import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type {
  DeliveryStatus,
  FulfillmentStatus,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "@/types/orders";
import type { RiskLevel, VerificationPriority, VerificationStatus } from "@/types/verification";

/**
 * Orders operations console access.
 *
 * All reads go through the controlled `orders_console_list` / `order_quick_view`
 * RPCs so pagination, filtering and aggregation happen in one server round-trip
 * and no internal cost columns are ever exposed. Bulk verification claiming
 * reuses `claim_verification_work` per order inside `bulk_claim_verification_work`,
 * so ownership rules and locking are identical to the single-order path.
 */

export const ORDER_SORTS = [
  "newest",
  "oldest",
  "total_desc",
  "total_asc",
  "updated",
  "priority",
] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export const ORDER_SORT_LABELS: Record<OrderSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  total_desc: "Highest value",
  total_asc: "Lowest value",
  updated: "Recently updated",
  priority: "Verification priority",
};

export interface OrdersConsoleFilters {
  page?: number;
  page_size?: number;
  sort?: OrderSort;
  search?: string;
  product_search?: string;
  status?: OrderStatus;
  verification_status?: VerificationStatus;
  fulfillment_status?: FulfillmentStatus;
  delivery_status?: DeliveryStatus;
  payment_status?: PaymentStatus;
  risk_level?: RiskLevel;
  verification_priority?: VerificationPriority;
  source?: OrderSource;
  store_id?: string;
  customer_id?: string;
  district?: string;
  area?: string;
  assigned_to?: string;
  has_exception?: boolean;
  has_open_return?: boolean;
  ready_for_warehouse?: boolean;
  shipping_attention?: boolean;
  attention?: boolean;
  from?: string;
  to?: string;
}

export interface OrderConsoleRow {
  id: string;
  order_number: string;
  source: OrderSource;
  status: OrderStatus;
  verification_status: VerificationStatus;
  verification_priority: VerificationPriority;
  verification_attempt_count: number;
  risk_level: RiskLevel;
  risk_reason: string | null;
  fulfillment_status: FulfillmentStatus;
  fulfillment_hold_reason: string | null;
  reservation_status: string;
  delivery_status: DeliveryStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  grand_total: number;
  paid_amount: number;
  due_amount: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  created_at: string;
  updated_at: string;
  store_id: string | null;
  store_name: string | null;
  area: string | null;
  district: string | null;
  item_lines: number;
  unit_count: number;
  first_item: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_is_mine: boolean;
  shipment_status: string | null;
  tracking_number: string | null;
  courier_name: string | null;
  open_exceptions: number;
  open_returns: number;
  ready_for_warehouse: boolean;
}

export interface OrdersConsolePage {
  total: number;
  page: number;
  page_size: number;
  sort: OrderSort;
  rows: OrderConsoleRow[];
}

export async function getOrdersConsole(
  filters: OrdersConsoleFilters = {},
): Promise<OrdersConsolePage> {
  const payload = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== "" && v !== null),
  );
  const { data, error } = await supabase.rpc("orders_console_list", {
    _payload: payload as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as OrdersConsolePage;
}

export interface QuickViewItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  line_total: number;
}

export interface OrderQuickViewData {
  order: {
    id: string;
    order_number: string;
    source: OrderSource;
    status: OrderStatus;
    verification_status: VerificationStatus;
    verification_priority: VerificationPriority;
    verification_attempt_count: number;
    risk_level: RiskLevel;
    risk_reason: string | null;
    fulfillment_status: FulfillmentStatus;
    fulfillment_hold_reason: string | null;
    reservation_status: string;
    delivery_status: DeliveryStatus;
    payment_status: PaymentStatus;
    payment_method: PaymentMethod;
    subtotal: number;
    product_discount: number;
    order_discount: number;
    shipping_charge: number;
    grand_total: number;
    paid_amount: number;
    due_amount: number;
    customer_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    store_id: string | null;
    store_name: string | null;
    created_at: string;
    updated_at: string;
  };
  address: {
    address_line: string | null;
    area: string | null;
    district: string | null;
    postal_code: string | null;
    landmark: string | null;
    contact_name: string | null;
    contact_phone: string | null;
  } | null;
  items: QuickViewItem[];
  assignment: {
    assigned_to: string;
    assigned_name: string | null;
    assigned_at: string;
    is_mine: boolean;
  } | null;
  reservations: { status: string; quantity: number }[];
  reservation_summary: {
    ordered_units: number;
    active_units: number;
    committed_units: number;
  } | null;
  fulfillments: {
    id: string;
    status: string;
    fulfillment_number: string;
    created_at: string;
    hold_reason: string | null;
    planned_units: number | null;
    picked_units: number | null;
    packed_units: number | null;
  }[];
  shipments: {
    id: string;
    shipment_number: string;
    status: string;
    tracking_number: string | null;
    external_consignment_id: string | null;
    courier_name: string | null;
    service_type: string | null;
    cash_on_delivery_amount: number | null;
    collected_amount: number | null;
    hold_reason: string | null;
    failure_reason: string | null;
    created_at: string;
  }[];
  returns: {
    id: string;
    return_number: string;
    status: string;
    return_type: string;
    created_at: string;
    is_open: boolean;
  }[];
  exceptions: {
    id: string;
    exception_type: string;
    status: string;
    description: string | null;
  }[];
  recent_notes: { id: string; note: string; note_type: string; created_at: string }[];
  customer_intelligence: QuickViewIntelligence | null;
  edit_block_reason: string | null;
  /** Null when this order can be claimed for verification; otherwise the reason. */
  verification_claim_block_reason: string | null;
  can_manage: boolean;
}

export interface QuickViewIntelligence {
  linked: boolean;
  metrics: Record<string, number | string | boolean | null> | null;
  flags: { flag: string; reason: string | null; created_at: string }[];
  recent_orders: { id: string; order_number: string }[];
}

export async function getOrderQuickView(orderId: string): Promise<OrderQuickViewData> {
  const { data, error } = await supabase.rpc("order_quick_view", { _order_id: orderId });
  if (error) throw error;
  return data as unknown as OrderQuickViewData;
}

export interface BulkClaimResult {
  succeeded: number;
  failed: number;
  results: { order_id: string; order_number: string | null; ok: boolean; error?: string }[];
}

export async function bulkClaimVerification(
  orderIds: string[],
  note?: string,
): Promise<BulkClaimResult> {
  const { data, error } = await supabase.rpc("bulk_claim_verification_work", {
    _order_ids: orderIds,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
  return data as unknown as BulkClaimResult;
}
