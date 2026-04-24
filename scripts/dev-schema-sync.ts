#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.resolve(REPO_ROOT, "shared/schema");
const SCHEMA_INDEX = path.resolve(SCHEMA_DIR, "index.ts");
const DRIZZLE_CONFIG = path.resolve(REPO_ROOT, "drizzle.config.ts");
const META_TABLE = "_dev_schema_meta";

// 180s budget for the actual `drizzle-kit push` invocation. The clean
// post-merge case never reaches it: `computeSchemaHash` short-circuits
// when the dev DB's stamped hash matches the working tree, so the
// script exits in a couple seconds when there are no schema changes.
// The budget only matters when there IS pending drift; the wrapping
// post-merge.sh runner adds another `timeout 200` on top as a backstop.
const PUSH_TIMEOUT_MS = Number(
  process.env.DEV_SCHEMA_PUSH_TIMEOUT_MS ?? 180_000,
);

function log(msg: string): void {
  console.log(`[dev-schema-sync] ${msg}`);
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectFiles(full));
    else if (st.isFile()) out.push(full);
  }
  return out.sort();
}

function computeSchemaHash(): string {
  // Hash file contents keyed by their **repo-relative** paths so the hash
  // is portable across different checkouts that point at the same dev DB.
  const hash = createHash("sha256");
  for (const file of [...collectFiles(SCHEMA_DIR), DRIZZLE_CONFIG]) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function ensureMetaTable(client: Client): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${META_TABLE} (
       id INTEGER PRIMARY KEY,
       schema_hash TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
}

async function readAppliedHash(client: Client): Promise<string | null> {
  try {
    const res = await client.query(
      `SELECT schema_hash FROM ${META_TABLE} WHERE id = 1`,
    );
    return res.rows[0]?.schema_hash ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return null;
    throw err;
  }
}

async function writeAppliedHash(client: Client, hash: string): Promise<void> {
  await ensureMetaTable(client);
  await client.query(
    `INSERT INTO ${META_TABLE} (id, schema_hash) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, applied_at = NOW()`,
    [hash],
  );
}

/**
 * Curated allowlist of public tables that we know are owned by raw-SQL
 * helpers / scripts rather than declared as Drizzle `pgTable`s. These
 * are the only "schema-missing" tables we are willing to hide from
 * `drizzle-kit push` — anything else that shows up as missing must
 * surface as an error so we don't silently mask a real Drizzle rename
 * regression (see Task #1598's code-review feedback).
 *
 * To add a new entry: include the exact table name (or a `prefix_*`
 * glob for groups owned by a single helper) and a `reason` pointing
 * at the helper / script that creates it. The reason is logged on
 * each post-merge run so the rationale stays visible.
 */
const KNOWN_RAW_SQL_TABLE_ALLOWLIST: ReadonlyArray<{
  pattern: string;
  reason: string;
}> = [
  {
    pattern: "_dev_schema_meta",
    reason: "owned by scripts/dev-schema-sync.ts (this script's hash marker)",
  },
  {
    pattern: "status_*",
    reason:
      "owned by server/utils/ensureStatusPageTables.ts (12 internal status-page tables)",
  },
  {
    pattern: "one_shot_jobs",
    reason: "owned by server/utils/oneShotJobRegistry.ts",
  },
  {
    pattern: "mobile_exchange_codes",
    reason: "owned by server/utils/ensureMobileExchangeCodes.ts",
  },
  {
    pattern: "project_report_settings",
    reason:
      "legacy table created by server/utils/ensureReportsTables.ts; kept for back-compat with dev DBs predating its retirement",
  },
  {
    pattern: "project_spec_index",
    reason:
      "legacy table dropped via migrations/0028_drop_project_spec_index.sql; persists on dev DBs predating that drop",
  },
];

function matchAllowlistEntry(
  table: string,
): { pattern: string; reason: string } | null {
  for (const entry of KNOWN_RAW_SQL_TABLE_ALLOWLIST) {
    if (entry.pattern.endsWith("_*")) {
      const prefix = entry.pattern.slice(0, -1); // keep trailing underscore
      if (table.startsWith(prefix) && table.length > prefix.length) {
        return entry;
      }
    } else if (entry.pattern === table) {
      return entry;
    }
  }
  return null;
}

/**
 * Splits public-schema tables that are missing from `shared/schema/*`
 * into two buckets:
 *
 * - `orphans`: tables we recognise as belonging to a raw-SQL helper
 *   (per `KNOWN_RAW_SQL_TABLE_ALLOWLIST`). These are safe to hide from
 *   `drizzle-kit push` via `tablesFilter` — drizzle-kit applies the
 *   filter to both schema-side AND DB-introspection-side tables, so
 *   excluded tables never enter the diff and can never trigger the
 *   "is X created or renamed from Y?" interactive prompt.
 *
 * - `unknown`: tables in the DB that have no Drizzle definition AND are
 *   not on the allowlist. Treating these as orphans would mask real
 *   Drizzle rename drift: if a Drizzle table gets renamed (old name
 *   removed from schema, new name added), the old name shows up here.
 *   Filtering it would let drizzle-kit silently CREATE the new table
 *   alongside the (now ignored) old one. The caller refuses to push
 *   when this list is non-empty and surfaces a clear error so an
 *   operator can investigate from a TTY.
 *
 * Per Task #1598, this is what keeps the post-merge sync both
 * non-interactive AND honest about real schema drift.
 */
async function computeOrphanTables(
  client: Client,
): Promise<{ orphans: string[]; unknown: string[] }> {
  // Load the Drizzle schema and extract every defined pgTable name.
  // Importing `@shared/schema` directly resolves the module's transitive
  // pgTable definitions in one shot, so we don't have to grep the source.
  const [schemaModule, { PgTable }, { getTableName }] = await Promise.all([
    import(SCHEMA_INDEX),
    import("drizzle-orm/pg-core"),
    import("drizzle-orm"),
  ]);

  const drizzleNames = new Set<string>();
  for (const value of Object.values(
    schemaModule as Record<string, unknown>,
  )) {
    if (value instanceof PgTable) {
      try {
        const name = getTableName(value);
        if (name) drizzleNames.add(name);
      } catch {
        // ignore individual-table extraction errors
      }
    }
  }

  if (drizzleNames.size === 0) {
    // We can't safely classify orphans without a populated schema set.
    // Bail out loudly — a downstream guard will refuse to push.
    throw new Error(
      "Could not extract any pgTable names from shared/schema — refusing to compute orphan list (would falsely mark every DB table as orphan).",
    );
  }

  const dbRows = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'`,
  );

  const orphans: string[] = [];
  const unknown: string[] = [];
  for (const row of dbRows.rows) {
    if (drizzleNames.has(row.table_name)) continue;
    if (matchAllowlistEntry(row.table_name)) {
      orphans.push(row.table_name);
    } else {
      unknown.push(row.table_name);
    }
  }
  // Always exclude _dev_schema_meta even on first run when it hasn't been
  // created yet (so its absence from the DB doesn't leave it off the
  // filter and let drizzle-kit ask about it after we create it later).
  if (!orphans.includes(META_TABLE) && matchAllowlistEntry(META_TABLE)) {
    orphans.push(META_TABLE);
  }
  orphans.sort();
  unknown.sort();
  return { orphans, unknown };
}

