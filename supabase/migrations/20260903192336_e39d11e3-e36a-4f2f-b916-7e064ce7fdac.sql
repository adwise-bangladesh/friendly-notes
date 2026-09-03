CREATE OR REPLACE FUNCTION public.shipment_profitability(_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; est_rev numeric; est_cost numeric; est_fee numeric;
        real_rev numeric; real_cost numeric; charges numeric;
        status_text text; missing text[] := ARRAY[]::text[];
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

  IF r.collected_amount IS NULL THEN missing := array_append(missing, 'actual COD not recorded'::text); END IF;
  IF r.actual_delivery_fee IS NULL THEN missing := array_append(missing, 'courier charges missing'::text); END IF;
  IF NOT COALESCE(r.settlement_has_actuals,false) THEN missing := array_append(missing, 'courier settlement not reconciled'::text); END IF;
  IF r.open_discrepancies > 0 THEN missing := array_append(missing, 'open settlement discrepancy'::text); END IF;
  IF r.shipment_status NOT IN ('delivered','partial_delivered','delivery_failed','return_received','lost','cancelled')
    THEN missing := array_append(missing, 'shipment still in transit'::text); END IF;

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

CREATE OR REPLACE FUNCTION public.order_profitability(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _o public.orders; _r record; q record; ships jsonb; recon text; missing text[] := ARRAY[]::text[];
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

  IF _r.shipments_with_collection < _r.shipment_count THEN missing := array_append(missing, 'actual COD not recorded on every shipment'::text); END IF;
  IF _r.shipments_with_fee < _r.shipment_count THEN missing := array_append(missing, 'courier charges missing'::text); END IF;
  IF _r.unresolved_returns > 0 THEN missing := array_append(missing, 'return outcome incomplete'::text); END IF;
  IF q.open_disc > 0 THEN missing := array_append(missing, 'open settlement discrepancy'::text); END IF;
  IF q.settled_shipments < q.shipments THEN missing := array_append(missing, 'courier settlement not reconciled'::text); END IF;
  IF NOT COALESCE(_r.cost_snapshot_complete,true) THEN missing := array_append(missing, 'product cost snapshot incomplete'::text); END IF;

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