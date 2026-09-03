CREATE OR REPLACE FUNCTION public.update_order_items(_order_id uuid, _payload jsonb)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders; _block text; _items jsonb; _item jsonb; _row public.order_items;
  _snap jsonb; _idx int := 0; _qty int; _disc numeric; _price numeric;
  _subtotal numeric := 0; _item_discount numeric := 0;
  _keep uuid[] := '{}'; _line_id uuid;
  _was_reserved boolean := false;
  _before jsonb; _after jsonb; _changes text[] := '{}';
  _b jsonb; _a jsonb; _reason text; _resnapshot boolean;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change orders';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  _block := public.order_edit_block_reason(_order_id);
  IF _block IS NOT NULL THEN RAISE EXCEPTION '%', _block; END IF;

  _items := public.merge_order_item_payload(_payload->'items');
  _reason := nullif(btrim(coalesce(_payload->>'reason','')), '');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'label', product_name || coalesce(' — ' || variant_name, ''),
           'qty', quantity, 'price', unit_price, 'disc', discount_amount) ORDER BY sort_order), '[]'::jsonb)
    INTO _before FROM public.order_items WHERE order_id = _order_id;

  _was_reserved := _order.reservation_status IN ('reserved','partial');
  IF _was_reserved THEN
    PERFORM public.release_order_reservations(_order_id, 'Order items edited');
  END IF;

  PERFORM set_config('app.order_write', 'on', true);

  -- Drop lines the operator removed BEFORE writing the new set, so the logical
  -- line uniqueness index never sees a transient duplicate.
  DELETE FROM public.order_items oi
   WHERE oi.order_id = _order_id
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(_items) it
        WHERE (it->>'product_id')::uuid = oi.product_id
          AND coalesce(nullif(it->>'variant_id','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(oi.variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _idx := _idx + 1;
    _qty := coalesce((_item->>'quantity')::int, 0);
    IF _qty < 1 THEN RAISE EXCEPTION 'Quantity must be at least 1'; END IF;
    _disc := coalesce((_item->>'discount_amount')::numeric, 0);
    IF _disc < 0 THEN RAISE EXCEPTION 'Item discount cannot be negative'; END IF;

    _line_id := nullif(_item->>'id','')::uuid;
    _row := NULL::public.order_items;
    IF _line_id IS NOT NULL THEN
      SELECT * INTO _row FROM public.order_items WHERE id = _line_id AND order_id = _order_id;
    END IF;
    -- Fall back to the logical line (product + variant) so an unchanged product
    -- sent without its row id updates that row instead of colliding with it.
    IF _row.id IS NULL THEN
      SELECT * INTO _row FROM public.order_items
       WHERE order_id = _order_id
         AND product_id = (_item->>'product_id')::uuid
         AND coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(nullif(_item->>'variant_id','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         AND NOT (id = ANY(_keep));
    END IF;

    _resnapshot := _row.id IS NULL
      OR _row.product_id <> (_item->>'product_id')::uuid
      OR _row.variant_id IS DISTINCT FROM nullif(_item->>'variant_id','')::uuid;

    IF _resnapshot THEN
      _snap := public.order_item_snapshot(
        (_item->>'product_id')::uuid, nullif(_item->>'variant_id','')::uuid);
      _price := coalesce(nullif(_item->>'unit_price','')::numeric, (_snap->>'unit_price')::numeric);
    ELSE
      _price := coalesce(nullif(_item->>'unit_price','')::numeric, _row.unit_price);
    END IF;
    IF _price IS NULL OR _price < 0 THEN RAISE EXCEPTION 'A valid unit price is required'; END IF;
    IF _disc > _qty * _price THEN RAISE EXCEPTION 'Item discount exceeds the line value'; END IF;

    IF _row.id IS NOT NULL AND NOT _resnapshot THEN
      UPDATE public.order_items
         SET quantity = _qty, unit_price = _price, discount_amount = _disc, sort_order = _idx
       WHERE id = _row.id;
      _keep := _keep || _row.id;
    ELSIF _row.id IS NOT NULL THEN
      UPDATE public.order_items
         SET product_id = (_item->>'product_id')::uuid,
             variant_id = nullif(_item->>'variant_id','')::uuid,
             product_name = _snap->>'product_name',
             variant_name = _snap->>'variant_name',
             sku = _snap->>'sku',
             product_type = (_snap->>'product_type')::public.product_type,
             quantity = _qty, unit_price = _price,
             compare_at_price = nullif(_snap->>'compare_at_price','')::numeric,
             discount_amount = _disc, sort_order = _idx,
             unit_base_cost = (_snap->>'unit_base_cost')::numeric,
             unit_additional_cost = (_snap->>'unit_additional_cost')::numeric,
             unit_cost = (_snap->>'unit_base_cost')::numeric + (_snap->>'unit_additional_cost')::numeric,
             cost_source = _snap->>'cost_source'
       WHERE id = _row.id;
      _keep := _keep || _row.id;
    ELSE
      INSERT INTO public.order_items (
        order_id, product_id, variant_id, product_name, variant_name, sku, product_type,
        quantity, unit_price, compare_at_price, discount_amount, sort_order,
        unit_base_cost, unit_additional_cost, unit_cost, cost_source
      ) VALUES (
        _order_id, (_item->>'product_id')::uuid, nullif(_item->>'variant_id','')::uuid,
        _snap->>'product_name', _snap->>'variant_name', _snap->>'sku',
        (_snap->>'product_type')::public.product_type,
        _qty, _price, nullif(_snap->>'compare_at_price','')::numeric, _disc, _idx,
        (_snap->>'unit_base_cost')::numeric, (_snap->>'unit_additional_cost')::numeric,
        (_snap->>'unit_base_cost')::numeric + (_snap->>'unit_additional_cost')::numeric,
        _snap->>'cost_source'
      ) RETURNING id INTO _line_id;
      _keep := _keep || _line_id;
    END IF;

    _subtotal := _subtotal + (_qty * _price);
    _item_discount := _item_discount + _disc;
  END LOOP;

  DELETE FROM public.order_items WHERE order_id = _order_id AND NOT (id = ANY(_keep));

  UPDATE public.orders
     SET subtotal = _subtotal,
         product_discount = _item_discount,
         order_discount = coalesce(nullif(_payload->>'order_discount','')::numeric, order_discount),
         shipping_charge = coalesce(nullif(_payload->>'shipping_charge','')::numeric, shipping_charge),
         adjustment = coalesce(nullif(_payload->>'adjustment','')::numeric, adjustment),
         delivery_charge = coalesce(nullif(_payload->>'delivery_charge','')::numeric, delivery_charge),
         packing_charge = coalesce(nullif(_payload->>'packing_charge','')::numeric, packing_charge),
         updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;

  PERFORM set_config('app.order_write', 'off', true);

  IF _order.order_discount < 0 OR _order.shipping_charge < 0 THEN
    RAISE EXCEPTION 'Discounts and charges cannot be negative';
  END IF;
  IF _order.grand_total < 0 THEN
    RAISE EXCEPTION 'The order total cannot be negative — check the discounts.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'label', product_name || coalesce(' — ' || variant_name, ''),
           'qty', quantity, 'price', unit_price, 'disc', discount_amount) ORDER BY sort_order), '[]'::jsonb)
    INTO _after FROM public.order_items WHERE order_id = _order_id;

  FOR _b IN SELECT * FROM jsonb_array_elements(_before) LOOP
    SELECT a INTO _a FROM jsonb_array_elements(_after) a WHERE a->>'id' = _b->>'id';
    IF _a IS NULL THEN
      _changes := _changes || ('item removed: ' || (_b->>'label') || ' ×' || (_b->>'qty'));
    ELSE
      IF (_a->>'label') IS DISTINCT FROM (_b->>'label') THEN
        _changes := _changes || ('item changed: ' || (_b->>'label') || ' → ' || (_a->>'label'));
      END IF;
      IF (_a->>'qty')::int IS DISTINCT FROM (_b->>'qty')::int THEN
        _changes := _changes || ('quantity changed on ' || (_a->>'label') || ': '
                                 || (_b->>'qty') || ' → ' || (_a->>'qty'));
      END IF;
      IF (_a->>'price')::numeric IS DISTINCT FROM (_b->>'price')::numeric THEN
        _changes := _changes || ('unit price changed on ' || (_a->>'label') || ': '
                                 || (_b->>'price') || ' → ' || (_a->>'price'));
      END IF;
      IF (_a->>'disc')::numeric IS DISTINCT FROM (_b->>'disc')::numeric THEN
        _changes := _changes || ('line discount changed on ' || (_a->>'label') || ': '
                                 || (_b->>'disc') || ' → ' || (_a->>'disc'));
      END IF;
    END IF;
    _a := NULL;
  END LOOP;

  FOR _a IN SELECT * FROM jsonb_array_elements(_after) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_before) b WHERE b->>'id' = _a->>'id') THEN
      _changes := _changes || ('item added: ' || (_a->>'label') || ' ×' || (_a->>'qty'));
    END IF;
  END LOOP;

  IF _payload ? 'order_discount' THEN
    _changes := _changes || ('order discount set to ' || _order.order_discount);
  END IF;
  IF _payload ? 'shipping_charge' THEN
    _changes := _changes || ('shipping charge set to ' || _order.shipping_charge);
  END IF;
  IF _payload ? 'adjustment' THEN
    _changes := _changes || ('adjustment set to ' || _order.adjustment);
  END IF;

  IF array_length(_changes, 1) IS NULL THEN
    _changes := ARRAY['no line changes'];
  END IF;

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
    'Order edited — ' || array_to_string(_changes, '; ') || '.'
      || coalesce(' Reason: ' || _reason, '')
      || ' New total: ' || _order.grand_total || '.',
    'system', true, auth.uid());

  IF _was_reserved THEN
    _order := public.reserve_order_inventory(_order_id);
  END IF;

  PERFORM public.refresh_order_payment(_order_id);
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  RETURN _order;
END; $function$;

REVOKE ALL ON FUNCTION public.update_order_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_items(uuid, jsonb) TO authenticated, service_role;