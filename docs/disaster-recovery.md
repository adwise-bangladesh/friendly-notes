# Disaster Recovery & Production Data Recovery

Step 20.9.4. This document describes what can be recovered, from where, how much
data can be lost, and how long recovery takes for the Commerce Operations
platform. It is based on the audited production architecture, not assumptions.

Never place secrets, database dumps or exported customer data in this
repository, in this document, in logs, or in migrations.

---

## 1. Audited production architecture

| Layer | Actual implementation |
| --- | --- |
| Application | TanStack Start (React 19 + Vite), built and hosted by the Lovable platform; preview and published deployments come from the same repository |
| Source of truth for code | The project Git repository (application code, migrations, docs) |
| Database | Managed PostgreSQL 17.6 (Lovable Cloud / Supabase-managed), instance size Tiny, region ap-southeast-1 |
| Extensions | `plpgsql`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `pg_cron` 1.6.4, `pg_net` 0.20.4, `supabase_vault` 0.3.1 |
| Schema | 86 public tables, 356 public functions, 128 RLS policies, 126 domain triggers; RLS enabled on **all** 86 public tables |
| Migrations | 150 SQL migrations committed under `supabase/migrations/`, applied in filename order |
| Scheduler | `pg_cron` → `public.trigger_worker()` → `pg_net` → published worker endpoints |
| Worker secrets | Vault rows `worker_secret_courier_tracking`, `worker_secret_sync_queue`, `worker_secret_ops_sweeper` (generated in-database, never exported) |
| Courier credentials | Vault-backed, referenced from `courier_account_credentials`; service-role-only accessors |
| Object storage | One private bucket `commerce-media` (10 MB limit), policies in migration `20260902100622_*` |
| WAL/backup posture | `archive_mode = on`, `wal_level = logical`, `archive_command` ships WAL through the platform's WAL-G pipeline → continuous WAL archiving plus managed base backups, operated by the platform |

Recovery readiness can be inspected at any time by a signed-in staff user:

```sql
select public.recovery_readiness_check();
```

It returns extensions, table/function/policy counts, RLS coverage, presence of
the four write guards, cron jobs, storage buckets, **presence (not value)** of
the worker secrets, and core commerce record counts.

---

## 2. Recovery asset inventory

**A. Rebuildable from source control**
- Application code, routes, server functions, worker endpoints
- All 150 database migrations (schema, functions, triggers, RLS policies, grants,
  guard functions, extensions `pg_cron`/`pg_net`)
- Documentation and operational runbooks

**B. Restorable from platform backup**
- The production database (all commerce, financial, courier, worker telemetry
  and alert data), via platform-managed base backup + archived WAL
- Objects in the `commerce-media` bucket (platform-managed storage backup)

**C. Requires separate secret recovery (never restorable from Git)**
- Worker secrets — regenerated in-database, not exported
- Courier provider API credentials — re-entered from the provider portals
- Courier webhook shared secrets — re-issued and re-registered with providers
- Platform service-role key and database password — held by the platform
- `LOVABLE_API_KEY`, `LOVABLE_CRON_SECRET` — platform-injected

**D. Requires manual reconfiguration**
- Published deployment (a republish is required after any environment rebuild)
- `pg_cron` schedules (see §6 — the exact statements are recorded below)
- The `commerce-media` storage bucket definition (policies are in migrations, the
  bucket record itself is created through the storage tooling)
- Courier provider webhook URLs registered in each provider portal
- Custom domain / DNS, if later attached

**E. Intentionally unrecoverable**
- Plaintext values of any Vault-stored secret. Vault rows survive a database
  restore (they are ordinary encrypted rows), but if the restore lands in a
  **different project** the encryption key differs and the values must be
  re-created, not recovered.
- Provider-side data never mirrored locally (e.g. courier label PDFs held only
  by the courier).

---

## 3. Database recovery

**Capability (verified by configuration inspection):** the instance runs with
`archive_mode = on` and a WAL-G `archive_command`, i.e. continuous WAL archiving
in addition to managed daily base backups. Backup storage, retention and the
restore operation are executed by the Lovable Cloud platform; there is no
self-service restore console in this project, so restores are requested through
Lovable support. Retention length and point-in-time window depend on the plan
attached to this project and must be confirmed with the platform before relying
on a specific window.

No custom `pg_dump` schedule was added. It would duplicate the managed backup,
place unencrypted customer PII (names, phone numbers, addresses, COD amounts)
somewhere less protected than the managed backup, and add an operational burden
with no recovery benefit. Logical export remains available on demand for
migration or forensic use, and any such export must be encrypted, access
controlled and deleted after use — never committed.

**Schema reconstruction:** an empty database can be rebuilt to the authoritative
schema by applying `supabase/migrations/*.sql` in filename order. The migration
set creates the extensions (`pg_cron`, `pg_net`), all tables, functions,
triggers, RLS policies, grants, the write guards and the Vault-backed credential
accessors. It does **not** create the storage bucket record or the cron
schedules — those are in §6 and §7.

**Recovery mechanism preference**

