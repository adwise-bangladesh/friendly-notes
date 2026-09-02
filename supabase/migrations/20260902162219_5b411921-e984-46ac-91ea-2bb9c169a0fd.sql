-- ============ 1. Movement audit detail ============
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS reason public.inventory_adjustment_reason,
  ADD COLUMN IF NOT EXISTS on_hand_before integer,
  ADD COLUMN IF NOT EXISTS on_hand_after integer,
  ADD COLUMN IF NOT EXISTS reserved_before integer,
  ADD COLUMN IF NOT EXISTS reserved_after integer,
  ADD COLUMN IF NOT EXISTS damaged_before integer,
  ADD COLUMN IF NOT EXISTS damaged_after integer,
  ADD COLUMN IF NOT EXISTS incoming_before integer,
  ADD COLUMN IF NOT EXISTS incoming_after integer;

CREATE INDEX IF NOT EXISTS inventory_movements_created_at_idx
  ON public.inventory_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_reference_idx
  ON public.inventory_movements (reference_type, reference_id);

-- Append-only history
CREATE OR REPLACE FUNCTION public.guard_inventory_movements_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movement history is append only and cannot be % .', TG_OP;
END; $$;

DROP TRIGGER IF EXISTS inventory_movements_append_only ON public.inventory_movements;
CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_movements_append_only();

-- ============ 2. apply_inventory_movement: reason + before/after + transfer/stocktake types ============
DROP FUNCTION IF EXISTS public.apply_inventory_movement(uuid, public.inventory_movement_type, integer, text, text, uuid);

CREATE FUNCTION public.apply_inventory_movement(
  _inventory_level_id uuid,
  _movement_type public.inventory_movement_type,
  _quantity integer,
  _note text DEFAULT NULL,
  _reference_type text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _reason public.inventory_adjustment_reason DEFAULT NULL
) RETURNS public.inventory_levels
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lvl public.inventory_levels; new_on_hand int; new_reserved int; new_damaged int; new_incoming int;
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
  new_incoming := lvl.incoming;

  CASE _movement_type
    WHEN 'initial', 'adjustment_in', 'return_in', 'purchase_in', 'transfer_in', 'stocktake_in' THEN
      new_on_hand := new_on_hand + _quantity;
    WHEN 'adjustment_out', 'transfer_out', 'stocktake_out' THEN
      new_on_hand := new_on_hand - _quantity;
    WHEN 'damage' THEN
      new_on_hand := new_on_hand - _quantity;
      new_damaged := new_damaged + _quantity;
    WHEN 'purchase_damaged_in' THEN
      new_damaged := new_damaged + _quantity;
    WHEN 'damaged_out' THEN
      new_damaged := new_damaged - _quantity;
    WHEN 'transfer_incoming_in' THEN
      new_incoming := new_incoming + _quantity;
    WHEN 'transfer_incoming_out' THEN
      new_incoming := new_incoming - _quantity;
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
  IF new_incoming < 0 THEN
    RAISE EXCEPTION 'Cannot remove more than the in-transit quantity (%).', lvl.incoming;
  END IF;
  IF new_reserved > new_on_hand THEN
    RAISE EXCEPTION 'Reserved (%) cannot exceed on hand (%)', new_reserved, new_on_hand;
  END IF;

  PERFORM set_config('app.inventory_write', 'on', true);
  UPDATE public.inventory_levels
     SET on_hand = new_on_hand, reserved = new_reserved, damaged = new_damaged,
         incoming = new_incoming, updated_by = auth.uid()
   WHERE id = _inventory_level_id
   RETURNING * INTO lvl;
  PERFORM set_config('app.inventory_write', 'off', true);

  INSERT INTO public.inventory_movements
    (inventory_level_id, movement_type, quantity, reference_type, reference_id, note, reason, created_by,
     on_hand_before, on_hand_after, reserved_before, reserved_after,
     damaged_before, damaged_after, incoming_before, incoming_after)
  VALUES (_inventory_level_id, _movement_type, _quantity, _reference_type, _reference_id, _note, _reason, auth.uid(),
     lvl.on_hand - (new_on_hand - (lvl.on_hand)), new_on_hand, new_reserved, new_reserved,
     new_damaged, new_damaged, new_incoming, new_incoming);

  RETURN lvl;
