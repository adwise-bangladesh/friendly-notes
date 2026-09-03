DROP VIEW IF EXISTS public.order_financial_rollup;
CREATE VIEW public.order_financial_rollup AS
 WITH item AS (
         SELECT oi.order_id,
            sum(COALESCE(oi.unit_cost, 0::numeric) * oi.quantity::numeric) AS est_product_cost,
            sum(COALESCE(oi.unit_cost, 0::numeric) * GREATEST(COALESCE(c.committed_qty, 0::bigint) - COALESCE(r.recovered_qty, 0::bigint), 0::bigint)::numeric) AS actual_product_cost,
            bool_and(oi.unit_cost IS NOT NULL) AS cost_known,
            sum(oi.quantity) AS units,
            COALESCE(sum(r.returned_qty), 0::numeric) AS returned_units,
            COALESCE(sum(r.recovered_qty), 0::numeric) AS cost_recovered_units
           FROM order_items oi
             LEFT JOIN LATERAL ( SELECT sum(ri.quantity_accepted) FILTER (WHERE (ret.status = ANY (ARRAY['received'::order_return_status, 'inspected'::order_return_status, 'completed'::order_return_status])) AND ret.financial_recorded_at IS NOT NULL) AS recovered_qty,
                    sum(ri.quantity_accepted) FILTER (WHERE ret.status = ANY (ARRAY['received'::order_return_status, 'inspected'::order_return_status, 'completed'::order_return_status])) AS returned_qty
                   FROM order_return_items ri
                     JOIN order_returns ret ON ret.id = ri.return_id
                  WHERE ri.order_item_id = oi.id) r ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(COALESCE(fi.packed_quantity, fi.picked_quantity, 0)), 0)::bigint AS committed_qty
                   FROM order_fulfillment_items fi
                     JOIN order_fulfillments f ON f.id = fi.fulfillment_id
                  WHERE fi.order_item_id = oi.id AND f.inventory_committed_at IS NOT NULL) c ON true
          GROUP BY oi.order_id
        ), ship AS (
         SELECT s.order_id,
            count(*) AS shipments,
            count(*) FILTER (WHERE s.collected_amount IS NOT NULL) AS with_collection,
            count(*) FILTER (WHERE s.actual_delivery_fee IS NOT NULL) AS with_fee,
            count(*) FILTER (WHERE COALESCE(s.booked_delivery_fee, s.quoted_delivery_fee) IS NULL) AS without_estimate,
            COALESCE(sum(s.collected_amount), 0::numeric) AS collected,
            COALESCE(sum(s.actual_delivery_fee), 0::numeric) AS actual_delivery,
            COALESCE(sum(s.cod_fee), 0::numeric) AS cod_fees,
            COALESCE(sum(s.return_charge), 0::numeric) AS return_charges,
            COALESCE(sum(s.other_courier_charge), 0::numeric) AS other_courier,
            COALESCE(sum(COALESCE(s.booked_delivery_fee, s.quoted_delivery_fee, 0::numeric)), 0::numeric) AS est_delivery_known
           FROM shipments s
          WHERE s.status <> 'cancelled'::shipment_status
          GROUP BY s.order_id
        ), shipped AS (
         SELECT s.order_id,
            COALESCE(sum(si.quantity), 0::bigint) AS shipped_units
           FROM shipments s
             JOIN shipment_items si ON si.shipment_id = s.id
          WHERE s.status <> 'cancelled'::shipment_status
          GROUP BY s.order_id
        ), adj AS (
         SELECT a.order_id,
            COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'income'::financial_adjustment_direction AND a.adjustment_type <> 'packing_cost'::financial_adjustment_type), 0::numeric) AS adj_income,
            COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'expense'::financial_adjustment_direction AND a.adjustment_type <> 'packing_cost'::financial_adjustment_type), 0::numeric) AS adj_expense,
            COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'expense'::financial_adjustment_direction AND a.adjustment_type = 'packing_cost'::financial_adjustment_type), 0::numeric) - COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'income'::financial_adjustment_direction AND a.adjustment_type = 'packing_cost'::financial_adjustment_type), 0::numeric) AS adj_packing,
            COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'expense'::financial_adjustment_direction AND a.adjustment_type = 'refund'::financial_adjustment_type), 0::numeric) - COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'income'::financial_adjustment_direction AND a.adjustment_type = 'refund'::financial_adjustment_type), 0::numeric) AS refunds
           FROM order_financial_adjustments a
          GROUP BY a.order_id
        ), ret AS (
         SELECT r.order_id,
            count(*) FILTER (WHERE (r.status = ANY (ARRAY['received'::order_return_status, 'inspected'::order_return_status, 'completed'::order_return_status])) AND r.financial_recorded_at IS NULL) AS unresolved_returns,
            COALESCE(sum(r.refund_amount), 0::numeric) AS refunded_recorded,
            COALESCE(sum(r.retained_amount), 0::numeric) AS retained_recorded
           FROM order_returns r
          GROUP BY r.order_id
        ), disc AS (
         SELECT d.order_id,
            count(*) FILTER (WHERE d.status = 'open'::settlement_discrepancy_status) AS open_discrepancies,
            COALESCE(sum(d.difference) FILTER (WHERE d.status = 'open'::settlement_discrepancy_status), 0::numeric) AS open_discrepancy_amount
           FROM courier_settlement_discrepancies d
          GROUP BY d.order_id
        ), base AS (
         SELECT o.id AS order_id,
            o.created_at,
            o.status,
            o.source,
            o.customer_id,
            o.grand_total,
            o.subtotal,
            o.product_discount,
            o.order_discount,
            o.shipping_charge,
            COALESCE(i.units, 0::bigint) AS units,
            COALESCE(shp.shipped_units, 0::bigint) AS shipped_units,
            COALESCE(i.returned_units, 0::numeric) AS returned_units,
            COALESCE(i.est_product_cost, 0::numeric) AS est_product_cost,
            COALESCE(i.actual_product_cost, 0::numeric) AS actual_product_cost,
            COALESCE(i.cost_known, true) AS cost_snapshot_complete,
                CASE
                    WHEN sh.shipments IS NULL OR sh.shipments = 0 THEN COALESCE(o.delivery_charge, 0::numeric)
                    ELSE sh.est_delivery_known + sh.without_estimate::numeric * COALESCE(o.delivery_charge, 0::numeric)
                END AS est_delivery_cost,
            COALESCE(sh.collected, 0::numeric) AS collected_amount,
            COALESCE(sh.actual_delivery, 0::numeric) AS actual_delivery_cost,
            COALESCE(sh.cod_fees, 0::numeric) AS cod_fees,
            COALESCE(sh.return_charges, 0::numeric) AS return_charges,
            COALESCE(sh.other_courier, 0::numeric) AS other_courier_charges,
            COALESCE(o.packing_charge, 0::numeric) + COALESCE(ad.adj_packing, 0::numeric) AS actual_packing_cost,
            COALESCE(o.packing_charge, 0::numeric) AS packing_charge,
            COALESCE(ad.adj_income, 0::numeric) AS adjustment_income,
            COALESCE(ad.adj_expense, 0::numeric) AS adjustment_expense,
            COALESCE(ad.refunds, 0::numeric) AS refunded_amount,
            COALESCE(sh.shipments, 0::bigint) AS shipment_count,
            COALESCE(sh.with_collection, 0::bigint) AS shipments_with_collection,
            COALESCE(sh.with_fee, 0::bigint) AS shipments_with_fee,
            COALESCE(rt.unresolved_returns, 0::bigint) AS unresolved_returns,
            COALESCE(rt.retained_recorded, 0::numeric) AS retained_amount,
            COALESCE(dc.open_discrepancies, 0::bigint) AS open_discrepancies,
            COALESCE(dc.open_discrepancy_amount, 0::numeric) AS open_discrepancy_amount
           FROM orders o
             LEFT JOIN item i ON i.order_id = o.id
             LEFT JOIN ship sh ON sh.order_id = o.id
             LEFT JOIN shipped shp ON shp.order_id = o.id
             LEFT JOIN adj ad ON ad.order_id = o.id
             LEFT JOIN ret rt ON rt.order_id = o.id
             LEFT JOIN disc dc ON dc.order_id = o.id
        )
 SELECT order_id, created_at, status, source, customer_id, grand_total, subtotal,
    product_discount, order_discount, shipping_charge, units, shipped_units, returned_units,
    est_product_cost, actual_product_cost, cost_snapshot_complete, est_delivery_cost,
    collected_amount, actual_delivery_cost, cod_fees, return_charges, other_courier_charges,
    actual_packing_cost, packing_charge, adjustment_income, adjustment_expense, refunded_amount,
    shipment_count, shipments_with_collection, shipments_with_fee, unresolved_returns,
    retained_amount, open_discrepancies, open_discrepancy_amount,
    grand_total - est_product_cost - est_delivery_cost - packing_charge AS estimated_profit,
    collected_amount - actual_product_cost - actual_delivery_cost - cod_fees - return_charges - other_courier_charges - actual_packing_cost - adjustment_expense + adjustment_income + open_discrepancy_amount AS actual_profit,
        CASE
            WHEN shipment_count = 0 THEN
            CASE
                WHEN (adjustment_income + adjustment_expense) > 0::numeric THEN 'partially_actual'::text
                ELSE 'estimated'::text
            END
            WHEN shipments_with_collection = shipment_count AND shipments_with_fee = shipment_count AND unresolved_returns = 0 AND open_discrepancies = 0 AND (shipped_units >= units OR status = 'cancelled'::order_status) THEN 'actual'::text
            WHEN shipments_with_collection > 0 OR shipments_with_fee > 0 OR (adjustment_income + adjustment_expense) > 0::numeric THEN 'partially_actual'::text
            ELSE 'estimated'::text
        END AS completeness
   FROM base b;

ALTER VIEW public.order_financial_rollup SET (security_invoker = on);
GRANT SELECT ON public.order_financial_rollup TO authenticated;