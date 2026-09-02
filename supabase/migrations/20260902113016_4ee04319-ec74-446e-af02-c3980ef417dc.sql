-- ============ ENUMS ============
CREATE TYPE public.inventory_movement_type AS ENUM (
  'initial','adjustment_in','adjustment_out','damage','return_in','reservation','release_reservation'
);

-- ============ LOCATIONS ============
CREATE TABLE public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  description text,
  status public.entity_status NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_locations_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT inventory_locations_code_not_blank CHECK (length(btrim(code)) > 0)
);

CREATE UNIQUE INDEX inventory_locations_code_key ON public.inventory_locations (lower(code));
CREATE UNIQUE INDEX inventory_locations_single_default
  ON public.inventory_locations ((true)) WHERE is_default AND status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_locations TO authenticated;
GRANT ALL ON public.inventory_locations TO service_role;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_locations_select ON public.inventory_locations
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY inventory_locations_insert ON public.inventory_locations
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY inventory_locations_update ON public.inventory_locations
  FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY inventory_locations_delete ON public.inventory_locations
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER inventory_locations_set_updated_at
  BEFORE UPDATE ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- archived / inactive locations can never be default
CREATE OR REPLACE FUNCTION public.guard_location_default()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status <> 'active' THEN NEW.is_default := false; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER inventory_locations_guard_default
  BEFORE INSERT OR UPDATE ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.guard_location_default();

-- promoting a default demotes the previous one
CREATE OR REPLACE FUNCTION public.set_default_inventory_location(_location_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _status public.entity_status;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to manage inventory locations';
  END IF;
  SELECT status INTO _status FROM public.inventory_locations WHERE id = _location_id;
  IF _status IS NULL THEN RAISE EXCEPTION 'Location not found'; END IF;
  IF _status <> 'active' THEN RAISE EXCEPTION 'Only an active location can be the default'; END IF;

  UPDATE public.inventory_locations SET is_default = false, updated_by = auth.uid()
   WHERE is_default AND id <> _location_id;
  UPDATE public.inventory_locations SET is_default = true, updated_by = auth.uid()
   WHERE id = _location_id;
  RETURN _location_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.set_default_inventory_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_inventory_location(uuid) TO authenticated;

-- ============ LEVELS ============
CREATE TABLE public.inventory_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  on_hand integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  damaged integer NOT NULL DEFAULT 0,
  incoming integer NOT NULL DEFAULT 0,
  available_quantity integer GENERATED ALWAYS AS (on_hand - reserved) STORED,
  low_stock_threshold integer,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_levels_owner_xor CHECK (
    (product_id IS NOT NULL AND variant_id IS NULL) OR (product_id IS NULL AND variant_id IS NOT NULL)
  ),
  CONSTRAINT inventory_levels_non_negative CHECK (
    on_hand >= 0 AND reserved >= 0 AND damaged >= 0 AND incoming >= 0
  ),
  CONSTRAINT inventory_levels_reserved_within_on_hand CHECK (reserved <= on_hand),
  CONSTRAINT inventory_levels_threshold_non_negative CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0)
);

CREATE UNIQUE INDEX inventory_levels_product_location_key
  ON public.inventory_levels (product_id, location_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX inventory_levels_variant_location_key
  ON public.inventory_levels (variant_id, location_id) WHERE variant_id IS NOT NULL;
CREATE INDEX inventory_levels_location_idx ON public.inventory_levels (location_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_levels TO authenticated;
GRANT ALL ON public.inventory_levels TO service_role;
ALTER TABLE public.inventory_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_levels_select ON public.inventory_levels
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY inventory_levels_insert ON public.inventory_levels
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY inventory_levels_update ON public.inventory_levels
  FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY inventory_levels_delete ON public.inventory_levels
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER inventory_levels_set_updated_at
  BEFORE UPDATE ON public.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- eligibility: simple product OR variant of a variable product; location must not be archived
CREATE OR REPLACE FUNCTION public.validate_inventory_level()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE _type public.product_type; _loc public.entity_status;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT product_type INTO _type FROM public.products WHERE id = NEW.product_id;
    IF _type IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF _type <> 'simple' THEN
      RAISE EXCEPTION 'Inventory can only be tracked directly on a simple product (got %). Variable products track stock per variant; bundle, service and digital products are not tracked.', _type;
    END IF;
  ELSE
    SELECT p.product_type INTO _type
      FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
     WHERE v.id = NEW.variant_id;
    IF _type IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
    IF _type <> 'variable' THEN
      RAISE EXCEPTION 'Variant inventory requires a parent product of type variable (got %)', _type;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    SELECT status INTO _loc FROM public.inventory_locations WHERE id = NEW.location_id;
    IF _loc = 'archived' THEN
      RAISE EXCEPTION 'Archived locations cannot receive inventory';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER inventory_levels_validate
  BEFORE INSERT OR UPDATE ON public.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_level();

-- quantities are only writable through apply_inventory_movement()
CREATE OR REPLACE FUNCTION public.guard_inventory_quantities()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.inventory_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.on_hand := 0; NEW.reserved := 0; NEW.damaged := 0; NEW.incoming := 0;
    RETURN NEW;
  END IF;

  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand
     OR NEW.reserved IS DISTINCT FROM OLD.reserved
     OR NEW.damaged IS DISTINCT FROM OLD.damaged
     OR NEW.incoming IS DISTINCT FROM OLD.incoming THEN
    RAISE EXCEPTION 'Stock quantities cannot be edited directly. Use apply_inventory_movement().';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER inventory_levels_guard_quantities
  BEFORE INSERT OR UPDATE ON public.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_quantities();

-- ============ MOVEMENTS ============
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_level_id uuid NOT NULL REFERENCES public.inventory_levels(id) ON DELETE CASCADE,
  movement_type public.inventory_movement_type NOT NULL,
  quantity integer NOT NULL,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX inventory_movements_level_idx
  ON public.inventory_movements (inventory_level_id, created_at DESC);

GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- read only: inserts happen exclusively inside apply_inventory_movement();
-- no update/delete policies, so the audit trail is immutable.
CREATE POLICY inventory_movements_select ON public.inventory_movements
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

-- ============ CONTROLLED MOVEMENT ============
CREATE OR REPLACE FUNCTION public.apply_inventory_movement(
  _inventory_level_id uuid,
  _movement_type public.inventory_movement_type,
  _quantity integer,
  _note text DEFAULT NULL,
  _reference_type text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL
) RETURNS public.inventory_levels
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

REVOKE EXECUTE ON FUNCTION public.apply_inventory_movement(uuid, public.inventory_movement_type, integer, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_inventory_movement(uuid, public.inventory_movement_type, integer, text, text, uuid) TO authenticated;
