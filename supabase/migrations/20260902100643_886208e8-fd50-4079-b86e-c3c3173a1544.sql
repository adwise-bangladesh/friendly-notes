CREATE OR REPLACE FUNCTION public.category_product_counts()
RETURNS TABLE (category_id uuid, product_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pc.category_id, count(DISTINCT pc.product_id)
  FROM public.product_categories pc
  GROUP BY pc.category_id;
$$;

CREATE OR REPLACE FUNCTION public.brand_product_counts()
RETURNS TABLE (brand_id uuid, product_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.brand_id, count(*)
  FROM public.products p
  WHERE p.brand_id IS NOT NULL
  GROUP BY p.brand_id;
$$;