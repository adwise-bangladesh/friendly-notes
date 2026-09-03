/**
 * Background sync queue workspace.
 *
 * Shows what the engine is about to do, what it is retrying and what has
 * permanently failed. Actions are limited to cancelling waiting work,
 * re-queueing failed work and asking the bounded worker to run now — the
 * queue itself is only written by the controlled database functions.
 */

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, PlayCircle, RefreshCw, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { getStore } from "@/lib/stores";
import { getSyncJobs, getSyncQueueOverview } from "@/lib/sync-queue";
import { cancelSyncJob, processSyncQueueNow, requeueSyncJob } from "@/lib/sync-queue.functions";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  SYNC_JOB_STATUS_LABELS,
  SYNC_OPERATION_LABELS,
} from "@/types/sync-queue";
import type { SyncJobStatus } from "@/types/sync-queue";

const TITLE = "Channel sync queue · Commerce Operations";
const DESCRIPTION =
  "Background synchronisation jobs keeping published channel listings up to date.";

export const Route = createFileRoute("/_authenticated/stores_/$id/catalog_/sync")({
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
  component: Page,
});

const TONE: Record<SyncJobStatus, StatusTone> = {
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Page() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { canManage } = useCommercePermissions();

  const [status, setStatus] = useState<SyncJobStatus | "all">("all");
  const [page, setPage] = useState(0);

  const storeQuery = useQuery({ queryKey: ["store", id], queryFn: () => getStore(id) });
  const overviewQuery = useQuery({
    queryKey: ["sync-queue-overview", id],
    queryFn: () => getSyncQueueOverview(id),
    refetchInterval: 15_000,
  });
  const jobsQuery = useQuery({
    queryKey: ["sync-jobs", id, status, page],
    queryFn: () =>
      getSyncJobs(id, {
        ...(status === "all" ? {} : { status }),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: 15_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["sync-jobs", id] });
    void qc.invalidateQueries({ queryKey: ["sync-queue-overview", id] });
  };

  const runWorker = useServerFn(processSyncQueueNow);
  const cancelJob = useServerFn(cancelSyncJob);
  const requeueJob = useServerFn(requeueSyncJob);

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

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => cancelJob({ data: { jobId } }),
    onSuccess: () => {
      toast.success("Job cancelled");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The job could not be cancelled"),
  });

  const requeueMutation = useMutation({
    mutationFn: (jobId: string) => requeueJob({ data: { jobId } }),
    onSuccess: () => {
      toast.success("Job re-queued");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The job could not be re-queued"),
  });

  const overview = overviewQuery.data;
  const rows = jobsQuery.data?.rows ?? [];
  const total = jobsQuery.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Channel sync queue"
        description={
          storeQuery.data
            ? `${storeQuery.data.name} · background synchronisation`
            : "Background synchronisation"
        }
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/stores/$id/catalog/listings" params={{ id }}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Listings
              </Link>
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

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Waiting" value={overview?.pending ?? 0} />
        <Stat label="Retry scheduled" value={overview?.retry_wait ?? 0} />
        <Stat label="Running" value={overview?.processing ?? 0} />
        <Stat label="Failed" value={overview?.failed ?? 0} />
        <Stat label="Succeeded (24h)" value={overview?.succeeded_24h ?? 0} />
      </div>

      <div className="mb-4 max-w-xs">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as SyncJobStatus | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="text-[13px]">
            <SelectValue placeholder="Job status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All job statuses</SelectItem>
            {(Object.keys(SYNC_JOB_STATUS_LABELS) as SyncJobStatus[]).map((value) => (
              <SelectItem key={value} value={value}>
                {SYNC_JOB_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {jobsQuery.isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="Nothing in the queue"
          description="Jobs appear here when a published listing's price, content or stock changes."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Operation</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">Queued by</th>
                  <th className="px-3 py-2 font-medium">Next run</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((job) => (
                  <tr key={job.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{job.product_title ?? "—"}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {job.channel_name ?? job.provider} · listing {job.listing_status}
                      </div>
                    </td>
                    <td className="px-3 py-2">{SYNC_OPERATION_LABELS[job.operation]}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={TONE[job.status]}>
                        {SYNC_JOB_STATUS_LABELS[job.status]}
                      </StatusBadge>
                      {job.last_error ? (
                        <div className="mt-1 text-[12px] text-destructive">{job.last_error}</div>
                      ) : null}
                      {job.failure_class ? (
                        <div className="text-[12px] text-muted-foreground">
                          {job.failure_class} failure
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {job.attempts}/{job.max_attempts}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">{job.source}</td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {job.status === "pending" || job.status === "retry_wait"
                        ? new Date(job.available_at).toLocaleString()
                        : job.completed_at
                          ? new Date(job.completed_at).toLocaleString()
                          : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage && (job.status === "pending" || job.status === "retry_wait") ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={cancelMutation.isPending}
                          onClick={() => cancelMutation.mutate(job.id)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                      {canManage && (job.status === "failed" || job.status === "cancelled") ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={requeueMutation.isPending}
                          onClick={() => requeueMutation.mutate(job.id)}
                        >
                          Re-queue
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              {rows.length} of {total} jobs
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((value) => value + 1)}
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
