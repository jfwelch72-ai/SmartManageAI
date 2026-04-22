#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.resolve(REPO_ROOT, "shared/schema");
const DRIZZLE_CONFIG = path.resolve(REPO_ROOT, "drizzle.config.ts");
const META_TABLE = "_dev_schema_meta";

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

function runDrizzlePush(): { ok: boolean; output: string } {
  // `drizzle-kit push --force` introspects the live DB and applies an
  // additive diff. It's slow on a ~470-table schema (1-3 min) but it's
  // safe to run against a populated dev DB. We only fall here on an
  // actual schema-hash miss, which is the rare path.
  const result = spawnSync(
    "npx",
    ["drizzle-kit", "push", "--force", `--config=${DRIZZLE_CONFIG}`],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
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

  const start = Date.now();
  const { ok, output } = runDrizzlePush();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  try {
    if (ok) {
      log(`drizzle-kit push completed in ${elapsed}s.`);
      await writeAppliedHash(client, expectedHash);
      log(`Stamped applied schema hash ${expectedHash.slice(0, 12)}.`);
    } else {
      log(`drizzle-kit push failed or timed out after ${elapsed}s. Output:`);
      if (output) console.log(output);
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
