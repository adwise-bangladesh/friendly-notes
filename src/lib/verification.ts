import { supabase } from "@/integrations/supabase/client";
import type { Order, OrderSource } from "@/types/orders";
import type {
  RiskLevel,
  VerificationAttempt,
  VerificationAttemptOutcome,
  VerificationEvent,
  VerificationMethod,
  VerificationPriority,
  VerificationStatus,
} from "@/types/verification";
import { VERIFICATION_QUEUE_STATUSES } from "@/types/verification";

/**
 * Verification data access.
 *
 * Reads are plain selects with explicit projections (no internal cost columns).
 * Every state change goes through a SECURITY DEFINER database function that
 * validates the transition and writes the order, the attempt, the event and the
 * order system note inside one transaction. The client can never write
 * verification columns directly — a database trigger rejects it.
 */

const QUEUE_SELECT = `
  id, order_number, source, customer_name, customer_phone,
  status, grand_total, created_at,
  verification_status, verification_priority, risk_level, risk_reason,
  verification_attempt_count, verification_last_attempt_at, verification_next_action_at
`;

export interface VerificationQueueRow {
  id: string;
  order_number: string;
  source: OrderSource;
  customer_name: string;
  customer_phone: string;
  status: string;
  grand_total: number;
  created_at: string;
  verification_status: VerificationStatus;
  verification_priority: VerificationPriority;
  risk_level: RiskLevel;
  risk_reason: string | null;
  verification_attempt_count: number;
  verification_last_attempt_at: string | null;
  verification_next_action_at: string | null;
  last_method?: VerificationMethod | null;
}

export interface VerificationQueueFilters {
  search?: string;
  status?: VerificationStatus | "all";
  method?: VerificationMethod | "all";
  source?: OrderSource | "all";
  from?: string;
  to?: string;
  limit?: number;
}

const PRIORITY_RANK: Record<VerificationPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export async function getVerificationQueue(
  filters: VerificationQueueFilters = {},
): Promise<VerificationQueueRow[]> {
  let query = supabase
    .from("orders")
    .select(QUEUE_SELECT)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.status && filters.status !== "all") {
    query = query.eq("verification_status", filters.status);
  } else {
    query = query.in("verification_status", VERIFICATION_QUEUE_STATUSES);
  }
  if (filters.source && filters.source !== "all") query = query.eq("source", filters.source);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const term = filters.search?.trim();
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      `order_number.ilike.${like},customer_name.ilike.${like},customer_phone.ilike.${like}`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as VerificationQueueRow[];
  if (rows.length === 0) return rows;

  // Last method used per order (needed for the method filter and the queue column).
  const { data: attempts, error: attemptError } = await supabase
    .from("order_verification_attempts")
    .select("order_id, method, attempt_number")
    .in(
      "order_id",
      rows.map((r) => r.id),
    )
    .order("attempt_number", { ascending: false });
  if (attemptError) throw attemptError;

  const lastMethod = new Map<string, VerificationMethod>();
  for (const a of attempts ?? []) {
    if (!lastMethod.has(a.order_id)) lastMethod.set(a.order_id, a.method);
  }
  let result = rows.map((r) => ({ ...r, last_method: lastMethod.get(r.id) ?? null }));

  if (filters.method && filters.method !== "all") {
    result = result.filter((r) => r.last_method === filters.method);
  }

  return result.sort((a, b) => {
    const p = PRIORITY_RANK[a.verification_priority] - PRIORITY_RANK[b.verification_priority];
    if (p !== 0) return p;
    const an = a.verification_next_action_at;
    const bn = b.verification_next_action_at;
    if (an && bn) return an.localeCompare(bn);
    if (an) return -1;
    if (bn) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

/* ---------- Per-order history ---------- */

export interface VerificationHistory {
  attempts: VerificationAttempt[];
  events: (VerificationEvent & { author: { id: string; full_name: string | null } | null })[];
}

const ATTEMPT_SELECT = `
  id, order_id, attempt_number, method, provider, status, outcome, notes,
  failure_reason, scheduled_at, started_at, completed_at, duration_seconds,
  external_call_id, transcript_reference, recording_reference, ai_result,
  initiated_by, created_at
`;

export async function getVerificationHistory(orderId: string): Promise<VerificationHistory> {
  const [attemptsRes, eventsRes] = await Promise.all([
    supabase
      .from("order_verification_attempts")
      .select(ATTEMPT_SELECT)
      .eq("order_id", orderId)
      .order("attempt_number", { ascending: true }),
    supabase
      .from("order_verification_events")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
  ]);
  if (attemptsRes.error) throw attemptsRes.error;
  if (eventsRes.error) throw eventsRes.error;

  const events = eventsRes.data ?? [];
  const authorIds = [...new Set(events.map((e) => e.created_by).filter(Boolean))] as string[];
  const authors = new Map<string, { id: string; full_name: string | null }>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const p of profiles ?? []) authors.set(p.id, p);
  }

  return {
    attempts: (attemptsRes.data ?? []) as VerificationAttempt[],
    events: events.map((e) => ({
      ...e,
      author: e.created_by ? (authors.get(e.created_by) ?? null) : null,
    })),
  };
}

/* ---------- Controlled workflow operations ---------- */

