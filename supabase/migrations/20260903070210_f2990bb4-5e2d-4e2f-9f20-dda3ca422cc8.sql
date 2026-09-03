-- ============ enums ============
create type public.store_product_status as enum ('draft','active','archived');
create type public.store_product_visibility as enum ('hidden','visible');
create type public.channel_listing_status as enum ('not_published','publishing','published','sync_failed','archived');
create type public.channel_listing_event_type as enum (
  'listing_created','listing_updated','listing_publish_requested','listing_published','listing_sync_failed','listing_archived'
);

-- ============ store_products ============
create table public.store_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  status public.store_product_status not null default 'draft',
  visibility public.store_product_visibility not null default 'hidden',
  selling_price numeric(12,2) not null check (selling_price >= 0),
  store_sku text,
  title_override text,
  description_override text,
  activated_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_products_unique_product unique (store_id, product_id)
);
create unique index store_products_store_sku_idx
  on public.store_products (store_id, lower(store_sku))
  where store_sku is not null and status <> 'archived';
create index store_products_store_status_idx on public.store_products (store_id, status);
create index store_products_product_idx on public.store_products (product_id);

grant select on public.store_products to authenticated;
grant all on public.store_products to service_role;
alter table public.store_products enable row level security;
create policy "Commerce readers can view store products" on public.store_products
  for select to authenticated using (public.can_read_commerce(auth.uid()));

-- ============ price history (append only) ============
create table public.store_product_price_history (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id) on delete restrict,
  previous_price numeric(12,2),
  new_price numeric(12,2) not null,
  reason text,
  changed_by uuid,
  created_at timestamptz not null default now()
);
create index store_product_price_history_idx
  on public.store_product_price_history (store_product_id, created_at desc);

grant select on public.store_product_price_history to authenticated;
grant all on public.store_product_price_history to service_role;
alter table public.store_product_price_history enable row level security;
create policy "Commerce readers can view store price history" on public.store_product_price_history
  for select to authenticated using (public.can_read_commerce(auth.uid()));

-- ============ channel listings ============
create table public.sales_channel_product_listings (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id) on delete restrict,
  sales_channel_account_id uuid not null references public.sales_channel_accounts(id) on delete restrict,
  external_product_id text,
  external_variant_reference text,
  external_sku text,
  external_url text,
  listing_status public.channel_listing_status not null default 'not_published',
  last_synced_at timestamptz,
  last_sync_error text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_listing_unique_pair unique (store_product_id, sales_channel_account_id)
);
create unique index channel_listing_external_idx
  on public.sales_channel_product_listings (sales_channel_account_id, external_product_id)
  where external_product_id is not null;

grant select on public.sales_channel_product_listings to authenticated;
grant all on public.sales_channel_product_listings to service_role;
alter table public.sales_channel_product_listings enable row level security;
create policy "Commerce readers can view channel listings" on public.sales_channel_product_listings
  for select to authenticated using (public.can_read_commerce(auth.uid()));

create table public.channel_listing_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.sales_channel_product_listings(id) on delete restrict,
  event_type public.channel_listing_event_type not null,
  status_from public.channel_listing_status,
  status_to public.channel_listing_status,
  message text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index channel_listing_events_idx on public.channel_listing_events (listing_id, created_at desc);

grant select on public.channel_listing_events to authenticated;
grant all on public.channel_listing_events to service_role;
alter table public.channel_listing_events enable row level security;
create policy "Commerce readers can view listing events" on public.channel_listing_events
  for select to authenticated using (public.can_read_commerce(auth.uid()));

-- ============ write guards ============
create or replace function public.guard_store_catalog_write()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.catalog_write', true), 'off') <> 'on' then
    raise exception 'Direct changes to % are not allowed — use the controlled store catalog operations', tg_table_name;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger guard_store_products_write before insert or update or delete on public.store_products
  for each row execute function public.guard_store_catalog_write();
create trigger guard_channel_listings_write before insert or update or delete on public.sales_channel_product_listings
  for each row execute function public.guard_store_catalog_write();

create or replace function public.guard_catalog_history_append_only()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception '% is append-only', tg_table_name;
  end if;
  if coalesce(current_setting('app.catalog_write', true), 'off') <> 'on' then
    raise exception 'Direct changes to % are not allowed — use the controlled store catalog operations', tg_table_name;
  end if;
  return new;
