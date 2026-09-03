/**
 * Steadfast (Packzy) courier adapter — SERVER ONLY.
 *
 * Implemented against Steadfast's documented merchant API:
 *   POST /create_order            → create a consignment
 *   GET  /status_by_cid/{id}      → consignment delivery status
 *
 * Authentication is two static headers (`Api-Key`, `Secret-Key`), resolved from
 * the vault through the single credential boundary. Steadfast publishes no
 * pricing, area-list or cancellation endpoint, so this adapter implements
 * exactly `bookShipment` and `getStatus` — nothing is invented and no capability
 * is advertised that the API does not offer.
 *
 * NOT verified against the live Steadfast API in this project: the integration
 * level stays "ready_for_api" until a real credentialed call succeeds.
 */

import {
  type CourierAdapter,
  type CourierBookingRequest,
  type CourierBookingResult,
  type CourierStatusResult,
} from "@/types/couriers";
import { courierFetch, fail, loadCourierAccount, type CourierAccountContext } from "./shared.server";

const BASES = {
  sandbox: "https://portal.packzy.com/api/v1",
  production: "https://portal.packzy.com/api/v1",
};

function authHeaders(ctx: CourierAccountContext): Record<string, string> {
  const key = ctx.credentials.clientId;
  const secret = ctx.credentials.clientSecret;
  if (!key || !secret) fail("auth", "The Steadfast API key and secret key are not configured");
  return { "Api-Key": key, "Secret-Key": secret };
}

export const steadfastAdapter: CourierAdapter = {
  code: "steadfast",
  integrationLevel: "ready_for_api",

  async bookShipment(accountId, req: CourierBookingRequest): Promise<CourierBookingResult> {
    const ctx = await loadCourierAccount(accountId, BASES);

    const json = await courierFetch<{
      status?: number;
      message?: string;
      consignment?: {
        consignment_id?: number | string;
        tracking_code?: string;
        status?: string;
        invoice?: string;
      };
    }>(`${ctx.baseUrl}/create_order`, {
      method: "POST",
      headers: authHeaders(ctx),
      body: {
        // our shipment number is the merchant-side idempotency anchor
        invoice: req.merchantOrderId,
        recipient_name: req.recipientName,
        recipient_phone: req.recipientPhone,
        recipient_address: req.recipientAddress,
        cod_amount: req.amountToCollect,
        ...(req.itemDescription ? { note: req.itemDescription } : {}),
      },
    });

    const consignment = json.consignment;
    if (!consignment?.consignment_id) {
      fail("unknown", json.message ?? "The courier returned no consignment id");
    }
    return {
      consignmentId: String(consignment.consignment_id),
      trackingNumber: consignment.tracking_code ?? String(consignment.consignment_id),
      providerStatus: consignment.status ?? null,
      deliveryFee: null,
    };
  },

  async getStatus(accountId, consignmentId): Promise<CourierStatusResult> {
    const ctx = await loadCourierAccount(accountId, BASES);
    const json = await courierFetch<{ status?: number; delivery_status?: string }>(
      `${ctx.baseUrl}/status_by_cid/${encodeURIComponent(consignmentId)}`,
      { method: "GET", headers: authHeaders(ctx) },
    );

    if (!json.delivery_status) {
      fail("unknown", "The courier returned no status for this consignment");
    }
    return {
      consignmentId,
      merchantOrderId: null,
      providerStatus: json.delivery_status,
      providerStatusSlug: json.delivery_status,
      updatedAt: null,
    };
  },
};
