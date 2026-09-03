/**
 * Integrations Center data access (browser).
 *
 * Reads only. Every sensitive operation (state change, connection test,
 * location refresh) goes through a server function that re-checks permission
 * and touches credentials with the service-role client. Column lists are
 * always explicit — no `select("*")` — so a credential column can never be
 * pulled into the browser by accident.
 */

import { supabase } from "@/integrations/supabase/client";
import { capabilitiesFor, getIntegrationProvider, hasServerAdapter } from "./integrations-registry";
import type {
  IntegrationAccount,
  IntegrationAccountHealth,
  IntegrationActivityEntry,
  IntegrationConnectionStatus,
  IntegrationCredentialStatus,
  IntegrationWebhookOverviewRow,
} from "@/types/integrations";
import type { CourierEnvironment, CourierProvider, CourierProviderStatus } from "@/types/shipping";

const ACCOUNT_COLUMNS =
  "id, provider_id, name, code, environment, external_store_id, store_id, status, is_default, created_at, updated_at, store:stores(id, name)";

/** Courier providers as the Integrations Center sees them. */
export async function getIntegrationProviders(): Promise<CourierProvider[]> {
  const { data, error } = await supabase
    .from("courier_providers")
    .select("id, code, name, status, sort_order, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<CourierProvider[]>();
  if (error) throw error;
  return data ?? [];
}

interface AccountRow {
  id: string;
  provider_id: string;
  name: string;
  code: string;
  environment: CourierEnvironment;
  external_store_id: string | null;
  store_id: string | null;
  store: { id: string; name: string } | null;
  status: CourierProviderStatus;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Connection status is DERIVED, never stored twice:
 * - disabled  → the account was switched off by an administrator
 * - error     → the last provider call for this account failed
 * - connected → a provider call has succeeded
 * - disconnected → adapter exists but nothing has ever been exercised
 * - unknown   → no adapter, so there is nothing to connect to
 */
export function deriveConnectionStatus(input: {
  accountStatus: CourierProviderStatus;
  hasAdapter: boolean;
  health?: IntegrationAccountHealth | null;
}): IntegrationConnectionStatus {
  if (input.accountStatus === "disabled" || input.accountStatus === "inactive") return "disabled";
  if (!input.hasAdapter) return "unknown";
  const health = input.health;
  if (!health) return "disconnected";
  const success = health.last_success_at ? Date.parse(health.last_success_at) : 0;
  const failure = health.last_failure_at ? Date.parse(health.last_failure_at) : 0;
  if (failure > success) return "error";
  if (success > 0) return "connected";
  return "disconnected";
}

export async function getIntegrationAccounts(): Promise<IntegrationAccount[]> {
  const [providers, accountsResult] = await Promise.all([
    getIntegrationProviders(),
    supabase
      .from("courier_accounts")
      .select(ACCOUNT_COLUMNS)
      .order("name", { ascending: true })
      .returns<AccountRow[]>(),
  ]);
  if (accountsResult.error) throw accountsResult.error;

  const byId = new Map(providers.map((p) => [p.id, p]));
  return (accountsResult.data ?? []).map((row) => {
    const provider = byId.get(row.provider_id);
    const providerKey = provider?.code ?? "unknown";
    const definition = getIntegrationProvider(providerKey);
    return {
      id: row.id,
      providerId: row.provider_id,
      providerKey,
      providerName: provider?.name ?? providerKey,
      providerStatus: provider?.status ?? "inactive",
      category: definition?.category ?? "courier",
      name: row.name,
      code: row.code,
      environment: row.environment,
      externalStoreId: row.external_store_id,
      storeId: row.store_id,
      storeName: row.store?.name ?? null,
      scope: row.store_id ? "store" : "organization",
      accountStatus: row.status,
      isDefault: row.is_default,
      capabilities: capabilitiesFor(providerKey),
      hasAdapter: hasServerAdapter(providerKey),
      connection: deriveConnectionStatus({
        accountStatus: row.status,
        hasAdapter: hasServerAdapter(providerKey),
      }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } satisfies IntegrationAccount;
  });
}

export async function getIntegrationAccount(id: string): Promise<IntegrationAccount | null> {
  const accounts = await getIntegrationAccounts();
  return accounts.find((a) => a.id === id) ?? null;
}

/** Safe operational health. The function never returns any secret value. */
export async function getIntegrationAccountHealth(
  accountId: string,
): Promise<IntegrationAccountHealth | null> {
  const { data, error } = await supabase.rpc("integration_account_health", {
    _account_id: accountId,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as IntegrationAccountHealth[];
  return rows[0] ?? null;
}

/** Secret-free credential configuration state for one account. */
export async function getIntegrationCredentialStatus(
  accountId: string,
): Promise<IntegrationCredentialStatus | null> {
  const { data, error } = await supabase.rpc("courier_credential_status", {
    _account_id: accountId,
  });
  if (error) throw error;
  return (data as unknown as IntegrationCredentialStatus | null) ?? null;
}

/** Stores available as a scope target for a courier account. */
export async function getIntegrationStoreOptions(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("stores")
    .select("id, name")
    .order("name", { ascending: true })
    .returns<{ id: string; name: string }[]>();
  if (error) throw error;
  return data ?? [];
}

export interface ActivityFilters {
  providerId?: string | null;
  accountId?: string | null;
  activityType?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

/** Always bounded — the feed never loads unlimited history. */
export async function getIntegrationActivity(
  filters: ActivityFilters = {},
): Promise<{ rows: IntegrationActivityEntry[]; total: number }> {
  const args: {
    _provider_id?: string;
    _account_id?: string;
    _activity_type?: string;
    _status?: string;
    _from?: string;
    _to?: string;
    _limit: number;
    _offset: number;
  } = {
    _limit: Math.min(filters.limit ?? 50, 200),
    _offset: filters.offset ?? 0,
  };
  if (filters.providerId) args._provider_id = filters.providerId;
  if (filters.accountId) args._account_id = filters.accountId;
  if (filters.activityType) args._activity_type = filters.activityType;
  if (filters.status) args._status = filters.status;
  if (filters.from) args._from = filters.from;
  if (filters.to) args._to = filters.to;

  const { data, error } = await supabase.rpc("integration_activity_feed", args);
  if (error) throw error;
  const rows = (data ?? []) as unknown as IntegrationActivityEntry[];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export async function getIntegrationWebhookOverview(): Promise<IntegrationWebhookOverviewRow[]> {
  const { data, error } = await supabase.rpc("integration_webhook_overview");
  if (error) throw error;
  return (data ?? []) as unknown as IntegrationWebhookOverviewRow[];
}

/** Webhook endpoint path is public information; the shared secret never is. */
export function webhookEndpointPath(providerKey: string): string {
  return `/api/public/couriers/${providerKey}/webhook`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}
