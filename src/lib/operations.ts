import { supabase } from "@/integrations/supabase/client";
import { OPERATION_ATTENTION_CONFIG } from "./operations-config";
import { BLOCKED_STATES } from "./operations-config";
import type {
  OperationActivityEntry,
  OperationAssignmentEvent,
  OperationAssignmentSource,
  OperationAttention,
  OperationCategory,
  OperationSeverity,
} from "@/types/operations";
import { OPERATION_SEVERITY_RANK } from "@/types/operations";

/**
 * Operations data access.
 *
 * The attention feed is DERIVED, never stored: `operations_attention_feed`
 * reads the authoritative order, fulfillment, shipment, exception, return,
 * inventory, transfer, stocktake and purchase order records and applies the
 * deterministic rules with the centralised thresholds passed in from
 * `OPERATION_ATTENTION_CONFIG`. Counters and lists both consume this single
 * result set, so they can never disagree.
 */

export async function getAttentionFeed(): Promise<OperationAttention[]> {
  const { data, error } = await supabase.rpc("operations_attention_feed", {
    _verification_pending_hours: OPERATION_ATTENTION_CONFIG.verification_pending_hours,
    _picking_stale_hours: OPERATION_ATTENTION_CONFIG.picking_stale_hours,
    _shipment_stale_hours: OPERATION_ATTENTION_CONFIG.shipment_stale_hours,
    _transfer_stale_hours: OPERATION_ATTENTION_CONFIG.transfer_stale_hours,
    _stocktake_stale_hours: OPERATION_ATTENTION_CONFIG.stocktake_stale_hours,
    _purchase_order_overdue_days: OPERATION_ATTENTION_CONFIG.purchase_order_overdue_days,
    _low_stock_default: OPERATION_ATTENTION_CONFIG.low_stock_default,
    _limit: OPERATION_ATTENTION_CONFIG.feed_limit,
  });
  if (error) throw error;

  // Background job reliability is derived from the authoritative job rows by
  // `background_jobs_attention`, then merged into the single feed so counters
  // and lists stay consistent with the rest of the Command Center.
  const { data: jobItems, error: jobError } = await supabase.rpc("background_jobs_attention", {
    _stale_wait_hours: OPERATION_ATTENTION_CONFIG.job_waiting_hours,
    _retry_warning_attempts: OPERATION_ATTENTION_CONFIG.job_retry_warning_attempts,
    _backlog_warning: OPERATION_ATTENTION_CONFIG.job_backlog_warning,
    _limit: OPERATION_ATTENTION_CONFIG.feed_limit,
  });
  if (jobError) throw jobError;

  return [
    ...((data ?? []) as unknown as OperationAttention[]),
    ...((jobItems ?? []) as unknown as OperationAttention[]),
  ];
}

export async function getRecentOperationalActivity(
  limit = 12,
): Promise<OperationActivityEntry[]> {
  const { data, error } = await supabase.rpc("operations_recent_activity", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as unknown as OperationActivityEntry[];
}

/* ---------------- Derived helpers (single calculation source) ---------------- */

export function isOverdue(item: OperationAttention, now = Date.now()): boolean {
  return item.due_at !== null && new Date(item.due_at).getTime() < now;
}

export function isBlocked(item: OperationAttention): boolean {
  return item.severity === "critical" || BLOCKED_STATES.includes(item.state);
}

export interface AttentionCounters {
  total: number;
  critical: number;
  high: number;
  overdue: number;
  blocked: number;
  byCategory: Record<OperationCategory, number>;
}

export function computeCounters(items: OperationAttention[]): AttentionCounters {
  const byCategory = {
    verification: 0,
    fulfillment: 0,
    shipping: 0,
    delivery_exception: 0,
    return: 0,
    inventory: 0,
    procurement: 0,
    integration: 0,
  } as Record<OperationCategory, number>;

  let critical = 0;
  let high = 0;
  let overdue = 0;
  let blocked = 0;
  const now = Date.now();

  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    if (item.severity === "critical") critical += 1;
    if (item.severity === "high") high += 1;
    if (isOverdue(item, now)) overdue += 1;
    if (isBlocked(item)) blocked += 1;
  }

  return { total: items.length, critical, high, overdue, blocked, byCategory };
}

export type AttentionSort = "severity" | "created" | "due" | "category";

