-- Signed-out visitors have no business touching operational records.
REVOKE ALL ON public.order_returns FROM anon;
REVOKE ALL ON public.order_return_items FROM anon;
REVOKE ALL ON public.shipments FROM anon;

-- Every write to these tables already goes through SECURITY DEFINER workflow
-- functions; table-level write privileges add nothing but risk.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_financial_adjustments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.courier_settlements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.courier_settlement_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.courier_settlement_discrepancies FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_returns FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_return_items FROM authenticated;

GRANT SELECT ON public.order_financial_adjustments TO authenticated;
GRANT SELECT ON public.courier_settlements TO authenticated;
GRANT SELECT ON public.courier_settlement_items TO authenticated;
GRANT SELECT ON public.courier_settlement_discrepancies TO authenticated;
GRANT SELECT ON public.order_returns TO authenticated;
GRANT SELECT ON public.order_return_items TO authenticated;
GRANT ALL ON public.order_financial_adjustments TO service_role;
GRANT ALL ON public.courier_settlements TO service_role;
GRANT ALL ON public.courier_settlement_items TO service_role;
GRANT ALL ON public.courier_settlement_discrepancies TO service_role;
GRANT ALL ON public.order_returns TO service_role;
GRANT ALL ON public.order_return_items TO service_role;