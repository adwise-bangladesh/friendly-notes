DROP FUNCTION IF EXISTS public.cancel_order(uuid, text);

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.commit_order_inventory(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_order_inventory(uuid) TO service_role;