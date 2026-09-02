import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { recordVerificationAttempt } from "@/lib/verification";
import {
  ACTIVE_VERIFICATION_METHODS,
  ATTEMPT_OUTCOMES,
  ATTEMPT_OUTCOME_LABELS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_METHOD_LABELS,
  outcomeRequirement,
} from "@/types/verification";
import type { VerificationAttemptOutcome, VerificationMethod } from "@/types/verification";

interface Props {
  orderId: string;
  orderNumber: string;
  attemptCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecordAttemptDialog({
  orderId,
  orderNumber,
  attemptCount,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<VerificationMethod>("manual_call");
  const [outcome, setOutcome] = useState<VerificationAttemptOutcome>("no_answer");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethod("manual_call");
    setOutcome("no_answer");
    setNotes("");
    setDuration("");
    setScheduledAt("");
    setReason("");
    setError(null);
  }, [open]);

  const requirement = outcomeRequirement(outcome);

  const mutation = useMutation({
    mutationFn: async () => {
      if (requirement === "scheduled_at" && !scheduledAt) {
        throw new Error("Pick the callback date and time.");
      }
      if ((requirement === "risk_reason" || requirement === "failure_reason") && !reason.trim()) {
        throw new Error("A reason is required for this outcome.");
      }
      const parsedDuration = duration.trim() === "" ? null : Number.parseInt(duration, 10);
      return recordVerificationAttempt({
        orderId,
        method,
        outcome,
        notes: notes.trim() || undefined,
        durationSeconds: parsedDuration,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        riskReason: requirement === "risk_reason" ? reason.trim() : null,
        failureReason: requirement === "failure_reason" ? reason.trim() : null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["order", orderId] });
      void qc.invalidateQueries({ queryKey: ["verification", orderId] });
      void qc.invalidateQueries({ queryKey: ["verification-queue"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Attempt recorded");
      onOpenChange(false);
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not record this attempt."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            Record attempt {attemptCount + 1} · {orderNumber}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Retry limit is {VERIFICATION_MAX_ATTEMPTS} attempts. Completed attempts become
            historical records and cannot be edited afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as VerificationMethod)}>
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVE_VERIFICATION_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {VERIFICATION_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Outcome</Label>
              <Select
                value={outcome}
                onValueChange={(v) => setOutcome(v as VerificationAttemptOutcome)}
              >
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTEMPT_OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {ATTEMPT_OUTCOME_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {requirement === "scheduled_at" && (
            <div className="space-y-1.5">
              <Label htmlFor="cb" className="text-[12px]">
                Callback date and time
              </Label>
              <Input
                id="cb"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
          )}

          {(requirement === "risk_reason" || requirement === "failure_reason") && (
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-[12px]">
                {requirement === "risk_reason" ? "Risk reason" : "Rejection reason"}
              </Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  requirement === "risk_reason"
                    ? "Why is this order suspicious?"
                    : "Why did the customer reject the order?"
                }
                className="h-8 text-[13px]"
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-[12px]">
                Notes
              </Label>
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did the customer say?"
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dur" className="text-[12px]">
                Duration (s)
              </Label>
              <Input
                id="dur"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Optional"
                className="h-8 text-[13px] tabular-nums"
              />
            </div>
          </div>

          {error && (
            <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Record attempt
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