END; $$;

-- correct before/after values (rewrite insert with captured olds)
CREATE OR REPLACE FUNCTION public.apply_inventory_movement(
  _inventory_level_id uuid,
  _movement_type public.inventory_movement_type,
  _quantity integer,
  _note text DEFAULT NULL,
  _reference_type text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _reason public.inventory_adjustment_reason DEFAULT NULL
) RETURNS public.inventory_levels
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lvl public.inventory_levels;
  old_on_hand int; old_reserved int; old_damaged int; old_incoming int;
  new_on_hand int; new_reserved int; new_damaged int; new_incoming int;
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

  old_on_hand := lvl.on_hand; old_reserved := lvl.reserved;
  old_damaged := lvl.damaged; old_incoming := lvl.incoming;
  new_on_hand := old_on_hand; new_reserved := old_reserved;
  new_damaged := old_damaged; new_incoming := old_incoming;

  CASE _movement_type
    WHEN 'initial', 'adjustment_in', 'return_in', 'purchase_in', 'transfer_in', 'stocktake_in' THEN
      new_on_hand := new_on_hand + _quantity;
    WHEN 'adjustment_out', 'transfer_out', 'stocktake_out' THEN
      new_on_hand := new_on_hand - _quantity;
    WHEN 'damage' THEN
      new_on_hand := new_on_hand - _quantity;
      new_damaged := new_damaged + _quantity;
    WHEN 'purchase_damaged_in' THEN
      new_damaged := new_damaged + _quantity;
    WHEN 'damaged_out' THEN
      new_damaged := new_damaged - _quantity;
    WHEN 'transfer_incoming_in' THEN
      new_incoming := new_incoming + _quantity;
    WHEN 'transfer_incoming_out' THEN
      new_incoming := new_incoming - _quantity;
    WHEN 'reservation' THEN
      new_reserved := new_reserved + _quantity;
    WHEN 'release_reservation' THEN
      new_reserved := new_reserved - _quantity;
    WHEN 'fulfillment_out' THEN
      new_reserved := new_reserved - _quantity;
      new_on_hand := new_on_hand - _quantity;
  END CASE;

  IF new_on_hand < 0 THEN
    RAISE EXCEPTION 'Not enough stock: on hand is %, cannot remove %', old_on_hand, _quantity;
  END IF;
  IF new_damaged < 0 THEN
    RAISE EXCEPTION 'Cannot remove more than the damaged quantity (%).', old_damaged;
  END IF;
  IF new_reserved < 0 THEN
    RAISE EXCEPTION 'Cannot release more than the reserved quantity (%).', old_reserved;
  END IF;
  IF new_incoming < 0 THEN
    RAISE EXCEPTION 'Cannot remove more than the in-transit quantity (%).', old_incoming;
  END IF;
  IF new_reserved > new_on_hand THEN
    RAISE EXCEPTION 'Reserved (%) cannot exceed on hand (%)', new_reserved, new_on_hand;
  END IF;

  PERFORM set_config('app.inventory_write', 'on', true);
  UPDATE public.inventory_levels
     SET on_hand = new_on_hand, reserved = new_reserved, damaged = new_damaged,
         incoming = new_incoming, updated_by = auth.uid()
   WHERE id = _inventory_level_id
   RETURNING * INTO lvl;
  PERFORM set_config('app.inventory_write', 'off', true);

  INSERT INTO public.inventory_movements
    (inventory_level_id, movement_type, quantity, reference_type, reference_id, note, reason, created_by,
     on_hand_before, on_hand_after, reserved_before, reserved_after,
     damaged_before, damaged_after, incoming_before, incoming_after)
  VALUES (_inventory_level_id, _movement_type, _quantity, _reference_type, _reference_id, _note, _reason, auth.uid(),
     old_on_hand, new_on_hand, old_reserved, new_reserved,
     old_damaged, new_damaged, old_incoming, new_incoming);

  RETURN lvl;
END; $$;

REVOKE EXECUTE ON FUNCTION public.apply_inventory_movement(uuid, public.inventory_movement_type, integer, text, text, uuid, public.inventory_adjustment_reason) FROM anon;

