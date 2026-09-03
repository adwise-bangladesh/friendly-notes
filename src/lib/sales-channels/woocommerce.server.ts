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
): Promise<unknown> {
  const url = new URL(`${baseUrl(credentials)}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authHeader(credentials), Accept: "application/json" },
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
      throw new SalesChannelError("The WooCommerce REST API was not found at this address");
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

export const wooCommerceAdapter: SalesChannelAdapter = {
  provider: "woocommerce",

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
