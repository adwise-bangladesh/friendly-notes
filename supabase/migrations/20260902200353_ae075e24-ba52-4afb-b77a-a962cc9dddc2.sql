-- ============ enums ============
create type public.store_status as enum ('active','inactive','archived');
create type public.sales_channel_provider as enum ('manual','woocommerce','shopify','custom_api','facebook','tiktok','daraz','other');
create type public.sales_channel_status as enum ('active','disabled','error','disconnected');
create type public.sales_channel_environment as enum ('production','sandbox');
create type public.sales_channel_sync_type as enum ('orders','products','customers','full');
create type public.sales_channel_sync_status as enum ('pending','running','completed','failed','partial');
create type public.external_entity_type as enum ('order','product','variant','customer');

-- ============ stores ============
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  code text not null,
  status public.store_status not null default 'active',
  currency text not null default 'BDT',
  timezone text not null default 'Asia/Dhaka',
  country text not null default 'BD',
  order_number_prefix text,
  default_warehouse_id uuid references public.inventory_locations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_name_not_blank check (btrim(name) <> ''),
  constraint stores_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint stores_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,15}$'),
  constraint stores_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint stores_country_format check (country ~ '^[A-Z]{2}$')
);
create unique index stores_slug_key on public.stores (slug);
create unique index stores_code_key on public.stores (code);
create index stores_status_idx on public.stores (status);

grant select on public.stores to authenticated;
grant all on public.stores to service_role;
alter table public.stores enable row level security;
create policy "stores_read" on public.stores for select to authenticated
  using (public.can_read_commerce(auth.uid()));

-- ============ sales channel accounts ============
create table public.sales_channel_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  provider public.sales_channel_provider not null,
  name text not null,
  status public.sales_channel_status not null default 'disconnected',
  environment public.sales_channel_environment not null default 'production',
  external_store_id text,
  external_store_name text,
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_channel_accounts_name_not_blank check (btrim(name) <> '')
);
create unique index sales_channel_accounts_store_name_key
  on public.sales_channel_accounts (store_id, provider, lower(btrim(name)));
-- exactly one manual/internal channel per store
create unique index sales_channel_accounts_manual_key
  on public.sales_channel_accounts (store_id) where provider = 'manual';
create index sales_channel_accounts_store_idx on public.sales_channel_accounts (store_id);

grant select on public.sales_channel_accounts to authenticated;
grant all on public.sales_channel_accounts to service_role;
alter table public.sales_channel_accounts enable row level security;
create policy "sales_channel_accounts_read" on public.sales_channel_accounts for select to authenticated
  using (public.can_read_commerce(auth.uid()));

-- ============ credentials (server only, never readable by the app) ============
create table public.sales_channel_credentials (
  account_id uuid primary key references public.sales_channel_accounts(id) on delete cascade,
  site_url text,
  consumer_key text,
  consumer_secret text,
  api_version text not null default 'wc/v3',
  webhook_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on public.sales_channel_credentials from anon, authenticated;
grant all on public.sales_channel_credentials to service_role;
alter table public.sales_channel_credentials enable row level security;
-- intentionally no policy: only the service role / SECURITY DEFINER functions may touch it

-- ============ external entity mappings ============
create table public.external_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  sales_channel_account_id uuid not null references public.sales_channel_accounts(id) on delete cascade,
  entity_type public.external_entity_type not null,
  internal_id uuid not null,
  external_id text not null,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_entity_mappings_external_id_not_blank check (btrim(external_id) <> '')
);
-- external ids are unique only WITHIN a channel account + entity type
create unique index external_entity_mappings_external_key
  on public.external_entity_mappings (sales_channel_account_id, entity_type, external_id);
create unique index external_entity_mappings_internal_key
  on public.external_entity_mappings (sales_channel_account_id, entity_type, internal_id);

grant select on public.external_entity_mappings to authenticated;
grant all on public.external_entity_mappings to service_role;
alter table public.external_entity_mappings enable row level security;
create policy "external_entity_mappings_read" on public.external_entity_mappings for select to authenticated
  using (public.can_read_commerce(auth.uid()));

