CREATE OR REPLACE FUNCTION public.channel_listing_readiness(_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _row public.sales_channel_product_listings; _sp public.store_products; _p public.products;
        _acc public.sales_channel_accounts; _store public.stores;
        _blocking text[] := '{}'; _warnings text[] := '{}'; _qty numeric; _title text; _sku text;
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted to read the store catalog';
  end if;
  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  if _row.id is null then raise exception 'Listing not found'; end if;
  select * into _sp from public.store_products where id = _row.store_product_id;
  select * into _p from public.products where id = _sp.product_id;
  select * into _acc from public.sales_channel_accounts where id = _row.sales_channel_account_id;
  select * into _store from public.stores where id = _sp.store_id;

  _qty := public.store_product_available_qty(_sp.product_id);
  _title := coalesce(nullif(btrim(coalesce(_sp.title_override,'')),''), _p.name);
  _sku := coalesce(nullif(btrim(coalesce(_sp.store_sku,'')),''), _p.sku);

  if _sp.status = 'archived' then
    _blocking := array_append(_blocking, 'The store product is archived');
  elsif _sp.status <> 'active' then
    _blocking := array_append(_blocking, 'The store product is not active');
  end if;
  if coalesce(_p.is_purchasable,false) is not true then _blocking := array_append(_blocking, 'The master product is not purchasable'); end if;
  if _p.status <> 'active' then _blocking := array_append(_blocking, 'The master product is not active'); end if;
  if coalesce(btrim(coalesce(_title,'')),'') = '' then _blocking := array_append(_blocking, 'A product title is required'); end if;
  if coalesce(_sp.selling_price,0) <= 0 then _blocking := array_append(_blocking, 'A selling price is required'); end if;
  if coalesce(btrim(coalesce(_sku,'')),'') = '' then _blocking := array_append(_blocking, 'A SKU is required by this channel'); end if;
  if _acc.status <> 'active' then _blocking := array_append(_blocking, 'The sales channel is not active'); end if;
  if _acc.provider = 'manual' then _blocking := array_append(_blocking, 'The internal channel does not publish products'); end if;
  if _store.status <> 'active' then _blocking := array_append(_blocking, 'The store is not active'); end if;
  if _row.listing_status = 'archived' then _blocking := array_append(_blocking, 'The listing is archived'); end if;

  if coalesce(btrim(coalesce(_sp.description_override, _p.description, '')),'') = '' then
    _warnings := array_append(_warnings, 'No product description is set');
  end if;
  if _qty <= 0 then _warnings := array_append(_warnings, 'No inventory is available for sale'); end if;
  if _sp.visibility <> 'visible' then _warnings := array_append(_warnings, 'The store product is hidden in the store'); end if;

  return jsonb_build_object(
    'listing_id', _row.id,
    'ready', array_length(_blocking,1) is null,
    'blocking', to_jsonb(_blocking),
    'warnings', to_jsonb(_warnings),
    'provider', _acc.provider,
    'listing_status', _row.listing_status,
    'effective_title', _title,
    'effective_sku', _sku,
    'effective_price', _sp.selling_price,
    'available_qty', _qty,
    'external_product_id', _row.external_product_id
  );
end $function$;

REVOKE EXECUTE ON FUNCTION public.channel_listing_readiness(uuid) FROM anon;