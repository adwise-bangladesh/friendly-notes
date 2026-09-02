import { supabase } from "@/integrations/supabase/client";
import type {
  Customer,
  CustomerFinancialSummary,
  CustomerListResult,
  CustomerListRow,
  CustomerManualFlag,
  CustomerManualFlagType,
  CustomerNote,
  CustomerOperationalMetrics,
  CustomerStatus,
  CustomerTimelineEvent,
} from "@/types/customers";

/**
 * Customer data access.
 *
 * Customers are an identity record only: orders, verification, shipments,
 * returns and financials stay in their own tables and remain the single source
 * of truth. Everything derived (counts, rates, timeline) is calculated by the
 * database from those tables, never stored as a duplicate counter.
 *
 * Sensitive actions — status/blocking, block reasons and manual flags — are
 * never written directly from the client. Database triggers reject any such
 * write; only the controlled functions below can change them.
 */

/** Never `select("*")` here: block reasons and blocker identity stay out of list reads. */
const CUSTOMER_DETAIL_SELECT = `
  id, name, primary_phone, primary_phone_normalized,
  secondary_phone, secondary_phone_normalized, email,
  status, block_reason, blocked_at, blocked_by,
  created_at, updated_at, created_by, updated_by
`;

/* ---------------- Phone normalization (client mirror) ---------------- */

/**
 * Mirrors the database `normalize_bd_phone`. Used only for display hints and
 * client-side comparison; matching that decides identity always happens in the
 * database so the two can never drift apart in a way that creates duplicates.
 */
export function normalizeBdPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("01")) return digits;
  if (digits.length === 13 && digits.startsWith("8801")) return digits.slice(2);
  if (digits.length === 15 && digits.startsWith("008801")) return digits.slice(4);
  if (digits.length === 10 && digits.startsWith("1")) return `0${digits}`;
  return digits;
}

/* ---------------- List ---------------- */

export interface CustomerListFilters {
  search?: string;
  status?: CustomerStatus | "all";
  customerType?: "all" | "new" | "repeat";
  attention?: boolean;
  limit?: number;
  offset?: number;
}

/** Server-side filtered, aggregated and paginated — no full history reaches the browser. */
export async function getCustomerList(
  filters: CustomerListFilters = {},
): Promise<CustomerListResult> {
  const { data, error } = await supabase.rpc("customer_list", {
    _search: filters.search?.trim() || undefined,
    ...(filters.status && filters.status !== "all" ? { _status: filters.status } : {}),
    ...(filters.customerType && filters.customerType !== "all"
      ? { _customer_type: filters.customerType }
      : {}),
    _attention: filters.attention ?? false,
    _limit: filters.limit ?? 25,
    _offset: filters.offset ?? 0,
  });
  if (error) throw error;
  const payload = data as unknown as {
    rows: CustomerListRow[];
    approx_total: number;
    limit: number;
    offset: number;
  };
  return payload;
}

/* ---------------- Identity ---------------- */

export async function getCustomer(id: string): Promise<Customer> {
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_DETAIL_SELECT)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Customer;
}

export interface CustomerInput {
  id?: string;
  name: string;
  primaryPhone: string;
  secondaryPhone?: string | null;
  email?: string | null;
}

export async function saveCustomer(input: CustomerInput): Promise<Customer> {
  const { data, error } = await supabase.rpc("save_customer", {
    _payload: {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      primary_phone: input.primaryPhone,
      secondary_phone: input.secondaryPhone ?? null,
      email: input.email ?? null,
    },
  });
  if (error) throw error;
  return data as unknown as Customer;
}

