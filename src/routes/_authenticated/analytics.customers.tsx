import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { MetricCard } from "@/components/analytics/MetricCard";
import { TrendChart } from "@/components/analytics/TrendChart";
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
  getCustomerAnalytics,
  getCustomerTrend,
  getTopCustomers,
  percentChange,
  previousRange,
  rangeFromPreset,
  suggestGrain,
  type DatePresetId,
} from "@/lib/analytics";
import type { AnalyticsGrain } from "@/types/analytics";

const TITLE = "Customer Analytics · Commerce Operations";
const DESCRIPTION =
  "Customer acquisition, repeat purchase behaviour and highest value customers derived from real order history.";

export const Route = createFileRoute("/_authenticated/analytics/customers")({
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
  component: CustomerAnalyticsPage,
});

function CustomerAnalyticsPage() {
  const [preset, setPreset] = useState<DatePresetId>("30d");
  const [grain, setGrain] = useState<AnalyticsGrain | null>(null);
  const range = useMemo(() => rangeFromPreset(preset), [preset]);
  const prev = useMemo(() => previousRange(range), [range]);
  const activeGrain = grain ?? suggestGrain(range);

  const stats = useQuery({
    queryKey: ["analytics", "customers", preset],
    queryFn: () => getCustomerAnalytics(range),
  });
  const baseline = useQuery({
    queryKey: ["analytics", "customers-prev", preset],
    queryFn: () => getCustomerAnalytics(prev),
  });
  const top = useQuery({
    queryKey: ["analytics", "top-customers", preset],
    queryFn: () => getTopCustomers(range, 10),
  });
  const trend = useQuery({
    queryKey: ["analytics", "customer-trend", preset, activeGrain],
    queryFn: () => getCustomerTrend(range, activeGrain),
  });

  const c = stats.data;
  const p = baseline.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Analytics"
        description="Derived from the existing customer records and their order history. No separate customer statistics are stored."
      />

      <AnalyticsFilters
        preset={preset}
        onPresetChange={setPreset}
        grain={activeGrain}
        onGrainChange={setGrain}
      />

      {stats.isLoading ? (
        <LoadingState />
      ) : c ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Active customers"
              value={formatNumber(c.active_customers)}
              change={p ? percentChange(c.active_customers, p.active_customers) : null}
            />
            <MetricCard
              label="New customers"
              value={formatNumber(c.new_customers)}
              change={p ? percentChange(c.new_customers, p.new_customers) : null}
            />
            <MetricCard
              label="Repeat customers"
              value={formatNumber(c.repeat_customers)}
              hint={`${formatNumber(c.returning_customers)} returning from earlier periods`}
            />
            <MetricCard
              label="Avg customer value"
              value={formatMoney(c.avg_customer_value)}
              hint={`${c.avg_orders_per_customer ?? "—"} orders per customer`}
            />
            <MetricCard label="Orders placed" value={formatNumber(c.orders)} />
            <MetricCard
              label="Cancellation rate"
              value={formatPercent(c.cancellation_rate)}
              invert
            />
            <MetricCard label="Blocked customers" value={formatNumber(c.blocked_customers)} invert />
          </div>

          <TrendChart
            title="Acquisition and activity"
            data={(trend.data ?? []).map((pt) => ({
              bucket: pt.bucket,
              newCustomers: Number(pt.new_customers),
              active: Number(pt.active_customers),
            }))}
            series={[
              { key: "newCustomers", label: "New customers", color: "hsl(var(--primary))" },
              { key: "active", label: "Ordering customers", color: "hsl(142 71% 45%)" },
            ]}
            valueFormatter={(v) => formatNumber(v)}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Highest value customers</CardTitle>
            </CardHeader>
            <CardContent>
              {top.isLoading ? (
                <LoadingState />
              ) : (top.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No customer orders in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Returned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(top.data ?? []).map((row) => (
                      <TableRow key={row.customer_id}>
                        <TableCell>
                          <Link
                            to="/customers/$id"
                            params={{ id: row.customer_id }}
                            className="font-medium hover:underline"
                          >
                            {row.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.phone}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.orders}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.delivered_orders}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.returned_orders}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
