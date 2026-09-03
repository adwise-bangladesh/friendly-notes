-- ============ L2: no anonymous order existence oracle ============
REVOKE ALL ON FUNCTION public.order_operationally_locked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_operationally_locked(uuid) TO authenticated, service_role;

-- ============ H2: role administration ============
CREATE TABLE IF NOT EXISTS public.role_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  action text NOT NULL,
  role_from public.app_role,
  role_to public.app_role,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.role_change_events TO authenticated;
GRANT ALL ON public.role_change_events TO service_role;
ALTER TABLE public.role_change_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view role history" ON public.role_change_events;
CREATE POLICY "Admins can view role history" ON public.role_change_events
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (user_id uuid, full_name text, avatar_url text, role public.app_role, joined_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.full_name, p.avatar_url, ur.role, p.created_at
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE public.is_admin(auth.uid())
  ORDER BY p.created_at
$$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(_user_id uuid, _role public.app_role, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _current public.app_role; _actor uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(_actor) THEN
    RAISE EXCEPTION 'Only an owner or administrator can manage team roles';
  END IF;
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'That user does not exist in this workspace';
  END IF;
  IF _user_id = _actor THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;
  IF _role = 'owner' AND NOT public.has_role(_actor, 'owner') THEN
    RAISE EXCEPTION 'Only an owner can grant the owner role';
  END IF;

  SELECT role INTO _current FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
  IF _current = 'owner' AND NOT public.has_role(_actor, 'owner') THEN
    RAISE EXCEPTION 'Only an owner can change another owner';
  END IF;
  IF _current = 'owner' AND _role <> 'owner'
     AND (SELECT count(*) FROM public.user_roles WHERE role = 'owner') <= 1 THEN
    RAISE EXCEPTION 'The last owner cannot be demoted';
  END IF;
  IF _current = _role THEN
    RETURN jsonb_build_object('outcome','unchanged','role',_role);
  END IF;

  PERFORM set_config('app.role_write','on',true);
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  PERFORM set_config('app.role_write','off',true);

  INSERT INTO public.role_change_events (target_user_id, action, role_from, role_to, reason, actor_id)
  VALUES (_user_id, CASE WHEN _current IS NULL THEN 'assigned' ELSE 'changed' END,
          _current, _role, nullif(btrim(coalesce(_reason,'')),''), _actor);
  RETURN jsonb_build_object('outcome', CASE WHEN _current IS NULL THEN 'assigned' ELSE 'changed' END,
                            'role', _role, 'previous_role', _current);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, public.app_role, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_revoke_user_role(_user_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _current public.app_role; _actor uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(_actor) THEN
    RAISE EXCEPTION 'Only an owner or administrator can manage team roles';
  END IF;
  IF _user_id = _actor THEN RAISE EXCEPTION 'You cannot change your own role'; END IF;
  SELECT role INTO _current FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
  IF _current IS NULL THEN RETURN jsonb_build_object('outcome','unchanged','role',null); END IF;
  IF _current = 'owner' THEN
    IF NOT public.has_role(_actor,'owner') THEN RAISE EXCEPTION 'Only an owner can change another owner'; END IF;
    IF (SELECT count(*) FROM public.user_roles WHERE role='owner') <= 1 THEN
      RAISE EXCEPTION 'The last owner cannot be removed';
    END IF;
  END IF;
  PERFORM set_config('app.role_write','on',true);
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  PERFORM set_config('app.role_write','off',true);
  INSERT INTO public.role_change_events (target_user_id, action, role_from, role_to, reason, actor_id)
  VALUES (_user_id, 'revoked', _current, NULL, nullif(btrim(coalesce(_reason,'')),''), _actor);
  RETURN jsonb_build_object('outcome','revoked','previous_role',_current);
END $$;
REVOKE ALL ON FUNCTION public.admin_revoke_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_role(uuid, text) TO authenticated, service_role;

-- ============ H3: profiles least privilege ============
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
CREATE POLICY "Own profile or staff attribution reads" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.can_manage_commerce(auth.uid()));

-- ============ C1 + C2: sync job lease integrity ============
CREATE OR REPLACE FUNCTION public.complete_sync_job(_job_id uuid, _lease_token uuid, _ok boolean, _message text DEFAULT NULL::text, _failure_class public.sync_failure_class DEFAULT 'unknown'::public.sync_failure_class, _run_id uuid DEFAULT NULL::uuid, _retry_after timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _job public.sales_channel_sync_jobs;
        _status public.sync_job_status; _class public.sync_failure_class; _msg text; _next timestamptz;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to process the synchronisation queue';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id for update;
  if _job.id is null then
    return jsonb_build_object('applied', false, 'outcome','not_found', 'reason_code','job_not_found',
      'message','This synchronisation job no longer exists');
  end if;

  if _job.status <> 'processing' then
    return jsonb_build_object('applied', false, 'outcome','stale', 'reason_code','not_processing',
      'status', _job.status,
      'message','This job is no longer being processed — the result was ignored');
  end if;
  if _job.lease_token is null or _lease_token is null or _job.lease_token is distinct from _lease_token then
    return jsonb_build_object('applied', false, 'outcome','rejected', 'reason_code','foreign_lease',
      'status', _job.status,
      'message','This result was reported by a worker that no longer holds the job');
  end if;
  if _job.lease_expires_at is not null and _job.lease_expires_at <= now() then
    return jsonb_build_object('applied', false, 'outcome','rejected', 'reason_code','lease_expired',
      'status', _job.status,
      'message','The worker lease for this job has expired — the result was ignored');
  end if;
  if not exists (select 1 from public.background_job_attempts
                  where job_id = _job_id and attempt_number = _job.attempts and finished_at is null) then
    return jsonb_build_object('applied', false, 'outcome','rejected', 'reason_code','attempt_already_closed',
      'status', _job.status,
      'message','This attempt has already been closed');
  end if;

  _class := coalesce(_failure_class, 'unknown');
  _msg := left(coalesce(nullif(btrim(coalesce(_message,'')),''), 'Synchronisation failed'), 300);

  if _ok then _status := 'succeeded';
  elsif _class in ('permanent','authentication') then _status := 'failed';
  elsif _job.attempts >= _job.max_attempts then _status := 'dead_letter';
  else _status := 'retry_wait';
  end if;

  if _status = 'retry_wait' then
    _next := case
      when _class = 'rate_limited' and _retry_after is not null and _retry_after > now() then _retry_after
      when _class = 'rate_limited' then now() + public.sync_job_backoff(_job.attempts) * 2
      else now() + public.sync_job_backoff(_job.attempts) end;
  end if;

  perform set_config('app.sync_job_write','on',true);
  update public.sales_channel_sync_jobs set
    status = _status,
    failure_class = case when _ok then null else _class end,
    last_error = case when _ok then null else _msg end,
    last_run_id = coalesce(_run_id, last_run_id),
    lease_token = null,
    lease_expires_at = null,
    worker_id = case when _status = 'retry_wait' then null else worker_id end,
    retry_after = case when _status = 'retry_wait' and _class = 'rate_limited' then _next else null end,
    available_at = case when _status = 'retry_wait' then _next else available_at end,
    first_failed_at = case when _ok then first_failed_at else coalesce(first_failed_at, now()) end,
    final_failed_at = case when _status in ('failed','dead_letter') then now() else null end,
    completed_at = case when _status in ('succeeded','failed','dead_letter') then now() else null end
  where id = _job_id;

  update public.background_job_attempts set
    finished_at = now(),
    duration_ms = greatest(0, (extract(epoch from (now() - started_at)) * 1000)::integer),
    ok = _ok,
    failure_class = case when _ok then null else _class end,
    message = case when _ok then null else _msg end,
    run_id = _run_id
  where job_id = _job_id and attempt_number = _job.attempts and finished_at is null;
  perform set_config('app.sync_job_write','off',true);

  return jsonb_build_object('applied', true, 'outcome','applied', 'reason_code','applied',
                            'status', _status, 'message','Result recorded');
end $function$;

-- ============ H1: channel readiness + explicit activation ============
CREATE OR REPLACE FUNCTION public.sales_channel_account_readiness(_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _acc public.sales_channel_accounts; _store public.stores; _has_creds boolean; _blocking text[] := '{}';
begin
  if not public.can_read_channels() then raise exception 'Not permitted to read sales channels'; end if;
  select * into _acc from public.sales_channel_accounts where id = _account_id;
  if _acc.id is null then raise exception 'Sales channel not found'; end if;
  select * into _store from public.stores where id = _acc.store_id;
  select exists (select 1 from public.sales_channel_credentials c
                  where c.account_id = _account_id
                    and coalesce(btrim(c.site_url),'') <> ''
                    and coalesce(btrim(c.consumer_key),'') <> ''
                    and coalesce(btrim(c.consumer_secret),'') <> '') into _has_creds;

  if _acc.provider <> 'manual' and not _has_creds then
    _blocking := array_append(_blocking, 'Channel credentials have not been configured');
  end if;
  if _acc.status = 'disabled' then _blocking := array_append(_blocking, 'This sales channel is disabled');
  elsif _acc.status = 'disconnected' then _blocking := array_append(_blocking, 'This sales channel has not been activated yet');
  elsif _acc.status = 'error' then _blocking := array_append(_blocking, 'This sales channel is in an error state');
  end if;
  if _store.status <> 'active' then _blocking := array_append(_blocking, 'The store is not active'); end if;

  return jsonb_build_object(
    'account_id', _acc.id, 'provider', _acc.provider, 'status', _acc.status,
    'environment', _acc.environment, 'credentials_configured', _has_creds,
    'can_activate', (_acc.provider = 'manual' or _has_creds) and _acc.status <> 'disabled' and _store.status = 'active',
    'operational', array_length(_blocking,1) is null,
    'blocking', to_jsonb(_blocking));
end $$;
REVOKE ALL ON FUNCTION public.sales_channel_account_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_channel_account_readiness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.activate_sales_channel_account(_account_id uuid)
RETURNS public.sales_channel_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _ready jsonb;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to change a sales channel';
  end if;
  _ready := public.sales_channel_account_readiness(_account_id);
  if not (_ready->>'can_activate')::boolean then
    raise exception 'This sales channel cannot be activated yet: %',
      coalesce(nullif(array_to_string(array(select jsonb_array_elements_text(_ready->'blocking')), '; '),''),
               'credentials are required');
  end if;
  return public.set_sales_channel_account_state(_account_id, 'active', null, false, false);
end $$;
REVOKE ALL ON FUNCTION public.activate_sales_channel_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_sales_channel_account(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_sales_channel_account_state(_account_id uuid, _status public.sales_channel_status, _error text DEFAULT NULL::text, _touch_sync boolean DEFAULT false, _successful boolean DEFAULT false)
RETURNS public.sales_channel_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _row public.sales_channel_accounts; _acc public.sales_channel_accounts; _has_creds boolean;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to change a sales channel';
  end if;
  if _status in ('disabled') and not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can disable a sales channel';
  end if;
  select * into _acc from public.sales_channel_accounts where id = _account_id;
  if _acc.id is null then raise exception 'Sales channel not found'; end if;

  if _status = 'active' and _acc.provider <> 'manual' then
    select exists (select 1 from public.sales_channel_credentials c
                    where c.account_id = _account_id
                      and coalesce(btrim(c.site_url),'') <> ''
                      and coalesce(btrim(c.consumer_key),'') <> ''
                      and coalesce(btrim(c.consumer_secret),'') <> '') into _has_creds;
    if not _has_creds then
      raise exception 'Channel credentials must be configured before this channel can be activated';
    end if;
    if not exists (select 1 from public.stores s where s.id = _acc.store_id and s.status = 'active') then
      raise exception 'The store is not active, so this channel cannot be activated';
    end if;
  end if;

  perform set_config('app.channel_write','on',true);
  update public.sales_channel_accounts set
    status = _status,
    last_error = left(_error, 500),
    last_sync_at = case when _touch_sync then now() else last_sync_at end,
    last_successful_sync_at = case when _touch_sync and _successful then now() else last_successful_sync_at end,
    updated_by = auth.uid(), updated_at = now()
  where id = _account_id returning * into _row;
  perform set_config('app.channel_write','off',true);
  if _row.id is null then raise exception 'Sales channel not found'; end if;
  return _row;
end $function$;

-- ============ M4 + L1: explicit enqueue outcomes ============
CREATE OR REPLACE FUNCTION public.enqueue_listing_sync_result(_listing_id uuid, _operation public.sales_channel_sync_type, _source text DEFAULT 'manual', _reference uuid DEFAULT NULL, _priority integer DEFAULT 100, _delay interval DEFAULT '00:00:00'::interval)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _row public.sales_channel_product_listings; _acc public.sales_channel_accounts;
        _sp public.store_products; _store public.stores; _job_id uuid; _qty numeric;
        _prio integer := coalesce(_priority, 100); _existing uuid; _has_creds boolean;
begin
  if _operation not in ('listing_update','price_sync','stock_sync','status_refresh') then
    raise exception 'This operation cannot be queued for background synchronisation';
  end if;
  if _prio < 1 or _prio > 1000 then
    raise exception 'Queue priority must be between 1 and 1000';
  end if;

  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  if _row.id is null then
    return jsonb_build_object('outcome','ineligible','reason_code','listing_not_found','job_id',null,
      'message','Listing not found');
  end if;
  if _row.listing_status = 'archived' then
    return jsonb_build_object('outcome','ineligible','reason_code','listing_archived','job_id',null,
      'message','This listing is archived, so nothing was queued');
  end if;
  if _row.listing_status not in ('published','update_pending','sync_failed') then
    return jsonb_build_object('outcome','ineligible','reason_code','listing_not_published','job_id',null,
      'message','This listing is not published on the channel yet, so nothing was queued');
  end if;
  if coalesce(btrim(coalesce(_row.external_product_id,'')),'') = '' then
    return jsonb_build_object('outcome','ineligible','reason_code','missing_external_product','job_id',null,
      'message','This listing has no external product reference yet');
  end if;

  select * into _acc from public.sales_channel_accounts where id = _row.sales_channel_account_id;
  if _acc.id is null then
    return jsonb_build_object('outcome','ineligible','reason_code','account_missing','job_id',null,
      'message','The sales channel for this listing no longer exists');
  end if;
  if _acc.provider = 'manual' then
    return jsonb_build_object('outcome','ineligible','reason_code','manual_channel','job_id',null,
      'message','The internal channel does not synchronise products');
  end if;
  if _acc.status <> 'active' then
    select exists (select 1 from public.sales_channel_credentials c
                    where c.account_id = _acc.id and coalesce(btrim(c.consumer_key),'') <> '') into _has_creds;
    return jsonb_build_object('outcome','blocked',
      'reason_code', case when not _has_creds then 'missing_credentials' else 'channel_not_active' end,
      'job_id', null,
      'message', case when not _has_creds
        then 'Channel credentials have not been configured, so nothing was queued'
        else 'This sales channel is not active, so nothing was queued' end);
  end if;

  select * into _sp from public.store_products where id = _row.store_product_id;
  if _sp.id is null or _sp.status = 'archived' then
    return jsonb_build_object('outcome','ineligible','reason_code','store_product_archived','job_id',null,
      'message','This store product is archived, so nothing was queued');
  end if;
  select * into _store from public.stores where id = _sp.store_id;
  if _store.id is null or _store.status <> 'active' then
    return jsonb_build_object('outcome','blocked','reason_code','store_not_active','job_id',null,
      'message','The store is not active, so nothing was queued');
  end if;

  if _operation = 'price_sync' and _row.synced_price is not null
     and _row.synced_price = coalesce(_sp.selling_price,0) then
    return jsonb_build_object('outcome','no_change','reason_code','price_unchanged','job_id',null,
      'message','The channel already reflects this price');
  end if;
  if _operation = 'stock_sync' then
    _qty := public.store_product_available_qty(_sp.product_id);
    if _row.synced_qty is not null and _row.synced_qty = _qty then
      return jsonb_build_object('outcome','no_change','reason_code','stock_unchanged','job_id',null,
        'message','The channel already reflects this stock level');
    end if;
  end if;
  if _operation = 'listing_update' and _row.synced_content_hash is not null
     and _row.synced_content_hash = public.listing_content_hash(_listing_id) then
    return jsonb_build_object('outcome','no_change','reason_code','content_unchanged','job_id',null,
      'message','The channel already reflects this product content');
  end if;

  select id into _existing from public.sales_channel_sync_jobs
   where listing_id = _listing_id and operation = _operation and status in ('pending','retry_wait');

  perform set_config('app.sync_job_write','on',true);
  insert into public.sales_channel_sync_jobs
    (listing_id, sales_channel_account_id, store_id, operation, priority,
     available_at, source, source_reference, created_by)
  values
    (_listing_id, _row.sales_channel_account_id, _sp.store_id, _operation, _prio,
     now() + coalesce(_delay, interval '0'), left(coalesce(_source,'manual'),60), _reference, auth.uid())
  on conflict (listing_id, operation) where status in ('pending','retry_wait')
  do update set
    priority = least(public.sales_channel_sync_jobs.priority, excluded.priority),
    available_at = least(public.sales_channel_sync_jobs.available_at, excluded.available_at),
    source = excluded.source,
    updated_at = now()
  returning id into _job_id;
  perform set_config('app.sync_job_write','off',true);

  if _existing is not null then
    return jsonb_build_object('outcome','already_queued','reason_code','deduplicated','job_id',_job_id,
      'message','This work was already queued and has been merged');
  end if;
  return jsonb_build_object('outcome','queued','reason_code','queued','job_id',_job_id,
    'message','Queued for background synchronisation');
end $$;
REVOKE ALL ON FUNCTION public.enqueue_listing_sync_result(uuid, public.sales_channel_sync_type, text, uuid, integer, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_listing_sync_result(uuid, public.sales_channel_sync_type, text, uuid, integer, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_listing_sync(_listing_id uuid, _operation public.sales_channel_sync_type, _source text DEFAULT 'manual'::text, _reference uuid DEFAULT NULL::uuid, _priority integer DEFAULT 100, _delay interval DEFAULT '00:00:00'::interval)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _res jsonb;
begin
  _res := public.enqueue_listing_sync_result(_listing_id, _operation, _source, _reference, coalesce(_priority,100), _delay);
  return nullif(_res->>'job_id','')::uuid;
end $function$;

-- ============ M1: publish respects authoritative readiness ============
CREATE OR REPLACE FUNCTION public.begin_listing_operation(_listing_id uuid, _operation public.sales_channel_sync_type)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _row public.sales_channel_product_listings; _acc public.sales_channel_accounts;
        _run public.sales_channel_sync_runs; _target public.channel_listing_status; _from public.channel_listing_status;
        _ready jsonb; _acc_ready jsonb; _blockers text;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to synchronise channel listings';
  end if;
  if _operation not in ('listing_publish','listing_update','price_sync','stock_sync','status_refresh','unpublish') then
    raise exception 'Unsupported listing operation';
  end if;

  select * into _row from public.sales_channel_product_listings where id = _listing_id for update;
  if _row.id is null then raise exception 'Listing not found'; end if;
  _from := _row.listing_status;
  if _from in ('publishing','syncing') then
    raise exception 'A synchronisation is already running for this listing';
  end if;
  if _from = 'archived' then raise exception 'This listing is archived'; end if;

  select * into _acc from public.sales_channel_accounts where id = _row.sales_channel_account_id;
  if _acc.status = 'disabled' then raise exception 'This sales channel is disabled'; end if;

  -- authoritative gate: everything except a read-only status refresh must be
  -- operationally ready before any provider work starts.
  if _operation <> 'status_refresh' then
    _acc_ready := public.sales_channel_account_readiness(_acc.id);
    if not (_acc_ready->>'operational')::boolean then
      raise exception 'This channel is not ready: %',
        array_to_string(array(select jsonb_array_elements_text(_acc_ready->'blocking')), '; ');
    end if;
  end if;

  if _operation = 'listing_publish' then
    _ready := public.channel_listing_readiness(_listing_id);
    if not (_ready->>'ready')::boolean then
      _blockers := array_to_string(array(select jsonb_array_elements_text(_ready->'blocking')), '; ');
      raise exception 'This listing is not ready to publish: %', _blockers;
    end if;
    if coalesce(_row.external_product_id,'') <> '' then
      raise exception 'This listing already has an external product — use an update instead';
    end if;
    if _from = 'not_published' then
      perform public.set_channel_listing_status(_listing_id, 'ready', 'Readiness confirmed');
    end if;
    _target := 'publishing';
  elsif _operation = 'unpublish' then
    _target := null;
  elsif _operation = 'status_refresh' then
    _target := null;
  else
    if coalesce(_row.external_product_id,'') = '' then
      raise exception 'This listing has not been published yet';
    end if;
    if _from = 'published' then
      perform public.set_channel_listing_status(_listing_id, 'update_pending', 'Change detected');
    end if;
    if _from = 'paused' then raise exception 'This listing is paused'; end if;
    _target := 'syncing';
  end if;

  if _target is not null then
    perform public.set_channel_listing_status(_listing_id, _target, null);
  end if;

  perform set_config('app.channel_write','on',true);
  insert into public.sales_channel_sync_runs (sales_channel_account_id, sync_type, status, initiated_by, listing_id)
  values (_row.sales_channel_account_id, _operation, 'running', auth.uid(), _listing_id)
  returning * into _run;
  perform set_config('app.channel_write','off',true);

  perform set_config('app.catalog_write','on',true);
  update public.sales_channel_product_listings set last_operation = _operation::text, updated_by = auth.uid()
  where id = _listing_id;

  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  return jsonb_build_object('run_id', _run.id, 'listing', to_jsonb(_row), 'previous_status', _from);
end $function$;

-- ============ H4 + M3: AI run lifecycle and friendly validation ============
CREATE OR REPLACE FUNCTION public.ai_complete_analysis_run(_run_id uuid, _payload jsonb)
RETURNS public.ai_analysis_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r public.ai_analysis_runs;
  item jsonb; ins_id uuid; n_ins int := 0; n_rec int := 0; key_map jsonb := '{}'::jsonb;
  _title text; _summary text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to update an AI analysis';
  END IF;
  SELECT * INTO r FROM public.ai_analysis_runs WHERE id = _run_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Analysis run not found'; END IF;
  IF r.status = 'completed' THEN
    RAISE EXCEPTION 'This analysis has already been completed — start a new analysis instead';
  ELSIF r.status NOT IN ('queued','running') THEN
    RAISE EXCEPTION 'This analysis is already closed (%) and cannot be completed', r.status;
  END IF;
  IF jsonb_typeof(coalesce(_payload->'insights', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(_payload->'recommendations', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'The analysis result is malformed — insights and recommendations must be lists';
  END IF;

  -- validate before touching the database so no partial output is written
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'insights', '[]'::jsonb)) LOOP
    _title := btrim(coalesce(item->>'title',''));
    _summary := btrim(coalesce(item->>'summary',''));
    IF length(_title) < 8 OR length(_title) > 160 THEN
      RAISE EXCEPTION 'Each insight needs a title between 8 and 160 characters (got "%")', left(_title, 40);
    END IF;
    IF length(_summary) < 8 THEN
      RAISE EXCEPTION 'The insight "%" needs a summary of at least 8 characters', left(_title, 40);
    END IF;
    IF length(_summary) > 4000 THEN
      RAISE EXCEPTION 'The summary for insight "%" is too long (max 4000 characters)', left(_title, 40);
    END IF;
    IF nullif(item->>'category','') IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.ai_insight_category)) e
                       WHERE e::text = item->>'category') THEN
      RAISE EXCEPTION 'The insight "%" has an unsupported category', left(_title, 40);
    END IF;
    IF nullif(item->>'severity','') IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.ai_insight_severity)) e
                       WHERE e::text = item->>'severity') THEN
      RAISE EXCEPTION 'The insight "%" has an unsupported severity', left(_title, 40);
    END IF;
    IF nullif(item->>'entity_id','') IS NOT NULL
       AND nullif(item->>'entity_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'The insight "%" references an invalid record', left(_title, 40);
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'recommendations', '[]'::jsonb)) LOOP
    _title := btrim(coalesce(item->>'title',''));
    IF length(_title) < 8 OR length(_title) > 160 THEN
      RAISE EXCEPTION 'Each recommendation needs a title between 8 and 160 characters (got "%")', left(_title, 40);
    END IF;
    IF length(btrim(coalesce(item->>'description',''))) < 8 THEN
      RAISE EXCEPTION 'The recommendation "%" needs a description of at least 8 characters', left(_title, 40);
    END IF;
    IF nullif(item->>'priority','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.ai_recommendation_priority)) e
                        WHERE e::text = item->>'priority') THEN
      RAISE EXCEPTION 'The recommendation "%" has an unsupported priority', left(_title, 40);
    END IF;
    IF nullif(item->>'insight_key','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_payload->'insights','[]'::jsonb)) i
                        WHERE i->>'key' = item->>'insight_key') THEN
      RAISE EXCEPTION 'The recommendation "%" refers to an insight that is not part of this result', left(_title, 40);
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'insights', '[]'::jsonb)) LOOP
    INSERT INTO public.ai_insights (analysis_run_id, entity_type, entity_id, category, severity,
                                    title, summary, confidence, evidence, expires_at)
    VALUES (r.id,
            coalesce(nullif(item->>'entity_type',''), r.entity_type),
            nullif(item->>'entity_id','')::uuid,
            (item->>'category')::public.ai_insight_category,
            (item->>'severity')::public.ai_insight_severity,
            btrim(item->>'title'), btrim(item->>'summary'),
            LEAST(1, GREATEST(0, coalesce((item->>'confidence')::numeric, 0.5))),
            coalesce(item->'evidence', '{}'::jsonb),
            nullif(item->>'expires_at','')::timestamptz)
    RETURNING id INTO ins_id;
    n_ins := n_ins + 1;
    IF nullif(item->>'key','') IS NOT NULL THEN
      key_map := key_map || jsonb_build_object(item->>'key', ins_id::text);
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'recommendations', '[]'::jsonb)) LOOP
    INSERT INTO public.ai_recommendations (analysis_run_id, insight_id, entity_type, entity_id,
                                           recommendation_type, priority, title, description,
                                           suggested_action, action_target, confidence)
    VALUES (r.id,
            nullif(key_map->>coalesce(item->>'insight_key',''), '')::uuid,
            coalesce(nullif(item->>'entity_type',''), r.entity_type),
            nullif(item->>'entity_id','')::uuid,
            coalesce(nullif(item->>'recommendation_type',''), 'review'),
            (coalesce(nullif(item->>'priority',''), 'medium'))::public.ai_recommendation_priority,
            btrim(item->>'title'), btrim(item->>'description'),
            nullif(item->>'suggested_action',''), nullif(item->>'action_target',''),
            LEAST(1, GREATEST(0, coalesce((item->>'confidence')::numeric, 0.5))));
    n_rec := n_rec + 1;
  END LOOP;

  UPDATE public.ai_analysis_runs
     SET status = 'completed', completed_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - coalesce(started_at, created_at))) * 1000)::int),
         insight_count = n_ins, recommendation_count = n_rec,
         summary = left(nullif(_payload->>'summary',''), 2000)
   WHERE id = r.id AND status IN ('queued','running') RETURNING * INTO r;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'This analysis was closed by another process — nothing was recorded';
  END IF;

  INSERT INTO public.ai_brain_events (event_type, run_id, actor_id, message)
  VALUES ('analysis_completed', r.id, auth.uid(),
          format('Analysis completed with %s insights and %s recommendations', n_ins, n_rec));
  RETURN r;
