
ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS delivered_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refused_quantity  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_quantity     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_quantity  integer NOT NULL DEFAULT 0;

ALTER TABLE public.shipment_items
  DROP CONSTRAINT IF EXISTS shipment_items_outcome_nonnegative,
  DROP CONSTRAINT IF EXISTS shipment_items_outcome_within_quantity;

ALTER TABLE public.shipment_items
  ADD CONSTRAINT shipment_items_outcome_nonnegative CHECK (
    delivered_quantity >= 0 AND refused_quantity >= 0
    AND lost_quantity >= 0 AND damaged_quantity >= 0),
  ADD CONSTRAINT shipment_items_outcome_within_quantity CHECK (
    delivered_quantity + refused_quantity + lost_quantity + damaged_quantity <= quantity);

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS delivery_outcome_fingerprint text,
  ADD COLUMN IF NOT EXISTS delivery_outcome_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_outcome_recorded_by uuid;

-- Delivered quantity projection: prefer authoritative per-item outcomes, fall
-- back to shipment status for shipments reconciled before this workflow existed.
CREATE OR REPLACE FUNCTION public.refresh_order_delivery_status(_order_id uuid)
 RETURNS order_delivery_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders;
  _next public.order_delivery_status;
  _started int; _active int; _delivered_ship int; _partial int; _returned int; _lost int;
  _failed_active int; _on_hold int; _moving int; _handed int;
  _ordered_qty int; _shipped_qty int; _delivered_qty int;
  _covered boolean;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RETURN NULL; END IF;

  SELECT
    count(*) FILTER (WHERE status NOT IN ('draft','ready_for_booking','booking_requested','booking_failed')),
    count(*) FILTER (WHERE status IN ('booked','pickup_requested','pickup_failed','picked_up','in_transit',
                                      'out_for_delivery','delivery_on_hold','delivery_failed',
                                      'return_requested','return_in_transit')),
    count(*) FILTER (WHERE status = 'delivered'),
    count(*) FILTER (WHERE status = 'partial_delivered'),
    count(*) FILTER (WHERE status = 'return_received'),
    count(*) FILTER (WHERE status = 'lost'),
    count(*) FILTER (WHERE status = 'delivery_failed'),
    count(*) FILTER (WHERE status = 'delivery_on_hold'),
    count(*) FILTER (WHERE status IN ('picked_up','in_transit','out_for_delivery',
                                      'return_requested','return_in_transit')),
    count(*) FILTER (WHERE status IN ('booked','pickup_requested','pickup_failed'))
  INTO _started, _active, _delivered_ship, _partial, _returned, _lost, _failed_active, _on_hold, _moving, _handed
  FROM public.shipments
  WHERE order_id = _order_id AND status <> 'cancelled';

  SELECT coalesce(sum(quantity), 0) INTO _ordered_qty
    FROM public.order_items WHERE order_id = _order_id;

  SELECT coalesce(sum(si.quantity), 0) INTO _shipped_qty
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.order_id = _order_id AND s.status <> 'cancelled';

  SELECT coalesce(sum(
           CASE WHEN s.delivery_outcome_recorded_at IS NOT NULL THEN si.delivered_quantity
                WHEN s.status = 'delivered' THEN si.quantity
                ELSE 0 END), 0)
    INTO _delivered_qty
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.order_id = _order_id AND s.status <> 'cancelled';

  _covered := _ordered_qty > 0 AND _shipped_qty >= _ordered_qty;

  IF _started = 0 THEN
    _next := 'not_shipped';
  ELSIF _active = 0 THEN
    IF _delivered_ship > 0 AND _partial = 0 AND _returned = 0 AND _lost = 0
       AND _ordered_qty > 0 AND _delivered_qty >= _ordered_qty THEN
      _next := 'delivered';
    ELSIF (_delivered_ship > 0 OR _partial > 0) AND (_returned > 0 OR _lost > 0) THEN
      _next := 'partially_returned';
    ELSIF _delivered_ship > 0 OR _partial > 0 THEN
      _next := 'partially_delivered';
    ELSIF _returned > 0 THEN
      _next := 'returned';
    ELSE
      _next := 'delivery_failed';
    END IF;
  ELSE
    IF _delivered_ship > 0 OR _partial > 0 THEN
      _next := 'partially_delivered';
    ELSIF _moving > 0 THEN
      _next := 'in_transit';
    ELSIF _on_hold > 0 THEN
      _next := 'on_hold';
    ELSIF _handed > 0 THEN
      _next := CASE WHEN _covered THEN 'shipped' ELSE 'partially_shipped' END;
    ELSIF _failed_active > 0 THEN
      _next := 'delivery_failed';
    ELSE
      _next := 'shipped';
    END IF;
  END IF;

  IF _next IS DISTINCT FROM _order.delivery_status THEN
    PERFORM set_config('app.delivery_write', 'on', true);
    UPDATE public.orders SET delivery_status = _next WHERE id = _order_id;
    PERFORM set_config('app.delivery_write', 'off', true);

    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id,
      'Delivery status changed from ' || _order.delivery_status::text
        || ' to ' || _next::text || ' (derived from delivered quantity across this order''s shipments).',
      'system', true, auth.uid());
  END IF;

  RETURN _next;
