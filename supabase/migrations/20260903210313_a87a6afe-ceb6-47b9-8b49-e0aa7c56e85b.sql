-- ============================================================
-- Step 20.9.2 — Operational alerts (deduplicated incidents)
-- ============================================================

CREATE TABLE public.operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  signal text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  peak_severity text NOT NULL CHECK (peak_severity IN ('info','warning','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  title text NOT NULL,
  detail text NOT NULL,
  recommended_action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  detection_count integer NOT NULL DEFAULT 1,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledged_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.operational_alerts TO authenticated;
GRANT ALL ON public.operational_alerts TO service_role;

ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers view operational alerts"
  ON public.operational_alerts FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE TRIGGER set_operational_alerts_updated_at
  BEFORE UPDATE ON public.operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_operational_alerts_open
  ON public.operational_alerts (severity, last_detected_at DESC)
  WHERE status <> 'resolved';
CREATE INDEX idx_operational_alerts_resolved_at
  ON public.operational_alerts (resolved_at DESC)
  WHERE status = 'resolved';

-- Direct writes are forbidden; only SECURITY DEFINER paths may write.
CREATE OR REPLACE FUNCTION public.protect_operational_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.operational_alerts_writer', true) <> 'on' THEN
    RAISE EXCEPTION 'operational_alerts is maintained by the alert detector only';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER protect_operational_alerts_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.protect_operational_alerts();

-- ------------------------------------------------------------
-- Upsert helper: one row per fingerprint, escalation-aware.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_operational_alert(
  _fingerprint text,
  _signal text,
  _category text,
  _severity text,
  _title text,
  _detail text,
  _recommended_action text,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _metrics jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rank_new int := CASE _severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END;
  _id uuid;
BEGIN
  PERFORM set_config('app.operational_alerts_writer', 'on', true);

  INSERT INTO public.operational_alerts AS a (
    fingerprint, signal, category, severity, peak_severity, status,
    title, detail, recommended_action, entity_type, entity_id, metrics
  )
  VALUES (
    _fingerprint, _signal, _category, _severity, _severity, 'open',
    _title, _detail, _recommended_action, _entity_type, _entity_id, COALESCE(_metrics, '{}'::jsonb)
  )
  ON CONFLICT (fingerprint) DO UPDATE SET
    severity = _severity,
    peak_severity = CASE
      WHEN _rank_new > (CASE a.peak_severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)
        THEN _severity ELSE a.peak_severity END,
    title = _title,
    detail = _detail,
    recommended_action = _recommended_action,
    entity_type = _entity_type,
    entity_id = _entity_id,
    metrics = COALESCE(_metrics, '{}'::jsonb),
    last_detected_at = now(),
    detection_count = a.detection_count + 1,
    -- a resolved condition that returns starts a new incident window
    first_detected_at = CASE WHEN a.status = 'resolved' THEN now() ELSE a.first_detected_at END,
    detection_count_reset = NULL,
    resolved_at = NULL,
    -- acknowledgement expires after 24h or on escalation
    status = CASE
      WHEN a.status = 'acknowledged'
       AND a.acknowledged_at > now() - interval '24 hours'
       AND _rank_new <= (CASE a.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)
        THEN 'acknowledged'
      ELSE 'open' END,
    acknowledged_at = CASE
      WHEN a.status = 'acknowledged'
       AND a.acknowledged_at > now() - interval '24 hours'
       AND _rank_new <= (CASE a.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)
        THEN a.acknowledged_at ELSE NULL END
  RETURNING a.id INTO _id;

  PERFORM set_config('app.operational_alerts_writer', 'off', true);
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_operational_alert(text,text,text,text,text,text,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_operational_alert(text,text,text,text,text,text,text,text,uuid,jsonb) TO service_role;
