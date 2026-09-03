-- ============================================================
-- STEP 20.1 FIX — ORDER LIFECYCLE & INVENTORY INTEGRITY
-- ============================================================

-- ---------- A1. Durable commitment bookkeeping ----------
ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS committed_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_committed_range
  CHECK (committed_quantity >= 0 AND committed_quantity <= quantity) NOT VALID;

ALTER TABLE public.order_fulfillments
  ADD COLUMN IF NOT EXISTS inventory_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inventory_committed_by uuid;

-- Historical committed reservations are append-only records and are NOT rewritten;
-- their committed quantity is read as the full reserved quantity.
CREATE OR REPLACE FUNCTION public.reservation_committed_quantity(_r public.inventory_reservations)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN _r.status = 'committed' AND _r.committed_quantity = 0
              THEN _r.quantity ELSE _r.committed_quantity END;
$fn$;

-- ---------- A2. Authoritative order fulfillment projection ----------
CREATE OR REPLACE FUNCTION public.refresh_order_fulfillment_projection(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      SELECT coalesce(sum(fi.quantity),0) INTO _covered
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
END; $$;

REVOKE ALL ON FUNCTION public.refresh_order_fulfillment_projection(uuid) FROM public, anon, authenticated;

-- ---------- A3. Single inventory commitment point ----------
CREATE OR REPLACE FUNCTION public.commit_fulfillment_inventory(_fulfillment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _f public.order_fulfillments; _order public.orders;
  _it record; _res record; _need int; _take int;
BEGIN
  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  IF _f.inventory_committed_at IS NOT NULL THEN RETURN; END IF;  -- durable idempotency

  SELECT * INTO _order FROM public.orders WHERE id = _f.order_id FOR UPDATE;

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
  END LOOP;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  UPDATE public.order_fulfillments
     SET inventory_committed_at = now(), inventory_committed_by = auth.uid()
   WHERE id = _f.id;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_f.order_id,
    'Stock committed for fulfillment #' || _f.fulfillment_number || ' at courier handover.',
    'system', true, auth.uid());
END; $$;

REVOKE ALL ON FUNCTION public.commit_fulfillment_inventory(uuid) FROM public, anon, authenticated;

-- ---------- A4. Warehouse workflow drives commitment + projection ----------
CREATE OR REPLACE FUNCTION public.set_fulfillment_state(_fulfillment_id uuid, _action text, _reason text DEFAULT NULL::text)
RETURNS order_fulfillments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _f public.order_fulfillments;
  _order public.orders;
  _from public.fulfillment_record_status;
  _next public.fulfillment_record_status;
  _event public.fulfillment_event_type;
  _msg text;
  _clean text := nullif(btrim(coalesce(_reason,'')), '');
  _unresolved integer;
  _failed integer;
  _note text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change fulfillment state';
  END IF;
  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _f.order_id;
  _from := _f.status;

  IF _order.status = 'cancelled' AND _action <> 'cancel' THEN
    RAISE EXCEPTION 'The order is cancelled. This fulfillment can only be cancelled.';
  END IF;

  CASE _action
    WHEN 'start_picking' THEN
      _next := 'picking'; _event := 'picking_started'; _msg := 'Picking started.';
    WHEN 'complete_picking' THEN
      SELECT count(*) INTO _unresolved FROM public.order_fulfillment_items
        WHERE fulfillment_id = _f.id AND picked_quantity < quantity AND shortage_reason IS NULL;
      IF _unresolved > 0 THEN
        RAISE EXCEPTION 'Picking cannot be completed: % item line(s) are short without an operational reason.', _unresolved;
      END IF;
      IF EXISTS (SELECT 1 FROM public.order_fulfillment_items WHERE fulfillment_id = _f.id AND picked_quantity = 0) THEN
        IF NOT EXISTS (SELECT 1 FROM public.order_fulfillment_items WHERE fulfillment_id = _f.id AND picked_quantity > 0) THEN
          RAISE EXCEPTION 'Nothing has been picked. Record picked quantities or put the fulfillment on hold.';
        END IF;
      END IF;
      _next := 'picked'; _event := 'picking_completed'; _msg := 'Picking completed.';
    WHEN 'start_packing' THEN
      _next := 'packing'; _event := 'packing_started'; _msg := 'Packing started.';
    WHEN 'send_to_qc' THEN
      _next := 'qc_pending'; _event := 'qc_started'; _msg := 'Sent to quality control.';
    WHEN 'pass_qc' THEN
      SELECT count(*) INTO _failed FROM public.order_fulfillment_items
        WHERE fulfillment_id = _f.id AND qc_status = 'failed';
      IF _failed > 0 THEN
        RAISE EXCEPTION 'Quality control cannot pass while % item line(s) are marked failed.', _failed;
      END IF;
      _next := 'packed'; _event := 'packed'; _msg := 'Quality control passed. Package is packed.';
    WHEN 'fail_qc' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required to fail quality control'; END IF;
      _next := 'qc_failed'; _event := 'qc_failed'; _msg := 'Quality control failed — ' || _clean;
    WHEN 'return_to_picking' THEN
      _next := 'picking'; _event := 'picking_started';
      _msg := 'Returned to picking' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'hold' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A hold reason is required'; END IF;
      _next := 'on_hold'; _event := 'put_on_hold'; _msg := 'Put on hold — ' || _clean;
    WHEN 'release_hold' THEN
      _next := CASE WHEN EXISTS (
          SELECT 1 FROM public.order_fulfillment_items WHERE fulfillment_id = _f.id AND picked_quantity > 0
        ) THEN 'picking'::public.fulfillment_record_status
        ELSE 'ready_to_pick'::public.fulfillment_record_status END;
      _event := 'hold_released'; _msg := 'Hold released' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'mark_ready_for_handover' THEN
      _next := 'ready_for_handover'; _event := 'ready_for_handover'; _msg := 'Ready for courier handover.';
    WHEN 'cancel' THEN
      IF _from = 'ready_for_handover' OR _f.inventory_committed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Stock for this fulfillment is already committed for handover. Process a return instead of cancelling.';
      END IF;
      _next := 'cancelled'; _event := 'fulfillment_cancelled';
      _msg := 'Fulfillment cancelled' || coalesce(' — ' || _clean, '') || '.';
    ELSE
      RAISE EXCEPTION 'Unknown fulfillment action: %', _action;
  END CASE;

  IF NOT public.fulfillment_transition_valid(_from, _next) THEN
    RAISE EXCEPTION 'Transition from % to % is not allowed', _from, _next;
  END IF;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  UPDATE public.order_fulfillments
     SET status = _next,
         updated_by = auth.uid(),
         hold_reason = CASE WHEN _next = 'on_hold' THEN _clean ELSE NULL END,
         started_at = CASE WHEN _next = 'picking' AND started_at IS NULL THEN now() ELSE started_at END,
         picked_at = CASE WHEN _next = 'picked' THEN now() ELSE picked_at END,
         packed_at = CASE WHEN _next = 'packed' THEN now() ELSE packed_at END,
         ready_for_handover_at = CASE WHEN _next = 'ready_for_handover' THEN now() ELSE ready_for_handover_at END,
         cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END
   WHERE id = _f.id
   RETURNING * INTO _f;

  IF _next = 'packed' THEN
    UPDATE public.order_fulfillment_items
       SET packed_quantity = picked_quantity,
           qc_status = CASE WHEN qc_status = 'pending' THEN 'passed'::public.fulfillment_qc_status ELSE qc_status END
     WHERE fulfillment_id = _f.id;
  END IF;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  PERFORM public.log_fulfillment_event(_f.id, _f.order_id, _event, _from, _next, _msg, NULL);

  -- Physical commitment point: goods are packed and handed to the courier lane.
  IF _next = 'ready_for_handover' THEN
    PERFORM public.commit_fulfillment_inventory(_f.id);
    SELECT * INTO _f FROM public.order_fulfillments WHERE id = _f.id;
  END IF;

  PERFORM public.refresh_order_fulfillment_projection(_f.order_id);

  IF _next IN ('on_hold','packed','ready_for_handover','cancelled','qc_failed') THEN
    _note := 'Fulfillment #' || _f.fulfillment_number || ': ' || _msg;
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_f.order_id, _note, 'system', true, auth.uid());
  END IF;

  RETURN _f;
