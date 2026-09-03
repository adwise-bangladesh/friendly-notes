-- =====================================================================
-- STEP 20.8.3.7 — Realized vs Estimated Profit & Loss Analytics
-- Read-only projections built on the existing authoritative records.
--
-- ATTRIBUTION RULES (deterministic, documented):
--  * unit net price  = order_items.line_total / order_items.quantity
--                      (already net of the line discount, frozen snapshot)
--  * unit cost       = order_items.unit_cost (immutable snapshot; today's
--                      catalog cost is never used)
--  * order discount and customer-paid shipping are allocated to a shipment
--    pro rata on line value: shipped value share for estimated figures,
--    delivered value share for realized figures.
--  * product cost is consumed by delivered + lost + damaged quantities and
--    recovered only by ACCEPTED return quantities (courier-declared returns
--    recover nothing).
--  * shipment-scoped financial adjustments belong to that shipment;
--    order-level adjustments, refunds and packing stay at order level only.
-- =====================================================================

CREATE OR REPLACE VIEW public.shipment_profit_rollup AS
WITH line AS (
  SELECT si.shipment_id,
         s.order_id,
         si.order_item_id,
         si.quantity,
         COALESCE(si.delivered_quantity,0) AS delivered_quantity,
         COALESCE(si.refused_quantity,0)   AS refused_quantity,
         COALESCE(si.lost_quantity,0)      AS lost_quantity,
         COALESCE(si.damaged_quantity,0)   AS damaged_quantity,
         COALESCE(oi.line_total,0) / NULLIF(oi.quantity,0) AS unit_net_price,
         COALESCE(oi.unit_cost,0) AS unit_cost,
         (oi.unit_cost IS NOT NULL) AS cost_known
    FROM public.shipment_items si
    JOIN public.shipments s   ON s.id = si.shipment_id
    JOIN public.order_items oi ON oi.id = si.order_item_id
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
         count(*) FILTER (WHERE st.status NOT IN ('cancelled')) AS item_count,
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
  -- allocation shares
  CASE WHEN COALESCE(ov.order_line_value,0) = 0 THEN 0
       ELSE a.shipped_line_value / ov.order_line_value END AS shipped_share,
  CASE WHEN COALESCE(ov.order_line_value,0) = 0 THEN 0
       ELSE (a.delivered_line_value - a.returned_line_value) / ov.order_line_value END AS delivered_share,
  -- estimated (expected at booking time, quantity = shipped)
  a.shipped_line_value,
  a.shipped_line_cost,
  COALESCE(s.booked_delivery_fee, s.quoted_delivery_fee) AS expected_delivery_fee,
  -- realized merchandise attribution
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

REVOKE ALL ON public.shipment_profit_rollup FROM PUBLIC, anon;
GRANT SELECT ON public.shipment_profit_rollup TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Shipment-level profitability projection
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shipment_profitability(_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; est_rev numeric; est_cost numeric; est_fee numeric;
        real_rev numeric; real_cost numeric; charges numeric;
        status_text text; missing text[] := '{}';
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read financial data';
  END IF;
  SELECT * INTO r FROM public.shipment_profit_rollup WHERE shipment_id = _shipment_id;
  IF r.shipment_id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  SELECT COALESCE(r.shipped_line_value,0)
       - COALESCE(o.order_discount,0) * COALESCE(r.shipped_share,0)
       + COALESCE(o.shipping_charge,0) * COALESCE(r.shipped_share,0)
    INTO est_rev FROM public.orders o WHERE o.id = r.order_id;
  est_cost := COALESCE(r.shipped_line_cost,0);
  est_fee  := COALESCE(r.expected_delivery_fee,0);

  SELECT COALESCE(r.delivered_line_value,0) - COALESCE(r.returned_line_value,0)
       - COALESCE(o.order_discount,0) * COALESCE(r.delivered_share,0)
       + COALESCE(o.shipping_charge,0) * COALESCE(r.delivered_share,0)
    INTO real_rev FROM public.orders o WHERE o.id = r.order_id;
  real_cost := COALESCE(r.consumed_line_cost,0) - COALESCE(r.recovered_line_cost,0);
  charges := COALESCE(r.actual_delivery_fee,0) + COALESCE(r.cod_fee,0)
           + COALESCE(r.return_charge,0) + COALESCE(r.other_courier_charge,0);

  IF r.collected_amount IS NULL THEN missing := missing || 'actual COD not recorded'; END IF;
  IF r.actual_delivery_fee IS NULL THEN missing := missing || 'courier charges missing'; END IF;
  IF NOT COALESCE(r.settlement_has_actuals,false) THEN missing := missing || 'courier settlement not reconciled'; END IF;
  IF r.open_discrepancies > 0 THEN missing := missing || 'open settlement discrepancy'; END IF;
  IF r.shipment_status NOT IN ('delivered','partial_delivered','delivery_failed','return_received','lost','cancelled')
    THEN missing := missing || 'shipment still in transit'; END IF;

  status_text := CASE
    WHEN COALESCE(r.settlement_finalized,false) AND r.open_discrepancies = 0 THEN 'finalized'
    WHEN COALESCE(r.settlement_has_actuals,false) AND r.open_discrepancies = 0 THEN 'reconciled'
    WHEN r.collected_amount IS NOT NULL OR r.actual_delivery_fee IS NOT NULL THEN
      CASE WHEN COALESCE(r.settlement_has_actuals,false) THEN 'partially_actual' ELSE 'pending_settlement' END
    WHEN r.shipment_status IN ('delivered','partial_delivered','delivery_failed','return_received','lost') THEN 'pending_settlement'
    ELSE 'estimated' END;

  RETURN jsonb_build_object(
    'shipment_id', r.shipment_id,
    'shipment_number', r.shipment_number,
    'order_id', r.order_id,
    'order_number', r.order_number,
    'shipment_status', r.shipment_status,
    'quantities', jsonb_build_object(
      'shipped', COALESCE(r.shipped_units,0), 'delivered', COALESCE(r.delivered_units,0),
      'refused', COALESCE(r.refused_units,0), 'lost', COALESCE(r.lost_units,0),
      'damaged', COALESCE(r.damaged_units,0),
      'return_declared', COALESCE(r.declared_return_units,0),
      'return_received', COALESCE(r.received_return_units,0),
      'return_accepted', COALESCE(r.accepted_return_units,0)),
    'estimated', jsonb_build_object(
      'attributed_revenue', est_rev, 'attributed_product_cost', est_cost,
      'expected_delivery_fee', r.expected_delivery_fee,
      'expected_cod', r.expected_cod,
      'profit', est_rev - est_cost - est_fee),
    'realized', jsonb_build_object(
      'attributed_revenue', real_rev, 'attributed_product_cost', real_cost,
      'collected_amount', r.collected_amount,
      'actual_delivery_fee', r.actual_delivery_fee,
      'actual_cod_fee', r.cod_fee,
      'actual_return_charge', r.return_charge,
      'actual_other_charge', r.other_courier_charge,
      'adjustment', r.shipment_adjustment,
      'profit', COALESCE(r.collected_amount,0) - real_cost - charges + COALESCE(r.shipment_adjustment,0)),
    'cost_snapshot_complete', COALESCE(r.cost_snapshot_complete,true),
    'open_discrepancies', r.open_discrepancies,
    'settlement_status', r.settlement_status,
    'profit_status', status_text,
    'missing', to_jsonb(missing));
END; $$;

REVOKE ALL ON FUNCTION public.shipment_profitability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shipment_profitability(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Order-level profitability projection (reuses order_financial_rollup)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_profitability(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _o public.orders; _r record; q record; ships jsonb; recon text; missing text[] := '{}';
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read financial data';
  END IF;
  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF _o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  SELECT * INTO _r FROM public.order_financial_rollup WHERE order_id = _order_id;

  SELECT COALESCE(SUM(delivered_units),0)::bigint delivered,
         COALESCE(SUM(refused_units),0)::bigint refused,
         COALESCE(SUM(lost_units),0)::bigint lost,
         COALESCE(SUM(damaged_units),0)::bigint damaged,
         COALESCE(SUM(accepted_return_units),0)::bigint accepted_returns,
         COALESCE(SUM(declared_return_units),0)::bigint declared_returns,
         COALESCE(SUM(open_discrepancies),0)::bigint open_disc,
         count(*)::bigint shipments,
         count(*) FILTER (WHERE settlement_has_actuals)::bigint settled_shipments
    INTO q FROM public.shipment_profit_rollup WHERE order_id = _order_id AND shipment_status <> 'cancelled';

  SELECT COALESCE(jsonb_agg(public.shipment_profitability(shipment_id) ORDER BY created_at), '[]'::jsonb)
    INTO ships FROM public.shipment_profit_rollup WHERE order_id = _order_id;

  IF q.shipments = 0 THEN recon := 'estimated';
  ELSIF q.open_disc > 0 THEN recon := 'partially_actual';
  ELSIF q.settled_shipments = q.shipments AND _r.unresolved_returns = 0 THEN recon := 'reconciled';
  ELSIF q.settled_shipments > 0 THEN recon := 'partially_actual';
  ELSE recon := 'pending_settlement';
  END IF;

  IF _r.shipments_with_collection < _r.shipment_count THEN missing := missing || 'actual COD not recorded on every shipment'; END IF;
  IF _r.shipments_with_fee < _r.shipment_count THEN missing := missing || 'courier charges missing'; END IF;
  IF _r.unresolved_returns > 0 THEN missing := missing || 'return outcome incomplete'; END IF;
  IF q.open_disc > 0 THEN missing := missing || 'open settlement discrepancy'; END IF;
  IF q.settled_shipments < q.shipments THEN missing := missing || 'courier settlement not reconciled'; END IF;
  IF NOT COALESCE(_r.cost_snapshot_complete,true) THEN missing := missing || 'product cost snapshot incomplete'; END IF;

  RETURN jsonb_build_object(
    'order_id', _o.id, 'order_number', _o.order_number, 'store_id', _o.store_id,
    'estimated', jsonb_build_object(
      'revenue', _o.grand_total,
      'product_cost', _r.est_product_cost,
      'courier_cost', _r.est_delivery_cost,
      'packing_cost', COALESCE(_o.packing_charge,0),
      'profit', _r.estimated_profit),
    'realized', jsonb_build_object(
      'revenue', _r.collected_amount,
      'product_cost', _r.actual_product_cost,
      'delivery_fee', _r.actual_delivery_cost,
      'cod_fee', _r.cod_fees,
      'return_charge', _r.return_charges,
      'other_courier_charge', _r.other_courier_charges,
      'packing_cost', _r.actual_packing_cost,
      'refund_amount', _r.refunded_amount,
      'adjustment_income', _r.adjustment_income,
      'adjustment_expense', _r.adjustment_expense,
      'open_discrepancy_amount', _r.open_discrepancy_amount,
      'profit', _r.actual_profit),
    'difference', _r.actual_profit - _r.estimated_profit,
    'quantities', jsonb_build_object(
      'ordered', _r.units, 'shipped', _r.shipped_units,
      'delivered', COALESCE(q.delivered,0), 'refused', COALESCE(q.refused,0),
      'lost', COALESCE(q.lost,0), 'damaged', COALESCE(q.damaged,0),
      'returned_declared', COALESCE(q.declared_returns,0),
      'returned_accepted', COALESCE(q.accepted_returns,0)),
    'shipment_count', _r.shipment_count,
    'cost_snapshot_complete', _r.cost_snapshot_complete,
    'profit_status', _r.completeness,
    'reconciliation_status', recon,
    'missing', to_jsonb(missing),
    'shipments', ships);
END; $$;

REVOKE ALL ON FUNCTION public.order_profitability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_profitability(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Period profitability summary for analytics dashboards
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_profitability(
  _from timestamptz, _to timestamptz, _store_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read financial data';
  END IF;
  PERFORM public.analytics_guard(_from, _to);
  PERFORM public.analytics_store_guard(_store_id);

  WITH r AS (
    SELECT f.*, o.store_id
      FROM public.order_financial_rollup f
      JOIN public.orders o ON o.id = f.order_id
     WHERE f.created_at >= _from AND f.created_at < _to
       AND f.status <> 'cancelled'
       AND (_store_id IS NULL OR o.store_id = _store_id)
  ), q AS (
    SELECT COALESCE(SUM(sp.delivered_units),0)::bigint delivered,
           COALESCE(SUM(sp.refused_units),0)::bigint refused,
           COALESCE(SUM(sp.lost_units),0)::bigint lost,
           COALESCE(SUM(sp.damaged_units),0)::bigint damaged,
           COALESCE(SUM(sp.accepted_return_units),0)::bigint returned_accepted,
           COALESCE(SUM(sp.returned_line_value),0) return_loss
      FROM public.shipment_profit_rollup sp
      JOIN r ON r.order_id = sp.order_id
     WHERE sp.shipment_status <> 'cancelled'
  )
  SELECT jsonb_build_object(
    'orders', (SELECT count(*) FROM r),
    'estimated_revenue', (SELECT COALESCE(SUM(grand_total),0) FROM r),
    'estimated_product_cost', (SELECT COALESCE(SUM(est_product_cost),0) FROM r),
    'estimated_courier_cost', (SELECT COALESCE(SUM(est_delivery_cost),0) FROM r),
    'estimated_profit', (SELECT COALESCE(SUM(estimated_profit),0) FROM r),
    'realized_revenue', (SELECT COALESCE(SUM(collected_amount),0) FROM r),
    'realized_product_cost', (SELECT COALESCE(SUM(actual_product_cost),0) FROM r),
    'courier_charges', (SELECT COALESCE(SUM(actual_delivery_cost + cod_fees + return_charges + other_courier_charges),0) FROM r),
    'refunds', (SELECT COALESCE(SUM(refunded_amount),0) FROM r),
    'adjustment_income', (SELECT COALESCE(SUM(adjustment_income),0) FROM r),
    'adjustment_expense', (SELECT COALESCE(SUM(adjustment_expense),0) FROM r),
    'realized_profit', (SELECT COALESCE(SUM(actual_profit),0) FROM r),
    'profit_difference', (SELECT COALESCE(SUM(actual_profit - estimated_profit),0) FROM r),
    'orders_pending_reconciliation', (SELECT count(*) FROM r WHERE completeness <> 'actual'),
    'orders_reconciled', (SELECT count(*) FROM r WHERE completeness = 'actual'),
    'open_discrepancy_amount', (SELECT COALESCE(SUM(open_discrepancy_amount),0) FROM r),
    'return_loss', (SELECT return_loss FROM q),
    'delivered_units', (SELECT delivered FROM q),
    'refused_units', (SELECT refused FROM q),
    'lost_units', (SELECT lost FROM q),
    'damaged_units', (SELECT damaged FROM q),
    'returned_units', (SELECT returned_accepted FROM q)
  ) INTO res;
  RETURN res;
END; $$;

REVOKE ALL ON FUNCTION public.analytics_profitability(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_profitability(timestamptz, timestamptz, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Extend variant-aware product analytics with realized figures
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_product_performance(timestamptz, timestamptz, integer, uuid, uuid);

CREATE FUNCTION public.analytics_product_performance(
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
    SELECT oi.*, o.id oid, o.order_discount, o.shipping_charge,
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
  ), outcome AS (
    SELECT si.order_item_id,
           SUM(COALESCE(si.delivered_quantity,0)) delivered,
           SUM(COALESCE(si.refused_quantity,0))   refused,
           SUM(COALESCE(si.lost_quantity,0))      lost,
           SUM(COALESCE(si.damaged_quantity,0))   damaged,
           SUM(COALESCE(si.quantity,0))           shipped
      FROM public.shipment_items si
      JOIN public.shipments s ON s.id = si.shipment_id
     WHERE s.status <> 'cancelled'
     GROUP BY 1
  ), courier AS (
    -- shipment courier cost attributed to each line by shipped value share
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
         -- realized revenue: delivered units minus accepted returns, at frozen price
         COALESCE(SUM(GREATEST(COALESCE(oc.delivered,0) - COALESCE(r.qty,0),0) * l.unit_net_price),0),
         -- realized cost: delivered + lost + damaged, minus cost recovered by accepted returns
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

CREATE INDEX IF NOT EXISTS idx_shipment_items_order_item ON public.shipment_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_financial_adjustments_shipment ON public.order_financial_adjustments(shipment_id) WHERE shipment_id IS NOT NULL;