end $$;

create trigger guard_price_history before insert or update or delete on public.store_product_price_history
  for each row execute function public.guard_catalog_history_append_only();
create trigger guard_listing_events before insert or update or delete on public.channel_listing_events
  for each row execute function public.guard_catalog_history_append_only();

create trigger store_products_updated_at before update on public.store_products
  for each row execute function public.set_updated_at();
create trigger channel_listings_updated_at before update on public.sales_channel_product_listings
  for each row execute function public.set_updated_at();

-- ============ derived availability ============
create or replace function public.store_product_available_qty(_product_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(greatest(l.available_quantity,0)),0)::numeric
    from public.inventory_levels l where l.product_id = _product_id;
$$;

-- ============ controlled operations ============
create or replace function public.add_product_to_store(
  _store_id uuid, _product_id uuid, _selling_price numeric default null, _store_sku text default null
) returns public.store_products
language plpgsql security definer set search_path to 'public' as $$
declare _row public.store_products; _p public.products; _s public.stores; _price numeric;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'You are not permitted to manage the store catalog';
  end if;
  select * into _s from public.stores where id = _store_id for update;
  if _s.id is null then raise exception 'Store not found'; end if;
  if _s.status = 'archived' then raise exception 'This store is archived'; end if;
  select * into _p from public.products where id = _product_id for update;
  if _p.id is null then raise exception 'Product not found'; end if;
  if _p.status = 'archived' then raise exception 'This product is archived'; end if;

  _price := coalesce(_selling_price, _p.price);
  if _price is null then
    raise exception 'A selling price is required — this product has no master price';
  end if;
  if _price < 0 then raise exception 'Selling price cannot be negative'; end if;

  perform set_config('app.catalog_write','on',true);
  insert into public.store_products (store_id, product_id, selling_price, store_sku, created_by, updated_by)
  values (_store_id, _product_id, round(_price,2), nullif(btrim(coalesce(_store_sku,'')),''), auth.uid(), auth.uid())
  returning * into _row;

  insert into public.store_product_price_history (store_product_id, previous_price, new_price, reason, changed_by)
  values (_row.id, null, _row.selling_price, 'Added to store', auth.uid());

  return _row;
exception when unique_violation then
  raise exception 'This product is already in the store catalog';
end $$;

create or replace function public.update_store_product(_id uuid, _payload jsonb)
returns public.store_products
language plpgsql security definer set search_path to 'public' as $$
declare _row public.store_products;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'You are not permitted to manage the store catalog';
  end if;
  select * into _row from public.store_products where id = _id for update;
  if _row.id is null then raise exception 'Store product not found'; end if;
  if _row.status = 'archived' then raise exception 'Archived store products cannot be changed'; end if;

  perform set_config('app.catalog_write','on',true);
  update public.store_products set
    store_sku = case when _payload ? 'store_sku' then nullif(btrim(coalesce(_payload->>'store_sku','')),'') else store_sku end,
    title_override = case when _payload ? 'title_override' then nullif(btrim(coalesce(_payload->>'title_override','')),'') else title_override end,
    description_override = case when _payload ? 'description_override' then nullif(btrim(coalesce(_payload->>'description_override','')),'') else description_override end,
    visibility = case when _payload ? 'visibility' then (_payload->>'visibility')::public.store_product_visibility else visibility end,
    updated_by = auth.uid()
  where id = _id returning * into _row;
  return _row;
exception when unique_violation then
  raise exception 'Another active product in this store already uses that store SKU';
end $$;

create or replace function public.set_store_product_price(_id uuid, _price numeric, _reason text default null)
returns public.store_products
language plpgsql security definer set search_path to 'public' as $$
declare _row public.store_products; _prev numeric;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'You are not permitted to manage the store catalog';
  end if;
  if _price is null or _price < 0 then raise exception 'Selling price must be zero or more'; end if;
  select * into _row from public.store_products where id = _id for update;
  if _row.id is null then raise exception 'Store product not found'; end if;
  if _row.status = 'archived' then raise exception 'Archived store products cannot be repriced'; end if;
  _prev := _row.selling_price;
  if round(_price,2) = _prev then return _row; end if;

  perform set_config('app.catalog_write','on',true);
  update public.store_products set selling_price = round(_price,2), updated_by = auth.uid()
  where id = _id returning * into _row;
  insert into public.store_product_price_history (store_product_id, previous_price, new_price, reason, changed_by)
  values (_id, _prev, _row.selling_price, nullif(btrim(coalesce(_reason,'')),''), auth.uid());
  return _row;
