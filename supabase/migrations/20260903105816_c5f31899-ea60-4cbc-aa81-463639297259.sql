-- 1. Durable per-line physical receipt marker -------------------------------
ALTER TABLE public.order_return_items
  ADD COLUMN IF NOT EXISTS received_recorded_at timestamptz;

-- Existing lines that already carry a count are treated as recorded.
UPDATE public.order_return_items
   SET received_recorded_at = coalesce(received_recorded_at, updated_at)
 WHERE quantity_received > 0 AND received_recorded_at IS NULL;

-- 2. Quantity-aware delivery projection -------------------------------------
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
  _ordered_qty int; _shipped_qty int; _delivered_qty int; _target_qty int;
  _committed_qty int; _open_ff int; _committed_ff int;
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

  -- Quantity that actually reached the customer: only fully delivered shipments
  -- count. A partially delivered shipment never counts as delivered quantity.
  SELECT coalesce(sum(si.quantity), 0) INTO _delivered_qty
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.order_id = _order_id AND s.status = 'delivered';

  -- Warehouse truth: once every fulfillment is committed (handed over), the
  -- quantity that can ever be delivered is what physically left the warehouse.
  SELECT count(*) FILTER (WHERE f.inventory_committed_at IS NULL),
         count(*) FILTER (WHERE f.inventory_committed_at IS NOT NULL)
    INTO _open_ff, _committed_ff
    FROM public.order_fulfillments f
   WHERE f.order_id = _order_id AND f.status <> 'cancelled';

  SELECT coalesce(sum(greatest(coalesce(nullif(fi.packed_quantity, 0), fi.picked_quantity), 0)), 0)
    INTO _committed_qty
    FROM public.order_fulfillment_items fi
    JOIN public.order_fulfillments f ON f.id = fi.fulfillment_id
   WHERE f.order_id = _order_id AND f.status <> 'cancelled'
     AND f.inventory_committed_at IS NOT NULL;

  _target_qty := CASE
    WHEN _committed_ff > 0 AND _open_ff = 0 THEN greatest(_committed_qty, 0)
    ELSE _ordered_qty END;

  _covered := _target_qty > 0 AND _shipped_qty >= _target_qty;

  IF _started = 0 THEN
    _next := 'not_shipped';

  ELSIF _active = 0 THEN
    -- every started shipment reached a final outcome
    IF _delivered_ship > 0 AND _partial = 0 AND _returned = 0 AND _lost = 0
       AND _target_qty > 0 AND _delivered_qty >= _target_qty THEN
      _next := 'delivered';
    ELSIF (_delivered_ship > 0 OR _partial > 0) AND (_returned > 0 OR _lost > 0) THEN
      _next := 'partially_returned';
    ELSIF _delivered_ship > 0 OR _partial > 0 THEN
      -- something arrived, but not the whole quantity that must still arrive
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

-- 3. Warehouse-side terminal fulfillment projection --------------------------
CREATE OR REPLACE FUNCTION public.refresh_order_fulfillment_projection(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders;
  _active int; _open int; _min int; _hold boolean; _covered int; _committed int; _ordered int;
  _next public.order_fulfillment_status; _reason text;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE inventory_committed_at IS NULL)
    INTO _active, _open
    FROM public.order_fulfillments WHERE order_id = _order_id AND status <> 'cancelled';

  SELECT coalesce(sum(quantity),0) INTO _ordered FROM public.order_items WHERE order_id = _order_id;

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
      -- Quantity actually handed over (committed) vs quantity still planned.
      SELECT coalesce(sum(
               CASE WHEN f.inventory_committed_at IS NOT NULL
                    THEN greatest(coalesce(nullif(fi.packed_quantity, 0), fi.picked_quantity), 0)
                    ELSE fi.quantity END), 0),
             coalesce(sum(
               CASE WHEN f.inventory_committed_at IS NOT NULL
                    THEN greatest(coalesce(nullif(fi.packed_quantity, 0), fi.picked_quantity), 0)
                    ELSE 0 END), 0)
        INTO _covered, _committed
        FROM public.order_fulfillment_items fi
        JOIN public.order_fulfillments f ON f.id = fi.fulfillment_id
       WHERE f.order_id = _order_id AND f.status <> 'cancelled';

      IF _open = 0 THEN
        -- Warehouse work is finished: this is the terminal warehouse meaning.
        -- Delivery progress is tracked separately on delivery_status.
        _next := CASE WHEN _committed >= _ordered AND _ordered > 0
                      THEN 'fulfilled'::public.order_fulfillment_status
                      ELSE 'partially_fulfilled'::public.order_fulfillment_status END;
      ELSE
        SELECT min(CASE status
                     WHEN 'unfulfilled' THEN 1 WHEN 'ready_to_pick' THEN 1
                     WHEN 'picking' THEN 2 WHEN 'picked' THEN 3
                     WHEN 'packing' THEN 4 WHEN 'qc_pending' THEN 4
                     WHEN 'packed' THEN 5 WHEN 'ready_for_handover' THEN 6
                     ELSE 1 END)
          INTO _min
          FROM public.order_fulfillments
         WHERE order_id = _order_id AND status <> 'cancelled' AND inventory_committed_at IS NULL;

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
      END IF;
      _reason := NULL;
    END IF;
  END IF;

  IF _next IS DISTINCT FROM _order.fulfillment_status
     OR (_next <> 'on_hold' AND _order.fulfillment_hold_reason IS NOT NULL) THEN
    PERFORM set_config('app.fulfillment_write', 'on', true);
    UPDATE public.orders
       SET fulfillment_status = _next,
           fulfillment_hold_reason = CASE WHEN _next = 'on_hold' THEN _reason ELSE NULL END,
           packed_at = CASE WHEN _next IN ('packed','ready_for_courier','partially_fulfilled','fulfilled')
                             AND packed_at IS NULL THEN now() ELSE packed_at END,
           updated_by = auth.uid()
     WHERE id = _order_id;
    PERFORM set_config('app.fulfillment_write', 'off', true);
  END IF;
