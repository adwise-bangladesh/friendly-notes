CREATE OR REPLACE FUNCTION public.recover_stale_sync_job(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _job public.sales_channel_sync_jobs;
begin
  if not public.can_sync_channels() then
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
end $function$;