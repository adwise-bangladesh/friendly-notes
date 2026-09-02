ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compare_at_price numeric(12,2);

ALTER TABLE public.products
  ADD CONSTRAINT products_price_non_negative CHECK (price >= 0),
  ADD CONSTRAINT products_compare_at_price_non_negative CHECK (compare_at_price IS NULL OR compare_at_price >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_key
  ON public.products (lower(sku)) WHERE sku IS NOT NULL;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS price numeric(12,2),
  ADD COLUMN IF NOT EXISTS compare_at_price numeric(12,2);

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_price_non_negative CHECK (price IS NULL OR price >= 0),
  ADD CONSTRAINT product_variants_compare_at_price_non_negative CHECK (compare_at_price IS NULL OR compare_at_price >= 0);

-- self-relationship guard already exists