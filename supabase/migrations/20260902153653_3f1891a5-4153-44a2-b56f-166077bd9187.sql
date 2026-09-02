-- ============================================================
-- STEP 7 — PROCUREMENT, SUPPLIERS & PURCHASE ORDERS
-- ============================================================

/* ---------------- enums ---------------- */

CREATE TYPE public.purchase_order_status AS ENUM (
  'draft','pending_approval','approved','ordered','partially_received','received','cancelled','closed'
);
CREATE TYPE public.goods_receipt_status AS ENUM ('draft','received','cancelled');
CREATE TYPE public.purchase_order_event_type AS ENUM (
  'created','updated','submitted_for_approval','approval_returned','approved','ordered',
  'receipt_created','receipt_cancelled','partially_received','received','receipt_reversed',
  'cancelled','closed','note_added'
);
CREATE TYPE public.cost_change_source AS ENUM ('manual','purchase_receipt','correction');
CREATE TYPE public.item_cost_type AS ENUM ('base_cost','additional_cost');

/* ---------------- inventory movement support for procurement ---------------- */

CREATE OR REPLACE FUNCTION public.apply_inventory_movement(
  _inventory_level_id uuid, _movement_type public.inventory_movement_type, _quantity integer,
  _note text DEFAULT NULL::text, _reference_type text DEFAULT NULL::text, _reference_id uuid DEFAULT NULL::uuid)
RETURNS public.inventory_levels
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE lvl public.inventory_levels; new_on_hand int; new_reserved int; new_damaged int;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to adjust inventory';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT * INTO lvl FROM public.inventory_levels WHERE id = _inventory_level_id FOR UPDATE;
  IF lvl.id IS NULL THEN RAISE EXCEPTION 'Inventory record not found'; END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_locations
              WHERE id = lvl.location_id AND status = 'archived') THEN
    RAISE EXCEPTION 'Archived locations cannot receive inventory movements';
  END IF;

  new_on_hand := lvl.on_hand;
  new_reserved := lvl.reserved;
  new_damaged := lvl.damaged;

  CASE _movement_type
    WHEN 'initial', 'adjustment_in', 'return_in', 'purchase_in' THEN
      new_on_hand := new_on_hand + _quantity;
    WHEN 'adjustment_out' THEN
      new_on_hand := new_on_hand - _quantity;
    WHEN 'damage' THEN
      new_on_hand := new_on_hand - _quantity;
      new_damaged := new_damaged + _quantity;
    WHEN 'purchase_damaged_in' THEN
      new_damaged := new_damaged + _quantity;
    WHEN 'damaged_out' THEN
      new_damaged := new_damaged - _quantity;
    WHEN 'reservation' THEN
      new_reserved := new_reserved + _quantity;
    WHEN 'release_reservation' THEN
      new_reserved := new_reserved - _quantity;
    WHEN 'fulfillment_out' THEN
      new_reserved := new_reserved - _quantity;
      new_on_hand := new_on_hand - _quantity;
  END CASE;

  IF new_on_hand < 0 THEN
    RAISE EXCEPTION 'Not enough stock: on hand is %, cannot remove %', lvl.on_hand, _quantity;
  END IF;
  IF new_damaged < 0 THEN
    RAISE EXCEPTION 'Cannot remove more than the damaged quantity (%).', lvl.damaged;
  END IF;
  IF new_reserved < 0 THEN
    RAISE EXCEPTION 'Cannot release more than the reserved quantity (%).', lvl.reserved;
  END IF;
  IF new_reserved > new_on_hand THEN
    RAISE EXCEPTION 'Reserved (%) cannot exceed on hand (%)', new_reserved, new_on_hand;
  END IF;

  PERFORM set_config('app.inventory_write', 'on', true);
  UPDATE public.inventory_levels
     SET on_hand = new_on_hand, reserved = new_reserved, damaged = new_damaged,
         updated_by = auth.uid()
   WHERE id = _inventory_level_id
   RETURNING * INTO lvl;
  PERFORM set_config('app.inventory_write', 'off', true);

  INSERT INTO public.inventory_movements
    (inventory_level_id, movement_type, quantity, reference_type, reference_id, note, created_by)
  VALUES (_inventory_level_id, _movement_type, _quantity, _reference_type, _reference_id,
          nullif(btrim(coalesce(_note,'')), ''), auth.uid());

  RETURN lvl;
