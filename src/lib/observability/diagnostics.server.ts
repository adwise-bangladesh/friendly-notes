/**
 * Structured operational diagnostics — SERVER ONLY.
 *
 * This is the single place where a backend failure is turned into a safe,
 * queryable diagnostic row. It does not replace any authoritative history:
 *
 *   domain events  → what happened to the business record (append-only)
 *   worker_runs    → did a worker execute, how long, with which counters
 *   courier_api_logs → one external provider call, safely summarised
 *   operational_diagnostics → why an operation failed, with correlation
 *   operational_alerts → the deduplicated incident an operator must act on
 *
 * Rules:
 * - never store secrets, tokens, headers, credentials or raw provider bodies
 * - never let telemetry break the operation it describes (best effort only)
 * - messages are operator-readable; the category is machine-readable
 */

export type DiagnosticSubsystem =
  | "orders"
  | "verification"
  | "fulfillment"
  | "shipping"
  | "courier"
  | "webhook"
  | "settlement"
  | "sync"
  | "worker"
  | "automation"
  | "integration"
  | "ai"
  | "inventory"
  | "other";

export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";

export type ErrorCategory =
  | "validation"
  | "authorization"
  | "not_found"
  | "conflict"
  | "state_conflict"
  | "external_timeout"
  | "external_unavailable"
  | "external_rejected"
  | "mapping_missing"
  | "rate_limited"
  | "lease_conflict"
  | "retry_exhausted"
  | "unknown_outcome"
  | "internal";

export type FailureStage =
  | "validation"
  | "authorization"
  | "claim"
  | "database"
  | "external_request"
  | "external_response"
  | "mapping"
  | "transition"
  | "projection"
  | "retry"
  | "recovery";

interface RpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface DiagnosticInput {
  subsystem: DiagnosticSubsystem;
  operation: string;
  message: string;
  severity?: DiagnosticSeverity;
  category?: ErrorCategory;
  stage?: FailureStage;
  retryable?: boolean;
  correlationId?: string | null;
  workerRunId?: string | null;
  providerCode?: string | null;
  accountId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  durationMs?: number | null;
  /** Small, non-sensitive counters or identifiers only. */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Never store anything that resembles a credential. */
const SECRET_KEY = /(secret|token|password|key|authorization|signature|cookie)/i;

function safeMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 200);
    else out[key] = value;
  }
  return out;
}

/**
 * Map an unknown failure to a stable category and a readable message.
 * Unrecognised failures stay honestly `internal` — they are never guessed into
 * a friendlier category.
 */
export function classifyError(error: unknown): {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
} {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const text = raw.toLowerCase();

  const match = (category: ErrorCategory, retryable = false) => ({
    category,
    message: raw.slice(0, 500),
    retryable,
  });

  if (text.includes("timeout") || text.includes("timed out") || text.includes("etimedout")) {
    return match("external_timeout", true);
  }
  if (text.includes("rate limit") || text.includes("429") || text.includes("too many requests")) {
    return match("rate_limited", true);
  }
  if (
    text.includes("fetch failed") ||
    text.includes("econnrefused") ||
    text.includes("network") ||
    text.includes("503") ||
    text.includes("502")
  ) {
    return match("external_unavailable", true);
  }
  if (text.includes("not authorised") || text.includes("not authorized") || text.includes("permission") || text.includes("forbidden") || text.includes("401") || text.includes("403")) {
    return match("authorization");
  }
  if (text.includes("not found") || text.includes("does not exist") || text.includes("404")) {
    return match("not_found");
  }
  if (text.includes("lease") || text.includes("locked") || text.includes("already in progress")) {
    return match("lease_conflict", true);
  }
  if (text.includes("duplicate") || text.includes("conflict") || text.includes("unique")) {
    return match("conflict");
  }
  if (text.includes("cannot") || text.includes("invalid transition") || text.includes("current status")) {
    return match("state_conflict");
  }
  if (text.includes("unknown outcome") || text.includes("outcome unknown")) {
    return match("unknown_outcome");
  }
  if (text.includes("no mapping") || text.includes("unmapped") || text.includes("unknown status")) {
    return match("mapping_missing");
  }
  if (text.includes("invalid") || text.includes("required") || text.includes("must be")) {
    return match("validation");
  }
  return match("internal");
}

/**
 * Record one diagnostic. Best effort: a telemetry failure is swallowed so the
 * caller's own error handling stays authoritative.
 */
export async function recordDiagnostic(
  client: RpcClient,
  input: DiagnosticInput,
): Promise<string | null> {
  try {
    const { data, error } = await client.rpc("record_operational_diagnostic", {
      _subsystem: input.subsystem,
      _operation: input.operation,
      _message: input.message.slice(0, 500),
      _severity: input.severity ?? "error",
      _error_category: input.category ?? "internal",
      ...(input.stage ? { _failure_stage: input.stage } : {}),
      _retryable: input.retryable ?? false,
      ...(input.correlationId ? { _correlation_id: input.correlationId } : {}),
      ...(input.workerRunId ? { _worker_run_id: input.workerRunId } : {}),
      ...(input.providerCode ? { _provider_code: input.providerCode } : {}),
      ...(input.accountId ? { _account_id: input.accountId } : {}),
      ...(input.entityType ? { _entity_type: input.entityType } : {}),
      ...(input.entityId ? { _entity_id: input.entityId } : {}),
      ...(typeof input.durationMs === "number"
        ? { _duration_ms: Math.max(0, Math.round(input.durationMs)) }
        : {}),
      _metadata: safeMetadata(input.metadata),
    });
    if (error) return null;
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

/** Convenience: classify then record a caught failure. */
export async function recordFailure(
  client: RpcClient,
  error: unknown,
  context: Omit<DiagnosticInput, "message" | "category" | "retryable"> &
    Partial<Pick<DiagnosticInput, "category" | "retryable">>,
): Promise<string | null> {
  const classified = classifyError(error);
  return recordDiagnostic(client, {
    ...context,
    message: classified.message,
    category: context.category ?? classified.category,
    retryable: context.retryable ?? classified.retryable,
  });
}
