-- Storage policies for commerce-media (private bucket)
CREATE POLICY "commerce_media_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'commerce-media' AND public.can_read_commerce(auth.uid()));

CREATE POLICY "commerce_media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'commerce-media' AND public.can_manage_commerce(auth.uid()));

CREATE POLICY "commerce_media_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'commerce-media' AND public.can_manage_commerce(auth.uid()))
  WITH CHECK (bucket_id = 'commerce-media' AND public.can_manage_commerce(auth.uid()));

CREATE POLICY "commerce_media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'commerce-media' AND public.can_manage_commerce(auth.uid()));

-- Efficient product counts (single round trip, RLS-safe: only readable by commerce readers)
CREATE OR REPLACE FUNCTION public.category_product_counts()
RETURNS TABLE (category_id uuid, product_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pc.category_id, count(DISTINCT pc.product_id)
  FROM public.product_categories pc
  WHERE public.can_read_commerce(auth.uid())
  GROUP BY pc.category_id;
$$;

CREATE OR REPLACE FUNCTION public.brand_product_counts()
RETURNS TABLE (brand_id uuid, product_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.brand_id, count(*)
  FROM public.products p
  WHERE p.brand_id IS NOT NULL AND public.can_read_commerce(auth.uid())
  GROUP BY p.brand_id;
$$;

REVOKE ALL ON FUNCTION public.category_product_counts() FROM public, anon;
REVOKE ALL ON FUNCTION public.brand_product_counts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_product_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_product_counts() TO authenticated;