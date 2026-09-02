/**
 * Courier adapter registry — SERVER ONLY.
 *
 * Only providers with a real adapter appear here. Everything else stays a
 * manual, operator-driven courier: the shipment workflow still works, the
 * automated actions simply are not offered.
 */

import type { CourierAdapter } from "@/types/couriers";
import { pathaoAdapter } from "./pathao.server";

const ADAPTERS: Record<string, CourierAdapter> = {
  pathao: pathaoAdapter,
};

export function getCourierAdapter(providerCode: string): CourierAdapter | null {
  return ADAPTERS[providerCode] ?? null;
}

/** Safe operational logging of a courier API call. Never receives secrets. */
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
  });
}
