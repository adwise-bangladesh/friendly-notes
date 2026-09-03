-- ============ enum extensions ============
alter type public.channel_listing_status add value if not exists 'ready' after 'not_published';
alter type public.channel_listing_status add value if not exists 'update_pending' after 'published';
alter type public.channel_listing_status add value if not exists 'syncing' after 'update_pending';
alter type public.channel_listing_status add value if not exists 'paused' after 'sync_failed';

alter type public.channel_listing_event_type add value if not exists 'listing_readiness_checked';
alter type public.channel_listing_event_type add value if not exists 'listing_publish_started';
alter type public.channel_listing_event_type add value if not exists 'listing_publish_failed';
alter type public.channel_listing_event_type add value if not exists 'listing_product_synced';
alter type public.channel_listing_event_type add value if not exists 'listing_price_synced';
alter type public.channel_listing_event_type add value if not exists 'listing_stock_synced';
alter type public.channel_listing_event_type add value if not exists 'listing_status_refreshed';
alter type public.channel_listing_event_type add value if not exists 'listing_external_missing';
alter type public.channel_listing_event_type add value if not exists 'listing_paused';
alter type public.channel_listing_event_type add value if not exists 'listing_unpublished';
alter type public.channel_listing_event_type add value if not exists 'listing_sync_started';

alter type public.sales_channel_sync_type add value if not exists 'listing_publish';
alter type public.sales_channel_sync_type add value if not exists 'listing_update';
alter type public.sales_channel_sync_type add value if not exists 'price_sync';
alter type public.sales_channel_sync_type add value if not exists 'stock_sync';
alter type public.sales_channel_sync_type add value if not exists 'status_refresh';
alter type public.sales_channel_sync_type add value if not exists 'unpublish';

-- ============ listing sync bookkeeping ============
alter table public.sales_channel_product_listings
  add column if not exists last_operation text,
  add column if not exists last_success_at timestamptz,
  add column if not exists synced_price numeric(12,2),
  add column if not exists synced_qty numeric(12,2),
  add column if not exists sync_started_at timestamptz;

alter table public.sales_channel_sync_runs
  add column if not exists listing_id uuid references public.sales_channel_product_listings(id) on delete restrict;

create index if not exists idx_sync_runs_listing on public.sales_channel_sync_runs(listing_id, started_at desc);

-- one external product per channel account (idempotency guard)
create unique index if not exists uq_listing_external_product
  on public.sales_channel_product_listings(sales_channel_account_id, external_product_id)
  where external_product_id is not null;

