-- ============ Per-order financial rollup (single definition, derived) ============
create or replace view public.order_financial_rollup
with (security_invoker = on) as
with item as (
  select oi.order_id,
         sum(coalesce(oi.unit_cost,0) * oi.quantity) as est_product_cost,
         sum(coalesce(oi.unit_cost,0) * greatest(oi.quantity - coalesce(r.returned_qty,0),0)) as actual_product_cost,
         bool_and(oi.unit_cost is not null) as cost_known,
         sum(oi.quantity) as units
    from public.order_items oi
    left join lateral (
      select sum(ri.quantity_accepted) as returned_qty
        from public.order_return_items ri
        join public.order_returns ret on ret.id = ri.return_id
       where ri.order_item_id = oi.id
         and ret.status in ('received','inspected','completed')
    ) r on true
   group by oi.order_id
), ship as (
  select s.order_id,
         count(*) as shipments,
         count(*) filter (where s.collected_amount is not null) as with_collection,
         count(*) filter (where s.actual_delivery_fee is not null) as with_fee,
         coalesce(sum(s.collected_amount),0) as collected,
         coalesce(sum(s.actual_delivery_fee),0) as actual_delivery,
         coalesce(sum(s.cod_fee),0) as cod_fees,
         coalesce(sum(s.return_charge),0) as return_charges,
         coalesce(sum(s.other_courier_charge),0) as other_courier,
         coalesce(sum(coalesce(s.booked_delivery_fee, s.quoted_delivery_fee, 0)),0) as est_delivery
    from public.shipments s
   where s.status <> 'cancelled'
   group by s.order_id
), adj as (
  select a.order_id,
         coalesce(sum(a.amount) filter (where a.direction='income'),0) as adj_income,
         coalesce(sum(a.amount) filter (where a.direction='expense'),0) as adj_expense,
         coalesce(sum(a.amount) filter (where a.direction='expense' and a.adjustment_type='packing_cost'),0)
           - coalesce(sum(a.amount) filter (where a.direction='income' and a.adjustment_type='packing_cost'),0) as adj_packing
    from public.order_financial_adjustments a
   group by a.order_id
)
select o.id as order_id,
       o.created_at,
       o.status,
       o.source,
       o.customer_id,
       o.grand_total,
       o.subtotal,
       o.product_discount,
       o.order_discount,
       o.shipping_charge,
       coalesce(i.units,0) as units,
       coalesce(i.est_product_cost,0) as est_product_cost,
       coalesce(i.actual_product_cost,0) as actual_product_cost,
       coalesce(i.cost_known,true) as cost_snapshot_complete,
       case when coalesce(sh.est_delivery,0) = 0 then coalesce(o.delivery_charge,0) else sh.est_delivery end as est_delivery_cost,
       coalesce(sh.collected,0) as collected_amount,
       coalesce(sh.actual_delivery,0) as actual_delivery_cost,
       coalesce(sh.cod_fees,0) as cod_fees,
       coalesce(sh.return_charges,0) as return_charges,
       coalesce(sh.other_courier,0) as other_courier_charges,
       coalesce(o.packing_charge,0) + coalesce(ad.adj_packing,0) as actual_packing_cost,
       coalesce(ad.adj_income,0) as adjustment_income,
       coalesce(ad.adj_expense,0) as adjustment_expense,
       coalesce(sh.shipments,0) as shipment_count,
       o.grand_total
         - coalesce(i.est_product_cost,0)
         - (case when coalesce(sh.est_delivery,0) = 0 then coalesce(o.delivery_charge,0) else sh.est_delivery end)
         - coalesce(o.packing_charge,0) as estimated_profit,
       coalesce(sh.collected,0)
         - coalesce(i.actual_product_cost,0)
         - coalesce(sh.actual_delivery,0)
         - coalesce(sh.cod_fees,0)
         - coalesce(sh.return_charges,0)
         - coalesce(sh.other_courier,0)
         - (coalesce(o.packing_charge,0) + coalesce(ad.adj_packing,0))
         - coalesce(ad.adj_expense,0)
         + coalesce(ad.adj_income,0) as actual_profit,
       case
         when coalesce(sh.shipments,0) = 0 then
           case when coalesce(ad.adj_income,0) + coalesce(ad.adj_expense,0) > 0 then 'partially_actual' else 'estimated' end
         when sh.with_collection = sh.shipments and sh.with_fee = sh.shipments then 'actual'
         when sh.with_collection > 0 or sh.with_fee > 0 or coalesce(ad.adj_income,0) + coalesce(ad.adj_expense,0) > 0 then 'partially_actual'
         else 'estimated'
       end as completeness
  from public.orders o
  left join item i on i.order_id = o.id
  left join ship sh on sh.order_id = o.id
  left join adj ad on ad.order_id = o.id;

