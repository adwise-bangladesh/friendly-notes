
-- ============ Assignment foundation ============
create type public.operation_source_type as enum (
  'order_verification','order_fulfillment','order_return','shipment_exception'
);

create type public.operation_assignment_event_type as enum ('assigned','reassigned','released');

create table public.operational_assignments (
  id uuid primary key default gen_random_uuid(),
  source_type public.operation_source_type not null,
  source_id uuid not null,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  note text,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index operational_assignments_active_key
  on public.operational_assignments (source_type, source_id)
  where released_at is null;
create index operational_assignments_assignee_idx
  on public.operational_assignments (assigned_to) where released_at is null;

create table public.operational_assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.operational_assignments(id) on delete cascade,
  source_type public.operation_source_type not null,
  source_id uuid not null,
  event_type public.operation_assignment_event_type not null,
  assigned_to uuid references auth.users(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index operational_assignment_events_source_idx
  on public.operational_assignment_events (source_type, source_id, created_at desc);

grant select on public.operational_assignments to authenticated;
grant select on public.operational_assignment_events to authenticated;
grant all on public.operational_assignments to service_role;
grant all on public.operational_assignment_events to service_role;

alter table public.operational_assignments enable row level security;
alter table public.operational_assignment_events enable row level security;

create policy "Commerce readers can view assignments"
  on public.operational_assignments for select to authenticated
  using (public.can_read_commerce(auth.uid()));
create policy "Commerce readers can view assignment history"
  on public.operational_assignment_events for select to authenticated
  using (public.can_read_commerce(auth.uid()));

-- No insert/update/delete policies: writes only via SECURITY DEFINER functions.
create or replace function public.guard_operational_assignment_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.operations_assignment', true) <> 'on' then
    raise exception 'Operational assignments are changed through controlled operations only';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_operational_assignments
  before insert or update or delete on public.operational_assignments
  for each row execute function public.guard_operational_assignment_write();

create or replace function public.guard_operational_assignment_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Assignment history is append-only';
  end if;
  if current_setting('app.operations_assignment', true) <> 'on' then
    raise exception 'Assignment history is written through controlled operations only';
  end if;
  return new;
end;
$$;

create trigger guard_operational_assignment_events
  before insert or update or delete on public.operational_assignment_events
  for each row execute function public.guard_operational_assignment_events();

-- ---------- Controlled assignment operations ----------
create or replace function public.assign_operational_work(
  _source_type public.operation_source_type,
  _source_id uuid,
  _assigned_to uuid,
  _note text default null
) returns public.operational_assignments
language plpgsql security definer set search_path = public as $$
declare
  _actor uuid := auth.uid();
  _actor_role public.app_role;
  _target_role public.app_role;
  _existing public.operational_assignments;
  _row public.operational_assignments;
  _event public.operation_assignment_event_type := 'assigned';
begin
  if _actor is null then raise exception 'Authentication required'; end if;
  select role into _actor_role from public.profiles where id = _actor;
  if _actor_role is null or _actor_role = 'viewer' then
    raise exception 'Not authorized to assign operational work';
  end if;
  if _actor_role = 'staff' and _assigned_to <> _actor then
    raise exception 'Staff can only assign operational work to themselves';
  end if;
  select role into _target_role from public.profiles where id = _assigned_to;
  if _target_role is null or _target_role = 'viewer' then
    raise exception 'Assignee must be an operational staff member';
  end if;

  perform public.assert_operation_source_exists(_source_type, _source_id);

  perform set_config('app.operations_assignment', 'on', true);

  select * into _existing from public.operational_assignments
   where source_type = _source_type and source_id = _source_id and released_at is null
   for update;

  if found then
    if _existing.assigned_to = _assigned_to then
      perform set_config('app.operations_assignment', 'off', true);
      return _existing;
    end if;
    update public.operational_assignments
       set released_at = now(), released_by = _actor
     where id = _existing.id;
    _event := 'reassigned';
  end if;

  insert into public.operational_assignments (source_type, source_id, assigned_to, assigned_by, note)
  values (_source_type, _source_id, _assigned_to, _actor, nullif(btrim(coalesce(_note,'')), ''))
  returning * into _row;

  insert into public.operational_assignment_events
    (assignment_id, source_type, source_id, event_type, assigned_to, actor_id, note)
  values (_row.id, _source_type, _source_id, _event, _assigned_to, _actor,
          nullif(btrim(coalesce(_note,'')), ''));

  perform set_config('app.operations_assignment', 'off', true);
  return _row;
end;
$$;

create or replace function public.assert_operation_source_exists(
  _source_type public.operation_source_type,
  _source_id uuid
) returns void language plpgsql stable security definer set search_path = public as $$
declare _ok boolean;
begin
  case _source_type
    when 'order_verification' then select exists(select 1 from public.orders where id = _source_id) into _ok;
    when 'order_fulfillment' then select exists(select 1 from public.order_fulfillments where id = _source_id) into _ok;
    when 'order_return' then select exists(select 1 from public.order_returns where id = _source_id) into _ok;
    when 'shipment_exception' then select exists(select 1 from public.shipment_exceptions where id = _source_id) into _ok;
  end case;
  if not coalesce(_ok, false) then
    raise exception 'Operational source record not found';
  end if;
end;
$$;

create or replace function public.release_operational_work(
  _source_type public.operation_source_type,
  _source_id uuid,
  _note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  _actor uuid := auth.uid();
  _actor_role public.app_role;
  _existing public.operational_assignments;
begin
  if _actor is null then raise exception 'Authentication required'; end if;
  select role into _actor_role from public.profiles where id = _actor;
  if _actor_role is null or _actor_role = 'viewer' then
    raise exception 'Not authorized to change operational assignments';
  end if;

  select * into _existing from public.operational_assignments
   where source_type = _source_type and source_id = _source_id and released_at is null;
  if not found then return; end if;

  if _actor_role = 'staff' and _existing.assigned_to <> _actor then
    raise exception 'Staff can only release their own operational work';
  end if;

  perform set_config('app.operations_assignment', 'on', true);
  update public.operational_assignments
     set released_at = now(), released_by = _actor
   where id = _existing.id;
  insert into public.operational_assignment_events
    (assignment_id, source_type, source_id, event_type, assigned_to, actor_id, note)
  values (_existing.id, _source_type, _source_id, 'released', _existing.assigned_to, _actor,
          nullif(btrim(coalesce(_note,'')), ''));
  perform set_config('app.operations_assignment', 'off', true);
end;
$$;

revoke all on function public.assign_operational_work(public.operation_source_type, uuid, uuid, text) from public, anon;
revoke all on function public.release_operational_work(public.operation_source_type, uuid, text) from public, anon;
revoke all on function public.assert_operation_source_exists(public.operation_source_type, uuid) from public, anon;
grant execute on function public.assign_operational_work(public.operation_source_type, uuid, uuid, text) to authenticated;
grant execute on function public.release_operational_work(public.operation_source_type, uuid, text) to authenticated;

-- ============ Derived attention feed ============
create or replace function public.operations_attention_feed(
  _verification_pending_hours integer default 6,
  _picking_stale_hours integer default 4,
  _shipment_stale_hours integer default 24,
  _transfer_stale_hours integer default 48,
  _stocktake_stale_hours integer default 72,
  _purchase_order_overdue_days integer default 3,
  _low_stock_default integer default 5,
  _limit integer default 500
)
returns table (
  id text,
  category text,
  severity text,
  source_type text,
  source_id uuid,
  title text,
  subtitle text,
  state text,
  reason text,
  occurred_at timestamptz,
  due_at timestamptz,
  href text,
  assignable boolean,
  assignment_source_type text,
  assigned_to uuid,
  assigned_to_name text
)
language sql stable security invoker set search_path = public as $$
with items as (
  -- ---------- Verification ----------
  select
    'verification:' || o.id::text as id,
    'verification' as category,
    case
      when o.verification_priority = 'urgent' then 'critical'
      when o.verification_status = 'manual_review' then 'high'
      when o.verification_status = 'rescheduled' and o.verification_next_action_at < now() then 'high'
      when o.verification_status = 'pending'
        and o.created_at < now() - make_interval(hours => _verification_pending_hours) then 'high'
      when o.verification_priority = 'high' then 'high'
      when o.verification_status = 'unreachable' then 'warning'
      when o.verification_status = 'rescheduled' then 'info'
      else 'info'
    end as severity,
    'order' as source_type,
    o.id as source_id,
    o.order_number as title,
    o.customer_name as subtitle,
    o.verification_status::text as state,
    case
      when o.verification_status = 'manual_review' then coalesce(o.risk_reason, 'Manual review required')
      when o.verification_status = 'rescheduled' and o.verification_next_action_at < now() then 'Scheduled callback overdue'
      when o.verification_status = 'rescheduled' then 'Callback scheduled'
      when o.verification_status = 'unreachable' then 'Customer unreachable'
      when o.verification_status = 'pending'
        and o.created_at < now() - make_interval(hours => _verification_pending_hours)
        then 'Pending verification beyond target time'
      else 'Awaiting verification'
    end as reason,
    o.created_at as occurred_at,
    o.verification_next_action_at as due_at,
    '/orders/verification' as href,
    true as assignable,
    'order_verification' as assignment_source_type
  from public.orders o
  where o.status <> 'cancelled'
    and o.verification_status in ('pending','manual_review','rescheduled','unreachable')

  union all
  -- ---------- Fulfillment: order ready, no active record ----------
  select
    'fulfillment-ready:' || o.id::text, 'fulfillment', 'warning', 'order', o.id,
    o.order_number, o.customer_name, o.fulfillment_status::text,
    'Ready for fulfillment but not started', o.created_at, null::timestamptz,
    '/orders/fulfillment', false, null
  from public.orders o
  where o.status <> 'cancelled'
    and o.fulfillment_status = 'ready'
    and not exists (
      select 1 from public.order_fulfillments f
      where f.order_id = o.id and f.status not in ('cancelled')
    )

  union all
  -- ---------- Fulfillment records ----------
  select
    'fulfillment:' || f.id::text, 'fulfillment',
    case
      when f.status in ('qc_failed','on_hold') then 'critical'
      when exists (select 1 from public.order_fulfillment_items i
                    where i.fulfillment_id = f.id and i.shortage_reason is not null) then 'critical'
      when f.status = 'picking' and coalesce(f.started_at, f.created_at)
           < now() - make_interval(hours => _picking_stale_hours) then 'high'
      else 'warning'
    end,
    'order_fulfillment', f.id,
    o.order_number, o.customer_name, f.status::text,
    case
      when f.status = 'qc_failed' then 'Quality check failed'
      when f.status = 'on_hold' then coalesce(f.hold_reason, 'Fulfillment on hold')
      when exists (select 1 from public.order_fulfillment_items i
                    where i.fulfillment_id = f.id and i.shortage_reason is not null)
        then 'Picking shortage detected'
      when f.status = 'picking' and coalesce(f.started_at, f.created_at)
           < now() - make_interval(hours => _picking_stale_hours) then 'Picking in progress too long'
      when f.status = 'ready_for_handover' then 'Awaiting courier handover'
      else 'Fulfillment work in progress'
    end,
    f.created_at, null::timestamptz,
    '/orders/fulfillments/' || f.id::text, true, 'order_fulfillment'
  from public.order_fulfillments f
  join public.orders o on o.id = f.order_id
  where f.status in ('ready_to_pick','picking','picked','packing','qc_pending','qc_failed','on_hold','ready_for_handover')
    and (
      f.status in ('qc_failed','on_hold','ready_for_handover')
      or (f.status = 'picking' and coalesce(f.started_at, f.created_at)
            < now() - make_interval(hours => _picking_stale_hours))
      or exists (select 1 from public.order_fulfillment_items i
                  where i.fulfillment_id = f.id and i.shortage_reason is not null)
    )

  union all
  -- ---------- Shipping ----------
  select
    'shipment:' || s.id::text, 'shipping',
    case
      when s.status in ('booking_failed','pickup_failed','delivery_failed','lost') then 'critical'
      when s.status = 'delivery_on_hold' then 'high'
      when s.status in ('draft','ready_for_booking') then 'warning'
      else 'high'
    end,
    'shipment', s.id,
    s.shipment_number, o.customer_name, s.status::text,
    case
      when s.status = 'booking_failed' then coalesce(s.failure_reason::text, 'Courier booking failed')
      when s.status = 'pickup_failed' then coalesce(s.failure_reason::text, 'Courier pickup failed')
      when s.status = 'delivery_failed' then coalesce(s.failure_reason::text, 'Delivery failed')
      when s.status = 'lost' then 'Shipment reported lost'
      when s.status = 'delivery_on_hold' then coalesce(s.hold_reason::text, 'Delivery on hold')
      when s.status in ('draft','ready_for_booking') then 'Shipment created but not booked'
      else 'No courier update received recently'
    end,
    s.created_at, null::timestamptz,
    '/orders/shipments/' || s.id::text, false, null
  from public.shipments s
  join public.orders o on o.id = s.order_id
  where s.status not in ('delivered','cancelled','return_received')
    and (
      s.status in ('draft','ready_for_booking','booking_failed','pickup_failed','delivery_failed','delivery_on_hold','lost')
      or (s.status in ('booked','pickup_requested','picked_up','in_transit','out_for_delivery')
          and coalesce(s.provider_status_at, s.last_synced_at, s.booked_at, s.created_at)
              < now() - make_interval(hours => _shipment_stale_hours))
    )

  union all
  -- ---------- Unmapped courier events ----------
  select
    'courier-event:' || e.id::text, 'shipping', 'warning', 'courier_event', e.id,
    coalesce(e.provider_event, 'Courier event'), e.merchant_order_id, e.processing_status::text,
    case when e.processing_status = 'unmatched' then 'Courier event could not be matched to a shipment'
         else 'Courier event rejected and needs review' end,
    e.received_at, null::timestamptz,
    coalesce('/orders/shipments/' || e.shipment_id::text, '/orders/shipments'), false, null
  from public.courier_provider_events e
  where e.processing_status in ('unmatched','rejected')

  union all
  -- ---------- Delivery exceptions ----------
  select
    'exception:' || x.id::text, 'delivery_exception',
    case when x.status = 'open' then 'high' else 'warning' end,
    'shipment_exception', x.id,
    coalesce(s.shipment_number, o.order_number), o.customer_name, x.status::text,
    coalesce(x.reason, x.courier_reason, x.exception_type::text),
    x.occurred_at, null::timestamptz,
    '/orders/exceptions', true, 'shipment_exception'
  from public.shipment_exceptions x
  join public.orders o on o.id = x.order_id
  left join public.shipments s on s.id = x.shipment_id
  where x.status in ('open','under_review')

  union all
  -- ---------- Returns ----------
  select
    'return:' || r.id::text, 'return',
    case
      when r.status = 'lost' then 'critical'
      when r.status = 'received' and r.inspected_at is null then 'high'
      else 'warning'
    end,
    'order_return', r.id,
    r.return_number, o.customer_name, r.status::text,
    case
      when r.status = 'pending' then 'Return awaiting receipt'
      when r.status = 'in_transit' then 'Return in transit'
      when r.status = 'received' and r.inspected_at is null then 'Received return not yet graded'
      when r.status = 'inspected' then 'Return awaiting financial resolution'
      when r.status = 'lost' then 'Return reported lost'
      else 'Return requires attention'
    end,
    r.created_at, null::timestamptz,
    '/returns/' || r.id::text, true, 'order_return'
  from public.order_returns r
  join public.orders o on o.id = r.order_id
  where r.status in ('pending','in_transit','received','inspected','lost')

  union all
  -- ---------- Inventory: stock levels ----------
  select
    'stock:' || l.id::text, 'inventory',
    case when l.available_quantity <= 0 then 'high' else 'warning' end,
    'inventory_level', l.id,
    p.name, loc.name, case when l.available_quantity <= 0 then 'out_of_stock' else 'low_stock' end,
    case when l.available_quantity <= 0 then 'Out of stock at ' || loc.name
         else 'Low stock (' || l.available_quantity || ' available) at ' || loc.name end,
    l.updated_at, null::timestamptz, '/inventory', false, null
  from public.inventory_levels l
  join public.products p on p.id = l.product_id
  join public.inventory_locations loc on loc.id = l.location_id
  where p.status = 'active'
    and l.available_quantity <= greatest(coalesce(l.low_stock_threshold, _low_stock_default), 0)

  union all
  -- ---------- Inventory: transfers ----------
  select
    'transfer:' || t.id::text, 'inventory', 'high', 'inventory_transfer', t.id,
    t.reference_number, null, t.status::text,
    case when t.status = 'pending' then 'Transfer pending dispatch too long'
         else 'Transfer in transit too long' end,
    coalesce(t.dispatched_at, t.created_at), null::timestamptz,
    '/inventory/transfers/' || t.id::text, false, null
  from public.inventory_transfers t
  where t.status in ('pending','in_transit')
    and coalesce(t.dispatched_at, t.created_at) < now() - make_interval(hours => _transfer_stale_hours)

  union all
  -- ---------- Inventory: stocktakes ----------
  select
    'stocktake:' || st.id::text, 'inventory', 'warning', 'stocktake', st.id,
    st.reference_number, loc.name, st.status::text,
    'Stocktake open beyond target time', coalesce(st.started_at, st.created_at), null::timestamptz,
    '/inventory/stocktakes/' || st.id::text, false, null
  from public.stocktakes st
  join public.inventory_locations loc on loc.id = st.location_id
  where st.status in ('draft','in_progress')
    and coalesce(st.started_at, st.created_at) < now() - make_interval(hours => _stocktake_stale_hours)

  union all
  -- ---------- Procurement ----------
  select
    'po:' || po.id::text, 'procurement',
    case when po.expected_delivery_date is not null
          and po.expected_delivery_date < current_date - _purchase_order_overdue_days
          and po.status in ('ordered','partially_received') then 'high'
         else 'warning' end,
    'purchase_order', po.id,
    po.purchase_order_number, sup.name, po.status::text,
    case
      when po.expected_delivery_date is not null
       and po.expected_delivery_date < current_date - _purchase_order_overdue_days
       and po.status in ('ordered','partially_received') then 'Supplier delivery overdue'
      when po.status = 'pending_approval' then 'Purchase order awaiting approval'
      when po.status = 'approved' then 'Approved purchase order not ordered yet'
      else 'Partial receiving pending'
    end,
    po.created_at,
    case when po.expected_delivery_date is not null
         then po.expected_delivery_date::timestamptz else null end,
    '/procurement/purchase-orders/' || po.id::text, false, null
  from public.purchase_orders po
  left join public.suppliers sup on sup.id = po.supplier_id
  where po.status in ('pending_approval','approved','ordered','partially_received')
    and (
      po.status in ('pending_approval','approved','partially_received')
      or (po.expected_delivery_date is not null
          and po.expected_delivery_date < current_date - _purchase_order_overdue_days)
    )
)
select
  i.id, i.category, i.severity, i.source_type, i.source_id, i.title, i.subtitle,
  i.state, i.reason, i.occurred_at, i.due_at, i.href, i.assignable,
  i.assignment_source_type, a.assigned_to, pr.full_name
from items i
left join public.operational_assignments a
  on i.assignment_source_type is not null
 and a.source_type = i.assignment_source_type::public.operation_source_type
 and a.source_id = i.source_id
 and a.released_at is null
left join public.profiles pr on pr.id = a.assigned_to
order by
  case i.severity when 'critical' then 0 when 'high' then 1 when 'warning' then 2 else 3 end,
  coalesce(i.due_at, i.occurred_at) asc
limit greatest(coalesce(_limit, 500), 1);
$$;

revoke all on function public.operations_attention_feed(integer,integer,integer,integer,integer,integer,integer,integer) from public, anon;
grant execute on function public.operations_attention_feed(integer,integer,integer,integer,integer,integer,integer,integer) to authenticated;
