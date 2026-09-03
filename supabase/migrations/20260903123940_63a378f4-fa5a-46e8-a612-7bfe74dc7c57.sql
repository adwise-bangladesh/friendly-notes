-- A1: default signup role
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _has_any boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;

  -- Bootstrap only: the very first account becomes owner. All later
  -- accounts start with NO role and must be granted one explicitly.
  SELECT EXISTS (SELECT 1 FROM public.user_roles) INTO _has_any;
  IF NOT _has_any THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END; $function$;

-- F1: supplier identity snapshot on purchase orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_name_snapshot text,
  ADD COLUMN IF NOT EXISTS supplier_code_snapshot text;

DO $$
BEGIN
  PERFORM set_config('app.procurement_write', 'on', true);
  UPDATE public.purchase_orders po
     SET supplier_name_snapshot = s.name,
         supplier_code_snapshot = s.supplier_code
    FROM public.suppliers s
   WHERE s.id = po.supplier_id AND po.supplier_name_snapshot IS NULL;
  PERFORM set_config('app.procurement_write', 'off', true);
END $$;

-- D1: one line per purchasable item on a purchase order
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_unique_product
  ON public.purchase_order_items (purchase_order_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_unique_variant
  ON public.purchase_order_items (purchase_order_id, variant_id) WHERE variant_id IS NOT NULL;

-- C1 / D1 / F1 / H1: validated purchase order save
CREATE OR REPLACE FUNCTION public.save_purchase_order(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po_id uuid := nullif(_payload->>'id','')::uuid;
  _status public.purchase_order_status;
  _item jsonb; _idx int := 0;
  _pid uuid; _vid uuid; _pname text; _vname text; _sku text;
  _supplier_id uuid := nullif(_payload->>'supplier_id','')::uuid;
  _supplier public.suppliers;
  _qty int; _cost numeric;
  _seen_products uuid[] := '{}'; _seen_variants uuid[] := '{}';
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage purchase orders';
  END IF;
  IF jsonb_array_length(coalesce(_payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A purchase order needs at least one item';
  END IF;

  IF _supplier_id IS NULL THEN
    RAISE EXCEPTION 'Choose a supplier for this purchase order';
  END IF;
  SELECT * INTO _supplier FROM public.suppliers WHERE id = _supplier_id;
  IF _supplier.id IS NULL THEN
    RAISE EXCEPTION 'That supplier could not be found';
  END IF;
  IF _supplier.status <> 'active' THEN
    RAISE EXCEPTION 'This supplier is archived and cannot be used for a new purchase order';
  END IF;

  -- validate lines before touching anything
  FOR _item IN SELECT * FROM jsonb_array_elements(_payload->'items') LOOP
    _idx := _idx + 1;
    _pid := nullif(_item->>'product_id','')::uuid;
    _vid := nullif(_item->>'variant_id','')::uuid;
    IF _pid IS NULL AND _vid IS NULL THEN
      RAISE EXCEPTION 'Line % has no product selected', _idx;
    END IF;
    _qty := nullif(_item->>'quantity_ordered','')::int;
    _cost := nullif(_item->>'unit_cost','')::numeric;
    IF _qty IS NULL OR _qty <= 0 THEN
      RAISE EXCEPTION 'Line % needs a quantity of at least 1', _idx;
    END IF;
    IF _cost IS NULL OR _cost < 0 THEN
      RAISE EXCEPTION 'Line % needs a unit cost of zero or more', _idx;
    END IF;
    IF coalesce((_item->>'discount_amount')::numeric, 0) < 0
       OR coalesce((_item->>'tax_amount')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Line % cannot have negative discount or tax', _idx;
    END IF;
    IF _vid IS NOT NULL THEN
      IF _vid = ANY(_seen_variants) THEN
        RAISE EXCEPTION 'Line % repeats an item already on this purchase order. Combine the quantities into one line.', _idx;
      END IF;
      _seen_variants := _seen_variants || _vid;
    ELSE
      IF _pid = ANY(_seen_products) THEN
        RAISE EXCEPTION 'Line % repeats an item already on this purchase order. Combine the quantities into one line.', _idx;
      END IF;
      _seen_products := _seen_products || _pid;
    END IF;
  END LOOP;

  IF coalesce((_payload->>'discount_total')::numeric, 0) < 0
     OR coalesce((_payload->>'shipping_cost')::numeric, 0) < 0
     OR coalesce((_payload->>'duty_cost')::numeric, 0) < 0
     OR coalesce((_payload->>'other_cost')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'Order level charges and discounts cannot be negative';
  END IF;

  _idx := 0;
  PERFORM set_config('app.procurement_write', 'on', true);

  IF _po_id IS NULL THEN
    INSERT INTO public.purchase_orders (
      purchase_order_number, supplier_id, supplier_name_snapshot, supplier_code_snapshot,
      order_date, expected_delivery_date, currency,
      exchange_rate, discount_total, shipping_cost, duty_cost, other_cost, notes, created_by, updated_by)
    VALUES (
      public.next_purchase_order_number(),
      _supplier_id, _supplier.name, _supplier.supplier_code,
      coalesce(nullif(_payload->>'order_date','')::date, (now() AT TIME ZONE 'Asia/Dhaka')::date),
      nullif(_payload->>'expected_delivery_date','')::date,
      coalesce(nullif(_payload->>'currency',''), 'BDT'),
      nullif(_payload->>'exchange_rate','')::numeric,
      coalesce((_payload->>'discount_total')::numeric, 0),
      coalesce((_payload->>'shipping_cost')::numeric, 0),
      coalesce((_payload->>'duty_cost')::numeric, 0),
      coalesce((_payload->>'other_cost')::numeric, 0),
      nullif(btrim(coalesce(_payload->>'notes','')), ''),
      auth.uid(), auth.uid())
    RETURNING id INTO _po_id;
  ELSE
    SELECT status INTO _status FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
    IF _status IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
    IF _status NOT IN ('draft','pending_approval') THEN
      RAISE EXCEPTION 'Only draft or pending approval purchase orders can be edited (status is %)', _status;
    END IF;
    IF _status = 'pending_approval' AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only an admin can edit a purchase order that is awaiting approval';
    END IF;

    UPDATE public.purchase_orders
       SET supplier_id = _supplier_id,
           supplier_name_snapshot = _supplier.name,
           supplier_code_snapshot = _supplier.supplier_code,
           order_date = coalesce(nullif(_payload->>'order_date','')::date, order_date),
           expected_delivery_date = nullif(_payload->>'expected_delivery_date','')::date,
           currency = coalesce(nullif(_payload->>'currency',''), 'BDT'),
           exchange_rate = nullif(_payload->>'exchange_rate','')::numeric,
           discount_total = coalesce((_payload->>'discount_total')::numeric, 0),
           shipping_cost = coalesce((_payload->>'shipping_cost')::numeric, 0),
           duty_cost = coalesce((_payload->>'duty_cost')::numeric, 0),
           other_cost = coalesce((_payload->>'other_cost')::numeric, 0),
           notes = nullif(btrim(coalesce(_payload->>'notes','')), ''),
           updated_by = auth.uid()
     WHERE id = _po_id;

    DELETE FROM public.purchase_order_items WHERE purchase_order_id = _po_id;
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_payload->'items') LOOP
    _idx := _idx + 1;
    _pid := nullif(_item->>'product_id','')::uuid;
    _vid := nullif(_item->>'variant_id','')::uuid;

    IF _vid IS NOT NULL THEN
      SELECT p.name, v.title, coalesce(v.sku, p.sku) INTO _pname, _vname, _sku
        FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
       WHERE v.id = _vid;
      _pid := NULL;
    ELSE
      SELECT name, NULL, sku INTO _pname, _vname, _sku FROM public.products WHERE id = _pid;
    END IF;
    IF _pname IS NULL THEN RAISE EXCEPTION 'Item % could not be found', _idx; END IF;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot,
      sku_snapshot, quantity_ordered, unit_cost, discount_amount, tax_amount, sort_order)
    VALUES (_po_id, _pid, _vid, _pname, _vname, _sku,
      (_item->>'quantity_ordered')::int,
      (_item->>'unit_cost')::numeric,
      coalesce((_item->>'discount_amount')::numeric, 0),
      coalesce((_item->>'tax_amount')::numeric, 0),
      _idx);
  END LOOP;

  PERFORM set_config('app.procurement_write', 'off', true);
  PERFORM public.recalculate_purchase_order_totals(_po_id);

  IF _status IS NULL THEN
    PERFORM public.log_purchase_order_event(_po_id, 'created', 'Purchase order created', NULL, 'draft');
  ELSE
    PERFORM public.log_purchase_order_event(_po_id, 'updated', 'Purchase order details updated');
  END IF;

  RETURN _po_id;
END; $function$;

-- E1: closed purchase orders cannot be silently reopened by a reversal
CREATE OR REPLACE FUNCTION public.reverse_goods_receipt(_receipt_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _receipt public.goods_receipts; _po public.purchase_orders;
  _line public.goods_receipt_items; _po_item public.purchase_order_items;
  _level_id uuid; _total_ordered int; _total_received int; _new_status public.purchase_order_status;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or owner can reverse a finalised receipt';
  END IF;
  IF nullif(btrim(coalesce(_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'A reversal needs a reason';
  END IF;

  SELECT * INTO _receipt FROM public.goods_receipts WHERE id = _receipt_id FOR UPDATE;
  IF _receipt.id IS NULL THEN RAISE EXCEPTION 'Goods receipt not found'; END IF;
  IF _receipt.status <> 'received' THEN RAISE EXCEPTION 'Only a finalised receipt can be reversed'; END IF;
  IF _receipt.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'This receipt was already reversed'; END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = _receipt.purchase_order_id FOR UPDATE;
  IF _po.status = 'closed' THEN
    RAISE EXCEPTION 'This purchase order is closed. A closed purchase order cannot be reopened by reversing a receipt.';
  END IF;

  FOR _line IN SELECT * FROM public.goods_receipt_items WHERE goods_receipt_id = _receipt_id LOOP
    SELECT * INTO _po_item FROM public.purchase_order_items
     WHERE id = _line.purchase_order_item_id FOR UPDATE;

    SELECT id INTO _level_id FROM public.inventory_levels
     WHERE location_id = _receipt.inventory_location_id
       AND product_id IS NOT DISTINCT FROM _po_item.product_id
       AND variant_id IS NOT DISTINCT FROM _po_item.variant_id;
    IF _level_id IS NULL THEN RAISE EXCEPTION 'The original stock record no longer exists'; END IF;

    IF _line.quantity_accepted > 0 THEN
      PERFORM public.apply_inventory_movement(
        _level_id, 'adjustment_out', _line.quantity_accepted,
        'Reversal of goods receipt ' || _receipt.receipt_number, 'goods_receipt_reversal', _receipt_id);
    END IF;
    IF _line.quantity_damaged > 0 THEN
      PERFORM public.apply_inventory_movement(
        _level_id, 'damaged_out', _line.quantity_damaged,
        'Reversal of goods receipt ' || _receipt.receipt_number, 'goods_receipt_reversal', _receipt_id);
    END IF;

    PERFORM set_config('app.procurement_write', 'on', true);
    UPDATE public.purchase_order_items
       SET quantity_received = greatest(quantity_received - _line.quantity_received, 0)
     WHERE id = _po_item.id;
    PERFORM set_config('app.procurement_write', 'off', true);
  END LOOP;

  SELECT coalesce(sum(quantity_ordered),0), coalesce(sum(quantity_received),0)
    INTO _total_ordered, _total_received
    FROM public.purchase_order_items WHERE purchase_order_id = _po.id;

  _new_status := CASE
    WHEN _total_received = 0 THEN 'ordered'::public.purchase_order_status
    WHEN _total_received >= _total_ordered THEN 'received'::public.purchase_order_status
    ELSE 'partially_received'::public.purchase_order_status END;

  PERFORM set_config('app.procurement_write', 'on', true);
  UPDATE public.goods_receipts
     SET reversed_at = now(), reversal_reason = btrim(_reason)
   WHERE id = _receipt_id;
  UPDATE public.purchase_orders SET status = _new_status, updated_by = auth.uid() WHERE id = _po.id;
  PERFORM set_config('app.procurement_write', 'off', true);

  PERFORM public.log_purchase_order_event(
    _po.id, 'receipt_reversed',
    'Goods receipt ' || _receipt.receipt_number || ' reversed: ' || btrim(_reason),
    _po.status, _new_status, jsonb_build_object('receipt_id', _receipt_id));
END; $function$;

-- G1: atomic preferred supplier switch
CREATE OR REPLACE FUNCTION public.set_preferred_supplier_product(_supplier_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.supplier_products; _supplier_status public.entity_status;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage suppliers';
  END IF;
  SELECT * INTO _row FROM public.supplier_products WHERE id = _supplier_product_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'That supplier item link could not be found';
  END IF;
  IF _row.product_id IS NULL AND _row.variant_id IS NULL THEN
    RAISE EXCEPTION 'This supplier item is not linked to a product or variant';
  END IF;
  SELECT status INTO _supplier_status FROM public.suppliers WHERE id = _row.supplier_id;
  IF _supplier_status <> 'active' THEN
    RAISE EXCEPTION 'This supplier is archived and cannot be made the preferred supplier';
  END IF;

  IF _row.variant_id IS NOT NULL THEN
    UPDATE public.supplier_products SET is_preferred = false
     WHERE variant_id = _row.variant_id AND id <> _row.id AND is_preferred;
  ELSE
    UPDATE public.supplier_products SET is_preferred = false
     WHERE product_id = _row.product_id AND variant_id IS NULL AND id <> _row.id AND is_preferred;
  END IF;

  UPDATE public.supplier_products SET is_preferred = true WHERE id = _row.id;
END; $function$;

REVOKE ALL ON FUNCTION public.set_preferred_supplier_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_preferred_supplier_product(uuid) TO authenticated;

-- B1 / B2: analytics correctness
DROP FUNCTION IF EXISTS public.analytics_purchased_products(timestamptz, timestamptz, integer);
CREATE FUNCTION public.analytics_purchased_products(_from timestamp with time zone, _to timestamp with time zone, _limit integer DEFAULT 10)
 RETURNS TABLE(product_id uuid, variant_id uuid, product_name text, sku text, quantity_ordered bigint, quantity_received bigint, ordered_value numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  perform public.analytics_guard(_from, _to);
  return query
  select i.product_id, i.variant_id,
         min(i.product_name_snapshot)
           || coalesce(' / ' || min(i.variant_name_snapshot), ''),
         min(i.sku_snapshot),
         sum(i.quantity_ordered)::bigint,
         sum(i.quantity_received)::bigint,
         sum(i.line_total)
    from public.purchase_order_items i
    join public.purchase_orders po on po.id = i.purchase_order_id
   where po.created_at >= _from and po.created_at < _to
     and po.status not in ('draft','cancelled')
   group by i.product_id, i.variant_id
   order by sum(i.line_total) desc
   limit greatest(coalesce(_limit,10),1);
end; $function$;

REVOKE ALL ON FUNCTION public.analytics_purchased_products(timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_purchased_products(timestamptz, timestamptz, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.analytics_supplier_spend(_from timestamp with time zone, _to timestamp with time zone, _limit integer DEFAULT 10)
 RETURNS TABLE(supplier_id uuid, supplier_name text, purchase_orders bigint, ordered_value numeric, received_value numeric, quantity_ordered bigint, quantity_received bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  perform public.analytics_guard(_from, _to);
  return query
  with pos as (
    select po.id, po.supplier_id, po.grand_total
      from public.purchase_orders po
     where po.created_at >= _from and po.created_at < _to
       and po.status not in ('draft','cancelled')
  ), items as (
    select p.supplier_id, sum(i.quantity_ordered) qty_ordered
      from public.purchase_order_items i join pos p on p.id = i.purchase_order_id group by 1
  ), received as (
    select p.supplier_id,
           sum(gi.quantity_accepted) qty_received,
           sum(gi.quantity_accepted * gi.unit_cost_snapshot) value_received
      from public.goods_receipt_items gi
      join public.goods_receipts gr on gr.id = gi.goods_receipt_id
      join pos p on p.id = gr.purchase_order_id
     where gr.status = 'received' and gr.reversed_at is null
     group by 1
  )
  select s.id, s.name, count(distinct p.id)::bigint,
         coalesce(sum(p.grand_total),0),
         coalesce(min(rc.value_received),0),
         coalesce(min(it.qty_ordered),0)::bigint,
         coalesce(min(rc.qty_received),0)::bigint
    from pos p
    join public.suppliers s on s.id = p.supplier_id
    left join items it on it.supplier_id = s.id
    left join received rc on rc.supplier_id = s.id
   group by s.id, s.name
   order by coalesce(sum(p.grand_total),0) desc
   limit greatest(coalesce(_limit,10),1);
end; $function$;

-- I1: grant cleanup
REVOKE ALL ON public.purchase_orders, public.purchase_order_items, public.purchase_order_events,
  public.goods_receipts, public.goods_receipt_items, public.product_cost_history,
  public.suppliers, public.supplier_contacts, public.supplier_products FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.purchase_orders, public.purchase_order_items, public.purchase_order_events,
  public.goods_receipts, public.goods_receipt_items, public.product_cost_history FROM authenticated;

GRANT SELECT ON public.purchase_orders, public.purchase_order_items, public.purchase_order_events,
  public.goods_receipts, public.goods_receipt_items, public.product_cost_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers, public.supplier_contacts, public.supplier_products TO authenticated;

GRANT ALL ON public.purchase_orders, public.purchase_order_items, public.purchase_order_events,
  public.goods_receipts, public.goods_receipt_items, public.product_cost_history,
  public.suppliers, public.supplier_contacts, public.supplier_products TO service_role;