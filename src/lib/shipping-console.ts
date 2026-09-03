import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CourierServiceType, ShipmentStatus } from "@/types/shipping";

/**
 * Shipping desk console access.
 *
 * Every read goes through the controlled `shipments_console_list` /
 * `shipment_quick_view` projections, so pagination, filtering, sorting and
 * aggregation happen in one SQL round-trip and no cost, credential or vault
 * data can ever reach the browser. Bulk courier assignment reuses the existing
 * per-shipment `assign_shipment_courier` inside `bulk_assign_shipment_courier`,
 * so every guard (already booked, wrong store, inactive provider) still runs
 * once per shipment and partial success is reported honestly.
 *
 * Booking itself is NOT wrapped here: it still runs through the
 * `bookShipmentWithCourier` server function, which claims the attempt with
 * `book_shipment_begin` before contacting a courier.
 */

export const SHIPMENT_SORTS = [
  "newest",
  "oldest",
  "updated",
  "oldest_unresolved",
  "booking_priority",
  "delivery_priority",
  "cod_desc",
] as const;
export type ShipmentSort = (typeof SHIPMENT_SORTS)[number];

export const SHIPMENT_SORT_LABELS: Record<ShipmentSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  updated: "Recently updated",
  oldest_unresolved: "Oldest unresolved",
  booking_priority: "Booking priority",
  delivery_priority: "Delivery priority",
  cod_desc: "Highest COD",
};

export type BookingState = "ready" | "in_progress" | "booked" | "failed" | "recovery_required" | "none";

export const BOOKING_STATE_LABELS: Record<BookingState, string> = {
  ready: "Ready for booking",
  in_progress: "Booking in progress",
  booked: "Booked",
  failed: "Booking failed",
  recovery_required: "Outcome unknown",
  none: "—",
};

export type DeliveryGroup =
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "partial"
  | "failed"
  | "hold"
  | "lost"
  | "return";

export const DELIVERY_GROUP_LABELS: Record<DeliveryGroup, string> = {
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  partial: "Partially delivered",
  failed: "Delivery / pickup failed",
  hold: "On hold",
  lost: "Lost",
  return: "Return leg",
};

export interface ShipmentConsoleFilters {
  page?: number;
  page_size?: number;
  sort?: ShipmentSort;
  search?: string;
  status?: ShipmentStatus;
  status_group?: "active" | "terminal";
  booking_state?: BookingState;
  provider_id?: string;
  account_id?: string;
  delivery_group?: DeliveryGroup;
  cod_min?: number;
  cod_max?: number;
  cod_mismatch?: boolean;
  settlement?: "settled" | "unsettled";
  has_exception?: boolean;
  exception_type?: string;
  store_id?: string;
  from?: string;
  to?: string;
  min_age_hours?: number;
  tracking?: "present" | "missing";
}

export interface ShipmentConsoleRow {
  id: string;
  shipment_number: string;
  status: ShipmentStatus;
  order_id: string;
  order_number: string;
  store_id: string | null;
  store_name: string | null;
  customer_name: string;
  customer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  delivery_area: string | null;
  delivery_city: string | null;
  item_lines: number;
  unit_count: number;
  first_item: string | null;
  delivered_quantity: number;
  refused_quantity: number;
  lost_quantity: number;
  damaged_quantity: number;
  has_outcome: boolean;
  provider_id: string | null;
  provider_name: string | null;
  provider_code: string | null;
  account_id: string | null;
  account_name: string | null;
  service_type: CourierServiceType | null;
  tracking_number: string | null;
  external_consignment_id: string | null;
  booking_state: BookingState;
  booking_attempt_count: number;
  booking_last_error: string | null;
  booking_outcome_unknown: boolean;
  provider_status: string | null;
  last_synced_at: string | null;
  hold_reason: string | null;
  failure_reason: string | null;
  cash_on_delivery_amount: number;
  collected_amount: number | null;
  cod_mismatch: boolean;
  quoted_delivery_fee: number | null;
  booked_delivery_fee: number | null;
  actual_delivery_fee: number | null;
  settlement_status: string | null;
  open_exceptions: number;
  exception_types: string[];
  open_returns: number;
  created_at: string;
  updated_at: string;
  age_hours: number;
}

export interface ShipmentConsoleResult {
  total: number;
  page: number;
  page_size: number;
  sort: ShipmentSort;
  rows: ShipmentConsoleRow[];
}

function cleanPayload(filters: ShipmentConsoleFilters): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    payload[key] = value;
  }
  return payload;
}

export async function getShipmentsConsole(
  filters: ShipmentConsoleFilters = {},
): Promise<ShipmentConsoleResult> {
  const { data, error } = await supabase.rpc("shipments_console_list", {
    _payload: cleanPayload(filters) as Json,
  });
  if (error) throw error;
  return data as unknown as ShipmentConsoleResult;
}

/* ---------- Quick view ---------- */

