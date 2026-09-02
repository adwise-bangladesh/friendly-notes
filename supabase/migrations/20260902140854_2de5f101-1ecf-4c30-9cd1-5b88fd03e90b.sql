REVOKE ALL ON FUNCTION public.log_shipment_event(uuid, uuid, public.shipment_event_type, public.shipment_status, public.shipment_status, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_shipment(uuid, jsonb, uuid, public.courier_service_type, numeric, numeric, numeric, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_shipment_courier(uuid, uuid, public.courier_service_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_shipment_details(uuid, numeric, numeric, numeric, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_shipment_state(uuid, text, text, public.shipment_hold_reason, public.shipment_failure_reason, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shipment(uuid, jsonb, uuid, public.courier_service_type, numeric, numeric, numeric, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_shipment_courier(uuid, uuid, public.courier_service_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shipment_details(uuid, numeric, numeric, numeric, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_shipment_state(uuid, text, text, public.shipment_hold_reason, public.shipment_failure_reason, text, text) TO authenticated;