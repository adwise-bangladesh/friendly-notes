CREATE OR REPLACE FUNCTION public.set_channel_listing_status(_listing_id uuid, _status channel_listing_status, _message text DEFAULT NULL::text)
RETURNS sales_channel_product_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _row public.sales_channel_product_listings; _from public.channel_listing_status; _ok boolean;
        _event public.channel_listing_event_type;
begin
  if _status = 'archived' then
    if not public.is_admin(auth.uid()) then
      raise exception 'Only an administrator can archive a listing';
    end if;
  elsif not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to manage channel listings';
  end if;

  select * into _row from public.sales_channel_product_listings where id = _listing_id for update;
  if _row.id is null then raise exception 'Listing not found'; end if;
  _from := _row.listing_status;
  if _from = _status then return _row; end if;

  _ok := (_from = 'not_published' and _status in ('ready','archived'))
      or (_from = 'ready' and _status in ('publishing','not_published','archived'))
      or (_from = 'publishing' and _status in ('published','sync_failed'))
      or (_from = 'published' and _status in ('update_pending','paused','not_published','archived'))
      or (_from = 'update_pending' and _status in ('syncing','published','paused','archived'))
      or (_from = 'syncing' and _status in ('published','sync_failed'))
      or (_from = 'sync_failed' and _status in ('publishing','syncing','ready','update_pending','not_published','archived'))
      or (_from = 'paused' and _status in ('ready','update_pending','not_published','archived'));
  if not _ok then
    raise exception 'Listing cannot move from % to %', _from, _status;
  end if;
  if _status = 'published' and coalesce(_row.external_product_id,'') = '' then
    raise exception 'An external product reference is required before a listing can be published';
  end if;

  perform set_config('app.catalog_write','on',true);
  update public.sales_channel_product_listings set
    listing_status = _status,
    last_synced_at = case when _status in ('published','sync_failed') then now() else last_synced_at end,
    last_success_at = case when _status = 'published' then now() else last_success_at end,
    sync_started_at = case when _status in ('publishing','syncing') then now() else null end,
    last_sync_error = case when _status = 'sync_failed'
      then left(coalesce(nullif(btrim(coalesce(_message,'')),''),'Synchronisation failed'),300) else null end,
    updated_by = auth.uid()
  where id = _listing_id returning * into _row;

  _event := case _status
    when 'publishing' then 'listing_publish_requested'
    when 'syncing' then 'listing_sync_started'
    when 'published' then 'listing_published'
    when 'sync_failed' then 'listing_sync_failed'
    when 'paused' then 'listing_paused'
    when 'not_published' then 'listing_unpublished'
    when 'archived' then 'listing_archived'
    else 'listing_updated' end;

  insert into public.channel_listing_events (listing_id, event_type, status_from, status_to, message, created_by)
  values (_listing_id, _event, _from, _status, left(nullif(btrim(coalesce(_message,'')),''),300), auth.uid());
  return _row;
end $function$;

REVOKE EXECUTE ON FUNCTION public.set_channel_listing_status(uuid, channel_listing_status, text) FROM anon;