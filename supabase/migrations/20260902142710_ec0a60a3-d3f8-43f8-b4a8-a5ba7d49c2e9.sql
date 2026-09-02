-- ============ COURIER ACCOUNTS (stores) ============
CREATE TABLE public.courier_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.courier_providers(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  environment public.courier_environment NOT NULL DEFAULT 'sandbox',
  external_store_id text,
  base_url text,
  status public.entity_status NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  -- non-secret operational configuration only (e.g. default item type / delivery type)
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_accounts TO authenticated;
GRANT ALL ON public.courier_accounts TO service_role;
ALTER TABLE public.courier_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers view courier accounts" ON public.courier_accounts
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "Admins insert courier accounts" ON public.courier_accounts
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update courier accounts" ON public.courier_accounts
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete courier accounts" ON public.courier_accounts
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER courier_accounts_updated_at BEFORE UPDATE ON public.courier_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ COURIER CREDENTIALS (server only, never readable by app users) ============
CREATE TABLE public.courier_account_credentials (
  account_id uuid PRIMARY KEY REFERENCES public.courier_accounts(id) ON DELETE CASCADE,
  client_id text,
  client_secret text,
  username text,
  password text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  token_refreshed_at timestamptz,
  webhook_secret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- deliberately no grants for anon/authenticated: only trusted server code reaches this table
GRANT ALL ON public.courier_account_credentials TO service_role;
ALTER TABLE public.courier_account_credentials ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER courier_credentials_updated_at BEFORE UPDATE ON public.courier_account_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ PROVIDER STATUS NORMALIZATION ============
CREATE TABLE public.courier_status_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.courier_providers(id) ON DELETE CASCADE,
  provider_event text NOT NULL,
  shipment_status public.shipment_status,
  event_type public.shipment_event_type NOT NULL DEFAULT 'provider_event',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_event)
);
GRANT SELECT ON public.courier_status_map TO authenticated;
GRANT ALL ON public.courier_status_map TO service_role;
ALTER TABLE public.courier_status_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers view status map" ON public.courier_status_map
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE TRIGGER courier_status_map_updated_at BEFORE UPDATE ON public.courier_status_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ RAW PROVIDER EVENTS (idempotency ledger) ============
CREATE TABLE public.courier_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.courier_providers(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.courier_accounts(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'webhook',
  fingerprint text NOT NULL UNIQUE,
  provider_event text,
  provider_status text,
  consignment_id text,
  merchant_order_id text,
  provider_event_at timestamptz,
  payload jsonb,
  processing_status public.courier_event_processing_status NOT NULL,
  processing_note text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courier_provider_events_shipment_idx ON public.courier_provider_events(shipment_id, received_at DESC);
CREATE INDEX courier_provider_events_consignment_idx ON public.courier_provider_events(consignment_id);
GRANT SELECT ON public.courier_provider_events TO authenticated;
GRANT ALL ON public.courier_provider_events TO service_role;
ALTER TABLE public.courier_provider_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers view provider events" ON public.courier_provider_events
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

-- ============ COURIER API LOG (safe operational detail only) ============
CREATE TABLE public.courier_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.courier_providers(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.courier_accounts(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  operation text NOT NULL,
  succeeded boolean NOT NULL,
  status_code integer,
  error_category text,
  safe_message text,
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courier_api_logs_shipment_idx ON public.courier_api_logs(shipment_id, created_at DESC);
GRANT SELECT ON public.courier_api_logs TO authenticated;
GRANT ALL ON public.courier_api_logs TO service_role;
ALTER TABLE public.courier_api_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers view courier api logs" ON public.courier_api_logs
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

-- ============ PROVIDER LOCATION CACHE ============
CREATE TABLE public.courier_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.courier_providers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('city','zone','area')),
  external_id text NOT NULL,
  parent_external_id text,
  name text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, kind, external_id)
);
CREATE INDEX courier_locations_parent_idx ON public.courier_locations(provider_id, kind, parent_external_id);
GRANT SELECT ON public.courier_locations TO authenticated;
GRANT ALL ON public.courier_locations TO service_role;
ALTER TABLE public.courier_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers view courier locations" ON public.courier_locations
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

-- ============ SHIPMENT COLUMNS ============
ALTER TABLE public.shipments
  ADD COLUMN courier_account_id uuid REFERENCES public.courier_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN provider_status text,
  ADD COLUMN provider_status_slug text,
  ADD COLUMN provider_status_at timestamptz,
  ADD COLUMN last_synced_at timestamptz,
  ADD COLUMN quoted_delivery_fee numeric(12,2) CHECK (quoted_delivery_fee IS NULL OR quoted_delivery_fee >= 0),
  ADD COLUMN booked_delivery_fee numeric(12,2) CHECK (booked_delivery_fee IS NULL OR booked_delivery_fee >= 0),
  ADD COLUMN return_tracking_number text,
  ADD COLUMN return_reason text,
  ADD COLUMN partial_delivery_note text,
  ADD COLUMN booking_idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN provider_recipient_city_id text,
  ADD COLUMN provider_recipient_zone_id text,
  ADD COLUMN provider_recipient_area_id text;

-- one courier consignment can only belong to one internal shipment
CREATE UNIQUE INDEX shipments_provider_consignment_uniq
  ON public.shipments(provider_id, external_consignment_id)
  WHERE external_consignment_id IS NOT NULL;
CREATE INDEX shipments_account_idx ON public.shipments(courier_account_id);

-- ============ TRANSITIONS (extended, provider-neutral) ============
CREATE OR REPLACE FUNCTION public.shipment_transition_valid(_from public.shipment_status, _to public.shipment_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _from
    WHEN 'draft' THEN _to IN ('ready_for_booking','cancelled')
    WHEN 'ready_for_booking' THEN _to IN ('booking_requested','booked','booking_failed','draft','cancelled')
    WHEN 'booking_requested' THEN _to IN ('booked','booking_failed','ready_for_booking','cancelled')
    WHEN 'booking_failed' THEN _to IN ('ready_for_booking','booking_requested','cancelled')
    WHEN 'booked' THEN _to IN ('pickup_requested','picked_up','pickup_failed','cancelled')
    WHEN 'pickup_requested' THEN _to IN ('picked_up','pickup_failed','booked','cancelled')
    WHEN 'pickup_failed' THEN _to IN ('pickup_requested','picked_up','cancelled')
    WHEN 'picked_up' THEN _to IN ('in_transit','out_for_delivery','delivery_on_hold','lost')
    WHEN 'in_transit' THEN _to IN ('out_for_delivery','delivery_on_hold','delivery_failed','return_requested','lost')
    WHEN 'out_for_delivery' THEN _to IN ('delivered','partial_delivered','delivery_on_hold','delivery_failed','return_requested','lost')
    WHEN 'delivery_on_hold' THEN _to IN ('out_for_delivery','delivered','partial_delivered','delivery_failed','return_requested','lost')
    WHEN 'delivery_failed' THEN _to IN ('out_for_delivery','delivery_on_hold','return_requested','lost')
    WHEN 'partial_delivered' THEN _to IN ('return_requested','return_in_transit','return_received','lost')
    WHEN 'return_requested' THEN _to IN ('return_in_transit','return_received','lost')
    WHEN 'return_in_transit' THEN _to IN ('return_received','lost')
    ELSE false  -- delivered / return_received / lost / cancelled are terminal
  END;
$$;

-- ============ COURIER ASSIGNMENT WITH ACCOUNT ============
CREATE OR REPLACE FUNCTION public.assign_shipment_courier(
  _shipment_id uuid, _provider_id uuid, _service_type public.courier_service_type DEFAULT NULL,
  _account_id uuid DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments; _p public.courier_providers; _a public.courier_accounts;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to assign couriers';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF _s.external_consignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'This shipment is already booked with a courier consignment and cannot be reassigned';
  END IF;
  IF _s.status NOT IN ('draft','ready_for_booking','booking_requested','booking_failed') THEN
    RAISE EXCEPTION 'The courier can no longer be changed once booking is confirmed (current: %)', _s.status;
  END IF;
  SELECT * INTO _p FROM public.courier_providers WHERE id = _provider_id;
  IF _p.id IS NULL OR _p.status <> 'active' THEN
    RAISE EXCEPTION 'Courier provider is missing or not active';
  END IF;
  IF _account_id IS NOT NULL THEN
    SELECT * INTO _a FROM public.courier_accounts WHERE id = _account_id;
    IF _a.id IS NULL OR _a.provider_id <> _p.id OR _a.status <> 'active' THEN
      RAISE EXCEPTION 'Courier account is missing, inactive, or belongs to another provider';
    END IF;
  END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments
     SET provider_id = _p.id, service_type = _service_type,
         courier_account_id = _account_id, updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'courier_assigned', _s.status, _s.status,
    'Courier set to ' || _p.name || coalesce(' (' || _a.name || ')', '') || '.',
    jsonb_build_object('provider_id', _p.id, 'account_id', _account_id));
  RETURN _s;
END; $$;

-- ============ EXTENDED MANUAL STATE MACHINE ============
CREATE OR REPLACE FUNCTION public.set_shipment_state(
  _shipment_id uuid,
  _action text,
  _reason text DEFAULT NULL,
  _hold_reason public.shipment_hold_reason DEFAULT NULL,
  _failure_reason public.shipment_failure_reason DEFAULT NULL,
  _tracking_number text DEFAULT NULL,
  _external_consignment_id text DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _s public.shipments;
  _order public.orders;
  _from public.shipment_status;
  _next public.shipment_status;
  _event public.shipment_event_type;
  _msg text;
  _clean text := nullif(btrim(coalesce(_reason,'')), '');
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change shipment state';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _s.order_id;
  _from := _s.status;

  IF _order.status = 'cancelled' AND _action <> 'cancel'
     AND _from IN ('draft','ready_for_booking','booking_requested','booking_failed','booked','pickup_requested') THEN
    RAISE EXCEPTION 'The order is cancelled. This shipment can only be cancelled.';
  END IF;

  CASE _action
    WHEN 'mark_ready_for_booking' THEN
      IF _s.provider_id IS NULL THEN
        RAISE EXCEPTION 'Assign a courier provider before marking the shipment ready for booking';
      END IF;
      _next := 'ready_for_booking'; _event := 'ready_for_booking';
      _msg := 'Shipment is ready for courier booking.';
    WHEN 'request_booking' THEN
      _next := 'booking_requested'; _event := 'booking_requested';
      _msg := 'Booking requested with the courier (internal operational action).';
    WHEN 'revert_booking_request' THEN
      _next := 'ready_for_booking'; _event := 'status_updated';
      _msg := 'Booking request withdrawn' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'mark_booking_failed' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required when a booking fails'; END IF;
      _next := 'booking_failed'; _event := 'booking_failed';
      _msg := 'Courier booking failed — ' || _clean;
    WHEN 'retry_booking' THEN
      _next := 'ready_for_booking'; _event := 'status_updated';
      _msg := 'Booking reset for another attempt' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'confirm_booking' THEN
      _next := 'booked'; _event := 'booking_confirmed';
      _msg := 'Courier booking confirmed (recorded manually)'
        || coalesce(' — tracking ' || nullif(btrim(coalesce(_tracking_number,'')),''), '') || '.';
    WHEN 'request_pickup' THEN
      _next := 'pickup_requested'; _event := 'pickup_requested'; _msg := 'Courier pickup requested.';
    WHEN 'mark_pickup_failed' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required when a pickup fails'; END IF;
      _next := 'pickup_failed'; _event := 'pickup_failed';
      _msg := 'Courier pickup failed — ' || _clean || ' The shipment stays active; the order is unaffected.';
    WHEN 'mark_picked_up' THEN
      _next := 'picked_up'; _event := 'shipment_picked_up'; _msg := 'Courier collected the package.';
    WHEN 'mark_in_transit' THEN
      _next := 'in_transit'; _event := 'status_updated'; _msg := 'Package is in transit.';
    WHEN 'mark_out_for_delivery' THEN
      _next := 'out_for_delivery'; _event := 'status_updated'; _msg := 'Package is out for delivery.';
    WHEN 'hold_delivery' THEN
      IF _hold_reason IS NULL THEN RAISE EXCEPTION 'A hold reason is required'; END IF;
      _next := 'delivery_on_hold'; _event := 'delivery_on_hold';
      _msg := 'Delivery on hold — ' || _hold_reason::text || coalesce(' — ' || _clean, '')
              || '. The order is not cancelled.';
    WHEN 'mark_delivered' THEN
      _next := 'delivered'; _event := 'shipment_delivered';
      _msg := 'Package delivered. No financial settlement was performed.';
    WHEN 'mark_partial_delivered' THEN
      IF _clean IS NULL THEN
        RAISE EXCEPTION 'Record what the customer accepted and rejected for a partial delivery';
      END IF;
      _next := 'partial_delivered'; _event := 'partial_delivery';
      _msg := 'Partial delivery — ' || _clean
              || ' Item-level acceptance is handled by the future returns module.';
    WHEN 'mark_delivery_failed' THEN
      IF _failure_reason IS NULL THEN RAISE EXCEPTION 'A delivery failure reason is required'; END IF;
      _next := 'delivery_failed'; _event := 'delivery_failed';
      _msg := 'Delivery failed — ' || _failure_reason::text || coalesce(' — ' || _clean, '')
              || '. The order is not cancelled.';
    WHEN 'start_return' THEN
      IF _from = 'delivered' THEN RAISE EXCEPTION 'A delivered shipment needs the customer return workflow'; END IF;
      _next := 'return_requested'; _event := 'return_requested';
      _msg := 'Return to sender requested' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'mark_return_in_transit' THEN
      _next := 'return_in_transit'; _event := 'return_started'; _msg := 'Return package is in transit.';
    WHEN 'mark_return_received' THEN
      _next := 'return_received'; _event := 'return_received';
      _msg := 'Returned package received. Inventory was not restocked.';
    WHEN 'mark_lost' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required to mark a shipment lost'; END IF;
      _next := 'lost'; _event := 'shipment_lost'; _msg := 'Shipment reported lost — ' || _clean;
    WHEN 'cancel' THEN
      IF _from IN ('picked_up','in_transit','out_for_delivery','delivery_on_hold','delivery_failed',
                   'partial_delivered','return_requested','return_in_transit') THEN
        RAISE EXCEPTION 'The courier already collected this package. Use the return workflow instead of cancelling.';
      END IF;
      IF _s.external_consignment_id IS NOT NULL AND _from IN ('booked','pickup_requested','pickup_failed') THEN
        IF _clean IS NULL THEN
          RAISE EXCEPTION 'This shipment has a courier consignment. Confirm the courier-side cancellation and record it as the reason.';
        END IF;
      END IF;
      _next := 'cancelled'; _event := 'shipment_cancelled';
      _msg := 'Shipment cancelled' || coalesce(' — ' || _clean, '') || '.';
    ELSE
      RAISE EXCEPTION 'Unknown shipment action: %', _action;
  END CASE;

  IF NOT public.shipment_transition_valid(_from, _next) THEN
    RAISE EXCEPTION 'Transition from % to % is not allowed', _from, _next;
  END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    status = _next,
    updated_by = auth.uid(),
    tracking_number = coalesce(nullif(btrim(coalesce(_tracking_number,'')),''), tracking_number),
    external_consignment_id = coalesce(nullif(btrim(coalesce(_external_consignment_id,'')),''), external_consignment_id),
    hold_reason = CASE WHEN _next = 'delivery_on_hold' THEN _hold_reason ELSE NULL END,
    failure_reason = CASE WHEN _next = 'delivery_failed' THEN _failure_reason ELSE failure_reason END,
    partial_delivery_note = CASE WHEN _next = 'partial_delivered' THEN _clean ELSE partial_delivery_note END,
    return_reason = CASE WHEN _next = 'return_requested' THEN coalesce(_clean, return_reason) ELSE return_reason END,
    booked_at = CASE WHEN _next = 'booked' AND booked_at IS NULL THEN now() ELSE booked_at END,
    picked_up_at = CASE WHEN _next = 'picked_up' AND picked_up_at IS NULL THEN now() ELSE picked_up_at END,
    delivered_at = CASE WHEN _next IN ('delivered','partial_delivered') THEN now() ELSE delivered_at END,
    cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, _event, _from, _next, _msg, NULL);

  IF _next IN ('booked','picked_up','delivered','partial_delivered','delivery_failed',
               'booking_failed','pickup_failed','return_received','lost','cancelled') THEN
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_s.order_id, 'Shipment ' || _s.shipment_number || ': ' || _msg, 'system', true, auth.uid());
  END IF;

  RETURN _s;
END; $$;

-- ============ RETURN TRACKING (return entity comes later) ============
CREATE OR REPLACE FUNCTION public.set_shipment_return_tracking(
  _shipment_id uuid, _return_tracking_number text, _return_reason text DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments; _tracking text := nullif(btrim(coalesce(_return_tracking_number,'')),'');
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record return tracking';
  END IF;
  IF _tracking IS NULL THEN RAISE EXCEPTION 'A return tracking identifier is required'; END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments
     SET return_tracking_number = _tracking,
         return_reason = coalesce(nullif(btrim(coalesce(_return_reason,'')),''), return_reason),
         updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'return_created', _s.status, _s.status,
    'Return tracking recorded: ' || _tracking || '.', jsonb_build_object('return_tracking_number', _tracking));
  RETURN _s;
END; $$;

-- ============ PROVIDER EVENT INGESTION (idempotent, stale-safe) ============
CREATE OR REPLACE FUNCTION public.ingest_courier_event(
  _provider_code text,
  _provider_event text,
  _consignment_id text DEFAULT NULL,
  _merchant_order_id text DEFAULT NULL,
  _provider_event_at timestamptz DEFAULT NULL,
  _provider_event_id text DEFAULT NULL,
  _payload jsonb DEFAULT NULL,
  _source text DEFAULT 'webhook'
) RETURNS public.courier_provider_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _p public.courier_providers;
  _s public.shipments;
  _map public.courier_status_map;
  _fp text;
  _row public.courier_provider_events;
  _status public.courier_event_processing_status;
  _note text;
  _from public.shipment_status;
  _at timestamptz := coalesce(_provider_event_at, now());
  _event public.shipment_event_type;
BEGIN
  SELECT * INTO _p FROM public.courier_providers WHERE code = _provider_code;

  _fp := coalesce(
    nullif(btrim(coalesce(_provider_event_id,'')),''),
    md5(coalesce(_provider_code,'?') || '|' || coalesce(_consignment_id, _merchant_order_id, '?')
        || '|' || coalesce(_provider_event,'?') || '|' || coalesce(_at::text,'?'))
  );
  _fp := coalesce(_provider_code,'?') || ':' || _fp;

  -- already seen: do not touch shipment state again
  SELECT * INTO _row FROM public.courier_provider_events WHERE fingerprint = _fp;
  IF _row.id IS NOT NULL THEN
    RETURN _row;
  END IF;

  IF _consignment_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments
     WHERE external_consignment_id = _consignment_id
       AND (_p.id IS NULL OR provider_id = _p.id)
     FOR UPDATE;
  END IF;
  IF _s.id IS NULL AND _merchant_order_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments WHERE shipment_number = _merchant_order_id FOR UPDATE;
  END IF;

  IF _p.id IS NULL THEN
    _status := 'rejected'; _note := 'Unknown courier provider code';
  ELSIF _s.id IS NULL THEN
    _status := 'unmatched'; _note := 'No shipment matches this consignment or merchant order id';
  ELSE
    SELECT * INTO _map FROM public.courier_status_map
     WHERE provider_id = _p.id AND provider_event = _provider_event;

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
         SET provider_status = _provider_event, provider_status_slug = _provider_event,
             provider_status_at = _at, last_synced_at = now()
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);
    ELSIF NOT public.shipment_transition_valid(_from, _map.shipment_status) THEN
      _status := 'rejected';
      _note := 'Courier event maps to ' || _map.shipment_status::text
               || ' which is not a valid transition from ' || _from::text;
      PERFORM public.log_shipment_event(_s.id, _s.order_id, 'provider_event', _from, _from,
        'Courier reported "' || _provider_event || '" — not applied because ' || _note || '.',
        jsonb_build_object('provider_event', _provider_event, 'source', _source));
    ELSE
      _status := 'applied';
      _event := coalesce(_map.event_type, 'provider_event');
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments SET
        status = _map.shipment_status,
        provider_status = _provider_event,
        provider_status_slug = _provider_event,
        provider_status_at = _at,
        last_synced_at = now(),
        picked_up_at = CASE WHEN _map.shipment_status = 'picked_up' AND picked_up_at IS NULL THEN _at ELSE picked_up_at END,
        delivered_at = CASE WHEN _map.shipment_status IN ('delivered','partial_delivered') THEN _at ELSE delivered_at END,
        cancelled_at = CASE WHEN _map.shipment_status = 'cancelled' THEN _at ELSE cancelled_at END
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);

      PERFORM public.log_shipment_event(_s.id, _s.order_id, _event, _from, _map.shipment_status,
        'Courier reported "' || _provider_event || '".',
        jsonb_build_object('provider_event', _provider_event, 'source', _source,
                           'provider_event_at', _at));
    END IF;
  END IF;

  INSERT INTO public.courier_provider_events (
    provider_id, account_id, shipment_id, source, fingerprint, provider_event, provider_status,
    consignment_id, merchant_order_id, provider_event_at, payload, processing_status, processing_note
  ) VALUES (
    _p.id, _s.courier_account_id, _s.id, coalesce(_source,'webhook'), _fp, _provider_event, _provider_event,
    _consignment_id, _merchant_order_id, _at, _payload, _status, _note
  ) RETURNING * INTO _row;

  RETURN _row;
