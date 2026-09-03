import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { MetricCard } from "@/components/analytics/MetricCard";
import { TrendChart } from "@/components/analytics/TrendChart";
import { StatList } from "@/components/analytics/StatList";
import { formatMoney } from "@/lib/currency";
import {
  formatNumber,
  formatPercent,
  getOverview,
  getProfitability,
  getSalesTrend,
  percentChange,
  previousRange,
  rangeFromPreset,
  suggestGrain,
  type DatePresetId,
} from "@/lib/analytics";
import type { AnalyticsGrain } from "@/types/analytics";

const TITLE = "Business Analytics · Commerce Operations";
const DESCRIPTION =
  "Revenue, profitability and order performance derived directly from live order, shipment and financial records.";

export const Route = createFileRoute("/_authenticated/analytics/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsOverviewPage,
});

function AnalyticsOverviewPage() {
  const [preset, setPreset] = useState<DatePresetId>("30d");
  const [source, setSource] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const range = useMemo(() => rangeFromPreset(preset), [preset]);
  const prev = useMemo(() => previousRange(range), [range]);
  const [grain, setGrain] = useState<AnalyticsGrain | null>(null);
  const activeGrain = grain ?? suggestGrain(range);

  const overview = useQuery({
    queryKey: ["analytics", "overview", preset, source, storeId],
    queryFn: () => getOverview(range, source, storeId),
  });
  const baseline = useQuery({
    queryKey: ["analytics", "overview-prev", preset, source, storeId],
    queryFn: () => getOverview(prev, source, storeId),
  });
  const profit = useQuery({
    queryKey: ["analytics", "profitability", preset, storeId],
    queryFn: () => getProfitability(range, storeId),
  });
  const trend = useQuery({
    queryKey: ["analytics", "sales-trend", preset, activeGrain, source, storeId],
    queryFn: () => getSalesTrend(range, activeGrain, source, storeId),
  });

  const o = overview.data;
  const p = baseline.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Analytics"
        description="All figures are derived from the authoritative order, shipment, return and financial records. Order-value metrics use the order date; delivery and collection metrics use the delivery date."
      />

      <AnalyticsFilters
        preset={preset}
        onPresetChange={setPreset}
        grain={activeGrain}
        onGrainChange={setGrain}
        source={source}
        onSourceChange={setSource}
        storeId={storeId}
        onStoreChange={setStoreId}
      />

      {overview.isLoading ? (
        <LoadingState />
      ) : overview.isError ? (
        <p className="text-sm text-destructive">
          {(overview.error as Error).message ?? "Unable to load analytics."}
        </p>
      ) : o ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Order value placed"
              value={formatMoney(o.order_revenue)}
              change={p ? percentChange(o.order_revenue, p.order_revenue) : null}
              hint={`${formatNumber(o.live_orders)} live orders · by order date`}
            />
            <MetricCard
              label="Delivered merchandise value"
              value={formatMoney(o.delivered_merchandise_value)}
              change={
                p
                  ? percentChange(o.delivered_merchandise_value, p.delivered_merchandise_value)
                  : null
              }
              hint={`${formatNumber(o.fully_delivered_orders)} fully · ${formatNumber(
                o.partially_delivered_orders,
              )} partly delivered · by delivery date`}
            />
            <MetricCard
              label="Cash collected"
              value={formatMoney(o.collected_revenue)}
              change={p ? percentChange(o.collected_revenue, p.collected_revenue) : null}
              hint="Recorded courier collections on this order cohort"
            />
            <MetricCard
              label="Net collected"
              value={formatMoney(o.net_collected_revenue)}
              change={p ? percentChange(o.net_collected_revenue, p.net_collected_revenue) : null}
              hint={`After ${formatMoney(o.refunded_amount)} refunded`}
            />
            <MetricCard
              label="Estimated profit"
              value={formatMoney(o.estimated_profit)}
              change={p ? percentChange(o.estimated_profit, p.estimated_profit) : null}
              hint={`Margin ${formatPercent(o.profit_margin)} · by order date`}
              badge="estimated"
            />
            <MetricCard
              label="Actual profit (settled)"
              value={formatMoney(o.actual_profit)}
              change={p ? percentChange(o.actual_profit, p.actual_profit) : null}
              hint={`Orders with a delivery in this period · ${o.completeness.actual} of ${o.live_orders} placed orders fully reconciled`}
              badge="actual"
            />
            <MetricCard
              label="Average order value"
              value={formatMoney(o.average_order_value)}
              change={
                p && p.average_order_value !== null && o.average_order_value !== null
                  ? percentChange(o.average_order_value, p.average_order_value)
                  : null
              }
            />
            <MetricCard
              label="Delivery success rate"
              value={formatPercent(o.delivery_success_rate)}
              hint={`${formatNumber(o.shipments_delivered)} of ${formatNumber(o.shipments)} shipments`}
            />
            <MetricCard
              label="Cancelled orders"
              value={formatNumber(o.cancelled_orders)}
              invert
              change={p ? percentChange(o.cancelled_orders, p.cancelled_orders) : null}
              hint={`${formatMoney(o.cancelled_revenue)} lost value`}
            />
            <MetricCard
              label="Return rate"
              value={formatPercent(o.return_rate)}
              invert
              hint={`${formatNumber(o.new_customers)} new / ${formatNumber(o.repeat_customers)} repeat customers`}
            />
          </div>

          {profit.data ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard
                  label="Estimated profit (period)"
                  value={formatMoney(profit.data.estimated_profit)}
                  hint="Frozen order-line price and cost snapshots"
                  badge="estimated"
                />
                <MetricCard
                  label="Realized profit (period)"
                  value={formatMoney(profit.data.realized_profit)}
                  hint={`${formatNumber(profit.data.orders_reconciled)} of ${formatNumber(profit.data.orders)} orders reconciled`}
                  badge="actual"
                />
                <MetricCard
                  label="Estimate vs actual gap"
                  value={formatMoney(profit.data.profit_difference)}
                  invert
                  hint={`${formatMoney(profit.data.open_discrepancy_amount)} still disputed with couriers`}
                />
                <MetricCard
                  label="Loss on returns"
                  value={formatMoney(profit.data.return_loss)}
                  invert
                  hint={`${formatNumber(profit.data.returned_units)} accepted return units`}
                />
                <MetricCard
                  label="Courier charges"
                  value={formatMoney(profit.data.courier_charges)}
                  invert
                  hint={`Refunds ${formatMoney(profit.data.refunds)}`}
                />
                <MetricCard
                  label="Lost & damaged units"
                  value={formatNumber(profit.data.lost_units + profit.data.damaged_units)}
                  invert
                  hint={`${formatNumber(profit.data.delivered_units)} delivered · ${formatNumber(profit.data.refused_units)} refused`}
                />
              </div>

              <StatList
                title="Estimated vs realized"
                description="Estimated comes from order snapshots. Realized only counts money actually collected and courier charges actually recorded."
                rows={[
                  { label: "Estimated revenue", value: formatMoney(profit.data.estimated_revenue) },
                  { label: "Realized revenue", value: formatMoney(profit.data.realized_revenue) },
                  {
                    label: "Estimated product cost",
                    value: formatMoney(profit.data.estimated_product_cost),
                  },
                  {
                    label: "Realized product cost",
                    value: formatMoney(profit.data.realized_product_cost),
                  },
                  {
                    label: "Awaiting reconciliation",
                    value: formatNumber(profit.data.orders_pending_reconciliation),
                  },
                ]}
              />
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {trend.isLoading ? (
                <LoadingState />
              ) : (
                <TrendChart
                  title="Revenue trend"
                  description="Order value is counted once per order on the day it was placed. Delivered merchandise value counts only quantities on fully delivered shipments, on the delivery date."
                  data={(trend.data ?? []).map((pt) => ({
                    bucket: pt.bucket,
                    revenue: Number(pt.revenue),
                    delivered: Number(pt.delivered_revenue),
                    cancelled: Number(pt.cancelled_revenue),
                  }))}
                  series={[
                    { key: "revenue", label: "Order revenue", color: "hsl(var(--primary))" },
                    { key: "delivered", label: "Delivered merchandise", color: "hsl(142 71% 45%)" },
                    { key: "cancelled", label: "Cancelled", color: "hsl(var(--destructive))" },
                  ]}
                  valueFormatter={(v) => formatMoney(v)}
                />
              )}
            </div>

            <StatList
              title="Financial data quality"
              description="Profitability is only 'actual' once every shipment on the order has recorded collections and courier charges."
              rows={[
                { label: "Fully reconciled orders", value: formatNumber(o.completeness.actual) },
                {
                  label: "Partially reconciled",
                  value: formatNumber(o.completeness.partially_actual),
                },
                { label: "Estimated only", value: formatNumber(o.completeness.estimated) },
                { label: "Failed shipments", value: formatNumber(o.shipments_failed) },
                { label: "Total orders (incl. cancelled)", value: formatNumber(o.total_orders) },
              ]}
            />
          </div>

          {trend.data && trend.data.length > 0 ? (
            <TrendChart
              title="Order volume"
              data={trend.data.map((pt) => ({ bucket: pt.bucket, orders: Number(pt.orders) }))}
              series={[{ key: "orders", label: "Orders", color: "hsl(var(--primary))" }]}
              valueFormatter={(v) => formatNumber(v)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
