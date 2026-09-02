create or replace function public.operations_recent_activity(_limit integer default 15)
returns table (
  id uuid,
  category text,
  event_type text,
  message text,
  reference text,
  href text,
  created_at timestamptz,
  actor_name text
)
language sql stable security invoker set search_path = public as $$
with ev as (
  select e.id, 'verification'::text category, e.event_type::text, e.message,
         o.order_number reference, '/orders/' || o.order_id_href href, e.created_at, e.created_by
  from (select ve.*, ve.order_id as oid from public.order_verification_events ve) e
  join (select id, order_number, id::text order_id_href from public.orders) o on o.id = e.oid
  union all
  select e.id, 'fulfillment', e.event_type::text, e.message, o.order_number,
         '/orders/fulfillments/' || e.fulfillment_id::text, e.created_at, e.created_by
  from public.order_fulfillment_events e join public.orders o on o.id = e.order_id
  union all
  select e.id, 'shipping', e.event_type::text, e.message, s.shipment_number,
         '/orders/shipments/' || e.shipment_id::text, e.created_at, e.created_by
  from public.shipment_events e join public.shipments s on s.id = e.shipment_id
  union all
  select e.id, 'return', e.event_type::text, e.message, r.return_number,
         '/returns/' || e.return_id::text, e.created_at, e.created_by
  from public.order_return_events e join public.order_returns r on r.id = e.return_id
  union all
  select e.id, 'procurement', e.event_type::text, e.message, po.purchase_order_number,
         '/procurement/purchase-orders/' || po.id::text, e.created_at, e.created_by
  from public.purchase_order_events e join public.purchase_orders po on po.id = e.purchase_order_id
)
select ev.id, ev.category, ev.event_type, ev.message, ev.reference, ev.href, ev.created_at, p.full_name
from ev left join public.profiles p on p.id = ev.created_by
order by ev.created_at desc
limit greatest(coalesce(_limit, 15), 1);
$$;

revoke all on function public.operations_recent_activity(integer) from public, anon;
grant execute on function public.operations_recent_activity(integer) to authenticated;
grant execute on function public.operations_recent_activity(integer) to supabase_read_only_user;