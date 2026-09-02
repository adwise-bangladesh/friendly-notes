
-- ============ Enums ============
CREATE TYPE public.customer_status AS ENUM ('active','inactive','blocked');
CREATE TYPE public.customer_manual_flag_type AS ENUM ('manual_attention','trusted','payment_risk','address_risk','other');

-- ============ Phone normalization (single source of truth) ============
CREATE OR REPLACE FUNCTION public.normalize_bd_phone(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Reduces 017XXXXXXXX / 8801XXXXXXXXX / +8801XXXXXXXXX / 0088... to a single
  -- canonical 11-digit local form (01XXXXXXXXX). Anything that is not a
  -- recognisable Bangladesh mobile number is returned digits-only so unrelated
  -- numbers never collapse onto each other.
  SELECT CASE
    WHEN d IS NULL OR d = '' THEN NULL
    WHEN length(d) = 11 AND d LIKE '01%' THEN d
    WHEN length(d) = 13 AND d LIKE '8801%' THEN substr(d, 3)
    WHEN length(d) = 15 AND d LIKE '008801%' THEN substr(d, 5)
    WHEN length(d) = 10 AND d LIKE '1%' THEN '0' || d
    ELSE d
  END
  FROM (SELECT regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g') AS d) s;
$$;

CREATE OR REPLACE FUNCTION public.repeat_customer_threshold()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT 2; $$;

-- ============ customers ============
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  primary_phone text NOT NULL,
  primary_phone_normalized text GENERATED ALWAYS AS (public.normalize_bd_phone(primary_phone)) STORED,
  secondary_phone text,
  secondary_phone_normalized text GENERATED ALWAYS AS (public.normalize_bd_phone(secondary_phone)) STORED,
  email text,
  status public.customer_status NOT NULL DEFAULT 'active',
  block_reason text,
  blocked_at timestamptz,
  blocked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT customers_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT customers_phone_not_blank CHECK (btrim(primary_phone) <> ''),
  CONSTRAINT customers_block_reason_required
    CHECK (status <> 'blocked' OR btrim(coalesce(block_reason,'')) <> '')
);

CREATE UNIQUE INDEX customers_primary_phone_norm_key
  ON public.customers (primary_phone_normalized)
  WHERE primary_phone_normalized IS NOT NULL;
CREATE INDEX customers_secondary_phone_norm_idx
  ON public.customers (secondary_phone_normalized)
  WHERE secondary_phone_normalized IS NOT NULL;
CREATE INDEX customers_name_idx ON public.customers (lower(name));
CREATE INDEX customers_email_idx ON public.customers (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX customers_status_idx ON public.customers (status);

GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers view customers" ON public.customers
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "Staff create customers" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "Staff update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));

-- Blocking state is controlled: only the dedicated function may change it.
CREATE OR REPLACE FUNCTION public.guard_customer_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.customer_write', true) = 'on' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'blocked' THEN
      RAISE EXCEPTION 'A customer cannot be created as blocked';
    END IF;
    NEW.block_reason := NULL; NEW.blocked_at := NULL; NEW.blocked_by := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.block_reason IS DISTINCT FROM OLD.block_reason
     OR NEW.blocked_at IS DISTINCT FROM OLD.blocked_at
     OR NEW.blocked_by IS DISTINCT FROM OLD.blocked_by THEN
    RAISE EXCEPTION 'Customer status and blocking are changed through set_customer_status only';
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER customers_guard
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_write();

-- ============ customer_notes (append only) ============
CREATE TABLE public.customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_notes_not_blank CHECK (btrim(note) <> '')
);
CREATE INDEX customer_notes_customer_idx ON public.customer_notes (customer_id, created_at DESC);

GRANT SELECT ON public.customer_notes TO authenticated;
GRANT ALL ON public.customer_notes TO service_role;
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers view customer notes" ON public.customer_notes
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_customer_notes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.customer_write', true) <> 'on' THEN
    RAISE EXCEPTION 'Customer notes are written through add_customer_note only';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Customer notes are append only';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER customer_notes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.customer_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_notes();

-- ============ customer_manual_flags ============
CREATE TABLE public.customer_manual_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  flag public.customer_manual_flag_type NOT NULL,
  reason text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  cleared_by uuid,
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_flag_reason_not_blank CHECK (btrim(reason) <> '')
);
CREATE UNIQUE INDEX customer_manual_flags_active_key
  ON public.customer_manual_flags (customer_id, flag) WHERE is_active;
