/**
 * Pathao courier adapter — SERVER ONLY.
 *
 * Credentials are never read from a table here. They are resolved through the
 * single trusted boundary in `credentials.server.ts`, which calls the
 * service-role-only vault functions. Freshly issued tokens are written back
 * through the same boundary, so nothing secret is ever stored in a readable
 * column or handled outside this server module.
 *
 * Implemented: token issue/refresh, create order, order info, price plan,
 * city/zone/area lists (cached in `courier_locations`).
 * NOT verified against the live Pathao API in this project — treat the
 * integration level as "ready_for_api" until a real sandbox call succeeds.
 */


import {
  CourierError,
  type CourierAdapter,
  type CourierBookingRequest,
  type CourierBookingResult,
  type CourierLocationOption,
  type CourierQuoteRequest,
  type CourierQuoteResult,
  type CourierStatusResult,
} from "@/types/couriers";
import {
  getCourierCredentials,
  storeCourierToken,
  type CourierCredentials,
} from "./credentials.server";

const SANDBOX_BASE = "https://courier-api-sandbox.pathao.com";
const PRODUCTION_BASE = "https://api-hermes.pathao.com";

/** Refresh a little before expiry so a booking never races the clock. */
const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;

interface AccountContext {
  accountId: string;
  providerId: string;
  baseUrl: string;
  storeId: string | null;
  credentials: CourierCredentials;
}


async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function fail(category: CourierError["category"], message: string, statusCode?: number): never {
  throw new CourierError({
    category,
    message,
    ...(statusCode === undefined ? {} : { statusCode }),
    retryable: category === "provider_unavailable" || category === "rate_limited",
  });
}

async function loadAccount(accountId: string): Promise<AccountContext> {
  const db = await admin();
  const { data: account, error } = await db
    .from("courier_accounts")
    .select("id, provider_id, environment, external_store_id, base_url, status")
    .eq("id", accountId)
    .maybeSingle();
  if (error) fail("unknown", "Could not load the courier account");
  if (!account) fail("not_found", "Courier account not found");
  if (account.status !== "active") fail("validation", "This courier account is not active");

  let credentials: CourierCredentials;
  try {
    credentials = await getCourierCredentials(accountId);
  } catch {
    fail("auth", "No credentials are configured for this courier account");
  }

  return {
    accountId,
    providerId: account.provider_id,
    baseUrl:
      account.base_url ?? (account.environment === "production" ? PRODUCTION_BASE : SANDBOX_BASE),
    storeId: account.external_store_id,
    credentials,
  };
}


/* ---------- Token management ---------- */

/** Serialises refreshes inside one worker instance; the database row is the shared cache. */
const inFlight = new Map<string, Promise<string>>();

