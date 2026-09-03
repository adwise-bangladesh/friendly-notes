-- =========================================================
-- STEP 20.8.3.2 — Store-scoped courier accounts + credential hardening
-- =========================================================

-- ---------- A. Store scoping on courier accounts ----------

ALTER TABLE public.courier_accounts
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.courier_accounts.store_id IS
  'NULL = organization-wide (shared) account. Non-null = account scoped to exactly that store.';

CREATE UNIQUE INDEX IF NOT EXISTS courier_accounts_store_default_uk
  ON public.courier_accounts (provider_id, store_id)
  WHERE is_default AND status = 'active'::entity_status AND store_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS courier_accounts_org_default_uk
  ON public.courier_accounts (provider_id)
  WHERE is_default AND status = 'active'::entity_status AND store_id IS NULL;

CREATE INDEX IF NOT EXISTS courier_accounts_store_provider_idx
  ON public.courier_accounts (store_id, provider_id);

-- ---------- B. Authoritative account selection ----------

CREATE OR REPLACE FUNCTION public.resolve_courier_account(
  _store_id uuid,
  _provider_id uuid,
  _account_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _a public.courier_accounts;
BEGIN
  IF _provider_id IS NULL THEN
    RAISE EXCEPTION 'Select a courier provider first';
  END IF;

  IF _account_id IS NOT NULL THEN
    SELECT * INTO _a FROM public.courier_accounts WHERE id = _account_id;
    IF _a.id IS NULL THEN
      RAISE EXCEPTION 'Courier account not found';
    END IF;
    IF _a.provider_id <> _provider_id THEN
      RAISE EXCEPTION 'That courier account belongs to a different courier provider';
    END IF;
    IF _a.status <> 'active'::entity_status THEN
      RAISE EXCEPTION 'That courier account is disabled. Enable it or choose another account.';
    END IF;
    IF _a.store_id IS NOT NULL AND _a.store_id IS DISTINCT FROM _store_id THEN
      RAISE EXCEPTION 'That courier account belongs to another store and cannot be used here';
    END IF;
    RETURN _a.id;
  END IF;

  IF _store_id IS NOT NULL THEN
    SELECT * INTO _a FROM public.courier_accounts
     WHERE provider_id = _provider_id AND store_id = _store_id
       AND status = 'active'::entity_status AND is_default
     LIMIT 1;
    IF _a.id IS NOT NULL THEN RETURN _a.id; END IF;
  END IF;

  SELECT * INTO _a FROM public.courier_accounts
   WHERE provider_id = _provider_id AND store_id IS NULL
     AND status = 'active'::entity_status AND is_default
   LIMIT 1;
  IF _a.id IS NOT NULL THEN RETURN _a.id; END IF;

  RAISE EXCEPTION 'No active courier account is configured for this store and courier provider.';
END; $$;

REVOKE ALL ON FUNCTION public.resolve_courier_account(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_courier_account(uuid, uuid, uuid) TO authenticated, service_role;

-- Admin-only scope / default management (DB indexes stay authoritative).
CREATE OR REPLACE FUNCTION public.set_courier_account_scope(
  _account_id uuid,
  _store_id uuid,
  _is_default boolean
) RETURNS public.courier_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.courier_accounts;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an administrator can change an integration account';
  END IF;
  IF _store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.stores WHERE id = _store_id) THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  BEGIN
    UPDATE public.courier_accounts
       SET store_id = _store_id,
           is_default = coalesce(_is_default, false),
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = _account_id
    RETURNING * INTO _row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another active account is already the default for this courier in that scope. Clear that default first.';
  END;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Integration account not found';
  END IF;
  RETURN _row;
END; $$;

REVOKE ALL ON FUNCTION public.set_courier_account_scope(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_courier_account_scope(uuid, uuid, boolean) TO authenticated, service_role;

-- ---------- C. Courier assignment uses the resolver ----------

CREATE OR REPLACE FUNCTION public.assign_shipment_courier(
  _shipment_id uuid,
  _provider_id uuid,
  _service_type courier_service_type DEFAULT NULL::courier_service_type,
  _account_id uuid DEFAULT NULL::uuid
) RETURNS public.shipments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _s public.shipments;
  _p public.courier_providers;
  _a public.courier_accounts;
  _order public.orders;
  _resolved uuid;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to assign couriers';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF _s.external_consignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'This shipment is already booked with a courier consignment and cannot be reassigned';
  END IF;
  IF _s.status NOT IN ('draft','ready_for_booking','booking_requested','booking_failed') THEN
    RAISE EXCEPTION 'The courier can no longer be changed once booking is confirmed (current: %)', _s.status;
  END IF;
  SELECT * INTO _p FROM public.courier_providers WHERE id = _provider_id;
  IF _p.id IS NULL OR _p.status <> 'active' THEN
    RAISE EXCEPTION 'Courier provider is missing or not active';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _s.order_id;

  -- deterministic, server-authoritative selection (explicit → store default → shared default)
  _resolved := public.resolve_courier_account(_order.store_id, _p.id, _account_id);
  SELECT * INTO _a FROM public.courier_accounts WHERE id = _resolved;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments
     SET provider_id = _p.id, service_type = _service_type,
         courier_account_id = _a.id, updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'courier_assigned', _s.status, _s.status,
    'Courier set to ' || _p.name || coalesce(' (' || _a.name || ')', '') || '.',
    jsonb_build_object(
      'provider_id', _p.id,
      'account_id', _a.id,
      'account_scope', CASE WHEN _a.store_id IS NULL THEN 'organization' ELSE 'store' END,
      'account_store_id', _a.store_id));
  RETURN _s;
END; $$;

-- ---------- D. Booking validates account scope (20.8.3.1 protections unchanged) ----------

CREATE OR REPLACE FUNCTION public.book_shipment_begin(
  _shipment_id uuid,
  _stale_after_seconds integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _s public.shipments;
  _p public.courier_providers;
  _a public.courier_accounts;
  _order public.orders;
  _from public.shipment_status;
  _stale interval := make_interval(secs => greatest(coalesce(_stale_after_seconds, 300), 30));
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to book shipments with a courier';
  END IF;

  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  IF _s.external_consignment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'already_booked',
      'shipment_id', _s.id,
      'status', _s.status,
      'consignment_id', _s.external_consignment_id,
      'idempotency_key', _s.booking_idempotency_key);
  END IF;

  IF _s.status = 'cancelled' THEN
    RAISE EXCEPTION 'This shipment is cancelled and cannot be booked';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _s.order_id;
  IF _order.status = 'cancelled' THEN
    RAISE EXCEPTION 'The order is cancelled. This shipment cannot be booked.';
  END IF;

  IF _s.booking_outcome_unknown THEN
    RETURN jsonb_build_object(
      'outcome', 'recovery_required',
      'shipment_id', _s.id,
      'status', _s.status,
      'idempotency_key', _s.booking_idempotency_key,
      'message', coalesce(_s.booking_last_error,
        'The result of the previous booking attempt is unknown.'));
  END IF;

  IF _s.status NOT IN ('ready_for_booking', 'booking_failed', 'booking_requested') THEN
    RAISE EXCEPTION 'A shipment in state "%" cannot be booked', _s.status;
  END IF;

  IF _s.status = 'booking_requested'
     AND _s.booking_attempt_started_at IS NOT NULL
     AND now() - _s.booking_attempt_started_at < _stale THEN
    RETURN jsonb_build_object(
      'outcome', 'in_progress',
      'shipment_id', _s.id,
      'status', _s.status,
      'idempotency_key', _s.booking_idempotency_key,
      'started_at', _s.booking_attempt_started_at);
  END IF;

  IF _s.provider_id IS NULL OR _s.courier_account_id IS NULL THEN
    RAISE EXCEPTION 'Assign a courier provider and account before booking';
  END IF;
  SELECT * INTO _p FROM public.courier_providers WHERE id = _s.provider_id;
  IF _p.id IS NULL OR _p.status <> 'active' THEN
    RAISE EXCEPTION 'Courier provider is missing or not active';
  END IF;
  SELECT * INTO _a FROM public.courier_accounts WHERE id = _s.courier_account_id;
  IF _a.id IS NULL OR _a.status <> 'active'::entity_status OR _a.provider_id <> _p.id THEN
    RAISE EXCEPTION 'Courier account is missing, inactive, or belongs to another provider';
  END IF;
  IF _a.store_id IS NOT NULL AND _a.store_id IS DISTINCT FROM _order.store_id THEN
    RAISE EXCEPTION 'This shipment''s courier account belongs to another store. Reassign the courier before booking.';
  END IF;

  _from := _s.status;
  IF _from <> 'booking_requested'
     AND NOT public.shipment_transition_valid(_from, 'booking_requested') THEN
    RAISE EXCEPTION 'Transition from % to booking_requested is not allowed', _from;
  END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    status = 'booking_requested',
    booking_idempotency_key = coalesce(booking_idempotency_key, gen_random_uuid()::text),
    booking_attempt_started_at = now(),
    booking_attempt_count = booking_attempt_count + 1,
    booking_last_error = NULL,
    updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'booking_requested', _from, _s.status,
    'Courier booking attempt #' || _s.booking_attempt_count || ' started.',
    jsonb_build_object('idempotency_key', _s.booking_idempotency_key,
                       'attempt', _s.booking_attempt_count,
                       'provider_id', _p.id, 'account_id', _a.id));

  RETURN jsonb_build_object(
    'outcome', 'proceed',
    'shipment_id', _s.id,
    'status', _s.status,
    'idempotency_key', _s.booking_idempotency_key,
    'attempt', _s.booking_attempt_count,
    'provider_code', _p.code,
    'account_id', _a.id,
    'account_code', _a.code,
    'account_name', _a.name,
    'account_environment', _a.environment,
    'account_scope', CASE WHEN _a.store_id IS NULL THEN 'organization' ELSE 'store' END,
    'account_store_id', _a.store_id,
    'order_store_id', _order.store_id);
