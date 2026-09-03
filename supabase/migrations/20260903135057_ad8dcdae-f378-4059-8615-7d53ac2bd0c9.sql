-- ============================================================
-- STEP 20.6.1 — AI, Automation & Analytics Integrity Fixes
-- ============================================================

-- ---------- P3: role read access ----------
-- user_roles SELECT policy calls is_admin(); authenticated could not execute it,
-- so the policy failed closed for everyone. is_admin is the canonical
-- security-definer role helper and is the only helper exposed here.
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- ---------- Security cleanup: remove PUBLIC/anon execution ----------
REVOKE ALL ON FUNCTION public.automation_registry() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.automation_max_depth() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_bucket(timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.automation_registry() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.automation_max_depth() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_bucket(timestamptz, text) TO authenticated, service_role;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname = 'automation_validate_rule' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
  END LOOP;
END $$;

-- ---------- Analytics: store scope guard ----------
CREATE OR REPLACE FUNCTION public.analytics_store_guard(_store_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
begin
  if _store_id is null then return; end if;
  if not exists (select 1 from public.stores s where s.id = _store_id) then
    raise exception 'That store could not be found';
  end if;
end; $$;

-- ---------- P1: analytics_overview ----------
DROP FUNCTION IF EXISTS public.analytics_overview(timestamptz, timestamptz, order_source);

CREATE OR REPLACE FUNCTION public.analytics_overview(
  _from timestamptz, _to timestamptz,
  _source order_source DEFAULT NULL, _store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);
  perform public.analytics_store_guard(_store_id);

  with scoped as (
    select f.* from public.order_financial_rollup f
      join public.orders o on o.id = f.order_id
     where f.created_at >= _from and f.created_at < _to
       and (_source is null or f.source = _source)
       and (_store_id is null or o.store_id = _store_id)
  ), live as (
    select * from scoped where status <> 'cancelled'
  ),
  -- Delivered merchandise value: only quantities on FULLY delivered shipments
  -- count, mirroring refresh_order_delivery_status(). Cancelled orders never
  -- contribute. Multiple shipments of one order each contribute their own lines.
  delivered_lines as (
    select o.id as order_id,
           sum(si.quantity * (oi.line_total / nullif(oi.quantity,0))) as delivered_value
      from public.shipments s
      join public.shipment_items si on si.shipment_id = s.id
      join public.order_items oi on oi.id = si.order_item_id
      join public.orders o on o.id = s.order_id
     where s.status = 'delivered'
       and s.delivered_at >= _from and s.delivered_at < _to
       and o.status <> 'cancelled'
       and (_source is null or o.source = _source)
       and (_store_id is null or o.store_id = _store_id)
     group by o.id
  ), delivered_set as (
    select o.id, o.delivery_status, r.actual_profit
      from public.orders o
      join public.order_financial_rollup r on r.order_id = o.id
     where o.status <> 'cancelled'
       and (_source is null or o.source = _source)
       and (_store_id is null or o.store_id = _store_id)
       and exists (select 1 from public.shipments s
                    where s.order_id = o.id
                      and s.status in ('delivered','partial_delivered')
                      and s.delivered_at >= _from and s.delivered_at < _to)
  ), returned_orders as (
    select count(distinct ret.order_id) c
      from public.order_returns ret
      join public.orders o on o.id = ret.order_id
     where ret.created_at >= _from and ret.created_at < _to
       and (_store_id is null or o.store_id = _store_id)
  ), cust as (
    select o.customer_id,
           min(o.created_at) over (partition by o.customer_id) as first_order_at
      from public.orders o
     where o.status <> 'cancelled' and o.customer_id is not null
       and (_store_id is null or o.store_id = _store_id)
  ), cust_period as (
    select count(distinct customer_id) filter (where first_order_at >= _from and first_order_at < _to) as new_customers
      from cust
  ), repeat_cust as (
    select count(*) c from (
      select o.customer_id from public.orders o
       where o.status <> 'cancelled' and o.customer_id is not null
         and o.created_at >= _from and o.created_at < _to
         and (_store_id is null or o.store_id = _store_id)
       group by o.customer_id having count(*) > 1) x
  ), ship_stats as (
    select count(*) total,
           count(*) filter (where s.status = 'delivered') delivered,
           count(*) filter (where s.status = 'partial_delivered') partial,
           count(*) filter (where s.status in ('delivery_failed','pickup_failed','lost')) failed
      from public.shipments s
      join public.orders o on o.id = s.order_id
     where s.created_at >= _from and s.created_at < _to and s.status <> 'cancelled'
       and (_store_id is null or o.store_id = _store_id)
  )
  select jsonb_build_object(
    'total_orders', (select count(*) from scoped),
    'live_orders', (select count(*) from live),
    'cancelled_orders', (select count(*) from scoped where status = 'cancelled'),
    'order_revenue', (select coalesce(sum(grand_total),0) from live),
    'cancelled_revenue', (select coalesce(sum(grand_total),0) from scoped where status = 'cancelled'),
    -- delivered merchandise value (quantity-accurate); delivered_revenue kept as an alias
    'delivered_merchandise_value', (select coalesce(sum(delivered_value),0) from delivered_lines),
    'delivered_revenue', (select coalesce(sum(delivered_value),0) from delivered_lines),
    'fully_delivered_orders', (select count(*) from delivered_set where delivery_status = 'delivered'),
    'partially_delivered_orders', (select count(*) from delivered_set
                                    where delivery_status in ('partially_delivered','partially_returned')),
    'delivered_orders', (select count(*) from delivered_set where delivery_status = 'delivered'),
    -- realized money, taken straight from the financial rollup (order cohort basis)
    'collected_revenue', (select coalesce(sum(collected_amount),0) from live),
    'refunded_amount', (select coalesce(sum(refunded_amount),0) from live),
    'net_collected_revenue', (select coalesce(sum(collected_amount - refunded_amount),0) from live),
    'estimated_profit', (select coalesce(sum(estimated_profit),0) from live),
    'actual_profit', (select coalesce(sum(actual_profit),0) from delivered_set),
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

-- ---------- P2: analytics_orders with store scope ----------
DROP FUNCTION IF EXISTS public.analytics_orders(timestamptz, timestamptz, order_source);

CREATE OR REPLACE FUNCTION public.analytics_orders(
  _from timestamptz, _to timestamptz,
  _source order_source DEFAULT NULL, _store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);
  perform public.analytics_store_guard(_store_id);
  with scoped as (
    select o.* from public.orders o
     where o.created_at >= _from and o.created_at < _to
       and (_source is null or o.source = _source)
       and (_store_id is null or o.store_id = _store_id)
  )
  select jsonb_build_object(
    'created', (select count(*) from scoped),
    'cancelled', (select count(*) from scoped where status='cancelled'),
    'verified', (select count(*) from scoped where verification_status in ('confirmed','not_required')),
    'fulfilled', (select count(*) from scoped where fulfillment_status in ('packed','ready_for_courier')),
    'fulfillment_in_progress', (select count(*) from scoped where fulfillment_status in ('ready','picking','picked','packing')),
    'shipped', (select count(distinct s.order_id) from public.shipments s join scoped o on o.id = s.order_id
                 where s.status <> 'cancelled' and s.booked_at is not null),
    'delivered', (select count(*) from scoped where delivery_status = 'delivered'),
    'partially_delivered', (select count(*) from scoped where delivery_status in ('partially_delivered','partially_returned')),
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
            join public.orders o on o.id = a.order_id
           where a.created_at >= _from and a.created_at < _to
             and (_store_id is null or o.store_id = _store_id)
           group by 1) y),
      'attempts', (select count(*) from public.order_verification_attempts a
                    join public.orders o on o.id = a.order_id
                   where a.created_at >= _from and a.created_at < _to
                     and (_store_id is null or o.store_id = _store_id)))
  ) into _r;
  return _r;
