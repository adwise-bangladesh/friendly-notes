-- ============================ STEP 14 — AI BRAIN FOUNDATION ============================
-- AI Brain is an intelligence layer. It never mutates authoritative commerce data.

CREATE TYPE public.ai_analysis_type AS ENUM (
  'operations_summary','order_review','customer_review','inventory_review',
  'delivery_review','courier_review','procurement_review','financial_review');

CREATE TYPE public.ai_run_status AS ENUM ('queued','running','completed','failed','cancelled');

CREATE TYPE public.ai_insight_category AS ENUM (
  'operations','order','customer','inventory','delivery','courier',
  'procurement','financial','verification','general');

CREATE TYPE public.ai_insight_severity AS ENUM ('info','low','medium','high','critical');

CREATE TYPE public.ai_insight_status AS ENUM ('active','acknowledged','dismissed','expired');

CREATE TYPE public.ai_recommendation_priority AS ENUM ('low','medium','high','urgent');

CREATE TYPE public.ai_recommendation_status AS ENUM ('pending','accepted','dismissed','executed','expired');

-- ---------------------------------------------------------------- analysis runs
CREATE TABLE public.ai_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_type public.ai_analysis_type NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  status public.ai_run_status NOT NULL DEFAULT 'queued',
  provider text,
  model text,
  source text NOT NULL DEFAULT 'ai_provider',
  requested_by uuid NOT NULL DEFAULT auth.uid(),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  error_message text,
  context_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  insight_count integer NOT NULL DEFAULT 0,
  recommendation_count integer NOT NULL DEFAULT 0,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_run_entity_ck CHECK (entity_type <> ''),
  CONSTRAINT ai_run_error_len_ck CHECK (error_message IS NULL OR length(error_message) <= 500),
  CONSTRAINT ai_run_source_ck CHECK (source IN ('ai_provider','system'))
);
CREATE INDEX ai_runs_created_idx ON public.ai_analysis_runs (created_at DESC);
CREATE INDEX ai_runs_entity_idx ON public.ai_analysis_runs (entity_type, entity_id, created_at DESC);
CREATE INDEX ai_runs_status_idx ON public.ai_analysis_runs (status);

-- ---------------------------------------------------------------- insights
CREATE TABLE public.ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL REFERENCES public.ai_analysis_runs(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  category public.ai_insight_category NOT NULL,
  severity public.ai_insight_severity NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  confidence numeric(3,2) NOT NULL DEFAULT 0.50,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.ai_insight_status NOT NULL DEFAULT 'active',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT ai_insight_title_ck CHECK (length(title) BETWEEN 3 AND 200),
  CONSTRAINT ai_insight_summary_ck CHECK (length(summary) BETWEEN 3 AND 2000),
  CONSTRAINT ai_insight_conf_ck CHECK (confidence >= 0 AND confidence <= 1)
);
CREATE INDEX ai_insights_status_idx ON public.ai_insights (status, severity, created_at DESC);
CREATE INDEX ai_insights_entity_idx ON public.ai_insights (entity_type, entity_id, created_at DESC);
CREATE INDEX ai_insights_run_idx ON public.ai_insights (analysis_run_id);

-- ---------------------------------------------------------------- recommendations
CREATE TABLE public.ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL REFERENCES public.ai_analysis_runs(id) ON DELETE CASCADE,
  insight_id uuid REFERENCES public.ai_insights(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  recommendation_type text NOT NULL,
  priority public.ai_recommendation_priority NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL,
  suggested_action text,
  action_target text,
  confidence numeric(3,2) NOT NULL DEFAULT 0.50,
  status public.ai_recommendation_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_rec_title_ck CHECK (length(title) BETWEEN 3 AND 200),
  CONSTRAINT ai_rec_desc_ck CHECK (length(description) BETWEEN 3 AND 2000),
  CONSTRAINT ai_rec_conf_ck CHECK (confidence >= 0 AND confidence <= 1)
);
CREATE INDEX ai_recs_status_idx ON public.ai_recommendations (status, priority, created_at DESC);
CREATE INDEX ai_recs_entity_idx ON public.ai_recommendations (entity_type, entity_id, created_at DESC);
CREATE INDEX ai_recs_run_idx ON public.ai_recommendations (analysis_run_id);

-- ---------------------------------------------------------------- append-only activity
CREATE TABLE public.ai_brain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  run_id uuid REFERENCES public.ai_analysis_runs(id) ON DELETE CASCADE,
  insight_id uuid REFERENCES public.ai_insights(id) ON DELETE CASCADE,
  recommendation_id uuid REFERENCES public.ai_recommendations(id) ON DELETE CASCADE,
  actor_id uuid,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_event_msg_ck CHECK (length(message) <= 500)
);
CREATE INDEX ai_brain_events_created_idx ON public.ai_brain_events (created_at DESC);

