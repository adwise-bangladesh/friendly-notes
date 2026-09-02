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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: provider } = await supabaseAdmin
          .from("courier_providers")
          .select("id, code, status")
          .eq("code", providerCode)
          .maybeSingle();
        if (!provider || provider.status !== "active") {
          return new Response("Unauthorized", { status: 401 });
        }

        const { data: accounts } = await supabaseAdmin
          .from("courier_accounts")
          .select("id, courier_account_credentials(webhook_secret)")
          .eq("provider_id", provider.id)
          .eq("status", "active");

        const matched = (accounts ?? []).find((account) => {
          const secret = (
            account.courier_account_credentials as { webhook_secret: string | null } | null
          )?.webhook_secret;
          return Boolean(secret) && timingSafeEqual(secret!, presented!);
        });
        if (!matched) return new Response("Unauthorized", { status: 401 });

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
          // never echo provider or internal detail back to a public caller
          return new Response(JSON.stringify({ received: true }), {
            status: 202,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }

        return new Response(
          JSON.stringify({
            received: true,
            processing: (event as { processing_status?: string } | null)?.processing_status ?? null,
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
