/**
 * Store catalog types.
 *
 * A STORE PRODUCT is a selling decision: "this master product is sold by this
 * store, at this price, with this store-specific presentation". It never
 * duplicates the master product record and never holds stock — availability is
 * always derived from the authoritative inventory levels.
 *
 * A CHANNEL LISTING is the mapping between a store product and one external
 * sales channel (its external reference and publish state). Publishing itself
 * is provider work handled elsewhere; this layer only records the state.
 */

import type { Enums, Tables } from "@/integrations/supabase/types";

export type StoreProductStatus = Enums<"store_product_status">;
export type StoreProductVisibility = Enums<"store_product_visibility">;
export type ChannelListingStatus = Enums<"channel_listing_status">;
export type ChannelListingEventType = Enums<"channel_listing_event_type">;

export type StoreProduct = Tables<"store_products">;
export type StoreProductPriceHistory = Tables<"store_product_price_history">;
export type ChannelListing = Tables<"sales_channel_product_listings">;
export type ChannelListingEvent = Tables<"channel_listing_events">;

export const STORE_PRODUCT_STATUS_LABELS: Record<StoreProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export const STORE_PRODUCT_VISIBILITY_LABELS: Record<StoreProductVisibility, string> = {
  hidden: "Hidden",
  visible: "Visible",
};

export const CHANNEL_LISTING_STATUS_LABELS: Record<ChannelListingStatus, string> = {
  not_published: "Not published",
  publishing: "Publishing",
  published: "Published",
  sync_failed: "Sync failed",
  archived: "Archived",
};

export const CHANNEL_LISTING_EVENT_LABELS: Record<ChannelListingEventType, string> = {
  listing_created: "Listing created",
  listing_updated: "Listing updated",
  listing_publish_requested: "Publish requested",
  listing_published: "Published",
  listing_sync_failed: "Sync failed",
  listing_archived: "Listing archived",
};

/** One row of the store catalog list (derived, read-only projection). */
export interface StoreCatalogRow {
  id: string;
  product_id: string;
  product_name: string;
  master_sku: string | null;
  store_sku: string | null;
  category_name: string | null;
  selling_price: number;
  status: StoreProductStatus;
  visibility: StoreProductVisibility;
  is_purchasable: boolean;
  available_qty: number;
  listing_count: number;
  published_count: number;
  updated_at: string;
  total_count: number;
}

export interface StoreCatalogSummary {
  total: number;
  active: number;
  draft: number;
  archived: number;
  visible: number;
  out_of_stock: number;
}

export interface ProductStoreAssignment {
  id: string;
  store_id: string;
  store_name: string;
  store_code: string;
  status: StoreProductStatus;
  visibility: StoreProductVisibility;
  selling_price: number;
  available_qty: number;
  listing_count: number;
  updated_at: string;
}

export interface StoreCatalogFilters {
  search?: string;
  status?: StoreProductStatus | null;
  visibility?: StoreProductVisibility | null;
  categoryId?: string | null;
  channelId?: string | null;
  stock?: "in_stock" | "out_of_stock" | null;
  limit?: number;
  offset?: number;
}
