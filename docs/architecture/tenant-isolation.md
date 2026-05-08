# Tenant Isolation with Postgres RLS (Task #2478)

## Status

**Ratchet closed (Task #2673).** Row-level security is enabled (with
`FORCE`) on every multi-tenant table in production and the policies are
fail-closed: a session sees a row IFF `app.is_superadmin = 'true'` OR
`organization_id = app.current_org_id`. Production now boots with
`STRICT_TENANT_RLS=true` — `server/index.ts` fails fast on boot in
production when the env var is missing or `false`. Dev/test may opt out
for local debugging and gets a loud warn in the boot log.

Authenticated HTTP traffic is **always** wrapped in a non-elevated
`withOrgContext` — even SUPER_ADMIN sessions land in a non-elevated
context scoped to their own org (or a fail-closed null-org context if
they don't have one). Cross-tenant reads/writes for platform admin work
must go through `runAsSuperadmin(reason, …)`, which writes a row to
`superadmin_access_log` *before* elevating and refuses to elevate if the
audit write fails.

Unauthenticated traffic (login, public webhooks, the few open portal
endpoints) and any code path that escapes a context wrapper now hits a
fresh pool connection whose connect-default is `app.is_superadmin =
'false'` (under `STRICT_TENANT_RLS=true`). Such queries return zero
rows instead of silently spanning every tenant — the desired
fail-closed behaviour.

| `STRICT_TENANT_RLS` | `app.is_superadmin` connect default | Effect on uncontextualized queries |
| --- | --- | --- |
| `true` (production default) | `false` | Fail closed — return zero rows. |
| unset / `false` (dev/test opt-out) | `true` | Bypass RLS — only acceptable for local debugging. |

## Why

Multi-tenant safety used to depend entirely on application-level filters:
the `requireActiveOrganization` middleware plus per-call `getOrgFilter()`
clauses on every Drizzle query. One missed `WHERE organization_id = ?` in a
new query would leak another tenant's data. RLS at the database layer makes
that class of bug impossible — even if a route forgets the filter, Postgres
still drops the cross-tenant rows from the result set.

## How it works

```
┌────────────────────────────┐
│  authMiddleware            │  → req.user populated
├────────────────────────────┤
│  requireActiveOrganization │  → org marked active
├────────────────────────────┤
│  orgContextMiddleware      │  → withOrgContext({ organizationId, isSuperadmin })
│                            │     - acquires a dedicated pg client from the pool
│                            │     - SELECT set_config('app.current_org_id', ...)
│                            │     - SELECT set_config('app.is_superadmin', ...)
│                            │     - binds an ALS-scoped drizzle({ client })
├────────────────────────────┤
│  route handler             │  → import { db } from "./db" (Proxy)
│                            │     The proxy reads ALS, prefers the ctx-bound
│                            │     drizzle, falls back to the pool drizzle.
└────────────────────────────┘
            ↓
        Postgres applies the `tenant_isolation` RLS policy on every
        SELECT/INSERT/UPDATE/DELETE against any tenant table.
```

### Policy template

Each multi-tenant table gets a single fail-closed policy plus FORCE RLS:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE  ROW LEVEL SECURITY;  -- owner role is also subject

CREATE POLICY tenant_isolation ON <table>
  AS PERMISSIVE
  FOR ALL
  USING (
    current_setting('app.is_superadmin', true) = 'true'             -- explicit escape hatch
    OR organization_id = current_setting('app.current_org_id', true) -- normal tenant scope
  )
  WITH CHECK ( /* same predicate */ );
```

Defined in `migrations/0096_enable_tenant_rls.sql` and idempotently
re-applied at boot by `server/utils/ensureRlsPolicies.ts`.

### Connection defaults & strict mode

`server/db.ts` registers a `pool.on("connect", …)` handler that sets
`app.is_superadmin` on every fresh pool connection. `withOrgContext`
overrides this default for the duration of the request/job (downgrades
to `is_superadmin = 'false'` + the bound org id), then restores the
connect-default on `client.release()`.

The production fail-fast lives in `server/index.ts` immediately after
the `isProduction` derivation and runs before any HTTP handler is
registered. To roll back the ratchet (e.g. an emergency rollback while
investigating a regression):

1. Set `STRICT_TENANT_RLS=false` (or unset it) in the production
   environment.
2. Redeploy. The server boots with the legacy connect-default
   `app.is_superadmin = 'true'` and unwrapped queries again span every
   tenant.
3. Re-enable strict mode by setting `STRICT_TENANT_RLS=true` and
   redeploying once the regression is fixed.

Rollback is intentionally a redeploy rather than a hot toggle — the
connect-default is read once per pg client at the `pool.on("connect")`
handler in `server/db.ts`, so a hot env flip would only affect newly
checked-out connections and leave existing pooled clients on the old
default.

### Files

| File | Role |
| --- | --- |
| `server/db.ts` | Pool + base drizzle + the Proxy that swaps in the ALS-bound instance. |
| `server/dbContext.ts` | `withOrgContext`, `runAsSuperadmin`, `withJobOrgContext`, ALS storage. |
| `server/middleware/orgContext.ts` | Express middleware that wraps every authenticated request in `withOrgContext`. |
| `server/utils/ensureRlsPolicies.ts` | Boot-time idempotent applier (mirrors the SQL migration). |
| `migrations/0096_enable_tenant_rls.sql` | The canonical migration, runnable via psql. |
| `scripts/inventory-tenant-tables.mjs` | Generator for the table inventory. |
| `scripts/check-db-imports.mjs` | Lint guard — fails CI if a new file imports drizzle bypassing the proxy. |
| `server/__tests__/tenant-rls.test.ts` | Cross-tenant SELECT/UPDATE/DELETE assertions. |

## Writing new tables

1. Add the table in `shared/schema/features/<domain>.ts` with an
   `organization_id varchar NOT NULL REFERENCES organizations(id)` column.
2. Re-run `node scripts/inventory-tenant-tables.mjs > /tmp/inv.txt` and
   confirm the new table appears.
3. Add it to the `tables` array in **both**
   `migrations/0096_enable_tenant_rls.sql` **and**
   `server/utils/ensureRlsPolicies.ts` (`TENANT_TABLES` const).
4. Restart the app — the boot-time applier will enable RLS and install
   the policy on the new table.

## Using the super-admin escape hatch

Most platform tooling should still scope to a tenant via:

```ts
await withOrgContext({ organizationId: someOrgId, source: "platform-tool" }, async () => {
  // queries here see only `someOrgId`
});
```

For genuinely cross-tenant tooling (e.g. nightly aggregate stats, support
tools that need to read multiple orgs), use the explicit escape hatch:

```ts
await runAsSuperadmin(
  "nightly-platform-rollup",
  async () => { /* queries here see ALL orgs */ },
  { actorId: req.user?.id ?? null }, // optional but recommended for HTTP
);
```

Each call writes a row to the dedicated `superadmin_access_log` table
(`reason`, `source`, `actor_id`, `created_at`) on a fresh privileged
connection BEFORE elevating. If the audit write fails, the helper
throws and `fn` is never invoked — privileged DB work without an audit
trail is exactly what this task exists to prevent. Schema is owned by
`migrations/0096_enable_tenant_rls.sql` + `ensureRlsPolicies.ts`.

## Background jobs

There are three context wrappers, picked by what the job touches:

| Wrapper | Use when… | Audit row? |
| --- | --- | --- |
| `withJobOrgContext("<job-name>", orgId, fn)` | The job processes ONE tenant at a time. | No |
| `withSystemJobContext("<job-name>", fn)` | The job is intrinsically cross-tenant (outbox drain, retention sweep, integration sync, periodic-report fan-out, …). | No |
| `runAsSuperadmin("<reason>", fn, { actorId? })` | A platform-admin code path needs cross-tenant access AND must leave an audit trail. | Yes — one row per call. |

Per-org loops look like:

```ts
import { withJobOrgContext } from "../dbContext";
// ...
for (const org of orgs) {
  await withJobOrgContext("processSwppOverdue", org.id, async () => {
    // existing per-org body
  });
}
```

Jobs that are intrinsically cross-tenant (e.g. `pruneSuppressionResets`,
`pruneJobMetricsDb`) wrap their main exported function in
`withSystemJobContext("<job-name>", …)`, which delegates to
`runAsSuperadmin("system-job:<job-name>", …)` so every cross-tenant
elevation is recorded in `superadmin_access_log` BEFORE the elevation
happens and refuses if the audit insert fails.

All `for (const org of orgs)` loops in `server/jobs/jobRunner.ts` are
wrapped with `withJobOrgContext(...)`, and the lint guards at
`scripts/check-db-imports.mjs` and `scripts/check-job-context.mjs`
(both wired into `scripts/ci.sh`) fail CI if a `db.*` reference inside
a per-org loop body is not lexically enclosed in a
`withJobOrgContext(...)` call, or if a background-job file touches the
DB without a tenant context wrapper. Current wrappers:

- `processCrmContactBirthdayDailyDigest` →
  `withJobOrgContext("crm.contactBirthdayDailyDigest", org.id, …)`
- `processCrmContactBirthdayWeeklyDigest` →
  `withJobOrgContext("crm.contactBirthdayWeeklyDigest", org.id, …)`
- `processCertifiedPayrollWeeklyDigest` →
  `withJobOrgContext("payroll.certifiedPayrollDigest", org.id, …)`
- `processComplianceExpirations` →
  `withJobOrgContext("compliance.expirationCheck", org.organizationId, …)`
  (Task #2674; per-org dedupe + insert moved inside the wrapper so RLS
  pins them to the current tenant.)
- `processEquipmentPmGeneration` →
  `withJobOrgContext("equipment.pmGeneration", orgId, …)`

When converting a job, outer-loop `continue` statements inside the
wrapped block must become `return` because the body now runs as an
async callback rather than the loop body itself. Inner loops keep
their own `continue`s.

### Cron sweeps wrap automatically via `withSchedulerLock`

`server/utils/schedulerLock.ts::withSchedulerLock(name, fn)` now wraps
the locked tick in `withSystemJobContext(name, …)`. That means every
in-process scheduler — `server/jobs/jobRunner.ts`,
`server/aiNotesScheduler.ts`, `server/crmTaskReminderScheduler.ts`,
`server/crmBackfillAlertDigestScheduler.ts`,
`server/statusProbeScheduler.ts`, `server/supportWeeklyReport.ts`,
`server/ai/scheduler.ts` — gets a working system context for free
under `STRICT_TENANT_RLS=true`. Per-org work fanned out from inside a
tick still drops into a child `withJobOrgContext(...)` so the inner
queries are pinned to a single tenant.

The pg-boss queue (`server/jobQueue/index.ts`) wraps each handler
invocation in `withOrgContext({ organizationId, source: "job:<name>",
isSuperadmin: false })` whenever the enqueued job carries an
`organizationId`. Handlers that need to escape that scope (rare —
mostly `bulkExport` summary rows that span tenants) must wrap the
escape in `runAsSuperadmin`.

### Per-org loops in `server/jobs/jobRunner.ts`

All five `for (const org of orgs)` loops are wrapped:

- `processEquipmentPmGeneration` (loop ~1519) →
  `withJobOrgContext("equipment.pmGeneration", orgId, …)`
- `processComplianceExpirations` (loop ~2801, Task #2673) →
  `withJobOrgContext("compliance.expiration", org.organizationId, …)`
  — proactively wrapped even though the inner body currently only
  appends to an in-memory array; future maintainers WILL add a per-org
  DB call here.
- `processCrmContactBirthdayDigest` (loop ~4117) →
  `withJobOrgContext("crm.contactBirthdayWeeklyDigest", org.id, …)`
- `processCrmContactBirthdayDailyDigest` (loop ~4485) →
  `withJobOrgContext("crm.contactBirthdayDailyDigest", org.id, …)`
- `processCertifiedPayrollWeeklyDigest` (loop ~4725) →
  `withJobOrgContext("payroll.certifiedPayrollDigest", org.id, …)`

## Lint guards (CI)

Both run in `scripts/ci.sh` (cheap, <1s each).

- `scripts/check-db-imports.mjs` (Task #2478) — fails when a new
  `server/` file imports `drizzle-orm/node-postgres`, builds its own
  `pg` `Pool`, or calls `drizzle({ client: ... })` outside the
  allowlisted `server/db.ts` / `server/dbContext.ts`. Bypassing the
  proxy bypasses the ALS-bound RLS client.
- `scripts/check-job-context.mjs` (Task #2673) — fails when a file
  under `server/jobs/`, `server/jobQueue/handlers/`, or
  `server/jobQueue/exports/` imports `db` (or calls `db.<verb>`)
  without referencing a context wrapper (`withJobOrgContext`,
  `withOrgContext`, `withSystemJobContext`, or `runAsSuperadmin`).
  Allowlist: `server/jobs/jobRunner.ts` (wraps at the
  `withSchedulerLock` layer) and `server/jobQueue/index.ts` (wraps
  every handler invocation).

## Periodic strict-mode audit

The ratchet is closed in production, but new code can still introduce
unwrapped paths between releases. Run this audit before each major
release:

1. Set `STRICT_TENANT_RLS=true` in a staging environment.
2. Exercise the app + `scripts/smoke-test.sh` + the full vitest suite.
3. Anything that returns empty results, 5xxs, or hits "0 rows
   affected" has an unwrapped DB call. Wrap it with `withOrgContext`
   (route), `withJobOrgContext` (per-tenant job), or
   `withSystemJobContext` (intrinsically cross-tenant job) and
   re-run.

## Tests

`server/__tests__/tenant-rls.test.ts` proves the contract:

- Org A context cannot SELECT Org B rows.
- Org A context cannot UPDATE/DELETE Org B rows.
- `runAsSuperadmin` sees both orgs.
- `withJobOrgContext` scopes a background job to a single tenant.
- Strict mode (no superadmin default, no context) returns zero rows.
