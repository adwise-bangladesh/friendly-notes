/**
 * One channel listing with its readiness panel and the operations the
 * provider genuinely supports. Every action calls a server operation; the
 * readiness verdict shown here is produced by the database, not the browser.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { StatusTone } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import { getListingReadiness, setChannelListingStatus } from "@/lib/store-catalog";
import { checkListingReadiness, runListingOperation } from "@/lib/channel-publishing.functions";
import { OPERATION_LABELS, supportsOperation } from "@/lib/sales-channels/capabilities";
import type { ListingOperation } from "@/lib/sales-channels/capabilities";
import { CHANNEL_LISTING_STATUS_LABELS } from "@/types/store-catalog";
import type { ChannelListing, ChannelListingStatus } from "@/types/store-catalog";
import { queueListingSync, cancelSyncJob } from "@/lib/sync-queue.functions";
import { getSyncJobs } from "@/lib/sync-queue";
import { SYNC_JOB_STATUS_LABELS, SYNC_OPERATION_LABELS } from "@/types/sync-queue";
import type { QueueableOperation } from "@/types/sync-queue";

const LISTING_TONE: Record<ChannelListingStatus, StatusTone> = {
  not_published: "neutral",
  ready: "info",
  publishing: "info",
  published: "success",
  update_pending: "warning",
  syncing: "info",
  sync_failed: "danger",
  paused: "warning",
  archived: "warning",
};

/** Only representation refreshes may run unattended. */
const QUEUEABLE: QueueableOperation[] = ["listing_update", "price_sync", "stock_sync"];

const BEFORE_PUBLISH: ListingOperation[] = ["listing_publish"];
const AFTER_PUBLISH: ListingOperation[] = [
  "status_refresh",
  "listing_update",
  "price_sync",
  "stock_sync",
  "unpublish",
];

interface Props {
  listing: ChannelListing;
  channelName: string;
  provider: string;
  channelStatus: string;
  canManage: boolean;
  canArchive: boolean;
  onChanged: () => void;
}