-- ============ authoritative effective product resolver ============
create or replace function public.effective_store_product_data(_store_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _sp public.store_products; _p public.products; _qty numeric;
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted to read the store catalog';
  end if;
  select * into _sp from public.store_products where id = _store_product_id;
  if _sp.id is null then raise exception 'Store product not found'; end if;
  select * into _p from public.products where id = _sp.product_id;
  if _p.id is null then raise exception 'Master product not found'; end if;
  _qty := public.store_product_available_qty(_sp.product_id);

  return jsonb_build_object(
    'store_product_id', _sp.id,
    'store_id', _sp.store_id,
    'product_id', _p.id,
    'title', coalesce(nullif(btrim(coalesce(_sp.title_override,'')),''), _p.name),
    'description', coalesce(nullif(btrim(coalesce(_sp.description_override,'')),''), _p.description, _p.short_description),
    'sku', coalesce(nullif(btrim(coalesce(_sp.store_sku,'')),''), _p.sku),
    'price', _sp.selling_price,
    'status', _sp.status,
    'visibility', _sp.visibility,
    'available_qty', _qty,
    'is_purchasable', _p.is_purchasable,
    'master_status', _p.status,
    'requires_shipping', _p.requires_shipping,
    'weight', _p.weight
  );
end $$;

-- ============ backend-authoritative readiness ============
create or replace function public.channel_listing_readiness(_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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

  if _sp.status <> 'active' then _blocking := _blocking || 'The store product is not active'; end if;
  if _sp.status = 'archived' then _blocking := _blocking || 'The store product is archived'; end if;
  if coalesce(_p.is_purchasable,false) is not true then _blocking := _blocking || 'The master product is not purchasable'; end if;
  if _p.status <> 'active' then _blocking := _blocking || 'The master product is not active'; end if;
  if coalesce(btrim(_title),'') = '' then _blocking := _blocking || 'A product title is required'; end if;
  if coalesce(_sp.selling_price,0) <= 0 then _blocking := _blocking || 'A selling price is required'; end if;
  if coalesce(btrim(coalesce(_sku,'')),'') = '' then _blocking := _blocking || 'A SKU is required by this channel'; end if;
  if _acc.status <> 'active' then _blocking := _blocking || 'The sales channel is not active'; end if;
  if _acc.provider = 'manual' then _blocking := _blocking || 'The internal channel does not publish products'; end if;
  if _store.status <> 'active' then _blocking := _blocking || 'The store is not active'; end if;
  if _row.listing_status = 'archived' then _blocking := _blocking || 'The listing is archived'; end if;

  if coalesce(btrim(coalesce(_sp.description_override, _p.description, '')),'') = '' then
    _warnings := _warnings || 'No product description is set';
  end if;
  if _qty <= 0 then _warnings := _warnings || 'No inventory is available for sale'; end if;
  if _sp.visibility <> 'visible' then _warnings := _warnings || 'The store product is hidden in the store'; end if;

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
end $$;

-- ============ controlled state transitions ============
create or replace function public.set_channel_listing_status(_listing_id uuid, _status channel_listing_status, _message text default null)
returns sales_channel_product_listings
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.sales_channel_product_listings; _from public.channel_listing_status; _ok boolean;
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

  insert into public.channel_listing_events (listing_id, event_type, status_from, status_to, message, created_by)
  values (_listing_id,
    case _status when 'publishing' then 'listing_publish_requested'
                 when 'syncing' then 'listing_sync_started'
                 when 'published' then 'listing_published'
                 when 'sync_failed' then 'listing_sync_failed'
                 when 'paused' then 'listing_paused'
                 when 'not_published' then 'listing_unpublished'
                 when 'archived' then 'listing_archived'
                 else 'listing_updated' end,
    _from, _status, left(nullif(btrim(coalesce(_message,'')),''),300), auth.uid());
  return _row;
end $$;

-- ============ operation lifecycle ============
create or replace function public.begin_listing_operation(_listing_id uuid, _operation sales_channel_sync_type)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.sales_channel_product_listings; _acc public.sales_channel_accounts;
        _run public.sales_channel_sync_runs; _target public.channel_listing_status; _from public.channel_listing_status;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to synchronise channel listings';
  end if;
  if _operation not in ('listing_publish','listing_update','price_sync','stock_sync','status_refresh','unpublish') then
    raise exception 'Unsupported listing operation';
  end if;

  -- row lock: concurrent publish attempts serialise here
  select * into _row from public.sales_channel_product_listings where id = _listing_id for update;
  if _row.id is null then raise exception 'Listing not found'; end if;
  _from := _row.listing_status;
  if _from in ('publishing','syncing') then
    raise exception 'A synchronisation is already running for this listing';
  end if;
  if _from = 'archived' then raise exception 'This listing is archived'; end if;

  select * into _acc from public.sales_channel_accounts where id = _row.sales_channel_account_id;
  if _acc.status = 'disabled' then raise exception 'This sales channel is disabled'; end if;

  if _operation = 'listing_publish' then
    if coalesce(_row.external_product_id,'') <> '' then
      raise exception 'This listing already has an external product — use an update instead';
    end if;
    if _from = 'not_published' then
      perform public.set_channel_listing_status(_listing_id, 'ready', 'Readiness confirmed');
    end if;
    _target := 'publishing';
  elsif _operation = 'unpublish' then
    _target := null;
  elsif _operation = 'status_refresh' then
    _target := null;
  else
    if coalesce(_row.external_product_id,'') = '' then
      raise exception 'This listing has not been published yet';
    end if;
    if _from = 'published' then
      perform public.set_channel_listing_status(_listing_id, 'update_pending', 'Change detected');
    end if;
    if _from = 'paused' then
      raise exception 'This listing is paused';
    end if;
    _target := 'syncing';
  end if;

  if _target is not null then
    perform public.set_channel_listing_status(_listing_id, _target, null);
  end if;

  perform set_config('app.channel_write','on',true);
  insert into public.sales_channel_sync_runs (sales_channel_account_id, sync_type, status, initiated_by, listing_id)
  values (_row.sales_channel_account_id, _operation, 'running', auth.uid(), _listing_id)
  returning * into _run;
  perform set_config('app.channel_write','off',true);

  perform set_config('app.catalog_write','on',true);
  update public.sales_channel_product_listings set last_operation = _operation::text, updated_by = auth.uid()
  where id = _listing_id;

  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  return jsonb_build_object('run_id', _run.id, 'listing', to_jsonb(_row), 'previous_status', _from);
end $$;

create or replace function public.finish_listing_operation(
  _run_id uuid,
  _listing_id uuid,
  _operation sales_channel_sync_type,
  _ok boolean,
  _message text default null,
  _external_product_id text default null,
  _external_url text default null,
  _synced_price numeric default null,
  _synced_qty numeric default null,
  _external_missing boolean default false
)
returns sales_channel_product_listings
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.sales_channel_product_listings; _event public.channel_listing_event_type;
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

  perform set_config('app.channel_write','on',true);
  update public.sales_channel_sync_runs set
    status = case when _ok then 'completed' else 'failed' end,
    completed_at = now(),
    records_fetched = 1,
    records_updated = case when _ok and _operation <> 'listing_publish' then 1 else 0 end,
    records_created = case when _ok and _operation = 'listing_publish' then 1 else 0 end,
    records_failed = case when _ok then 0 else 1 end,
    error_summary = case when _ok then null else left(_message, 2000) end
  where id = _run_id and status = 'running';
  perform set_config('app.channel_write','off',true);

  return _row;
end $$;

-- ============ readiness audit event ============
create or replace function public.record_listing_readiness_check(_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _result jsonb; _row public.sales_channel_product_listings;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to check listing readiness';
  end if;
  _result := public.channel_listing_readiness(_listing_id);
  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  insert into public.channel_listing_events (listing_id, event_type, status_to, message, created_by)
  values (_listing_id, 'listing_readiness_checked', _row.listing_status,
    case when (_result->>'ready')::boolean then 'Ready to publish'
         else left('Blocked: ' || coalesce(array_to_string(array(select jsonb_array_elements_text(_result->'blocking')), '; '),''), 300) end,
    auth.uid());
  return _result;
end $$;

-- ============ listing workspace read ============
create or replace function public.store_channel_listings(
  _store_id uuid,
  _search text default null,
  _channel_id uuid default null,
  _status channel_listing_status default null,
  _health text default null,
  _limit integer default 50,
  _offset integer default 0
)
returns table (
  id uuid,
  store_product_id uuid,
  product_id uuid,
  product_name text,
  store_sku text,
  selling_price numeric,
  store_product_status store_product_status,
  channel_id uuid,
  channel_name text,
  provider sales_channel_provider,
  channel_status sales_channel_status,
  listing_status channel_listing_status,
  external_product_id text,
  external_url text,
  last_synced_at timestamptz,
  last_success_at timestamptz,
  last_sync_error text,
  available_qty numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with base as (
    select l.id, l.store_product_id, sp.product_id, p.name as product_name,
           coalesce(nullif(btrim(coalesce(sp.store_sku,'')),''), p.sku) as store_sku,
           sp.selling_price, sp.status as store_product_status,
           a.id as channel_id, a.name as channel_name, a.provider, a.status as channel_status,
           l.listing_status, l.external_product_id, l.external_url,
           l.last_synced_at, l.last_success_at, l.last_sync_error,
           public.store_product_available_qty(sp.product_id) as available_qty
      from public.sales_channel_product_listings l
      join public.store_products sp on sp.id = l.store_product_id
      join public.products p on p.id = sp.product_id
      join public.sales_channel_accounts a on a.id = l.sales_channel_account_id
     where sp.store_id = _store_id
       and (_channel_id is null or a.id = _channel_id)
       and (_status is null or l.listing_status = _status)
       and (_search is null or btrim(_search) = '' or p.name ilike '%'||btrim(_search)||'%'
            or coalesce(sp.store_sku,'') ilike '%'||btrim(_search)||'%'
            or coalesce(p.sku,'') ilike '%'||btrim(_search)||'%')
       and (_health is null
            or (_health = 'healthy' and l.last_sync_error is null)
            or (_health = 'failing' and l.last_sync_error is not null)
            or (_health = 'never_synced' and l.last_success_at is null))
  )
  select b.*, (select count(*) from base) as total_count
    from base b
   order by b.product_name, b.channel_name
   limit greatest(coalesce(_limit,50),1) offset greatest(coalesce(_offset,0),0);
$$;

revoke all on function public.effective_store_product_data(uuid) from anon;
revoke all on function public.channel_listing_readiness(uuid) from anon;
revoke all on function public.record_listing_readiness_check(uuid) from anon;
revoke all on function public.begin_listing_operation(uuid, sales_channel_sync_type) from anon;
revoke all on function public.finish_listing_operation(uuid, uuid, sales_channel_sync_type, boolean, text, text, text, numeric, numeric, boolean) from anon;
revoke all on function public.store_channel_listings(uuid, text, uuid, channel_listing_status, text, integer, integer) from anon;