end $$;

create or replace function public.activate_store_product(_id uuid)
returns public.store_products
language plpgsql security definer set search_path to 'public' as $$
declare _row public.store_products; _p public.products;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'You are not permitted to manage the store catalog';
  end if;
  select * into _row from public.store_products where id = _id for update;
  if _row.id is null then raise exception 'Store product not found'; end if;
  if _row.status = 'active' then return _row; end if;
  if _row.status <> 'draft' then raise exception 'Only a draft store product can be activated'; end if;

  select * into _p from public.products where id = _row.product_id;
  if _p.status = 'archived' then raise exception 'The master product is archived'; end if;
  if not coalesce(_p.is_purchasable,false) then raise exception 'The master product is not purchasable'; end if;
  if _row.selling_price is null or _row.selling_price <= 0 then
    raise exception 'Set a valid selling price before activating';
  end if;

  perform set_config('app.catalog_write','on',true);
  update public.store_products set status = 'active', activated_at = now(), updated_by = auth.uid()
  where id = _id returning * into _row;
  return _row;
end $$;

create or replace function public.archive_store_product(_id uuid)
returns public.store_products
language plpgsql security definer set search_path to 'public' as $$
declare _row public.store_products;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can archive a store product';
  end if;
  select * into _row from public.store_products where id = _id for update;
  if _row.id is null then raise exception 'Store product not found'; end if;
  if _row.status = 'archived' then return _row; end if;

  perform set_config('app.catalog_write','on',true);
  update public.store_products set status='archived', visibility='hidden', archived_at=now(), updated_by=auth.uid()
  where id = _id returning * into _row;

  insert into public.channel_listing_events (listing_id, event_type, status_to, message, created_by)
  select id, 'listing_archived', 'archived', 'Store product archived', auth.uid()
    from public.sales_channel_product_listings where store_product_id = _id and listing_status <> 'archived';

  update public.sales_channel_product_listings
     set listing_status='archived', updated_by=auth.uid()
   where store_product_id = _id and listing_status <> 'archived';
  return _row;
end $$;

-- ============ channel listings ============
create or replace function public.create_or_update_channel_listing(_store_product_id uuid, _account_id uuid, _payload jsonb default '{}'::jsonb)
returns public.sales_channel_product_listings
language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_product_listings; _sp public.store_products; _acc public.sales_channel_accounts; _new boolean := false;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can manage channel listings';
  end if;
  select * into _sp from public.store_products where id = _store_product_id for update;
  if _sp.id is null then raise exception 'Store product not found'; end if;
  if _sp.status = 'archived' then raise exception 'Archived store products cannot be listed'; end if;
  select * into _acc from public.sales_channel_accounts where id = _account_id;
  if _acc.id is null then raise exception 'Sales channel not found'; end if;
  if _acc.store_id <> _sp.store_id then raise exception 'That sales channel belongs to a different store'; end if;
  if _acc.provider = 'manual' then raise exception 'The internal channel does not use external listings'; end if;

  perform set_config('app.catalog_write','on',true);
  select * into _row from public.sales_channel_product_listings
   where store_product_id = _store_product_id and sales_channel_account_id = _account_id for update;

  if _row.id is null then
    insert into public.sales_channel_product_listings (
      store_product_id, sales_channel_account_id, external_product_id, external_variant_reference,
      external_sku, external_url, created_by, updated_by
    ) values (
      _store_product_id, _account_id,
      nullif(btrim(coalesce(_payload->>'external_product_id','')),''),
      nullif(btrim(coalesce(_payload->>'external_variant_reference','')),''),
      nullif(btrim(coalesce(_payload->>'external_sku','')),''),
      nullif(btrim(coalesce(_payload->>'external_url','')),''),
      auth.uid(), auth.uid()
    ) returning * into _row;
    _new := true;
  else
    update public.sales_channel_product_listings set
      external_product_id = case when _payload ? 'external_product_id' then nullif(btrim(coalesce(_payload->>'external_product_id','')),'') else external_product_id end,
      external_variant_reference = case when _payload ? 'external_variant_reference' then nullif(btrim(coalesce(_payload->>'external_variant_reference','')),'') else external_variant_reference end,
      external_sku = case when _payload ? 'external_sku' then nullif(btrim(coalesce(_payload->>'external_sku','')),'') else external_sku end,
      external_url = case when _payload ? 'external_url' then nullif(btrim(coalesce(_payload->>'external_url','')),'') else external_url end,
      updated_by = auth.uid()
    where id = _row.id returning * into _row;
  end if;

  insert into public.channel_listing_events (listing_id, event_type, status_to, created_by)
  values (_row.id, case when _new then 'listing_created' else 'listing_updated' end, _row.listing_status, auth.uid());
  return _row;
