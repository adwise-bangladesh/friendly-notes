/**
 * Scheduled courier tracking synchronisation.
 *
 *   scheduler → /api/public/courier-tracking-worker → this worker
 *     → claim_courier_tracking_polls (lease, bounded batch)
 *     → adapter.getStatus  (only where the provider declares `status`)
 *     → ingest_courier_event  (the one authoritative event pipeline)
 *     → record_courier_tracking_poll (reschedule with backoff)
 *     → sweep_courier_event_retries (bounded retry of unmatched events)
 *
 * There is no second event pipeline and no self invocation: every run is
 * bounded by a batch size, a hard cap and a wall clock budget.
 */

import { CourierError } from "@/types/couriers";

interface RpcClient {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface CourierPollOptions {
  batchSize?: number;
  leaseSeconds?: number;
  timeBudgetMs?: number;
  workerId?: string;
  retrySweep?: number;
  /** Stitches this run's diagnostics and courier API logs together. */
  correlationId?: string;
  workerRunId?: string;
}

export interface CourierPollSummary {
  claimed: number;
  polled: number;
  applied: number;
  failed: number;
  retriedEvents: number;
}

interface Candidate {
  shipment_id: string;
  provider_code: string;
  account_id: string | null;
  consignment_id: string | null;
  shipment_number: string | null;
  lease_token: string;
}

export async function runCourierTrackingPoll(
  client: RpcClient,
  options: CourierPollOptions = {},
): Promise<CourierPollSummary> {
  const batchSize = Math.min(Math.max(options.batchSize ?? 10, 1), 25);
  const leaseSeconds = Math.min(Math.max(options.leaseSeconds ?? 120, 30), 600);
  const timeBudgetMs = Math.min(Math.max(options.timeBudgetMs ?? 25_000, 5_000), 55_000);
  const startedAt = Date.now();

  const summary: CourierPollSummary = {
    claimed: 0,
    polled: 0,
    applied: 0,
    failed: 0,
    retriedEvents: 0,
  };

  const { getCourierAdapter, courierCapability, logCourierCall } = await import("./registry.server");
  const { recordFailure } = await import("@/lib/observability/diagnostics.server");
  const correlationId = options.correlationId ?? null;
  const workerRunId = options.workerRunId ?? null;

  const claim = await client.rpc("claim_courier_tracking_polls", {
    _limit: batchSize,
    _lease_seconds: leaseSeconds,
    _worker: options.workerId ?? "scheduled",
  });
  if (claim.error) throw new Error(claim.error.message);
  const candidates = (claim.data ?? []) as Candidate[];
  summary.claimed = candidates.length;

  for (const candidate of candidates) {
    // leave unstarted work claimed: the lease expires and a later run retries
    if (Date.now() - startedAt > timeBudgetMs) break;

    const code = candidate.provider_code;
    const adapter = getCourierAdapter(code);
    const trackable =
      Boolean(adapter) &&
      courierCapability(code, "status") &&
      Boolean(candidate.account_id) &&
      Boolean(candidate.consignment_id);

    if (!trackable) {
      // not an error — this courier is handled manually or by webhook only
      await client.rpc("record_courier_tracking_poll", {
        _shipment_id: candidate.shipment_id,
        _lease_token: candidate.lease_token,
        _ok: false,
        _error: "This courier cannot be tracked through the API",
      });
      continue;
    }

    const callStartedAt = Date.now();
    try {
      const status = await adapter!.getStatus(candidate.account_id!, candidate.consignment_id!);
      summary.polled += 1;

      const ingest = await client.rpc("ingest_courier_event", {
        _provider_code: code,
        _provider_event: status.providerStatusSlug ?? status.providerStatus,
        _consignment_id: status.consignmentId,
        ...(status.merchantOrderId ? { _merchant_order_id: status.merchantOrderId } : {}),
        ...(status.updatedAt ? { _provider_event_at: status.updatedAt } : {}),
        _source: "polling",
      });
      if (ingest.error) throw new Error(ingest.error.message);
      if ((ingest.data as { processing_status?: string } | null)?.processing_status === "applied") {
        summary.applied += 1;
      }

      await client.rpc("record_courier_tracking_poll", {
        _shipment_id: candidate.shipment_id,
        _lease_token: candidate.lease_token,
        _ok: true,
      });
      await logCourierCall({
        shipmentId: candidate.shipment_id,
        ...(candidate.account_id ? { accountId: candidate.account_id } : {}),
        operation: "poll_status",
        succeeded: true,
        durationMs: Date.now() - callStartedAt,
        ...(correlationId ? { correlationId } : {}),
      });
    } catch (error) {
      summary.failed += 1;
      const message =
        error instanceof CourierError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Courier tracking failed";
      await client.rpc("record_courier_tracking_poll", {
        _shipment_id: candidate.shipment_id,
        _lease_token: candidate.lease_token,
        _ok: false,
        _error: message,
      });
      await logCourierCall({
        shipmentId: candidate.shipment_id,
        ...(candidate.account_id ? { accountId: candidate.account_id } : {}),
        operation: "poll_status",
        succeeded: false,
        safeMessage: message,
        durationMs: Date.now() - callStartedAt,
        failureStage: "external_request",
        ...(correlationId ? { correlationId } : {}),
      });
      await recordFailure(client, error, {
        subsystem: "courier",
        operation: "poll_status",
        stage: "external_request",
        providerCode: code,
        accountId: candidate.account_id,
        entityType: "shipment",
        entityId: candidate.shipment_id,
        correlationId,
        workerRunId,
        durationMs: Date.now() - callStartedAt,
        metadata: { shipment_number: candidate.shipment_number ?? "" },
      });
    }
  }

  // bounded automatic retry of events that could not be matched yet
  const sweep = await client.rpc("sweep_courier_event_retries", {
    _limit: Math.min(Math.max(options.retrySweep ?? 20, 1), 50),
  });
  if (!sweep.error) summary.retriedEvents = Number(sweep.data ?? 0);

  return summary;
}