END; $$;

-- create_order_fulfillment must refresh the projection too
CREATE OR REPLACE FUNCTION public.create_order_fulfillment(_order_id uuid, _location_id uuid, _items jsonb, _notes text DEFAULT NULL::text)
RETURNS order_fulfillments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _order public.orders; _f public.order_fulfillments; _number integer;
  _line jsonb; _item_id uuid; _qty integer; _remaining integer; _count integer := 0;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create fulfillments';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled orders cannot be fulfilled'; END IF;
  IF _order.verification_status NOT IN ('confirmed','not_required') THEN
    RAISE EXCEPTION 'Order is not eligible for fulfillment. Verification must be confirmed (current: %)', _order.verification_status;
  END IF;

  IF _location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_locations WHERE id = _location_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Warehouse location is missing or not active';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  SELECT coalesce(max(fulfillment_number), 0) + 1 INTO _number
    FROM public.order_fulfillments WHERE order_id = _order_id;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);

  INSERT INTO public.order_fulfillments
    (order_id, fulfillment_number, status, location_id, notes, created_by, updated_by)
  VALUES (_order_id, _number, 'ready_to_pick', _location_id,
          nullif(btrim(coalesce(_notes,'')), ''), auth.uid(), auth.uid())
  RETURNING * INTO _f;

  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _item_id := (_line->>'order_item_id')::uuid;
    _qty := coalesce((_line->>'quantity')::int, 0);
    CONTINUE WHEN _qty <= 0;

    SELECT (oi.quantity - coalesce((
      SELECT sum(fi.quantity) FROM public.order_fulfillment_items fi
        JOIN public.order_fulfillments f2 ON f2.id = fi.fulfillment_id
       WHERE fi.order_item_id = oi.id AND f2.status <> 'cancelled' AND f2.id <> _f.id
    ), 0))::int
      INTO _remaining
      FROM public.order_items oi
     WHERE oi.id = _item_id AND oi.order_id = _order_id;

    IF _remaining IS NULL THEN
      RAISE EXCEPTION 'Order item % does not belong to this order', _item_id;
    END IF;
    IF _qty > _remaining THEN
      RAISE EXCEPTION 'Quantity % exceeds the remaining quantity % for this order item', _qty, _remaining;
    END IF;

    INSERT INTO public.order_fulfillment_items (fulfillment_id, order_item_id, quantity)
    VALUES (_f.id, _item_id, _qty);
    _count := _count + 1;
  END LOOP;

  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  IF _count = 0 THEN RAISE EXCEPTION 'At least one item with a positive quantity is required'; END IF;

  PERFORM public.log_fulfillment_event(_f.id, _order_id, 'fulfillment_created', NULL, 'ready_to_pick',
    'Fulfillment #' || _number || ' created with ' || _count || ' item line(s).',
    jsonb_build_object('location_id', _location_id, 'line_count', _count));

  PERFORM public.refresh_order_fulfillment_projection(_order_id);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Fulfillment #' || _number || ' created.', 'system', true, auth.uid());

  RETURN _f;