end; $$;

-- ---------- P1/P2: analytics_sales_trend ----------
DROP FUNCTION IF EXISTS public.analytics_sales_trend(timestamptz, timestamptz, text, order_source);

CREATE OR REPLACE FUNCTION public.analytics_sales_trend(
  _from timestamptz, _to timestamptz, _grain text DEFAULT 'day',
  _source order_source DEFAULT NULL, _store_id uuid DEFAULT NULL)
RETURNS TABLE(bucket date, orders bigint, revenue numeric, discounts numeric, shipping numeric,
              net_product_revenue numeric, cancelled_revenue numeric, delivered_revenue numeric,
              average_order_value numeric)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
begin
  perform public.analytics_guard(_from, _to);
  perform public.analytics_store_guard(_store_id);
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
       and (_store_id is null or o.store_id = _store_id)
     group by 1
  ), delivered as (
    -- quantity-accurate delivered merchandise value, bucketed by delivery date
    select public.analytics_bucket(s.delivered_at, _grain) b,
           coalesce(sum(si.quantity * (oi.line_total / nullif(oi.quantity,0))),0) delivered_revenue
      from public.shipments s
      join public.shipment_items si on si.shipment_id = s.id
      join public.order_items oi on oi.id = si.order_item_id
      join public.orders o on o.id = s.order_id
     where s.status = 'delivered'
       and s.delivered_at >= _from and s.delivered_at < _to
       and o.status <> 'cancelled'
       and (_source is null or o.source = _source)
       and (_store_id is null or o.store_id = _store_id)
     group by 1
  )
  select coalesce(c.b, dl.b) as bucket,
         coalesce(c.orders,0), coalesce(c.revenue,0), coalesce(c.discounts,0), coalesce(c.shipping,0),
         coalesce(c.netp,0), coalesce(c.cancelled,0), coalesce(dl.delivered_revenue,0),
         case when coalesce(c.orders,0) = 0 then null else round(c.revenue / c.orders, 2) end
    from created c
    full outer join delivered dl on dl.b = c.b
   order by 1;
