CREATE OR REPLACE FUNCTION public.finish_listing_operation(_run_id uuid, _listing_id uuid, _operation sales_channel_sync_type, _ok boolean, _message text DEFAULT NULL::text, _external_product_id text DEFAULT NULL::text, _external_url text DEFAULT NULL::text, _synced_price numeric DEFAULT NULL::numeric, _synced_qty numeric DEFAULT NULL::numeric, _external_missing boolean DEFAULT false)
RETURNS sales_channel_product_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _row public.sales_channel_product_listings; _event public.channel_listing_event_type;
        _run_status public.sales_channel_sync_status;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to synchronise channel listings';
  end if;
  select * into _row from public.sales_channel_product_listings where id = _listing_id for update;
  if _row.id is null then raise exception 'Listing not found'; end if;

  if _ok and coalesce(btrim(coalesce(_external_product_id,'')),'') <> '' then
    perform set_config('app.catalog_write','on',true);
    update public.sales_channel_product_listings
      set external_product_id = btrim(_external_product_id),
          external_url = coalesce(nullif(btrim(coalesce(_external_url,'')),''), external_url),
          updated_by = auth.uid()
    where id = _listing_id returning * into _row;
  end if;

  if _ok then
    if _operation = 'unpublish' then
      perform public.set_channel_listing_status(_listing_id, 'not_published', _message);
    elsif _operation = 'status_refresh' then
      null;
    else
      perform public.set_channel_listing_status(_listing_id, 'published', _message);
    end if;
  else
    if _row.listing_status in ('publishing','syncing') then
      perform public.set_channel_listing_status(_listing_id, 'sync_failed', _message);
    end if;
  end if;

  perform set_config('app.catalog_write','on',true);
  update public.sales_channel_product_listings set
    synced_price = coalesce(_synced_price, synced_price),
    synced_qty = coalesce(_synced_qty, synced_qty),
    last_synced_at = now(),
    last_success_at = case when _ok then now() else last_success_at end,
    last_sync_error = case when _ok then null else left(coalesce(nullif(btrim(coalesce(_message,'')),''),'Synchronisation failed'),300) end,
    sync_started_at = null,
    updated_by = auth.uid()
  where id = _listing_id returning * into _row;

  _event := case
    when _external_missing then 'listing_external_missing'
    when not _ok then case when _operation = 'listing_publish' then 'listing_publish_failed' else 'listing_sync_failed' end
    when _operation = 'listing_publish' then 'listing_published'
    when _operation = 'listing_update' then 'listing_product_synced'
    when _operation = 'price_sync' then 'listing_price_synced'
    when _operation = 'stock_sync' then 'listing_stock_synced'
    when _operation = 'status_refresh' then 'listing_status_refreshed'
    when _operation = 'unpublish' then 'listing_unpublished'
    else 'listing_updated' end;

  insert into public.channel_listing_events (listing_id, event_type, status_to, message, created_by)
  values (_listing_id, _event, _row.listing_status, left(nullif(btrim(coalesce(_message,'')),''),300), auth.uid());

  _run_status := (case when _ok then 'completed' else 'failed' end)::public.sales_channel_sync_status;

  perform set_config('app.channel_write','on',true);
  update public.sales_channel_sync_runs set
    status = _run_status,
    completed_at = now(),
    records_fetched = 1,
    records_updated = case when _ok and _operation <> 'listing_publish' then 1 else 0 end,
    records_created = case when _ok and _operation = 'listing_publish' then 1 else 0 end,
    records_failed = case when _ok then 0 else 1 end,
    error_summary = case when _ok then null else left(_message, 2000) end
  where id = _run_id and status = 'running';
  perform set_config('app.channel_write','off',true);

  return _row;
end $function$;

REVOKE EXECUTE ON FUNCTION public.finish_listing_operation(uuid, uuid, sales_channel_sync_type, boolean, text, text, text, numeric, numeric, boolean) FROM anon;