import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneCall, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FormSection } from "@/components/commerce/FormSection";
import { RecordAttemptDialog } from "./RecordAttemptDialog";
import { VerificationTimeline } from "./VerificationTimeline";
import {
  getVerificationHistory,
  setVerificationPriority,
  setVerificationState,
  startVerification,
} from "@/lib/verification";
import type { VerificationStateAction } from "@/lib/verification";
import {
  RISK_LEVEL_LABELS,
  RISK_LEVEL_TONE,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_PRIORITIES,
  VERIFICATION_PRIORITY_LABELS,
  VERIFICATION_PRIORITY_TONE,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_MEANINGS,
  VERIFICATION_STATUS_TONE,
  availableActions,
  canRecordAttempt,
  isReadyForFulfillment,
} from "@/types/verification";
import type { VerificationAction, VerificationPriority } from "@/types/verification";
import type { Order } from "@/types/orders";

const ACTION_LABELS: Record<VerificationAction, string> = {
  start: "Start verification",
  confirm: "Mark confirmed",
  manual_review: "Move to manual review",
  schedule_callback: "Schedule callback",
  unreachable: "Mark unreachable",
  fail: "Mark failed",
  reopen: "Reopen for retry",
};

const REASON_REQUIRED: VerificationAction[] = ["manual_review", "fail"];

export function VerificationPanel({ order, canManage }: { order: Order; canManage: boolean }) {
  const qc = useQueryClient();
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [action, setAction] = useState<VerificationAction | null>(null);
  const [reason, setReason] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ["verification", order.id],
    queryFn: () => getVerificationHistory(order.id),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["order", order.id] });
    void qc.invalidateQueries({ queryKey: ["verification", order.id] });
    void qc.invalidateQueries({ queryKey: ["verification-queue"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const actionMutation = useMutation({
    mutationFn: async (a: VerificationAction) => {
      if (a === "start") return startVerification(order.id, "manual_call");
      if (REASON_REQUIRED.includes(a) && !reason.trim()) {
        throw new Error("A reason is required for this action.");
      }
      if (a === "schedule_callback" && !scheduledAt) {
        throw new Error("Pick the callback date and time.");
      }
      return setVerificationState({
        orderId: order.id,
        action: a as VerificationStateAction,
        reason: reason.trim() || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
    },
    onSuccess: () => {
      invalidate();
      setAction(null);
      setReason("");
      setScheduledAt("");
      setError(null);
      toast.success("Verification updated");
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "This verification action was rejected."),
  });

  const priorityMutation = useMutation({
    mutationFn: (p: VerificationPriority) => setVerificationPriority(order.id, p),
    onSuccess: () => {
      invalidate();
      toast.success("Priority updated");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not change the priority."),
  });

  const status = order.verification_status;
  const actions = order.status === "cancelled" ? [] : availableActions(status);
  const canAttempt = canManage && canRecordAttempt(order.status, status);

  return (
    <FormSection
      title="Verification"
      description={VERIFICATION_STATUS_MEANINGS[status]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={VERIFICATION_STATUS_TONE[status]}>
            {VERIFICATION_STATUS_LABELS[status]}
          </StatusBadge>
          <StatusBadge tone={VERIFICATION_PRIORITY_TONE[order.verification_priority]}>
            Priority · {VERIFICATION_PRIORITY_LABELS[order.verification_priority]}
          </StatusBadge>
          <StatusBadge tone={RISK_LEVEL_TONE[order.risk_level]}>
            Risk · {RISK_LEVEL_LABELS[order.risk_level]}
          </StatusBadge>
          {isReadyForFulfillment(order.status, status) && (
            <StatusBadge tone="success">Ready for fulfillment</StatusBadge>
          )}
        </div>

        <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
          <Row
            label="Attempts"
            value={`${order.verification_attempt_count} of ${VERIFICATION_MAX_ATTEMPTS}`}
          />
          <Row
            label="Last attempt"
            value={
              order.verification_last_attempt_at
                ? new Date(order.verification_last_attempt_at).toLocaleString()
                : "—"
            }
          />
          <Row
            label="Next action"
            value={
              order.verification_next_action_at
                ? `Callback · ${new Date(order.verification_next_action_at).toLocaleString()}`
                : "None scheduled"
            }
          />
          <Row label="Risk reason" value={order.risk_reason ?? "—"} />
          {order.verification_failure_reason && (
            <Row label="Failure reason" value={order.verification_failure_reason} />
          )}
        </dl>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {canAttempt && (
              <Button size="sm" className="h-8" onClick={() => setAttemptOpen(true)}>
                <PhoneCall className="mr-1 h-3.5 w-3.5" /> Record call attempt
              </Button>
            )}
            {actions.map((a) => (
              <Button
                key={a}
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  setError(null);
                  setReason("");
                  setScheduledAt("");
                  if (a === "start") actionMutation.mutate(a);
                  else setAction(a);
                }}
              >
                {ACTION_LABELS[a]}
              </Button>
            ))}
            <Select
              value={order.verification_priority}
              onValueChange={(v) => priorityMutation.mutate(v as VerificationPriority)}
            >
              <SelectTrigger className="h-8 w-32 text-[13px]" aria-label="Verification priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERIFICATION_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {VERIFICATION_PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Verification timeline
          </p>
          {history.isLoading ? (
            <p className="text-[12.5px] text-muted-foreground">Loading…</p>
          ) : (
            <VerificationTimeline
              createdAt={order.created_at}
              attempts={history.data?.attempts ?? []}
              events={history.data?.events ?? []}
            />
          )}
        </div>
      </div>

      <RecordAttemptDialog
        orderId={order.id}
        orderNumber={order.order_number}
        attemptCount={order.verification_attempt_count}
        open={attemptOpen}
        onOpenChange={setAttemptOpen}
      />

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {action ? ACTION_LABELS[action] : ""}
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              The workflow validates this transition on the server and records an event and a
              system note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {action === "schedule_callback" && (
              <div className="space-y-1.5">
                <Label htmlFor="sched" className="text-[12px]">
                  Callback date and time
                </Label>
                <Input
                  id="sched"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="areason" className="text-[12px]">
                {action && REASON_REQUIRED.includes(action) ? "Reason (required)" : "Note"}
              </Label>
              <Input
                id="areason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-8 text-[13px]"
                placeholder="Recorded on the verification timeline"
              />
            </div>
            {error && (
              <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={actionMutation.isPending}
                onClick={() => action && actionMutation.mutate(action)}
              >
                {actionMutation.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </FormSection>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  );
}
