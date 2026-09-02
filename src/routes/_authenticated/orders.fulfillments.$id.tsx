import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Save, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormSection } from "@/components/commerce/FormSection";
import { MediaImage } from "@/components/commerce/MediaImage";
import { ShipmentCreateDialog } from "@/components/orders/ShipmentCreateDialog";
import { getFulfillmentShipments } from "@/lib/shipping";
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONE } from "@/types/shipping";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  getFulfillmentById,
  getFulfillmentEvents,
  recordFulfillmentPicks,
  setFulfillmentItemQc,
  setFulfillmentRecordState,
} from "@/lib/fulfillment-records";
import {
  FULFILLMENT_EVENT_LABELS,
  FULFILLMENT_RECORD_ACTION_LABELS,
  FULFILLMENT_RECORD_STATUS_LABELS,
  FULFILLMENT_RECORD_STATUS_MEANINGS,
  FULFILLMENT_RECORD_STATUS_TONE,
  HOLD_REASONS,
  QC_FAILURE_REASONS,
  QC_STATUS_LABELS,
  QC_STATUS_TONE,
  REASON_REQUIRED_ACTIONS,
  SHORTAGE_REASONS,
  SHORTAGE_REASON_LABELS,
  availableFulfillmentRecordActions,
} from "@/types/fulfillment-records";
import type {
  FulfillmentRecordAction,
  ShortageReason,
} from "@/types/fulfillment-records";

const TITLE = "Fulfillment Workspace · Commerce Operations";
const DESCRIPTION = "Pick, quality check and pack one warehouse fulfillment.";

