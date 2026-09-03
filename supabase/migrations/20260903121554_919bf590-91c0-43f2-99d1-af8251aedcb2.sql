CREATE OR REPLACE FUNCTION public.guard_order_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.payment_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
     OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount THEN
    RAISE EXCEPTION 'Collected and refunded amounts are derived from recorded money and can only change through payment reconciliation.';
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'Payment status is derived from collected money and can only change through payment reconciliation.';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.record_return_financial_outcome(_return_id uuid, _refund_amount numeric DEFAULT 0, _retained_amount numeric DEFAULT NULL::numeric, _note text DEFAULT NULL::text)
 RETURNS order_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF coalesce(_refund_amount, 0) < 0 THEN
    RAISE EXCEPTION 'The refund amount cannot be negative.';
  END IF;
  IF _retained_amount IS NOT NULL AND _retained_amount < 0 THEN
    RAISE EXCEPTION 'The retained amount cannot be negative.';
  END IF;
  _refund := round(coalesce(_refund_amount, 0), 2);

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
      RETURN _r;
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
END; $function$;