
CREATE OR REPLACE FUNCTION public.worker_run_health(_stale_minutes integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stale integer := GREATEST(5, LEAST(COALESCE(_stale_minutes, 30), 1440));
  v_rows jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to view worker health';
  END IF;

  SELECT COALESCE(jsonb_agg(w ORDER BY w.worker), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      k.worker,
      (SELECT to_jsonb(r) FROM (
         SELECT id, status, trigger_source, started_at, finished_at, duration_ms,
                claimed, processed, succeeded, failed, skipped, error_class
         FROM public.worker_runs
         WHERE worker = k.worker
         ORDER BY started_at DESC LIMIT 1
       ) r) AS last_run,
      (SELECT max(started_at) FROM public.worker_runs
        WHERE worker = k.worker AND status = 'succeeded') AS last_success_at,
      (SELECT max(started_at) FROM public.worker_runs
        WHERE worker = k.worker AND status = 'failed') AS last_failure_at,
      (SELECT count(*) FROM public.worker_runs
        WHERE worker = k.worker AND status = 'running'
          AND started_at < now() - interval '15 minutes') AS abandoned_runs,
      (SELECT count(*) FROM public.worker_runs
        WHERE worker = k.worker AND started_at > now() - interval '24 hours') AS runs_24h,
      (SELECT count(*) FROM public.worker_runs
        WHERE worker = k.worker AND status = 'failed'
          AND started_at > now() - interval '24 hours') AS failures_24h,
      COALESCE(
        (SELECT max(started_at) FROM public.worker_runs
          WHERE worker = k.worker AND status = 'succeeded'),
        '-infinity'::timestamptz
      ) < now() - make_interval(mins => v_stale) AS is_stale
    FROM (VALUES ('courier_tracking'), ('sync_queue'), ('ops_sweeper')) AS k(worker)
  ) w;

  RETURN jsonb_build_object(
    'stale_after_minutes', v_stale,
    'generated_at', now(),
    'workers', v_rows,
    'backlog', jsonb_build_object(
      'sync_jobs_pending', (SELECT count(*) FROM public.sales_channel_sync_jobs WHERE status = 'pending'::public.sync_job_status),
      'sync_jobs_running', (SELECT count(*) FROM public.sales_channel_sync_jobs WHERE status = 'processing'::public.sync_job_status),
      'courier_events_retry_scheduled', (SELECT count(*) FROM public.courier_provider_events WHERE processing_status = 'retry_scheduled'),
      'courier_events_dead_letter', (SELECT count(*) FROM public.courier_provider_events WHERE processing_status = 'dead_letter'),
      'tracking_polls_due', (SELECT count(*) FROM public.courier_tracking_polls WHERE next_poll_at <= now())
    )
  );
END;
$function$;
