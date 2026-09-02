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
  const range = useMemo(() => rangeFromPreset(preset), [preset]);
  const prev = useMemo(() => previousRange(range), [range]);
  const [grain, setGrain] = useState<AnalyticsGrain | null>(null);
  const activeGrain = grain ?? suggestGrain(range);

  const overview = useQuery({
    queryKey: ["analytics", "overview", preset, source],
    queryFn: () => getOverview(range, source),
  });
  const baseline = useQuery({
    queryKey: ["analytics", "overview-prev", preset, source],
    queryFn: () => getOverview(prev, source),
  });
  const trend = useQuery({
    queryKey: ["analytics", "sales-trend", preset, activeGrain, source],
    queryFn: () => getSalesTrend(range, activeGrain, source),
  });

  const o = overview.data;
  const p = baseline.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Analytics"
        description="All figures are derived from the authoritative order, shipment, return and financial records — nothing is stored separately or estimated."
      />

      <AnalyticsFilters
        preset={preset}
        onPresetChange={setPreset}
        grain={activeGrain}
        onGrainChange={setGrain}
        source={source}
        onSourceChange={setSource}
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
              label="Order revenue"
              value={formatMoney(o.order_revenue)}
              change={p ? percentChange(o.order_revenue, p.order_revenue) : null}
              hint={`${formatNumber(o.live_orders)} live orders`}
            />
            <MetricCard
              label="Delivered revenue"
              value={formatMoney(o.delivered_revenue)}
              change={p ? percentChange(o.delivered_revenue, p.delivered_revenue) : null}
              hint={`${formatNumber(o.delivered_orders)} delivered orders`}
            />
            <MetricCard
              label="Estimated profit"
              value={formatMoney(o.estimated_profit)}
              change={p ? percentChange(o.estimated_profit, p.estimated_profit) : null}
              hint={`Margin ${formatPercent(o.profit_margin)}`}
              badge="estimated"
            />
            <MetricCard
              label="Actual profit (settled)"
              value={formatMoney(o.actual_profit)}
              change={p ? percentChange(o.actual_profit, p.actual_profit) : null}
              hint={`${o.completeness.actual} of ${o.live_orders} orders fully reconciled`}
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

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {trend.isLoading ? (
                <LoadingState />
              ) : (
                <TrendChart
                  title="Revenue trend"
                  description="Order revenue is counted once per order on the day it was placed; delivered revenue is counted on the delivery date."
                  data={(trend.data ?? []).map((pt) => ({
                    bucket: pt.bucket,
                    revenue: Number(pt.revenue),
                    delivered: Number(pt.delivered_revenue),
                    cancelled: Number(pt.cancelled_revenue),
                  }))}
                  series={[
                    { key: "revenue", label: "Order revenue", color: "hsl(var(--primary))" },
                    { key: "delivered", label: "Delivered revenue", color: "hsl(142 71% 45%)" },
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
