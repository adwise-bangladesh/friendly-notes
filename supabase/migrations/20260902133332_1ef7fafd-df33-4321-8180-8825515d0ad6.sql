-- ============================================================
-- STEP 6.2 — INVENTORY RESERVATION & WAREHOUSE FULFILLMENT
-- ============================================================

-- 1. Enums ----------------------------------------------------

CREATE TYPE public.reservation_status AS ENUM (
  'not_required','pending','reserved','partial','failed','released'
);

CREATE TYPE public.reservation_record_status AS ENUM ('active','released','committed');

-- Fulfillment: rename the placeholder value, then extend.
ALTER TYPE public.order_fulfillment_status RENAME VALUE 'unfulfilled' TO 'not_started';
ALTER TYPE public.order_fulfillment_status ADD VALUE 'on_hold';
ALTER TYPE public.order_fulfillment_status ADD VALUE 'ready';
ALTER TYPE public.order_fulfillment_status ADD VALUE 'picking';
ALTER TYPE public.order_fulfillment_status ADD VALUE 'picked';
ALTER TYPE public.order_fulfillment_status ADD VALUE 'packing';
ALTER TYPE public.order_fulfillment_status ADD VALUE 'packed';
ALTER TYPE public.order_fulfillment_status ADD VALUE 'ready_for_courier';

-- One immutable movement that consumes reserved stock permanently.
ALTER TYPE public.inventory_movement_type ADD VALUE 'fulfillment_out';

-- 2. Order columns --------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN reservation_status public.reservation_status NOT NULL DEFAULT 'pending',
  ADD COLUMN fulfillment_location_id uuid REFERENCES public.inventory_locations(id),
  ADD COLUMN fulfillment_hold_reason text,
  ADD COLUMN reserved_at timestamptz,
  ADD COLUMN packed_at timestamptz;

CREATE INDEX idx_orders_fulfillment_status ON public.orders(fulfillment_status);
CREATE INDEX idx_orders_reservation_status ON public.orders(reservation_status);

-- 3. Reservation records --------------------------------------

CREATE TABLE public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  inventory_level_id uuid NOT NULL REFERENCES public.inventory_levels(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  status public.reservation_record_status NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id),
  released_by uuid REFERENCES auth.users(id),
  committed_by uuid REFERENCES auth.users(id),
  released_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservations_quantity_positive CHECK (quantity > 0),
  CONSTRAINT inventory_reservations_product_xor_variant CHECK (
    (product_id IS NOT NULL AND variant_id IS NULL)
    OR (product_id IS NULL AND variant_id IS NOT NULL)
  )
);

GRANT SELECT ON public.inventory_reservations TO authenticated;
GRANT ALL ON public.inventory_reservations TO service_role;

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commerce readers can view reservations"
  ON public.inventory_reservations FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

-- No INSERT/UPDATE/DELETE policies: every write goes through the
-- SECURITY DEFINER workflow functions below.

CREATE UNIQUE INDEX uq_reservation_active_per_item
  ON public.inventory_reservations(order_item_id)
  WHERE status = 'active';
CREATE INDEX idx_reservations_order ON public.inventory_reservations(order_id);
CREATE INDEX idx_reservations_level ON public.inventory_reservations(inventory_level_id);
CREATE INDEX idx_reservations_status ON public.inventory_reservations(status);

CREATE TRIGGER inventory_reservations_set_updated_at
  BEFORE UPDATE ON public.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guard_inventory_reservations()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.reservation_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Reservations can only be changed through the fulfillment workflow functions';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reservation history is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'active' THEN
    RAISE EXCEPTION 'A % reservation is a historical record and cannot be rewritten', OLD.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER inventory_reservations_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_reservations();

-- 4. Protect the new order columns ----------------------------

CREATE OR REPLACE FUNCTION public.guard_order_fulfillment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.fulfillment_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status
     OR NEW.reservation_status IS DISTINCT FROM OLD.reservation_status
     OR NEW.fulfillment_location_id IS DISTINCT FROM OLD.fulfillment_location_id
     OR NEW.fulfillment_hold_reason IS DISTINCT FROM OLD.fulfillment_hold_reason
     OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at
     OR NEW.packed_at IS DISTINCT FROM OLD.packed_at THEN
    RAISE EXCEPTION 'Fulfillment fields cannot be updated directly. Use the fulfillment workflow functions.';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER orders_guard_fulfillment
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_fulfillment();

-- 5. Movement engine: support the commit movement -------------

