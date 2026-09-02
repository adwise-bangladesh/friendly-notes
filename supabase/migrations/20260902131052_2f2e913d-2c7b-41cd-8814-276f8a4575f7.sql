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
  IF _outcome = 'pending' THEN RAISE EXCEPTION 'Record a real attempt outcome'; END IF;

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
  PERFORM set_config('app.verification_write', 'off', true);

  CASE _outcome
    WHEN 'confirmed' THEN
      _next := 'confirmed'; _event := 'verification_confirmed';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — customer confirmed the order.';
    WHEN 'rejected' THEN
      _next := 'failed'; _event := 'verification_failed';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — customer rejected the order: ' || _failure_reason;
    WHEN 'risk_flagged' THEN
      _next := 'manual_review'; _event := 'risk_flagged'; _risk := 'high';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — risk flagged: ' || _risk_reason;
    WHEN 'callback_requested' THEN
      _next := 'rescheduled'; _event := 'callback_scheduled';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — callback scheduled for '
              || to_char(_scheduled_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY HH12:MI AM') || ' (Dhaka).';
    WHEN 'answered' THEN
      _next := 'in_progress'; _event := 'attempt_completed';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — customer answered, awaiting a decision.';
    ELSE
      IF _number >= _max THEN
        _next := 'unreachable'; _event := 'verification_unreachable';
        _msg := 'Attempt ' || _number || ' (' || _method || ') — ' || _outcome
                || '. Customer unreachable after ' || _number || ' attempts.';
      ELSE
        _next := 'pending'; _event := 'attempt_completed';
        _msg := 'Attempt ' || _number || ' (' || _method || ') — ' || _outcome
                || '. Retry allowed (' || _number || '/' || _max || ').';
      END IF;
  END CASE;

  _order := public.apply_verification_transition(
    _order_id, _next, _event, _msg, _attempt.id,
    jsonb_build_object('outcome', _outcome, 'method', _method, 'attempt_number', _number),
    CASE WHEN _outcome = 'callback_requested' THEN _scheduled_at ELSE NULL END,
    _risk,
    CASE WHEN _outcome = 'risk_flagged' THEN _risk_reason ELSE NULL END,
    CASE WHEN _outcome = 'rejected' THEN _failure_reason ELSE NULL END,
    true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Verification: ' || _msg, 'system', true, auth.uid());

  RETURN _order;
END; $$;