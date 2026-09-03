/**
 * Scheduled courier tracking worker endpoint.
 *
 *   Scheduler → this endpoint → dedicated-secret check → bounded worker run
 *
 * Security:
 * - Authenticated with the courier tracking worker's OWN secret (vault
 *   `worker_secret_courier_tracking`, or the explicit `COURIER_POLL_SECRET`
 *   env var). It no longer falls back to the sync worker's secret.
 * - Service-role only inside, bounded (batch cap + wall clock budget, no self
 *   invocation). No courier payload, credential or customer data is returned —
 *   only counters.
 * - Overlapping runs are safe: polls are claimed with leased
 *   `FOR UPDATE SKIP LOCKED` rows and events are idempotent by fingerprint.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/courier-tracking-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifyWorkerRequest, workerUnauthorized } = await import(
          "@/lib/workers/auth.server"
        );
        const client = supabaseAdmin as unknown as Parameters<typeof verifyWorkerRequest>[2];

        if (!(await verifyWorkerRequest(request, "courier_tracking", client))) {
          return workerUnauthorized();
        }

        const url = new URL(request.url);
        const batch = Number.parseInt(url.searchParams.get("batch") ?? "10", 10);
        const triggerSource = url.searchParams.get("trigger") === "manual" ? "manual" : "scheduled";

        const { runCourierTrackingPoll } = await import("@/lib/couriers/polling.server");
        const { startWorkerRun, finishWorkerRun, classifyWorkerError } = await import(
          "@/lib/workers/run.server"
        );

        const runId = await startWorkerRun(client, "courier_tracking", triggerSource);

        try {
          const summary = await runCourierTrackingPoll(
            supabaseAdmin as unknown as Parameters<typeof runCourierTrackingPoll>[0],
            {
              batchSize: Number.isFinite(batch) ? batch : 10,
              leaseSeconds: 120,
              timeBudgetMs: 25_000,
              workerId: triggerSource,
            },
          );
          await finishWorkerRun(client, runId, "succeeded", {
            claimed: summary.claimed,
            processed: summary.polled + summary.failed,
            succeeded: summary.polled,
            failed: summary.failed,
            skipped: Math.max(0, summary.claimed - summary.polled - summary.failed),
          });
          return Response.json({ run_id: runId, ...summary });
        } catch (error) {
          await finishWorkerRun(client, runId, "failed", {}, classifyWorkerError(error));
          return new Response("Worker run failed", { status: 500 });
        }
      },
    },
  },
});
