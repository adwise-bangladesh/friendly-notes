/**
 * Store & sales channel types.
 *
 * A STORE is a commercial identity you operate (Velora Website, Velora Retail).
 * A SALES CHANNEL ACCOUNT is one connection between a store and an external
 * platform (WooCommerce site, or the internal manual channel).
 * The EXTERNAL PLATFORM is only a source/destination of data — Commerce
 * Operations stays the authoritative operational system.
 *
 * This module is client-safe: no credentials, no network code.
 */

import type { Enums } from "@/integrations/supabase/types";

export type StoreStatus = Enums<"store_status">;
export type SalesChannelProvider = Enums<"sales_channel_provider">;
export type SalesChannelStatus = Enums<"sales_channel_status">;
export type SalesChannelEnvironment = Enums<"sales_channel_environment">;
export type SyncType = Enums<"sales_channel_sync_type">;
export type SyncStatus = Enums<"sales_channel_sync_status">;
export type ExternalEntityType = Enums<"external_entity_type">;

export const STORE_STATUS_LABELS: Record<StoreStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const CHANNEL_STATUS_LABELS: Record<SalesChannelStatus, string> = {
  active: "Connected",
  disabled: "Disabled",
  error: "Error",
  disconnected: "Not connected",
};

export const PROVIDER_LABELS: Record<SalesChannelProvider, string> = {
  manual: "Manual / Internal",
  woocommerce: "WooCommerce",
  shopify: "Shopify",
  custom_api: "Custom API",
  facebook: "Facebook Commerce",
  tiktok: "TikTok Shop",
  daraz: "Daraz",
  other: "Other",
};

/** Only these providers have real behaviour today. Everything else is planned. */
export const AVAILABLE_PROVIDERS: SalesChannelProvider[] = ["manual", "woocommerce"];

export const SYNC_TYPE_LABELS: Record<SyncType, string> = {
  orders: "Orders",
  products: "Products",
  customers: "Customers",
  full: "Full",
  listing_publish: "Publish",
  listing_update: "Product update",
  price_sync: "Price sync",
  stock_sync: "Stock sync",
  status_refresh: "Status refresh",
  unpublish: "Unpublish",
};

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  partial: "Partial",
};

export interface Store {
  id: string;
  name: string;
  slug: string;
  code: string;
  status: StoreStatus;
  currency: string;
  timezone: string;
  country: string;
  order_number_prefix: string | null;
  default_warehouse_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreListRow {
  id: string;
  name: string;
  slug: string;
  code: string;
  status: StoreStatus;
  currency: string;
  timezone: string;
  country: string;
  created_at: string;
  channel_count: number;
  order_count: number;
  last_sync_at: string | null;
}

export interface SalesChannelAccount {
  id: string;
  store_id: string;
  provider: SalesChannelProvider;
  name: string;
  status: SalesChannelStatus;
  environment: SalesChannelEnvironment;
  external_store_id: string | null;
  external_store_name: string | null;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesChannelSyncRun {
  id: string;
  sales_channel_account_id: string;
  sync_type: SyncType;
  status: SyncStatus;
  started_at: string;
  completed_at: string | null;
  records_fetched: number;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  records_failed: number;
  error_summary: string | null;
}

export interface ExternalEntityMapping {
  id: string;
  sales_channel_account_id: string;
  entity_type: ExternalEntityType;
  internal_id: string;
  external_id: string;
  external_reference: string | null;
  created_at: string;
}

/** Never contains a secret — only whether one is stored. */
export interface ChannelCredentialStatus {
  configured: boolean;
  site_url: string | null;
  api_version: string | null;
  updated_at: string | null;
}

export interface ChannelCapability {
  key: "test_connection" | "sync_orders" | "sync_products" | "sync_customers";
  label: string;
  supported: boolean;
  note?: string;
}

/** What a provider can actually do today. No pretending. */
export function capabilitiesForProvider(provider: SalesChannelProvider): ChannelCapability[] {
  if (provider === "manual") {
    return [
      { key: "test_connection", label: "Test connection", supported: false, note: "No external API" },
      { key: "sync_orders", label: "Import orders", supported: false, note: "Orders are created in-app" },
      { key: "sync_products", label: "Import products", supported: false },
      { key: "sync_customers", label: "Import customers", supported: false },
    ];
  }
  if (provider === "woocommerce") {
    return [
      { key: "test_connection", label: "Test connection", supported: true },
      { key: "sync_orders", label: "Import orders", supported: true, note: "Mapped products only" },
      { key: "sync_products", label: "Import products", supported: false, note: "Planned" },
      { key: "sync_customers", label: "Import customers", supported: false, note: "Planned" },
    ];
  }
  return [
    { key: "test_connection", label: "Test connection", supported: false, note: "Planned provider" },
    { key: "sync_orders", label: "Import orders", supported: false, note: "Planned provider" },
    { key: "sync_products", label: "Import products", supported: false, note: "Planned provider" },
    { key: "sync_customers", label: "Import customers", supported: false, note: "Planned provider" },
  ];
}