exception when unique_violation then
  raise exception 'That external listing is already mapped on this channel';
end $$;

create or replace function public.set_channel_listing_status(_listing_id uuid, _status public.channel_listing_status, _message text default null)
returns public.sales_channel_product_listings
language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_product_listings; _from public.channel_listing_status; _ok boolean;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can manage channel listings';
  end if;
  select * into _row from public.sales_channel_product_listings where id = _listing_id for update;
  if _row.id is null then raise exception 'Listing not found'; end if;
  _from := _row.listing_status;
  if _from = _status then return _row; end if;

  _ok := (_from = 'not_published' and _status = 'publishing')
      or (_from = 'publishing' and _status in ('published','sync_failed'))
      or (_from = 'sync_failed' and _status = 'publishing')
      or (_from = 'published' and _status = 'archived')
      or (_status = 'archived' and _from in ('not_published','sync_failed'));
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
    last_sync_error = case when _status = 'sync_failed' then left(coalesce(nullif(btrim(coalesce(_message,'')),''),'Synchronisation failed'),300) else null end,
    updated_by = auth.uid()
  where id = _listing_id returning * into _row;

  insert into public.channel_listing_events (listing_id, event_type, status_from, status_to, message, created_by)
  values (_listing_id,
    case _status when 'publishing' then 'listing_publish_requested'
                 when 'published' then 'listing_published'
                 when 'sync_failed' then 'listing_sync_failed'
                 when 'archived' then 'listing_archived'
                 else 'listing_updated' end,
    _from, _status, left(nullif(btrim(coalesce(_message,'')),''),300), auth.uid());
  return _row;
end $$;

-- ============ reads ============
create or replace function public.store_catalog_list(
  _store_id uuid,
  _search text default null,
  _status public.store_product_status default null,
  _visibility public.store_product_visibility default null,
  _category_id uuid default null,
  _stock text default null,
  _channel_id uuid default null,
  _limit integer default 50,
  _offset integer default 0
) returns table (
  id uuid, product_id uuid, product_name text, master_sku text, store_sku text,
  category_name text, selling_price numeric, status public.store_product_status,
  visibility public.store_product_visibility, is_purchasable boolean,
  available_qty numeric, listing_count integer, published_count integer,
  updated_at timestamptz, total_count bigint
)
language sql stable security invoker set search_path to 'public' as $$
  with base as (
    select sp.id, sp.product_id, p.name as product_name, p.sku as master_sku, sp.store_sku,
           (select c.name from public.product_categories pc join public.categories c on c.id = pc.category_id
             where pc.product_id = p.id order by pc.is_primary desc nulls last limit 1) as category_name,
           sp.selling_price, sp.status, sp.visibility, coalesce(p.is_purchasable,false) as is_purchasable,
           public.store_product_available_qty(sp.product_id) as available_qty,
           (select count(*) from public.sales_channel_product_listings l where l.store_product_id = sp.id)::int as listing_count,
           (select count(*) from public.sales_channel_product_listings l where l.store_product_id = sp.id and l.listing_status = 'published')::int as published_count,
           sp.updated_at
      from public.store_products sp
      join public.products p on p.id = sp.product_id
     where sp.store_id = _store_id
       and (_status is null or sp.status = _status)
       and (_visibility is null or sp.visibility = _visibility)
       and (_search is null or btrim(_search) = '' or p.name ilike '%'||btrim(_search)||'%'
            or p.sku ilike '%'||btrim(_search)||'%' or sp.store_sku ilike '%'||btrim(_search)||'%')
       and (_category_id is null or exists (
             select 1 from public.product_categories pc where pc.product_id = p.id and pc.category_id = _category_id))
       and (_channel_id is null or exists (
             select 1 from public.sales_channel_product_listings l
              where l.store_product_id = sp.id and l.sales_channel_account_id = _channel_id))
  ), filtered as (
    select * from base
     where _stock is null or _stock = ''
        or (_stock = 'in_stock' and available_qty > 0)
        or (_stock = 'out_of_stock' and available_qty <= 0)
  )
  select f.*, (select count(*) from filtered) as total_count
    from filtered f
   order by f.product_name
   limit greatest(coalesce(_limit,50),1) offset greatest(coalesce(_offset,0),0);
