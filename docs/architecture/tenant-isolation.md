# Tenant Isolation with Postgres RLS (Task #2478)

## Status

**Defense-in-depth, fail-closed policy + named superadmin default.** Row-level
security is enabled (with `FORCE`) on every multi-tenant table in production
and the policies are fail-closed: a session sees a row IFF
`app.is_superadmin = 'true'` OR `organization_id = app.current_org_id`.

Authenticated HTTP traffic is **always** wrapped in a non-elevated
`withOrgContext` — even SUPER_ADMIN sessions land in a non-elevated
context scoped to their own org (or a fail-closed null-org context if
they don't have one). Cross-tenant reads/writes for platform admin work
must go through `runAsSuperadmin(reason, …)`, which writes a row to
`superadmin_access_log` *before* elevating and refuses to elevate if the
audit write fails.

Unauthenticated traffic (login, public webhooks, the few open portal
endpoints) and not-yet-wrapped background jobs run on a fresh pool
connection whose default is governed by `STRICT_TENANT_RLS`:

- `STRICT_TENANT_RLS` unset / `false` (today): connect-default is
  `app.is_superadmin = 'true'` so legacy job code paths keep working.
- `STRICT_TENANT_RLS=true` (target state): connect-default is
  `app.is_superadmin = 'false'` so any unwrapped query returns zero
  rows.

The flip is the actual ratchet to strict mode.

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

`server/db.ts` registers a `pool.on("connect", …)` handler that sets the
following on every fresh pool connection:

| `STRICT_TENANT_RLS` | `app.is_superadmin` default | Effect on uncontextualized queries |
| --- | --- | --- |
| unset / `false` (today) | `true` | Bypass RLS — legacy code keeps working. |
| `true` (target state)   | `false` | Fail closed — return zero rows. |

`withOrgContext` always overrides this default for the duration of the
request/job (downgrades to `is_superadmin = 'false'` + the bound org id),
then restores the connect-default on `client.release()`.

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

Each handler in `server/jobs/jobRunner.ts` that processes a single
organization should wrap the per-org body with:

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
`pruneJobMetricsDb`) can keep running outside any context — the
default-superadmin connect handler preserves their behaviour today. To
move them into the strict-mode lane explicitly, wrap each one with
`runAsSuperadmin("<job-name>", …)` and accept the per-tick audit row.

All four `for (const org of orgs)` loops in `server/jobs/jobRunner.ts`
are now accounted for:

- `processCrmContactBirthdayDailyDigest` (loop ~4138) →
  `withJobOrgContext("crm.contactBirthdayDailyDigest", org.id, …)`
- `processCrmContactBirthdayWeeklyDigest` (loop ~3769) →
  `withJobOrgContext("crm.contactBirthdayWeeklyDigest", org.id, …)`
- `processCertifiedPayrollDigest` (loop ~4377) →
  `withJobOrgContext("payroll.certifiedPayrollDigest", org.id, …)`
- Compliance-expiration notification builder (loop ~2456) — N/A: the
  loop body issues NO DB queries; it only appends to an in-memory
  `notificationValues` array. The single bulk read/write happens after
  the loop and intentionally spans all orgs.

When converting a job, outer-loop `continue` statements inside the
wrapped block must become `return` because the body now runs as an
async callback rather than the loop body itself. Inner loops keep
their own `continue`s. Follow-up #2491 covers any new per-org loops
added after this task and the eventual `STRICT_TENANT_RLS=true` flip.

## Ratchet to strict mode

The full ratchet is a single env flip — `STRICT_TENANT_RLS=true` — once
every authenticated route and every per-org background job is wrapped.
Until then, run periodic audits:

1. Set `STRICT_TENANT_RLS=true` in a staging environment.
2. Exercise the app + smoke tests; any feature that returns empty
   results or 5xxs has an unwrapped DB call.
3. Wrap it with `withOrgContext` (route) or `withJobOrgContext` (job)
   and re-run.

The lint guard at `scripts/check-db-imports.mjs` (wired into
`scripts/ci.sh`) blocks new files that bypass the proxy by importing
drizzle directly or building their own pool.

## Tests

`server/__tests__/tenant-rls.test.ts` proves the contract:

- Org A context cannot SELECT Org B rows.
- Org A context cannot UPDATE/DELETE Org B rows.
- `runAsSuperadmin` sees both orgs.
- `withJobOrgContext` scopes a background job to a single tenant.
- Strict mode (no superadmin default, no context) returns zero rows.
