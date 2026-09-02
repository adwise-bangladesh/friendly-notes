/**
 * Courier operations that must run on the server: booking, status refresh and
 * price quotes. Credentials never leave the server; the browser only ever sees
 * the resulting shipment state.
 *
 * Every function authenticates the caller (`requireSupabaseAuth`), re-checks
 * the staff/admin role in the database, and then performs the privileged
 * write through the guarded SQL functions with the service-role client.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CourierError } from "@/types/couriers";

const shipmentInput = z.object({ shipmentId: z.string().uuid() });

interface CourierActionResult {
  ok: boolean;
  status?: string;
  message: string;
  changed?: boolean;
}

async function assertCanManage(
  supabase: { rpc: (fn: never, args: never) => unknown },
  userId: string,
) {
  const client = supabase as unknown as {
    rpc: (
      fn: "can_manage_commerce",
      args: { _user_id: string },
    ) => PromiseLike<{ data: boolean | null }>;
  };
  const { data } = await client.rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to perform courier operations");
}

function safeMessage(error: unknown): string {
  if (error instanceof CourierError) return error.message;
  if (error instanceof Error) return error.message;
  return "The courier operation failed";
}

/** Books the shipment with its assigned courier account. Safe to retry. */
export const bookShipmentWithCourier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipmentInput.parse(input))
  .handler(async ({ data, context }): Promise<CourierActionResult> => {
    await assertCanManage(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCourierAdapter, logCourierCall } = await import("./couriers/registry.server");

    const { data: shipment } = await supabaseAdmin
      .from("shipments")
      .select(
        "id, shipment_number, status, provider_id, courier_account_id, external_consignment_id, recipient_name, recipient_phone, delivery_address, cash_on_delivery_amount, weight, notes, provider_recipient_city_id, provider_recipient_zone_id, provider_recipient_area_id, provider:courier_providers(code)",
      )
      .eq("id", data.shipmentId)
      .maybeSingle();
    if (!shipment) throw new Error("Shipment not found");

    // outbound idempotency: an existing consignment means the courier already has it
    if (shipment.external_consignment_id) {
      return {
        ok: true,
        status: shipment.status,
        changed: false,
        message: `Already booked with consignment ${shipment.external_consignment_id}.`,
      };
    }
    if (!["ready_for_booking", "booking_requested", "booking_failed"].includes(shipment.status)) {
      throw new Error(`A shipment in state "${shipment.status}" cannot be booked`);
    }
    if (!shipment.courier_account_id) throw new Error("Assign a courier account before booking");

    const code = (shipment.provider as { code: string } | null)?.code ?? "";
    const adapter = getCourierAdapter(code);
    if (!adapter) {
      throw new Error(
        `No API integration exists for this courier yet. Record the booking manually.`,
      );
    }

    const { count } = await supabaseAdmin
      .from("shipment_items")
      .select("quantity", { count: "exact", head: true })
      .eq("shipment_id", shipment.id);

    try {
      const result = await adapter.bookShipment(shipment.courier_account_id, {
        shipmentId: shipment.id,
        merchantOrderId: shipment.shipment_number,
        recipientName: shipment.recipient_name,
        recipientPhone: shipment.recipient_phone,
        recipientAddress: shipment.delivery_address,
        recipientCityId: shipment.provider_recipient_city_id,
        recipientZoneId: shipment.provider_recipient_zone_id,
        recipientAreaId: shipment.provider_recipient_area_id,
        // the amount to collect is the shipment's COD figure, derived from the
        // order financials when the shipment was created — never the order total
        amountToCollect: Number(shipment.cash_on_delivery_amount ?? 0),
        itemQuantity: count ?? 1,
        itemWeight: shipment.weight,
        itemDescription: shipment.notes,
      });

      const { error } = await supabaseAdmin.rpc("record_courier_booking", {
        _shipment_id: shipment.id,
        _consignment_id: result.consignmentId,
        ...(result.providerStatus ? { _provider_status: result.providerStatus } : {}),
        ...(result.deliveryFee != null ? { _delivery_fee: result.deliveryFee } : {}),
        ...(result.trackingNumber ? { _tracking_number: result.trackingNumber } : {}),
      });
      if (error) throw new Error(error.message);

      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "book_shipment",
        succeeded: true,
      });
      return {
        ok: true,
        status: "booked",
        changed: true,
        message: `Booked with the courier — consignment ${result.consignmentId}.`,
      };
    } catch (error) {
      const message = safeMessage(error);
      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "book_shipment",
        succeeded: false,
        ...(error instanceof CourierError
          ? {
              statusCode: error.statusCode ?? null,
              errorCategory: error.category,
              retryable: error.retryable,
            }
          : {}),
        safeMessage: message,
      });
      throw new Error(message);
    }
  });

