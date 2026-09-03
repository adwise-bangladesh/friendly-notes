/**
 * Scheduled background sync worker endpoint.
 *
 *   Scheduler → this endpoint → dedicated-secret check → bounded worker run
 *
 * Security:
 * - The route lives under /api/public so an external scheduler can reach the
 *   published site, and is therefore authenticated here with the sync worker's
 *   OWN secret (vault `worker_secret_sync_queue`, or the explicit
 *   `SYNC_WORKER_SECRET` env var). It never accepts another worker's secret.
 * - The worker itself runs with the service-role client, so the controlled
 *   database functions accept it as the background context. No credential,
 *   provider payload or customer data is returned — only counters.
 * - Every run is bounded: at most `batch` jobs (hard cap inside the worker)
 *   within a wall clock budget, with no self invocation. Overlapping runs are
 *   safe because job claiming uses `FOR UPDATE SKIP LOCKED` leases.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sync-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifyWorkerRequest, workerUnauthorized } = await import(
          "@/lib/workers/auth.server"
        );
        const client = supabaseAdmin as unknown as Parameters<typeof verifyWorkerRequest>[2];

        if (!(await verifyWorkerRequest(request, "sync_queue", client))) {
          return workerUnauthorized();
        }

        const url = new URL(request.url);
        const batch = Number.parseInt(url.searchParams.get("batch") ?? "10", 10);
        const triggerSource = url.searchParams.get("trigger") === "manual" ? "manual" : "scheduled";

        const { runSyncWorker } = await import("@/lib/sales-channels/worker.server");
        const { startWorkerRun, finishWorkerRun, classifyWorkerError } = await import(
          "@/lib/workers/run.server"
        );

        const runId = await startWorkerRun(client, "sync_queue", triggerSource);

        try {
          const summary = await runSyncWorker(
            supabaseAdmin as unknown as Parameters<typeof runSyncWorker>[0],
            {
              batchSize: Number.isFinite(batch) ? batch : 10,
              leaseSeconds: 120,
              timeBudgetMs: 25_000,
              workerId: triggerSource,
            },
          );
          await finishWorkerRun(client, runId, "succeeded", {
            claimed: summary.claimed,
            processed: summary.processed,
            succeeded: summary.succeeded,
            failed: summary.failed,
            skipped: Math.max(0, summary.claimed - summary.processed),
          });
          return Response.json({
            run_id: runId,
            claimed: summary.claimed,
            processed: summary.processed,
            succeeded: summary.succeeded,
            failed: summary.failed,
          });
        } catch (error) {
          await finishWorkerRun(client, runId, "failed", {}, classifyWorkerError(error));
          // never echo an internal message to an external caller
          return new Response("Worker run failed", { status: 500 });
        }
      },
    },
  },
});