-- ============ sync runs ============
create table public.sales_channel_sync_runs (
  id uuid primary key default gen_random_uuid(),
  sales_channel_account_id uuid not null references public.sales_channel_accounts(id) on delete cascade,
  sync_type public.sales_channel_sync_type not null,
  status public.sales_channel_sync_status not null default 'pending',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  records_fetched integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  records_skipped integer not null default 0,
  records_failed integer not null default 0,
  error_summary text,
  initiated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sales_channel_sync_runs_counts_positive check (
    records_fetched >= 0 and records_created >= 0 and records_updated >= 0
    and records_skipped >= 0 and records_failed >= 0
  )
);
create index sales_channel_sync_runs_account_idx
  on public.sales_channel_sync_runs (sales_channel_account_id, started_at desc);

grant select on public.sales_channel_sync_runs to authenticated;
grant all on public.sales_channel_sync_runs to service_role;
alter table public.sales_channel_sync_runs enable row level security;
create policy "sales_channel_sync_runs_read" on public.sales_channel_sync_runs for select to authenticated
  using (public.can_read_commerce(auth.uid()));

-- ============ orders.store_id (non destructive: historical orders stay NULL) ============
alter table public.orders add column store_id uuid references public.stores(id) on delete set null;
create index orders_store_idx on public.orders (store_id);

-- ============ write guards: everything goes through controlled functions ============
create or replace function public.guard_sales_channel_write()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.channel_write', true), 'off') <> 'on' then
    raise exception 'Direct changes to % are not allowed — use the controlled store/channel operations', tg_table_name;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger guard_stores_write before insert or update or delete on public.stores
  for each row execute function public.guard_sales_channel_write();
create trigger guard_channel_accounts_write before insert or update or delete on public.sales_channel_accounts
  for each row execute function public.guard_sales_channel_write();
create trigger guard_channel_credentials_write before insert or update or delete on public.sales_channel_credentials
  for each row execute function public.guard_sales_channel_write();
create trigger guard_channel_mappings_write before insert or update or delete on public.external_entity_mappings
  for each row execute function public.guard_sales_channel_write();

-- sync history is append oriented: a finished run can never be rewritten or removed
create or replace function public.guard_sync_run_history()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.channel_write', true), 'off') <> 'on' then
    raise exception 'Sync history can only be written by the controlled sync operations';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Sync history cannot be deleted';
  end if;
  if tg_op = 'UPDATE' and old.status in ('completed','failed','partial') then
    raise exception 'A finished sync run cannot be modified — start a new run instead';
  end if;
  return new;
end; $$;

create trigger guard_sync_runs_history before insert or update or delete on public.sales_channel_sync_runs
  for each row execute function public.guard_sync_run_history();

revoke all on function public.guard_sales_channel_write() from anon, authenticated;
revoke all on function public.guard_sync_run_history() from anon, authenticated;

