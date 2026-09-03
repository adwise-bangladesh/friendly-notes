-- ---------------------------------------------------------------------------
-- CLAIM: priority + anti-starvation + dependencies + worker identity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_sync_jobs(
  _limit integer DEFAULT 5,
  _lease_seconds integer DEFAULT 120,
  _worker_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _token uuid := gen_random_uuid(); _rows jsonb; _worker text;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to process the synchronisation queue';
  end if;
  _worker := left(coalesce(nullif(btrim(coalesce(_worker_id,'')),''), 'worker'), 60);
  perform public.reclaim_stale_sync_jobs();

  perform set_config('app.sync_job_write','on',true);
  with candidate as (
    select j.id from public.sales_channel_sync_jobs j
    join public.background_job_types t on t.job_type = j.job_type and t.enabled
    where j.status in ('pending','retry_wait')
      and j.available_at <= now()
      and (j.retry_after is null or j.retry_after <= now())
      and (
        j.depends_on_job_id is null
        or exists (select 1 from public.sales_channel_sync_jobs d
                    where d.id = j.depends_on_job_id and d.status = 'succeeded')
      )
    -- anti-starvation: waiting time lowers the effective priority number
    order by (j.priority - least(60, floor(extract(epoch from (now() - j.available_at)) / 600) * 10)) asc,
             j.available_at asc
    limit greatest(1, least(coalesce(_limit,5), 25))
    for update skip locked
  ), claimed as (
    update public.sales_channel_sync_jobs j set
      status = 'processing',
      attempts = j.attempts + 1,
      claimed_at = now(),
      last_attempt_at = now(),
      worker_id = _worker,
      lease_token = _token,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(_lease_seconds,120), 600)))
    from candidate c where j.id = c.id
    returning j.id, j.listing_id, j.sales_channel_account_id, j.store_id, j.operation,
              j.job_type, j.attempts, j.max_attempts
  ), history as (
    insert into public.background_job_attempts (job_id, attempt_number, worker_id, started_at)
    select id, attempts, _worker, now() from claimed
    returning 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', id, 'listing_id', listing_id, 'account_id', sales_channel_account_id,
    'store_id', store_id, 'operation', operation, 'job_type', job_type,
    'attempts', attempts, 'max_attempts', max_attempts,
    'lease_token', _token, 'worker_id', _worker
  )), '[]'::jsonb) into _rows
  from claimed;
  perform (select count(*) from public.background_job_attempts where lease_dummy_never is null limit 0);
  perform set_config('app.sync_job_write','off',true);

  return _rows;
end $$;

