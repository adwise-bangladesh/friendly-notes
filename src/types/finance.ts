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
    profit: number;
  };
  shipping_margin: number;
  shipment_count: number;
  shipments_with_collection: number;
  completeness: FinancialCompleteness;
}

export interface SettlementItemWithContext extends CourierSettlementItem {
  order: { id: string; order_number: string } | null;
  shipment: { id: string; shipment_number: string; cash_on_delivery_amount: number } | null;
}

export interface SettlementWithContext extends CourierSettlement {
  account: { id: string; name: string; code: string; provider_id: string } | null;
  provider_name: string | null;
  item_count: number;
}
