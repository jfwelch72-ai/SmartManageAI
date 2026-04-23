import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { drizzleTableStartupCoverage } from "../drizzleTableStartupCoverage";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "migrations");
const UTILS_DIR = path.join(REPO_ROOT, "server/utils");
const RUN_STARTUP = path.join(UTILS_DIR, "runStartupMigrations.ts");

const CREATE_TABLE_RE =
  /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"public"\.)?"?([a-z_][a-z_0-9]*)"?/gi;

function collectDrizzleTableNames(): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      try {
        const name = getTableConfig(value).name;
        if (name) out.add(name);
      } catch {
        // ignore
      }
    }
  }
  return out;
}

/**
 * Tables created by an `ensure*` helper that is **registered** in
 * `runStartupMigrations.ts`'s `migrations` array (i.e. has a matching
 * `fn: <helperName>` entry). Importing the helper isn't enough — it must
 * actually run at boot. This is the ONLY coverage source the guard
 * accepts for newly-added Drizzle tables.
 */
function collectStartupHelperCoveredTables(): Set<string> {
  const covered = new Set<string>();
  const runSrc = readFileSync(RUN_STARTUP, "utf8");

  const registered = new Set<string>();
  for (const m of runSrc.matchAll(/\bfn\s*:\s*(\w+)/g)) registered.add(m[1]);

  const helperToRelPath = new Map<string, string>();
  const importRe = /^import\s*\{\s*([^}]+)\s*\}\s*from\s*"(\.[^"]+)"/gm;
  for (const m of runSrc.matchAll(importRe)) {
    const rel = m[2];
    for (const name of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      helperToRelPath.set(name, rel);
    }
  }

  for (const helper of registered) {
    const rel = helperToRelPath.get(helper);
    if (!rel) continue;
    const full = path.join(UTILS_DIR, rel + ".ts");
    let src: string;
    try {
      src = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(CREATE_TABLE_RE)) covered.add(m[1]);
  }

  return covered;
}

/**
 * Tables created by a static `migrations/*.sql` `CREATE TABLE` — applied
 * at deploy time by `npx drizzle-kit migrate`, **not** at boot by
 * `runStartupMigrations`. This is recorded only so the "redundant skip
 * entry" check can distinguish grandfathered baseline entries from
 * truly-dead ones; it is NOT accepted as coverage for the main guard.
 */
function collectSqlMigrationCreatedTables(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) continue;
    const src = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const m of src.matchAll(CREATE_TABLE_RE)) out.add(m[1]);
  }
  return out;
}

describe("drizzle table startup coverage", () => {
  const drizzleTables = collectDrizzleTableNames();
  const helperCovered = collectStartupHelperCoveredTables();
  const sqlCovered = collectSqlMigrationCreatedTables();
  const manifest = drizzleTableStartupCoverage;

  it("loaded a non-trivial schema", () => {
    // Sanity check — guards against an import regression that would
    // otherwise let the next test pass with an empty Drizzle set.
    expect(drizzleTables.size).toBeGreaterThan(100);
  });

  it("every Drizzle table is created at boot by a registered ensure* helper OR explicitly grandfathered in the skip manifest", () => {
    // Per Task #1145: the *only* acceptable coverage source for a newly-
    // added Drizzle table is a registered startup helper. SQL migrations
    // are deploy-time, not boot-time, and so do not satisfy this guard
    // for new tables — they belong in the grandfathered skip manifest.
    const missing: string[] = [];
    for (const name of drizzleTables) {
      if (helperCovered.has(name)) continue;
      if (name in manifest) continue;
      missing.push(name);
    }
    missing.sort();
    expect(
      missing,
      `Found ${missing.length} Drizzle table(s) in shared/schema/*.ts that ` +
        `have NO registered boot-time ensure* helper in ` +
        `server/utils/runStartupMigrations.ts. A freshly-pulled dev DB (and ` +
        `any fresh production deploy without manual \`drizzle-kit push\`) ` +
        `will silently 500 on these.\n\n` +
        `To fix each missing table:\n` +
        `  1. Write \`server/utils/ensure<Table>Table.ts\` whose body runs\n` +
        `       CREATE TABLE IF NOT EXISTS "<table>" (...)\n` +
        `  2. Import it in server/utils/runStartupMigrations.ts\n` +
        `  3. Register it in the \`migrations\` array as\n` +
        `       { name: "<table>", category: "CREATE_TABLE", fn: ensure<Table>Table }\n\n` +
        `See server/utils/drizzleTableStartupCoverage.ts for the full ` +
        `playbook. DO NOT silence this by adding the table to the skip ` +
        `manifest — that's reserved for pre-Task-#1145 baseline tables only.\n\n` +
        `Missing tables:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every coverage-manifest entry has a non-empty skip reason", () => {
    const malformed: string[] = [];
    for (const [name, entry] of Object.entries(manifest)) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as { skip?: unknown }).skip !== "string" ||
        ((entry as { skip: string }).skip ?? "").trim().length === 0
      ) {
        malformed.push(name);
      }
    }
    expect(
      malformed,
      `Coverage manifest entries must be \`{ skip: "<reason>" }\` with a ` +
        `non-empty reason. Malformed: ${malformed.join(", ")}`,
    ).toEqual([]);
  });

  it("has no stale manifest entries for tables that no longer exist in the Drizzle schema", () => {
    const stale = Object.keys(manifest).filter((t) => !drizzleTables.has(t));
    stale.sort();
    expect(
      stale,
      `Found ${stale.length} coverage manifest entr${stale.length === 1 ? "y" : "ies"} ` +
        `for table(s) that no longer exist in shared/schema/*.ts. Remove them ` +
        `from server/utils/drizzleTableStartupCoverage.ts.\n\nStale: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("does not list any helper-covered tables in the skip manifest (would mask future drift)", () => {
    // If a table is created by a registered ensure helper AND also listed
    // in the skip manifest, the manifest entry is dead weight. Worse, it
    // would silently keep "covering" the table even if the helper got
    // dropped — defeating the guard. Force the manifest to stay minimal.
    //
    // SQL-migration-created tables are intentionally NOT flagged here:
    // they're the grandfathered population the manifest exists to record.
    void sqlCovered; // referenced for documentation; intentional no-op.
    const redundant = Object.keys(manifest).filter((t) => helperCovered.has(t));
    redundant.sort();
    expect(
      redundant,
      `These tables are created by a registered boot-time ensure* helper ` +
        `AND also listed in the skip manifest. Drop the manifest entry — ` +
        `the helper is sufficient and the manifest entry would mask future ` +
        `drift.\n\nRedundant: ${redundant.join(", ")}`,
    ).toEqual([]);
  });
});
