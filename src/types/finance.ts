import type { Database } from "@/integrations/supabase/types";
import type { StatusTone } from "@/components/shared/StatusBadge";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* ---------- Row types ---------- */

export type OrderFinancialAdjustment = Tables["order_financial_adjustments"]["Row"];
export type CourierSettlement = Tables["courier_settlements"]["Row"];
export type CourierSettlementItem = Tables["courier_settlement_items"]["Row"];

export type FinancialAdjustmentType = Enums["financial_adjustment_type"];
export type FinancialAdjustmentDirection = Enums["financial_adjustment_direction"];
export type SettlementStatus = Enums["courier_settlement_status"];
export type PaymentStatus = Enums["payment_status"];

/** Derived, never stored: how much of the financial picture is real money. */
export type FinancialCompleteness = "estimated" | "partially_actual" | "actual";

/* ---------- Labels ---------- */

export const ADJUSTMENT_TYPES: FinancialAdjustmentType[] = [
  "packing_cost",
  "courier_charge",
  "cod_fee",
  "return_charge",
  "damage_loss",
  "manual_expense",
  "manual_income",
  "settlement_adjustment",
  "other",
];

export const ADJUSTMENT_TYPE_LABELS: Record<FinancialAdjustmentType, string> = {
  packing_cost: "Packing cost",
  courier_charge: "Courier charge",
  cod_fee: "COD fee",
  return_charge: "Return charge",
  damage_loss: "Damage loss",
  manual_expense: "Manual expense",
  manual_income: "Manual income",
  settlement_adjustment: "Settlement adjustment",
  refund: "Customer refund",
  settlement_shortfall: "Settlement shortfall",
  other: "Other",
};

export const ADJUSTMENT_DIRECTIONS: FinancialAdjustmentDirection[] = ["expense", "income"];
export const ADJUSTMENT_DIRECTION_LABELS: Record<FinancialAdjustmentDirection, string> = {
  income: "Income",
  expense: "Expense",
};

export const SETTLEMENT_STATUSES: SettlementStatus[] = [
  "draft",
  "pending",
  "partial",
  "settled",
  "disputed",
  "cancelled",
];

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  partial: "Partially settled",
  settled: "Settled",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

export const SETTLEMENT_STATUS_TONE: Record<SettlementStatus, StatusTone> = {
  draft: "neutral",
  pending: "info",
  partial: "warning",
  settled: "success",
  disputed: "danger",
  cancelled: "neutral",
};

export const COMPLETENESS_LABELS: Record<FinancialCompleteness, string> = {
  estimated: "Estimated only",
  partially_actual: "Partly actual",
  actual: "Actual",
};

export const COMPLETENESS_TONE: Record<FinancialCompleteness, StatusTone> = {
  estimated: "warning",
  partially_actual: "info",
  actual: "success",
};

/** A settled settlement is financial truth and can no longer be edited. */
export function isSettlementLocked(status: SettlementStatus): boolean {
  return status === "settled" || status === "cancelled";
}

/* ---------- Profitability projection (order_financials RPC) ---------- */

export interface OrderFinancialSnapshot {
  order_id: string;
  revenue: {
    gross_product_amount: number;
    item_discounts: number;
    order_discounts: number;
    net_product_revenue: number;
    shipping_revenue: number;
    other_adjustments: number;
    customer_total: number;
  };
  estimated: {
    product_cost: number;
    delivery_cost: number;
    packing_cost: number;
    profit: number;
    cost_snapshot_complete: boolean;
  };
  actual: {
    collected_amount: number;
    product_cost: number;
    delivery_cost: number;
    cod_fees: number;
    return_charges: number;
    other_courier_charges: number;
    packing_cost: number;
    adjustment_income: number;
    adjustment_expense: number;
    refunded_amount: number;
    settlement_discrepancy: number;
    profit: number;
  };
  payment: {
    expected_amount: number;
    paid_amount: number;
    refunded_amount: number;
    net_retained: number;
    due_amount: number;
    status: PaymentStatus;
  };
  returns: {
    returned_units: number;
    cost_recovered: boolean;
    retained_amount: number;
    unresolved: number;
  };
  realization: {
    units_ordered: number;
    units_shipped: number;
    fully_realized: boolean;
  };
  settlement: {
    open_discrepancies: number;
    open_discrepancy_amount: number;
  };
  shipping_margin: number;
  shipment_count: number;
  shipments_with_collection: number;
  completeness: FinancialCompleteness;
}