CREATE OR REPLACE FUNCTION public.apply_inventory_movement(
  _inventory_level_id uuid,
  _movement_type inventory_movement_type,
  _quantity integer,
  _note text DEFAULT NULL::text,
  _reference_type text DEFAULT NULL::text,
  _reference_id uuid DEFAULT NULL::uuid)
RETURNS inventory_levels
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    WHEN 'initial', 'adjustment_in', 'return_in' THEN
      new_on_hand := new_on_hand + _quantity;
    WHEN 'adjustment_out' THEN
      new_on_hand := new_on_hand - _quantity;
    WHEN 'damage' THEN
      new_on_hand := new_on_hand - _quantity;
      new_damaged := new_damaged + _quantity;
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
  IF new_reserved < 0 THEN
    RAISE EXCEPTION 'Cannot release more than the reserved quantity (%).', lvl.reserved;
  END IF;
  IF new_reserved > new_on_hand THEN
    RAISE EXCEPTION 'Reserved (%) cannot exceed on hand (%)', new_reserved, new_on_hand;
  END IF;

  PERFORM set_config('app.inventory_write', 'on', true);
  UPDATE public.inventory_levels
     SET on_hand = new_on_hand,
         reserved = new_reserved,
         damaged = new_damaged,
         updated_by = auth.uid()
   WHERE id = _inventory_level_id
   RETURNING * INTO lvl;
  PERFORM set_config('app.inventory_write', 'off', true);

  INSERT INTO public.inventory_movements
    (inventory_level_id, movement_type, quantity, reference_type, reference_id, note, created_by)
  VALUES (_inventory_level_id, _movement_type, _quantity, _reference_type, _reference_id,
          nullif(btrim(coalesce(_note,'')), ''), auth.uid());

  RETURN lvl;
END; $$;

-- 6. Fulfillment transition rules -----------------------------

CREATE OR REPLACE FUNCTION public.fulfillment_transition_allowed(
  _from order_fulfillment_status, _to order_fulfillment_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _from::text = _to::text THEN false
    WHEN _to::text = 'on_hold' THEN _from::text IN ('not_started','ready','picking','picked','packing')
    WHEN _from::text = 'not_started' THEN _to::text = 'ready'
    WHEN _from::text = 'on_hold' THEN _to::text = 'ready'
    WHEN _from::text = 'ready' THEN _to::text = 'picking'
    WHEN _from::text = 'picking' THEN _to::text = 'picked'
    WHEN _from::text = 'picked' THEN _to::text = 'packing'
    WHEN _from::text = 'packing' THEN _to::text = 'packed'
    WHEN _from::text = 'packed' THEN _to::text = 'ready_for_courier'
    ELSE false
  END;
$$;

-- 7. Reservation ----------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_order_inventory(_order_id uuid)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _order public.orders;
  _loc uuid;
  _item record;
  _need record;
  _blocked text := NULL;
  _stock_items int := 0;
  _level_id uuid;
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

  -- Idempotent: an order that already holds stock is never reserved twice.
  IF _order.reservation_status IN ('reserved','not_required')
     OR EXISTS (SELECT 1 FROM public.inventory_reservations
                 WHERE order_id = _order_id AND status IN ('active','committed')) THEN
    RETURN _order;
  END IF;

  SELECT id INTO _loc FROM public.inventory_locations
   WHERE status = 'active' AND is_default ORDER BY created_at LIMIT 1;

  -- Requirements per order line (variable products reserve the variant).
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
     ORDER BY oi.sort_order
  LOOP
    CONTINUE WHEN _item.id IS NULL;
    IF _item.order_item_id IS NULL THEN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id = _item.id AND order_id = _order_id) THEN
      CONTINUE;
    END IF;

    IF _item.product_type IS NULL THEN
      _blocked := coalesce(_blocked, 'Product record missing for "' || _item.product_name || '".');
      CONTINUE;
    END IF;

    IF _item.product_type IN ('service','digital') THEN
      CONTINUE; -- never stock tracked, never blocks the warehouse
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

  -- Lock every needed stock row in one deterministic statement.
  PERFORM l.id
     FROM public.inventory_levels l
     JOIN _req r
       ON l.location_id = _loc
      AND ((r.variant_id IS NOT NULL AND l.variant_id = r.variant_id)
        OR (r.product_id IS NOT NULL AND l.product_id = r.product_id))
    ORDER BY l.id
      FOR UPDATE OF l;

  -- All-or-nothing availability check (aggregated per stock row).
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

  -- Reserve everything.
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
END; $$;