END; $function$;

CREATE OR REPLACE FUNCTION public.ai_fail_analysis_run(_run_id uuid, _error text)
RETURNS public.ai_analysis_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.ai_analysis_runs; _cur public.ai_run_status;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to update an AI analysis';
  END IF;
  SELECT status INTO _cur FROM public.ai_analysis_runs WHERE id = _run_id;
  IF _cur IS NULL THEN RAISE EXCEPTION 'Analysis run not found'; END IF;
  IF _cur NOT IN ('queued','running') THEN
    RAISE EXCEPTION 'This analysis is already closed (%) and cannot be failed', _cur;
  END IF;
  UPDATE public.ai_analysis_runs
     SET status = 'failed', completed_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - coalesce(started_at, created_at))) * 1000)::int),
         error_message = left(coalesce(_error, 'Analysis failed'), 500)
   WHERE id = _run_id AND status IN ('queued','running') RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'This analysis was closed by another process'; END IF;
  INSERT INTO public.ai_brain_events (event_type, run_id, actor_id, message)
  VALUES ('analysis_failed', r.id, auth.uid(), left(coalesce(_error, 'Analysis failed'), 500));
  RETURN r;
END; $function$;

-- ============ M2: external import conflict detection ============
ALTER TABLE public.external_entity_mappings
  ADD COLUMN IF NOT EXISTS payload_fingerprint text;

