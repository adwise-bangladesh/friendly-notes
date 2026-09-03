/**
 * Operational diagnostics — read-only client access.
 *
 * All three functions are authorised in the database with `can_read_commerce`
 * and return safe projections only: no credentials, no vault references, no
 * raw provider payloads.
 */

import { supabase } from "@/integrations/supabase/client";

export interface DiagnosticRow {
  id: string;
  occurred_at: string;
  severity: "info" | "warning" | "error" | "critical";
  subsystem: string;
  operation: string;
  error_category: string;
  failure_stage: string | null;
  message: string;
  retryable: boolean;
  correlation_id: string | null;
  worker_run_id: string | null;
  provider_code: string | null;
  account_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
}

export interface DiagnosticsPage {
  generated_at: string;
  total: number;
  limit: number;
  offset: number;
  rows: DiagnosticRow[];
}

export interface DiagnosticTrail {
  correlation_id: string;
  generated_at: string;
  diagnostics: DiagnosticRow[];
  worker_runs: Array<{
    id: string;
    worker: string;
    trigger_source: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    claimed: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    error_class: string | null;
    correlation_id?: string | null;
  }>;
  courier_api_calls: Array<{
    id: string;
    provider_id: string | null;
    account_id: string | null;
    shipment_id: string | null;
    operation: string;
    succeeded: boolean;
    status_code: number | null;
    error_category: string | null;
    safe_message: string | null;
    retryable: boolean;
    duration_ms: number | null;
    failure_stage: string | null;
    created_at: string;
  }>;
}

export interface AlertEvidence {
  alert: Record<string, unknown>;
  generated_at: string;
  worker_runs: DiagnosticTrail["worker_runs"];
  diagnostics: DiagnosticRow[];
  courier_api_calls: DiagnosticTrail["courier_api_calls"];
}

export const SUBSYSTEM_LABELS: Record<string, string> = {
  orders: "Orders",
  verification: "Verification",
  fulfillment: "Fulfillment",
  shipping: "Shipping",
  courier: "Courier",
  webhook: "Webhooks",
  settlement: "Settlements",
  sync: "Channel sync",
  worker: "Background workers",
  automation: "Automation",
  integration: "Integrations",
  ai: "AI brain",
  inventory: "Inventory",
  other: "Other",
};

export const ERROR_CATEGORY_LABELS: Record<string, string> = {
  validation: "Invalid input",
  authorization: "Not permitted",
  not_found: "Record not found",
  conflict: "Conflict",
  state_conflict: "Wrong state",
  external_timeout: "Provider timeout",
  external_unavailable: "Provider unreachable",
  external_rejected: "Provider rejected",
  mapping_missing: "Unmapped status",
  rate_limited: "Rate limited",
  lease_conflict: "Locked by another run",
  retry_exhausted: "Retries exhausted",
  unknown_outcome: "Outcome unknown",
  internal: "Internal error",
};

export const FAILURE_STAGE_LABELS: Record<string, string> = {
  validation: "Validation",
  authorization: "Authorisation",
  claim: "Claiming work",
  database: "Database",
  external_request: "Calling provider",
  external_response: "Provider response",
  mapping: "Status mapping",
  transition: "State transition",
  projection: "Projection refresh",
  retry: "Retry",
  recovery: "Recovery",
};

export interface DiagnosticFilters {
  limit?: number;
  offset?: number;
  severity?: string | null;
  subsystem?: string | null;
  errorCategory?: string | null;
  correlationId?: string | null;
  sinceHours?: number;
}

export async function listDiagnostics(filters: DiagnosticFilters = {}): Promise<DiagnosticsPage> {
  const { data, error } = await supabase.rpc("list_operational_diagnostics", {
    _limit: filters.limit ?? 25,
    _offset: filters.offset ?? 0,
    _since_hours: filters.sinceHours ?? 168,
    ...(filters.severity ? { _severity: filters.severity } : {}),
    ...(filters.subsystem ? { _subsystem: filters.subsystem } : {}),
    ...(filters.errorCategory ? { _error_category: filters.errorCategory } : {}),
    ...(filters.correlationId ? { _correlation_id: filters.correlationId } : {}),
  });
  if (error) throw new Error(error.message);
  return data as unknown as DiagnosticsPage;
}

export async function getDiagnosticTrail(correlationId: string): Promise<DiagnosticTrail> {
  const { data, error } = await supabase.rpc("operational_diagnostic_trail", {
    _correlation_id: correlationId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as DiagnosticTrail;
}

export async function getAlertEvidence(alertId: string): Promise<AlertEvidence> {
  const { data, error } = await supabase.rpc("operational_alert_evidence", {
    _alert_id: alertId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as AlertEvidence;
}
