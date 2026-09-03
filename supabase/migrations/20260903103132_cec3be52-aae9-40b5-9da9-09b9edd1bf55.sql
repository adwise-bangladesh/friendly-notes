-- Durable restock marker on returns
ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS restocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS restocked_by uuid;

/* ------------------------------------------------------------------
   1. Handover commitment must be fully covered by live reservations.
      Shortage remainders are released back to available stock.
   ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.commit_fulfillment_inventory(_fulfillment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _f public.order_fulfillments; _order public.orders;
  _it record; _res record; _need int; _take int; _cover int;
  _outstanding int; _reserved int; _excess int;
BEGIN
  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  IF _f.inventory_committed_at IS NOT NULL THEN RETURN; END IF;  -- durable idempotency

  SELECT * INTO _order FROM public.orders WHERE id = _f.order_id FOR UPDATE;

  -- Pre-flight: every actual unit must be covered by an active reservation
  -- before any stock movement is written. Nothing is changed otherwise.
  FOR _it IN
    SELECT fi.order_item_id,
           greatest(coalesce(nullif(fi.packed_quantity, 0), fi.picked_quantity), 0)::int AS qty,
           oi.product_name
      FROM public.order_fulfillment_items fi
      JOIN public.order_items oi ON oi.id = fi.order_item_id
     WHERE fi.fulfillment_id = _f.id
     ORDER BY fi.id
  LOOP
    CONTINUE WHEN _it.qty <= 0;
    SELECT coalesce(sum(greatest(quantity - committed_quantity, 0)), 0) INTO _cover
      FROM public.inventory_reservations
     WHERE order_id = _f.order_id AND order_item_id = _it.order_item_id AND status = 'active';
    IF _cover < _it.qty THEN
      RAISE EXCEPTION 'Stock for "%" is not reserved for this order (% of % unit(s) reserved). Reserve the stock before handing the package to the courier.',
        _it.product_name, _cover, _it.qty;
    END IF;
  END LOOP;

  FOR _it IN
    SELECT fi.order_item_id,
           greatest(coalesce(nullif(fi.packed_quantity, 0), fi.picked_quantity), 0)::int AS qty
      FROM public.order_fulfillment_items fi
     WHERE fi.fulfillment_id = _f.id
     ORDER BY fi.id
  LOOP
    _need := _it.qty;
    CONTINUE WHEN _need <= 0;

    FOR _res IN
      SELECT * FROM public.inventory_reservations
       WHERE order_id = _f.order_id AND order_item_id = _it.order_item_id
         AND status = 'active' AND quantity > committed_quantity
       ORDER BY id FOR UPDATE
    LOOP
      EXIT WHEN _need <= 0;
      _take := least(_need, _res.quantity - _res.committed_quantity);

      PERFORM public.apply_inventory_movement(
        _res.inventory_level_id, 'fulfillment_out', _take,
        'Handed over for order ' || _order.order_number
          || ' (fulfillment #' || _f.fulfillment_number || ')',
        'order_fulfillment', _f.id);

      PERFORM set_config('app.reservation_write', 'on', true);
      UPDATE public.inventory_reservations
         SET committed_quantity = committed_quantity + _take,
             status = CASE WHEN committed_quantity + _take >= quantity
                           THEN 'committed'::public.reservation_record_status ELSE status END,
             committed_at = coalesce(committed_at, now()),
             committed_by = auth.uid()
       WHERE id = _res.id;
      PERFORM set_config('app.reservation_write', 'off', true);

      _need := _need - _take;
    END LOOP;

    IF _need > 0 THEN
      RAISE EXCEPTION 'Reserved stock changed while committing this handover. Try again.';
    END IF;
  END LOOP;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  UPDATE public.order_fulfillments
     SET inventory_committed_at = now(), inventory_committed_by = auth.uid()
   WHERE id = _f.id;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  -- Release reservation remainders that no open fulfillment still needs
  -- (shortages, cancelled lines) so the stock becomes available again.
  FOR _it IN
    SELECT DISTINCT fi.order_item_id
      FROM public.order_fulfillment_items fi
     WHERE fi.fulfillment_id = _f.id
  LOOP
    SELECT coalesce(sum(fi.quantity), 0) INTO _outstanding
      FROM public.order_fulfillment_items fi
      JOIN public.order_fulfillments f ON f.id = fi.fulfillment_id
     WHERE f.order_id = _f.order_id AND f.status <> 'cancelled'
       AND f.inventory_committed_at IS NULL
       AND fi.order_item_id = _it.order_item_id;

    SELECT coalesce(sum(greatest(quantity - committed_quantity, 0)), 0) INTO _reserved
      FROM public.inventory_reservations
     WHERE order_id = _f.order_id AND order_item_id = _it.order_item_id AND status = 'active';

    _excess := _reserved - _outstanding;
    CONTINUE WHEN _excess <= 0;

    FOR _res IN
      SELECT * FROM public.inventory_reservations
       WHERE order_id = _f.order_id AND order_item_id = _it.order_item_id
         AND status = 'active' AND quantity > committed_quantity
       ORDER BY id FOR UPDATE
    LOOP
      EXIT WHEN _excess <= 0;
      _take := least(_excess, _res.quantity - _res.committed_quantity);

      PERFORM public.apply_inventory_movement(
        _res.inventory_level_id, 'release_reservation', _take,
        'Unpicked remainder released for order ' || _order.order_number
          || ' (fulfillment #' || _f.fulfillment_number || ')',
        'order_fulfillment', _f.id);

      PERFORM set_config('app.reservation_write', 'on', true);
      UPDATE public.inventory_reservations
         SET quantity = quantity - _take,
             status = CASE WHEN quantity - _take <= committed_quantity
                           THEN CASE WHEN committed_quantity > 0
                                     THEN 'committed'::public.reservation_record_status
                                     ELSE 'released'::public.reservation_record_status END
                           ELSE status END,
             released_at = CASE WHEN quantity - _take <= committed_quantity THEN now() ELSE released_at END,
             released_by = CASE WHEN quantity - _take <= committed_quantity THEN auth.uid() ELSE released_by END
       WHERE id = _res.id;
      PERFORM set_config('app.reservation_write', 'off', true);

      _excess := _excess - _take;
    END LOOP;
  END LOOP;

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_f.order_id,
    'Stock committed for fulfillment #' || _f.fulfillment_number || ' at courier handover.',
    'system', true, auth.uid());
END; $function$;

/* ------------------------------------------------------------------
   2. Fulfillment projection uses actual quantities once committed.
   ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.refresh_order_fulfillment_projection(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders;
  _active int; _min int; _hold boolean; _covered int; _ordered int;
  _next public.order_fulfillment_status; _reason text;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO _active
    FROM public.order_fulfillments WHERE order_id = _order_id AND status <> 'cancelled';

  IF _active = 0 THEN
    _next := CASE
      WHEN _order.reservation_status IN ('reserved','not_required') THEN 'ready'::public.order_fulfillment_status
      WHEN _order.fulfillment_status = 'on_hold' THEN 'on_hold'::public.order_fulfillment_status
      ELSE 'not_started'::public.order_fulfillment_status END;
    _reason := _order.fulfillment_hold_reason;
  ELSE
    SELECT bool_or(status IN ('on_hold','qc_failed')) INTO _hold
      FROM public.order_fulfillments WHERE order_id = _order_id AND status <> 'cancelled';

    IF _hold THEN
      _next := 'on_hold';
      SELECT coalesce(min(coalesce(hold_reason, 'Fulfillment #' || fulfillment_number || ' needs attention.')), 'A fulfillment needs attention.')
        INTO _reason
        FROM public.order_fulfillments
       WHERE order_id = _order_id AND status IN ('on_hold','qc_failed');
    ELSE
      SELECT min(CASE status
                   WHEN 'unfulfilled' THEN 1 WHEN 'ready_to_pick' THEN 1
                   WHEN 'picking' THEN 2 WHEN 'picked' THEN 3
                   WHEN 'packing' THEN 4 WHEN 'qc_pending' THEN 4
                   WHEN 'packed' THEN 5 WHEN 'ready_for_handover' THEN 6
                   ELSE 1 END)
        INTO _min
        FROM public.order_fulfillments WHERE order_id = _order_id AND status <> 'cancelled';

      SELECT coalesce(sum(quantity),0) INTO _ordered FROM public.order_items WHERE order_id = _order_id;
      -- Committed fulfillments count what actually left; open ones count their plan.
      SELECT coalesce(sum(
               CASE WHEN f.inventory_committed_at IS NOT NULL
                    THEN greatest(coalesce(nullif(fi.packed_quantity, 0), fi.picked_quantity), 0)
                    ELSE fi.quantity END), 0)
        INTO _covered
        FROM public.order_fulfillment_items fi
        JOIN public.order_fulfillments f ON f.id = fi.fulfillment_id
       WHERE f.order_id = _order_id AND f.status <> 'cancelled';

      _next := CASE _min
        WHEN 1 THEN 'ready'::public.order_fulfillment_status
        WHEN 2 THEN 'picking'::public.order_fulfillment_status
        WHEN 3 THEN 'picked'::public.order_fulfillment_status
        WHEN 4 THEN 'packing'::public.order_fulfillment_status
        WHEN 5 THEN 'packed'::public.order_fulfillment_status
        ELSE CASE WHEN _covered >= _ordered
                  THEN 'ready_for_courier'::public.order_fulfillment_status
                  ELSE 'packing'::public.order_fulfillment_status END
      END;
      _reason := NULL;
    END IF;
  END IF;

  IF _next IS DISTINCT FROM _order.fulfillment_status
     OR (_next <> 'on_hold' AND _order.fulfillment_hold_reason IS NOT NULL) THEN
    PERFORM set_config('app.fulfillment_write', 'on', true);
    UPDATE public.orders
       SET fulfillment_status = _next,
           fulfillment_hold_reason = CASE WHEN _next = 'on_hold' THEN _reason ELSE NULL END,
           packed_at = CASE WHEN _next IN ('packed','ready_for_courier') AND packed_at IS NULL
                            THEN now() ELSE packed_at END,
           updated_by = auth.uid()
     WHERE id = _order_id;
    PERFORM set_config('app.fulfillment_write', 'off', true);
  END IF;
END; $function$;

/* ------------------------------------------------------------------
   3. Return eligibility is bounded by what physically left the warehouse
      minus what is already covered by other returns.
   ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.order_item_returnable_quantity(_order_item_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _oi public.order_items; _out int; _already int; _shipped int;
BEGIN
  SELECT * INTO _oi FROM public.order_items WHERE id = _order_item_id;
  IF _oi.id IS NULL THEN RETURN 0; END IF;

  SELECT coalesce(sum(greatest(coalesce(nullif(fi.packed_quantity, 0), fi.picked_quantity), 0)), 0)
    INTO _out
    FROM public.order_fulfillment_items fi
    JOIN public.order_fulfillments f ON f.id = fi.fulfillment_id
   WHERE fi.order_item_id = _order_item_id AND f.inventory_committed_at IS NOT NULL;

  IF _out = 0 THEN
    SELECT coalesce(sum(si.quantity), 0) INTO _shipped
      FROM public.shipment_items si
      JOIN public.shipments s ON s.id = si.shipment_id
     WHERE si.order_item_id = _order_item_id AND s.status NOT IN ('draft','cancelled');
    _out := _shipped;
  END IF;

  SELECT coalesce(sum(ri.quantity_expected), 0) INTO _already
    FROM public.order_return_items ri
    JOIN public.order_returns r ON r.id = ri.return_id
   WHERE ri.order_item_id = _order_item_id AND r.status <> 'cancelled';

  RETURN greatest(_out - _already, 0);
END; $function$;

GRANT EXECUTE ON FUNCTION public.order_item_returnable_quantity(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_order_return(_order_id uuid, _shipment_id uuid DEFAULT NULL::uuid, _return_type order_return_type DEFAULT 'return_to_merchant'::order_return_type, _reason text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _tracking_reference text DEFAULT NULL::text, _items jsonb DEFAULT '[]'::jsonb, _courier_reason text DEFAULT NULL::text, _source text DEFAULT 'manual'::text)
 RETURNS order_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.order_returns; _order public.orders; _item jsonb; _oi public.order_items; _qty integer;
  _allowed integer;
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

  IF NOT _internal AND NOT EXISTS (
      SELECT 1 FROM public.order_fulfillments
       WHERE order_id = _order_id AND inventory_committed_at IS NOT NULL)
     AND NOT EXISTS (
      SELECT 1 FROM public.shipments
       WHERE order_id = _order_id AND status NOT IN ('draft','cancelled')) THEN
    RAISE EXCEPTION 'Nothing has physically left the warehouse for this order, so there is nothing to return. Cancel the order or the fulfillment instead.';
  END IF;

  IF _shipment_id IS NOT NULL THEN
    SELECT * INTO _r FROM public.order_returns
     WHERE shipment_id = _shipment_id AND status IN ('pending','in_transit','received','inspected')
     FOR UPDATE;
    IF _r.id IS NOT NULL THEN RETURN _r; END IF;
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
    _allowed := public.order_item_returnable_quantity(_oi.id);
    IF _qty > _allowed THEN
      RAISE EXCEPTION 'Only % unit(s) of "%" can still be returned (units that actually shipped, minus units already covered by another return).',
        _allowed, _oi.product_name;
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
END; $function$;

/* ------------------------------------------------------------------
   4. Returned goods re-enter stock exactly once, per disposition.
   ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.restock_return_inventory(_return_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.order_returns; _order public.orders; _row record;
  _level uuid; _loc uuid; _good int; _bad int; _lines int := 0;
BEGIN
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _r.restocked_at IS NOT NULL THEN RETURN; END IF;   -- durable idempotency

  SELECT * INTO _order FROM public.orders WHERE id = _r.order_id;

  FOR _row IN
    SELECT ri.id, ri.order_item_id, ri.quantity_received, ri.quantity_accepted,
           oi.product_id, oi.variant_id, oi.product_name
      FROM public.order_return_items ri
      JOIN public.order_items oi ON oi.id = ri.order_item_id
     WHERE ri.return_id = _r.id
     ORDER BY ri.id
  LOOP
    _good := greatest(coalesce(_row.quantity_accepted, 0), 0);
    _bad := greatest(coalesce(_row.quantity_received, 0) - _good, 0);
    CONTINUE WHEN _good = 0 AND _bad = 0;

    SELECT inventory_level_id INTO _level
      FROM public.inventory_reservations
     WHERE order_id = _r.order_id AND order_item_id = _row.order_item_id
     ORDER BY committed_quantity DESC, id
     LIMIT 1;

    IF _level IS NULL THEN
      SELECT id INTO _loc FROM public.inventory_locations
       WHERE status <> 'archived' ORDER BY is_default DESC, created_at LIMIT 1;
      IF _loc IS NULL THEN
        RAISE EXCEPTION 'No active stock location is available to receive returned goods.';
      END IF;
      _level := public.ensure_inventory_level_internal(_loc, _row.product_id, _row.variant_id);
    END IF;

    IF _good > 0 THEN
      PERFORM public.apply_inventory_movement(
        _level, 'return_in', _good,
        'Returned to sellable stock — return ' || _r.return_number
          || ' (order ' || _order.order_number || ')',
        'order_return', _r.id);
    END IF;

    IF _bad > 0 THEN
      PERFORM public.apply_inventory_movement(
        _level, 'return_in', _bad,
        'Returned (pending write-off) — return ' || _r.return_number,
        'order_return', _r.id);
      PERFORM public.apply_inventory_movement(
        _level, 'damage', _bad,
        'Returned goods not accepted — return ' || _r.return_number,
        'order_return', _r.id);
    END IF;

    _lines := _lines + 1;
  END LOOP;

  PERFORM set_config('app.return_write', 'on', true);
  UPDATE public.order_returns
     SET restocked_at = now(), restocked_by = auth.uid()
   WHERE id = _r.id;
  PERFORM set_config('app.return_write', 'off', true);

  IF _lines > 0 THEN
    PERFORM public.log_return_event(_r.id, _r.order_id, 'return_completed', _r.status, _r.status,
      'Stock updated from this return for ' || _lines || ' line(s): accepted units returned to sellable stock, rejected units recorded as damaged.',
      jsonb_build_object('restocked', true));
  END IF;
END; $function$;

/* set_return_state: restock on completion */
CREATE OR REPLACE FUNCTION public.set_return_state(_return_id uuid, _action text, _reason text DEFAULT NULL::text)
 RETURNS order_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.order_returns;
  _from public.order_return_status;
  _next public.order_return_status;
  _event public.return_event_type := 'status_changed';
  _clean text := nullif(btrim(coalesce(_reason,'')),'');
  _pending integer;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change return state';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  _from := _r.status;

  CASE _action
    WHEN 'mark_in_transit' THEN _next := 'in_transit';
    WHEN 'mark_received'   THEN _next := 'received';
    WHEN 'mark_inspected'  THEN _next := 'inspected';
    WHEN 'complete'        THEN _next := 'completed'; _event := 'return_completed';
    WHEN 'cancel'          THEN _next := 'cancelled'; _event := 'return_cancelled';
    WHEN 'mark_lost'       THEN _next := 'lost';      _event := 'return_lost';
    ELSE RAISE EXCEPTION 'Unknown return action: %', _action;
  END CASE;

  IF NOT public.return_transition_valid(_from, _next) THEN
    RAISE EXCEPTION 'A return cannot move from % to %', _from, _next;
  END IF;
  IF _next = 'lost' AND _clean IS NULL THEN
    RAISE EXCEPTION 'A reason is required when marking a return lost';
  END IF;
  IF _next = 'cancelled' AND _clean IS NULL THEN
    RAISE EXCEPTION 'A reason is required when cancelling a return';
  END IF;
  IF _next = 'inspected' THEN
    SELECT count(*) INTO _pending FROM public.order_return_items
     WHERE return_id = _r.id AND condition = 'unknown';
    IF _pending > 0 THEN
      RAISE EXCEPTION 'Record the condition of every returned line before finishing inspection';
    END IF;
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  UPDATE public.order_returns SET
    status = _next,
    initiated_at = CASE WHEN _next = 'in_transit' AND initiated_at IS NULL THEN now() ELSE initiated_at END,
    received_at  = CASE WHEN _next = 'received'  AND received_at  IS NULL THEN now() ELSE received_at END,
    inspected_at = CASE WHEN _next = 'inspected' AND inspected_at IS NULL THEN now() ELSE inspected_at END,
    completed_at = CASE WHEN _next = 'completed' THEN now() ELSE completed_at END,
    cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END,
    resolution_note = CASE WHEN _next IN ('completed','cancelled','lost') THEN _clean ELSE resolution_note END,
    notes = CASE WHEN _next NOT IN ('completed','cancelled','lost') AND _clean IS NOT NULL
                 THEN coalesce(notes || E'\n','') || _clean ELSE notes END,
    updated_by = auth.uid()
  WHERE id = _r.id RETURNING * INTO _r;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _r.order_id, _event, _from, _next,
    'Return moved from ' || _from::text || ' to ' || _next::text || coalesce(' — ' || _clean, '') || '.',
    jsonb_build_object('action', _action));

  -- Completion is the physical settlement point: goods re-enter stock here.
  IF _next = 'completed' THEN
    PERFORM public.restock_return_inventory(_r.id);
    SELECT * INTO _r FROM public.order_returns WHERE id = _r.id;
  END IF;

  RETURN _r;
