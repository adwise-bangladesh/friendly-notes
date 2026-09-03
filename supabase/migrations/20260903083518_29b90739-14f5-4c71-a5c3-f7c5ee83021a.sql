DROP FUNCTION IF EXISTS public.claim_sync_jobs(integer, integer);
DROP FUNCTION IF EXISTS public.complete_sync_job(uuid, uuid, boolean, text, public.sync_failure_class, uuid);
DROP FUNCTION IF EXISTS public.list_sync_jobs(uuid, public.sync_job_status, uuid, integer, integer);

-- Remove the accidental no-op probe statement from the claim function.
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
  perform set_config('app.sync_job_write','off',true);

  return _rows;
end $$;

REVOKE ALL ON FUNCTION public.claim_sync_jobs(integer,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_sync_job(uuid,uuid,boolean,text,public.sync_failure_class,uuid,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_sync_jobs(uuid,public.sync_job_status,uuid,integer,integer,text,public.sync_failure_class,uuid,public.sales_channel_sync_type,text,timestamptz,timestamptz,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sync_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recover_stale_sync_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_queue_health(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.background_jobs_attention(integer,integer,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_job_backoff(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_sync_jobs(integer,integer,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_sync_job(uuid,uuid,boolean,text,public.sync_failure_class,uuid,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_sync_jobs(uuid,public.sync_job_status,uuid,integer,integer,text,public.sync_failure_class,uuid,public.sales_channel_sync_type,text,timestamptz,timestamptz,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sync_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_sync_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_queue_health(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.background_jobs_attention(integer,integer,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_job_backoff(integer) TO authenticated, service_role;
