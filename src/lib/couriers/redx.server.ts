/**
 * RedX courier adapter — SERVER ONLY.
 *
 * Implemented against RedX's documented open API:
 *   POST /parcel                  → create a parcel
 *   GET  /parcel/track/{id}       → tracking history
 *   GET  /areas                   → delivery areas (cached in `courier_locations`)
 *
 * Authentication is a single `API-ACCESS-TOKEN` header, resolved from the vault
 * through the credential boundary. RedX publishes no price-quote or
 * cancellation endpoint, so this adapter deliberately implements neither.
 *
 * NOT verified against the live RedX API in this project: the integration level
 * stays "ready_for_api" until a real credentialed call succeeds.
 */

import {
  type CourierAdapter,
  type CourierBookingRequest,
  type CourierBookingResult,
  type CourierLocationOption,
  type CourierStatusResult,
} from "@/types/couriers";
import { courierFetch, fail, loadCourierAccount, type CourierAccountContext } from "./shared.server";

const BASES = {
  sandbox: "https://sandbox.redx.com.bd/v1.0.0-beta",
  production: "https://openapi.redx.com.bd/v1.0.0-beta",
};

/** RedX areas change rarely; refresh only when missing or a week old. */
const LOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function authHeaders(ctx: CourierAccountContext): Record<string, string> {
  const token = ctx.credentials.accessToken ?? ctx.credentials.clientSecret;
  if (!token) fail("auth", "The RedX API access token is not configured");
  return { "API-ACCESS-TOKEN": `Bearer ${token}` };
}

export const redxAdapter: CourierAdapter = {
  code: "redx",
  integrationLevel: "ready_for_api",

  async bookShipment(accountId, req: CourierBookingRequest): Promise<CourierBookingResult> {
    const ctx = await loadCourierAccount(accountId, BASES);
    if (!req.recipientAreaId) {
      fail("validation", "A RedX delivery area must be mapped before booking");
    }

    const json = await courierFetch<{ tracking_id?: string; message?: string }>(
      `${ctx.baseUrl}/parcel`,
      {
        method: "POST",
        headers: authHeaders(ctx),
        body: {
          customer_name: req.recipientName,
          customer_phone: req.recipientPhone,
          delivery_area_id: Number(req.recipientAreaId),
          customer_address: req.recipientAddress,
          // our shipment number is the merchant-side idempotency anchor
          merchant_invoice_id: req.merchantOrderId,
          cash_collection_amount: String(req.amountToCollect),
          parcel_weight: Math.round((req.itemWeight ?? 0.5) * 1000),
          value: req.amountToCollect,
          ...(req.itemDescription ? { instruction: req.itemDescription } : {}),
          ...(req.specialInstruction ? { pickup_note: req.specialInstruction } : {}),
        },
      },
    );

    if (!json.tracking_id) fail("unknown", json.message ?? "The courier returned no tracking id");
    return {
      consignmentId: json.tracking_id,
      trackingNumber: json.tracking_id,
      providerStatus: null,
      deliveryFee: null,
    };
  },

  async getStatus(accountId, consignmentId): Promise<CourierStatusResult> {
    const ctx = await loadCourierAccount(accountId, BASES);
    const json = await courierFetch<{
      tracking?: { message_en?: string; time?: string }[];
    }>(`${ctx.baseUrl}/parcel/track/${encodeURIComponent(consignmentId)}`, {
      method: "GET",
      headers: authHeaders(ctx),
    });

    const latest = json.tracking?.[0];
    if (!latest?.message_en) {
      fail("unknown", "The courier returned no status for this parcel");
    }
    return {
      consignmentId,
      merchantOrderId: null,
      providerStatus: latest.message_en,
      providerStatusSlug: latest.message_en.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      updatedAt: latest.time ?? null,
    };
  },

  async listAreas(accountId): Promise<CourierLocationOption[]> {
    const ctx = await loadCourierAccount(accountId, BASES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cached } = await supabaseAdmin
      .from("courier_locations")
      .select("external_id, name, parent_external_id, refreshed_at")
      .eq("provider_id", ctx.providerId)
      .eq("kind", "area");

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

    const json = await courierFetch<{
      areas?: { id?: number | string; name?: string; zone_id?: number | string }[];
    }>(`${ctx.baseUrl}/areas`, { method: "GET", headers: authHeaders(ctx) });

    const options = (json.areas ?? [])
      .filter((a) => a.id != null && a.name)
      .map((a) => ({
        externalId: String(a.id),
        name: String(a.name),
        parentExternalId: a.zone_id == null ? null : String(a.zone_id),
      }));

    if (options.length > 0) {
      await supabaseAdmin.from("courier_locations").upsert(
        options.map((o) => ({
          provider_id: ctx.providerId,
          kind: "area",
          external_id: o.externalId,
          parent_external_id: o.parentExternalId,
          name: o.name,
          refreshed_at: new Date().toISOString(),
        })),
        { onConflict: "provider_id,kind,external_id" },
      );
    }
    return options;
  },
};
