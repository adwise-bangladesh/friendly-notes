CREATE OR REPLACE FUNCTION public.guard_order_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.payment_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
     OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount THEN
    RAISE EXCEPTION 'Collected and refunded amounts are derived from recorded money and can only change through payment reconciliation.';
  END IF;
  IF coalesce(current_setting('app.order_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'Payment status is derived from collected money and can only change through payment reconciliation.';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.refresh_order_payment(_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _o public.orders; _collected numeric := 0; _refunded numeric := 0;
  _net numeric; _status public.payment_status;
BEGIN
  SELECT * INTO _o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _o.id IS NULL THEN RETURN; END IF;

  SELECT coalesce(sum(collected_amount), 0) INTO _collected
    FROM public.shipments WHERE order_id = _order_id AND status <> 'cancelled';

  SELECT greatest(coalesce(sum(amount) FILTER (WHERE direction = 'expense'), 0)
                - coalesce(sum(amount) FILTER (WHERE direction = 'income'), 0), 0)
    INTO _refunded
    FROM public.order_financial_adjustments
   WHERE order_id = _order_id AND adjustment_type = 'refund';

  _net := _collected - _refunded;
  _status := CASE
    WHEN _collected > 0 AND _net <= 0 THEN 'refunded'::public.payment_status
    WHEN _net >= coalesce(_o.grand_total, 0) AND _net > 0 THEN 'paid'::public.payment_status
    WHEN _net > 0 THEN 'partial'::public.payment_status
    ELSE 'unpaid'::public.payment_status END;

  IF _o.paid_amount = _collected AND _o.refunded_amount = _refunded AND _o.payment_status = _status THEN
    RETURN;
  END IF;

  PERFORM set_config('app.payment_write', 'on', true);
  UPDATE public.orders SET
    paid_amount = _collected,
    refunded_amount = _refunded,
    payment_status = _status
  WHERE id = _order_id;
  PERFORM set_config('app.payment_write', 'off', true);
END; $$;

REVOKE ALL ON FUNCTION public.refresh_order_payment(uuid) FROM PUBLIC, anon, authenticated;