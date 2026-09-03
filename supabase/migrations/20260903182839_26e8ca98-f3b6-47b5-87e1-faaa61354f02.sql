-- Shared application routine: the single place where a stored courier event is
-- turned into shipment state. Webhook ingestion, retry and replay all call it.
CREATE OR REPLACE FUNCTION public.courier_apply_event(_event_id uuid)
RETURNS public.courier_provider_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.courier_provider_events;
  _p public.courier_providers;
  _s public.shipments;
  _map public.courier_status_map;
  _status public.courier_event_processing_status;
  _note text;
  _from public.shipment_status;
  _at timestamptz;
  _event public.shipment_event_type;
BEGIN
  SELECT * INTO _row FROM public.courier_provider_events WHERE id = _event_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Courier event not found';
  END IF;
  -- An applied event is never applied twice.
  IF _row.processing_status = 'applied' THEN
    RETURN _row;
  END IF;

  _at := coalesce(_row.provider_event_at, _row.received_at, now());
  SELECT * INTO _p FROM public.courier_providers WHERE id = _row.provider_id;

  IF _row.consignment_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments
     WHERE external_consignment_id = _row.consignment_id
       AND (_p.id IS NULL OR provider_id = _p.id)
     FOR UPDATE;
  END IF;
  IF _s.id IS NULL AND _row.merchant_order_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments WHERE shipment_number = _row.merchant_order_id FOR UPDATE;
  END IF;

  IF _p.id IS NULL THEN
    _status := 'rejected'; _note := 'Unknown courier provider code';
  ELSIF _s.id IS NULL THEN
    _status := 'unmatched'; _note := 'No shipment matches this consignment or merchant order id';
  ELSE
    SELECT * INTO _map FROM public.courier_status_map
     WHERE provider_id = _p.id AND provider_event = _row.provider_event;

    _from := _s.status;
    IF _s.provider_status_at IS NOT NULL AND _at < _s.provider_status_at THEN
      _status := 'stale';
      _note := 'Event is older than the last courier update already applied';
    ELSIF _map.id IS NULL THEN
      _status := 'recorded'; _note := 'No status mapping for this courier event';
    ELSIF _map.shipment_status IS NULL OR _map.shipment_status = _from THEN
      _status := 'recorded'; _note := 'Courier reported no internal state change';
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments
         SET provider_status = _row.provider_event, provider_status_slug = _row.provider_event,
             provider_status_at = _at, last_synced_at = now()
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);
      PERFORM public.apply_courier_operational_effects(
        _s.id, coalesce(_map.event_type,'provider_event'), _row.provider_event, _at, _row.payload);
    ELSIF NOT public.shipment_transition_valid(_from, _map.shipment_status) THEN
      _status := 'rejected';
      _note := 'Courier event maps to ' || _map.shipment_status::text
               || ' which is not a valid transition from ' || _from::text;
      PERFORM public.log_shipment_event(_s.id, _s.order_id, 'provider_event', _from, _from,
        'Courier reported "' || _row.provider_event || '" — not applied because ' || _note || '.',
        jsonb_build_object('provider_event', _row.provider_event, 'source', _row.source));
    ELSE
      _status := 'applied';
      _event := coalesce(_map.event_type, 'provider_event');
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments SET
        status = _map.shipment_status,
        provider_status = _row.provider_event,
        provider_status_slug = _row.provider_event,
        provider_status_at = _at,
        last_synced_at = now(),
        picked_up_at = CASE WHEN _map.shipment_status = 'picked_up' AND picked_up_at IS NULL THEN _at ELSE picked_up_at END,
        delivered_at = CASE WHEN _map.shipment_status IN ('delivered','partial_delivered') THEN _at ELSE delivered_at END,
        cancelled_at = CASE WHEN _map.shipment_status = 'cancelled' THEN _at ELSE cancelled_at END
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);

      PERFORM public.log_shipment_event(_s.id, _s.order_id, _event, _from, _map.shipment_status,
        'Courier reported "' || _row.provider_event || '".',
        jsonb_build_object('provider_event', _row.provider_event, 'source', _row.source,
                           'provider_event_at', _at));

      PERFORM public.apply_courier_operational_effects(_s.id, _event, _row.provider_event, _at, _row.payload);
    END IF;
  END IF;

  UPDATE public.courier_provider_events SET
    shipment_id = coalesce(_s.id, shipment_id),
    account_id = coalesce(_s.courier_account_id, account_id),
    processing_status = _status,
    processing_note = _note,
    last_attempt_at = now(),
    -- transient states stay retryable; everything else stops here
    next_retry_at = CASE WHEN _status = 'unmatched'
                         THEN now() + make_interval(mins => least(60, power(2, least(retry_count, 6))::int))
                         ELSE NULL END
  WHERE id = _row.id
  RETURNING * INTO _row;

  RETURN _row;
