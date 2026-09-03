/**
 * WooCommerce adapter — SERVER ONLY.
 *
 * Talks to the store's REST API (wc/v3) with HTTP Basic auth built from the
 * consumer key/secret held in the server-only credentials table. Credentials
 * are never logged and never returned. Provider errors are reduced to a status
 * code and a short sanitised sentence.
 */

import type {
  AdapterTestResult,
  EffectiveProductData,
  PublishResult,
  NormalizedExternalOrder,
  NormalizedExternalOrderLine,
  SalesChannelAdapter,
  SalesChannelCredentials,
} from "./adapter";
import { SalesChannelError } from "./adapter";

function baseUrl(credentials: SalesChannelCredentials): string {
  const site = (credentials.site_url ?? "").trim().replace(/\/+$/, "");
  if (!site) throw new SalesChannelError("No site URL is configured for this connection");
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    throw new SalesChannelError("The configured site URL is not a valid address");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new SalesChannelError("The site URL must use https");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/wp-json/${credentials.api_version || "wc/v3"}`;
}

function authHeader(credentials: SalesChannelCredentials): string {
  const key = credentials.consumer_key ?? "";
  const secret = credentials.consumer_secret ?? "";
  if (!key || !secret) throw new SalesChannelError("No API credentials are configured");
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function call(
  credentials: SalesChannelCredentials,
  path: string,
  params: Record<string, string> = {},
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const url = new URL(`${baseUrl(credentials)}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: authHeader(credentials),
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new SalesChannelError("The store could not be reached");
  }
  if (!response.ok) {
    // status only: a provider body can echo credentials or private data
    if (response.status === 401 || response.status === 403) {
      throw new SalesChannelError("The store rejected the API credentials");
    }
    if (response.status === 404) {
      throw path.startsWith("/products/")
        ? new ExternalMissingError("The product no longer exists on the store")
        : new SalesChannelError("The WooCommerce REST API was not found at this address");
    }
    throw new SalesChannelError(`The store returned an error (HTTP ${response.status})`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new SalesChannelError("The store returned a response that could not be read");
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(str(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Provider payload → normalised order. No database access happens here. */
export function normalizeWooOrder(raw: unknown): NormalizedExternalOrder {
  const o = record(raw);
  const billing = record(o["billing"]);
  const shipping = record(o["shipping"]);
  const lines: NormalizedExternalOrderLine[] = (Array.isArray(o["line_items"]) ? o["line_items"] : [])
    .map((item) => {
      const li = record(item);
      const quantity = Math.max(1, Math.trunc(num(li["quantity"])));
      const total = num(li["total"]);
      return {
        external_product_id: str(li["product_id"]),
        external_variant_id: num(li["variation_id"]) > 0 ? str(li["variation_id"]) : null,
        name: str(li["name"]),
        quantity,
        unit_price: quantity > 0 ? Number((total / quantity).toFixed(2)) : 0,
      };
    })
    // a line without a real product reference cannot be mapped, so it is dropped
    .filter((line) => Number(line.external_product_id) > 0);

  const name =
    `${str(shipping["first_name"]) || str(billing["first_name"])} ${str(shipping["last_name"]) || str(billing["last_name"])}`.trim();

  return {
    external_id: str(o["id"]),
    external_reference: str(o["number"]) || null,
    external_status: str(o["status"]) || null,
    external_created_at: str(o["date_created_gmt"]) || null,
    external_payment_method: str(o["payment_method_title"]) || str(o["payment_method"]) || null,
    customer_name: name,
    customer_phone: str(billing["phone"]),
    customer_email: str(billing["email"]) || null,
    customer_note: str(o["customer_note"]) || null,
    address_line:
      [str(shipping["address_1"]) || str(billing["address_1"]), str(shipping["address_2"])]
        .filter(Boolean)
        .join(", ") || null,
    area: str(shipping["city"]) || str(billing["city"]) || null,
    district: str(shipping["state"]) || str(billing["state"]) || null,
    postal_code: str(shipping["postcode"]) || str(billing["postcode"]) || null,
    shipping_charge: num(o["shipping_total"]),
    discount: num(o["discount_total"]),
    lines,
  };
}

/** Raised when the provider says the referenced record is gone. */
export class ExternalMissingError extends SalesChannelError {
  constructor(message: string) {
    super(message);
    this.name = "ExternalMissingError";
  }
}

/**
 * Fields Commerce Operations owns on the channel. Anything not listed here
 * (categories, images, SEO, channel-only attributes) is left untouched.
 */
function productPayload(data: EffectiveProductData): Record<string, unknown> {
  const qty = Math.max(0, Math.trunc(data.available_qty));
  return {
    name: data.title,
    type: "simple",
    regular_price: data.price.toFixed(2),
    description: data.description ?? "",
    ...(data.sku ? { sku: data.sku } : {}),
    status: data.visibility === "visible" && data.status === "active" ? "publish" : "draft",
    manage_stock: true,
    stock_quantity: qty,
    stock_status: qty > 0 ? "instock" : "outofstock",
  };
}

function outcome(raw: unknown, message: string, data?: EffectiveProductData): PublishResult {
  const p = record(raw);
  return {
    ok: true,
    message,
    external_product_id: str(p["id"]) || null,
    external_url: str(p["permalink"]) || null,
    ...(data
      ? { synced_price: data.price, synced_qty: Math.max(0, Math.trunc(data.available_qty)) }
      : {}),
  };
}

function failure(error: unknown): PublishResult {
  const missing = error instanceof ExternalMissingError;
  return {
    ok: false,
    message: error instanceof SalesChannelError ? error.message : "The operation failed on the store",
    ...(missing ? { external_missing: true } : {}),
  };
}

export const wooCommerceAdapter: SalesChannelAdapter = {
  provider: "woocommerce",
  capabilities: [
    "connection",
    "order_import",
    "product_publish",
    "product_update",
    "price_sync",
    "stock_sync",
    "status_refresh",
    "unpublish",
  ],

  async testConnection(credentials): Promise<AdapterTestResult> {
    try {
      const data = await call(credentials, "", { per_page: "1" });
      const info = record(data);
      const store = record(info["store"]);
      return {
        ok: true,
        message: "Connection succeeded",
        info: {
          external_store_id: new URL((credentials.site_url ?? "").trim()).host,
          external_store_name: str(store["name"]) || null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof SalesChannelError ? error.message : "The connection test failed",
      };
    }
  },

  async fetchOrders(credentials, options): Promise<NormalizedExternalOrder[]> {
    const data = await call(credentials, "/orders", {
      per_page: String(Math.min(Math.max(options.limit, 1), 50)),
      orderby: "date",
      order: "desc",
    });
    if (!Array.isArray(data)) throw new SalesChannelError("The store returned an unexpected order list");
    return data.map(normalizeWooOrder).filter((order) => order.external_id !== "");
  },
};

/* ------------------------------------------------------------------ */
/* Outbound product operations. Inventory is never mutated here — the  */
/* quantity sent is the authoritative internal availability, read-only.*/
/* ------------------------------------------------------------------ */

wooCommerceAdapter.findProductBySku = async (credentials, sku) => {
  const data = await call(credentials, "/products", { sku, per_page: "1" });
  if (!Array.isArray(data) || data.length === 0) return null;
  const p = record(data[0]);
  const id = str(p["id"]);
  if (!id) return null;
  return { external_product_id: id, external_url: str(p["permalink"]) || null };
};

wooCommerceAdapter.publishProduct = async (credentials, data) => {
  try {
    // idempotency at the provider: reuse an existing product with the same SKU
    if (data.sku) {
      const existing = await wooCommerceAdapter.findProductBySku!(credentials, data.sku);
      if (existing) {
        const updated = await call(credentials, `/products/${existing.external_product_id}`, {}, {
          method: "PUT",
          body: productPayload(data),
        });
        return outcome(updated, "An existing product with this SKU was reused and updated", data);
      }
    }
    const created = await call(credentials, "/products", {}, { method: "POST", body: productPayload(data) });
    return outcome(created, "Product published", data);
  } catch (error) {
    return failure(error);
  }
};

wooCommerceAdapter.updateProduct = async (credentials, externalId, data) => {
  try {
    const updated = await call(credentials, `/products/${externalId}`, {}, {
      method: "PUT",
      body: productPayload(data),
    });
    return outcome(updated, "Product updated on the store", data);
  } catch (error) {
    return failure(error);
  }
};

wooCommerceAdapter.updatePrice = async (credentials, externalId, data) => {
  try {
    const updated = await call(credentials, `/products/${externalId}`, {}, {
      method: "PUT",
      body: { regular_price: data.price.toFixed(2) },
    });
    return { ...outcome(updated, "Price synchronised", data), synced_qty: null };
  } catch (error) {
    return failure(error);
  }
};

wooCommerceAdapter.updateStock = async (credentials, externalId, data) => {
  try {
    const qty = Math.max(0, Math.trunc(data.available_qty));
    const updated = await call(credentials, `/products/${externalId}`, {}, {
      method: "PUT",
      body: { manage_stock: true, stock_quantity: qty, stock_status: qty > 0 ? "instock" : "outofstock" },
    });
    return { ...outcome(updated, "Stock synchronised", data), synced_price: null };
  } catch (error) {
    return failure(error);
  }
};

wooCommerceAdapter.unpublishProduct = async (credentials, externalId) => {
  try {
    const updated = await call(credentials, `/products/${externalId}`, {}, {
      method: "PUT",
      body: { status: "draft" },
    });
    return outcome(updated, "Product unpublished on the store");
  } catch (error) {
    return failure(error);
  }
};

wooCommerceAdapter.refreshProductStatus = async (credentials, externalId) => {
  try {
    const product = await call(credentials, `/products/${externalId}`);
    const p = record(product);
    return {
      ...outcome(product, `Store status: ${str(p["status"]) || "unknown"}`),
      synced_qty: p["stock_quantity"] === null ? null : num(p["stock_quantity"]),
      synced_price: num(p["regular_price"]) || null,
    };
  } catch (error) {
    return failure(error);
  }
};
