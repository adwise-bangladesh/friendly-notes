CREATE OR REPLACE VIEW public.shipment_profit_rollup AS
WITH raw AS (
  SELECT si.shipment_id,
         s.order_id,
         s.status::text AS shipment_status,
         si.order_item_id,
         si.quantity,
         COALESCE(si.delivered_quantity,0) AS d,
         COALESCE(si.refused_quantity,0)   AS rf,
         COALESCE(si.lost_quantity,0)      AS ls,
         COALESCE(si.damaged_quantity,0)   AS dm,
         COALESCE(oi.line_total,0) / NULLIF(oi.quantity,0) AS unit_net_price,
         COALESCE(oi.unit_cost,0) AS unit_cost,
         (oi.unit_cost IS NOT NULL) AS cost_known
    FROM public.shipment_items si
    JOIN public.shipments s   ON s.id = si.shipment_id
    JOIN public.order_items oi ON oi.id = si.order_item_id
), flag AS (
  -- a shipment has item-level outcomes only when at least one quantity was recorded
  SELECT shipment_id, SUM(d + rf + ls + dm) > 0 AS outcomes_recorded
    FROM raw GROUP BY 1
), line AS (
  SELECT r.shipment_id, r.order_id, r.order_item_id, r.quantity,
         -- legacy fallback: a delivered shipment with no recorded outcomes
         -- delivered everything it carried
         CASE WHEN NOT f.outcomes_recorded AND r.shipment_status = 'delivered'
              THEN r.quantity ELSE r.d END AS delivered_quantity,
         r.rf AS refused_quantity, r.ls AS lost_quantity, r.dm AS damaged_quantity,
         r.unit_net_price, r.unit_cost, r.cost_known
    FROM raw r JOIN flag f ON f.shipment_id = r.shipment_id
), ret AS (
  SELECT r.shipment_id,
         ri.order_item_id,
         COALESCE(SUM(ri.quantity_accepted) FILTER (
           WHERE r.status IN ('received','inspected','completed')),0) AS accepted_qty,
         COALESCE(SUM(ri.quantity_received) FILTER (
           WHERE r.status IN ('received','inspected','completed')),0) AS received_qty,
         COALESCE(SUM(ri.quantity_expected),0) AS declared_qty
    FROM public.order_returns r
    JOIN public.order_return_items ri ON ri.return_id = r.id
   WHERE r.shipment_id IS NOT NULL
   GROUP BY 1,2
), agg AS (
  SELECT l.shipment_id,
         l.order_id,
         SUM(l.quantity)::bigint            AS shipped_units,
         SUM(l.delivered_quantity)::bigint  AS delivered_units,
         SUM(l.refused_quantity)::bigint    AS refused_units,
         SUM(l.lost_quantity)::bigint       AS lost_units,
         SUM(l.damaged_quantity)::bigint    AS damaged_units,
         COALESCE(SUM(rt.accepted_qty),0)::bigint AS accepted_return_units,
         COALESCE(SUM(rt.received_qty),0)::bigint AS received_return_units,
         COALESCE(SUM(rt.declared_qty),0)::bigint AS declared_return_units,
         SUM(l.quantity * l.unit_net_price)            AS shipped_line_value,
         SUM(l.delivered_quantity * l.unit_net_price)  AS delivered_line_value,
         COALESCE(SUM(rt.accepted_qty * l.unit_net_price),0) AS returned_line_value,
         SUM(l.quantity * l.unit_cost)                 AS shipped_line_cost,
         SUM((l.delivered_quantity + l.lost_quantity + l.damaged_quantity) * l.unit_cost) AS consumed_line_cost,
         COALESCE(SUM(rt.accepted_qty * l.unit_cost),0) AS recovered_line_cost,
         bool_and(l.cost_known) AS cost_snapshot_complete
    FROM line l
    LEFT JOIN ret rt ON rt.shipment_id = l.shipment_id AND rt.order_item_id = l.order_item_id
   GROUP BY 1,2
), sadj AS (
  SELECT a.shipment_id,
         COALESCE(SUM(a.amount) FILTER (WHERE a.direction='income'),0)
       - COALESCE(SUM(a.amount) FILTER (WHERE a.direction='expense'),0) AS net_adjustment
    FROM public.order_financial_adjustments a
   WHERE a.shipment_id IS NOT NULL AND a.reversed_at IS NULL
   GROUP BY 1
), sett AS (
  SELECT i.shipment_id,
         bool_or(i.actual_collected_amount IS NOT NULL) AS has_actuals,
         bool_or(st.status = 'settled') AS finalized,
         max(st.status::text) AS settlement_status
    FROM public.courier_settlement_items i
    JOIN public.courier_settlements st ON st.id = i.settlement_id
   GROUP BY 1
), disc AS (
  SELECT d.shipment_id, count(*) FILTER (WHERE d.status='open') AS open_discrepancies
    FROM public.courier_settlement_discrepancies d
   WHERE d.shipment_id IS NOT NULL
   GROUP BY 1
), ordv AS (
  SELECT oi.order_id, SUM(COALESCE(oi.line_total,0)) AS order_line_value
    FROM public.order_items oi GROUP BY 1
)
SELECT
  s.id   AS shipment_id,
  s.shipment_number,
  s.order_id,
  o.order_number,
  o.store_id,
  s.status::text AS shipment_status,
  s.courier_account_id,
  s.provider_id,
  s.created_at,
  s.delivered_at,
  a.shipped_units, a.delivered_units, a.refused_units, a.lost_units, a.damaged_units,
  a.declared_return_units, a.received_return_units, a.accepted_return_units,
  a.cost_snapshot_complete,
  CASE WHEN COALESCE(ov.order_line_value,0) = 0 THEN 0
       ELSE a.shipped_line_value / ov.order_line_value END AS shipped_share,
  CASE WHEN COALESCE(ov.order_line_value,0) = 0 THEN 0
       ELSE (a.delivered_line_value - a.returned_line_value) / ov.order_line_value END AS delivered_share,
  a.shipped_line_value,
  a.shipped_line_cost,
  COALESCE(s.booked_delivery_fee, s.quoted_delivery_fee) AS expected_delivery_fee,
  a.delivered_line_value,
  a.returned_line_value,
  a.consumed_line_cost,
  a.recovered_line_cost,
  s.cash_on_delivery_amount AS expected_cod,
  s.collected_amount,
  s.actual_delivery_fee,
  s.cod_fee,
  s.return_charge,
  s.other_courier_charge,
  COALESCE(sa.net_adjustment,0) AS shipment_adjustment,
  COALESCE(dc.open_discrepancies,0)::bigint AS open_discrepancies,
  COALESCE(se.has_actuals,false) AS settlement_has_actuals,
  COALESCE(se.finalized,false)   AS settlement_finalized,
  se.settlement_status
