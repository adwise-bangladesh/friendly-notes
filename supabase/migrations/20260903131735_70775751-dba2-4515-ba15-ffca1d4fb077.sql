CREATE OR REPLACE FUNCTION public.set_store_status(_store_id uuid, _status store_status)
 RETURNS stores
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.stores; _prev public.store_status;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can change a store status';
  end if;
  select status into _prev from public.stores where id = _store_id;
  if _prev is null then raise exception 'Store not found'; end if;

  perform set_config('app.channel_write','on',true);
  update public.stores set status = _status, updated_by = auth.uid(), updated_at = now()
   where id = _store_id returning * into _row;
  perform set_config('app.channel_write','off',true);

  if _status = 'archived' and _prev <> 'archived' then
    -- queued work for an archived store can never run: cancel it explicitly
    perform set_config('app.sync_job_write','on',true);
    update public.sales_channel_sync_jobs
       set status = 'cancelled', completed_at = now(),
           last_error = 'Store archived', lease_token = null, lease_expires_at = null
     where store_id = _store_id and status in ('pending','retry_wait');
    perform set_config('app.sync_job_write','off',true);

    -- published listings stay externally live until an unpublish actually runs;
    -- locally they are paused so the store no longer looks operationally publishing.
    perform set_config('app.catalog_write','on',true);

    insert into public.channel_listing_events (listing_id, event_type, status_from, status_to, message, created_by)
    select l.id, 'listing_paused', l.listing_status, 'paused',
           'Store archived — local publishing paused (the external listing was not removed)', auth.uid()
      from public.sales_channel_product_listings l
      join public.store_products sp on sp.id = l.store_product_id
     where sp.store_id = _store_id and l.listing_status in ('published','update_pending','sync_failed');

    update public.sales_channel_product_listings l
       set listing_status = 'paused', updated_by = auth.uid()
      from public.store_products sp
     where sp.id = l.store_product_id and sp.store_id = _store_id
       and l.listing_status in ('published','update_pending','sync_failed');

    perform set_config('app.catalog_write','off',true);
  end if;

  return _row;
end $function$;

REVOKE ALL ON FUNCTION public.set_store_status(uuid, store_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_status(uuid, store_status) TO authenticated, service_role;