$$;

create or replace function public.store_catalog_summary(_store_id uuid)
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where sp.status = 'active'),
    'draft', count(*) filter (where sp.status = 'draft'),
    'archived', count(*) filter (where sp.status = 'archived'),
    'visible', count(*) filter (where sp.visibility = 'visible' and sp.status = 'active'),
    'out_of_stock', count(*) filter (where sp.status = 'active' and public.store_product_available_qty(sp.product_id) <= 0)
  ) from public.store_products sp where sp.store_id = _store_id;
$$;

create or replace function public.product_store_assignments(_product_id uuid)
returns table (
  id uuid, store_id uuid, store_name text, store_code text,
  status public.store_product_status, visibility public.store_product_visibility,
  selling_price numeric, available_qty numeric, listing_count integer, updated_at timestamptz
)
language sql stable security invoker set search_path to 'public' as $$
  select sp.id, s.id, s.name, s.code, sp.status, sp.visibility, sp.selling_price,
         public.store_product_available_qty(sp.product_id),
         (select count(*) from public.sales_channel_product_listings l where l.store_product_id = sp.id)::int,
         sp.updated_at
    from public.store_products sp join public.stores s on s.id = sp.store_id
   where sp.product_id = _product_id
   order by s.name;
$$;

revoke all on function public.guard_store_catalog_write() from public;
revoke all on function public.guard_catalog_history_append_only() from public;
revoke all on function public.store_product_available_qty(uuid) from public;
revoke all on function public.add_product_to_store(uuid,uuid,numeric,text) from public;
revoke all on function public.update_store_product(uuid,jsonb) from public;
revoke all on function public.set_store_product_price(uuid,numeric,text) from public;
revoke all on function public.activate_store_product(uuid) from public;
revoke all on function public.archive_store_product(uuid) from public;
revoke all on function public.create_or_update_channel_listing(uuid,uuid,jsonb) from public;
revoke all on function public.set_channel_listing_status(uuid,public.channel_listing_status,text) from public;
revoke all on function public.store_catalog_list(uuid,text,public.store_product_status,public.store_product_visibility,uuid,text,uuid,integer,integer) from public;
revoke all on function public.store_catalog_summary(uuid) from public;
revoke all on function public.product_store_assignments(uuid) from public;

grant execute on function public.store_product_available_qty(uuid) to authenticated;
grant execute on function public.add_product_to_store(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.update_store_product(uuid,jsonb) to authenticated;
grant execute on function public.set_store_product_price(uuid,numeric,text) to authenticated;
grant execute on function public.activate_store_product(uuid) to authenticated;
grant execute on function public.archive_store_product(uuid) to authenticated;
grant execute on function public.create_or_update_channel_listing(uuid,uuid,jsonb) to authenticated;
grant execute on function public.set_channel_listing_status(uuid,public.channel_listing_status,text) to authenticated;
grant execute on function public.store_catalog_list(uuid,text,public.store_product_status,public.store_product_visibility,uuid,text,uuid,integer,integer) to authenticated;
grant execute on function public.store_catalog_summary(uuid) to authenticated;
grant execute on function public.product_store_assignments(uuid) to authenticated;