export interface ShipmentQuickViewData {
  shipment: {
    id: string;
    shipment_number: string;
    status: ShipmentStatus;
    service_type: CourierServiceType | null;
    created_at: string;
    updated_at: string;
    booked_at: string | null;
    picked_up_at: string | null;
    delivered_at: string | null;
    notes: string | null;
    partial_delivery_note: string | null;
  };
  order: {
    id: string;
    order_number: string;
    status: string;
    payment_method: string;
    grand_total: number;
    due_amount: number;
    store_id: string | null;
  };
  customer: {
    name: string;
    phone: string;
    recipient_name: string;
    recipient_phone: string;
    address: string | null;
    area: string | null;
    city: string | null;
    zone: string | null;
    postal_code: string | null;
  };
  courier: {
    provider_id: string | null;
    provider_name: string | null;
    provider_code: string | null;
    account_id: string | null;
    account_name: string | null;
    tracking_number: string | null;
    external_consignment_id: string | null;
    provider_reference: string | null;
  };
  booking: {
    state: BookingState;
    attempt_count: number;
    attempt_started_at: string | null;
    last_error: string | null;
    outcome_unknown: boolean;
  };
  delivery: {
    status: ShipmentStatus;
    provider_status: string | null;
    provider_status_at: string | null;
    last_synced_at: string | null;
    hold_reason: string | null;
    failure_reason: string | null;
    outcome_recorded_at: string | null;
  };
  financial: {
    expected_cod: number;
    collected_amount: number | null;
    quoted_delivery_fee: number | null;
    booked_delivery_fee: number | null;
    actual_delivery_fee: number | null;
    cod_fee: number | null;
    return_charge: number | null;
    other_courier_charge: number | null;
    financials_recorded_at: string | null;
    settlement_status: string | null;
  };
  items: {
    id: string;
    product_name: string | null;
    variant_name: string | null;
    sku: string | null;
    quantity: number;
    delivered_quantity: number;
    refused_quantity: number;
    lost_quantity: number;
    damaged_quantity: number;
  }[];
  returns: { id: string; return_number: string; status: string; return_type: string }[];
  exceptions: {
    id: string;
    exception_type: string;
    status: string;
    reason: string | null;
    occurred_at: string;
    assigned_to: string | null;
    assigned_name: string | null;
    assigned_is_mine: boolean;
  }[];
  profit: Record<string, number | string | null> | null;
  can_manage: boolean;
}

export async function getShipmentQuickView(shipmentId: string): Promise<ShipmentQuickViewData> {
  const { data, error } = await supabase.rpc("shipment_quick_view", {
    _shipment_id: shipmentId,
  });
  if (error) throw error;
  return data as unknown as ShipmentQuickViewData;
}

/* ---------- Bulk courier assignment ---------- */

export interface BulkAssignResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: {
    shipment_id: string;
    shipment_number: string | null;
    ok: boolean;
    error: string | null;
  }[];
}

export async function bulkAssignShipmentCourier(args: {
  shipmentIds: string[];
  providerId: string;
  serviceType?: CourierServiceType | null;
  accountId?: string | null;
}): Promise<BulkAssignResult> {
  const { data, error } = await supabase.rpc("bulk_assign_shipment_courier", {
    _shipment_ids: args.shipmentIds,
    _provider_id: args.providerId,
    ...(args.serviceType ? { _service_type: args.serviceType } : {}),
    ...(args.accountId ? { _account_id: args.accountId } : {}),
  });
  if (error) throw error;
  return data as unknown as BulkAssignResult;
}

/**
 * Why a shipment cannot be booked right now, in operator language.
 * `null` means the shipment is eligible; the database re-checks anyway.
 */
export function bookingBlockReason(row: {
  status: ShipmentStatus;
  booking_state: BookingState;
  provider_id: string | null;
  account_id: string | null;
}): string | null {
  if (row.booking_state === "recovery_required")
    return "Booking outcome is unknown and requires recovery.";
  if (row.booking_state === "booked") return "Shipment already has an active booking.";
  if (row.booking_state === "in_progress") return "A booking attempt is already running.";
  if (row.status === "cancelled") return "Shipment is cancelled.";
  if (!["ready_for_booking", "booking_failed", "booking_requested"].includes(row.status))
    return "Shipment is not ready for booking.";
  if (!row.provider_id || !row.account_id)
    return "Assign a courier provider and account before booking.";
  return null;
}

/** Why the courier can no longer be changed. `null` means assignment is allowed. */
export function assignBlockReason(row: {
  status: ShipmentStatus;
  external_consignment_id: string | null;
}): string | null {
  if (row.external_consignment_id)
    return "Shipment is already booked with a courier consignment and cannot be reassigned.";
  if (!["draft", "ready_for_booking", "booking_requested", "booking_failed"].includes(row.status))
    return "The courier can no longer be changed once booking is confirmed.";
  return null;
}
