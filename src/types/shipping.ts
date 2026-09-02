import type { Database } from "@/integrations/supabase/types";
import type { StatusTone } from "@/components/shared/StatusBadge";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* ---------- Rows ---------- */

export type Shipment = Tables["shipments"]["Row"];
export type ShipmentItem = Tables["shipment_items"]["Row"];
export type ShipmentEvent = Tables["shipment_events"]["Row"];
export type CourierProvider = Tables["courier_providers"]["Row"];

/* ---------- Enums ---------- */

export type ShipmentStatus = Enums["shipment_status"];
export type ShipmentEventType = Enums["shipment_event_type"];
export type CourierProviderStatus = Enums["courier_provider_status"];
export type CourierServiceType = Enums["courier_service_type"];
export type ShipmentHoldReason = Enums["shipment_hold_reason"];
export type ShipmentFailureReason = Enums["shipment_failure_reason"];

/* ---------- Status ---------- */

export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "draft",
  "ready_for_booking",
  "booking_requested",
  "booked",
  "pickup_requested",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivery_on_hold",
  "delivered",
  "delivery_failed",
  "return_requested",
  "return_in_transit",
  "return_received",
  "lost",
  "cancelled",
];

/** Shipments that still need shipping-desk attention. */
export const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
  "draft",
  "ready_for_booking",
  "booking_requested",
  "booked",
  "pickup_requested",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivery_on_hold",
  "delivery_failed",
  "return_requested",
  "return_in_transit",
];

export const TERMINAL_SHIPMENT_STATUSES: ShipmentStatus[] = [
  "delivered",
  "return_received",
  "lost",
  "cancelled",
];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft: "Draft",
  ready_for_booking: "Ready for booking",
  booking_requested: "Booking requested",
  booked: "Booked",
  pickup_requested: "Pickup requested",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivery_on_hold: "Delivery on hold",
  delivered: "Delivered",
  delivery_failed: "Delivery failed",
  return_requested: "Return requested",
  return_in_transit: "Return in transit",
  return_received: "Return received",
  lost: "Lost",
  cancelled: "Cancelled",
};

export const SHIPMENT_STATUS_MEANINGS: Record<ShipmentStatus, string> = {
  draft: "The shipment record exists but is not ready for courier booking.",
  ready_for_booking: "Warehouse work is complete and the shipment data is ready for the courier.",
  booking_requested: "A booking request has been initiated with the courier.",
  booked: "The courier accepted the shipment. A tracking or consignment id may exist.",
  pickup_requested: "A courier pickup has been requested.",
  picked_up: "The courier physically collected the package.",
  in_transit: "The package is moving through courier operations.",
  out_for_delivery: "The package is with the final delivery operation.",
  delivery_on_hold: "Delivery is temporarily paused. A reason is recorded.",
  delivered: "The package was delivered. Financial settlement is a separate concept.",
  delivery_failed: "A delivery attempt failed. This does not create a return by itself.",
  return_requested: "The shipment is entering the return-to-sender process.",
  return_in_transit: "The package is moving back toward the merchant.",
  return_received: "The merchant physically received the returned shipment. No restocking yet.",
  lost: "The courier reports the shipment as lost. History is preserved.",
  cancelled: "The shipment workflow was cancelled before pickup.",
};

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, StatusTone> = {
  draft: "neutral",
  ready_for_booking: "info",
  booking_requested: "info",
  booked: "info",
  pickup_requested: "info",
  picked_up: "info",
  in_transit: "info",
  out_for_delivery: "info",
  delivery_on_hold: "warning",
  delivered: "success",
  delivery_failed: "danger",
  return_requested: "warning",
  return_in_transit: "warning",
  return_received: "neutral",
  lost: "danger",
  cancelled: "neutral",
};

/* ---------- Provider / service ---------- */

export const COURIER_PROVIDER_STATUS_LABELS: Record<CourierProviderStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  disabled: "Disabled",
};

export const COURIER_SERVICE_TYPES: CourierServiceType[] = [
  "standard",
  "express",
  "same_day",
  "next_day",
  "other",
];

export const COURIER_SERVICE_TYPE_LABELS: Record<CourierServiceType, string> = {
  standard: "Standard",
  express: "Express",
  same_day: "Same day",
  next_day: "Next day",
  other: "Other",
};

/* ---------- Reasons ---------- */

export const SHIPMENT_HOLD_REASONS: ShipmentHoldReason[] = [
  "customer_requested_delay",
  "address_issue",
  "rider_issue",
  "weather",
  "operational_issue",
  "other",
];

export const SHIPMENT_HOLD_REASON_LABELS: Record<ShipmentHoldReason, string> = {
  customer_requested_delay: "Customer requested a later day",
  address_issue: "Address issue",
  rider_issue: "Rider issue",
  weather: "Weather",
  operational_issue: "Operational issue",
  other: "Other",
};

export const SHIPMENT_FAILURE_REASONS: ShipmentFailureReason[] = [
  "customer_unreachable",
  "customer_refused",
  "address_not_found",
  "delivery_attempt_failed",
  "area_unserviceable",
  "customer_requested_cancel",
  "other",
];

