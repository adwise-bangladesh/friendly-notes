/**
 * Scheduled background sync worker endpoint.
 *
 *   Scheduler → this endpoint → shared-secret check → bounded worker run
 *
 * Security:
 * - The route lives under /api/public so an external scheduler can reach the
 *   published site, and is therefore authenticated here: a caller must present
 *   `SYNC_WORKER_SECRET` in the `x-sync-worker-secret` header. Everything else
 *   is rejected before any database access.
 * - The worker itself runs with the service-role client, so the controlled
 *   database functions accept it as the background context. No credential,
 *   provider payload or customer data is returned — only counters.
 * - Every run is bounded: at most `batch` jobs (hard cap 25) inside a wall
 *   clock budget, with no self invocation.
 */

import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/sync-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["SYNC_WORKER_SECRET"] ?? "";
        const presented = request.headers.get("x-sync-worker-secret") ?? "";
        if (!expected || !presented || !timingSafeEqual(presented, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const batch = Number.parseInt(url.searchParams.get("batch") ?? "10", 10);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runSyncWorker } = await import("@/lib/sales-channels/worker.server");

        try {
          const summary = await runSyncWorker(
            supabaseAdmin as unknown as Parameters<typeof runSyncWorker>[0],
            {
              batchSize: Number.isFinite(batch) ? batch : 10,
              leaseSeconds: 120,
              timeBudgetMs: 25_000,
            },
          );
          return Response.json({
            claimed: summary.claimed,
            processed: summary.processed,
            succeeded: summary.succeeded,
            failed: summary.failed,
          });
        } catch {
          // never echo an internal message to an external caller
          return new Response("Worker run failed", { status: 500 });
        }
      },
    },
  },
});
