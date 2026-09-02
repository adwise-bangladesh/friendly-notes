/**
 * Stores & sales channels — browser data access.
 *
 * Reads only, with explicit column lists (credentials live in a separate
 * server-only table that the browser cannot query at all). Every mutation goes
 * through a controlled database function or a server function.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  ChannelCredentialStatus,
  ExternalEntityMapping,
  SalesChannelAccount,
  SalesChannelStatus,
  SalesChannelSyncRun,
  Store,
  StoreListRow,
  StoreStatus,
} from "@/types/stores";
import type { Json } from "@/integrations/supabase/types";

const STORE_COLUMNS =
  "id, name, slug, code, status, currency, timezone, country, order_number_prefix, default_warehouse_id, created_at, updated_at";

const CHANNEL_COLUMNS =
  "id, store_id, provider, name, status, environment, external_store_id, external_store_name, last_sync_at, last_successful_sync_at, last_error, created_at, updated_at";

const RUN_COLUMNS =
  "id, sales_channel_account_id, sync_type, status, started_at, completed_at, records_fetched, records_created, records_updated, records_skipped, records_failed, error_summary";

export async function getStoreList(): Promise<StoreListRow[]> {
  const { data, error } = await supabase.rpc("store_list");
  if (error) throw error;
  return (data ?? []) as unknown as StoreListRow[];
}

export async function getStore(id: string): Promise<Store | null> {
  const { data, error } = await supabase
    .from("stores")
    .select(STORE_COLUMNS)
    .eq("id", id)
    .maybeSingle<Store>();
  if (error) throw error;
  return data;
}

export async function getActiveStores(): Promise<Pick<Store, "id" | "name" | "code">[]> {
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, code")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getStoreChannels(storeId: string): Promise<SalesChannelAccount[]> {
  const { data, error } = await supabase
    .from("sales_channel_accounts")
    .select(CHANNEL_COLUMNS)
    .eq("store_id", storeId)
    .order("created_at")
    .returns<SalesChannelAccount[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getChannel(id: string): Promise<SalesChannelAccount | null> {
  const { data, error } = await supabase
    .from("sales_channel_accounts")
    .select(CHANNEL_COLUMNS)
    .eq("id", id)
    .maybeSingle<SalesChannelAccount>();
  if (error) throw error;
  return data;
}

export async function getSyncRuns(accountIds: string[], limit = 50): Promise<SalesChannelSyncRun[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await supabase
    .from("sales_channel_sync_runs")
    .select(RUN_COLUMNS)
    .in("sales_channel_account_id", accountIds)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<SalesChannelSyncRun[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getMappings(
  accountIds: string[],
  limit = 100,
): Promise<ExternalEntityMapping[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await supabase
    .from("external_entity_mappings")
    .select(
      "id, sales_channel_account_id, entity_type, internal_id, external_id, external_reference, created_at",
    )
    .in("sales_channel_account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<ExternalEntityMapping[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getStoreOrderCount(storeId: string): Promise<number> {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId);
  if (error) throw error;
  return count ?? 0;
}

/** Safe indicator only — the credential values never leave the server. */
export async function getCredentialStatus(accountId: string): Promise<ChannelCredentialStatus> {
  const { data, error } = await supabase.rpc("sales_channel_credentials_status", {
    _account_id: accountId,
  });
  if (error) throw error;
  return data as unknown as ChannelCredentialStatus;
}

export interface StoreInput {
  id?: string;
  name: string;
  slug: string;
  code: string;
  currency?: string;
  timezone?: string;
  country?: string;
  order_number_prefix?: string | null;
  default_warehouse_id?: string | null;
}

export async function saveStore(input: StoreInput): Promise<Store> {
  const { data, error } = await supabase.rpc("save_store", {
    _payload: input as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as Store;
}

export async function setStoreStatus(storeId: string, status: StoreStatus): Promise<Store> {
  const { data, error } = await supabase.rpc("set_store_status", {
    _store_id: storeId,
    _status: status,
  });
  if (error) throw error;
  return data as unknown as Store;
}

export interface ChannelInput {
  id?: string;
  store_id?: string;
  provider?: SalesChannelAccount["provider"];
  name: string;
  environment?: SalesChannelAccount["environment"];
  external_store_id?: string | null;
  external_store_name?: string | null;
}

export async function saveChannel(input: ChannelInput): Promise<SalesChannelAccount> {
  const { data, error } = await supabase.rpc("save_sales_channel_account", {
    _payload: input as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as SalesChannelAccount;
}

export async function setChannelStatus(
  accountId: string,
  status: SalesChannelStatus,
): Promise<SalesChannelAccount> {
  const { data, error } = await supabase.rpc("set_sales_channel_account_state", {
    _account_id: accountId,
    _status: status,
  });
  if (error) throw error;
  return data as unknown as SalesChannelAccount;
}
