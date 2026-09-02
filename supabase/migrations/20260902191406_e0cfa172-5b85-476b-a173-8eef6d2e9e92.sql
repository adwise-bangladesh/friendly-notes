-- 1. Lock down direct client access to courier/integration tables.
revoke all on public.courier_accounts, public.courier_account_credentials, public.courier_api_logs,
  public.courier_provider_events, public.courier_locations, public.courier_status_map,
  public.courier_providers from anon, public;

revoke insert, update, delete, truncate, references on
  public.courier_accounts, public.courier_account_credentials, public.courier_api_logs,
  public.courier_provider_events, public.courier_locations, public.courier_status_map
  from authenticated;

grant select on public.courier_accounts, public.courier_api_logs, public.courier_provider_events,
  public.courier_locations, public.courier_status_map, public.courier_providers to authenticated;
revoke select on public.courier_account_credentials from authenticated;

grant all on public.courier_accounts, public.courier_account_credentials, public.courier_api_logs,
  public.courier_provider_events, public.courier_locations, public.courier_status_map,
  public.courier_providers to service_role;

drop policy if exists "Admins insert courier accounts" on public.courier_accounts;
drop policy if exists "Admins update courier accounts" on public.courier_accounts;
drop policy if exists "Admins delete courier accounts" on public.courier_accounts;

-- 2. Controlled account state change (enable / disable).
create or replace function public.set_courier_account_state(
  _account_id uuid,
  _status public.courier_provider_status
) returns public.courier_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.courier_accounts;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can change an integration account';
  end if;

  update public.courier_accounts
     set status = _status,
         updated_by = auth.uid(),
         updated_at = now()
   where id = _account_id
  returning * into _row;

  if _row.id is null then
    raise exception 'Integration account not found';
  end if;

  return _row;
end;
$$;

revoke all on function public.set_courier_account_state(uuid, public.courier_provider_status) from public, anon;
grant execute on function public.set_courier_account_state(uuid, public.courier_provider_status) to authenticated;

-- 3. Safe connection health per account. Never returns a secret value.
create or replace function public.integration_account_health(_account_id uuid)
returns table (
  account_id uuid,
  has_credentials boolean,
  has_webhook_secret boolean,
  last_token_refresh_at timestamptz,
  token_expires_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_message text,
  failure_count_24h integer,
  last_webhook_at timestamptz,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    _account_id,
    (c.account_id is not null),
    (c.webhook_secret is not null),
    c.token_refreshed_at,
    c.token_expires_at,
    (select max(l.created_at) from public.courier_api_logs l where l.account_id = _account_id and l.succeeded),
    (select max(l.created_at) from public.courier_api_logs l where l.account_id = _account_id and not l.succeeded),
    (select l.safe_message from public.courier_api_logs l
      where l.account_id = _account_id and not l.succeeded
      order by l.created_at desc limit 1),
    (select count(*)::int from public.courier_api_logs l
      where l.account_id = _account_id and not l.succeeded and l.created_at > now() - interval '24 hours'),
    (select max(e.received_at) from public.courier_provider_events e
      where e.account_id = _account_id and e.source = 'webhook'),
    greatest(
      coalesce((select max(l.created_at) from public.courier_api_logs l where l.account_id = _account_id), 'epoch'::timestamptz),
      coalesce((select max(e.received_at) from public.courier_provider_events e where e.account_id = _account_id), 'epoch'::timestamptz)
    )
  from (select 1) s
  left join public.courier_account_credentials c on c.account_id = _account_id
  where public.can_read_commerce(auth.uid());
$$;

revoke all on function public.integration_account_health(uuid) from public, anon;
grant execute on function public.integration_account_health(uuid) to authenticated;

-- 4. Combined, paged, sanitized integration activity feed.
--    Reuses the authoritative courier_api_logs and courier_provider_events records.
create or replace function public.integration_activity_feed(
  _provider_id uuid default null,
  _account_id uuid default null,
  _activity_type text default null,
  _status text default null,
  _from timestamptz default null,
  _to timestamptz default null,
  _limit integer default 50,
  _offset integer default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  provider_id uuid,
  provider_name text,
  account_id uuid,
  account_name text,
  environment text,
  activity_type text,
  status text,
  message text,
  shipment_id uuid,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with rows as (
    select l.id,
           l.created_at,
           l.provider_id,
           l.account_id,
           case l.operation
             when 'book_shipment' then 'shipment_booking'
             when 'refresh_status' then 'status_refresh'
             when 'price_quote' then 'quote_request'
             else l.operation
           end as activity_type,
           case when l.succeeded then 'success' else 'failed' end as status,
           coalesce(l.safe_message,
             case when l.succeeded then 'Completed' else 'The provider call failed' end) as message,
           l.shipment_id
      from public.courier_api_logs l
    union all
    select e.id,
           e.received_at as created_at,
           e.provider_id,
           e.account_id,
           case e.processing_status
             when 'applied' then 'webhook_applied'
             when 'rejected' then 'webhook_failed'
             when 'unmatched' then 'webhook_failed'
             else 'webhook_ignored'
           end as activity_type,
           case e.processing_status
             when 'applied' then 'success'
             when 'rejected' then 'failed'
             when 'unmatched' then 'failed'
             else 'ignored'
           end as status,
           concat_ws(' — ',
             nullif(coalesce(e.provider_event, e.provider_status), ''),
             nullif(e.processing_note, '')) as message,
           e.shipment_id
      from public.courier_provider_events e
  ),
  filtered as (
    select r.*, p.name as provider_name, a.name as account_name, a.environment::text as environment
      from rows r
      left join public.courier_providers p on p.id = r.provider_id
      left join public.courier_accounts a on a.id = r.account_id
     where (_provider_id is null or r.provider_id = _provider_id)
       and (_account_id is null or r.account_id = _account_id)
       and (_activity_type is null or r.activity_type = _activity_type)
       and (_status is null or r.status = _status)
       and (_from is null or r.created_at >= _from)
       and (_to is null or r.created_at <= _to)
  )
  select f.id, f.created_at, f.provider_id, f.provider_name, f.account_id, f.account_name,
         f.environment, f.activity_type, f.status, f.message, f.shipment_id,
         count(*) over () as total_count
    from filtered f
   order by f.created_at desc
   limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
$$;

revoke all on function public.integration_activity_feed(uuid, uuid, text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.integration_activity_feed(uuid, uuid, text, text, timestamptz, timestamptz, integer, integer) to authenticated;

-- 5. Webhook visibility per account, derived from the existing event history.
create or replace function public.integration_webhook_overview()
returns table (
  provider_id uuid,
  provider_code text,
  provider_name text,
  account_id uuid,
  account_name text,
  environment text,
  webhook_configured boolean,
  last_received_at timestamptz,
  applied_count integer,
  duplicate_count integer,
  ignored_count integer,
  rejected_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.code, p.name, a.id, a.name, a.environment::text,
         (c.webhook_secret is not null),
         (select max(e.received_at) from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook'),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook' and e.processing_status = 'applied'),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook' and e.processing_status = 'duplicate'),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook'
             and e.processing_status in ('recorded', 'stale')),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook'
             and e.processing_status in ('rejected', 'unmatched'))
    from public.courier_accounts a
    join public.courier_providers p on p.id = a.provider_id
    left join public.courier_account_credentials c on c.account_id = a.id
   where public.can_read_commerce(auth.uid())
   order by p.name, a.name;
$$;

revoke all on function public.integration_webhook_overview() from public, anon;
grant execute on function public.integration_webhook_overview() to authenticated;