/** Pulls the current courier status. Only records history when something changed. */
export const refreshShipmentCourierStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipmentInput.parse(input))
  .handler(async ({ data, context }): Promise<CourierActionResult> => {
    await assertCanManage(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCourierAdapter, logCourierCall } = await import("./couriers/registry.server");

    const { data: shipment } = await supabaseAdmin
      .from("shipments")
      .select(
        "id, status, provider_id, courier_account_id, external_consignment_id, provider:courier_providers(code)",
      )
      .eq("id", data.shipmentId)
      .maybeSingle();
    if (!shipment) throw new Error("Shipment not found");
    if (!shipment.external_consignment_id) {
      throw new Error("This shipment has no courier consignment to look up yet");
    }
    const code = (shipment.provider as { code: string } | null)?.code ?? "";
    const adapter = getCourierAdapter(code);
    if (!adapter || !shipment.courier_account_id) {
      throw new Error("No API integration exists for this courier yet");
    }

    try {
      const status = await adapter.getStatus(
        shipment.courier_account_id,
        shipment.external_consignment_id,
      );
      // the same idempotent, stale-safe path a webhook takes
      const { data: event, error } = await supabaseAdmin.rpc("ingest_courier_event", {
        _provider_code: code,
        _provider_event: status.providerStatusSlug ?? status.providerStatus,
        _consignment_id: status.consignmentId,
        ...(status.merchantOrderId ? { _merchant_order_id: status.merchantOrderId } : {}),
        ...(status.updatedAt ? { _provider_event_at: status.updatedAt } : {}),
        _source: "manual_refresh",
      });
      if (error) throw new Error(error.message);

      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "refresh_status",
        succeeded: true,
      });

      const processing = (event as { processing_status?: string } | null)?.processing_status;
      return {
        ok: true,
        changed: processing === "applied",
        message:
          processing === "applied"
            ? `Courier status applied: ${status.providerStatus}.`
            : `Courier reports "${status.providerStatus}" — no internal change (${processing ?? "recorded"}).`,
      };
    } catch (error) {
      const message = safeMessage(error);
      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "refresh_status",
        succeeded: false,
        ...(error instanceof CourierError
          ? {
              statusCode: error.statusCode ?? null,
              errorCategory: error.category,
              retryable: error.retryable,
            }
          : {}),
        safeMessage: message,
      });
      throw new Error(message);
    }
  });

/** Estimated courier quote only — never a booked fee and never a settlement figure. */
export const quoteShipmentDeliveryFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipmentInput.parse(input))
  .handler(async ({ data, context }): Promise<CourierActionResult & { quote?: number }> => {
    await assertCanManage(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCourierAdapter, logCourierCall } = await import("./couriers/registry.server");

    const { data: shipment } = await supabaseAdmin
      .from("shipments")
      .select(
        "id, provider_id, courier_account_id, weight, provider_recipient_city_id, provider_recipient_zone_id, provider:courier_providers(code)",
      )
      .eq("id", data.shipmentId)
      .maybeSingle();
    if (!shipment) throw new Error("Shipment not found");
    const code = (shipment.provider as { code: string } | null)?.code ?? "";
    const adapter = getCourierAdapter(code);
    if (!adapter?.quote || !shipment.courier_account_id) {
      throw new Error("This courier cannot be asked for a quote yet");
    }
    if (!shipment.provider_recipient_city_id || !shipment.provider_recipient_zone_id) {
      throw new Error("Map the courier city and zone before requesting a quote");
    }

    try {
      const quote = await adapter.quote(shipment.courier_account_id, {
        recipientCityId: shipment.provider_recipient_city_id,
        recipientZoneId: shipment.provider_recipient_zone_id,
        itemWeight: Number(shipment.weight ?? 0.5),
      });
      await supabaseAdmin.rpc("record_courier_quote", {
        _shipment_id: shipment.id,
        _quoted_fee: quote.finalPrice,
      });
      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "price_quote",
        succeeded: true,
      });
      return { ok: true, changed: true, quote: quote.finalPrice, message: "Courier quote saved." };
    } catch (error) {
      const message = safeMessage(error);
      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "price_quote",
        succeeded: false,
        safeMessage: message,
      });
      throw new Error(message);
    }
  });
