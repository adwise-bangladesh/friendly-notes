-- ============================================================
-- 1. Schema additions
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS financial_outcome public.return_financial_outcome NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS refund_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retained_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financial_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS financial_recorded_by uuid,
  ADD COLUMN IF NOT EXISTS refund_adjustment_id uuid;

CREATE TABLE IF NOT EXISTS public.courier_settlement_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.courier_settlements(id) ON DELETE CASCADE,
  settlement_item_id uuid NOT NULL UNIQUE REFERENCES public.courier_settlement_items(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  expected_amount numeric NOT NULL,
  settled_amount numeric NOT NULL,
  difference numeric NOT NULL,
  direction text NOT NULL CHECK (direction IN ('shortfall','surplus')),
  status public.settlement_discrepancy_status NOT NULL DEFAULT 'open',
  resolution public.settlement_discrepancy_resolution,
  resolution_note text,
  adjustment_id uuid REFERENCES public.order_financial_adjustments(id),
  resolved_at timestamptz,
  resolved_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.courier_settlement_discrepancies TO authenticated;
GRANT ALL ON public.courier_settlement_discrepancies TO service_role;
ALTER TABLE public.courier_settlement_discrepancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commerce readers view settlement discrepancies" ON public.courier_settlement_discrepancies;
CREATE POLICY "Commerce readers view settlement discrepancies"
  ON public.courier_settlement_discrepancies FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_settlement_discrepancies_order ON public.courier_settlement_discrepancies(order_id);
CREATE INDEX IF NOT EXISTS idx_settlement_discrepancies_status ON public.courier_settlement_discrepancies(status);

CREATE OR REPLACE FUNCTION public.guard_settlement_discrepancy_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.financial_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Settlement discrepancies can only be changed through the settlement workflow functions.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS settlement_discrepancies_guard ON public.courier_settlement_discrepancies;
CREATE TRIGGER settlement_discrepancies_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.courier_settlement_discrepancies
  FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_discrepancy_write();

DROP TRIGGER IF EXISTS settlement_discrepancies_set_updated_at ON public.courier_settlement_discrepancies;
CREATE TRIGGER settlement_discrepancies_set_updated_at
  BEFORE UPDATE ON public.courier_settlement_discrepancies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Revoke anonymous access to financial tables
REVOKE ALL ON public.order_financial_adjustments FROM anon;
REVOKE ALL ON public.courier_settlements FROM anon;
REVOKE ALL ON public.courier_settlement_items FROM anon;
REVOKE ALL ON public.courier_settlement_discrepancies FROM anon;

-- ============================================================
-- 2. Payment projection (derived, controlled)
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_order_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.payment_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
     OR NEW.due_amount IS DISTINCT FROM OLD.due_amount
     OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'Payment amounts are derived from collected money and can only change through payment reconciliation.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_guard_payment ON public.orders;
CREATE TRIGGER orders_guard_payment BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_payment();

CREATE OR REPLACE FUNCTION public.refresh_order_payment(_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _o public.orders; _collected numeric := 0; _refunded numeric := 0;
  _net numeric; _due numeric; _status public.payment_status;
BEGIN
  SELECT * INTO _o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _o.id IS NULL THEN RETURN; END IF;

  SELECT coalesce(sum(collected_amount), 0) INTO _collected
    FROM public.shipments WHERE order_id = _order_id AND status <> 'cancelled';

  SELECT coalesce(sum(amount) FILTER (WHERE direction = 'expense'), 0)
       - coalesce(sum(amount) FILTER (WHERE direction = 'income'), 0)
    INTO _refunded
    FROM public.order_financial_adjustments
   WHERE order_id = _order_id AND adjustment_type = 'refund';
  _refunded := greatest(_refunded, 0);

  _net := _collected - _refunded;
  _due := greatest(coalesce(_o.grand_total, 0) - _net, 0);

  _status := CASE
    WHEN _collected > 0 AND _net <= 0 THEN 'refunded'::public.payment_status
    WHEN _net >= coalesce(_o.grand_total, 0) AND _net > 0 THEN 'paid'::public.payment_status
    WHEN _net > 0 THEN 'partial'::public.payment_status
    ELSE 'unpaid'::public.payment_status END;

  IF _o.paid_amount = _collected AND coalesce(_o.due_amount, -1) = _due
     AND _o.refunded_amount = _refunded AND _o.payment_status = _status THEN
    RETURN;
  END IF;

  PERFORM set_config('app.payment_write', 'on', true);
  UPDATE public.orders SET
    paid_amount = _collected,
    refunded_amount = _refunded,
    due_amount = _due,
    payment_status = _status
  WHERE id = _order_id;
  PERFORM set_config('app.payment_write', 'off', true);
END; $$;

REVOKE ALL ON FUNCTION public.refresh_order_payment(uuid) FROM anon, authenticated;

-- ============================================================
-- 3. Shipment financials -> payment projection
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_shipment_financials(_shipment_id uuid, _collected_amount numeric DEFAULT NULL::numeric, _actual_delivery_fee numeric DEFAULT NULL::numeric, _cod_fee numeric DEFAULT NULL::numeric, _return_charge numeric DEFAULT NULL::numeric, _other_courier_charge numeric DEFAULT NULL::numeric, _note text DEFAULT NULL::text)
RETURNS shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record shipment financials';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  IF coalesce(_collected_amount, 0) < 0 OR coalesce(_actual_delivery_fee, 0) < 0
     OR coalesce(_cod_fee, 0) < 0 OR coalesce(_return_charge, 0) < 0
     OR coalesce(_other_courier_charge, 0) < 0 THEN
    RAISE EXCEPTION 'Financial amounts cannot be negative';
  END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    collected_amount = coalesce(_collected_amount, collected_amount),
    actual_delivery_fee = coalesce(_actual_delivery_fee, actual_delivery_fee),
    cod_fee = coalesce(_cod_fee, cod_fee),
    return_charge = coalesce(_return_charge, return_charge),
    other_courier_charge = coalesce(_other_courier_charge, other_courier_charge),
    financials_recorded_at = now(), financials_recorded_by = auth.uid(), updated_by = auth.uid()
  WHERE id = _shipment_id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'status_updated', _s.status, _s.status,
    coalesce(nullif(btrim(coalesce(_note,'')),''), 'Courier financial values recorded.'),
    jsonb_build_object('collected_amount', _s.collected_amount,
                       'actual_delivery_fee', _s.actual_delivery_fee,
                       'cod_fee', _s.cod_fee, 'return_charge', _s.return_charge,
                       'other_courier_charge', _s.other_courier_charge));

  PERFORM public.refresh_order_payment(_s.order_id);
  RETURN _s;
END; $$;

-- ============================================================
-- 4. Return financial outcome (explicit, replay-safe)
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_return_financial_outcome(
  _return_id uuid, _refund_amount numeric DEFAULT 0, _retained_amount numeric DEFAULT NULL, _note text DEFAULT NULL)
RETURNS order_returns LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _r public.order_returns; _value numeric := 0; _refund numeric; _retain numeric;
  _outcome public.return_financial_outcome; _adj public.order_financial_adjustments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record return financial outcomes';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _r.status NOT IN ('received','inspected','completed') THEN
    RAISE EXCEPTION 'Record the financial outcome only after the returned goods have been received';
  END IF;

  _refund := round(greatest(coalesce(_refund_amount, 0), 0), 2);

  -- Money value of the goods that came back, using the frozen order prices.
  SELECT coalesce(sum(coalesce(oi.unit_price,0) * ri.quantity_received), 0) INTO _value
    FROM public.order_return_items ri
    JOIN public.order_items oi ON oi.id = ri.order_item_id
   WHERE ri.return_id = _r.id;

  IF _refund > _value THEN
    RAISE EXCEPTION 'The refund cannot exceed the value of the returned goods (BDT %).', round(_value,2);
  END IF;

  _retain := round(coalesce(_retained_amount, _value - _refund), 2);
  IF _retain < 0 OR round(_refund + _retain, 2) > round(_value, 2) THEN
    RAISE EXCEPTION 'Refunded and retained amounts cannot exceed the value of the returned goods (BDT %).', round(_value,2);
  END IF;

  IF _r.financial_recorded_at IS NOT NULL THEN
    IF _r.refund_amount = _refund AND _r.retained_amount = _retain THEN
      RETURN _r;  -- exact replay is a safe no-op
    END IF;
    RAISE EXCEPTION 'A financial outcome was already recorded for this return (refunded BDT %, retained BDT %). Record a correcting financial adjustment instead.',
      _r.refund_amount, _r.retained_amount;
  END IF;

  _outcome := CASE
    WHEN _refund <= 0 THEN 'retained'::public.return_financial_outcome
    WHEN _refund >= _value THEN 'refunded'::public.return_financial_outcome
    ELSE 'partially_refunded'::public.return_financial_outcome END;

  IF _refund > 0 THEN
    _adj := public.create_financial_adjustment(_r.order_id, 'refund', 'expense', _refund,
      coalesce(nullif(btrim(coalesce(_note,'')),''), 'Refund for return ' || _r.return_number),
      _r.return_number, _r.shipment_id, _r.id);
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  UPDATE public.order_returns SET
    financial_outcome = _outcome,
    refund_amount = _refund,
    retained_amount = _retain,
    financial_recorded_at = now(),
    financial_recorded_by = auth.uid(),
    refund_adjustment_id = _adj.id,
    updated_by = auth.uid()
  WHERE id = _r.id RETURNING * INTO _r;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _r.order_id, 'status_changed', _r.status, _r.status,
    'Financial outcome recorded: refunded BDT ' || _refund || ', retained BDT ' || _retain || '.',
    jsonb_build_object('refund_amount', _refund, 'retained_amount', _retain, 'outcome', _outcome));

  PERFORM public.refresh_order_payment(_r.order_id);
  RETURN _r;
