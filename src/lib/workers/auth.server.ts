/**
 * Background worker endpoint authentication.
 *
 *   scheduler → worker endpoint → verifyWorkerRequest() → bounded worker run
 *
 * Rules (Step 20.9.1):
 * - Every worker has its OWN secret. A worker never falls back to another
 *   worker's secret, so one leaked value cannot authorise a second endpoint.
 * - The authoritative secret lives encrypted in the vault, one row per worker
 *   (`worker_secret_<worker>`), generated inside the database. It is verified
 *   through `worker_secret_matches`, which returns a boolean and never returns
 *   the stored value. The same vault row is what the scheduler reads, so there
 *   is a single source of truth.
 * - An optional per-worker environment variable is accepted as well, for local
 *   development and for operators who prefer env-injected secrets. It is
 *   strictly per worker; there is no shared or cross-worker variable.
 * - Missing/unprovisioned secret → fail closed (401), never open.
 * - Nothing here is ever logged, echoed or returned to a caller.
 */

export type WorkerName = "courier_tracking" | "sync_queue" | "ops_sweeper";

/** Per-worker configuration. Deliberately explicit — no shared defaults. */
const WORKER_CONFIG: Record<WorkerName, { envVar: string; headers: string[] }> = {
  courier_tracking: {
    envVar: "COURIER_POLL_SECRET",
    headers: ["x-worker-secret", "x-courier-poll-secret"],
  },
  sync_queue: {
    envVar: "SYNC_WORKER_SECRET",
    headers: ["x-worker-secret", "x-sync-worker-secret"],
  },
  ops_sweeper: {
    envVar: "OPS_SWEEPER_SECRET",
    headers: ["x-worker-secret", "x-ops-sweeper-secret"],
  },
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function presentedSecret(request: Request, worker: WorkerName): string {
  for (const header of WORKER_CONFIG[worker].headers) {
    const value = request.headers.get(header);
    if (value) return value;
  }
  return "";
}

interface RpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Verify a worker invocation. Returns `true` only for the correct dedicated
 * secret of that specific worker.
 */
export async function verifyWorkerRequest(
  request: Request,
  worker: WorkerName,
  client: RpcClient,
): Promise<boolean> {
  const presented = presentedSecret(request, worker);
  if (!presented || presented.length < 16) return false;

  const envSecret = process.env[WORKER_CONFIG[worker].envVar] ?? "";
  if (envSecret && envSecret.length >= 16 && constantTimeEqual(presented, envSecret)) {
    return true;
  }

  const { data, error } = await client.rpc("worker_secret_matches", {
    _worker: worker,
    _presented: presented,
  });
  if (error) return false;
  return data === true;
}

/** Uniform denial. No detail is leaked about which check failed. */
export function workerUnauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}
