import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, MessageCircle, Phone } from "lucide-react";
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
import { formatMoney } from "@/lib/currency";
import { getOrderQuickView } from "@/lib/orders-console";
import { addOrderNote } from "@/lib/orders";
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

export function OrderQuickView({ orderId, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["order-quick-view", orderId],
    queryFn: () => getOrderQuickView(orderId as string),
    enabled: !!orderId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["order-quick-view", orderId] });
    void queryClient.invalidateQueries({ queryKey: ["orders-console"] });
  };

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

  const o = data?.order;

  return (
    <Sheet open={!!orderId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">{o ? o.order_number : "Order"}</SheetTitle>
          <SheetDescription className="text-xs">
            Quick view — inspect and act without leaving the console.
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
            </div>

            <div className="rounded border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{o.customer_name}</p>
                  <p className="tabular-nums text-muted-foreground">{o.customer_phone}</p>
                  {data.address ? (
                    <p className="mt-1 text-muted-foreground">
                      {[
                        data.address.address_line,
                        data.address.area,
                        data.address.district,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
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

            <div className="rounded border border-border">
              <table className="w-full">
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5">
                        {i.product_name}
                        {i.variant_name ? (
                          <span className="text-muted-foreground"> · {i.variant_name}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        ×{i.quantity}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatMoney(Number(i.line_total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Cell label="Payment">
                {PAYMENT_METHOD_LABELS[o.payment_method]} ·{" "}
                {PAYMENT_STATUS_LABELS[o.payment_status]}
              </Cell>
              <Cell label="Order total">{formatMoney(Number(o.grand_total))}</Cell>
              <Cell label="Collected">{formatMoney(Number(o.paid_amount))}</Cell>
              <Cell label="COD due">{formatMoney(Number(o.due_amount))}</Cell>
              <Cell label="Store">{o.store_name ?? "—"}</Cell>
              <Cell label="Attempts">{o.verification_attempt_count}</Cell>
            </div>

            {(data.shipments.length > 0 ||
              data.returns.length > 0 ||
              data.exceptions.length > 0) && (
              <div className="space-y-1 rounded border border-border p-3">
                {data.shipments.map((s) => (
                  <p key={s.id}>
                    Shipment {s.shipment_number} · {s.status}
                    {s.courier_name ? ` · ${s.courier_name}` : ""}
                    {s.tracking_number ? ` · ${s.tracking_number}` : ""}
                  </p>
                ))}
                {data.returns.map((r) => (
                  <p key={r.id}>
                    Return {r.return_number} · {r.status}
                  </p>
                ))}
                {data.exceptions.map((e) => (
                  <p key={e.id} className="text-destructive">
                    Exception: {e.exception_type} · {e.status}
                  </p>
                ))}
              </div>
            )}

            {data.edit_block_reason ? (
              <p className="rounded border border-border bg-muted/40 p-2 text-muted-foreground">
                {data.edit_block_reason}
              </p>
            ) : null}

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
              {data.can_manage ? (
                data.assignment ? (
                  data.assignment.is_mine ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={release.isPending}
                      onClick={() => release.mutate()}
                    >
                      Release verification
                    </Button>
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
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <p className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular-nums">{children}</p>
    </div>
  );
}
