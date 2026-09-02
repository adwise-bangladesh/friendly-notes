REVOKE ALL ON FUNCTION public.refresh_order_delivery_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_order_delivery_projection() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_order_delivery_projection_from_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_delivery() FROM PUBLIC, anon, authenticated;