/**
 * Store catalog — browser data access.
 *
 * Reads go through database read functions (they run as the signed-in user and
 * respect RLS). Every mutation goes through a controlled database function;
 * direct table writes are rejected by database guards.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  ChannelListing,
  ChannelListingEvent,
  ChannelListingStatus,
  ProductStoreAssignment,
  StoreCatalogFilters,
  StoreCatalogRow,
  StoreCatalogSummary,
  StoreProduct,
  StoreProductPriceHistory,
  StoreProductVisibility,
} from "@/types/store-catalog";

/**
 * Supabase returns plain objects for database errors, so the friendly message
 * raised by the controlled operations must be re-thrown as a real Error for
 * the UI to show it.
 */
function fail(error: { message: string } | null): never | void {
  if (error) throw new Error(error.message);
}

const LISTING_COLUMNS =
  "id, store_product_id, sales_channel_account_id, external_product_id, external_variant_reference, external_sku, external_url, listing_status, last_synced_at, last_sync_error, created_at, updated_at";

export async function getStoreCatalog(
  storeId: string,
  filters: StoreCatalogFilters = {},
): Promise<{ rows: StoreCatalogRow[]; total: number }> {
  const search = filters.search?.trim();
  const { data, error } = await supabase.rpc("store_catalog_list", {
    _store_id: storeId,
    ...(search ? { _search: search } : {}),
    ...(filters.status ? { _status: filters.status } : {}),
    ...(filters.visibility ? { _visibility: filters.visibility } : {}),
    ...(filters.categoryId ? { _category_id: filters.categoryId } : {}),
    ...(filters.stock ? { _stock: filters.stock } : {}),
    ...(filters.channelId ? { _channel_id: filters.channelId } : {}),
    _limit: filters.limit ?? 50,
    _offset: filters.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as StoreCatalogRow[];
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 };
}

export async function getStoreCatalogSummary(storeId: string): Promise<StoreCatalogSummary> {
  const { data, error } = await supabase.rpc("store_catalog_summary", { _store_id: storeId });
  if (error) throw error;
  const fallback: StoreCatalogSummary = {
    total: 0,
    active: 0,
    draft: 0,
    archived: 0,
    visible: 0,
    out_of_stock: 0,
  };
  return { ...fallback, ...((data ?? {}) as unknown as StoreCatalogSummary) };
}

export async function getProductStoreAssignments(
  productId: string,
): Promise<ProductStoreAssignment[]> {
  const { data, error } = await supabase.rpc("product_store_assignments", {
    _product_id: productId,
  });
  if (error) throw error;
  return (data ?? []) as unknown as ProductStoreAssignment[];
}

export async function getStoreProduct(id: string): Promise<StoreProduct | null> {
  const { data, error } = await supabase
    .from("store_products")
    .select("*")
    .eq("id", id)
    .maybeSingle<StoreProduct>();
  if (error) throw error;
  return data;
}

export async function getStoreProductPriceHistory(
  storeProductId: string,
): Promise<StoreProductPriceHistory[]> {
  const { data, error } = await supabase
    .from("store_product_price_history")
    .select("*")
    .eq("store_product_id", storeProductId)
    .order("created_at", { ascending: false })
    .returns<StoreProductPriceHistory[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getStoreProductListings(storeProductId: string): Promise<ChannelListing[]> {
  const { data, error } = await supabase
    .from("sales_channel_product_listings")
    .select(LISTING_COLUMNS)
    .eq("store_product_id", storeProductId)
    .order("created_at")
    .returns<ChannelListing[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getListingEvents(listingIds: string[]): Promise<ChannelListingEvent[]> {
  if (listingIds.length === 0) return [];
  const { data, error } = await supabase
    .from("channel_listing_events")
    .select("*")
    .in("listing_id", listingIds)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<ChannelListingEvent[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getAvailableQuantity(productId: string): Promise<number> {
  const { data, error } = await supabase.rpc("store_product_available_qty", {
    _product_id: productId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/* ---------------- controlled mutations ---------------- */

export async function addProductToStore(input: {
  storeId: string;
  productId: string;
  sellingPrice?: number | null;
  storeSku?: string | null;
}): Promise<StoreProduct> {
  const { data, error } = await supabase.rpc("add_product_to_store", {
    _store_id: input.storeId,
    _product_id: input.productId,
    ...(input.sellingPrice === null || input.sellingPrice === undefined
      ? {}
      : { _selling_price: input.sellingPrice }),
    ...(input.storeSku ? { _store_sku: input.storeSku } : {}),
  });
  fail(error);
  return data as unknown as StoreProduct;
}

export async function updateStoreProduct(
  id: string,
  payload: {
    store_sku?: string | null;
    title_override?: string | null;
    description_override?: string | null;
    visibility?: StoreProductVisibility;
  },
): Promise<StoreProduct> {
  const { data, error } = await supabase.rpc("update_store_product", {
    _id: id,
    _payload: payload,
  });
  fail(error);
  return data as unknown as StoreProduct;
}

export async function setStoreProductPrice(
  id: string,
  price: number,
  reason?: string | null,
): Promise<StoreProduct> {
  const { data, error } = await supabase.rpc("set_store_product_price", {
    _id: id,
    _price: price,
    ...(reason ? { _reason: reason } : {}),
  });
  fail(error);
  return data as unknown as StoreProduct;
}

export async function activateStoreProduct(id: string): Promise<StoreProduct> {
  const { data, error } = await supabase.rpc("activate_store_product", { _id: id });
  fail(error);
  return data as unknown as StoreProduct;
}

export async function archiveStoreProduct(id: string): Promise<StoreProduct> {
  const { data, error } = await supabase.rpc("archive_store_product", { _id: id });
  fail(error);
  return data as unknown as StoreProduct;
}

export async function saveChannelListing(input: {
  storeProductId: string;
  accountId: string;
  external_product_id?: string | null;
  external_sku?: string | null;
  external_url?: string | null;
}): Promise<ChannelListing> {
  const { storeProductId, accountId, ...payload } = input;
  const { data, error } = await supabase.rpc("create_or_update_channel_listing", {
    _store_product_id: storeProductId,
    _account_id: accountId,
    _payload: payload,
  });
  fail(error);
  return data as unknown as ChannelListing;
}

export async function setChannelListingStatus(
  listingId: string,
  status: ChannelListingStatus,
  message?: string | null,
): Promise<ChannelListing> {
  const { data, error } = await supabase.rpc("set_channel_listing_status", {
    _listing_id: listingId,
    _status: status,
    ...(message ? { _message: message } : {}),
  });
  fail(error);
  return data as unknown as ChannelListing;
}

/* ---------------- publishing & sync reads (Step 17) ---------------- */

export interface ListingReadinessResult {
  listing_id: string;
  ready: boolean;
  blocking: string[];
  warnings: string[];
  provider: string;
  listing_status: ChannelListingStatus;
  effective_title: string | null;
  effective_sku: string | null;
  effective_price: number | null;
  available_qty: number;
  external_product_id: string | null;
}

/** Read-only readiness. Running it as an audited check goes through the server. */
export async function getListingReadiness(listingId: string): Promise<ListingReadinessResult> {
  const { data, error } = await supabase.rpc("channel_listing_readiness", {
    _listing_id: listingId,
  });
  fail(error);
  return data as unknown as ListingReadinessResult;
}

export interface ChannelListingRow {
  id: string;
  store_product_id: string;
  product_id: string;
  product_name: string;
  store_sku: string | null;
  selling_price: number;
  store_product_status: string;
  channel_id: string;
  channel_name: string;
  provider: string;
  channel_status: string;
  listing_status: ChannelListingStatus;
  external_product_id: string | null;
  external_url: string | null;
  last_synced_at: string | null;
  last_success_at: string | null;
  last_sync_error: string | null;
  available_qty: number;
  total_count: number;
}

export interface ChannelListingFilters {
  search?: string;
  channelId?: string | null;
  status?: ChannelListingStatus | null;
  health?: "healthy" | "failing" | "never_synced" | null;
  limit?: number;
  offset?: number;
}

export async function getStoreChannelListings(
  storeId: string,
  filters: ChannelListingFilters = {},
): Promise<{ rows: ChannelListingRow[]; total: number }> {
  const search = filters.search?.trim();
  const { data, error } = await supabase.rpc("store_channel_listings", {
    _store_id: storeId,
    ...(search ? { _search: search } : {}),
    ...(filters.channelId ? { _channel_id: filters.channelId } : {}),
    ...(filters.status ? { _status: filters.status } : {}),
    ...(filters.health ? { _health: filters.health } : {}),
    _limit: filters.limit ?? 50,
    _offset: filters.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as ChannelListingRow[];
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 };
}

/** Sync history for one listing (append-only, newest first). */
export async function getListingSyncRuns(listingId: string) {
  const { data, error } = await supabase
    .from("sales_channel_sync_runs")
    .select("id, sync_type, status, started_at, completed_at, error_summary")
    .eq("listing_id", listingId)
    .order("started_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return data ?? [];
}
