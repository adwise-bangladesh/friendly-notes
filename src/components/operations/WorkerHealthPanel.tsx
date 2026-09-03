/**
 * Scheduled worker health.
 *
 * Reads the authoritative `worker_run_health` projection: last run, staleness,
 * 24h counts and the real backlog each worker is responsible for. Manual runs
 * go through the same controlled worker paths as the scheduler.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getWorkerHealth, WORKER_LABELS } from "@/lib/workers";
import type { WorkerHealthRow } from "@/lib/workers";
import { runCourierTrackingNow, runOpsSweeperNow } from "@/lib/workers.functions";
import { useCommercePermissions } from "@/hooks/use-permissions";

function relative(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function rowTone(row: WorkerHealthRow) {
  if (row.last_run?.status === "failed" || row.abandoned_runs > 0) return "danger" as const;
  if (row.is_stale) return "warning" as const;
  return "success" as const;
}

function rowLabel(row: WorkerHealthRow) {
  if (row.abandoned_runs > 0) return "Abandoned run";
  if (row.last_run?.status === "failed") return "Last run failed";
  if (row.is_stale) return "No recent success";
  return "Healthy";
}

export function WorkerHealthPanel() {
  const qc = useQueryClient();
  const { canManage } = useCommercePermissions();

  const health = useQuery({
    queryKey: ["worker-health"],
    queryFn: () => getWorkerHealth(),
    refetchInterval: 30_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["worker-health"] });
    void qc.invalidateQueries({ queryKey: ["job-queue-health"] });
    void qc.invalidateQueries({ queryKey: ["background-jobs"] });
  };

  const pollFn = useServerFn(runCourierTrackingNow);
  const sweepFn = useServerFn(runOpsSweeperNow);

  const poll = useMutation({
    mutationFn: () => pollFn({ data: { batchSize: 5 } }),
    onSuccess: (s) => {
      toast.success(`Tracking poll finished · ${s.polled} polled, ${s.failed} failed`);
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "The tracking run failed"),
  });

  const sweep = useMutation({
    mutationFn: () => sweepFn({ data: {} }),
    onSuccess: (s) => {
      toast.success(
        `Sweep finished · ${s.staleSyncJobsReclaimed} stale jobs reclaimed, ${s.courierEventsRetried} events retried, ${s.alertsDetected} incidents detected`,
      );
      void qc.invalidateQueries({ queryKey: ["operational-health"] });
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "The sweep failed"),
  });


  const data = health.data;
  const backlog = data?.backlog;

  return (
    <section className="mb-4 rounded-lg border border-border p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Scheduled workers</h2>
          <p className="text-[12px] text-muted-foreground">
            A worker is flagged stale when it has not succeeded in the last{" "}
            {data?.stale_after_minutes ?? 30} minutes.
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={poll.isPending}
              onClick={() => poll.mutate()}
            >
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
              {poll.isPending ? "Polling…" : "Poll couriers now"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sweep.isPending}
              onClick={() => sweep.mutate()}
            >
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
              {sweep.isPending ? "Sweeping…" : "Sweep stuck work"}
            </Button>
          </div>
        ) : null}
      </div>

      {health.isError ? (
        <p className="text-[12.5px] text-destructive">Worker health is unavailable right now.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {(data?.workers ?? []).map((row) => (
            <div key={row.worker} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium">{WORKER_LABELS[row.worker]}</p>
                <StatusBadge tone={rowTone(row)}>{rowLabel(row)}</StatusBadge>
              </div>
              <dl className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <dt>Last success</dt>
                  <dd className="tabular-nums">{relative(row.last_success_at)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Runs / failures (24h)</dt>
                  <dd className="tabular-nums">
                    {row.runs_24h} / {row.failures_24h}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Last run</dt>
                  <dd className="tabular-nums">
                    {row.last_run
                      ? `${row.last_run.processed} processed · ${row.last_run.failed} failed`
                      : "No runs yet"}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      {backlog ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Backlog · {backlog.sync_jobs_pending} sync jobs waiting, {backlog.sync_jobs_running}{" "}
          running, {backlog.tracking_polls_due} tracking polls due,{" "}
          {backlog.courier_events_retry_scheduled} courier events retrying,{" "}
          {backlog.courier_events_dead_letter} dead-lettered.
        </p>
      ) : null}
    </section>
  );
}