-- ---------------------------------------------------------------- grants / RLS
GRANT SELECT ON public.ai_analysis_runs, public.ai_insights, public.ai_recommendations, public.ai_brain_events TO authenticated;
GRANT ALL ON public.ai_analysis_runs, public.ai_insights, public.ai_recommendations, public.ai_brain_events TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.ai_analysis_runs, public.ai_insights, public.ai_recommendations, public.ai_brain_events FROM authenticated, anon, public;
REVOKE SELECT ON public.ai_analysis_runs, public.ai_insights, public.ai_recommendations, public.ai_brain_events FROM anon, public;

ALTER TABLE public.ai_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_brain_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_runs_read ON public.ai_analysis_runs FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY ai_insights_read ON public.ai_insights FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY ai_recs_read ON public.ai_recommendations FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY ai_events_read ON public.ai_brain_events FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

-- ---------------------------------------------------------------- immutability
CREATE OR REPLACE FUNCTION public.ai_protect_insight_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI insight content is immutable; only the review status may change';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ai_insights_immutable BEFORE UPDATE ON public.ai_insights
  FOR EACH ROW EXECUTE FUNCTION public.ai_protect_insight_content();

CREATE OR REPLACE FUNCTION public.ai_protect_recommendation_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
     OR NEW.insight_id IS DISTINCT FROM OLD.insight_id
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.recommendation_type IS DISTINCT FROM OLD.recommendation_type
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.suggested_action IS DISTINCT FROM OLD.suggested_action
     OR NEW.action_target IS DISTINCT FROM OLD.action_target
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI recommendation content is immutable; only the review status may change';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ai_recs_immutable BEFORE UPDATE ON public.ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.ai_protect_recommendation_content();

CREATE OR REPLACE FUNCTION public.ai_block_history_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'AI Brain history is append-only';
END; $$;
CREATE TRIGGER ai_events_append_only BEFORE UPDATE OR DELETE ON public.ai_brain_events
  FOR EACH ROW EXECUTE FUNCTION public.ai_block_history_change();
CREATE TRIGGER ai_insights_no_delete BEFORE DELETE ON public.ai_insights
  FOR EACH ROW EXECUTE FUNCTION public.ai_block_history_change();
CREATE TRIGGER ai_recs_no_delete BEFORE DELETE ON public.ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.ai_block_history_change();

-- ---------------------------------------------------------------- controlled operations
CREATE OR REPLACE FUNCTION public.ai_start_analysis_run(
  _analysis_type public.ai_analysis_type,
  _entity_type text,
  _entity_id uuid DEFAULT NULL,
  _provider text DEFAULT NULL,
  _model text DEFAULT NULL,
  _source text DEFAULT 'ai_provider',
  _context_summary jsonb DEFAULT '{}'::jsonb)