export interface RecordAttemptInput {
  orderId: string;
  method: VerificationMethod;
  outcome: VerificationAttemptOutcome;
  notes?: string | undefined;
  durationSeconds?: number | null | undefined;
  scheduledAt?: string | null | undefined;
  riskReason?: string | null | undefined;
  failureReason?: string | null | undefined;
  provider?: string | null | undefined;
}

export async function recordVerificationAttempt(input: RecordAttemptInput): Promise<Order> {
  const { data, error } = await supabase.rpc("record_verification_attempt", {
    _order_id: input.orderId,
    _method: input.method,
    _outcome: input.outcome,
    ...(input.notes ? { _notes: input.notes } : {}),
    ...(typeof input.durationSeconds === "number"
      ? { _duration_seconds: input.durationSeconds }
      : {}),
    ...(input.scheduledAt ? { _scheduled_at: input.scheduledAt } : {}),
    ...(input.riskReason ? { _risk_reason: input.riskReason } : {}),
    ...(input.failureReason ? { _failure_reason: input.failureReason } : {}),
    ...(input.provider ? { _provider: input.provider } : {}),
  });
  if (error) throw error;
  return data as unknown as Order;
}

export async function startVerification(
  orderId: string,
  method: VerificationMethod = "manual_call",
): Promise<Order> {
  const { data, error } = await supabase.rpc("start_order_verification", {
    _order_id: orderId,
    _method: method,
  });
  if (error) throw error;
  return data as unknown as Order;
}

export type VerificationStateAction =
  | "confirm"
  | "manual_review"
  | "schedule_callback"
  | "unreachable"
  | "fail"
  | "reopen";

export async function setVerificationState(args: {
  orderId: string;
  action: VerificationStateAction;
  reason?: string | null;
  scheduledAt?: string | null;
  riskLevel?: RiskLevel | null;
}): Promise<Order> {
  const { data, error } = await supabase.rpc("set_order_verification_state", {
    _order_id: args.orderId,
    _action: args.action,
    ...(args.reason ? { _reason: args.reason } : {}),
    ...(args.scheduledAt ? { _scheduled_at: args.scheduledAt } : {}),
    ...(args.riskLevel ? { _risk_level: args.riskLevel } : {}),
  });
  if (error) throw error;
  return data as unknown as Order;
}

export async function setVerificationPriority(
  orderId: string,
  priority: VerificationPriority,
): Promise<Order> {
  const { data, error } = await supabase.rpc("set_order_verification_priority", {
    _order_id: orderId,
    _priority: priority,
  });
  if (error) throw error;
  return data as unknown as Order;
}

/* ---------- Provider boundary (no real integration yet) ---------- */

export interface NormalisedVerificationResult {
  outcome: VerificationAttemptOutcome;
  notes?: string;
  durationSeconds?: number;
  scheduledAt?: string;
  externalCallId?: string;
  transcriptReference?: string;
}

/**
 * The seam a future AI voice / SMS / WhatsApp provider plugs into.
 * A provider places the contact and reports back a raw payload; the
 * implementation normalises it, and the verification engine (the database
 * functions above) remains the only thing that decides the resulting state.
 */
export interface VerificationProvider {
  readonly id: string;
  readonly method: VerificationMethod;
  startVerification(order: { id: string; customerPhone: string }): Promise<{ externalCallId: string }>;
  normalizeResult(raw: unknown): NormalisedVerificationResult;
}

/** Registry — intentionally empty until a real provider is integrated. */
export const verificationProviders: Record<string, VerificationProvider> = {};

/* ---------- Claiming verification work (Step 20.8.1) ---------- */

export interface VerificationAssignment {
  id: string;
  source_id: string;
  assigned_to: string;
  assigned_at: string;
  assignee: { id: string; full_name: string | null } | null;
}

/**
 * Takes ownership of an order's verification. The database serialises
 * competing claims on the order row, so exactly one operator wins; the other
 * gets a message naming the current owner.
 */
export async function claimVerificationWork(orderId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc("claim_verification_work", {
    _order_id: orderId,
    ...(note?.trim() ? { _note: note.trim() } : {}),
  });
  if (error) throw error;
}

export async function releaseVerificationWork(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("release_operational_work", {
    _source_type: "order_verification",
    _source_id: orderId,
  });
  if (error) throw error;
}

/** Current verification owner per order, for the queue and the order page. */
export async function getVerificationAssignments(
  orderIds: string[],
): Promise<Map<string, VerificationAssignment>> {
  const result = new Map<string, VerificationAssignment>();
  if (orderIds.length === 0) return result;

  const { data, error } = await supabase
    .from("operational_assignments")
    .select("id, source_id, assigned_to, assigned_at")
    .eq("source_type", "order_verification")
    .is("released_at", null)
    .in("source_id", orderIds);
  if (error) throw error;

  const rows = data ?? [];
  const assigneeIds = [...new Set(rows.map((r) => r.assigned_to))];
  const profiles = new Map<string, { id: string; full_name: string | null }>();
  if (assigneeIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", assigneeIds);
    for (const p of people ?? []) profiles.set(p.id, p);
  }

  for (const r of rows) {
    result.set(r.source_id, { ...r, assignee: profiles.get(r.assigned_to) ?? null });
  }
  return result;
}
