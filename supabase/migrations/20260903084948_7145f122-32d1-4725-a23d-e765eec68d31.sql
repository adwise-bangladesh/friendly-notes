-- Race-safe requeue: reuse an existing live recovery job instead of duplicating.
CREATE OR REPLACE FUNCTION public.requeue_sync_job(_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _job public.sales_channel_sync_jobs; _new uuid; _existing uuid;
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

  -- A recovery job for this exact job may already be waiting or running.
  select id into _existing
    from public.sales_channel_sync_jobs
   where source_reference = _job.id
     and status in ('pending','retry_wait','processing')
   limit 1;
  if _existing is not null then
    return _existing;
  end if;

  perform set_config('app.sync_job_write','on',true);
  insert into public.sales_channel_sync_jobs
    (listing_id, sales_channel_account_id, store_id, operation, job_type, priority,
     source, source_reference, created_by)
  values (_job.listing_id, _job.sales_channel_account_id, _job.store_id, _job.operation,
          _job.job_type, 50, 'requeue', _job.id, auth.uid())
  on conflict (listing_id, operation) where status in ('pending','retry_wait')
  do update set priority = 50, available_at = now(), retry_after = null,
                source = 'requeue', source_reference = excluded.source_reference,
                updated_at = now()
  returning id into _new;
  perform set_config('app.sync_job_write','off',true);
  return _new;
end $function$;

-- Queue health gains an honest overdue count.
CREATE OR REPLACE FUNCTION public.sync_queue_health(_store_id uuid DEFAULT NULL::uuid, _overdue_hours integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _res jsonb; _recent integer; _hours integer := greatest(coalesce(_overdue_hours,2),1);
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
    'overdue_count', count(*) filter (
        where status in ('pending','retry_wait')
          and available_at < now() - make_interval(hours => _hours)),
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
end $function$;

REVOKE ALL ON FUNCTION public.sync_queue_health(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_queue_health(uuid, integer) TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.sync_queue_health(uuid);