CREATE OR REPLACE FUNCTION public.external_order_fingerprint(_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT md5(jsonb_build_object(
    'customer_name', btrim(coalesce(_payload->>'customer_name','')),
    'customer_phone', btrim(coalesce(_payload->>'customer_phone','')),
    'customer_email', btrim(coalesce(_payload->>'customer_email','')),
    'address', btrim(coalesce(_payload#>>'{address,address_line}','')),
    'shipping_charge', coalesce((_payload->>'shipping_charge')::numeric, 0),
    'order_discount', coalesce((_payload->>'order_discount')::numeric, 0),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', i->>'product_id', 'variant_id', coalesce(i->>'variant_id',''),
        'quantity', coalesce((i->>'quantity')::int,0),
        'discount_amount', coalesce((i->>'discount_amount')::numeric,0))
        ORDER BY i->>'product_id', coalesce(i->>'variant_id',''))
      FROM jsonb_array_elements(coalesce(_payload->'items','[]'::jsonb)) i), '[]'::jsonb)
  )::text)
$$;

CREATE OR REPLACE FUNCTION public.import_external_order(_account_id uuid, _store_id uuid, _external_id text, _external_reference text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _order public.orders; _map public.external_entity_mappings;
        _ext text := btrim(coalesce(_external_id,'')); _fp text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to import orders';
  END IF;
  IF _ext = '' THEN RAISE EXCEPTION 'The external order has no identifier'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = _store_id AND status = 'active') THEN
    RAISE EXCEPTION 'Store not found or not active';
  END IF;

  _fp := public.external_order_fingerprint(_payload);

  SELECT * INTO _map FROM public.external_entity_mappings
   WHERE sales_channel_account_id = _account_id AND entity_type = 'order' AND external_id = _ext;

  IF _map.id IS NOT NULL THEN
    IF _map.payload_fingerprint IS NULL THEN
      -- historical mapping imported before fingerprinting: adopt it, never overwrite the order
      PERFORM set_config('app.channel_write','on',true);
      UPDATE public.external_entity_mappings SET payload_fingerprint = _fp, updated_at = now()
       WHERE id = _map.id;
      PERFORM set_config('app.channel_write','off',true);
      RETURN jsonb_build_object('outcome','already_imported','order_id',_map.internal_id,
        'message','This external order was already imported');
    END IF;
    IF _map.payload_fingerprint = _fp THEN
      RETURN jsonb_build_object('outcome','already_imported','order_id',_map.internal_id,
        'message','This external order was already imported');
    END IF;
    RETURN jsonb_build_object('outcome','conflict','reason_code','external_order_changed',
      'order_id', _map.internal_id, 'external_id', _ext,
      'message','The channel order changed after it was imported — the existing order was left unchanged and needs review');
  END IF;

  _order := public.create_order(_payload);

  PERFORM public.upsert_external_mapping(
    _account_id, 'order'::public.external_entity_type, _order.id, _ext, _external_reference);
  PERFORM set_config('app.channel_write','on',true);
  UPDATE public.external_entity_mappings SET payload_fingerprint = _fp, updated_at = now()
   WHERE sales_channel_account_id = _account_id AND entity_type = 'order' AND external_id = _ext;
  PERFORM set_config('app.channel_write','off',true);

  PERFORM set_config('app.order_write', 'on', true);
  UPDATE public.orders SET store_id = _store_id, updated_by = auth.uid() WHERE id = _order.id;
  PERFORM set_config('app.order_write', 'off', true);

  RETURN jsonb_build_object('outcome', 'created', 'order_id', _order.id, 'message','Order imported');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This external order was already imported';
