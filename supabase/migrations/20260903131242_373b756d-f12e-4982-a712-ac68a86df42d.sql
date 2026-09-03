DROP FUNCTION IF EXISTS public.update_order_customer(uuid, text, text, text, uuid);

REVOKE ALL ON FUNCTION public.update_order_customer(uuid, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_customer(uuid, text, text, text, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.import_external_order(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_external_order(uuid, uuid, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_order_address(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_address(uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_job_attempt_write() FROM PUBLIC, anon, authenticated;