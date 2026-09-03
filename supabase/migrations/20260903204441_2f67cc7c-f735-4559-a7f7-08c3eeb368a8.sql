CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE public.worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker text NOT NULL CHECK (worker IN ('courier_tracking', 'sync_queue', 'ops_sweeper')),
  trigger_source text NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  claimed integer NOT NULL DEFAULT 0 CHECK (claimed >= 0),
  processed integer NOT NULL DEFAULT 0 CHECK (processed >= 0),
  succeeded integer NOT NULL DEFAULT 0 CHECK (succeeded >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  error_class text CHECK (error_class IS NULL OR length(error_class) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.worker_runs IS
  'Minimal execution heartbeat for the existing background workers. Written only by the service role through start_worker_run/finish_worker_run. Never contains secrets, credentials, payloads or customer data.';

CREATE INDEX idx_worker_runs_worker_started ON public.worker_runs (worker, started_at DESC);
CREATE INDEX idx_worker_runs_started ON public.worker_runs (started_at DESC);

GRANT SELECT ON public.worker_runs TO authenticated;
GRANT ALL ON public.worker_runs TO service_role;
REVOKE ALL ON public.worker_runs FROM anon;

ALTER TABLE public.worker_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers can view worker runs"
  ON public.worker_runs FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE TRIGGER update_worker_runs_updated_at
  BEFORE UPDATE ON public.worker_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Start a bounded worker run. Service role only: the worker endpoints run with
-- the service-role client, exactly like every other background context.
CREATE OR REPLACE FUNCTION public.start_worker_run(_worker text, _trigger_source text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.worker_runs (worker, trigger_source)
  VALUES (_worker, _trigger_source)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_worker_run(
  _run_id uuid,
  _status text,
  _claimed integer DEFAULT 0,
  _processed integer DEFAULT 0,
  _succeeded integer DEFAULT 0,
  _failed integer DEFAULT 0,
  _skipped integer DEFAULT 0,
  _error_class text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.worker_runs
  SET status = _status,
      finished_at = now(),
      duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::integer),
      claimed = GREATEST(0, COALESCE(_claimed, 0)),
      processed = GREATEST(0, COALESCE(_processed, 0)),
      succeeded = GREATEST(0, COALESCE(_succeeded, 0)),
      failed = GREATEST(0, COALESCE(_failed, 0)),
      skipped = GREATEST(0, COALESCE(_skipped, 0)),
      error_class = left(_error_class, 120)
  WHERE id = _run_id
    AND status = 'running';
END;
$$;

REVOKE ALL ON FUNCTION public.start_worker_run(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_worker_run(uuid, text, integer, integer, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_worker_run(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_worker_run(uuid, text, integer, integer, integer, integer, integer, text) TO service_role;

-- Read-only operational projection: last success, last failure, backlog-free
-- staleness signal per worker. No payloads, no secrets.
CREATE OR REPLACE FUNCTION public.worker_run_health(_stale_minutes integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      'sync_jobs_pending', (SELECT count(*) FROM public.sales_channel_sync_jobs WHERE status = 'pending'),
      'sync_jobs_running', (SELECT count(*) FROM public.sales_channel_sync_jobs WHERE status = 'running'),
      'courier_events_retry_scheduled', (SELECT count(*) FROM public.courier_provider_events WHERE processing_status = 'retry_scheduled'),
      'courier_events_dead_letter', (SELECT count(*) FROM public.courier_provider_events WHERE processing_status = 'dead_letter'),
      'tracking_polls_due', (SELECT count(*) FROM public.courier_tracking_polls WHERE next_poll_at <= now())
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.worker_run_health(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_run_health(integer) TO authenticated, service_role;

-- Bounded retention. Worker runs are operational telemetry, not audit history.
CREATE OR REPLACE FUNCTION public.prune_worker_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.worker_runs WHERE started_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_worker_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_worker_runs() TO service_role, postgres;