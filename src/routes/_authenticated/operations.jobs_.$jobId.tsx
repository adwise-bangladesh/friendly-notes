/**
 * Background job detail.
 *
 * Identity, source, processing and lease state, sanitized failure detail and
 * the append-only attempt history. Recovery actions are permission-gated in
 * the UI and re-checked inside the controlled database functions.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { getJobDetail } from "@/lib/sync-queue";
import {
  cancelSyncJob,
  recoverStaleSyncJob,
  requeueSyncJob,
} from "@/lib/sync-queue.functions";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  JOB_TYPE_LABELS,
  SYNC_FAILURE_CLASS_LABELS,
  SYNC_JOB_STATUS_LABELS,
  SYNC_OPERATION_LABELS,
  priorityBand,
} from "@/types/sync-queue";
import { JOB_TONE } from "./operations.jobs";

const TITLE = "Background job detail · Commerce Operations";
const DESCRIPTION =
  "Lifecycle, retry policy, worker lease and append-only execution history for a background job.";

export const Route = createFileRoute("/_authenticated/operations/jobs_/$jobId")({
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
  component: JobDetailPage,
});

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium">{value}</p>
    </div>
  );
}

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const qc = useQueryClient();
  const { canManage, canArchive } = useCommercePermissions();

  const detail = useQuery({
    queryKey: ["background-job", jobId],
    queryFn: () => getJobDetail(jobId),
    refetchInterval: 20_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["background-job", jobId] });
    void qc.invalidateQueries({ queryKey: ["background-jobs"] });
    void qc.invalidateQueries({ queryKey: ["job-queue-health"] });
  };

  const cancelJob = useServerFn(cancelSyncJob);
  const requeueJob = useServerFn(requeueSyncJob);
  const recoverJob = useServerFn(recoverStaleSyncJob);

  const fail = (error: unknown, fallback: string) =>
    toast.error(error instanceof Error ? error.message : fallback);

  const cancelMutation = useMutation({
    mutationFn: () => cancelJob({ data: { jobId } }),
    onSuccess: () => {
      toast.success("Job cancelled");
      refresh();
    },
    onError: (e: unknown) => fail(e, "The job could not be cancelled"),
  });

  const requeueMutation = useMutation({
    mutationFn: () => requeueJob({ data: { jobId } }),
    onSuccess: () => {
      toast.success("A new attempt has been queued");
      refresh();
    },
    onError: (e: unknown) => fail(e, "The job could not be re-queued"),
  });

  const recoverMutation = useMutation({
    mutationFn: () => recoverJob({ data: { jobId } }),
    onSuccess: (result) => {
      toast.success(`Job recovered · now ${result.status}`);
      refresh();
    },
    onError: (e: unknown) => fail(e, "The job could not be recovered"),
  });

  if (detail.isLoading) return <LoadingState />;
  if (detail.isError || !detail.data) {
    return (
      <p className="text-[13px] text-destructive">
        {detail.error instanceof Error ? detail.error.message : "This job could not be loaded"}
      </p>
    );
  }

  const { job, attempts, runs } = detail.data;
  const leaseExpired = job.lease_expires_at
    ? new Date(job.lease_expires_at).getTime() < Date.now()
    : false;
  const canRequeue =
    job.status === "failed" || job.status === "cancelled" || job.status === "dead_letter";
  const canCancel =
    job.status === "pending" ||
    job.status === "retry_wait" ||
    job.status === "failed" ||
    job.status === "dead_letter";

  return (
    <>
      <PageHeader
        title={job.product_title ?? "Background job"}
        description={`${JOB_TYPE_LABELS[job.job_type ?? "channel_listing_sync"]} · ${
          SYNC_OPERATION_LABELS[job.operation] ?? job.operation
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/operations/jobs">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> All jobs
              </Link>
            </Button>
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
            {canManage && canRequeue ? (
              <Button
                size="sm"
                disabled={requeueMutation.isPending}
                onClick={() => requeueMutation.mutate()}
              >
                Re-queue
              </Button>
            ) : null}
            {canManage && canCancel ? (
              <Button
                size="sm"
                variant="outline"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel
              </Button>
            ) : null}
            {canArchive && job.status === "processing" && leaseExpired ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={recoverMutation.isPending}
                onClick={() => recoverMutation.mutate()}
              >
                Recover stale job
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Identity</h2>
          <div className="grid gap-3">
            <Field label="Status" value={
              <StatusBadge tone={JOB_TONE[job.status]}>
                {SYNC_JOB_STATUS_LABELS[job.status]}
              </StatusBadge>
            } />
            <Field label="Priority" value={<span className="capitalize">{priorityBand(job.priority)} ({job.priority})</span>} />
            <Field label="Job type" value={JOB_TYPE_LABELS[job.job_type ?? "channel_listing_sync"]} />
            <Field label="Job ID" value={<span className="font-mono text-[11px]">{job.id}</span>} />
            <Field label="Queued by" value={job.source} />
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Source</h2>
          <div className="grid gap-3">
            <Field label="Store" value={job.store_name ?? "—"} />
            <Field label="Sales channel" value={job.channel_name ?? job.provider ?? "—"} />
            <Field label="Product" value={job.product_title ?? "—"} />
            <Field
              label="Listing"
              value={
                job.listing_id ? (
                  <span className="font-mono text-[11px]">
                    {job.listing_id} · {job.listing_status ?? "—"}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Depends on"
              value={
                job.depends_on_job_id ? (
                  <Link
                    className="font-mono text-[11px] underline"
                    to="/operations/jobs_/$jobId"
                    params={{ jobId: job.depends_on_job_id }}
                  >
                    {job.depends_on_job_id}
                  </Link>
                ) : (
                  "Nothing"
                )
              }
            />
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Processing</h2>
          <div className="grid gap-3">
            <Field label="Attempts" value={`${job.attempts} of ${job.max_attempts}`} />
            <Field label="Worker" value={job.worker_id ?? "Not held"} />
            <Field
              label="Lease"
              value={
                job.lease_expires_at
                  ? `${leaseExpired ? "Expired" : "Held"} until ${when(job.lease_expires_at)}`
                  : "No active lease"
              }
            />
            <Field label="Next run" value={when(job.available_at)} />
            <Field label="Rate-limit hold" value={when(job.retry_after)} />
            <Field label="Last attempt" value={when(job.last_attempt_at)} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Failure</h2>
        {job.failure_class || job.last_error ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="Failure type"
              value={job.failure_class ? SYNC_FAILURE_CLASS_LABELS[job.failure_class] : "—"}
            />
            <Field label="First failure" value={when(job.first_failed_at)} />
            <Field label="Final failure" value={when(job.final_failed_at)} />
            <Field label="Message" value={job.last_error ?? "—"} />
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No failures recorded.</p>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Execution history ({attempts.length})
        </div>
        {attempts.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-muted-foreground">
            This job has not been attempted yet.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Attempt</th>
                <th className="px-3 py-2 font-medium">Worker</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Finished</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">#{attempt.attempt_number}</td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {attempt.worker_id ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {when(attempt.started_at)}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {attempt.finished_at ? when(attempt.finished_at) : "In progress"}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {attempt.duration_ms == null ? "—" : `${attempt.duration_ms} ms`}
                  </td>
                  <td className="px-3 py-2">
                    {attempt.ok === null ? (
                      <span className="text-muted-foreground">Running</span>
                    ) : attempt.ok ? (
                      <StatusBadge tone="success">Succeeded</StatusBadge>
                    ) : (
                      <>
                        <StatusBadge tone="danger">
                          {attempt.failure_class
                            ? SYNC_FAILURE_CLASS_LABELS[attempt.failure_class]
                            : "Failed"}
                        </StatusBadge>
                        {attempt.message ? (
                          <div className="mt-1 text-[12px] text-muted-foreground">
                            {attempt.message}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {runs.length > 0 ? (
        <div className="mt-4 rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Related provider operations
          </div>
          <ul className="divide-y divide-border text-[12.5px]">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  {run.sync_type} · {run.status}
                  {run.message ? ` · ${run.message}` : ""}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {when(run.started_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
