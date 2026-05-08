// Task #2478 — Tenant isolation hardening with Postgres RLS.
//
// Per-request / per-job database context. The Express middleware
// (`server/middleware/orgContext.ts`) and the background job runner both
// call `withOrgContext()` to bind a checked-out pg client whose session
// variables (`app.current_org_id`, `app.is_superadmin`) drive the
// row-level-security policies installed by `ensureRlsPolicies` /
// `migrations/0096_enable_tenant_rls.sql`.
//
// The exported `db` from `./db` is a Proxy that prefers the ALS-bound
// drizzle instance whenever a context is active, so existing callers that
// import `db` from `./db` automatically pick up the RLS-scoped client
// without any code change.
//
// Defense-in-depth: even if a route forgets a `WHERE organization_id = …`
// clause, Postgres itself filters cross-tenant rows out of the result set.

import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { pool, __setOrgContextResolver, STRICT_TENANT_RLS } from "./db";
import { logError, logInfo, logWarn } from "./utils/logger";

export interface OrgContext {
  client: PoolClient;
  drizzle: NodePgDatabase<typeof schema>;
  organizationId: string | null;
  isSuperadmin: boolean;
  // Free-form label (route path, job name, etc.) used in audit logs when
  // the superadmin escape hatch is invoked.
  source: string;
}

const orgContextStorage = new AsyncLocalStorage<OrgContext>();

export function getOrgContext(): OrgContext | undefined {
  return orgContextStorage.getStore();
}

export interface WithOrgContextOptions {
  organizationId: string | null;
  isSuperadmin?: boolean;
  source: string;
}

/**
 * Acquire a dedicated pg client, set the per-tenant session variables, run
 * `fn` with that client bound to the AsyncLocalStorage, and release the
 * client when `fn` resolves or throws.
 *
 * Holding a connection per request is intentional: Postgres `SET` /
 * `set_config(_, _, false)` is connection-scoped, so the RLS policy must
 * see the same backend that ran the SET. Pool size is 60 (see `./db`),
 * which comfortably covers our concurrent request load.
 */
export async function withOrgContext<T>(
  opts: WithOrgContextOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT set_config('app.current_org_id', $1, false), set_config('app.is_superadmin', $2, false)",
      [opts.organizationId ?? "", opts.isSuperadmin ? "true" : "false"],
    );
    const ctxDb = drizzle({ client, schema });
    const ctx: OrgContext = {
      client,
      drizzle: ctxDb,
      organizationId: opts.organizationId,
      isSuperadmin: !!opts.isSuperadmin,
      source: opts.source,
    };
    return await orgContextStorage.run(ctx, fn);
  } finally {
    // Restore the connection to its pool-default state so the next
    // checkout starts from a known baseline. In non-strict mode that
    // means superadmin = 'true' (matches the pool 'connect' handler);
    // in strict mode the default is 'false' so unwrapped queries on a
    // returned client still fail closed.
    const defaultSuperadmin = STRICT_TENANT_RLS ? "false" : "true";
    try {
      await client.query(
        "SELECT set_config('app.current_org_id', '', false), set_config('app.is_superadmin', $1, false)",
        [defaultSuperadmin],
      );
    } catch (err) {
      logWarn("[dbContext] reset session vars failed", {
        error: (err as Error).message,
      });
    }
    client.release();
  }
}

/**
 * Explicit super-admin escape hatch. Every invocation is audit-logged to
 * the dedicated `superadmin_access_log` table so platform-level reads /
 * writes that bypass tenant isolation are visible after the fact.
 *
 * FAIL-CLOSED: the audit insert runs on a fresh, dedicated pg client (so
 * RLS / current session vars cannot suppress it) and any failure rejects
 * before `fn` is invoked. Privileged DB work without an audit trail is
 * exactly what this task exists to prevent.
 *
 * Use sparingly — most platform-admin work should still scope to a
 * specific tenant via `withOrgContext({ organizationId, … })`.
 */