export interface SettlementItemWithContext extends CourierSettlementItem {
  order: { id: string; order_number: string } | null;
  shipment: {
    id: string;
    shipment_number: string;
    cash_on_delivery_amount: number;
    status?: string;
    external_consignment_id?: string | null;
  } | null;
}

export interface SettlementWithContext extends CourierSettlement {
  account: { id: string; name: string; code: string; provider_id: string } | null;
  provider_name: string | null;
  item_count: number;
}

/* ---------- Settlement discrepancies ---------- */

export type SettlementDiscrepancy = Tables["courier_settlement_discrepancies"]["Row"];
export type DiscrepancyStatus = Enums["settlement_discrepancy_status"];
export type DiscrepancyResolution = Enums["settlement_discrepancy_resolution"];

export interface DiscrepancyWithContext extends SettlementDiscrepancy {
  settlement: {
    id: string;
    settlement_reference: string;
    status: SettlementStatus;
    settlement_date: string | null;
    courier_account_id: string;
  } | null;
  shipment: { id: string; shipment_number: string } | null;
  order: { id: string; order_number: string } | null;
  account_name: string | null;
  provider_name: string | null;
}

export const DISCREPANCY_STATUS_LABELS: Record<DiscrepancyStatus, string> = {
  open: "Open",
  resolved: "Resolved",
};

export const DISCREPANCY_STATUS_TONE: Record<DiscrepancyStatus, StatusTone> = {
  open: "warning",
  resolved: "success",
};

/** Direction is stored as free text by the settlement workflow. */
export function discrepancyDirectionLabel(direction: string | null): string {
  if (direction === "shortfall") return "Shortfall";
  if (direction === "overpayment") return "Overpayment";
  return direction ?? "—";
}

export const DISCREPANCY_RESOLUTIONS: DiscrepancyResolution[] = [
  "courier_corrected",
  "settlement_received",
  "merchant_adjustment",
  "written_off",
];

export const DISCREPANCY_RESOLUTION_LABELS: Record<DiscrepancyResolution, string> = {
  courier_corrected: "Courier corrected it",
  settlement_received: "Money later received",
  merchant_adjustment: "Absorb as merchant adjustment",
  written_off: "Write off",
};

/**
 * How each resolution touches profit. Only the two that post a financial
 * adjustment change the money; the other two simply close the case because the
 * courier fixed it or paid later.
 */
export const DISCREPANCY_RESOLUTION_EFFECT: Record<DiscrepancyResolution, string> = {
  courier_corrected: "No financial adjustment. The open shortfall stops weighing on profit.",
  settlement_received: "No financial adjustment. The open shortfall stops weighing on profit.",
  merchant_adjustment: "Posts a permanent settlement adjustment on the order.",
  written_off: "Posts a permanent settlement write-off on the order.",
};

export function postsAdjustment(resolution: DiscrepancyResolution): boolean {
  return resolution === "merchant_adjustment" || resolution === "written_off";
}

/* ---------- Return financial outcome ---------- */

export type ReturnFinancialOutcome = Enums["return_financial_outcome"];

export const RETURN_OUTCOME_LABELS: Record<ReturnFinancialOutcome, string> = {
  pending: "Not recorded",
  refunded: "Fully refunded",
  partially_refunded: "Partially refunded",
  retained: "Money retained",
};

export const RETURN_OUTCOME_TONE: Record<ReturnFinancialOutcome, StatusTone> = {
  pending: "warning",
  refunded: "info",
  partially_refunded: "info",
  retained: "success",
};

/** Mirrors return_financial_summary(uuid). */
export interface ReturnFinancialSummary {
  return_id: string;
  order_id: string;
  status: string;
  expected_units: number;
  received_units: number;
  accepted_units: number;
  rejected_units: number;
  received_value: number;
  accepted_value: number;
  max_refund: number;
  can_record: boolean;
  recorded: boolean;
  recorded_at: string | null;
  outcome: ReturnFinancialOutcome | null;
  refund_amount: number;
  retained_amount: number;
  refund_adjustment_id: string | null;
}

