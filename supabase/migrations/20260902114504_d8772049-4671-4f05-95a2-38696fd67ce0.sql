-- ============ ENUMS ============
CREATE TYPE public.order_source AS ENUM ('admin','web','mobile','facebook','whatsapp','phone','import','api');
CREATE TYPE public.order_status AS ENUM ('draft','created','cancelled');
CREATE TYPE public.order_verification_status AS ENUM ('not_required','pending');
CREATE TYPE public.order_fulfillment_status AS ENUM ('unfulfilled');
CREATE TYPE public.order_delivery_status AS ENUM ('not_shipped');
CREATE TYPE public.order_financial_status AS ENUM ('not_applicable');
CREATE TYPE public.payment_status AS ENUM ('unpaid','partial','paid','refunded');
CREATE TYPE public.payment_method AS ENUM ('cod','cash','bkash','nagad','rocket','card','bank_transfer','other');
CREATE TYPE public.order_note_type AS ENUM ('general','system');

-- ============ ORDER NUMBER ============
CREATE SEQUENCE public.order_number_seq;

CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'ORD-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.order_number_seq')::text, 6, '0');
$$;

-- ============ ORDERS ============
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  source public.order_source NOT NULL DEFAULT 'admin',

  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,

  status public.order_status NOT NULL DEFAULT 'draft',
  verification_status public.order_verification_status NOT NULL DEFAULT 'not_required',
  fulfillment_status public.order_fulfillment_status NOT NULL DEFAULT 'unfulfilled',
  delivery_status public.order_delivery_status NOT NULL DEFAULT 'not_shipped',
  financial_status public.order_financial_status NOT NULL DEFAULT 'not_applicable',

  payment_method public.payment_method NOT NULL DEFAULT 'cod',
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',

  -- customer facing money
  subtotal numeric(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  product_discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (product_discount >= 0),
  order_discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (order_discount >= 0),
  shipping_charge numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_charge >= 0),
  adjustment numeric(12,2) NOT NULL DEFAULT 0,
  grand_total numeric(12,2) NOT NULL GENERATED ALWAYS AS
    (subtotal - product_discount - order_discount + shipping_charge + adjustment) STORED,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_amount numeric(12,2) GENERATED ALWAYS AS
    (subtotal - product_discount - order_discount + shipping_charge + adjustment - paid_amount) STORED,

  -- internal operational cost (never exposed publicly)
  delivery_charge numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  packing_charge numeric(12,2) NOT NULL DEFAULT 0 CHECK (packing_charge >= 0),

  cancelled_at timestamptz,
  placed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_grand_total_non_negative CHECK
    (subtotal - product_discount - order_discount + shipping_charge + adjustment >= 0)
);

CREATE INDEX orders_created_at_idx ON public.orders (created_at DESC);
CREATE INDEX orders_status_idx ON public.orders (status);
CREATE INDEX orders_payment_status_idx ON public.orders (payment_status);
CREATE INDEX orders_customer_phone_idx ON public.orders (customer_phone);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_read" ON public.orders FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "orders_insert" ON public.orders FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid())) WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "orders_delete" ON public.orders FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- order number immutability
CREATE OR REPLACE FUNCTION public.guard_order_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Order number is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_guard_number BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_number();

-- money/items may only change while the order is a draft
CREATE OR REPLACE FUNCTION public.guard_order_money()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.order_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF OLD.status <> 'draft' AND (
       NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.product_discount IS DISTINCT FROM OLD.product_discount
    OR NEW.order_discount IS DISTINCT FROM OLD.order_discount
    OR NEW.shipping_charge IS DISTINCT FROM OLD.shipping_charge
    OR NEW.adjustment IS DISTINCT FROM OLD.adjustment) THEN
    RAISE EXCEPTION 'Order totals can only be changed while the order is a draft';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_guard_money BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_money();

-- ============ ORDER ADDRESSES ============
CREATE TABLE public.order_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  address_type text NOT NULL DEFAULT 'shipping',
  recipient_name text NOT NULL,
  phone text NOT NULL,
  address_line text NOT NULL,
  area text,
  district text,
  division text,
  postal_code text,
  country text NOT NULL DEFAULT 'Bangladesh',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_addresses TO authenticated;