END; $function$;

-- ============ M5: blocked-customer correction boundary ============
CREATE OR REPLACE FUNCTION public.update_order_customer(_order_id uuid, _customer_name text, _customer_phone text, _customer_email text DEFAULT NULL::text, _customer_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _order public.orders; _resolved uuid; _prev uuid; _identity_change boolean;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled order cannot be edited'; END IF;
  IF public.order_operationally_locked(_order_id) THEN
    RAISE EXCEPTION 'This order is already committed or with the courier — customer details can no longer be changed.';
  END IF;
  IF coalesce(btrim(coalesce(_customer_name,'')), '') = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF coalesce(btrim(coalesce(_customer_phone,'')), '') = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;
  IF _customer_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.customers WHERE id = _customer_id AND status = 'blocked') THEN
    RAISE EXCEPTION 'That customer is blocked and cannot be linked to an order';
  END IF;

  _prev := _order.customer_id;
  _resolved := public.resolve_customer_for_order(
    btrim(_customer_name), btrim(_customer_phone), _customer_email, _customer_id);

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = _resolved AND status = 'blocked') THEN
    RAISE EXCEPTION 'That customer is blocked and cannot be linked to an order';
  END IF;

  _identity_change := _resolved IS DISTINCT FROM _prev;
  IF _identity_change AND btrim(coalesce(_reason,'')) = '' THEN
    RAISE EXCEPTION 'A correction reason is required when an order is moved to a different customer';
  END IF;

  PERFORM set_config('app.order_write', 'on', true);
  UPDATE public.orders
     SET customer_id = _resolved,
         customer_name = btrim(_customer_name),
         customer_phone = btrim(_customer_phone),
         customer_email = nullif(btrim(coalesce(_customer_email,'')),''),
         updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.order_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
          'Customer details corrected to ' || btrim(_customer_name) || ' (' || btrim(_customer_phone) || ').'
          || CASE WHEN _identity_change THEN ' Customer record changed from '
               || coalesce(_prev::text,'none') || ' to ' || _resolved::text
               || '. Reason: ' || btrim(_reason) ELSE '' END,
          'system', true, auth.uid());
  RETURN _order;
