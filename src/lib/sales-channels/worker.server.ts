/**
 * Background sync worker — SERVER ONLY.
 *
 * Bounded by design: a run claims at most `batchSize` jobs, processes them
 * sequentially inside a wall-clock budget and returns. There is no self
 * invocation and no unbounded loop; a scheduler (or an operator pressing
 * "Process queue now") decides how often a run happens.
 *
 * Every job is claimed with a lease, so two concurrent runs never process the
 * same job, and a result from an expired lease is rejected by the database.
 */

import { executeListingOperation } from "./execution.server";
import type { RpcClient } from "./execution.server";
import type { ListingOperation } from "./capabilities";

export interface WorkerOptions {
  batchSize?: number;
  leaseSeconds?: number;
  timeBudgetMs?: number;
  /** Identifies this run in the append-only attempt history. */
  workerId?: string;
}

export interface WorkerJobOutcome {
  jobId: string;
  listingId: string;
  operation: string;
  ok: boolean;
  message: string;
  status: string;
}

export interface WorkerRunSummary {
  claimed: number;
  processed: number;
  succeeded: number;
  failed: number;
  outcomes: WorkerJobOutcome[];
}

interface ClaimedJob {
  job_id: string;
  listing_id: string;
  account_id: string;
  store_id: string;
  operation: string;
  attempts: number;
  max_attempts: number;
  lease_token: string;
}

const DEFAULT_BATCH = 5;
const MAX_BATCH = 25;
const DEFAULT_BUDGET_MS = 20_000;

export async function runSyncWorker(
  client: RpcClient,
  options: WorkerOptions = {},
): Promise<WorkerRunSummary> {
  const batchSize = Math.min(Math.max(options.batchSize ?? DEFAULT_BATCH, 1), MAX_BATCH);
  const leaseSeconds = Math.min(Math.max(options.leaseSeconds ?? 120, 30), 600);
  const budgetMs = Math.min(Math.max(options.timeBudgetMs ?? DEFAULT_BUDGET_MS, 2_000), 45_000);
  const startedAt = Date.now();

  const workerId = (options.workerId ?? "worker").slice(0, 60);
  const { data, error } = await client.rpc("claim_sync_jobs", {
    _limit: batchSize,
    _lease_seconds: leaseSeconds,
    _worker_id: workerId,
  });
  if (error) throw new Error(error.message);
  const jobs = (Array.isArray(data) ? data : []) as ClaimedJob[];

  const summary: WorkerRunSummary = {
    claimed: jobs.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    outcomes: [],
  };

  for (const job of jobs) {
    // Time budget: leave unstarted jobs claimed — their lease expires and the
    // next run reclaims them rather than running past the request deadline.
    if (Date.now() - startedAt > budgetMs) break;

    let ok = false;
    let message = "The operation failed";
    let failureClass: string = "unknown";
    let runId: string | null = null;
    let retryAfter: string | null = null;
    try {
      const result = await executeListingOperation(
        client,
        job.listing_id,
        job.operation as ListingOperation,
      );
      ok = result.ok;
      message = result.message;
      failureClass = result.failureClass ?? "unknown";
      runId = result.runId;
      retryAfter = result.retryAfter;
    } catch (caught) {
      message = caught instanceof Error ? caught.message.slice(0, 300) : "The operation failed";
      failureClass = "transient";
    }

    const { data: completion, error: completeError } = await client.rpc("complete_sync_job", {
      _job_id: job.job_id,
      _lease_token: job.lease_token,
      _ok: ok,
      _message: message,
      _failure_class: failureClass,
      _run_id: runId,
      _retry_after: retryAfter,
    });
    if (completeError) throw new Error(completeError.message);
    const status = (completion as { status?: string } | null)?.status ?? "unknown";

    summary.processed += 1;
    if (ok) summary.succeeded += 1;
    else summary.failed += 1;
    summary.outcomes.push({
      jobId: job.job_id,
      listingId: job.listing_id,
      operation: job.operation,
      ok,
      message,
      status,
    });
  }

  return summary;
}
