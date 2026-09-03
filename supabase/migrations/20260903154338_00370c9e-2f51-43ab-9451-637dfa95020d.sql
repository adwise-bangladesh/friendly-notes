-- ============================================================
-- STEP 20.8.1 — Orders & Bangladesh operations core fixes
-- ============================================================

-- ---------- PART A: canonical phone validation ----------
CREATE OR REPLACE FUNCTION public.canonical_contact_phone(_phone text, _label text DEFAULT 'Phone number')
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE _raw text; _digits text; _norm text;
BEGIN
  _raw := regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g');
  IF _raw = '' THEN
    RAISE EXCEPTION '% is required', _label;
  END IF;
  _digits := regexp_replace(_raw, '[^0-9]', '', 'g');

  -- Explicit non-Bangladesh international numbers stay as supplied (E.164-ish).
  IF _raw LIKE '+%' AND _raw NOT LIKE '+880%' THEN
    IF length(_digits) BETWEEN 8 AND 15 THEN
      RETURN '+' || _digits;
    END IF;
    RAISE EXCEPTION '% "%" is not a valid international phone number.', _label, _phone;
  END IF;

  _norm := public.normalize_bd_phone(_digits);
  IF _norm ~ '^01[3-9][0-9]{8}$' THEN
    RETURN _norm;
  END IF;

  RAISE EXCEPTION '% "%" is not a valid Bangladesh mobile number. Use 01XXXXXXXXX, +8801XXXXXXXXX or 8801XXXXXXXXX.', _label, _phone;
END; $function$;

