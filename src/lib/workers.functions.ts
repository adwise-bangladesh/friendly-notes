/**
 * Operator-triggered background worker runs.
 *
 * These call exactly the same bounded worker code paths as the scheduled
 * endpoints — same leases, same claim functions, same idempotency. A manual
 * run overlapping a scheduled run is therefore safe: both claim work with
 * `FOR UPDATE SKIP LOCKED` leases and neither can process the same row twice.
 *
 * Manual runs are gated on `can_manage_commerce`, so operators never need to
 * hold a worker secret. Worker secrets stay server-side and are never returned.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type MinimalClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function assertCanManage(client: MinimalClient, userId: string) {
  const { data } = await client.rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to run background workers");
}

/** Bounded courier tracking poll, triggered by an operator. */
export const runCourierTrackingNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ batchSize: z.number().int().min(1).max(10).default(5) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertCanManage(context.supabase as unknown as MinimalClient, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runCourierTrackingPoll } = await import("./couriers/polling.server");
    const { startWorkerRun, finishWorkerRun, classifyWorkerError } = await import(
      "./workers/run.server"
    );
    const admin = supabaseAdmin as unknown as MinimalClient;

    const runId = await startWorkerRun(admin, "courier_tracking", "manual");
    try {
      const summary = await runCourierTrackingPoll(
        supabaseAdmin as unknown as Parameters<typeof runCourierTrackingPoll>[0],
        {
          batchSize: data.batchSize,
          timeBudgetMs: 20_000,
          workerId: `operator:${context.userId.slice(0, 8)}`,
        },
      );
      await finishWorkerRun(admin, runId, "succeeded", {
        claimed: summary.claimed,
        processed: summary.polled + summary.failed,
        succeeded: summary.polled,
        failed: summary.failed,
        skipped: Math.max(0, summary.claimed - summary.polled - summary.failed),
      });
      return summary;
    } catch (error) {
      await finishWorkerRun(admin, runId, "failed", {}, classifyWorkerError(error));
      throw new Error("The courier tracking run failed. Please try again.");
    }
  });

/** Stuck-state sweep, triggered by an operator. Reuses the existing recovery RPCs. */
export const runOpsSweeperNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    await assertCanManage(context.supabase as unknown as MinimalClient, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { startWorkerRun, finishWorkerRun } = await import("./workers/run.server");
    const admin = supabaseAdmin as unknown as MinimalClient;

    const runId = await startWorkerRun(admin, "ops_sweeper", "manual");
    const call = async (fn: string, args?: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(fn, args);
      return { ok: !error, count: Number(data ?? 0) || 0 };
    };

    const staleSyncJobs = await call("reclaim_stale_sync_jobs");
    const retries = await call("sweep_courier_event_retries", { _limit: 20 });
    // Incident detection runs inside the existing sweep so there is no second
    // schedule and no second source of truth for operational health.
    const detection = await admin.rpc("detect_operational_alerts");
    const steps = [staleSyncJobs, retries, { ok: !detection.error, count: 0 }];
    const failed = steps.filter((s) => !s.ok).length;

    await finishWorkerRun(admin, runId, failed > 0 ? "failed" : "succeeded", {
      claimed: staleSyncJobs.count + retries.count,
      processed: staleSyncJobs.count + retries.count,
      succeeded: steps.filter((s) => s.ok).length,
      failed,
    });

    const summary = (detection.data ?? {}) as { detected?: number; resolved?: number };

    return {
      staleSyncJobsReclaimed: staleSyncJobs.count,
      courierEventsRetried: retries.count,
      alertsDetected: Number(summary.detected ?? 0),
      alertsResolved: Number(summary.resolved ?? 0),
      failedSteps: failed,
    };
  });