/**
 * Writes a transient drizzle-kit config that mirrors `drizzle.config.ts`
 * but adds a `tablesFilter` that hides the orphan tables from
 * introspection. Returns the absolute config path and a cleanup fn.
 *
 * Using a temp config (rather than mutating drizzle.config.ts) keeps the
 * filter scoped to this one push run: the rest of the dev workflow
 * (`npm run db:push`, `npm run db:studio`, etc.) still sees every table.
 */
function writeTempDrizzleConfig(orphans: string[]): {
  configPath: string;
  cleanup: () => void;
} {
  // Writing the temp config inside the repo (under node_modules/.cache)
  // is intentional: drizzle-kit's config loader uses Node's require()
  // resolution to import "drizzle-kit" itself from the config file, so
  // a config in /tmp can't see the repo's node_modules. node_modules
  // is also already gitignored so the cached file is never staged.
  const cacheDir = path.resolve(REPO_ROOT, "node_modules/.cache");
  mkdirSync(cacheDir, { recursive: true });
  const tmpDir = mkdtempSync(path.join(cacheDir, "dev-schema-sync-"));
  const configPath = path.join(tmpDir, "drizzle.config.mjs");

  // Use absolute paths so drizzle-kit resolves files correctly regardless
  // of where it ends up resolving the config-relative paths from.
  const filterLiteral = JSON.stringify(orphans.map((t) => `!${t}`));
  const schemaLiteral = JSON.stringify(SCHEMA_INDEX);
  const outLiteral = JSON.stringify(path.resolve(REPO_ROOT, "migrations"));

  const content = `// AUTO-GENERATED by scripts/dev-schema-sync.ts; safe to delete.
// Mirrors drizzle.config.ts but adds tablesFilter so drizzle-kit push
// ignores tables that are owned by raw-SQL ensure*Tables.ts helpers
// (status_*, one_shot_jobs, _dev_schema_meta, ...). See Task #1598.
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for dev-schema-sync");
}

export default defineConfig({
  out: ${outLiteral},
  schema: ${schemaLiteral},
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  tablesFilter: ${filterLiteral},
});
`;
  writeFileSync(configPath, content);
  return {
    configPath,
    cleanup: () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

function runDrizzlePush(configPath: string): { ok: boolean; output: string } {
  // `drizzle-kit push --force` introspects the live DB and applies an
  // additive diff. With our orphan-table filter in place the diff is
  // additive-only, so push runs without any interactive prompts.
  //
  // stdin is `'ignore'` (i.e. /dev/null) so an unexpected interactive
  // prompt cannot silently consume garbage and pick a destructive
  // default — instead it'll hang until PUSH_TIMEOUT_MS, surfacing the
  // problem as a clear timeout error rather than a silent data-loss
  // commit. See Task #1598.
  const result = spawnSync(
    "npx",
    ["drizzle-kit", "push", "--force", `--config=${configPath}`],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: PUSH_TIMEOUT_MS,
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error || result.status !== 0) {
    return { ok: false, output };
  }
  return { ok: true, output };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    log("DATABASE_URL not set — skipping dev schema sync.");
    return;
  }
  if (process.env.SKIP_DEV_SCHEMA_SYNC === "1") {
    log("SKIP_DEV_SCHEMA_SYNC=1 — skipping dev schema sync.");
    return;
  }

  const expectedHash = computeSchemaHash();
  const force = process.env.FORCE_DEV_SCHEMA_SYNC === "1";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let needsPush = force;
  try {
    if (!force) {
      const applied = await readAppliedHash(client);
      if (applied === expectedHash) {
        log(
          `Schema hash matches (${expectedHash.slice(0, 12)}) — skipping push.`,
        );
        return;
      }
      log(
        applied
          ? `Schema hash changed (was ${applied.slice(0, 12)}, now ${expectedHash.slice(0, 12)}) — running drizzle-kit push.`
          : `No applied hash recorded — running drizzle-kit push to bring DB in sync.`,
      );
    } else {
      log("FORCE_DEV_SCHEMA_SYNC=1 — running drizzle-kit push unconditionally.");
    }
    needsPush = true;
  } finally {
    if (!needsPush) await client.end();
  }

  if (!needsPush) return;

  // Pre-introspect to find tables owned by raw-SQL helpers (orphans
  // from drizzle-kit's POV) so we can hide them via tablesFilter and
  // avoid the interactive rename prompt that hangs the post-merge run.
  // Anything missing from the schema that is NOT on the curated
  // allowlist is treated as suspected drift and aborts the push.
  let orphans: string[];
  let unknown: string[];
  try {
    ({ orphans, unknown } = await computeOrphanTables(client));
  } catch (err) {
    log(
      `Pre-introspect failed: ${(err as Error).message}. Refusing to run drizzle-kit push.`,
    );
    await client.end();
    process.exit(1);
    return;
  }

  if (unknown.length > 0) {
    log("ABORTING: detected schema-missing tables not on the raw-SQL allowlist.");
    log(
      `These tables exist in the dev DB but have no Drizzle pgTable and aren't owned by a known raw-SQL helper:`,
    );
    for (const name of unknown) log(`  - ${name}`);
    log(
      "If these are leftover Drizzle tables from a rename, run drizzle-kit push from a TTY (FORCE_DEV_SCHEMA_SYNC=1 npx drizzle-kit push --config=drizzle.config.ts) so you can answer the rename prompt.",
    );
    log(
      "If they are owned by a new raw-SQL helper, add them to KNOWN_RAW_SQL_TABLE_ALLOWLIST in scripts/dev-schema-sync.ts (with a `reason` pointing at the helper) and re-run.",
    );
    log(
      "Skipping push and leaving the schema hash unchanged so the next post-merge retries.",
    );
    await client.end();
    process.exit(1);
    return;
  }

  if (orphans.length > 0) {
    log(
      `Excluding ${orphans.length} raw-SQL-owned tables from drizzle-kit push: ${orphans.join(", ")}`,
    );
    for (const entry of KNOWN_RAW_SQL_TABLE_ALLOWLIST) {
      if (orphans.some((t) => matchAllowlistEntry(t)?.pattern === entry.pattern)) {
        log(`  • allowlist[${entry.pattern}]: ${entry.reason}`);
      }
    }
  } else {
    log(
      "No orphan tables detected — every public table is defined in shared/schema.",
    );
  }

  const { configPath, cleanup } = writeTempDrizzleConfig(orphans);
  const start = Date.now();
  const { ok, output } = runDrizzlePush(configPath);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  cleanup();

  try {
    if (ok) {
      log(`drizzle-kit push completed in ${elapsed}s.`);
      await writeAppliedHash(client, expectedHash);
      log(`Stamped applied schema hash ${expectedHash.slice(0, 12)}.`);
    } else {
      log(`drizzle-kit push failed or timed out after ${elapsed}s. Output:`);
      if (output) console.log(output);
      // If the elapsed time is suspiciously close to the configured
      // timeout, the run probably hit an unanswered interactive prompt
      // (column rename, unique-constraint truncate, drop-column
      // confirmation, ...) — surface that hypothesis loudly so the
      // operator knows where to look instead of assuming a transient
      // network issue. The orphan allowlist prevents the rename-prompt
      // class specifically; other interactive prompts mean genuine
      // drift that needs a human decision.
      if (Date.now() - start >= PUSH_TIMEOUT_MS - 500) {
        log(
          "Push hit the configured timeout. This usually means drizzle-kit asked an interactive prompt that no TTY answered — most often a column rename, unique-constraint addition on populated data, or drop-column confirmation. Re-run with `FORCE_DEV_SCHEMA_SYNC=1 npx drizzle-kit push --config=drizzle.config.ts` from a TTY to inspect and answer the prompt.",
        );
      }
      log(
        "Continuing without stamping hash — startup migrations / next sync will retry.",
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[dev-schema-sync] Unexpected error: ${err?.stack ?? err}`);
  // Non-blocking: post-merge should not fail the merge on schema-sync issues.
  process.exit(0);
});