GRANT ALL ON public.order_addresses TO service_role;
ALTER TABLE public.order_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_addresses_read" ON public.order_addresses FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "order_addresses_insert" ON public.order_addresses FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "order_addresses_update" ON public.order_addresses FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid())) WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "order_addresses_delete" ON public.order_addresses FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER order_addresses_set_updated_at BEFORE UPDATE ON public.order_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ORDER ITEMS ============
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  variant_name text,
  sku text,
  product_type public.product_type,
  quantity integer NOT NULL CHECK (quantity >= 1),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  compare_at_price numeric(12,2),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total numeric(12,2) GENERATED ALWAYS AS ((quantity * unit_price) - discount_amount) STORED,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_discount_within_line CHECK (discount_amount <= quantity * unit_price)
);
CREATE INDEX order_items_order_id_idx ON public.order_items (order_id);
CREATE INDEX order_items_product_id_idx ON public.order_items (product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_items_read" ON public.order_items FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "order_items_insert" ON public.order_items FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "order_items_update" ON public.order_items FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid())) WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "order_items_delete" ON public.order_items FOR DELETE TO authenticated USING (public.can_manage_commerce(auth.uid()));

-- items frozen once the order leaves draft
CREATE OR REPLACE FUNCTION public.guard_order_items_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _status public.order_status; _order uuid;
BEGIN
  IF coalesce(current_setting('app.order_write', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  _order := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT status INTO _status FROM public.orders WHERE id = _order;
  IF _status IS NOT NULL AND _status <> 'draft' THEN
    RAISE EXCEPTION 'Order items cannot be changed after the order has been created';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER order_items_guard_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_items_immutable();

-- ============ ORDER NOTES (append only) ============
CREATE TABLE public.order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  note text NOT NULL,
  note_type public.order_note_type NOT NULL DEFAULT 'general',
  is_internal boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_notes_order_id_idx ON public.order_notes (order_id, created_at DESC);
GRANT SELECT, INSERT ON public.order_notes TO authenticated;
GRANT ALL ON public.order_notes TO service_role;
ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_notes_read" ON public.order_notes FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "order_notes_insert" ON public.order_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commerce(auth.uid()) AND note_type = 'general' AND created_by = auth.uid());

-- ============ ATOMIC ORDER CREATION ============
CREATE OR REPLACE FUNCTION public.create_order(_payload jsonb)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _order public.orders;
  _item jsonb;
  _product public.products;
  _variant public.product_variants;
  _name text; _variant_name text; _sku text; _price numeric; _compare numeric;
  _qty int; _disc numeric; _idx int := 0;
  _subtotal numeric := 0; _item_discount numeric := 0;
  _status public.order_status;
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
    ELSE
      IF _product.product_type = 'variable' THEN
        RAISE EXCEPTION 'Product "%" is a variable product — select a variant instead', _product.name;
      END IF;
      _variant := NULL;
      _variant_name := NULL;
      _sku := _product.sku;
      _price := _product.price;
      _compare := _product.compare_at_price;
    END IF;

    IF _product.status <> 'active' OR NOT _product.is_purchasable THEN
      RAISE EXCEPTION 'Product "%" is not purchasable', _product.name;
    END IF;

    _name := _product.name;
    IF _disc > _qty * _price THEN RAISE EXCEPTION 'Item discount exceeds the line value'; END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, sku, product_type,
      quantity, unit_price, compare_at_price, discount_amount, sort_order
    ) VALUES (
      _order.id, _product.id, _variant.id, _name, _variant_name, _sku, _product.product_type,
      _qty, _price, _compare, _disc, _idx
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

REVOKE ALL ON FUNCTION public.create_order(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb) TO authenticated, service_role;

-- ============ CANCELLATION ============
CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid, _reason text DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _order public.orders;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to cancel orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Order is already cancelled'; END IF;

  PERFORM set_config('app.order_write', 'on', true);
  UPDATE public.orders
     SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.order_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
    'Order cancelled' || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.',
    'system', true, auth.uid());

  RETURN _order;
END; $$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_order_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_order_number() TO service_role;