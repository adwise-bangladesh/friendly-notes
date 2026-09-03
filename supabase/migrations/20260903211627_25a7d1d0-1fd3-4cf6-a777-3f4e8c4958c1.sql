
-- 1. correlation columns on existing telemetry
ALTER TABLE public.worker_runs ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE public.courier_api_logs ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE public.courier_api_logs ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE public.courier_api_logs ADD COLUMN IF NOT EXISTS failure_stage text;
CREATE INDEX IF NOT EXISTS worker_runs_correlation_idx ON public.worker_runs (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS courier_api_logs_correlation_idx ON public.courier_api_logs (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS courier_api_logs_created_idx ON public.courier_api_logs (created_at DESC);

-- 2. append-only operational diagnostics
CREATE TABLE IF NOT EXISTS public.operational_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL DEFAULT 'error'
    CHECK (severity IN ('info','warning','error','critical')),
  subsystem text NOT NULL
    CHECK (subsystem IN ('orders','verification','fulfillment','shipping','courier','webhook','settlement','sync','worker','automation','integration','ai','inventory','other')),
  operation text NOT NULL,
  error_category text NOT NULL DEFAULT 'internal'
    CHECK (error_category IN ('validation','authorization','not_found','conflict','state_conflict','external_timeout','external_unavailable','external_rejected','mapping_missing','rate_limited','lease_conflict','retry_exhausted','unknown_outcome','internal')),
  failure_stage text
    CHECK (failure_stage IS NULL OR failure_stage IN ('validation','authorization','claim','database','external_request','external_response','mapping','transition','projection','retry','recovery')),
  message text NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  correlation_id text,
  worker_run_id uuid REFERENCES public.worker_runs(id) ON DELETE SET NULL,
  provider_code text,
  account_id uuid,
  entity_type text,
  entity_id uuid,
  duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_diagnostics_occurred_idx ON public.operational_diagnostics (occurred_at DESC);
CREATE INDEX IF NOT EXISTS operational_diagnostics_subsystem_idx ON public.operational_diagnostics (subsystem, occurred_at DESC);
CREATE INDEX IF NOT EXISTS operational_diagnostics_severity_idx ON public.operational_diagnostics (severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS operational_diagnostics_correlation_idx ON public.operational_diagnostics (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operational_diagnostics_entity_idx ON public.operational_diagnostics (entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operational_diagnostics_run_idx ON public.operational_diagnostics (worker_run_id) WHERE worker_run_id IS NOT NULL;

ALTER TABLE public.operational_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_diagnostics FROM anon, authenticated;
GRANT ALL ON public.operational_diagnostics TO service_role;

-- append-only: rows may never be edited; deletion only through the pruner
CREATE OR REPLACE FUNCTION public.guard_operational_diagnostics_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Operational diagnostics are append-only';
  END IF;
  IF TG_OP = 'DELETE'
     AND COALESCE(current_setting('app.diagnostics_pruner', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Operational diagnostics may only be removed by the retention pruner';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_operational_diagnostics_write ON public.operational_diagnostics;
CREATE TRIGGER guard_operational_diagnostics_write
BEFORE UPDATE OR DELETE ON public.operational_diagnostics
FOR EACH ROW EXECUTE FUNCTION public.guard_operational_diagnostics_write();

-- 3. controlled recorder (backend paths only)
CREATE OR REPLACE FUNCTION public.record_operational_diagnostic(
  _subsystem text,
  _operation text,
  _message text,
  _severity text DEFAULT 'error',
  _error_category text DEFAULT 'internal',
  _failure_stage text DEFAULT NULL,
  _retryable boolean DEFAULT false,
  _correlation_id text DEFAULT NULL,
  _worker_run_id uuid DEFAULT NULL,
  _provider_code text DEFAULT NULL,
  _account_id uuid DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _duration_ms integer DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Diagnostics are recorded by backend operations only';
  END IF;

  INSERT INTO public.operational_diagnostics (
    subsystem, operation, message, severity, error_category, failure_stage,
    retryable, correlation_id, worker_run_id, provider_code, account_id,
    entity_type, entity_id, duration_ms, metadata
  ) VALUES (
    _subsystem,
    left(_operation, 120),
    left(_message, 500),
    COALESCE(_severity, 'error'),
    COALESCE(_error_category, 'internal'),
    _failure_stage,
    COALESCE(_retryable, false),
    left(_correlation_id, 64),
    _worker_run_id,
    left(_provider_code, 40),
    _account_id,
    left(_entity_type, 40),
    _entity_id,
    _duration_ms,
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_operational_diagnostic(text,text,text,text,text,text,boolean,text,uuid,text,uuid,text,uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_operational_diagnostic(text,text,text,text,text,text,boolean,text,uuid,text,uuid,text,uuid,integer,jsonb) TO service_role;

-- 4. worker run start accepts a correlation id
CREATE OR REPLACE FUNCTION public.start_worker_run(
  _worker text,
  _trigger_source text,
  _correlation_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.worker_runs (worker, trigger_source, correlation_id)
  VALUES (_worker, _trigger_source, left(_correlation_id, 64))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 5. reader projections
CREATE OR REPLACE FUNCTION public.list_operational_diagnostics(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0,
  _severity text DEFAULT NULL,
  _subsystem text DEFAULT NULL,
  _error_category text DEFAULT NULL,
  _correlation_id text DEFAULT NULL,
  _since_hours integer DEFAULT 168
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_since timestamptz := now() - make_interval(hours => LEAST(GREATEST(COALESCE(_since_hours, 168), 1), 720));
  v_total integer;
  v_rows jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to read operational diagnostics';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.operational_diagnostics d
   WHERE d.occurred_at >= v_since
     AND (_severity IS NULL OR d.severity = _severity)
     AND (_subsystem IS NULL OR d.subsystem = _subsystem)
     AND (_error_category IS NULL OR d.error_category = _error_category)
     AND (_correlation_id IS NULL OR d.correlation_id = _correlation_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.occurred_at DESC, x.id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT d.*
        FROM public.operational_diagnostics d
       WHERE d.occurred_at >= v_since
         AND (_severity IS NULL OR d.severity = _severity)
         AND (_subsystem IS NULL OR d.subsystem = _subsystem)
         AND (_error_category IS NULL OR d.error_category = _error_category)
         AND (_correlation_id IS NULL OR d.correlation_id = _correlation_id)
       ORDER BY d.occurred_at DESC, d.id DESC
       LIMIT v_limit OFFSET v_offset
    ) x;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_operational_diagnostics(integer,integer,text,text,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_operational_diagnostics(integer,integer,text,text,text,text,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.operational_diagnostic_trail(_correlation_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := left(_correlation_id, 64);
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to read operational diagnostics';
  END IF;

  RETURN jsonb_build_object(
    'correlation_id', v_key,
    'generated_at', now(),
    'diagnostics', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.occurred_at)
        FROM (
          SELECT * FROM public.operational_diagnostics
           WHERE correlation_id = v_key
           ORDER BY occurred_at LIMIT 200
        ) d
    ), '[]'::jsonb),
    'worker_runs', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.started_at)
        FROM (
          SELECT id, worker, trigger_source, status, started_at, finished_at,
                 duration_ms, claimed, processed, succeeded, failed, skipped, error_class
            FROM public.worker_runs
           WHERE correlation_id = v_key
           ORDER BY started_at LIMIT 50
        ) r
    ), '[]'::jsonb),
    'courier_api_calls', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at)
        FROM (
          SELECT id, provider_id, account_id, shipment_id, operation, succeeded,
                 status_code, error_category, safe_message, retryable, duration_ms,
                 failure_stage, created_at
            FROM public.courier_api_logs
           WHERE correlation_id = v_key
           ORDER BY created_at LIMIT 100
        ) l
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.operational_diagnostic_trail(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_diagnostic_trail(text) TO authenticated, service_role;

-- 6. supporting evidence for one operational alert (references, not copies)
CREATE OR REPLACE FUNCTION public.operational_alert_evidence(_alert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.operational_alerts%ROWTYPE;
  v_subsystem text;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to read operational diagnostics';
  END IF;

  SELECT * INTO a FROM public.operational_alerts WHERE id = _alert_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alert not found';
  END IF;

  v_subsystem := CASE a.category
    WHEN 'workers' THEN 'worker'
    WHEN 'courier' THEN 'courier'
    WHEN 'finance' THEN 'settlement'
    ELSE NULL END;

  RETURN jsonb_build_object(
    'alert', to_jsonb(a) - 'acknowledged_by',
    'generated_at', now(),
    'worker_runs', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC)
        FROM (
          SELECT id, worker, trigger_source, status, started_at, finished_at,
                 duration_ms, claimed, processed, succeeded, failed, skipped,
                 error_class, correlation_id
            FROM public.worker_runs
           WHERE a.category = 'workers'
             AND worker = COALESCE(a.metrics->>'worker', a.signal)
           ORDER BY started_at DESC LIMIT 10
        ) r
    ), '[]'::jsonb),
    'diagnostics', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.occurred_at DESC)
        FROM (
          SELECT * FROM public.operational_diagnostics
           WHERE occurred_at > a.first_detected_at - interval '1 hour'
             AND (
               (a.entity_id IS NOT NULL AND entity_id = a.entity_id)
               OR (a.entity_id IS NULL AND v_subsystem IS NOT NULL AND subsystem = v_subsystem)
             )
           ORDER BY occurred_at DESC LIMIT 25
        ) d
    ), '[]'::jsonb),
    'courier_api_calls', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC)
        FROM (
          SELECT id, provider_id, account_id, shipment_id, operation, succeeded,
                 status_code, error_category, safe_message, retryable, duration_ms,
                 failure_stage, correlation_id, created_at
            FROM public.courier_api_logs
           WHERE a.entity_type = 'shipment'
             AND shipment_id = a.entity_id
           ORDER BY created_at DESC LIMIT 20
        ) l
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.operational_alert_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_alert_evidence(uuid) TO authenticated, service_role;

-- 7. bounded retention for operational telemetry only
CREATE OR REPLACE FUNCTION public.prune_operational_telemetry(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(_days, 30), 7), 365);
  v_diag integer := 0;
  v_logs integer := 0;
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Retention runs from backend operations only';
  END IF;

  PERFORM set_config('app.diagnostics_pruner', 'on', true);

  DELETE FROM public.operational_diagnostics
   WHERE occurred_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_diag = ROW_COUNT;

  DELETE FROM public.courier_api_logs
   WHERE created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  RETURN jsonb_build_object('diagnostics_deleted', v_diag, 'courier_api_logs_deleted', v_logs, 'retention_days', v_days);
END;
$$;

REVOKE ALL ON FUNCTION public.prune_operational_telemetry(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_telemetry(integer) TO service_role;
