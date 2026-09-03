-- 1. Booking integrity columns on the existing shipment aggregate
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS booking_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS booking_attempt_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_last_error text,
  ADD COLUMN IF NOT EXISTS booking_outcome_unknown boolean NOT NULL DEFAULT false;

-- 2. One idempotency key can never belong to two shipments
CREATE UNIQUE INDEX IF NOT EXISTS shipments_booking_idempotency_uniq
  ON public.shipments (booking_idempotency_key)
  WHERE booking_idempotency_key IS NOT NULL;

-- 3. Controlled booking entry point: lock, validate, stamp the attempt
CREATE OR REPLACE FUNCTION public.book_shipment_begin(
  _shipment_id uuid,
  _stale_after_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s public.shipments;
  _p public.courier_providers;
  _a public.courier_accounts;
  _order public.orders;
  _from public.shipment_status;
  _stale interval := make_interval(secs => greatest(coalesce(_stale_after_seconds, 300), 30));
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to book shipments with a courier';
  END IF;

  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  -- already booked: never call the provider again
  IF _s.external_consignment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'already_booked',
      'shipment_id', _s.id,
      'status', _s.status,
      'consignment_id', _s.external_consignment_id,
      'idempotency_key', _s.booking_idempotency_key);
  END IF;

  IF _s.status = 'cancelled' THEN
    RAISE EXCEPTION 'This shipment is cancelled and cannot be booked';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _s.order_id;
  IF _order.status = 'cancelled' THEN
    RAISE EXCEPTION 'The order is cancelled. This shipment cannot be booked.';
  END IF;

  IF _s.booking_outcome_unknown THEN
    RETURN jsonb_build_object(
      'outcome', 'recovery_required',
      'shipment_id', _s.id,
      'status', _s.status,
      'idempotency_key', _s.booking_idempotency_key,
      'message', coalesce(_s.booking_last_error,
        'The result of the previous booking attempt is unknown.'));
  END IF;

  IF _s.status NOT IN ('ready_for_booking', 'booking_failed', 'booking_requested') THEN
    RAISE EXCEPTION 'A shipment in state "%" cannot be booked', _s.status;
  END IF;

  -- another attempt is legitimately running
  IF _s.status = 'booking_requested'
     AND _s.booking_attempt_started_at IS NOT NULL
     AND now() - _s.booking_attempt_started_at < _stale THEN
    RETURN jsonb_build_object(
      'outcome', 'in_progress',
      'shipment_id', _s.id,
      'status', _s.status,
      'idempotency_key', _s.booking_idempotency_key,
      'started_at', _s.booking_attempt_started_at);
  END IF;

  IF _s.provider_id IS NULL OR _s.courier_account_id IS NULL THEN
    RAISE EXCEPTION 'Assign a courier provider and account before booking';
  END IF;
  SELECT * INTO _p FROM public.courier_providers WHERE id = _s.provider_id;
  IF _p.id IS NULL OR _p.status <> 'active' THEN
    RAISE EXCEPTION 'Courier provider is missing or not active';
  END IF;
  SELECT * INTO _a FROM public.courier_accounts WHERE id = _s.courier_account_id;
  IF _a.id IS NULL OR _a.status <> 'active' OR _a.provider_id <> _p.id THEN
    RAISE EXCEPTION 'Courier account is missing, inactive, or belongs to another provider';
  END IF;

  _from := _s.status;
  IF _from <> 'booking_requested'
     AND NOT public.shipment_transition_valid(_from, 'booking_requested') THEN
    RAISE EXCEPTION 'Transition from % to booking_requested is not allowed', _from;
  END IF;

  -- the key is stable across retries of the same logical booking
  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    status = 'booking_requested',
    booking_idempotency_key = coalesce(booking_idempotency_key, gen_random_uuid()::text),
    booking_attempt_started_at = now(),
    booking_attempt_count = booking_attempt_count + 1,
    booking_last_error = NULL,
    updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'booking_requested', _from, _s.status,
    'Courier booking attempt #' || _s.booking_attempt_count || ' started.',
    jsonb_build_object('idempotency_key', _s.booking_idempotency_key,
                       'attempt', _s.booking_attempt_count,
                       'provider_id', _p.id, 'account_id', _a.id));

  RETURN jsonb_build_object(
    'outcome', 'proceed',
    'shipment_id', _s.id,
    'status', _s.status,
    'idempotency_key', _s.booking_idempotency_key,
    'attempt', _s.booking_attempt_count,
    'provider_code', _p.code,
    'account_id', _a.id);
