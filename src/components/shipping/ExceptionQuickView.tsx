import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Phone, UserMinus, UserPlus } from "lucide-react";
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
import { ExceptionActionDialog } from "@/components/orders/ExceptionActionDialog";
import { formatMoney } from "@/lib/currency";
import { getExceptionQuickView } from "@/lib/exception-console";
import { invalidateShippingSurfaces } from "@/lib/shipping-cache";
import { assignOperationalWork, releaseOperationalWork } from "@/lib/operations";
import { useProfile } from "@/hooks/use-profile";
import {
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_STATUS_TONE,
  EXCEPTION_TYPE_LABELS,
  exceptionActions,
} from "@/types/returns";
import type { ExceptionAction, ExceptionQueueRow } from "@/types/returns";
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONE } from "@/types/shipping";

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
 * Exception ownership and resolution in one place. Ownership uses the existing
 * operational assignment workflow, resolution uses the existing
 * `set_exception_state` dialog — no parallel state machine is introduced.
 */
export function ExceptionQuickView({
  exceptionId,
  onOpenChange,
}: {
  exceptionId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const [pending, setPending] = useState<{
    action: ExceptionAction;
    label: string;
    needsNote: boolean;
  } | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ["exception-quick-view", exceptionId],
    queryFn: () => getExceptionQuickView(exceptionId),
  });

  const invalidate = () =>
    invalidateShippingSurfaces(queryClient, {
      exceptionId,
      shipmentId: data?.shipment?.id ?? null,
      orderId: data?.order?.id ?? null,
    });

  const claim = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error("Your profile is still loading.");
      await assignOperationalWork({
        sourceType: "shipment_exception",
        sourceId: exceptionId,
        assignedTo: profile.id,
      });
    },
    onSuccess: () => {
      toast.success("Exception assigned to you.");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const release = useMutation({
    mutationFn: () => releaseOperationalWork("shipment_exception", exceptionId),
    onSuccess: () => {
      toast.success("Exception released.");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const actions = data?.can_manage ? exceptionActions(data.exception.status) : [];
  const ownedByOther = !!data?.assignment && !data.assignment.assigned_is_mine;

  return (
    <>
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {isPending ? (
            <LoadingState rows={6} />
          ) : error || !data ? (
            <p className="text-[13px] text-destructive">
              {(error as Error | null)?.message ?? "Exception could not be loaded."}
            </p>
          ) : (
            <>
              <SheetHeader className="space-y-1">
                <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                  {EXCEPTION_TYPE_LABELS[data.exception.exception_type]}
                  <StatusBadge tone={EXCEPTION_STATUS_TONE[data.exception.status]}>
                    {EXCEPTION_STATUS_LABELS[data.exception.status]}
                  </StatusBadge>
                </SheetTitle>
                <SheetDescription>
                  {data.order ? (
                    <>
                      Order{" "}
                      <Link
                        to="/orders/$id"
                        params={{ id: data.order.id }}
                        className="text-primary hover:underline"
                      >
                        {data.order.order_number}
                      </Link>{" "}
                      · {data.order.customer_name}
                    </>
                  ) : (
                    "No order linked"
                  )}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {data.shipment && (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/orders/shipments/$id" params={{ id: data.shipment.id }}>
                        Open shipment
                      </Link>
                    </Button>
                  )}
                  {data.order && (
                    <>
                      <Button size="sm" variant="outline" asChild>
                        <a href={`tel:${phoneDigits(data.order.customer_phone)}`}>
                          <Phone className="mr-1 h-3.5 w-3.5" />
                          Call
                        </a>
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={`https://wa.me/${phoneDigits(data.order.customer_phone)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MessageCircle className="mr-1 h-3.5 w-3.5" />
                          WhatsApp
                        </a>
                      </Button>
                    </>
                  )}
                  {data.can_manage && !data.assignment && (
                    <Button size="sm" onClick={() => claim.mutate()} disabled={claim.isPending}>
                      <UserPlus className="mr-1 h-3.5 w-3.5" />
                      Claim
                    </Button>
                  )}
                  {data.can_manage && ownedByOther && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={claim.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `${data.assignment?.assigned_name ?? "Someone else"} currently owns this exception. Take it over?`,
                          )
                        )
                          claim.mutate();
                      }}
                    >
                      <UserPlus className="mr-1 h-3.5 w-3.5" />
                      Take over
                    </Button>
                  )}
                  {data.can_manage && data.assignment && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={release.isPending}
                      onClick={() => release.mutate()}
                    >
                      <UserMinus className="mr-1 h-3.5 w-3.5" />
                      Release
                    </Button>
                  )}
                  {actions.map((item) => (
                    <Button
                      key={item.action}
                      size="sm"
                      variant={item.action === "resolve" ? "default" : "outline"}
                      onClick={() =>
                        setPending({
                          action: item.action,
                          label: item.label,
                          needsNote: item.needsNote,
                        })
                      }
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>

                <Separator />

                <Section title="Incident">
                  <Row label="Reported" value={new Date(data.exception.occurred_at).toLocaleString()} />
                  <Row label="Source" value={data.exception.source === "courier" ? "Courier" : "Manual"} />
                  <Row label="Courier event" value={data.exception.provider_event} />
                  <Row label="Reason" value={data.exception.courier_reason ?? data.exception.reason} />
                  <Row label="Notes" value={data.exception.notes} />
                  <Row
                    label="Collected"
                    value={
                      data.exception.collected_amount == null
                        ? null
                        : formatMoney(Number(data.exception.collected_amount))
                    }
                  />
                  <Row label="Resolution" value={data.exception.resolution_note} />
                </Section>

                <Section title="Ownership">
                  {data.assignment ? (
                    <>
                      <Row
                        label="Owner"
                        value={`${data.assignment.assigned_name ?? "Unknown"}${
                          data.assignment.assigned_is_mine ? " (you)" : ""
                        }`}
                      />
                      <Row
                        label="Since"
                        value={new Date(data.assignment.assigned_at).toLocaleString()}
                      />
                    </>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">Nobody owns this exception.</p>
                  )}
                  {data.assignment_events.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {data.assignment_events.slice(0, 6).map((event) => (
                        <p key={event.id} className="text-[11.5px] text-muted-foreground">
                          {new Date(event.created_at).toLocaleString()} · {event.event_type}
                          {event.note ? ` · ${event.note}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </Section>

                {data.shipment && (
                  <Section title="Shipment">
                    <Row
                      label="Shipment"
                      value={
                        <span className="inline-flex items-center gap-1.5">
                          {data.shipment.shipment_number}
                          <StatusBadge tone={SHIPMENT_STATUS_TONE[data.shipment.status]}>
                            {SHIPMENT_STATUS_LABELS[data.shipment.status]}
                          </StatusBadge>
                        </span>
                      }
                    />
                    <Row label="Courier" value={data.shipment.provider_name} />
                    <Row label="Account" value={data.shipment.account_name} />
                    <Row label="Tracking" value={data.shipment.tracking_number} />
                    <Row label="Expected COD" value={formatMoney(Number(data.shipment.expected_cod))} />
                    <Row
                      label="Collected"
                      value={
                        data.shipment.collected_amount == null
                          ? "Not recorded"
                          : formatMoney(Number(data.shipment.collected_amount))
                      }
                    />
                  </Section>
                )}

                {data.delivery_outcome.length > 0 && (
                  <Section title="Delivery outcome">
                    {data.delivery_outcome.map((item, index) => (
                      <p key={index} className="text-[12px] text-muted-foreground">
                        {item.product_name ?? "Item"}
                        {item.variant_name ? ` · ${item.variant_name}` : ""} — sent {item.quantity},
                        delivered {item.delivered_quantity}, refused {item.refused_quantity}, lost{" "}
                        {item.lost_quantity}, damaged {item.damaged_quantity}
                      </p>
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

                {data.discrepancies.length > 0 && (
                  <Section title="Settlement discrepancies">
                    {data.discrepancies.map((d) => (
                      <p key={d.id} className="text-[12px] text-muted-foreground">
                        {d.discrepancy_type.replace(/_/g, " ")} · {d.status.replace(/_/g, " ")}
                        {d.difference_amount == null
                          ? ""
                          : ` · ${formatMoney(Number(d.difference_amount))}`}
                      </p>
                    ))}
                  </Section>
                )}

                {data.events.length > 0 && (
                  <Section title="Shipment events">
                    {data.events.slice(0, 8).map((event) => (
                      <p key={event.id} className="text-[11.5px] text-muted-foreground">
                        {new Date(event.created_at).toLocaleString()} · {event.event_type}
                        {event.message ? ` · ${event.message}` : ""}
                      </p>
                    ))}
                  </Section>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {pending && data && (
        <ExceptionActionDialog
          exception={
            {
              id: data.exception.id,
              status: data.exception.status,
              exception_type: data.exception.exception_type,
              order_id: data.order?.id ?? null,
              shipment_id: data.shipment?.id ?? null,
            } as unknown as ExceptionQueueRow
          }
          action={pending.action}
          label={pending.label}
          needsNote={pending.needsNote}
          onOpenChange={(open) => {
            if (!open) {
              setPending(null);
              invalidate();
            }
          }}
        />
      )}
    </>
  );
}