-- ---------------------------------------------------------------------------
-- COMPLETE: lifecycle + retry policy + dead letter + attempt history
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_sync_job(
  _job_id uuid,
  _lease_token uuid,
  _ok boolean,
  _message text DEFAULT NULL,
  _failure_class public.sync_failure_class DEFAULT 'unknown',
  _run_id uuid DEFAULT NULL,
  _retry_after timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _job public.sales_channel_sync_jobs;
        _status public.sync_job_status;
        _class public.sync_failure_class;
        _msg text;
        _next timestamptz;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to process the synchronisation queue';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id for update;
  if _job.id is null then raise exception 'Sync job not found'; end if;

  -- lease ownership: an expired, re-claimed or foreign lease can never report
  if _job.status <> 'processing' or _job.lease_token is distinct from _lease_token then
    return jsonb_build_object('applied', false, 'status', _job.status);
  end if;

  _class := coalesce(_failure_class, 'unknown');
  _msg := left(coalesce(nullif(btrim(coalesce(_message,'')),''), 'Synchronisation failed'), 300);

  if _ok then
    _status := 'succeeded';
  elsif _class in ('permanent','authentication') then
    _status := 'failed';                       -- never auto-retried
  elsif _job.attempts >= _job.max_attempts then
    _status := 'dead_letter';                  -- retries exhausted
  else
    _status := 'retry_wait';
  end if;

  if _status = 'retry_wait' then
    _next := case
      when _class = 'rate_limited' and _retry_after is not null and _retry_after > now()
        then _retry_after
      when _class = 'rate_limited' then now() + public.sync_job_backoff(_job.attempts) * 2
      else now() + public.sync_job_backoff(_job.attempts)
    end;
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

  return jsonb_build_object('applied', true, 'status', _status);
end $$;

-- ---------------------------------------------------------------------------
-- STALE RECOVERY (race-safe, lease driven)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reclaim_stale_sync_jobs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _n integer;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to manage the synchronisation queue';
  end if;
  perform set_config('app.sync_job_write','on',true);
  with stale as (
    update public.sales_channel_sync_jobs set
      status = (case when attempts >= max_attempts then 'dead_letter' else 'retry_wait' end)::public.sync_job_status,
      failure_class = 'transient'::public.sync_failure_class,
      last_error = 'The worker did not report a result in time',
      lease_token = null,
      lease_expires_at = null,
      worker_id = null,
      available_at = now() + public.sync_job_backoff(attempts),
      first_failed_at = coalesce(first_failed_at, now()),
      final_failed_at = case when attempts >= max_attempts then now() else null end,
      completed_at = case when attempts >= max_attempts then now() else null end
    where status = 'processing' and lease_expires_at is not null and lease_expires_at < now()
    returning id, attempts
  ), closed as (
    update public.background_job_attempts a set
      finished_at = now(),
      duration_ms = greatest(0, (extract(epoch from (now() - a.started_at)) * 1000)::integer),
      ok = false,
      failure_class = 'transient'::public.sync_failure_class,
      message = 'The worker did not report a result in time'
    from stale s
    where a.job_id = s.id and a.attempt_number = s.attempts and a.finished_at is null
    returning 1
  ) select count(*) into _n from stale;
  perform set_config('app.sync_job_write','off',true);
  return coalesce(_n,0);
end $$;

/** Operator-driven recovery of one job whose lease has genuinely expired. */
CREATE OR REPLACE FUNCTION public.recover_stale_sync_job(_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _job public.sales_channel_sync_jobs;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to recover background jobs';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id for update;
  if _job.id is null then raise exception 'Sync job not found'; end if;
  if _job.status <> 'processing' then
    raise exception 'Only a running job can be recovered';
  end if;
  if _job.lease_expires_at is null or _job.lease_expires_at >= now() then
    raise exception 'This job is still held by a healthy worker';
  end if;

  perform set_config('app.sync_job_write','on',true);
  update public.sales_channel_sync_jobs set
    status = (case when attempts >= max_attempts then 'dead_letter' else 'retry_wait' end)::public.sync_job_status,
    failure_class = 'transient'::public.sync_failure_class,
    last_error = 'Recovered after the worker lease expired',
    lease_token = null, lease_expires_at = null, worker_id = null,
    available_at = now(),
    first_failed_at = coalesce(first_failed_at, now()),
    final_failed_at = case when attempts >= max_attempts then now() else null end,
    completed_at = case when attempts >= max_attempts then now() else null end
  where id = _job_id;

  update public.background_job_attempts set
    finished_at = now(),
    duration_ms = greatest(0, (extract(epoch from (now() - started_at)) * 1000)::integer),
    ok = false,
    failure_class = 'transient'::public.sync_failure_class,
    message = 'Recovered after the worker lease expired'
  where job_id = _job_id and attempt_number = _job.attempts and finished_at is null;
  perform set_config('app.sync_job_write','off',true);

  select * into _job from public.sales_channel_sync_jobs where id = _job_id;
  return jsonb_build_object('job_id', _job_id, 'status', _job.status);
end $$;

-- ---------------------------------------------------------------------------
-- CANCEL / REQUEUE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_sync_job(_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _job public.sales_channel_sync_jobs;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to manage the synchronisation queue';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id for update;
  if _job.id is null then raise exception 'Sync job not found'; end if;
  if _job.status not in ('pending','retry_wait','failed','dead_letter') then
    raise exception 'Only a waiting, failed or dead-letter job can be cancelled';
  end if;
  perform set_config('app.sync_job_write','on',true);
  update public.sales_channel_sync_jobs
     set status = 'cancelled', completed_at = now(),
         last_error = 'Cancelled by an operator',
         retry_after = null
   where id = _job_id;
  perform set_config('app.sync_job_write','off',true);
  return jsonb_build_object('job_id', _job_id, 'status', 'cancelled');
end $$;

CREATE OR REPLACE FUNCTION public.requeue_sync_job(_job_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _job public.sales_channel_sync_jobs; _new uuid;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to manage the synchronisation queue';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id for update;
  if _job.id is null then raise exception 'Sync job not found'; end if;
  if _job.status not in ('failed','cancelled','dead_letter') then
    raise exception 'Only a failed, cancelled or dead-letter job can be re-queued';
  end if;
  if _job.listing_id is not null
     and not exists (select 1 from public.sales_channel_product_listings where id = _job.listing_id) then
    raise exception 'The listing this job refers to no longer exists';
  end if;

  perform set_config('app.sync_job_write','on',true);
  insert into public.sales_channel_sync_jobs
    (listing_id, sales_channel_account_id, store_id, operation, job_type, priority,
     source, source_reference, created_by)
  values (_job.listing_id, _job.sales_channel_account_id, _job.store_id, _job.operation,
          _job.job_type, 50, 'requeue', _job.id, auth.uid())
  on conflict (listing_id, operation) where status in ('pending','retry_wait')
  do update set priority = 50, available_at = now(), retry_after = null,
                source = 'requeue', updated_at = now()
  returning id into _new;
  perform set_config('app.sync_job_write','off',true);
  return _new;
end $$;

-- ---------------------------------------------------------------------------
-- READ: health, list, detail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_queue_health(_store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _res jsonb; _recent integer;
begin
  if not public.can_read_channels() then
    raise exception 'Not permitted to read the synchronisation queue';
  end if;

  select count(*) into _recent from public.sales_channel_sync_jobs
   where (_store_id is null or store_id = _store_id)
     and completed_at is not null and completed_at > now() - interval '24 hours';

  select jsonb_build_object(
    'queue_depth', count(*) filter (where status in ('pending','retry_wait')),
    'processing_count', count(*) filter (where status = 'processing'),
    'retry_count', count(*) filter (where status = 'retry_wait'),
    'failed_count', count(*) filter (where status = 'failed'),
    'dead_letter_count', count(*) filter (where status = 'dead_letter'),
    'cancelled_count', count(*) filter (where status = 'cancelled'),
    'succeeded_24h', count(*) filter (where status = 'succeeded' and completed_at > now() - interval '24 hours'),
    'oldest_waiting_at', min(available_at) filter (where status in ('pending','retry_wait')),
    'stale_lease_count', count(*) filter (where status = 'processing' and lease_expires_at < now()),
    'auth_failure_count', count(*) filter (where failure_class = 'authentication' and status in ('failed','dead_letter')),
    'rate_limited_count', count(*) filter (where failure_class = 'rate_limited' and status in ('retry_wait','failed','dead_letter')),
    'sample_24h', _recent,
    'failure_rate_24h', case when _recent = 0 then null else round(
        (count(*) filter (where status in ('failed','dead_letter') and completed_at > now() - interval '24 hours'))::numeric
        / _recent * 100, 1) end,
    'success_rate_24h', case when _recent = 0 then null else round(
        (count(*) filter (where status = 'succeeded' and completed_at > now() - interval '24 hours'))::numeric
        / _recent * 100, 1) end
  ) into _res
  from public.sales_channel_sync_jobs
  where (_store_id is null or store_id = _store_id);

  select _res
      || jsonb_build_object(
        'avg_duration_ms',
        (select round(avg(a.duration_ms))::integer from public.background_job_attempts a
          join public.sales_channel_sync_jobs j on j.id = a.job_id
         where a.finished_at is not null and a.finished_at > now() - interval '24 hours'
           and (_store_id is null or j.store_id = _store_id)),
        'last_worker_activity_at',
        (select max(a.started_at) from public.background_job_attempts a
          join public.sales_channel_sync_jobs j on j.id = a.job_id
         where (_store_id is null or j.store_id = _store_id)),
        'attempts_24h',
        (select count(*) from public.background_job_attempts a
          join public.sales_channel_sync_jobs j on j.id = a.job_id
         where a.started_at > now() - interval '24 hours'
           and (_store_id is null or j.store_id = _store_id))
      ) into _res;

  return coalesce(_res, '{}'::jsonb);
end $$;

CREATE OR REPLACE FUNCTION public.list_sync_jobs(
  _store_id uuid DEFAULT NULL,
  _status public.sync_job_status DEFAULT NULL,
  _listing_id uuid DEFAULT NULL,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0,
  _job_type text DEFAULT NULL,
  _failure_class public.sync_failure_class DEFAULT NULL,
  _account_id uuid DEFAULT NULL,
  _operation public.sales_channel_sync_type DEFAULT NULL,
  _search text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _sort text DEFAULT 'recent'
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _rows jsonb; _total integer; _q text := nullif(btrim(coalesce(_search,'')),'');
begin
  if not public.can_read_channels() then
    raise exception 'Not permitted to read the synchronisation queue';
  end if;

  with base as (
    select j.*, a.provider, a.name as channel_name, l.listing_status,
           coalesce(nullif(btrim(coalesce(sp.title_override,'')),''), p.name) as product_title
    from public.sales_channel_sync_jobs j
    left join public.sales_channel_product_listings l on l.id = j.listing_id
    left join public.store_products sp on sp.id = l.store_product_id
    left join public.products p on p.id = sp.product_id
    left join public.sales_channel_accounts a on a.id = j.sales_channel_account_id
    where (_store_id is null or j.store_id = _store_id)
      and (_status is null or j.status = _status)
      and (_listing_id is null or j.listing_id = _listing_id)
      and (_job_type is null or j.job_type = _job_type)
      and (_failure_class is null or j.failure_class = _failure_class)
      and (_account_id is null or j.sales_channel_account_id = _account_id)
      and (_operation is null or j.operation = _operation)
      and (_from is null or j.created_at >= _from)
      and (_to is null or j.created_at <= _to)
      and (_q is null or coalesce(a.name,'') ilike '%'||_q||'%'
           or coalesce(p.name,'') ilike '%'||_q||'%'
           or coalesce(sp.title_override,'') ilike '%'||_q||'%'
           or coalesce(j.last_error,'') ilike '%'||_q||'%')
  )
  select count(*) into _total from base;

  with base as (
    select j.*, a.provider, a.name as channel_name, l.listing_status,
           coalesce(nullif(btrim(coalesce(sp.title_override,'')),''), p.name) as product_title
    from public.sales_channel_sync_jobs j
    left join public.sales_channel_product_listings l on l.id = j.listing_id
    left join public.store_products sp on sp.id = l.store_product_id
    left join public.products p on p.id = sp.product_id
    left join public.sales_channel_accounts a on a.id = j.sales_channel_account_id
    where (_store_id is null or j.store_id = _store_id)
      and (_status is null or j.status = _status)
      and (_listing_id is null or j.listing_id = _listing_id)
      and (_job_type is null or j.job_type = _job_type)
      and (_failure_class is null or j.failure_class = _failure_class)
      and (_account_id is null or j.sales_channel_account_id = _account_id)
      and (_operation is null or j.operation = _operation)
      and (_from is null or j.created_at >= _from)
      and (_to is null or j.created_at <= _to)
      and (_q is null or coalesce(a.name,'') ilike '%'||_q||'%'
           or coalesce(p.name,'') ilike '%'||_q||'%'
           or coalesce(sp.title_override,'') ilike '%'||_q||'%'
           or coalesce(j.last_error,'') ilike '%'||_q||'%')
  ), ordered as (
    select jsonb_build_object(
      'id', id, 'listing_id', listing_id, 'store_id', store_id,
      'job_type', job_type, 'operation', operation, 'status', status, 'priority', priority,
      'attempts', attempts, 'max_attempts', max_attempts,
      'available_at', available_at, 'completed_at', completed_at,
      'last_attempt_at', last_attempt_at, 'first_failed_at', first_failed_at,
      'final_failed_at', final_failed_at, 'retry_after', retry_after,
      'lease_expires_at', lease_expires_at, 'worker_id', worker_id,
      'last_error', last_error, 'failure_class', failure_class,
      'source', source, 'created_at', created_at, 'updated_at', updated_at,
      'provider', provider, 'channel_name', channel_name,
      'product_title', product_title, 'listing_status', listing_status
    ) as row,
    row_number() over (order by
      case when _sort = 'oldest' then created_at end asc,
      case when _sort = 'priority' then priority end asc,
      case when _sort not in ('oldest','priority') then created_at end desc
    ) as ord
    from base
    order by
      case when _sort = 'oldest' then created_at end asc,
      case when _sort = 'priority' then priority end asc,
      case when _sort not in ('oldest','priority') then created_at end desc
    limit greatest(1, least(coalesce(_limit,25), 100)) offset greatest(coalesce(_offset,0),0)
  )
  select coalesce(jsonb_agg(row order by ord), '[]'::jsonb) into _rows from ordered;

  return jsonb_build_object('total', _total, 'rows', _rows);
end $$;

CREATE OR REPLACE FUNCTION public.get_sync_job(_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _job jsonb; _history jsonb; _runs jsonb;
begin
  if not public.can_read_channels() then
    raise exception 'Not permitted to read the synchronisation queue';
  end if;

  select jsonb_build_object(
    'id', j.id, 'listing_id', j.listing_id, 'store_id', j.store_id,
    'store_name', s.name,
    'job_type', j.job_type, 'operation', j.operation, 'status', j.status,
    'priority', j.priority, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
    'available_at', j.available_at, 'completed_at', j.completed_at,
    'claimed_at', j.claimed_at, 'lease_expires_at', j.lease_expires_at,
    'worker_id', j.worker_id, 'last_attempt_at', j.last_attempt_at,
    'first_failed_at', j.first_failed_at, 'final_failed_at', j.final_failed_at,
    'retry_after', j.retry_after, 'depends_on_job_id', j.depends_on_job_id,
    'last_error', j.last_error, 'failure_class', j.failure_class,
    'last_run_id', j.last_run_id, 'source', j.source, 'source_reference', j.source_reference,
    'created_at', j.created_at, 'updated_at', j.updated_at,
    'provider', a.provider, 'channel_name', a.name,
    'sales_channel_account_id', j.sales_channel_account_id,
    'listing_status', l.listing_status,
    'product_title', coalesce(nullif(btrim(coalesce(sp.title_override,'')),''), p.name)
  ) into _job
  from public.sales_channel_sync_jobs j
  left join public.stores s on s.id = j.store_id
  left join public.sales_channel_product_listings l on l.id = j.listing_id
  left join public.store_products sp on sp.id = l.store_product_id
  left join public.products p on p.id = sp.product_id
  left join public.sales_channel_accounts a on a.id = j.sales_channel_account_id
  where j.id = _job_id;

  if _job is null then raise exception 'Sync job not found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'attempt_number', attempt_number, 'worker_id', worker_id,
    'started_at', started_at, 'finished_at', finished_at, 'duration_ms', duration_ms,
    'ok', ok, 'failure_class', failure_class, 'message', message, 'run_id', run_id
  ) order by attempt_number desc), '[]'::jsonb) into _history
  from public.background_job_attempts where job_id = _job_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'sync_type', r.sync_type, 'status', r.status,
    'started_at', r.started_at, 'finished_at', r.finished_at, 'message', r.message
  ) order by r.started_at desc), '[]'::jsonb) into _runs
  from public.sales_channel_sync_runs r
  where r.id in (select run_id from public.background_job_attempts where job_id = _job_id and run_id is not null);

  return jsonb_build_object('job', _job, 'attempts', _history, 'runs', _runs);
end $$;

-- ---------------------------------------------------------------------------
-- OPERATIONS ATTENTION (derived from the authoritative job rows)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.background_jobs_attention(
  _stale_wait_hours integer DEFAULT 2,
  _retry_warning_attempts integer DEFAULT 2,
  _backlog_warning integer DEFAULT 25,
  _limit integer DEFAULT 100
)
RETURNS TABLE(
  id text, category text, severity text, source_type text, source_id uuid,
  title text, subtitle text, state text, reason text,
  occurred_at timestamptz, due_at timestamptz, href text,
  assignable boolean, assignment_source_type text,
  assigned_to uuid, assigned_to_name text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  with j as (
    select jb.*, a.name as channel_name,
           coalesce(nullif(btrim(coalesce(sp.title_override,'')),''), p.name, 'Background job') as label
    from public.sales_channel_sync_jobs jb
    left join public.sales_channel_accounts a on a.id = jb.sales_channel_account_id
    left join public.sales_channel_product_listings l on l.id = jb.listing_id
    left join public.store_products sp on sp.id = l.store_product_id
    left join public.products p on p.id = sp.product_id
  ), items as (
    select ('job.dead_letter.'||j.id)::text as id, 'integration'::text as category,
           'critical'::text as severity, 'sync_job'::text as source_type, j.id as source_id,
           ('Dead-letter job: '||j.label) as title, j.channel_name as subtitle,
           j.status::text as state,
           coalesce(j.last_error,'Retries exhausted') as reason,
           coalesce(j.final_failed_at, j.updated_at) as occurred_at,
           null::timestamptz as due_at,
           ('/operations/jobs/'||j.id) as href
    from j where j.status = 'dead_letter'
    union all
    select ('job.auth.'||j.id), 'integration', 'critical', 'sync_job', j.id,
           ('Channel authentication failed: '||coalesce(j.channel_name,'connection')),
           j.label, j.status::text,
           coalesce(j.last_error,'The channel rejected our credentials'),
           coalesce(j.final_failed_at, j.updated_at), null::timestamptz,
           ('/operations/jobs/'||j.id)
    from j where j.failure_class = 'authentication' and j.status in ('failed','dead_letter')
    union all
    select ('job.stale_lease.'||j.id), 'integration', 'high', 'sync_job', j.id,
           ('Stale worker lease: '||j.label), j.channel_name, j.status::text,
           'A worker claimed this job and never reported a result',
           coalesce(j.claimed_at, j.updated_at), j.lease_expires_at,
           ('/operations/jobs/'||j.id)
    from j where j.status = 'processing' and j.lease_expires_at is not null and j.lease_expires_at < now()
    union all
    select ('job.overdue.'||j.id), 'integration', 'high', 'sync_job', j.id,
           ('Job waiting too long: '||j.label), j.channel_name, j.status::text,
           'This job has been waiting far longer than expected',
           j.available_at, j.available_at + make_interval(hours => greatest(_stale_wait_hours,1)),
           ('/operations/jobs/'||j.id)
    from j where j.status in ('pending','retry_wait')
      and j.available_at < now() - make_interval(hours => greatest(_stale_wait_hours,1))
    union all
    select ('job.retrying.'||j.id), 'integration', 'warning', 'sync_job', j.id,
           ('Repeated retries: '||j.label), j.channel_name, j.status::text,
           coalesce(j.last_error,'Repeated transient failures'),
           coalesce(j.first_failed_at, j.updated_at), j.available_at,
           ('/operations/jobs/'||j.id)
    from j where j.status = 'retry_wait' and j.attempts >= greatest(_retry_warning_attempts,1)
    union all
    select ('job.failed.'||j.id), 'integration', 'warning', 'sync_job', j.id,
           ('Failed job: '||j.label), j.channel_name, j.status::text,
           coalesce(j.last_error,'The job failed'),
           coalesce(j.final_failed_at, j.updated_at), null::timestamptz,
           ('/operations/jobs/'||j.id)
    from j where j.status = 'failed' and coalesce(j.failure_class::text,'') <> 'authentication'
    union all
    select 'job.backlog', 'integration', 'warning', 'sync_job',
           '00000000-0000-0000-0000-000000000000'::uuid,
           'Background queue backlog', null, 'pending',
           ('There are '||count(*)||' jobs waiting to be processed'),
           min(j.available_at), null::timestamptz, '/operations/jobs'
    from j where j.status in ('pending','retry_wait')
    having count(*) >= greatest(_backlog_warning,1)
  )
  select i.id, i.category, i.severity, i.source_type, i.source_id, i.title, i.subtitle,
         i.state, i.reason, i.occurred_at, i.due_at, i.href,
         false as assignable, null::text as assignment_source_type,
         null::uuid as assigned_to, null::text as assigned_to_name
  from items i
  order by case i.severity when 'critical' then 0 when 'high' then 1 else 2 end,
           i.occurred_at asc
  limit greatest(1, least(coalesce(_limit,100), 500));
$$;

REVOKE ALL ON FUNCTION public.recover_stale_sync_job(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sync_queue_health(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_sync_job(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.background_jobs_attention(integer,integer,integer,integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_sync_jobs(integer,integer,text) FROM anon;
REVOKE ALL ON FUNCTION public.complete_sync_job(uuid,uuid,boolean,text,public.sync_failure_class,uuid,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.list_sync_jobs(uuid,public.sync_job_status,uuid,integer,integer,text,public.sync_failure_class,uuid,public.sales_channel_sync_type,text,timestamptz,timestamptz,text) FROM anon;