END; $function$;

-- 4. Booking confirmation gains an immutable non-secret snapshot + key assertion
CREATE OR REPLACE FUNCTION public.record_courier_booking(
  _shipment_id uuid,
  _consignment_id text,
  _provider_status text DEFAULT NULL::text,
  _delivery_fee numeric DEFAULT NULL::numeric,
  _tracking_number text DEFAULT NULL::text,
  _idempotency_key text DEFAULT NULL::text,
  _booking_snapshot jsonb DEFAULT NULL::jsonb
)
RETURNS shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s public.shipments;
  _from public.shipment_status;
  _cid text := nullif(btrim(coalesce(_consignment_id,'')),'');
  _snap jsonb;
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'A courier consignment identifier is required'; END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  IF _idempotency_key IS NOT NULL AND _s.booking_idempotency_key IS DISTINCT FROM _idempotency_key THEN
    RAISE EXCEPTION 'This booking result belongs to a different booking attempt';
  END IF;

  -- idempotent: the same consignment recorded twice changes nothing
  IF _s.external_consignment_id IS NOT NULL THEN
    IF _s.external_consignment_id = _cid THEN RETURN _s; END IF;
    RAISE EXCEPTION 'This shipment is already booked with consignment %', _s.external_consignment_id;
  END IF;

  -- never persist secrets in the snapshot
  _snap := coalesce(_booking_snapshot, '{}'::jsonb)
           - 'client_secret' - 'password' - 'access_token' - 'refresh_token'
           - 'api_key' - 'secret' - 'webhook_secret' - 'token';
  _snap := _snap || jsonb_build_object('booked_at', now(),
                                       'idempotency_key', _s.booking_idempotency_key,
                                       'attempt', _s.booking_attempt_count);

  _from := _s.status;
  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    external_consignment_id = _cid,
    tracking_number = coalesce(nullif(btrim(coalesce(_tracking_number,'')),''), _cid),
    provider_status = coalesce(_provider_status, provider_status),
    provider_status_slug = coalesce(_provider_status, provider_status_slug),
    provider_status_at = now(),
    booked_delivery_fee = coalesce(_delivery_fee, booked_delivery_fee),
    status = CASE WHEN public.shipment_transition_valid(_from, 'booked') THEN 'booked' ELSE status END,
    booked_at = coalesce(booked_at, now()),
    last_synced_at = now(),
    booking_snapshot = coalesce(booking_snapshot, _snap),
    booking_attempt_started_at = NULL,
    booking_outcome_unknown = false,
    booking_last_error = NULL
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'booking_confirmed', _from, _s.status,
    'Courier booking confirmed — consignment ' || _cid
      || coalesce(', delivery fee ' || _delivery_fee::text, '') || '.',
    jsonb_build_object('consignment_id', _cid, 'delivery_fee', _delivery_fee,
                       'idempotency_key', _s.booking_idempotency_key));

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_s.order_id, 'Shipment ' || _s.shipment_number || ' booked with the courier (consignment ' || _cid || ').',
          'system', true, auth.uid());
  RETURN _s;
END; $function$;

-- 5. Controlled failure / unknown-outcome recording
CREATE OR REPLACE FUNCTION public.record_courier_booking_failure(
  _shipment_id uuid,
  _message text,
  _outcome_unknown boolean DEFAULT false,
  _idempotency_key text DEFAULT NULL::text
)
RETURNS shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _s public.shipments; _from public.shipment_status;
        _clean text := left(nullif(btrim(coalesce(_message,'')),''), 500);
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change shipment state';
  END IF;
  IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required when a booking attempt fails'; END IF;

  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF _idempotency_key IS NOT NULL AND _s.booking_idempotency_key IS DISTINCT FROM _idempotency_key THEN
    RAISE EXCEPTION 'This booking result belongs to a different booking attempt';
  END IF;
  IF _s.external_consignment_id IS NOT NULL THEN RETURN _s; END IF;

  _from := _s.status;
  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    -- an unknown outcome must NOT look retryable: it stays in booking_requested
    status = CASE
               WHEN _outcome_unknown THEN status
               WHEN public.shipment_transition_valid(_from, 'booking_failed') THEN 'booking_failed'
               ELSE status END,
    booking_outcome_unknown = _outcome_unknown,
    booking_attempt_started_at = CASE WHEN _outcome_unknown THEN booking_attempt_started_at ELSE NULL END,
    booking_last_error = _clean,
    updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id,
    CASE WHEN _outcome_unknown THEN 'status_updated' ELSE 'booking_failed' END::public.shipment_event_type,
    _from, _s.status,
    CASE WHEN _outcome_unknown
      THEN 'Courier booking outcome is UNKNOWN — ' || _clean || ' Operator recovery is required before any retry.'
      ELSE 'Courier booking failed — ' || _clean END,
    jsonb_build_object('idempotency_key', _s.booking_idempotency_key,
                       'attempt', _s.booking_attempt_count,
                       'outcome_unknown', _outcome_unknown));
  RETURN _s;
