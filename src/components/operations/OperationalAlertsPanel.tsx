/**
 * Operational incidents panel.
 *
 * Reads the authoritative `operational_health_overview` projection: one row per
 * distinct problem, deduplicated by fingerprint, with a plain-language detail
 * and the recommended operator action. Acknowledgement goes through the
 * controlled RPC and is enforced in the database.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, ShieldCheck } from "lucide-react";
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

function when(value: string): string {
  return new Date(value).toLocaleString();
}

function AlertRow({ alert, canManage }: { alert: OperationalAlert; canManage: boolean }) {
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
  );
}

export function OperationalAlertsPanel() {
  const { canManage } = useCommercePermissions();
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
            <AlertRow key={a.id} alert={a} canManage={canManage} />
          ))}
        </div>
      )}
    </section>
  );
}
