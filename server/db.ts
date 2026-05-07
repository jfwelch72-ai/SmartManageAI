// Task #2478 — `db` is a Proxy that prefers an ALS-bound, RLS-scoped
// drizzle instance whenever an org context is active (set by
// `server/middleware/orgContext.ts` or `server/dbContext.ts#withOrgContext`).
// Falls back to the pool-backed base instance for boot, schedulers, and
// other code paths that haven't yet been wrapped in an org context.
//
// All callers should keep importing `db` from `./db` — the proxy is
// transparent. New files MUST NOT bypass this proxy by constructing their
// own `drizzle({ client: pool })`; the lint guard at
// `scripts/check-db-imports.mjs` catches that.

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 60,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Task #2478 — RLS default for the connection.
//
// Policies installed by ensureRlsPolicies are FAIL-CLOSED: a row is
// visible IFF `app.is_superadmin = 'true'` OR `organization_id =
// app.current_org_id`. To keep legacy code paths that haven't been
// wrapped in `withOrgContext` working, every fresh pool connection is
// stamped as superadmin by default. `withOrgContext` explicitly
// downgrades the session to non-superadmin + a specific org id, which
// is what engages true tenant filtering.
//
// Setting `STRICT_TENANT_RLS=true` skips this default so unwrapped
// queries return zero rows — the actual ratchet to strict mode.
export const STRICT_TENANT_RLS = process.env.STRICT_TENANT_RLS === "true";
const CONNECT_DEFAULT_IS_SUPERADMIN = STRICT_TENANT_RLS ? "false" : "true";

pool.on("connect", (client: PoolClient) => {
  // Fire-and-forget — the very next query on this client awaits its own
  // completion, and pg serialises queries per-client, so the SET is
  // guaranteed to be visible before any user query runs.
  client
    .query(
      "SELECT set_config('app.is_superadmin', $1, false), set_config('app.current_org_id', '', false)",
      [CONNECT_DEFAULT_IS_SUPERADMIN],
    )
    .catch((err: Error) => {
      // eslint-disable-next-line no-console
      console.error("[db] failed to set RLS connect-defaults", err.message);
    });
});

const baseDb: NodePgDatabase<typeof schema> = drizzle({ client: pool, schema });

// `dbContext` registers its `getContextDrizzle` here at import time. We
// can't import it eagerly because `dbContext` itself imports `pool` from
// this file (circular). The setter pattern keeps both modules ESM-clean
// while letting the Proxy route to the ALS-bound instance whenever a
// context is active.
type ContextResolver = () => NodePgDatabase<typeof schema> | null;
let contextResolver: ContextResolver | null = null;
export function __setOrgContextResolver(fn: ContextResolver): void {
  contextResolver = fn;
}

function activeDb(): NodePgDatabase<typeof schema> {
  if (!contextResolver) return baseDb;
  try {
    return contextResolver() ?? baseDb;
  } catch {
    return baseDb;
  }
}

export const db: NodePgDatabase<typeof schema> = new Proxy(baseDb, {
  get(_target, prop) {
    const target = activeDb() as unknown as Record<string | symbol, unknown>;
    const value = target[prop as string];
    return typeof value === "function" ? (value as Function).bind(target) : value;
  },
}) as NodePgDatabase<typeof schema>;