CREATE INDEX customer_manual_flags_customer_idx ON public.customer_manual_flags (customer_id);

GRANT SELECT ON public.customer_manual_flags TO authenticated;
GRANT ALL ON public.customer_manual_flags TO service_role;
ALTER TABLE public.customer_manual_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers view customer flags" ON public.customer_manual_flags
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_customer_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.customer_write', true) <> 'on' THEN
    RAISE EXCEPTION 'Customer flags are managed through set_customer_manual_flag only';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Customer flags are never deleted'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER customer_manual_flags_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.customer_manual_flags
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_flags();

-- ============ Orders link ============
ALTER TABLE public.orders
  ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX orders_customer_idx ON public.orders (customer_id, created_at DESC);
CREATE INDEX orders_customer_phone_norm_idx
  ON public.orders (public.normalize_bd_phone(customer_phone));

-- ============ Matching + reuse ============
CREATE OR REPLACE FUNCTION public.find_customer_by_phone(_phone text)
RETURNS SETOF public.customers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _norm text;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read customers';
  END IF;
  _norm := public.normalize_bd_phone(_phone);
  IF _norm IS NULL OR _norm = '' THEN RETURN; END IF;
  RETURN QUERY
    SELECT * FROM public.customers
     WHERE primary_phone_normalized = _norm OR secondary_phone_normalized = _norm
     ORDER BY (primary_phone_normalized = _norm) DESC, created_at
     LIMIT 10;
END; $$;

