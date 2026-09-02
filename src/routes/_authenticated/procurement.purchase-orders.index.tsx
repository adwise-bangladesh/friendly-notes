import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getPurchaseOrders } from "@/lib/procurement";
import { formatCurrencyAmount } from "@/lib/currency";
import {
  PO_STATUS_LABELS,
  PO_STATUS_TONE,
  PURCHASE_ORDER_STATUSES,
} from "@/types/procurement";
import type { PurchaseOrderStatus } from "@/types/procurement";

const TITLE = "Purchase Orders · Commerce Operations";
const DESCRIPTION = "Buying intent: what you ordered from suppliers and how much has arrived.";

export const Route = createFileRoute("/_authenticated/procurement/purchase-orders/")({
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
  component: Page,
});

function Page() {
  const perms = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PurchaseOrderStatus | "all">("all");

  const ordersQuery = useQuery({
    queryKey: ["purchase-orders", { status, search }],
    queryFn: () => getPurchaseOrders({ status, search }),
  });

  const rows = ordersQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        description={DESCRIPTION}
        actions={
          perms.canManage ? (
            <Button size="sm" asChild>
              <Link to="/procurement/purchase-orders/new">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Purchase Order
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO number or supplier"
            className="h-8 pl-8 text-[13px]"
            aria-label="Search purchase orders"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as PurchaseOrderStatus | "all")}>
          <SelectTrigger className="h-8 w-[190px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PURCHASE_ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PO_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {ordersQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {ordersQuery.error instanceof Error
              ? ordersQuery.error.message
              : "Failed to load purchase orders."}
          </p>
        ) : ordersQuery.isLoading ? (
          <LoadingState rows={5} label="Loading purchase orders" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No purchase orders"
            description="Raise a purchase order to buy stock from a supplier."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">PO number</th>
                  <th className="px-3 py-2 text-left font-semibold">Supplier</th>
                  <th className="px-3 py-2 text-left font-semibold">Order date</th>
                  <th className="px-3 py-2 text-left font-semibold">Expected</th>
                  <th className="px-3 py-2 text-right font-semibold">Lines</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((po) => (
                  <tr key={po.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5">
                      <Link
                        to="/procurement/purchase-orders/$id"
                        params={{ id: po.id }}
                        className="font-mono text-[12.5px] text-primary hover:underline"
                      >
                        {po.purchase_order_number}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">{po.supplier?.name ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{po.order_date}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {po.expected_delivery_date ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {po.item_count?.[0]?.count ?? 0}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCurrencyAmount(po.grand_total, po.currency)}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={PO_STATUS_TONE[po.status]}>
                        {PO_STATUS_LABELS[po.status]}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
