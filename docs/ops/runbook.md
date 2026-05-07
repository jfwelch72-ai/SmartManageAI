# On-Call Runbook

This runbook is the first thing on-call should open during an incident. It
covers the six scenarios we have seen (or expect) most often. Each section
is structured the same way: **Symptoms → Triage → Mitigation →
Post-incident**.

For deep observability mechanics (correlation IDs, Sentry, log search) see
[`docs/runbooks/observability.md`](../runbooks/observability.md). For
backups & restore drills see [`backups.md`](./backups.md). For the
status-page workflow see [`status-page.md`](./status-page.md). For the
metrics catalog see [`metrics.md`](./metrics.md).

---

## 0. First five minutes (every incident)

1. Open the **status page** ([`status-page.md`](./status-page.md)) and
   post an *Investigating* update with whatever you know. Better to
   over-communicate than to leave customers guessing.
2. Hit `/healthz` and `/readyz` on the production host. `/readyz` failing
   tells you the DB is unreachable; `/healthz` failing means the process
   is down.
3. Open Sentry → *Issues* and sort by *Last seen*. New regressions usually
   spike here within 60 seconds.
4. Grab the **correlation ID** from a customer report or a Sentry event.
   Every triage path below assumes you have one.
5. Page a second engineer if the impact is wider than a single tenant or
   the mitigation requires a deploy / DB change.

---

## 1. Site-wide outage triage

**Symptoms**

- `/healthz` is non-200, OR
- `/readyz` is 503 with `database: fail`, OR
- Replit deployment is "Crashing" / restarting in a loop.

**Triage**

1. Replit Deployments → Logs. Look for the last successful boot line
   (`serving on port 5000`) and read backwards from the crash.
2. If the crash repeats with the same stack, treat as "bad deploy" →
   jump to §4.
3. If `/readyz` shows DB fail but `/healthz` is OK, treat as "DB
   unreachable" → check Replit DB status page and section §5.
4. If neither, sample a handful of `error_logs` rows from the last 5
   minutes:
   ```sql
   SELECT created_at, status_code, path, message
   FROM error_logs
   WHERE created_at > now() - interval '5 minutes'
   ORDER BY created_at DESC
   LIMIT 50;
   ```

**Mitigation**

- Bad deploy → roll back (§4).
- Bad data / migration → see "Restoring from backup" (§5).
- Upstream provider (OpenAI, SendGrid, GCS) → flip the relevant feature
  flag in Super Admin to "degraded" mode and post a status update.

**Post-incident**

- Open a follow-up task with the root cause, the mitigation, and a
  preventive change (test, alert, guardrail).

---

## 2. Restoring from backup

See [`backups.md`](./backups.md) for the full procedure. The
two-paragraph version:

1. Identify the **last known good** point-in-time (Sentry / status page
   timeline + the customer report).
2. In Replit Deployments → Database → **Restore from backup**, pick the
   PITR target. **Restore into a scratch DB first**, never directly over
   prod, and verify a handful of rows before swapping `DATABASE_URL`.
3. Once the scratch DB looks correct, switch `DATABASE_URL` over (or
   `pg_dump | pg_restore` the affected tables back into prod) and
   restart `Start application`.
4. Post a final status update with the recovery time and the data window
   that was lost (if any).

---

## 3. Rotating a leaked secret

**Symptoms**: GitHub secret-scanning alert, customer report of an exposed
key, or Sentry event containing a credential string.

**Triage**