```
Point-in-time / WAL recovery  →  managed base backup  →  logical export  →  migrations + reseed
```

---

## 4. Application recovery

Required production configuration:

- Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- Server: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID`, `SUPABASE_SERVICE_ROLE_KEY`
- Optional per-worker overrides: `COURIER_POLL_SECRET`, `SYNC_WORKER_SECRET`, `OPS_SWEEPER_SECRET`
- Platform-injected: `LOVABLE_API_KEY`, `LOVABLE_CRON_SECRET`

Rebuild path: repository → deployment environment → environment configuration →
database connection → secrets → storage → workers → verification.

---

## 5. Secret recovery

| Category | Authoritative location | Recovery procedure | Affected on rotation |
| --- | --- | --- | --- |
| Worker secrets | Vault rows `worker_secret_*` | Re-run the Step 20.9.1 provisioning migration; it generates a new value in-database when the row is absent | Scheduled worker calls (`trigger_worker` reads the same row, so they stay consistent automatically) |
| Courier API credentials | Vault, referenced by `courier_account_credentials` | Re-enter from the provider portal through the credential UI/service-role function | Bookings, tracking polls for that account |
| Courier webhook secrets | Vault, per courier account | Re-issue, then update the URL/secret in the provider portal | Inbound tracking events for that provider |
| Service role key / DB password | Platform-managed | Not exportable on Lovable Cloud; re-injected by the platform | All server functions |

Secrets are never written to Git, migrations, logs, alerts, diagnostics or this
document. `worker_secret_matches` and the credential accessors return booleans or
service-role-only values, never a secret to a client.

A database restore restores the Vault **rows**. Whether those rows still decrypt
depends on the target project's encryption key: same project → secrets keep
working; new project → every secret in category C must be re-created.

---

## 6. Scheduler recovery

Cron schedules live in `cron.job`, which is **not** reproduced by the repository
migrations. After any restore into a new database, re-create them exactly:

```sql
select cron.schedule('worker-courier-tracking', '*/15 * * * *',
  $$select public.trigger_worker('courier_tracking', 'https://project--d5d0e503-6e5a-41dd-9598-82bd440268d4.lovable.app', '/api/public/courier-tracking-worker');$$);
select cron.schedule('worker-sync-queue', '*/10 * * * *',
  $$select public.trigger_worker('sync_queue', 'https://project--d5d0e503-6e5a-41dd-9598-82bd440268d4.lovable.app', '/api/public/sync-worker');$$);
select cron.schedule('worker-ops-sweeper', '7 * * * *',
  $$select public.trigger_worker('ops_sweeper', 'https://project--d5d0e503-6e5a-41dd-9598-82bd440268d4.lovable.app', '/api/public/ops-sweeper');$$);
```

Cadence: 96 + 144 + 24 = 264 runs/day. Verify with
`select jobname, schedule, active from cron.job;` or `recovery_readiness_check()`.
Worker behaviour, telemetry (`worker_runs`), leases, batch bounds and
authentication are all restored by code + migrations; only the schedules and
secrets need attention.

---

## 7. Storage recovery

- One private bucket: `commerce-media` (product media, uploaded documents).
  Access policies are in migration `20260902100622_*`; the bucket record itself
  must be re-created (private, 10 MB limit) before the policies are meaningful.
- Bucket versioning is not enabled; recovery depends on the platform's storage
  backup.
- A database restore restores **references** (paths) only. If objects are lost,
  references become dangling: the UI shows broken media but no commerce workflow
  is blocked — media is never used in financial, inventory or shipment logic.
- After a storage incident, list referenced paths from the media tables and
  compare against `storage.objects` to identify permanently lost objects, then
  re-upload from source assets.

---

## 8. RPO and RTO

| Data class | RPO (realistic) | Rationale |
| --- | --- | --- |
| Orders, order items, payments | Up to the platform WAL/PITR window; worst case last managed base backup (≤ 24 h) | Continuous WAL archiving is configured; the guaranteed window is plan-dependent |
| Inventory movements, financial adjustments, settlements | Same as above | Same physical backup chain |
| Courier provider events | ≤ 24 h, and largely self-healing | Providers re-send/tracking polls re-fetch state after recovery |
| Worker telemetry, diagnostics, alerts | Loss acceptable | Operational, not business, data |
| Storage objects | Platform storage backup interval | No bucket versioning |

| Scenario | RTO target |
| --- | --- |
| Application deployment failure (rollback/republish) | 15–30 min |
| Broken migration (forward fix) | 30–60 min |
| Accidental data modification (isolated restore + reconcile) | 4–8 h |
| Complete database loss (platform restore + verification) | 4–12 h, dependent on platform restore turnaround |
| Complete environment rebuild | 1 business day |
| Storage loss | Hours to days; permanently lost objects are re-uploaded manually |

These reflect a small operations team with platform-operated restores. Zero data
loss is **not** guaranteed.

---

## 9. Runbook

### Scenario 1 — Application deployment failure
1. Contain: stop further publishes; the database is unaffected.
2. Identify the last known-good release in the project's version history.
3. Restore that version and republish.
4. Verify: app responds, sign-in works, `/orders`, `/shipping`, `/operations` load.
5. Verify workers: `/operations/jobs` shows recent successful runs, or trigger a
   manual run and confirm a new `worker_runs` row.
6. Verify commerce: order console, quick view, shipment desk, settlement page.

### Scenario 2 — Broken database migration
1. Freeze deployments and further migrations.
2. Determine impact: which objects changed, whether data was destroyed.
3. Do not hand-edit production tables to "patch" the state.
4. Prefer a forward-fix migration when no data was lost.
5. Restore only when data was destroyed or the schema cannot be reconciled — see
   Scenario 3 for the isolated-restore approach.
6. Verify guards, RLS, grants, and the affected workflow end to end.

### Scenario 3 — Accidental data modification or deletion
1. Contain: stop the workers (`select cron.unschedule(...)` for the affected job)
   and stop the operator action causing writes.
2. Identify the incident window from `created_at`/`updated_at`, append-only
   history tables, `worker_runs` and `operational_diagnostics` correlation IDs.
3. Request a point-in-time restore **into an isolated database**, not over
   production.
4. Extract only the affected rows from the isolate and reconcile them into
   production through the controlled RPCs where possible.
5. Never overwrite production wholesale: valid data created after the incident
   must survive.
6. Re-enable the schedules and confirm health.

### Scenario 4 — Complete database failure
1. Request a platform restore / provision a replacement database.
2. Verify schema: table, function, policy counts via `recovery_readiness_check()`.
3. Verify extensions: `pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, `supabase_vault`.
4. Verify migrations applied (`supabase/migrations` count vs applied history).
5. Verify RLS enabled on all public tables and grants intact.
6. Verify Vault: worker secrets present; re-provision if the project changed.
7. Re-create cron schedules (§6).
8. Point the application at the database, republish, verify connectivity.
9. Run the §10 checklist.

