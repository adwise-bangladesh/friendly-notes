
-- ============ ENUMS ============
CREATE TYPE public.financial_adjustment_type AS ENUM (
  'packing_cost','courier_charge','cod_fee','return_charge','damage_loss',
  'manual_expense','manual_income','settlement_adjustment','other');
CREATE TYPE public.financial_adjustment_direction AS ENUM ('income','expense');
CREATE TYPE public.courier_settlement_status AS ENUM
  ('draft','pending','partial','settled','disputed','cancelled');

-- ============ 1. ORDER ITEM COST SNAPSHOT ============
ALTER TABLE public.order_items
  ADD COLUMN unit_base_cost numeric(12,2),
  ADD COLUMN unit_additional_cost numeric(12,2),
  ADD COLUMN unit_cost numeric(12,2),
  ADD COLUMN cost_source text;

COMMENT ON COLUMN public.order_items.unit_cost IS
  'Historically frozen landed unit cost (base + additional) resolved at order creation. Never recomputed from current product data.';
COMMENT ON COLUMN public.order_items.cost_source IS
  'How the cost was resolved: product, variant_override, variant_inherited, bundle_parent, group_buy_provisional, unknown.';

-- Backfill existing rows from current product data (best available; flagged as backfill).
SELECT set_config('app.order_write', 'on', false);
UPDATE public.order_items oi
   SET unit_base_cost = c.base,
       unit_additional_cost = c.add_cost,
       unit_cost = c.base + c.add_cost,
       cost_source = 'backfill_current_cost'
  FROM (
    SELECT i.id,
           coalesce(v.base_cost, p.base_cost, 0) AS base,
           coalesce(v.additional_cost, p.additional_cost, 0) AS add_cost
      FROM public.order_items i
      JOIN public.products p ON p.id = i.product_id
      LEFT JOIN public.product_variants v ON v.id = i.variant_id
     WHERE i.unit_cost IS NULL
  ) c
 WHERE oi.id = c.id;
SELECT set_config('app.order_write', 'off', false);

-- Cost snapshots are immutable once written.
CREATE OR REPLACE FUNCTION public.guard_order_item_cost_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.order_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF OLD.unit_cost IS NOT NULL AND (
       NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
    OR NEW.unit_base_cost IS DISTINCT FROM OLD.unit_base_cost
    OR NEW.unit_additional_cost IS DISTINCT FROM OLD.unit_additional_cost
    OR NEW.cost_source IS DISTINCT FROM OLD.cost_source) THEN
    RAISE EXCEPTION 'Historical order item cost snapshots cannot be changed';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_order_item_cost_snapshot
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_item_cost_snapshot();