END; $$;

REVOKE ALL ON FUNCTION public.record_return_financial_outcome(uuid, numeric, numeric, text) FROM anon;

-- ============================================================
-- 5. Settlement: preserve collected money, expose discrepancies
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_settlement_actuals(_item_id uuid, _actual_collected_amount numeric DEFAULT NULL::numeric, _delivery_charge numeric DEFAULT NULL::numeric, _cod_charge numeric DEFAULT NULL::numeric, _return_charge numeric DEFAULT NULL::numeric, _other_charge numeric DEFAULT NULL::numeric)
RETURNS courier_settlement_items LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _st public.courier_settlements; _row public.courier_settlement_items;
  _s public.shipments; _expected numeric; _settled numeric; _diff numeric; _existing uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;
  SELECT * INTO _row FROM public.courier_settlement_items WHERE id = _item_id FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Settlement item not found'; END IF;
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _row.settlement_id FOR UPDATE;
  IF _st.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'A % settlement can no longer be changed', _st.status;
  END IF;
  IF coalesce(_actual_collected_amount,0) < 0 OR coalesce(_delivery_charge,0) < 0
     OR coalesce(_cod_charge,0) < 0 OR coalesce(_return_charge,0) < 0
     OR coalesce(_other_charge,0) < 0 THEN
    RAISE EXCEPTION 'Financial amounts cannot be negative';
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_settlement_items SET
    actual_collected_amount = coalesce(_actual_collected_amount, actual_collected_amount),
    delivery_charge = coalesce(_delivery_charge, delivery_charge),
    cod_charge = coalesce(_cod_charge, cod_charge),
    return_charge = coalesce(_return_charge, return_charge),
    other_charge = coalesce(_other_charge, other_charge)
  WHERE id = _item_id RETURNING * INTO _row;
  UPDATE public.courier_settlement_items SET
    net_settlement_amount = coalesce(actual_collected_amount,0) - coalesce(delivery_charge,0)
      - coalesce(cod_charge,0) - coalesce(return_charge,0) - coalesce(other_charge,0)
  WHERE id = _item_id RETURNING * INTO _row;
  UPDATE public.courier_settlements s
     SET status = CASE WHEN s.status = 'draft' THEN 'pending'::public.courier_settlement_status
                       ELSE s.status END,
         updated_by = auth.uid()
   WHERE s.id = _row.settlement_id;
  PERFORM set_config('app.financial_write', 'off', true);

  SELECT * INTO _s FROM public.shipments WHERE id = _row.shipment_id;
  _settled := coalesce(_row.actual_collected_amount, 0);
  _expected := _s.collected_amount;   -- what delivery/collection records say

  -- Charges always come from the settlement. Collected money is only adopted
  -- when no collection record exists yet: settlement never overwrites history.
  PERFORM public.record_shipment_financials(_row.shipment_id,
    CASE WHEN _expected IS NULL THEN _settled ELSE NULL END,
    _row.delivery_charge, _row.cod_charge, _row.return_charge, _row.other_charge,
    'Courier settlement ' || _st.settlement_reference || ' actuals recorded.');

  IF _expected IS NOT NULL THEN
    _diff := round(_settled - _expected, 2);
    SELECT id INTO _existing FROM public.courier_settlement_discrepancies
     WHERE settlement_item_id = _row.id;

    PERFORM set_config('app.financial_write', 'on', true);
    IF _diff = 0 THEN
      IF _existing IS NOT NULL THEN
        UPDATE public.courier_settlement_discrepancies
           SET expected_amount = _expected, settled_amount = _settled, difference = 0,
               status = 'resolved', resolution = 'settlement_received',
               resolved_at = coalesce(resolved_at, now()), resolved_by = auth.uid()
         WHERE id = _existing AND status = 'open';
      END IF;
    ELSIF _existing IS NULL THEN
      INSERT INTO public.courier_settlement_discrepancies (
        settlement_id, settlement_item_id, shipment_id, order_id,
        expected_amount, settled_amount, difference, direction, created_by)
      VALUES (_st.id, _row.id, _s.id, _s.order_id, _expected, _settled, _diff,
              CASE WHEN _diff < 0 THEN 'shortfall' ELSE 'surplus' END, auth.uid());
    ELSE
      UPDATE public.courier_settlement_discrepancies
         SET expected_amount = _expected, settled_amount = _settled, difference = _diff,
             direction = CASE WHEN _diff < 0 THEN 'shortfall' ELSE 'surplus' END
       WHERE id = _existing AND status = 'open';
    END IF;
    PERFORM set_config('app.financial_write', 'off', true);
  END IF;

  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_settlement_discrepancy(
  _discrepancy_id uuid, _resolution public.settlement_discrepancy_resolution, _note text DEFAULT NULL)
