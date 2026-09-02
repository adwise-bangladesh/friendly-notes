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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setExceptionState } from "@/lib/returns";
import { EXCEPTION_TYPE_LABELS } from "@/types/returns";
import type { ExceptionAction, ExceptionQueueRow } from "@/types/returns";

/**
 * Resolving or dismissing an exception always requires a written outcome — the
 * incident log is what an operations lead reads later, so "closed silently" is
 * not an allowed state.
 */
export function ExceptionActionDialog({
  exception,
  action,
  label,
  needsNote,
  onOpenChange,
}: {
  exception: ExceptionQueueRow;
  action: ExceptionAction;
  label: string;
  needsNote: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      setExceptionState({ exceptionId: exception.id, action, note: note || null }),
    onSuccess: () => {
      toast.success(`${label} recorded.`);
      queryClient.invalidateQueries({ queryKey: ["exception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["order-exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["shipment"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const blocked = needsNote && note.trim().length === 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {EXCEPTION_TYPE_LABELS[exception.exception_type]} on shipment{" "}
            {exception.shipment?.shipment_number ?? "—"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="exception-note">
            {needsNote ? "Outcome note (required)" : "Note (optional)"}
          </Label>
          <Textarea
            id="exception-note"
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What did you find out, and what happens next?"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={blocked || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
