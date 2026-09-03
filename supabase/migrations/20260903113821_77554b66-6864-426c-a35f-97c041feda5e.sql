ALTER VIEW public.order_financial_rollup SET (security_invoker = on);

REVOKE ALL ON FUNCTION public.refresh_order_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_return_financial_outcome(uuid, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_settlement_discrepancy(uuid, public.settlement_discrepancy_resolution, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_return_financial_outcome(uuid, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_settlement_discrepancy(uuid, public.settlement_discrepancy_resolution, text) TO authenticated;