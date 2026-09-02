-- ============ PART 1/2: product costs, physical data, purchasability ============
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS base_cost numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_cost numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS weight numeric(12,3),
  ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS length numeric(12,3),
  ADD COLUMN IF NOT EXISTS width numeric(12,3),
  ADD COLUMN IF NOT EXISTS height numeric(12,3),
  ADD COLUMN IF NOT EXISTS dimension_unit text NOT NULL DEFAULT 'cm',
  ADD COLUMN IF NOT EXISTS requires_shipping boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_purchasable boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD CONSTRAINT products_base_cost_non_negative CHECK (base_cost >= 0),
  ADD CONSTRAINT products_additional_cost_non_negative CHECK (additional_cost >= 0),
  ADD CONSTRAINT products_weight_non_negative CHECK (weight IS NULL OR weight >= 0),
  ADD CONSTRAINT products_length_non_negative CHECK (length IS NULL OR length >= 0),
  ADD CONSTRAINT products_width_non_negative CHECK (width IS NULL OR width >= 0),
  ADD CONSTRAINT products_height_non_negative CHECK (height IS NULL OR height >= 0),
  ADD CONSTRAINT products_weight_unit_check CHECK (weight_unit IN ('kg','g','lb')),
  ADD CONSTRAINT products_dimension_unit_check CHECK (dimension_unit IN ('cm','m','in'));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS estimated_landed_cost numeric(12,2)
  GENERATED ALWAYS AS (base_cost + additional_cost) STORED;

UPDATE public.products SET is_purchasable = true WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique_idx
  ON public.products (lower(btrim(barcode))) WHERE barcode IS NOT NULL;

-- Archived products can never remain purchasable.
CREATE OR REPLACE FUNCTION public.enforce_product_purchasable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'archived' THEN NEW.is_purchasable := false; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_product_purchasable() FROM PUBLIC;

DROP TRIGGER IF EXISTS products_enforce_purchasable ON public.products;
CREATE TRIGGER products_enforce_purchasable BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_product_purchasable();

