import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Ban, ExternalLink, MessageCircle, Phone } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { RecordAttemptDialog } from "@/components/orders/RecordAttemptDialog";
import { formatMoney } from "@/lib/currency";
import { getOrderQuickView } from "@/lib/orders-console";
import { addOrderNote, cancelOrder } from "@/lib/orders";
import { invalidateOrderSurfaces } from "@/lib/order-cache";
import { claimVerificationWork, releaseVerificationWork } from "@/lib/verification";
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  FULFILLMENT_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/types/orders";
import {
  RISK_LEVEL_TONE,
  VERIFICATION_PRIORITY_TONE,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_TONE,
} from "@/types/verification";

interface Props {
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
}

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("880") ? digits : `880${digits.replace(/^0/, "")}`;
  return `https://wa.me/${intl}`;
}

const RESERVATION_LABELS: Record<string, string> = {
  not_required: "Reservation not required",
  pending: "Reservation pending",
  reserved: "Reserved",
  partial: "Partially reserved",
  failed: "Reservation failed",
  released: "Reservation released",
};

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function OrderQuickView({ orderId, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["order-quick-view", orderId],
    queryFn: () => getOrderQuickView(orderId as string),
    enabled: !!orderId,
  });

  const invalidate = () => invalidateOrderSurfaces(queryClient, orderId);

  const claim = useMutation({
    mutationFn: () => claimVerificationWork(orderId as string),
    onSuccess: () => {
      toast.success("Verification claimed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const release = useMutation({
    mutationFn: () => releaseVerificationWork(orderId as string),
    onSuccess: () => {
      toast.success("Verification released");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveNote = useMutation({
    mutationFn: () => addOrderNote(orderId as string, note.trim()),
    onSuccess: () => {
      setNote("");
      toast.success("Note added");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: () => cancelOrder(orderId as string, "Cancelled from the orders console"),
    onSuccess: () => {
      toast.success("Order cancelled");
      setCancelOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const o = data?.order;
  const ci = data?.customer_intelligence ?? null;
  const metrics = ci?.metrics ?? null;
  const claimBlock = data?.verification_claim_block_reason ?? null;
  const openReturns = (data?.returns ?? []).filter((r) => r.is_open);
  const itemDiscounts = (data?.items ?? []).reduce((s, i) => s + num(i.discount_amount), 0);

  return (
    <Sheet open={!!orderId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">{o ? o.order_number : "Order"}</SheetTitle>
          <SheetDescription className="text-xs">
            {o
              ? `Placed ${new Date(o.created_at).toLocaleString()}`
              : "Quick view — inspect and act without leaving the console."}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="mt-4">
            <LoadingState rows={6} label="Loading order" />
          </div>
        ) : isError ? (
          <div className="mt-6 space-y-3 text-[13px]">
            <p className="text-destructive">{(error as Error).message}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : data && o ? (
          <div className="mt-4 space-y-4 text-[13px]">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge tone={o.status === "cancelled" ? "danger" : "info"}>
                {ORDER_STATUS_LABELS[o.status]}
              </StatusBadge>
              <StatusBadge tone={VERIFICATION_STATUS_TONE[o.verification_status]}>
                {VERIFICATION_STATUS_LABELS[o.verification_status]}
              </StatusBadge>
              <StatusBadge tone={VERIFICATION_PRIORITY_TONE[o.verification_priority]}>
                {o.verification_priority} priority
              </StatusBadge>
              <StatusBadge tone={RISK_LEVEL_TONE[o.risk_level]}>{o.risk_level} risk</StatusBadge>
              <StatusBadge tone={DELIVERY_STATUS_TONE[o.delivery_status]}>
                {DELIVERY_STATUS_LABELS[o.delivery_status]}
              </StatusBadge>
              <StatusBadge tone="neutral">
                {FULFILLMENT_STATUS_LABELS[o.fulfillment_status]}
              </StatusBadge>
              {o.store_name ? <StatusBadge tone="neutral">{o.store_name}</StatusBadge> : null}
              <StatusBadge tone="neutral">{o.source}</StatusBadge>
            </div>

            {/* Blockers first — can this order move forward right now? */}
            {(o.fulfillment_hold_reason ||
              data.exceptions.length > 0 ||
              openReturns.length > 0 ||
              o.reservation_status === "failed") && (
              <div className="space-y-1 rounded border border-destructive/40 bg-destructive/5 p-2.5">
                {o.reservation_status === "failed" ? (
                  <Blocker text="Stock reservation failed — inventory could not be held." />
                ) : null}
                {o.fulfillment_hold_reason ? (
                  <Blocker text={`Fulfillment hold: ${o.fulfillment_hold_reason}`} />
                ) : null}
                {data.exceptions.map((e) => (
                  <Blocker
                    key={e.id}
                    text={`Shipment exception: ${e.exception_type.replace(/_/g, " ")} · ${e.status}${
                      e.description ? ` — ${e.description}` : ""
                    }`}
                  />
                ))}
                {openReturns.map((r) => (
                  <Blocker
                    key={r.id}
                    text={`Open return ${r.return_number} · ${r.return_type} · ${r.status}`}
                  />
                ))}
              </div>
            )}

            {/* Customer + contact */}
            <div className="rounded border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{o.customer_name}</p>
                  <p className="tabular-nums text-muted-foreground">{o.customer_phone}</p>
                  {data.address ? (
                    <p className="mt-1 text-muted-foreground">
                      {[data.address.address_line, data.address.area, data.address.district]
                        .filter(Boolean)
                        .join(", ")}
                      {data.address.landmark ? ` (${data.address.landmark})` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    onClick={() => {
                      void navigator.clipboard?.writeText(o.customer_phone);
                      toast.success("Phone copied");
                    }}
                  >
                    Copy
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-7 px-2">
                    <a href={`tel:${o.customer_phone}`} aria-label="Call customer">
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-7 px-2">
                    <a
                      href={waLink(o.customer_phone)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="WhatsApp customer"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            {/* Customer history / risk */}
            <div className="rounded border border-border p-3">
              <p className="text-[11.5px] uppercase tracking-wide text-muted-foreground">
                Customer history
              </p>
              {!ci?.linked ? (
                <p className="pt-1 text-muted-foreground">
                  Not linked to a saved customer record yet.
                </p>
              ) : (
                <div className="space-y-2 pt-1">
                  <p className="tabular-nums">
                    {num(metrics?.["total_orders"])} previous orders ·{" "}
                    {num(metrics?.["delivered_orders"])} delivered ·{" "}
                    {num(metrics?.["returned_orders"])} returned/refused ·{" "}
                    {num(metrics?.["cancelled_orders"])} cancelled
                  </p>
                  <p className="text-muted-foreground">
                    Risk {o.risk_level}
                    {o.risk_reason ? ` — ${o.risk_reason}` : ""}
                  </p>
                  {(ci.flags ?? []).map((f, i) => (
                    <p
                      key={`${f.flag}-${i}`}
                      className="flex items-start gap-1.5 text-foreground"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <span>
                        {f.flag.replace(/_/g, " ")}
                        {f.reason ? ` — ${f.reason}` : ""}
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Items */}
            <div className="rounded border border-border">
              <table className="w-full">
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-3 py-1.5">
                        <div>
                          {i.product_name}
                          {i.variant_name ? (
                            <span className="text-muted-foreground"> · {i.variant_name}</span>
                          ) : null}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {i.sku ? `SKU ${i.sku} · ` : ""}
                          {formatMoney(num(i.unit_price))} each
                          {num(i.discount_amount) > 0
                            ? ` · −${formatMoney(num(i.discount_amount))} discount`
                            : ""}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        ×{i.quantity}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatMoney(num(i.line_total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Money */}
            <div className="space-y-1 rounded border border-border p-3 tabular-nums">
              <Money label="Merchandise subtotal" value={num(o.subtotal)} />
              {itemDiscounts + num(o.product_discount) > 0 ? (
                <Money
                  label="Item discounts"
                  value={-(itemDiscounts + num(o.product_discount))}
                />
              ) : null}
              {num(o.order_discount) > 0 ? (
                <Money label="Order discount" value={-num(o.order_discount)} />
              ) : null}
              <Money label="Shipping charge" value={num(o.shipping_charge)} />
              <Money label="Grand total" value={num(o.grand_total)} strong />
              <Money label="Collected" value={num(o.paid_amount)} />
              <Money label="COD due" value={num(o.due_amount)} strong />
              <p className="pt-1 text-[11.5px] text-muted-foreground">
                {PAYMENT_METHOD_LABELS[o.payment_method]} ·{" "}
                {PAYMENT_STATUS_LABELS[o.payment_status]}
              </p>
            </div>

            {/* Operational state */}
            <div className="space-y-1.5 rounded border border-border p-3">
              <p>
                <span className="text-muted-foreground">Inventory: </span>
                {RESERVATION_LABELS[o.reservation_status] ?? o.reservation_status}
                {data.reservation_summary
                  ? ` · ${data.reservation_summary.active_units} held / ${data.reservation_summary.committed_units} committed of ${data.reservation_summary.ordered_units} units`
                  : ""}
              </p>
              <p>
                <span className="text-muted-foreground">Fulfillment: </span>
                {FULFILLMENT_STATUS_LABELS[o.fulfillment_status]}
                {data.fulfillments.length === 0 ? " · no fulfillment yet" : ""}
              </p>
              {data.fulfillments.map((f) => (
                <p key={f.id} className="pl-3 text-muted-foreground">
                  {f.fulfillment_number} · {f.status.replace(/_/g, " ")} · picked{" "}
                  {f.picked_units ?? 0}/{f.planned_units ?? 0} · packed {f.packed_units ?? 0}/
                  {f.planned_units ?? 0}
                  {f.hold_reason ? ` · hold: ${f.hold_reason}` : ""}
                </p>
              ))}
              <p>
                <span className="text-muted-foreground">Delivery: </span>
                {DELIVERY_STATUS_LABELS[o.delivery_status]}
              </p>
              {data.shipments.length === 0 ? (
                <p className="text-muted-foreground">No shipment booked.</p>
              ) : (
                data.shipments.map((s) => (
                  <p key={s.id} className="pl-3 text-muted-foreground">
                    {s.shipment_number} · {s.courier_name ?? "no courier"} ·{" "}
                    {s.status.replace(/_/g, " ")}
                    {s.tracking_number || s.external_consignment_id
                      ? ` · ${s.tracking_number ?? s.external_consignment_id}`
                      : ""}
                    {s.hold_reason ? ` · hold: ${s.hold_reason}` : ""}
                    {s.failure_reason ? ` · ${s.failure_reason}` : ""}
                  </p>
                ))
              )}
            </div>

            {data.edit_block_reason ? (
              <p className="rounded border border-border bg-muted/40 p-2 text-muted-foreground">
                {data.edit_block_reason}
              </p>
            ) : null}

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
              {data.can_manage ? (
                claimBlock ? (
                  <span className="text-muted-foreground">{claimBlock}</span>
                ) : data.assignment ? (
                  data.assignment.is_mine ? (
                    <>
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => setAttemptOpen(true)}
                        disabled={o.status === "cancelled"}
                      >
                        Record outcome
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={release.isPending}
                        onClick={() => release.mutate()}
                      >
                        Release verification
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Claimed by {data.assignment.assigned_name ?? "another operator"}
                    </span>
                  )
                ) : (
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={claim.isPending}
                    onClick={() => claim.mutate()}
                  >
                    Claim verification
                  </Button>
                )
              ) : null}
              {data.can_manage && o.status !== "cancelled" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => setCancelOpen(true)}
                >
                  <Ban className="mr-1 h-3.5 w-3.5" /> Cancel order
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link to="/orders/$id" params={{ id: o.id }}>
                  Open full order <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            {data.can_manage ? (
              <div className="space-y-2">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add an internal note"
                  className="min-h-16 text-[13px]"
                  aria-label="Order note"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!note.trim() || saveNote.isPending}
                  onClick={() => saveNote.mutate()}
                >
                  Add note
                </Button>
              </div>
            ) : null}

            {data.recent_notes.length > 0 ? (
              <div className="space-y-1 rounded border border-border p-3 text-muted-foreground">
                {data.recent_notes.map((n) => (
                  <p key={n.id}>
                    <span className="text-foreground">{n.note}</span>{" "}
                    <span className="text-[11.5px]">
                      · {new Date(n.created_at).toLocaleString()}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}

            <RecordAttemptDialog
              orderId={o.id}
              orderNumber={o.order_number}
              attemptCount={o.verification_attempt_count}
              open={attemptOpen}
              onOpenChange={(open) => {
                setAttemptOpen(open);
                if (!open) invalidate();
              }}
            />

            <ConfirmDialog
              open={cancelOpen}
              onOpenChange={setCancelOpen}
              title={`Cancel ${o.order_number}?`}
              description="This runs the same controlled cancellation as the full order page: reservations are released, and packed stock is protected. Blocked cancellations report their reason."
              confirmLabel="Cancel order"
              onConfirm={() => cancel.mutate()}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Blocker({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      <span>{text}</span>
    </p>
  );
}

function Money({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-medium" : undefined}>{formatMoney(value)}</span>
    </div>
  );
}