end; $$;

-- ---------- P4: procurement consistency ----------
CREATE OR REPLACE FUNCTION public.analytics_procurement(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
declare _r jsonb;
begin
  perform public.analytics_guard(_from, _to);
  with all_pos as (
    select po.* from public.purchase_orders po
     where po.created_at >= _from and po.created_at < _to and po.status <> 'draft'
  ), pos as (
    -- effective (non-cancelled) purchase orders, matching analytics_supplier_spend
    select * from all_pos where status <> 'cancelled'
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
    'purchase_orders_created', (select count(*) from all_pos),
    'purchase_orders_effective', (select count(*) from pos),
    'purchase_orders_received', (select count(*) from pos where status = 'received'),
    'purchase_orders_partially_received', (select count(*) from pos where status = 'partially_received'),
    'purchase_orders_cancelled', (select count(*) from all_pos where status = 'cancelled'),
    'procurement_value', (select coalesce(sum(grand_total),0) from pos),
    'cancelled_value', (select coalesce(sum(grand_total),0) from all_pos where status = 'cancelled'),
    'completion_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status in ('received','closed'))::numeric / count(*) * 100, 2) end from pos),
    'partial_receiving_rate', (select case when count(*) = 0 then null else
        round(count(*) filter (where status='partially_received')::numeric / count(*) * 100, 2) end from pos),
    'goods_receipts', (select count(*) from receipts),
    'quantity_ordered', (select coalesce(sum(i.quantity_ordered),0) from public.purchase_order_items i
                          join pos on pos.id = i.purchase_order_id),
    'quantity_cancelled', (select coalesce(sum(i.quantity_ordered),0) from public.purchase_order_items i
                            join all_pos c on c.id = i.purchase_order_id and c.status = 'cancelled'),
    'quantity_received', (select coalesce(sum(gi.quantity_accepted),0) from public.goods_receipt_items gi
                           join receipts r on r.id = gi.goods_receipt_id),
    'quantity_damaged', (select coalesce(sum(gi.quantity_damaged),0) from public.goods_receipt_items gi
                          join receipts r on r.id = gi.goods_receipt_id),
    'quantity_outstanding', greatest(
        (select coalesce(sum(i.quantity_ordered),0) from public.purchase_order_items i
          join pos on pos.id = i.purchase_order_id)
      - (select coalesce(sum(i.quantity_received),0) from public.purchase_order_items i
          join pos on pos.id = i.purchase_order_id), 0),
    'received_value', (select coalesce(sum(gi.quantity_accepted * gi.unit_cost_snapshot),0)
                         from public.goods_receipt_items gi join receipts r on r.id = gi.goods_receipt_id),
    'avg_lead_time_days', (select case when count(*) = 0 then null else round((avg(sec)/86400)::numeric,1) end from lead),
    'lead_time_sample', (select count(*) from lead)
  ) into _r;
  return _r;
end; $$;

-- ---------- P7: movement summary semantics ----------
DROP FUNCTION IF EXISTS public.analytics_movement_summary(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.analytics_movement_summary(_from timestamptz, _to timestamptz)
RETURNS TABLE(movement_type text, category text, movements bigint,
              total_quantity bigint, net_quantity bigint)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
begin
  perform public.analytics_guard(_from, _to);
  return query
  select m.movement_type::text,
         case when m.movement_type in ('reservation','release_reservation')
              then 'logical' else 'physical' end::text,
         count(*)::bigint,
         sum(abs(m.quantity))::bigint,
         sum(m.quantity)::bigint
    from public.inventory_movements m
   where m.created_at >= _from and m.created_at < _to
   group by 1, 2
   order by 3 desc;
end; $$;

-- ---------- P7: inventory valuation basis is explicit ----------
CREATE OR REPLACE FUNCTION public.analytics_inventory()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
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
    'valuation_basis', 'current_catalog_cost',
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

-- ---------- P7: product performance, return aware + store scope ----------
DROP FUNCTION IF EXISTS public.analytics_product_performance(timestamptz, timestamptz, integer, uuid);

CREATE OR REPLACE FUNCTION public.analytics_product_performance(
  _from timestamptz, _to timestamptz, _limit integer DEFAULT 20,
  _product_id uuid DEFAULT NULL, _store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, variant_id uuid, product_name text, variant_name text, sku text,
              units_ordered bigint, units_returned bigint, revenue numeric, returned_value numeric,
              net_revenue numeric, product_cost numeric, estimated_profit numeric,
              net_estimated_profit numeric, orders bigint, cost_snapshot_complete boolean,
              variants_grouped boolean)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
begin
  perform public.analytics_guard(_from, _to);
  perform public.analytics_store_guard(_store_id);
  return query
  with lines as (
    select oi.*, o.id oid
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.created_at >= _from and o.created_at < _to and o.status <> 'cancelled'
       and (_product_id is null or oi.product_id = _product_id)
       and (_store_id is null or o.store_id = _store_id)
  ), returned as (
    -- authoritative accepted return quantities, same filter as order_financial_rollup
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
         coalesce(sum(coalesce(r.qty,0) * (l.line_total / nullif(l.quantity,0))),0),
         sum(l.line_total) - coalesce(sum(coalesce(r.qty,0) * (l.line_total / nullif(l.quantity,0))),0),
         sum(coalesce(l.unit_cost,0) * l.quantity),
         sum(l.line_total - coalesce(l.unit_cost,0) * l.quantity),
         (sum(l.line_total) - coalesce(sum(coalesce(r.qty,0) * (l.line_total / nullif(l.quantity,0))),0))
           - sum(coalesce(l.unit_cost,0) * greatest(l.quantity - coalesce(r.qty,0), 0)),
         count(distinct l.oid)::bigint,
         bool_and(l.unit_cost is not null),
         (_product_id is null)
    from lines l
    left join returned r on r.order_item_id = l.id
   group by l.product_id, case when _product_id is null then null::uuid else l.variant_id end
   order by sum(l.line_total) desc
   limit greatest(coalesce(_limit,20), 1);
end; $$;

-- ---------- P5: AI insight freshness & supersession ----------
ALTER TABLE public.ai_insights
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_run_id uuid REFERENCES public.ai_analysis_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_insights_scope_idx
  ON public.ai_insights (entity_type, entity_id, status);

CREATE OR REPLACE FUNCTION public.ai_protect_insight_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI insight content is immutable; only the review status may change';
  END IF;
  -- supersession is recorded once and never rewritten
  IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
    RAISE EXCEPTION 'An insight that is already superseded cannot be re-superseded';
  END IF;
  RETURN NEW;
END; $$;

-- default freshness window for insights that do not carry their own expiry
CREATE OR REPLACE FUNCTION public.ai_default_insight_ttl()
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT interval '14 days' $$;
REVOKE ALL ON FUNCTION public.ai_default_insight_ttl() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_default_insight_ttl() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_complete_analysis_run(_run_id uuid, _payload jsonb)
RETURNS ai_analysis_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.ai_analysis_runs;
  item jsonb; ins_id uuid; n_ins int := 0; n_rec int := 0; key_map jsonb := '{}'::jsonb;
  _title text; _summary text; n_sup int := 0;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to update an AI analysis';
  END IF;
  SELECT * INTO r FROM public.ai_analysis_runs WHERE id = _run_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Analysis run not found'; END IF;
  IF r.status = 'completed' THEN
    RAISE EXCEPTION 'This analysis has already been completed — start a new analysis instead';
  ELSIF r.status NOT IN ('queued','running') THEN
    RAISE EXCEPTION 'This analysis is already closed (%) and cannot be completed', r.status;
  END IF;
  IF jsonb_typeof(coalesce(_payload->'insights', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(_payload->'recommendations', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'The analysis result is malformed — insights and recommendations must be lists';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'insights', '[]'::jsonb)) LOOP
    _title := btrim(coalesce(item->>'title',''));
    _summary := btrim(coalesce(item->>'summary',''));
    IF length(_title) < 8 OR length(_title) > 160 THEN
      RAISE EXCEPTION 'Each insight needs a title between 8 and 160 characters (got "%")', left(_title, 40);
    END IF;
    IF length(_summary) < 8 THEN
      RAISE EXCEPTION 'The insight "%" needs a summary of at least 8 characters', left(_title, 40);
    END IF;
    IF length(_summary) > 4000 THEN
      RAISE EXCEPTION 'The summary for insight "%" is too long (max 4000 characters)', left(_title, 40);
    END IF;
    IF nullif(item->>'category','') IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.ai_insight_category)) e
                       WHERE e::text = item->>'category') THEN
      RAISE EXCEPTION 'The insight "%" has an unsupported category', left(_title, 40);
    END IF;
    IF nullif(item->>'severity','') IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.ai_insight_severity)) e
                       WHERE e::text = item->>'severity') THEN
      RAISE EXCEPTION 'The insight "%" has an unsupported severity', left(_title, 40);
    END IF;
    IF nullif(item->>'entity_id','') IS NOT NULL
       AND nullif(item->>'entity_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'The insight "%" references an invalid record', left(_title, 40);
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'recommendations', '[]'::jsonb)) LOOP
    _title := btrim(coalesce(item->>'title',''));
    IF length(_title) < 8 OR length(_title) > 160 THEN
      RAISE EXCEPTION 'Each recommendation needs a title between 8 and 160 characters (got "%")', left(_title, 40);
    END IF;
    IF length(btrim(coalesce(item->>'description',''))) < 8 THEN
      RAISE EXCEPTION 'The recommendation "%" needs a description of at least 8 characters', left(_title, 40);
    END IF;
    IF nullif(item->>'priority','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.ai_recommendation_priority)) e
                        WHERE e::text = item->>'priority') THEN
      RAISE EXCEPTION 'The recommendation "%" has an unsupported priority', left(_title, 40);
    END IF;
    IF nullif(item->>'insight_key','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_payload->'insights','[]'::jsonb)) i
                        WHERE i->>'key' = item->>'insight_key') THEN
      RAISE EXCEPTION 'The recommendation "%" refers to an insight that is not part of this result', left(_title, 40);
    END IF;
  END LOOP;

  -- Supersede the previous still-current insights for the SAME analysis scope
  -- (analysis type + entity type + entity id). Nothing is deleted or rewritten:
  -- the row keeps its content, run link and history, and only gains a marker.
  UPDATE public.ai_insights i
     SET superseded_at = now(), superseded_by_run_id = r.id
    FROM public.ai_analysis_runs prev
   WHERE prev.id = i.analysis_run_id
     AND prev.id <> r.id
     AND prev.analysis_type = r.analysis_type
     AND prev.entity_type IS NOT DISTINCT FROM r.entity_type
     AND prev.entity_id IS NOT DISTINCT FROM r.entity_id
     AND i.status = 'active'
     AND i.superseded_at IS NULL;
  GET DIAGNOSTICS n_sup = ROW_COUNT;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'insights', '[]'::jsonb)) LOOP
    INSERT INTO public.ai_insights (analysis_run_id, entity_type, entity_id, category, severity,
                                    title, summary, confidence, evidence, expires_at)
    VALUES (r.id,
            coalesce(nullif(item->>'entity_type',''), r.entity_type),
            nullif(item->>'entity_id','')::uuid,
            (item->>'category')::public.ai_insight_category,
            (item->>'severity')::public.ai_insight_severity,
            btrim(item->>'title'), btrim(item->>'summary'),
            LEAST(1, GREATEST(0, coalesce((item->>'confidence')::numeric, 0.5))),
            coalesce(item->'evidence', '{}'::jsonb),
            coalesce(nullif(item->>'expires_at','')::timestamptz,
                     now() + public.ai_default_insight_ttl()))
    RETURNING id INTO ins_id;
    n_ins := n_ins + 1;
    IF nullif(item->>'key','') IS NOT NULL THEN
      key_map := key_map || jsonb_build_object(item->>'key', ins_id::text);
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'recommendations', '[]'::jsonb)) LOOP
    INSERT INTO public.ai_recommendations (analysis_run_id, insight_id, entity_type, entity_id,
                                           recommendation_type, priority, title, description,
                                           suggested_action, action_target, confidence)
    VALUES (r.id,
            nullif(key_map->>coalesce(item->>'insight_key',''), '')::uuid,
            coalesce(nullif(item->>'entity_type',''), r.entity_type),
            nullif(item->>'entity_id','')::uuid,
            coalesce(nullif(item->>'recommendation_type',''), 'review'),
            (coalesce(nullif(item->>'priority',''), 'medium'))::public.ai_recommendation_priority,
            btrim(item->>'title'), btrim(item->>'description'),
            nullif(item->>'suggested_action',''), nullif(item->>'action_target',''),
            LEAST(1, GREATEST(0, coalesce((item->>'confidence')::numeric, 0.5))));
    n_rec := n_rec + 1;
  END LOOP;

  UPDATE public.ai_analysis_runs
     SET status = 'completed', completed_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - coalesce(started_at, created_at))) * 1000)::int),
         insight_count = n_ins, recommendation_count = n_rec,
         summary = left(nullif(_payload->>'summary',''), 2000)
   WHERE id = r.id AND status IN ('queued','running') RETURNING * INTO r;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'This analysis was closed by another process — nothing was recorded';
  END IF;

  INSERT INTO public.ai_brain_events (event_type, run_id, actor_id, message)
  VALUES ('analysis_completed', r.id, auth.uid(),
          format('Analysis completed with %s insights and %s recommendations%s',
                 n_ins, n_rec,
                 case when n_sup > 0 then format(' (superseded %s earlier insight(s))', n_sup) else '' end));
  RETURN r;