END; $function$;

-- ============ M6: precise product eligibility messages ============
CREATE OR REPLACE FUNCTION public.add_product_to_store(_store_id uuid, _product_id uuid, _selling_price numeric DEFAULT NULL::numeric, _store_sku text DEFAULT NULL::text)
RETURNS public.store_products LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _row public.store_products; _p public.products; _s public.stores; _price numeric;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'You are not permitted to manage the store catalog';
  end if;
  select * into _s from public.stores where id = _store_id for update;
  if _s.id is null then raise exception 'Store not found'; end if;
  if _s.status = 'archived' then raise exception 'This store is archived'; end if;
  select * into _p from public.products where id = _product_id for update;
  if _p.id is null then raise exception 'Product not found'; end if;
  if _p.status = 'archived' then raise exception 'The product "%" is archived and cannot be sold', _p.name; end if;
  if _p.status <> 'active' then raise exception 'The product "%" is not active yet', _p.name; end if;
  if coalesce(_p.is_purchasable,false) is not true then
    raise exception 'The product "%" is not purchasable — enable purchasing on the product first', _p.name;
  end if;

  _price := coalesce(_selling_price, _p.price);
  if _price is null then
    raise exception 'A selling price is required — this product has no master price';
  end if;
  if _price < 0 then raise exception 'Selling price cannot be negative'; end if;

  perform set_config('app.catalog_write','on',true);
  insert into public.store_products (store_id, product_id, selling_price, store_sku, created_by, updated_by)
  values (_store_id, _product_id, round(_price,2), nullif(btrim(coalesce(_store_sku,'')),''), auth.uid(), auth.uid())
  returning * into _row;

  insert into public.store_product_price_history (store_product_id, previous_price, new_price, reason, changed_by)
  values (_row.id, null, _row.selling_price, 'Added to store', auth.uid());

  return _row;