export interface AttentionFilters {
  search?: string;
  category?: OperationCategory | "all";
  severity?: OperationSeverity | "all";
  overdueOnly?: boolean;
  assignedTo?: string | null;
  sort?: AttentionSort;
}

export function filterAndSortAttention(
  items: OperationAttention[],
  filters: AttentionFilters,
): OperationAttention[] {
  const term = filters.search?.trim().toLowerCase();
  const now = Date.now();

  const filtered = items.filter((item) => {
    if (filters.category && filters.category !== "all" && item.category !== filters.category)
      return false;
    if (filters.severity && filters.severity !== "all" && item.severity !== filters.severity)
      return false;
    if (filters.overdueOnly && !isOverdue(item, now)) return false;
    if (filters.assignedTo && item.assigned_to !== filters.assignedTo) return false;
    if (term) {
      const hay = `${item.title} ${item.subtitle ?? ""} ${item.reason} ${item.state}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  const sort = filters.sort ?? "severity";
  return filtered.sort((a, b) => {
    if (sort === "created") return a.occurred_at.localeCompare(b.occurred_at);
    if (sort === "due") {
      if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return a.occurred_at.localeCompare(b.occurred_at);
    }
    if (sort === "category") {
      const c = a.category.localeCompare(b.category);
      if (c !== 0) return c;
    }
    const s = OPERATION_SEVERITY_RANK[a.severity] - OPERATION_SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    const aKey = a.due_at ?? a.occurred_at;
    const bKey = b.due_at ?? b.occurred_at;
    return aKey.localeCompare(bKey);
  });
}

/* ---------------- Age formatting ---------------- */

export function formatAge(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  return formatDuration(diff);
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatDue(item: OperationAttention, now = Date.now()): string | null {
  if (!item.due_at) return null;
  const diff = new Date(item.due_at).getTime() - now;
  return diff < 0 ? `Overdue by ${formatDuration(-diff)}` : `Due in ${formatDuration(diff)}`;
}

/* ---------------- Controlled assignment ---------------- */

export async function assignOperationalWork(input: {
  sourceType: OperationAssignmentSource;
  sourceId: string;
  assignedTo: string;
  note?: string | null;
}): Promise<void> {
  const args: {
    _source_type: OperationAssignmentSource;
    _source_id: string;
    _assigned_to: string;
    _note?: string;
  } = {
    _source_type: input.sourceType,
    _source_id: input.sourceId,
    _assigned_to: input.assignedTo,
  };
  const note = input.note?.trim();
  if (note) args._note = note;

  const { error } = await supabase.rpc("assign_operational_work", args);
  if (error) throw error;
}

export async function releaseOperationalWork(
  sourceType: OperationAssignmentSource,
  sourceId: string,
  note?: string | null,
): Promise<void> {
  const args: { _source_type: OperationAssignmentSource; _source_id: string; _note?: string } = {
    _source_type: sourceType,
    _source_id: sourceId,
  };
  const trimmed = note?.trim();
  if (trimmed) args._note = trimmed;

  const { error } = await supabase.rpc("release_operational_work", args);
  if (error) throw error;
}

export async function getAssignmentHistory(
  sourceType: OperationAssignmentSource,
  sourceId: string,
): Promise<OperationAssignmentEvent[]> {
  const { data, error } = await supabase
    .from("operational_assignment_events")
    .select("id, event_type, assigned_to, actor_id, note, created_at")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as OperationAssignmentEvent[];
}

export interface AssignableStaff {
  id: string;
  full_name: string | null;
  role: string;
}

export async function getAssignableStaff(): Promise<AssignableStaff[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .neq("role", "viewer")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AssignableStaff[];
}

/* ---------------- Suggested actions (never auto-executed) ---------------- */

export function suggestedAction(item: OperationAttention): { label: string; href: string } {
  switch (item.category) {
    case "verification":
      return { label: "Open verification queue", href: item.href };
    case "fulfillment":
      return { label: "Open warehouse workspace", href: item.href };
    case "shipping":
      return { label: "Review shipment / courier status", href: item.href };
    case "delivery_exception":
      return { label: "Review delivery exception", href: item.href };
    case "return":
      return { label: "Open return workspace", href: item.href };
    case "inventory":
      return { label: "Open inventory", href: item.href };
    case "procurement":
      return { label: "Review purchase order", href: item.href };
    default:
      return { label: "Open workspace", href: item.href };
  }
}
