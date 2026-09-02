-- ============ ENUMS ============
create type public.automation_rule_status as enum ('active','paused','archived');
create type public.automation_rule_priority as enum ('low','normal','high');
create type public.automation_condition_mode as enum ('all','any');
create type public.automation_execution_status as enum ('pending','running','completed','skipped','failed');
create type public.automation_event_origin as enum ('human','system','automation');
create type public.automation_action_type as enum (
  'set_verification_priority','move_to_manual_review','assign_operational_work','create_internal_note');
create type public.automation_trigger_type as enum (
  'order.created','order.cancelled',
  'verification.pending','verification.manual_review','verification.unreachable','verification.confirmed','verification.failed',
  'fulfillment.shortage','fulfillment.qc_failed','fulfillment.on_hold','fulfillment.handover',
  'shipment.created','shipment.on_hold','shipment.delivery_failed','shipment.delivered','shipment.returned',
  'inventory.low_stock','inventory.out_of_stock',
  'purchase_order.pending_approval','purchase_order.partially_received');

-- ============ TABLES ============
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  trigger_type public.automation_trigger_type not null,
  condition_mode public.automation_condition_mode not null default 'all',
  conditions jsonb not null default '[]'::jsonb,
  action_type public.automation_action_type not null,
  action_config jsonb not null default '{}'::jsonb,
  status public.automation_rule_status not null default 'active',
  priority public.automation_rule_priority not null default 'normal',
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rules_name_check check (btrim(name) <> ''),
  constraint automation_rules_conditions_array check (jsonb_typeof(conditions) = 'array'),
  constraint automation_rules_config_object check (jsonb_typeof(action_config) = 'object')
);
create index automation_rules_trigger_idx on public.automation_rules (trigger_type, status);
create index automation_rules_status_idx on public.automation_rules (status);

create table public.automation_rule_executions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete restrict,
  source_event_id text not null,
  event_type public.automation_trigger_type not null,
  entity_type text not null,
  entity_id uuid,
  status public.automation_execution_status not null default 'pending',
  input_snapshot jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  automation_depth integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint automation_executions_unique_source unique (rule_id, source_event_id)
);
create index automation_exec_rule_created_idx on public.automation_rule_executions (rule_id, created_at desc);
create index automation_exec_status_idx on public.automation_rule_executions (status, created_at desc);
create index automation_exec_entity_idx on public.automation_rule_executions (entity_type, entity_id);

create table public.automation_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  note text not null,
  rule_id uuid references public.automation_rules(id) on delete set null,
  execution_id uuid references public.automation_rule_executions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index automation_notes_entity_idx on public.automation_notes (entity_type, entity_id, created_at desc);

grant select on public.automation_rules to authenticated;
grant select on public.automation_rule_executions to authenticated;
grant select on public.automation_notes to authenticated;
grant all on public.automation_rules to service_role;
grant all on public.automation_rule_executions to service_role;
grant all on public.automation_notes to service_role;

alter table public.automation_rules enable row level security;
alter table public.automation_rule_executions enable row level security;
alter table public.automation_notes enable row level security;

create policy automation_rules_read on public.automation_rules
  for select to authenticated using (public.can_read_commerce(auth.uid()));
create policy automation_executions_read on public.automation_rule_executions
  for select to authenticated using (public.can_read_commerce(auth.uid()));
create policy automation_notes_read on public.automation_notes
  for select to authenticated using (public.can_read_commerce(auth.uid()));

-- ============ WRITE GUARDS ============
create or replace function public.guard_automation_write()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.automation_write', true), 'off') <> 'on' then
    raise exception 'Automation records can only be changed through the automation engine';
  end if;
  return coalesce(NEW, OLD);
end; $$;

create or replace function public.guard_automation_history_immutable()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'Automation execution history cannot be deleted';
  end if;
  if coalesce(current_setting('app.automation_write', true), 'off') <> 'on' then
    raise exception 'Automation execution history is append-only';
  end if;
  if OLD.status in ('completed','failed','skipped') then
    raise exception 'A finished automation execution cannot be modified';
  end if;
  if NEW.id <> OLD.id or NEW.rule_id <> OLD.rule_id or NEW.source_event_id <> OLD.source_event_id
     or NEW.created_at <> OLD.created_at then
    raise exception 'Automation execution identity is immutable';
  end if;
  return NEW;
end; $$;

create trigger automation_rules_guard before insert or update or delete on public.automation_rules
  for each row execute function public.guard_automation_write();
create trigger automation_notes_guard before insert or update or delete on public.automation_notes
  for each row execute function public.guard_automation_write();
create trigger automation_exec_insert_guard before insert on public.automation_rule_executions
  for each row execute function public.guard_automation_write();
create trigger automation_exec_history_guard before update or delete on public.automation_rule_executions
  for each row execute function public.guard_automation_history_immutable();

-- ============ REGISTRY ============
create or replace function public.automation_max_depth()
returns integer language sql immutable as $$ select 3 $$;

