# Post-20.8.3.10 Production Readiness Audit + Roadmap (no changes made)

## 1. Production-readiness score

**62 / 100** — application-layer integrity is strong; the *operational runtime*
(scheduling, monitoring, alerting, recovery drills) is largely absent.

| Area | Score |
|---|---|
| Data integrity / controlled workflows | 92 |
| Security (RLS, grants, SECURITY DEFINER, secrets) | 85 |
| Background worker design | 70 (design) / 10 (deployment) |
| Scheduling / automation runtime | 5 |
| Observability, alerting | 20 |
| DB performance / capacity | 65 |
| Backup / DR verification | 15 |
| Deployment configuration | 45 |

## 2. Critical blockers

1. **No scheduler exists.** `pg_cron` and `pg_net` are not installed (extensions
   present: pgcrypto, pg_stat_statements, supabase_vault, uuid-ossp, plpgsql).
   `/api/public/sync-worker` and `/api/public/courier-tracking-worker` are only
   reachable manually, so tracking polls, event retries, dead-letter sweeps and
   sync jobs never run in production.
2. **`COURIER_POLL_SECRET` is not configured.** The courier worker silently
   falls back to `SYNC_WORKER_SECRET`, so one leaked secret authorises both
   workers and rotation is coupled.
3. **No stuck-state sweeper is scheduled.** Expired poll leases, stuck
   `booking_in_progress` shipments, `retry_scheduled` courier events and
   abandoned statement imports have recovery *functions* but no automatic
   caller — they rely on a human opening a desk page.
4. **No alerting of any kind.** Dead-letter growth, booking failures, courier
   API failures and open COD discrepancies are visible only if someone looks.

## 3. High-priority risks

- Worker endpoints have no rate limiting and no structured request logging; a
  500 from `runCourierTrackingPoll` is returned as an opaque string with the
  cause discarded (`catch {}`), so failures are invisible post-mortem.
- No health endpoint for uptime monitoring (`/api/public/health`).
- Courier adapter external calls: timeout/abort behaviour is per-adapter and
  not centrally bounded; a hanging provider consumes the worker time budget.
- Backup/PITR is Supabase-managed and **never restore-tested**; there is no
  documented reconciliation procedure for courier state after a restore
  (couriers keep delivering while the DB is rolled back).
- No environment/config validation at boot — a missing `SUPABASE_URL` or worker
  secret fails at first request, not at deploy.

## 4. Medium-priority risks

- `courier_tracking_polls` has only 2 indexes; the `SKIP LOCKED` claim predicate
  (status + next_poll_at + lease_expires_at) is not fully covered.
- `shipment_events` (3 indexes) and `courier_settlement_items` (3) may need
  covering indexes as volume grows; all current judgements are on ~35 orders of
  seed data, so no plan is representative yet.
- 229 SECURITY DEFINER functions — all have explicit `search_path` (verified,
  0 offenders) — but there is no automated regression check that new ones do.
- Console RPCs are capped/paginated but were never load-tested; no slow-query
  budget or `pg_stat_statements` review loop exists.
- Statement imports left in `staged` have no expiry; discrepancies have no aging
  or SLA surface.
- No CORS/trusted-origin policy declared for the public API routes.

## 5. Existing strengths

Controlled-RPC architecture with `guard_*` write triggers; append-only
shipment/return/fulfillment event history; immutable order-item cost snapshots;
exactly-once fulfillment commitment; accepted-only restocking; booking
idempotency + unknown-outcome recovery; Vault-backed, service-role-only courier
credentials; store-scoped accounts; signed webhook secret matching with
fingerprint idempotency; event retry/dead-letter/replay; leased polling with
`SKIP LOCKED`; settlement candidate population, CSV import with per-row
classification, discrepancy detection; realized-vs-estimated profitability;
shipping and exception desks with server-side pagination; every SECURITY DEFINER
function pinned to a `search_path`.

## 6. Already production-ready

Data model and write path integrity, RBAC/RLS/grants, credential handling,
webhook ingestion security, idempotency and audit trails, financial
reconciliation logic, order/shipping/exception operator consoles.

## 7. Still requires work

Scheduling, worker deployment/authentication separation, structured logging,
health checks, alerting, stuck-state automation, index/plan validation under
volume, backup restore drills and post-restore courier reconciliation, and
production deployment configuration (origins, rate limits, env validation).

## 8. Recommended sequence

The generic 20.9.1–20.9.7 split is close, but the real architecture demands
scheduling and worker deployment come **first** (nothing else can be observed if
nothing runs), and DR verification comes last.

### 20.9.1 — Scheduling, Worker Deployment & Secret Separation
- **Goal:** make every background process actually run, on a schedule, with its
  own secret.