END; $function$;

-- Authoritative quantity-level delivery outcome workflow.
CREATE OR REPLACE FUNCTION public.record_delivery_outcome(
  _shipment_id uuid,
  _items jsonb,
  _note text DEFAULT NULL::text,
  _finalize boolean DEFAULT true)
 RETURNS shipments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.shipments;
  _item jsonb;
  _si public.shipment_items;
  _d int; _r int; _l int; _g int;
  _fingerprint text;
  _canonical text;
  _tot_ship int; _tot_d int; _tot_r int; _tot_l int; _tot_g int; _tot_class int;
  _clean text := nullif(btrim(coalesce(_note, '')), '');
  _action text;
  _failure public.shipment_failure_reason;
  _msg text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to record a delivery outcome';
  END IF;
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record delivery outcomes';
  END IF;

  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  IF _s.status NOT IN ('picked_up','in_transit','out_for_delivery','delivery_on_hold',
                       'delivery_failed','partial_delivered') THEN
    RAISE EXCEPTION 'A delivery outcome can only be recorded once the courier has the package and before the shipment is closed (this shipment is %).', _s.status;
  END IF;

  IF jsonb_typeof(coalesce(_items, 'null'::jsonb)) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Record an outcome for at least one shipment item';
  END IF;

  -- Canonical fingerprint of the submitted outcome (order-independent).
  SELECT string_agg(t.line, '|' ORDER BY t.line) INTO _canonical
  FROM (
    SELECT (e->>'shipment_item_id') || ':' ||
           coalesce((e->>'delivered_quantity')::int, 0) || ',' ||
           coalesce((e->>'refused_quantity')::int, 0) || ',' ||
           coalesce((e->>'lost_quantity')::int, 0) || ',' ||
           coalesce((e->>'damaged_quantity')::int, 0) AS line
    FROM jsonb_array_elements(_items) e
  ) t;
  _fingerprint := md5(coalesce(_canonical, '') || '|finalize:' || coalesce(_finalize, true)::text);

  IF _s.delivery_outcome_fingerprint IS NOT NULL THEN
    IF _s.delivery_outcome_fingerprint = _fingerprint THEN
      RETURN _s; -- exact replay: no further effects
    END IF;
    IF _s.delivery_outcome_recorded_at IS NOT NULL AND _s.status IN ('delivered','partial_delivered') THEN
      RAISE EXCEPTION 'A different delivery outcome was already recorded for this shipment. Use the return workflow to correct what the customer kept.';
    END IF;
  END IF;

  -- Validate and apply each line.
  PERFORM set_config('app.shipment_write', 'on', true);
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _si FROM public.shipment_items
     WHERE id = (_item->>'shipment_item_id')::uuid FOR UPDATE;
    IF _si.id IS NULL OR _si.shipment_id <> _s.id THEN
      RAISE EXCEPTION 'One of the submitted items does not belong to this shipment';
    END IF;
    _d := coalesce((_item->>'delivered_quantity')::int, 0);
    _r := coalesce((_item->>'refused_quantity')::int, 0);
    _l := coalesce((_item->>'lost_quantity')::int, 0);
    _g := coalesce((_item->>'damaged_quantity')::int, 0);
    IF _d < 0 OR _r < 0 OR _l < 0 OR _g < 0 THEN
      RAISE EXCEPTION 'Delivery outcome quantities cannot be negative';
    END IF;
    IF _d + _r + _l + _g > _si.quantity THEN
      RAISE EXCEPTION 'You recorded % unit(s) but only % unit(s) were shipped for this line.',
        _d + _r + _l + _g, _si.quantity;
    END IF;
    UPDATE public.shipment_items
       SET delivered_quantity = _d, refused_quantity = _r,
           lost_quantity = _l, damaged_quantity = _g
     WHERE id = _si.id;
  END LOOP;

  SELECT coalesce(sum(quantity),0), coalesce(sum(delivered_quantity),0),
         coalesce(sum(refused_quantity),0), coalesce(sum(lost_quantity),0),
         coalesce(sum(damaged_quantity),0)
    INTO _tot_ship, _tot_d, _tot_r, _tot_l, _tot_g
    FROM public.shipment_items WHERE shipment_id = _s.id;
  _tot_class := _tot_d + _tot_r + _tot_l + _tot_g;

  UPDATE public.shipments
     SET delivery_outcome_fingerprint = _fingerprint,
         delivery_outcome_recorded_at = CASE WHEN _finalize THEN now() ELSE delivery_outcome_recorded_at END,
         delivery_outcome_recorded_by = CASE WHEN _finalize THEN auth.uid() ELSE delivery_outcome_recorded_by END,
         updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  _msg := 'Delivery outcome recorded — delivered ' || _tot_d || ', refused ' || _tot_r
          || ', lost ' || _tot_l || ', damaged ' || _tot_g || ' of ' || _tot_ship || ' unit(s)'
          || coalesce(' — ' || _clean, '') || '.';
  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'status_updated', _s.status, _s.status, _msg,
    jsonb_build_object('delivered', _tot_d, 'refused', _tot_r, 'lost', _tot_l,
                       'damaged', _tot_g, 'shipped', _tot_ship,
                       'finalized', _finalize, 'source', 'operator'));

  IF NOT _finalize THEN
    PERFORM public.refresh_order_delivery_status(_s.order_id);
    RETURN _s;
  END IF;

  IF _tot_class < _tot_ship THEN
    RAISE EXCEPTION 'Classify every shipped unit (% of % unit(s) recorded) before finalising the outcome.',
      _tot_class, _tot_ship;
  END IF;

  -- Exceptions reuse the existing exception architecture (deduplicated per type).
  IF _tot_l > 0 THEN
    PERFORM public.create_shipment_exception(_s.id, 'lost_in_transit',
      _tot_l || ' unit(s) reported lost by the courier.', _clean);
  END IF;
  IF _tot_g > 0 THEN
    PERFORM public.create_shipment_exception(_s.id, 'damaged_in_transit',
      _tot_g || ' unit(s) reported damaged in transit.', _clean);
  END IF;
  IF _tot_r > 0 AND _tot_d > 0 THEN
    PERFORM public.create_shipment_exception(_s.id, 'partial_delivery',
      _tot_r || ' unit(s) refused, ' || _tot_d || ' unit(s) accepted.', _clean);
  ELSIF _tot_r > 0 THEN
    PERFORM public.create_shipment_exception(_s.id, 'customer_refused',
      _tot_r || ' unit(s) refused by the customer.', _clean);
  END IF;

  -- Shipment state through the existing controlled state machine only.
  IF _tot_d = _tot_ship AND _tot_ship > 0 THEN
    _action := 'mark_delivered';
  ELSIF _tot_d > 0 THEN
    _action := 'mark_partial_delivered';
  ELSIF _tot_l = _tot_ship AND _tot_ship > 0 THEN
    _action := 'mark_lost';
  ELSE
    _action := 'mark_delivery_failed';
    _failure := CASE WHEN _tot_r > 0 THEN 'customer_refused'::public.shipment_failure_reason
                     ELSE 'other'::public.shipment_failure_reason END;
  END IF;

  IF _action = 'mark_delivery_failed' THEN
    IF _s.status <> 'delivery_failed' THEN
      PERFORM public.set_shipment_state(_s.id, _action, _msg, NULL, _failure);
    END IF;
  ELSIF _action = 'mark_partial_delivered' THEN
    IF _s.status <> 'partial_delivered' THEN
      PERFORM public.set_shipment_state(_s.id, _action, _msg);
    END IF;
  ELSE
    PERFORM public.set_shipment_state(_s.id, _action, _msg);
  END IF;

  SELECT * INTO _s FROM public.shipments WHERE id = _s.id;
  PERFORM public.refresh_order_delivery_status(_s.order_id);
  RETURN _s;
