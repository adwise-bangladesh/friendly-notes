/**
 * Background jobs workspace.
 *
 * Every number here is derived from the authoritative job and attempt rows by
 * `sync_queue_health` / `list_sync_jobs`, so nothing can drift from the
 * Operations Command Center. All mutations go through controlled server
 * functions; the job tables reject direct writes.
 */

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlayCircle, RefreshCw, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { StatusTone } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { getQueueHealth, getSyncJobs } from "@/lib/sync-queue";
import { processSyncQueueNow } from "@/lib/sync-queue.functions";
import { WorkerHealthPanel } from "@/components/operations/WorkerHealthPanel";
import { OperationalAlertsPanel } from "@/components/operations/OperationalAlertsPanel";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  JOB_TYPE_LABELS,
  SYNC_FAILURE_CLASS_LABELS,
  SYNC_JOB_STATUS_LABELS,
  SYNC_OPERATION_LABELS,
  priorityBand,
} from "@/types/sync-queue";
import type {
  BackgroundJobType,
  SyncFailureClass,
  SyncJobStatus,
} from "@/types/sync-queue";

const TITLE = "Background jobs · Commerce Operations";
const DESCRIPTION =
  "Queue health, retries, dead-letter recovery and execution history for every background job.";

export const Route = createFileRoute("/_authenticated/operations/jobs")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobsPage,
});

export const JOB_TONE: Record<SyncJobStatus, StatusTone> = {
  pending: "info",
  retry_wait: "warning",
  processing: "info",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  superseded: "neutral",
  dead_letter: "danger",
};