export const SHIPMENT_FAILURE_REASON_LABELS: Record<ShipmentFailureReason, string> = {
  customer_unreachable: "Customer unreachable",
  customer_refused: "Customer refused",
  address_not_found: "Address not found",
  delivery_attempt_failed: "Delivery attempt failed",
  area_unserviceable: "Area unserviceable",
  customer_requested_cancel: "Customer requested cancellation",
  other: "Other",
};

/* ---------- Events ---------- */

export const SHIPMENT_EVENT_LABELS: Record<ShipmentEventType, string> = {
  shipment_created: "Shipment created",
  ready_for_booking: "Ready for booking",
  booking_requested: "Booking requested",
  booking_confirmed: "Booking confirmed",
  courier_assigned: "Courier assigned",
  pickup_requested: "Pickup requested",
  shipment_picked_up: "Picked up",
  status_updated: "Status updated",
  delivery_on_hold: "Delivery on hold",
  delivery_failed: "Delivery failed",
  shipment_delivered: "Delivered",
  return_requested: "Return requested",
  return_started: "Return in transit",
  return_received: "Return received",
  shipment_lost: "Reported lost",
  shipment_cancelled: "Shipment cancelled",
};

/* ---------- Actions (UI affordance only; the database is the authority) ---------- */

export type ShipmentAction =
  | "mark_ready_for_booking"
  | "request_booking"
  | "revert_booking_request"
  | "confirm_booking"
  | "request_pickup"
  | "mark_picked_up"
  | "mark_in_transit"
  | "mark_out_for_delivery"
  | "hold_delivery"
  | "mark_delivered"
  | "mark_delivery_failed"
  | "start_return"
  | "mark_return_in_transit"
  | "mark_return_received"
  | "mark_lost"
  | "cancel";

export const SHIPMENT_ACTION_LABELS: Record<ShipmentAction, string> = {
  mark_ready_for_booking: "Mark ready for booking",
  request_booking: "Request booking",
  revert_booking_request: "Withdraw booking request",
  confirm_booking: "Confirm booking",
  request_pickup: "Request pickup",
  mark_picked_up: "Mark picked up",
  mark_in_transit: "Mark in transit",
  mark_out_for_delivery: "Mark out for delivery",
  hold_delivery: "Put delivery on hold",
  mark_delivered: "Mark delivered",
  mark_delivery_failed: "Mark delivery failed",
  start_return: "Start return",
  mark_return_in_transit: "Mark return in transit",
  mark_return_received: "Mark return received",
  mark_lost: "Mark lost",
  cancel: "Cancel shipment",
};

/** Only the transitions the database allows are offered. */
export function availableShipmentActions(status: ShipmentStatus): ShipmentAction[] {
  switch (status) {
    case "draft":
      return ["mark_ready_for_booking", "cancel"];
    case "ready_for_booking":
      return ["request_booking", "cancel"];
    case "booking_requested":
      return ["confirm_booking", "revert_booking_request", "cancel"];
    case "booked":
      return ["request_pickup", "mark_picked_up", "cancel"];
    case "pickup_requested":
      return ["mark_picked_up", "cancel"];
    case "picked_up":
      return ["mark_in_transit", "mark_lost"];
    case "in_transit":
      return ["mark_out_for_delivery", "hold_delivery", "start_return", "mark_lost"];
    case "out_for_delivery":
      return [
        "mark_delivered",
        "hold_delivery",
        "mark_delivery_failed",
        "start_return",
        "mark_lost",
      ];
    case "delivery_on_hold":
      return ["mark_out_for_delivery", "mark_delivery_failed", "start_return", "mark_lost"];
    case "delivery_failed":
      return ["mark_out_for_delivery", "start_return", "mark_lost"];
    case "return_requested":
      return ["mark_return_in_transit", "mark_lost"];
    case "return_in_transit":
      return ["mark_return_received", "mark_lost"];
    default:
      return [];
  }
}

export const HOLD_REASON_ACTIONS: ShipmentAction[] = ["hold_delivery"];
export const FAILURE_REASON_ACTIONS: ShipmentAction[] = ["mark_delivery_failed"];
export const FREE_TEXT_REASON_ACTIONS: ShipmentAction[] = ["mark_lost"];

/* ---------- Composed read shapes ---------- */

export interface ShipmentItemLine extends ShipmentItem {
  productName: string;
  variantName: string | null;
  sku: string | null;
}

export interface ShipmentSummary {
  id: string;
  shipment_number: string;
  status: ShipmentStatus;
  tracking_number: string | null;
  cash_on_delivery_amount: number;
  fulfillment_id: string | null;
  provider: { id: string; name: string; code: string } | null;
  created_at: string;
}

export interface ShipmentWithDetails extends Shipment {
  provider: { id: string; name: string; code: string; status: CourierProviderStatus } | null;
  order: {
    id: string;
    order_number: string;
    status: string;
    customer_name: string;
    customer_phone: string;
    payment_method: string;
    grand_total: number;
    due_amount: number | null;
  } | null;
  fulfillment: { id: string; fulfillment_number: number; status: string } | null;
  items: ShipmentItemLine[];
}

export interface ShipmentQueueRow extends Shipment {
  provider: { id: string; name: string; code: string } | null;
  order: { id: string; order_number: string; customer_name: string; customer_phone: string } | null;
}

export interface ShippableLine {
  fulfillment_item_id: string;
  order_item_id: string;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  planned: number;
  fulfilled: number;
  shipped: number;
  shippable: number;
}
