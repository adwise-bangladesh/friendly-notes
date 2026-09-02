import type { Database } from "@/integrations/supabase/types";
import type { StatusTone } from "@/components/shared/StatusBadge";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type CustomerStatus = Enums["customer_status"];
export type CustomerManualFlagType = Enums["customer_manual_flag_type"];

export type Customer = Tables["customers"]["Row"];
export type CustomerNote = Tables["customer_notes"]["Row"];
export type CustomerManualFlag = Tables["customer_manual_flags"]["Row"];

export const CUSTOMER_STATUSES: CustomerStatus[] = ["active", "inactive", "blocked"];

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  blocked: "Blocked",
};

export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, StatusTone> = {
  active: "success",
  inactive: "neutral",
  blocked: "danger",
};

export const CUSTOMER_FLAG_LABELS: Record<CustomerManualFlagType, string> = {
  manual_attention: "Manual attention",
  trusted: "Trusted",
  payment_risk: "Payment risk",
  address_risk: "Address risk",
  other: "Other",
};

export const CUSTOMER_FLAGS: CustomerManualFlagType[] = [
  "manual_attention",
  "payment_risk",
  "address_risk",
  "trusted",
  "other",
];

/**
 * A customer counts as "repeat" from this many orders onwards.
 * The database mirrors this in `repeat_customer_threshold()`; change both together.
 */
export const REPEAT_CUSTOMER_THRESHOLD = 2;

/* ---------------- Derived metrics ---------------- */

/**
 * Every number here is calculated from live order, shipment, return and
 * verification records — nothing is stored as a counter, nothing is invented.
 *
 * Rates are percentages, or `null` when there is not enough data to divide by.
 */
export interface CustomerOperationalMetrics {
  customer_id: string;
  total_orders: number;
  confirmed_orders: number;
  cancelled_orders: number;
  delivered_orders: number;
  returned_orders: number;
  failed_deliveries: number;
  final_outcome_orders: number;
  verification_required_orders: number;
  verification_failure_orders: number;
  total_order_value: number;
  delivered_revenue: number;
  average_order_value: number | null;
  first_order_at: string | null;
  last_order_at: string | null;
  is_repeat_customer: boolean;
  /** delivered / orders that reached a final delivery outcome */
  delivery_success_rate: number | null;
  /** returned / (delivered + returned) */
  return_rate: number | null;
  /** confirmed / orders that actually required verification */
  verification_success_rate: number | null;
}

export interface CustomerDeliveryMetrics {
  deliveredOrders: number;
  failedDeliveries: number;
  finalOutcomeOrders: number;
  successRate: number | null;
}

export interface CustomerReturnMetrics {
  returnedOrders: number;
  deliveredOrders: number;
  returnRate: number | null;
}

export function deliveryMetrics(m: CustomerOperationalMetrics): CustomerDeliveryMetrics {
  return {
    deliveredOrders: m.delivered_orders,
    failedDeliveries: m.failed_deliveries,
    finalOutcomeOrders: m.final_outcome_orders,
    successRate: m.delivery_success_rate,
  };
}

export function returnMetrics(m: CustomerOperationalMetrics): CustomerReturnMetrics {
  return {
    returnedOrders: m.returned_orders,
    deliveredOrders: m.delivered_orders,
    returnRate: m.return_rate,
  };
}

