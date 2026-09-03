create or replace function public.set_channel_listing_status(_listing_id uuid, _status channel_listing_status, _message text default null)
returns sales_channel_product_listings
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.sales_channel_product_listings; _from public.channel_listing_status; _ok boolean;
        _event public.channel_listing_event_type;
begin
  if _status = 'archived' then
    if not public.is_admin(auth.uid()) then
      raise exception 'Only an administrator can archive a listing';
    end if;
  elsif not public.can_sync_channels() then
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

  _event := case
    when _status = 'published' then 'published'
    when _status = 'sync_failed' then 'sync_failed'
    when _status = 'archived' then 'archived'
    when _status = 'paused' then 'paused'
    when _status = 'not_published' then 'unpublished'
    else 'status_changed'
  end;

  insert into public.channel_listing_events (listing_id, event_type, message, created_by)
  values (_listing_id, _event, left(coalesce(nullif(btrim(coalesce(_message,'')),''), 'Listing status changed to ' || _status::text),300), auth.uid());
  perform set_config('app.catalog_write','off',true);

  return _row;
end $function$;

revoke execute on function public.set_channel_listing_status(uuid, channel_listing_status, text) from anon;