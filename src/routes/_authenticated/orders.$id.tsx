import { useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { StatusTone } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormSection } from "@/components/commerce/FormSection";
import { VerificationPanel } from "@/components/orders/VerificationPanel";
import { FulfillmentPanel } from "@/components/orders/FulfillmentPanel";
import { OrderFulfillmentsPanel } from "@/components/orders/OrderFulfillmentsPanel";
import { OrderShipmentsPanel } from "@/components/orders/OrderShipmentsPanel";
import { OrderReturnsPanel } from "@/components/orders/OrderReturnsPanel";

import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import { addOrderNote, cancelOrder, getOrderById } from "@/lib/orders";
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  FINANCIAL_STATUS_LABELS,
  FULFILLMENT_STATUS_LABELS,
  NOTE_TYPE_LABELS,
  ORDER_SOURCE_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
  canCancel,
  orderEditingRule,
} from "@/types/orders";
import type { OrderStatus, PaymentStatus } from "@/types/orders";
import {
  isStockCommitted,
  FULFILLMENT_STATUS_TONE,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
} from "@/types/fulfillment";

const DESCRIPTION = "Order snapshot, items, payment and operational notes.";

export const Route = createFileRoute("/_authenticated/orders/$id")({
  head: () => ({
    meta: [
      { title: "Order Details · Commerce Operations" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Order Details · Commerce Operations" },
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
  const { id } = useParams({ from: "/_authenticated/orders/$id" });
  const queryClient = useQueryClient();
  const { canManage, canRead, canDelete } = useCommercePermissions();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const { data: order, isLoading } = useQuery({
    queryKey: ["order", id],
    queryFn: () => getOrderById(id),
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      cancelOrder(
        id,
        "Cancelled from the order details page",
        !!order && isStockCommitted(order.fulfillment_status) && canDelete,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["order", id] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order cancelled");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not cancel"),
  });

  const noteMutation = useMutation({
    mutationFn: (text: string) => addOrderNote(id, text),
    onSuccess: () => {
      setNoteDraft("");
      void queryClient.invalidateQueries({ queryKey: ["order", id] });
      toast.success("Note added");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add note"),
  });

  if (isLoading) return <LoadingState rows={8} label="Loading order" />;
  if (!order) {
    return (
      <EmptyState
        title="Order not found"
        description="This order may have been removed or you do not have access."
        action={
          <Button asChild size="sm" className="h-8">
            <Link to="/orders">Back to orders</Link>
          </Button>
        }
      />
    );
  }

  const internalVisible = canRead;

  return (
    <>
      <PageHeader
        title={order.order_number}
        description={orderEditingRule(order.status)}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="h-8">
              <Link to="/orders">
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Orders
              </Link>
            </Button>
            {canManage && canCancel(order.status) && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setConfirmCancel(true)}
              >
                <Ban className="mr-1 h-3.5 w-3.5" /> Cancel order
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={ORDER_TONE[order.status]}>
          Order · {ORDER_STATUS_LABELS[order.status]}
        </StatusBadge>
        <StatusBadge tone={PAYMENT_TONE[order.payment_status]}>
          Payment · {PAYMENT_STATUS_LABELS[order.payment_status]}
        </StatusBadge>
        <StatusBadge>Verification · {VERIFICATION_STATUS_LABELS[order.verification_status]}</StatusBadge>
        <StatusBadge tone={FULFILLMENT_STATUS_TONE[order.fulfillment_status]}>
          Warehouse · {FULFILLMENT_STATUS_LABELS[order.fulfillment_status]}
        </StatusBadge>
        <StatusBadge tone={RESERVATION_STATUS_TONE[order.reservation_status]}>
          Stock · {RESERVATION_STATUS_LABELS[order.reservation_status]}
        </StatusBadge>
        <StatusBadge tone={DELIVERY_STATUS_TONE[order.delivery_status]}>
          Delivery · {DELIVERY_STATUS_LABELS[order.delivery_status]}
        </StatusBadge>
        <StatusBadge>Settlement · {FINANCIAL_STATUS_LABELS[order.financial_status]}</StatusBadge>
        <span className="text-[12px] text-muted-foreground">
          {ORDER_SOURCE_LABELS[order.source]} · {new Date(order.created_at).toLocaleString()}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSection title="Customer">
              <dl className="space-y-1 text-[13px]">
                <Item label="Name" value={order.customer_name} />
                <Item label="Phone" value={order.customer_phone} />
                <Item label="Email" value={order.customer_email ?? "—"} />
              </dl>
            </FormSection>
            <FormSection title="Shipping address">
              {order.address ? (
                <dl className="space-y-1 text-[13px]">
                  <Item label="Recipient" value={order.address.recipient_name} />
                  <Item label="Phone" value={order.address.phone} />
                  <Item label="Address" value={order.address.address_line} />
                  <Item
                    label="Area"
                    value={
                      [order.address.area, order.address.district, order.address.division]
                        .filter(Boolean)
                        .join(", ") || "—"
                    }
                  />
                  <Item
                    label="Postal / Country"
                    value={`${order.address.postal_code ?? "—"} · ${order.address.country}`}
                  />
                </dl>
              ) : (
                <p className="text-[13px] text-muted-foreground">No address recorded.</p>
              )}
            </FormSection>
          </div>

          <FormSection
            title="Items"
            description="Historical snapshot — later product edits never change these values."
          >
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-[13px]">
                <thead className="border-b border-border bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">SKU</th>
                    <th className="px-3 py-2 text-right font-medium">Unit price</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Discount</th>
                    <th className="px-3 py-2 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{i.product_name}</p>
                        {i.variant_name && (
                          <p className="text-[11.5px] text-muted-foreground">{i.variant_name}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{i.sku ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(i.unit_price))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(i.discount_amount))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(i.line_total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>

          <VerificationPanel order={order} canManage={canManage} />

          <FulfillmentPanel order={order} canManage={canManage} />

          <OrderFulfillmentsPanel order={order} canManage={canManage} />

          <OrderShipmentsPanel order={order} canManage={canManage} />

          <OrderReturnsPanel order={order} canManage={canManage} />

          {internalVisible && <OrderFinancialsPanel orderId={order.id} canManage={canManage} />






          <FormSection title="Notes" description="Append-only timeline.">
            <ol className="space-y-2">
              {order.notes.length === 0 && (
                <li className="text-[13px] text-muted-foreground">No notes yet.</li>
              )}
              {order.notes.map((n) => (
                <li key={n.id} className="rounded border border-border p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <StatusBadge tone={n.note_type === "system" ? "info" : "neutral"}>
                      {NOTE_TYPE_LABELS[n.note_type]}
                    </StatusBadge>
                    <span className="text-[11.5px] text-muted-foreground">
                      {n.author?.full_name ?? "System"} · {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[13px] text-foreground">{n.note}</p>
                </li>
              ))}
            </ol>
            {canManage && (
              <div className="mt-3 space-y-2">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={2}
                  className="text-[13px]"
                  placeholder="Add an internal note"
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={!noteDraft.trim() || noteMutation.isPending}
                  onClick={() => noteMutation.mutate(noteDraft.trim())}
                >
                  <MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> Add note
                </Button>
              </div>
            )}
          </FormSection>
        </div>

        <div className="space-y-4">
          <FormSection title="Payment">
            <dl className="space-y-1 text-[13px]">
              <Item label="Method" value={PAYMENT_METHOD_LABELS[order.payment_method]} />
              <Item label="Status" value={PAYMENT_STATUS_LABELS[order.payment_status]} />
            </dl>
          </FormSection>

          <div className="rounded border border-border p-3 text-[13px]">
            <Row label="Subtotal" value={formatMoney(Number(order.subtotal))} />
            <Row label="Item discount" value={`− ${formatMoney(Number(order.product_discount))}`} />
            <Row label="Order discount" value={`− ${formatMoney(Number(order.order_discount))}`} />
            <Row label="Shipping charge" value={formatMoney(Number(order.shipping_charge))} />
            <Row label="Adjustment" value={formatMoney(Number(order.adjustment))} />
            <div className="my-2 border-t border-border" />
            <Row label="Grand total" value={formatMoney(Number(order.grand_total))} strong />
            <Row label="Paid" value={formatMoney(Number(order.paid_amount))} />
            <Row label="Due" value={formatMoney(Number(order.due_amount))} />
          </div>

          {internalVisible && (
            <div className="rounded border border-dashed border-border p-3 text-[13px]">
              <p className="mb-1 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                Internal cost (not customer facing)
              </p>
              <Row label="Delivery cost" value={formatMoney(Number(order.delivery_charge))} />
              <Row label="Packing cost" value={formatMoney(Number(order.packing_charge))} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this order?"
        description="The order is kept as a historical record and a system note is added. This cannot be undone."
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        destructive
        onConfirm={() => cancelMutation.mutate()}
      />
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={strong ? "font-semibold tabular-nums text-foreground" : "tabular-nums text-foreground"}
      >
        {value}
      </span>
    </div>
  );
}
