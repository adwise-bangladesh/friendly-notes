
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
  _target public.shipment_status;
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
      RETURN _s;
    END IF;
    IF _s.delivery_outcome_recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'A different delivery outcome was already recorded for this shipment. Use the return workflow to correct what the customer kept.';
    END IF;
  END IF;

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

  IF _tot_d = _tot_ship AND _tot_ship > 0 THEN
    _action := 'mark_delivered'; _target := 'delivered';
  ELSIF _tot_d > 0 THEN
    _action := 'mark_partial_delivered'; _target := 'partial_delivered';
  ELSIF _tot_l = _tot_ship AND _tot_ship > 0 THEN
    _action := 'mark_lost'; _target := 'lost';
  ELSE
    _action := 'mark_delivery_failed'; _target := 'delivery_failed';
    _failure := CASE WHEN _tot_r > 0 THEN 'customer_refused'::public.shipment_failure_reason
                     ELSE 'other'::public.shipment_failure_reason END;
  END IF;

  IF _s.status = _target THEN
    NULL; -- already in the state this outcome implies
  ELSIF public.shipment_transition_valid(_s.status, _target) THEN
    IF _action = 'mark_delivery_failed' THEN
      PERFORM public.set_shipment_state(_s.id, _action, _msg, NULL, _failure);
    ELSE
      PERFORM public.set_shipment_state(_s.id, _action, _msg);
    END IF;
  ELSE
    PERFORM public.log_shipment_event(_s.id, _s.order_id, 'status_updated', _s.status, _s.status,
      'Quantities recorded. The shipment stays ' || _s.status::text
        || ' because moving it to ' || _target::text || ' is not a valid next step.',
      jsonb_build_object('blocked_target', _target::text));
  END IF;

  SELECT * INTO _s FROM public.shipments WHERE id = _s.id;
  PERFORM public.refresh_order_delivery_status(_s.order_id);
  RETURN _s;
END; $function$;

REVOKE ALL ON FUNCTION public.record_delivery_outcome(uuid, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_delivery_outcome(uuid, jsonb, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.courier_credentials_purge_vault() FROM PUBLIC, anon, authenticated;