1. Identify which env var the leak corresponds to (`SESSION_SECRET`,
   `ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `OPS_METRICS_TOKEN`, etc).
2. Search `error_logs` and `audit_log` for any usage in the leak window:
   ```sql
   SELECT created_at, user_id, action, entity_type, entity_id
   FROM audit_log
   WHERE created_at > '<leak-time>'
   ORDER BY created_at DESC LIMIT 200;
   ```

**Mitigation**

1. Generate a new value at the provider (Anthropic, SendGrid, etc).
2. Update the value in Replit Secrets — the platform restarts the
   `Start application` workflow automatically.
3. **For `SESSION_SECRET`**: rotating invalidates every JWT. Communicate
   that all users will be signed out, then update the secret and restart.
4. Revoke the old key at the provider once the new one is live.
5. Force-rotate any DB rows that may have stored the old value (e.g. a
   tenant integration `access_token` column).

**Post-incident**

- File a follow-up to add the leak source to `git-secrets` /
  pre-commit scanning if not already covered.

---

## 4. Rolling back a bad deploy

**Symptoms**: spike in 5xx in Sentry / `error_logs` immediately after a
deploy; `/healthz` flapping; new error class not seen before the deploy.

**Triage**

1. Identify the deploying commit from Replit Deployments → History.
2. Diff against the last known good commit (the one whose Sentry release
   tag was clean for ≥ 30 minutes before the new deploy).

**Mitigation**

1. Replit Deployments → History → **Redeploy** the previous commit. This
   is the fastest revert and skips a rebuild for the same artifact.
2. Confirm `serving on port 5000` in logs and `/healthz` 200.
3. Post a status update: *Identified → Monitoring* once 5xx returns to
   baseline.

**Post-incident**

- Cherry-pick a fix or revert commit on `main` so the next deploy doesn't
  reintroduce the regression.
- If the bad change touched a migration, re-run the restore drill in
  §2 to confirm the rollback path still works on real data.

---

## 5. Database unreachable / pool starvation

**Symptoms**: `/readyz` 503; `pool_exhausted` events in
`getRecentPoolExhaustedEvents`; `app_db_pool_waiting > 0` in
`/metrics`; alert from `pool_health.exhausted` or
`pool_health.waitingSaturated` rule.

**Triage**

1. Hit `/api/admin/metrics/pool` (Super Admin) for the live pool
   counters and the rolling 50-event `pool_exhausted` buffer.
2. If `waiting` is sustained > 0, identify the slow query — most often
   a long-running takeoff or report job. Check
   `/api/admin/metrics/jobs/<job>` for runtime spikes.

**Mitigation**

- Short term: kill the offending session (`pg_terminate_backend`) or
  pause the runaway job via the Super Admin → Jobs UI.
- Medium term: bump `Pool { max }` in `server/db.ts` if the workload
  legitimately needs more, and document why.

**Post-incident**

- File a follow-up if a single endpoint is responsible — usually a
  missing index, a missing pagination cap, or an N+1.

---

## 6. Draining a stuck job queue

**Symptoms**: `app_job_counter_total{job="…",counter="failed"}`
climbing; same job appearing repeatedly in Sentry; user reports of
"my export never finished".

**Triage**

1. Super Admin → Jobs Health → identify the job and its last successful
   sample timestamp.
2. Inspect the job's recent samples via
   `/api/admin/metrics/jobs/<job>?range=24h` — `latest` and `totals`
   tell you whether it's *stalled* (no samples) or *failing* (samples
   with `failed` counter).

**Mitigation**

- **Stalled**: restart the `Start application` workflow. The
  `jobRunner` rehydrates from `job_metric_samples` and resumes pending
  work on boot.
- **Poison pill** (one bad row crashing every tick): identify it via
  the Sentry stack trace, then either fix the row in place or move
  it aside (`UPDATE … SET status = 'quarantined'`) so the queue can
  drain.
- **Provider outage** (Anthropic, OpenAI, SendGrid): flip the relevant
  AI feature flag to fall back to the alternate provider per the AI
  routing notes in `replit.md`.

**Post-incident**

- Add a regression test for the poison-pill input shape if applicable.
- Confirm the metric returns to its baseline rate; close the status
  page incident.

---

## 7. Scaling and reading logs from the job worker pod

Background jobs (AI takeoff, AI document analysis, PDF tile prerender,
certified-payroll exports, accounting sync, etc.) run on a **dedicated
worker process**, not on the autoscale web pod. This isolates AI/PDF
CPU spikes from request latency.

**Topology** (Task #2519):

| Process | Where | Run command | Job handlers? |
| ------- | ----- | ----------- | ------------- |
| Web (HTTP) | Replit autoscale deployment (`.replit [deployment]`) | `npm run start` | No — `JOB_WORKER_INPROCESS=0` is pinned via `[userenv.production]` so the web pod only enqueues. |
| Job worker | A second Replit deployment (Reserved VM, "background worker") | `npx tsx server/worker.ts` | Yes — `startJobQueue({ withWorkers: true })`. |
| Dev | The `Job worker` workflow in this repl | `JOB_WORKER_INPROCESS=0 npx tsx server/worker.ts` | Yes (and the dev web workflow stays enqueue-only too). |

### Initial setup (one-time, performed from the main repl)

1. Open Replit Deployments → **Create deployment** → choose **Reserved
   VM** (background worker; no public port).
2. Build command: `npm run build`. Run command: `npx tsx server/worker.ts`.
3. Use the **same** secrets group as the web deployment so
   `DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `SENDGRID_API_KEY`, `PRIVATE_OBJECT_DIR`, and
   `PGBOSS_SCHEMA` (if customised) all flow through. Do **not** set
   `JOB_WORKER_INPROCESS` on the worker — `server/worker.ts` always
   starts handlers regardless.
4. Verify boot: the deployment logs should print
   `Job worker is running. Awaiting work…`.

### Scaling the worker pod

- **Vertical**: bump the Reserved VM size (more vCPU / RAM) in
  Replit Deployments → *Resources*. Restart the deployment to pick
  up the change. Use this first when AI / PDF jobs are CPU-bound on
  a single tenant.
- **Horizontal**: increase the deployment's instance count. pg-boss
  uses Postgres `SKIP LOCKED` to lease jobs, so multiple worker
  pods coordinate safely without extra config. Per-tenant fairness
  (`teamSize=8, teamConcurrency=8` plus the per-tenant semaphore
  in the handler wrapper, see `docs/architecture/job-queue.md`)
  still applies across pods.
- After scaling, watch `app_job_queue_active_pods` and
  `app_job_queue_depth{queue="…"}` in `/metrics` and the
  Super Admin → *Jobs Health* dashboard. Depth that drains within
  the SLO (≤ 5 min for AI takeoff, ≤ 30 s for tile prerender)
  means you've sized correctly.

### Reading worker logs

- **Production**: Replit Deployments → select the **Job worker**
  deployment → *Logs*. Same structured JSON line format as the
  web pod (`server/utils/logger.ts`), so you can grep by
  `correlationId`, `jobName`, `organizationId`, etc. From this
  agent / shell, use `fetchDeploymentLogs({ message: "queue:…" })`
  scoped to the worker deployment ID.
- **Dev**: the `Job worker` workflow in this repl. Use
  `refresh_all_logs` (writes to `/tmp/logs/Job worker_*.log`) or
  scroll the workflow console.
- **Sentry**: worker errors land in the same Sentry project as the
  web pod (the worker calls `initSentry()` at boot). Filter by
  `release` + `tag:component=job-worker` (set in
  `server/worker.ts`).
- **Per-job timing**: `/api/admin/metrics/jobs/<job>?range=24h`
  surfaces samples regardless of which pod recorded them.

### Failure modes

- **Worker pod down**: web continues to accept requests, but jobs
  pile up in pg-boss. Symptom is climbing `app_job_queue_depth`
  with zero `…_succeeded` samples. Restart the worker deployment;
  it rehydrates from `pgboss.job` on boot. If the crash repeats,
  treat as §4 ("rolling back a bad deploy") for the worker.
- **Web pod accidentally running handlers**: indicates
  `JOB_WORKER_INPROCESS=1` leaked onto the web deployment.
  Inspect with `viewEnvVars({ environment: "production" })` and
  delete / set back to `"0"`. Restart the web deployment.

---

## Wired-up evidence

The pieces below are already implemented; this section is the index so a
new on-call doesn't have to grep for them.

| Capability | Where | Notes |
| --- | --- | --- |
| Structured JSON logger | `server/utils/logger.ts` | Production emits one JSON object per line; `logDebug/Info/Warn/Error`. `console.*` is forbidden under `server/` (regression guard: `scripts/check-no-console.mjs`). |
| Request-ID propagation | `server/middleware/correlationId.ts` + `server/utils/correlatedFetch.ts` | Inbound `x-request-id` is honored or a UUID v4 is generated; stashed in AsyncLocalStorage and auto-attached to every log line, error row, and Sentry event. Outbound `fetch(...)` re-emits the same header. Frontend → backend: pass `x-request-id` from `apiRequest`. |
| Backend error aggregation | `server/sentry.ts` | `initSentry()` runs at boot; no-op without `SENTRY_DSN`. `beforeSend` scrubs PII. Central error middleware in `server/index.ts` forwards 5xx + programmer errors via `captureRequestException`. |
| Frontend error aggregation | `client/src/sentry.ts` | `initBrowserSentry()` runs from the app entrypoint; no-op without `VITE_SENTRY_DSN`. Same PII scrubber as the server. |
| Source maps for Sentry | `vite.config.ts` (`build.sourcemap: "hidden"`) | Maps emitted into `dist/public` next to bundles, but no `//# sourceMappingURL=` comment so end users don't see source in devtools. Upload to Sentry as part of the build pipeline. |
| Health probes | `server/opsRoutes.ts` (`/healthz`, `/readyz`) | `/healthz` always 200 if process is alive; `/readyz` runs a `SELECT 1` against the pool and returns 503 on failure. Wire both into the Replit deployment health-check settings. |
| Detailed status | `server/opsRoutes.ts` (`/api/ops/status`, `/api/ops/health-check`) | Token-gated via `OPS_STATUS_TOKEN` in production. Returns memory, monitoring init state, and CSP/error-log presence. |
| Metrics | `server/opsRoutes.ts` (`/metrics`) | Prometheus text format; token-gated via `OPS_METRICS_TOKEN`. Catalog at [`metrics.md`](./metrics.md). |
| Status page checks | `server/statusProbeScheduler.ts` | Drives the in-app `Status Components` table that powers the public BetterStack page (see [`status-page.md`](./status-page.md)). |
| Backups & restore | `docs/ops/backups.md` + `scripts/restore-drill.sh` | Quarterly drill, last successful run logged in the Drill log. |

## Quick links

- Health: `GET /healthz`, `GET /readyz`
- Detailed status (token-gated): `GET /api/ops/status`,
  `GET /api/ops/health-check`
- Prometheus metrics (token-gated): `GET /metrics`
- In-app dashboards: Super Admin → *Jobs Health*, *Pool Health*,
  *Error Logs*, *Status Components*
- Deeper observability: [`docs/runbooks/observability.md`](../runbooks/observability.md)
