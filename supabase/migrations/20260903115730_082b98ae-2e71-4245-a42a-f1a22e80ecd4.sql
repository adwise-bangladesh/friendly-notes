CREATE OR REPLACE FUNCTION public.return_financial_summary(_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _r public.order_returns; _v record;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read financial data';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;

  SELECT
    coalesce(sum(ri.quantity_expected), 0) AS expected_units,
    coalesce(sum(ri.quantity_received), 0) AS received_units,
    coalesce(sum(ri.quantity_accepted), 0) AS accepted_units,
    coalesce(sum(greatest(ri.quantity_received - ri.quantity_accepted, 0)), 0) AS rejected_units,
    coalesce(sum(coalesce(oi.unit_price, 0) * ri.quantity_received), 0) AS received_value,
    coalesce(sum(coalesce(oi.unit_price, 0) * ri.quantity_accepted), 0) AS accepted_value
  INTO _v
  FROM public.order_return_items ri
  JOIN public.order_items oi ON oi.id = ri.order_item_id
  WHERE ri.return_id = _r.id;

  RETURN jsonb_build_object(
    'return_id', _r.id,
    'order_id', _r.order_id,
    'status', _r.status,
    'expected_units', _v.expected_units,
    'received_units', _v.received_units,
    'accepted_units', _v.accepted_units,
    'rejected_units', _v.rejected_units,
    'received_value', round(_v.received_value, 2),
    'accepted_value', round(_v.accepted_value, 2),
    'max_refund', round(_v.received_value, 2),
    'can_record', (_r.status IN ('received','inspected','completed') AND _r.financial_recorded_at IS NULL),
    'recorded', _r.financial_recorded_at IS NOT NULL,
    'recorded_at', _r.financial_recorded_at,
    'outcome', _r.financial_outcome,
    'refund_amount', coalesce(_r.refund_amount, 0),
    'retained_amount', coalesce(_r.retained_amount, 0),
    'refund_adjustment_id', _r.refund_adjustment_id);
END; $$;

REVOKE ALL ON FUNCTION public.return_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_financial_summary(uuid) TO authenticated;