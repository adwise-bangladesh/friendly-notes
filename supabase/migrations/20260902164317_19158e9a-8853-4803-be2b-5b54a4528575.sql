
-- Remove the implicit PUBLIC execute grant, then re-grant only to signed-in users.
REVOKE EXECUTE ON FUNCTION public.normalize_bd_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repeat_customer_threshold() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_customer_by_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_customer_for_order(text,text,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_customer(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_customer_status(uuid, public.customer_status, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_customer_note(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_customer_manual_flag(uuid, public.customer_manual_flag_type, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.customer_metrics(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.customer_list(text, public.customer_status, text, boolean, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.customer_timeline(uuid, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.customer_financial_summary(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_customer_write() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_customer_notes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_customer_flags() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.normalize_bd_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repeat_customer_threshold() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_customer_by_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_customer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_status(uuid, public.customer_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_customer_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_manual_flag(uuid, public.customer_manual_flag_type, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_metrics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_list(text, public.customer_status, text, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_timeline(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_financial_summary(uuid) TO authenticated;

-- Internal only: triggers and the order-creation helper run as the definer.
GRANT EXECUTE ON FUNCTION public.normalize_bd_phone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_customer_for_order(text,text,text,uuid) TO service_role;
