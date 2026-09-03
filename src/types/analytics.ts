/**
 * Analytics types.
 *
 * Every shape here mirrors a database function that DERIVES its numbers from
 * the authoritative operational tables (orders, order items, shipments,
 * returns, adjustments, inventory, procurement). Nothing is stored, cached or
 * counted twice — the database is always the single source of truth.
 */

export type AnalyticsGrain = "day" | "week" | "month";

export type FinancialCompleteness = "estimated" | "partially_actual" | "actual";

export interface AnalyticsOverview {
  total_orders: number;
  live_orders: number;
  cancelled_orders: number;
  /** Value of orders placed in the period (order cohort basis, cancelled excluded). */
  order_revenue: number;
  cancelled_revenue: number;
  /** Merchandise value actually delivered in the period (delivery-date basis). */
  delivered_merchandise_value: number;
  /** Alias of `delivered_merchandise_value`, kept for existing callers. */
  delivered_revenue: number;
  fully_delivered_orders: number;
  partially_delivered_orders: number;
  /** Fully delivered orders only. */
  delivered_orders: number;
  /** Cash actually collected on the order cohort (from the financial rollup). */
  collected_revenue: number;
  refunded_amount: number;
  net_collected_revenue: number;
  estimated_profit: number;
  actual_profit: number;
  profit_margin: number | null;
  average_order_value: number | null;
  completeness: Record<FinancialCompleteness, number>;
  shipments: number;
  shipments_delivered: number;
  shipments_failed: number;
  delivery_success_rate: number | null;
  return_rate: number | null;
  new_customers: number;
  repeat_customers: number;
}

export interface SalesTrendPoint {
  bucket: string;
  orders: number;
  revenue: number;
  discounts: number;
  shipping: number;
  net_product_revenue: number;
  cancelled_revenue: number;
  delivered_revenue: number;
  average_order_value: number | null;
}

export interface AnalyticsOrders {
  created: number;
  cancelled: number;
  partially_delivered: number;
  verified: number;
  fulfilled: number;
  fulfillment_in_progress: number;
  shipped: number;
  delivered: number;
  returned: number;
  with_exceptions: number;
  by_source: Record<string, number>;
  verification: {
    total: number;
    confirmed: number;
    manual_review: number;
    unreachable: number;
    failed: number;
    pending: number;
    callbacks: number;
    avg_attempts_per_confirmed: number | null;
    attempt_outcomes: Record<string, number>;
    attempts: number;
  };
}

export interface AnalyticsDelivery {
  shipments: number;
  delivered: number;
  partial_delivered: number;
  failed: number;
  returned: number;
  in_flight: number;
  success_rate: number | null;
  failure_rate: number | null;
  return_rate: number | null;
  partial_rate: number | null;
  avg_delivery_hours: number | null;
  delivery_time_sample: number;
}

export interface CourierPerformanceRow {
  provider_id: string | null;
  provider_name: string | null;
  account_id: string | null;
  account_name: string | null;
  shipments: number;
  delivered: number;
  partial: number;
  failed: number;
  returned: number;
  avg_delivery_hours: number | null;
  avg_estimated_cost: number | null;
  avg_actual_cost: number | null;
  shipments_with_actual_cost: number;
  settlement_difference: number | null;
}

export interface AnalyticsCustomers {
  active_customers: number;
  new_customers: number;
  repeat_customers: number;
  returning_customers: number;
  orders: number;
  avg_orders_per_customer: number | null;
  avg_customer_value: number | null;
  blocked_customers: number;
  cancellation_rate: number | null;
}

export interface TopCustomerRow {
  customer_id: string;
  name: string;
  phone: string;
  orders: number;
  revenue: number;
  delivered_orders: number;
  returned_orders: number;
}

export interface CustomerTrendPoint {
  bucket: string;
  new_customers: number;
  active_customers: number;
}

export interface ProductPerformanceRow {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  units_ordered: number;
  units_returned: number;
  revenue: number;
  /** Merchandise value of accepted returns, priced from the order lines. */
  returned_value: number;
  net_revenue: number;
  product_cost: number;
  estimated_profit: number;
  /** Profit after removing returned units and recovering their cost. */
  net_estimated_profit: number;
  orders: number;
  cost_snapshot_complete: boolean;
  /** True when variants of a product are aggregated into one row. */
  variants_grouped: boolean;
}

export interface AnalyticsInventory {
  /** Which cost basis `inventory_value` uses. */
  valuation_basis: "current_catalog_cost";
  tracked_items: number;
  total_on_hand: number;
  total_available: number;
  total_reserved: number;
  total_damaged: number;
  total_incoming: number;
  inventory_value: number;
  damaged_value: number;
  items_without_cost: number;
  low_stock_items: number;
  out_of_stock_items: number;
  in_transit_units: number;
}

export interface StockRiskRow {
  level_id: string;
  product_id: string;
  product_name: string;
  variant_name: string | null;
  location_name: string;
  on_hand: number;
  available: number;
  damaged: number;
  incoming: number;
  threshold: number;
  risk: "out_of_stock" | "low_stock" | "damaged";
}

export interface MovementSummaryRow {
  movement_type: string;
  /** `physical` moves real stock; `logical` only reserves or releases it. */
  category: "physical" | "logical";
  movements: number;
  /** Operational volume: absolute quantity touched. */
  total_quantity: number;
  /** Net stock change: signed quantity, so reversals cancel out. */
  net_quantity: number;
}

export interface AnalyticsProcurement {
  /** Every non-draft purchase order raised in the period. */
  purchase_orders_created: number;
  /** Non-draft, non-cancelled purchase orders — the basis for every value below. */
  purchase_orders_effective: number;
  purchase_orders_received: number;
  purchase_orders_partially_received: number;
  purchase_orders_cancelled: number;
  /** Value of effective purchase orders; cancelled value is reported separately. */
  procurement_value: number;
  cancelled_value: number;
  completion_rate: number | null;
  partial_receiving_rate: number | null;
  goods_receipts: number;
  quantity_ordered: number;
  quantity_cancelled: number;
  quantity_received: number;
  quantity_damaged: number;
  quantity_outstanding: number;
  received_value: number;
  avg_lead_time_days: number | null;
  lead_time_sample: number;
}

export interface SupplierSpendRow {
  supplier_id: string;
  supplier_name: string;
  purchase_orders: number;
  ordered_value: number;
  received_value: number;
  quantity_ordered: number;
  quantity_received: number;
}

export interface PurchasedProductRow {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  quantity_ordered: number;
  quantity_received: number;
  ordered_value: number;
}

export interface OperationsTrendPoint {
  bucket: string;
  exceptions: number;
  returns: number;
  failed_deliveries: number;
  verification_failures: number;
  stock_adjustments: number;
}
