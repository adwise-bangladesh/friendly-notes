/**
 * Client-safe capability map.
 *
 * The UI uses this to decide which buttons exist at all. It mirrors the
 * adapters' declared `capabilities`; a provider without a real adapter is
 * honestly listed as supporting nothing.
 */

import type { ChannelCapability } from "./adapter";

export type ListingOperation =
  | "listing_publish"
  | "listing_update"
  | "price_sync"
  | "stock_sync"
  | "status_refresh"
  | "unpublish";

export const OPERATION_LABELS: Record<ListingOperation, string> = {
  listing_publish: "Publish",
  listing_update: "Sync product",
  price_sync: "Sync price",
  stock_sync: "Sync stock",
  status_refresh: "Refresh status",
  unpublish: "Unpublish",
};

export const OPERATION_CAPABILITY: Record<ListingOperation, ChannelCapability> = {
  listing_publish: "product_publish",
  listing_update: "product_update",
  price_sync: "price_sync",
  stock_sync: "stock_sync",
  status_refresh: "status_refresh",
  unpublish: "unpublish",
};

export const PROVIDER_CAPABILITIES: Record<string, ChannelCapability[]> = {
  manual: [],
  woocommerce: [
    "connection",
    "order_import",
    "product_publish",
    "product_update",
    "price_sync",
    "stock_sync",
    "status_refresh",
    "unpublish",
  ],
  shopify: [],
  custom_api: [],
  facebook: [],
  tiktok: [],
  daraz: [],
  other: [],
};

export function providerCapabilities(provider: string): ChannelCapability[] {
  return PROVIDER_CAPABILITIES[provider] ?? [];
}

export function supportsOperation(provider: string, operation: ListingOperation): boolean {
  return providerCapabilities(provider).includes(OPERATION_CAPABILITY[operation]);
}
