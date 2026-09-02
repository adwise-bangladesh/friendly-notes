DROP POLICY IF EXISTS product_categories_delete ON public.product_categories;
CREATE POLICY product_categories_delete ON public.product_categories
  FOR DELETE TO authenticated USING (public.can_manage_commerce(auth.uid()));

DROP POLICY IF EXISTS product_media_delete ON public.product_media;
CREATE POLICY product_media_delete ON public.product_media
  FOR DELETE TO authenticated USING (public.can_manage_commerce(auth.uid()));

DROP POLICY IF EXISTS product_variants_delete ON public.product_variants;
CREATE POLICY product_variants_delete ON public.product_variants
  FOR DELETE TO authenticated USING (public.can_manage_commerce(auth.uid()));

DROP POLICY IF EXISTS product_relationships_delete ON public.product_relationships;
CREATE POLICY product_relationships_delete ON public.product_relationships
  FOR DELETE TO authenticated USING (public.can_manage_commerce(auth.uid()));