create or replace function public.automation_registry()
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  order_fields jsonb := jsonb_build_object(
    'order.total','number','order.source','text','order.status','text',
    'order.payment_method','text','order.item_count','number',
    'verification.status','text','verification.priority','text','verification.risk_level','text',
    'customer.is_blocked','boolean');
  ship_fields jsonb;
  ful_fields jsonb;
  inv_fields jsonb := jsonb_build_object(
    'inventory.available_quantity','number','inventory.on_hand','number',
    'inventory.low_stock_threshold','number','inventory.product_name','text','inventory.location','text');
  po_fields jsonb := jsonb_build_object(
    'purchase_order.status','text','purchase_order.total','number','purchase_order.supplier','text');
  order_actions jsonb := '["set_verification_priority","move_to_manual_review","assign_operational_work","create_internal_note"]'::jsonb;
  ful_actions jsonb := '["set_verification_priority","move_to_manual_review","assign_operational_work","create_internal_note"]'::jsonb;
  ship_actions jsonb := '["set_verification_priority","move_to_manual_review","create_internal_note"]'::jsonb;
  inv_actions jsonb := '["create_internal_note"]'::jsonb;
  po_actions jsonb := '["create_internal_note"]'::jsonb;
  triggers jsonb := '{}'::jsonb;
  t text;
begin
  ship_fields := order_fields || jsonb_build_object(
    'shipment.status','text','shipment.courier','text',
    'shipment.hold_reason','text','shipment.failure_reason','text');
  ful_fields := order_fields || jsonb_build_object(
    'fulfillment.status','text','fulfillment.event','text');

  foreach t in array array['order.created','order.cancelled','verification.pending','verification.manual_review',
                           'verification.unreachable','verification.confirmed','verification.failed'] loop
    triggers := triggers || jsonb_build_object(t, jsonb_build_object(
      'entity_type','order','fields',order_fields,'actions',order_actions));
  end loop;
  foreach t in array array['fulfillment.shortage','fulfillment.qc_failed','fulfillment.on_hold','fulfillment.handover'] loop
    triggers := triggers || jsonb_build_object(t, jsonb_build_object(
      'entity_type','fulfillment','fields',ful_fields,'actions',ful_actions));
  end loop;
  foreach t in array array['shipment.created','shipment.on_hold','shipment.delivery_failed','shipment.delivered','shipment.returned'] loop
    triggers := triggers || jsonb_build_object(t, jsonb_build_object(
      'entity_type','shipment','fields',ship_fields,'actions',ship_actions));
  end loop;
  foreach t in array array['inventory.low_stock','inventory.out_of_stock'] loop
    triggers := triggers || jsonb_build_object(t, jsonb_build_object(
      'entity_type','inventory_level','fields',inv_fields,'actions',inv_actions));
  end loop;
  foreach t in array array['purchase_order.pending_approval','purchase_order.partially_received'] loop
    triggers := triggers || jsonb_build_object(t, jsonb_build_object(
      'entity_type','purchase_order','fields',po_fields,'actions',po_actions));
  end loop;

  return jsonb_build_object(
    'max_depth', public.automation_max_depth(),
    'operators', jsonb_build_object(
      'number','["equals","not_equals","greater_than","greater_than_or_equal","less_than","less_than_or_equal","in","not_in","exists"]'::jsonb,
      'text','["equals","not_equals","contains","in","not_in","exists"]'::jsonb,
      'boolean','["equals","not_equals","exists"]'::jsonb),
    'triggers', triggers);
end; $$;

-- ============ VALIDATION ============
create or replace function public.automation_validate_rule(
  _trigger public.automation_trigger_type, _mode public.automation_condition_mode,
  _conditions jsonb, _action public.automation_action_type, _config jsonb)
returns void language plpgsql stable set search_path to 'public' as $$
declare
  reg jsonb := public.automation_registry();
  tdef jsonb := reg->'triggers'->(_trigger::text);
  cond jsonb; f text; op text; ftype text; val jsonb; assignee uuid;
