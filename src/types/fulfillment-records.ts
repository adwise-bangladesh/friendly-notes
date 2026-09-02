import type { Database } from "@/integrations/supabase/types";
import type { StatusTone } from "@/components/shared/StatusBadge";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* ---------- Enums ---------- */

export type FulfillmentRecordStatus = Enums["fulfillment_record_status"];
export type FulfillmentEventType = Enums["fulfillment_event_type"];
export type QCStatus = Enums["fulfillment_qc_status"];
export type ShortageReason = Enums["fulfillment_shortage_reason"];

export type Fulfillment = Tables["order_fulfillments"]["Row"];
export type FulfillmentItem = Tables["order_fulfillment_items"]["Row"];
export type FulfillmentEvent = Tables["order_fulfillment_events"]["Row"];

/* ---------- Status ---------- */

export const FULFILLMENT_RECORD_STATUSES: FulfillmentRecordStatus[] = [
  "unfulfilled",
  "ready_to_pick",
  "picking",
  "picked",
  "packing",
  "qc_pending",
  "qc_failed",
  "packed",
  "ready_for_handover",
  "on_hold",
  "cancelled",
];

/** Statuses that still need warehouse attention. */
export const ACTIVE_FULFILLMENT_STATUSES: FulfillmentRecordStatus[] = [
  "ready_to_pick",
  "picking",
  "picked",
  "packing",
  "qc_pending",
  "qc_failed",
  "on_hold",
  "packed",
];

export const FULFILLMENT_RECORD_STATUS_LABELS: Record<FulfillmentRecordStatus, string> = {
  unfulfilled: "Unfulfilled",
  ready_to_pick: "Ready to pick",
  picking: "Picking",
  picked: "Picked",
  packing: "Packing",
  qc_pending: "QC pending",
  qc_failed: "QC failed",
  packed: "Packed",
  ready_for_handover: "Ready for handover",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export const FULFILLMENT_RECORD_STATUS_MEANINGS: Record<FulfillmentRecordStatus, string> = {
  unfulfilled: "No warehouse fulfillment has started.",
  ready_to_pick: "Eligible for warehouse processing. Nothing has been collected yet.",
  picking: "Warehouse staff are actively collecting the planned items.",
  picked: "All planned items of this fulfillment are resolved as picked or short.",
  packing: "Items are being prepared and packed.",
  qc_pending: "The package is waiting for quality control.",
  qc_failed: "Quality control found a problem. Return to picking or put on hold.",
  packed: "Quality control passed and the package is packed.",
  ready_for_handover: "The package is ready to hand over to a courier.",
  on_hold: "Warehouse processing is temporarily blocked. A reason is recorded.",
  cancelled: "This fulfillment operation was cancelled. History is preserved.",
};

export const FULFILLMENT_RECORD_STATUS_TONE: Record<FulfillmentRecordStatus, StatusTone> = {
  unfulfilled: "neutral",
  ready_to_pick: "info",
  picking: "info",
  picked: "info",
  packing: "info",
  qc_pending: "warning",
  qc_failed: "danger",
  packed: "success",
  ready_for_handover: "success",
  on_hold: "danger",
  cancelled: "neutral",
};

/* ---------- QC / shortage ---------- */

export const QC_STATUS_LABELS: Record<QCStatus, string> = {
  pending: "Pending",
  passed: "Passed",
  failed: "Failed",
};

export const QC_STATUS_TONE: Record<QCStatus, StatusTone> = {
  pending: "neutral",
  passed: "success",
  failed: "danger",
};

export const SHORTAGE_REASONS: ShortageReason[] = [
  "out_of_stock",
  "damaged",
  "missing",
  "wrong_item",
  "other",
];

export const SHORTAGE_REASON_LABELS: Record<ShortageReason, string> = {
  out_of_stock: "Out of stock",
  damaged: "Damaged",
  missing: "Missing",
  wrong_item: "Wrong item",
  other: "Other",
};

export const HOLD_REASONS = [
  "Stock issue",
  "Product issue",
  "Customer request",
  "Operational issue",
  "Other",
];

export const QC_FAILURE_REASONS = [
  "Wrong product",
  "Wrong variant",
  "Damaged",
  "Missing item",
  "Packaging problem",
  "Other",
];

/* ---------- Events ---------- */

export const FULFILLMENT_EVENT_LABELS: Record<FulfillmentEventType, string> = {
  fulfillment_created: "Fulfillment created",
  picking_started: "Picking started",
  item_picked: "Items picked",
  picking_completed: "Picking completed",
  packing_started: "Packing started",
  qc_started: "QC started",
  qc_passed: "QC passed",
  qc_failed: "QC failed",
  packed: "Packed",
  ready_for_handover: "Ready for handover",
  put_on_hold: "Put on hold",
  hold_released: "Hold released",
  fulfillment_cancelled: "Fulfillment cancelled",
};

/* ---------- Actions (UI affordance only; the database is the authority) ---------- */

export type FulfillmentRecordAction =
  | "start_picking"
  | "complete_picking"
  | "start_packing"
  | "send_to_qc"
  | "pass_qc"
  | "fail_qc"
  | "return_to_picking"
  | "hold"
  | "release_hold"
  | "mark_ready_for_handover"
  | "cancel";

export const FULFILLMENT_RECORD_ACTION_LABELS: Record<FulfillmentRecordAction, string> = {
  start_picking: "Start picking",
  complete_picking: "Complete picking",
  start_packing: "Start packing",
  send_to_qc: "Send to QC",
  pass_qc: "Pass QC",
  fail_qc: "Fail QC",
  return_to_picking: "Return to picking",
  hold: "Put on hold",
  release_hold: "Release hold",
  mark_ready_for_handover: "Ready for handover",
  cancel: "Cancel fulfillment",
};

/** Actions the workspace may offer. The database re-validates every one of them. */
export function availableFulfillmentRecordActions(
  status: FulfillmentRecordStatus,
  orderCancelled: boolean,
): FulfillmentRecordAction[] {
  if (orderCancelled) return [];
  switch (status) {
    case "ready_to_pick":
      return ["start_picking", "hold", "cancel"];
    case "picking":
      return ["complete_picking", "hold", "cancel"];
    case "picked":
      return ["start_packing", "hold", "cancel"];
    case "packing":
      return ["send_to_qc", "hold", "cancel"];
    case "qc_pending":
      return ["pass_qc", "fail_qc", "hold", "cancel"];
    case "qc_failed":
      return ["return_to_picking", "hold", "cancel"];
    case "packed":
      return ["mark_ready_for_handover"];
    case "on_hold":
      return ["release_hold", "cancel"];
    default:
      return [];
  }
}

/** Actions that require a reason before the database will accept them. */
export const REASON_REQUIRED_ACTIONS: FulfillmentRecordAction[] = ["hold", "fail_qc"];

/* ---------- Composed read shapes ---------- */

export interface FulfillmentItemLine extends FulfillmentItem {
  orderItemId: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  orderedQuantity: number;
  imageUrl: string | null;
}

export interface FulfillmentWithItems extends Fulfillment {
  items: FulfillmentItemLine[];
  order: {
    id: string;
    order_number: string;
    status: string;
    customer_name: string;
    customer_phone: string;
    verification_status: string;
  } | null;
  location: { id: string; name: string; code: string } | null;
}

export interface OrderItemFulfillmentSummary {
  orderItemId: string;
  ordered: number;
  fulfilled: number;
  remaining: number;
}