export async function runAsSuperadmin<T>(
  reason: string,
  fn: () => Promise<T>,
  opts: { actorId?: string | null } = {},
): Promise<T> {
  logInfo("[dbContext] runAsSuperadmin invoked", { reason });
  const auditClient = await pool.connect();
  try {
    // Stamp this audit row from a privileged session so it cannot be
    // filtered out by a future RLS policy. The table is non-tenant
    // (no organization_id) so RLS is not enabled today, but defending
    // against drift is cheap.
    try {
      await auditClient.query(
        "SELECT set_config('app.is_superadmin', 'true', false), set_config('app.current_org_id', '', false)",
      );
      await auditClient.query(
        `INSERT INTO superadmin_access_log (reason, source, actor_id)
         VALUES ($1, $2, $3)`,
        [reason, "runAsSuperadmin", opts.actorId ?? null],
      );
    } catch (err) {
      logError("[dbContext] superadmin audit insert FAILED — refusing to elevate", {
        reason,
        error: (err as Error).message,
      });
      throw new Error(
        `runAsSuperadmin refused: audit write failed (${(err as Error).message})`,
      );
    } finally {
      // CRITICAL: restore connect-default session vars BEFORE returning
      // the client to the pool. Otherwise the next checkout would
      // inherit `app.is_superadmin='true'` and any unwrapped query on
      // that pooled client would silently bypass RLS — exactly the
      // privilege-leak this task is designed to prevent. In strict
      // mode the default is 'false', mirroring the pool 'connect'
      // handler in `./db.ts`.
      const defaultSuperadmin = STRICT_TENANT_RLS ? "false" : "true";
      try {
        await auditClient.query(
          "SELECT set_config('app.current_org_id', '', false), set_config('app.is_superadmin', $1, false)",
          [defaultSuperadmin],
        );
      } catch (resetErr) {
        // Resetting failed — discard the connection so a poisoned
        // client cannot poison subsequent checkouts.
        logWarn("[dbContext] failed to reset audit-client session vars; discarding", {
          error: (resetErr as Error).message,
        });
        try {
          (auditClient as unknown as { release: (err?: unknown) => void }).release(
            resetErr,
          );
        } catch {
          /* fall through */
        }
        // Return early so we don't double-release.
        return withOrgContext(
          { organizationId: null, isSuperadmin: true, source: `superadmin:${reason}` },
          fn,
        );
      }
    }
  } finally {
    try {
      auditClient.release();
    } catch {
      /* already released above on the reset-failure path */
    }
  }
  return withOrgContext(
    { organizationId: null, isSuperadmin: true, source: `superadmin:${reason}` },
    fn,
  );
}

/**
 * Background-job convenience wrapper. Equivalent to `withOrgContext` but
 * forces a `source` of `job:<name>` so the audit/log story for jobs is
 * uniform.
 */
export async function withJobOrgContext<T>(
  jobName: string,
  organizationId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  return withOrgContext(
    { organizationId, source: `job:${jobName}` },
    fn,
  );
}

/**
 * Task #2673 — System-job context for cross-tenant background sweeps
 * (outbox drain, retention sweep, integration sync, periodic reports,
 * etc.). These jobs are intrinsically global: they walk every tenant
 * to find work, so they need cross-tenant DB access once
 * `STRICT_TENANT_RLS=true` is the production default.
 *
 * IMPORTANT: this is an AUDITED elevation. It delegates to
 * `runAsSuperadmin("system-job:<name>", …)` which writes a row to
 * `superadmin_access_log` BEFORE elevating and refuses to elevate if
 * the audit write fails. `superadmin_access_log` is therefore the only
 * path for cross-tenant access in the codebase — there is no silent
 * bypass anywhere.
 *
 * Yes, this means every cron tick that runs an inherently cross-tenant
 * sweep writes one audit row. That is the point: the operator can grep
 * `superadmin_access_log` for `system-job:*` to see exactly which
 * background jobs elevated, when, and how often. Per-tenant work that
 * fans out from inside one of these sweeps MUST still drop into a
 * tenant-scoped child context via `withJobOrgContext` so RLS pins the
 * inner queries to a single org and the per-org child does not write
 * an additional audit row.
 */
export async function withSystemJobContext<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runAsSuperadmin(`system-job:${jobName}`, fn);
}

/**
 * Internal — used by the `db` proxy in `./db.ts`. Returns the ALS-bound
 * drizzle instance when a context is active, otherwise `null` so callers
 * fall back to the pool-backed base instance.
 */
export function getContextDrizzle(): NodePgDatabase<typeof schema> | null {
  const ctx = orgContextStorage.getStore();
  return ctx ? ctx.drizzle : null;
}

// Wire ourselves into the `db` Proxy at import time so any future `db.…`
// call automatically routes through the ALS-bound drizzle instance when a
// context is active. Importing `./middleware/orgContext` (or this module
// directly) anywhere in the boot graph is enough to enable enforcement.
__setOrgContextResolver(getContextDrizzle);

// Exposed for tests that want to assert "did this code path run inside a
// context?". Not used by production code.
export const __orgContextStorageForTests = orgContextStorage;

export function logOrgContextOnError(err: unknown): void {
  const ctx = orgContextStorage.getStore();
  if (!ctx) return;
  logError("[dbContext] error inside org context", {
    organizationId: ctx.organizationId,
    isSuperadmin: ctx.isSuperadmin,
    source: ctx.source,
    error: (err as Error)?.message,
  });
}