RETURNS public.ai_analysis_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.ai_analysis_runs;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to request an AI analysis';
  END IF;
  IF _entity_type IS NULL OR _entity_type = '' THEN
    RAISE EXCEPTION 'An analysis target is required';
  END IF;
  IF _source NOT IN ('ai_provider','system') THEN
    RAISE EXCEPTION 'Unsupported analysis source';
  END IF;
  IF _entity_id IS NOT NULL THEN
    IF _entity_type = 'order' AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = _entity_id) THEN
      RAISE EXCEPTION 'Order not found';
    ELSIF _entity_type = 'customer' AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _entity_id) THEN
      RAISE EXCEPTION 'Customer not found';
    ELSIF _entity_type = 'product' AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = _entity_id) THEN
      RAISE EXCEPTION 'Product not found';
    END IF;
  END IF;

  INSERT INTO public.ai_analysis_runs (analysis_type, entity_type, entity_id, status, provider, model,
                                       source, requested_by, started_at, context_summary)
  VALUES (_analysis_type, _entity_type, _entity_id, 'running', _provider, _model,
          _source, auth.uid(), now(), coalesce(_context_summary, '{}'::jsonb))
  RETURNING * INTO r;

  INSERT INTO public.ai_brain_events (event_type, run_id, actor_id, message)
  VALUES ('analysis_requested', r.id, auth.uid(),
          format('%s analysis requested for %s', _analysis_type, _entity_type));
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.ai_fail_analysis_run(_run_id uuid, _error text)
RETURNS public.ai_analysis_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.ai_analysis_runs;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to update an AI analysis';
  END IF;
  UPDATE public.ai_analysis_runs
     SET status = 'failed', completed_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - coalesce(started_at, created_at))) * 1000)::int),
         error_message = left(coalesce(_error, 'Analysis failed'), 500)
   WHERE id = _run_id AND status IN ('queued','running')
   RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Analysis run is not open'; END IF;
  INSERT INTO public.ai_brain_events (event_type, run_id, actor_id, message)
  VALUES ('analysis_failed', r.id, auth.uid(), left(coalesce(_error, 'Analysis failed'), 500));
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.ai_complete_analysis_run(_run_id uuid, _payload jsonb)
RETURNS public.ai_analysis_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.ai_analysis_runs;
  item jsonb; ins_id uuid; n_ins int := 0; n_rec int := 0;
  key_map jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to update an AI analysis';
  END IF;
  SELECT * INTO r FROM public.ai_analysis_runs WHERE id = _run_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Analysis run not found'; END IF;
  IF r.status NOT IN ('queued','running') THEN RAISE EXCEPTION 'Analysis run is already closed'; END IF;
  IF jsonb_typeof(coalesce(_payload->'insights', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(_payload->'recommendations', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Malformed analysis payload';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'insights', '[]'::jsonb)) LOOP
    INSERT INTO public.ai_insights (analysis_run_id, entity_type, entity_id, category, severity,
                                    title, summary, confidence, evidence, expires_at)
    VALUES (r.id,
            coalesce(nullif(item->>'entity_type',''), r.entity_type),
            nullif(item->>'entity_id','')::uuid,
            (item->>'category')::public.ai_insight_category,
            (item->>'severity')::public.ai_insight_severity,
            item->>'title', item->>'summary',
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
            item->>'title', item->>'description',
            nullif(item->>'suggested_action',''), nullif(item->>'action_target',''),
            LEAST(1, GREATEST(0, coalesce((item->>'confidence')::numeric, 0.5))));
    n_rec := n_rec + 1;
  END LOOP;

  UPDATE public.ai_analysis_runs
     SET status = 'completed', completed_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - coalesce(started_at, created_at))) * 1000)::int),
         insight_count = n_ins, recommendation_count = n_rec,
         summary = left(nullif(_payload->>'summary',''), 2000)
   WHERE id = r.id RETURNING * INTO r;

  INSERT INTO public.ai_brain_events (event_type, run_id, actor_id, message)
  VALUES ('analysis_completed', r.id, auth.uid(),
          format('Analysis completed with %s insights and %s recommendations', n_ins, n_rec));
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.ai_set_insight_status(_insight_id uuid, _status public.ai_insight_status)
RETURNS public.ai_insights LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i public.ai_insights;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to review AI insights';
  END IF;
  IF _status NOT IN ('acknowledged','dismissed','expired') THEN
    RAISE EXCEPTION 'Unsupported insight status';
  END IF;
  UPDATE public.ai_insights
     SET status = _status, reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _insight_id AND status = 'active'
   RETURNING * INTO i;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Insight is not active'; END IF;
  INSERT INTO public.ai_brain_events (event_type, insight_id, run_id, actor_id, message)
  VALUES ('insight_' || _status::text, i.id, i.analysis_run_id, auth.uid(), left(i.title, 200));
  RETURN i;
END; $$;

CREATE OR REPLACE FUNCTION public.ai_set_recommendation_status(
  _recommendation_id uuid, _status public.ai_recommendation_status)
RETURNS public.ai_recommendations LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE rec public.ai_recommendations;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to review AI recommendations';
  END IF;
  IF _status NOT IN ('accepted','dismissed','executed','expired') THEN
    RAISE EXCEPTION 'Unsupported recommendation status';
  END IF;
  UPDATE public.ai_recommendations
     SET status = _status, reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _recommendation_id
     AND (status = 'pending' OR (status = 'accepted' AND _status = 'executed'))
   RETURNING * INTO rec;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'Recommendation cannot move to that state'; END IF;
  INSERT INTO public.ai_brain_events (event_type, recommendation_id, run_id, actor_id, message)
  VALUES ('recommendation_' || _status::text, rec.id, rec.analysis_run_id, auth.uid(), left(rec.title, 200));
  RETURN rec;
END; $$;

CREATE OR REPLACE FUNCTION public.ai_brain_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'active_insights', (SELECT count(*) FROM public.ai_insights WHERE status = 'active'),
    'critical_insights', (SELECT count(*) FROM public.ai_insights WHERE status = 'active' AND severity IN ('critical','high')),
    'pending_recommendations', (SELECT count(*) FROM public.ai_recommendations WHERE status = 'pending'),
    'runs_last_7_days', (SELECT count(*) FROM public.ai_analysis_runs WHERE created_at > now() - interval '7 days'),
    'failed_runs_last_7_days', (SELECT count(*) FROM public.ai_analysis_runs WHERE status = 'failed' AND created_at > now() - interval '7 days'),
    'last_completed_at', (SELECT max(completed_at) FROM public.ai_analysis_runs WHERE status = 'completed')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.ai_start_analysis_run(public.ai_analysis_type, text, uuid, text, text, text, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ai_fail_analysis_run(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ai_complete_analysis_run(uuid, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ai_set_insight_status(uuid, public.ai_insight_status) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ai_set_recommendation_status(uuid, public.ai_recommendation_status) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ai_brain_overview() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ai_brain_overview() TO authenticated;