const PAGE_SIZE = 25;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function JobsPage() {
  const qc = useQueryClient();
  const { canManage } = useCommercePermissions();

  const [status, setStatus] = useState<SyncJobStatus | "all">("all");
  const [jobType, setJobType] = useState<BackgroundJobType | "all">("all");
  const [failureClass, setFailureClass] = useState<SyncFailureClass | "all">("all");
  const [sort, setSort] = useState<"recent" | "oldest" | "priority">("recent");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const health = useQuery({
    queryKey: ["job-queue-health"],
    queryFn: () => getQueueHealth(),
    refetchInterval: 20_000,
  });

  const jobs = useQuery({
    queryKey: ["background-jobs", status, jobType, failureClass, sort, search, page],
    queryFn: () =>
      getSyncJobs(undefined, {
        ...(status === "all" ? {} : { status }),
        ...(jobType === "all" ? {} : { jobType }),
        ...(failureClass === "all" ? {} : { failureClass }),
        ...(search.trim() ? { search: search.trim() } : {}),
        sort,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: 20_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["background-jobs"] });
    void qc.invalidateQueries({ queryKey: ["job-queue-health"] });
  };

  const runWorker = useServerFn(processSyncQueueNow);
  const workerMutation = useMutation({
    mutationFn: () => runWorker({ data: { batchSize: 5 } }),
    onSuccess: (summary) => {
      toast.success(
        `Processed ${summary.processed} of ${summary.claimed} claimed jobs · ${summary.succeeded} succeeded, ${summary.failed} failed`,
      );
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The worker run failed"),
  });

  const h = health.data;
  const rows = jobs.data?.rows ?? [];
  const total = jobs.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Background jobs"
        description="Derived from the authoritative job queue — the worker runs only when triggered."
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/operations">Command Center</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
            {canManage ? (
              <Button
                size="sm"
                disabled={workerMutation.isPending}
                onClick={() => workerMutation.mutate()}
              >
                <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                {workerMutation.isPending ? "Processing…" : "Process queue now"}
              </Button>
            ) : null}
          </div>
        }
      />

      <OperationalAlertsPanel />

      <WorkerHealthPanel />

      <div className="mb-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <Stat label="Waiting" value={h?.queue_depth ?? 0} />
        <Stat label="Running" value={h?.processing_count ?? 0} />
        <Stat label="Retrying" value={h?.retry_count ?? 0} />
        <Stat label="Overdue" value={h?.overdue_count ?? 0} />
        <Stat label="Failed" value={h?.failed_count ?? 0} />
        <Stat label="Dead letter" value={h?.dead_letter_count ?? 0} />
        <Stat
          label="Success rate (24h)"
          value={h?.success_rate_24h == null ? "No data" : `${h.success_rate_24h}%`}
        />
      </div>

      <div className="mb-4 grid gap-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <p className="text-muted-foreground">Oldest waiting job</p>
          <p className="mt-0.5 font-medium">
            {h?.oldest_waiting_at ? new Date(h.oldest_waiting_at).toLocaleString() : "None waiting"}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-muted-foreground">Last worker activity</p>
          <p className="mt-0.5 font-medium">
            {h?.last_worker_activity_at
              ? new Date(h.last_worker_activity_at).toLocaleString()
              : "No data"}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-muted-foreground">Average attempt duration</p>
          <p className="mt-0.5 font-medium">
            {h?.avg_duration_ms == null ? "No data" : `${Math.round(h.avg_duration_ms)} ms`}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-muted-foreground">Stale leases · auth failures</p>
          <p className="mt-0.5 font-medium">
            {h?.stale_lease_count ?? 0} · {h?.auth_failure_count ?? 0}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search product, channel or error"
          className="h-9 w-60"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as SyncJobStatus | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="h-9 w-44 text-[13px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(SYNC_JOB_STATUS_LABELS) as SyncJobStatus[]).map((v) => (
              <SelectItem key={v} value={v}>
                {SYNC_JOB_STATUS_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={jobType}
          onValueChange={(v) => {
            setJobType(v as BackgroundJobType | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="h-9 w-52 text-[13px]">
            <SelectValue placeholder="Job type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All job types</SelectItem>
            {(Object.keys(JOB_TYPE_LABELS) as BackgroundJobType[]).map((v) => (
              <SelectItem key={v} value={v}>
                {JOB_TYPE_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={failureClass}
          onValueChange={(v) => {
            setFailureClass(v as SyncFailureClass | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="h-9 w-44 text-[13px]">
            <SelectValue placeholder="Failure type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All failure types</SelectItem>
            {(Object.keys(SYNC_FAILURE_CLASS_LABELS) as SyncFailureClass[]).map((v) => (
              <SelectItem key={v} value={v}>
                {SYNC_FAILURE_CLASS_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as "recent" | "oldest" | "priority")}>
          <SelectTrigger className="h-9 w-40 text-[13px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {jobs.isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No background jobs match"
          description="Jobs appear here when published listings change or an operator queues work."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Priority</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">Next / finished</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((job) => (
                  <tr key={job.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{job.product_title ?? "Background job"}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {job.channel_name ?? job.provider ?? "—"} ·{" "}
                        {SYNC_OPERATION_LABELS[job.operation] ?? job.operation}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {JOB_TYPE_LABELS[job.job_type ?? "channel_listing_sync"]}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={JOB_TONE[job.status]}>
                        {SYNC_JOB_STATUS_LABELS[job.status]}
                      </StatusBadge>
                      {job.last_error ? (
                        <div className="mt-1 max-w-xs text-[12px] text-destructive">
                          {job.last_error}
                        </div>
                      ) : null}
                      {job.failure_class ? (
                        <div className="text-[12px] text-muted-foreground">
                          {SYNC_FAILURE_CLASS_LABELS[job.failure_class]}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[12px] capitalize text-muted-foreground">
                      {priorityBand(job.priority)}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {job.attempts}/{job.max_attempts}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {job.status === "pending" || job.status === "retry_wait"
                        ? new Date(job.available_at).toLocaleString()
                        : job.completed_at
                          ? new Date(job.completed_at).toLocaleString()
                          : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/operations/jobs/$jobId" params={{ jobId: job.id }}>
                          Open
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