grant select on public.order_financial_rollup to authenticated;

create index if not exists idx_orders_created_at on public.orders (created_at);
create index if not exists idx_shipments_delivered_at on public.shipments (delivered_at);

-- ============ Shared guard ============
create or replace function public.analytics_guard(_from timestamptz, _to timestamptz)
returns void language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted to read analytics';
  end if;
  if _from is null or _to is null or _to <= _from then
    raise exception 'Invalid analytics date range';
  end if;
  if _to - _from > interval '400 days' then
    raise exception 'Analytics date range is limited to 400 days';
  end if;
end; $$;

revoke all on function public.analytics_guard(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_guard(timestamptz, timestamptz) to authenticated;

create or replace function public.analytics_bucket(_ts timestamptz, _grain text)
returns date language sql immutable set search_path = public as $$
  select (date_trunc(case when _grain in ('day','week','month') then _grain else 'day' end, _ts))::date;
$$;

-- ============ Overview ============
create or replace function public.analytics_overview(
  _from timestamptz, _to timestamptz, _source order_source default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);

  with scoped as (
    select f.* from public.order_financial_rollup f
     where f.created_at >= _from and f.created_at < _to
       and (_source is null or f.source = _source)
  ), live as (
    select * from scoped where status <> 'cancelled'
  ), delivered as (
    select o.id, r.grand_total, r.actual_profit, r.completeness
      from public.orders o
      join public.order_financial_rollup r on r.order_id = o.id
     where o.delivery_status in ('delivered','partially_delivered')
       and exists (select 1 from public.shipments s
                    where s.order_id = o.id and s.delivered_at >= _from and s.delivered_at < _to)
       and (_source is null or o.source = _source)
  ), returned_orders as (
    select count(distinct ret.order_id) c
      from public.order_returns ret
     where ret.created_at >= _from and ret.created_at < _to
  ), cust as (
    select o.customer_id,
           min(o.created_at) over (partition by o.customer_id) as first_order_at
      from public.orders o where o.status <> 'cancelled' and o.customer_id is not null
  ), cust_period as (
    select count(distinct customer_id) filter (where first_order_at >= _from and first_order_at < _to) as new_customers
      from cust
  ), repeat_cust as (
    select count(*) c from (
      select o.customer_id from public.orders o
       where o.status <> 'cancelled' and o.customer_id is not null
         and o.created_at >= _from and o.created_at < _to
       group by o.customer_id having count(*) > 1) x
  ), ship_stats as (
    select count(*) total,
           count(*) filter (where s.status = 'delivered') delivered,
           count(*) filter (where s.status = 'partial_delivered') partial,
           count(*) filter (where s.status in ('delivery_failed','pickup_failed','lost')) failed
      from public.shipments s
     where s.created_at >= _from and s.created_at < _to and s.status <> 'cancelled'
  )
  select jsonb_build_object(
    'total_orders', (select count(*) from scoped),
    'live_orders', (select count(*) from live),
    'cancelled_orders', (select count(*) from scoped where status = 'cancelled'),
    'order_revenue', (select coalesce(sum(grand_total),0) from live),
    'cancelled_revenue', (select coalesce(sum(grand_total),0) from scoped where status = 'cancelled'),
    'delivered_revenue', (select coalesce(sum(grand_total),0) from delivered),
    'delivered_orders', (select count(*) from delivered),
    'estimated_profit', (select coalesce(sum(estimated_profit),0) from live),
    'actual_profit', (select coalesce(sum(actual_profit),0) from delivered),
    'profit_margin', case when (select coalesce(sum(grand_total),0) from live) = 0 then null
        else round((select coalesce(sum(estimated_profit),0) from live) / (select sum(grand_total) from live) * 100, 2) end,
    'average_order_value', case when (select count(*) from live) = 0 then null
        else round((select coalesce(sum(grand_total),0) from live) / (select count(*) from live), 2) end,
    'completeness', jsonb_build_object(
        'actual', (select count(*) from live where completeness='actual'),
        'partially_actual', (select count(*) from live where completeness='partially_actual'),
        'estimated', (select count(*) from live where completeness='estimated')),
    'shipments', (select total from ship_stats),
    'shipments_delivered', (select delivered + partial from ship_stats),
    'shipments_failed', (select failed from ship_stats),
    'delivery_success_rate', (select case when total = 0 then null
        else round((delivered + partial)::numeric / total * 100, 2) end from ship_stats),
    'return_rate', case when (select count(*) from live) = 0 then null
        else round((select c from returned_orders)::numeric / (select count(*) from live) * 100, 2) end,
    'new_customers', (select new_customers from cust_period),
    'repeat_customers', (select c from repeat_cust)
  ) into _r;
  return _r;
end; $$;

revoke all on function public.analytics_overview(timestamptz, timestamptz, order_source) from public, anon;
grant execute on function public.analytics_overview(timestamptz, timestamptz, order_source) to authenticated;

-- ============ Sales trend ============
create or replace function public.analytics_sales_trend(
  _from timestamptz, _to timestamptz, _grain text default 'day', _source order_source default null)
returns table (
  bucket date, orders bigint, revenue numeric, discounts numeric, shipping numeric,
  net_product_revenue numeric, cancelled_revenue numeric, delivered_revenue numeric, average_order_value numeric)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  with created as (
    select public.analytics_bucket(o.created_at, _grain) b,
           count(*) filter (where o.status <> 'cancelled') orders,
           coalesce(sum(o.grand_total) filter (where o.status <> 'cancelled'),0) revenue,
           coalesce(sum(o.product_discount + o.order_discount) filter (where o.status <> 'cancelled'),0) discounts,
           coalesce(sum(o.shipping_charge) filter (where o.status <> 'cancelled'),0) shipping,
           coalesce(sum(o.subtotal - o.product_discount - o.order_discount) filter (where o.status <> 'cancelled'),0) netp,
           coalesce(sum(o.grand_total) filter (where o.status = 'cancelled'),0) cancelled
      from public.orders o
     where o.created_at >= _from and o.created_at < _to
       and (_source is null or o.source = _source)
     group by 1
  ), delivered as (
    select public.analytics_bucket(d.delivered_at, _grain) b, coalesce(sum(d.grand_total),0) delivered_revenue
      from (
        select distinct on (o.id) o.id, o.grand_total, s.delivered_at
          from public.orders o
          join public.shipments s on s.order_id = o.id
         where s.delivered_at >= _from and s.delivered_at < _to
           and s.status in ('delivered','partial_delivered')
           and (_source is null or o.source = _source)
         order by o.id, s.delivered_at
      ) d group by 1
  )
  select coalesce(c.b, dl.b) as bucket,
         coalesce(c.orders,0), coalesce(c.revenue,0), coalesce(c.discounts,0), coalesce(c.shipping,0),
         coalesce(c.netp,0), coalesce(c.cancelled,0), coalesce(dl.delivered_revenue,0),
         case when coalesce(c.orders,0) = 0 then null else round(c.revenue / c.orders, 2) end
    from created c
    full outer join delivered dl on dl.b = c.b
   order by 1;
end; $$;

revoke all on function public.analytics_sales_trend(timestamptz, timestamptz, text, order_source) from public, anon;
grant execute on function public.analytics_sales_trend(timestamptz, timestamptz, text, order_source) to authenticated;

-- ============ Order funnel + verification ============
create or replace function public.analytics_orders(
  _from timestamptz, _to timestamptz, _source order_source default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);
  with scoped as (
    select o.* from public.orders o
     where o.created_at >= _from and o.created_at < _to
       and (_source is null or o.source = _source)
  )
  select jsonb_build_object(
    'created', (select count(*) from scoped),
    'cancelled', (select count(*) from scoped where status='cancelled'),
    'verified', (select count(*) from scoped where verification_status in ('confirmed','not_required')),
    'fulfilled', (select count(*) from scoped where fulfillment_status in ('fulfilled','partially_fulfilled')),
    'shipped', (select count(distinct s.order_id) from public.shipments s join scoped o on o.id = s.order_id
                 where s.status <> 'cancelled' and s.booked_at is not null),
    'delivered', (select count(*) from scoped where delivery_status in ('delivered','partially_delivered')),
    'returned', (select count(distinct r.order_id) from public.order_returns r join scoped o on o.id = r.order_id),
    'with_exceptions', (select count(distinct e.order_id) from public.shipment_exceptions e join scoped o on o.id = e.order_id),
    'by_source', (select coalesce(jsonb_object_agg(source, c), '{}'::jsonb) from
                   (select source::text source, count(*) c from scoped group by 1) x),
    'verification', jsonb_build_object(
      'total', (select count(*) from scoped where verification_status <> 'not_required'),
      'confirmed', (select count(*) from scoped where verification_status='confirmed'),
      'manual_review', (select count(*) from scoped where verification_status='manual_review'),
      'unreachable', (select count(*) from scoped where verification_status='unreachable'),
      'failed', (select count(*) from scoped where verification_status='failed'),
      'pending', (select count(*) from scoped where verification_status in ('pending','in_progress','rescheduled')),
      'callbacks', (select count(*) from scoped where verification_status='rescheduled'),
      'avg_attempts_per_confirmed', (select case when count(*) = 0 then null
            else round(avg(verification_attempt_count)::numeric, 2) end
            from scoped where verification_status='confirmed'),
      'attempt_outcomes', (select coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb) from (
          select a.outcome::text outcome, count(*) c
            from public.order_verification_attempts a
           where a.created_at >= _from and a.created_at < _to
           group by 1) y),
      'attempts', (select count(*) from public.order_verification_attempts a
                    where a.created_at >= _from and a.created_at < _to))
  ) into _r;
  return _r;
