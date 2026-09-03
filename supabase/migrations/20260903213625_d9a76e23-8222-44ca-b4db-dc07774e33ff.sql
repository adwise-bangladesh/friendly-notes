-- STEP 20.9.4: read-only recovery readiness check. No commerce workflow, guard,
-- grant, RLS, financial, shipment, worker-auth or Vault boundary is modified.
CREATE OR REPLACE FUNCTION public.recovery_readiness_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to read recovery readiness';
  END IF;

  SELECT jsonb_build_object(
    'checked_at', now(),
    'extensions', (SELECT jsonb_object_agg(extname, true) FROM pg_extension
                    WHERE extname IN ('pg_cron','pg_net','pgcrypto','supabase_vault','uuid-ossp')),
    'public_tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
    'public_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'),
    'rls_enabled_tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity),
    'rls_disabled_tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity),
    'policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
    'guards_present', (SELECT jsonb_object_agg(p.proname, true) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname IN
                          ('guard_shipment_write','guard_return_write','guard_fulfillment_write','guard_operational_diagnostics_write')),
    'cron_jobs', (SELECT jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active) ORDER BY jobname) FROM cron.job),
    'worker_secrets_present', (SELECT jsonb_object_agg(name, true) FROM vault.secrets
                                WHERE name IN ('worker_secret_courier_tracking','worker_secret_sync_queue','worker_secret_ops_sweeper')),
    'storage_buckets', (SELECT jsonb_agg(jsonb_build_object('id', id, 'public', public) ORDER BY id) FROM storage.buckets),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'core_counts', jsonb_build_object(
      'orders', (SELECT count(*) FROM public.orders),
      'order_items', (SELECT count(*) FROM public.order_items),
      'shipments', (SELECT count(*) FROM public.shipments),
      'shipment_items', (SELECT count(*) FROM public.shipment_items),
      'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
      'financial_adjustments', (SELECT count(*) FROM public.order_financial_adjustments),
      'settlements', (SELECT count(*) FROM public.courier_settlements),
      'returns', (SELECT count(*) FROM public.order_returns),
      'courier_accounts', (SELECT count(*) FROM public.courier_accounts),
      'worker_runs', (SELECT count(*) FROM public.worker_runs),
      'open_alerts', (SELECT count(*) FROM public.operational_alerts WHERE status <> 'resolved')
    )
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.recovery_readiness_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recovery_readiness_check() FROM anon;
GRANT EXECUTE ON FUNCTION public.recovery_readiness_check() TO authenticated, service_role;