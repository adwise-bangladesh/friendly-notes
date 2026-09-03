import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/commerce/FormSection";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import { getReturnFinancialSummary, recordReturnFinancialOutcome } from "@/lib/finance";
import { RETURN_OUTCOME_LABELS, RETURN_OUTCOME_TONE } from "@/types/finance";

type OutcomeChoice = "refunded" | "partially_refunded" | "retained";

const CHOICE_LABELS: Record<OutcomeChoice, string> = {
  refunded: "Refund the full value of the returned goods",
  partially_refunded: "Refund part of the value",
  retained: "Keep the money (no refund)",
};

/**
 * Financial outcome of a return. Every number shown comes from
 * return_financial_summary(); the browser never computes money, and the
 * outcome itself is written by record_return_financial_outcome().
 */
export function ReturnFinancialOutcome({
  returnId,
  orderId,
  canManage,
}: {
  returnId: string;
  orderId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<OutcomeChoice>("refunded");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const { data: summary, isLoading } = useQuery({
    queryKey: ["return-financials", returnId],
    queryFn: () => getReturnFinancialSummary(returnId),
  });

  const record = useMutation({
    mutationFn: () =>
      recordReturnFinancialOutcome({
        returnId,
        refundAmount: refund,
        note: note.trim() ? note.trim() : undefined,
      }),
    onSuccess: () => {
      toast.success("Financial outcome recorded.");
      setOpen(false);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["return-financials", returnId] });
      void queryClient.invalidateQueries({ queryKey: ["return", returnId] });
      void queryClient.invalidateQueries({ queryKey: ["order-financials", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["order-adjustments", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !summary) {
    return (
      <FormSection title="Financial outcome">
        <p className="text-[13px] text-muted-foreground">Loading financial outcome…</p>
      </FormSection>
    );
  }

  const maxRefund = Number(summary.max_refund);
  const refund =
    choice === "retained" ? 0 : choice === "refunded" ? maxRefund : Number(amount || 0);
  const invalidAmount =
    choice === "partially_refunded" &&
    (amount.trim() === "" || !Number.isFinite(refund) || refund <= 0 || refund > maxRefund);
  const amountMessage =
    amount.trim() === ""
      ? "Enter the refund amount."
      : refund <= 0
        ? "Enter an amount greater than zero, or choose to keep the money."
        : `Refund amount cannot exceed the value of the returned goods (${formatMoney(maxRefund)}).`;

  const outcome = summary.outcome ?? "pending";

  return (
    <FormSection
      title="Financial outcome"
      description="Recorded once. Money is only refunded when you record it here; correct mistakes with a financial adjustment on the order."
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge tone={RETURN_OUTCOME_TONE[outcome]}>
          {RETURN_OUTCOME_LABELS[outcome]}
        </StatusBadge>
        {summary.recorded && summary.recorded_at && (
          <span className="text-[11.5px] text-muted-foreground">
            Final · recorded {new Date(summary.recorded_at).toLocaleString()}
          </span>
        )}
        {!summary.recorded && !summary.can_record && (
          <span className="text-[11.5px] text-muted-foreground">
            Available once the returned goods have been received.
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
        <Row label="Returned (received)" value={`${summary.received_units} units`} />
        <Row label="Accepted back to stock" value={`${summary.accepted_units} units`} />
        <Row label="Rejected / damaged" value={`${summary.rejected_units} units`} />
        <Row label="Value of returned goods" value={formatMoney(Number(summary.received_value))} />
        <Row label="Value of accepted goods" value={formatMoney(Number(summary.accepted_value))} />
        <Row label="Maximum refund" value={formatMoney(maxRefund)} />
        <Row label="Refunded" value={formatMoney(Number(summary.refund_amount))} />
        <Row label="Retained" value={formatMoney(Number(summary.retained_amount))} />
      </dl>

      <p className="mt-2 text-[11.5px] text-muted-foreground">
        A refund posts an expense on the order, lowers net collected revenue and updates the
        payment status. Retained money leaves revenue untouched. Accepted units are restocked by
        the return workflow, which is what lowers the actual product cost.
      </p>

      {canManage && summary.can_record && (
        <Button size="sm" className="mt-3 h-8" onClick={() => setOpen(true)}>
          Record financial outcome
        </Button>
      )}
      {summary.recorded && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          This return already has a final financial outcome. Record a correcting financial
          adjustment on the order instead of changing it.
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record financial outcome</DialogTitle>
            <DialogDescription>
              This is recorded once and cannot be edited afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <Select value={choice} onValueChange={(v) => setChoice(v as OutcomeChoice)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHOICE_LABELS) as OutcomeChoice[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHOICE_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {choice === "partially_refunded" && (
              <div className="space-y-1.5">
                <Label htmlFor="refund-amount">Refund amount (max {formatMoney(maxRefund)})</Label>
                <Input
                  id="refund-amount"
                  className="h-9"
                  type="number"
                  min={0}
                  max={maxRefund}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {invalidAmount && (
                  <p className="text-[12px] text-destructive">{amountMessage}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="outcome-note">Note (optional)</Label>
              <Textarea
                id="outcome-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this outcome was agreed."
              />
            </div>

            <div className="rounded border border-border bg-muted/40 p-2.5 text-[12.5px]">
              <p className="font-medium">Confirm</p>
              <p className="text-muted-foreground">
                Refund {formatMoney(Number.isFinite(refund) ? refund : 0)} · retain{" "}
                {formatMoney(Math.max(maxRefund - (Number.isFinite(refund) ? refund : 0), 0))} of
                the {formatMoney(maxRefund)} returned value.
                {refund > 0
                  ? " A refund expense will be posted on the order."
                  : " No refund will be posted."}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={invalidAmount || record.isPending}
              onClick={() => record.mutate()}
            >
              {record.isPending ? "Recording…" : "Record outcome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormSection>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-0.5 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
