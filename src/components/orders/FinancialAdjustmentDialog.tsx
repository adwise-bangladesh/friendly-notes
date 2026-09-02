import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { createFinancialAdjustment } from "@/lib/finance";
import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_DIRECTION_LABELS,
  ADJUSTMENT_TYPES,
  ADJUSTMENT_TYPE_LABELS,
} from "@/types/finance";
import type { FinancialAdjustmentDirection, FinancialAdjustmentType } from "@/types/finance";

/**
 * Adjustments are append-only: this dialog can only add a record. A wrong
 * entry is corrected with an explicit reversal, never by editing history.
 */
export function FinancialAdjustmentDialog({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<FinancialAdjustmentType>("packing_cost");
  const [direction, setDirection] = useState<FinancialAdjustmentDirection>("expense");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const numericAmount = Number(amount);
  const valid = Number.isFinite(numericAmount) && numericAmount > 0;

  const mutation = useMutation({
    mutationFn: () =>
      createFinancialAdjustment({
        orderId,
        type,
        direction,
        amount: numericAmount,
        reason: reason.trim() || undefined,
        reference: reference.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["order-financials", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["order-adjustments", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      toast.success("Adjustment recorded");
      setAmount("");
      setReason("");
      setReference("");
      onOpenChange(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not record the adjustment"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Add financial adjustment</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Recorded permanently. Mistakes are corrected with a reversal, not an edit.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[12px]">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as FinancialAdjustmentType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ADJUSTMENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Direction</Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as FinancialAdjustmentDirection)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_DIRECTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {ADJUSTMENT_DIRECTION_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Amount (৳)</Label>
            <Input
              className="h-9"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            {amount !== "" && !valid && (
              <p className="text-[11.5px] text-destructive">Amount must be greater than zero.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Reason</Label>
            <Textarea
              rows={2}
              className="text-[13px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this cost or income exists"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Reference</Label>
            <Input
              className="h-9"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Invoice, settlement or receipt reference"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Record adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