-- 8. Release ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_order_reservations(_order_id uuid, _reason text)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _order public.orders; _res record; _count int := 0;
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
    PERFORM public.apply_inventory_movement(
      _res.inventory_level_id, 'release_reservation', _res.quantity,
      'Released for order ' || _order.order_number
        || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), ''),
      'order', _order_id);

    PERFORM set_config('app.reservation_write', 'on', true);
    UPDATE public.inventory_reservations
       SET status = 'released', released_at = now(), released_by = auth.uid()
     WHERE id = _res.id;
    PERFORM set_config('app.reservation_write', 'off', true);
    _count := _count + 1;
  END LOOP;

  IF _count = 0 AND _order.reservation_status <> 'reserved' THEN
    RETURN _order; -- nothing held; releasing twice is a no-op
  END IF;

  PERFORM set_config('app.fulfillment_write', 'on', true);
  UPDATE public.orders
     SET reservation_status = 'released',
         reserved_at = NULL,
         fulfillment_status = CASE WHEN fulfillment_status IN ('packed','ready_for_courier')
                                   THEN fulfillment_status ELSE 'on_hold' END,
         fulfillment_hold_reason = coalesce(nullif(btrim(coalesce(_reason,'')),''),
                                            'Reserved stock was released.'),
         updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.fulfillment_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
    'Reservation released (' || _count || ' line(s))'
      || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.',
    'system', true, auth.uid());

  RETURN _order;
END; $$;

-- 9. Commit ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.commit_order_inventory(_order_id uuid)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _order public.orders; _res record; _count int := 0;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to commit inventory';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.fulfillment_status <> 'packing' THEN
    RAISE EXCEPTION 'Stock is committed when a packing order is marked packed (current: %)',
      _order.fulfillment_status;
  END IF;

  FOR _res IN
    SELECT * FROM public.inventory_reservations
     WHERE order_id = _order_id AND status = 'active'
     ORDER BY id FOR UPDATE
  LOOP
    PERFORM public.apply_inventory_movement(
      _res.inventory_level_id, 'fulfillment_out', _res.quantity,
      'Packed for order ' || _order.order_number, 'order', _order_id);

    PERFORM set_config('app.reservation_write', 'on', true);
    UPDATE public.inventory_reservations
       SET status = 'committed', committed_at = now(), committed_by = auth.uid()
     WHERE id = _res.id;
    PERFORM set_config('app.reservation_write', 'off', true);
    _count := _count + 1;
  END LOOP;

  RETURN _order;
END; $$;

-- 10. Fulfillment workflow -------------------------------------

CREATE OR REPLACE FUNCTION public.set_order_fulfillment_state(
  _order_id uuid, _action text, _reason text DEFAULT NULL::text)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _order public.orders;
  _from public.order_fulfillment_status;
  _next public.order_fulfillment_status;
  _msg text;
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
  _from := _order.fulfillment_status;

  CASE _action
    WHEN 'start_picking' THEN _next := 'picking'; _msg := 'Picking started.';
    WHEN 'mark_picked' THEN _next := 'picked'; _msg := 'All items picked.';
    WHEN 'start_packing' THEN _next := 'packing'; _msg := 'Packing started.';
    WHEN 'mark_packed' THEN _next := 'packed'; _msg := 'Order packed — stock committed.';
    WHEN 'ready_for_courier' THEN _next := 'ready_for_courier'; _msg := 'Ready for courier handover.';
    WHEN 'hold' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A hold reason is required'; END IF;
      _next := 'on_hold'; _msg := 'Put on hold — ' || _clean;
    WHEN 'resume' THEN _next := 'ready'; _msg := coalesce(_clean, 'Resumed — ready for the warehouse.');
    ELSE RAISE EXCEPTION 'Unknown fulfillment action: %', _action;
  END CASE;

  IF NOT public.fulfillment_transition_allowed(_from, _next) THEN
    RAISE EXCEPTION 'Fulfillment cannot move from % to %', _from, _next;
  END IF;

  IF _action IN ('start_picking','resume')
     AND _order.reservation_status NOT IN ('reserved','not_required') THEN
    RAISE EXCEPTION 'Inventory must be reserved before warehouse work can start';
  END IF;

  IF _action = 'mark_packed' THEN
    PERFORM public.commit_order_inventory(_order_id);
  END IF;

  PERFORM set_config('app.fulfillment_write', 'on', true);
  UPDATE public.orders
     SET fulfillment_status = _next,
         fulfillment_hold_reason = CASE WHEN _next = 'on_hold' THEN _clean ELSE NULL END,
         packed_at = CASE WHEN _action = 'mark_packed' THEN now() ELSE packed_at END,
         updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.fulfillment_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Fulfillment: ' || _msg, 'system', true, auth.uid());

  RETURN _order;
