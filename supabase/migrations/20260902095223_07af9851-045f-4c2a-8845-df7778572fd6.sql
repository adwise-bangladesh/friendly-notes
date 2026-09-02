-- ENUMS
CREATE TYPE public.entity_status AS ENUM ('active','inactive','archived');
CREATE TYPE public.entity_visibility AS ENUM ('visible','hidden');
CREATE TYPE public.brand_type AS ENUM ('standard','own_brand','generic');
CREATE TYPE public.product_type AS ENUM ('simple','variable','bundle','service','digital');
CREATE TYPE public.supply_model AS ENUM ('in_stock','local_sourcing','preorder');
CREATE TYPE public.product_status AS ENUM ('draft','active','inactive','archived');
CREATE TYPE public.variant_status AS ENUM ('active','inactive');
CREATE TYPE public.product_relationship_type AS ENUM ('related','upsell','cross_sell','bundle_item');

-- helper: staff-or-above write access
CREATE OR REPLACE FUNCTION public.can_manage_commerce(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(_user_id) OR public.has_role(_user_id,'staff');
$$;
REVOKE EXECUTE ON FUNCTION public.can_manage_commerce(uuid) FROM public, anon;

CREATE OR REPLACE FUNCTION public.can_read_commerce(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_manage_commerce(_user_id) OR public.has_role(_user_id,'viewer');
$$;
REVOKE EXECUTE ON FUNCTION public.can_read_commerce(uuid) FROM public, anon;

-- CATEGORIES
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.categories(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  short_description text,
  description text,
  thumbnail_url text,
  banner_url text,
  status public.entity_status NOT NULL DEFAULT 'active',
  visibility public.entity_visibility NOT NULL DEFAULT 'visible',
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT categories_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX categories_slug_lower_key ON public.categories (lower(slug));
CREATE INDEX categories_parent_id_idx ON public.categories (parent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- BRANDS
CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  brand_type public.brand_type NOT NULL DEFAULT 'standard',
  short_description text,
  description text,
  logo_url text,
  banner_url text,
  website text,
  status public.entity_status NOT NULL DEFAULT 'active',
  visibility public.entity_visibility NOT NULL DEFAULT 'visible',
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX brands_slug_lower_key ON public.brands (lower(slug));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- PRODUCTS
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  short_description text,
  description text,
  brand_id uuid REFERENCES public.brands(id) ON DELETE RESTRICT,
  product_type public.product_type NOT NULL DEFAULT 'simple',
  supply_model public.supply_model NOT NULL DEFAULT 'in_stock',
  status public.product_status NOT NULL DEFAULT 'draft',
  visibility public.entity_visibility NOT NULL DEFAULT 'visible',
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX products_slug_lower_key ON public.products (lower(slug));
CREATE INDEX products_brand_id_idx ON public.products (brand_id);
CREATE INDEX products_status_visibility_idx ON public.products (status, visibility);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- PRODUCT CATEGORIES
CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, category_id)
);
CREATE UNIQUE INDEX product_categories_one_primary_idx ON public.product_categories (product_id) WHERE is_primary;
CREATE INDEX product_categories_product_id_idx ON public.product_categories (product_id);
CREATE INDEX product_categories_category_id_idx ON public.product_categories (category_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

-- PRODUCT VARIANTS
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  sku text,
  barcode text,
  status public.variant_status NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_variants_sku_key ON public.product_variants (lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX product_variants_product_id_idx ON public.product_variants (product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- PRODUCT RELATIONSHIPS
CREATE TABLE public.product_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  related_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  relationship_type public.product_relationship_type NOT NULL DEFAULT 'related',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_relationships_no_self CHECK (product_id <> related_product_id),
  UNIQUE (product_id, related_product_id, relationship_type)
);
CREATE INDEX product_relationships_product_id_idx ON public.product_relationships (product_id);
CREATE INDEX product_relationships_related_product_id_idx ON public.product_relationships (related_product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_relationships TO authenticated;
GRANT ALL ON public.product_relationships TO service_role;
ALTER TABLE public.product_relationships ENABLE ROW LEVEL SECURITY;

-- PRODUCT MEDIA (minimal)
CREATE TABLE public.product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_media_one_primary_idx ON public.product_media (product_id) WHERE is_primary;
CREATE INDEX product_media_product_id_idx ON public.product_media (product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_media TO authenticated;
GRANT ALL ON public.product_media TO service_role;
ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

-- CIRCULAR HIERARCHY GUARD
CREATE OR REPLACE FUNCTION public.prevent_category_cycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cur uuid; depth int := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'A category cannot be its own parent'; END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    depth := depth + 1;
    IF depth > 50 THEN RAISE EXCEPTION 'Category hierarchy too deep'; END IF;
    IF cur = NEW.id THEN RAISE EXCEPTION 'Circular category hierarchy detected'; END IF;
    SELECT parent_id INTO cur FROM public.categories WHERE id = cur;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER categories_prevent_cycle BEFORE INSERT OR UPDATE OF parent_id ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_category_cycle();

-- ARCHIVED ENTITIES CANNOT BE ASSIGNED TO NEW PRODUCTS
CREATE OR REPLACE FUNCTION public.block_archived_brand()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.brand_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.brand_id IS DISTINCT FROM OLD.brand_id) THEN
    IF EXISTS (SELECT 1 FROM public.brands WHERE id = NEW.brand_id AND status = 'archived') THEN
      RAISE EXCEPTION 'Archived brands cannot be assigned to products';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER products_block_archived_brand BEFORE INSERT OR UPDATE OF brand_id ON public.products
FOR EACH ROW EXECUTE FUNCTION public.block_archived_brand();

CREATE OR REPLACE FUNCTION public.block_archived_category()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.categories WHERE id = NEW.category_id AND status = 'archived') THEN
    RAISE EXCEPTION 'Archived categories cannot be assigned to products';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER product_categories_block_archived BEFORE INSERT OR UPDATE OF category_id ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.block_archived_category();

-- UPDATED_AT TRIGGERS (reuse existing function)
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER product_variants_set_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS POLICIES (uniform pattern across commerce tables)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','brands','products','product_categories','product_variants','product_relationships','product_media'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()))', t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_manage_commerce(auth.uid()))', t||'_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_manage_commerce(auth.uid())) WITH CHECK (public.can_manage_commerce(auth.uid()))', t||'_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin(auth.uid()))', t||'_delete', t);
  END LOOP;
END $$;