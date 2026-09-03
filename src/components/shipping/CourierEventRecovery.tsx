import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCourierEventRecoveryQueue,
  replayCourierEvent,
  retryCourierEvent,
} from "@/lib/shipping";
import type { CourierProviderEvent } from "@/types/shipping";

/**
 * Operational recovery for courier events that could not be applied.
 *
 * Retry and replay both go through the one authoritative event pipeline in the
 * database — nothing is applied twice and an already applied event is refused.
 */
export function CourierEventRecovery({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({});

  const events = useQuery({
    queryKey: ["courier-event-recovery"],
    queryFn: () => getCourierEventRecoveryQueue(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["courier-event-recovery"] });
    void queryClient.invalidateQueries({ queryKey: ["shipment-courier-events"] });
    void queryClient.invalidateQueries({ queryKey: ["shipments"] });
  };

  const retry = useMutation({
    mutationFn: (id: string) => retryCourierEvent(id),
    onSuccess: (row) => {
      toast.success(`Retried — now ${row.processing_status.replace(/_/g, " ")}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const replay = useMutation({
    mutationFn: (v: { id: string; reason: string }) => replayCourierEvent(v.id, v.reason),
    onSuccess: (row) => {
      toast.success(`Replayed — now ${row.processing_status.replace(/_/g, " ")}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (events.data ?? []) as CourierProviderEvent[];

  if (events.isLoading) {
    return <p className="text-[12.5px] text-muted-foreground">Loading courier events…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Every courier message received so far has been handled.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((event) => (
        <div key={event.id} className="rounded border border-border p-3 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {event.provider_event}
              <span className="ml-2 font-normal text-muted-foreground">
                {event.processing_status.replace(/_/g, " ")}
                {event.retry_count > 0 ? ` · ${event.retry_count} attempt(s)` : ""}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {new Date(event.received_at).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {event.processing_note ?? event.last_error ?? "No note recorded."}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Consignment {event.consignment_id ?? "—"} · order ref{" "}
            {event.merchant_order_id ?? "—"} · via {event.source}
          </p>
          {canManage && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {(event.processing_status === "unmatched" ||
                event.processing_status === "retry_scheduled") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate(event.id)}
                >
                  Retry now
                </Button>
              )}
              <Input
                value={reason[event.id] ?? ""}
                onChange={(e) => setReason((p) => ({ ...p, [event.id]: e.target.value }))}
                placeholder="Reason for replay"
                className="h-8 max-w-xs text-[12.5px]"
              />
              <Button
                size="sm"
                disabled={replay.isPending || !(reason[event.id] ?? "").trim()}
                onClick={() =>
                  replay.mutate({ id: event.id, reason: (reason[event.id] ?? "").trim() })
                }
              >
                Replay
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
