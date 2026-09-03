/**
 * The ONE trusted courier credential boundary — SERVER ONLY.
 *
 * Secret values are not stored as readable database columns any more: they
 * live in the encrypted vault and `courier_account_credentials` only keeps a
 * reference. The vault-reading SQL functions are executable by `service_role`
 * alone, so this module (which uses the service-role client) is the only way
 * a courier adapter can obtain a credential.
 *
 * Nothing here may be imported from browser code, returned through an RPC
 * projection, logged, or written into a booking snapshot.
 */

export interface CourierCredentials {
  accountId: string;
  clientId: string | null;
  username: string | null;
  clientSecret: string | null;
  password: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
}

/** Resolves the decrypted credentials for one courier account. */
export async function getCourierCredentials(
  accountId: string,
  options: { requireActive?: boolean } = {},
): Promise<CourierCredentials> {
  const db = await admin();
  const { data, error } = await db.rpc("courier_credentials_resolve", {
    _account_id: accountId,
    _require_active: options.requireActive ?? true,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, string | null>;
  return {
    accountId,
    clientId: row["client_id"] ?? null,
    username: row["username"] ?? null,
    clientSecret: row["client_secret"] ?? null,
    password: row["password"] ?? null,
    accessToken: row["access_token"] ?? null,
    refreshToken: row["refresh_token"] ?? null,
    tokenExpiresAt: row["token_expires_at"] ?? null,
  };
}

/** Persists a freshly issued provider token back into the vault. */
export async function storeCourierToken(
  accountId: string,
  token: { accessToken: string; refreshToken?: string | null; expiresAt?: string | null },
): Promise<void> {
  const db = await admin();
  const { error } = await db.rpc("courier_credentials_store_token", {
    _account_id: accountId,
    _access_token: token.accessToken,
    _refresh_token: token.refreshToken ?? null,
    _expires_at: token.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Writes configuration credentials. Values go straight into the vault. */
export async function setCourierCredentials(input: {
  accountId: string;
  clientId?: string | null;
  username?: string | null;
  clientSecret?: string | null;
  password?: string | null;
  webhookSecret?: string | null;
}): Promise<Record<string, boolean>> {
  const db = await admin();
  const { data, error } = await db.rpc("courier_credentials_set", {
    _account_id: input.accountId,
    _client_id: input.clientId ?? null,
    _username: input.username ?? null,
    _client_secret: input.clientSecret ?? null,
    _password: input.password ?? null,
    _webhook_secret: input.webhookSecret ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, boolean>;
}

/**
 * Identifies which courier account a webhook secret belongs to. The secret is
 * compared inside the database against fixed-length digests and is never
 * returned to this process.
 */
export async function matchCourierWebhookAccount(
  providerCode: string,
  presentedSecret: string,
): Promise<string | null> {
  const db = await admin();
  const { data, error } = await db.rpc("courier_webhook_match_account", {
    _provider_code: providerCode,
    _presented: presentedSecret,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}