END; $function$;

/* Shared eligibility rule — mirrors validate_inventory_level(). */
CREATE OR REPLACE FUNCTION public.is_inventory_eligible_item(_product_id uuid, _variant_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE _type public.product_type;
BEGIN
  IF (_product_id IS NULL) = (_variant_id IS NULL) THEN RETURN false; END IF;
  IF _product_id IS NOT NULL THEN
    SELECT product_type INTO _type FROM public.products WHERE id = _product_id;
    RETURN _type = 'simple';
  END IF;
  SELECT p.product_type INTO _type
    FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
   WHERE v.id = _variant_id;
  RETURN _type = 'variable';
END; $$;

CREATE OR REPLACE FUNCTION public.guard_procurement_item_eligibility()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_inventory_eligible_item(NEW.product_id, NEW.variant_id) THEN
    RAISE EXCEPTION 'Only stock tracked items can be procured: a simple product, or a variant of a variable product.';
  END IF;
  RETURN NEW;
END; $$;

/* ---------------- suppliers ---------------- */

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  supplier_code text NOT NULL CHECK (btrim(supplier_code) <> ''),
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  country text NOT NULL DEFAULT 'Bangladesh',
  default_currency text NOT NULL DEFAULT 'BDT' CHECK (char_length(default_currency) = 3),
  status public.entity_status NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_code_key ON public.suppliers (lower(supplier_code));
CREATE INDEX suppliers_status_idx ON public.suppliers (status);
CREATE INDEX suppliers_name_idx ON public.suppliers (lower(name));

GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_read" ON public.suppliers FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "suppliers_insert" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY "suppliers_update" ON public.suppliers FOR UPDATE TO authenticated
  USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));
-- deliberately no DELETE policy: suppliers are archived, never removed.

CREATE TRIGGER suppliers_updated_at BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/* ---------------- supplier contacts ---------------- */

CREATE TABLE public.supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  phone text,
  email text,
  role text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supplier_contacts_one_primary
  ON public.supplier_contacts (supplier_id) WHERE is_primary;
CREATE INDEX supplier_contacts_supplier_idx ON public.supplier_contacts (supplier_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_contacts TO authenticated;
GRANT ALL ON public.supplier_contacts TO service_role;
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_contacts_read" ON public.supplier_contacts FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "supplier_contacts_write" ON public.supplier_contacts FOR ALL TO authenticated
  USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));

CREATE TRIGGER supplier_contacts_updated_at BEFORE UPDATE ON public.supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/* ---------------- supplier products ---------------- */

CREATE TABLE public.supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  supplier_sku text,
  supplier_product_name text,
  last_purchase_cost numeric(12,2) CHECK (last_purchase_cost IS NULL OR last_purchase_cost >= 0),
  currency text NOT NULL DEFAULT 'BDT' CHECK (char_length(currency) = 3),
  minimum_order_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  is_preferred boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_products_target_xor CHECK (
    (product_id IS NOT NULL AND variant_id IS NULL) OR (product_id IS NULL AND variant_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX supplier_products_unique_product
  ON public.supplier_products (supplier_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX supplier_products_unique_variant
  ON public.supplier_products (supplier_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX supplier_products_one_preferred_product
  ON public.supplier_products (product_id) WHERE is_preferred AND product_id IS NOT NULL;
CREATE UNIQUE INDEX supplier_products_one_preferred_variant
  ON public.supplier_products (variant_id) WHERE is_preferred AND variant_id IS NOT NULL;
CREATE INDEX supplier_products_supplier_idx ON public.supplier_products (supplier_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_products TO authenticated;
GRANT ALL ON public.supplier_products TO service_role;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_products_read" ON public.supplier_products FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "supplier_products_write" ON public.supplier_products FOR ALL TO authenticated
  USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));

CREATE TRIGGER supplier_products_eligibility BEFORE INSERT OR UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_item_eligibility();
CREATE TRIGGER supplier_products_updated_at BEFORE UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/* ---------------- purchase orders ---------------- */

CREATE SEQUENCE IF NOT EXISTS public.purchase_order_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.goods_receipt_number_seq;

CREATE OR REPLACE FUNCTION public.next_purchase_order_number()
RETURNS text LANGUAGE sql SET search_path TO 'public'
AS $$
  SELECT 'PO-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.purchase_order_number_seq')::text, 6, '0');
$$;

CREATE OR REPLACE FUNCTION public.next_goods_receipt_number()
RETURNS text LANGUAGE sql SET search_path TO 'public'
AS $$
  SELECT 'GRN-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.goods_receipt_number_seq')::text, 6, '0');