REVOKE ALL ON FUNCTION public.canonical_contact_phone(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_contact_phone(text, text) TO authenticated, service_role;

-- ---------- PART B: one logical line per product/variant ----------
CREATE UNIQUE INDEX IF NOT EXISTS order_items_order_line_key
  ON public.order_items (order_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------- Shared, cost-aware line snapshot resolver ----------
CREATE OR REPLACE FUNCTION public.order_item_snapshot(_product_id uuid, _variant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _product public.products; _variant public.product_variants;
  _variant_name text; _sku text; _price numeric; _compare numeric;
  _base numeric; _add numeric; _cost_source text;
BEGIN
  SELECT * INTO _product FROM public.products WHERE id = _product_id;
  IF _product.id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  IF _variant_id IS NOT NULL THEN
    SELECT * INTO _variant FROM public.product_variants WHERE id = _variant_id;
    IF _variant.id IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
    IF _variant.product_id <> _product.id THEN
      RAISE EXCEPTION 'Variant % does not belong to product %', _variant.title, _product.name;
    END IF;
    IF _product.product_type <> 'variable' THEN
      RAISE EXCEPTION 'Only a variable product can be ordered by variant';
    END IF;
    IF _variant.status = 'archived' THEN
      RAISE EXCEPTION 'Variant "%" is archived and cannot be ordered', _variant.title;
    END IF;
    IF _variant.price IS NULL THEN
      RAISE EXCEPTION 'Variant "%" has no price and cannot be ordered', _variant.title;
    END IF;
    _variant_name := _variant.title;
    _sku := coalesce(_variant.sku, _product.sku);
    _price := coalesce(_variant.price, _product.price);
    _compare := coalesce(_variant.compare_at_price, _product.compare_at_price);
    _base := coalesce(_variant.base_cost, _product.base_cost, 0);
    _add  := coalesce(_variant.additional_cost, _product.additional_cost, 0);
    _cost_source := CASE WHEN _variant.base_cost IS NOT NULL OR _variant.additional_cost IS NOT NULL
                         THEN 'variant_override' ELSE 'variant_inherited' END;
  ELSE
    IF _product.product_type = 'variable' THEN
      RAISE EXCEPTION 'Product "%" is a variable product — select a variant instead', _product.name;
    END IF;
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

  RETURN jsonb_build_object(
    'product_name', _product.name,
    'variant_name', _variant_name,
    'sku', _sku,
    'product_type', _product.product_type,
    'unit_price', _price,
    'compare_at_price', _compare,
    'unit_base_cost', _base,
    'unit_additional_cost', _add,
    'cost_source', _cost_source);
END; $function$;

-- internal only: carries cost data, never callable from the browser
REVOKE ALL ON FUNCTION public.order_item_snapshot(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_item_snapshot(uuid, uuid) TO service_role;

-- Merge duplicate logical lines; reject genuinely ambiguous duplicates.
CREATE OR REPLACE FUNCTION public.merge_order_item_payload(_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb; _prices int;
BEGIN
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one valid order item is required';
  END IF;

  SELECT count(*) INTO _prices FROM (
    SELECT elem->>'product_id' AS p, elem->>'variant_id' AS v
      FROM jsonb_array_elements(_items) AS elem
     WHERE elem->>'unit_price' IS NOT NULL
     GROUP BY 1, 2
    HAVING count(DISTINCT (elem->>'unit_price')::numeric) > 1
  ) s;
  IF _prices > 0 THEN
    RAISE EXCEPTION 'The same product appears more than once with different prices. Combine those lines into a single line first.';
  END IF;

  SELECT jsonb_agg(item ORDER BY ord) INTO _out FROM (
    SELECT min(t.ord) AS ord,
           jsonb_strip_nulls(jsonb_build_object(
             'id', min(t.elem->>'id'),
             'product_id', t.elem->>'product_id',
             'variant_id', t.elem->>'variant_id',
             'quantity', sum(coalesce((t.elem->>'quantity')::int, 0)),
             'discount_amount', sum(coalesce((t.elem->>'discount_amount')::numeric, 0)),
             'unit_price', max((t.elem->>'unit_price')::numeric)
           )) AS item
      FROM jsonb_array_elements(_items) WITH ORDINALITY AS t(elem, ord)
     GROUP BY t.elem->>'product_id', t.elem->>'variant_id'
  ) g;

  RETURN _out;
END; $function$;

REVOKE ALL ON FUNCTION public.merge_order_item_payload(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_order_item_payload(jsonb) TO authenticated, service_role;

-- ---------- create_order: canonical phones + duplicate line merge ----------
CREATE OR REPLACE FUNCTION public.create_order(_payload jsonb)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders;
  _item jsonb; _items jsonb; _snap jsonb;
  _qty int; _disc numeric; _idx int := 0; _price numeric;
  _subtotal numeric := 0; _item_discount numeric := 0;
  _status public.order_status;
  _customer_id uuid; _address_line text; _cust_name text; _cust_phone text; _addr_phone text;
  _raw_count int;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create orders';
  END IF;

  IF jsonb_typeof(_payload->'items') <> 'array' OR jsonb_array_length(_payload->'items') = 0 THEN
    RAISE EXCEPTION 'At least one valid order item is required';
  END IF;
  _raw_count := jsonb_array_length(_payload->'items');
  _items := public.merge_order_item_payload(_payload->'items');

  _cust_name := nullif(btrim(coalesce(_payload->>'customer_name','')), '');
  IF _cust_name IS NULL THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  _cust_phone := nullif(btrim(coalesce(_payload->>'customer_phone','')), '');
  IF _cust_phone IS NULL THEN RAISE EXCEPTION 'Customer phone is required'; END IF;
  _cust_phone := public.canonical_contact_phone(_cust_phone, 'Customer phone');
  _address_line := nullif(btrim(coalesce(_payload#>>'{address,address_line}','')), '');
  IF _address_line IS NULL THEN RAISE EXCEPTION 'A delivery address is required'; END IF;
  _addr_phone := nullif(btrim(coalesce(_payload#>>'{address,phone}','')), '');
  _addr_phone := CASE WHEN _addr_phone IS NULL THEN _cust_phone
                      ELSE public.canonical_contact_phone(_addr_phone, 'Delivery phone') END;

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
    _addr_phone,
    _address_line,
    nullif(btrim(coalesce(_payload#>>'{address,area}','')),''),
    nullif(btrim(coalesce(_payload#>>'{address,district}','')),''),
    nullif(btrim(coalesce(_payload#>>'{address,division}','')),''),
    nullif(btrim(coalesce(_payload#>>'{address,postal_code}','')),''),
    coalesce(nullif(btrim(coalesce(_payload#>>'{address,country}','')),''), 'Bangladesh')
  );

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _idx := _idx + 1;
    _qty := coalesce((_item->>'quantity')::int, 0);
    IF _qty < 1 THEN RAISE EXCEPTION 'Quantity must be at least 1'; END IF;
    _disc := coalesce((_item->>'discount_amount')::numeric, 0);
    IF _disc < 0 THEN RAISE EXCEPTION 'Item discount cannot be negative'; END IF;

    _snap := public.order_item_snapshot(
      (_item->>'product_id')::uuid, nullif(_item->>'variant_id','')::uuid);
    _price := (_snap->>'unit_price')::numeric;
    IF _disc > _qty * _price THEN RAISE EXCEPTION 'Item discount exceeds the line value'; END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, sku, product_type,
      quantity, unit_price, compare_at_price, discount_amount, sort_order,
      unit_base_cost, unit_additional_cost, unit_cost, cost_source
    ) VALUES (
      _order.id, (_item->>'product_id')::uuid, nullif(_item->>'variant_id','')::uuid,
      _snap->>'product_name', _snap->>'variant_name', _snap->>'sku',
      (_snap->>'product_type')::public.product_type,
      _qty, _price, nullif(_snap->>'compare_at_price','')::numeric, _disc, _idx,
      (_snap->>'unit_base_cost')::numeric, (_snap->>'unit_additional_cost')::numeric,
      (_snap->>'unit_base_cost')::numeric + (_snap->>'unit_additional_cost')::numeric,
      _snap->>'cost_source'
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

  IF _raw_count > jsonb_array_length(_items) THEN
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order.id, 'Repeated product lines were combined into single lines on creation.',
            'system', true, auth.uid());
  END IF;

  IF nullif(btrim(coalesce(_payload->>'note','')), '') IS NOT NULL THEN
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order.id, btrim(_payload->>'note'), 'general', true, auth.uid());
  END IF;

  PERFORM set_config('app.order_write', 'off', true);
  RETURN _order;
END; $function$;

-- ---------- resolve_customer_for_order stores the canonical phone ----------
CREATE OR REPLACE FUNCTION public.resolve_customer_for_order(_name text, _phone text, _email text, _customer_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _norm text; _existing public.customers; _id uuid; _matches int; _status public.customer_status;
BEGIN
  IF _customer_id IS NOT NULL THEN
    SELECT * INTO _existing FROM public.customers WHERE id = _customer_id;
    IF _existing.id IS NULL THEN RAISE EXCEPTION 'Selected customer not found'; END IF;
    IF _existing.status = 'blocked' THEN
      RAISE EXCEPTION 'Customer is blocked and cannot place new orders';
    END IF;
    RETURN _existing.id;
  END IF;

  _norm := public.normalize_bd_phone(_phone);
  IF _norm IS NULL OR _norm = '' THEN RETURN NULL; END IF;

  SELECT count(*) INTO _matches FROM public.customers
   WHERE primary_phone_normalized = _norm OR secondary_phone_normalized = _norm;

  IF _matches = 1 THEN
    SELECT id, status INTO _id, _status FROM public.customers
     WHERE primary_phone_normalized = _norm OR secondary_phone_normalized = _norm;
    IF _status = 'blocked' THEN
      RAISE EXCEPTION 'Customer is blocked and cannot place new orders';
    END IF;
    RETURN _id;
  ELSIF _matches > 1 THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.customer_write', 'on', true);
  INSERT INTO public.customers (name, primary_phone, email, created_by, updated_by)
  VALUES (btrim(_name), public.canonical_contact_phone(_phone, 'Customer phone'),
          nullif(btrim(coalesce(_email,'')),''), auth.uid(), auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _id;
END; $function$;

-- ---------- controlled corrections validate phones the same way ----------
CREATE OR REPLACE FUNCTION public.update_order_customer(_order_id uuid, _customer_name text, _customer_phone text, _customer_email text DEFAULT NULL::text, _customer_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _order public.orders; _resolved uuid; _prev uuid; _identity_change boolean; _phone text;
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
  _phone := public.canonical_contact_phone(_customer_phone, 'Customer phone');

  IF _customer_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.customers WHERE id = _customer_id AND status = 'blocked') THEN
    RAISE EXCEPTION 'That customer is blocked and cannot be linked to an order';
  END IF;

  _prev := _order.customer_id;
  _resolved := public.resolve_customer_for_order(
    btrim(_customer_name), _phone, _customer_email, _customer_id);

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = _resolved AND status = 'blocked') THEN
    RAISE EXCEPTION 'That customer is blocked and cannot be linked to an order';
  END IF;

  _identity_change := _resolved IS DISTINCT FROM _prev;
  IF _identity_change AND btrim(coalesce(_reason,'')) = '' THEN
    RAISE EXCEPTION 'A correction reason is required when an order is moved to a different customer';
  END IF;

  PERFORM set_config('app.order_write', 'on', true);
  UPDATE public.orders
     SET customer_id = _resolved,
         customer_name = btrim(_customer_name),
         customer_phone = _phone,
         customer_email = nullif(btrim(coalesce(_customer_email,'')),''),
         updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.order_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
          'Customer details corrected to ' || btrim(_customer_name) || ' (' || _phone || ').'
          || CASE WHEN _identity_change THEN ' Customer record changed from '
               || coalesce(_prev::text,'none') || ' to ' || _resolved::text
               || '. Reason: ' || btrim(_reason) ELSE '' END,
          'system', true, auth.uid());
  RETURN _order;
END; $function$;

CREATE OR REPLACE FUNCTION public.update_order_address(_order_id uuid, _address jsonb)
RETURNS order_addresses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _order public.orders; _addr public.order_addresses; _phone text;
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
  _phone := public.canonical_contact_phone(_address->>'phone', 'Delivery phone');

  SELECT * INTO _addr FROM public.order_addresses
   WHERE order_id = _order_id ORDER BY created_at LIMIT 1;

  PERFORM set_config('app.order_write', 'on', true);
  IF _addr.id IS NULL THEN
    INSERT INTO public.order_addresses
      (order_id, recipient_name, phone, address_line, area, district, division, postal_code, country)
    VALUES (_order_id, btrim(_address->>'recipient_name'), _phone,
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
           phone = _phone,
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
END; $function$;

CREATE OR REPLACE FUNCTION public.save_customer(_payload jsonb)
RETURNS customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _c public.customers; _id uuid; _primary text; _secondary text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage customers';
  END IF;
  _id := nullif(_payload->>'id','')::uuid;
  _primary := public.canonical_contact_phone(_payload->>'primary_phone', 'Primary phone');
  _secondary := nullif(btrim(coalesce(_payload->>'secondary_phone','')),'');
  IF _secondary IS NOT NULL THEN
    _secondary := public.canonical_contact_phone(_secondary, 'Secondary phone');
  END IF;

  PERFORM set_config('app.customer_write', 'on', true);

  IF _id IS NULL THEN
    INSERT INTO public.customers (name, primary_phone, secondary_phone, email, created_by, updated_by)
    VALUES (btrim(_payload->>'name'), _primary, _secondary,
            nullif(btrim(coalesce(_payload->>'email','')),''),
            auth.uid(), auth.uid())
    RETURNING * INTO _c;
  ELSE
    UPDATE public.customers SET
      name = btrim(_payload->>'name'),
      primary_phone = _primary,
      secondary_phone = _secondary,
      email = nullif(btrim(coalesce(_payload->>'email','')),''),
      updated_by = auth.uid(), updated_at = now()
    WHERE id = _id RETURNING * INTO _c;
    IF _c.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  END IF;

  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _c;
END; $function$;

-- ---------- PART C: controlled pre-operation order editing ----------
CREATE OR REPLACE FUNCTION public.order_edit_block_reason(_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _o public.orders;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read orders';
  END IF;
  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF _o.id IS NULL THEN RETURN 'Order not found.'; END IF;
  IF _o.status = 'cancelled' THEN RETURN 'This order is cancelled and can no longer be edited.'; END IF;
  IF public.order_operationally_locked(_order_id) THEN
    RETURN 'Stock is committed or the parcel is with the courier — items can no longer be edited.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_fulfillments
              WHERE order_id = _order_id AND status <> 'cancelled') THEN
    RETURN 'The warehouse has already started packing this order — cancel that fulfillment before editing items.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_returns
              WHERE order_id = _order_id AND status <> 'cancelled') THEN
    RETURN 'This order has a return in progress — items can no longer be edited.';
  END IF;
  RETURN NULL;
END; $function$;

REVOKE ALL ON FUNCTION public.order_edit_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_edit_block_reason(uuid) TO authenticated, service_role;

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

  -- audit trail (append-only order notes, no cost data)
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

-- ---------- PART E: verification claim ----------
CREATE OR REPLACE FUNCTION public.claim_verification_work(_order_id uuid, _note text DEFAULT NULL::text)
RETURNS operational_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _actor uuid := auth.uid(); _actor_role public.app_role;
  _existing public.operational_assignments; _row public.operational_assignments; _owner text;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT role INTO _actor_role FROM public.profiles WHERE id = _actor;
  IF _actor_role IS NULL OR _actor_role = 'viewer' THEN
    RAISE EXCEPTION 'Not authorized to claim verification work';
  END IF;
  PERFORM public.assert_operation_source_exists('order_verification', _order_id);

  -- Serialise competing claims on the order row itself.
  PERFORM 1 FROM public.orders WHERE id = _order_id FOR UPDATE;

  SELECT * INTO _existing FROM public.operational_assignments
   WHERE source_type = 'order_verification' AND source_id = _order_id AND released_at IS NULL
   FOR UPDATE;

  IF _existing.id IS NOT NULL THEN
    IF _existing.assigned_to = _actor THEN RETURN _existing; END IF;
    SELECT coalesce(full_name, 'another operator') INTO _owner
      FROM public.profiles WHERE id = _existing.assigned_to;
    RAISE EXCEPTION 'This order is already being verified by %.', coalesce(_owner, 'another operator');
  END IF;

  PERFORM set_config('app.operations_assignment', 'on', true);
  INSERT INTO public.operational_assignments
    (source_type, source_id, assigned_to, assigned_by, note)
  VALUES ('order_verification', _order_id, _actor, _actor,
          nullif(btrim(coalesce(_note,'')), ''))
  RETURNING * INTO _row;

  INSERT INTO public.operational_assignment_events
    (assignment_id, source_type, source_id, event_type, assigned_to, actor_id, note)
  VALUES (_row.id, 'order_verification', _order_id, 'assigned', _actor, _actor,
          nullif(btrim(coalesce(_note,'')), ''));
  PERFORM set_config('app.operations_assignment', 'off', true);

  RETURN _row;
END; $function$;

REVOKE ALL ON FUNCTION public.claim_verification_work(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_verification_work(uuid, text) TO authenticated, service_role;

-- ---------- PART F: attempt recording is retry safe ----------
CREATE OR REPLACE FUNCTION public.record_verification_attempt(_order_id uuid, _method verification_method, _outcome verification_attempt_outcome, _notes text DEFAULT NULL::text, _duration_seconds integer DEFAULT NULL::integer, _scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _risk_reason text DEFAULT NULL::text, _failure_reason text DEFAULT NULL::text, _provider text DEFAULT NULL::text)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders; _attempt public.order_verification_attempts;
  _number int; _next public.order_verification_status;
  _event public.verification_event_type; _msg text;
  _risk public.verification_risk_level := NULL;
  _max int := public.verification_max_attempts();
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record verification attempts';
  END IF;
  IF _outcome = 'pending' THEN RAISE EXCEPTION 'Record a real attempt outcome'; END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'This order is cancelled'; END IF;

  -- Double-click / retry protection: an identical attempt by the same operator
  -- within 15 seconds is treated as the same attempt.
  IF EXISTS (
    SELECT 1 FROM public.order_verification_attempts
     WHERE order_id = _order_id AND method = _method AND outcome = _outcome
       AND initiated_by = auth.uid() AND created_at > now() - interval '15 seconds'
  ) THEN
    RETURN _order;
  END IF;

  IF _order.verification_status IN ('confirmed','failed','cancelled') THEN
    RAISE EXCEPTION 'Verification is already closed for this order';
  END IF;

  IF _outcome = 'callback_requested' AND _scheduled_at IS NULL THEN
    RAISE EXCEPTION 'A callback needs a scheduled time';
  END IF;
  IF _outcome = 'callback_requested' AND _scheduled_at <= now() THEN
    RAISE EXCEPTION 'The callback time must be in the future';
  END IF;
  IF _outcome = 'risk_flagged' AND nullif(btrim(coalesce(_risk_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A risk reason is required';
  END IF;
  IF _outcome = 'rejected' AND nullif(btrim(coalesce(_failure_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when the customer rejects the order';
  END IF;

  SELECT coalesce(max(attempt_number), 0) + 1 INTO _number
    FROM public.order_verification_attempts WHERE order_id = _order_id;

  PERFORM set_config('app.verification_write', 'on', true);
  INSERT INTO public.order_verification_attempts (
    order_id, attempt_number, method, provider, status, outcome, notes,
    failure_reason, scheduled_at, started_at, completed_at, duration_seconds, initiated_by
  ) VALUES (
    _order_id, _number, _method, nullif(btrim(coalesce(_provider,'')),''), 'completed', _outcome,
    nullif(btrim(coalesce(_notes,'')),''),
    coalesce(nullif(btrim(coalesce(_failure_reason,'')),''), nullif(btrim(coalesce(_risk_reason,'')),'')),
    _scheduled_at, now(), now(), _duration_seconds, auth.uid()
  ) RETURNING * INTO _attempt;
  PERFORM set_config('app.verification_write', 'off', true);

  CASE _outcome
    WHEN 'confirmed' THEN
      _next := 'confirmed'; _event := 'verification_confirmed';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — customer confirmed the order.';
    WHEN 'rejected' THEN
      _next := 'failed'; _event := 'verification_failed';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — customer rejected the order: ' || _failure_reason;
    WHEN 'risk_flagged' THEN
      _next := 'manual_review'; _event := 'risk_flagged'; _risk := 'high';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — risk flagged: ' || _risk_reason;
    WHEN 'callback_requested' THEN
      _next := 'rescheduled'; _event := 'callback_scheduled';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — callback scheduled for '
              || to_char(_scheduled_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY HH12:MI AM') || ' (Dhaka).';
    WHEN 'answered' THEN
      _next := 'in_progress'; _event := 'attempt_completed';
      _msg := 'Attempt ' || _number || ' (' || _method || ') — customer answered, awaiting a decision.';
    ELSE
      IF _number >= _max THEN
        _next := 'unreachable'; _event := 'verification_unreachable';
        _msg := 'Attempt ' || _number || ' (' || _method || ') — ' || _outcome
                || '. Customer unreachable after ' || _number || ' attempts.';
      ELSE
        _next := 'pending'; _event := 'attempt_completed';
        _msg := 'Attempt ' || _number || ' (' || _method || ') — ' || _outcome
                || '. Retry allowed (' || _number || '/' || _max || ').';
      END IF;
  END CASE;

  _order := public.apply_verification_transition(
    _order_id, _next, _event, _msg, _attempt.id,
    jsonb_build_object('outcome', _outcome, 'method', _method, 'attempt_number', _number),
    CASE WHEN _outcome = 'callback_requested' THEN _scheduled_at ELSE NULL END,
    _risk,
    CASE WHEN _outcome = 'risk_flagged' THEN _risk_reason ELSE NULL END,
    CASE WHEN _outcome = 'rejected' THEN _failure_reason ELSE NULL END,
    true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Verification: ' || _msg, 'system', true, auth.uid());

  RETURN _order;
END; $function$;

-- ---------- PART G: customer intelligence for order surfaces ----------
CREATE OR REPLACE FUNCTION public.order_customer_intelligence(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _o public.orders; _cust public.customers; _metrics jsonb; _flags jsonb; _recent jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read customers';
  END IF;
  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF _o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _o.customer_id IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'customer', NULL,
                              'metrics', NULL, 'flags', '[]'::jsonb, 'recent_orders', '[]'::jsonb);
  END IF;

  SELECT * INTO _cust FROM public.customers WHERE id = _o.customer_id;
  _metrics := public.customer_metrics(_o.customer_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'flag', flag, 'reason', reason, 'created_at', created_at)
           ORDER BY created_at DESC), '[]'::jsonb)
    INTO _flags FROM public.customer_manual_flags
   WHERE customer_id = _o.customer_id AND is_active AND cleared_at IS NULL;

  SELECT coalesce(jsonb_agg(o ORDER BY o->>'created_at' DESC), '[]'::jsonb) INTO _recent
    FROM (
      SELECT jsonb_build_object(
               'id', id, 'order_number', order_number, 'status', status,
               'delivery_status', delivery_status, 'verification_status', verification_status,
               'grand_total', grand_total, 'created_at', created_at) AS o
        FROM public.orders
       WHERE customer_id = _o.customer_id AND id <> _order_id
       ORDER BY created_at DESC LIMIT 5
    ) s;

  RETURN jsonb_build_object(
    'linked', true,
    'customer', jsonb_build_object('id', _cust.id, 'name', _cust.name,
                                   'primary_phone', _cust.primary_phone, 'status', _cust.status),
    'metrics', _metrics,
    'flags', _flags,
    'recent_orders', _recent);
END; $function$;

REVOKE ALL ON FUNCTION public.order_customer_intelligence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_customer_intelligence(uuid) TO authenticated, service_role;