import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { MetricCard } from "@/components/analytics/MetricCard";
import { StatList } from "@/components/analytics/StatList";
import { Badge } from "@/components/ui/badge";
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
  getInventoryAnalytics,
  getMovementSummary,
  getProductPerformance,
  getStockRisk,
  rangeFromPreset,
  type DatePresetId,
} from "@/lib/analytics";

const TITLE = "Product & Inventory Analytics · Commerce Operations";
const DESCRIPTION =
  "Best sellers, product profitability, stock value and stock risk derived from order snapshots and live inventory levels.";

export const Route = createFileRoute("/_authenticated/analytics/products")({
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
  component: ProductAnalyticsPage,
});

const RISK_LABEL: Record<string, string> = {
  out_of_stock: "Out of stock",
  low_stock: "Low stock",
  damaged_attention: "Damaged stock",
};

function ProductAnalyticsPage() {
  const [preset, setPreset] = useState<DatePresetId>("30d");
  const [storeId, setStoreId] = useState<string | null>(null);
  const range = useMemo(() => rangeFromPreset(preset), [preset]);

  const products = useQuery({
    queryKey: ["analytics", "products", preset, storeId],
    queryFn: () => getProductPerformance(range, 20, storeId),
  });
  const inventory = useQuery({
    queryKey: ["analytics", "inventory"],
    queryFn: () => getInventoryAnalytics(),
  });
  const risk = useQuery({
    queryKey: ["analytics", "stock-risk"],
    queryFn: () => getStockRisk(25),
  });
  const movements = useQuery({
    queryKey: ["analytics", "movements", preset],
    queryFn: () => getMovementSummary(range),
  });

  const inv = inventory.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product & Inventory Analytics"
        description="Sales figures use the frozen price and cost snapshots stored on each order line, so history never changes when a product is edited."
      />

      <AnalyticsFilters
        preset={preset}
        onPresetChange={setPreset}
        storeId={storeId}
        onStoreChange={setStoreId}
      />

      {inv ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Inventory value"
            value={formatMoney(inv.inventory_value)}
            hint={`${formatNumber(inv.total_on_hand)} units on hand · valued at current catalog cost`}
          />
          <MetricCard
            label="Available units"
            value={formatNumber(inv.total_available)}
            hint={`${formatNumber(inv.total_reserved)} reserved`}
          />
          <MetricCard
            label="Out of stock items"
            value={formatNumber(inv.out_of_stock_items)}
            invert
            hint={`${formatNumber(inv.low_stock_items)} low stock`}
          />
          <MetricCard
            label="Damaged value"
            value={formatMoney(inv.damaged_value)}
            invert
            hint={`${formatNumber(inv.total_damaged)} damaged units`}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Product performance</CardTitle>
          <p className="text-xs text-muted-foreground">
            Revenue and cost come from order line snapshots (order date basis). Returned units are
            accepted returns, and net figures remove them. Variants are grouped into one product row
            unless a single product is selected. Realized columns count only delivered units (minus accepted
            returns) and courier charges actually recorded, so they lag behind until couriers report.
          </p>
        </CardHeader>
        <CardContent>
          {products.isLoading ? (
            <LoadingState />
          ) : (products.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Net revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Est. profit</TableHead>
                  <TableHead className="text-right">Net profit</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Lost / damaged</TableHead>
                  <TableHead className="text-right">Realized revenue</TableHead>
                  <TableHead className="text-right">Courier cost</TableHead>
                  <TableHead className="text-right">Realized profit</TableHead>
                  <TableHead className="text-right">Margin est / real</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(products.data ?? []).map((row) => (
                  <TableRow key={`${row.product_id}:${row.variant_id ?? "all"}`}>
                    <TableCell>
                      <Link
                        to="/products/$id"
                        params={{ id: row.product_id }}
                        className="font-medium hover:underline"
                      >
                        {row.product_name}
                      </Link>
                      {!row.cost_snapshot_complete ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          cost incomplete
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.orders}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.units_ordered}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.units_returned}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.net_revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.product_cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.estimated_profit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.net_estimated_profit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.units_delivered}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.units_lost} / {row.units_damaged}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.realized_revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.courier_cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.realized_profit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.estimated_margin === null ? "—" : `${row.estimated_margin}%`} /{" "}
                      {row.realized_margin === null ? "—" : `${row.realized_margin}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Stock risk</CardTitle>
          </CardHeader>
          <CardContent>
            {risk.isLoading ? (
              <LoadingState />
            ) : (risk.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock risks right now.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead>Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(risk.data ?? []).map((row) => (
                    <TableRow key={row.level_id}>
                      <TableCell>
                        {row.product_name}
                        {row.variant_name ? (
                          <span className="text-muted-foreground"> · {row.variant_name}</span>
                        ) : null}
                        {row.variant_sku ? (
                          <span className="block text-xs text-muted-foreground">
                            {row.variant_sku}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.location_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.available}</TableCell>
                      <TableCell>
                        <Badge
                          variant={row.risk === "out_of_stock" ? "destructive" : "outline"}
                          className="text-[10px]"
                        >
                          {RISK_LABEL[row.risk] ?? row.risk}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <StatList
          title="Stock movement activity"
          description="Physical movements change stock on hand; logical movements only reserve or release it. Net shows the signed stock change, so reversals cancel out."
          rows={(movements.data ?? []).map((m) => ({
            label: `${m.movement_type.replace(/_/g, " ")} (${m.category})`,
            value: `${formatNumber(m.movements)} · ${formatNumber(m.total_quantity)} units · net ${formatNumber(m.net_quantity)}`,
          }))}
        />
      </div>
    </div>
  );
}