$$;

CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_number text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  status public.purchase_order_status NOT NULL DEFAULT 'draft',
  order_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Dhaka')::date,
  expected_delivery_date date,
  currency text NOT NULL DEFAULT 'BDT' CHECK (char_length(currency) = 3),
  exchange_rate numeric(14,6) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  shipping_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  duty_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (duty_cost >= 0),
  other_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  cancelled_at timestamptz,
  cancel_reason text,
  closed_at timestamptz,
  ordered_at timestamptz,
  submitted_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_orders_supplier_idx ON public.purchase_orders (supplier_id);
CREATE INDEX purchase_orders_status_idx ON public.purchase_orders (status);
CREATE INDEX purchase_orders_expected_idx ON public.purchase_orders (expected_delivery_date);
CREATE INDEX purchase_orders_created_idx ON public.purchase_orders (created_at DESC);

CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  variant_id uuid REFERENCES public.product_variants(id),
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text,
  sku_snapshot text,
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total numeric(14,2) GENERATED ALWAYS AS
    (quantity_ordered * unit_cost - discount_amount + tax_amount) STORED,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_items_target_xor CHECK (
    (product_id IS NOT NULL AND variant_id IS NULL) OR (product_id IS NULL AND variant_id IS NOT NULL)
  ),
  CONSTRAINT purchase_order_items_not_over_received CHECK (quantity_received <= quantity_ordered)
);
CREATE INDEX purchase_order_items_po_idx ON public.purchase_order_items (purchase_order_id);
CREATE TRIGGER purchase_order_items_eligibility BEFORE INSERT ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_item_eligibility();

CREATE TABLE public.purchase_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  event_type public.purchase_order_event_type NOT NULL,
  from_status public.purchase_order_status,
  to_status public.purchase_order_status,
  message text NOT NULL,
  metadata jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_order_events_po_idx ON public.purchase_order_events (purchase_order_id, created_at DESC);

/* ---------------- goods receipts ---------------- */

CREATE TABLE public.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  inventory_location_id uuid NOT NULL REFERENCES public.inventory_locations(id),
  status public.goods_receipt_status NOT NULL DEFAULT 'draft',
  notes text,
  reversed_at timestamptz,
  reversal_reason text,
  received_at timestamptz,
  received_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goods_receipts_po_idx ON public.goods_receipts (purchase_order_id, created_at DESC);
CREATE INDEX goods_receipts_status_idx ON public.goods_receipts (status);

CREATE TABLE public.goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id uuid NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  quantity_received integer NOT NULL CHECK (quantity_received >= 0),
  quantity_accepted integer NOT NULL DEFAULT 0 CHECK (quantity_accepted >= 0),
  quantity_damaged integer NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  unit_cost_snapshot numeric(12,2) NOT NULL CHECK (unit_cost_snapshot >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goods_receipt_items_split CHECK (quantity_accepted + quantity_damaged = quantity_received),
  CONSTRAINT goods_receipt_items_unique UNIQUE (goods_receipt_id, purchase_order_item_id)
);
CREATE INDEX goods_receipt_items_receipt_idx ON public.goods_receipt_items (goods_receipt_id);
CREATE INDEX goods_receipt_items_po_item_idx ON public.goods_receipt_items (purchase_order_item_id);

/* ---------------- cost history ---------------- */

CREATE TABLE public.product_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  cost_type public.item_cost_type NOT NULL DEFAULT 'base_cost',
  previous_cost numeric(12,2),
  new_cost numeric(12,2) NOT NULL CHECK (new_cost >= 0),
  source_type public.cost_change_source NOT NULL,
  source_id uuid,
  note text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_cost_history_target_xor CHECK (
    (product_id IS NOT NULL AND variant_id IS NULL) OR (product_id IS NULL AND variant_id IS NOT NULL)
  )
);
CREATE INDEX product_cost_history_product_idx ON public.product_cost_history (product_id, effective_at DESC);
CREATE INDEX product_cost_history_variant_idx ON public.product_cost_history (variant_id, effective_at DESC);