-- ============ controlled operations ============
create or replace function public.save_store(_payload jsonb)
returns public.stores language plpgsql security definer set search_path to 'public' as $$
declare _row public.stores; _id uuid := nullif(_payload->>'id','')::uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can manage stores';
  end if;
  perform set_config('app.channel_write','on',true);

  if _id is null then
    insert into public.stores (
      name, slug, code, status, currency, timezone, country,
      order_number_prefix, default_warehouse_id, created_by, updated_by
    ) values (
      btrim(_payload->>'name'),
      lower(btrim(_payload->>'slug')),
      upper(btrim(_payload->>'code')),
      coalesce((_payload->>'status')::public.store_status, 'active'),
      coalesce(nullif(upper(btrim(coalesce(_payload->>'currency',''))),''), 'BDT'),
      coalesce(nullif(btrim(coalesce(_payload->>'timezone','')),''), 'Asia/Dhaka'),
      coalesce(nullif(upper(btrim(coalesce(_payload->>'country',''))),''), 'BD'),
      nullif(btrim(coalesce(_payload->>'order_number_prefix','')),''),
      nullif(_payload->>'default_warehouse_id','')::uuid,
      auth.uid(), auth.uid()
    ) returning * into _row;

    -- every store owns an internal channel for manually created orders
    insert into public.sales_channel_accounts (store_id, provider, name, status, created_by, updated_by)
    values (_row.id, 'manual', 'Manual / Internal', 'active', auth.uid(), auth.uid());
  else
    update public.stores set
      name = coalesce(nullif(btrim(coalesce(_payload->>'name','')),''), name),
      slug = coalesce(nullif(lower(btrim(coalesce(_payload->>'slug',''))),''), slug),
      code = coalesce(nullif(upper(btrim(coalesce(_payload->>'code',''))),''), code),
      currency = coalesce(nullif(upper(btrim(coalesce(_payload->>'currency',''))),''), currency),
      timezone = coalesce(nullif(btrim(coalesce(_payload->>'timezone','')),''), timezone),
      country = coalesce(nullif(upper(btrim(coalesce(_payload->>'country',''))),''), country),
      order_number_prefix = case when _payload ? 'order_number_prefix'
        then nullif(btrim(coalesce(_payload->>'order_number_prefix','')),'') else order_number_prefix end,
      default_warehouse_id = case when _payload ? 'default_warehouse_id'
        then nullif(_payload->>'default_warehouse_id','')::uuid else default_warehouse_id end,
      updated_by = auth.uid(),
      updated_at = now()
    where id = _id returning * into _row;
    if _row.id is null then raise exception 'Store not found'; end if;
  end if;

  perform set_config('app.channel_write','off',true);
  return _row;
end; $$;

create or replace function public.set_store_status(_store_id uuid, _status public.store_status)
returns public.stores language plpgsql security definer set search_path to 'public' as $$
declare _row public.stores;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can change a store status';
  end if;
  perform set_config('app.channel_write','on',true);
  update public.stores set status = _status, updated_by = auth.uid(), updated_at = now()
   where id = _store_id returning * into _row;
  perform set_config('app.channel_write','off',true);
  if _row.id is null then raise exception 'Store not found'; end if;
  return _row;
end; $$;

create or replace function public.save_sales_channel_account(_payload jsonb)
returns public.sales_channel_accounts language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_accounts; _id uuid := nullif(_payload->>'id','')::uuid;
        _provider public.sales_channel_provider;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can manage sales channels';
  end if;
  perform set_config('app.channel_write','on',true);

  if _id is null then
    _provider := (_payload->>'provider')::public.sales_channel_provider;
    if _provider not in ('manual','woocommerce') then
      raise exception 'The % channel is planned but not available yet', _provider;
    end if;
    insert into public.sales_channel_accounts (
      store_id, provider, name, environment, external_store_id, external_store_name,
      status, created_by, updated_by
    ) values (
      (_payload->>'store_id')::uuid,
      _provider,
      btrim(_payload->>'name'),
      coalesce((_payload->>'environment')::public.sales_channel_environment, 'production'),
      nullif(btrim(coalesce(_payload->>'external_store_id','')),''),
      nullif(btrim(coalesce(_payload->>'external_store_name','')),''),
      case when _provider = 'manual' then 'active'::public.sales_channel_status
           else 'disconnected'::public.sales_channel_status end,
      auth.uid(), auth.uid()
    ) returning * into _row;
  else
    update public.sales_channel_accounts set
      name = coalesce(nullif(btrim(coalesce(_payload->>'name','')),''), name),
      environment = coalesce((_payload->>'environment')::public.sales_channel_environment, environment),
      external_store_id = case when _payload ? 'external_store_id'
        then nullif(btrim(coalesce(_payload->>'external_store_id','')),'') else external_store_id end,
      external_store_name = case when _payload ? 'external_store_name'
        then nullif(btrim(coalesce(_payload->>'external_store_name','')),'') else external_store_name end,
      updated_by = auth.uid(), updated_at = now()
    where id = _id returning * into _row;
    if _row.id is null then raise exception 'Sales channel not found'; end if;
  end if;

  perform set_config('app.channel_write','off',true);
  return _row;
