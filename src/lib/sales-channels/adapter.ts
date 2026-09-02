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

export interface SalesChannelAdapter {
  provider: string;
  testConnection(credentials: SalesChannelCredentials): Promise<AdapterTestResult>;
  fetchOrders(
    credentials: SalesChannelCredentials,
    options: { limit: number },
  ): Promise<NormalizedExternalOrder[]>;
}

/** Provider failures surface as this — never a raw provider body. */
export class SalesChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesChannelError";
  }
}