end; $$;

revoke all on function public.analytics_orders(timestamptz, timestamptz, order_source) from public, anon;
grant execute on function public.analytics_orders(timestamptz, timestamptz, order_source) to authenticated;

-- ============ Delivery + courier performance ============
create or replace function public.analytics_delivery(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);
  with scoped as (
    select s.* from public.shipments s
     where s.created_at >= _from and s.created_at < _to and s.status <> 'cancelled'
  ), timed as (
    select extract(epoch from (delivered_at - coalesce(picked_up_at, booked_at))) sec
      from scoped
     where delivered_at is not null and coalesce(picked_up_at, booked_at) is not null
       and delivered_at > coalesce(picked_up_at, booked_at)
  )
  select jsonb_build_object(
    'shipments', (select count(*) from scoped),
    'delivered', (select count(*) from scoped where status='delivered'),
    'partial_delivered', (select count(*) from scoped where status='partial_delivered'),
    'failed', (select count(*) from scoped where status in ('delivery_failed','pickup_failed','lost')),
    'returned', (select count(*) from scoped where status in ('return_requested','return_in_transit','return_received')),
    'in_flight', (select count(*) from scoped where status in ('booked','picked_up','in_transit','out_for_delivery','delivery_on_hold')),
    'success_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status in ('delivered','partial_delivered'))::numeric / count(*) * 100, 2) end from scoped),
    'failure_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status in ('delivery_failed','pickup_failed','lost'))::numeric / count(*) * 100, 2) end from scoped),
    'return_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status in ('return_requested','return_in_transit','return_received'))::numeric / count(*) * 100, 2) end from scoped),
    'partial_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status='partial_delivered')::numeric / count(*) * 100, 2) end from scoped),
    'avg_delivery_hours', (select case when count(*) = 0 then null else round((avg(sec)/3600)::numeric, 1) end from timed),
    'delivery_time_sample', (select count(*) from timed)
  ) into _r;
  return _r;