export function ChannelListingCard({
  listing,
  channelName,
  provider,
  channelStatus,
  canManage,
  canArchive,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ListingOperation | null>(null);
  const runOperation = useServerFn(runListingOperation);
  const auditReadiness = useServerFn(checkListingReadiness);

  const readinessQuery = useQuery({
    queryKey: ["listing-readiness", listing.id, listing.listing_status, listing.updated_at],
    queryFn: () => getListingReadiness(listing.id),
  });
  const readiness = readinessQuery.data;

  const published = Boolean(listing.external_product_id);
  const operations = (published ? AFTER_PUBLISH : BEFORE_PUBLISH).filter((operation) =>
    supportsOperation(provider, operation),
  );

  const operationMutation = useMutation({
    mutationFn: async (operation: ListingOperation) => {
      setBusy(operation);
      return runOperation({ data: { listingId: listing.id, operation } });
    },
    onSettled: () => setBusy(null),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      void qc.invalidateQueries({ queryKey: ["listing-readiness", listing.id] });
      onChanged();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The operation failed"),
  });

  const statusMutation = useMutation({
    mutationFn: (status: ChannelListingStatus) => setChannelListingStatus(listing.id, status),
    onSuccess: () => {
      toast.success("Listing updated");
      void qc.invalidateQueries({ queryKey: ["listing-readiness", listing.id] });
      onChanged();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The listing could not be updated"),
  });

  const queueSync = useServerFn(queueListingSync);
  const cancelJob = useServerFn(cancelSyncJob);

  const jobsQuery = useQuery({
    queryKey: ["listing-sync-jobs", listing.id, listing.updated_at],
    queryFn: () => getSyncJobs(undefined, { listingId: listing.id, limit: 5 }),
  });
  const jobs = jobsQuery.data?.rows ?? [];

  const refreshJobs = () => {
    void qc.invalidateQueries({ queryKey: ["listing-sync-jobs", listing.id] });
  };

  const queueMutation = useMutation({
    mutationFn: (operation: QueueableOperation) =>
      queueSync({ data: { listingId: listing.id, operation } }),
    onSuccess: () => {
      toast.success("Queued for background synchronisation");
      refreshJobs();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The job could not be queued"),
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => cancelJob({ data: { jobId } }),
    onSuccess: () => {
      toast.success("Job cancelled");
      refreshJobs();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The job could not be cancelled"),
  });

  const readinessMutation = useMutation({
    mutationFn: () => auditReadiness({ data: { listingId: listing.id } }),
    onSuccess: (result) => {
      toast[result.ready ? "success" : "error"](
        result.ready ? "Ready to publish" : `Blocked: ${result.blocking.join("; ")}`,
      );
      void qc.invalidateQueries({ queryKey: ["listing-readiness", listing.id] });
      onChanged();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Readiness check failed"),
  });

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {channelName}{" "}
            <span className="text-[12px] font-normal text-muted-foreground">
              · {provider} · channel {channelStatus}
            </span>
          </p>
          <p className="text-[12px] text-muted-foreground">
            {listing.external_product_id
              ? `External ID ${listing.external_product_id}`
              : "Not published yet"}
            {listing.last_synced_at
              ? ` · last sync ${new Date(listing.last_synced_at).toLocaleString()}`
              : ""}
            {listing.last_operation ? ` · ${listing.last_operation}` : ""}
          </p>
          {listing.last_sync_error ? (
            <p className="mt-1 text-[12px] text-destructive">{listing.last_sync_error}</p>
          ) : null}
          {listing.external_url ? (
            <a
              href={listing.external_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary underline"
            >
              Open on channel <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
        <StatusBadge tone={LISTING_TONE[listing.listing_status]}>
          {CHANNEL_LISTING_STATUS_LABELS[listing.listing_status]}
        </StatusBadge>
      </div>

      {/* readiness — backend verdict */}
      <div className="mt-3 rounded-md bg-muted/40 p-3 text-[12px]">
        {readinessQuery.isLoading || !readiness ? (
          <span className="text-muted-foreground">Checking readiness…</span>
        ) : (
          <div className="space-y-1.5">
            <p
              className={
                readiness.ready
                  ? "flex items-center gap-1.5 font-medium text-success"
                  : "flex items-center gap-1.5 font-medium text-destructive"
              }
            >
              {readiness.ready ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {readiness.ready ? "Ready to publish" : "Not ready to publish"}
            </p>
            {readiness.blocking.length > 0 ? (
              <ul className="list-disc pl-4 text-destructive">
                {readiness.blocking.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
            {readiness.warnings.length > 0 ? (
              <ul className="list-disc pl-4 text-muted-foreground">
                {readiness.warnings.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-muted-foreground">
              Sends: {readiness.effective_title ?? "—"} · {readiness.effective_sku ?? "no SKU"} ·{" "}
              {readiness.effective_price === null ? "—" : formatMoney(Number(readiness.effective_price))}{" "}
              · {Number(readiness.available_qty)} available
            </p>
          </div>
        )}
      </div>

      {/* background queue — jobs the engine will run without an operator */}
      {published ? (
        <div className="mt-3 rounded-md border border-border p-3 text-[12px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">Background queue</span>
            {canManage ? (
              <div className="flex flex-wrap gap-1.5">
                {QUEUEABLE.filter((operation) => supportsOperation(provider, operation)).map(
                  (operation) => (
                    <Button
                      key={operation}
                      size="sm"
                      variant="ghost"
                      disabled={queueMutation.isPending}
                      onClick={() => queueMutation.mutate(operation)}
                    >
                      Queue {SYNC_OPERATION_LABELS[operation].toLowerCase()}
                    </Button>
                  ),
                )}
              </div>
            ) : null}
          </div>
          {jobs.length === 0 ? (
            <p className="mt-1.5 text-muted-foreground">No background jobs for this listing.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{SYNC_OPERATION_LABELS[job.operation]}</span>
                  <span className="text-muted-foreground">
                    {SYNC_JOB_STATUS_LABELS[job.status]} · attempt {job.attempts}/{job.max_attempts}
                    {job.status === "retry_wait"
                      ? ` · retries ${new Date(job.available_at).toLocaleTimeString()}`
                      : ""}
                  </span>
                  {job.last_error ? (
                    <span className="text-destructive">{job.last_error}</span>
                  ) : null}
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
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={readinessMutation.isPending}
            onClick={() => readinessMutation.mutate()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Check readiness
          </Button>
          {operations.map((operation) => (
            <Button
              key={operation}
              size="sm"
              variant={operation === "listing_publish" ? "default" : "outline"}
              disabled={operationMutation.isPending}
              onClick={() => operationMutation.mutate(operation)}
            >
              {busy === operation ? "Working…" : OPERATION_LABELS[operation]}
            </Button>
          ))}
          {listing.listing_status === "published" ? (
            <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate("paused")}>
              Pause
            </Button>
          ) : null}
          {listing.listing_status === "paused" ? (
            <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate("ready")}>
              Resume
            </Button>
          ) : null}
          {canArchive && listing.listing_status !== "archived" ? (
            <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate("archived")}>
              Archive listing
            </Button>
          ) : null}
          {operations.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              This provider has no publishing support yet.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
