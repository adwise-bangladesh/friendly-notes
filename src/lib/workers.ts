/**
 * Worker health — read-only client access to the authoritative
 * `worker_run_health` projection. No secret, payload or credential is exposed;
 * the function authorises the caller with `can_read_commerce` itself.
 */

import { supabase } from "@/integrations/supabase/client";

export type WorkerName = "courier_tracking" | "sync_queue" | "ops_sweeper";

export interface WorkerLastRun {
  id: string;
  status: "running" | "succeeded" | "failed";
  trigger_source: "scheduled" | "manual";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  claimed: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  error_class: string | null;
}

export interface WorkerHealthRow {
  worker: WorkerName;
  last_run: WorkerLastRun | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  abandoned_runs: number;
  runs_24h: number;
  failures_24h: number;
  is_stale: boolean;
}

export interface WorkerHealth {
  stale_after_minutes: number;
  generated_at: string;
  workers: WorkerHealthRow[];
  backlog: {
    sync_jobs_pending: number;
    sync_jobs_running: number;
    courier_events_retry_scheduled: number;
    courier_events_dead_letter: number;
    tracking_polls_due: number;
  };
}

export const WORKER_LABELS: Record<WorkerName, string> = {
  courier_tracking: "Courier tracking",
  sync_queue: "Sales channel sync",
  ops_sweeper: "Stuck-state sweeper",
};

export async function getWorkerHealth(staleMinutes = 30): Promise<WorkerHealth> {
  const { data, error } = await supabase.rpc("worker_run_health", {
    _stale_minutes: staleMinutes,
  });
  if (error) throw new Error(error.message);
  return data as unknown as WorkerHealth;
}
