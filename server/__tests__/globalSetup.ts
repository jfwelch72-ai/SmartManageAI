import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "../../shared/schema");
const DRIZZLE_CONFIG = path.resolve(__dirname, "../../drizzle.config.ts");
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");
const CACHE_DIR = path.resolve(__dirname, "../../node_modules/.cache/vitest-db");
const CACHE_FILE = path.join(CACHE_DIR, "test-db-schema.hash");

// Loose, idempotent SQL migration files that capture schema fixes the
// `shared/schema/*` Drizzle schema relies on. These are applied directly via
// pg before `drizzle-kit push` so that even when push is too slow (or
// momentarily fails because of unrelated schema churn) the test database
// still has the columns / enum values the field-sync tests require.
//
// Every file listed here MUST be safe to run repeatedly against an already
// up-to-date database (use `IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`,
// `CREATE TYPE ... EXCEPTION WHEN duplicate_object`, etc.).
const REQUIRED_IDEMPOTENT_MIGRATIONS = [
  "add_users_quiet_hours_digest_locale_format.sql",
  "add_offline_entity_types_field_sync.sql",
];

async function applyIdempotentMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const filename of REQUIRED_IDEMPOTENT_MIGRATIONS) {
      const fullPath = path.join(MIGRATIONS_DIR, filename);
      if (!existsSync(fullPath)) {
        console.warn(
          `[vitest globalSetup] Required idempotent migration missing on disk: ${filename}`,
        );
        continue;
      }
      const sql = readFileSync(fullPath, "utf8");
      try {
        await client.query(sql);
      } catch (err) {
        throw new Error(
          `Failed to apply idempotent migration ${filename}: ${(err as Error).message}`,
        );
      }
    }
  } finally {
    await client.end();
  }
}

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
  // Include the database URL so switching DBs forces a re-push.
  hash.update(process.env.DATABASE_URL ?? "");
  return hash.digest("hex");
}

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    if (process.env.SKIP_TEST_DB_PUSH === "1") {
      console.log(
        "[vitest globalSetup] SKIP_TEST_DB_PUSH=1 and no DATABASE_URL — skipping schema sync entirely.",
      );
      return;
    }
    throw new Error(
      "DATABASE_URL is not set. The test database must be provisioned before running vitest, " +
        "or set SKIP_TEST_DB_PUSH=1 to bypass schema sync entirely.",
    );
  }

  // Always apply the small set of idempotent migrations first so that the
  // schema fixes captured in `migrations/add_*.sql` are present even when
  // `drizzle-kit push` is slow/skipped. This is the documented step that
  // ensures the test database is in sync with `shared/schema/*` before
  // vitest runs any test files.
  try {
    await applyIdempotentMigrations();
  } catch (err) {
    throw new Error(
      `[vitest globalSetup] Failed to apply required idempotent migrations: ${(err as Error).message}`,
    );
  }

  if (process.env.SKIP_TEST_DB_PUSH === "1") {
    console.log(
      "[vitest globalSetup] SKIP_TEST_DB_PUSH=1 set, idempotent migrations applied; skipping drizzle-kit push.",
    );
    return;
  }

  const currentHash = computeSchemaHash();
  const force = process.env.FORCE_TEST_DB_PUSH === "1";

  if (!force && existsSync(CACHE_FILE)) {
    const cachedHash = readFileSync(CACHE_FILE, "utf8").trim();
    if (cachedHash === currentHash) {
      console.log(
        "[vitest globalSetup] Schema unchanged since last push (hash match), skipping drizzle-kit push.",
      );
      return;
    }
  }

  console.log(
    "[vitest globalSetup] Schema changed (or first run), syncing test database via `drizzle-kit push --force`...",
  );
  const result = spawnSync(
    "npx",
    ["drizzle-kit", "push", "--force"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `drizzle-kit push failed with exit code ${result.status}. ` +
        `Test database schema is out of sync with shared/schema. ` +
        `Set SKIP_TEST_DB_PUSH=1 to bypass this check (not recommended), ` +
        `or FORCE_TEST_DB_PUSH=1 to force a push regardless of cache.`,
    );
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, currentHash);
  console.log("[vitest globalSetup] Test database schema is in sync (hash cached).");
}
