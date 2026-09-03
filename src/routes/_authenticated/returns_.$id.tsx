import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { FormSection } from "@/components/commerce/FormSection";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  getReturnById,
  inspectReturnItems,
  recordReturnReceipt,
  setReturnState,
} from "@/lib/returns";
import {
  RETURN_CONDITIONS,
  RETURN_CONDITION_LABELS,
  RETURN_CONDITION_TONE,
  RETURN_EVENT_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONE,
  RETURN_TYPE_LABELS,
  canInspect,
  canRecordReceipt,
  returnActions,
} from "@/types/returns";
import type { ReturnAction, ReturnItemCondition } from "@/types/returns";

const DESCRIPTION = "Return progress, what physically arrived and its condition.";

export const Route = createFileRoute("/_authenticated/returns_/$id")({
  head: () => ({
    meta: [
      { title: "Return Details · Commerce Operations" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Return Details · Commerce Operations" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

interface LineDraft {
  received: string;
  accepted: string;
  condition: ReturnItemCondition;
  notes: string;
}

function Page() {
  const { id } = useParams({ from: "/_authenticated/returns_/$id" });
  const { canManage } = useCommercePermissions();
  const queryClient = useQueryClient();

  const { data: record, isLoading } = useQuery({
    queryKey: ["return", id],
    queryFn: () => getReturnById(id),
  });

  const [draft, setDraft] = useState<Record<string, LineDraft>>({});
  const [receiptNote, setReceiptNote] = useState("");
  const [inspectionNote, setInspectionNote] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [pendingAction, setPendingAction] = useState<ReturnAction | null>(null);

  useEffect(() => {
    if (!record) return;
    setDraft(
      Object.fromEntries(
        record.items.map((item) => [
          item.id,
          {
            received: String(item.quantity_received),
            accepted: String(item.quantity_accepted),
            condition: item.condition,
            notes: item.notes ?? "",
          },
        ]),
      ),
    );
  }, [record]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["return", id] });
    queryClient.invalidateQueries({ queryKey: ["return-queue"] });
    queryClient.invalidateQueries({ queryKey: ["order-returns"] });
  };

  const stateMutation = useMutation({
    mutationFn: (action: ReturnAction) =>
      setReturnState({ returnId: id, action, reason: actionReason || null }),
    onSuccess: () => {
      toast.success("Return updated.");
      setActionReason("");
      setPendingAction(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const receiptMutation = useMutation({
    mutationFn: () =>
      recordReturnReceipt({
        returnId: id,
        items: Object.entries(draft).map(([itemId, line]) => ({
          itemId,
          quantityReceived: Number(line.received) || 0,
          notes: line.notes || null,
        })),
        note: receiptNote || null,
      }),
    onSuccess: () => {
      toast.success("Physical receipt recorded.");
      setReceiptNote("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const inspectionMutation = useMutation({
    mutationFn: () =>
      inspectReturnItems({
        returnId: id,
        items: Object.entries(draft).map(([itemId, line]) => ({
          itemId,
          condition: line.condition,
          quantityAccepted: Number(line.accepted) || 0,
          notes: line.notes || null,
        })),
        note: inspectionNote || null,
      }),
    onSuccess: () => {
      toast.success("Inspection recorded.");
      setInspectionNote("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const totals = useMemo(() => {
    const items = record?.items ?? [];
    return {
      expected: items.reduce((sum, item) => sum + item.quantity_expected, 0),
      received: items.reduce((sum, item) => sum + item.quantity_received, 0),
      accepted: items.reduce((sum, item) => sum + item.quantity_accepted, 0),
    };
  }, [record]);

  if (isLoading) return <LoadingState />;
  if (!record) {
    return (
      <EmptyState
        icon={ArrowLeft}
        title="Return not found"
        description="This return may have been removed."
      />
    );
  }

  const actions = canManage ? returnActions(record.status) : [];
  const showReceipt = canManage && canRecordReceipt(record.status);
  const showInspection = canManage && canInspect(record.status);
  const chosen = actions.find((item) => item.action === pendingAction);

  return (
    <>
      <PageHeader
        title={record.return_number}
        description={`${RETURN_TYPE_LABELS[record.return_type]} · ${DESCRIPTION}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/returns">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> All returns
          </Link>
        </Button>
        <StatusBadge tone={RETURN_STATUS_TONE[record.status]}>
          {RETURN_STATUS_LABELS[record.status]}
        </StatusBadge>
        <Link
          to="/orders/$id"
          params={{ id: record.order_id }}
          className="text-[13px] text-primary hover:underline"
        >
          {record.order?.order_number ?? "Order"}
        </Link>
        <span className="text-[13px] text-muted-foreground">
          {record.order?.customer_name} · {record.order?.customer_phone}
        </span>
        {record.shipment && (
          <span className="text-[13px] text-muted-foreground">
            Shipment {record.shipment.shipment_number}
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded border border-border p-4">
            <FormSection
              title="Returned lines"
              description={`Expected ${totals.expected} · Received ${totals.received} · Accepted ${totals.accepted}. Received quantities are what was physically counted.`}
            >
              {record.items.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No lines were attached to this return. The courier reported a return
                  before the contents were known.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-1.5 font-medium">Item</th>
                        <th className="py-1.5 font-medium">Expected</th>
                        <th className="py-1.5 font-medium">Received</th>
                        <th className="py-1.5 font-medium">Accepted</th>
                        <th className="py-1.5 font-medium">Condition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {record.items.map((item) => {
                        const line = draft[item.id];
                        return (
                          <tr key={item.id} className="align-top">
                            <td className="py-2 pr-3">
                              <div className="font-medium">
                                {item.order_item?.product_name ?? "Item"}
                              </div>
                              {item.order_item?.variant_name && (
                                <div className="text-[12px] text-muted-foreground">
                                  {item.order_item.variant_name}
                                </div>
                              )}
                              {item.reason && (
                                <div className="text-[12px] text-muted-foreground">
                                  {item.reason}
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-3">{item.quantity_expected}</td>
                            <td className="py-2 pr-3">
                              {showReceipt ? (
                                <Input
                                  className="h-8 w-20"
                                  type="number"
                                  min={0}
                                  max={item.quantity_expected}
                                  value={line?.received ?? ""}
                                  onChange={(event) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...prev[item.id]!,
                                        received: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              ) : (
                                item.quantity_received
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {showInspection ? (
                                <Input
                                  className="h-8 w-20"
                                  type="number"
                                  min={0}
                                  max={item.quantity_received}
                                  value={line?.accepted ?? ""}
                                  onChange={(event) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...prev[item.id]!,
                                        accepted: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              ) : (
                                item.quantity_accepted
                              )}
                            </td>
                            <td className="py-2">
                              {showInspection ? (
                                <Select
                                  value={line?.condition ?? "unknown"}
                                  onValueChange={(value) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...prev[item.id]!,
                                        condition: value as ReturnItemCondition,
                                      },
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 w-44">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {RETURN_CONDITIONS.map((value) => (
                                      <SelectItem key={value} value={value}>
                                        {RETURN_CONDITION_LABELS[value]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <StatusBadge tone={RETURN_CONDITION_TONE[item.condition]}>
                                  {RETURN_CONDITION_LABELS[item.condition]}
                                </StatusBadge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {showReceipt && record.items.length > 0 && (
                <div className="space-y-2 rounded border border-border p-3">
                  <Label htmlFor="receipt-note">Receipt note</Label>
                  <Textarea
                    id="receipt-note"
                    rows={2}
                    value={receiptNote}
                    onChange={(event) => setReceiptNote(event.target.value)}
                    placeholder="Parcel condition, who counted it, discrepancies."
                  />
                  <Button
                    size="sm"
                    disabled={receiptMutation.isPending}
                    onClick={() => receiptMutation.mutate()}
                  >
                    {receiptMutation.isPending ? "Saving…" : "Record received quantities"}
                  </Button>
                </div>
              )}

              {showInspection && record.items.length > 0 && (
                <div className="space-y-2 rounded border border-border p-3">
                  <Label htmlFor="inspection-note">Inspection note</Label>
                  <Textarea
                    id="inspection-note"
                    rows={2}
                    value={inspectionNote}
                    onChange={(event) => setInspectionNote(event.target.value)}
                    placeholder="Grading decisions. Stock is updated when the return is completed."
                  />
                  <Button
                    size="sm"
                    disabled={inspectionMutation.isPending}
                    onClick={() => inspectionMutation.mutate()}
                  >
                    {inspectionMutation.isPending ? "Saving…" : "Record inspection"}
                  </Button>
                </div>
              )}
            </FormSection>
          </div>

          <div className="rounded border border-border p-4">
            <FormSection title="History" description="Append-only record of this return.">
              <ol className="space-y-2.5">
                {record.events.map((event) => (
                  <li key={event.id} className="border-l-2 border-border pl-3">
                    <div className="text-[12px] font-medium">
                      {RETURN_EVENT_LABELS[event.event_type]}
                    </div>
                    <div className="text-[13px]">{event.message}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ol>
            </FormSection>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded border border-border p-4">
            <FormSection
              title="Move this return forward"
              description="State changes are validated by the database; nothing skips a step."
            >
              {actions.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  This return is closed. No further action is possible.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map((item) => (
                      <Button
                        key={item.action}
                        size="sm"
                        variant={pendingAction === item.action ? "default" : "outline"}
                        onClick={() => setPendingAction(item.action)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                  {chosen && (
                    <div className="space-y-2">
                      <Label htmlFor="action-reason">
                        {chosen.needsReason ? "Reason (required)" : "Note (optional)"}
                      </Label>
                      <Textarea
                        id="action-reason"
                        rows={3}
                        value={actionReason}
                        onChange={(event) => setActionReason(event.target.value)}
                      />
                      <Button
                        size="sm"
                        disabled={
                          stateMutation.isPending ||
                          (chosen.needsReason && actionReason.trim().length === 0)
                        }
                        onClick={() => stateMutation.mutate(chosen.action)}
                      >
                        {stateMutation.isPending ? "Saving…" : `Confirm: ${chosen.label}`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </FormSection>
          </div>

          <div className="rounded border border-border p-4 text-[13px]">
            <FormSection title="Details">
              <dl className="space-y-1.5">
                <Row label="Opened" value={new Date(record.requested_at).toLocaleString()} />
                <Row label="Source" value={record.source === "courier" ? "Courier" : "Manual"} />
                <Row label="Reason" value={record.reason ?? "—"} />
                <Row label="Courier reason" value={record.courier_reason ?? "—"} />
                <Row label="Return tracking" value={record.tracking_reference ?? "—"} />
                <Row
                  label="Received"
                  value={record.received_at ? new Date(record.received_at).toLocaleString() : "—"}
                />
                <Row label="Outcome" value={record.resolution_note ?? "—"} />
              </dl>
            </FormSection>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