END; $function$;

-- 6. Operator recovery for an unknown booking outcome
CREATE OR REPLACE FUNCTION public.resolve_unknown_courier_booking(
  _shipment_id uuid,
  _resolution text,
  _consignment_id text DEFAULT NULL::text,
  _reason text DEFAULT NULL::text
)
RETURNS shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _s public.shipments; _from public.shipment_status;
        _clean text := nullif(btrim(coalesce(_reason,'')),'');
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to resolve courier bookings';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF NOT _s.booking_outcome_unknown THEN
    RAISE EXCEPTION 'This shipment has no unresolved booking outcome';
  END IF;

  IF _resolution = 'confirm' THEN
    IF nullif(btrim(coalesce(_consignment_id,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Enter the consignment number the courier created';
    END IF;
    PERFORM set_config('app.shipment_write', 'on', true);
    UPDATE public.shipments SET booking_outcome_unknown = false WHERE id = _s.id;
    PERFORM set_config('app.shipment_write', 'off', true);
    RETURN public.record_courier_booking(_s.id, _consignment_id, NULL, NULL, NULL,
                                         _s.booking_idempotency_key,
                                         jsonb_build_object('recovered_manually', true));
  ELSIF _resolution = 'abandon' THEN
    IF _clean IS NULL THEN
      RAISE EXCEPTION 'Confirm with the courier that no parcel exists and record that as the reason';
    END IF;
    _from := _s.status;
    -- explicit abandonment is the ONLY place the idempotency key rotates
    PERFORM set_config('app.shipment_write', 'on', true);
    UPDATE public.shipments SET
      booking_outcome_unknown = false,
      booking_attempt_started_at = NULL,
      booking_last_error = 'Abandoned — ' || _clean,
      booking_idempotency_key = gen_random_uuid()::text,
      status = CASE WHEN public.shipment_transition_valid(_from,'booking_failed') THEN 'booking_failed' ELSE status END,
      updated_by = auth.uid()
     WHERE id = _s.id RETURNING * INTO _s;
    PERFORM set_config('app.shipment_write', 'off', true);

    PERFORM public.log_shipment_event(_s.id, _s.order_id, 'booking_failed', _from, _s.status,
      'Unknown booking attempt abandoned after courier confirmation — ' || _clean
        || ' A new booking reference was issued.',
      jsonb_build_object('idempotency_key', _s.booking_idempotency_key));
    RETURN _s;
  END IF;
  RAISE EXCEPTION 'Unknown resolution: %', _resolution;
END; $function$;

-- 7. Least privilege
REVOKE ALL ON public.shipment_items FROM anon;
REVOKE ALL ON public.shipment_events FROM anon;
REVOKE ALL ON public.shipment_exceptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_exceptions TO authenticated;
GRANT ALL ON public.shipment_items TO service_role;
GRANT ALL ON public.shipment_events TO service_role;
GRANT ALL ON public.shipment_exceptions TO service_role;

REVOKE ALL ON FUNCTION public.book_shipment_begin(uuid, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.record_courier_booking(uuid, text, text, numeric, text, text, jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.record_courier_booking_failure(uuid, text, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.resolve_unknown_courier_booking(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.book_shipment_begin(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_courier_booking(uuid, text, text, numeric, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_courier_booking_failure(uuid, text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_unknown_courier_booking(uuid, text, text, text) TO authenticated, service_role;