END; $$;

-- ---------- E. Credential hardening: encrypted vault storage ----------

ALTER TABLE public.courier_account_credentials
  ADD COLUMN IF NOT EXISTS client_secret_ref uuid,
  ADD COLUMN IF NOT EXISTS password_ref uuid,
  ADD COLUMN IF NOT EXISTS access_token_ref uuid,
  ADD COLUMN IF NOT EXISTS refresh_token_ref uuid,
  ADD COLUMN IF NOT EXISTS webhook_secret_ref uuid;

-- Staged safety: never drop plaintext while any row still holds it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.courier_account_credentials) THEN
    RAISE EXCEPTION 'Plaintext credential rows exist — migrate them into the vault before dropping the columns';
  END IF;
END $$;

ALTER TABLE public.courier_account_credentials
  DROP COLUMN IF EXISTS client_secret,
  DROP COLUMN IF EXISTS password,
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS webhook_secret;

COMMENT ON TABLE public.courier_account_credentials IS
  'Courier credential references. Secret VALUES live in the encrypted vault; this table only stores non-secret identifiers and vault references. Readable only by trusted server-side execution.';

-- vault helpers (owner = postgres, which holds vault privileges)
CREATE OR REPLACE FUNCTION public.courier_vault_put(_ref uuid, _name text, _value text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _id uuid;
BEGIN
  IF _value IS NULL THEN RETURN _ref; END IF;
  IF _ref IS NULL THEN
    _id := vault.create_secret(_value, _name, 'Courier integration credential');
    RETURN _id;
  END IF;
  PERFORM vault.update_secret(_ref, _value, _name, 'Courier integration credential');
  RETURN _ref;
END; $$;

CREATE OR REPLACE FUNCTION public.courier_vault_read(_ref uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = _ref; $$;

REVOKE ALL ON FUNCTION public.courier_vault_put(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_vault_read(uuid) FROM PUBLIC, anon, authenticated;

-- purge vault secrets when a credential row is removed
CREATE OR REPLACE FUNCTION public.courier_credentials_purge_vault()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM vault.secrets
   WHERE id IN (OLD.client_secret_ref, OLD.password_ref, OLD.access_token_ref,
                OLD.refresh_token_ref, OLD.webhook_secret_ref);
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS courier_credentials_purge_vault ON public.courier_account_credentials;
CREATE TRIGGER courier_credentials_purge_vault
  AFTER DELETE ON public.courier_account_credentials
  FOR EACH ROW EXECUTE FUNCTION public.courier_credentials_purge_vault();

-- single authoritative writer
CREATE OR REPLACE FUNCTION public.courier_credentials_set(
  _account_id uuid,
  _client_id text DEFAULT NULL,
  _username text DEFAULT NULL,
  _client_secret text DEFAULT NULL,
  _password text DEFAULT NULL,
  _webhook_secret text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.courier_account_credentials;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.courier_accounts WHERE id = _account_id) THEN
    RAISE EXCEPTION 'Courier account not found';
  END IF;

  INSERT INTO public.courier_account_credentials (account_id)
  VALUES (_account_id)
  ON CONFLICT (account_id) DO NOTHING;

  SELECT * INTO _row FROM public.courier_account_credentials
   WHERE account_id = _account_id FOR UPDATE;

  UPDATE public.courier_account_credentials SET
    client_id = coalesce(nullif(btrim(coalesce(_client_id, '')), ''), client_id),
    username  = coalesce(nullif(btrim(coalesce(_username, '')), ''), username),
    client_secret_ref = public.courier_vault_put(_row.client_secret_ref,
        'courier:' || _account_id || ':client_secret', nullif(_client_secret, '')),
    password_ref = public.courier_vault_put(_row.password_ref,
        'courier:' || _account_id || ':password', nullif(_password, '')),
    webhook_secret_ref = public.courier_vault_put(_row.webhook_secret_ref,
        'courier:' || _account_id || ':webhook_secret', nullif(_webhook_secret, '')),
    -- changing the client credentials invalidates any cached token
    access_token_ref = CASE WHEN nullif(_client_secret, '') IS NOT NULL
                              OR nullif(_password, '') IS NOT NULL
                            THEN NULL ELSE access_token_ref END,
    refresh_token_ref = CASE WHEN nullif(_client_secret, '') IS NOT NULL
                              OR nullif(_password, '') IS NOT NULL
                            THEN NULL ELSE refresh_token_ref END,
    token_expires_at = CASE WHEN nullif(_client_secret, '') IS NOT NULL
                              OR nullif(_password, '') IS NOT NULL
                            THEN NULL ELSE token_expires_at END,
    updated_at = now()
   WHERE account_id = _account_id
  RETURNING * INTO _row;

  RETURN jsonb_build_object(
    'account_id', _row.account_id,
    'has_client_id', _row.client_id IS NOT NULL,
    'has_username', _row.username IS NOT NULL,
    'has_client_secret', _row.client_secret_ref IS NOT NULL,
    'has_password', _row.password_ref IS NOT NULL,
    'has_webhook_secret', _row.webhook_secret_ref IS NOT NULL);
END; $$;

-- single authoritative reader (server-side only)
CREATE OR REPLACE FUNCTION public.courier_credentials_resolve(
  _account_id uuid,
  _require_active boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _a public.courier_accounts; _c public.courier_account_credentials;
BEGIN
  SELECT * INTO _a FROM public.courier_accounts WHERE id = _account_id;
  IF _a.id IS NULL THEN RAISE EXCEPTION 'Courier account not found'; END IF;
  IF _require_active AND _a.status <> 'active'::entity_status THEN
    RAISE EXCEPTION 'This courier account is not active';
  END IF;

  SELECT * INTO _c FROM public.courier_account_credentials WHERE account_id = _account_id;
  IF _c.account_id IS NULL THEN
    RAISE EXCEPTION 'No credentials are configured for this courier account';
  END IF;

  RETURN jsonb_build_object(
    'account_id', _c.account_id,
    'client_id', _c.client_id,
    'username', _c.username,
    'client_secret', public.courier_vault_read(_c.client_secret_ref),
    'password', public.courier_vault_read(_c.password_ref),
    'access_token', public.courier_vault_read(_c.access_token_ref),
    'refresh_token', public.courier_vault_read(_c.refresh_token_ref),
    'token_expires_at', _c.token_expires_at);
END; $$;

CREATE OR REPLACE FUNCTION public.courier_credentials_store_token(
  _account_id uuid,
  _access_token text,
  _refresh_token text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _c public.courier_account_credentials;
BEGIN
  SELECT * INTO _c FROM public.courier_account_credentials
   WHERE account_id = _account_id FOR UPDATE;
  IF _c.account_id IS NULL THEN
    RAISE EXCEPTION 'No credentials are configured for this courier account';
  END IF;

  UPDATE public.courier_account_credentials SET
    access_token_ref = public.courier_vault_put(_c.access_token_ref,
      'courier:' || _account_id || ':access_token', nullif(_access_token, '')),
    refresh_token_ref = public.courier_vault_put(_c.refresh_token_ref,
      'courier:' || _account_id || ':refresh_token', nullif(_refresh_token, '')),
    token_expires_at = coalesce(_expires_at, token_expires_at),
    token_refreshed_at = now(),
    updated_at = now()
   WHERE account_id = _account_id;
END; $$;

-- webhook identification without ever returning the secret
CREATE OR REPLACE FUNCTION public.courier_webhook_match_account(
  _provider_code text,
  _presented text
) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _p public.courier_providers; _account_id uuid; _presented_hash text;
BEGIN
  IF _presented IS NULL OR length(_presented) = 0 THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.courier_providers WHERE code = lower(_provider_code);
  IF _p.id IS NULL OR _p.status <> 'active' THEN RETURN NULL; END IF;

  -- fixed-length digest comparison: no early exit on secret content
  _presented_hash := encode(extensions.digest(_presented, 'sha256'), 'hex');

  SELECT a.id INTO _account_id
    FROM public.courier_accounts a
    JOIN public.courier_account_credentials c ON c.account_id = a.id
   WHERE a.provider_id = _p.id
     AND a.status = 'active'::entity_status
     AND c.webhook_secret_ref IS NOT NULL
     AND encode(extensions.digest(
           coalesce(public.courier_vault_read(c.webhook_secret_ref), ''), 'sha256'), 'hex')
         = _presented_hash
   LIMIT 1;

  RETURN _account_id;
END; $$;

REVOKE ALL ON FUNCTION public.courier_credentials_set(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_credentials_resolve(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_credentials_store_token(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_webhook_match_account(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_credentials_set(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_credentials_resolve(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_credentials_store_token(uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_webhook_match_account(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_vault_put(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_vault_read(uuid) TO service_role;

-- ---------- F. Grants / exposure ----------

REVOKE ALL ON public.courier_account_credentials FROM anon, authenticated;
GRANT ALL ON public.courier_account_credentials TO service_role;
REVOKE ALL ON public.courier_accounts FROM anon;

-- ---------- G. Status projections keep working (booleans only) ----------

CREATE OR REPLACE FUNCTION public.integration_account_health(_account_id uuid)
RETURNS TABLE(account_id uuid, has_credentials boolean, has_webhook_secret boolean,
              last_token_refresh_at timestamptz, token_expires_at timestamptz,
              last_success_at timestamptz, last_failure_at timestamptz,
              last_failure_message text, failure_count_24h integer,
              last_webhook_at timestamptz, last_activity_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select
    _account_id,
    (c.account_id is not null and (c.client_secret_ref is not null or c.password_ref is not null)),
    (c.webhook_secret_ref is not null),
    c.token_refreshed_at,
    c.token_expires_at,
    (select max(l.created_at) from public.courier_api_logs l where l.account_id = _account_id and l.succeeded),
    (select max(l.created_at) from public.courier_api_logs l where l.account_id = _account_id and not l.succeeded),
    (select l.safe_message from public.courier_api_logs l
      where l.account_id = _account_id and not l.succeeded
      order by l.created_at desc limit 1),
    (select count(*)::int from public.courier_api_logs l
      where l.account_id = _account_id and not l.succeeded and l.created_at > now() - interval '24 hours'),
    (select max(e.received_at) from public.courier_provider_events e
      where e.account_id = _account_id and e.source = 'webhook'),
    greatest(
      coalesce((select max(l.created_at) from public.courier_api_logs l where l.account_id = _account_id), 'epoch'::timestamptz),
      coalesce((select max(e.received_at) from public.courier_provider_events e where e.account_id = _account_id), 'epoch'::timestamptz)
    )
  from (select 1) s
  left join public.courier_account_credentials c on c.account_id = _account_id
  where public.can_read_commerce(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.integration_webhook_overview()
RETURNS TABLE(provider_id uuid, provider_code text, provider_name text, account_id uuid,
              account_name text, environment text, webhook_configured boolean,
              last_received_at timestamptz, applied_count integer, duplicate_count integer,
              ignored_count integer, rejected_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select p.id, p.code, p.name, a.id, a.name, a.environment::text,
         (c.webhook_secret_ref is not null),
         (select max(e.received_at) from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook'),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook' and e.processing_status = 'applied'),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook' and e.processing_status = 'duplicate'),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook'
             and e.processing_status in ('recorded', 'stale')),
         (select count(*)::int from public.courier_provider_events e
           where e.account_id = a.id and e.source = 'webhook'
             and e.processing_status in ('rejected', 'unmatched'))
    from public.courier_accounts a
    join public.courier_providers p on p.id = a.provider_id
    left join public.courier_account_credentials c on c.account_id = a.id
   where public.can_read_commerce(auth.uid())
   order by p.name, a.name;
$$;

-- account configuration status for the management UI (never a secret value)
CREATE OR REPLACE FUNCTION public.courier_credential_status(_account_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select jsonb_build_object(
    'account_id', _account_id,
    'has_client_id', c.client_id is not null,
    'has_username', c.username is not null,
    'has_client_secret', c.client_secret_ref is not null,
    'has_password', c.password_ref is not null,
    'has_webhook_secret', c.webhook_secret_ref is not null,
    'token_expires_at', c.token_expires_at,
    'token_refreshed_at', c.token_refreshed_at)
  from (select 1) s
  left join public.courier_account_credentials c on c.account_id = _account_id
  where public.can_read_commerce(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.courier_credential_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_credential_status(uuid) TO authenticated, service_role;