exception when unique_violation then
  raise exception 'This product is already in the store catalog';
end $function$;

-- ============ L3: store archival reconciliation ============
CREATE OR REPLACE FUNCTION public.set_store_status(_store_id uuid, _status public.store_status)
RETURNS public.stores LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _row public.stores; _prev public.store_status;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can change a store status';
  end if;
  select status into _prev from public.stores where id = _store_id;
  if _prev is null then raise exception 'Store not found'; end if;

  perform set_config('app.channel_write','on',true);
  update public.stores set status = _status, updated_by = auth.uid(), updated_at = now()
   where id = _store_id returning * into _row;
  perform set_config('app.channel_write','off',true);

  if _status = 'archived' and _prev <> 'archived' then
    -- queued work for an archived store can never run: cancel it explicitly
    perform set_config('app.sync_job_write','on',true);
    update public.sales_channel_sync_jobs
       set status = 'cancelled', completed_at = now(),
           last_error = 'Store archived', lease_token = null, lease_expires_at = null
     where store_id = _store_id and status in ('pending','retry_wait');
    perform set_config('app.sync_job_write','off',true);

    -- published listings stay externally live until an unpublish actually runs;
    -- locally they are paused so the store no longer looks operationally publishing.
    insert into public.channel_listing_events (listing_id, event_type, status_from, status_to, message, created_by)
    select l.id, 'listing_paused', l.listing_status, 'paused',
           'Store archived — local publishing paused (the external listing was not removed)', auth.uid()
      from public.sales_channel_product_listings l
      join public.store_products sp on sp.id = l.store_product_id
     where sp.store_id = _store_id and l.listing_status in ('published','update_pending','sync_failed');

    perform set_config('app.catalog_write','on',true);
    update public.sales_channel_product_listings l
       set listing_status = 'paused', updated_by = auth.uid()
      from public.store_products sp
     where sp.id = l.store_product_id and sp.store_id = _store_id
       and l.listing_status in ('published','update_pending','sync_failed');
  end if;

  return _row;
end $function$;