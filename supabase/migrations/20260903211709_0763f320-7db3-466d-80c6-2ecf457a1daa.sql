
REVOKE ALL ON FUNCTION public.guard_operational_diagnostics_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_operational_diagnostics_write() TO service_role;
REVOKE ALL ON FUNCTION public.start_worker_run(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_worker_run(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_worker_run(text, text, text) TO service_role;