-- Reuses an existing customer for a phone, or creates one. Never merges on name.
CREATE OR REPLACE FUNCTION public.resolve_customer_for_order(
  _name text, _phone text, _email text, _customer_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _norm text; _existing public.customers; _id uuid; _matches int;
BEGIN
  IF _customer_id IS NOT NULL THEN
    SELECT * INTO _existing FROM public.customers WHERE id = _customer_id;
    IF _existing.id IS NULL THEN RAISE EXCEPTION 'Selected customer not found'; END IF;
    RETURN _existing.id;
  END IF;

  _norm := public.normalize_bd_phone(_phone);
  IF _norm IS NULL OR _norm = '' THEN RETURN NULL; END IF;

  SELECT count(*) INTO _matches FROM public.customers
   WHERE primary_phone_normalized = _norm OR secondary_phone_normalized = _norm;

  IF _matches = 1 THEN
    SELECT id INTO _id FROM public.customers
     WHERE primary_phone_normalized = _norm OR secondary_phone_normalized = _norm;
    RETURN _id;
  ELSIF _matches > 1 THEN
    RAISE EXCEPTION 'This phone number matches more than one customer — pick the customer explicitly';
  END IF;

  PERFORM set_config('app.customer_write', 'on', true);
  INSERT INTO public.customers (name, primary_phone, email, created_by, updated_by)
  VALUES (btrim(_name), btrim(_phone), nullif(btrim(coalesce(_email,'')),''), auth.uid(), auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.resolve_customer_for_order(text,text,text,uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_customer_by_phone(text) FROM anon;

-- ============ Order creation now links the customer ============
CREATE OR REPLACE FUNCTION public.create_order(_payload jsonb)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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
  _customer_id uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create orders';
  END IF;

  IF jsonb_typeof(_payload->'items') <> 'array' OR jsonb_array_length(_payload->'items') = 0 THEN
    RAISE EXCEPTION 'An order needs at least one item';
  END IF;

  _status := coalesce((_payload->>'status')::public.order_status, 'created');
  IF _status = 'cancelled' THEN RAISE EXCEPTION 'A new order cannot start as cancelled'; END IF;

  _customer_id := public.resolve_customer_for_order(
    btrim(_payload->>'customer_name'),
    btrim(_payload->>'customer_phone'),
    _payload->>'customer_email',
    nullif(_payload->>'customer_id','')::uuid
  );

  PERFORM set_config('app.order_write', 'on', true);

  INSERT INTO public.orders (
    order_number, source, customer_id, customer_name, customer_phone, customer_email,
    status, payment_method, payment_status,
    order_discount, shipping_charge, adjustment, paid_amount,
    delivery_charge, packing_charge, placed_at, created_by, updated_by
  ) VALUES (
    public.next_order_number(),
    coalesce((_payload->>'source')::public.order_source, 'admin'),
    _customer_id,
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

-- ============ Controlled customer actions ============
CREATE OR REPLACE FUNCTION public.save_customer(_payload jsonb)
RETURNS public.customers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.customers; _id uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage customers';
  END IF;
  _id := nullif(_payload->>'id','')::uuid;
  PERFORM set_config('app.customer_write', 'on', true);

  IF _id IS NULL THEN
    INSERT INTO public.customers (name, primary_phone, secondary_phone, email, created_by, updated_by)
    VALUES (btrim(_payload->>'name'), btrim(_payload->>'primary_phone'),
            nullif(btrim(coalesce(_payload->>'secondary_phone','')),''),
            nullif(btrim(coalesce(_payload->>'email','')),''),
            auth.uid(), auth.uid())
    RETURNING * INTO _c;
  ELSE
    UPDATE public.customers SET
      name = btrim(_payload->>'name'),
      primary_phone = btrim(_payload->>'primary_phone'),
      secondary_phone = nullif(btrim(coalesce(_payload->>'secondary_phone','')),''),
      email = nullif(btrim(coalesce(_payload->>'email','')),''),
      updated_by = auth.uid(), updated_at = now()
    WHERE id = _id RETURNING * INTO _c;
    IF _c.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  END IF;

  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _c;
END; $$;

CREATE OR REPLACE FUNCTION public.set_customer_status(
  _customer_id uuid, _status public.customer_status, _reason text DEFAULT NULL
) RETURNS public.customers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.customers;
BEGIN
  IF _status = 'blocked' OR EXISTS (
       SELECT 1 FROM public.customers WHERE id = _customer_id AND status = 'blocked') THEN
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only an admin or owner can block or unblock a customer';
    END IF;
  ELSIF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage customers';
  END IF;

  IF _status = 'blocked' AND btrim(coalesce(_reason,'')) = '' THEN
    RAISE EXCEPTION 'A reason is required to block a customer';
  END IF;

  PERFORM set_config('app.customer_write', 'on', true);
  UPDATE public.customers SET
    status = _status,
    block_reason = CASE WHEN _status = 'blocked' THEN btrim(_reason) ELSE NULL END,
    blocked_at  = CASE WHEN _status = 'blocked' THEN now() ELSE NULL END,
    blocked_by  = CASE WHEN _status = 'blocked' THEN auth.uid() ELSE NULL END,
    updated_by = auth.uid(), updated_at = now()
  WHERE id = _customer_id RETURNING * INTO _c;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

  INSERT INTO public.customer_notes (customer_id, note, created_by)
  VALUES (_customer_id,
          CASE WHEN _status = 'blocked'
               THEN 'Customer blocked — ' || btrim(_reason)
               ELSE 'Customer status set to ' || _status::text END,
          auth.uid());
  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _c;
END; $$;

CREATE OR REPLACE FUNCTION public.add_customer_note(_customer_id uuid, _note text)
RETURNS public.customer_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n public.customer_notes;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to add customer notes';
  END IF;
  IF btrim(coalesce(_note,'')) = '' THEN RAISE EXCEPTION 'A note cannot be empty'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer_id) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;
  PERFORM set_config('app.customer_write', 'on', true);
  INSERT INTO public.customer_notes (customer_id, note, created_by)
  VALUES (_customer_id, btrim(_note), auth.uid()) RETURNING * INTO _n;
  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public.set_customer_manual_flag(
  _customer_id uuid, _flag public.customer_manual_flag_type, _active boolean, _reason text
) RETURNS public.customer_manual_flags
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f public.customer_manual_flags;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or owner can manage customer flags';
  END IF;
  IF btrim(coalesce(_reason,'')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer_id) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  PERFORM set_config('app.customer_write', 'on', true);
  IF _active THEN
    SELECT * INTO _f FROM public.customer_manual_flags
     WHERE customer_id = _customer_id AND flag = _flag AND is_active;
    IF _f.id IS NULL THEN
      INSERT INTO public.customer_manual_flags (customer_id, flag, reason, created_by)
      VALUES (_customer_id, _flag, btrim(_reason), auth.uid()) RETURNING * INTO _f;
    END IF;
  ELSE
    UPDATE public.customer_manual_flags
       SET is_active = false, cleared_by = auth.uid(), cleared_at = now(),
           updated_at = now(), reason = reason || ' | cleared: ' || btrim(_reason)
     WHERE customer_id = _customer_id AND flag = _flag AND is_active
     RETURNING * INTO _f;
    IF _f.id IS NULL THEN RAISE EXCEPTION 'That flag is not active for this customer'; END IF;
  END IF;
  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _f;
END; $$;

-- ============ Derived metrics ============
CREATE OR REPLACE FUNCTION public.customer_metrics(_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _delivered int; _returned int; _final int; _ver_req int; _ver_ok int;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read customer data';
  END IF;

  SELECT
    count(*) AS total_orders,
    count(*) FILTER (WHERE verification_status = 'confirmed') AS confirmed_orders,
    count(*) FILTER (WHERE status = 'cancelled') AS cancelled_orders,
    count(*) FILTER (WHERE delivery_status IN ('delivered','partially_delivered')) AS delivered_orders,
    count(*) FILTER (WHERE delivery_status IN ('returned','partially_returned')) AS returned_orders,
    count(*) FILTER (WHERE delivery_status IN
      ('delivered','partially_delivered','returned','partially_returned','delivery_failed')) AS final_orders,
    count(*) FILTER (WHERE delivery_status = 'delivery_failed') AS failed_deliveries,
    count(*) FILTER (WHERE verification_status <> 'not_required') AS verification_required,
    count(*) FILTER (WHERE verification_status IN ('failed','unreachable')) AS verification_failures,
    coalesce(sum(grand_total), 0) AS total_value,
    coalesce(sum(grand_total) FILTER (WHERE delivery_status IN ('delivered','partially_delivered')), 0) AS delivered_value,
    max(created_at) AS last_order_at,
    min(created_at) AS first_order_at
  INTO r
  FROM public.orders WHERE customer_id = _customer_id;

  _delivered := r.delivered_orders; _returned := r.returned_orders; _final := r.final_orders;
  _ver_req := r.verification_required; _ver_ok := r.confirmed_orders;

  RETURN jsonb_build_object(
    'customer_id', _customer_id,
    'total_orders', r.total_orders,
    'confirmed_orders', r.confirmed_orders,
    'cancelled_orders', r.cancelled_orders,
    'delivered_orders', _delivered,
    'returned_orders', _returned,
    'failed_deliveries', r.failed_deliveries,
    'final_outcome_orders', _final,
    'verification_required_orders', _ver_req,
    'verification_failure_orders', r.verification_failures,
    'total_order_value', r.total_value,
    'delivered_revenue', r.delivered_value,
    'average_order_value', CASE WHEN r.total_orders > 0
      THEN round(r.total_value / r.total_orders, 2) ELSE NULL END,
    'first_order_at', r.first_order_at,
    'last_order_at', r.last_order_at,
    'is_repeat_customer', r.total_orders >= public.repeat_customer_threshold(),
    -- delivered / orders that reached a final delivery outcome
    'delivery_success_rate', CASE WHEN _final > 0
      THEN round(_delivered::numeric * 100 / _final, 1) ELSE NULL END,
    -- returned / (delivered + returned): a returned order is never also delivered
    'return_rate', CASE WHEN (_delivered + _returned) > 0
      THEN round(_returned::numeric * 100 / (_delivered + _returned), 1) ELSE NULL END,
    'verification_success_rate', CASE WHEN _ver_req > 0
      THEN round(_ver_ok::numeric * 100 / _ver_req, 1) ELSE NULL END
  );
END; $$;

CREATE OR REPLACE FUNCTION public.customer_list(
  _search text DEFAULT NULL,
  _status public.customer_status DEFAULT NULL,
  _customer_type text DEFAULT NULL,      -- 'new' | 'repeat'
  _attention boolean DEFAULT false,
  _limit int DEFAULT 25,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb; _total bigint; _term text; _norm text; _lim int;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read customers';
  END IF;
  _lim := least(greatest(coalesce(_limit,25),1), 100);
  _term := nullif(btrim(lower(coalesce(_search,''))),'');
  _norm := CASE WHEN _term IS NULL THEN NULL ELSE public.normalize_bd_phone(_term) END;

  WITH agg AS (
    SELECT c.id, c.name, c.primary_phone, c.email, c.status, c.created_at,
           count(o.id) AS total_orders,
           count(o.id) FILTER (WHERE o.delivery_status IN ('delivered','partially_delivered')) AS delivered_orders,
           count(o.id) FILTER (WHERE o.delivery_status IN ('returned','partially_returned')) AS returned_orders,
           count(o.id) FILTER (WHERE o.delivery_status IN
             ('delivered','partially_delivered','returned','partially_returned','delivery_failed')) AS final_orders,
           count(o.id) FILTER (WHERE o.verification_status IN ('failed','unreachable')) AS verification_failures,
           count(o.id) FILTER (WHERE o.delivery_status = 'delivery_failed') AS failed_deliveries,
           max(o.created_at) AS last_order_at,
           EXISTS (SELECT 1 FROM public.customer_manual_flags f
                    WHERE f.customer_id = c.id AND f.is_active) AS has_manual_flag
      FROM public.customers c
      LEFT JOIN public.orders o ON o.customer_id = c.id
     WHERE (_status IS NULL OR c.status = _status)
       AND (_term IS NULL
            OR lower(c.name) LIKE '%'||_term||'%'
            OR lower(coalesce(c.email,'')) LIKE '%'||_term||'%'
            OR (_norm IS NOT NULL AND (
                 c.primary_phone_normalized LIKE '%'||_norm||'%'
                 OR coalesce(c.secondary_phone_normalized,'') LIKE '%'||_norm||'%')))
     GROUP BY c.id
  ), scored AS (
    SELECT *,
      CASE WHEN final_orders > 0 THEN round(delivered_orders::numeric*100/final_orders,1) END AS delivery_success_rate,
      CASE WHEN (delivered_orders+returned_orders) > 0
           THEN round(returned_orders::numeric*100/(delivered_orders+returned_orders),1) END AS return_rate,
      total_orders >= public.repeat_customer_threshold() AS is_repeat_customer
      FROM agg
  ), filtered AS (
    SELECT * FROM scored
     WHERE (_customer_type IS NULL
            OR (_customer_type = 'repeat' AND is_repeat_customer)
            OR (_customer_type = 'new' AND NOT is_repeat_customer))
       AND (NOT _attention OR status = 'blocked' OR has_manual_flag
            OR verification_failures >= 2 OR failed_deliveries >= 2
            OR (return_rate IS NOT NULL AND return_rate >= 30
                AND (delivered_orders + returned_orders) >= 2))
  )
  SELECT count(*), coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.last_order_at DESC NULLS LAST, t.created_at DESC), '[]'::jsonb)
    INTO _total, _rows
    FROM (SELECT * FROM filtered ORDER BY last_order_at DESC NULLS LAST, created_at DESC
           LIMIT _lim OFFSET greatest(coalesce(_offset,0),0)) t;

  SELECT count(*) INTO _total FROM (
    SELECT 1 FROM public.customers c
     WHERE (_status IS NULL OR c.status = _status)
       AND (_term IS NULL
            OR lower(c.name) LIKE '%'||_term||'%'
            OR lower(coalesce(c.email,'')) LIKE '%'||_term||'%'
            OR (_norm IS NOT NULL AND (
                 c.primary_phone_normalized LIKE '%'||_norm||'%'
                 OR coalesce(c.secondary_phone_normalized,'') LIKE '%'||_norm||'%')))
  ) q;

  RETURN jsonb_build_object('rows', _rows, 'approx_total', _total,
                            'limit', _lim, 'offset', greatest(coalesce(_offset,0),0));
END; $$;

CREATE OR REPLACE FUNCTION public.customer_timeline(
  _customer_id uuid, _limit int DEFAULT 50, _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb; _lim int;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read customer data';
  END IF;
  _lim := least(greatest(coalesce(_limit,50),1), 200);

  WITH events AS (
    SELECT c.created_at AS at, 'customer'::text AS source, 'Customer created'::text AS title,
           c.name AS detail, NULL::uuid AS order_id, NULL::text AS reference
      FROM public.customers c WHERE c.id = _customer_id
    UNION ALL
    SELECT o.created_at, 'order', 'Order created', o.status::text, o.id, o.order_number
      FROM public.orders o WHERE o.customer_id = _customer_id
    UNION ALL
    SELECT e.created_at, 'verification', 'Verification: ' || e.event_type::text, NULL, o.id, o.order_number
      FROM public.order_verification_events e
      JOIN public.orders o ON o.id = e.order_id
     WHERE o.customer_id = _customer_id
    UNION ALL
    SELECT e.created_at, 'fulfillment', 'Fulfillment: ' || e.event_type::text, NULL, o.id, o.order_number
      FROM public.order_fulfillment_events e
      JOIN public.order_fulfillments f ON f.id = e.fulfillment_id
      JOIN public.orders o ON o.id = f.order_id
     WHERE o.customer_id = _customer_id
    UNION ALL
    SELECT e.created_at, 'shipment', 'Shipment: ' || e.event_type::text, s.shipment_number, o.id, s.shipment_number
      FROM public.shipment_events e
      JOIN public.shipments s ON s.id = e.shipment_id
      JOIN public.orders o ON o.id = s.order_id
     WHERE o.customer_id = _customer_id
    UNION ALL
    SELECT e.created_at, 'return', 'Return: ' || e.event_type::text, r.return_number, o.id, r.return_number
      FROM public.order_return_events e
      JOIN public.order_returns r ON r.id = e.return_id
      JOIN public.orders o ON o.id = r.order_id
     WHERE o.customer_id = _customer_id
    UNION ALL
    SELECT n.created_at, 'note', 'Internal note', n.note, NULL, NULL
      FROM public.customer_notes n WHERE n.customer_id = _customer_id
  )
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.at DESC), '[]'::jsonb) INTO _rows
    FROM (SELECT * FROM events ORDER BY at DESC LIMIT _lim OFFSET greatest(coalesce(_offset,0),0)) t;

  RETURN jsonb_build_object('events', _rows, 'limit', _lim, 'offset', greatest(coalesce(_offset,0),0));
END; $$;

CREATE OR REPLACE FUNCTION public.customer_financial_summary(_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _o record; _f jsonb;
  _gross numeric := 0; _delivered numeric := 0;
  _est numeric := 0; _part numeric := 0; _act numeric := 0;
  _n_est int := 0; _n_part int := 0; _n_act int := 0;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read financial data';
  END IF;
  FOR _o IN SELECT id, grand_total, delivery_status FROM public.orders
             WHERE customer_id = _customer_id AND status <> 'cancelled' LOOP
    _f := public.order_financials(_o.id);
    _gross := _gross + coalesce(_o.grand_total, 0);
    IF _o.delivery_status IN ('delivered','partially_delivered') THEN
      _delivered := _delivered + coalesce(_o.grand_total, 0);
    END IF;
    CASE _f->>'completeness'
      WHEN 'actual' THEN
        _act := _act + coalesce((_f#>>'{actual,profit}')::numeric, 0); _n_act := _n_act + 1;
      WHEN 'partially_actual' THEN
        _part := _part + coalesce((_f#>>'{actual,profit}')::numeric, 0); _n_part := _n_part + 1;
      ELSE
        _est := _est + coalesce((_f#>>'{estimated,profit}')::numeric, 0); _n_est := _n_est + 1;
    END CASE;
  END LOOP;

  RETURN jsonb_build_object(
    'gross_order_value', _gross,
    'delivered_revenue', _delivered,
    'estimated_profit', _est,
    'partially_actual_profit', _part,
    'actual_profit', _act,
    'estimated_orders', _n_est,
    'partially_actual_orders', _n_part,
    'actual_orders', _n_act);
END; $$;

REVOKE EXECUTE ON FUNCTION public.customer_metrics(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.customer_list(text, public.customer_status, text, boolean, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.customer_timeline(uuid, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.customer_financial_summary(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_customer(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_customer_status(uuid, public.customer_status, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_customer_note(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_customer_manual_flag(uuid, public.customer_manual_flag_type, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.repeat_customer_threshold() FROM anon;
REVOKE EXECUTE ON FUNCTION public.normalize_bd_phone(text) FROM anon;

-- ============ Backfill existing orders into customers ============
DO $backfill$
DECLARE _r record; _id uuid;
BEGIN
  PERFORM set_config('app.customer_write', 'on', true);
  FOR _r IN
    SELECT public.normalize_bd_phone(customer_phone) AS norm,
           min(customer_name) AS name,
           min(customer_email) FILTER (WHERE customer_email IS NOT NULL) AS email,
           min(created_at) AS first_at
      FROM public.orders
     WHERE customer_id IS NULL
       AND public.normalize_bd_phone(customer_phone) IS NOT NULL
       AND public.normalize_bd_phone(customer_phone) <> ''
     GROUP BY 1
  LOOP
    SELECT id INTO _id FROM public.customers WHERE primary_phone_normalized = _r.norm;
    IF _id IS NULL THEN
      INSERT INTO public.customers (name, primary_phone, email, created_at, updated_at)
      VALUES (_r.name, _r.norm, _r.email, _r.first_at, _r.first_at)
      RETURNING id INTO _id;
    END IF;
    UPDATE public.orders SET customer_id = _id
     WHERE customer_id IS NULL
       AND public.normalize_bd_phone(customer_phone) = _r.norm;
  END LOOP;
  PERFORM set_config('app.customer_write', 'off', true);
END $backfill$;