begin
  if tdef is null then raise exception 'Unknown automation trigger: %', _trigger; end if;
  if jsonb_typeof(coalesce(_conditions,'[]'::jsonb)) <> 'array' then
    raise exception 'Conditions must be a list'; end if;
  if jsonb_array_length(coalesce(_conditions,'[]'::jsonb)) > 10 then
    raise exception 'A rule supports at most 10 conditions'; end if;
  if not (tdef->'actions') ? (_action::text) then
    raise exception 'Action % is not available for trigger %', _action, _trigger; end if;

  for cond in select value from jsonb_array_elements(coalesce(_conditions,'[]'::jsonb)) loop
    if jsonb_typeof(cond) <> 'object' then raise exception 'Each condition must be an object'; end if;
    if (select count(*) from jsonb_object_keys(cond) k where k not in ('field','operator','value')) > 0 then
      raise exception 'A condition may only contain field, operator and value'; end if;
    f := cond->>'field'; op := cond->>'operator'; val := cond->'value';
    ftype := tdef->'fields'->>f;
    if ftype is null then raise exception 'Field % is not allowed for trigger %', coalesce(f,'(missing)'), _trigger; end if;
    if not (reg->'operators'->ftype) ? coalesce(op,'') then
      raise exception 'Operator % is not valid for %', coalesce(op,'(missing)'), f; end if;
    if op <> 'exists' then
      if val is null or val = 'null'::jsonb then raise exception 'A comparison value is required for %', f; end if;
      if op in ('in','not_in') and jsonb_typeof(val) <> 'array' then
        raise exception 'Operator % requires a list of values for %', op, f; end if;
      if op not in ('in','not_in') and ftype = 'number' and jsonb_typeof(val) <> 'number' then
        raise exception 'Field % requires a numeric value', f; end if;
      if op not in ('in','not_in') and ftype = 'boolean' and jsonb_typeof(val) <> 'boolean' then
        raise exception 'Field % requires a true/false value', f; end if;
      if op not in ('in','not_in') and ftype = 'text' and jsonb_typeof(val) <> 'string' then
        raise exception 'Field % requires a text value', f; end if;
    end if;
  end loop;

  if jsonb_typeof(coalesce(_config,'{}'::jsonb)) <> 'object' then
    raise exception 'Action configuration must be an object'; end if;

  case _action
    when 'set_verification_priority' then
      if (select count(*) from jsonb_object_keys(_config) k where k <> 'priority') > 0 then
        raise exception 'Unexpected action configuration fields'; end if;
      if coalesce(_config->>'priority','') not in ('low','normal','high','urgent') then
        raise exception 'A valid verification priority is required'; end if;
    when 'move_to_manual_review' then
      if (select count(*) from jsonb_object_keys(_config) k where k <> 'reason') > 0 then
        raise exception 'Unexpected action configuration fields'; end if;
      if btrim(coalesce(_config->>'reason','')) = '' then
        raise exception 'A reason is required for manual review'; end if;
    when 'assign_operational_work' then
      if (select count(*) from jsonb_object_keys(_config) k where k not in ('assigned_to','note')) > 0 then
        raise exception 'Unexpected action configuration fields'; end if;
      begin assignee := (_config->>'assigned_to')::uuid;
      exception when others then raise exception 'A valid assignee is required'; end;
      if assignee is null or not exists (
        select 1 from public.profiles p where p.id = assignee and p.role <> 'viewer') then
        raise exception 'Assignee must be an eligible operational staff member'; end if;
    when 'create_internal_note' then
      if (select count(*) from jsonb_object_keys(_config) k where k <> 'note') > 0 then
        raise exception 'Unexpected action configuration fields'; end if;
      if btrim(coalesce(_config->>'note','')) = '' then
        raise exception 'A note is required'; end if;
      if length(_config->>'note') > 1000 then raise exception 'Note is too long'; end if;
  end case;
end; $$;

-- ============ CONDITION EVALUATION ============
create or replace function public.automation_evaluate_conditions(
  _trigger public.automation_trigger_type, _mode public.automation_condition_mode,
  _conditions jsonb, _ctx jsonb)
returns boolean language plpgsql stable set search_path to 'public' as $$
declare
  tdef jsonb := public.automation_registry()->'triggers'->(_trigger::text);
  cond jsonb; f text; op text; val jsonb; ftype text; actual jsonb;
  ok boolean; any_true boolean := false; total int := 0;
