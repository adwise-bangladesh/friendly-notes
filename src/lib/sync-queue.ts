/**
 * Background sync queue — browser data access.
 *
 * Reads only. Every queue mutation goes through the server functions in
 * `sync-queue.functions.ts`, which call the controlled database functions;
 * the job table itself rejects direct writes.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  JobDetail,
  QueueHealth,
  SyncJobFilters,
  SyncJobRow,
  SyncQueueOverview,
} from "@/types/sync-queue";

const EMPTY_OVERVIEW: SyncQueueOverview = {
  pending: 0,
  retry_wait: 0,
  processing: 0,
  failed: 0,
  succeeded_24h: 0,
  oldest_waiting_at: null,
};

export async function getSyncQueueOverview(storeId?: string): Promise<SyncQueueOverview> {
  const { data, error } = await supabase.rpc("sync_queue_overview", {
    ...(storeId ? { _store_id: storeId } : {}),
  });
  if (error) throw new Error(error.message);
  return { ...EMPTY_OVERVIEW, ...((data ?? {}) as Partial<SyncQueueOverview>) };
}

export async function getSyncJobs(
  storeId: string | undefined,
  filters: SyncJobFilters = {},
): Promise<{ rows: SyncJobRow[]; total: number }> {
  const { data, error } = await supabase.rpc("list_sync_jobs", {
    ...(storeId ? { _store_id: storeId } : {}),
    ...(filters.status ? { _status: filters.status } : {}),
    ...(filters.listingId ? { _listing_id: filters.listingId } : {}),
    ...(filters.jobType ? { _job_type: filters.jobType } : {}),
    ...(filters.failureClass ? { _failure_class: filters.failureClass } : {}),
    ...(filters.accountId ? { _account_id: filters.accountId } : {}),
    ...(filters.operation ? { _operation: filters.operation } : {}),
    ...(filters.search ? { _search: filters.search } : {}),
    ...(filters.from ? { _from: filters.from } : {}),
    ...(filters.to ? { _to: filters.to } : {}),
    ...(filters.sort ? { _sort: filters.sort } : {}),
    _limit: filters.limit ?? 25,
    _offset: filters.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? { total: 0, rows: [] }) as { total?: number; rows?: SyncJobRow[] };
  return { rows: result.rows ?? [], total: Number(result.total ?? 0) };
}

/**
 * Derived queue health. Every number comes from the authoritative job and
 * attempt rows, so the workspace and the Operations Command Center can never
 * disagree; rates are null when there is not enough recent data.
 */
export async function getQueueHealth(storeId?: string): Promise<QueueHealth> {
  const { data, error } = await supabase.rpc("sync_queue_health", {
    ...(storeId ? { _store_id: storeId } : {}),
  });
  if (error) throw new Error(error.message);
  return data as unknown as QueueHealth;
}

export async function getJobDetail(jobId: string): Promise<JobDetail> {
  const { data, error } = await supabase.rpc("get_sync_job", { _job_id: jobId });
  if (error) throw new Error(error.message);
  return data as unknown as JobDetail;
}