### Scenario 5 — Complete application environment loss
Dependency order — do not skip or reorder:

```
Repository → Deployment environment → Environment configuration → Database
  → Secrets → Storage → Workers/Schedules → Verification
```

### Scenario 6 — Storage / media failure
1. Identify the bucket and time window.
2. Restore from the platform storage backup (no bucket versioning available).
3. Re-create the bucket and re-apply policies if the bucket itself was lost.
4. Compare referenced media paths against `storage.objects`; list dangling ones.
5. Re-upload from source assets; leave database references intact — missing media
   degrades display only and never blocks commerce workflows.

---

## 10. Post-recovery verification checklist

**Application**
- [ ] Production application responds
- [ ] Authentication works
- [ ] Critical pages load (`/orders`, `/shipping`, `/operations`, `/products`)

**Database**
- [ ] Connectivity works
- [ ] `recovery_readiness_check()` returns expected table/function/policy counts
- [ ] `rls_disabled_tables` is 0
- [ ] Guards present: `guard_shipment_write`, `guard_return_write`,
      `guard_fulfillment_write`, `guard_operational_diagnostics_write`

**Commerce integrity (read-only, creates no QA data)**
- [ ] Order console loads and paginates
- [ ] Order quick view opens
- [ ] Verification queue reachable
- [ ] Fulfillment data intact
- [ ] Shipment desk loads
- [ ] Settlement page loads
- [ ] Inventory projections readable
- [ ] Profitability projections readable

**Courier**
- [ ] Integrations page loads
- [ ] Credential status shows configured/absent only, never a value
- [ ] Webhook with a wrong secret returns 401
- [ ] Tracking worker endpoint reachable (401 without secret)
- [ ] No live provider bookings performed during verification

**Workers**
- [ ] Three schedules exist and are active
- [ ] Worker secrets present in Vault
- [ ] Worker endpoints reject unauthenticated calls
- [ ] One safe manual run succeeds
- [ ] `worker_runs` records the run
- [ ] Operational health panel green

**Operations**
- [ ] No unexplained critical alerts
- [ ] Alert lifecycle functions
- [ ] Diagnostics correlation trail accessible

---

## 11. Backup security

- Backups are platform-managed; only the platform operator can create or restore
  them. No project user can download a production backup from this application.
- Backups contain customer PII (names, Bangladeshi phone numbers, addresses) and
  financial data; they must never be copied to unmanaged storage.
- Storage at rest is encrypted by the platform; WAL is shipped through the
  managed WAL-G pipeline.
- No backup file, dump or export is stored in this repository, and no endpoint in
  this application exposes a downloadable backup.
- Vault secrets remain encrypted inside backups and are not readable through the
  Data API.

---

## 12. Known limitations

- Exact backup retention length and the guaranteed point-in-time window are
  platform/plan controlled and are not queryable from this project; confirm with
  Lovable before assuming a specific window.
- No full restore drill has been performed: restoring a backup requires platform
  operator action. **Recovery configuration verified; full restore drill not
  performed.**
- Cron schedules and the storage bucket record are not reproduced by migrations;
  they are documented here and must be re-created manually after a rebuild.
- Storage has no object versioning.
- Vault secret values cannot be exported; a restore into a different project
  requires re-creating every external credential.