- **Why:** blockers 1 and 2; all reliability work depends on it.
- **Systems:** `pg_cron`, `pg_net`, `/api/public/sync-worker`,
  `/api/public/courier-tracking-worker`, a new sweeper endpoint.
- **DB:** enable `pg_cron`/`pg_net`; schedule jobs via `run_sql` (not migrations,
  since they carry URLs/secrets). No schema change to business tables.
- **Backend:** dedicated `COURIER_POLL_SECRET`, remove the silent fallback, add
  `/api/public/ops-sweeper` that calls the *existing* recovery functions
  (expired leases, retry-scheduled events, stale booking locks) — no new
  workflow.
- **Frontend:** none beyond surfacing last-run time on Operations → Jobs.
- **Security:** per-worker secrets, timing-safe compare (already present), no
  payload echo.
- **Concurrency:** rely on existing `SKIP LOCKED` leases; cron overlap must be
  a no-op, verified by running two invocations simultaneously.
- **Idempotency:** sweepers only advance rows already past their lease/backoff.
- **Verification:** trigger each cron job manually, confirm counters, confirm
  double invocation processes each row once, confirm 401 without secret.
- **Rollback:** `cron.unschedule` each job; endpoints stay inert without secrets.
- **Do not change:** booking, delivery-outcome, settlement or event semantics.

### 20.9.2 — Observability, Structured Logging & Health Endpoints
- **Goal:** every worker run, courier API call and webhook produces a structured,
  queryable record; add `/api/public/health` and worker heartbeats.
- **Why:** failures are currently silent; `catch {}` discards causes.
- **Systems:** worker routes, courier adapters, webhook route, `courier_api_logs`.
- **DB:** a worker-run heartbeat table (run id, worker, started/finished, counts,
  error class) with RLS + grants; reuse `courier_api_logs` for provider calls.
- **Backend:** structured logging helper, error classification, no secret or PII
  in logs.
- **Frontend:** Operations → Health page reading controlled projections.
- **Security:** logs must never contain credentials, tokens, phone numbers or
  cost/profit data.
- **Verification:** force a provider failure and a worker exception; confirm both
  appear with correct classification and no secrets.
- **Rollback:** drop the heartbeat table; logging helper is additive.

### 20.9.3 — Operational Alerting & Stuck-State SLAs
- **Goal:** thresholds and aging for dead-letter events, stuck bookings, expired
  leases, incomplete statement imports and open COD discrepancies, surfaced on
  the command center and escalated.
- **Systems:** existing recovery/attention functions, command center.
- **DB:** threshold config table + an `operational_alerts` projection function.
- **Backend:** sweeper computes alerts; optional notification channel later.
- **Verification:** synthesise each stuck state rollback-safely, confirm the
  alert appears and clears.

### 20.9.4 — Database Performance & Capacity Hardening
- **Goal:** validate console RPCs and worker claim queries at realistic volume
  and add only the indexes the plans justify.
- **Systems:** `orders_console_list`, `shipments_console_list`,
  `exceptions_console_list`, poll/job claim queries, analytics rollups.
- **DB:** `EXPLAIN (ANALYZE, BUFFERS)` on a temporary large synthetic dataset,
  then targeted indexes; `pg_stat_statements` review; stale-grant sweep.
- **Verification:** before/after timings recorded; synthetic data fully removed.
- **Do not change:** query semantics, pagination caps, or RLS predicates.

### 20.9.5 — Production Deployment & Configuration Baseline
- **Goal:** boot-time env validation, webhook/worker URL documentation, CORS and
  trusted origins, rate limiting on public routes, production error pages.
- **Systems:** `src/routes/api/public/*`, app config, error boundary.
- **Security:** deny-by-default origins; rate limits keyed per route+IP.
- **Verification:** missing-env failure surfaces clearly; rate limit returns 429.

### 20.9.6 — Backup, Restore & Disaster Recovery Verification
- **Goal:** document and *test* PITR assumptions, and define post-restore courier
  reconciliation (re-ingesting provider events after a rollback) using the
  existing replay tooling.
- **Verification:** restore drill on a scratch target; replay unmatched events;
  confirm append-only histories and idempotency prevent double effects.

### 20.9.7 — Full Production Readiness Verification
- End-to-end audit of 20.9.1–20.9.6 with the same rollback-safe discipline as
  20.8.3.9, plus a final security review and readiness scorecard.

## Constraints for every step above

No parallel order/fulfillment/shipment/return/payment/COD/settlement/inventory/
financial workflow; no frontend direct writes; keep `guard_shipment_write`,
`guard_return_write`, `guard_fulfillment_write`, `can_manage_commerce`,
append-only events, immutable cost snapshots, exactly-once commitment,
accepted-only restocking, `order_item_returnable_quantity`,
`refresh_order_payment`, `refresh_order_delivery_status`, and the existing
settlement/adjustment workflows exactly as they are.