END; $function$;

/* inspection message no longer claims inventory is never changed */
CREATE OR REPLACE FUNCTION public.inspect_return_items(_return_id uuid, _items jsonb, _note text DEFAULT NULL::text)
 RETURNS order_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.order_returns;
  _item jsonb;
  _ri public.order_return_items;
  _received integer;
  _accepted integer;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to inspect returns';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _r.status NOT IN ('received','inspected') THEN
    RAISE EXCEPTION 'A return can only be inspected after it has been received';
  END IF;
  IF _r.restocked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This return has already updated stock and can no longer be re-inspected';
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  FOR _item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _ri FROM public.order_return_items
     WHERE id = (_item->>'id')::uuid AND return_id = _r.id FOR UPDATE;
    IF _ri.id IS NULL THEN RAISE EXCEPTION 'Return line not found'; END IF;
    _received := coalesce((_item->>'quantity_received')::int, _ri.quantity_received);
    _accepted := coalesce((_item->>'quantity_accepted')::int, _ri.quantity_accepted);
    IF _received < 0 OR _accepted < 0 THEN RAISE EXCEPTION 'Quantities cannot be negative'; END IF;
    IF _received > _ri.quantity_expected THEN
      RAISE EXCEPTION 'Received quantity cannot exceed the expected quantity (%).', _ri.quantity_expected;
    END IF;
    IF _accepted > _received THEN
      RAISE EXCEPTION 'Accepted quantity cannot exceed the received quantity (%).', _received;
    END IF;
    UPDATE public.order_return_items SET
      quantity_received = _received,
      quantity_accepted = _accepted,
      condition = coalesce((_item->>'condition')::public.return_item_condition, condition),
      notes = coalesce(nullif(btrim(coalesce(_item->>'notes','')),''), notes)
    WHERE id = _ri.id;
  END LOOP;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _r.order_id, 'inspection_recorded', _r.status, _r.status,
    'Inspection recorded' || coalesce(' — ' || nullif(btrim(coalesce(_note,'')),''), '')
      || '. Stock is updated when the return is completed.',
    jsonb_build_object('items', _items));
  RETURN _r;
