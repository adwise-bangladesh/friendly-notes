REVOKE ALL ON FUNCTION public.restock_return_inventory(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_shipment_return(uuid, public.order_return_status, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_item_returnable_quantity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_item_returnable_quantity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restock_return_inventory(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_shipment_return(uuid, public.order_return_status, text, timestamptz, text) TO service_role;