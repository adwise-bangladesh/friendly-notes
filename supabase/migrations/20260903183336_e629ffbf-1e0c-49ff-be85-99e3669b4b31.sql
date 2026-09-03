REVOKE ALL ON public.courier_tracking_polls FROM anon, authenticated;
GRANT ALL ON public.courier_tracking_polls TO service_role;