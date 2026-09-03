/**
 * Provider-neutral sales channel contract.
 *
 * Deliberately small: only the operations Step 15 actually performs. External
 * data is always NORMALISED into these shapes before any controlled write —
 * a provider payload never reaches the database directly.
 *
 * Client-safe: types plus the normalised shapes, no credentials, no network.
 */

export interface NormalizedExternalOrderLine {
  external_product_id: string;
  external_variant_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
}

export interface NormalizedExternalOrder {
  external_id: string;
  external_reference: string | null;
  external_status: string | null;
  external_created_at: string | null;
  external_payment_method: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_note: string | null;
  address_line: string | null;
  area: string | null;
  district: string | null;
  postal_code: string | null;
  shipping_charge: number;
  discount: number;
  lines: NormalizedExternalOrderLine[];
}

export interface ExternalStoreInfo {
  external_store_id: string | null;
  external_store_name: string | null;
}

export interface AdapterTestResult {
  ok: boolean;
  /** Already sanitised — safe to show the user. */
  message: string;
  info?: ExternalStoreInfo;
}

export interface SalesChannelCredentials {
  site_url: string | null;
  consumer_key: string | null;
  consumer_secret: string | null;
  api_version: string;
}

/**
 * Product data that the internal system owns and is willing to send outward.
 * Resolved once, server-side, by `effective_store_product_data` — never
 * recomputed in the UI or inside an adapter.
 */
export interface EffectiveProductData {
  store_product_id: string;
  store_id: string;
  product_id: string;
  title: string;
  description: string | null;
  sku: string | null;
  price: number;
  status: string;
  visibility: string;
  available_qty: number;
  is_purchasable: boolean;
  master_status: string;
  requires_shipping: boolean;
  weight: number | null;
}

/** Outbound operations an adapter may support. Declared, never assumed. */
export type ChannelCapability =
  | "connection"
  | "order_import"
  | "product_publish"
  | "product_update"
  | "price_sync"
  | "stock_sync"
  | "status_refresh"
  | "unpublish";

/** Structured failure classification understood by the background queue. */
export type ChannelFailureClass =
  | "transient"
  | "permanent"
  | "rate_limited"
  | "authentication"
  | "unknown";

export interface PublishResult {
  ok: boolean;
  /** Sanitised, user-facing. */
  message: string;
  external_product_id?: string | null;
  external_url?: string | null;
  /** True when the provider no longer has the referenced product. */
  external_missing?: boolean;
  synced_price?: number | null;
  synced_qty?: number | null;
  /**
   * How the background engine should treat a failure.
   * `transient` retries with backoff, `rate_limited` waits for the provider
   * window, `authentication` and `permanent` are never retried automatically.
   */
  failure_class?: ChannelFailureClass;
  /** Provider-requested earliest retry time (ISO), for rate limiting. */
  retry_after?: string | null;
}

export interface SalesChannelAdapter {
  provider: string;
  capabilities: ChannelCapability[];
  testConnection(credentials: SalesChannelCredentials): Promise<AdapterTestResult>;
  fetchOrders(
    credentials: SalesChannelCredentials,
    options: { limit: number },
  ): Promise<NormalizedExternalOrder[]>;
  /** Creates the external product. Must be safe to call only when unmapped. */
  publishProduct?(
    credentials: SalesChannelCredentials,
    data: EffectiveProductData,
  ): Promise<PublishResult>;
  updateProduct?(
    credentials: SalesChannelCredentials,
    externalId: string,
    data: EffectiveProductData,
  ): Promise<PublishResult>;
  updatePrice?(
    credentials: SalesChannelCredentials,
    externalId: string,
    data: EffectiveProductData,
  ): Promise<PublishResult>;
  updateStock?(
    credentials: SalesChannelCredentials,
    externalId: string,
    data: EffectiveProductData,
  ): Promise<PublishResult>;
  unpublishProduct?(
    credentials: SalesChannelCredentials,
    externalId: string,
  ): Promise<PublishResult>;
  refreshProductStatus?(
    credentials: SalesChannelCredentials,
    externalId: string,
  ): Promise<PublishResult>;
  /** Existing external product with this SKU, used to avoid duplicates. */
  findProductBySku?(
    credentials: SalesChannelCredentials,
    sku: string,
  ): Promise<{ external_product_id: string; external_url: string | null } | null>;
}

/** Provider failures surface as this — never a raw provider body. */
export class SalesChannelError extends Error {
  /** True when retrying the same request later could plausibly succeed. */
  readonly retryable: boolean;
  /** Structured classification the queue interprets; parsing stays in adapters. */
  readonly failureClass: ChannelFailureClass;
  /** Provider-requested earliest retry time (ISO), when it supplied one. */
  readonly retryAfter: string | null;
  constructor(
    message: string,
    retryable = false,
    failureClass?: ChannelFailureClass,
    retryAfter: string | null = null,
  ) {
    super(message);
    this.name = "SalesChannelError";
    this.retryable = retryable;
    this.failureClass = failureClass ?? (retryable ? "transient" : "permanent");
    this.retryAfter = retryAfter;
  }
}
