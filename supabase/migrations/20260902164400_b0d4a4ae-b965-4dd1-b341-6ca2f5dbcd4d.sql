
REVOKE EXECUTE ON FUNCTION public.guard_customer_write() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_customer_notes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_customer_flags() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_customer_for_order(text,text,text,uuid) FROM anon, authenticated;
