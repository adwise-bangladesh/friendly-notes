-- Does a variant carry operational or historical references?
CREATE OR REPLACE FUNCTION public.variant_has_history(_variant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.order_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.inventory_transfer_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.stocktake_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.supplier_products WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.bundle_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.inventory_levels WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.product_cost_history WHERE variant_id = _variant_id);
$$;
REVOKE ALL ON FUNCTION public.variant_has_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.variant_has_history(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_product_catalog(_product_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _slug text; _sku text; _type public.product_type; _status public.product_status;
  _price numeric; _base numeric; _add numeric;
  _cat jsonb; _v jsonb; _m jsonb; _r jsonb; _b jsonb;
  _keep_variants uuid[] := '{}';
  _keep_media uuid[] := '{}';
  _vid uuid; _mid uuid; _i int; _j int;
  _removed text[] := '{}';
  _existing uuid;
  _archived int := 0; _deleted int := 0;
BEGIN
  IF _uid IS NULL OR NOT public.can_manage_commerce(_uid) THEN
    RAISE EXCEPTION 'You do not have permission to manage products.';
  END IF;

  /* ---------- Validation (nothing is written before this passes) ---------- */
  IF nullif(btrim(coalesce(_payload->>'name','')),'') IS NULL THEN
    RAISE EXCEPTION 'Product name is required.';
  END IF;
  _slug := nullif(btrim(coalesce(_payload->>'slug','')),'');
  IF _slug IS NULL THEN RAISE EXCEPTION 'A valid web address (slug) is required.'; END IF;
  _sku := nullif(btrim(coalesce(_payload->>'sku','')),'');
  _type := (_payload->>'product_type')::public.product_type;
  _status := (_payload->>'status')::public.product_status;
  _price := coalesce((_payload->>'price')::numeric, 0);
  _base := coalesce((_payload->>'base_cost')::numeric, 0);
  _add := coalesce((_payload->>'additional_cost')::numeric, 0);

  IF _price < 0 THEN RAISE EXCEPTION 'Regular selling price cannot be negative.'; END IF;
  IF _base < 0 OR _add < 0 THEN RAISE EXCEPTION 'Costs cannot be negative.'; END IF;
  IF (_payload->>'compare_at_price') IS NOT NULL
     AND (_payload->>'compare_at_price')::numeric < 0 THEN
    RAISE EXCEPTION 'Compare-at price cannot be negative.';
  END IF;

  IF _product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'This product no longer exists.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.products
              WHERE slug = _slug AND (_product_id IS NULL OR id <> _product_id)) THEN
    RAISE EXCEPTION 'The web address "%" is already used by another product.', _slug;
  END IF;
  IF _sku IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.products
        WHERE lower(sku) = lower(_sku) AND (_product_id IS NULL OR id <> _product_id)) THEN
    RAISE EXCEPTION 'The product code "%" is already used by another product.', _sku;
  END IF;

  IF (_payload->>'brand_id') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = (_payload->>'brand_id')::uuid) THEN
      RAISE EXCEPTION 'The selected brand no longer exists.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.brands
                WHERE id = (_payload->>'brand_id')::uuid AND status = 'archived') THEN
      RAISE EXCEPTION 'That brand is archived and cannot be assigned. Restore it or pick another brand.';
    END IF;
  END IF;

  -- Categories
  IF (SELECT count(*) FROM jsonb_array_elements(coalesce(_payload->'categories','[]'::jsonb)) c
       WHERE (c->>'is_primary')::boolean) > 1 THEN
    RAISE EXCEPTION 'Only one category can be the primary category.';
  END IF;
  IF (SELECT count(*) FROM (
        SELECT DISTINCT c->>'category_id' cid
          FROM jsonb_array_elements(coalesce(_payload->'categories','[]'::jsonb)) c) d)
     <> jsonb_array_length(coalesce(_payload->'categories','[]'::jsonb)) THEN
    RAISE EXCEPTION 'The same category cannot be added twice.';
  END IF;
  FOR _cat IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'categories','[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = (_cat->>'category_id')::uuid) THEN
      RAISE EXCEPTION 'One of the selected categories no longer exists.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.categories
                WHERE id = (_cat->>'category_id')::uuid AND status = 'archived') THEN
      RAISE EXCEPTION 'An archived category cannot be assigned to a product. Restore it or remove it from this product.';
    END IF;
  END LOOP;

  -- Media
  IF (SELECT count(*) FROM jsonb_array_elements(coalesce(_payload->'media','[]'::jsonb)) m
       WHERE (m->>'is_primary')::boolean) > 1 THEN
    RAISE EXCEPTION 'Only one image can be the main image.';
  END IF;

  -- Variants
  IF _type = 'variable' AND jsonb_array_length(coalesce(_payload->'variants','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A variable product needs at least one variant.';
  END IF;
  FOR _v IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'variants','[]'::jsonb)) LOOP
    IF nullif(btrim(coalesce(_v->>'title','')),'') IS NULL THEN
      RAISE EXCEPTION 'Every variant needs a name.';
    END IF;
    IF (_v->>'price') IS NOT NULL AND (_v->>'price')::numeric < 0 THEN
      RAISE EXCEPTION 'Variant "%" cannot have a negative price.', _v->>'title';
    END IF;
    IF (_v->>'base_cost') IS NOT NULL AND (_v->>'base_cost')::numeric < 0 THEN
      RAISE EXCEPTION 'Variant "%" cannot have a negative cost.', _v->>'title';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(coalesce(_v->'media','[]'::jsonb)) m
         WHERE (m->>'is_primary')::boolean) > 1 THEN
      RAISE EXCEPTION 'Variant "%" can only have one main image.', _v->>'title';
    END IF;
    -- Child ownership: a submitted variant id must belong to this product.
    IF (_v->>'key') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      _vid := (_v->>'key')::uuid;
      IF EXISTS (SELECT 1 FROM public.product_variants WHERE id = _vid)
         AND NOT EXISTS (SELECT 1 FROM public.product_variants
                          WHERE id = _vid AND product_id = _product_id) THEN
        RAISE EXCEPTION 'One of the submitted variants does not belong to this product.';
      END IF;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM (
        SELECT DISTINCT lower(btrim(v->>'sku')) s
          FROM jsonb_array_elements(coalesce(_payload->'variants','[]'::jsonb)) v
         WHERE nullif(btrim(coalesce(v->>'sku','')),'') IS NOT NULL) d)
     <> (SELECT count(*) FROM jsonb_array_elements(coalesce(_payload->'variants','[]'::jsonb)) v
          WHERE nullif(btrim(coalesce(v->>'sku','')),'') IS NOT NULL) THEN
    RAISE EXCEPTION 'Variant codes (SKU) must be unique within the product.';
  END IF;

  -- Variant SKUs must not collide with another product's variants
  FOR _v IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'variants','[]'::jsonb)) LOOP
    IF nullif(btrim(coalesce(_v->>'sku','')),'') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.product_variants pv
                    WHERE lower(pv.sku) = lower(btrim(_v->>'sku'))
                      AND pv.product_id IS DISTINCT FROM _product_id) THEN
      RAISE EXCEPTION 'The variant code "%" is already used by another product.', btrim(_v->>'sku');
    END IF;
  END LOOP;

  -- Relationships
  IF (SELECT count(*) FROM (
        SELECT DISTINCT (r->>'relationship_type')||':'||(r->>'related_product_id') k
          FROM jsonb_array_elements(coalesce(_payload->'relationships','[]'::jsonb)) r) d)
     <> jsonb_array_length(coalesce(_payload->'relationships','[]'::jsonb)) THEN
    RAISE EXCEPTION 'The same related product cannot be added twice.';
  END IF;

  -- Bundle contents
  IF _type = 'bundle' THEN
    IF (SELECT count(*) FROM (
          SELECT DISTINCT coalesce(b->>'variant_id', b->>'product_id') k
            FROM jsonb_array_elements(coalesce(_payload->'bundle_items','[]'::jsonb)) b) d)
       <> jsonb_array_length(coalesce(_payload->'bundle_items','[]'::jsonb)) THEN
      RAISE EXCEPTION 'The same item cannot be added to the bundle twice.';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_payload->'bundle_items','[]'::jsonb)) b
                WHERE coalesce((b->>'quantity')::int, 0) < 1) THEN
      RAISE EXCEPTION 'Bundle quantities must be at least 1.';
    END IF;
  END IF;

  /* ---------- Write (single transaction) ---------- */
  IF _product_id IS NULL THEN
    INSERT INTO public.products (
      name, slug, sku, barcode, short_description, description, brand_id,
      product_type, supply_model, status, visibility, featured, is_purchasable,
      price, compare_at_price, base_cost, additional_cost,
      weight, weight_unit, length, width, height, dimension_unit,
      requires_shipping, created_by, updated_by)
    VALUES (
      btrim(_payload->>'name'), _slug, _sku, nullif(btrim(coalesce(_payload->>'barcode','')),''),
      _payload->>'short_description', _payload->>'description',
      (_payload->>'brand_id')::uuid, _type, (_payload->>'supply_model')::public.supply_model,
      _status, (_payload->>'visibility')::public.entity_visibility,
      coalesce((_payload->>'featured')::boolean,false),
      coalesce((_payload->>'is_purchasable')::boolean,false),
      _price, (_payload->>'compare_at_price')::numeric, _base, _add,
      (_payload->>'weight')::numeric, (_payload->>'weight_unit')::public.weight_unit,
      (_payload->>'length')::numeric, (_payload->>'width')::numeric, (_payload->>'height')::numeric,
      (_payload->>'dimension_unit')::public.dimension_unit,
      coalesce((_payload->>'requires_shipping')::boolean,true), _uid, _uid)
    RETURNING id INTO _product_id;
  ELSE
    UPDATE public.products SET
      name = btrim(_payload->>'name'), slug = _slug, sku = _sku,
      barcode = nullif(btrim(coalesce(_payload->>'barcode','')),''),
      short_description = _payload->>'short_description',
      description = _payload->>'description',
      brand_id = (_payload->>'brand_id')::uuid,
      product_type = _type,
      supply_model = (_payload->>'supply_model')::public.supply_model,
      status = _status,
      visibility = (_payload->>'visibility')::public.entity_visibility,
      featured = coalesce((_payload->>'featured')::boolean,false),
      is_purchasable = coalesce((_payload->>'is_purchasable')::boolean,false),
      price = _price,
      compare_at_price = (_payload->>'compare_at_price')::numeric,
      base_cost = _base, additional_cost = _add,
      weight = (_payload->>'weight')::numeric,
      weight_unit = (_payload->>'weight_unit')::public.weight_unit,
      length = (_payload->>'length')::numeric,
      width = (_payload->>'width')::numeric,
      height = (_payload->>'height')::numeric,
      dimension_unit = (_payload->>'dimension_unit')::public.dimension_unit,
      requires_shipping = coalesce((_payload->>'requires_shipping')::boolean,true),
      updated_by = _uid
    WHERE id = _product_id;
  END IF;

  -- Categories (no history; safe to reconcile)
  DELETE FROM public.product_categories pc
   WHERE pc.product_id = _product_id
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(_payload->'categories','[]'::jsonb)) c
        WHERE (c->>'category_id')::uuid = pc.category_id);
  _i := 0;
  FOR _cat IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'categories','[]'::jsonb)) LOOP
    INSERT INTO public.product_categories (product_id, category_id, is_primary, sort_order)
    VALUES (_product_id, (_cat->>'category_id')::uuid,
            coalesce((_cat->>'is_primary')::boolean,false), _i)
    ON CONFLICT (product_id, category_id) DO UPDATE
      SET is_primary = EXCLUDED.is_primary, sort_order = EXCLUDED.sort_order;
    _i := _i + 1;
  END LOOP;

  -- Variants: ID-stable reconcile
  _i := 0;
  FOR _v IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'variants','[]'::jsonb)) LOOP
    _existing := NULL;
    IF (_v->>'key') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO _existing FROM public.product_variants
       WHERE id = (_v->>'key')::uuid AND product_id = _product_id;
    END IF;

    IF _existing IS NOT NULL THEN
      UPDATE public.product_variants SET
        title = btrim(_v->>'title'),
        sku = nullif(btrim(coalesce(_v->>'sku','')),''),
        barcode = nullif(btrim(coalesce(_v->>'barcode','')),''),
        price = (_v->>'price')::numeric,
        compare_at_price = (_v->>'compare_at_price')::numeric,
        base_cost = (_v->>'base_cost')::numeric,
        additional_cost = (_v->>'additional_cost')::numeric,
        weight = (_v->>'weight')::numeric,
        length = (_v->>'length')::numeric,
        width = (_v->>'width')::numeric,
        height = (_v->>'height')::numeric,
        status = coalesce((_v->>'status')::public.variant_status,'active'),
        sort_order = _i
      WHERE id = _existing;
      _vid := _existing;
    ELSE
      INSERT INTO public.product_variants (
        product_id, title, sku, barcode, price, compare_at_price, base_cost,
        additional_cost, weight, length, width, height, status, sort_order)
      VALUES (
        _product_id, btrim(_v->>'title'), nullif(btrim(coalesce(_v->>'sku','')),''),
        nullif(btrim(coalesce(_v->>'barcode','')),''),
        (_v->>'price')::numeric, (_v->>'compare_at_price')::numeric,
        (_v->>'base_cost')::numeric, (_v->>'additional_cost')::numeric,
        (_v->>'weight')::numeric, (_v->>'length')::numeric,
        (_v->>'width')::numeric, (_v->>'height')::numeric,
        coalesce((_v->>'status')::public.variant_status,'active'), _i)
      RETURNING id INTO _vid;
    END IF;
    _keep_variants := _keep_variants || _vid;

    -- Variant media, ID-stable
    _j := 0;
    _keep_media := '{}';
    FOR _m IN SELECT * FROM jsonb_array_elements(coalesce(_v->'media','[]'::jsonb)) LOOP
      _mid := NULL;
      IF (_m->>'key') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO _mid FROM public.product_media
         WHERE id = (_m->>'key')::uuid AND variant_id = _vid;
      END IF;
      IF _mid IS NOT NULL THEN
        UPDATE public.product_media
           SET url = _m->>'url', alt_text = _m->>'alt_text',
               is_primary = coalesce((_m->>'is_primary')::boolean,false), sort_order = _j
         WHERE id = _mid;
      ELSE
        INSERT INTO public.product_media (variant_id, product_id, url, alt_text, is_primary, sort_order)
        VALUES (_vid, NULL, _m->>'url', _m->>'alt_text',
                coalesce((_m->>'is_primary')::boolean,false), _j)
        RETURNING id INTO _mid;
      END IF;
      _keep_media := _keep_media || _mid;
      _j := _j + 1;
    END LOOP;

    SELECT _removed || coalesce(array_agg(url), '{}') INTO _removed
      FROM public.product_media
     WHERE variant_id = _vid AND NOT (id = ANY(_keep_media));
    DELETE FROM public.product_media WHERE variant_id = _vid AND NOT (id = ANY(_keep_media));

    _i := _i + 1;
  END LOOP;

  -- Variants removed from the editor: archive when they carry history, delete only when unused.
  FOR _vid IN SELECT id FROM public.product_variants
               WHERE product_id = _product_id AND NOT (id = ANY(_keep_variants)) LOOP
    IF public.variant_has_history(_vid) THEN
      UPDATE public.product_variants SET status = 'archived' WHERE id = _vid;
      _archived := _archived + 1;
    ELSE
      SELECT _removed || coalesce(array_agg(url), '{}') INTO _removed
        FROM public.product_media WHERE variant_id = _vid;
      DELETE FROM public.product_variants WHERE id = _vid;
      _deleted := _deleted + 1;
    END IF;
  END LOOP;

  -- Product-level media, ID-stable
  _keep_media := '{}';
  _j := 0;
  FOR _m IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'media','[]'::jsonb)) LOOP
    _mid := NULL;
    IF (_m->>'key') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO _mid FROM public.product_media
       WHERE id = (_m->>'key')::uuid AND product_id = _product_id;
    END IF;
    IF _mid IS NOT NULL THEN
      UPDATE public.product_media
         SET url = _m->>'url', alt_text = _m->>'alt_text',
             is_primary = coalesce((_m->>'is_primary')::boolean,false), sort_order = _j
       WHERE id = _mid;
    ELSE
      INSERT INTO public.product_media (product_id, variant_id, url, alt_text, is_primary, sort_order)
      VALUES (_product_id, NULL, _m->>'url', _m->>'alt_text',
              coalesce((_m->>'is_primary')::boolean,false), _j)
      RETURNING id INTO _mid;
    END IF;
    _keep_media := _keep_media || _mid;
    _j := _j + 1;
  END LOOP;

  SELECT _removed || coalesce(array_agg(url), '{}') INTO _removed
    FROM public.product_media
   WHERE product_id = _product_id AND NOT (id = ANY(_keep_media));
  DELETE FROM public.product_media
   WHERE product_id = _product_id AND NOT (id = ANY(_keep_media));

  -- Relationships (pure links, no history)
  DELETE FROM public.product_relationships WHERE product_id = _product_id;
  _i := 0;
  FOR _r IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'relationships','[]'::jsonb)) LOOP
    INSERT INTO public.product_relationships
      (product_id, related_product_id, relationship_type, sort_order)
    VALUES (_product_id, (_r->>'related_product_id')::uuid,
            (_r->>'relationship_type')::public.product_relationship_type, _i);
    _i := _i + 1;
  END LOOP;

  -- Bundle contents
  DELETE FROM public.bundle_items WHERE bundle_product_id = _product_id;
  IF _type = 'bundle' THEN
    _i := 0;
    FOR _b IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'bundle_items','[]'::jsonb)) LOOP
      INSERT INTO public.bundle_items
        (bundle_product_id, product_id, variant_id, quantity, sort_order)
      VALUES (_product_id,
              CASE WHEN (_b->>'variant_id') IS NULL THEN (_b->>'product_id')::uuid END,
              (_b->>'variant_id')::uuid,
              coalesce((_b->>'quantity')::int, 1), _i);
      _i := _i + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'product_id', _product_id,
    'archived_variants', _archived,
    'deleted_variants', _deleted,
    'removed_media', to_jsonb(coalesce(_removed, '{}'::text[])));
END; $$;

REVOKE ALL ON FUNCTION public.save_product_catalog(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_catalog(uuid, jsonb) TO authenticated, service_role;