/**
 * The single, client-safe declaration of what each courier adapter can do.
 *
 * This module is the ONE place that answers "does provider X support booking /
 * tracking / quotes / location lookup / cancellation through its API?". Both
 * the server registry and the Integrations Center read it, so the UI can never
 * advertise a capability the adapter does not implement.
 *
 * Rules:
 * - Only list a capability that is actually implemented against the provider's
 *   documented API. Nothing here is aspirational.
 * - `integrationLevel` stays "ready_for_api" until a real credentialed call has
 *   been observed against the provider. Never claim production readiness.
 * - Providers with no adapter keep the manual shipping-desk workflow; they are
 *   not broken, they are simply operated by hand.
 *
 * No credentials, no endpoints, no network code lives here.
 */

import type { CourierIntegrationLevel } from "@/types/couriers";
import type { IntegrationCapability } from "@/types/integrations";

export interface CourierProviderCapabilityProfile {
  providerKey: string;
  name: string;
  /** true when a server adapter exists in `src/lib/couriers/<code>.server.ts` */
  hasAdapter: boolean;
  integrationLevel: CourierIntegrationLevel;
  /** API capabilities the adapter really implements */
  api: {
    book: boolean;
    status: boolean;
    quote: boolean;
    locations: boolean;
    cancel: boolean;
  };
  /** what an operator must configure before automated operations can run */
  accountRequirements: string[];
  note?: string;
}

const NO_API = { book: false, status: false, quote: false, locations: false, cancel: false };

export const COURIER_CAPABILITY_PROFILES: Record<string, CourierProviderCapabilityProfile> = {
  pathao: {
    providerKey: "pathao",
    name: "Pathao Courier",
    hasAdapter: true,
    integrationLevel: "ready_for_api",
    api: { book: true, status: true, quote: true, locations: true, cancel: false },
    accountRequirements: ["Client ID", "Client secret", "Username", "Password", "Store ID"],
    note: "Booking, tracking, price plan and city/zone/area lookup are implemented. Pathao's merchant API exposes no cancellation endpoint, so cancellation stays manual.",
  },
  steadfast: {
    providerKey: "steadfast",
    name: "Steadfast Courier",
    hasAdapter: true,
    integrationLevel: "ready_for_api",
    api: { book: true, status: true, quote: false, locations: false, cancel: false },
    accountRequirements: ["API key", "Secret key"],
    note: "Booking and consignment status are implemented against the documented merchant API. Delivery-status translations are loaded from Steadfast's documented vocabulary but have not been confirmed against a live credentialed account yet — unrecognised statuses are recorded without changing the shipment. Steadfast publishes no pricing, area or cancellation endpoints, so those stay manual.",
  },
  redx: {
    providerKey: "redx",
    name: "RedX",
    hasAdapter: true,
    integrationLevel: "ready_for_api",
    api: { book: true, status: true, quote: false, locations: true, cancel: false },
    accountRequirements: ["API access token"],
    note: "Parcel creation, tracking and delivery-area lookup are implemented. Tracking-status translations come from RedX's documented vocabulary and are not yet confirmed against a live credentialed account — unrecognised statuses are recorded without changing the shipment. RedX exposes no public price or cancellation endpoint, so those stay manual.",
  },
  paperfly: {
    providerKey: "paperfly",
    name: "Paperfly",
    hasAdapter: false,
    integrationLevel: "configured",
    api: { ...NO_API },
    accountRequirements: [],
    note: "No verified API contract is available in this project, so Paperfly shipments are operated manually through the shipping desk.",
  },
};

export function courierCapabilityProfile(
  providerKey: string,
): CourierProviderCapabilityProfile | null {
  return COURIER_CAPABILITY_PROFILES[providerKey.toLowerCase()] ?? null;
}

/** Capability vocabulary used by the Integrations Center, derived — never hand-written. */
export function integrationCapabilitiesFor(providerKey: string): IntegrationCapability[] {
  const profile = courierCapabilityProfile(providerKey);
  if (!profile || !profile.hasAdapter) return ["manual_workflow", "webhook_processing"];
  const caps: IntegrationCapability[] = [];
  if (profile.api.book) caps.push("create_shipment");
  if (profile.api.status) caps.push("refresh_tracking");
  if (profile.api.quote) caps.push("delivery_quote");
  if (profile.api.locations) caps.push("location_lookup");
  if (profile.api.cancel) caps.push("cancel_shipment");
  caps.push("webhook_processing");
  return caps;
}
