import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ShipmentStatus } from "@/types/shipping";
import type { ShipmentExceptionStatus, ShipmentExceptionType } from "@/types/returns";

/**
 * Exception desk access.
 *
 * Reads use the controlled `exceptions_console_list` / `exception_quick_view`
 * projections. Ownership reuses the existing operational assignment system
 * (`assign_operational_work` / `release_operational_work` with the
 * `shipment_exception` source type), so claiming an exception is concurrency
 * safe and appends to the same audit trail as every other operational claim.
 * Resolution still goes through `set_exception_state`.
 */

export const EXCEPTION_SORTS = ["newest", "oldest_unresolved", "priority", "oldest_assigned"] as const;
export type ExceptionSort = (typeof EXCEPTION_SORTS)[number];

export const EXCEPTION_SORT_LABELS: Record<ExceptionSort, string> = {
  newest: "Newest first",
  oldest_unresolved: "Oldest unresolved",
  priority: "Highest priority",
  oldest_assigned: "Oldest assigned",
};

export interface ExceptionConsoleFilters {
  page?: number;
  page_size?: number;
  sort?: ExceptionSort;
  search?: string;
  status?: ShipmentExceptionStatus | "open" | "all";
  exception_type?: ShipmentExceptionType;
  provider_id?: string;
  account_id?: string;
  store_id?: string;
  shipment_status?: ShipmentStatus;
  assigned_to?: string;
  has_discrepancy?: boolean;
  from?: string;
  to?: string;
}

export interface ExceptionConsoleRow {
  id: string;
  exception_type: ShipmentExceptionType;
  status: ShipmentExceptionStatus;
  reason: string | null;
  courier_reason: string | null;
  resolution_note: string | null;
  collected_amount: number | null;
  source: string | null;
  occurred_at: string;
  resolved_at: string | null;
  order_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  store_id: string | null;
  store_name: string | null;
  shipment_id: string | null;
  shipment_number: string | null;
  shipment_status: ShipmentStatus | null;
  tracking_number: string | null;
  provider_name: string | null;
  account_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_at: string | null;
  assigned_is_mine: boolean;
  open_discrepancies: number;
  age_hours: number;
}

export interface ExceptionConsoleResult {
  total: number;
  page: number;
  page_size: number;
  sort: ExceptionSort;
  rows: ExceptionConsoleRow[];
}

function cleanPayload(filters: ExceptionConsoleFilters): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    payload[key] = value;
  }
  return payload;
}

export async function getExceptionsConsole(
  filters: ExceptionConsoleFilters = {},
): Promise<ExceptionConsoleResult> {
  const { data, error } = await supabase.rpc("exceptions_console_list", {
    _payload: cleanPayload(filters) as Json,
  });
  if (error) throw error;
  return data as unknown as ExceptionConsoleResult;
}

export interface ExceptionQuickViewData {
  exception: {
    id: string;
    exception_type: ShipmentExceptionType;
    status: ShipmentExceptionStatus;
    reason: string | null;
    courier_reason: string | null;
    notes: string | null;
    resolution_note: string | null;
    collected_amount: number | null;
    source: string | null;
    provider_event: string | null;
    occurred_at: string;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
  };
  shipment: {
    id: string;
    shipment_number: string;
    status: ShipmentStatus;
    tracking_number: string | null;
    external_consignment_id: string | null;
    provider_name: string | null;
    account_name: string | null;
    expected_cod: number;
    collected_amount: number | null;
  } | null;
  order: {
    id: string;
    order_number: string;
    status: string;
    customer_name: string;
    customer_phone: string;
    grand_total: number;
    due_amount: number;
  } | null;
  assignment: {
    assigned_to: string;
    assigned_name: string | null;
    assigned_at: string;
    note: string | null;
    assigned_is_mine: boolean;
  } | null;
  assignment_events: {
    id: string;
    event_type: string;
    assigned_to: string | null;
    actor_id: string | null;
    note: string | null;
    created_at: string;
  }[];
  delivery_outcome: {
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
  discrepancies: {
    id: string;
    status: string;
    discrepancy_type: string;
    difference_amount: number | null;
    created_at: string;
  }[];
  events: {
    id: string;
    event_type: string;
    message: string | null;
    from_status: string | null;
    to_status: string | null;
    created_at: string;
  }[];
  can_manage: boolean;
}

export async function getExceptionQuickView(
  exceptionId: string,
): Promise<ExceptionQuickViewData> {
  const { data, error } = await supabase.rpc("exception_quick_view", {
    _exception_id: exceptionId,
  });
  if (error) throw error;
  return data as unknown as ExceptionQuickViewData;
}
