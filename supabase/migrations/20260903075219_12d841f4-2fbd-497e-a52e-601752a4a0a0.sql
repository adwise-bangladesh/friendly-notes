-- ============================================================
-- STEP 18 — Background sync engine for sales channels
-- ============================================================

create type public.sync_job_status as enum
  ('pending','retry_wait','processing','succeeded','failed','cancelled','superseded');

create type public.sync_failure_class as enum ('transient','permanent','unknown');

-- Service-role (background worker) context detection -----------------------
create or replace function public.is_service_context()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  ) = 'service_role';
$$;

create or replace function public.can_sync_channels()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_service_context() or public.can_manage_commerce(auth.uid());
$$;

create or replace function public.can_read_channels()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_service_context() or public.can_read_commerce(auth.uid());
$$;

-- listings gain a content signature so we never push an unchanged product ---
alter table public.sales_channel_product_listings
  add column if not exists synced_content_hash text;

create or replace function public.listing_content_hash(_listing_id uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare _row public.sales_channel_product_listings; _sp public.store_products; _p public.products;
begin
  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  if _row.id is null then return null; end if;
  select * into _sp from public.store_products where id = _row.store_product_id;
  select * into _p from public.products where id = _sp.product_id;
  return md5(concat_ws('|',
    coalesce(nullif(btrim(coalesce(_sp.title_override,'')),''), _p.name),
    coalesce(nullif(btrim(coalesce(_sp.description_override,'')),''), _p.description, _p.short_description,''),
    coalesce(nullif(btrim(coalesce(_sp.store_sku,'')),''), _p.sku, ''),
    _sp.status::text, _sp.visibility::text, coalesce(_sp.selling_price,0)::text
  ));
end $$;

-- ============================================================
-- Queue table
-- ============================================================
create table public.sales_channel_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.sales_channel_product_listings(id) on delete cascade,
  sales_channel_account_id uuid not null references public.sales_channel_accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  operation public.sales_channel_sync_type not null,
  status public.sync_job_status not null default 'pending',
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  last_run_id uuid references public.sales_channel_sync_runs(id) on delete set null,
  last_error text,
  failure_class public.sync_failure_class,
  source text not null default 'manual',
  source_reference uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_job_operation_allowed
    check (operation in ('listing_update','price_sync','stock_sync','status_refresh')),
  constraint sync_job_attempts_bounded check (attempts >= 0 and max_attempts between 1 and 10)
);

grant select on public.sales_channel_sync_jobs to authenticated;
grant all on public.sales_channel_sync_jobs to service_role;

alter table public.sales_channel_sync_jobs enable row level security;

create policy "Commerce readers can read sync jobs"
  on public.sales_channel_sync_jobs for select to authenticated
  using (public.can_read_commerce(auth.uid()));

-- coalescing: at most one waiting job per listing + operation
create unique index sync_jobs_one_waiting
  on public.sales_channel_sync_jobs (listing_id, operation)
  where status in ('pending','retry_wait');

create index sync_jobs_claim_order
  on public.sales_channel_sync_jobs (status, available_at, priority);
create index sync_jobs_store_recent
  on public.sales_channel_sync_jobs (store_id, created_at desc);
create index sync_jobs_listing_recent
  on public.sales_channel_sync_jobs (listing_id, created_at desc);

create trigger sync_jobs_set_updated_at
  before update on public.sales_channel_sync_jobs
  for each row execute function public.set_updated_at();

-- no direct client writes: only the controlled functions below
create or replace function public.guard_sync_job_write()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.sync_job_write', true), 'off') <> 'on' then
    raise exception 'Sync jobs can only be changed through the synchronisation functions';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger sync_jobs_guard
  before insert or update or delete on public.sales_channel_sync_jobs
  for each row execute function public.guard_sync_job_write();

