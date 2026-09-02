import type { StatusTone } from "@/components/shared/StatusBadge";
import type { Database } from "@/integrations/supabase/types";

/**
 * Delivery exceptions and returns.
 *
 * Both are operational records owned by the merchant, never by a courier.
 * Couriers only *report* something happened; the database normalises that into
 * an exception (an incident somebody must look at) or a return (physical goods
 * coming back). Every write goes through a SECURITY DEFINER function.
 */

export type ShipmentExceptionType =
  Database["public"]["Enums"]["shipment_exception_type"];
export type ShipmentExceptionStatus =
  Database["public"]["Enums"]["shipment_exception_status"];
export type OrderReturnType = Database["public"]["Enums"]["order_return_type"];
export type OrderReturnStatus = Database["public"]["Enums"]["order_return_status"];
export type ReturnItemCondition = Database["public"]["Enums"]["return_item_condition"];
export type ReturnEventType = Database["public"]["Enums"]["return_event_type"];

export type ShipmentException = Database["public"]["Tables"]["shipment_exceptions"]["Row"];
export type OrderReturn = Database["public"]["Tables"]["order_returns"]["Row"];
export type OrderReturnItemRow = Database["public"]["Tables"]["order_return_items"]["Row"];
export type OrderReturnEvent = Database["public"]["Tables"]["order_return_events"]["Row"];

export interface OrderRef {
  order_number: string;
  customer_name: string;
  customer_phone: string;
}

export interface ShipmentRef {
  shipment_number: string;
  tracking_number: string | null;
}

export interface ExceptionQueueRow extends ShipmentException {
  order: OrderRef | null;
  shipment: ShipmentRef | null;
}

export interface ReturnQueueRow extends OrderReturn {
  order: OrderRef | null;
  shipment: ShipmentRef | null;
  item_count: number;
}

export interface OrderReturnItem extends OrderReturnItemRow {
  order_item: {
    product_name: string;
    variant_name: string | null;
    sku: string | null;
    quantity: number;
  } | null;
}

export interface ReturnWithDetails extends OrderReturn {
  order: OrderRef | null;
  shipment: ShipmentRef | null;
  items: OrderReturnItem[];
  events: OrderReturnEvent[];
}

/* ---------- Exceptions ---------- */

export const EXCEPTION_STATUSES: ShipmentExceptionStatus[] = [
  "open",
  "under_review",
  "resolved",
  "dismissed",
];