END; $$;

-- ---------- A5. Retire the competing order-level inventory path ----------
DROP FUNCTION IF EXISTS public.commit_order_inventory(uuid);

CREATE OR REPLACE FUNCTION public.set_order_fulfillment_state(_order_id uuid, _action text, _reason text DEFAULT NULL::text)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _order public.orders;
  _clean text := nullif(btrim(coalesce(_reason,'')), '');
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage fulfillment';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled order cannot move through the warehouse';
  END IF;

  -- The warehouse workflow now lives on fulfillment records. Only order-level
  -- hold / resume remain here; everything else must go through a fulfillment.
  IF _action = 'hold' THEN
    IF _clean IS NULL THEN RAISE EXCEPTION 'A hold reason is required'; END IF;
    IF EXISTS (SELECT 1 FROM public.order_fulfillments
                WHERE order_id = _order_id AND status NOT IN ('cancelled')) THEN
      RAISE EXCEPTION 'This order already has fulfillment records — put the fulfillment on hold instead.';
    END IF;
    PERFORM set_config('app.fulfillment_write', 'on', true);
    UPDATE public.orders
       SET fulfillment_status = 'on_hold', fulfillment_hold_reason = _clean, updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Fulfillment: Put on hold — ' || _clean, 'system', true, auth.uid());
    RETURN _order;
  ELSIF _action = 'resume' THEN
    IF _order.reservation_status NOT IN ('reserved','not_required') THEN
      RAISE EXCEPTION 'Inventory must be reserved before warehouse work can start';
    END IF;
    PERFORM set_config('app.fulfillment_write', 'on', true);
    UPDATE public.orders
       SET fulfillment_status = 'ready', fulfillment_hold_reason = NULL, updated_by = auth.uid()
     WHERE id = _order_id;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    PERFORM public.refresh_order_fulfillment_projection(_order_id);
    SELECT * INTO _order FROM public.orders WHERE id = _order_id;
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Fulfillment: ' || coalesce(_clean, 'Resumed — ready for the warehouse.'),
            'system', true, auth.uid());
    RETURN _order;
  END IF;

  RAISE EXCEPTION 'Warehouse progress is recorded on fulfillment records. Create or open a fulfillment for this order instead.';