END; $$;

-- Freshness state, derived (never stored) so it can never drift.
CREATE OR REPLACE FUNCTION public.ai_insight_freshness(_insight public.ai_insights)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _insight.status <> 'active' THEN 'reviewed'
    WHEN _insight.superseded_at IS NOT NULL THEN 'superseded'
    WHEN _insight.expires_at IS NOT NULL AND _insight.expires_at <= now() THEN 'expired'
    ELSE 'current' END;
$$;
REVOKE ALL ON FUNCTION public.ai_insight_freshness(public.ai_insights) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_insight_freshness(public.ai_insights) TO authenticated, service_role;

-- Brain overview now counts only genuinely current insights.
CREATE OR REPLACE FUNCTION public.ai_brain_overview()
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'active_insights', (SELECT count(*) FROM public.ai_insights
                         WHERE status = 'active' AND superseded_at IS NULL
                           AND (expires_at IS NULL OR expires_at > now())),
    'critical_insights', (SELECT count(*) FROM public.ai_insights
                           WHERE status = 'active' AND superseded_at IS NULL
                             AND (expires_at IS NULL OR expires_at > now())
                             AND severity IN ('critical','high')),
    'superseded_insights', (SELECT count(*) FROM public.ai_insights
                             WHERE status = 'active' AND superseded_at IS NOT NULL),
    'expired_insights', (SELECT count(*) FROM public.ai_insights
                          WHERE status = 'active' AND superseded_at IS NULL
                            AND expires_at IS NOT NULL AND expires_at <= now()),
    'pending_recommendations', (SELECT count(*) FROM public.ai_recommendations WHERE status = 'pending'),
    'runs_last_7_days', (SELECT count(*) FROM public.ai_analysis_runs WHERE created_at > now() - interval '7 days'),
    'failed_runs_last_7_days', (SELECT count(*) FROM public.ai_analysis_runs WHERE status = 'failed' AND created_at > now() - interval '7 days'),
    'last_completed_at', (SELECT max(completed_at) FROM public.ai_analysis_runs WHERE status = 'completed')
  );