FROM public.shipments s
JOIN public.orders o ON o.id = s.order_id
LEFT JOIN agg  a  ON a.shipment_id = s.id
LEFT JOIN ordv ov ON ov.order_id = s.order_id
LEFT JOIN sadj sa ON sa.shipment_id = s.id
LEFT JOIN sett se ON se.shipment_id = s.id
LEFT JOIN disc dc ON dc.shipment_id = s.id;

ALTER VIEW public.shipment_profit_rollup SET (security_invoker = on);
REVOKE ALL ON public.shipment_profit_rollup FROM PUBLIC, anon;
GRANT SELECT ON public.shipment_profit_rollup TO authenticated, service_role;

-- product analytics: same legacy fallback for delivered quantities
CREATE OR REPLACE FUNCTION public.analytics_product_performance(
  _from timestamptz, _to timestamptz, _limit integer DEFAULT 20,
  _product_id uuid DEFAULT NULL, _store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, variant_id uuid, product_name text, variant_name text, sku text,
  units_ordered bigint, units_returned bigint, revenue numeric, returned_value numeric,
  net_revenue numeric, product_cost numeric, estimated_profit numeric, net_estimated_profit numeric,
  orders bigint, cost_snapshot_complete boolean, variants_grouped boolean,
  units_delivered bigint, units_refused bigint, units_lost bigint, units_damaged bigint,
  realized_revenue numeric, realized_product_cost numeric, realized_profit numeric,
  courier_cost numeric, return_loss numeric,
  estimated_margin numeric, realized_margin numeric)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.analytics_guard(_from, _to);
  PERFORM public.analytics_store_guard(_store_id);
  RETURN QUERY
  WITH lines AS (
    SELECT oi.*, o.id oid,
           COALESCE(oi.line_total,0) / NULLIF(oi.quantity,0) AS unit_net_price
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.created_at >= _from AND o.created_at < _to AND o.status <> 'cancelled'
       AND (_product_id IS NULL OR oi.product_id = _product_id)
       AND (_store_id IS NULL OR o.store_id = _store_id)
  ), returned AS (
    SELECT ri.order_item_id, SUM(ri.quantity_accepted) qty
      FROM public.order_return_items ri
      JOIN public.order_returns ret ON ret.id = ri.return_id
     WHERE ret.status IN ('received','inspected','completed')
     GROUP BY 1
  ), sflag AS (
    SELECT si.shipment_id,
           SUM(COALESCE(si.delivered_quantity,0) + COALESCE(si.refused_quantity,0)
             + COALESCE(si.lost_quantity,0) + COALESCE(si.damaged_quantity,0)) > 0 AS recorded
      FROM public.shipment_items si GROUP BY 1
  ), outcome AS (
    SELECT si.order_item_id,
           SUM(CASE WHEN NOT f.recorded AND s.status = 'delivered'
                    THEN si.quantity ELSE COALESCE(si.delivered_quantity,0) END) delivered,
           SUM(COALESCE(si.refused_quantity,0)) refused,
           SUM(COALESCE(si.lost_quantity,0))    lost,
           SUM(COALESCE(si.damaged_quantity,0)) damaged
      FROM public.shipment_items si
      JOIN public.shipments s ON s.id = si.shipment_id
      JOIN sflag f ON f.shipment_id = si.shipment_id
     WHERE s.status <> 'cancelled'
     GROUP BY 1
  ), courier AS (
    SELECT si.order_item_id,
           SUM( (COALESCE(s.actual_delivery_fee,0) + COALESCE(s.cod_fee,0)
               + COALESCE(s.return_charge,0) + COALESCE(s.other_courier_charge,0))
                * (si.quantity * (COALESCE(oi2.line_total,0)/NULLIF(oi2.quantity,0)))
                / NULLIF(tot.ship_value,0) ) AS cost
      FROM public.shipment_items si
      JOIN public.shipments s ON s.id = si.shipment_id AND s.status <> 'cancelled'
      JOIN public.order_items oi2 ON oi2.id = si.order_item_id
      JOIN LATERAL (
        SELECT SUM(si2.quantity * (COALESCE(oi3.line_total,0)/NULLIF(oi3.quantity,0))) ship_value
          FROM public.shipment_items si2 JOIN public.order_items oi3 ON oi3.id = si2.order_item_id
         WHERE si2.shipment_id = si.shipment_id) tot ON true
     GROUP BY 1
  )
  SELECT l.product_id,
         CASE WHEN _product_id IS NULL THEN NULL::uuid ELSE l.variant_id END,
         MIN(l.product_name),
         CASE WHEN _product_id IS NULL THEN NULL::text ELSE MIN(l.variant_name) END,
         MIN(l.sku),
         SUM(l.quantity)::bigint,
         COALESCE(SUM(r.qty),0)::bigint,
         SUM(l.line_total),
         COALESCE(SUM(COALESCE(r.qty,0) * l.unit_net_price),0),
         SUM(l.line_total) - COALESCE(SUM(COALESCE(r.qty,0) * l.unit_net_price),0),
         SUM(COALESCE(l.unit_cost,0) * l.quantity),
         SUM(l.line_total - COALESCE(l.unit_cost,0) * l.quantity),
         (SUM(l.line_total) - COALESCE(SUM(COALESCE(r.qty,0) * l.unit_net_price),0))
           - SUM(COALESCE(l.unit_cost,0) * GREATEST(l.quantity - COALESCE(r.qty,0), 0)),
         count(DISTINCT l.oid)::bigint,
         bool_and(l.unit_cost IS NOT NULL),
         (_product_id IS NULL),
         COALESCE(SUM(oc.delivered),0)::bigint,
         COALESCE(SUM(oc.refused),0)::bigint,
         COALESCE(SUM(oc.lost),0)::bigint,
         COALESCE(SUM(oc.damaged),0)::bigint,
         COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) - COALESCE(r.qty,0),0) * l.unit_net_price),0),
         COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) + COALESCE(oc.lost,0) + COALESCE(oc.damaged,0)
                        - COALESCE(r.qty,0),0) * COALESCE(l.unit_cost,0)),0),
         COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) - COALESCE(r.qty,0),0) * l.unit_net_price),0)
           - COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) + COALESCE(oc.lost,0) + COALESCE(oc.damaged,0)
                        - COALESCE(r.qty,0),0) * COALESCE(l.unit_cost,0)),0)
           - COALESCE(SUM(cc.cost),0),
         COALESCE(SUM(cc.cost),0),
         COALESCE(SUM(COALESCE(r.qty,0) * l.unit_net_price),0),
         CASE WHEN SUM(l.line_total) > 0
              THEN ROUND(100 * (SUM(l.line_total - COALESCE(l.unit_cost,0) * l.quantity)) / SUM(l.line_total), 1) END,
         CASE WHEN COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) - COALESCE(r.qty,0),0) * l.unit_net_price),0) > 0
              THEN ROUND(100 * (
                   COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) - COALESCE(r.qty,0),0) * l.unit_net_price),0)
                 - COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) + COALESCE(oc.lost,0) + COALESCE(oc.damaged,0)
                        - COALESCE(r.qty,0),0) * COALESCE(l.unit_cost,0)),0)
                 - COALESCE(SUM(cc.cost),0))
                 / COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) - COALESCE(r.qty,0),0) * l.unit_net_price),0), 1) END
    FROM lines l
    LEFT JOIN returned r ON r.order_item_id = l.id
    LEFT JOIN outcome oc ON oc.order_item_id = l.id
    LEFT JOIN courier cc ON cc.order_item_id = l.id
   GROUP BY l.product_id, CASE WHEN _product_id IS NULL THEN NULL::uuid ELSE l.variant_id END
   ORDER BY SUM(l.line_total) DESC
   LIMIT GREATEST(COALESCE(_limit,20), 1);
END; $$;

REVOKE ALL ON FUNCTION public.analytics_product_performance(timestamptz, timestamptz, integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_product_performance(timestamptz, timestamptz, integer, uuid, uuid) TO authenticated, service_role;