end; $$;

revoke all on function public.analytics_delivery(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_delivery(timestamptz, timestamptz) to authenticated;

create or replace function public.analytics_courier_performance(
  _from timestamptz, _to timestamptz, _provider_id uuid default null, _account_id uuid default null)
returns table (
  provider_id uuid, provider_name text, account_id uuid, account_name text,
  shipments bigint, delivered bigint, partial bigint, failed bigint, returned bigint,
  avg_delivery_hours numeric, avg_estimated_cost numeric, avg_actual_cost numeric,
  shipments_with_actual_cost bigint, settlement_difference numeric)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  select p.id, p.name, a.id, a.name,
         count(*)::bigint,
         count(*) filter (where s.status='delivered')::bigint,
         count(*) filter (where s.status='partial_delivered')::bigint,
         count(*) filter (where s.status in ('delivery_failed','pickup_failed','lost'))::bigint,
         count(*) filter (where s.status in ('return_requested','return_in_transit','return_received'))::bigint,
         round((avg(extract(epoch from (s.delivered_at - coalesce(s.picked_up_at, s.booked_at))))
               filter (where s.delivered_at is not null and coalesce(s.picked_up_at, s.booked_at) is not null
                         and s.delivered_at > coalesce(s.picked_up_at, s.booked_at)) / 3600)::numeric, 1),
         round(avg(coalesce(s.booked_delivery_fee, s.quoted_delivery_fee)) filter
               (where coalesce(s.booked_delivery_fee, s.quoted_delivery_fee) is not null)::numeric, 2),
         round(avg(s.actual_delivery_fee) filter (where s.actual_delivery_fee is not null)::numeric, 2),
         count(*) filter (where s.actual_delivery_fee is not null)::bigint,
         round(coalesce(sum(s.actual_delivery_fee) filter (where s.actual_delivery_fee is not null), 0)
               - coalesce(sum(coalesce(s.booked_delivery_fee, s.quoted_delivery_fee))
                          filter (where s.actual_delivery_fee is not null), 0), 2)
    from public.shipments s
    left join public.courier_providers p on p.id = s.provider_id
    left join public.courier_accounts a on a.id = s.courier_account_id
   where s.created_at >= _from and s.created_at < _to and s.status <> 'cancelled'
     and (_provider_id is null or s.provider_id = _provider_id)
     and (_account_id is null or s.courier_account_id = _account_id)
   group by p.id, p.name, a.id, a.name
   order by count(*) desc;
end; $$;

revoke all on function public.analytics_courier_performance(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.analytics_courier_performance(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ============ Customers ============
create or replace function public.analytics_customers(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);
  with live as (
    select o.* from public.orders o where o.status <> 'cancelled' and o.customer_id is not null
  ), firsts as (
    select customer_id, min(created_at) first_order_at from live group by 1
  ), period as (
    select * from live where created_at >= _from and created_at < _to
  ), per_customer as (
    select customer_id, count(*) orders, sum(grand_total) value from period group by 1
  )
  select jsonb_build_object(
    'active_customers', (select count(*) from per_customer),
    'new_customers', (select count(*) from firsts where first_order_at >= _from and first_order_at < _to),
    'repeat_customers', (select count(*) from per_customer where orders > 1),
    'returning_customers', (select count(*) from per_customer pc
                             join firsts f on f.customer_id = pc.customer_id
                            where f.first_order_at < _from),
    'orders', (select coalesce(sum(orders),0) from per_customer),
    'avg_orders_per_customer', (select case when count(*) = 0 then null else round(avg(orders)::numeric,2) end from per_customer),
    'avg_customer_value', (select case when count(*) = 0 then null else round(avg(value)::numeric,2) end from per_customer),
    'blocked_customers', (select count(*) from public.customers where status = 'blocked'),
    'cancellation_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status='cancelled')::numeric / count(*) * 100, 2) end
        from public.orders where created_at >= _from and created_at < _to)
  ) into _r;
  return _r;
end; $$;

revoke all on function public.analytics_customers(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_customers(timestamptz, timestamptz) to authenticated;

create or replace function public.analytics_top_customers(
  _from timestamptz, _to timestamptz, _limit integer default 10)
returns table (customer_id uuid, name text, phone text, orders bigint, revenue numeric,
               delivered_orders bigint, returned_orders bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  select c.id, c.name, c.primary_phone,
         count(*)::bigint,
         coalesce(sum(o.grand_total),0),
         count(*) filter (where o.delivery_status in ('delivered','partially_delivered'))::bigint,
         count(*) filter (where o.delivery_status in ('returned','partially_returned'))::bigint
    from public.orders o
    join public.customers c on c.id = o.customer_id
   where o.created_at >= _from and o.created_at < _to and o.status <> 'cancelled'
   group by c.id, c.name, c.primary_phone
   order by coalesce(sum(o.grand_total),0) desc
   limit greatest(coalesce(_limit,10), 1);
end; $$;

revoke all on function public.analytics_top_customers(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.analytics_top_customers(timestamptz, timestamptz, integer) to authenticated;

create or replace function public.analytics_customer_trend(
  _from timestamptz, _to timestamptz, _grain text default 'day')
returns table (bucket date, new_customers bigint, active_customers bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  with live as (
    select o.customer_id, o.created_at from public.orders o
     where o.status <> 'cancelled' and o.customer_id is not null
  ), firsts as (
    select customer_id, min(created_at) first_order_at from live group by 1
  ), active as (
    select public.analytics_bucket(created_at, _grain) b, count(distinct customer_id) c
      from live where created_at >= _from and created_at < _to group by 1
  ), fresh as (
    select public.analytics_bucket(first_order_at, _grain) b, count(*) c
      from firsts where first_order_at >= _from and first_order_at < _to group by 1
  )
  select coalesce(a.b, f.b), coalesce(f.c,0)::bigint, coalesce(a.c,0)::bigint
    from active a full outer join fresh f on f.b = a.b order by 1;
end; $$;

revoke all on function public.analytics_customer_trend(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.analytics_customer_trend(timestamptz, timestamptz, text) to authenticated;

-- ============ Product performance (order-item snapshots only) ============
create or replace function public.analytics_product_performance(
  _from timestamptz, _to timestamptz, _limit integer default 20, _product_id uuid default null)
returns table (
  product_id uuid, variant_id uuid, product_name text, variant_name text, sku text,
  units_ordered bigint, units_returned bigint, revenue numeric, product_cost numeric,
  estimated_profit numeric, orders bigint, cost_snapshot_complete boolean)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  with lines as (
    select oi.*, o.id oid
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.created_at >= _from and o.created_at < _to and o.status <> 'cancelled'
       and (_product_id is null or oi.product_id = _product_id)
  ), returned as (
    select ri.order_item_id, sum(ri.quantity_accepted) qty
      from public.order_return_items ri
      join public.order_returns ret on ret.id = ri.return_id
     where ret.status in ('received','inspected','completed')
     group by 1
  )
  select l.product_id,
         case when _product_id is null then null::uuid else l.variant_id end,
         min(l.product_name),
         case when _product_id is null then null::text else min(l.variant_name) end,
         min(l.sku),
         sum(l.quantity)::bigint,
         coalesce(sum(r.qty),0)::bigint,
         sum(l.line_total),
         sum(coalesce(l.unit_cost,0) * l.quantity),
         sum(l.line_total - coalesce(l.unit_cost,0) * l.quantity),
         count(distinct l.oid)::bigint,
         bool_and(l.unit_cost is not null)
    from lines l
    left join returned r on r.order_item_id = l.id
   group by l.product_id, case when _product_id is null then null::uuid else l.variant_id end
   order by sum(l.line_total) desc
   limit greatest(coalesce(_limit,20), 1);
end; $$;

revoke all on function public.analytics_product_performance(timestamptz, timestamptz, integer, uuid) from public, anon;
grant execute on function public.analytics_product_performance(timestamptz, timestamptz, integer, uuid) to authenticated;

-- ============ Inventory ============
create or replace function public.analytics_inventory()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare _r jsonb;
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted to read analytics';
  end if;
  with levels as (
    select il.*, coalesce(v.base_cost + coalesce(v.additional_cost,0),
                          p.base_cost + coalesce(p.additional_cost,0)) as unit_cost
      from public.inventory_levels il
      join public.products p on p.id = il.product_id
      left join public.product_variants v on v.id = il.variant_id
  )
  select jsonb_build_object(
    'tracked_items', (select count(*) from levels),
    'total_on_hand', (select coalesce(sum(on_hand),0) from levels),
    'total_available', (select coalesce(sum(available_quantity),0) from levels),
    'total_reserved', (select coalesce(sum(reserved),0) from levels),
    'total_damaged', (select coalesce(sum(damaged),0) from levels),
    'total_incoming', (select coalesce(sum(incoming),0) from levels),
    'inventory_value', (select coalesce(sum(on_hand * coalesce(unit_cost,0)),0) from levels),
    'damaged_value', (select coalesce(sum(damaged * coalesce(unit_cost,0)),0) from levels),
    'items_without_cost', (select count(*) from levels where unit_cost is null and on_hand > 0),
    'low_stock_items', (select count(*) from levels
                         where available_quantity > 0
                           and available_quantity <= coalesce(low_stock_threshold, 5)),
    'out_of_stock_items', (select count(*) from levels where available_quantity <= 0),
    'in_transit_units', (select coalesce(sum(ti.shipped_quantity - coalesce(ti.received_quantity,0)),0)
                           from public.inventory_transfer_items ti
                           join public.inventory_transfers t on t.id = ti.transfer_id
                          where t.status = 'in_transit')
  ) into _r;
  return _r;
end; $$;

revoke all on function public.analytics_inventory() from public, anon;
grant execute on function public.analytics_inventory() to authenticated;

create or replace function public.analytics_stock_risk(_limit integer default 25)
returns table (level_id uuid, product_id uuid, product_name text, variant_name text,
               location_name text, on_hand integer, available integer, damaged integer,
               incoming integer, threshold integer, risk text)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted to read analytics';
  end if;
  return query
  select il.id, il.product_id, p.name, v.title, loc.name,
         il.on_hand, il.available_quantity, il.damaged, il.incoming,
         coalesce(il.low_stock_threshold, 5),
         case when il.available_quantity <= 0 then 'out_of_stock'
              when il.damaged > 0 and il.damaged >= greatest(il.on_hand,1) / 2 then 'damaged'
              else 'low_stock' end
    from public.inventory_levels il
    join public.products p on p.id = il.product_id
    left join public.product_variants v on v.id = il.variant_id
    join public.inventory_locations loc on loc.id = il.location_id
   where il.available_quantity <= coalesce(il.low_stock_threshold, 5) or il.damaged > 0
   order by il.available_quantity asc, il.damaged desc
   limit greatest(coalesce(_limit,25), 1);
end; $$;

revoke all on function public.analytics_stock_risk(integer) from public, anon;
grant execute on function public.analytics_stock_risk(integer) to authenticated;

create or replace function public.analytics_movement_summary(_from timestamptz, _to timestamptz)
returns table (movement_type text, movements bigint, total_quantity bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  select m.movement_type::text, count(*)::bigint, sum(abs(m.quantity))::bigint
    from public.inventory_movements m
   where m.created_at >= _from and m.created_at < _to
   group by 1 order by 2 desc;
end; $$;

revoke all on function public.analytics_movement_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_movement_summary(timestamptz, timestamptz) to authenticated;

-- ============ Procurement ============
create or replace function public.analytics_procurement(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);
  with pos as (
    select po.* from public.purchase_orders po
     where po.created_at >= _from and po.created_at < _to and po.status <> 'draft'
  ), receipts as (
    select gr.* from public.goods_receipts gr
     where gr.received_at >= _from and gr.received_at < _to
       and gr.status = 'received' and gr.reversed_at is null
  ), lead as (
    select extract(epoch from (gr.received_at - po.ordered_at)) sec
      from public.goods_receipts gr
      join public.purchase_orders po on po.id = gr.purchase_order_id
     where gr.received_at >= _from and gr.received_at < _to
       and gr.status = 'received' and gr.reversed_at is null
       and po.ordered_at is not null and gr.received_at > po.ordered_at
  )
  select jsonb_build_object(
    'purchase_orders_created', (select count(*) from pos),
    'purchase_orders_received', (select count(*) from pos where status = 'received'),
    'purchase_orders_partially_received', (select count(*) from pos where status = 'partially_received'),
    'purchase_orders_cancelled', (select count(*) from pos where status = 'cancelled'),
    'procurement_value', (select coalesce(sum(grand_total),0) from pos),
    'completion_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status in ('received','closed'))::numeric / count(*) * 100, 2) end from pos),
    'partial_receiving_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status='partially_received')::numeric / count(*) * 100, 2) end from pos),
    'goods_receipts', (select count(*) from receipts),
    'quantity_ordered', (select coalesce(sum(i.quantity_ordered),0) from public.purchase_order_items i
                          join pos on pos.id = i.purchase_order_id),
    'quantity_received', (select coalesce(sum(gi.quantity_accepted),0) from public.goods_receipt_items gi
                           join receipts r on r.id = gi.goods_receipt_id),
    'quantity_damaged', (select coalesce(sum(gi.quantity_damaged),0) from public.goods_receipt_items gi
                          join receipts r on r.id = gi.goods_receipt_id),
    'received_value', (select coalesce(sum(gi.quantity_accepted * gi.unit_cost_snapshot),0)
                         from public.goods_receipt_items gi join receipts r on r.id = gi.goods_receipt_id),
    'avg_lead_time_days', (select case when count(*) = 0 then null else round((avg(sec)/86400)::numeric,1) end from lead),
    'lead_time_sample', (select count(*) from lead)
  ) into _r;
  return _r;
end; $$;

revoke all on function public.analytics_procurement(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_procurement(timestamptz, timestamptz) to authenticated;

create or replace function public.analytics_supplier_spend(
  _from timestamptz, _to timestamptz, _limit integer default 10)
returns table (supplier_id uuid, supplier_name text, purchase_orders bigint,
               ordered_value numeric, received_value numeric, quantity_ordered bigint, quantity_received bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  with pos as (
    select po.id, po.supplier_id, po.grand_total
      from public.purchase_orders po
     where po.created_at >= _from and po.created_at < _to and po.status <> 'draft'
  ), items as (
    select p.supplier_id, sum(i.quantity_ordered) qty_ordered
      from public.purchase_order_items i join pos p on p.id = i.purchase_order_id group by 1
  ), received as (
    select p.supplier_id,
           sum(gi.quantity_accepted) qty_received,
           sum(gi.quantity_accepted * gi.unit_cost_snapshot) value_received
      from public.goods_receipt_items gi
      join public.goods_receipts gr on gr.id = gi.goods_receipt_id
      join pos p on p.id = gr.purchase_order_id
     where gr.status = 'received' and gr.reversed_at is null
     group by 1
  )
  select s.id, s.name, count(distinct p.id)::bigint,
         coalesce(sum(p.grand_total),0),
         coalesce(min(rc.value_received),0),
         coalesce(min(it.qty_ordered),0)::bigint,
         coalesce(min(rc.qty_received),0)::bigint
    from pos p
    join public.suppliers s on s.id = p.supplier_id
    left join items it on it.supplier_id = s.id
    left join received rc on rc.supplier_id = s.id
   group by s.id, s.name
   order by coalesce(sum(p.grand_total),0) desc
   limit greatest(coalesce(_limit,10),1);
end; $$;

revoke all on function public.analytics_supplier_spend(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.analytics_supplier_spend(timestamptz, timestamptz, integer) to authenticated;

create or replace function public.analytics_purchased_products(
  _from timestamptz, _to timestamptz, _limit integer default 10)
returns table (product_id uuid, product_name text, quantity_ordered bigint,
               quantity_received bigint, ordered_value numeric)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  select i.product_id, min(i.product_name_snapshot),
         sum(i.quantity_ordered)::bigint,
         sum(i.quantity_received)::bigint,
         sum(i.line_total)
    from public.purchase_order_items i
    join public.purchase_orders po on po.id = i.purchase_order_id
   where po.created_at >= _from and po.created_at < _to and po.status <> 'draft'
   group by i.product_id
   order by sum(i.line_total) desc
   limit greatest(coalesce(_limit,10),1);
end; $$;

revoke all on function public.analytics_purchased_products(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.analytics_purchased_products(timestamptz, timestamptz, integer) to authenticated;

-- ============ Operations trend (historical patterns, not the live queue) ============
create or replace function public.analytics_operations_trend(
  _from timestamptz, _to timestamptz, _grain text default 'day')
returns table (bucket date, exceptions bigint, returns bigint, failed_deliveries bigint,
               verification_failures bigint, stock_adjustments bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  with b as (
    select generate_series(public.analytics_bucket(_from,_grain),
                           public.analytics_bucket(_to - interval '1 second',_grain),
                           case when _grain='month' then interval '1 month'
                                when _grain='week' then interval '7 days'
                                else interval '1 day' end)::date bucket
  )
  select b.bucket,
    (select count(*) from public.shipment_exceptions e
      where public.analytics_bucket(e.created_at,_grain) = b.bucket)::bigint,
    (select count(*) from public.order_returns r
      where public.analytics_bucket(r.created_at,_grain) = b.bucket)::bigint,
    (select count(*) from public.shipment_events se
      where se.to_status in ('delivery_failed','pickup_failed','lost')
        and public.analytics_bucket(se.created_at,_grain) = b.bucket)::bigint,
    (select count(*) from public.order_verification_events ve
      where ve.to_status in ('failed','unreachable')
        and public.analytics_bucket(ve.created_at,_grain) = b.bucket)::bigint,
    (select count(*) from public.inventory_movements m
      where m.movement_type in ('adjustment_in','adjustment_out','damage','damaged_out')
        and public.analytics_bucket(m.created_at,_grain) = b.bucket)::bigint
  from b order by 1;
end; $$;

revoke all on function public.analytics_operations_trend(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.analytics_operations_trend(timestamptz, timestamptz, text) to authenticated;