-- ============================================================
-- Centralised policy
-- ============================================================
create or replace function public.sync_job_backoff(_attempt integer)
returns interval language sql immutable set search_path to 'public' as $$
  select least(interval '30 minutes',
               make_interval(secs => 30 * power(3, greatest(_attempt,1) - 1)))
       + make_interval(secs => floor(random() * 10));
$$;

-- ============================================================
-- Enqueue (change-aware, coalescing, never auto-publishes)
-- ============================================================
create or replace function public.enqueue_listing_sync(
  _listing_id uuid,
  _operation public.sales_channel_sync_type,
  _source text default 'manual',
  _reference uuid default null,
  _priority integer default 100,
  _delay interval default interval '0'
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare _row public.sales_channel_product_listings; _acc public.sales_channel_accounts;
        _sp public.store_products; _store public.stores; _job_id uuid; _qty numeric;
begin
  if _operation not in ('listing_update','price_sync','stock_sync','status_refresh') then
    raise exception 'This operation cannot be queued for background synchronisation';
  end if;

  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  if _row.id is null then return null; end if;

  -- only already published listings are eligible; publishing stays manual
  if _row.listing_status not in ('published','update_pending','sync_failed') then return null; end if;
  if coalesce(btrim(coalesce(_row.external_product_id,'')),'') = '' then return null; end if;

  select * into _acc from public.sales_channel_accounts where id = _row.sales_channel_account_id;
  if _acc.id is null or _acc.status <> 'active' or _acc.provider = 'manual' then return null; end if;

  select * into _sp from public.store_products where id = _row.store_product_id;
  if _sp.id is null or _sp.status = 'archived' then return null; end if;
  select * into _store from public.stores where id = _sp.store_id;
  if _store.id is null or _store.status <> 'active' then return null; end if;

  -- change detection: never queue work the channel already reflects
  if _operation = 'price_sync' and _row.synced_price is not null
     and _row.synced_price = coalesce(_sp.selling_price,0) then
    return null;
  end if;
  if _operation = 'stock_sync' then
    _qty := public.store_product_available_qty(_sp.product_id);
    if _row.synced_qty is not null and _row.synced_qty = _qty then return null; end if;
  end if;
  if _operation = 'listing_update' and _row.synced_content_hash is not null
     and _row.synced_content_hash = public.listing_content_hash(_listing_id) then
    return null;
  end if;

  perform set_config('app.sync_job_write','on',true);
  insert into public.sales_channel_sync_jobs
    (listing_id, sales_channel_account_id, store_id, operation, priority,
     available_at, source, source_reference, created_by)
  values
    (_listing_id, _row.sales_channel_account_id, _sp.store_id, _operation, _priority,
     now() + coalesce(_delay, interval '0'), left(coalesce(_source,'manual'),60), _reference, auth.uid())
  on conflict (listing_id, operation) where status in ('pending','retry_wait')
  do update set
    priority = least(public.sales_channel_sync_jobs.priority, excluded.priority),
    available_at = least(public.sales_channel_sync_jobs.available_at, excluded.available_at),
    source = excluded.source,
    updated_at = now()
  returning id into _job_id;
  perform set_config('app.sync_job_write','off',true);

  return _job_id;
end $$;

create or replace function public.queue_listing_sync(
  _listing_id uuid, _operation public.sales_channel_sync_type
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare _id uuid;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to synchronise channel listings';
  end if;
  _id := public.enqueue_listing_sync(_listing_id, _operation, 'manual', null, 50, interval '0');
  if _id is null then
    raise exception 'This listing is not eligible for that background operation, or it is already up to date';
  end if;
  return _id;
end $$;

-- fan-out helper used by the change triggers
create or replace function public.enqueue_sync_for_store_product(
  _store_product_id uuid, _operation public.sales_channel_sync_type, _source text
) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare _n integer := 0; _l record;
begin
  for _l in select id from public.sales_channel_product_listings
            where store_product_id = _store_product_id
              and listing_status in ('published','update_pending','sync_failed')
  loop
    if public.enqueue_listing_sync(_l.id, _operation, _source, _store_product_id, 100, interval '0') is not null then
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $$;

create or replace function public.enqueue_sync_for_product(
  _product_id uuid, _operation public.sales_channel_sync_type, _source text
) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare _n integer := 0; _sp record;
begin
  for _sp in select id from public.store_products where product_id = _product_id and status <> 'archived'
  loop
    _n := _n + public.enqueue_sync_for_store_product(_sp.id, _operation, _source);
  end loop;
  return _n;
end $$;

-- ============================================================
-- Change triggers (queue only — never any outbound call here)
-- ============================================================
create or replace function public.trg_store_product_sync_queue()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.selling_price,0) is distinct from coalesce(old.selling_price,0) then
    perform public.enqueue_sync_for_store_product(new.id, 'price_sync', 'store_product_price');
  end if;
  if new.title_override is distinct from old.title_override
     or new.description_override is distinct from old.description_override
     or new.store_sku is distinct from old.store_sku
     or new.status is distinct from old.status
     or new.visibility is distinct from old.visibility then
    perform public.enqueue_sync_for_store_product(new.id, 'listing_update', 'store_product_content');
  end if;
  return null;
end $$;

create trigger store_products_sync_queue
  after update on public.store_products
  for each row execute function public.trg_store_product_sync_queue();

create or replace function public.trg_product_sync_queue()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.name is distinct from old.name
     or new.description is distinct from old.description
     or new.short_description is distinct from old.short_description
     or new.sku is distinct from old.sku
     or new.status is distinct from old.status
     or new.is_purchasable is distinct from old.is_purchasable then
    perform public.enqueue_sync_for_product(new.id, 'listing_update', 'product_content');
  end if;
  return null;
end $$;

create trigger products_sync_queue
  after update on public.products
  for each row execute function public.trg_product_sync_queue();

create or replace function public.trg_inventory_sync_queue()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and new.available_quantity is not distinct from old.available_quantity then
    return null;
  end if;
  perform public.enqueue_sync_for_product(new.product_id, 'stock_sync', 'inventory_available');
  return null;
end $$;

create trigger inventory_levels_sync_queue
  after insert or update on public.inventory_levels
  for each row execute function public.trg_inventory_sync_queue();

-- ============================================================
-- Worker lifecycle
-- ============================================================
create or replace function public.reclaim_stale_sync_jobs()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _n integer;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to manage the synchronisation queue';
  end if;
  perform set_config('app.sync_job_write','on',true);
  with stale as (
    update public.sales_channel_sync_jobs set
      status = case when attempts >= max_attempts then 'failed' else 'retry_wait' end,
      failure_class = 'transient',
      last_error = 'The worker did not report a result in time',
      lease_token = null,
      lease_expires_at = null,
      available_at = now() + public.sync_job_backoff(attempts),
      completed_at = case when attempts >= max_attempts then now() else null end
    where status = 'processing' and lease_expires_at is not null and lease_expires_at < now()
    returning 1
  ) select count(*) into _n from stale;
  perform set_config('app.sync_job_write','off',true);
  return coalesce(_n,0);
end $$;

create or replace function public.claim_sync_jobs(_limit integer default 5, _lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _token uuid := gen_random_uuid(); _rows jsonb;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to process the synchronisation queue';
  end if;
  perform public.reclaim_stale_sync_jobs();

  perform set_config('app.sync_job_write','on',true);
  with candidate as (
    select id from public.sales_channel_sync_jobs
    where status in ('pending','retry_wait') and available_at <= now()
    order by priority asc, available_at asc
    limit greatest(1, least(coalesce(_limit,5), 25))
    for update skip locked
  ), claimed as (
    update public.sales_channel_sync_jobs j set
      status = 'processing',
      attempts = j.attempts + 1,
      claimed_at = now(),
      lease_token = _token,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(_lease_seconds,120), 600)))
    from candidate c where j.id = c.id
    returning j.id, j.listing_id, j.sales_channel_account_id, j.store_id, j.operation,
              j.attempts, j.max_attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', id, 'listing_id', listing_id, 'account_id', sales_channel_account_id,
    'store_id', store_id, 'operation', operation, 'attempts', attempts,
    'max_attempts', max_attempts, 'lease_token', _token
  )), '[]'::jsonb) into _rows from claimed;
  perform set_config('app.sync_job_write','off',true);

  return _rows;
