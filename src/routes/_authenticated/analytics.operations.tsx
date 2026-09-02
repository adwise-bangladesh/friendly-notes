import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { MetricCard } from "@/components/analytics/MetricCard";
import { TrendChart } from "@/components/analytics/TrendChart";
import { StatList } from "@/components/analytics/StatList";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/currency";
import {
  formatNumber,
  formatPercent,
  getCourierPerformance,
  getDeliveryAnalytics,
  getOperationsTrend,
  getOrderAnalytics,
  rangeFromPreset,
  suggestGrain,
  type DatePresetId,
} from "@/lib/analytics";
import type { AnalyticsGrain } from "@/types/analytics";

const TITLE = "Order & Delivery Analytics · Commerce Operations";
const DESCRIPTION =
  "Order funnel, verification effectiveness, delivery outcomes and courier performance derived from live operational records.";

export const Route = createFileRoute("/_authenticated/analytics/operations")({
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
  component: OperationsAnalyticsPage,
});

function OperationsAnalyticsPage() {
  const [preset, setPreset] = useState<DatePresetId>("30d");
  const [source, setSource] = useState<string | null>(null);
  const [grain, setGrain] = useState<AnalyticsGrain | null>(null);
  const range = useMemo(() => rangeFromPreset(preset), [preset]);
  const activeGrain = grain ?? suggestGrain(range);

  const orders = useQuery({
    queryKey: ["analytics", "orders", preset, source],
    queryFn: () => getOrderAnalytics(range, source),
  });
  const delivery = useQuery({
    queryKey: ["analytics", "delivery", preset],
    queryFn: () => getDeliveryAnalytics(range),
  });
  const couriers = useQuery({
    queryKey: ["analytics", "couriers", preset],
    queryFn: () => getCourierPerformance(range),
  });
  const trend = useQuery({
    queryKey: ["analytics", "ops-trend", preset, activeGrain],
    queryFn: () => getOperationsTrend(range, activeGrain),
  });

  const o = orders.data;
  const d = delivery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Order & Delivery Analytics"
        description="Historical outcome patterns. The live queue stays in the Operations Command Center."
      />

      <AnalyticsFilters
        preset={preset}
        onPresetChange={setPreset}
        grain={activeGrain}
        onGrainChange={setGrain}
        source={source}
        onSourceChange={setSource}
      />

      {orders.isLoading || delivery.isLoading ? (
        <LoadingState />
      ) : (
        <>
          {o ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Order funnel</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Each stage counts distinct orders created in this period, so multi-shipment orders
                  are never counted twice.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Created", o.created],
                  ["Verified", o.verified],
                  ["Packed", o.fulfilled],
                  ["Shipped", o.shipped],
                  ["Delivered", o.delivered],
                  ["Returned", o.returned],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded border border-border p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {label as string}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatNumber(value as number)}
                    </p>
                    {o.created > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {Math.round(((value as number) / o.created) * 1000) / 10}%
                      </p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Shipments" value={formatNumber(d?.shipments ?? 0)} />
            <MetricCard label="Delivery success" value={formatPercent(d?.success_rate ?? null)} />
            <MetricCard
              label="Failure rate"
              value={formatPercent(d?.failure_rate ?? null)}
              invert
            />
            <MetricCard
              label="Avg delivery time"
              value={d?.avg_delivery_hours ? `${d.avg_delivery_hours} h` : "—"}
              hint={`${formatNumber(d?.delivery_time_sample ?? 0)} completed deliveries measured`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {o ? (
              <StatList
                title="Verification effectiveness"
                description="Order verification outcomes and the call attempts behind them."
                rows={[
                  { label: "Orders requiring verification", value: formatNumber(o.verification.total) },
                  { label: "Confirmed", value: formatNumber(o.verification.confirmed) },
                  { label: "Manual review", value: formatNumber(o.verification.manual_review) },
                  { label: "Unreachable", value: formatNumber(o.verification.unreachable) },
                  { label: "Failed", value: formatNumber(o.verification.failed) },
                  { label: "Still pending", value: formatNumber(o.verification.pending) },
                  { label: "Total attempts logged", value: formatNumber(o.verification.attempts) },
                  ...Object.entries(o.verification.attempt_outcomes).map(([k, v]) => ({
                    label: `Attempt outcome · ${k.replace(/_/g, " ")}`,
                    value: formatNumber(v),
                  })),
                ]}
              />
            ) : null}

            {d ? (
              <StatList
                title="Delivery outcomes"
                rows={[
                  { label: "Delivered", value: formatNumber(d.delivered) },
                  { label: "Partially delivered", value: formatNumber(d.partial_delivered) },
                  { label: "Failed / lost", value: formatNumber(d.failed) },
                  { label: "Returned to sender", value: formatNumber(d.returned) },
                  { label: "Currently in flight", value: formatNumber(d.in_flight) },
                  { label: "Partial delivery rate", value: formatPercent(d.partial_rate) },
                  { label: "Courier return rate", value: formatPercent(d.return_rate) },
                ]}
              />
            ) : null}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Courier performance</CardTitle>
              <p className="text-xs text-muted-foreground">
                Split by provider and courier account, so multi-store setups stay comparable.
              </p>
            </CardHeader>
            <CardContent>
              {couriers.isLoading ? (
                <LoadingState />
              ) : (couriers.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No shipments in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Courier</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Shipments</TableHead>
                      <TableHead className="text-right">Success</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">Avg hours</TableHead>
                      <TableHead className="text-right">Avg quoted</TableHead>
                      <TableHead className="text-right">Avg actual</TableHead>
                      <TableHead className="text-right">Cost variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(couriers.data ?? []).map((row) => {
                      const success =
                        row.shipments > 0
                          ? Math.round(((row.delivered + row.partial) / row.shipments) * 1000) / 10
                          : null;
                      return (
                        <TableRow key={`${row.provider_id}-${row.account_id}`}>
                          <TableCell>{row.provider_name ?? "Unassigned"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.account_name ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.shipments}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(success)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.failed}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.avg_delivery_hours ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.avg_estimated_cost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.avg_actual_cost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.shipments_with_actual_cost > 0
                              ? formatMoney(row.settlement_difference)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <TrendChart
            title="Operational issue trend"
            description="Exceptions, returns, failed deliveries, verification failures and manual stock adjustments over time."
            data={(trend.data ?? []).map((pt) => ({
              bucket: pt.bucket,
              exceptions: Number(pt.exceptions),
              returns: Number(pt.returns),
              failed: Number(pt.failed_deliveries),
              verification: Number(pt.verification_failures),
              adjustments: Number(pt.stock_adjustments),
            }))}
            series={[
              { key: "exceptions", label: "Exceptions", color: "hsl(var(--destructive))" },
              { key: "returns", label: "Returns", color: "hsl(38 92% 50%)" },
              { key: "failed", label: "Failed deliveries", color: "hsl(var(--primary))" },
              { key: "verification", label: "Verification failures", color: "hsl(262 83% 58%)" },
              { key: "adjustments", label: "Stock adjustments", color: "hsl(142 71% 45%)" },
            ]}
            valueFormatter={(v) => formatNumber(v)}
          />
        </>
      )}
    </div>
  );
}
