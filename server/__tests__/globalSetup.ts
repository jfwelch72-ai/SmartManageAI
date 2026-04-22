import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "../../shared/schema");
const DRIZZLE_CONFIG = path.resolve(__dirname, "../../drizzle.config.ts");
const CACHE_DIR = path.resolve(__dirname, "../../node_modules/.cache/vitest-db");
const CACHE_FILE = path.join(CACHE_DIR, "test-db-schema.hash");

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
  if (process.env.SKIP_TEST_DB_PUSH === "1") {
    console.log("[vitest globalSetup] SKIP_TEST_DB_PUSH=1 set, skipping drizzle-kit push.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. The test database must be provisioned before running vitest, " +
        "or set SKIP_TEST_DB_PUSH=1 to bypass schema sync entirely.",
    );
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
