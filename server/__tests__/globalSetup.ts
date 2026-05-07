// Side-effect import: applies `.env.test` overrides (when the file exists)
// before any of this module's code runs. Same module is also wired up as a
// vitest `setupFiles` entry so the override propagates to test workers too.
import { logInfo } from "../utils/logger";
import "./loadEnvTest";

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "../../shared/schema");
const DRIZZLE_CONFIG = path.resolve(__dirname, "../../drizzle.config.ts");
const ENV_TEST_PATH = path.resolve(__dirname, "../../.env.test");

// Name of the marker table used to cache "schema applied" state inside the
// test database itself. Storing the hash in-DB (rather than on disk) keeps
// the cache and the actual schema state in lock-step: if someone wipes the
// DB the next run will rebuild it; if someone changes shared/schema we
// rebuild because the hash mismatches.
const META_TABLE = "_test_schema_meta";

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}

function computeSchemaHash(): string {
  const hash = createHash("sha256");
  const files = [...collectFiles(SCHEMA_DIR), DRIZZLE_CONFIG];
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function exportSchemaSql(): string {
  // `drizzle-kit export --sql` diffs the schema in `shared/schema/*` against
  // an empty database and prints the resulting CREATE TYPE / CREATE TABLE /
  // ALTER TABLE / CREATE INDEX statements to stdout. It does NOT touch the
  // database and runs in a few seconds even on the full ~470-table schema,
  // so we use it as the source of truth for rebuilding the test database
  // instead of the much slower `drizzle-kit push --force` (which has to
  // introspect the live DB and times out at ~2 minutes).
  const result = spawnSync(
    "npx",
    ["drizzle-kit", "export", "--sql", `--config=${DRIZZLE_CONFIG}`],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `drizzle-kit export failed (exit ${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  if (!result.stdout || !result.stdout.includes("CREATE TABLE")) {
    throw new Error(
      `drizzle-kit export produced unexpected output (no CREATE TABLE found): ${result.stdout?.slice(0, 200)}`,
    );
  }
  return result.stdout;
}

async function readAppliedHash(client: Client): Promise<string | null> {
  try {
    const res = await client.query(
      `SELECT schema_hash FROM ${META_TABLE} WHERE id = 1`,
    );
    return res.rows[0]?.schema_hash ?? null;
  } catch (err) {
    // Postgres error code 42P01 = "undefined_table" — fresh DB, expected.
    // Anything else is a real problem (auth, connectivity, permissions)
    // and should surface so it can be diagnosed instead of silently
    // triggering a destructive rebuild.
    if ((err as { code?: string }).code === "42P01") {
      return null;
    }
    throw err;
  }
}

function assertSafeTestDatabase(databaseUrl: string): void {
  // Hard preflight to make sure we never DROP SCHEMA on a database that
  // wasn't meant to be wiped. The bootstrap is destructive, so we fail
  // closed unless one of the following is true:
  //   1. The connection string clearly identifies a test database
  //      (database name or host contains "test"), OR
  //   2. The operator has explicitly opted in by exporting
  //      ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1.
  //
  // NODE_ENV alone is intentionally NOT enough: it is trivially set to
  // "test" by every vitest run, including those a developer might launch
  // against a mispointed DATABASE_URL.
  if (process.env.ALLOW_DESTRUCTIVE_TEST_DB_REBUILD === "1") {
    return;
  }
  let dbName = "";
  let host = "";
  try {
    const u = new URL(databaseUrl);
    dbName = (u.pathname || "").replace(/^\//, "").toLowerCase();
    host = (u.hostname || "").toLowerCase();
  } catch {
    // Non-URL connection strings (rare) — fall through to the explicit
    // opt-in error below.
  }
  if (dbName.includes("test") || host.includes("test")) {
    return;
  }
  throw new Error(
    "[vitest globalSetup] Refusing to rebuild schema: DATABASE_URL does not " +
      "look like a test database (no 'test' substring in the database name " +
      "or host). The bootstrap performs DROP SCHEMA public CASCADE, which " +
      "is unsafe to run against a database with real data. If this DB is " +
      "genuinely a dedicated test DB, set " +
      "ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1 to opt in, or set " +
      "SKIP_TEST_DB_PUSH=1 to skip the bootstrap entirely.",
  );
}

async function rebuildSchema(client: Client, schemaSql: string, hash: string): Promise<void> {
  // Wipe the public schema and reapply the entire schema in one transaction.
  // pg's simple-query protocol accepts multiple statements separated by `;`
  // in a single .query() call, which is dramatically faster than spawning
  // psql or running statements one-by-one.
  await client.query("BEGIN");
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
    await client.query(schemaSql);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${META_TABLE} (
         id INTEGER PRIMARY KEY,
         schema_hash TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    await client.query(
      `INSERT INTO ${META_TABLE} (id, schema_hash) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, applied_at = NOW()`,
      [hash],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

function urlLooksLikeTest(databaseUrl: string): boolean {
  try {
    const u = new URL(databaseUrl);
    const dbName = (u.pathname || "").replace(/^\//, "").toLowerCase();
    const host = (u.hostname || "").toLowerCase();
    return dbName.includes("test") || host.includes("test");
  } catch {
    return false;
  }
}

async function maybeAutoProvisionTestDatabase(): Promise<void> {
  if (process.env.AUTO_PROVISION_TEST_DB === "0") return;
  if (process.env.ALLOW_DESTRUCTIVE_TEST_DB_REBUILD === "1") return;
  const sourceUrl = process.env.DATABASE_URL!;
  if (urlLooksLikeTest(sourceUrl)) return;

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return; // assertSafeTestDatabase will produce the actionable error
  }
  const sourceDbName = (parsed.pathname || "").replace(/^\//, "");
  if (!sourceDbName) return;

  const testDbName = process.env.TEST_DATABASE_NAME || `${sourceDbName}_test`;
  if (!testDbName.toLowerCase().includes("test")) return;
  if (testDbName === sourceDbName) return;

  // Connect to the server's default `postgres` admin DB and ensure the
  // sibling test database exists. CREATE DATABASE cannot be issued from
  // inside the dev DB itself.
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    logInfo(
      `[vitest globalSetup] Auto-provision skipped — cannot reach admin DB at ${adminUrl.host}: ${(err as Error).message}`,
    );
    return;
  }
  try {
    const exists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [testDbName],
    );
    if (!(exists.rowCount && exists.rowCount > 0)) {
      const escaped = `"${testDbName.replace(/"/g, '""')}"`;
      await admin.query(`CREATE DATABASE ${escaped}`);
      logInfo(`[vitest globalSetup] Auto-created test database '${testDbName}'.`);
    }
  } finally {
    await admin.end().catch(() => {});
  }

  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();

  // Persist `.env.test` so subsequent worker processes (which load this
  // file via vitest `setupFiles` → loadEnvTest.ts) see the same override.
  // Mutating process.env here only affects the main vitest process.
  if (!existsSync(ENV_TEST_PATH)) {
    const banner =
      "# Auto-generated by vitest globalSetup (Task #2589). Safe to delete and regenerate.\n" +
      "# Pinning DATABASE_URL at the dedicated test DB so `npm test` works\n" +
      "# without the contributor having to run `npm run test:setup` first.\n";
    writeFileSync(ENV_TEST_PATH, `${banner}DATABASE_URL=${testUrlStr}\n`, {
      mode: 0o600,
    });
  }
  process.env.DATABASE_URL = testUrlStr;
  logInfo(
    `[vitest globalSetup] Auto-provisioned test DB; DATABASE_URL now points at '${testDbName}'.`,
  );
}

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    if (process.env.SKIP_TEST_DB_PUSH === "1") {
      logInfo(
        "[vitest globalSetup] SKIP_TEST_DB_PUSH=1 and no DATABASE_URL — skipping schema sync entirely.",
      );
      return;
    }
    throw new Error(
      "DATABASE_URL is not set. The test database must be provisioned before running vitest, " +
        "or set SKIP_TEST_DB_PUSH=1 to bypass schema sync entirely.",
    );
  }

  if (process.env.SKIP_TEST_DB_PUSH === "1") {
    logInfo(
      "[vitest globalSetup] SKIP_TEST_DB_PUSH=1 set; skipping test schema sync.",
    );
    return;
  }

  // Task #2589 — When DATABASE_URL points at a non-test DB and the
  // operator hasn't already opted in via ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1,
  // auto-provision a sibling `<dbname>_test` database (and write `.env.test`
  // so test workers pick it up via setupFiles → loadEnvTest.ts) instead of
  // forcing every contributor to remember `npm run test:setup` first. This
  // keeps the destructive `DROP SCHEMA public CASCADE` confined to a freshly
  // created sibling DB whose name embeds "test", which still satisfies
  // assertSafeTestDatabase() below. Disable with AUTO_PROVISION_TEST_DB=0.
  await maybeAutoProvisionTestDatabase();

  // Fail closed before opening any connection if the target DB does not
  // look like a dedicated test database.
  assertSafeTestDatabase(process.env.DATABASE_URL);

  const expectedHash = computeSchemaHash();
  const force =
    process.env.FORCE_TEST_DB_PUSH === "1" ||
    process.env.FORCE_TEST_DB_REBUILD === "1";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (!force) {
      const appliedHash = await readAppliedHash(client);
      if (appliedHash === expectedHash) {
        logInfo(
          "[vitest globalSetup] Test DB schema hash matches — skipping rebuild.",
        );
        return;
      }
    }

    logInfo(
      "[vitest globalSetup] Rebuilding test DB schema from `drizzle-kit export`...",
    );
    const start = Date.now();
    const sql = exportSchemaSql();
    await rebuildSchema(client, sql, expectedHash);
    logInfo(
      `[vitest globalSetup] Test DB schema rebuilt in ${((Date.now() - start) / 1000).toFixed(1)}s (hash ${expectedHash.slice(0, 12)}).`,
    );
  } finally {
    await client.end();
  }
}