END; $function$;

REVOKE ALL ON FUNCTION public.courier_apply_event(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_apply_event(uuid) TO service_role;

-- Ingestion: store first, then apply through the shared routine.
CREATE OR REPLACE FUNCTION public.ingest_courier_event(_provider_code text, _provider_event text, _consignment_id text DEFAULT NULL::text, _merchant_order_id text DEFAULT NULL::text, _provider_event_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _provider_event_id text DEFAULT NULL::text, _payload jsonb DEFAULT NULL::jsonb, _source text DEFAULT 'webhook'::text)
RETURNS public.courier_provider_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _p public.courier_providers;
  _fp text;
  _row public.courier_provider_events;
  _at timestamptz := coalesce(_provider_event_at, now());
BEGIN
  SELECT * INTO _p FROM public.courier_providers WHERE code = _provider_code;

  _fp := coalesce(
    nullif(btrim(coalesce(_provider_event_id,'')),''),
    md5(coalesce(_provider_code,'?') || '|' || coalesce(_consignment_id, _merchant_order_id, '?')
        || '|' || coalesce(_provider_event,'?') || '|' || coalesce(_at::text,'?'))
  );
  _fp := coalesce(_provider_code,'?') || ':' || _fp;

  SELECT * INTO _row FROM public.courier_provider_events WHERE fingerprint = _fp;
  IF _row.id IS NOT NULL THEN
    RETURN _row;
  END IF;

  INSERT INTO public.courier_provider_events (
    provider_id, source, fingerprint, provider_event, provider_status,
    consignment_id, merchant_order_id, provider_event_at, payload, processing_status, processing_note
  ) VALUES (
    _p.id, coalesce(_source,'webhook'), _fp, _provider_event, _provider_event,
    _consignment_id, _merchant_order_id, _at, _payload, 'received', NULL
  ) RETURNING * INTO _row;

  RETURN public.courier_apply_event(_row.id);
END; $function$;

-- Retry: only for events that are transiently unapplied.
CREATE OR REPLACE FUNCTION public.retry_courier_event(_event_id uuid)
RETURNS public.courier_provider_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.courier_provider_events;
  _max_attempts constant integer := 6;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to retry courier events';
  END IF;

  SELECT * INTO _row FROM public.courier_provider_events WHERE id = _event_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Courier event not found';
  END IF;
  IF _row.processing_status NOT IN ('unmatched','received','retry_scheduled') THEN
    RAISE EXCEPTION 'Only unmatched or scheduled courier events can be retried. Use replay for a parked or rejected event.';
  END IF;

  UPDATE public.courier_provider_events
     SET retry_count = retry_count + 1
   WHERE id = _row.id RETURNING * INTO _row;

  _row := public.courier_apply_event(_row.id);

  IF _row.processing_status = 'unmatched' THEN
    IF _row.retry_count >= _max_attempts THEN
      UPDATE public.courier_provider_events
         SET processing_status = 'dead_letter',
             next_retry_at = NULL,
             last_error = 'Still unmatched after ' || _row.retry_count || ' attempts'
       WHERE id = _row.id RETURNING * INTO _row;
    ELSE
      UPDATE public.courier_provider_events
         SET processing_status = 'retry_scheduled'
       WHERE id = _row.id RETURNING * INTO _row;
    END IF;
  END IF;

  RETURN _row;
END; $function$;

REVOKE ALL ON FUNCTION public.retry_courier_event(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.retry_courier_event(uuid) TO authenticated, service_role;

-- Replay: deliberate, permissioned reprocessing of a parked or rejected event.
CREATE OR REPLACE FUNCTION public.replay_courier_event(_event_id uuid, _reason text DEFAULT NULL::text)
RETURNS public.courier_provider_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.courier_provider_events;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to replay courier events';
  END IF;
  IF coalesce(btrim(_reason),'') = '' THEN
    RAISE EXCEPTION 'A reason is required to replay a courier event';
  END IF;

  SELECT * INTO _row FROM public.courier_provider_events WHERE id = _event_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Courier event not found';
  END IF;
  IF _row.processing_status = 'applied' THEN
    RAISE EXCEPTION 'This event was already applied and cannot be replayed';
  END IF;

  UPDATE public.courier_provider_events
     SET replay_count = replay_count + 1,
         last_replay_at = now(),
         last_replay_by = auth.uid(),
         retry_count = 0,
         last_error = NULL,
         processing_note = 'Replayed: ' || btrim(_reason)
   WHERE id = _row.id RETURNING * INTO _row;

  RETURN public.courier_apply_event(_row.id);
END; $function$;

REVOKE ALL ON FUNCTION public.replay_courier_event(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.replay_courier_event(uuid, text) TO authenticated, service_role;

-- Bounded automatic retry sweep for the background worker.
CREATE OR REPLACE FUNCTION public.sweep_courier_event_retries(_limit integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _n integer := 0;
BEGIN
  FOR _id IN
    SELECT id FROM public.courier_provider_events
     WHERE processing_status IN ('unmatched','retry_scheduled')
       AND (next_retry_at IS NULL OR next_retry_at <= now())
     ORDER BY received_at
     LIMIT greatest(1, least(coalesce(_limit,20), 50))
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.retry_courier_event(_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END; $function$;

REVOKE ALL ON FUNCTION public.sweep_courier_event_retries(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_courier_event_retries(integer) TO service_role;

-- Tracking polling: lease-based claim of a bounded batch of shipments.
CREATE OR REPLACE FUNCTION public.claim_courier_tracking_polls(_limit integer DEFAULT 10, _lease_seconds integer DEFAULT 120, _worker text DEFAULT 'scheduled'::text)
RETURNS TABLE(shipment_id uuid, provider_code text, account_id uuid, consignment_id text, shipment_number text, lease_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _lease integer := greatest(30, least(coalesce(_lease_seconds,120), 600));
  _batch integer := greatest(1, least(coalesce(_limit,10), 25));
  _token uuid := gen_random_uuid();
BEGIN
  -- keep the schedule in step with active shipments
  INSERT INTO public.courier_tracking_polls (shipment_id)
  SELECT s.id FROM public.shipments s
   WHERE s.external_consignment_id IS NOT NULL
     AND s.courier_account_id IS NOT NULL
     AND s.status NOT IN ('delivered','cancelled','returned','failed')
  ON CONFLICT (shipment_id) DO NOTHING;

  RETURN QUERY
  WITH due AS (
    SELECT p.shipment_id
      FROM public.courier_tracking_polls p
      JOIN public.shipments s ON s.id = p.shipment_id
      JOIN public.courier_accounts a ON a.id = s.courier_account_id
      JOIN public.courier_providers pr ON pr.id = s.provider_id
     WHERE p.next_poll_at <= now()
       AND (p.lease_until IS NULL OR p.lease_until < now())
       AND s.external_consignment_id IS NOT NULL
       AND s.status NOT IN ('delivered','cancelled','returned','failed')
       AND a.status = 'active'
       AND pr.status = 'active'
     ORDER BY p.next_poll_at
     LIMIT _batch
     FOR UPDATE OF p SKIP LOCKED
  ), claimed AS (
    UPDATE public.courier_tracking_polls p
       SET lease_token = _token,
           lease_until = now() + make_interval(secs => _lease),
           worker_id = coalesce(_worker,'scheduled'),
           attempts = p.attempts + 1
      FROM due
     WHERE p.shipment_id = due.shipment_id
     RETURNING p.shipment_id
  )
  SELECT s.id, pr.code, s.courier_account_id, s.external_consignment_id, s.shipment_number, _token
    FROM claimed c
    JOIN public.shipments s ON s.id = c.shipment_id
    JOIN public.courier_providers pr ON pr.id = s.provider_id;
END; $function$;

REVOKE ALL ON FUNCTION public.claim_courier_tracking_polls(integer, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_courier_tracking_polls(integer, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_courier_tracking_poll(_shipment_id uuid, _lease_token uuid, _ok boolean, _error text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _p public.courier_tracking_polls;
BEGIN
  SELECT * INTO _p FROM public.courier_tracking_polls WHERE shipment_id = _shipment_id FOR UPDATE;
  IF _p.shipment_id IS NULL THEN
    RETURN false;
  END IF;
  -- a result from an expired or foreign lease is ignored
  IF _p.lease_token IS DISTINCT FROM _lease_token THEN
    RETURN false;
  END IF;

  UPDATE public.courier_tracking_polls SET
    lease_token = NULL,
    lease_until = NULL,
    last_polled_at = now(),
    last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error,'Poll failed'), 500) END,
    consecutive_failures = CASE WHEN _ok THEN 0 ELSE consecutive_failures + 1 END,
    next_poll_at = CASE
      WHEN _ok THEN now() + interval '20 minutes'
      ELSE now() + make_interval(mins => least(360, 10 * power(2, least(consecutive_failures, 5))::int))
    END
  WHERE shipment_id = _shipment_id;

  RETURN true;
END; $function$;

REVOKE ALL ON FUNCTION public.record_courier_tracking_poll(uuid, uuid, boolean, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_courier_tracking_poll(uuid, uuid, boolean, text) TO service_role;