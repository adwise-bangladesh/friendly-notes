/**
 * Scheduled stuck-state sweeper.
 *
 *   Scheduler → this endpoint → dedicated-secret check → existing recovery RPCs
 *
 * This endpoint owns no logic of its own. It only calls the authoritative
 * recovery functions that already exist, so there is no second recovery
 * pipeline:
 *   - `reclaim_stale_sync_jobs()`   → returns jobs whose worker lease expired
 *   - `sweep_courier_event_retries()` → bounded retry of due courier events
 *   - `prune_worker_runs()`         → bounded retention of worker telemetry
 *
 * Stuck shipment bookings are deliberately NOT auto-resolved here: the Step
 * 20.8.3.1 model requires an operator decision for an unknown booking outcome
 * (`resolve_unknown_courier_booking`), and stale in-progress booking locks are
 * already reclaimed by `book_shipment_begin(_stale_after_seconds)` on the next
 * attempt. Overdue tracking polls with expired leases are re-claimed by
 * `claim_courier_tracking_polls` in the courier tracking worker.
 *
 * Every step is independently guarded: one failing sweep does not abort the
 * others, and each underlying function is idempotent and lock-safe, so
 * overlapping invocations cannot duplicate work.
 */

import { createFileRoute } from "@tanstack/react-router";

interface SweepResult {
  ok: boolean;
  count: number;
}

export const Route = createFileRoute("/api/public/ops-sweeper")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifyWorkerRequest, workerUnauthorized } = await import(
          "@/lib/workers/auth.server"
        );
        const client = supabaseAdmin as unknown as Parameters<typeof verifyWorkerRequest>[2];

        if (!(await verifyWorkerRequest(request, "ops_sweeper", client))) {
          return workerUnauthorized();
        }

        const url = new URL(request.url);
        const retryLimitRaw = Number.parseInt(url.searchParams.get("retry_limit") ?? "20", 10);
        const retryLimit = Math.min(
          Math.max(Number.isFinite(retryLimitRaw) ? retryLimitRaw : 20, 1),
          50,
        );
        const triggerSource = url.searchParams.get("trigger") === "manual" ? "manual" : "scheduled";
        const prune = url.searchParams.get("prune") === "1";

        const { startWorkerRun, finishWorkerRun } = await import("@/lib/workers/run.server");
        const runId = await startWorkerRun(client, "ops_sweeper", triggerSource);

        const call = async (fn: string, args?: Record<string, unknown>): Promise<SweepResult> => {
          try {
            const { data, error } = await client.rpc(fn, args);
            if (error) return { ok: false, count: 0 };
            return { ok: true, count: Number(data ?? 0) || 0 };
          } catch {
            return { ok: false, count: 0 };
          }
        };

        const staleSyncJobs = await call("reclaim_stale_sync_jobs");
        const courierEventRetries = await call("sweep_courier_event_retries", {
          _limit: retryLimit,
        });
        const prunedRuns = prune ? await call("prune_worker_runs") : { ok: true, count: 0 };

        const steps = [staleSyncJobs, courierEventRetries, prunedRuns];
        const failed = steps.filter((s) => !s.ok).length;
        const processed = steps.reduce((sum, s) => sum + s.count, 0);

        await finishWorkerRun(client, runId, failed > 0 ? "failed" : "succeeded", {
          claimed: processed,
          processed,
          succeeded: steps.filter((s) => s.ok).length,
          failed,
        });

        return Response.json({
          run_id: runId,
          stale_sync_jobs_reclaimed: staleSyncJobs.count,
          courier_events_retried: courierEventRetries.count,
          worker_runs_pruned: prunedRuns.count,
          failed_steps: failed,
        });
      },
    },
  },
});
