CREATE OR REPLACE FUNCTION public.guard_order_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.payment_write', true), '') = 'on' THEN RETURN NEW; END IF;

  IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
     OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount THEN
    RAISE EXCEPTION 'Collected and refunded amounts are derived from recorded money and can only change through payment reconciliation.';
  END IF;

  -- Order editing may recompute the derived due amount / payment label from the
  -- unchanged collected amount; nothing else may touch them.
  IF coalesce(current_setting('app.order_write', true), '') = 'on' THEN RETURN NEW; END IF;

  IF NEW.due_amount IS DISTINCT FROM OLD.due_amount
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'Payment amounts are derived from collected money and can only change through payment reconciliation.';
  END IF;
  RETURN NEW;
END; $$;