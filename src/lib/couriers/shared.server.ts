/**
 * Shared plumbing for courier adapters — SERVER ONLY.
 *
 * Adapters differ in payloads and endpoints, not in how they load an account,
 * resolve credentials or normalize failures. Keeping that identical here means
 * every provider produces the same `CourierError` vocabulary, so the booking
 * workflow can decide "definite failure" vs "unknown outcome" uniformly.
 *
 * Credentials are only ever obtained through `credentials.server.ts`; nothing
 * in this module logs, returns or snapshots a secret.
 */

import { CourierError } from "@/types/couriers";
import { getCourierCredentials, type CourierCredentials } from "./credentials.server";

export interface CourierAccountContext {
  accountId: string;
  providerId: string;
  environment: string;
  baseUrl: string;
  externalStoreId: string | null;
  credentials: CourierCredentials;
}

export function fail(
  category: CourierError["category"],
  message: string,
  statusCode?: number,
): never {
  throw new CourierError({
    category,
    message,
    ...(statusCode === undefined ? {} : { statusCode }),
    retryable: category === "provider_unavailable" || category === "rate_limited",
  });
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Loads an active courier account plus its vault-backed credentials. */
export async function loadCourierAccount(
  accountId: string,
  bases: { sandbox: string; production: string },
): Promise<CourierAccountContext> {
  const db = await admin();
  const { data: account, error } = await db
    .from("courier_accounts")
    .select("id, provider_id, environment, external_store_id, base_url, status")
    .eq("id", accountId)
    .maybeSingle();
  if (error) fail("unknown", "Could not load the courier account");
  if (!account) fail("not_found", "Courier account not found");
  if (account.status !== "active") fail("validation", "This courier account is not active");

  let credentials: CourierCredentials;
  try {
    credentials = await getCourierCredentials(accountId);
  } catch {
    fail("auth", "No credentials are configured for this courier account");
  }

  return {
    accountId,
    providerId: account.provider_id,
    environment: account.environment ?? "sandbox",
    baseUrl:
      account.base_url ??
      (account.environment === "production" ? bases.production : bases.sandbox),
    externalStoreId: account.external_store_id,
    credentials,
  };
}

/**
 * Performs a provider call and normalizes the response into the shared error
 * vocabulary. A transport failure or 5xx stays "provider_unavailable" so the
 * booking workflow treats the outcome as unknown rather than as a clean miss.
 */
export async function courierFetch<T>(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    fail("provider_unavailable", "The courier API could not be reached");
  }

  if (response.status === 401 || response.status === 403) {
    fail("auth", "The courier rejected the credentials for this account", response.status);
  }
  if (response.status === 429) {
    fail("rate_limited", "The courier API is rate limiting requests", 429);
  }
  if (response.status === 404) {
    fail("not_found", "The courier does not know this record", 404);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    fail(
      response.status >= 500 ? "provider_unavailable" : "validation",
      `The courier rejected the request (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    // a 2xx we cannot read leaves the real outcome unknown
    fail("provider_unavailable", "The courier returned an unreadable response");
  }
}