END; $function$;

CREATE OR REPLACE FUNCTION public.record_return_receipt(_return_id uuid, _items jsonb, _note text DEFAULT NULL::text)
 RETURNS order_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.order_returns;
  _item jsonb;
  _ri public.order_return_items;
  _qty integer;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to receive returns';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _r.status NOT IN ('received','inspected') THEN
    RAISE EXCEPTION 'Mark the return received before recording arrived quantities';
  END IF;
  IF _r.restocked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This return has already updated stock and can no longer be changed';
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  FOR _item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _ri FROM public.order_return_items
     WHERE id = (_item->>'id')::uuid AND return_id = _r.id FOR UPDATE;
    IF _ri.id IS NULL THEN RAISE EXCEPTION 'Return line not found'; END IF;
    _qty := coalesce((_item->>'quantity_received')::int, _ri.quantity_received);
    IF _qty < 0 THEN RAISE EXCEPTION 'Received quantity cannot be negative'; END IF;
    IF _qty > _ri.quantity_expected THEN
      RAISE EXCEPTION 'Received quantity cannot exceed the expected quantity (%).', _ri.quantity_expected;
    END IF;
    UPDATE public.order_return_items SET
      quantity_received = _qty,
      quantity_accepted = least(quantity_accepted, _qty),
      notes = coalesce(nullif(btrim(coalesce(_item->>'notes','')),''), notes)
    WHERE id = _ri.id;
  END LOOP;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _r.order_id, 'items_received', _r.status, _r.status,
    'Physical receipt recorded' || coalesce(' — ' || nullif(btrim(coalesce(_note,'')),''), '') || '.',
    jsonb_build_object('items', _items));
  RETURN _r;
