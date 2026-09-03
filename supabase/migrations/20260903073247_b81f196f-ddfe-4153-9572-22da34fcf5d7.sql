CREATE OR REPLACE FUNCTION public.create_or_update_channel_listing(_store_product_id uuid, _account_id uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS public.sales_channel_product_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _row public.sales_channel_product_listings;
  _sp public.store_products;
  _acct public.sales_channel_accounts;
  _new boolean := false;
BEGIN
  IF NOT public.can_manage_commerce() THEN
    RAISE EXCEPTION 'Not authorized to manage channel listings';
  END IF;

  SELECT * INTO _sp FROM public.store_products WHERE id = _store_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store product not found'; END IF;
  IF _sp.status = 'archived' THEN RAISE EXCEPTION 'Archived store products cannot be listed on a channel'; END IF;

  SELECT * INTO _acct FROM public.sales_channel_accounts WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales channel not found'; END IF;
  IF _acct.store_id <> _sp.store_id THEN RAISE EXCEPTION 'Sales channel belongs to a different store'; END IF;

  SELECT * INTO _row FROM public.sales_channel_product_listings
   WHERE store_product_id = _store_product_id AND sales_channel_account_id = _account_id FOR UPDATE;

  IF NOT FOUND THEN
    _new := true;
    INSERT INTO public.sales_channel_product_listings (
      store_product_id, sales_channel_account_id, external_product_id,
      external_variant_reference, external_sku, external_url, listing_status, created_by, updated_by
    ) VALUES (
      _store_product_id, _account_id,
      nullif(btrim(coalesce(_payload->>'external_product_id','')),''),
      nullif(btrim(coalesce(_payload->>'external_variant_reference','')),''),
      nullif(btrim(coalesce(_payload->>'external_sku','')),''),
      nullif(btrim(coalesce(_payload->>'external_url','')),''),
      'not_published', auth.uid(), auth.uid()
    ) RETURNING * INTO _row;
  ELSE
    UPDATE public.sales_channel_product_listings SET
      external_product_id = coalesce(nullif(btrim(coalesce(_payload->>'external_product_id','')),''), external_product_id),
      external_variant_reference = coalesce(nullif(btrim(coalesce(_payload->>'external_variant_reference','')),''), external_variant_reference),
      external_sku = coalesce(nullif(btrim(coalesce(_payload->>'external_sku','')),''), external_sku),
      external_url = coalesce(nullif(btrim(coalesce(_payload->>'external_url','')),''), external_url),
      updated_by = auth.uid(), updated_at = now()
    WHERE id = _row.id RETURNING * INTO _row;
  END IF;

  INSERT INTO public.channel_listing_events (listing_id, event_type, status_to, created_by)
  VALUES (
    _row.id,
    (CASE WHEN _new THEN 'listing_created' ELSE 'listing_updated' END)::public.channel_listing_event_type,
    _row.listing_status,
    auth.uid()
  );

  RETURN _row;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.create_or_update_channel_listing(uuid, uuid, jsonb) FROM anon;