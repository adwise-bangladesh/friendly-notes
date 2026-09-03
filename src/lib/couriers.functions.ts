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

/**
 * Categories that prove the courier did NOT create a parcel. Anything else —
 * a timeout, a dropped connection, a 5xx, an unparsable answer — leaves the
 * outcome genuinely unknown and must never be silently retried.
 */
function isDefiniteFailure(error: unknown): boolean {
  return (
    error instanceof CourierError &&
    (error.category === "auth" ||
      error.category === "validation" ||
      error.category === "rate_limited")
  );
}

/**
 * Books the shipment with its assigned courier account.
 *
 * Concurrency contract: `book_shipment_begin` locks the shipment row, re-checks
 * eligibility and claims the attempt *before* any external call. A second
 * click, tab or operator therefore gets `already_booked` / `in_progress` and
 * never reaches the courier API. The booking key it returns is stable across
 * retries, so a provider that honours idempotency keys can dedupe as well.
 */
export const bookShipmentWithCourier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipmentInput.parse(input))
  .handler(async ({ data, context }): Promise<CourierActionResult> => {
    await assertCanManage(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCourierAdapter, logCourierCall } = await import("./couriers/registry.server");

    // the caller's own client performs the claim, so auth.uid() and the
    // permission re-check inside the SQL function apply to the real operator
    const claimClient = context.supabase as unknown as {
      rpc: (
        fn: "book_shipment_begin",
        args: { _shipment_id: string },
      ) => PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
    };
    const { data: claim, error: claimError } = await claimClient.rpc("book_shipment_begin", {
      _shipment_id: data.shipmentId,
    });
    if (claimError) throw new Error(claimError.message);
    const outcome = String(claim?.["outcome"] ?? "");

    if (outcome === "already_booked") {
      return {
        ok: true,
        status: String(claim?.["status"] ?? ""),
        changed: false,
        message: `Already booked with consignment ${String(claim?.["consignment_id"] ?? "")}.`,
      };
    }
    if (outcome === "in_progress") {
      return {
        ok: true,
        status: String(claim?.["status"] ?? ""),
        changed: false,
        message: "A booking attempt for this shipment is already running. Nothing was sent again.",
      };
    }
    if (outcome === "recovery_required") {
      throw new Error(
        `${String(claim?.["message"] ?? "The previous booking outcome is unknown.")} Confirm with the courier and resolve it before booking again.`,
      );
    }

    const idempotencyKey = String(claim?.["idempotency_key"] ?? "");

    const { data: shipment } = await supabaseAdmin
      .from("shipments")
      .select(
        "id, shipment_number, status, provider_id, service_type, courier_account_id, external_consignment_id, recipient_name, recipient_phone, delivery_address, delivery_city, delivery_zone, cash_on_delivery_amount, weight, notes, provider_recipient_city_id, provider_recipient_zone_id, provider_recipient_area_id, provider:courier_providers(code, name), account:courier_accounts(id, label, environment)",
      )
      .eq("id", data.shipmentId)
      .maybeSingle();
    if (!shipment) throw new Error("Shipment not found");

    const code = (shipment.provider as { code: string } | null)?.code ?? "";
    const adapter = getCourierAdapter(code);
    if (!adapter) {
      await supabaseAdmin.rpc("record_courier_booking_failure", {
        _shipment_id: shipment.id,
        _message: "No API integration exists for this courier yet.",
        _outcome_unknown: false,
        _idempotency_key: idempotencyKey,
      });
      throw new Error(
        "No API integration exists for this courier yet. Record the booking manually.",
      );
    }

    const { count } = await supabaseAdmin
      .from("shipment_items")
      .select("quantity", { count: "exact", head: true })
      .eq("shipment_id", shipment.id);

    const account = shipment.account as {
      id: string;
      label: string | null;
      environment: string | null;
    } | null;

    try {
      const result = await adapter.bookShipment(shipment.courier_account_id!, {
        shipmentId: shipment.id,
        merchantOrderId: shipment.shipment_number,
        idempotencyKey,
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

      // non-secret, historical record of what the booking was made against
      const snapshot = {
        provider_code: code,
        provider_name: (shipment.provider as { name?: string } | null)?.name ?? null,
        account_id: account?.id ?? null,
        account_label: account?.label ?? null,
        environment: account?.environment ?? null,
        service_type: shipment.service_type,
        merchant_order_id: shipment.shipment_number,
        amount_to_collect: Number(shipment.cash_on_delivery_amount ?? 0),
        item_quantity: count ?? 1,
        item_weight: shipment.weight,
        recipient_city_id: shipment.provider_recipient_city_id,
        recipient_zone_id: shipment.provider_recipient_zone_id,
        recipient_area_id: shipment.provider_recipient_area_id,
        provider_status: result.providerStatus ?? null,
        delivery_fee: result.deliveryFee ?? null,
        tracking_number: result.trackingNumber ?? null,
      };

      const { error } = await supabaseAdmin.rpc("record_courier_booking", {
        _shipment_id: shipment.id,
        _consignment_id: result.consignmentId,
        _idempotency_key: idempotencyKey,
        _booking_snapshot: snapshot,
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
      const definite = isDefiniteFailure(error);
      await supabaseAdmin.rpc("record_courier_booking_failure", {
        _shipment_id: shipment.id,
        _message: message,
        _outcome_unknown: !definite,
        _idempotency_key: idempotencyKey,
      });
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
      throw new Error(
        definite
          ? message
          : `${message} The result is unknown — check with the courier before retrying.`,
      );
    }
  });

/**
 * Cancels a booked consignment with the courier, but only for providers whose
 * adapter actually implements cancellation. Internal state is then moved
 * through the existing shipment state machine — no parallel workflow.
 */
export const cancelShipmentWithCourier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    shipmentInput.extend({ reason: z.string().trim().min(3).max(500) }).parse(input),
  )
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
      throw new Error("This shipment has no courier consignment to cancel");
    }
    const code = (shipment.provider as { code: string } | null)?.code ?? "";
    const adapter = getCourierAdapter(code);
    if (!adapter?.cancelShipment || !shipment.courier_account_id) {
      throw new Error(
        "This courier cannot be cancelled through the API yet. Cancel it with the courier directly, then cancel the shipment here.",
      );
    }

    try {
      await adapter.cancelShipment(shipment.courier_account_id, shipment.external_consignment_id);
      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "cancel_shipment",
        succeeded: true,
      });
    } catch (error) {
      const message = safeMessage(error);
      await logCourierCall({
        providerId: shipment.provider_id,
        accountId: shipment.courier_account_id,
        shipmentId: shipment.id,
        operation: "cancel_shipment",
        succeeded: false,
        safeMessage: message,
      });
      throw new Error(message);
    }

    // internal state always moves through the existing guarded state machine
    const stateClient = context.supabase as unknown as {
      rpc: (
        fn: "set_shipment_state",
        args: { _shipment_id: string; _action: string; _reason: string },
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
    const { error } = await stateClient.rpc("set_shipment_state", {
      _shipment_id: shipment.id,
      _action: "cancel",
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true, changed: true, status: "cancelled", message: "Cancelled with the courier." };
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