END; $$;

-- 11. Auto-reserve on verification confirmation ----------------
-- Reservation never rolls back a confirmed verification: a stock shortage
-- ends as reservation_status = failed + fulfillment_status = on_hold.

CREATE OR REPLACE FUNCTION public.apply_verification_transition(
  _order_id uuid, _to order_verification_status, _event verification_event_type,
  _message text, _attempt_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT NULL::jsonb,
  _scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _risk_level verification_risk_level DEFAULT NULL::verification_risk_level,
  _risk_reason text DEFAULT NULL::text, _failure_reason text DEFAULT NULL::text,
  _touch_attempt boolean DEFAULT false)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _order public.orders; _from public.order_verification_status;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  _from := _order.verification_status;

  IF _order.status = 'cancelled' AND _to <> 'cancelled' THEN
    RAISE EXCEPTION 'This order is cancelled — verification can no longer be changed';
  END IF;
  IF NOT public.verification_transition_allowed(_from, _to) THEN
    RAISE EXCEPTION 'Verification cannot move from % to %', _from, _to;
  END IF;

  PERFORM set_config('app.verification_write', 'on', true);
  UPDATE public.orders
     SET verification_status = _to,
         risk_level = coalesce(_risk_level, risk_level),
         risk_reason = CASE WHEN _risk_reason IS NULL THEN risk_reason ELSE _risk_reason END,
         verification_failure_reason = CASE WHEN _to = 'failed' THEN _failure_reason ELSE verification_failure_reason END,
         verification_confirmed_at = CASE WHEN _to = 'confirmed' THEN now() ELSE verification_confirmed_at END,
         verification_next_action_at = CASE
           WHEN _to IN ('confirmed','failed','cancelled','unreachable') THEN NULL
           WHEN _scheduled_at IS NOT NULL THEN _scheduled_at
           ELSE verification_next_action_at END,
         verification_last_attempt_at = CASE WHEN _touch_attempt THEN now() ELSE verification_last_attempt_at END,
         verification_attempt_count = (
           SELECT count(*) FROM public.order_verification_attempts a WHERE a.order_id = _order_id
         ),
         updated_by = coalesce(auth.uid(), updated_by)
   WHERE id = _order_id
   RETURNING * INTO _order;

  INSERT INTO public.order_verification_events
    (order_id, attempt_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_order_id, _attempt_id, _event, _from, _to, _message, _metadata, auth.uid());
  PERFORM set_config('app.verification_write', 'off', true);

  IF _to = 'confirmed' AND _from <> 'confirmed' AND _order.status <> 'cancelled' THEN
    _order := public.reserve_order_inventory(_order_id);
  END IF;

  RETURN _order;
END; $$;

-- 12. Cancellation releases held stock, never silently restores committed stock

CREATE OR REPLACE FUNCTION public.cancel_order(
  _order_id uuid, _reason text DEFAULT NULL::text, _force boolean DEFAULT false)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _order public.orders; _from public.order_verification_status; _committed int;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to cancel orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Order is already cancelled'; END IF;
  _from := _order.verification_status;

  SELECT count(*) INTO _committed FROM public.inventory_reservations
   WHERE order_id = _order_id AND status = 'committed';

  IF _committed > 0 AND NOT _force THEN
    RAISE EXCEPTION 'Stock for this order is already committed (packed). Cancelling needs an administrative exception and a return/reversal to restore stock.';
  END IF;
  IF _committed > 0 AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or owner can force-cancel an order whose stock is committed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_reservations
              WHERE order_id = _order_id AND status = 'active') THEN
    PERFORM public.release_order_reservations(_order_id, 'Order cancelled');
    SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  END IF;

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
      || CASE WHEN _committed > 0 THEN ' (administrative exception — committed stock was NOT restored).' ELSE '.' END,
    'system', true, auth.uid());

  RETURN _order;
END; $$;

REVOKE ALL ON FUNCTION public.reserve_order_inventory(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.release_order_reservations(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.commit_order_inventory(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.set_order_fulfillment_state(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reserve_order_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_order_reservations(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_fulfillment_state(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_order_inventory(uuid) TO authenticated;
