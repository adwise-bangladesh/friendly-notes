
-- Scheduler → trigger_worker() → worker endpoint.
-- Reads the worker's OWN vault secret and sends it as a header. Nothing is
-- returned to the caller except the pg_net request id, so the secret never
-- leaves the database.
CREATE OR REPLACE FUNCTION public.trigger_worker(_worker text, _base_url text, _path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  IF _worker NOT IN ('courier_tracking', 'sync_queue', 'ops_sweeper') THEN
    RAISE EXCEPTION 'Unknown worker';
  END IF;
  IF _base_url !~ '^https://[a-z0-9.-]+$' THEN
    RAISE EXCEPTION 'Invalid worker base url';
  END IF;
  IF _path !~ '^/api/public/[a-z0-9/-]+$' THEN
    RAISE EXCEPTION 'Invalid worker path';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'worker_secret_' || _worker;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Worker secret is not provisioned';
  END IF;

  SELECT net.http_post(
    url := _base_url || _path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_worker(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_worker(text, text, text) TO postgres, service_role;
