create or replace function public.sync_job_backoff(_attempt integer)
returns interval
language sql
volatile
set search_path to 'public'
as $function$
  select least(interval '30 minutes',
               make_interval(secs => 30 * power(3, greatest(_attempt,1) - 1)))
       + make_interval(secs => floor(random() * 10));
$function$;

create or replace function public.reclaim_stale_sync_jobs()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _n integer;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to manage the synchronisation queue';
  end if;
  perform set_config('app.sync_job_write','on',true);
  with stale as (
    update public.sales_channel_sync_jobs set
      status = (case when attempts >= max_attempts then 'failed' else 'retry_wait' end)::public.sync_job_status,
      failure_class = 'transient'::public.sync_failure_class,
      last_error = 'The worker did not report a result in time',
      lease_token = null,
      lease_expires_at = null,
      available_at = now() + public.sync_job_backoff(attempts),
      completed_at = case when attempts >= max_attempts then now() else null end
    where status = 'processing' and lease_expires_at is not null and lease_expires_at < now()
    returning 1
  ) select count(*) into _n from stale;
  perform set_config('app.sync_job_write','off',true);
  return coalesce(_n,0);
end $function$;

revoke all on function public.sync_job_backoff(integer) from anon;
revoke all on function public.reclaim_stale_sync_jobs() from anon;