/** Background sales-channel synchronisation queue types. */

export type SyncJobStatus =
  | "pending"
  | "retry_wait"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "superseded"
  | "dead_letter";

export type SyncFailureClass =
  | "transient"
  | "permanent"
  | "rate_limited"
  | "authentication"
  | "unknown";

/** Registered background job kinds. Unknown types are rejected server-side. */
export type BackgroundJobType =
  | "channel_listing_sync"
  | "inventory_sync"
  | "courier_status_refresh"
  | "webhook_recovery";

/** Numeric priority is authoritative; these are the operational bands. */
export type JobPriorityBand = "critical" | "high" | "normal" | "low";

export const JOB_PRIORITY_VALUE: Record<JobPriorityBand, number> = {
  critical: 10,
  high: 50,
  normal: 100,
  low: 200,
};

export function priorityBand(priority: number): JobPriorityBand {
  if (priority <= 10) return "critical";
  if (priority <= 50) return "high";
  if (priority <= 100) return "normal";
  return "low";
}

/** Only representation-level operations may run in the background. */
export type QueueableOperation = "listing_update" | "price_sync" | "stock_sync" | "status_refresh";

export interface SyncJobRow {
  id: string;
  listing_id: string;
  store_id: string;
  operation: QueueableOperation;
  status: SyncJobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: string;
  completed_at: string | null;
  last_error: string | null;
  failure_class: SyncFailureClass | null;
  source: string;
  created_at: string;
  updated_at: string;
  provider: string;
  channel_name: string | null;
  product_title: string | null;
  listing_status: string | null;
  job_type?: BackgroundJobType;
  last_attempt_at?: string | null;
  first_failed_at?: string | null;
  final_failed_at?: string | null;
  retry_after?: string | null;
  lease_expires_at?: string | null;
  worker_id?: string | null;
}

export interface JobAttempt {
  id: string;
  attempt_number: number;
  worker_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  ok: boolean | null;
  failure_class: SyncFailureClass | null;
  message: string | null;
  run_id: string | null;
}

export interface JobSyncRun {
  id: string;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  message: string | null;
}

export interface JobDetail {
  job: SyncJobRow & {
    store_name: string | null;
    claimed_at: string | null;
    depends_on_job_id: string | null;
    last_run_id: string | null;
    source_reference: string | null;
    sales_channel_account_id: string | null;
  };
  attempts: JobAttempt[];
  runs: JobSyncRun[];
}

/** Derived queue health. Nulls mean "not enough data", never a fake number. */
export interface QueueHealth {
  queue_depth: number;
  processing_count: number;
  retry_count: number;
  failed_count: number;
  dead_letter_count: number;
  cancelled_count: number;
  succeeded_24h: number;
  oldest_waiting_at: string | null;
  overdue_count: number;
  stale_lease_count: number;
  auth_failure_count: number;
  rate_limited_count: number;
  sample_24h: number;
  failure_rate_24h: number | null;
  success_rate_24h: number | null;
  avg_duration_ms: number | null;
  last_worker_activity_at: string | null;
  attempts_24h: number;
}

export interface SyncQueueOverview {
  pending: number;
  retry_wait: number;
  processing: number;
  failed: number;
  succeeded_24h: number;
  oldest_waiting_at: string | null;
}

export interface SyncJobFilters {
  status?: SyncJobStatus;
  listingId?: string;
  jobType?: BackgroundJobType;
  failureClass?: SyncFailureClass;
  accountId?: string;
  operation?: QueueableOperation;
  search?: string;
  from?: string;
  to?: string;
  sort?: "recent" | "oldest" | "priority";
  limit?: number;
  offset?: number;
}

export const SYNC_JOB_STATUS_LABELS: Record<SyncJobStatus, string> = {
  pending: "Waiting",
  retry_wait: "Retry scheduled",
  processing: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  superseded: "Superseded",
  dead_letter: "Dead letter",
};

export const SYNC_FAILURE_CLASS_LABELS: Record<SyncFailureClass, string> = {
  transient: "Temporary",
  permanent: "Permanent",
  rate_limited: "Rate limited",
  authentication: "Authentication",
  unknown: "Unknown",
};

export const JOB_TYPE_LABELS: Record<BackgroundJobType, string> = {
  channel_listing_sync: "Channel listing sync",
  inventory_sync: "Inventory sync",
  courier_status_refresh: "Courier status refresh",
  webhook_recovery: "Webhook recovery",
};

export const SYNC_OPERATION_LABELS: Record<QueueableOperation, string> = {
  listing_update: "Product sync",
  price_sync: "Price sync",
  stock_sync: "Stock sync",
  status_refresh: "Status refresh",
};