/** Blocking and unblocking are admin-only and always recorded as a note. */
export async function setCustomerStatus(
  id: string,
  status: CustomerStatus,
  reason?: string,
): Promise<Customer> {
  const { data, error } = await supabase.rpc("set_customer_status", {
    _customer_id: id,
    _status: status,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as Customer;
}

/** Candidates for an entered phone. Never merges anything — selection stays manual. */
export async function findCustomersByPhone(phone: string): Promise<Customer[]> {
  const { data, error } = await supabase.rpc("find_customer_by_phone", { _phone: phone });
  if (error) throw error;
  return (data ?? []) as unknown as Customer[];
}

/**
 * Lightweight duplicate hint: other customers sharing the normalized phone.
 * Detection only — this step never merges customer records.
 */
export async function possibleDuplicates(customer: Customer): Promise<Customer[]> {
  const all = await findCustomersByPhone(customer.primary_phone);
  return all.filter((c) => c.id !== customer.id);
}

/* ---------------- Notes (append only) ---------------- */

export interface CustomerNoteWithAuthor extends CustomerNote {
  authorName: string | null;
}

export async function getCustomerNotes(
  customerId: string,
  limit = 50,
): Promise<CustomerNoteWithAuthor[]> {
  const { data, error } = await supabase
    .from("customer_notes")
    .select("id, customer_id, note, created_by, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  const authorIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
  let names: Record<string, string | null> = {};
  if (authorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));
  }
  return rows.map((r) => ({
    ...r,
    authorName: r.created_by ? (names[r.created_by] ?? null) : null,
  }));
}

export async function addCustomerNote(customerId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("add_customer_note", {
    _customer_id: customerId,
    _note: note,
  });
  if (error) throw error;
}

/* ---------------- Manual flags ---------------- */

export async function getCustomerFlags(customerId: string): Promise<CustomerManualFlag[]> {
  const { data, error } = await supabase
    .from("customer_manual_flags")
    .select(
      "id, customer_id, flag, reason, is_active, created_by, cleared_by, cleared_at, created_at, updated_at",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function setCustomerManualFlag(
  customerId: string,
  flag: CustomerManualFlagType,
  active: boolean,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("set_customer_manual_flag", {
    _customer_id: customerId,
    _flag: flag,
    _active: active,
    _reason: reason,
  });
  if (error) throw error;
}

/* ---------------- Derived reads ---------------- */

export async function getCustomerMetrics(
  customerId: string,
): Promise<CustomerOperationalMetrics> {
  const { data, error } = await supabase.rpc("customer_metrics", { _customer_id: customerId });
  if (error) throw error;
  return data as unknown as CustomerOperationalMetrics;
}

export async function getCustomerTimeline(
  customerId: string,
  limit = 50,
  offset = 0,
): Promise<CustomerTimelineEvent[]> {
  const { data, error } = await supabase.rpc("customer_timeline", {
    _customer_id: customerId,
    _limit: limit,
    _offset: offset,
  });
  if (error) throw error;
  return (data as unknown as { events: CustomerTimelineEvent[] }).events;
}

export async function getCustomerFinancialSummary(
  customerId: string,
): Promise<CustomerFinancialSummary> {
  const { data, error } = await supabase.rpc("customer_financial_summary", {
    _customer_id: customerId,
  });
  if (error) throw error;
  return data as unknown as CustomerFinancialSummary;
}

/* ---------------- Operational history (paginated, explicit columns) ---------------- */

export interface CustomerOrderRow {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  verification_status: string;
  delivery_status: string;
  grand_total: number;
}

export interface CustomerOrderFilters {
  search?: string;
  from?: string;
  to?: string;
  status?: string | "all";
  deliveryStatus?: string | "all";
  limit?: number;
  offset?: number;
}

export async function getCustomerOrders(
  customerId: string,
  filters: CustomerOrderFilters = {},
): Promise<CustomerOrderRow[]> {
  const limit = filters.limit ?? 25;
  const offset = filters.offset ?? 0;
  let query = supabase
    .from("orders")
    .select(
      "id, order_number, created_at, status, verification_status, delivery_status, grand_total",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.search?.trim()) query = query.ilike("order_number", `%${filters.search.trim()}%`);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status as never);
  }
  if (filters.deliveryStatus && filters.deliveryStatus !== "all") {
    query = query.eq("delivery_status", filters.deliveryStatus as never);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as CustomerOrderRow[];
}

export interface CustomerVerificationRow {
  id: string;
  order_number: string;
  created_at: string;
  verification_status: string;
  verification_attempt_count: number;
  verification_last_attempt_at: string | null;
  risk_level: string | null;
  lastOutcome: string | null;
}

/**
 * Reuses the verification records already attached to each order — attempt
 * history is not duplicated. Risk level is only requested when the caller is
 * allowed to see internal risk information.
 */
export async function getCustomerVerification(
  customerId: string,
  options: { includeRisk: boolean; limit?: number; offset?: number },
): Promise<CustomerVerificationRow[]> {
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const columns = [
    "id",
    "order_number",
    "created_at",
    "verification_status",
    "verification_attempt_count",
    "verification_last_attempt_at",
    ...(options.includeRisk ? ["risk_level"] : []),
  ].join(", ");

  const { data, error } = await supabase
    .from("orders")
    .select(columns)
    .eq("customer_id", customerId)
    .neq("verification_status", "not_required")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const orders = (data ?? []) as unknown as Omit<CustomerVerificationRow, "lastOutcome">[];
  if (orders.length === 0) return [];

  const { data: attempts, error: attemptError } = await supabase
    .from("order_verification_attempts")
    .select("order_id, outcome, created_at")
    .in(
      "order_id",
      orders.map((o) => o.id),
    )
    .order("created_at", { ascending: false });
  if (attemptError) throw attemptError;

  const lastOutcome: Record<string, string> = {};
  for (const a of attempts ?? []) {
    if (!(a.order_id in lastOutcome)) lastOutcome[a.order_id] = a.outcome;
  }

  return orders.map((o) => ({
    ...o,
    risk_level: options.includeRisk ? (o.risk_level ?? null) : null,
    lastOutcome: lastOutcome[o.id] ?? null,
  }));
}

export interface CustomerShipmentRow {
  id: string;
  shipment_number: string;
  status: string;
  external_consignment_id: string | null;
  tracking_number: string | null;
  collected_amount: number | null;
  created_at: string;
  updated_at: string;
  order: { id: string; order_number: string; delivery_status: string } | null;
  courier: { name: string } | null;
}

export async function getCustomerShipments(
  customerId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<CustomerShipmentRow[]> {
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const { data, error } = await supabase
    .from("shipments")
    .select(
      `id, shipment_number, status, external_consignment_id, tracking_number,
       collected_amount, created_at, updated_at,
       order:orders!inner(id, order_number, delivery_status, customer_id),
       courier:courier_providers(name)`,
    )
    .eq("orders.customer_id", customerId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as unknown as CustomerShipmentRow[];
}

export interface CustomerReturnRow {
  id: string;
  return_number: string;
  status: string;
  return_type: string;
  reason: string | null;
  created_at: string;
  completed_at: string | null;
  received_at: string | null;
  order: { id: string; order_number: string } | null;
  condition: string | null;
}

export async function getCustomerReturns(
  customerId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<CustomerReturnRow[]> {
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const { data, error } = await supabase
    .from("order_returns")
    .select(
      `id, return_number, status, return_type, reason, created_at, completed_at, received_at,
       order:orders!inner(id, order_number, customer_id),
       items:order_return_items(condition)`,
    )
    .eq("orders.customer_id", customerId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  type Raw = Omit<CustomerReturnRow, "condition"> & { items: { condition: string | null }[] };
  return ((data ?? []) as unknown as Raw[]).map(({ items, ...rest }) => {
    const conditions = [...new Set(items.map((i) => i.condition).filter((c): c is string => !!c))];
    return { ...rest, condition: conditions.length ? conditions.join(", ") : null };
  });
}