/* ---------------- write guard: controlled operations only ---------------- */

CREATE OR REPLACE FUNCTION public.guard_procurement_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('app.procurement_write', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION '% records are managed by procurement operations and cannot be changed directly.', TG_TABLE_NAME;
END; $$;

CREATE TRIGGER purchase_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_write();
CREATE TRIGGER purchase_order_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_write();
CREATE TRIGGER purchase_order_events_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_write();
CREATE TRIGGER goods_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_write();
CREATE TRIGGER goods_receipt_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.goods_receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_write();
CREATE TRIGGER product_cost_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.product_cost_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_write();

CREATE TRIGGER purchase_orders_updated_at BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER purchase_order_items_updated_at BEFORE UPDATE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER goods_receipts_updated_at BEFORE UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER goods_receipt_items_updated_at BEFORE UPDATE ON public.goods_receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/* ---------------- RLS: read-only from the app ---------------- */

GRANT SELECT ON public.purchase_orders, public.purchase_order_items, public.purchase_order_events,
                public.goods_receipts, public.goods_receipt_items, public.product_cost_history
  TO authenticated;
GRANT ALL ON public.purchase_orders, public.purchase_order_items, public.purchase_order_events,
             public.goods_receipts, public.goods_receipt_items, public.product_cost_history
  TO service_role;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_orders_read" ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "purchase_order_items_read" ON public.purchase_order_items FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "purchase_order_events_read" ON public.purchase_order_events FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "goods_receipts_read" ON public.goods_receipts FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "goods_receipt_items_read" ON public.goods_receipt_items FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "product_cost_history_read" ON public.product_cost_history FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

/* ---------------- helpers ---------------- */

CREATE OR REPLACE FUNCTION public.log_purchase_order_event(
  _po_id uuid, _event public.purchase_order_event_type, _message text,
  _from public.purchase_order_status DEFAULT NULL, _to public.purchase_order_status DEFAULT NULL,
  _metadata jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.procurement_write', 'on', true);
  INSERT INTO public.purchase_order_events
    (purchase_order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_po_id, _event, _from, _to, _message, _metadata, auth.uid());
  PERFORM set_config('app.procurement_write', 'off', true);
END; $$;

CREATE OR REPLACE FUNCTION public.recalculate_purchase_order_totals(_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _subtotal numeric(14,2);
BEGIN
  SELECT coalesce(sum(line_total), 0) INTO _subtotal
    FROM public.purchase_order_items WHERE purchase_order_id = _po_id;

  PERFORM set_config('app.procurement_write', 'on', true);
  UPDATE public.purchase_orders
     SET subtotal = _subtotal,
         grand_total = _subtotal - discount_total + shipping_cost + duty_cost + other_cost,
         updated_by = auth.uid()
   WHERE id = _po_id;
  PERFORM set_config('app.procurement_write', 'off', true);
END; $$;

/* ---------------- purchase order operations ---------------- */

CREATE OR REPLACE FUNCTION public.save_purchase_order(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _po_id uuid := nullif(_payload->>'id','')::uuid;
  _status public.purchase_order_status;
  _item jsonb; _idx int := 0;
  _pid uuid; _vid uuid; _pname text; _vname text; _sku text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage purchase orders';
  END IF;
  IF jsonb_array_length(coalesce(_payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A purchase order needs at least one item';
  END IF;

  PERFORM set_config('app.procurement_write', 'on', true);

  IF _po_id IS NULL THEN
    INSERT INTO public.purchase_orders (
      purchase_order_number, supplier_id, order_date, expected_delivery_date, currency,
      exchange_rate, discount_total, shipping_cost, duty_cost, other_cost, notes, created_by, updated_by)
    VALUES (
      public.next_purchase_order_number(),
      (_payload->>'supplier_id')::uuid,
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
       SET supplier_id = (_payload->>'supplier_id')::uuid,
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
END; $$;

CREATE OR REPLACE FUNCTION public.set_purchase_order_status(
  _po_id uuid, _status public.purchase_order_status, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _po public.purchase_orders; _received int; _event public.purchase_order_event_type;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage purchase orders';
  END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF _po.id IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _po.status = _status THEN RETURN; END IF;

  SELECT coalesce(sum(quantity_received), 0) INTO _received
    FROM public.purchase_order_items WHERE purchase_order_id = _po_id;

  -- receiving-driven statuses are never set by hand
  IF _status IN ('partially_received','received') THEN
    RAISE EXCEPTION 'Receiving progress is derived from goods receipts and cannot be set manually';
  END IF;

  IF _status = 'pending_approval' AND _po.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft can be submitted for approval';
  END IF;
  IF _status = 'draft' AND _po.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Only a purchase order awaiting approval can be returned to draft';
  END IF;
  IF _status = 'approved' THEN
    IF _po.status <> 'pending_approval' THEN
      RAISE EXCEPTION 'Only a purchase order awaiting approval can be approved';
    END IF;
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only an admin or owner can approve a purchase order';
    END IF;
  END IF;
  IF _status = 'ordered' AND _po.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved purchase order can be marked as ordered';
  END IF;
  IF _status = 'cancelled' THEN
    IF _po.status IN ('cancelled','closed') THEN
      RAISE EXCEPTION 'This purchase order is already finished';
    END IF;
    IF _received > 0 THEN
      RAISE EXCEPTION 'This purchase order already has received goods and cannot be cancelled. Reverse the receipts first.';
    END IF;
  END IF;
  IF _status = 'closed' AND _po.status NOT IN ('ordered','partially_received','received') THEN
    RAISE EXCEPTION 'Only an ordered or received purchase order can be closed';
  END IF;

  _event := CASE _status
    WHEN 'pending_approval' THEN 'submitted_for_approval'::public.purchase_order_event_type
    WHEN 'draft' THEN 'approval_returned'::public.purchase_order_event_type
    WHEN 'approved' THEN 'approved'::public.purchase_order_event_type
    WHEN 'ordered' THEN 'ordered'::public.purchase_order_event_type
    WHEN 'cancelled' THEN 'cancelled'::public.purchase_order_event_type
    ELSE 'closed'::public.purchase_order_event_type END;

  PERFORM set_config('app.procurement_write', 'on', true);
  UPDATE public.purchase_orders
     SET status = _status,
         submitted_at = CASE WHEN _status = 'pending_approval' THEN now() ELSE submitted_at END,
         approved_by = CASE WHEN _status = 'approved' THEN auth.uid()
                            WHEN _status = 'draft' THEN NULL ELSE approved_by END,
         approved_at = CASE WHEN _status = 'approved' THEN now()
                            WHEN _status = 'draft' THEN NULL ELSE approved_at END,
         ordered_at = CASE WHEN _status = 'ordered' THEN now() ELSE ordered_at END,
         cancelled_at = CASE WHEN _status = 'cancelled' THEN now() ELSE cancelled_at END,
         cancel_reason = CASE WHEN _status = 'cancelled'
                              THEN nullif(btrim(coalesce(_note,'')), '') ELSE cancel_reason END,
         closed_at = CASE WHEN _status = 'closed' THEN now() ELSE closed_at END,
         updated_by = auth.uid()
   WHERE id = _po_id;
  PERFORM set_config('app.procurement_write', 'off', true);

  PERFORM public.log_purchase_order_event(
    _po_id, _event, coalesce(nullif(btrim(coalesce(_note,'')), ''), 'Status changed'),
    _po.status, _status);
END; $$;

/* ---------------- goods receipt operations ---------------- */

CREATE OR REPLACE FUNCTION public.create_goods_receipt(
  _po_id uuid, _location_id uuid, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _status public.purchase_order_status; _receipt_id uuid; _loc public.entity_status; _number text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to receive goods';
  END IF;

  SELECT status INTO _status FROM public.purchase_orders WHERE id = _po_id;
  IF _status IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _status NOT IN ('approved','ordered','partially_received') THEN
    RAISE EXCEPTION 'Goods can only be received against an approved, ordered or partially received purchase order (status is %)', _status;
  END IF;

  SELECT status INTO _loc FROM public.inventory_locations WHERE id = _location_id;
  IF _loc IS NULL THEN RAISE EXCEPTION 'Inventory location not found'; END IF;
  IF _loc <> 'active' THEN RAISE EXCEPTION 'Goods can only be received into an active location'; END IF;

  IF EXISTS (SELECT 1 FROM public.goods_receipts WHERE purchase_order_id = _po_id AND status = 'draft') THEN
    RAISE EXCEPTION 'This purchase order already has an open draft receipt. Finish or cancel it first.';
  END IF;

  _number := public.next_goods_receipt_number();

  PERFORM set_config('app.procurement_write', 'on', true);
  INSERT INTO public.goods_receipts (receipt_number, purchase_order_id, inventory_location_id, notes, created_by)
  VALUES (_number, _po_id, _location_id, nullif(btrim(coalesce(_notes,'')), ''), auth.uid())
  RETURNING id INTO _receipt_id;
  PERFORM set_config('app.procurement_write', 'off', true);

  PERFORM public.log_purchase_order_event(
    _po_id, 'receipt_created', 'Goods receipt ' || _number || ' created', NULL, NULL,
    jsonb_build_object('receipt_id', _receipt_id, 'receipt_number', _number));

  RETURN _receipt_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_goods_receipt_lines(_receipt_id uuid, _lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _receipt public.goods_receipts; _line jsonb;
  _po_item public.purchase_order_items; _remaining int;
  _rec int; _acc int; _dam int;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to receive goods';
  END IF;

  SELECT * INTO _receipt FROM public.goods_receipts WHERE id = _receipt_id FOR UPDATE;
  IF _receipt.id IS NULL THEN RAISE EXCEPTION 'Goods receipt not found'; END IF;
  IF _receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft receipt can be edited. Use a reversal to correct received goods.';
  END IF;

  PERFORM set_config('app.procurement_write', 'on', true);
  DELETE FROM public.goods_receipt_items WHERE goods_receipt_id = _receipt_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) LOOP
    SELECT * INTO _po_item FROM public.purchase_order_items
     WHERE id = (_line->>'purchase_order_item_id')::uuid
       AND purchase_order_id = _receipt.purchase_order_id
     FOR UPDATE;
    IF _po_item.id IS NULL THEN
      RAISE EXCEPTION 'Receipt line does not belong to this purchase order';
    END IF;

    _rec := coalesce((_line->>'quantity_received')::int, 0);
    _acc := coalesce((_line->>'quantity_accepted')::int, 0);
    _dam := coalesce((_line->>'quantity_damaged')::int, 0);
    CONTINUE WHEN _rec = 0 AND _acc = 0 AND _dam = 0;

    IF _acc + _dam <> _rec THEN
      RAISE EXCEPTION 'Accepted (%) plus damaged (%) must equal received (%) for %',
        _acc, _dam, _rec, _po_item.product_name_snapshot;
    END IF;
    _remaining := _po_item.quantity_ordered - _po_item.quantity_received;
    IF _rec > _remaining THEN
      RAISE EXCEPTION 'Cannot receive % of % — only % remaining on the purchase order',
        _rec, _po_item.product_name_snapshot, _remaining;
    END IF;

    INSERT INTO public.goods_receipt_items (
      goods_receipt_id, purchase_order_item_id, quantity_received, quantity_accepted,
      quantity_damaged, unit_cost_snapshot, notes)
    VALUES (_receipt_id, _po_item.id, _rec, _acc, _dam, _po_item.unit_cost,
            nullif(btrim(coalesce(_line->>'notes','')), ''));
  END LOOP;
  PERFORM set_config('app.procurement_write', 'off', true);
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_goods_receipt(_receipt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _receipt public.goods_receipts; _po public.purchase_orders;
  _line public.goods_receipt_items; _po_item public.purchase_order_items;
  _level_id uuid; _remaining int; _lines int := 0;
  _total_ordered int; _total_received int; _new_status public.purchase_order_status;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to receive goods';
  END IF;

  SELECT * INTO _receipt FROM public.goods_receipts WHERE id = _receipt_id FOR UPDATE;
  IF _receipt.id IS NULL THEN RAISE EXCEPTION 'Goods receipt not found'; END IF;
  IF _receipt.status <> 'draft' THEN RAISE EXCEPTION 'This receipt is already finished'; END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = _receipt.purchase_order_id FOR UPDATE;
  IF _po.status NOT IN ('approved','ordered','partially_received') THEN
    RAISE EXCEPTION 'This purchase order can no longer receive goods (status is %)', _po.status;
  END IF;

  FOR _line IN
    SELECT * FROM public.goods_receipt_items WHERE goods_receipt_id = _receipt_id ORDER BY created_at
  LOOP
    _lines := _lines + 1;
    SELECT * INTO _po_item FROM public.purchase_order_items
     WHERE id = _line.purchase_order_item_id FOR UPDATE;

    _remaining := _po_item.quantity_ordered - _po_item.quantity_received;
    IF _line.quantity_received > _remaining THEN
      RAISE EXCEPTION 'Cannot receive % of % — only % remaining on the purchase order',
        _line.quantity_received, _po_item.product_name_snapshot, _remaining;
    END IF;

    -- find or create the stock record at the receiving location
    SELECT id INTO _level_id FROM public.inventory_levels
     WHERE location_id = _receipt.inventory_location_id
       AND product_id IS NOT DISTINCT FROM _po_item.product_id
       AND variant_id IS NOT DISTINCT FROM _po_item.variant_id;

    IF _level_id IS NULL THEN
      INSERT INTO public.inventory_levels (location_id, product_id, variant_id, created_by, updated_by)
      VALUES (_receipt.inventory_location_id, _po_item.product_id, _po_item.variant_id,
              auth.uid(), auth.uid())
      RETURNING id INTO _level_id;
    END IF;

    IF _line.quantity_accepted > 0 THEN
      PERFORM public.apply_inventory_movement(
        _level_id, 'purchase_in', _line.quantity_accepted,
        'Goods receipt ' || _receipt.receipt_number, 'goods_receipt', _receipt_id);
    END IF;
    IF _line.quantity_damaged > 0 THEN
      PERFORM public.apply_inventory_movement(
        _level_id, 'purchase_damaged_in', _line.quantity_damaged,
        'Damaged on arrival — goods receipt ' || _receipt.receipt_number, 'goods_receipt', _receipt_id);
    END IF;

    PERFORM set_config('app.procurement_write', 'on', true);
    UPDATE public.purchase_order_items
       SET quantity_received = quantity_received + _line.quantity_received
     WHERE id = _po_item.id;
    PERFORM set_config('app.procurement_write', 'off', true);
  END LOOP;

  IF _lines = 0 THEN RAISE EXCEPTION 'This receipt has no quantities to receive'; END IF;

  SELECT coalesce(sum(quantity_ordered),0), coalesce(sum(quantity_received),0)
    INTO _total_ordered, _total_received
    FROM public.purchase_order_items WHERE purchase_order_id = _po.id;

  _new_status := CASE WHEN _total_received >= _total_ordered THEN 'received'::public.purchase_order_status
                      ELSE 'partially_received'::public.purchase_order_status END;

  PERFORM set_config('app.procurement_write', 'on', true);
  UPDATE public.goods_receipts
     SET status = 'received', received_at = now(), received_by = auth.uid()
   WHERE id = _receipt_id;
  UPDATE public.purchase_orders
     SET status = _new_status, updated_by = auth.uid()
   WHERE id = _po.id;
  PERFORM set_config('app.procurement_write', 'off', true);

  PERFORM public.log_purchase_order_event(
    _po.id,
    CASE WHEN _new_status = 'received' THEN 'received'::public.purchase_order_event_type
         ELSE 'partially_received'::public.purchase_order_event_type END,
    'Goods receipt ' || _receipt.receipt_number || ' finalised into inventory',
    _po.status, _new_status,
    jsonb_build_object('receipt_id', _receipt_id, 'receipt_number', _receipt.receipt_number,
                       'total_ordered', _total_ordered, 'total_received', _total_received));
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_goods_receipt(_receipt_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _receipt public.goods_receipts;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to receive goods';
  END IF;
  SELECT * INTO _receipt FROM public.goods_receipts WHERE id = _receipt_id FOR UPDATE;
  IF _receipt.id IS NULL THEN RAISE EXCEPTION 'Goods receipt not found'; END IF;
  IF _receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'A finalised receipt cannot be cancelled. Use a reversal instead.';
  END IF;

  PERFORM set_config('app.procurement_write', 'on', true);
  UPDATE public.goods_receipts SET status = 'cancelled' WHERE id = _receipt_id;
  PERFORM set_config('app.procurement_write', 'off', true);

  PERFORM public.log_purchase_order_event(
    _receipt.purchase_order_id, 'receipt_cancelled',
    'Draft receipt ' || _receipt.receipt_number || ' cancelled', NULL, NULL,
    jsonb_build_object('receipt_id', _receipt_id, 'reason', nullif(btrim(coalesce(_reason,'')), '')));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_goods_receipt(_receipt_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
END; $$;

/* ---------------- explicit catalog cost update ---------------- */

CREATE OR REPLACE FUNCTION public.apply_catalog_cost_update(
  _product_id uuid, _variant_id uuid, _new_cost numeric,
  _source public.cost_change_source, _source_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _previous numeric(12,2);
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or owner can change the catalog cost of an item';
  END IF;
  IF (_product_id IS NULL) = (_variant_id IS NULL) THEN
    RAISE EXCEPTION 'Provide exactly one of product or variant';
  END IF;
  IF _new_cost IS NULL OR _new_cost < 0 THEN RAISE EXCEPTION 'Cost cannot be negative'; END IF;

  IF _product_id IS NOT NULL THEN
    SELECT base_cost INTO _previous FROM public.products WHERE id = _product_id FOR UPDATE;
    IF _previous IS NULL AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = _product_id) THEN
      RAISE EXCEPTION 'Product not found';
    END IF;
    IF _previous IS NOT DISTINCT FROM _new_cost THEN RETURN; END IF;
    UPDATE public.products SET base_cost = _new_cost, updated_by = auth.uid() WHERE id = _product_id;
  ELSE
    SELECT base_cost INTO _previous FROM public.product_variants WHERE id = _variant_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant_id) THEN
      RAISE EXCEPTION 'Variant not found';
    END IF;
    IF _previous IS NOT DISTINCT FROM _new_cost THEN RETURN; END IF;
    UPDATE public.product_variants SET base_cost = _new_cost WHERE id = _variant_id;
  END IF;

  PERFORM set_config('app.procurement_write', 'on', true);
  INSERT INTO public.product_cost_history
    (product_id, variant_id, cost_type, previous_cost, new_cost, source_type, source_id, note, created_by)
  VALUES (_product_id, _variant_id, 'base_cost', _previous, _new_cost, _source, _source_id,
          nullif(btrim(coalesce(_note,'')), ''), auth.uid());
  PERFORM set_config('app.procurement_write', 'off', true);
END; $$;

/* ---------------- read projections ---------------- */

CREATE OR REPLACE FUNCTION public.supplier_summaries()
RETURNS TABLE (supplier_id uuid, product_count bigint, purchase_order_count bigint,
               primary_contact_name text, primary_contact_phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id,
         (SELECT count(*) FROM public.supplier_products sp WHERE sp.supplier_id = s.id),
         (SELECT count(*) FROM public.purchase_orders po WHERE po.supplier_id = s.id),
         c.name, c.phone
    FROM public.suppliers s
    LEFT JOIN public.supplier_contacts c ON c.supplier_id = s.id AND c.is_primary
   WHERE public.can_read_commerce(auth.uid());
$$;

/* ---------------- privileges ---------------- */

REVOKE EXECUTE ON FUNCTION public.apply_inventory_movement(uuid, public.inventory_movement_type, integer, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_inventory_eligible_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_purchase_order_event(uuid, public.purchase_order_event_type, text, public.purchase_order_status, public.purchase_order_status, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalculate_purchase_order_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_procurement_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_procurement_item_eligibility() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.save_purchase_order(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_purchase_order_status(uuid, public.purchase_order_status, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_goods_receipt(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_goods_receipt_lines(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalize_goods_receipt(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_goods_receipt(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_goods_receipt(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_catalog_cost_update(uuid, uuid, numeric, public.cost_change_source, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.supplier_summaries() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_purchase_order_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_goods_receipt_number() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_purchase_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_purchase_order_status(uuid, public.purchase_order_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_goods_receipt(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_goods_receipt_lines(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_goods_receipt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_goods_receipt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_goods_receipt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_catalog_cost_update(uuid, uuid, numeric, public.cost_change_source, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_summaries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_inventory_eligible_item(uuid, uuid) TO authenticated;