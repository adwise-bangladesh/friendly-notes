/**
 * Background sync queue — server operations.
 *
 * Queue mutations and the operator-triggered worker run. Every write goes
 * through the controlled database functions; nothing here touches the job
 * table directly and no credential ever crosses this boundary.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkerRunSummary } from "./sales-channels/worker.server";

const QUEUEABLE = ["listing_update", "price_sync", "stock_sync", "status_refresh"] as const;

type MinimalClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function assertCanManage(client: MinimalClient, userId: string) {
  const { data } = await client.rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to synchronise sales channels");
}

/** Queue a background operation for an already published listing. */
export const queueListingSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ listingId: z.string().uuid(), operation: z.enum(QUEUEABLE) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ jobId: string }> => {
    const client = context.supabase as unknown as MinimalClient;
    await assertCanManage(client, context.userId);
    const { data: jobId, error } = await client.rpc("queue_listing_sync", {
      _listing_id: data.listingId,
      _operation: data.operation,
    });
    if (error) throw new Error(error.message);
    return { jobId: jobId as string };
  });

export const cancelSyncJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const client = context.supabase as unknown as MinimalClient;
    await assertCanManage(client, context.userId);
    const { error } = await client.rpc("cancel_sync_job", { _job_id: data.jobId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const requeueSyncJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ jobId: string }> => {
    const client = context.supabase as unknown as MinimalClient;
    await assertCanManage(client, context.userId);
    const { data: newId, error } = await client.rpc("requeue_sync_job", { _job_id: data.jobId });
    if (error) throw new Error(error.message);
    return { jobId: newId as string };
  });

/** Recover a job whose worker lease has genuinely expired. Staff/admin only. */
export const recoverStaleSyncJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    const client = context.supabase as unknown as MinimalClient;
    await assertCanManage(client, context.userId);
    const { data: result, error } = await client.rpc("recover_stale_sync_job", {
      _job_id: data.jobId,
    });
    if (error) throw new Error(error.message);
    return { status: (result as { status?: string })?.status ?? "unknown" };
  });

/**
 * Operator-triggered worker run. Same bounded worker the scheduled endpoint
 * uses, executed as the signed-in user so RLS and permissions still apply.
 */
export const processSyncQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ batchSize: z.number().int().min(1).max(10).default(5) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<WorkerRunSummary> => {
    const client = context.supabase as unknown as MinimalClient;
    await assertCanManage(client, context.userId);
    const { runSyncWorker } = await import("./sales-channels/worker.server");
    return runSyncWorker(client, {
      batchSize: data.batchSize,
      timeBudgetMs: 20_000,
      workerId: `operator:${context.userId.slice(0, 8)}`,
    });
  });