END; $$;

-- ============ OUTBOUND BOOKING RESULT (idempotent) ============
CREATE OR REPLACE FUNCTION public.record_courier_booking(
  _shipment_id uuid,
  _consignment_id text,
  _provider_status text DEFAULT NULL,
  _delivery_fee numeric DEFAULT NULL,
  _tracking_number text DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments; _from public.shipment_status; _cid text := nullif(btrim(coalesce(_consignment_id,'')),'');
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'A courier consignment identifier is required'; END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  -- idempotent: the same consignment recorded twice changes nothing
  IF _s.external_consignment_id IS NOT NULL THEN
    IF _s.external_consignment_id = _cid THEN RETURN _s; END IF;
    RAISE EXCEPTION 'This shipment is already booked with consignment %', _s.external_consignment_id;
  END IF;

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
    last_synced_at = now()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'booking_confirmed', _from, _s.status,
    'Courier booking confirmed — consignment ' || _cid
      || coalesce(', delivery fee ' || _delivery_fee::text, '') || '.',
    jsonb_build_object('consignment_id', _cid, 'delivery_fee', _delivery_fee));

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_s.order_id, 'Shipment ' || _s.shipment_number || ' booked with the courier (consignment ' || _cid || ').',
          'system', true, auth.uid());
  RETURN _s;