-- create_order now snapshots the resolved cost.
CREATE OR REPLACE FUNCTION public.create_order(_payload jsonb)
 RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create orders';
  END IF;

  IF jsonb_typeof(_payload->'items') <> 'array' OR jsonb_array_length(_payload->'items') = 0 THEN
    RAISE EXCEPTION 'An order needs at least one item';
  END IF;

  _status := coalesce((_payload->>'status')::public.order_status, 'created');
  IF _status = 'cancelled' THEN RAISE EXCEPTION 'A new order cannot start as cancelled'; END IF;

  PERFORM set_config('app.order_write', 'on', true);

  INSERT INTO public.orders (
    order_number, source, customer_name, customer_phone, customer_email,
    status, payment_method, payment_status,
    order_discount, shipping_charge, adjustment, paid_amount,
    delivery_charge, packing_charge, placed_at, created_by, updated_by
  ) VALUES (
    public.next_order_number(),
    coalesce((_payload->>'source')::public.order_source, 'admin'),
    btrim(_payload->>'customer_name'),
    btrim(_payload->>'customer_phone'),
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

  IF coalesce(btrim(_order.customer_name), '') = '' THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  IF coalesce(btrim(_order.customer_phone), '') = '' THEN RAISE EXCEPTION 'Customer phone is required'; END IF;

  INSERT INTO public.order_addresses (
    order_id, recipient_name, phone, address_line, area, district, division, postal_code, country
  ) VALUES (
    _order.id,
    coalesce(nullif(btrim(coalesce(_payload#>>'{address,recipient_name}','')),''), _order.customer_name),
    coalesce(nullif(btrim(coalesce(_payload#>>'{address,phone}','')),''), _order.customer_phone),
    coalesce(nullif(btrim(coalesce(_payload#>>'{address,address_line}','')),''),
             (SELECT NULL::text WHERE false)),
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
END; $function$;

-- ============ 2. SHIPMENT ACTUAL COURIER MONEY ============
ALTER TABLE public.shipments
  ADD COLUMN actual_delivery_fee numeric(12,2),
  ADD COLUMN cod_fee numeric(12,2),
  ADD COLUMN return_charge numeric(12,2),
  ADD COLUMN other_courier_charge numeric(12,2),
  ADD COLUMN collected_amount numeric(12,2),
  ADD COLUMN financials_recorded_at timestamptz,
  ADD COLUMN financials_recorded_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION public.record_shipment_financials(
  _shipment_id uuid,
  _collected_amount numeric DEFAULT NULL,
  _actual_delivery_fee numeric DEFAULT NULL,
  _cod_fee numeric DEFAULT NULL,
  _return_charge numeric DEFAULT NULL,
  _other_courier_charge numeric DEFAULT NULL,
  _note text DEFAULT NULL)
RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record shipment financials';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  IF coalesce(_collected_amount, 0) < 0 OR coalesce(_actual_delivery_fee, 0) < 0
     OR coalesce(_cod_fee, 0) < 0 OR coalesce(_return_charge, 0) < 0
     OR coalesce(_other_courier_charge, 0) < 0 THEN
    RAISE EXCEPTION 'Financial amounts cannot be negative';
  END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    collected_amount = coalesce(_collected_amount, collected_amount),
    actual_delivery_fee = coalesce(_actual_delivery_fee, actual_delivery_fee),
    cod_fee = coalesce(_cod_fee, cod_fee),
    return_charge = coalesce(_return_charge, return_charge),
    other_courier_charge = coalesce(_other_courier_charge, other_courier_charge),
    financials_recorded_at = now(), financials_recorded_by = auth.uid(), updated_by = auth.uid()
  WHERE id = _shipment_id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'status_updated', _s.status, _s.status,
    coalesce(nullif(btrim(coalesce(_note,'')),''), 'Courier financial values recorded.'),
    jsonb_build_object('collected_amount', _s.collected_amount,
                       'actual_delivery_fee', _s.actual_delivery_fee,
                       'cod_fee', _s.cod_fee, 'return_charge', _s.return_charge,
                       'other_courier_charge', _s.other_courier_charge));
  RETURN _s;
END; $$;

-- ============ 3. ORDER FINANCIAL ADJUSTMENTS ============
CREATE TABLE public.order_financial_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  adjustment_type public.financial_adjustment_type NOT NULL,
  direction public.financial_adjustment_direction NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text,
  reference text,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  return_id uuid REFERENCES public.order_returns(id) ON DELETE SET NULL,
  settlement_id uuid,
  reversal_of uuid REFERENCES public.order_financial_adjustments(id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ofa_order ON public.order_financial_adjustments(order_id);
CREATE INDEX idx_ofa_type ON public.order_financial_adjustments(adjustment_type);
CREATE UNIQUE INDEX idx_ofa_reversal_once ON public.order_financial_adjustments(reversal_of)
  WHERE reversal_of IS NOT NULL;

GRANT SELECT ON public.order_financial_adjustments TO authenticated;
GRANT ALL ON public.order_financial_adjustments TO service_role;
ALTER TABLE public.order_financial_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can read adjustments"
  ON public.order_financial_adjustments FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_financial_adjustment_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.financial_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Financial adjustments can only be changed through the financial workflow functions.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_financial_adjustment_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_financial_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_adjustment_write();

-- ============ 4. COURIER SETTLEMENTS ============
CREATE TABLE public.courier_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_account_id uuid NOT NULL REFERENCES public.courier_accounts(id) ON DELETE RESTRICT,
  settlement_reference text NOT NULL,
  status public.courier_settlement_status NOT NULL DEFAULT 'draft',
  settlement_date date,
  expected_amount numeric(14,2) NOT NULL DEFAULT 0,
  actual_amount numeric(14,2),
  notes text,
  finalized_at timestamptz,
  finalized_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_settlement_ref ON public.courier_settlements(courier_account_id, settlement_reference);
CREATE INDEX idx_settlement_status ON public.courier_settlements(status);
CREATE TRIGGER set_courier_settlements_updated_at BEFORE UPDATE ON public.courier_settlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.courier_settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.courier_settlements(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  expected_collected_amount numeric(12,2) NOT NULL DEFAULT 0,
  actual_collected_amount numeric(12,2),
  delivery_charge numeric(12,2),
  cod_charge numeric(12,2),
  return_charge numeric(12,2),
  other_charge numeric(12,2),
  net_settlement_amount numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_settlement_item_unique ON public.courier_settlement_items(settlement_id, shipment_id);
CREATE INDEX idx_settlement_item_order ON public.courier_settlement_items(order_id);
CREATE TRIGGER set_courier_settlement_items_updated_at BEFORE UPDATE ON public.courier_settlement_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.courier_settlements TO authenticated;
GRANT ALL ON public.courier_settlements TO service_role;
GRANT SELECT ON public.courier_settlement_items TO authenticated;
GRANT ALL ON public.courier_settlement_items TO service_role;
ALTER TABLE public.courier_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_settlement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can read settlements"
  ON public.courier_settlements FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "Commerce readers can read settlement items"
  ON public.courier_settlement_items FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_settlement_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.financial_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Settlement records can only be changed through the settlement workflow functions.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_courier_settlements_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.courier_settlements
  FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_write();
CREATE TRIGGER guard_courier_settlement_items_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.courier_settlement_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_write();

-- ============ 5. FINANCIAL RPCs ============
CREATE OR REPLACE FUNCTION public.create_financial_adjustment(
  _order_id uuid,
  _adjustment_type public.financial_adjustment_type,
  _direction public.financial_adjustment_direction,
  _amount numeric,
  _reason text DEFAULT NULL,
  _reference text DEFAULT NULL,
  _shipment_id uuid DEFAULT NULL,
  _return_id uuid DEFAULT NULL)
RETURNS public.order_financial_adjustments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _row public.order_financial_adjustments; _order public.orders;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record financial adjustments';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _shipment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.shipments WHERE id = _shipment_id AND order_id = _order_id) THEN
    RAISE EXCEPTION 'Shipment does not belong to this order';
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  INSERT INTO public.order_financial_adjustments (
    order_id, adjustment_type, direction, amount, reason, reference,
    shipment_id, return_id, created_by)
  VALUES (_order_id, _adjustment_type, _direction, round(_amount, 2),
          nullif(btrim(coalesce(_reason,'')),''), nullif(btrim(coalesce(_reference,'')),''),
          _shipment_id, _return_id, auth.uid())
  RETURNING * INTO _row;
  PERFORM set_config('app.financial_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
    'Financial adjustment: ' || _direction || ' ' || _adjustment_type || ' BDT ' || round(_amount,2)
      || coalesce(' — ' || _row.reason, '') || coalesce(' (ref ' || _row.reference || ')', '') || '.',
    'system', true, auth.uid());
  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_financial_adjustment(
  _adjustment_id uuid, _reason text DEFAULT NULL)
RETURNS public.order_financial_adjustments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _orig public.order_financial_adjustments; _row public.order_financial_adjustments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to reverse financial adjustments';
  END IF;
  SELECT * INTO _orig FROM public.order_financial_adjustments WHERE id = _adjustment_id FOR UPDATE;
  IF _orig.id IS NULL THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'This adjustment is already reversed'; END IF;
  IF _orig.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'A reversal cannot itself be reversed'; END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  INSERT INTO public.order_financial_adjustments (
    order_id, adjustment_type, direction, amount, reason, reference,
    shipment_id, return_id, reversal_of, created_by)
  VALUES (_orig.order_id, _orig.adjustment_type,
          CASE WHEN _orig.direction = 'income' THEN 'expense'::public.financial_adjustment_direction
               ELSE 'income'::public.financial_adjustment_direction END,
          _orig.amount,
          coalesce(nullif(btrim(coalesce(_reason,'')),''), 'Reversal of an earlier adjustment'),
          _orig.reference, _orig.shipment_id, _orig.return_id, _orig.id, auth.uid())
  RETURNING * INTO _row;
  UPDATE public.order_financial_adjustments
     SET reversed_at = now(), reversed_by = auth.uid() WHERE id = _orig.id;
  PERFORM set_config('app.financial_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_orig.order_id, 'Financial adjustment reversed (' || _orig.adjustment_type
    || ' BDT ' || _orig.amount || ').', 'system', true, auth.uid());
  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.create_courier_settlement(
  _courier_account_id uuid, _settlement_reference text,
  _settlement_date date DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS public.courier_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _row public.courier_settlements;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create settlements';
  END IF;
  IF coalesce(btrim(coalesce(_settlement_reference,'')),'') = '' THEN
    RAISE EXCEPTION 'A settlement reference is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courier_accounts WHERE id = _courier_account_id) THEN
    RAISE EXCEPTION 'Courier account not found';
  END IF;
  PERFORM set_config('app.financial_write', 'on', true);
  INSERT INTO public.courier_settlements (
    courier_account_id, settlement_reference, settlement_date, notes, created_by, updated_by)
  VALUES (_courier_account_id, btrim(_settlement_reference), _settlement_date,
          nullif(btrim(coalesce(_notes,'')),''), auth.uid(), auth.uid())
  RETURNING * INTO _row;
  PERFORM set_config('app.financial_write', 'off', true);
  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.add_settlement_item(_settlement_id uuid, _shipment_id uuid)
RETURNS public.courier_settlement_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st public.courier_settlements; _s public.shipments; _row public.courier_settlement_items;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _settlement_id FOR UPDATE;
  IF _st.id IS NULL THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF _st.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'A % settlement can no longer be changed', _st.status;
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.courier_settlement_items i
              JOIN public.courier_settlements s ON s.id = i.settlement_id
             WHERE i.shipment_id = _shipment_id AND s.status <> 'cancelled') THEN
    RAISE EXCEPTION 'This shipment is already part of another settlement';
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  INSERT INTO public.courier_settlement_items (
    settlement_id, order_id, shipment_id, expected_collected_amount)
  VALUES (_settlement_id, _s.order_id, _s.id, coalesce(_s.cash_on_delivery_amount, 0))
  RETURNING * INTO _row;
  UPDATE public.courier_settlements s
     SET expected_amount = (SELECT coalesce(sum(expected_collected_amount),0)
                              FROM public.courier_settlement_items WHERE settlement_id = s.id),
         updated_by = auth.uid()
   WHERE s.id = _settlement_id;
  PERFORM set_config('app.financial_write', 'off', true);
  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_settlement_item(_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st public.courier_settlements; _sid uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;
  SELECT s.* INTO _st FROM public.courier_settlements s
    JOIN public.courier_settlement_items i ON i.settlement_id = s.id
   WHERE i.id = _item_id FOR UPDATE OF s;
  IF _st.id IS NULL THEN RAISE EXCEPTION 'Settlement item not found'; END IF;
  IF _st.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'A % settlement can no longer be changed', _st.status;
  END IF;
  _sid := _st.id;
  PERFORM set_config('app.financial_write', 'on', true);
  DELETE FROM public.courier_settlement_items WHERE id = _item_id;
  UPDATE public.courier_settlements s
     SET expected_amount = (SELECT coalesce(sum(expected_collected_amount),0)
                              FROM public.courier_settlement_items WHERE settlement_id = s.id),
         updated_by = auth.uid()
   WHERE s.id = _sid;
  PERFORM set_config('app.financial_write', 'off', true);
END; $$;

CREATE OR REPLACE FUNCTION public.record_settlement_actuals(
  _item_id uuid,
  _actual_collected_amount numeric DEFAULT NULL,
  _delivery_charge numeric DEFAULT NULL,
  _cod_charge numeric DEFAULT NULL,
  _return_charge numeric DEFAULT NULL,
  _other_charge numeric DEFAULT NULL)
RETURNS public.courier_settlement_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st public.courier_settlements; _row public.courier_settlement_items;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;
  SELECT * INTO _row FROM public.courier_settlement_items WHERE id = _item_id FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Settlement item not found'; END IF;
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _row.settlement_id FOR UPDATE;
  IF _st.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'A % settlement can no longer be changed', _st.status;
  END IF;
  IF coalesce(_actual_collected_amount,0) < 0 OR coalesce(_delivery_charge,0) < 0
     OR coalesce(_cod_charge,0) < 0 OR coalesce(_return_charge,0) < 0
     OR coalesce(_other_charge,0) < 0 THEN
    RAISE EXCEPTION 'Financial amounts cannot be negative';
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_settlement_items SET
    actual_collected_amount = coalesce(_actual_collected_amount, actual_collected_amount),
    delivery_charge = coalesce(_delivery_charge, delivery_charge),
    cod_charge = coalesce(_cod_charge, cod_charge),
    return_charge = coalesce(_return_charge, return_charge),
    other_charge = coalesce(_other_charge, other_charge)
  WHERE id = _item_id RETURNING * INTO _row;
  UPDATE public.courier_settlement_items SET
    net_settlement_amount = coalesce(actual_collected_amount,0) - coalesce(delivery_charge,0)
      - coalesce(cod_charge,0) - coalesce(return_charge,0) - coalesce(other_charge,0)
  WHERE id = _item_id RETURNING * INTO _row;
  UPDATE public.courier_settlements s
     SET status = CASE WHEN s.status = 'draft' THEN 'pending'::public.courier_settlement_status
                       ELSE s.status END,
         updated_by = auth.uid()
   WHERE s.id = _row.settlement_id;
  PERFORM set_config('app.financial_write', 'off', true);

  -- Actual courier money lives on the shipment: one source of truth.
  PERFORM public.record_shipment_financials(_row.shipment_id,
    _row.actual_collected_amount, _row.delivery_charge, _row.cod_charge,
    _row.return_charge, _row.other_charge,
    'Courier settlement ' || _st.settlement_reference || ' actuals recorded.');
  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.set_settlement_status(
  _settlement_id uuid, _status public.courier_settlement_status, _note text DEFAULT NULL)
RETURNS public.courier_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st public.courier_settlements; _missing int;
BEGIN
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _settlement_id FOR UPDATE;
  IF _st.id IS NULL THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF _st.status = 'settled' THEN
    RAISE EXCEPTION 'A settled settlement is locked. Record a correcting financial adjustment instead.';
  END IF;
  IF _status IN ('settled','disputed','cancelled') THEN
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only an admin or owner can mark a settlement % ', _status;
    END IF;
  ELSIF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;

  IF _status = 'settled' THEN
    SELECT count(*) INTO _missing FROM public.courier_settlement_items
     WHERE settlement_id = _settlement_id AND actual_collected_amount IS NULL;
    IF _missing > 0 THEN
      RAISE EXCEPTION 'Record actual collected amounts on every settlement line before settling';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.courier_settlement_items WHERE settlement_id = _settlement_id) THEN
      RAISE EXCEPTION 'A settlement needs at least one line before it can be settled';
    END IF;
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_settlements SET
    status = _status,
    actual_amount = (SELECT coalesce(sum(net_settlement_amount),0)
                       FROM public.courier_settlement_items WHERE settlement_id = _settlement_id),
    notes = coalesce(nullif(btrim(coalesce(_note,'')),''), notes),
    finalized_at = CASE WHEN _status = 'settled' THEN now() ELSE finalized_at END,
    finalized_by = CASE WHEN _status = 'settled' THEN auth.uid() ELSE finalized_by END,
    updated_by = auth.uid()
  WHERE id = _settlement_id RETURNING * INTO _st;
  PERFORM set_config('app.financial_write', 'off', true);
  RETURN _st;
END; $$;

-- ============ 6. PROFITABILITY PROJECTION ============
CREATE OR REPLACE FUNCTION public.order_financials(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _o public.orders;
  _est_product_cost numeric := 0; _actual_product_cost numeric := 0;
  _cost_known boolean := true;
  _shipments int := 0; _ship_with_collection int := 0; _ship_with_fee int := 0;
  _collected numeric := 0; _actual_delivery numeric := 0; _cod_fees numeric := 0;
  _return_charges numeric := 0; _other_courier numeric := 0;
  _adj_income numeric := 0; _adj_expense numeric := 0; _adj_packing numeric := 0;
  _est_delivery numeric := 0; _packing numeric := 0;
  _est_profit numeric; _actual_profit numeric;
  _completeness text;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read financial data';
  END IF;
  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF _o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  SELECT
    coalesce(sum(coalesce(oi.unit_cost,0) * oi.quantity), 0),
    coalesce(sum(coalesce(oi.unit_cost,0) * greatest(oi.quantity - coalesce(r.returned_qty,0), 0)), 0),
    bool_and(oi.unit_cost IS NOT NULL)
  INTO _est_product_cost, _actual_product_cost, _cost_known
  FROM public.order_items oi
  LEFT JOIN LATERAL (
    SELECT sum(ri.quantity_accepted) AS returned_qty
      FROM public.order_return_items ri
      JOIN public.order_returns ret ON ret.id = ri.return_id
     WHERE ri.order_item_id = oi.id
       AND ret.status IN ('received','inspected','completed')
  ) r ON true
  WHERE oi.order_id = _order_id;

  SELECT count(*),
         count(*) FILTER (WHERE collected_amount IS NOT NULL),
         count(*) FILTER (WHERE actual_delivery_fee IS NOT NULL),
         coalesce(sum(collected_amount),0), coalesce(sum(actual_delivery_fee),0),
         coalesce(sum(cod_fee),0), coalesce(sum(return_charge),0),
         coalesce(sum(other_courier_charge),0),
         coalesce(sum(coalesce(booked_delivery_fee, quoted_delivery_fee, 0)),0)
    INTO _shipments, _ship_with_collection, _ship_with_fee, _collected, _actual_delivery,
         _cod_fees, _return_charges, _other_courier, _est_delivery
  FROM public.shipments WHERE order_id = _order_id AND status <> 'cancelled';

  IF _est_delivery = 0 THEN _est_delivery := coalesce(_o.delivery_charge, 0); END IF;

  SELECT
    coalesce(sum(amount) FILTER (WHERE direction = 'income'), 0),
    coalesce(sum(amount) FILTER (WHERE direction = 'expense'), 0),
    coalesce(sum(amount) FILTER (WHERE direction = 'expense' AND adjustment_type = 'packing_cost'), 0)
      - coalesce(sum(amount) FILTER (WHERE direction = 'income' AND adjustment_type = 'packing_cost'), 0)
  INTO _adj_income, _adj_expense, _adj_packing
  FROM public.order_financial_adjustments WHERE order_id = _order_id;

  _packing := coalesce(_o.packing_charge, 0) + _adj_packing;

  _est_profit := _o.grand_total - _est_product_cost - _est_delivery - coalesce(_o.packing_charge,0);

  _actual_profit := _collected - _actual_product_cost - _actual_delivery - _cod_fees
                    - _return_charges - _other_courier - _packing - _adj_expense + _adj_income
                    + _adj_packing * 0;

  IF _shipments = 0 THEN
    _completeness := CASE WHEN _adj_expense + _adj_income > 0 THEN 'partially_actual' ELSE 'estimated' END;
  ELSIF _ship_with_collection = _shipments AND _ship_with_fee = _shipments THEN
    _completeness := 'actual';
  ELSIF _ship_with_collection > 0 OR _ship_with_fee > 0 OR (_adj_expense + _adj_income) > 0 THEN
    _completeness := 'partially_actual';
  ELSE
    _completeness := 'estimated';
  END IF;

  RETURN jsonb_build_object(
    'order_id', _o.id,
    'revenue', jsonb_build_object(
      'gross_product_amount', _o.subtotal,
      'item_discounts', _o.product_discount,
      'order_discounts', _o.order_discount,
      'net_product_revenue', _o.subtotal - _o.product_discount - _o.order_discount,
      'shipping_revenue', _o.shipping_charge,
      'other_adjustments', _o.adjustment,
      'customer_total', _o.grand_total),
    'estimated', jsonb_build_object(
      'product_cost', _est_product_cost,
      'delivery_cost', _est_delivery,
      'packing_cost', coalesce(_o.packing_charge,0),
      'profit', _est_profit,
      'cost_snapshot_complete', coalesce(_cost_known, true)),
    'actual', jsonb_build_object(
      'collected_amount', _collected,
      'product_cost', _actual_product_cost,
      'delivery_cost', _actual_delivery,
      'cod_fees', _cod_fees,
      'return_charges', _return_charges,
      'other_courier_charges', _other_courier,
      'packing_cost', _packing,
      'adjustment_income', _adj_income,
      'adjustment_expense', _adj_expense,
      'profit', _actual_profit),
    'shipping_margin', _o.shipping_charge - CASE WHEN _actual_delivery > 0 THEN _actual_delivery ELSE _est_delivery END,
    'shipment_count', _shipments,
    'shipments_with_collection', _ship_with_collection,
    'completeness', _completeness);
END; $$;

-- ============ 7. PRIVILEGE HYGIENE ============
REVOKE EXECUTE ON FUNCTION public.create_financial_adjustment(uuid, public.financial_adjustment_type, public.financial_adjustment_direction, numeric, text, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_financial_adjustment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_shipment_financials(uuid, numeric, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_courier_settlement(uuid, text, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_settlement_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_settlement_item(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_settlement_actuals(uuid, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_settlement_status(uuid, public.courier_settlement_status, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.order_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_financial_adjustment(uuid, public.financial_adjustment_type, public.financial_adjustment_direction, numeric, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_financial_adjustment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_shipment_financials(uuid, numeric, numeric, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_courier_settlement(uuid, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_settlement_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_settlement_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_settlement_actuals(uuid, numeric, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_settlement_status(uuid, public.courier_settlement_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_financials(uuid) TO authenticated;