$$;

-- ---------- P6: automation failure semantics (explicit fail-once + authorised replay) ----------
CREATE UNIQUE INDEX IF NOT EXISTS automation_notes_execution_uniq
  ON public.automation_notes (execution_id) WHERE execution_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.automation_max_replays()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT 3 $$;
REVOKE ALL ON FUNCTION public.automation_max_replays() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.automation_max_replays() TO authenticated, service_role;

-- Notes now carry a durable attribution row keyed on the execution, so a replay
-- of the same execution can never write the note twice.
CREATE OR REPLACE FUNCTION public.automation_execute_action(_rule automation_rules, _ctx jsonb, _execution_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  _order_id uuid := nullif(_ctx->>'order_id','')::uuid;
  _note text;
begin
  case _rule.action_type
    when 'set_verification_priority' then
      if _order_id is null then raise exception 'No order is linked to this event'; end if;
      perform public.set_order_verification_priority(_order_id, (_rule.action_config->>'priority')::public.verification_priority);
      return jsonb_build_object('action','set_verification_priority','order_id',_order_id,
                                'priority', _rule.action_config->>'priority');

    when 'move_to_manual_review' then
      if _order_id is null then raise exception 'No order is linked to this event'; end if;
      perform public.set_order_verification_state(_order_id, 'manual_review', _rule.action_config->>'reason');
      return jsonb_build_object('action','move_to_manual_review','order_id',_order_id);

    when 'assign_operational_work' then
      if (_ctx->>'assignment_source_type') is null or (_ctx->>'assignment_source_id') is null then
        raise exception 'This event has no assignable work item'; end if;
      if exists (select 1 from public.operational_assignments a
                  where a.source_type = (_ctx->>'assignment_source_type')::public.operation_source_type
                    and a.source_id = (_ctx->>'assignment_source_id')::uuid
                    and a.released_at is null) then
        return jsonb_build_object('action','assign_operational_work','skipped','already_assigned');
      end if;
      perform public.assign_operational_work(
        (_ctx->>'assignment_source_type')::public.operation_source_type,
        (_ctx->>'assignment_source_id')::uuid,
        (_rule.action_config->>'assigned_to')::uuid,
        'Assigned automatically by rule: ' || _rule.name);
      return jsonb_build_object('action','assign_operational_work',
        'assigned_to', _rule.action_config->>'assigned_to');

    when 'create_internal_note' then
      _note := 'Automated by rule: ' || _rule.name || ' — ' || (_rule.action_config->>'note');

      if exists (select 1 from public.automation_notes n where n.execution_id = _execution_id) then
        return jsonb_build_object('action','create_internal_note','skipped','already_written');
      end if;

      -- attribution record first: rule + execution identity, guarded table,
      -- unique per execution so a replay cannot duplicate the side effect
      perform set_config('app.automation_write','on', true);
      insert into public.automation_notes (entity_type, entity_id, note, rule_id, execution_id)
      values (coalesce(_ctx->>'entity_type','order'),
              coalesce(nullif(_ctx->>'entity_id','')::uuid, _order_id), _note, _rule.id, _execution_id);
      perform set_config('app.automation_write','off', true);

      if _order_id is not null then
        insert into public.order_notes (order_id, note, note_type, is_internal, created_by)
        values (_order_id, _note, 'system', true, null);
        return jsonb_build_object('action','create_internal_note','target','order','order_id',_order_id);
      elsif _ctx->>'purchase_order_id' is not null then
        perform public.log_purchase_order_event(
          (_ctx->>'purchase_order_id')::uuid, 'note_added', _note, null, null,
          jsonb_build_object('automation_rule_id', _rule.id, 'origin', 'automation'));
        return jsonb_build_object('action','create_internal_note','target','purchase_order');
      else
        return jsonb_build_object('action','create_internal_note','target','automation_note');
      end if;
  end case;
  raise exception 'Unsupported automation action';
end; $$;

-- Authorised replay of a FAILED execution. The original row is never modified;
-- a new attempt is appended under a derived event id so the unique
-- (rule_id, source_event_id) idempotency key still holds.
CREATE OR REPLACE FUNCTION public.automation_replay_execution(_execution_id uuid)
RETURNS public.automation_rule_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  e public.automation_rule_executions;
  r public.automation_rules;
  root text; attempts int; new_id uuid; res jsonb; ctx jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an owner or admin can replay an automation run';
  end if;

  select * into e from public.automation_rule_executions where id = _execution_id;
  if e.id is null then raise exception 'That automation run could not be found'; end if;
  if e.status <> 'failed' then
    raise exception 'Only a failed automation run can be replayed (this one is %)', e.status;
  end if;

  root := split_part(e.source_event_id, '#replay:', 1);

  select * into r from public.automation_rules where id = e.rule_id;
  if r.id is null then raise exception 'The rule behind this run no longer exists'; end if;
  if r.status <> 'active' then
    raise exception 'The rule "%" is not active, so it cannot be replayed', r.name;
  end if;

  select count(*) into attempts from public.automation_rule_executions x
   where x.rule_id = e.rule_id and x.source_event_id like root || '#replay:%';
  if attempts >= public.automation_max_replays() then
    raise exception 'This automation run has already been replayed % times', attempts;
  end if;

  ctx := coalesce(e.input_snapshot, '{}'::jsonb)
      || jsonb_build_object('replay_of', e.id::text, 'root_event_id', root, 'replay_attempt', attempts + 1);

  perform set_config('app.automation_write', 'on', true);
  insert into public.automation_rule_executions
    (rule_id, source_event_id, event_type, entity_type, entity_id, status, input_snapshot,
     automation_depth, started_at)
  values (e.rule_id, root || '#replay:' || (attempts + 1)::text, e.event_type, e.entity_type,
          e.entity_id, 'running', ctx, e.automation_depth, now())
  returning id into new_id;
  perform set_config('app.automation_write', 'off', true);

  begin
    perform set_config('app.automation_rule_chain', '|' || r.id::text, true);
    res := public.automation_execute_action(r, ctx, new_id);
    perform set_config('app.automation_rule_chain', '', true);
    perform set_config('app.automation_write', 'on', true);
    update public.automation_rule_executions
       set status = 'completed', result = res, completed_at = now() where id = new_id;
    perform set_config('app.automation_write', 'off', true);
  exception when others then
    perform set_config('app.automation_rule_chain', '', true);
    perform set_config('app.automation_write', 'on', true);
    update public.automation_rule_executions
       set status = 'failed', error_message = public.automation_sanitize_error(SQLERRM),
           result = jsonb_build_object('action', r.action_type::text, 'replay_of', e.id::text),
           completed_at = now()
     where id = new_id;
    perform set_config('app.automation_write', 'off', true);
  end;

  select * into e from public.automation_rule_executions where id = new_id;
  return e;
end; $$;

REVOKE ALL ON FUNCTION public.automation_replay_execution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.automation_replay_execution(uuid) TO authenticated, service_role;

-- keep the new analytics signatures reachable, and no wider than before
REVOKE ALL ON FUNCTION public.analytics_overview(timestamptz, timestamptz, order_source, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_orders(timestamptz, timestamptz, order_source, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_sales_trend(timestamptz, timestamptz, text, order_source, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_product_performance(timestamptz, timestamptz, integer, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_movement_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_store_guard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_overview(timestamptz, timestamptz, order_source, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_orders(timestamptz, timestamptz, order_source, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_sales_trend(timestamptz, timestamptz, text, order_source, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_product_performance(timestamptz, timestamptz, integer, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_movement_summary(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_store_guard(uuid) TO authenticated, service_role;