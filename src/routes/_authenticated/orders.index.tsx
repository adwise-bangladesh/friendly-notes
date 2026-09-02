import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, ShoppingCart } from "lucide-react";
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
import type { StatusTone } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import { getOrders } from "@/lib/orders";
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  FULFILLMENT_STATUS_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
} from "@/types/orders";
import type { DeliveryStatus, OrderStatus, PaymentStatus } from "@/types/orders";

const TITLE = "Orders · Commerce Operations";
const DESCRIPTION = "Create and track customer orders across your Bangladesh operation.";

export const Route = createFileRoute("/_authenticated/orders/")({
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

const ORDER_TONE: Record<OrderStatus, StatusTone> = {
  draft: "neutral",
  created: "info",
  cancelled: "danger",
};

const PAYMENT_TONE: Record<PaymentStatus, StatusTone> = {
  unpaid: "warning",
  partial: "warning",
  paid: "success",
  refunded: "neutral",
};

function Page() {
  const { canManage } = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus | "all">("all");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders", search, status, deliveryStatus, paymentStatus, from, to],
    queryFn: () =>
      getOrders({
        search,
        status,
        deliveryStatus,
        paymentStatus,
        ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
      }),
  });

  return (
    <>
      <PageHeader
        title="Orders"
        description={DESCRIPTION}
        actions={
          canManage ? (
            <Button asChild size="sm" className="h-8">
              <Link to="/orders/new">
                <Plus className="mr-1 h-3.5 w-3.5" /> New order
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order number, customer or phone"
          className="h-8 w-64 text-[13px]"
          aria-label="Search orders"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus | "all")}>
          <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Order status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={deliveryStatus}
          onValueChange={(v) => setDeliveryStatus(v as DeliveryStatus | "all")}
        >
          <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Delivery status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All delivery states</SelectItem>
            {DELIVERY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {DELIVERY_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={paymentStatus}
          onValueChange={(v) => setPaymentStatus(v as PaymentStatus | "all")}
        >
          <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Payment status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 w-36 text-[13px]"
          aria-label="From date"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 w-36 text-[13px]"
          aria-label="To date"
        />
      </div>

      <div className="rounded border border-border">
        {isLoading ? (
          <LoadingState rows={6} label="Loading orders" />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No orders yet"
            description="Create your first order to see it here."
            action={
              canManage ? (
                <Button asChild size="sm" className="h-8">
                  <Link to="/orders/new">New order</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Order</th>
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-left font-medium">Phone</th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-left font-medium">Payment</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Verification</th>
                  <th className="px-3 py-2 text-left font-medium">Fulfillment</th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link
                        to="/orders/$id"
                        params={{ id: o.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{o.customer_name}</td>
                    <td className="px-3 py-2 tabular-nums">{o.customer_phone}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {o.item_count?.[0]?.count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(o.grand_total))}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={PAYMENT_TONE[o.payment_status]}>
                        {PAYMENT_STATUS_LABELS[o.payment_status]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={ORDER_TONE[o.status]}>
                        {ORDER_STATUS_LABELS[o.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {VERIFICATION_STATUS_LABELS[o.verification_status]}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {FULFILLMENT_STATUS_LABELS[o.fulfillment_status]}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString()}
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
