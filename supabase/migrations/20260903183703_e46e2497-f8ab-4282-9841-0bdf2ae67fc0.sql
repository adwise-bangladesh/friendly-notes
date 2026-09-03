CREATE OR REPLACE FUNCTION public.claim_courier_tracking_polls(_limit integer DEFAULT 10, _lease_seconds integer DEFAULT 120, _worker text DEFAULT 'scheduled'::text)
RETURNS TABLE(shipment_id uuid, provider_code text, account_id uuid, consignment_id text, shipment_number text, lease_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _lease integer := greatest(30, least(coalesce(_lease_seconds,120), 600));
  _batch integer := greatest(1, least(coalesce(_limit,10), 25));
  _token uuid := gen_random_uuid();
  _terminal public.shipment_status[] := ARRAY['delivered','partial_delivered','cancelled','return_received','lost']::public.shipment_status[];
BEGIN
  INSERT INTO public.courier_tracking_polls (shipment_id)
  SELECT s.id FROM public.shipments s
   WHERE s.external_consignment_id IS NOT NULL
     AND s.courier_account_id IS NOT NULL
     AND NOT (s.status = ANY(_terminal))
  ON CONFLICT ON CONSTRAINT courier_tracking_polls_pkey DO NOTHING;

  DELETE FROM public.courier_tracking_polls p
   USING public.shipments s
   WHERE s.id = p.shipment_id AND s.status = ANY(_terminal);

  RETURN QUERY
  WITH due AS (
    SELECT p.shipment_id AS sid
      FROM public.courier_tracking_polls p
      JOIN public.shipments s ON s.id = p.shipment_id
      JOIN public.courier_accounts a ON a.id = s.courier_account_id
      JOIN public.courier_providers pr ON pr.id = s.provider_id
     WHERE p.next_poll_at <= now()
       AND (p.lease_until IS NULL OR p.lease_until < now())
       AND s.external_consignment_id IS NOT NULL
       AND NOT (s.status = ANY(_terminal))
       AND a.status = 'active'
       AND pr.status = 'active'
     ORDER BY p.next_poll_at
     LIMIT _batch
     FOR UPDATE OF p SKIP LOCKED
  ), claimed AS (
    UPDATE public.courier_tracking_polls p
       SET lease_token = _token,
           lease_until = now() + make_interval(secs => _lease),
           worker_id = coalesce(_worker,'scheduled'),
           attempts = p.attempts + 1
      FROM due
     WHERE p.shipment_id = due.sid
     RETURNING p.shipment_id AS sid
  )
  SELECT s.id, pr.code, s.courier_account_id, s.external_consignment_id, s.shipment_number, _token
    FROM claimed c
    JOIN public.shipments s ON s.id = c.sid
    JOIN public.courier_providers pr ON pr.id = s.provider_id;
END; $function$;

REVOKE ALL ON FUNCTION public.claim_courier_tracking_polls(integer, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_courier_tracking_polls(integer, integer, text) TO service_role;