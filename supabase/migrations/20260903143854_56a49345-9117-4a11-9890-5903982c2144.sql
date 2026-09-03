DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO def FROM pg_proc WHERE proname = 'save_product_catalog';
  def := replace(def, '::public.weight_unit', '::text');
  def := replace(def, '::public.dimension_unit', '::text');
  EXECUTE def;
END $$;