-- ============ 3. Internal helper: ensure a level row exists ============
CREATE OR REPLACE FUNCTION public.ensure_inventory_level_internal(
  _location_id uuid, _product_id uuid, _variant_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.is_inventory_eligible_item(_product_id, _variant_id) THEN
    RAISE EXCEPTION 'This item cannot hold stock';
  END IF;
  SELECT id INTO _id FROM public.inventory_levels
   WHERE location_id = _location_id
     AND product_id IS NOT DISTINCT FROM _product_id
     AND variant_id IS NOT DISTINCT FROM _variant_id;
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  INSERT INTO public.inventory_levels (location_id, product_id, variant_id, created_by, updated_by)
  VALUES (_location_id, _product_id, _variant_id, auth.uid(), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.ensure_inventory_level_internal(uuid, uuid, uuid) FROM anon, authenticated;

-- ============ 4. Transfers ============
CREATE SEQUENCE IF NOT EXISTS public.inventory_transfer_number_seq;
CREATE OR REPLACE FUNCTION public.next_transfer_number()
RETURNS text LANGUAGE sql SET search_path = public AS $$
  SELECT 'TRF-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.inventory_transfer_number_seq')::text, 5, '0');
$$;

CREATE TABLE IF NOT EXISTS public.inventory_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  from_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  to_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status public.inventory_transfer_status NOT NULL DEFAULT 'draft',
  notes text,
  cancel_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dispatched_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dispatched_at timestamptz,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transfers_distinct_locations CHECK (from_location_id <> to_location_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_transfers TO authenticated;
GRANT ALL ON public.inventory_transfers TO service_role;
ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_transfers_select ON public.inventory_transfers
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE INDEX IF NOT EXISTS inventory_transfers_status_idx ON public.inventory_transfers (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.inventory_transfers(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text,
  sku_snapshot text,
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  shipped_quantity integer NOT NULL DEFAULT 0 CHECK (shipped_quantity >= 0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transfer_items_target_xor
    CHECK ((product_id IS NULL) <> (variant_id IS NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_transfer_items TO authenticated;
GRANT ALL ON public.inventory_transfer_items TO service_role;
ALTER TABLE public.inventory_transfer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_transfer_items_select ON public.inventory_transfer_items
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE UNIQUE INDEX IF NOT EXISTS inventory_transfer_items_product_uniq
  ON public.inventory_transfer_items (transfer_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_transfer_items_variant_uniq
  ON public.inventory_transfer_items (transfer_id, variant_id) WHERE variant_id IS NOT NULL;

-- ============ 5. Stocktakes ============
CREATE SEQUENCE IF NOT EXISTS public.stocktake_number_seq;
CREATE OR REPLACE FUNCTION public.next_stocktake_number()
RETURNS text LANGUAGE sql SET search_path = public AS $$
  SELECT 'STK-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.stocktake_number_seq')::text, 5, '0');
$$;

CREATE TABLE IF NOT EXISTS public.stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status public.stocktake_status NOT NULL DEFAULT 'draft',
  notes text,
  cancel_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stocktakes TO authenticated;
GRANT ALL ON public.stocktakes TO service_role;
ALTER TABLE public.stocktakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY stocktakes_select ON public.stocktakes
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE INDEX IF NOT EXISTS stocktakes_status_idx ON public.stocktakes (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stocktake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  inventory_level_id uuid NOT NULL REFERENCES public.inventory_levels(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text,
  sku_snapshot text,
  system_quantity integer NOT NULL,
  counted_quantity integer CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  applied_delta integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stocktake_items_target_xor CHECK ((product_id IS NULL) <> (variant_id IS NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stocktake_items TO authenticated;
GRANT ALL ON public.stocktake_items TO service_role;
ALTER TABLE public.stocktake_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY stocktake_items_select ON public.stocktake_items
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE UNIQUE INDEX IF NOT EXISTS stocktake_items_level_uniq
  ON public.stocktake_items (stocktake_id, inventory_level_id);

-- ============ 6. Direct write guard ============
CREATE OR REPLACE FUNCTION public.guard_inventory_ops_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.inventory_ops_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Direct writes to % are not allowed. Use the controlled inventory operations.', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_write ON public.inventory_transfers;
CREATE TRIGGER guard_write BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_ops_write();
DROP TRIGGER IF EXISTS guard_write ON public.inventory_transfer_items;
CREATE TRIGGER guard_write BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transfer_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_ops_write();
DROP TRIGGER IF EXISTS guard_write ON public.stocktakes;
CREATE TRIGGER guard_write BEFORE INSERT OR UPDATE OR DELETE ON public.stocktakes
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_ops_write();
DROP TRIGGER IF EXISTS guard_write ON public.stocktake_items;
CREATE TRIGGER guard_write BEFORE INSERT OR UPDATE OR DELETE ON public.stocktake_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_ops_write();

-- ============ 7. Transfer operations ============
CREATE OR REPLACE FUNCTION public.create_inventory_transfer(
  _from_location_id uuid, _to_location_id uuid, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create transfers';
  END IF;
  IF _from_location_id = _to_location_id THEN
    RAISE EXCEPTION 'Source and destination must be different locations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_locations WHERE id = _from_location_id AND status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.inventory_locations WHERE id = _to_location_id AND status = 'active') THEN
    RAISE EXCEPTION 'Both locations must be active';
  END IF;

  PERFORM set_config('app.inventory_ops_write', 'on', true);
  INSERT INTO public.inventory_transfers (reference_number, from_location_id, to_location_id, notes, created_by)
  VALUES (public.next_transfer_number(), _from_location_id, _to_location_id, nullif(btrim(_notes), ''), auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('app.inventory_ops_write', 'off', true);
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_transfer_items(_transfer_id uuid, _lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.inventory_transfers; ln jsonb; _pid uuid; _vid uuid; _qty int;
        _pname text; _vname text; _sku text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to edit transfers';
  END IF;
  SELECT * INTO t FROM public.inventory_transfers WHERE id = _transfer_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status <> 'draft' THEN RAISE EXCEPTION 'Only draft transfers can be edited'; END IF;

  PERFORM set_config('app.inventory_ops_write', 'on', true);
  DELETE FROM public.inventory_transfer_items WHERE transfer_id = _transfer_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) LOOP
    _pid := nullif(ln->>'product_id','')::uuid;
    _vid := nullif(ln->>'variant_id','')::uuid;
    _qty := (ln->>'requested_quantity')::int;
    IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
    IF NOT public.is_inventory_eligible_item(_pid, _vid) THEN
      RAISE EXCEPTION 'This item cannot be transferred because it does not hold stock';
    END IF;

    IF _vid IS NOT NULL THEN
      SELECT p.name, v.title, coalesce(v.sku, p.sku) INTO _pname, _vname, _sku
        FROM public.product_variants v JOIN public.products p ON p.id = v.product_id WHERE v.id = _vid;
    ELSE
      SELECT name, NULL, sku INTO _pname, _vname, _sku FROM public.products WHERE id = _pid;
    END IF;

    INSERT INTO public.inventory_transfer_items
      (transfer_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, requested_quantity)
    VALUES (_transfer_id, _pid, _vid, coalesce(_pname,'Unknown item'), _vname, _sku, _qty);
  END LOOP;

  UPDATE public.inventory_transfers SET updated_at = now() WHERE id = _transfer_id;
  PERFORM set_config('app.inventory_ops_write', 'off', true);
END; $$;

CREATE OR REPLACE FUNCTION public.set_transfer_status(
  _transfer_id uuid, _status public.inventory_transfer_status, _reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.inventory_transfers; it public.inventory_transfer_items; _src uuid; _dst uuid; _item_count int;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change transfers';
  END IF;
  SELECT * INTO t FROM public.inventory_transfers WHERE id = _transfer_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status = _status THEN RAISE EXCEPTION 'Transfer is already %', _status; END IF;

  SELECT count(*) INTO _item_count FROM public.inventory_transfer_items WHERE transfer_id = _transfer_id;

  PERFORM set_config('app.inventory_ops_write', 'on', true);

  IF _status = 'pending' THEN
    IF t.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft transfer can be submitted'; END IF;
    IF _item_count = 0 THEN RAISE EXCEPTION 'Add at least one item before submitting'; END IF;
    UPDATE public.inventory_transfers
       SET status = 'pending', approved_by = auth.uid(), updated_at = now() WHERE id = _transfer_id;

  ELSIF _status = 'in_transit' THEN
    IF t.status <> 'pending' THEN RAISE EXCEPTION 'Only a pending transfer can be dispatched'; END IF;
    FOR it IN SELECT * FROM public.inventory_transfer_items WHERE transfer_id = _transfer_id ORDER BY id LOOP
      _src := public.ensure_inventory_level_internal(t.from_location_id, it.product_id, it.variant_id);
      _dst := public.ensure_inventory_level_internal(t.to_location_id, it.product_id, it.variant_id);
      PERFORM public.apply_inventory_movement(_src, 'transfer_out', it.requested_quantity,
        'Dispatched on transfer ' || t.reference_number, 'inventory_transfer', t.id, NULL);
      PERFORM public.apply_inventory_movement(_dst, 'transfer_incoming_in', it.requested_quantity,
        'In transit from transfer ' || t.reference_number, 'inventory_transfer', t.id, NULL);
      UPDATE public.inventory_transfer_items
         SET shipped_quantity = it.requested_quantity, updated_at = now() WHERE id = it.id;
    END LOOP;
    UPDATE public.inventory_transfers
       SET status = 'in_transit', dispatched_by = auth.uid(), dispatched_at = now(), updated_at = now()
     WHERE id = _transfer_id;

  ELSIF _status = 'received' THEN
    IF t.status <> 'in_transit' THEN RAISE EXCEPTION 'Only a dispatched transfer can be received'; END IF;
    FOR it IN SELECT * FROM public.inventory_transfer_items WHERE transfer_id = _transfer_id ORDER BY id LOOP
      _dst := public.ensure_inventory_level_internal(t.to_location_id, it.product_id, it.variant_id);
      PERFORM public.apply_inventory_movement(_dst, 'transfer_incoming_out', it.shipped_quantity,
        'Arrived from transfer ' || t.reference_number, 'inventory_transfer', t.id, NULL);
      PERFORM public.apply_inventory_movement(_dst, 'transfer_in', it.shipped_quantity,
        'Received from transfer ' || t.reference_number, 'inventory_transfer', t.id, NULL);
      UPDATE public.inventory_transfer_items
         SET received_quantity = it.shipped_quantity, updated_at = now() WHERE id = it.id;
    END LOOP;
    UPDATE public.inventory_transfers
       SET status = 'received', received_by = auth.uid(), received_at = now(), updated_at = now()
     WHERE id = _transfer_id;

  ELSIF _status = 'cancelled' THEN
    IF t.status IN ('received','cancelled') THEN
      RAISE EXCEPTION 'A % transfer cannot be cancelled', t.status;
    END IF;
    IF nullif(btrim(coalesce(_reason,'')),'') IS NULL THEN
      RAISE EXCEPTION 'A cancellation reason is required';
    END IF;
    IF t.status = 'in_transit' THEN
      IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only an administrator can cancel a dispatched transfer';
      END IF;
      FOR it IN SELECT * FROM public.inventory_transfer_items WHERE transfer_id = _transfer_id ORDER BY id LOOP
        _src := public.ensure_inventory_level_internal(t.from_location_id, it.product_id, it.variant_id);
        _dst := public.ensure_inventory_level_internal(t.to_location_id, it.product_id, it.variant_id);
        PERFORM public.apply_inventory_movement(_dst, 'transfer_incoming_out', it.shipped_quantity,
          'Cancelled transfer ' || t.reference_number, 'inventory_transfer', t.id, NULL);
        PERFORM public.apply_inventory_movement(_src, 'transfer_in', it.shipped_quantity,
          'Returned to source, cancelled transfer ' || t.reference_number, 'inventory_transfer', t.id, NULL);
        UPDATE public.inventory_transfer_items SET shipped_quantity = 0, updated_at = now() WHERE id = it.id;
      END LOOP;
    END IF;
    UPDATE public.inventory_transfers
       SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
           cancel_reason = btrim(_reason), updated_at = now()
     WHERE id = _transfer_id;
  ELSE
    RAISE EXCEPTION 'Unsupported transfer status %', _status;
  END IF;

  PERFORM set_config('app.inventory_ops_write', 'off', true);
END; $$;

-- ============ 8. Stocktake operations ============
CREATE OR REPLACE FUNCTION public.create_stocktake(_location_id uuid, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create stocktakes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_locations WHERE id = _location_id AND status = 'active') THEN
    RAISE EXCEPTION 'The location must be active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stocktakes WHERE location_id = _location_id AND status IN ('draft','in_progress')) THEN
    RAISE EXCEPTION 'An open stocktake already exists for this location';
  END IF;
  PERFORM set_config('app.inventory_ops_write', 'on', true);
  INSERT INTO public.stocktakes (reference_number, location_id, notes, created_by)
  VALUES (public.next_stocktake_number(), _location_id, nullif(btrim(_notes),''), auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('app.inventory_ops_write', 'off', true);
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.start_stocktake(_stocktake_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.stocktakes;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to start stocktakes';
  END IF;
  SELECT * INTO s FROM public.stocktakes WHERE id = _stocktake_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stocktake not found'; END IF;
  IF s.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft stocktake can be started'; END IF;

  PERFORM set_config('app.inventory_ops_write', 'on', true);
  INSERT INTO public.stocktake_items
    (stocktake_id, inventory_level_id, product_id, variant_id,
     product_name_snapshot, variant_name_snapshot, sku_snapshot, system_quantity)
  SELECT s.id, l.id, l.product_id, l.variant_id,
         coalesce(pp.name, p.name, 'Unknown item'), v.title, coalesce(v.sku, p.sku, pp.sku),
         l.on_hand
    FROM public.inventory_levels l
    LEFT JOIN public.products p ON p.id = l.product_id
    LEFT JOIN public.product_variants v ON v.id = l.variant_id
    LEFT JOIN public.products pp ON pp.id = v.product_id
   WHERE l.location_id = s.location_id;

  UPDATE public.stocktakes
     SET status = 'in_progress', started_at = now(), updated_at = now() WHERE id = _stocktake_id;
  PERFORM set_config('app.inventory_ops_write', 'off', true);
END; $$;

CREATE OR REPLACE FUNCTION public.set_stocktake_counts(_stocktake_id uuid, _lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.stocktakes; ln jsonb; _item_id uuid; _counted int;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record counts';
  END IF;
  SELECT * INTO s FROM public.stocktakes WHERE id = _stocktake_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stocktake not found'; END IF;
  IF s.status <> 'in_progress' THEN RAISE EXCEPTION 'Counts can only be recorded while the stocktake is in progress'; END IF;

  PERFORM set_config('app.inventory_ops_write', 'on', true);
  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) LOOP
    _item_id := (ln->>'item_id')::uuid;
    _counted := nullif(ln->>'counted_quantity','')::int;
    IF _counted IS NOT NULL AND _counted < 0 THEN RAISE EXCEPTION 'Counted quantity cannot be negative'; END IF;
    UPDATE public.stocktake_items
       SET counted_quantity = _counted, note = nullif(btrim(ln->>'note'),''), updated_at = now()
     WHERE id = _item_id AND stocktake_id = _stocktake_id;
  END LOOP;
  UPDATE public.stocktakes SET updated_at = now() WHERE id = _stocktake_id;
  PERFORM set_config('app.inventory_ops_write', 'off', true);
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_stocktake(_stocktake_id uuid, _accept_changes boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.stocktakes; it public.stocktake_items; cur_on_hand int; delta int; stale int := 0;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to finalise stocktakes';
  END IF;
  SELECT * INTO s FROM public.stocktakes WHERE id = _stocktake_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stocktake not found'; END IF;
  IF s.status <> 'in_progress' THEN RAISE EXCEPTION 'Only a stocktake in progress can be finalised'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stocktake_items WHERE stocktake_id = _stocktake_id AND counted_quantity IS NOT NULL) THEN
    RAISE EXCEPTION 'Record at least one physical count before finalising';
  END IF;

  -- stale detection: stock moved since the snapshot was taken
  SELECT count(*) INTO stale
    FROM public.stocktake_items i
    JOIN public.inventory_levels l ON l.id = i.inventory_level_id
   WHERE i.stocktake_id = _stocktake_id
     AND i.counted_quantity IS NOT NULL
     AND l.on_hand <> i.system_quantity;

  IF stale > 0 AND NOT _accept_changes THEN
    RAISE EXCEPTION 'Stock changed for % counted item(s) during this stocktake. Review the differences and confirm reconciliation before finalising.', stale;
  END IF;

  PERFORM set_config('app.inventory_ops_write', 'on', true);
  FOR it IN SELECT * FROM public.stocktake_items
             WHERE stocktake_id = _stocktake_id AND counted_quantity IS NOT NULL ORDER BY id LOOP
    SELECT on_hand INTO cur_on_hand FROM public.inventory_levels WHERE id = it.inventory_level_id FOR UPDATE;
    delta := it.counted_quantity - cur_on_hand;
    IF delta > 0 THEN
      PERFORM public.apply_inventory_movement(it.inventory_level_id, 'stocktake_in', delta,
        'Stocktake ' || s.reference_number, 'stocktake', s.id, 'counting_error');
    ELSIF delta < 0 THEN
      PERFORM public.apply_inventory_movement(it.inventory_level_id, 'stocktake_out', -delta,
        'Stocktake ' || s.reference_number, 'stocktake', s.id, 'counting_error');
    END IF;
    UPDATE public.stocktake_items SET applied_delta = delta, updated_at = now() WHERE id = it.id;
  END LOOP;

  UPDATE public.stocktakes
     SET status = 'completed', completed_at = now(), completed_by = auth.uid(), updated_at = now()
   WHERE id = _stocktake_id;
  PERFORM set_config('app.inventory_ops_write', 'off', true);
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_stocktake(_stocktake_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.stocktakes;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to cancel stocktakes';
  END IF;
  IF nullif(btrim(coalesce(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;
  SELECT * INTO s FROM public.stocktakes WHERE id = _stocktake_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stocktake not found'; END IF;
  IF s.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'A % stocktake cannot be cancelled', s.status; END IF;
  PERFORM set_config('app.inventory_ops_write', 'on', true);
  UPDATE public.stocktakes
     SET status = 'cancelled', cancel_reason = btrim(_reason), cancelled_by = auth.uid(), updated_at = now()
   WHERE id = _stocktake_id;
  PERFORM set_config('app.inventory_ops_write', 'off', true);
END; $$;

-- ============ 9. Manual adjustment wrapper with mandatory reason ============
CREATE OR REPLACE FUNCTION public.adjust_inventory(
  _inventory_level_id uuid,
  _movement_type public.inventory_movement_type,
  _quantity integer,
  _reason public.inventory_adjustment_reason,
  _note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _movement_type NOT IN ('initial','adjustment_in','adjustment_out','damage','damaged_out','return_in') THEN
    RAISE EXCEPTION 'Movement type % is not a manual adjustment', _movement_type;
  END IF;
  IF _reason IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF _reason = 'other' AND nullif(btrim(coalesce(_note,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A note is required when the reason is "other"';
  END IF;
  IF _movement_type = 'damaged_out' AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an administrator can remove damaged stock';
  END IF;
  PERFORM public.apply_inventory_movement(
    _inventory_level_id, _movement_type, _quantity, nullif(btrim(_note),''), 'manual_adjustment', NULL, _reason);
END; $$;

-- ============ 10. Derived bundle availability ============
CREATE OR REPLACE FUNCTION public.bundle_availability(_bundle_product_id uuid, _location_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.can_read_commerce(auth.uid()) THEN NULL
         ELSE coalesce((
    SELECT min(floor(comp.available / bi.quantity))::int
      FROM public.bundle_items bi
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(greatest(l.available_quantity, 0)), 0)::numeric AS available
          FROM public.inventory_levels l
         WHERE (_location_id IS NULL OR l.location_id = _location_id)
           AND ((bi.variant_id IS NOT NULL AND l.variant_id = bi.variant_id)
             OR (bi.product_id IS NOT NULL AND l.product_id = bi.product_id))
      ) comp
     WHERE bi.bundle_product_id = _bundle_product_id AND bi.quantity > 0
  ), 0) END;
$$;
REVOKE EXECUTE ON FUNCTION public.bundle_availability(uuid, uuid) FROM anon;