END; $$;

-- ---------- A6. Reservation release respects committed quantity ----------
CREATE OR REPLACE FUNCTION public.release_order_reservations(_order_id uuid, _reason text)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _order public.orders; _res record; _count int := 0; _remaining int;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to release reservations';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  FOR _res IN
    SELECT * FROM public.inventory_reservations
     WHERE order_id = _order_id AND status = 'active'
     ORDER BY id FOR UPDATE
  LOOP
    _remaining := greatest(_res.quantity - _res.committed_quantity, 0);
    IF _remaining > 0 THEN
      PERFORM public.apply_inventory_movement(
        _res.inventory_level_id, 'release_reservation', _remaining,
        'Released for order ' || _order.order_number
          || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), ''),
        'order', _order_id);
      _count := _count + 1;
    END IF;

    PERFORM set_config('app.reservation_write', 'on', true);
    UPDATE public.inventory_reservations
       SET status = CASE WHEN committed_quantity > 0
                         THEN 'committed'::public.reservation_record_status
                         ELSE 'released'::public.reservation_record_status END,
           released_at = now(), released_by = auth.uid()
     WHERE id = _res.id;
    PERFORM set_config('app.reservation_write', 'off', true);
  END LOOP;

  IF _count = 0 AND _order.reservation_status <> 'reserved' THEN
    RETURN _order;
  END IF;

  PERFORM set_config('app.fulfillment_write', 'on', true);
  UPDATE public.orders
     SET reservation_status = 'released', reserved_at = NULL, updated_by = auth.uid()
   WHERE id = _order_id;
  PERFORM set_config('app.fulfillment_write', 'off', true);

  PERFORM public.refresh_order_fulfillment_projection(_order_id);
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
    'Reservation released (' || _count || ' line(s))'
      || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.',
    'system', true, auth.uid());

  RETURN _order;
END; $$;

-- ---------- B. Cancellation cannot contradict physical delivery ----------
CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid, _reason text DEFAULT NULL::text, _force boolean DEFAULT false)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _order public.orders; _from public.order_verification_status; _committed int;
        _f public.order_fulfillments; _s public.shipments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to cancel orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Order is already cancelled'; END IF;
  _from := _order.verification_status;

  -- Rule 1: physically delivered goods can never be cancelled away, not even by force.
  IF EXISTS (SELECT 1 FROM public.shipments
              WHERE order_id = _order_id
                AND status IN ('delivered','partial_delivered','return_requested',
                               'return_in_transit','return_received','lost')) THEN
    RAISE EXCEPTION 'This order has delivered or returning shipments and cannot be cancelled. Process a return for the delivered items instead.';
  END IF;

  SELECT coalesce(sum(CASE WHEN status = 'committed' AND committed_quantity = 0
                           THEN quantity ELSE committed_quantity END), 0) INTO _committed
    FROM public.inventory_reservations WHERE order_id = _order_id;

  IF _committed > 0 AND NOT _force THEN
    RAISE EXCEPTION 'Stock for this order is already committed for handover. Cancelling needs an administrative exception, and committed stock is only restored through a return.';
  END IF;
  IF _committed > 0 AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or owner can force-cancel an order whose stock is committed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_fulfillments
              WHERE order_id = _order_id AND status = 'ready_for_handover') AND NOT _force THEN
    RAISE EXCEPTION 'A fulfillment is already ready for courier handover. Cancelling needs an administrative exception.';
  END IF;

  -- Only uncommitted reserved quantity is returned to available stock.
  IF EXISTS (SELECT 1 FROM public.inventory_reservations
              WHERE order_id = _order_id AND status = 'active') THEN
    PERFORM public.release_order_reservations(_order_id, 'Order cancelled');
    SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  END IF;

  FOR _s IN SELECT * FROM public.shipments
             WHERE order_id = _order_id
               AND status NOT IN ('delivered','return_received','lost','cancelled')
             FOR UPDATE LOOP
    IF _s.status IN ('draft','ready_for_booking','booking_requested','booked','pickup_requested') THEN
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid()
       WHERE id = _s.id;
      PERFORM set_config('app.shipment_write', 'off', true);
      PERFORM public.log_shipment_event(_s.id, _order_id, 'shipment_cancelled', _s.status, 'cancelled',
        'Shipment cancelled because the order was cancelled'
          || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.', NULL);
    ELSE
      PERFORM public.log_shipment_event(_s.id, _order_id, 'status_updated', _s.status, _s.status,
        'The order was cancelled while this shipment was already with the courier. It stays active and needs return handling.',
        jsonb_build_object('order_cancelled', true));
    END IF;
  END LOOP;

  FOR _f IN SELECT * FROM public.order_fulfillments
             WHERE order_id = _order_id AND status NOT IN ('cancelled','ready_for_handover')
             FOR UPDATE LOOP
    PERFORM set_config('app.fulfillment_record_write', 'on', true);
    UPDATE public.order_fulfillments
       SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid(), hold_reason = NULL
     WHERE id = _f.id;
    PERFORM set_config('app.fulfillment_record_write', 'off', true);
    PERFORM public.log_fulfillment_event(_f.id, _order_id, 'fulfillment_cancelled', _f.status, 'cancelled',
      'Fulfillment cancelled because the order was cancelled'
        || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.', NULL);
  END LOOP;

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
    'Order cancelled' || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '')
      || CASE WHEN _committed > 0 THEN ' (administrative exception — committed stock was NOT restored; use a return).' ELSE '.' END,
    'system', true, auth.uid());

  RETURN _order;
