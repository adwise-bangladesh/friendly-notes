import { supabase } from "@/integrations/supabase/client";
import type {
  AnalyticsCustomers,
  AnalyticsDelivery,
  AnalyticsGrain,
  AnalyticsInventory,
  AnalyticsOrders,
  AnalyticsOverview,
  AnalyticsProcurement,
  CourierPerformanceRow,
  CustomerTrendPoint,
  MovementSummaryRow,
  OperationsTrendPoint,
  ProductPerformanceRow,
  PurchasedProductRow,
  SalesTrendPoint,
  StockRiskRow,
  SupplierSpendRow,
  TopCustomerRow,
} from "@/types/analytics";
import type { ProfitabilitySummary } from "@/types/finance";

/**
 * Analytics data access.
 *
 * Rules that this module and the underlying SQL both honour:
 *  - Nothing is invented: every number comes from the authoritative tables.
 *  - No summary counters are stored, so figures cannot drift.
 *  - Financial values are gated in the database by `can_read_commerce`, so
 *    permissions behave exactly like the rest of the finance surfaces.
 *  - Revenue is aggregated per order, delivery per shipment line, so
 *    multi-shipment orders can never double count revenue.
 *
 * Date basis of the headline metrics (the database decides, never the client):
 *  - Order revenue, estimated profit, collected/refunded/net money and the
 *    completeness breakdown use the ORDER CREATION date (cohort basis).
 *  - Delivered merchandise value and actual profit use the SHIPMENT DELIVERY
 *    date, and only quantities on fully delivered shipments count.
 *  - Procurement uses purchase order creation and goods receipt dates.
 *
 * Store attribution uses `orders.store_id`. Sales channel accounts hang off a
 * store but are NOT recorded on the order, so channel-level analytics is not
 * available from the current schema — store level is the finest attribution.
 */

export const DATE_PRESETS = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "365d", label: "Last 12 months", days: 365 },
] as const;

export type DatePresetId = (typeof DATE_PRESETS)[number]["id"];

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeFromPreset(preset: DatePresetId, now = new Date()): DateRange {
  const days = DATE_PRESETS.find((p) => p.id === preset)?.days ?? 30;
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/** Immediately preceding window of identical length, for comparisons. */
export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span),
    to: new Date(range.from.getTime()),
  };
}

export function suggestGrain(range: DateRange): AnalyticsGrain {
  const days = (range.to.getTime() - range.from.getTime()) / 86_400_000;
  if (days > 180) return "month";
  if (days > 45) return "week";
  return "day";
}

/** Percentage change between two values, null when a baseline is unavailable. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function args(range: DateRange) {
  return { _from: range.from.toISOString(), _to: range.to.toISOString() };
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  // The RPC list is generated from the database, but this helper is shared by
  // every analytics call, so the name is passed through as a typed key.
  const { data, error } = await supabase.rpc(
    name as Parameters<typeof supabase.rpc>[0],
    params as never,
  );
  if (error) throw error;
  return data as unknown as T;
}

export function getOverview(range: DateRange, source?: string | null, storeId?: string | null) {
  return rpc<AnalyticsOverview>("analytics_overview", {
    ...args(range),
    _source: source ?? null,
    _store_id: storeId ?? null,
  });
}

export function getSalesTrend(
  range: DateRange,
  grain: AnalyticsGrain,
  source?: string | null,
  storeId?: string | null,
) {
  return rpc<SalesTrendPoint[]>("analytics_sales_trend", {
    ...args(range),
    _grain: grain,
    _source: source ?? null,
    _store_id: storeId ?? null,
  });
}

export function getOrderAnalytics(range: DateRange, source?: string | null, storeId?: string | null) {
  return rpc<AnalyticsOrders>("analytics_orders", {
    ...args(range),
    _source: source ?? null,
    _store_id: storeId ?? null,
  });
}

export function getDeliveryAnalytics(range: DateRange) {
  return rpc<AnalyticsDelivery>("analytics_delivery", args(range));
}

export function getCourierPerformance(range: DateRange) {
  return rpc<CourierPerformanceRow[]>("analytics_courier_performance", {
    ...args(range),
    _provider_id: null,
    _account_id: null,
  });
}

export function getCustomerAnalytics(range: DateRange) {
  return rpc<AnalyticsCustomers>("analytics_customers", args(range));
}

export function getTopCustomers(range: DateRange, limit = 10) {
  return rpc<TopCustomerRow[]>("analytics_top_customers", { ...args(range), _limit: limit });
}

export function getCustomerTrend(range: DateRange, grain: AnalyticsGrain) {
  return rpc<CustomerTrendPoint[]>("analytics_customer_trend", { ...args(range), _grain: grain });
}

export function getProductPerformance(
  range: DateRange,
  limit = 20,
  storeId?: string | null,
  productId?: string | null,
) {
  return rpc<ProductPerformanceRow[]>("analytics_product_performance", {
    ...args(range),
    _limit: limit,
    _product_id: productId ?? null,
    _store_id: storeId ?? null,
  });
}

export function getInventoryAnalytics() {
  return rpc<AnalyticsInventory>("analytics_inventory", {});
}

export function getStockRisk(limit = 25) {
  return rpc<StockRiskRow[]>("analytics_stock_risk", { _limit: limit });
}

export function getMovementSummary(range: DateRange) {
  return rpc<MovementSummaryRow[]>("analytics_movement_summary", args(range));
}

export function getProcurementAnalytics(range: DateRange) {
  return rpc<AnalyticsProcurement>("analytics_procurement", args(range));
}

export function getSupplierSpend(range: DateRange, limit = 10) {
  return rpc<SupplierSpendRow[]>("analytics_supplier_spend", { ...args(range), _limit: limit });
}

export function getPurchasedProducts(range: DateRange, limit = 10) {
  return rpc<PurchasedProductRow[]>("analytics_purchased_products", {
    ...args(range),
    _limit: limit,
  });
}

export function getOperationsTrend(range: DateRange, grain: AnalyticsGrain) {
  return rpc<OperationsTrendPoint[]>("analytics_operations_trend", {
    ...args(range),
    _grain: grain,
  });
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Estimated vs realized profit for the period. Estimated uses the frozen
 * order-line snapshots; realized uses money actually collected and courier
 * charges actually recorded, so the two never share a source.
 */
export function getProfitability(range: DateRange, storeId?: string | null) {
  return rpc<ProfitabilitySummary>("analytics_profitability", {
    ...args(range),
    _store_id: storeId ?? null,
  });
}
