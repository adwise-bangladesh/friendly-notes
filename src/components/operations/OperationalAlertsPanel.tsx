/**
 * Operational incidents panel.
 *
 * Reads the authoritative `operational_health_overview` projection: one row per
 * distinct problem, deduplicated by fingerprint, with a plain-language detail
 * and the recommended operator action. Acknowledgement goes through the
 * controlled RPC and is enforced in the database.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileSearch, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  ALERT_CATEGORY_LABELS,
  SEVERITY_TONE,
  acknowledgeAlert,
  getOperationalHealth,
} from "@/lib/operational-alerts";
import type { OperationalAlert } from "@/lib/operational-alerts";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ERROR_CATEGORY_LABELS,
  SUBSYSTEM_LABELS,
  getAlertEvidence,
} from "@/lib/observability";

function when(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * Supporting evidence for one incident: the worker runs, diagnostics and
 * courier calls that back it. References only — nothing is duplicated and no
 * remediation happens here; state changes stay in the controlled workflows.
 */
function EvidenceSheet({ alertId, onClose }: { alertId: string | null; onClose: () => void }) {
  const evidence = useQuery({
    queryKey: ["alert-evidence", alertId],
    queryFn: () => getAlertEvidence(alertId as string),
    enabled: Boolean(alertId),
  });

  return (
    <Sheet open={Boolean(alertId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Incident evidence</SheetTitle>
          <SheetDescription>
            Worker runs, diagnostics and provider calls related to this incident.
          </SheetDescription>
        </SheetHeader>
        {evidence.isLoading ? (
          <p className="mt-4 text-[12.5px] text-muted-foreground">Loading evidence…</p>
        ) : null}
        {evidence.error ? (
          <p className="mt-4 text-[12.5px] text-destructive">
            {evidence.error instanceof Error ? evidence.error.message : "Could not load evidence"}
          </p>
        ) : null}
        {evidence.data ? (
          <div className="mt-4 space-y-5 text-[12.5px]">
            <section>
              <p className="mb-2 font-medium">Worker runs</p>
              {evidence.data.worker_runs.length === 0 ? (
                <p className="text-muted-foreground">No related worker run.</p>
              ) : (
                evidence.data.worker_runs.map((run) => (
                  <div key={run.id} className="mb-2 rounded-lg border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={run.status === "failed" ? "danger" : "success"}>
                        {run.status}
                      </StatusBadge>
                      <span className="font-medium">{run.worker}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {when(run.started_at)} · {run.duration_ms ?? "—"} ms · processed{" "}
                      {run.processed} · failed {run.failed}
                      {run.error_class ? ` · ${run.error_class}` : ""}
                      {run.correlation_id ? ` · ${run.correlation_id}` : ""}
                    </p>
                  </div>
                ))
              )}
            </section>
            <section>
              <p className="mb-2 font-medium">Diagnostics</p>
              {evidence.data.diagnostics.length === 0 ? (
                <p className="text-muted-foreground">No diagnostics recorded for this incident.</p>
              ) : (
                evidence.data.diagnostics.map((row) => (
                  <div key={row.id} className="mb-2 rounded-lg border border-border p-2.5">
                    <p className="font-medium">
                      {SUBSYSTEM_LABELS[row.subsystem] ?? row.subsystem} · {row.operation}
                    </p>
                    <p className="mt-1">{row.message}</p>
                    <p className="mt-1 text-muted-foreground">
                      {when(row.occurred_at)} ·{" "}
                      {ERROR_CATEGORY_LABELS[row.error_category] ?? row.error_category}
                      {row.correlation_id ? ` · ${row.correlation_id}` : ""}
                    </p>
                  </div>
                ))
              )}
            </section>
            <section>
              <p className="mb-2 font-medium">Courier API calls</p>
              {evidence.data.courier_api_calls.length === 0 ? (
                <p className="text-muted-foreground">No provider calls linked.</p>
              ) : (
                evidence.data.courier_api_calls.map((call) => (
                  <div key={call.id} className="mb-2 rounded-lg border border-border p-2.5">
                    <p className="font-medium">{call.operation}</p>
                    <p className="mt-1 text-muted-foreground">
                      {when(call.created_at)} · {call.succeeded ? "ok" : "failed"}
                      {call.safe_message ? ` · ${call.safe_message}` : ""}
                    </p>
                  </div>
                ))
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AlertRow({
  alert,
  canManage,
  onInvestigate,
}: {
  alert: OperationalAlert;
  canManage: boolean;
  onInvestigate: (id: string) => void;
}) {
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: () => acknowledgeAlert(alert.id),
    onSuccess: () => {
      toast.success("Incident acknowledged for the next 24 hours");
      void qc.invalidateQueries({ queryKey: ["operational-health"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not acknowledge this incident"),
  });

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</StatusBadge>
            <p className="text-[13px] font-medium">{alert.title}</p>
            {alert.status === "acknowledged" ? (
              <StatusBadge tone="neutral">Acknowledged</StatusBadge>
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{alert.detail}</p>
          <p className="mt-1 text-[12.5px]">{alert.recommended_action}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {ALERT_CATEGORY_LABELS[alert.category] ?? alert.category} · first seen{" "}
            {when(alert.first_detected_at)} · last seen {when(alert.last_detected_at)} ·{" "}
            {alert.detection_count} detection{alert.detection_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => onInvestigate(alert.id)}>
          <FileSearch className="mr-1.5 h-3.5 w-3.5" /> Investigate
        </Button>
        {canManage && alert.status === "open" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={ack.isPending}
            onClick={() => ack.mutate()}
          >
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            {ack.isPending ? "Acknowledging…" : "Acknowledge"}
          </Button>
        ) : null}
        </div>
      </div>
    </div>
  );
}

export function OperationalAlertsPanel() {
  const { canManage } = useCommercePermissions();
  const [investigating, setInvestigating] = useState<string | null>(null);
  const health = useQuery({
    queryKey: ["operational-health"],
    queryFn: () => getOperationalHealth(),
    refetchInterval: 60_000,
  });

  const s = health.data?.summary;
  const alerts = health.data?.alerts ?? [];

  return (
    <section className="mb-4 rounded-lg border border-border p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <BellRing className="h-4 w-4" /> Operational incidents
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Detected on every sweeper run from worker, courier and settlement data. Incidents close
            themselves once the condition clears.
          </p>
        </div>
        {s ? (
          <p className="text-[12px] text-muted-foreground tabular-nums">
            {s.critical} critical · {s.warning} warning · {s.acknowledged} acknowledged ·{" "}
            {s.resolved_24h} resolved (24h)
          </p>
        ) : null}
      </div>

      {health.isError ? (
        <p className="text-[12.5px] text-destructive">
          Operational incidents are unavailable right now.
        </p>
      ) : health.isLoading ? (
        <p className="text-[12.5px] text-muted-foreground">Loading incidents…</p>
      ) : alerts.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          No open incidents. Workers, courier events and settlements are within thresholds.
        </p>
      ) : (
        <div className="grid gap-2">
          {alerts.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              canManage={canManage}
              onInvestigate={setInvestigating}
            />
          ))}
        </div>
      )}

      <EvidenceSheet alertId={investigating} onClose={() => setInvestigating(null)} />
    </section>
  );
}