END; $$;

-- ---------- C. Lifecycle + identity fields are controlled fields ----------
CREATE OR REPLACE FUNCTION public.guard_order_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('app.order_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Order status can only change through the controlled order actions (for example cancelling an order).';
  END IF;
  IF NEW.financial_status IS DISTINCT FROM OLD.financial_status THEN
    RAISE EXCEPTION 'Financial status is derived and cannot be set directly.';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
     OR NEW.customer_email IS DISTINCT FROM OLD.customer_email THEN
    RAISE EXCEPTION 'Customer details on an order can only be changed with the controlled customer correction.';
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'The store of an order cannot be changed directly.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_guard_lifecycle ON public.orders;
CREATE TRIGGER orders_guard_lifecycle BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_lifecycle();

CREATE OR REPLACE FUNCTION public.guard_order_address_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('app.order_write', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Delivery addresses can only be changed through the controlled address correction.';
END; $$;

DROP TRIGGER IF EXISTS order_addresses_guard_write ON public.order_addresses;
CREATE TRIGGER order_addresses_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_addresses
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_address_write();

-- ---------- D. No direct order creation / editing / deletion ----------
DROP POLICY IF EXISTS orders_insert ON public.orders;
DROP POLICY IF EXISTS orders_update ON public.orders;
DROP POLICY IF EXISTS orders_delete ON public.orders;
DROP POLICY IF EXISTS order_items_insert ON public.order_items;
DROP POLICY IF EXISTS order_items_update ON public.order_items;
DROP POLICY IF EXISTS order_items_delete ON public.order_items;
DROP POLICY IF EXISTS order_addresses_insert ON public.order_addresses;
DROP POLICY IF EXISTS order_addresses_update ON public.order_addresses;
DROP POLICY IF EXISTS order_addresses_delete ON public.order_addresses;

REVOKE INSERT, UPDATE, DELETE ON public.orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_addresses FROM authenticated;
REVOKE ALL ON public.orders FROM anon;
REVOKE ALL ON public.order_items FROM anon;
REVOKE ALL ON public.order_addresses FROM anon;

-- ---------- E. Controlled identity / address corrections ----------
CREATE OR REPLACE FUNCTION public.order_operationally_locked(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.order_fulfillments
                  WHERE order_id = _order_id AND inventory_committed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.shipments
                  WHERE order_id = _order_id AND status NOT IN ('draft','cancelled'));
$$;

CREATE OR REPLACE FUNCTION public.update_order_customer(
  _order_id uuid, _customer_name text, _customer_phone text,
  _customer_email text DEFAULT NULL, _customer_id uuid DEFAULT NULL)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _order public.orders; _resolved uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled order cannot be edited'; END IF;
  IF public.order_operationally_locked(_order_id) THEN
    RAISE EXCEPTION 'This order is already committed or with the courier — customer details can no longer be changed.';
  END IF;
  IF coalesce(btrim(coalesce(_customer_name,'')), '') = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF coalesce(btrim(coalesce(_customer_phone,'')), '') = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;

  _resolved := public.resolve_customer_for_order(
    btrim(_customer_name), btrim(_customer_phone), _customer_email, _customer_id);

  PERFORM set_config('app.order_write', 'on', true);
  UPDATE public.orders
     SET customer_id = _resolved,
         customer_name = btrim(_customer_name),
         customer_phone = btrim(_customer_phone),
         customer_email = nullif(btrim(coalesce(_customer_email,'')),''),
         updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.order_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Customer details corrected to ' || btrim(_customer_name)
          || ' (' || btrim(_customer_phone) || ').', 'system', true, auth.uid());
  RETURN _order;
END; $$;

CREATE OR REPLACE FUNCTION public.update_order_address(_order_id uuid, _address jsonb)
RETURNS order_addresses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _order public.orders; _addr public.order_addresses;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled order cannot be edited'; END IF;
  IF public.order_operationally_locked(_order_id) THEN
    RAISE EXCEPTION 'This order is already committed or with the courier — the delivery address can no longer be changed.';
  END IF;
  IF coalesce(nullif(btrim(coalesce(_address->>'address_line','')),''), '') = '' THEN
    RAISE EXCEPTION 'A delivery address is required';
  END IF;
  IF coalesce(nullif(btrim(coalesce(_address->>'recipient_name','')),''), '') = '' THEN
    RAISE EXCEPTION 'A recipient name is required';
  END IF;
  IF coalesce(nullif(btrim(coalesce(_address->>'phone','')),''), '') = '' THEN
    RAISE EXCEPTION 'A delivery phone number is required';
  END IF;

  SELECT * INTO _addr FROM public.order_addresses
   WHERE order_id = _order_id ORDER BY created_at LIMIT 1;

  PERFORM set_config('app.order_write', 'on', true);
  IF _addr.id IS NULL THEN
    INSERT INTO public.order_addresses
      (order_id, recipient_name, phone, address_line, area, district, division, postal_code, country)
    VALUES (_order_id, btrim(_address->>'recipient_name'), btrim(_address->>'phone'),
            btrim(_address->>'address_line'),
            nullif(btrim(coalesce(_address->>'area','')),''),
            nullif(btrim(coalesce(_address->>'district','')),''),
            nullif(btrim(coalesce(_address->>'division','')),''),
            nullif(btrim(coalesce(_address->>'postal_code','')),''),
            coalesce(nullif(btrim(coalesce(_address->>'country','')),''), 'Bangladesh'))
    RETURNING * INTO _addr;
  ELSE
    UPDATE public.order_addresses
       SET recipient_name = btrim(_address->>'recipient_name'),
           phone = btrim(_address->>'phone'),
           address_line = btrim(_address->>'address_line'),
           area = nullif(btrim(coalesce(_address->>'area','')),''),
           district = nullif(btrim(coalesce(_address->>'district','')),''),
           division = nullif(btrim(coalesce(_address->>'division','')),''),
           postal_code = nullif(btrim(coalesce(_address->>'postal_code','')),''),
           country = coalesce(nullif(btrim(coalesce(_address->>'country','')),''), 'Bangladesh')
     WHERE id = _addr.id RETURNING * INTO _addr;
  END IF;
  PERFORM set_config('app.order_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Delivery address corrected.', 'system', true, auth.uid());
  RETURN _addr;
END; $$;

GRANT EXECUTE ON FUNCTION public.update_order_customer(uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_address(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_operationally_locked(uuid) TO authenticated;

-- ---------- I. Friendly creation validation ----------
CREATE OR REPLACE FUNCTION public.create_order(_payload jsonb)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _order public.orders;
  _item jsonb;
  _product public.products;
  _variant public.product_variants;
  _name text; _variant_name text; _sku text; _price numeric; _compare numeric;
  _qty int; _disc numeric; _idx int := 0;
  _subtotal numeric := 0; _item_discount numeric := 0;
  _status public.order_status;
  _base numeric; _add numeric; _cost_source text;
  _customer_id uuid; _address_line text; _cust_name text; _cust_phone text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create orders';
  END IF;

  IF jsonb_typeof(_payload->'items') <> 'array' OR jsonb_array_length(_payload->'items') = 0 THEN
    RAISE EXCEPTION 'At least one valid order item is required';
  END IF;

  _cust_name := nullif(btrim(coalesce(_payload->>'customer_name','')), '');
  IF _cust_name IS NULL THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  _cust_phone := nullif(btrim(coalesce(_payload->>'customer_phone','')), '');
  IF _cust_phone IS NULL THEN RAISE EXCEPTION 'Customer phone is required'; END IF;
  _address_line := nullif(btrim(coalesce(_payload#>>'{address,address_line}','')), '');
  IF _address_line IS NULL THEN RAISE EXCEPTION 'A delivery address is required'; END IF;

  _status := coalesce((_payload->>'status')::public.order_status, 'created');
  IF _status = 'cancelled' THEN RAISE EXCEPTION 'A new order cannot start as cancelled'; END IF;

  _customer_id := public.resolve_customer_for_order(
    _cust_name, _cust_phone, _payload->>'customer_email',
    nullif(_payload->>'customer_id','')::uuid);

  PERFORM set_config('app.order_write', 'on', true);

  INSERT INTO public.orders (
    order_number, source, customer_id, customer_name, customer_phone, customer_email,
    status, payment_method, payment_status,
    order_discount, shipping_charge, adjustment, paid_amount,
    delivery_charge, packing_charge, placed_at, created_by, updated_by
  ) VALUES (
    public.next_order_number(),
    coalesce((_payload->>'source')::public.order_source, 'admin'),
    _customer_id, _cust_name, _cust_phone,
    nullif(btrim(coalesce(_payload->>'customer_email','')), ''),
    _status,
    coalesce((_payload->>'payment_method')::public.payment_method, 'cod'),
    'unpaid',
    coalesce((_payload->>'order_discount')::numeric, 0),
    coalesce((_payload->>'shipping_charge')::numeric, 0),
    coalesce((_payload->>'adjustment')::numeric, 0),
    coalesce((_payload->>'paid_amount')::numeric, 0),
    coalesce((_payload->>'delivery_charge')::numeric, 0),
    coalesce((_payload->>'packing_charge')::numeric, 0),
    CASE WHEN _status = 'created' THEN now() ELSE NULL END,
    auth.uid(), auth.uid()
  ) RETURNING * INTO _order;

  INSERT INTO public.order_addresses (
    order_id, recipient_name, phone, address_line, area, district, division, postal_code, country
  ) VALUES (
    _order.id,
    coalesce(nullif(btrim(coalesce(_payload#>>'{address,recipient_name}','')),''), _order.customer_name),
    coalesce(nullif(btrim(coalesce(_payload#>>'{address,phone}','')),''), _order.customer_phone),
    _address_line,
    nullif(btrim(coalesce(_payload#>>'{address,area}','')),''),
    nullif(btrim(coalesce(_payload#>>'{address,district}','')),''),
    nullif(btrim(coalesce(_payload#>>'{address,division}','')),''),
    nullif(btrim(coalesce(_payload#>>'{address,postal_code}','')),''),
    coalesce(nullif(btrim(coalesce(_payload#>>'{address,country}','')),''), 'Bangladesh')
  );

  FOR _item IN SELECT * FROM jsonb_array_elements(_payload->'items') LOOP
    _idx := _idx + 1;
    _qty := coalesce((_item->>'quantity')::int, 0);
    IF _qty < 1 THEN RAISE EXCEPTION 'Quantity must be at least 1'; END IF;
    _disc := coalesce((_item->>'discount_amount')::numeric, 0);
    IF _disc < 0 THEN RAISE EXCEPTION 'Item discount cannot be negative'; END IF;

    SELECT * INTO _product FROM public.products WHERE id = (_item->>'product_id')::uuid;
    IF _product.id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    IF _item->>'variant_id' IS NOT NULL THEN
      SELECT * INTO _variant FROM public.product_variants WHERE id = (_item->>'variant_id')::uuid;
      IF _variant.id IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
      IF _variant.product_id <> _product.id THEN
        RAISE EXCEPTION 'Variant % does not belong to product %', _variant.title, _product.name;
      END IF;
      IF _product.product_type <> 'variable' THEN
        RAISE EXCEPTION 'Only a variable product can be ordered by variant';
      END IF;
      _variant_name := _variant.title;
      _sku := coalesce(_variant.sku, _product.sku);
      _price := coalesce(_variant.price, _product.price);
      _compare := coalesce(_variant.compare_at_price, _product.compare_at_price);
      IF _variant.price IS NULL THEN
        RAISE EXCEPTION 'Variant "%" has no price and cannot be ordered', _variant.title;
      END IF;
      _base := coalesce(_variant.base_cost, _product.base_cost, 0);
      _add  := coalesce(_variant.additional_cost, _product.additional_cost, 0);
      _cost_source := CASE WHEN _variant.base_cost IS NOT NULL OR _variant.additional_cost IS NOT NULL
                           THEN 'variant_override' ELSE 'variant_inherited' END;
    ELSE
      IF _product.product_type = 'variable' THEN
        RAISE EXCEPTION 'Product "%" is a variable product — select a variant instead', _product.name;
      END IF;
      _variant := NULL;
      _variant_name := NULL;
      _sku := _product.sku;
      _price := _product.price;
      _compare := _product.compare_at_price;
      _base := coalesce(_product.base_cost, 0);
      _add  := coalesce(_product.additional_cost, 0);
      _cost_source := CASE
        WHEN _product.product_type = 'bundle' THEN 'bundle_parent'
        WHEN _product.supply_model = 'group_buy' THEN 'group_buy_provisional'
        ELSE 'product' END;
    END IF;

    IF _product.status <> 'active' OR NOT _product.is_purchasable THEN
      RAISE EXCEPTION 'Product "%" is not purchasable', _product.name;
    END IF;

    _name := _product.name;
    IF _disc > _qty * _price THEN RAISE EXCEPTION 'Item discount exceeds the line value'; END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, sku, product_type,
      quantity, unit_price, compare_at_price, discount_amount, sort_order,
      unit_base_cost, unit_additional_cost, unit_cost, cost_source
    ) VALUES (
      _order.id, _product.id, _variant.id, _name, _variant_name, _sku, _product.product_type,
      _qty, _price, _compare, _disc, _idx,
      _base, _add, _base + _add, _cost_source
    );

    _subtotal := _subtotal + (_qty * _price);
    _item_discount := _item_discount + _disc;
  END LOOP;

  UPDATE public.orders
     SET subtotal = _subtotal,
         product_discount = _item_discount,
         payment_status = CASE
           WHEN paid_amount <= 0 THEN 'unpaid'::public.payment_status
           WHEN paid_amount >= (_subtotal - _item_discount - order_discount + shipping_charge + adjustment) THEN 'paid'::public.payment_status
           ELSE 'partial'::public.payment_status END
   WHERE id = _order.id
   RETURNING * INTO _order;

  IF _order.grand_total < 0 THEN RAISE EXCEPTION 'Grand total cannot be negative'; END IF;

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order.id, 'Order ' || _order.order_number || ' created via ' || _order.source || '.',
          'system', true, auth.uid());

  IF nullif(btrim(coalesce(_payload->>'note','')), '') IS NOT NULL THEN
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order.id, btrim(_payload->>'note'), 'general', true, auth.uid());
  END IF;

  PERFORM set_config('app.order_write', 'off', true);
  RETURN _order;
END; $$;

-- ---------- F. Atomic external order import ----------
CREATE OR REPLACE FUNCTION public.import_external_order(
  _account_id uuid, _store_id uuid, _external_id text,
  _external_reference text, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _order public.orders; _existing uuid; _ext text := btrim(coalesce(_external_id,''));
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to import orders';
  END IF;
  IF _ext = '' THEN RAISE EXCEPTION 'The external order has no identifier'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = _store_id AND status = 'active') THEN
    RAISE EXCEPTION 'Store not found or not active';
  END IF;

  SELECT internal_id INTO _existing FROM public.external_entity_mappings
   WHERE sales_channel_account_id = _account_id AND entity_type = 'order' AND external_id = _ext;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'skipped', 'order_id', _existing);
  END IF;

  _order := public.create_order(_payload);

  PERFORM public.upsert_external_mapping(
    _account_id, 'order'::public.external_entity_type, _order.id, _ext, _external_reference);

  PERFORM set_config('app.order_write', 'on', true);
  UPDATE public.orders SET store_id = _store_id, updated_by = auth.uid() WHERE id = _order.id;
  PERFORM set_config('app.order_write', 'off', true);

  RETURN jsonb_build_object('outcome', 'created', 'order_id', _order.id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This external order was already imported';
END; $$;

GRANT EXECUTE ON FUNCTION public.import_external_order(uuid, uuid, text, text, jsonb) TO authenticated;

-- ---------- H. Returns require a real physical outbound flow ----------
CREATE OR REPLACE FUNCTION public.create_order_return(_order_id uuid, _shipment_id uuid DEFAULT NULL::uuid, _return_type order_return_type DEFAULT 'return_to_merchant'::order_return_type, _reason text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _tracking_reference text DEFAULT NULL::text, _items jsonb DEFAULT '[]'::jsonb, _courier_reason text DEFAULT NULL::text, _source text DEFAULT 'manual'::text)
RETURNS order_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _r public.order_returns; _order public.orders; _item jsonb; _oi public.order_items; _qty integer;
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

  -- A return must mirror a real physical outbound flow: stock committed at
  -- handover, or a shipment that has left the draft stage.
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

COMMENT ON COLUMN public.orders.financial_status IS
  'DEPRECATED — always not_applicable. Financial completeness lives in order_financial_rollup.';
COMMENT ON FUNCTION public.reserve_order_inventory(uuid) IS
  'Known limitation: reserves only at the single default active inventory location. Multi-location allocation is a future feature.';