export const EXCEPTION_STATUS_LABELS: Record<ShipmentExceptionStatus, string> = {
  open: "Open",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const EXCEPTION_STATUS_TONE: Record<ShipmentExceptionStatus, StatusTone> = {
  open: "danger",
  under_review: "warning",
  resolved: "success",
  dismissed: "neutral",
};

export const EXCEPTION_TYPES: ShipmentExceptionType[] = [
  "delivery_failed",
  "delivery_on_hold",
  "pickup_failed",
  "pickup_cancelled",
  "address_issue",
  "customer_unavailable",
  "customer_refused",
  "damaged_in_transit",
  "lost_in_transit",
  "partial_delivery",
  "other",
];

export const EXCEPTION_TYPE_LABELS: Record<ShipmentExceptionType, string> = {
  delivery_failed: "Delivery failed",
  delivery_on_hold: "Delivery on hold",
  pickup_failed: "Pickup failed",
  pickup_cancelled: "Pickup cancelled",
  address_issue: "Address issue",
  customer_unavailable: "Customer unavailable",
  customer_refused: "Customer refused",
  damaged_in_transit: "Damaged in transit",
  lost_in_transit: "Lost in transit",
  partial_delivery: "Partial delivery",
  other: "Other",
};

export const OPEN_EXCEPTION_STATUSES: ShipmentExceptionStatus[] = [
  "open",
  "under_review",
];

export type ExceptionAction = "start_review" | "resolve" | "dismiss";

export function exceptionActions(
  status: ShipmentExceptionStatus,
): { action: ExceptionAction; label: string; needsNote: boolean }[] {
  switch (status) {
    case "open":
      return [
        { action: "start_review", label: "Start review", needsNote: false },
        { action: "resolve", label: "Resolve", needsNote: true },
        { action: "dismiss", label: "Dismiss", needsNote: true },
      ];
    case "under_review":
      return [
        { action: "resolve", label: "Resolve", needsNote: true },
        { action: "dismiss", label: "Dismiss", needsNote: true },
      ];
    default:
      return [];
  }
}

/* ---------- Returns ---------- */

export const RETURN_STATUSES: OrderReturnStatus[] = [
  "pending",
  "in_transit",
  "received",
  "inspected",
  "completed",
  "cancelled",
  "lost",
];

export const RETURN_STATUS_LABELS: Record<OrderReturnStatus, string> = {
  pending: "Pending",
  in_transit: "In transit",
  received: "Received",
  inspected: "Inspected",
  completed: "Completed",
  cancelled: "Cancelled",
  lost: "Lost",
};

export const RETURN_STATUS_TONE: Record<OrderReturnStatus, StatusTone> = {
  pending: "warning",
  in_transit: "info",
  received: "info",
  inspected: "info",
  completed: "success",
  cancelled: "neutral",
  lost: "danger",
};

export const OPEN_RETURN_STATUSES: OrderReturnStatus[] = [
  "pending",
  "in_transit",
  "received",
  "inspected",
];

export const RETURN_TYPES: OrderReturnType[] = [
  "return_to_merchant",
  "paid_return",
  "customer_return",
  "exchange_return",
  "other",
];

export const RETURN_TYPE_LABELS: Record<OrderReturnType, string> = {
  return_to_merchant: "Courier return",
  paid_return: "Paid return",
  customer_return: "Customer return",
  exchange_return: "Exchange return",
  other: "Other",
};

export const RETURN_CONDITIONS: ReturnItemCondition[] = [
  "unknown",
  "good",
  "opened",
  "damaged",
  "missing",
  "unusable",
];

export const RETURN_CONDITION_LABELS: Record<ReturnItemCondition, string> = {
  unknown: "Not inspected",
  good: "Good — resellable",
  opened: "Opened — check",
  damaged: "Damaged",
  missing: "Missing",
  unusable: "Unusable",
};

export const RETURN_CONDITION_TONE: Record<ReturnItemCondition, StatusTone> = {
  unknown: "neutral",
  good: "success",
  opened: "warning",
  damaged: "danger",
  missing: "danger",
  unusable: "danger",
};

export const RETURN_EVENT_LABELS: Record<ReturnEventType, string> = {
  return_created: "Return created",
  status_changed: "Status changed",
  items_received: "Items received",
  inspection_recorded: "Inspection recorded",
  return_completed: "Return completed",
  return_cancelled: "Return cancelled",
  return_lost: "Return lost",
  provider_event: "Courier update",
  note_added: "Note added",
};

export type ReturnAction =
  | "mark_in_transit"
  | "mark_received"
  | "mark_inspected"
  | "complete"
  | "cancel"
  | "mark_lost";

export function returnActions(
  status: OrderReturnStatus,
): { action: ReturnAction; label: string; needsReason: boolean }[] {
  switch (status) {
    case "pending":
      return [
        { action: "mark_in_transit", label: "Mark in transit", needsReason: false },
        { action: "mark_received", label: "Mark received", needsReason: false },
        { action: "cancel", label: "Cancel return", needsReason: true },
        { action: "mark_lost", label: "Mark lost", needsReason: true },
      ];
    case "in_transit":
      return [
        { action: "mark_received", label: "Mark received", needsReason: false },
        { action: "cancel", label: "Cancel return", needsReason: true },
        { action: "mark_lost", label: "Mark lost", needsReason: true },
      ];
    case "received":
      return [
        { action: "mark_inspected", label: "Mark inspected", needsReason: false },
        { action: "mark_lost", label: "Mark lost", needsReason: true },
      ];
    case "inspected":
      return [{ action: "complete", label: "Complete return", needsReason: false }];
    default:
      return [];
  }
}

/** Physical receipt is only meaningful while goods are still arriving. */
export function canRecordReceipt(status: OrderReturnStatus): boolean {
  return status === "received" || status === "inspected";
}

export function canInspect(status: OrderReturnStatus): boolean {
  return status === "received" || status === "inspected";
}
