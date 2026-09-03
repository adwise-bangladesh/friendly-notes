CREATE OR REPLACE FUNCTION public.sync_shipment_return_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _target public.order_return_status;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _target := CASE NEW.status
      WHEN 'return_requested'  THEN 'pending'::public.order_return_status
      WHEN 'return_in_transit' THEN 'in_transit'::public.order_return_status
      WHEN 'return_received'   THEN 'received'::public.order_return_status
      ELSE NULL END;
    IF _target IS NOT NULL THEN
      PERFORM public.ensure_shipment_return(
        NEW.id, _target, NEW.return_reason, now(), NULL);
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS shipments_sync_return_record ON public.shipments;
CREATE TRIGGER shipments_sync_return_record
AFTER UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.sync_shipment_return_record();