end; $$;

create or replace function public.set_sales_channel_account_state(
  _account_id uuid,
  _status public.sales_channel_status,
  _error text default null,
  _touch_sync boolean default false,
  _successful boolean default false
) returns public.sales_channel_accounts
language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_accounts;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to change a sales channel';
  end if;
  if _status in ('disabled') and not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can disable a sales channel';
  end if;
  perform set_config('app.channel_write','on',true);
  update public.sales_channel_accounts set
    status = _status,
    last_error = left(_error, 500),
    last_sync_at = case when _touch_sync then now() else last_sync_at end,
    last_successful_sync_at = case when _touch_sync and _successful then now() else last_successful_sync_at end,
    updated_by = auth.uid(), updated_at = now()
  where id = _account_id returning * into _row;
  perform set_config('app.channel_write','off',true);
  if _row.id is null then raise exception 'Sales channel not found'; end if;
  return _row;
end; $$;

-- credentials in, never out
create or replace function public.set_sales_channel_credentials(
  _account_id uuid,
  _site_url text,
  _consumer_key text,
  _consumer_secret text,
  _api_version text default 'wc/v3',
  _webhook_secret text default null
) returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can manage channel credentials';
  end if;
  if not exists (select 1 from public.sales_channel_accounts where id = _account_id) then
    raise exception 'Sales channel not found';
  end if;
  perform set_config('app.channel_write','on',true);
  insert into public.sales_channel_credentials (
    account_id, site_url, consumer_key, consumer_secret, api_version, webhook_secret
  ) values (
    _account_id, btrim(_site_url), btrim(_consumer_key), btrim(_consumer_secret),
    coalesce(nullif(btrim(coalesce(_api_version,'')),''),'wc/v3'),
    nullif(btrim(coalesce(_webhook_secret,'')),'')
  )
  on conflict (account_id) do update set
    site_url = excluded.site_url,
    consumer_key = excluded.consumer_key,
    consumer_secret = excluded.consumer_secret,
    api_version = excluded.api_version,
    webhook_secret = coalesce(excluded.webhook_secret, public.sales_channel_credentials.webhook_secret),
    updated_at = now();
  perform set_config('app.channel_write','off',true);
  return true;
end; $$;

