import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getLevelSnapshot, getMovements, setLowStockThreshold } from "@/lib/inventory";
import { adjustInventory } from "@/lib/inventory-ops";
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  ADMIN_ONLY_MOVEMENT_TYPES,
  MANUAL_MOVEMENT_TYPES,
  MOVEMENT_TYPE_HELP,
  MOVEMENT_TYPE_LABELS,
  movementDirection,
} from "@/types/inventory";
import type {
  InventoryAdjustmentReason,
  InventoryItem,
  ManualMovementType,
} from "@/types/inventory";

interface Props {
  item: InventoryItem | null;
  onClose: () => void;
  canManage: boolean;
  isAdmin?: boolean;
}

export function StockAdjustDialog({ item, onClose, canManage, isAdmin = false }: Props) {
  const qc = useQueryClient();
  const [type, setType] = useState<ManualMovementType>("adjustment_in");
  const [reason, setReason] = useState<InventoryAdjustmentReason>("correction");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setType(item.onHand === 0 && item.damaged === 0 ? "initial" : "adjustment_in");
    setReason("correction");
    setQuantity("1");
    setNote("");
    setThreshold(item.lowStockThreshold === null ? "" : String(item.lowStockThreshold));
    setError(null);
  }, [item]);

  const snapshotQuery = useQuery({
    queryKey: ["inventory", "level", item?.levelId],
    queryFn: () => getLevelSnapshot(item!.levelId),
    enabled: !!item,
  });

  const movementsQuery = useQuery({
    queryKey: ["inventory-movements", item?.levelId],
    queryFn: () => getMovements(item!.levelId),
    enabled: !!item,
  });

  const live = snapshotQuery.data;
  const current = item
    ? {
        onHand: live?.on_hand ?? item.onHand,
        reserved: live?.reserved ?? item.reserved,
        damaged: live?.damaged ?? item.damaged,
        available: live?.available_quantity ?? item.available,
      }
    : null;

  const qty = Number.parseInt(quantity, 10);
  const preview = useMemo(() => {
    if (!current || !Number.isFinite(qty) || qty <= 0) return null;
    let onHand = current.onHand;
    let reserved = current.reserved;
    let damaged = current.damaged;
    if (type === "initial" || type === "adjustment_in" || type === "return_in") onHand += qty;
    if (type === "adjustment_out") onHand -= qty;
    if (type === "damage") {
      onHand -= qty;
      damaged += qty;
    }
    if (type === "damaged_out") damaged -= qty;
    return { onHand, reserved, damaged, available: onHand - reserved };
  }, [current, qty, type]);

  const invalidPreview =
    preview !== null &&
    (preview.onHand < 0 ||
      preview.reserved < 0 ||
      preview.damaged < 0 ||
      preview.reserved > preview.onHand);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Enter a quantity greater than zero.");
      if (reason === "other" && !note.trim()) {
        throw new Error('Add a note explaining the change when the reason is "other".');
      }
      await adjustInventory({
        levelId: item.levelId,
        type,
        quantity: qty,
        reason,
        note: note.trim() || null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void snapshotQuery.refetch();
      void qc.invalidateQueries({ queryKey: ["inventory-movements", item?.levelId] });
      toast.success("Stock updated");
      setQuantity("1");
      setNote("");
      setError(null);
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not apply this movement."),
  });

  const thresholdMutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const parsed = threshold.trim() === "" ? null : Number.parseInt(threshold, 10);
      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
        throw new Error("Threshold must be zero or greater.");
      }
      await setLowStockThreshold(item.levelId, parsed);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Low stock threshold saved");
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not save the threshold."),
  });

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {item?.itemName}
            {item?.variantTitle ? ` — ${item.variantTitle}` : ""}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {item?.locationName}
            {item?.sku ? ` · SKU ${item.sku}` : ""}
          </DialogDescription>
        </DialogHeader>

        {item && (
          <div className="space-y-5">
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "On hand", value: current?.onHand ?? item.onHand },
                { label: "Reserved", value: current?.reserved ?? item.reserved },
                { label: "Available", value: current?.available ?? item.available },
                { label: "Damaged", value: current?.damaged ?? item.damaged },
              ].map((cell) => (
                <div key={cell.label} className="rounded border border-border bg-muted/40 px-2 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {cell.label}
                  </div>
                  <div className="text-[15px] font-semibold tabular-nums">{cell.value}</div>
                </div>
              ))}
            </div>

            {canManage ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Record a stock movement
                </p>

                <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                  <div className="space-y-1.5">
                    <Label className="text-[12px]">Movement type</Label>
                    <Select
                      value={type}
                      onValueChange={(v) => setType(v as ManualMovementType)}
                    >
                      <SelectTrigger className="h-8 text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MANUAL_MOVEMENT_TYPES.filter(
                          (t) => isAdmin || !ADMIN_ONLY_MOVEMENT_TYPES.includes(t),
                        ).map((t) => (
                          <SelectItem key={t} value={t}>
                            {MOVEMENT_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qty" className="text-[12px]">
                      Quantity
                    </Label>
                    <Input
                      id="qty"
                      inputMode="numeric"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))}
                      className="h-8 text-[13px] tabular-nums"
                    />
                  </div>
                </div>

                <p className="text-[11.5px] text-muted-foreground">{MOVEMENT_TYPE_HELP[type]}</p>

                <div className="space-y-1.5">
                  <Label className="text-[12px]">Reason</Label>
                  <Select
                    value={reason}
                    onValueChange={(v) => setReason(v as InventoryAdjustmentReason)}
                  >
                    <SelectTrigger className="h-8 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADJUSTMENT_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ADJUSTMENT_REASON_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="note" className="text-[12px]">
                    Note{reason === "other" ? " (required)" : ""}
                  </Label>
                  <Textarea
                    id="note"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why is this change being made?"
                    className="text-[13px]"
                  />
                </div>

                {preview && (
                  <p
                    className={
                      invalidPreview
                        ? "rounded border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12.5px] text-destructive"
                        : "rounded border border-border bg-muted/40 px-2.5 py-1.5 text-[12.5px] text-muted-foreground"
                    }
                  >
                    {invalidPreview
                      ? "This movement would take stock below zero or reserve more than is on hand."
                      : `After this movement — on hand ${preview.onHand}, reserved ${preview.reserved}, available ${preview.available}, damaged ${preview.damaged}.`}
                  </p>
                )}

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => applyMutation.mutate()}
                    disabled={applyMutation.isPending || invalidPreview || !preview}
                  >
                    {applyMutation.isPending && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    Apply movement
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
                You have read-only access to inventory.
              </p>
            )}

            {canManage && (
              <div className="flex items-end gap-2 rounded-md border border-border p-3">
                <div className="w-32 space-y-1.5">
                  <Label htmlFor="threshold" className="text-[12px]">
                    Low stock at
                  </Label>
                  <Input
                    id="threshold"
                    inputMode="numeric"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="None"
                    className="h-8 text-[13px] tabular-nums"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => thresholdMutation.mutate()}
                  disabled={thresholdMutation.isPending}
                >
                  Save threshold
                </Button>
                <p className="pb-1.5 text-[11.5px] text-muted-foreground">
                  Warns when available stock drops to this number at this location.
                </p>
              </div>
            )}

            {error && (
              <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
                {error}
              </p>
            )}

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Movement history
              </p>
              {movementsQuery.isLoading ? (
                <p className="text-[12.5px] text-muted-foreground">Loading…</p>
              ) : (movementsQuery.data ?? []).length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">No movements recorded yet.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {(movementsQuery.data ?? []).map((m) => {
                    const dir = movementDirection(m.movement_type);
                    return (
                      <li key={m.id} className="flex items-start gap-2 px-3 py-2">
                        <StatusBadge
                          tone={dir === "in" ? "success" : dir === "out" ? "danger" : "info"}
                        >
                          {dir === "in" ? "+" : dir === "out" ? "−" : "±"}
                          {m.quantity}
                        </StatusBadge>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium">
                            {MOVEMENT_TYPE_LABELS[m.movement_type]}
                          </div>
                          {(m.reason ?? m.note) && (
                            <div className="text-[11.5px] text-muted-foreground">
                              {m.reason ? ADJUSTMENT_REASON_LABELS[m.reason] : ""}
                              {m.reason && m.note ? " · " : ""}
                              {m.note ?? ""}
                            </div>
                          )}
                          {m.on_hand_before !== null && m.on_hand_after !== null && (
                            <div className="text-[11px] tabular-nums text-muted-foreground">
                              On hand {m.on_hand_before} → {m.on_hand_after}
                            </div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            {new Date(m.created_at).toLocaleString()}
                            {m.actorName ? ` · ${m.actorName}` : ""}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
