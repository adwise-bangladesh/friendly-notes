REVOKE EXECUTE ON FUNCTION public.create_shipment_exception(uuid, public.shipment_exception_type, text, text, text, numeric, text, text, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_exception_state(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_order_return(uuid, uuid, public.order_return_type, text, text, text, jsonb, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_return_state(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_return_receipt(uuid, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inspect_return_items(uuid, jsonb, text) FROM anon;

CREATE OR REPLACE FUNCTION public.next_return_number()
RETURNS text LANGUAGE sql SET search_path = public AS $$
  SELECT 'RET-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.return_number_seq')::text, 6, '0');
$$;

-- A caller can pass _source, but only the courier ingest pipeline may skip the
-- permission check. app.courier_ingest is set inside a SECURITY DEFINER function
-- that clients cannot call.
CREATE OR REPLACE FUNCTION public.create_shipment_exception(
  _shipment_id uuid,
  _exception_type public.shipment_exception_type,
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _courier_reason text DEFAULT NULL,
  _collected_amount numeric DEFAULT NULL,
  _source text DEFAULT 'manual',
  _provider_event text DEFAULT NULL,
  _occurred_at timestamptz DEFAULT NULL
) RETURNS public.shipment_exceptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.shipments;
  _e public.shipment_exceptions;
  _at timestamptz := coalesce(_occurred_at, now());
  _internal boolean := coalesce(current_setting('app.courier_ingest', true), '') = 'on';
BEGIN
  IF NOT _internal THEN
    IF NOT public.can_manage_commerce(auth.uid()) THEN
      RAISE EXCEPTION 'Not permitted to raise delivery exceptions';
    END IF;
    _source := 'manual';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  SELECT * INTO _e FROM public.shipment_exceptions
   WHERE shipment_id = _shipment_id AND exception_type = _exception_type
     AND status IN ('open','under_review')
   FOR UPDATE;

  PERFORM set_config('app.exception_write', 'on', true);
  IF _e.id IS NOT NULL THEN
    UPDATE public.shipment_exceptions SET
      courier_reason = coalesce(nullif(btrim(coalesce(_courier_reason,'')),''), courier_reason),
      collected_amount = coalesce(_collected_amount, collected_amount),
      provider_event = coalesce(_provider_event, provider_event),
      occurred_at = greatest(occurred_at, _at)
    WHERE id = _e.id RETURNING * INTO _e;
  ELSE
    INSERT INTO public.shipment_exceptions (
      shipment_id, order_id, exception_type, reason, courier_reason, notes,
      collected_amount, source, provider_event, occurred_at, created_by
    ) VALUES (
      _s.id, _s.order_id, _exception_type,
      nullif(btrim(coalesce(_reason,'')),''),
      nullif(btrim(coalesce(_courier_reason,'')),''),
      nullif(btrim(coalesce(_notes,'')),''),
      _collected_amount, coalesce(_source,'manual'), _provider_event, _at,
      auth.uid()
    ) RETURNING * INTO _e;
  END IF;
  PERFORM set_config('app.exception_write', 'off', true);
  RETURN _e;
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_shipment_exception(uuid, public.shipment_exception_type, text, text, text, numeric, text, text, timestamptz) FROM anon;

CREATE OR REPLACE FUNCTION public.create_order_return(
  _order_id uuid,
  _shipment_id uuid DEFAULT NULL,
  _return_type public.order_return_type DEFAULT 'return_to_merchant',
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _tracking_reference text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _courier_reason text DEFAULT NULL,
  _source text DEFAULT 'manual'
) RETURNS public.order_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.order_returns;
  _order public.orders;
  _item jsonb;
  _oi public.order_items;
  _qty integer;
  _internal boolean := coalesce(current_setting('app.courier_ingest', true), '') = 'on';
BEGIN
  IF NOT _internal THEN
    IF NOT public.can_manage_commerce(auth.uid()) THEN
      RAISE EXCEPTION 'Not permitted to create returns';
    END IF;
    _source := 'manual';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF _shipment_id IS NOT NULL THEN
    SELECT * INTO _r FROM public.order_returns
     WHERE shipment_id = _shipment_id AND status IN ('pending','in_transit','received','inspected')
     FOR UPDATE;
    IF _r.id IS NOT NULL THEN
      RETURN _r;
    END IF;
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  INSERT INTO public.order_returns (
    order_id, shipment_id, return_number, return_type, reason, courier_reason, notes,
    tracking_reference, source, created_by, updated_by
  ) VALUES (
    _order_id, _shipment_id, public.next_return_number(), _return_type,
    nullif(btrim(coalesce(_reason,'')),''),
    nullif(btrim(coalesce(_courier_reason,'')),''),
    nullif(btrim(coalesce(_notes,'')),''),
    nullif(btrim(coalesce(_tracking_reference,'')),''),
    coalesce(_source,'manual'), auth.uid(), auth.uid()
  ) RETURNING * INTO _r;

  FOR _item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _oi FROM public.order_items
     WHERE id = (_item->>'order_item_id')::uuid AND order_id = _order_id;
    IF _oi.id IS NULL THEN RAISE EXCEPTION 'Order item does not belong to this order'; END IF;
    _qty := coalesce((_item->>'quantity_expected')::int, 0);
    IF _qty < 0 THEN RAISE EXCEPTION 'Return quantity cannot be negative'; END IF;
    IF _qty > _oi.quantity THEN
      RAISE EXCEPTION 'Return quantity cannot exceed the ordered quantity (%).', _oi.quantity;
    END IF;
    IF _qty > 0 THEN
      INSERT INTO public.order_return_items (return_id, order_item_id, quantity_expected, reason)
      VALUES (_r.id, _oi.id, _qty, nullif(btrim(coalesce(_item->>'reason','')),''));
    END IF;
  END LOOP;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _order_id, 'return_created', NULL, 'pending',
    'Return ' || _r.return_number || ' created (' || _return_type::text || ')'
      || coalesce(' — ' || _r.reason, '') || '.',
    jsonb_build_object('source', coalesce(_source,'manual'), 'shipment_id', _shipment_id));

  IF _shipment_id IS NOT NULL THEN
    PERFORM public.log_shipment_event(_shipment_id, _order_id, 'return_created', NULL, NULL,
      'Return ' || _r.return_number || ' opened for this shipment.',
      jsonb_build_object('return_id', _r.id));
  END IF;
  RETURN _r;
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_order_return(uuid, uuid, public.order_return_type, text, text, text, jsonb, text, text) FROM anon;

CREATE OR REPLACE FUNCTION public.apply_courier_operational_effects(
  _shipment_id uuid,
  _event_type public.shipment_event_type,
  _provider_event text,
  _at timestamptz,
  _payload jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.shipments;
  _reason text;
  _amount numeric;
  _etype public.shipment_exception_type;
  _r public.order_returns;
  _target public.order_return_status;
  _rank_from int; _rank_to int;
BEGIN
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id;
  IF _s.id IS NULL THEN RETURN; END IF;

  PERFORM set_config('app.courier_ingest', 'on', true);

  _reason := nullif(btrim(coalesce(
    _payload->>'reason', _payload->>'delivery_failed_reason', _payload->>'failure_reason',
    _payload->>'remarks', _payload->>'note', _payload->>'status_message', '')), '');
  _amount := nullif(coalesce(
    _payload->>'collected_amount', _payload->>'amount_collected',
    _payload->>'collected_price', _payload->>'partial_delivery_amount'), '')::numeric;

  _etype := CASE _event_type
    WHEN 'delivery_failed'  THEN 'delivery_failed'::public.shipment_exception_type
    WHEN 'delivery_on_hold' THEN 'delivery_on_hold'::public.shipment_exception_type
    WHEN 'pickup_failed'    THEN 'pickup_failed'::public.shipment_exception_type
    WHEN 'partial_delivery' THEN 'partial_delivery'::public.shipment_exception_type
    ELSE NULL END;

  IF _etype IS NOT NULL THEN
    PERFORM public.create_shipment_exception(
      _s.id, _etype, NULL, NULL, _reason, _amount, 'courier', _provider_event, _at);
  END IF;

  _target := CASE _event_type
    WHEN 'return_created'   THEN 'pending'::public.order_return_status
    WHEN 'return_requested' THEN 'pending'::public.order_return_status
    WHEN 'return_started'   THEN 'in_transit'::public.order_return_status
    WHEN 'return_received'  THEN 'received'::public.order_return_status
    ELSE NULL END;

  IF _target IS NOT NULL THEN
    SELECT * INTO _r FROM public.order_returns
     WHERE shipment_id = _s.id AND status IN ('pending','in_transit','received','inspected')
     FOR UPDATE;
    IF _r.id IS NULL THEN
      _r := public.create_order_return(
        _s.order_id, _s.id, 'return_to_merchant',
        'Courier reported a return', NULL, _s.return_tracking_number,
        '[]'::jsonb, _reason, 'courier');
    END IF;

    _rank_from := CASE _r.status WHEN 'pending' THEN 1 WHEN 'in_transit' THEN 2
                                 WHEN 'received' THEN 3 WHEN 'inspected' THEN 4 ELSE 9 END;
    _rank_to := CASE _target WHEN 'pending' THEN 1 WHEN 'in_transit' THEN 2
                             WHEN 'received' THEN 3 ELSE 9 END;
    IF _rank_to > _rank_from AND public.return_transition_valid(_r.status, _target) THEN
      PERFORM set_config('app.return_write', 'on', true);
      UPDATE public.order_returns SET
        status = _target,
        courier_reason = coalesce(_reason, courier_reason),
        tracking_reference = coalesce(tracking_reference, _s.return_tracking_number),
        initiated_at = CASE WHEN _target = 'in_transit' AND initiated_at IS NULL THEN _at ELSE initiated_at END,
        received_at  = CASE WHEN _target = 'received'  AND received_at  IS NULL THEN _at ELSE received_at END
      WHERE id = _r.id;
      PERFORM set_config('app.return_write', 'off', true);
      PERFORM public.log_return_event(_r.id, _r.order_id, 'provider_event', _r.status, _target,
        'Courier reported "' || coalesce(_provider_event,'?') || '".',
        jsonb_build_object('provider_event', _provider_event, 'provider_event_at', _at));
    END IF;
  END IF;

  PERFORM set_config('app.courier_ingest', 'off', true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.apply_courier_operational_effects(uuid,public.shipment_event_type,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;