async function issueToken(ctx: AccountContext, useRefresh: boolean): Promise<string> {
  const c = ctx.credentials;
  if (!c.clientId || !c.clientSecret) fail("auth", "Courier client credentials are missing");

  const body: Record<string, string> = {
    client_id: c.clientId,
    client_secret: c.clientSecret,
  };
  if (useRefresh && c.refreshToken) {
    body["grant_type"] = "refresh_token";
    body["refresh_token"] = c.refreshToken;
  } else {
    if (!c.username || !c.password) fail("auth", "Courier username or password is missing");
    body["grant_type"] = "password";
    body["username"] = c.username;
    body["password"] = c.password;
  }

  let response: Response;
  try {
    response = await fetch(`${ctx.baseUrl}/aladdin/api/v1/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    fail("provider_unavailable", "The courier authentication service could not be reached");
  }

  if (!response.ok) {
    if (useRefresh) return issueToken({ ...ctx, credentials: { ...c, refreshToken: null } }, false);
    fail("auth", "The courier rejected the authentication request", response.status);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) fail("auth", "The courier returned no access token");

  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  // tokens go back into the vault through the same trusted boundary
  await storeCourierToken(ctx.accountId, {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? c.refreshToken,
    expiresAt,
  });

  return json.access_token;
}

async function getValidAccessToken(ctx: AccountContext): Promise<string> {
  const c = ctx.credentials;
  const expiry = c.tokenExpiresAt ? Date.parse(c.tokenExpiresAt) : 0;
  if (c.accessToken && expiry - TOKEN_SAFETY_WINDOW_MS > Date.now()) return c.accessToken;

  const pending = inFlight.get(ctx.accountId);
  if (pending) return pending;

  const promise = issueToken(ctx, Boolean(c.refreshToken)).finally(() =>
    inFlight.delete(ctx.accountId),
  );
  inFlight.set(ctx.accountId, promise);
  return promise;
}


async function request<T>(
  ctx: AccountContext,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const token = await getValidAccessToken(ctx);
  const call = async (bearer: string) =>
    fetch(`${ctx.baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  let response: Response;
  try {
    response = await call(token);
    if (response.status === 401) {
      const fresh = await issueToken(ctx, Boolean(ctx.credentials.refreshToken));
      response = await call(fresh);
    }
  } catch {
    fail("provider_unavailable", "The courier API could not be reached");
  }

  if (response.status === 429) fail("rate_limited", "The courier API is rate limiting requests", 429);
  if (response.status === 404) fail("not_found", "The courier does not know this record", 404);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    fail(
      response.status >= 500 ? "provider_unavailable" : "validation",
      `The courier rejected the request (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

/* ---------- Adapter ---------- */

export const pathaoAdapter: CourierAdapter = {
  code: "pathao",
  integrationLevel: "ready_for_api",

  async bookShipment(accountId, req: CourierBookingRequest): Promise<CourierBookingResult> {
    const ctx = await loadAccount(accountId);
    if (!ctx.storeId) fail("validation", "This courier account has no store id configured");
    if (!req.recipientCityId || !req.recipientZoneId) {
      fail("validation", "A courier city and zone must be mapped before booking");
    }

    const payload = {
      store_id: Number(ctx.storeId),
      // provider-side idempotency anchor: our own shipment number
      merchant_order_id: req.merchantOrderId,
      recipient_name: req.recipientName,
      recipient_phone: req.recipientPhone,
      recipient_address: req.recipientAddress,
      recipient_city: Number(req.recipientCityId),
      recipient_zone: Number(req.recipientZoneId),
      ...(req.recipientAreaId ? { recipient_area: Number(req.recipientAreaId) } : {}),
      delivery_type: req.deliveryType === "on_demand" ? 12 : 48,
      item_type: req.itemType === "document" ? 1 : 2,
      item_quantity: req.itemQuantity,
      item_weight: req.itemWeight ?? 0.5,
      amount_to_collect: req.amountToCollect,
      ...(req.itemDescription ? { item_description: req.itemDescription } : {}),
      ...(req.specialInstruction ? { special_instruction: req.specialInstruction } : {}),
    };

    const json = await request<{
      data?: {
        consignment_id?: string;
        merchant_order_id?: string;
        order_status?: string;
        delivery_fee?: number;
      };
    }>(ctx, "/aladdin/api/v1/orders", { method: "POST", body: payload });

    const data = json.data;
    if (!data?.consignment_id) fail("unknown", "The courier returned no consignment id");
    return {
      consignmentId: data.consignment_id,
      trackingNumber: data.consignment_id,
      providerStatus: data.order_status ?? null,
      deliveryFee: data.delivery_fee ?? null,
    };
  },

  async getStatus(accountId, consignmentId): Promise<CourierStatusResult> {
    const ctx = await loadAccount(accountId);
    const json = await request<{
      data?: {
        consignment_id?: string;
        merchant_order_id?: string;
        order_status?: string;
        order_status_slug?: string;
        updated_at?: string;
      };
    }>(ctx, `/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`, { method: "GET" });

    const data = json.data;
    if (!data?.order_status && !data?.order_status_slug) {
      fail("unknown", "The courier returned no status for this consignment");
    }
    return {
      consignmentId: data.consignment_id ?? consignmentId,
      merchantOrderId: data.merchant_order_id ?? null,
      providerStatus: data.order_status_slug ?? data.order_status ?? "",
      providerStatusSlug: data.order_status_slug ?? null,
      updatedAt: data.updated_at ?? null,
    };
  },

  async quote(accountId, req: CourierQuoteRequest): Promise<CourierQuoteResult> {
    const ctx = await loadAccount(accountId);
    if (!ctx.storeId) fail("validation", "This courier account has no store id configured");
    const json = await request<{
      data?: {
        price?: number;
        discount?: number;
        promo_discount?: number;
        plan_id?: string;
        cod_percentage?: number;
        additional_charge?: number;
        final_price?: number;
      };
    }>(ctx, "/aladdin/api/v1/merchant/price-plan", {
      method: "POST",
      body: {
        store_id: Number(ctx.storeId),
        item_type: req.itemType === "document" ? 1 : 2,
        delivery_type: req.deliveryType === "on_demand" ? 12 : 48,
        item_weight: req.itemWeight,
        recipient_city: Number(req.recipientCityId),
        recipient_zone: Number(req.recipientZoneId),
      },
    });
    const d = json.data ?? {};
    return {
      price: d.price ?? 0,
      discount: d.discount ?? null,
      promoDiscount: d.promo_discount ?? null,
      codPercentage: d.cod_percentage ?? null,
      additionalCharge: d.additional_charge ?? null,
      finalPrice: d.final_price ?? d.price ?? 0,
      planId: d.plan_id ?? null,
    };
  },

  async listCities(accountId) {
    return cachedLocations(accountId, "city", "/aladdin/api/v1/city-list", null, (row) => ({
      externalId: String(row["city_id"]),
      name: String(row["city_name"]),
    }));
  },

  async listZones(accountId, cityId) {
    return cachedLocations(
      accountId,
      "zone",
      `/aladdin/api/v1/cities/${encodeURIComponent(cityId)}/zone-list`,
      cityId,
      (row) => ({ externalId: String(row["zone_id"]), name: String(row["zone_name"]) }),
    );
  },

  async listAreas(accountId, zoneId) {
    return cachedLocations(
      accountId,
      "area",
      `/aladdin/api/v1/zones/${encodeURIComponent(zoneId)}/area-list`,
      zoneId,
      (row) => ({ externalId: String(row["area_id"]), name: String(row["area_name"]) }),
    );
  },
};

/** Location lists change rarely: serve from the database, refresh only when empty or stale. */
const LOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function cachedLocations(
  accountId: string,
  kind: "city" | "zone" | "area",
  path: string,
  parentExternalId: string | null,
  map: (row: Record<string, unknown>) => { externalId: string; name: string },
): Promise<CourierLocationOption[]> {
  const ctx = await loadAccount(accountId);
  const db = await admin();

  let query = db
    .from("courier_locations")
    .select("external_id, name, parent_external_id, refreshed_at")
    .eq("provider_id", ctx.providerId)
    .eq("kind", kind);
  query = parentExternalId
    ? query.eq("parent_external_id", parentExternalId)
    : query.is("parent_external_id", null);
  const { data: cached } = await query;

  const fresh =
    (cached?.length ?? 0) > 0 &&
    cached!.every((r) => Date.now() - Date.parse(r.refreshed_at) < LOCATION_TTL_MS);
  if (fresh) {
    return cached!.map((r) => ({
      externalId: r.external_id,
      name: r.name,
      parentExternalId: r.parent_external_id,
    }));
  }

  const json = await request<{ data?: { data?: Record<string, unknown>[] } }>(ctx, path, {
    method: "GET",
  });
  const rows = json.data?.data ?? [];
  const options = rows.map(map);
  if (options.length > 0) {
    await db.from("courier_locations").upsert(
      options.map((o) => ({
        provider_id: ctx.providerId,
        kind,
        external_id: o.externalId,
        parent_external_id: parentExternalId,
        name: o.name,
        refreshed_at: new Date().toISOString(),
      })),
      { onConflict: "provider_id,kind,external_id" },
    );
  }
  return options.map((o) => ({ ...o, parentExternalId }));
}