end $$;

create or replace function public.complete_sync_job(
  _job_id uuid,
  _lease_token uuid,
  _ok boolean,
  _message text default null,
  _failure_class public.sync_failure_class default 'unknown',
  _run_id uuid default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare _job public.sales_channel_sync_jobs; _status public.sync_job_status;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to process the synchronisation queue';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id for update;
  if _job.id is null then raise exception 'Sync job not found'; end if;

  -- stale result protection: an expired or re-claimed lease cannot report
  if _job.status <> 'processing' or _job.lease_token is distinct from _lease_token then
    return jsonb_build_object('applied', false, 'status', _job.status);
  end if;

  if _ok then
    _status := 'succeeded';
  elsif _failure_class = 'transient' and _job.attempts < _job.max_attempts then
    _status := 'retry_wait';
  else
    _status := 'failed';
  end if;

  perform set_config('app.sync_job_write','on',true);
  update public.sales_channel_sync_jobs set
    status = _status,
    failure_class = case when _ok then null else coalesce(_failure_class,'unknown') end,
    last_error = case when _ok then null else left(coalesce(nullif(btrim(coalesce(_message,'')),''),'Synchronisation failed'),300) end,
    last_run_id = coalesce(_run_id, last_run_id),
    lease_token = null,
    lease_expires_at = null,
    available_at = case when _status = 'retry_wait' then now() + public.sync_job_backoff(_job.attempts) else available_at end,
    completed_at = case when _status in ('succeeded','failed') then now() else null end
  where id = _job_id;
  perform set_config('app.sync_job_write','off',true);

  return jsonb_build_object('applied', true, 'status', _status);
end $$;

create or replace function public.cancel_sync_job(_job_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _job public.sales_channel_sync_jobs;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to manage the synchronisation queue';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id for update;
  if _job.id is null then raise exception 'Sync job not found'; end if;
  if _job.status not in ('pending','retry_wait') then
    raise exception 'Only a waiting job can be cancelled';
  end if;
  perform set_config('app.sync_job_write','on',true);
  update public.sales_channel_sync_jobs
     set status = 'cancelled', completed_at = now(), last_error = 'Cancelled by an operator'
   where id = _job_id;
  perform set_config('app.sync_job_write','off',true);
  return jsonb_build_object('job_id', _job_id, 'status', 'cancelled');
end $$;

create or replace function public.requeue_sync_job(_job_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _job public.sales_channel_sync_jobs; _new uuid;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to manage the synchronisation queue';
  end if;
  select * into _job from public.sales_channel_sync_jobs where id = _job_id;
  if _job.id is null then raise exception 'Sync job not found'; end if;
  if _job.status not in ('failed','cancelled') then
    raise exception 'Only a failed or cancelled job can be re-queued';
  end if;

  perform set_config('app.sync_job_write','on',true);
  insert into public.sales_channel_sync_jobs
    (listing_id, sales_channel_account_id, store_id, operation, priority, source, source_reference, created_by)
  values (_job.listing_id, _job.sales_channel_account_id, _job.store_id, _job.operation, 50,
          'requeue', _job.id, auth.uid())
  on conflict (listing_id, operation) where status in ('pending','retry_wait')
  do update set priority = 50, available_at = now(), source = 'requeue', updated_at = now()
  returning id into _new;
  perform set_config('app.sync_job_write','off',true);
  return _new;
end $$;

-- ============================================================
-- Observability reads
-- ============================================================
create or replace function public.sync_queue_overview(_store_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _res jsonb;
begin
  if not public.can_read_channels() then
    raise exception 'Not permitted to read the synchronisation queue';
  end if;
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'retry_wait', count(*) filter (where status = 'retry_wait'),
    'processing', count(*) filter (where status = 'processing'),
    'failed', count(*) filter (where status = 'failed'),
    'succeeded_24h', count(*) filter (where status = 'succeeded' and completed_at > now() - interval '24 hours'),
    'oldest_waiting_at', min(available_at) filter (where status in ('pending','retry_wait'))
  ) into _res
  from public.sales_channel_sync_jobs
  where (_store_id is null or store_id = _store_id);
  return coalesce(_res, '{}'::jsonb);
end $$;

create or replace function public.list_sync_jobs(
  _store_id uuid default null,
  _status public.sync_job_status default null,
  _listing_id uuid default null,
  _limit integer default 25,
  _offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _rows jsonb; _total integer;
begin
  if not public.can_read_channels() then
    raise exception 'Not permitted to read the synchronisation queue';
  end if;
  select count(*) into _total from public.sales_channel_sync_jobs j
   where (_store_id is null or j.store_id = _store_id)
     and (_status is null or j.status = _status)
     and (_listing_id is null or j.listing_id = _listing_id);

  select coalesce(jsonb_agg(row order by ord), '[]'::jsonb) into _rows from (
    select jsonb_build_object(
      'id', j.id, 'listing_id', j.listing_id, 'store_id', j.store_id,
      'operation', j.operation, 'status', j.status, 'priority', j.priority,
      'attempts', j.attempts, 'max_attempts', j.max_attempts,
      'available_at', j.available_at, 'completed_at', j.completed_at,
      'last_error', j.last_error, 'failure_class', j.failure_class,
      'source', j.source, 'created_at', j.created_at, 'updated_at', j.updated_at,
      'provider', a.provider, 'channel_name', a.name,
      'product_title', coalesce(nullif(btrim(coalesce(sp.title_override,'')),''), p.name),
      'listing_status', l.listing_status
    ) as row,
    row_number() over (order by j.created_at desc) as ord
    from public.sales_channel_sync_jobs j
    join public.sales_channel_product_listings l on l.id = j.listing_id
    join public.store_products sp on sp.id = l.store_product_id
    join public.products p on p.id = sp.product_id
    join public.sales_channel_accounts a on a.id = j.sales_channel_account_id
    where (_store_id is null or j.store_id = _store_id)
      and (_status is null or j.status = _status)
      and (_listing_id is null or j.listing_id = _listing_id)
    order by j.created_at desc
    limit greatest(1, least(coalesce(_limit,25), 100)) offset greatest(coalesce(_offset,0),0)
  ) t;

  return jsonb_build_object('total', _total, 'rows', _rows);
end $$;

-- ============================================================
-- Shared execution path: allow the background worker to use the
-- existing controlled listing operation functions.
-- ============================================================
create or replace function public.begin_listing_operation(_listing_id uuid, _operation sales_channel_sync_type)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.sales_channel_product_listings; _acc public.sales_channel_accounts;
        _run public.sales_channel_sync_runs; _target public.channel_listing_status; _from public.channel_listing_status;
begin
  if not public.can_sync_channels() then
    raise exception 'Not permitted to synchronise channel listings';
  end if;
  if _operation not in ('listing_publish','listing_update','price_sync','stock_sync','status_refresh','unpublish') then
    raise exception 'Unsupported listing operation';
  end if;

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
end $function$;

create or replace function public.finish_listing_operation(
  _run_id uuid, _listing_id uuid, _operation sales_channel_sync_type, _ok boolean,
  _message text default null, _external_product_id text default null, _external_url text default null,
  _synced_price numeric default null, _synced_qty numeric default null, _external_missing boolean default false)
 returns sales_channel_product_listings language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.sales_channel_product_listings; _event public.channel_listing_event_type;
        _run_status public.sales_channel_sync_status;
begin
  if not public.can_sync_channels() then
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
    synced_content_hash = case
      when _ok and _operation in ('listing_publish','listing_update')
      then public.listing_content_hash(_listing_id) else synced_content_hash end,
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

create or replace function public.effective_store_product_data(_store_product_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare _sp public.store_products; _p public.products; _qty numeric;
begin
  if not public.can_read_channels() then
    raise exception 'Not permitted to read the store catalog';
  end if;
  select * into _sp from public.store_products where id = _store_product_id;
  if _sp.id is null then raise exception 'Store product not found'; end if;
  select * into _p from public.products where id = _sp.product_id;
  if _p.id is null then raise exception 'Master product not found'; end if;
  _qty := public.store_product_available_qty(_sp.product_id);

  return jsonb_build_object(
    'store_product_id', _sp.id, 'store_id', _sp.store_id, 'product_id', _p.id,
    'title', coalesce(nullif(btrim(coalesce(_sp.title_override,'')),''), _p.name),
    'description', coalesce(nullif(btrim(coalesce(_sp.description_override,'')),''), _p.description, _p.short_description),
    'sku', coalesce(nullif(btrim(coalesce(_sp.store_sku,'')),''), _p.sku),
    'price', _sp.selling_price, 'status', _sp.status, 'visibility', _sp.visibility,
    'available_qty', _qty, 'is_purchasable', _p.is_purchasable, 'master_status', _p.status,
    'requires_shipping', _p.requires_shipping, 'weight', _p.weight
  );
end $function$;

-- ============================================================
-- Lock down execution
-- ============================================================
revoke all on function public.enqueue_listing_sync(uuid, public.sales_channel_sync_type, text, uuid, integer, interval) from public, anon;
revoke all on function public.enqueue_sync_for_store_product(uuid, public.sales_channel_sync_type, text) from public, anon;
revoke all on function public.enqueue_sync_for_product(uuid, public.sales_channel_sync_type, text) from public, anon;
revoke all on function public.queue_listing_sync(uuid, public.sales_channel_sync_type) from public, anon;
revoke all on function public.claim_sync_jobs(integer, integer) from public, anon;
revoke all on function public.complete_sync_job(uuid, uuid, boolean, text, public.sync_failure_class, uuid) from public, anon;
revoke all on function public.cancel_sync_job(uuid) from public, anon;
revoke all on function public.requeue_sync_job(uuid) from public, anon;
revoke all on function public.reclaim_stale_sync_jobs() from public, anon;
revoke all on function public.sync_queue_overview(uuid) from public, anon;
revoke all on function public.list_sync_jobs(uuid, public.sync_job_status, uuid, integer, integer) from public, anon;
revoke all on function public.guard_sync_job_write() from public, anon;
revoke all on function public.listing_content_hash(uuid) from public, anon;
revoke all on function public.is_service_context() from public, anon;

grant execute on function public.queue_listing_sync(uuid, public.sales_channel_sync_type) to authenticated, service_role;
grant execute on function public.cancel_sync_job(uuid) to authenticated, service_role;
grant execute on function public.requeue_sync_job(uuid) to authenticated, service_role;
grant execute on function public.sync_queue_overview(uuid) to authenticated, service_role;
grant execute on function public.list_sync_jobs(uuid, public.sync_job_status, uuid, integer, integer) to authenticated, service_role;
grant execute on function public.claim_sync_jobs(integer, integer) to authenticated, service_role;
grant execute on function public.complete_sync_job(uuid, uuid, boolean, text, public.sync_failure_class, uuid) to authenticated, service_role;
grant execute on function public.reclaim_stale_sync_jobs() to authenticated, service_role;
grant execute on function public.can_sync_channels() to authenticated, service_role;
grant execute on function public.can_read_channels() to authenticated, service_role;