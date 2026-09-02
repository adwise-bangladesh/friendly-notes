-- ============ Purchasability: only ACTIVE products may be purchasable ============
CREATE OR REPLACE FUNCTION public.enforce_product_purchasable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    NEW.is_purchasable := false;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_product_purchasable() FROM PUBLIC;

UPDATE public.products SET is_purchasable = false
WHERE is_purchasable AND status IS DISTINCT FROM 'active';

-- ============ Group Buy: lock current_quantity against direct writes ============
CREATE OR REPLACE FUNCTION public.guard_group_buy_quantity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Demand always starts at zero; it is never supplied by the client.
    NEW.current_quantity := 0;
    RETURN NEW;
  END IF;

  IF NEW.current_quantity IS DISTINCT FROM OLD.current_quantity
     AND coalesce(current_setting('app.group_buy_quantity_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'current_quantity cannot be modified directly. Use adjust_group_buy_campaign_quantity().';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_group_buy_quantity() FROM PUBLIC;

DROP TRIGGER IF EXISTS group_buy_campaigns_guard_quantity ON public.group_buy_campaigns;
CREATE TRIGGER group_buy_campaigns_guard_quantity
  BEFORE INSERT OR UPDATE ON public.group_buy_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_group_buy_quantity();

-- Controlled, admin-only manual adjustment until orders drive the number.
CREATE OR REPLACE FUNCTION public.adjust_group_buy_campaign_quantity(
  _campaign_id uuid,
  _quantity integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or owner may adjust confirmed group buy quantity';
  END IF;
  IF _quantity IS NULL OR _quantity < 0 THEN
    RAISE EXCEPTION 'Quantity must be zero or greater';
  END IF;

  PERFORM set_config('app.group_buy_quantity_write', 'on', true);
  UPDATE public.group_buy_campaigns
     SET current_quantity = _quantity,
         updated_by = auth.uid()
   WHERE id = _campaign_id
   RETURNING current_quantity INTO result;
  PERFORM set_config('app.group_buy_quantity_write', 'off', true);

  IF result IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.adjust_group_buy_campaign_quantity(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_group_buy_campaign_quantity(uuid, integer) TO authenticated;