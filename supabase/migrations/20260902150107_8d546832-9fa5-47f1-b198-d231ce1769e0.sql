REVOKE EXECUTE ON FUNCTION public.create_shipment_exception(uuid, public.shipment_exception_type, text, text, text, numeric, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_exception_state(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_order_return(uuid, uuid, public.order_return_type, text, text, text, jsonb, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_return_state(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_return_receipt(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.inspect_return_items(uuid, jsonb, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_shipment_exception(uuid, public.shipment_exception_type, text, text, text, numeric, text, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_exception_state(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_order_return(uuid, uuid, public.order_return_type, text, text, text, jsonb, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_return_state(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_return_receipt(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inspect_return_items(uuid, jsonb, text) TO authenticated, service_role;