RETURNS courier_settlement_discrepancies LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _d public.courier_settlement_discrepancies; _adj public.order_financial_adjustments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to resolve settlement discrepancies';
  END IF;
  SELECT * INTO _d FROM public.courier_settlement_discrepancies WHERE id = _discrepancy_id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Discrepancy not found'; END IF;
  IF _d.status = 'resolved' THEN RAISE EXCEPTION 'This discrepancy is already resolved'; END IF;

  IF _resolution IN ('merchant_adjustment','written_off') AND _d.difference <> 0 THEN
    _adj := public.create_financial_adjustment(_d.order_id, 'settlement_shortfall',
      CASE WHEN _d.difference < 0 THEN 'expense'::public.financial_adjustment_direction
           ELSE 'income'::public.financial_adjustment_direction END,
      abs(_d.difference),
      coalesce(nullif(btrim(coalesce(_note,'')),''), 'Settlement discrepancy ' || _resolution::text),
      'settlement-discrepancy', _d.shipment_id, NULL);
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_settlement_discrepancies SET
    status = 'resolved', resolution = _resolution,
    resolution_note = nullif(btrim(coalesce(_note,'')),''),
    adjustment_id = _adj.id, resolved_at = now(), resolved_by = auth.uid()
  WHERE id = _d.id RETURNING * INTO _d;
  PERFORM set_config('app.financial_write', 'off', true);
  RETURN _d;
