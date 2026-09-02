-- ============ 1. Enums ============
CREATE TYPE public.order_verification_status_new AS ENUM (
  'not_required','pending','in_progress','manual_review','rescheduled',
  'confirmed','unreachable','failed','cancelled'
);

ALTER TABLE public.orders
  ALTER COLUMN verification_status DROP DEFAULT,
  ALTER COLUMN verification_status TYPE public.order_verification_status_new
    USING verification_status::text::public.order_verification_status_new,
  ALTER COLUMN verification_status SET DEFAULT 'pending'::public.order_verification_status_new;

DROP TYPE public.order_verification_status;
ALTER TYPE public.order_verification_status_new RENAME TO order_verification_status;

CREATE TYPE public.verification_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE public.verification_risk_level AS ENUM ('none','low','medium','high');
CREATE TYPE public.verification_method AS ENUM ('ai_voice','manual_call','sms','whatsapp','other');
CREATE TYPE public.verification_attempt_status AS ENUM ('pending','in_progress','completed','cancelled');
CREATE TYPE public.verification_attempt_outcome AS ENUM (
  'pending','answered','confirmed','rejected','no_answer','busy',
  'invalid_number','callback_requested','risk_flagged','failed'
);
CREATE TYPE public.verification_event_type AS ENUM (
  'verification_started','attempt_created','attempt_completed','callback_scheduled',
  'moved_to_manual_review','risk_flagged','verification_confirmed','verification_failed',
  'verification_unreachable','verification_cancelled','priority_changed'
);

-- ============ 2. Order columns ============
ALTER TABLE public.orders
  ADD COLUMN verification_priority public.verification_priority NOT NULL DEFAULT 'normal',
  ADD COLUMN risk_level public.verification_risk_level NOT NULL DEFAULT 'none',
  ADD COLUMN risk_reason text,
  ADD COLUMN verification_failure_reason text,
  ADD COLUMN verification_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN verification_last_attempt_at timestamptz,
  ADD COLUMN verification_next_action_at timestamptz,
  ADD COLUMN verification_confirmed_at timestamptz;

CREATE INDEX orders_verification_status_idx ON public.orders (verification_status);
CREATE INDEX orders_verification_next_action_idx ON public.orders (verification_next_action_at);

-- ============ 3. Attempts ============
CREATE TABLE public.order_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  method public.verification_method NOT NULL,
  provider text,
  status public.verification_attempt_status NOT NULL DEFAULT 'pending',
  outcome public.verification_attempt_outcome NOT NULL DEFAULT 'pending',
  notes text,
  failure_reason text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  external_call_id text,
  transcript_reference text,
  recording_reference text,
  ai_result jsonb,
  initiated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_verification_attempts_unique_number UNIQUE (order_id, attempt_number),
  CONSTRAINT order_verification_attempts_duration_positive
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);
CREATE INDEX order_verification_attempts_order_idx
  ON public.order_verification_attempts (order_id, attempt_number DESC);

GRANT SELECT ON public.order_verification_attempts TO authenticated;
GRANT ALL ON public.order_verification_attempts TO service_role;
ALTER TABLE public.order_verification_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers can view verification attempts"
  ON public.order_verification_attempts FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

-- ============ 4. Events ============
CREATE TABLE public.order_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.order_verification_attempts(id) ON DELETE SET NULL,
  event_type public.verification_event_type NOT NULL,
  from_status public.order_verification_status,
  to_status public.order_verification_status,
  message text NOT NULL,
  metadata jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_verification_events_order_idx
  ON public.order_verification_events (order_id, created_at);

GRANT SELECT ON public.order_verification_events TO authenticated;
GRANT ALL ON public.order_verification_events TO service_role;
ALTER TABLE public.order_verification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers can view verification events"
  ON public.order_verification_events FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