END; $function$;

/* ------------------------------------------------------------------
   5. Shared shipment -> return linkage (courier and manual paths).
   ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.ensure_shipment_return(_shipment_id uuid, _target order_return_status, _reason text, _at timestamptz, _provider_event text DEFAULT NULL::text)
 RETURNS order_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.shipments; _r public.order_returns; _rank_from int; _rank_to int;
  _was boolean := coalesce(current_setting('app.courier_ingest', true), '') = 'on';
BEGIN
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id;
  IF _s.id IS NULL THEN RETURN NULL; END IF;

  IF NOT _was THEN PERFORM set_config('app.courier_ingest', 'on', true); END IF;

  SELECT * INTO _r FROM public.order_returns
   WHERE shipment_id = _s.id AND status IN ('pending','in_transit','received','inspected')
   FOR UPDATE;
  IF _r.id IS NULL THEN
    _r := public.create_order_return(
      _s.order_id, _s.id, 'return_to_merchant',
      coalesce(_reason, 'The package is coming back from the courier'), NULL,
      _s.return_tracking_number, '[]'::jsonb, _reason, 'courier');
  END IF;

  _rank_from := CASE _r.status WHEN 'pending' THEN 1 WHEN 'in_transit' THEN 2
                               WHEN 'received' THEN 3 WHEN 'inspected' THEN 4 ELSE 9 END;
  _rank_to := CASE _target WHEN 'pending' THEN 1 WHEN 'in_transit' THEN 2
                           WHEN 'received' THEN 3 ELSE 9 END;

  IF _rank_to > _rank_from AND public.return_transition_valid(_r.status, _target) THEN
    PERFORM set_config('app.return_write', 'on', true);
    UPDATE public.order_returns SET
      status = _target,
      courier_reason = coalesce(nullif(btrim(coalesce(_reason,'')),''), courier_reason),
      tracking_reference = coalesce(tracking_reference, _s.return_tracking_number),
      initiated_at = CASE WHEN _target = 'in_transit' AND initiated_at IS NULL THEN _at ELSE initiated_at END,
      received_at  = CASE WHEN _target = 'received'  AND received_at  IS NULL THEN _at ELSE received_at END
    WHERE id = _r.id;
    PERFORM set_config('app.return_write', 'off', true);
    PERFORM public.log_return_event(_r.id, _r.order_id, 'provider_event', _r.status, _target,
      CASE WHEN _provider_event IS NOT NULL
           THEN 'Courier reported "' || _provider_event || '".'
           ELSE 'Shipment return progress recorded by an operator.' END,
      jsonb_build_object('provider_event', _provider_event, 'provider_event_at', _at));
    SELECT * INTO _r FROM public.order_returns WHERE id = _r.id;
  END IF;

  IF NOT _was THEN PERFORM set_config('app.courier_ingest', 'off', true); END IF;
  RETURN _r;
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_courier_operational_effects(_shipment_id uuid, _event_type shipment_event_type, _provider_event text, _at timestamp with time zone, _payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.shipments;
  _reason text;
  _amount numeric;
  _etype public.shipment_exception_type;
  _target public.order_return_status;
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
    PERFORM public.ensure_shipment_return(_s.id, _target, _reason, _at, _provider_event);
  END IF;

  PERFORM set_config('app.courier_ingest', 'off', true);
END; $function$;