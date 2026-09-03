/**
 * Courier adapter registry — SERVER ONLY.
 *
 * Only providers with a real adapter appear here. Everything else stays a
 * manual, operator-driven courier: the shipment workflow still works, the
 * automated actions simply are not offered.
 *
 * Capabilities are never re-declared here. `capabilities.ts` is the single
 * source of truth, and `courierCapability()` cross-checks it against the
 * methods the adapter actually implements, so an over-claiming profile can
 * never enable an action at runtime.
 */

import type { CourierAdapter } from "@/types/couriers";
import { courierCapabilityProfile } from "./capabilities";
import { pathaoAdapter } from "./pathao.server";
import { redxAdapter } from "./redx.server";
import { steadfastAdapter } from "./steadfast.server";

const ADAPTERS: Record<string, CourierAdapter> = {
  pathao: pathaoAdapter,
  steadfast: steadfastAdapter,
  redx: redxAdapter,
};

export function getCourierAdapter(providerCode: string): CourierAdapter | null {
  return ADAPTERS[providerCode.toLowerCase()] ?? null;
}

export type CourierOperation = "book" | "status" | "quote" | "locations" | "cancel";

/**
 * True only when the declared profile AND the implemented adapter both support
 * the operation. Callers gate every automated courier action on this.
 */
export function courierCapability(providerCode: string, operation: CourierOperation): boolean {
  const adapter = getCourierAdapter(providerCode);
  if (!adapter) return false;
  const profile = courierCapabilityProfile(providerCode);
  if (!profile?.hasAdapter || !profile.api[operation]) return false;
  switch (operation) {
    case "book":
      return typeof adapter.bookShipment === "function";
    case "status":
      return typeof adapter.getStatus === "function";
    case "quote":
      return typeof adapter.quote === "function";
    case "locations":
      return (
        typeof adapter.listCities === "function" ||
        typeof adapter.listZones === "function" ||
        typeof adapter.listAreas === "function"
      );
    case "cancel":
      return typeof adapter.cancelShipment === "function";
  }
}


/**
 * Safe operational logging of one courier API call. Never receives secrets:
 * no headers, no tokens, no raw provider bodies. The authoritative provider
 * payload lives in `courier_provider_events`; this row is diagnostics only.
 */
export async function logCourierCall(entry: {
  providerId?: string | null;
  accountId?: string | null;
  shipmentId?: string | null;
  operation: string;
  succeeded: boolean;
  statusCode?: number | null;
  errorCategory?: string | null;
  safeMessage?: string | null;
  retryable?: boolean;
  durationMs?: number | null;
  failureStage?: string | null;
  correlationId?: string | null;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("courier_api_logs").insert({
    provider_id: entry.providerId ?? null,
    account_id: entry.accountId ?? null,
    shipment_id: entry.shipmentId ?? null,
    operation: entry.operation,
    succeeded: entry.succeeded,
    status_code: entry.statusCode ?? null,
    error_category: entry.errorCategory ?? null,
    safe_message: entry.safeMessage?.slice(0, 500) ?? null,
    retryable: entry.retryable ?? false,
    duration_ms: entry.durationMs == null ? null : Math.max(0, Math.round(entry.durationMs)),
    failure_stage: entry.failureStage ?? null,
    correlation_id: entry.correlationId ?? null,
  });
}