-- ============ 5. Append-only guards ============
CREATE OR REPLACE FUNCTION public.guard_verification_attempts()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.verification_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Verification attempts can only be written through the verification workflow functions';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RAISE EXCEPTION 'A completed verification attempt is a historical record and cannot be rewritten';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER order_verification_attempts_guard
  BEFORE INSERT OR UPDATE ON public.order_verification_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_verification_attempts();

CREATE OR REPLACE FUNCTION public.guard_verification_events()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Verification events are append-only';
  END IF;
  IF coalesce(current_setting('app.verification_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Verification events can only be written through the verification workflow functions';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER order_verification_events_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_verification_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_verification_events();

CREATE OR REPLACE FUNCTION public.guard_order_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.verification_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.verification_priority IS DISTINCT FROM OLD.verification_priority
     OR NEW.risk_level IS DISTINCT FROM OLD.risk_level
     OR NEW.risk_reason IS DISTINCT FROM OLD.risk_reason
     OR NEW.verification_failure_reason IS DISTINCT FROM OLD.verification_failure_reason
     OR NEW.verification_attempt_count IS DISTINCT FROM OLD.verification_attempt_count
     OR NEW.verification_last_attempt_at IS DISTINCT FROM OLD.verification_last_attempt_at
     OR NEW.verification_next_action_at IS DISTINCT FROM OLD.verification_next_action_at
     OR NEW.verification_confirmed_at IS DISTINCT FROM OLD.verification_confirmed_at THEN
    RAISE EXCEPTION 'Verification fields cannot be updated directly. Use the verification workflow functions.';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER orders_guard_verification
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_verification();

-- ============ 6. Config + transition rules ============
CREATE OR REPLACE FUNCTION public.verification_max_attempts()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT 3 $$;

CREATE OR REPLACE FUNCTION public.verification_transition_allowed(
  _from public.order_verification_status, _to public.order_verification_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _from = _to THEN true
    WHEN _to = 'cancelled' THEN _from IN ('not_required','pending','in_progress','manual_review','rescheduled','unreachable')
    WHEN _from = 'not_required' THEN _to IN ('pending')
    WHEN _from = 'pending' THEN _to IN ('in_progress','manual_review','unreachable','confirmed','failed','rescheduled')
    WHEN _from = 'in_progress' THEN _to IN ('confirmed','rescheduled','manual_review','pending','unreachable','failed')
    WHEN _from = 'rescheduled' THEN _to IN ('pending','in_progress','manual_review')
    WHEN _from = 'manual_review' THEN _to IN ('pending','in_progress','confirmed','failed','unreachable')
    WHEN _from = 'unreachable' THEN _to IN ('manual_review','failed','pending')
    ELSE false
  END;
$$;

-- ============ 7. Internal transition helper ============
CREATE OR REPLACE FUNCTION public.apply_verification_transition(
  _order_id uuid,
  _to public.order_verification_status,
  _event public.verification_event_type,
  _message text,
  _attempt_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT NULL,
  _scheduled_at timestamptz DEFAULT NULL,
  _risk_level public.verification_risk_level DEFAULT NULL,
  _risk_reason text DEFAULT NULL,
  _failure_reason text DEFAULT NULL,
  _touch_attempt boolean DEFAULT false
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _order public.orders; _from public.order_verification_status;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  _from := _order.verification_status;

  IF _order.status = 'cancelled' AND _to <> 'cancelled' THEN
    RAISE EXCEPTION 'This order is cancelled — verification can no longer be changed';
  END IF;
  IF NOT public.verification_transition_allowed(_from, _to) THEN
    RAISE EXCEPTION 'Verification cannot move from % to %', _from, _to;
  END IF;

  PERFORM set_config('app.verification_write', 'on', true);
  UPDATE public.orders
     SET verification_status = _to,
         risk_level = coalesce(_risk_level, risk_level),
         risk_reason = CASE WHEN _risk_reason IS NULL THEN risk_reason ELSE _risk_reason END,
         verification_failure_reason = CASE WHEN _to = 'failed' THEN _failure_reason ELSE verification_failure_reason END,
         verification_confirmed_at = CASE WHEN _to = 'confirmed' THEN now() ELSE verification_confirmed_at END,
         verification_next_action_at = CASE
           WHEN _to IN ('confirmed','failed','cancelled','unreachable') THEN NULL
           WHEN _scheduled_at IS NOT NULL THEN _scheduled_at
           ELSE verification_next_action_at END,
         verification_last_attempt_at = CASE WHEN _touch_attempt THEN now() ELSE verification_last_attempt_at END,
         verification_attempt_count = (
           SELECT count(*) FROM public.order_verification_attempts a WHERE a.order_id = _order_id
         ),
         updated_by = coalesce(auth.uid(), updated_by)
   WHERE id = _order_id
   RETURNING * INTO _order;

  INSERT INTO public.order_verification_events
    (order_id, attempt_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_order_id, _attempt_id, _event, _from, _to, _message, _metadata, auth.uid());
  PERFORM set_config('app.verification_write', 'off', true);

  RETURN _order;
END; $$;

REVOKE ALL ON FUNCTION public.apply_verification_transition(uuid, public.order_verification_status, public.verification_event_type, text, uuid, jsonb, timestamptz, public.verification_risk_level, text, text, boolean) FROM public, anon, authenticated;

-- ============ 8. Public workflow RPCs ============
CREATE OR REPLACE FUNCTION public.start_order_verification(_order_id uuid, _method public.verification_method DEFAULT 'manual_call')
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage verification';
  END IF;
  RETURN public.apply_verification_transition(
    _order_id, 'in_progress', 'verification_started',
    'Verification started (' || _method || ').', NULL,
    jsonb_build_object('method', _method));
END; $$;

CREATE OR REPLACE FUNCTION public.record_verification_attempt(
  _order_id uuid,
  _method public.verification_method,
  _outcome public.verification_attempt_outcome,
  _notes text DEFAULT NULL,
  _duration_seconds integer DEFAULT NULL,
  _scheduled_at timestamptz DEFAULT NULL,
  _risk_reason text DEFAULT NULL,
  _failure_reason text DEFAULT NULL,
  _provider text DEFAULT NULL
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _order public.orders; _attempt public.order_verification_attempts;
  _number int; _next public.order_verification_status;
  _event public.verification_event_type; _msg text;
  _risk public.verification_risk_level := NULL;
  _max int := public.verification_max_attempts();
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record verification attempts';
  END IF;
  IF _outcome IN ('pending') THEN RAISE EXCEPTION 'Record a real attempt outcome'; END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'This order is cancelled'; END IF;
  IF _order.verification_status IN ('confirmed','failed','cancelled') THEN
    RAISE EXCEPTION 'Verification is already closed for this order';
  END IF;

  IF _outcome = 'callback_requested' AND _scheduled_at IS NULL THEN
    RAISE EXCEPTION 'A callback needs a scheduled time';
  END IF;
  IF _outcome = 'callback_requested' AND _scheduled_at <= now() THEN
    RAISE EXCEPTION 'The callback time must be in the future';
  END IF;
  IF _outcome = 'risk_flagged' AND nullif(btrim(coalesce(_risk_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A risk reason is required';
  END IF;
  IF _outcome = 'rejected' AND nullif(btrim(coalesce(_failure_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when the customer rejects the order';
  END IF;

  SELECT coalesce(max(attempt_number), 0) + 1 INTO _number
    FROM public.order_verification_attempts WHERE order_id = _order_id;

  PERFORM set_config('app.verification_write', 'on', true);
  INSERT INTO public.order_verification_attempts (
    order_id, attempt_number, method, provider, status, outcome, notes,
    failure_reason, scheduled_at, started_at, completed_at, duration_seconds, initiated_by
  ) VALUES (
    _order_id, _number, _method, nullif(btrim(coalesce(_provider,'')),''), 'completed', _outcome,
    nullif(btrim(coalesce(_notes,'')),''),
    coalesce(nullif(btrim(coalesce(_failure_reason,'')),''), nullif(btrim(coalesce(_risk_reason,'')),'')),
    _scheduled_at, now(), now(), _duration_seconds, auth.uid()
  ) RETURNING * INTO _attempt;

  INSERT INTO public.order_verification_events
    (order_id, attempt_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_order_id, _attempt.id, 'attempt_completed',
          _order.verification_status, _order.verification_status,
          'Attempt ' || _number || ' (' || _method || ') — ' || _outcome || '.',
          jsonb_build_object('outcome', _outcome, 'method', _method, 'attempt_number', _number),
          auth.uid());
  PERFORM set_config('app.verification_write', 'off', true);

  CASE _outcome
    WHEN 'confirmed' THEN
      _next := 'confirmed'; _event := 'verification_confirmed';
      _msg := 'Customer confirmed the order on attempt ' || _number || '.';
    WHEN 'rejected' THEN
      _next := 'failed'; _event := 'verification_failed';
      _msg := 'Customer rejected the order — ' || _failure_reason;
    WHEN 'risk_flagged' THEN
      _next := 'manual_review'; _event := 'risk_flagged'; _risk := 'high';
      _msg := 'Risk flagged on attempt ' || _number || ' — ' || _risk_reason;
    WHEN 'callback_requested' THEN
      _next := 'rescheduled'; _event := 'callback_scheduled';
      _msg := 'Callback scheduled for ' || to_char(_scheduled_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY HH12:MI AM') || ' (Dhaka).';
    WHEN 'answered' THEN
      _next := 'in_progress'; _event := 'attempt_completed';
      _msg := 'Customer answered on attempt ' || _number || ' — awaiting a decision.';
    ELSE
      IF _number >= _max THEN
        _next := 'unreachable'; _event := 'verification_unreachable';
        _msg := 'Customer unreachable after ' || _number || ' attempts.';
      ELSE
        _next := 'pending'; _event := 'attempt_completed';
        _msg := 'Attempt ' || _number || ' unsuccessful (' || _outcome || ') — retry allowed (' || _number || '/' || _max || ').';
      END IF;
  END CASE;

  _order := public.apply_verification_transition(
    _order_id, _next, _event, _msg, _attempt.id,
    jsonb_build_object('outcome', _outcome, 'attempt_number', _number),
    CASE WHEN _outcome = 'callback_requested' THEN _scheduled_at ELSE NULL END,
    _risk,
    CASE WHEN _outcome = 'risk_flagged' THEN _risk_reason ELSE NULL END,
    CASE WHEN _outcome = 'rejected' THEN _failure_reason ELSE NULL END,
    true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Verification: ' || _msg, 'system', true, auth.uid());

  RETURN _order;
END; $$;

CREATE OR REPLACE FUNCTION public.set_order_verification_state(
  _order_id uuid,
  _action text,
  _reason text DEFAULT NULL,
  _scheduled_at timestamptz DEFAULT NULL,
  _risk_level public.verification_risk_level DEFAULT NULL
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _order public.orders; _next public.order_verification_status;
  _event public.verification_event_type; _msg text;
  _clean text := nullif(btrim(coalesce(_reason,'')), '');
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage verification';
  END IF;

  CASE _action
    WHEN 'confirm' THEN
      _next := 'confirmed'; _event := 'verification_confirmed';
      _msg := coalesce(_clean, 'Order confirmed by an operator.');
    WHEN 'manual_review' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required for manual review'; END IF;
      _next := 'manual_review'; _event := 'moved_to_manual_review';
      _msg := 'Moved to manual review — ' || _clean;
    WHEN 'schedule_callback' THEN
      IF _scheduled_at IS NULL OR _scheduled_at <= now() THEN
        RAISE EXCEPTION 'A future callback time is required';
      END IF;
      _next := 'rescheduled'; _event := 'callback_scheduled';
      _msg := 'Callback scheduled for ' || to_char(_scheduled_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY HH12:MI AM') || ' (Dhaka).';
    WHEN 'unreachable' THEN
      _next := 'unreachable'; _event := 'verification_unreachable';
      _msg := coalesce(_clean, 'Marked unreachable by an operator.');
    WHEN 'fail' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A failure reason is required'; END IF;
      _next := 'failed'; _event := 'verification_failed';
      _msg := 'Verification failed — ' || _clean;
    WHEN 'reopen' THEN
      _next := 'pending'; _event := 'verification_started';
      _msg := coalesce(_clean, 'Verification reopened for another attempt.');
    ELSE RAISE EXCEPTION 'Unknown verification action: %', _action;
  END CASE;

  _order := public.apply_verification_transition(
    _order_id, _next, _event, _msg, NULL,
    jsonb_build_object('action', _action),
    CASE WHEN _action = 'schedule_callback' THEN _scheduled_at ELSE NULL END,
    CASE WHEN _action = 'manual_review' THEN coalesce(_risk_level, 'medium') ELSE _risk_level END,
    CASE WHEN _action = 'manual_review' THEN _clean ELSE NULL END,
    CASE WHEN _action = 'fail' THEN _clean ELSE NULL END,
    false);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Verification: ' || _msg, 'system', true, auth.uid());

  RETURN _order;
END; $$;

CREATE OR REPLACE FUNCTION public.set_order_verification_priority(
  _order_id uuid, _priority public.verification_priority)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _order public.orders; _old public.verification_priority;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage verification';
  END IF;
  SELECT verification_priority INTO _old FROM public.orders WHERE id = _order_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  PERFORM set_config('app.verification_write', 'on', true);
  UPDATE public.orders SET verification_priority = _priority, updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  INSERT INTO public.order_verification_events
    (order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_order_id, 'priority_changed', _order.verification_status, _order.verification_status,
          'Priority changed from ' || _old || ' to ' || _priority || '.',
          jsonb_build_object('from', _old, 'to', _priority), auth.uid());
  PERFORM set_config('app.verification_write', 'off', true);
  RETURN _order;
END; $$;

-- ============ 9. Cancellation synchronisation ============
CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid, _reason text DEFAULT NULL::text)
 RETURNS public.orders
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _order public.orders; _from public.order_verification_status;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to cancel orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Order is already cancelled'; END IF;
  _from := _order.verification_status;

  PERFORM set_config('app.order_write', 'on', true);
  PERFORM set_config('app.verification_write', 'on', true);
  UPDATE public.orders
     SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid(),
         verification_status = CASE
           WHEN _from IN ('confirmed','failed','cancelled') THEN _from
           ELSE 'cancelled'::public.order_verification_status END,
         verification_next_action_at = NULL
   WHERE id = _order_id RETURNING * INTO _order;

  IF _from NOT IN ('confirmed','failed','cancelled') THEN
    INSERT INTO public.order_verification_events
      (order_id, event_type, from_status, to_status, message, created_by)
    VALUES (_order_id, 'verification_cancelled', _from, 'cancelled',
            'Verification cancelled because the order was cancelled. Scheduled actions are no longer active.',
            auth.uid());
  END IF;
  PERFORM set_config('app.verification_write', 'off', true);
  PERFORM set_config('app.order_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
    'Order cancelled' || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.',
    'system', true, auth.uid());

  RETURN _order;
END; $function$;

REVOKE ALL ON FUNCTION public.start_order_verification(uuid, public.verification_method) FROM public, anon;
REVOKE ALL ON FUNCTION public.record_verification_attempt(uuid, public.verification_method, public.verification_attempt_outcome, text, integer, timestamptz, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.set_order_verification_state(uuid, text, text, timestamptz, public.verification_risk_level) FROM public, anon;
REVOKE ALL ON FUNCTION public.set_order_verification_priority(uuid, public.verification_priority) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_order_verification(uuid, public.verification_method) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_verification_attempt(uuid, public.verification_method, public.verification_attempt_outcome, text, integer, timestamptz, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_verification_state(uuid, text, text, timestamptz, public.verification_risk_level) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_verification_priority(uuid, public.verification_priority) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verification_max_attempts() TO authenticated;