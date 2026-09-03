import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, ExternalLink, MessageCircle, Phone, Truck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { formatMoney } from "@/lib/currency";
import {
  getShipmentQuickView,
  bookingBlockReason,
  BOOKING_STATE_LABELS,
} from "@/lib/shipping-console";
import { invalidateShippingSurfaces } from "@/lib/shipping-cache";
import { bookShipmentWithCourier } from "@/lib/couriers.functions";
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONE } from "@/types/shipping";
import { EXCEPTION_STATUS_LABELS, EXCEPTION_TYPE_LABELS } from "@/types/returns";
import type { ShipmentExceptionStatus, ShipmentExceptionType } from "@/types/returns";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

const phoneDigits = (phone: string) => phone.replace(/[^\d]/g, "");

/**
 * Fast operational inspection of one shipment. Nothing here writes directly:
 * booking runs through the existing `bookShipmentWithCourier` server function,
 * which claims the attempt with `book_shipment_begin` before any courier call.
 */
export function ShipmentQuickView({
  shipmentId,
  onOpenChange,
}: {
  shipmentId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ["shipment-quick-view", shipmentId],
    queryFn: () => getShipmentQuickView(shipmentId),
  });

  const bookFn = useServerFn(bookShipmentWithCourier);
  const book = useMutation({
    mutationFn: async () => {
      setBusy(true);
      return bookFn({ data: { shipmentId } });
    },
    onSuccess: (result) => {
      setBusy(false);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      invalidateShippingSurfaces(queryClient, {
        shipmentId,
        orderId: data?.order.id ?? null,
      });
    },
    onError: (err: Error) => {
      setBusy(false);
      toast.error(err.message);
    },
  });

  const copy = (value: string | null | undefined, label: string) => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  };

  const blockReason = data
    ? bookingBlockReason({
        status: data.shipment.status,
        booking_state: data.booking.state,
        provider_id: data.courier.provider_id,
        account_id: data.courier.account_id,
      })
    : "Loading…";

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {isPending ? (
          <LoadingState rows={6} />
        ) : error || !data ? (
          <p className="text-[13px] text-destructive">
            {(error as Error | null)?.message ?? "Shipment could not be loaded."}
          </p>
        ) : (
          <>
            <SheetHeader className="space-y-1">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                {data.shipment.shipment_number}
                <StatusBadge tone={SHIPMENT_STATUS_TONE[data.shipment.status]}>
                  {SHIPMENT_STATUS_LABELS[data.shipment.status]}
                </StatusBadge>
                <StatusBadge
                  tone={
                    data.booking.state === "recovery_required" || data.booking.state === "failed"
                      ? "danger"
                      : data.booking.state === "booked"
                        ? "success"
                        : "neutral"
                  }
                >
                  {BOOKING_STATE_LABELS[data.booking.state]}
                </StatusBadge>
              </SheetTitle>
              <SheetDescription>
                Order{" "}
                <Link
                  to="/orders/$id"
                  params={{ id: data.order.id }}
                  className="text-primary hover:underline"
                >
                  {data.order.order_number}
                </Link>{" "}
                · {data.customer.name}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {/* Actions */}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/orders/shipments/$id" params={{ id: shipmentId }}>
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    Open shipment
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/orders/$id" params={{ id: data.order.id }}>
                    Open order
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`tel:${phoneDigits(data.customer.phone)}`}>
                    <Phone className="mr-1 h-3.5 w-3.5" />
                    Call
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://wa.me/${phoneDigits(data.customer.phone)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="mr-1 h-3.5 w-3.5" />
                    WhatsApp
                  </a>
                </Button>
                {data.courier.tracking_number && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(data.courier.tracking_number, "Tracking number")}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Tracking
                  </Button>
                )}
                {data.can_manage && (
                  <Button
                    size="sm"
                    disabled={!!blockReason || busy || book.isPending}
                    title={blockReason ?? "Book this shipment with the assigned courier"}
                    onClick={() => book.mutate()}
                  >
                    <Truck className="mr-1 h-3.5 w-3.5" />
                    {book.isPending ? "Booking…" : "Book shipment"}
                  </Button>
                )}
              </div>
              {data.can_manage && blockReason && (
                <p className="text-[12px] text-muted-foreground">Booking blocked: {blockReason}</p>
              )}

              <Separator />

              <Section title="Customer">
                <Row label="Name" value={data.customer.name} />
                <Row label="Phone" value={data.customer.phone} />
                <Row label="Recipient" value={data.customer.recipient_name} />
                <Row label="Address" value={data.customer.address} />
                <Row
                  label="Area / district"
                  value={[data.customer.area, data.customer.city].filter(Boolean).join(" · ") || "—"}
                />
              </Section>

              <Section title="Contents">
                <div className="overflow-x-auto rounded border border-border">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left">Item</th>
                        <th className="px-2 py-1 text-right">Sent</th>
                        <th className="px-2 py-1 text-right">Del.</th>
                        <th className="px-2 py-1 text-right">Ref.</th>
                        <th className="px-2 py-1 text-right">Lost</th>
                        <th className="px-2 py-1 text-right">Dmg.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-2 py-1">
                            {item.product_name ?? "Removed item"}
                            {item.variant_name ? ` · ${item.variant_name}` : ""}
                            {item.sku ? (
                              <span className="text-muted-foreground"> · {item.sku}</span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-right">{item.quantity}</td>
                          <td className="px-2 py-1 text-right">{item.delivered_quantity}</td>
                          <td className="px-2 py-1 text-right">{item.refused_quantity}</td>
                          <td className="px-2 py-1 text-right">{item.lost_quantity}</td>
                          <td className="px-2 py-1 text-right">{item.damaged_quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.delivery.outcome_recorded_at && (
                  <p className="text-[11.5px] text-muted-foreground">
                    No courier outcome recorded yet.
                  </p>
                )}
              </Section>

              <Section title="Courier">
                <Row label="Provider" value={data.courier.provider_name ?? "Not assigned"} />
                <Row label="Account" value={data.courier.account_name} />
                <Row label="Service" value={data.shipment.service_type} />
                <Row label="Tracking" value={data.courier.tracking_number} />
                <Row label="Consignment" value={data.courier.external_consignment_id} />
              </Section>

              <Section title="Booking">
                <Row label="State" value={BOOKING_STATE_LABELS[data.booking.state]} />
                <Row label="Attempts" value={data.booking.attempt_count} />
                <Row label="Last error" value={data.booking.last_error} />
                <Row
                  label="Outcome unknown"
                  value={data.booking.outcome_unknown ? "Yes — needs recovery" : "No"}
                />
              </Section>

              <Section title="Delivery">
                <Row label="State" value={SHIPMENT_STATUS_LABELS[data.delivery.status]} />
                <Row label="Courier status" value={data.delivery.provider_status} />
                <Row
                  label="Last sync"
                  value={
                    data.delivery.last_synced_at
                      ? new Date(data.delivery.last_synced_at).toLocaleString()
                      : null
                  }
                />
                <Row label="Hold reason" value={data.delivery.hold_reason} />
                <Row label="Failure reason" value={data.delivery.failure_reason} />
              </Section>

              <Section title="COD & courier charges">
                <Row label="Expected COD" value={formatMoney(Number(data.financial.expected_cod))} />
                <Row
                  label="Collected"
                  value={
                    data.financial.collected_amount == null
                      ? "Not recorded"
                      : formatMoney(Number(data.financial.collected_amount))
                  }
                />
                <Row
                  label="Quoted fee"
                  value={
                    data.financial.quoted_delivery_fee == null
                      ? null
                      : formatMoney(Number(data.financial.quoted_delivery_fee))
                  }
                />
                <Row
                  label="Booked fee"
                  value={
                    data.financial.booked_delivery_fee == null
                      ? null
                      : formatMoney(Number(data.financial.booked_delivery_fee))
                  }
                />
                <Row
                  label="Actual fee"
                  value={
                    data.financial.actual_delivery_fee == null
                      ? null
                      : formatMoney(Number(data.financial.actual_delivery_fee))
                  }
                />
                <Row
                  label="COD fee"
                  value={
                    data.financial.cod_fee == null ? null : formatMoney(Number(data.financial.cod_fee))
                  }
                />
                <Row
                  label="Return charge"
                  value={
                    data.financial.return_charge == null
                      ? null
                      : formatMoney(Number(data.financial.return_charge))
                  }
                />
                <Row
                  label="Other charge"
                  value={
                    data.financial.other_courier_charge == null
                      ? null
                      : formatMoney(Number(data.financial.other_courier_charge))
                  }
                />
                <Row label="Settlement" value={data.financial.settlement_status} />
              </Section>

              {data.profit && (
                <Section title="Profitability">
                  {Object.entries(data.profit)
                    .filter(([, value]) => typeof value === "number")
                    .map(([key, value]) => (
                      <Row
                        key={key}
                        label={key.replace(/_/g, " ")}
                        value={formatMoney(Number(value))}
                      />
                    ))}
                </Section>
              )}

              <Section title="Returns">
                {data.returns.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No return linked.</p>
                ) : (
                  data.returns.map((r) => (
                    <Link
                      key={r.id}
                      to="/returns/$id"
                      params={{ id: r.id }}
                      className="flex items-center justify-between rounded border border-border px-2 py-1 text-[12.5px] hover:bg-accent/50"
                    >
                      <span>{r.return_number}</span>
                      <span className="text-muted-foreground">{r.status.replace(/_/g, " ")}</span>
                    </Link>
                  ))
                )}
              </Section>

              <Section title="Exceptions">
                {data.exceptions.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No exception recorded.</p>
                ) : (
                  data.exceptions.map((e) => (
                    <div
                      key={e.id}
                      className="rounded border border-border px-2 py-1 text-[12.5px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {EXCEPTION_TYPE_LABELS[e.exception_type as ShipmentExceptionType]}
                        </span>
                        <StatusBadge
                          tone={e.status === "resolved" ? "success" : "warning"}
                        >
                          {EXCEPTION_STATUS_LABELS[e.status as ShipmentExceptionStatus]}
                        </StatusBadge>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground">
                        {e.reason ?? "No reason reported"}
                        {e.assigned_name ? ` · owned by ${e.assigned_name}` : " · unassigned"}
                      </p>
                    </div>
                  ))
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