END; $function$;

-- 4. Return receipt: replay-safe, overwrite-proof ----------------------------
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
  _changed int := 0;
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

    IF _ri.received_recorded_at IS NOT NULL THEN
      -- Exact replay is a safe no-op; a different count is a conflicting
      -- overwrite of a physical record and is refused.
      IF _qty <> _ri.quantity_received THEN
        RAISE EXCEPTION 'The physical count for this line was already recorded as % unit(s) and cannot be changed. Add a note or open a new return instead.',
          _ri.quantity_received;
      END IF;
      CONTINUE;
    END IF;

    UPDATE public.order_return_items SET
      quantity_received = _qty,
      quantity_accepted = least(quantity_accepted, _qty),
      received_recorded_at = now(),
      notes = coalesce(nullif(btrim(coalesce(_item->>'notes','')),''), notes)
    WHERE id = _ri.id;
    _changed := _changed + 1;
  END LOOP;
  PERFORM set_config('app.return_write', 'off', true);

  -- No history entry for an exact replay: the physical record did not change.
  IF _changed > 0 THEN
    PERFORM public.log_return_event(_r.id, _r.order_id, 'items_received', _r.status, _r.status,
      'Physical receipt recorded' || coalesce(' — ' || nullif(btrim(coalesce(_note,'')),''), '') || '.',
      jsonb_build_object('items', _items));
  END IF;
  RETURN _r;
END; $function$;

-- 5. Inspection: receipt first, bounded by the counted quantity --------------
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
  _accepted integer;
  _cond text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to inspect returns';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _r.status NOT IN ('received','inspected') THEN
    RAISE EXCEPTION 'This return must be received before inspection';
  END IF;
  IF _r.restocked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This return has already updated stock and can no longer be re-inspected';
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  FOR _item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _ri FROM public.order_return_items
     WHERE id = (_item->>'id')::uuid AND return_id = _r.id FOR UPDATE;
    IF _ri.id IS NULL THEN RAISE EXCEPTION 'Return line not found'; END IF;
    IF _ri.received_recorded_at IS NULL THEN
      RAISE EXCEPTION 'Record how many units physically arrived for this line before grading it';
    END IF;

    _accepted := coalesce((_item->>'quantity_accepted')::int, _ri.quantity_accepted);
    IF _accepted < 0 THEN RAISE EXCEPTION 'Quantities cannot be negative'; END IF;
    IF _accepted > _ri.quantity_received THEN
      RAISE EXCEPTION 'Inspection quantity cannot exceed the received quantity (%).', _ri.quantity_received;
    END IF;

    _cond := nullif(btrim(coalesce(_item->>'condition','')),'');
    IF _cond IS NOT NULL AND _cond NOT IN ('unknown','good','opened','damaged','missing','unusable') THEN
      RAISE EXCEPTION 'Unknown item condition. Choose one of the listed condition options.';
    END IF;

    -- Inspection grades goods; it never rewrites the physical count.
    UPDATE public.order_return_items SET
      quantity_accepted = _accepted,
      condition = coalesce(_cond::public.return_item_condition, condition),
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

