/**
 * Scheduled courier tracking worker endpoint.
 *
 *   Scheduler → this endpoint → shared-secret check → bounded worker run
 *
 * Same contract as the sales-channel sync worker: reachable from an external
 * scheduler, authenticated with a shared secret, service-role only inside, and
 * bounded (batch cap + wall clock budget, no self invocation). No courier
 * payload, credential or customer data is returned — only counters.
 */

import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/courier-tracking-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected =
          process.env["COURIER_POLL_SECRET"] ?? process.env["SYNC_WORKER_SECRET"] ?? "";
        const presented =
          request.headers.get("x-courier-poll-secret") ??
          request.headers.get("x-sync-worker-secret") ??
          "";
        if (!expected || !presented || !timingSafeEqual(presented, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const batch = Number.parseInt(url.searchParams.get("batch") ?? "10", 10);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCourierTrackingPoll } = await import("@/lib/couriers/polling.server");

        try {
          const summary = await runCourierTrackingPoll(
            supabaseAdmin as unknown as Parameters<typeof runCourierTrackingPoll>[0],
            {
              batchSize: Number.isFinite(batch) ? batch : 10,
              leaseSeconds: 120,
              timeBudgetMs: 25_000,
              workerId: "scheduled",
            },
          );
          return Response.json(summary);
        } catch {
          return new Response("Worker run failed", { status: 500 });
        }
      },
    },
  },
});