END; $$;

CREATE OR REPLACE FUNCTION public.record_courier_quote(
  _shipment_id uuid, _quoted_fee numeric
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments;
BEGIN
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET quoted_delivery_fee = _quoted_fee, updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);
  RETURN _s;
END; $$;

-- ============ EXECUTION RIGHTS ============
REVOKE ALL ON FUNCTION public.ingest_courier_event(text, text, text, text, timestamptz, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_courier_booking(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_courier_quote(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_shipment_courier(uuid, uuid, public.courier_service_type, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_shipment_return_tracking(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_shipment_courier(uuid, uuid, public.courier_service_type, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_shipment_return_tracking(uuid, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.assign_shipment_courier(uuid, uuid, public.courier_service_type);

-- ============ PATHAO STATUS MAP SEED ============
INSERT INTO public.courier_status_map (provider_id, provider_event, shipment_status, event_type, description)
SELECT p.id, v.ev, v.st::public.shipment_status, v.et::public.shipment_event_type, v.note
  FROM public.courier_providers p
  CROSS JOIN (VALUES
    ('order.created','booked','booking_confirmed','Courier accepted the consignment'),
    ('order.updated',NULL,'provider_event','Informational update'),
    ('order.pickup-requested','pickup_requested','pickup_requested','Pickup scheduled'),
    ('order.assigned-for-pickup','pickup_requested','pickup_requested','Rider assigned for pickup'),
    ('order.picked','picked_up','shipment_picked_up','Package collected'),
    ('order.pickup-failed','pickup_failed','pickup_failed','Pickup attempt failed'),
    ('order.pickup-cancelled','pickup_failed','pickup_failed','Pickup cancelled by courier'),
    ('order.at-the-sorting-hub','in_transit','status_updated','Sorting hub'),
    ('order.in-transit','in_transit','status_updated','Moving between hubs'),
    ('order.received-at-last-mile-hub','in_transit','status_updated','Last mile hub'),
    ('order.assigned-for-delivery','out_for_delivery','status_updated','Rider assigned for delivery'),
    ('order.delivered','delivered','shipment_delivered','Delivered'),
    ('order.partial-delivery','partial_delivered','partial_delivery','Customer accepted part of the shipment'),
    ('order.delivery-failed','delivery_failed','delivery_failed','Delivery attempt failed'),
    ('order.on-hold','delivery_on_hold','delivery_on_hold','Delivery paused'),
    ('order.paid',NULL,'provider_event','Courier settlement signal — financial module, not shipment state'),
    ('order.exchanged',NULL,'provider_event','Exchange handled by the future returns module'),
    ('order.return-id-created',NULL,'return_created','Return consignment created'),
    ('order.return-in-transit','return_in_transit','return_started','Return moving to merchant'),
    ('order.returned','return_requested','return_requested','Return to sender started'),
    ('order.paid-return',NULL,'provider_event','Paid return — financial module'),
    ('order.returned-to-merchant','return_received','return_received','Return received by merchant')
  ) AS v(ev, st, et, note)
 WHERE p.code = 'pathao'
ON CONFLICT (provider_id, provider_event) DO NOTHING;