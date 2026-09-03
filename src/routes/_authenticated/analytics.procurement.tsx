import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { MetricCard } from "@/components/analytics/MetricCard";
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
  getProcurementAnalytics,
  getPurchasedProducts,
  getSupplierSpend,
  percentChange,
  previousRange,
  rangeFromPreset,
  type DatePresetId,
} from "@/lib/analytics";

const TITLE = "Procurement Analytics · Commerce Operations";
const DESCRIPTION =
  "Supplier spend, receiving accuracy and lead times derived from purchase orders and goods receipts.";

export const Route = createFileRoute("/_authenticated/analytics/procurement")({
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
  component: ProcurementAnalyticsPage,
});

function ProcurementAnalyticsPage() {
  const [preset, setPreset] = useState<DatePresetId>("90d");
  const range = useMemo(() => rangeFromPreset(preset), [preset]);
  const prev = useMemo(() => previousRange(range), [range]);

  const stats = useQuery({
    queryKey: ["analytics", "procurement", preset],
    queryFn: () => getProcurementAnalytics(range),
  });
  const baseline = useQuery({
    queryKey: ["analytics", "procurement-prev", preset],
    queryFn: () => getProcurementAnalytics(prev),
  });
  const suppliers = useQuery({
    queryKey: ["analytics", "supplier-spend", preset],
    queryFn: () => getSupplierSpend(range, 10),
  });
  const purchased = useQuery({
    queryKey: ["analytics", "purchased-products", preset],
    queryFn: () => getPurchasedProducts(range, 10),
  });

  const s = stats.data;
  const p = baseline.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement Analytics"
        description="Only submitted purchase orders and finalised, non-reversed goods receipts are counted."
      />

      <AnalyticsFilters preset={preset} onPresetChange={setPreset} />

      {stats.isLoading ? (
        <LoadingState />
      ) : s ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Procurement value"
              value={formatMoney(s.procurement_value)}
              change={p ? percentChange(s.procurement_value, p.procurement_value) : null}
              hint={`${formatNumber(s.purchase_orders_created)} purchase orders`}
            />
            <MetricCard
              label="Received value"
              value={formatMoney(s.received_value)}
              hint={`${formatNumber(s.goods_receipts)} goods receipts`}
            />
            <MetricCard
              label="Completion rate"
              value={formatPercent(s.completion_rate)}
              hint={`${formatNumber(s.purchase_orders_partially_received)} partially received`}
            />
            <MetricCard
              label="Avg lead time"
              value={s.avg_lead_time_days ? `${s.avg_lead_time_days} days` : "—"}
              hint={`${formatNumber(s.lead_time_sample)} receipts measured`}
            />
            <MetricCard label="Quantity ordered" value={formatNumber(s.quantity_ordered)} />
            <MetricCard label="Quantity accepted" value={formatNumber(s.quantity_received)} />
            <MetricCard label="Quantity damaged" value={formatNumber(s.quantity_damaged)} invert />
            <MetricCard
              label="Cancelled purchase orders"
              value={formatNumber(s.purchase_orders_cancelled)}
              invert
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Supplier spend</CardTitle>
            </CardHeader>
            <CardContent>
              {suppliers.isLoading ? (
                <LoadingState />
              ) : (suppliers.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchase orders in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">POs</TableHead>
                      <TableHead className="text-right">Ordered value</TableHead>
                      <TableHead className="text-right">Received value</TableHead>
                      <TableHead className="text-right">Qty ordered</TableHead>
                      <TableHead className="text-right">Qty accepted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(suppliers.data ?? []).map((row) => (
                      <TableRow key={row.supplier_id}>
                        <TableCell>
                          <Link
                            to="/suppliers/$id"
                            params={{ id: row.supplier_id }}
                            className="font-medium hover:underline"
                          >
                            {row.supplier_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.purchase_orders}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.ordered_value)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.received_value)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.quantity_ordered}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.quantity_received}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Most purchased products</CardTitle>
            </CardHeader>
            <CardContent>
              {purchased.isLoading ? (
                <LoadingState />
              ) : (purchased.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchased products.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qty ordered</TableHead>
                      <TableHead className="text-right">Qty received</TableHead>
                      <TableHead className="text-right">Ordered value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(purchased.data ?? []).map((row) => (
                      <TableRow key={row.variant_id ?? row.product_id ?? row.product_name}>
                        <TableCell>{row.product_name}</TableCell>
                        <TableCell className="text-muted-foreground">{row.sku ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.quantity_ordered}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.quantity_received}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.ordered_value)}
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