export const Route = createFileRoute("/_authenticated/orders/fulfillments/$id")({
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

interface PickDraft {
  pickedQuantity: number;
  shortageReason: ShortageReason | "";
}

function Page() {
  const { id } = useParams({ from: "/_authenticated/orders/fulfillments/$id" });
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();

  const [picks, setPicks] = useState<Record<string, PickDraft>>({});
  const [reasonAction, setReasonAction] = useState<FulfillmentRecordAction | null>(null);
  const [reason, setReason] = useState("");
  const [qcItemId, setQcItemId] = useState<string | null>(null);
  const [qcNote, setQcNote] = useState("");
  const [shippingOpen, setShippingOpen] = useState(false);

  const { data: fulfillment, isLoading } = useQuery({
    queryKey: ["fulfillment", id],
    queryFn: () => getFulfillmentById(id),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["fulfillment-events", id],
    queryFn: () => getFulfillmentEvents(id),
  });
  const { data: shipments = [] } = useQuery({
    queryKey: ["fulfillment-shipments", id],
    queryFn: () => getFulfillmentShipments(id),
  });

  useEffect(() => {
    if (!fulfillment) return;
    setPicks(
      Object.fromEntries(
        fulfillment.items.map((item) => [
          item.id,
          {
            pickedQuantity: item.picked_quantity,
            shortageReason: (item.shortage_reason ?? "") as ShortageReason | "",
          },
        ]),
      ),
    );
  }, [fulfillment]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["fulfillment", id] });
    void queryClient.invalidateQueries({ queryKey: ["fulfillment-events", id] });
    void queryClient.invalidateQueries({ queryKey: ["fulfillment-record-queue"] });
    if (fulfillment?.order_id) {
      void queryClient.invalidateQueries({ queryKey: ["order", fulfillment.order_id] });
      void queryClient.invalidateQueries({ queryKey: ["order-fulfillments", fulfillment.order_id] });
      void queryClient.invalidateQueries({
        queryKey: ["order-fulfillment-summary", fulfillment.order_id],
      });
    }
  };

  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "The warehouse operation was rejected");

  const savePicks = useMutation({
    mutationFn: () =>
      recordFulfillmentPicks(
        id,
        Object.entries(picks).map(([itemId, draft]) => ({
          itemId,
          pickedQuantity: draft.pickedQuantity,
          shortageReason: draft.shortageReason || null,
        })),
      ),
    onSuccess: () => {
      refresh();
      toast.success("Picked quantities saved");
    },
    onError,
  });

  const stateMutation = useMutation({
    mutationFn: (args: { action: FulfillmentRecordAction; reason?: string }) =>
      setFulfillmentRecordState({
        fulfillmentId: id,
        action: args.action,
        reason: args.reason ?? null,
      }),
    onSuccess: (_data, args) => {
      setReasonAction(null);
      setReason("");
      refresh();
      toast.success(`${FULFILLMENT_RECORD_ACTION_LABELS[args.action]} done`);
    },
    onError,
  });

  const qcMutation = useMutation({
    mutationFn: (args: { itemId: string; status: "passed" | "failed"; note?: string }) =>
      setFulfillmentItemQc(args.itemId, args.status, args.note ?? null),
    onSuccess: () => {
      setQcItemId(null);
      setQcNote("");
      refresh();
      toast.success("Quality control recorded");
    },
    onError,
  });

  if (isLoading) return <LoadingState rows={8} label="Loading fulfillment" />;
  if (!fulfillment) {
    return (
      <EmptyState
        title="Fulfillment not found"
        description="This fulfillment may have been removed or you do not have access."
        action={
          <Button asChild size="sm" className="h-8">
            <Link to="/orders/fulfillment">Back to the warehouse queue</Link>
          </Button>
        }
      />
    );
  }

  const orderCancelled = fulfillment.order?.status === "cancelled";
  const actions = canManage
    ? availableFulfillmentRecordActions(fulfillment.status, orderCancelled)
    : [];
  const picking = fulfillment.status === "picking";
  const inQc = fulfillment.status === "qc_pending";

  return (
    <>
      <PageHeader
        title={`Fulfillment #${fulfillment.fulfillment_number}`}
        description={FULFILLMENT_RECORD_STATUS_MEANINGS[fulfillment.status]}
        actions={
          <Button asChild variant="ghost" size="sm" className="h-8">
            <Link to="/orders/fulfillment">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Warehouse queue
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px]">
        <StatusBadge tone={FULFILLMENT_RECORD_STATUS_TONE[fulfillment.status]}>
          {FULFILLMENT_RECORD_STATUS_LABELS[fulfillment.status]}
        </StatusBadge>
        {fulfillment.order && (
          <Link
            to="/orders/$id"
            params={{ id: fulfillment.order.id }}
            className="font-medium underline-offset-2 hover:underline"
          >
            {fulfillment.order.order_number}
          </Link>
        )}
        <span className="text-muted-foreground">
          {fulfillment.order?.customer_name} · {fulfillment.order?.customer_phone}
        </span>
        <span className="text-muted-foreground">
          {fulfillment.location?.name ?? "No warehouse"}
        </span>
        {fulfillment.hold_reason && (
          <StatusBadge tone="danger">Hold · {fulfillment.hold_reason}</StatusBadge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 rounded border border-border bg-card p-4">
          <FormSection title="Items" description="Quantities come from the immutable order snapshot.">
            <div className="space-y-2">
              {fulfillment.items.map((item) => {
                const draft = picks[item.id] ?? {
                  pickedQuantity: item.picked_quantity,
                  shortageReason: "" as const,
                };
                const short = draft.pickedQuantity < item.quantity;
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-2"
                  >
                    <MediaImage path={item.imageUrl} alt={item.productName} className="h-9 w-9" />
                    <div className="min-w-40 flex-1">
                      <p className="text-[13px] font-medium">{item.productName}</p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {[item.variantName, item.sku].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <span className="text-[11.5px] text-muted-foreground">
                      Ordered {item.orderedQuantity} · This fulfillment {item.quantity}
                    </span>
                    {picking && canManage ? (
                      <>
                        <Input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={draft.pickedQuantity}
                          onChange={(e) =>
                            setPicks((p) => ({
                              ...p,
                              [item.id]: {
                                ...draft,
                                pickedQuantity: Math.max(
                                  0,
                                  Math.min(item.quantity, Number(e.target.value) || 0),
                                ),
                              },
                            }))
                          }
                          className="h-8 w-20 text-[13px]"
                          aria-label={`Picked quantity for ${item.productName}`}
                        />
                        <Select
                          value={draft.shortageReason || "none"}
                          onValueChange={(v) =>
                            setPicks((p) => ({
                              ...p,
                              [item.id]: {
                                ...draft,
                                shortageReason: v === "none" ? "" : (v as ShortageReason),
                              },
                            }))
                          }
                          disabled={!short}
                        >
                          <SelectTrigger
                            className="h-8 w-40 text-[13px]"
                            aria-label={`Shortage reason for ${item.productName}`}
                          >
                            <SelectValue placeholder="Reason" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No shortage</SelectItem>
                            {SHORTAGE_REASONS.map((r) => (
                              <SelectItem key={r} value={r}>
                                {SHORTAGE_REASON_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    ) : (
                      <span className="text-[11.5px] text-muted-foreground">
                        Picked {item.picked_quantity}/{item.quantity}
                        {item.shortage_reason
                          ? ` · ${SHORTAGE_REASON_LABELS[item.shortage_reason]}`
                          : ""}
                      </span>
                    )}
                    <StatusBadge tone={QC_STATUS_TONE[item.qc_status]}>
                      QC · {QC_STATUS_LABELS[item.qc_status]}
                    </StatusBadge>
                    {inQc && canManage && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() =>
                            qcMutation.mutate({ itemId: item.id, status: "passed" })
                          }
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Pass
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => {
                            setQcItemId(item.id);
                            setQcNote("");
                          }}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Fail
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {picking && canManage && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={savePicks.isPending}
                onClick={() => savePicks.mutate()}
              >
                <Save className="mr-1 h-3.5 w-3.5" /> Save picked quantities
              </Button>
            )}
          </FormSection>

          {actions.length > 0 && (
            <FormSection
              title="Warehouse actions"
              description="Every action is validated by the backend workflow."
            >
              <div className="flex flex-wrap gap-2">
                {actions.map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant={action === "cancel" ? "outline" : "default"}
                    className="h-8"
                    disabled={stateMutation.isPending}
                    onClick={() => {
                      if (REASON_REQUIRED_ACTIONS.includes(action) || action === "cancel") {
                        setReasonAction(action);
                        setReason("");
                      } else {
                        stateMutation.mutate({ action });
                      }
                    }}
                  >
                    {FULFILLMENT_RECORD_ACTION_LABELS[action]}
                  </Button>
                ))}
              </div>
            </FormSection>
          )}

          {fulfillment.notes && (
            <FormSection title="Notes">
              <p className="text-[13px]">{fulfillment.notes}</p>
            </FormSection>
          )}

          <FormSection
            title="Shipping"
            description="A shipment can be created once this fulfillment is ready for handover."
          >
            {shipments.length > 0 && (
              <div className="mb-3 space-y-2">
                {shipments.map((s) => (
                  <Link
                    key={s.id}
                    to="/orders/shipments/$id"
                    params={{ id: s.id }}
                    className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2 hover:bg-accent/50"
                  >
                    <span className="text-[13px] font-medium">{s.shipment_number}</span>
                    <StatusBadge tone={SHIPMENT_STATUS_TONE[s.status]}>
                      {SHIPMENT_STATUS_LABELS[s.status]}
                    </StatusBadge>
                  </Link>
                ))}
              </div>
            )}
            {canManage && fulfillment.status === "ready_for_handover" ? (
              <Button size="sm" variant="outline" onClick={() => setShippingOpen(true)}>
                Create shipment
              </Button>
            ) : (
              shipments.length === 0 && (
                <p className="text-[12px] text-muted-foreground">
                  No shipment yet for this fulfillment.
                </p>
              )
            )}
          </FormSection>

          {fulfillment.order && (
            <ShipmentCreateDialog
              fulfillmentId={fulfillment.id}
              orderId={fulfillment.order.id}
              open={shippingOpen}
              onOpenChange={setShippingOpen}
            />
          )}

        </div>

        <div className="rounded border border-border bg-card p-4">
          <FormSection title="History" description="Append-only fulfillment events.">
            <ol className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="border-l-2 border-border pl-2">
                  <p className="text-[12.5px] font-medium">
                    {FULFILLMENT_EVENT_LABELS[event.event_type]}
                  </p>
                  <p className="text-[12px] text-muted-foreground">{event.message}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
              {events.length === 0 && (
                <li className="text-[12.5px] text-muted-foreground">No events yet.</li>
              )}
            </ol>
          </FormSection>
        </div>
      </div>

      <Dialog open={reasonAction !== null} onOpenChange={(o) => !o && setReasonAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonAction ? FULFILLMENT_RECORD_ACTION_LABELS[reasonAction] : ""}
            </DialogTitle>
            <DialogDescription>
              {reasonAction === "hold"
                ? "A hold reason is required and is kept in the fulfillment history."
                : "Record why this action is being taken."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {(reasonAction === "fail_qc" ? QC_FAILURE_REASONS : HOLD_REASONS).map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => setReason(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
              className="min-h-16 text-[13px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setReasonAction(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={
                stateMutation.isPending ||
                (reasonAction !== null &&
                  REASON_REQUIRED_ACTIONS.includes(reasonAction) &&
                  reason.trim().length === 0)
              }
              onClick={() =>
                reasonAction && stateMutation.mutate({ action: reasonAction, reason: reason.trim() })
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={qcItemId !== null} onOpenChange={(o) => !o && setQcItemId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fail quality control</DialogTitle>
            <DialogDescription>A reason is required and stays in the history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {QC_FAILURE_REASONS.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => setQcNote(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
            <Textarea
              value={qcNote}
              onChange={(e) => setQcNote(e.target.value)}
              placeholder="What is wrong with this item?"
              className="min-h-16 text-[13px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setQcItemId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={qcNote.trim().length === 0 || qcMutation.isPending}
              onClick={() =>
                qcItemId &&
                qcMutation.mutate({ itemId: qcItemId, status: "failed", note: qcNote.trim() })
              }
            >
              Record failure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