begin
  if coalesce(jsonb_array_length(coalesce(_conditions,'[]'::jsonb)),0) = 0 then return true; end if;
  for cond in select value from jsonb_array_elements(_conditions) loop
    total := total + 1;
    f := cond->>'field'; op := cond->>'operator'; val := cond->'value';
    ftype := tdef->'fields'->>f;
    actual := _ctx #> string_to_array(f, '.');
    if actual = 'null'::jsonb then actual := null; end if;

    if op = 'exists' then
      ok := actual is not null;
    elsif actual is null then
      ok := false;
    elsif op = 'in' then
      ok := exists (select 1 from jsonb_array_elements(val) e where e = actual or e#>>'{}' = actual#>>'{}');
    elsif op = 'not_in' then
      ok := not exists (select 1 from jsonb_array_elements(val) e where e = actual or e#>>'{}' = actual#>>'{}');
    elsif ftype = 'number' then
      declare a numeric := (actual#>>'{}')::numeric; v numeric := (val#>>'{}')::numeric;
      begin
        ok := case op
          when 'equals' then a = v when 'not_equals' then a <> v
          when 'greater_than' then a > v when 'greater_than_or_equal' then a >= v
          when 'less_than' then a < v when 'less_than_or_equal' then a <= v else false end;
      end;
    elsif ftype = 'boolean' then
      declare a boolean := (actual#>>'{}')::boolean; v boolean := (val#>>'{}')::boolean;
      begin ok := case op when 'equals' then a = v when 'not_equals' then a <> v else false end; end;
    else
      declare a text := actual#>>'{}'; v text := val#>>'{}';
      begin
        ok := case op
          when 'equals' then a = v when 'not_equals' then a <> v
          when 'contains' then position(lower(v) in lower(a)) > 0 else false end;
      end;
    end if;

    if _mode = 'all' and not ok then return false; end if;
    if ok then any_true := true; end if;
  end loop;
  if _mode = 'any' then return any_true; end if;
  return true;
end; $$;

-- ============ CONTEXT BUILDERS ============
create or replace function public.automation_order_context(_order_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order', jsonb_build_object(
      'total', o.grand_total, 'source', o.source::text, 'status', o.status::text,
      'payment_method', o.payment_method::text, 'order_number', o.order_number,
      'item_count', (select coalesce(sum(i.quantity),0) from public.order_items i where i.order_id = o.id)),
    'verification', jsonb_build_object(
      'status', o.verification_status::text, 'priority', o.verification_priority::text,
      'risk_level', o.risk_level::text),
    'customer', jsonb_build_object(
      'id', o.customer_id,
      'is_blocked', coalesce((select c.status = 'blocked' from public.customers c where c.id = o.customer_id), false)))
  from public.orders o where o.id = _order_id;
$$;

-- ============ ACTION EXECUTION ============
create or replace function public.automation_sanitize_error(_msg text)
returns text language sql immutable as $$
  select left(regexp_replace(coalesce(_msg,'Automation action failed'), '[\r\n].*$', '', 'g'), 300);
$$;

create or replace function public.automation_execute_action(
  _rule public.automation_rules, _ctx jsonb, _execution_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  _order_id uuid := nullif(_ctx->>'order_id','')::uuid;
  _note text;
begin
  case _rule.action_type
    when 'set_verification_priority' then
      if _order_id is null then raise exception 'No order is linked to this event'; end if;
      perform public.set_order_verification_priority(_order_id, (_rule.action_config->>'priority')::public.verification_priority);
      return jsonb_build_object('action','set_verification_priority','order_id',_order_id,
                                'priority', _rule.action_config->>'priority');

    when 'move_to_manual_review' then
      if _order_id is null then raise exception 'No order is linked to this event'; end if;
      perform public.set_order_verification_state(_order_id, 'manual_review', _rule.action_config->>'reason');
      return jsonb_build_object('action','move_to_manual_review','order_id',_order_id);

    when 'assign_operational_work' then
      if (_ctx->>'assignment_source_type') is null or (_ctx->>'assignment_source_id') is null then
        raise exception 'This event has no assignable work item'; end if;
      if exists (select 1 from public.operational_assignments a
                  where a.source_type = (_ctx->>'assignment_source_type')::public.operation_source_type
                    and a.source_id = (_ctx->>'assignment_source_id')::uuid
                    and a.released_at is null) then
        return jsonb_build_object('action','assign_operational_work','skipped','already_assigned');
      end if;
      perform public.assign_operational_work(
        (_ctx->>'assignment_source_type')::public.operation_source_type,
        (_ctx->>'assignment_source_id')::uuid,
        (_rule.action_config->>'assigned_to')::uuid,
        'Assigned automatically by rule: ' || _rule.name);
      return jsonb_build_object('action','assign_operational_work',
        'assigned_to', _rule.action_config->>'assigned_to');

    when 'create_internal_note' then
      _note := 'Automated by rule: ' || _rule.name || ' — ' || (_rule.action_config->>'note');
      if _order_id is not null then
        insert into public.order_notes (order_id, note, note_type, is_internal, created_by)
        values (_order_id, _note, 'system', true, null);
        return jsonb_build_object('action','create_internal_note','target','order','order_id',_order_id);
      elsif _ctx->>'purchase_order_id' is not null then
        perform public.log_purchase_order_event(
          (_ctx->>'purchase_order_id')::uuid, 'note_added', _note, null, null,
          jsonb_build_object('automation_rule_id', _rule.id, 'origin', 'automation'));
        return jsonb_build_object('action','create_internal_note','target','purchase_order');
      else
        perform set_config('app.automation_write','on', true);
        insert into public.automation_notes (entity_type, entity_id, note, rule_id, execution_id)
        values (_ctx->>'entity_type', (_ctx->>'entity_id')::uuid, _note, _rule.id, _execution_id);
        perform set_config('app.automation_write','off', true);
        return jsonb_build_object('action','create_internal_note','target','automation_note');
      end if;
  end case;
  raise exception 'Unsupported automation action';
end; $$;

-- ============ ENGINE ============
create or replace function public.automation_emit_event(
  _event_type public.automation_trigger_type, _entity_type text, _entity_id uuid,
  _source_event_id text, _payload jsonb, _origin public.automation_event_origin default 'system')
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  depth int := coalesce(nullif(current_setting('app.automation_depth', true), '')::int, 0);
  chain text := coalesce(current_setting('app.automation_rule_chain', true), '');
  ctx jsonb := coalesce(_payload,'{}'::jsonb)
    || jsonb_build_object('entity_type', _entity_type, 'entity_id', _entity_id, 'origin', _origin::text);
  r public.automation_rules;
  exec_id uuid; res jsonb;
begin
  if _source_event_id is null or btrim(_source_event_id) = '' then return; end if;

  for r in
    select * from public.automation_rules
     where status = 'active' and trigger_type = _event_type
     order by case priority when 'high' then 0 when 'normal' then 1 else 2 end, created_at
  loop
    -- same-rule recursion protection
    if position(r.id::text in chain) > 0 then continue; end if;

    perform set_config('app.automation_write', 'on', true);
    begin
      insert into public.automation_rule_executions
        (rule_id, source_event_id, event_type, entity_type, entity_id, status, input_snapshot,
         automation_depth, started_at)
      values (r.id, _source_event_id, _event_type, _entity_type, _entity_id, 'running', ctx, depth, now())
      returning id into exec_id;
    exception when unique_violation then
      perform set_config('app.automation_write', 'off', true);
      continue;
    end;
    perform set_config('app.automation_write', 'off', true);

    if depth >= public.automation_max_depth() then
      perform set_config('app.automation_write', 'on', true);
      update public.automation_rule_executions
         set status = 'skipped', result = jsonb_build_object('reason','max_depth_exceeded'), completed_at = now()
       where id = exec_id;
      perform set_config('app.automation_write', 'off', true);
      continue;
    end if;

    if not public.automation_evaluate_conditions(_event_type, r.condition_mode, r.conditions, ctx) then
      perform set_config('app.automation_write', 'on', true);
      update public.automation_rule_executions
         set status = 'skipped', result = jsonb_build_object('reason','conditions_not_met'), completed_at = now()
       where id = exec_id;
      perform set_config('app.automation_write', 'off', true);
      continue;
    end if;

    begin
      perform set_config('app.automation_depth', (depth + 1)::text, true);
      perform set_config('app.automation_rule_chain', chain || '|' || r.id::text, true);
      res := public.automation_execute_action(r, ctx, exec_id);
      perform set_config('app.automation_depth', depth::text, true);
      perform set_config('app.automation_rule_chain', chain, true);
      perform set_config('app.automation_write', 'on', true);
      update public.automation_rule_executions
         set status = 'completed', result = res, completed_at = now() where id = exec_id;
      perform set_config('app.automation_write', 'off', true);
    exception when others then
      perform set_config('app.automation_depth', depth::text, true);
      perform set_config('app.automation_rule_chain', chain, true);
      perform set_config('app.automation_write', 'on', true);
      update public.automation_rule_executions
         set status = 'failed', error_message = public.automation_sanitize_error(SQLERRM),
             result = jsonb_build_object('action', r.action_type::text), completed_at = now()
       where id = exec_id;
      perform set_config('app.automation_write', 'off', true);
    end;
  end loop;
end; $$;

-- ============ CONTROLLED RULE CRUD ============
create or replace function public.save_automation_rule(_payload jsonb)
returns public.automation_rules language plpgsql security definer set search_path to 'public' as $$
declare
  _id uuid := nullif(_payload->>'id','')::uuid;
  _row public.automation_rules;
  _trigger public.automation_trigger_type := (_payload->>'trigger_type')::public.automation_trigger_type;
  _mode public.automation_condition_mode := coalesce((_payload->>'condition_mode')::public.automation_condition_mode,'all');
  _conditions jsonb := coalesce(_payload->'conditions','[]'::jsonb);
  _action public.automation_action_type := (_payload->>'action_type')::public.automation_action_type;
  _config jsonb := coalesce(_payload->'action_config','{}'::jsonb);
  _status public.automation_rule_status := coalesce((_payload->>'status')::public.automation_rule_status,'active');
  _priority public.automation_rule_priority := coalesce((_payload->>'priority')::public.automation_rule_priority,'normal');
  _name text := btrim(coalesce(_payload->>'name',''));
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an admin or owner can manage automation rules'; end if;
  if _name = '' then raise exception 'A rule name is required'; end if;
  if _status = 'archived' then raise exception 'Use the archive action to archive a rule'; end if;
  perform public.automation_validate_rule(_trigger, _mode, _conditions, _action, _config);

  perform set_config('app.automation_write','on', true);
  if _id is null then
    insert into public.automation_rules
      (name, description, trigger_type, condition_mode, conditions, action_type, action_config,
       status, priority, created_by, updated_by)
    values (_name, nullif(btrim(coalesce(_payload->>'description','')),''), _trigger, _mode, _conditions,
            _action, _config, _status, _priority, auth.uid(), auth.uid())
    returning * into _row;
  else
    select * into _row from public.automation_rules where id = _id for update;
    if _row.id is null then raise exception 'Automation rule not found'; end if;
    if _row.status = 'archived' then raise exception 'An archived rule cannot be edited'; end if;
    update public.automation_rules
       set name = _name, description = nullif(btrim(coalesce(_payload->>'description','')),''),
           trigger_type = _trigger, condition_mode = _mode, conditions = _conditions,
           action_type = _action, action_config = _config, status = _status, priority = _priority,
           updated_by = auth.uid(), updated_at = now()
     where id = _id returning * into _row;
  end if;
  perform set_config('app.automation_write','off', true);
  return _row;
end; $$;

create or replace function public.set_automation_rule_status(
  _rule_id uuid, _status public.automation_rule_status)
returns public.automation_rules language plpgsql security definer set search_path to 'public' as $$
declare _row public.automation_rules;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an admin or owner can manage automation rules'; end if;
  select * into _row from public.automation_rules where id = _rule_id for update;
  if _row.id is null then raise exception 'Automation rule not found'; end if;
  if _row.status = 'archived' then raise exception 'An archived rule cannot change status'; end if;
  perform set_config('app.automation_write','on', true);
  update public.automation_rules set status = _status, updated_by = auth.uid(), updated_at = now()
   where id = _rule_id returning * into _row;
  perform set_config('app.automation_write','off', true);
  return _row;
end; $$;

revoke all on function public.automation_emit_event(public.automation_trigger_type, text, uuid, text, jsonb, public.automation_event_origin) from public, anon, authenticated;
revoke all on function public.automation_execute_action(public.automation_rules, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.guard_automation_write() from public, anon, authenticated;
revoke all on function public.guard_automation_history_immutable() from public, anon, authenticated;
revoke all on function public.save_automation_rule(jsonb) from public, anon;
revoke all on function public.set_automation_rule_status(uuid, public.automation_rule_status) from public, anon;
revoke all on function public.automation_registry() from anon;
revoke all on function public.automation_validate_rule(public.automation_trigger_type, public.automation_condition_mode, jsonb, public.automation_action_type, jsonb) from anon;
grant execute on function public.save_automation_rule(jsonb) to authenticated;
grant execute on function public.set_automation_rule_status(uuid, public.automation_rule_status) to authenticated;
grant execute on function public.automation_registry() to authenticated;

-- ============ INTEGRATION: VERIFICATION ============
CREATE OR REPLACE FUNCTION public.apply_verification_transition(_order_id uuid, _to order_verification_status, _event verification_event_type, _message text, _attempt_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT NULL::jsonb, _scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _risk_level verification_risk_level DEFAULT NULL::verification_risk_level, _risk_reason text DEFAULT NULL::text, _failure_reason text DEFAULT NULL::text, _touch_attempt boolean DEFAULT false)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _order public.orders; _from public.order_verification_status; _event_id uuid; _trigger public.automation_trigger_type;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  _from := _order.verification_status;

  IF _order.status = 'cancelled' AND _to <> 'cancelled' THEN
    RAISE EXCEPTION 'This order is cancelled — verification can no longer be changed';
  END IF;
  IF NOT public.verification_transition_allowed(_from, _to) THEN
    RAISE EXCEPTION 'Verification cannot move from % to %', _from, _to;
  END IF;

  PERFORM set_config('app.verification_write', 'on', true);
  UPDATE public.orders
     SET verification_status = _to,
         risk_level = coalesce(_risk_level, risk_level),
         risk_reason = CASE WHEN _risk_reason IS NULL THEN risk_reason ELSE _risk_reason END,
         verification_failure_reason = CASE WHEN _to = 'failed' THEN _failure_reason ELSE verification_failure_reason END,
         verification_confirmed_at = CASE WHEN _to = 'confirmed' THEN now() ELSE verification_confirmed_at END,
         verification_next_action_at = CASE
           WHEN _to IN ('confirmed','failed','cancelled','unreachable') THEN NULL
           WHEN _scheduled_at IS NOT NULL THEN _scheduled_at
           ELSE verification_next_action_at END,
         verification_last_attempt_at = CASE WHEN _touch_attempt THEN now() ELSE verification_last_attempt_at END,
         verification_attempt_count = (
           SELECT count(*) FROM public.order_verification_attempts a WHERE a.order_id = _order_id
         ),
         updated_by = coalesce(auth.uid(), updated_by)
   WHERE id = _order_id
   RETURNING * INTO _order;

  INSERT INTO public.order_verification_events
    (order_id, attempt_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_order_id, _attempt_id, _event, _from, _to, _message, _metadata, auth.uid())
  RETURNING id INTO _event_id;
  PERFORM set_config('app.verification_write', 'off', true);

  IF _to = 'confirmed' AND _from <> 'confirmed' AND _order.status <> 'cancelled' THEN
    _order := public.reserve_order_inventory(_order_id);
  END IF;

  _trigger := CASE _to
    WHEN 'pending' THEN 'verification.pending'::public.automation_trigger_type
    WHEN 'manual_review' THEN 'verification.manual_review'::public.automation_trigger_type
    WHEN 'unreachable' THEN 'verification.unreachable'::public.automation_trigger_type
    WHEN 'confirmed' THEN 'verification.confirmed'::public.automation_trigger_type
    WHEN 'failed' THEN 'verification.failed'::public.automation_trigger_type
    ELSE NULL END;
  IF _trigger IS NOT NULL AND _from IS DISTINCT FROM _to THEN
    PERFORM public.automation_emit_event(
      _trigger, 'order', _order_id, 'verification_event:' || _event_id::text,
      public.automation_order_context(_order_id)
        || jsonb_build_object('assignment_source_type','order_verification','assignment_source_id',_order_id),
      CASE WHEN coalesce(nullif(current_setting('app.automation_depth', true), '')::int, 0) > 0
           THEN 'automation'::public.automation_event_origin ELSE 'human'::public.automation_event_origin END);
  END IF;

  RETURN _order;
END; $function$;

-- ============ INTEGRATION: FULFILLMENT ============
CREATE OR REPLACE FUNCTION public.log_fulfillment_event(_fulfillment_id uuid, _order_id uuid, _event fulfillment_event_type, _from fulfillment_record_status, _to fulfillment_record_status, _message text, _metadata jsonb DEFAULT NULL::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _event_id uuid; _trigger public.automation_trigger_type;
BEGIN
  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  INSERT INTO public.order_fulfillment_events
    (fulfillment_id, order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_fulfillment_id, _order_id, _event, _from, _to, _message, _metadata, auth.uid())
  RETURNING id INTO _event_id;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  _trigger := CASE
    WHEN _event = 'qc_failed' THEN 'fulfillment.qc_failed'::public.automation_trigger_type
    WHEN _event = 'put_on_hold' THEN 'fulfillment.on_hold'::public.automation_trigger_type
    WHEN _event = 'ready_for_handover' THEN 'fulfillment.handover'::public.automation_trigger_type
    WHEN coalesce(_metadata,'{}'::jsonb) ? 'shortage_reason' THEN 'fulfillment.shortage'::public.automation_trigger_type
    ELSE NULL END;
  IF _trigger IS NOT NULL THEN
    PERFORM public.automation_emit_event(
      _trigger, 'fulfillment', _fulfillment_id, 'fulfillment_event:' || _event_id::text,
      public.automation_order_context(_order_id)
        || jsonb_build_object('fulfillment', jsonb_build_object('status', _to::text, 'event', _event::text),
                              'assignment_source_type','order_fulfillment','assignment_source_id',_fulfillment_id),
      CASE WHEN coalesce(nullif(current_setting('app.automation_depth', true), '')::int, 0) > 0
           THEN 'automation'::public.automation_event_origin ELSE 'human'::public.automation_event_origin END);
  END IF;
END; $function$;

-- ============ INTEGRATION: SHIPMENT ============
CREATE OR REPLACE FUNCTION public.log_shipment_event(_shipment_id uuid, _order_id uuid, _event shipment_event_type, _from shipment_status, _to shipment_status, _message text, _metadata jsonb DEFAULT NULL::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _event_id uuid; _trigger public.automation_trigger_type; _ship public.shipments; _courier text;
BEGIN
  PERFORM set_config('app.shipment_write', 'on', true);
  INSERT INTO public.shipment_events
    (shipment_id, order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_shipment_id, _order_id, _event, _from, _to, _message, _metadata, auth.uid())
  RETURNING id INTO _event_id;
  PERFORM set_config('app.shipment_write', 'off', true);

  _trigger := CASE
    WHEN _event = 'shipment_created' THEN 'shipment.created'::public.automation_trigger_type
    WHEN _to = 'delivery_on_hold' THEN 'shipment.on_hold'::public.automation_trigger_type
    WHEN _to = 'delivery_failed' THEN 'shipment.delivery_failed'::public.automation_trigger_type
    WHEN _to = 'delivered' THEN 'shipment.delivered'::public.automation_trigger_type
    WHEN _to = 'return_received' THEN 'shipment.returned'::public.automation_trigger_type
    ELSE NULL END;
  IF _trigger IS NOT NULL THEN
    SELECT * INTO _ship FROM public.shipments WHERE id = _shipment_id;
    SELECT p.name INTO _courier FROM public.courier_providers p WHERE p.id = _ship.provider_id;
    PERFORM public.automation_emit_event(
      _trigger, 'shipment', _shipment_id, 'shipment_event:' || _event_id::text,
      public.automation_order_context(_order_id)
        || jsonb_build_object('shipment', jsonb_build_object(
             'status', coalesce(_to, _ship.status)::text, 'courier', _courier,
             'hold_reason', _ship.hold_reason::text, 'failure_reason', _ship.failure_reason::text)),
      CASE WHEN coalesce(nullif(current_setting('app.automation_depth', true), '')::int, 0) > 0
           THEN 'automation'::public.automation_event_origin ELSE 'system'::public.automation_event_origin END);
  END IF;
END; $function$;

-- ============ INTEGRATION: PURCHASE ORDERS ============
CREATE OR REPLACE FUNCTION public.log_purchase_order_event(_po_id uuid, _event purchase_order_event_type, _message text, _from purchase_order_status DEFAULT NULL::purchase_order_status, _to purchase_order_status DEFAULT NULL::purchase_order_status, _metadata jsonb DEFAULT NULL::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _event_id uuid; _trigger public.automation_trigger_type; _po public.purchase_orders; _supplier text;
BEGIN
  PERFORM set_config('app.procurement_write', 'on', true);
  INSERT INTO public.purchase_order_events
    (purchase_order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_po_id, _event, _from, _to, _message, _metadata, auth.uid())
  RETURNING id INTO _event_id;
  PERFORM set_config('app.procurement_write', 'off', true);

  _trigger := CASE _to
    WHEN 'pending_approval' THEN 'purchase_order.pending_approval'::public.automation_trigger_type
    WHEN 'partially_received' THEN 'purchase_order.partially_received'::public.automation_trigger_type
    ELSE NULL END;
  IF _trigger IS NOT NULL AND _from IS DISTINCT FROM _to THEN
    SELECT * INTO _po FROM public.purchase_orders WHERE id = _po_id;
    SELECT s.name INTO _supplier FROM public.suppliers s WHERE s.id = _po.supplier_id;
    PERFORM public.automation_emit_event(
      _trigger, 'purchase_order', _po_id, 'purchase_order_event:' || _event_id::text,
      jsonb_build_object('purchase_order_id', _po_id,
        'purchase_order', jsonb_build_object('status', _to::text, 'total', _po.grand_total, 'supplier', _supplier)),
      CASE WHEN coalesce(nullif(current_setting('app.automation_depth', true), '')::int, 0) > 0
           THEN 'automation'::public.automation_event_origin ELSE 'human'::public.automation_event_origin END);
  END IF;
END; $function$;

-- ============ INTEGRATION: INVENTORY THRESHOLD TRANSITIONS ============
CREATE OR REPLACE FUNCTION public.apply_inventory_movement(_inventory_level_id uuid, _movement_type inventory_movement_type, _quantity integer, _note text DEFAULT NULL::text, _reference_type text DEFAULT NULL::text, _reference_id uuid DEFAULT NULL::uuid, _reason inventory_adjustment_reason DEFAULT NULL::inventory_adjustment_reason)
 RETURNS inventory_levels LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  lvl public.inventory_levels;
  old_on_hand int; old_reserved int; old_damaged int; old_incoming int;
  new_on_hand int; new_reserved int; new_damaged int; new_incoming int;
  _movement_id uuid; _threshold int; _before int; _after int;
  _trigger public.automation_trigger_type; _ctx jsonb;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to adjust inventory';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT * INTO lvl FROM public.inventory_levels WHERE id = _inventory_level_id FOR UPDATE;
  IF lvl.id IS NULL THEN RAISE EXCEPTION 'Inventory record not found'; END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_locations
              WHERE id = lvl.location_id AND status = 'archived') THEN
    RAISE EXCEPTION 'Archived locations cannot receive inventory movements';
  END IF;

  old_on_hand := lvl.on_hand; old_reserved := lvl.reserved;
  old_damaged := lvl.damaged; old_incoming := lvl.incoming;
  new_on_hand := old_on_hand; new_reserved := old_reserved;
  new_damaged := old_damaged; new_incoming := old_incoming;

  CASE _movement_type
    WHEN 'initial', 'adjustment_in', 'return_in', 'purchase_in', 'transfer_in', 'stocktake_in' THEN
      new_on_hand := new_on_hand + _quantity;
    WHEN 'adjustment_out', 'transfer_out', 'stocktake_out' THEN
      new_on_hand := new_on_hand - _quantity;
    WHEN 'damage' THEN
      new_on_hand := new_on_hand - _quantity;
      new_damaged := new_damaged + _quantity;
    WHEN 'purchase_damaged_in' THEN
      new_damaged := new_damaged + _quantity;
    WHEN 'damaged_out' THEN
      new_damaged := new_damaged - _quantity;
    WHEN 'transfer_incoming_in' THEN
      new_incoming := new_incoming + _quantity;
    WHEN 'transfer_incoming_out' THEN
      new_incoming := new_incoming - _quantity;
    WHEN 'reservation' THEN
      new_reserved := new_reserved + _quantity;
    WHEN 'release_reservation' THEN
      new_reserved := new_reserved - _quantity;
    WHEN 'fulfillment_out' THEN
      new_reserved := new_reserved - _quantity;
      new_on_hand := new_on_hand - _quantity;
  END CASE;

  IF new_on_hand < 0 THEN
    RAISE EXCEPTION 'Not enough stock: on hand is %, cannot remove %', old_on_hand, _quantity;
  END IF;
  IF new_damaged < 0 THEN
    RAISE EXCEPTION 'Cannot remove more than the damaged quantity (%).', old_damaged;
  END IF;
  IF new_reserved < 0 THEN
    RAISE EXCEPTION 'Cannot release more than the reserved quantity (%).', old_reserved;
  END IF;
  IF new_incoming < 0 THEN
    RAISE EXCEPTION 'Cannot remove more than the in-transit quantity (%).', old_incoming;
  END IF;
  IF new_reserved > new_on_hand THEN
    RAISE EXCEPTION 'Reserved (%) cannot exceed on hand (%)', new_reserved, new_on_hand;
  END IF;

  PERFORM set_config('app.inventory_write', 'on', true);
  UPDATE public.inventory_levels
     SET on_hand = new_on_hand, reserved = new_reserved, damaged = new_damaged,
         incoming = new_incoming, updated_by = auth.uid()
   WHERE id = _inventory_level_id
   RETURNING * INTO lvl;
  PERFORM set_config('app.inventory_write', 'off', true);

  INSERT INTO public.inventory_movements
    (inventory_level_id, movement_type, quantity, reference_type, reference_id, note, reason, created_by,
     on_hand_before, on_hand_after, reserved_before, reserved_after,
     damaged_before, damaged_after, incoming_before, incoming_after)
  VALUES (_inventory_level_id, _movement_type, _quantity, _reference_type, _reference_id, _note, _reason, auth.uid(),
     old_on_hand, new_on_hand, old_reserved, new_reserved,
     old_damaged, new_damaged, old_incoming, new_incoming)
  RETURNING id INTO _movement_id;

  -- Threshold-transition based automation events (no stored stock alerts).
  _threshold := coalesce(lvl.low_stock_threshold, 5);
  _before := old_on_hand - old_reserved;
  _after := new_on_hand - new_reserved;
  IF _before > 0 AND _after <= 0 THEN
    _trigger := 'inventory.out_of_stock';
  ELSIF _before > _threshold AND _after <= _threshold AND _after > 0 THEN
    _trigger := 'inventory.low_stock';
  END IF;

  IF _trigger IS NOT NULL THEN
    SELECT jsonb_build_object(
      'inventory', jsonb_build_object(
        'available_quantity', _after, 'on_hand', new_on_hand,
        'low_stock_threshold', _threshold,
        'product_name', p.name,
        'location', l.name))
      INTO _ctx
      FROM public.products p, public.inventory_locations l
     WHERE p.id = lvl.product_id AND l.id = lvl.location_id;
    PERFORM public.automation_emit_event(
      _trigger, 'inventory_level', _inventory_level_id, 'inventory_movement:' || _movement_id::text,
      coalesce(_ctx, '{}'::jsonb),
      CASE WHEN coalesce(nullif(current_setting('app.automation_depth', true), '')::int, 0) > 0
           THEN 'automation'::public.automation_event_origin ELSE 'human'::public.automation_event_origin END);
  END IF;

  RETURN lvl;
END; $function$;

-- ============ INTEGRATION: ORDER LIFECYCLE ============
create or replace function public.emit_order_automation_events()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'INSERT' then
    perform public.automation_emit_event('order.created', 'order', NEW.id,
      'order_created:' || NEW.id::text, public.automation_order_context(NEW.id), 'human');
  elsif NEW.status = 'cancelled' and OLD.status is distinct from NEW.status then
    perform public.automation_emit_event('order.cancelled', 'order', NEW.id,
      'order_cancelled:' || NEW.id::text, public.automation_order_context(NEW.id), 'human');
  end if;
  return null;
end; $$;

create trigger orders_automation_events after insert or update of status on public.orders
  for each row execute function public.emit_order_automation_events();
