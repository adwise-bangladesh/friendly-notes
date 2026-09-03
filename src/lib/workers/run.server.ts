/**
 * Worker run heartbeat.
 *
 * A thin wrapper over the authoritative `start_worker_run` / `finish_worker_run`
 * functions. This is telemetry only: it records that a worker ran, for how long
 * and with which counters. It never carries payloads, credentials, customer
 * data or error messages — only a short, safe error class.
 *
 * Recording must never break a worker run, so every call is best effort.
 */

import type { WorkerName } from "./auth.server";

interface RpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface WorkerCounters {
  claimed?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
}

export async function startWorkerRun(
  client: RpcClient,
  worker: WorkerName,
  triggerSource: "scheduled" | "manual",
): Promise<string | null> {
  try {
    const { data, error } = await client.rpc("start_worker_run", {
      _worker: worker,
      _trigger_source: triggerSource,
    });
    if (error) return null;
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

export async function finishWorkerRun(
  client: RpcClient,
  runId: string | null,
  status: "succeeded" | "failed",
  counters: WorkerCounters = {},
  errorClass?: string,
): Promise<void> {
  if (!runId) return;
  try {
    await client.rpc("finish_worker_run", {
      _run_id: runId,
      _status: status,
      _claimed: counters.claimed ?? 0,
      _processed: counters.processed ?? 0,
      _succeeded: counters.succeeded ?? 0,
      _failed: counters.failed ?? 0,
      _skipped: counters.skipped ?? 0,
      ...(errorClass ? { _error_class: errorClass.slice(0, 120) } : {}),
    });
  } catch {
    // telemetry must never mask or fail the actual worker outcome
  }
}

/** Coarse, non-sensitive classification of a worker failure. */
export function classifyWorkerError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || "Error";
    return name.slice(0, 120);
  }
  return "UnknownError";
}