-- safe indicator only — never the values
create or replace function public.sales_channel_credentials_status(_account_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_credentials;
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted';
  end if;
  select * into _row from public.sales_channel_credentials where account_id = _account_id;
  return jsonb_build_object(
    'configured', _row.account_id is not null
      and coalesce(_row.consumer_key,'') <> '' and coalesce(_row.consumer_secret,'') <> '',
    'site_url', _row.site_url,
    'api_version', _row.api_version,
    'updated_at', _row.updated_at
  );
end; $$;

create or replace function public.upsert_external_mapping(
  _account_id uuid,
  _entity_type public.external_entity_type,
  _internal_id uuid,
  _external_id text,
  _external_reference text default null
) returns public.external_entity_mappings
language plpgsql security definer set search_path to 'public' as $$
declare _row public.external_entity_mappings;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to map external records';
  end if;
  perform set_config('app.channel_write','on',true);
  insert into public.external_entity_mappings (
    sales_channel_account_id, entity_type, internal_id, external_id, external_reference
  ) values (_account_id, _entity_type, _internal_id, btrim(_external_id),
            nullif(btrim(coalesce(_external_reference,'')),''))
  on conflict (sales_channel_account_id, entity_type, external_id) do update set
    external_reference = coalesce(excluded.external_reference, public.external_entity_mappings.external_reference),
    updated_at = now()
  returning * into _row;
  perform set_config('app.channel_write','off',true);
  return _row;
end; $$;

create or replace function public.start_sync_run(
  _account_id uuid,
  _sync_type public.sales_channel_sync_type
) returns public.sales_channel_sync_runs
language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_sync_runs; _account public.sales_channel_accounts;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to run a synchronisation';
  end if;
  select * into _account from public.sales_channel_accounts where id = _account_id;
  if _account.id is null then raise exception 'Sales channel not found'; end if;
  if _account.status = 'disabled' then raise exception 'This sales channel is disabled'; end if;
  if exists (select 1 from public.stores s where s.id = _account.store_id and s.status <> 'active') then
    raise exception 'The store is not active';
  end if;

  perform set_config('app.channel_write','on',true);
  insert into public.sales_channel_sync_runs (sales_channel_account_id, sync_type, status, initiated_by)
  values (_account_id, _sync_type, 'running', auth.uid())
  returning * into _row;
  perform set_config('app.channel_write','off',true);
  return _row;
end; $$;

create or replace function public.finish_sync_run(
  _run_id uuid,
  _status public.sales_channel_sync_status,
  _fetched integer default 0,
  _created integer default 0,
  _updated integer default 0,
  _skipped integer default 0,
  _failed integer default 0,
  _error_summary text default null
) returns public.sales_channel_sync_runs
language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_sync_runs;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to close a synchronisation';
  end if;
  if _status not in ('completed','failed','partial') then
    raise exception 'A sync run can only finish as completed, failed or partial';
  end if;
  perform set_config('app.channel_write','on',true);
  update public.sales_channel_sync_runs set
    status = _status,
    completed_at = now(),
    records_fetched = greatest(coalesce(_fetched,0),0),
    records_created = greatest(coalesce(_created,0),0),
    records_updated = greatest(coalesce(_updated,0),0),
    records_skipped = greatest(coalesce(_skipped,0),0),
    records_failed = greatest(coalesce(_failed,0),0),
    error_summary = left(_error_summary, 2000)
  where id = _run_id and status = 'running'
  returning * into _row;
  perform set_config('app.channel_write','off',true);
  if _row.id is null then raise exception 'No running sync run to finish'; end if;
  return _row;
end; $$;

-- attaches an order to a store; never re-classifies an order that already has one
create or replace function public.set_order_store(_order_id uuid, _store_id uuid)
returns public.orders language plpgsql security definer set search_path to 'public' as $$
declare _row public.orders;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to change an order';
  end if;
  if not exists (select 1 from public.stores where id = _store_id and status = 'active') then
    raise exception 'Store not found or not active';
  end if;
  perform set_config('app.order_write','on',true);
  update public.orders set store_id = _store_id, updated_by = auth.uid(), updated_at = now()
   where id = _order_id and store_id is null
  returning * into _row;
  perform set_config('app.order_write','off',true);
  if _row.id is null then
    raise exception 'Order not found or already assigned to a store';
  end if;
  return _row;
end; $$;

-- compact list for the stores workspace
create or replace function public.store_list()
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'code', s.code, 'status', s.status,
      'currency', s.currency, 'timezone', s.timezone, 'country', s.country,
      'created_at', s.created_at,
      'channel_count', (select count(*) from public.sales_channel_accounts a where a.store_id = s.id),
      'order_count', (select count(*) from public.orders o where o.store_id = s.id),
      'last_sync_at', (select max(a.last_sync_at) from public.sales_channel_accounts a where a.store_id = s.id)
    ) as t
    from public.stores s
  ) x;
$$;

revoke all on function public.save_store(jsonb) from anon;
revoke all on function public.set_store_status(uuid, public.store_status) from anon;
revoke all on function public.save_sales_channel_account(jsonb) from anon;
revoke all on function public.set_sales_channel_account_state(uuid, public.sales_channel_status, text, boolean, boolean) from anon;
revoke all on function public.set_sales_channel_credentials(uuid, text, text, text, text, text) from anon;
revoke all on function public.sales_channel_credentials_status(uuid) from anon;
revoke all on function public.upsert_external_mapping(uuid, public.external_entity_type, uuid, text, text) from anon;
revoke all on function public.start_sync_run(uuid, public.sales_channel_sync_type) from anon;
revoke all on function public.finish_sync_run(uuid, public.sales_channel_sync_status, integer, integer, integer, integer, integer, text) from anon;
revoke all on function public.set_order_store(uuid, uuid) from anon;
revoke all on function public.store_list() from anon;