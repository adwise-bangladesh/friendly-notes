/**
 * Courier webhook boundary.
 *
 *   Provider → this endpoint → shared-secret verification → normalization →
 *   idempotency check → shipment match → transition validation → atomic update
 *
 * Security notes, deliberately conservative:
 * - The provider is taken from the URL path, but nothing happens until the
 *   request proves it knows the secret configured for one of that provider's
 *   courier accounts. Payload fields never establish identity.
 * - Pathao's real webhook authentication mechanism is not verified in this
 *   project, so no signature scheme is invented here. A shared secret header
 *   is required, and the header name is configurable per provider. When the
 *   provider's documented mechanism is confirmed, replace `verifySecret` only.
 * - A request that cannot be authenticated is rejected before any lookup, so a
 *   public caller cannot probe shipment ids or move shipment state.
 * - Duplicate, stale, unmatched and invalid-transition events are all recorded
 *   in `courier_provider_events` by the database function; the shipment itself
 *   only changes on a valid forward transition.
 */

import { createFileRoute } from "@tanstack/react-router";

const SECRET_HEADERS = [
  "x-courier-webhook-secret",
  "x-pathao-signature",
  "x-webhook-signature",
] as const;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export const Route = createFileRoute("/api/public/couriers/$provider/webhook")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const providerCode = params.provider.toLowerCase();

        let presented: string | null = null;
        for (const header of SECRET_HEADERS) {
          presented = presented ?? str(request.headers.get(header));
        }
        if (!presented) return new Response("Unauthorized", { status: 401 });

        // The secret never leaves the database: the account is identified by
        // comparing fixed-length digests inside a service-role-only function.
        const { matchCourierWebhookAccount } = await import("@/lib/couriers/credentials.server");
        const matchedAccountId = await matchCourierWebhookAccount(providerCode, presented);
        if (!matchedAccountId) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { correlationFromRequest } = await import("@/lib/observability/correlation");
        const { recordDiagnostic, recordFailure } = await import(
          "@/lib/observability/diagnostics.server"
        );
        const client = supabaseAdmin as unknown as Parameters<typeof recordDiagnostic>[0];
        const correlationId = correlationFromRequest(request, "hook");
        const receivedAt = Date.now();

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        // Provider-neutral normalization: pull the few fields we rely on and
        // keep the untouched payload for audit.
        const providerEvent =
          str(payload["event"]) ?? str(payload["order_status_slug"]) ?? str(payload["status"]);
        if (!providerEvent) return new Response("Missing event", { status: 400 });

        const consignmentId = str(payload["consignment_id"]);
        const merchantOrderId = str(payload["merchant_order_id"]);
        const eventAt = str(payload["updated_at"]) ?? str(payload["timestamp"]);
        const eventId = str(payload["event_id"]) ?? str(payload["id"]);

        const { data: event, error } = await supabaseAdmin.rpc("ingest_courier_event", {
          _provider_code: providerCode,
          _provider_event: providerEvent,
          ...(consignmentId ? { _consignment_id: consignmentId } : {}),
          ...(merchantOrderId ? { _merchant_order_id: merchantOrderId } : {}),
          ...(eventAt ? { _provider_event_at: eventAt } : {}),
          ...(eventId ? { _provider_event_id: eventId } : {}),
          _payload: payload as never,
          _source: "webhook",
        });

        if (error) {
          await recordFailure(client, new Error(error.message), {
            subsystem: "webhook",
            operation: "ingest_courier_event",
            stage: "database",
            providerCode,
            accountId: matchedAccountId,
            correlationId,
            durationMs: Date.now() - receivedAt,
          });
          // never echo provider or internal detail back to a public caller
          return new Response(JSON.stringify({ received: true }), {
            status: 202,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }

        const processing =
          (event as { processing_status?: string } | null)?.processing_status ?? null;
        if (processing && processing !== "applied" && processing !== "duplicate") {
          // unmatched / stale / invalid transitions stay authoritative in
          // courier_provider_events; this is only the operator-facing trail
          await recordDiagnostic(client, {
            subsystem: "webhook",
            operation: "ingest_courier_event",
            severity: "warning",
            category: processing === "unmatched" ? "not_found" : "state_conflict",
            stage: "mapping",
            message: `Courier webhook event was recorded as ${processing}`,
            retryable: processing === "unmatched",
            providerCode,
            accountId: matchedAccountId,
            correlationId,
            durationMs: Date.now() - receivedAt,
            metadata: { processing_status: processing },
          });
        }

        return new Response(
          JSON.stringify({
            received: true,
            processing,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});
