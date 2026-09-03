-- One dedicated secret per worker, generated in the database and stored
-- encrypted in the vault. No worker secret is ever readable from the API and
-- no worker may fall back to another worker's secret.
CREATE OR REPLACE FUNCTION public.ensure_worker_secret(_worker text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name text;
BEGIN
  IF _worker NOT IN ('courier_tracking', 'sync_queue', 'ops_sweeper') THEN
    RAISE EXCEPTION 'Unknown worker %', _worker;
  END IF;
  v_name := 'worker_secret_' || _worker;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_name) THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      v_name,
      'Background worker endpoint authentication secret'
    );
  END IF;

  RETURN v_name;
END;
$$;

-- Verification only: takes the presented secret, returns a boolean. The stored
-- value never leaves the database.
CREATE OR REPLACE FUNCTION public.worker_secret_matches(_worker text, _presented text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_stored text;
BEGIN
  IF _worker NOT IN ('courier_tracking', 'sync_queue', 'ops_sweeper') THEN
    RETURN false;
  END IF;
  IF _presented IS NULL OR length(_presented) < 16 THEN
    RETURN false;
  END IF;

  v_name := 'worker_secret_' || _worker;
  SELECT decrypted_secret INTO v_stored
  FROM vault.decrypted_secrets
  WHERE name = v_name;

  IF v_stored IS NULL THEN
    -- fail closed: an unprovisioned worker cannot be invoked
    RETURN false;
  END IF;

  -- digest comparison so the check does not short-circuit on the first byte
  RETURN extensions.digest(v_stored, 'sha256') = extensions.digest(_presented, 'sha256');
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_worker_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.worker_secret_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_worker_secret(text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.worker_secret_matches(text, text) TO service_role;

SELECT public.ensure_worker_secret('courier_tracking');
SELECT public.ensure_worker_secret('sync_queue');
SELECT public.ensure_worker_secret('ops_sweeper');