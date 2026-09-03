/**
 * Provider-neutral courier adapter contracts.
 *
 * These types describe what *any* courier integration must be able to do.
 * They are deliberately small: a courier adapter books a shipment, looks up a
 * status, and (optionally) quotes a price. Everything else — internal state,
 * history, money — belongs to the shipment model, not to the provider.
 *
 * This module is client-safe: it contains no credentials and no network code.
 */

import type { ShipmentStatus } from "./shipping";

/** How far a provider integration actually is. Never overstate this. */
export type CourierIntegrationLevel =
  | "configured" // exists in the database, manual operations only
  | "stub" // adapter shape exists, no API calls implemented
  | "ready_for_api" // adapter implemented, needs credentials + real-world verification
  | "partially_implemented"
  | "production_ready";

export const COURIER_INTEGRATION_LABELS: Record<CourierIntegrationLevel, string> = {
  configured: "Configured (manual only)",
  stub: "Stub",
  ready_for_api: "Ready for API (unverified)",
  partially_implemented: "Partially implemented",
  production_ready: "Production ready",
};

/**
 * Honest, hand-maintained status of every provider in this project.
 * Only change a value after the capability has actually been exercised.
 */
export const COURIER_INTEGRATION_STATUS: Record<string, CourierIntegrationLevel> = {
  pathao: "ready_for_api",
  steadfast: "configured",
  redx: "configured",
  paperfly: "configured",
};

/* ---------- Adapter I/O ---------- */

export interface CourierBookingRequest {
  shipmentId: string;
  /** our own identifier handed to the provider — also the outbound idempotency anchor */
  merchantOrderId: string;
  /**
   * Authoritative booking key issued by `book_shipment_begin`. Stable across
   * retries of the same logical booking; only an explicitly abandoned attempt
   * rotates it. Adapters send it wherever the provider supports an idempotency
   * key or header; providers without that support (Pathao today) still rely on
   * `merchantOrderId` and on our own locking to avoid a second parcel.
   */
  idempotencyKey?: string | null;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientCityId?: string | null;
  recipientZoneId?: string | null;
  recipientAreaId?: string | null;
  /** the amount the rider must collect, from the order financials — not the order total */
  amountToCollect: number;
  itemQuantity: number;
  itemWeight?: number | null;
  itemDescription?: string | null;
  specialInstruction?: string | null;
  deliveryType?: "standard" | "on_demand";
  itemType?: "document" | "parcel";
}

export interface CourierBookingResult {
  consignmentId: string;
  trackingNumber?: string | null;
  providerStatus?: string | null;
  deliveryFee?: number | null;
}

export interface CourierStatusResult {
  consignmentId: string;
  merchantOrderId?: string | null;
  providerStatus: string;
  providerStatusSlug?: string | null;
  updatedAt?: string | null;
}

export interface CourierQuoteRequest {
  recipientCityId: string;
  recipientZoneId: string;
  itemWeight: number;
  deliveryType?: "standard" | "on_demand";
  itemType?: "document" | "parcel";
}

export interface CourierQuoteResult {
  price: number;
  discount?: number | null;
  promoDiscount?: number | null;
  codPercentage?: number | null;
  additionalCharge?: number | null;
  finalPrice: number;
  planId?: string | null;
}

export interface CourierLocationOption {
  externalId: string;
  name: string;
  parentExternalId?: string | null;
}

/** A safe, user-presentable failure. Never carries credentials or raw tokens. */
export interface CourierErrorInfo {
  category:
    | "auth"
    | "validation"
    | "not_found"
    | "rate_limited"
    | "provider_unavailable"
    | "unknown";
  message: string;
  statusCode?: number | undefined;
  retryable: boolean;
}

export class CourierError extends Error implements CourierErrorInfo {
  category: CourierErrorInfo["category"];
  statusCode: number | undefined;
  retryable: boolean;
  constructor(info: CourierErrorInfo) {
    super(info.message);
    this.name = "CourierError";
    this.category = info.category;
    this.statusCode = info.statusCode;
    this.retryable = info.retryable;
  }
}

/** Every provider adapter implements this. Optional members are genuinely optional. */
export interface CourierAdapter {
  code: string;
  integrationLevel: CourierIntegrationLevel;
  bookShipment(accountId: string, request: CourierBookingRequest): Promise<CourierBookingResult>;
  getStatus(accountId: string, consignmentId: string): Promise<CourierStatusResult>;
  quote?(accountId: string, request: CourierQuoteRequest): Promise<CourierQuoteResult>;
  listCities?(accountId: string): Promise<CourierLocationOption[]>;
  listZones?(accountId: string, cityId: string): Promise<CourierLocationOption[]>;
  listAreas?(accountId: string, zoneId: string): Promise<CourierLocationOption[]>;
  cancelShipment?(accountId: string, consignmentId: string): Promise<void>;
}

/** Provider-neutral shape of a normalized inbound courier event. */
export interface NormalizedCourierEvent {
  providerCode: string;
  providerEvent: string;
  consignmentId?: string | null;
  merchantOrderId?: string | null;
  providerEventAt?: string | null;
  providerEventId?: string | null;
}

/** Fee vocabulary — kept distinct so settlement can be added without a redesign. */
export const COURIER_FEE_MEANINGS = {
  quoted: "Estimated courier quote before booking. Never a financial fact.",
  booked: "Fee the courier returned when the consignment was accepted.",
  actual: "Real charge after delivery — not modelled yet (financial settlement step).",
  settlement: "Net amount the courier pays the merchant — not modelled yet.",
} as const;

export type ShipmentStatusForProvider = ShipmentStatus;
