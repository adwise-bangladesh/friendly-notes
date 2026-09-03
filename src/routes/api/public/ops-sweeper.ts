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
        const { correlationFromRequest } = await import("@/lib/observability/correlation");
        const { recordFailure } = await import("@/lib/observability/diagnostics.server");

        const correlationId = correlationFromRequest(request, "sweep");
        const runId = await startWorkerRun(client, "ops_sweeper", triggerSource, correlationId);

        const call = async (fn: string, args?: Record<string, unknown>): Promise<SweepResult> => {
          const startedAt = Date.now();
          try {
            const { data, error } = await client.rpc(fn, args);
            if (error) {
              await recordFailure(client, new Error(error.message), {
                subsystem: "worker",
                operation: fn,
                stage: "database",
                correlationId,
                workerRunId: runId,
                durationMs: Date.now() - startedAt,
              });
              return { ok: false, count: 0 };
            }
            return { ok: true, count: Number(data ?? 0) || 0 };
          } catch (error) {
            await recordFailure(client, error, {
              subsystem: "worker",
              operation: fn,
              stage: "database",
              correlationId,
              workerRunId: runId,
              durationMs: Date.now() - startedAt,
            });
            return { ok: false, count: 0 };
          }
        };

        const staleSyncJobs = await call("reclaim_stale_sync_jobs");
        const courierEventRetries = await call("sweep_courier_event_retries", {
          _limit: retryLimit,
        });
        const prunedRuns = prune ? await call("prune_worker_runs") : { ok: true, count: 0 };
        // Operational telemetry retention only: diagnostics and safe courier API
        // logs older than 30 days. Authoritative domain history is never touched.
        const prunedTelemetry = prune
          ? await call("prune_operational_telemetry", { _days: 30 })
          : { ok: true, count: 0 };

        // Operational incident detection reuses the existing telemetry and
        // operational tables; it never mutates business state.
        let detection: { detected: number; resolved: number; ok: boolean } = {
          detected: 0,
          resolved: 0,
          ok: false,
        };
        try {
          const { data, error } = await client.rpc("detect_operational_alerts");
          const summary = (data ?? {}) as { detected?: number; resolved?: number };
          detection = {
            ok: !error,
            detected: Number(summary.detected ?? 0),
            resolved: Number(summary.resolved ?? 0),
          };
        } catch {
          detection = { detected: 0, resolved: 0, ok: false };
        }

        const steps = [
          staleSyncJobs,
          courierEventRetries,
          prunedRuns,
          prunedTelemetry,
          { ok: detection.ok, count: 0 },
        ];
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
          correlation_id: correlationId,
          stale_sync_jobs_reclaimed: staleSyncJobs.count,
          courier_events_retried: courierEventRetries.count,
          worker_runs_pruned: prunedRuns.count,
          alerts_detected: detection.detected,
          alerts_resolved: detection.resolved,
          failed_steps: failed,
        });

      },
    },
  },
});