END; $$;

REVOKE ALL ON FUNCTION public.resolve_settlement_discrepancy(uuid, public.settlement_discrepancy_resolution, text) FROM anon;

-- ============================================================
-- 6. Single authoritative projection
-- ============================================================
DROP VIEW IF EXISTS public.order_financial_rollup;
CREATE VIEW public.order_financial_rollup AS
WITH item AS (
  SELECT oi.order_id,
    sum(coalesce(oi.unit_cost,0) * oi.quantity) AS est_product_cost,
    sum(coalesce(oi.unit_cost,0) * greatest(oi.quantity - coalesce(r.recovered_qty,0), 0)) AS actual_product_cost,
    bool_and(oi.unit_cost IS NOT NULL) AS cost_known,
    sum(oi.quantity) AS units,
    coalesce(sum(r.returned_qty), 0) AS returned_units,
    coalesce(sum(r.recovered_qty), 0) AS cost_recovered_units
  FROM public.order_items oi
  LEFT JOIN LATERAL (
    SELECT sum(ri.quantity_accepted) FILTER (
             WHERE ret.status IN ('received','inspected','completed')
               AND ret.financial_recorded_at IS NOT NULL) AS recovered_qty,
           sum(ri.quantity_accepted) FILTER (
             WHERE ret.status IN ('received','inspected','completed')) AS returned_qty
      FROM public.order_return_items ri
      JOIN public.order_returns ret ON ret.id = ri.return_id
     WHERE ri.order_item_id = oi.id) r ON true
  GROUP BY oi.order_id
), ship AS (
  SELECT s.order_id,
    count(*) AS shipments,
    count(*) FILTER (WHERE s.collected_amount IS NOT NULL) AS with_collection,
    count(*) FILTER (WHERE s.actual_delivery_fee IS NOT NULL) AS with_fee,
    count(*) FILTER (WHERE coalesce(s.booked_delivery_fee, s.quoted_delivery_fee) IS NULL) AS without_estimate,
    coalesce(sum(s.collected_amount), 0) AS collected,
    coalesce(sum(s.actual_delivery_fee), 0) AS actual_delivery,
    coalesce(sum(s.cod_fee), 0) AS cod_fees,
    coalesce(sum(s.return_charge), 0) AS return_charges,
    coalesce(sum(s.other_courier_charge), 0) AS other_courier,
    coalesce(sum(coalesce(s.booked_delivery_fee, s.quoted_delivery_fee, 0)), 0) AS est_delivery_known
  FROM public.shipments s WHERE s.status <> 'cancelled' GROUP BY s.order_id
), shipped AS (
  SELECT s.order_id, coalesce(sum(si.quantity), 0) AS shipped_units
    FROM public.shipments s
    JOIN public.shipment_items si ON si.shipment_id = s.id
   WHERE s.status <> 'cancelled' GROUP BY s.order_id
), adj AS (
  SELECT a.order_id,
    coalesce(sum(a.amount) FILTER (WHERE a.direction = 'income' AND a.adjustment_type <> 'packing_cost'), 0) AS adj_income,
    coalesce(sum(a.amount) FILTER (WHERE a.direction = 'expense' AND a.adjustment_type <> 'packing_cost'), 0) AS adj_expense,
    coalesce(sum(a.amount) FILTER (WHERE a.direction = 'expense' AND a.adjustment_type = 'packing_cost'), 0)
      - coalesce(sum(a.amount) FILTER (WHERE a.direction = 'income' AND a.adjustment_type = 'packing_cost'), 0) AS adj_packing,
    coalesce(sum(a.amount) FILTER (WHERE a.direction = 'expense' AND a.adjustment_type = 'refund'), 0)
      - coalesce(sum(a.amount) FILTER (WHERE a.direction = 'income' AND a.adjustment_type = 'refund'), 0) AS refunds
  FROM public.order_financial_adjustments a GROUP BY a.order_id
), ret AS (
  SELECT r.order_id,
    count(*) FILTER (WHERE r.status IN ('received','inspected','completed')
                       AND r.financial_recorded_at IS NULL) AS unresolved_returns,
    coalesce(sum(r.refund_amount), 0) AS refunded_recorded,
    coalesce(sum(r.retained_amount), 0) AS retained_recorded
  FROM public.order_returns r GROUP BY r.order_id
), disc AS (
  SELECT d.order_id,
    count(*) FILTER (WHERE d.status = 'open') AS open_discrepancies,
    coalesce(sum(d.difference) FILTER (WHERE d.status = 'open'), 0) AS open_discrepancy_amount
  FROM public.courier_settlement_discrepancies d GROUP BY d.order_id
), base AS (
  SELECT o.id AS order_id, o.created_at, o.status, o.source, o.customer_id,
    o.grand_total, o.subtotal, o.product_discount, o.order_discount, o.shipping_charge,
    coalesce(i.units, 0) AS units,
    coalesce(shp.shipped_units, 0) AS shipped_units,
    coalesce(i.returned_units, 0) AS returned_units,
    coalesce(i.est_product_cost, 0) AS est_product_cost,
    coalesce(i.actual_product_cost, coalesce(i.est_product_cost, 0)) AS actual_product_cost,
    coalesce(i.cost_known, true) AS cost_snapshot_complete,
    CASE WHEN sh.shipments IS NULL OR sh.shipments = 0
         THEN coalesce(o.delivery_charge, 0)
         ELSE sh.est_delivery_known + sh.without_estimate * coalesce(o.delivery_charge, 0) END AS est_delivery_cost,
    coalesce(sh.collected, 0) AS collected_amount,
    coalesce(sh.actual_delivery, 0) AS actual_delivery_cost,
    coalesce(sh.cod_fees, 0) AS cod_fees,
    coalesce(sh.return_charges, 0) AS return_charges,
    coalesce(sh.other_courier, 0) AS other_courier_charges,
    coalesce(o.packing_charge, 0) + coalesce(ad.adj_packing, 0) AS actual_packing_cost,
    coalesce(o.packing_charge, 0) AS packing_charge,
    coalesce(ad.adj_income, 0) AS adjustment_income,
    coalesce(ad.adj_expense, 0) AS adjustment_expense,
    coalesce(ad.refunds, 0) AS refunded_amount,
    coalesce(sh.shipments, 0) AS shipment_count,
    coalesce(sh.with_collection, 0) AS shipments_with_collection,
    coalesce(sh.with_fee, 0) AS shipments_with_fee,
    coalesce(rt.unresolved_returns, 0) AS unresolved_returns,
    coalesce(rt.retained_recorded, 0) AS retained_amount,
    coalesce(dc.open_discrepancies, 0) AS open_discrepancies,
    coalesce(dc.open_discrepancy_amount, 0) AS open_discrepancy_amount
  FROM public.orders o
  LEFT JOIN item i ON i.order_id = o.id
  LEFT JOIN ship sh ON sh.order_id = o.id
  LEFT JOIN shipped shp ON shp.order_id = o.id
  LEFT JOIN adj ad ON ad.order_id = o.id
  LEFT JOIN ret rt ON rt.order_id = o.id
  LEFT JOIN disc dc ON dc.order_id = o.id
)
SELECT b.*,
  b.grand_total - b.est_product_cost - b.est_delivery_cost - b.packing_charge AS estimated_profit,
  b.collected_amount
    - b.actual_product_cost - b.actual_delivery_cost - b.cod_fees - b.return_charges
    - b.other_courier_charges - b.actual_packing_cost
    - b.adjustment_expense + b.adjustment_income
    + b.open_discrepancy_amount AS actual_profit,
  CASE
    WHEN b.shipment_count = 0 THEN
      CASE WHEN (b.adjustment_income + b.adjustment_expense) > 0 THEN 'partially_actual' ELSE 'estimated' END
    WHEN b.shipments_with_collection = b.shipment_count AND b.shipments_with_fee = b.shipment_count
         AND b.unresolved_returns = 0 AND b.open_discrepancies = 0
         AND (b.shipped_units >= b.units OR b.status = 'cancelled') THEN 'actual'
    WHEN b.shipments_with_collection > 0 OR b.shipments_with_fee > 0
         OR (b.adjustment_income + b.adjustment_expense) > 0 THEN 'partially_actual'
    ELSE 'estimated'
  END AS completeness
