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
    'fulfilled', (select count(*) from scoped where fulfillment_status in ('packed','ready_for_courier')),
    'fulfillment_in_progress', (select count(*) from scoped where fulfillment_status in ('ready','picking','picked','packing')),
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