/** Renders a rate that may legitimately have no denominator yet. */
export function formatRate(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/* ---------------- List row ---------------- */

export interface CustomerListRow {
  id: string;
  name: string;
  primary_phone: string;
  email: string | null;
  status: CustomerStatus;
  created_at: string;
  total_orders: number;
  delivered_orders: number;
  returned_orders: number;
  final_orders: number;
  verification_failures: number;
  failed_deliveries: number;
  last_order_at: string | null;
  has_manual_flag: boolean;
  delivery_success_rate: number | null;
  return_rate: number | null;
  is_repeat_customer: boolean;
}

export interface CustomerListResult {
  rows: CustomerListRow[];
  approx_total: number;
  limit: number;
  offset: number;
}

/* ---------------- Indicators ---------------- */

export type CustomerIndicatorKind = "derived" | "manual" | "status";

export interface CustomerIndicator {
  key: string;
  label: string;
  tone: StatusTone;
  kind: CustomerIndicatorKind;
  /** Plain-language explanation of exactly which data produced this indicator. */
  basis: string;
}

/**
 * Transparent indicators only. There is deliberately no opaque "customer score":
 * each indicator states the real numbers behind it, and manual flags stay
 * visibly separate from calculated ones.
 */
export function deriveIndicators(input: {
  status: CustomerStatus;
  blockReason?: string | null;
  metrics: Pick<
    CustomerOperationalMetrics,
    | "total_orders"
    | "delivered_orders"
    | "returned_orders"
    | "failed_deliveries"
    | "verification_failure_orders"
    | "return_rate"
    | "is_repeat_customer"
  >;
  manualFlags?: { flag: CustomerManualFlagType; reason: string }[];
}): CustomerIndicator[] {
  const { metrics: m } = input;
  const out: CustomerIndicator[] = [];

  if (input.status === "blocked") {
    out.push({
      key: "blocked",
      label: "Blocked",
      tone: "danger",
      kind: "status",
      basis: input.blockReason ? `Reason: ${input.blockReason}` : "Blocked by an administrator.",
    });
  }

  for (const f of input.manualFlags ?? []) {
    out.push({
      key: `manual:${f.flag}`,
      label: CUSTOMER_FLAG_LABELS[f.flag],
      tone: f.flag === "trusted" ? "success" : "warning",
      kind: "manual",
      basis: `Raised manually — ${f.reason}`,
    });
  }

  if (m.is_repeat_customer) {
    out.push({
      key: "repeat",
      label: "Repeat customer",
      tone: "info",
      kind: "derived",
      basis: `${m.total_orders} orders (repeat from ${REPEAT_CUSTOMER_THRESHOLD}).`,
    });
  }

  const returnBase = m.delivered_orders + m.returned_orders;
  if (m.return_rate !== null && m.return_rate >= 30 && returnBase >= 2) {
    out.push({
      key: "high_return_rate",
      label: "High return rate",
      tone: "warning",
      kind: "derived",
      basis: `${m.returned_orders} returned of ${returnBase} completed deliveries (${m.return_rate}%).`,
    });
  }

  if (m.verification_failure_orders >= 2) {
    out.push({
      key: "verification_failures",
      label: "Repeated verification failures",
      tone: "warning",
      kind: "derived",
      basis: `${m.verification_failure_orders} orders ended as failed or unreachable.`,
    });
  }

  if (m.failed_deliveries >= 2) {
    out.push({
      key: "delivery_failures",
      label: "Repeated delivery failures",
      tone: "warning",
      kind: "derived",
      basis: `${m.failed_deliveries} orders ended with a failed delivery.`,
    });
  }

  return out;
}

/* ---------------- Timeline ---------------- */

export type CustomerTimelineSource =
  | "customer"
  | "order"
  | "verification"
  | "fulfillment"
  | "shipment"
  | "return"
  | "note";

export interface CustomerTimelineEvent {
  at: string;
  source: CustomerTimelineSource;
  title: string;
  detail: string | null;
  order_id: string | null;
  reference: string | null;
}

export const TIMELINE_SOURCE_LABELS: Record<CustomerTimelineSource, string> = {
  customer: "Customer",
  order: "Order",
  verification: "Verification",
  fulfillment: "Fulfillment",
  shipment: "Shipment",
  return: "Return",
  note: "Note",
};

/* ---------------- Financials ---------------- */

export interface CustomerFinancialSummary {
  gross_order_value: number;
  delivered_revenue: number;
  estimated_profit: number;
  partially_actual_profit: number;
  actual_profit: number;
  estimated_orders: number;
  partially_actual_orders: number;
  actual_orders: number;
}
