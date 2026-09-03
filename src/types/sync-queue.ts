/** Background sales-channel synchronisation queue types. */

export type SyncJobStatus =
  | "pending"
  | "retry_wait"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "superseded";

export type SyncFailureClass = "transient" | "permanent" | "unknown";

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
  listing_status: string;
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
};

export const SYNC_OPERATION_LABELS: Record<QueueableOperation, string> = {
  listing_update: "Product sync",
  price_sync: "Price sync",
  stock_sync: "Stock sync",
  status_refresh: "Status refresh",
};