END; $function$;

REVOKE ALL ON FUNCTION public.record_delivery_outcome(uuid, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_delivery_outcome(uuid, jsonb, text, boolean) TO authenticated;

-- Suggested return expectation from courier outcomes. Reporting only: physical
-- receipt, inspection and restocking stay in the existing return workflow.
CREATE OR REPLACE FUNCTION public.shipment_expected_return_items(_shipment_id uuid)
 RETURNS TABLE(order_item_id uuid, product_name text, variant_name text, sku text,
               refused_quantity integer, damaged_quantity integer,
               suggested_quantity integer, returnable_quantity integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT oi.id, oi.product_name, oi.variant_name, oi.sku,
         si.refused_quantity, si.damaged_quantity,
         least(si.refused_quantity + si.damaged_quantity,
               public.order_item_returnable_quantity(oi.id)),
         public.order_item_returnable_quantity(oi.id)
    FROM public.shipment_items si
    JOIN public.order_items oi ON oi.id = si.order_item_id
   WHERE si.shipment_id = _shipment_id
     AND (si.refused_quantity + si.damaged_quantity) > 0
     AND public.can_manage_commerce(auth.uid())
   ORDER BY oi.sort_order;
$function$;

REVOKE ALL ON FUNCTION public.shipment_expected_return_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shipment_expected_return_items(uuid) TO authenticated;