-- ============ Variant cost + physical overrides ============
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS base_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS additional_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS weight numeric(12,3),
  ADD COLUMN IF NOT EXISTS length numeric(12,3),
  ADD COLUMN IF NOT EXISTS width numeric(12,3),
  ADD COLUMN IF NOT EXISTS height numeric(12,3);

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_base_cost_non_negative CHECK (base_cost IS NULL OR base_cost >= 0),
  ADD CONSTRAINT product_variants_additional_cost_non_negative CHECK (additional_cost IS NULL OR additional_cost >= 0),
  ADD CONSTRAINT product_variants_weight_non_negative CHECK (weight IS NULL OR weight >= 0),
  ADD CONSTRAINT product_variants_length_non_negative CHECK (length IS NULL OR length >= 0),
  ADD CONSTRAINT product_variants_width_non_negative CHECK (width IS NULL OR width >= 0),
  ADD CONSTRAINT product_variants_height_non_negative CHECK (height IS NULL OR height >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_barcode_unique_idx
  ON public.product_variants (lower(btrim(barcode))) WHERE barcode IS NOT NULL;

-- ============ Variant-specific media (product XOR variant) ============
ALTER TABLE public.product_media
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE;

ALTER TABLE public.product_media ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.product_media
  ADD CONSTRAINT product_media_owner_xor
  CHECK ((product_id IS NOT NULL) <> (variant_id IS NOT NULL));

DROP INDEX IF EXISTS public.product_media_one_primary_idx;
CREATE UNIQUE INDEX product_media_one_primary_product_idx
  ON public.product_media (product_id) WHERE is_primary AND product_id IS NOT NULL;
CREATE UNIQUE INDEX product_media_one_primary_variant_idx
  ON public.product_media (variant_id) WHERE is_primary AND variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_media_variant_idx ON public.product_media (variant_id);

-- ============ Group Buy supply model + campaigns ============
ALTER TYPE public.supply_model ADD VALUE IF NOT EXISTS 'group_buy';

DO $$ BEGIN
  CREATE TYPE public.group_buy_status AS ENUM (
    'draft','scheduled','active','closed','target_met','target_not_met',
    'procurement','fulfillment','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.group_buy_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  status public.group_buy_status NOT NULL DEFAULT 'draft',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  minimum_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_quantity >= 1),
  target_quantity integer CHECK (target_quantity IS NULL OR target_quantity >= 1),
  current_quantity integer NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
  expected_delivery_start date,
  expected_delivery_end date,
  campaign_price numeric(12,2) CHECK (campaign_price IS NULL OR campaign_price >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_buy_campaigns_window CHECK (ends_at > starts_at),
  CONSTRAINT group_buy_campaigns_delivery_window
    CHECK (expected_delivery_start IS NULL OR expected_delivery_end IS NULL
           OR expected_delivery_end >= expected_delivery_start)
);
CREATE INDEX IF NOT EXISTS group_buy_campaigns_product_idx ON public.group_buy_campaigns (product_id, starts_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_buy_campaigns TO authenticated;
GRANT ALL ON public.group_buy_campaigns TO service_role;
ALTER TABLE public.group_buy_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_buy_campaigns_select ON public.group_buy_campaigns
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY group_buy_campaigns_insert ON public.group_buy_campaigns
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY group_buy_campaigns_update ON public.group_buy_campaigns
  FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY group_buy_campaigns_delete ON public.group_buy_campaigns
  FOR DELETE TO authenticated USING (public.can_manage_commerce(auth.uid()));

CREATE TRIGGER group_buy_campaigns_set_updated_at BEFORE UPDATE ON public.group_buy_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Bundle contents ============
CREATE TABLE IF NOT EXISTS public.bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_items_target_xor CHECK ((product_id IS NOT NULL) <> (variant_id IS NOT NULL)),
  CONSTRAINT bundle_items_no_self CHECK (product_id IS NULL OR product_id <> bundle_product_id)
);
CREATE INDEX IF NOT EXISTS bundle_items_bundle_idx ON public.bundle_items (bundle_product_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS bundle_items_unique_product_idx
  ON public.bundle_items (bundle_product_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bundle_items_unique_variant_idx
  ON public.bundle_items (bundle_product_id, variant_id) WHERE variant_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bundle_items TO authenticated;
GRANT ALL ON public.bundle_items TO service_role;
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY bundle_items_select ON public.bundle_items
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY bundle_items_insert ON public.bundle_items
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY bundle_items_update ON public.bundle_items
  FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid()))
  WITH CHECK (public.can_manage_commerce(auth.uid()));
CREATE POLICY bundle_items_delete ON public.bundle_items
  FOR DELETE TO authenticated USING (public.can_manage_commerce(auth.uid()));

CREATE TRIGGER bundle_items_set_updated_at BEFORE UPDATE ON public.bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_bundle_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE parent_type public.product_type; child_product uuid; child_type public.product_type;
BEGIN
  SELECT product_type INTO parent_type FROM public.products WHERE id = NEW.bundle_product_id;
  IF parent_type IS DISTINCT FROM 'bundle' THEN
    RAISE EXCEPTION 'Bundle contents can only be added to a product of type "bundle"';
  END IF;

  IF NEW.variant_id IS NOT NULL THEN
    SELECT product_id INTO child_product FROM public.product_variants WHERE id = NEW.variant_id;
  ELSE
    child_product := NEW.product_id;
  END IF;

  IF child_product = NEW.bundle_product_id THEN
    RAISE EXCEPTION 'A bundle cannot contain itself';
  END IF;

  SELECT product_type INTO child_type FROM public.products WHERE id = child_product;
  IF child_type = 'bundle' THEN
    RAISE EXCEPTION 'A bundle cannot contain another bundle';
  END IF;

  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_bundle_item() FROM PUBLIC;

CREATE TRIGGER bundle_items_validate BEFORE INSERT OR UPDATE ON public.bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_bundle_item();

-- ============ Retire the generic bundle_item relationship type ============
DELETE FROM public.product_relationships WHERE relationship_type = 'bundle_item';

ALTER TABLE public.product_relationships ALTER COLUMN relationship_type DROP DEFAULT;
CREATE TYPE public.product_relationship_type_new AS ENUM ('related','upsell','cross_sell');
ALTER TABLE public.product_relationships
  ALTER COLUMN relationship_type TYPE public.product_relationship_type_new
  USING relationship_type::text::public.product_relationship_type_new;
DROP TYPE public.product_relationship_type;
ALTER TYPE public.product_relationship_type_new RENAME TO product_relationship_type;
ALTER TABLE public.product_relationships
  ALTER COLUMN relationship_type SET DEFAULT 'related'::public.product_relationship_type;