-- 6. Exception resolution classification -------------------------------------
CREATE OR REPLACE FUNCTION public.exception_resolution_class(_type public.shipment_exception_type)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _type::text
    WHEN 'delivery_failed'   THEN 'shipment'
    WHEN 'delivery_on_hold'  THEN 'shipment'
    WHEN 'pickup_failed'     THEN 'shipment'
    WHEN 'pickup_cancelled'  THEN 'shipment'
    WHEN 'partial_delivery'  THEN 'shipment'
    WHEN 'customer_refused'  THEN 'return'
    WHEN 'damaged_in_transit' THEN 'return'
    WHEN 'lost_in_transit'   THEN 'return'
    ELSE 'informational'
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.exception_resolution_class(public.shipment_exception_type) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_exception_state(_exception_id uuid, _action text, _note text DEFAULT NULL::text)
 RETURNS shipment_exceptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _e public.shipment_exceptions;
  _next public.shipment_exception_status;
  _clean text := nullif(btrim(coalesce(_note,'')),'');
  _class text;
  _ship public.shipments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to handle delivery exceptions';
  END IF;
  SELECT * INTO _e FROM public.shipment_exceptions WHERE id = _exception_id FOR UPDATE;
  IF _e.id IS NULL THEN RAISE EXCEPTION 'Exception not found'; END IF;
  _class := public.exception_resolution_class(_e.exception_type);

  CASE _action
    WHEN 'start_review' THEN
      IF _e.status <> 'open' THEN RAISE EXCEPTION 'Only an open exception can move to review'; END IF;
      _next := 'under_review';
    WHEN 'resolve' THEN
      IF _e.status NOT IN ('open','under_review') THEN
        RAISE EXCEPTION 'Only an open or in-review exception can be resolved';
      END IF;
      IF _clean IS NULL THEN RAISE EXCEPTION 'A resolution note is required'; END IF;

      -- Resolution may never imply an operational outcome the authoritative
      -- shipment / return workflow has not actually recorded.
      SELECT * INTO _ship FROM public.shipments WHERE id = _e.shipment_id;

      IF _class = 'shipment' THEN
        IF _ship.id IS NOT NULL AND _ship.status IN ('delivery_failed','delivery_on_hold','pickup_failed') THEN
          RAISE EXCEPTION 'Record the courier outcome on shipment % first. The shipment is still marked "%" — resolving now would hide an unfinished delivery.',
            _ship.shipment_number, _ship.status;
        END IF;
      ELSIF _class = 'return' THEN
        IF _e.exception_type = 'lost_in_transit' THEN
          IF _ship.id IS NOT NULL AND _ship.status <> 'lost' THEN
            RAISE EXCEPTION 'Mark shipment % as lost before resolving this exception, so the loss is recorded on the shipment itself.',
              _ship.shipment_number;
          END IF;
        ELSIF NOT EXISTS (SELECT 1 FROM public.order_returns
                           WHERE order_id = _e.order_id AND status <> 'cancelled') THEN
          RAISE EXCEPTION 'Goods are coming back for this exception. Create or advance the return for this order before resolving it.';
        END IF;
      END IF;

      _next := 'resolved';
    WHEN 'dismiss' THEN
      IF _e.status NOT IN ('open','under_review') THEN
        RAISE EXCEPTION 'Only an open or in-review exception can be dismissed';
      END IF;
      IF _clean IS NULL THEN RAISE EXCEPTION 'A note is required when dismissing an exception'; END IF;
      _next := 'dismissed';
    ELSE RAISE EXCEPTION 'Unknown exception action. Choose start review, resolve or dismiss.';
  END CASE;

  PERFORM set_config('app.exception_write', 'on', true);
  UPDATE public.shipment_exceptions SET
    status = _next,
    notes = CASE WHEN _next = 'under_review' AND _clean IS NOT NULL
                 THEN coalesce(notes || E'\n', '') || _clean ELSE notes END,
    resolution_note = CASE WHEN _next IN ('resolved','dismissed') THEN _clean ELSE resolution_note END,
    resolved_at = CASE WHEN _next IN ('resolved','dismissed') THEN now() ELSE resolved_at END,
    resolved_by = CASE WHEN _next IN ('resolved','dismissed') THEN auth.uid() ELSE resolved_by END
  WHERE id = _e.id RETURNING * INTO _e;
  PERFORM set_config('app.exception_write', 'off', true);

  PERFORM public.log_shipment_event(_e.shipment_id, _e.order_id, 'status_updated', NULL, NULL,
    'Delivery exception (' || _e.exception_type::text || ') → ' || _next::text
      || coalesce(' — ' || _clean, '')
      || '. Bookkeeping only: shipment, return and financial records stay authoritative.',
    jsonb_build_object('exception_id', _e.id, 'exception_status', _next,
                       'resolution_class', _class));
  RETURN _e;
END; $function$;