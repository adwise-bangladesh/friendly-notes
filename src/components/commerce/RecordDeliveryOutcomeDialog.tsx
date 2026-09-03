import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordDeliveryOutcome } from "@/lib/shipping";
import type { ShipmentItemLine } from "@/types/shipping";

/**
 * Operator entry for quantity-level courier outcomes.
 *
 * The dialog only assists: every rule (totals, ownership, lifecycle, replay and
 * conflict handling) is enforced again by `record_delivery_outcome` on the
 * server. Refused, lost and damaged units are courier outcomes — they do not
 * put stock back in the warehouse.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipmentId: string;
  items: ShipmentItemLine[];
  onRecorded: () => void;
}

type Draft = Record<string, { d: string; r: string; l: string; g: string }>;

const n = (v: string) => {
  const parsed = Number.parseInt(v, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function RecordDeliveryOutcomeDialog({
  open,
  onOpenChange,
  shipmentId,
  items,
  onRecorded,
}: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      items.map((i) => [
        i.id,
        {
          d: String(i.delivered_quantity || i.quantity),
          r: String(i.refused_quantity || 0),
          l: String(i.lost_quantity || 0),
          g: String(i.damaged_quantity || 0),
        },
      ]),
    ),
  );

  const lines = useMemo(
    () =>
      items.map((item) => {
        const row = draft[item.id] ?? { d: "0", r: "0", l: "0", g: "0" };
        const delivered = n(row.d);
        const refused = n(row.r);
        const lost = n(row.l);
        const damaged = n(row.g);
        return {
          item,
          delivered,
          refused,
          lost,
          damaged,
          total: delivered + refused + lost + damaged,
        };
      }),
    [items, draft],
  );

  const totals = lines.reduce(
    (acc, l) => ({
      shipped: acc.shipped + l.item.quantity,
      delivered: acc.delivered + l.delivered,
      refused: acc.refused + l.refused,
      lost: acc.lost + l.lost,
      damaged: acc.damaged + l.damaged,
      classified: acc.classified + l.total,
    }),
    { shipped: 0, delivered: 0, refused: 0, lost: 0, damaged: 0, classified: 0 },
  );

  const overflow = lines.filter((l) => l.total > l.item.quantity);
  const unclassified = totals.shipped - totals.classified;
  const valid = overflow.length === 0 && unclassified === 0;

  const outcomeLabel =
    totals.delivered === totals.shipped
      ? "Delivered in full"
      : totals.delivered > 0
        ? "Partially delivered"
        : totals.lost === totals.shipped
          ? "Lost"
          : "Delivery failed";

  const mutation = useMutation({
    mutationFn: () =>
      recordDeliveryOutcome({
        shipmentId,
        note,
        lines: lines.map((l) => ({
          shipmentItemId: l.item.id,
          deliveredQuantity: l.delivered,
          refusedQuantity: l.refused,
          lostQuantity: l.lost,
          damagedQuantity: l.damaged,
        })),
      }),
    onSuccess: () => {
      toast.success("Delivery outcome recorded");
      queryClient.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      setConfirming(false);
      onOpenChange(false);
      onRecorded();
    },
    onError: (error: Error) => {
      setConfirming(false);
      toast.error(error.message);
    },
  });

  const set = (id: string, key: "d" | "r" | "l" | "g", value: string) =>
    setDraft((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { d: "0", r: "0", l: "0", g: "0" }), [key]: value },
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Record delivery outcome</DialogTitle>
          <DialogDescription>
            Enter exactly how many units the customer accepted, refused, or that the courier lost
            or damaged. This is the authoritative record and closes the shipment. Refused, lost and
            damaged units are <strong>not</strong> back in stock — they still need the return
            receipt and inspection workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_repeat(5,64px)] gap-2 px-1 text-[11px] font-medium text-muted-foreground">
            <span>Item</span>
            <span className="text-right">Shipped</span>
            <span className="text-right">Delivered</span>
            <span className="text-right">Refused</span>
            <span className="text-right">Lost</span>
            <span className="text-right">Damaged</span>
          </div>
          {lines.map((line) => (
            <div
              key={line.item.id}
              className="grid grid-cols-[1fr_repeat(5,64px)] items-center gap-2 rounded border border-border px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{line.item.productName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {[line.item.variantName, line.item.sku].filter(Boolean).join(" · ") || "—"}
                  {line.total > line.item.quantity
                    ? " · more units recorded than shipped"
                    : line.total < line.item.quantity
                      ? ` · ${line.item.quantity - line.total} unit(s) unclassified`
                      : ""}
                </p>
              </div>
              <span className="text-right text-[13px] tabular-nums">{line.item.quantity}</span>
              {(["d", "r", "l", "g"] as const).map((key) => (
                <Input
                  key={key}
                  type="number"
                  min={0}
                  max={line.item.quantity}
                  className="h-8 text-right text-[13px]"
                  value={draft[line.item.id]?.[key] ?? "0"}
                  onChange={(e) => set(line.item.id, key, e.target.value)}
                />
              ))}
            </div>
          ))}
        </div>

        <Textarea
          rows={2}
          placeholder="What did the courier report? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="text-[13px]"
        />

        <p className="text-[12px] text-muted-foreground">
          {totals.delivered} delivered · {totals.refused} refused · {totals.lost} lost ·{" "}
          {totals.damaged} damaged of {totals.shipped} shipped
          {unclassified > 0 ? ` · ${unclassified} unit(s) still unclassified` : ""}
        </p>

        {confirming && valid ? (
          <div className="rounded border border-border bg-muted/40 p-3 text-[12px]">
            <p className="font-medium">Confirm: {outcomeLabel}</p>
            <p className="text-muted-foreground">
              This closes the shipment with these quantities and cannot be re-recorded with
              different numbers. Corrections then go through the return workflow.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {confirming && valid ? (
            <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Recording…" : "Confirm outcome"}
            </Button>
          ) : (
            <Button size="sm" disabled={!valid} onClick={() => setConfirming(true)}>
              Review outcome
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
