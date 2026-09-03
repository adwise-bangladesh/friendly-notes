# Background workers & scheduling (Step 20.9.1)

## Workers

| Worker | Endpoint | Schedule | Secret | Concurrency safety |
| --- | --- | --- | --- | --- |
| Courier tracking | `POST /api/public/courier-tracking-worker` | `*/15 * * * *` (96/day) | `worker_secret_courier_tracking` (vault) or `COURIER_POLL_SECRET` env | Leased poll claim (`FOR UPDATE SKIP LOCKED`), fingerprint-idempotent events |
| Sales channel sync | `POST /api/public/sync-worker` | `*/10 * * * *` (144/day) | `worker_secret_sync_queue` or `SYNC_WORKER_SECRET` | Leased job claim (`FOR UPDATE SKIP LOCKED`), attempt history |
| Stuck-state sweeper | `POST /api/public/ops-sweeper` | `7 * * * *` (24/day) | `worker_secret_ops_sweeper` or `OPS_SWEEPER_SECRET` | Calls only the existing idempotent recovery functions |

Each run is bounded by a batch cap and a ~25s wall-clock budget, never self-invokes,
and records a telemetry row in `worker_runs` (started/finished, counters, duration,
coarse error class — no payloads, no secrets).

The sweeper composes existing recovery only:
`reclaim_stale_sync_jobs()`, `sweep_courier_event_retries()`, `prune_worker_runs()`.
Unknown courier booking outcomes stay operator-resolved by design.

## Scheduler

pg_cron (in the database) + pg_net, calling the published site over HTTPS.
Job commands call `public.trigger_worker(worker, base_url, path)`, which reads that
worker's own vault secret and sends it as `x-worker-secret`. The function is
service-role/cron only; browsers and signed-in users cannot execute it, and the
secret is never returned.

Manage schedules:

```sql
-- list
select jobname, schedule, active from cron.job order by jobname;
-- disable / enable
update cron.job set active = false where jobname = 'worker-sync-queue';
-- remove
select cron.unschedule('worker-sync-queue');
-- re-create (production URL)
select cron.schedule('worker-sync-queue', '*/10 * * * *',
  $$select public.trigger_worker('sync_queue','https://<production-host>','/api/public/sync-worker');$$);
```

Duplicate/overlapping invocations are safe: all claiming uses leases with
`SKIP LOCKED`, and event/booking/settlement paths keep their idempotency keys.

## Secrets

One secret per worker, generated inside the database and stored in the vault.
No worker accepts another worker's secret and there is no shared fallback; a
missing or unprovisioned secret fails closed with `401`. Optional per-worker
environment variables (`COURIER_POLL_SECRET`, `SYNC_WORKER_SECRET`,
`OPS_SWEEPER_SECRET`) are accepted for self-hosted schedulers, matched in
constant time. Rotation: update the vault row `worker_secret_<worker>`; the
scheduler picks up the new value on its next run.

## Visibility

`/operations/jobs` shows the "Scheduled workers" panel from `worker_run_health`:
last success, staleness, 24h runs/failures, abandoned runs and the real backlog
(pending sync jobs, due tracking polls, retrying and dead-lettered courier events).
Staff/admin can trigger each worker manually through the same controlled paths
without ever holding a worker secret.

Note: the cron jobs target the **published** site, so newly deployed worker
endpoints only start returning results after the next publish.

## Operational incident detection (Step 20.9.2)

Detection runs inside the existing hourly ops sweeper (`/api/public/ops-sweeper`
and the operator-triggered sweep). It reads only authoritative operational data
and writes deduplicated incidents to `operational_alerts` — there is no second
event bus and no duplicate source of truth.

### Signals and thresholds

| Signal | Source | Warning | Critical |
| --- | --- | --- | --- |
| `worker_stale` | `worker_runs` | no success for 3× the schedule interval | 6× the interval, or never succeeded |
| `worker_failures` | `worker_runs` (24h) | ≥ 3 failed runs | ≥ 10 failed runs |
| `courier_events_dead_letter` | `courier_provider_events` | ≥ 1 | ≥ 10 |
| `courier_events_retry_backlog` | `courier_provider_events` | retry overdue by > 30 min | — |
| `booking_unknown` | `shipments.booking_outcome_unknown` | — | any (per shipment) |
| `booking_stuck` | `shipments.booking_attempt_started_at` | attempt open > 15 min | — |
| `tracking_poll_failures` | `courier_tracking_polls` | ≥ 3 consecutive failures | ≥ 10 shipments |
| `tracking_polls_overdue` | `courier_tracking_polls` | poll due > 2 h, lease expired | — |
| `settlement_discrepancies_open` | `courier_settlement_discrepancies` | any open | oldest > 7 days or ≥ 5,000 BDT |
| `statement_import_attention` | `courier_statement_imports` | invalid/unmatched/ambiguous rows, or unfinished > 24 h | — |

Scheduled intervals used for staleness: courier tracking 15 min, sync queue
10 min, ops sweeper 60 min.

### Lifecycle

* One row per stable `fingerprint`; repeat detections update `last_detected_at`
  and `detection_count` instead of creating duplicates.
* Severity escalation is recorded in `peak_severity`.
* Staff/admin/owner can acknowledge (`acknowledge_operational_alert`). An
  acknowledgement expires after 24 hours or immediately on escalation.
* When the condition is no longer detected, the incident is resolved
  automatically; a recurrence starts a fresh incident window.
* Nothing is auto-remediated — unknown booking outcomes still require the
  operator decision defined in Step 20.8.3.1.

### Access

* `operational_health_overview()` — anyone with `can_read_commerce`.
* `acknowledge_operational_alert()` — `can_manage_commerce`.
* `detect_operational_alerts()` / `upsert_operational_alert()` — service role
  only; the table rejects all direct writes.

Surfaced in the UI on `/operations` and `/operations/jobs`.
