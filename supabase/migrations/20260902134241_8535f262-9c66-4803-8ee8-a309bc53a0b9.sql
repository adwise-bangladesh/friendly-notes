CREATE OR REPLACE FUNCTION public.reserve_order_inventory(_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders;
  _loc uuid;
  _item record;
  _need record;
  _blocked text := NULL;
  _stock_items int := 0;
  _note text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to reserve inventory';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled order cannot reserve stock'; END IF;
  IF _order.verification_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Inventory is reserved only after verification is confirmed';
  END IF;

  IF _order.reservation_status IN ('reserved','not_required')
     OR EXISTS (SELECT 1 FROM public.inventory_reservations
                 WHERE order_id = _order_id AND status IN ('active','committed')) THEN
    RETURN _order;
  END IF;

  SELECT id INTO _loc FROM public.inventory_locations
   WHERE status = 'active' AND is_default ORDER BY created_at LIMIT 1;

  DROP TABLE IF EXISTS _req;
  CREATE TEMP TABLE _req (
    order_item_id uuid,
    product_id uuid,
    variant_id uuid,
    label text,
    quantity int
  ) ON COMMIT DROP;

  FOR _item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity,
           oi.product_name, oi.variant_name,
           p.product_type, p.supply_model
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
     WHERE oi.order_id = _order_id
     ORDER BY oi.sort_order
  LOOP
    IF _item.product_type IS NULL THEN
      _blocked := coalesce(_blocked, 'Product record missing for "' || _item.product_name || '".');
      CONTINUE;
    END IF;

    IF _item.product_type IN ('service','digital') THEN
      CONTINUE;
    END IF;

    IF _item.product_type = 'bundle' THEN
      _blocked := coalesce(_blocked,
        'Bundle inventory allocation is not configured — "' || _item.product_name
        || '" cannot enter automatic reservation.');
      CONTINUE;
    END IF;

    IF _item.supply_model <> 'in_stock' THEN
      _blocked := coalesce(_blocked,
        'Supply model "' || _item.supply_model || '" for "' || _item.product_name
        || '" is not part of normal warehouse stock yet.');
      CONTINUE;
    END IF;

    IF _item.product_type = 'variable' AND _item.variant_id IS NULL THEN
      _blocked := coalesce(_blocked,
        'Variable product "' || _item.product_name || '" was ordered without a variant.');
      CONTINUE;
    END IF;

    _stock_items := _stock_items + 1;
    INSERT INTO _req(order_item_id, product_id, variant_id, label, quantity)
    VALUES (
      _item.id,
      CASE WHEN _item.variant_id IS NULL THEN _item.product_id ELSE NULL END,
      _item.variant_id,
      _item.product_name || coalesce(' — ' || _item.variant_name, ''),
      _item.quantity
    );
  END LOOP;

  PERFORM set_config('app.fulfillment_write', 'on', true);

  IF _blocked IS NOT NULL THEN
    UPDATE public.orders
       SET reservation_status = 'failed',
           fulfillment_status = 'on_hold',
           fulfillment_hold_reason = _blocked,
           updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Reservation failed — ' || _blocked, 'system', true, auth.uid());
    RETURN _order;
  END IF;

  IF _stock_items = 0 THEN
    UPDATE public.orders
       SET reservation_status = 'not_required',
           fulfillment_status = 'ready',
           fulfillment_hold_reason = NULL,
           fulfillment_location_id = _loc,
           reserved_at = now(),
           updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'No stock reservation required — this order has no physical items.',
            'system', true, auth.uid());
    RETURN _order;
  END IF;

  IF _loc IS NULL THEN
    UPDATE public.orders
       SET reservation_status = 'failed',
           fulfillment_status = 'on_hold',
           fulfillment_hold_reason = 'No default active inventory location is configured.',
           updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Reservation failed — no default active inventory location is configured.',
            'system', true, auth.uid());
    RETURN _order;
  END IF;

  PERFORM l.id
     FROM public.inventory_levels l
     JOIN _req r
       ON l.location_id = _loc
      AND ((r.variant_id IS NOT NULL AND l.variant_id = r.variant_id)
        OR (r.product_id IS NOT NULL AND l.product_id = r.product_id))
    ORDER BY l.id
      FOR UPDATE OF l;

  FOR _need IN
    SELECT r.label,
           sum(r.quantity) AS required,
           l.id AS level_id,
           coalesce(l.on_hand - l.reserved, 0) AS available
      FROM _req r
      LEFT JOIN public.inventory_levels l
        ON l.location_id = _loc
       AND ((r.variant_id IS NOT NULL AND l.variant_id = r.variant_id)
         OR (r.product_id IS NOT NULL AND l.product_id = r.product_id))
     GROUP BY r.label, l.id, l.on_hand, l.reserved
  LOOP
    IF _need.level_id IS NULL THEN
      _blocked := coalesce(_blocked,
        'Insufficient stock: "' || _need.label || '" is not stocked at the default location.');
    ELSIF _need.available < _need.required THEN
      _blocked := coalesce(_blocked,
        'Insufficient stock: "' || _need.label || '" needs ' || _need.required
        || ', available ' || _need.available || '.');
    END IF;
  END LOOP;

  IF _blocked IS NOT NULL THEN
    UPDATE public.orders
       SET reservation_status = 'failed',
           fulfillment_status = 'on_hold',
           fulfillment_hold_reason = _blocked,
           fulfillment_location_id = _loc,
           updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Reservation failed — ' || _blocked, 'system', true, auth.uid());
    RETURN _order;
  END IF;

  FOR _need IN
    SELECT r.order_item_id, r.product_id, r.variant_id, r.quantity, l.id AS level_id
      FROM _req r
      JOIN public.inventory_levels l
        ON l.location_id = _loc
       AND ((r.variant_id IS NOT NULL AND l.variant_id = r.variant_id)
         OR (r.product_id IS NOT NULL AND l.product_id = r.product_id))
  LOOP
    PERFORM set_config('app.reservation_write', 'on', true);
    INSERT INTO public.inventory_reservations
      (order_id, order_item_id, inventory_level_id, location_id, product_id, variant_id,
       quantity, status, created_by)
    VALUES (_order_id, _need.order_item_id, _need.level_id, _loc, _need.product_id,
            _need.variant_id, _need.quantity, 'active', auth.uid());
    PERFORM set_config('app.reservation_write', 'off', true);

    PERFORM public.apply_inventory_movement(
      _need.level_id, 'reservation', _need.quantity,
      'Reserved for order ' || _order.order_number, 'order', _order_id);
  END LOOP;

  UPDATE public.orders
     SET reservation_status = 'reserved',
         fulfillment_status = 'ready',
         fulfillment_hold_reason = NULL,
         fulfillment_location_id = _loc,
         reserved_at = now(),
         updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.fulfillment_write', 'off', true);

  SELECT 'Inventory reserved at ' || name || ' — order is ready for warehouse processing.'
    INTO _note FROM public.inventory_locations WHERE id = _loc;
  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, _note, 'system', true, auth.uid());

  RETURN _order;
END; $function$;

REVOKE ALL ON FUNCTION public.reserve_order_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_order_inventory(uuid) TO authenticated, service_role;