FROM base b;

GRANT SELECT ON public.order_financial_rollup TO authenticated;

CREATE OR REPLACE FUNCTION public.order_financials(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o public.orders; _r record;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read financial data';
  END IF;
  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF _o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  SELECT * INTO _r FROM public.order_financial_rollup WHERE order_id = _order_id;

  RETURN jsonb_build_object(
    'order_id', _o.id,
    'revenue', jsonb_build_object(
      'gross_product_amount', _o.subtotal,
      'item_discounts', _o.product_discount,
      'order_discounts', _o.order_discount,
      'net_product_revenue', _o.subtotal - _o.product_discount - _o.order_discount,
      'shipping_revenue', _o.shipping_charge,
      'other_adjustments', _o.adjustment,
      'customer_total', _o.grand_total),
    'estimated', jsonb_build_object(
      'product_cost', _r.est_product_cost,
      'delivery_cost', _r.est_delivery_cost,
      'packing_cost', coalesce(_o.packing_charge,0),
      'profit', _r.estimated_profit,
      'cost_snapshot_complete', _r.cost_snapshot_complete),
    'actual', jsonb_build_object(
      'collected_amount', _r.collected_amount,
      'product_cost', _r.actual_product_cost,
      'delivery_cost', _r.actual_delivery_cost,
      'cod_fees', _r.cod_fees,
      'return_charges', _r.return_charges,
      'other_courier_charges', _r.other_courier_charges,
      'packing_cost', _r.actual_packing_cost,
      'adjustment_income', _r.adjustment_income,
      'adjustment_expense', _r.adjustment_expense,
      'refunded_amount', _r.refunded_amount,
      'settlement_discrepancy', _r.open_discrepancy_amount,
      'profit', _r.actual_profit),
    'payment', jsonb_build_object(
      'expected_amount', _o.grand_total,
      'paid_amount', _o.paid_amount,
      'refunded_amount', _o.refunded_amount,
      'net_retained', _o.paid_amount - _o.refunded_amount,
      'due_amount', _o.due_amount,
      'status', _o.payment_status),
    'returns', jsonb_build_object(
      'returned_units', _r.returned_units,
      'cost_recovered', _r.actual_product_cost < _r.est_product_cost,
      'retained_amount', _r.retained_amount,
      'unresolved', _r.unresolved_returns),
    'realization', jsonb_build_object(
      'units_ordered', _r.units,
      'units_shipped', _r.shipped_units,
      'fully_realized', _r.shipped_units >= _r.units),
    'settlement', jsonb_build_object(
      'open_discrepancies', _r.open_discrepancies,
      'open_discrepancy_amount', _r.open_discrepancy_amount),
    'shipping_margin', _o.shipping_charge - CASE WHEN _r.actual_delivery_cost > 0 THEN _r.actual_delivery_cost ELSE _r.est_delivery_cost END,
    'shipment_count', _r.shipment_count,
    'shipments_with_collection', _r.shipments_with_collection,
    'completeness', _r.completeness);
END; $$;

-- ============================================================
-- 7. Multi-fulfillment reservation continuation
-- ============================================================
CREATE OR REPLACE FUNCTION public.reserve_order_inventory(_order_id uuid)
RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _order public.orders; _loc uuid; _item record; _need record;
  _blocked text := NULL; _stock_items int := 0; _note text;
  _already int; _remaining int; _has_reservations boolean := false;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to reserve inventory';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled order cannot reserve stock'; END IF;
  IF _order.verification_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Inventory is reserved only after verification is confirmed';
  END IF;
  IF _order.reservation_status = 'not_required' THEN RETURN _order; END IF;

  SELECT EXISTS (SELECT 1 FROM public.inventory_reservations
                  WHERE order_id = _order_id AND status IN ('active','committed'))
    INTO _has_reservations;

  SELECT id INTO _loc FROM public.inventory_locations
   WHERE status = 'active' AND is_default ORDER BY created_at LIMIT 1;

  DROP TABLE IF EXISTS _req;
  CREATE TEMP TABLE _req (
    order_item_id uuid, product_id uuid, variant_id uuid, label text, quantity int
  ) ON COMMIT DROP;

  FOR _item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity,
           oi.product_name, oi.variant_name, p.product_type, p.supply_model
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
     WHERE oi.order_id = _order_id
     ORDER BY oi.sort_order
  LOOP
    IF _item.product_type IS NULL THEN
      _blocked := coalesce(_blocked, 'Product record missing for "' || _item.product_name || '".');
      CONTINUE;
    END IF;
    IF _item.product_type IN ('service','digital') THEN CONTINUE; END IF;
    IF _item.product_type = 'bundle' THEN
      _blocked := coalesce(_blocked,
        'Bundle inventory allocation is not configured — "' || _item.product_name
        || '" cannot enter automatic reservation.');
      CONTINUE;
    END IF;
    IF _item.supply_model <> 'in_stock' THEN
      _blocked := coalesce(_blocked,
        'Supply model "' || _item.supply_model || '" for "' || _item.product_name
        || '" is not part of normal warehouse stock yet.');
      CONTINUE;
    END IF;
    IF _item.product_type = 'variable' AND _item.variant_id IS NULL THEN
      _blocked := coalesce(_blocked,
        'Variable product "' || _item.product_name || '" was ordered without a variant.');
      CONTINUE;
    END IF;

    -- Units already covered: still-open reservation remainders plus units
    -- already committed to a handover. Released shortages become reservable again.
    SELECT coalesce(sum(
             CASE WHEN status = 'active' THEN greatest(quantity - committed_quantity, 0) ELSE 0 END
             + CASE WHEN status IN ('active','committed') THEN committed_quantity ELSE 0 END), 0)
      INTO _already
      FROM public.inventory_reservations
     WHERE order_id = _order_id AND order_item_id = _item.id;

    _remaining := _item.quantity - _already;
    CONTINUE WHEN _remaining <= 0;

    _stock_items := _stock_items + 1;
    INSERT INTO _req(order_item_id, product_id, variant_id, label, quantity)
    VALUES (_item.id,
      CASE WHEN _item.variant_id IS NULL THEN _item.product_id ELSE NULL END,
      _item.variant_id,
      _item.product_name || coalesce(' — ' || _item.variant_name, ''),
      _remaining);
  END LOOP;

  PERFORM set_config('app.fulfillment_write', 'on', true);

  IF _blocked IS NOT NULL THEN
    UPDATE public.orders
       SET reservation_status = 'failed', fulfillment_status = 'on_hold',
           fulfillment_hold_reason = _blocked, updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Reservation failed — ' || _blocked, 'system', true, auth.uid());
    RETURN _order;
  END IF;

  IF _stock_items = 0 THEN
    IF _has_reservations THEN
      PERFORM set_config('app.fulfillment_write', 'off', true);
      RETURN _order;   -- everything already reserved or committed
    END IF;
    UPDATE public.orders
       SET reservation_status = 'not_required', fulfillment_status = 'ready',
           fulfillment_hold_reason = NULL, fulfillment_location_id = _loc,
           reserved_at = now(), updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'No stock reservation required — this order has no physical items.',
            'system', true, auth.uid());
    RETURN _order;
  END IF;

  IF _loc IS NULL THEN
    UPDATE public.orders
       SET reservation_status = 'failed', fulfillment_status = 'on_hold',
           fulfillment_hold_reason = 'No default active inventory location is configured.',
           updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Reservation failed — no default active inventory location is configured.',
            'system', true, auth.uid());
    RETURN _order;
  END IF;

  PERFORM l.id FROM public.inventory_levels l JOIN _req r
      ON l.location_id = _loc
     AND ((r.variant_id IS NOT NULL AND l.variant_id = r.variant_id)
       OR (r.product_id IS NOT NULL AND l.product_id = r.product_id))
   ORDER BY l.id FOR UPDATE OF l;

  FOR _need IN
    SELECT r.label, sum(r.quantity) AS required, l.id AS level_id,
           coalesce(l.on_hand - l.reserved, 0) AS available
      FROM _req r
      LEFT JOIN public.inventory_levels l
        ON l.location_id = _loc
       AND ((r.variant_id IS NOT NULL AND l.variant_id = r.variant_id)
         OR (r.product_id IS NOT NULL AND l.product_id = r.product_id))
     GROUP BY r.label, l.id, l.on_hand, l.reserved
  LOOP
    IF _need.level_id IS NULL THEN
      _blocked := coalesce(_blocked,
        'Insufficient stock: "' || _need.label || '" is not stocked at the default location.');
    ELSIF _need.available < _need.required THEN
      _blocked := coalesce(_blocked,
        'Insufficient stock: "' || _need.label || '" needs ' || _need.required
        || ', available ' || _need.available || '.');
    END IF;
  END LOOP;

  IF _blocked IS NOT NULL THEN
    UPDATE public.orders
       SET reservation_status = CASE WHEN _has_reservations THEN reservation_status ELSE 'failed' END,
           fulfillment_status = 'on_hold', fulfillment_hold_reason = _blocked,
           fulfillment_location_id = _loc, updated_by = auth.uid()
     WHERE id = _order_id RETURNING * INTO _order;
    PERFORM set_config('app.fulfillment_write', 'off', true);
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id, 'Reservation failed — ' || _blocked, 'system', true, auth.uid());
    RETURN _order;
  END IF;

  FOR _need IN
    SELECT r.order_item_id, r.product_id, r.variant_id, r.quantity, l.id AS level_id
      FROM _req r
      JOIN public.inventory_levels l
        ON l.location_id = _loc
       AND ((r.variant_id IS NOT NULL AND l.variant_id = r.variant_id)
         OR (r.product_id IS NOT NULL AND l.product_id = r.product_id))
  LOOP
    PERFORM set_config('app.reservation_write', 'on', true);
    INSERT INTO public.inventory_reservations
      (order_id, order_item_id, inventory_level_id, location_id, product_id, variant_id,
       quantity, status, created_by)
    VALUES (_order_id, _need.order_item_id, _need.level_id, _loc, _need.product_id,
            _need.variant_id, _need.quantity, 'active', auth.uid());
    PERFORM set_config('app.reservation_write', 'off', true);

    PERFORM public.apply_inventory_movement(
      _need.level_id, 'reservation', _need.quantity,
      'Reserved for order ' || _order.order_number, 'order', _order_id);
  END LOOP;

  UPDATE public.orders
     SET reservation_status = 'reserved', fulfillment_status = 'ready',
         fulfillment_hold_reason = NULL, fulfillment_location_id = _loc,
         reserved_at = now(), updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _order;
  PERFORM set_config('app.fulfillment_write', 'off', true);

  SELECT 'Inventory reserved at ' || name || ' — order is ready for warehouse processing.'
    INTO _note FROM public.inventory_locations WHERE id = _loc;
  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, _note, 'system', true, auth.uid());

  RETURN _order;
END; $$;