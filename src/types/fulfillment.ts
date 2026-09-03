import type { Database } from "@/integrations/supabase/types";
import type { StatusTone } from "@/components/shared/StatusBadge";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* ---------- Enums ---------- */

export type ReservationStatus = Enums["reservation_status"];
export type ReservationRecordStatus = Enums["reservation_record_status"];
export type FulfillmentStatus = Enums["order_fulfillment_status"];

export type InventoryReservation = Tables["inventory_reservations"]["Row"];

/* ---------- Reservation status ---------- */

export const RESERVATION_STATUSES: ReservationStatus[] = [
  "not_required",
  "pending",
  "reserved",
  "partial",
  "failed",
  "released",
];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  not_required: "Not required",
  pending: "Pending",
  reserved: "Reserved",
  partial: "Partial",
  failed: "Failed",
  released: "Released",
};

export const RESERVATION_STATUS_MEANINGS: Record<ReservationStatus, string> = {
  not_required: "This order has no physical items, so no stock is held.",
  pending: "Stock has not been reserved yet. Reservation runs when verification is confirmed.",
  reserved: "Every required unit is held for this order at the warehouse.",
  partial: "Partially reserved. Reservation is all-or-nothing, so this state is not produced.",
  failed: "Stock could not be held — nothing was reserved. See the hold reason.",
  released: "Previously held stock was returned to available.",
};

export const RESERVATION_STATUS_TONE: Record<ReservationStatus, StatusTone> = {
  not_required: "neutral",
  pending: "warning",
  reserved: "success",
  partial: "warning",
  failed: "danger",
  released: "neutral",
};

export const RESERVATION_RECORD_STATUS_LABELS: Record<ReservationRecordStatus, string> = {
  active: "Active",
  released: "Released",
  committed: "Committed",
};

export const RESERVATION_RECORD_STATUS_TONE: Record<ReservationRecordStatus, StatusTone> = {
  active: "info",
  released: "neutral",
  committed: "success",
};

/* ---------- Fulfillment status ---------- */

export const FULFILLMENT_STATUSES: FulfillmentStatus[] = [
  "not_started",
  "on_hold",
  "ready",
  "picking",
  "picked",
  "packing",
  "packed",
  "ready_for_courier",
];

/** Statuses the warehouse queue works on. */
export const FULFILLMENT_QUEUE_STATUSES: FulfillmentStatus[] = [
  "ready",
  "picking",
  "picked",
  "packing",
  "packed",
  "ready_for_courier",
  "on_hold",
];

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  not_started: "Not started",
  on_hold: "On hold",
  ready: "Ready",
  picking: "Picking",
  picked: "Picked",
  packing: "Packing",
  packed: "Packed",
  ready_for_courier: "Ready for courier",
};

export const FULFILLMENT_STATUS_MEANINGS: Record<FulfillmentStatus, string> = {
  not_started: "The order has not entered warehouse operations.",
  on_hold: "Warehouse processing is blocked. A reason is recorded.",
  ready: "Inventory is held. The order is ready for warehouse processing.",
  picking: "Warehouse staff are collecting the items.",
  picked: "All items have been collected.",
  packing: "Items are being packed.",
  packed: "Items are packed and stock has been permanently deducted.",
  ready_for_courier: "The package is ready to hand over to a courier.",
};

export const FULFILLMENT_STATUS_TONE: Record<FulfillmentStatus, StatusTone> = {
  not_started: "neutral",
  on_hold: "danger",
  ready: "info",
  picking: "info",
  picked: "info",
  packing: "info",
  packed: "success",
  ready_for_courier: "success",
};

/* ---------- Actions (UI affordance only; the database is the authority) ---------- */

export type FulfillmentAction =
  | "reserve"
  | "retry_reservation"
  | "start_picking"
  | "mark_picked"
  | "start_packing"
  | "mark_packed"
  | "ready_for_courier"
  | "hold"
  | "resume";

export const FULFILLMENT_ACTION_LABELS: Record<FulfillmentAction, string> = {
  reserve: "Reserve inventory",
  retry_reservation: "Retry reservation",
  start_picking: "Start picking",
  mark_picked: "Mark picked",
  start_packing: "Start packing",
  mark_packed: "Mark packed",
  ready_for_courier: "Mark ready for courier",
  hold: "Put on hold",
  resume: "Resume",
};

/**
 * The next order-level step for the warehouse queue. Physical progress
 * (picking → QC → packing → handover) now happens on fulfillment records, so
 * the queue only offers reservation and hold/resume.
 */
export function nextFulfillmentAction(
  fulfillment: FulfillmentStatus,
  reservation: ReservationStatus,
): FulfillmentAction | null {
  if (fulfillment === "on_hold") {
    return reservation === "reserved" || reservation === "not_required" ? "resume" : "retry_reservation";
  }
  if (fulfillment === "not_started") {
    return reservation === "reserved" || reservation === "not_required" ? null : "reserve";
  }
  return null;
}



/**
 * Order-level warehouse actions.
 *
 * Since the Step 20.1 fix the warehouse workflow lives on fulfillment records
 * (`/fulfillment` workspace). The order page only offers stock reservation and
 * an order-level hold/resume while no fulfillment record exists yet. Picking,
 * packing, QC and handover — and therefore inventory commitment — happen on the
 * fulfillment record and are projected back onto the order automatically.
 */
export function availableFulfillmentActions(args: {
  orderStatus: string;
  verificationStatus: string;
  fulfillment: FulfillmentStatus;
  reservation: ReservationStatus;
  hasFulfillmentRecords?: boolean;
}): FulfillmentAction[] {
  const { orderStatus, verificationStatus, fulfillment, reservation } = args;
  if (orderStatus === "cancelled") return [];

  const actions: FulfillmentAction[] = [];
  const held = reservation === "reserved" || reservation === "not_required";

  if (verificationStatus === "confirmed" && !held) {
    actions.push(reservation === "failed" || reservation === "released" ? "retry_reservation" : "reserve");
  }

  if (args.hasFulfillmentRecords) return actions;

  if (fulfillment === "on_hold" && held) actions.push("resume");
  else if (fulfillment === "ready") actions.push("hold");

  return actions;
}

/** True once stock has permanently left on hand. */
export function isStockCommitted(fulfillment: FulfillmentStatus): boolean {
  return fulfillment === "packed" || fulfillment === "ready_for_courier";
}


/* ---------- Pick list ---------- */

export interface PickListLine {
  orderItemId: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  productType: string;
  imageUrl: string | null;
  requiredQuantity: number;
  reservedQuantity: number;
  locationName: string | null;
  stockTracked: boolean;
}
