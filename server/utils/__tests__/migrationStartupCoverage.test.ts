import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import {
  migrationStartupCoverage,
  type MigrationCoverageEntry,
} from "../migrationStartupCoverage";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "migrations");
const RUN_STARTUP = path.join(REPO_ROOT, "server/utils/runStartupMigrations.ts");

function listSqlFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

function isHelper(
  entry: MigrationCoverageEntry,
): entry is { helper: string; note?: string } {
  return "helper" in entry;
}

describe("migration startup coverage manifest", () => {
  const sqlFiles = listSqlFiles();
  const manifestKeys = Object.keys(migrationStartupCoverage);
  const runStartupSrc = readFileSync(RUN_STARTUP, "utf8");

  it("has an entry for every SQL file in migrations/", () => {
    const missing = sqlFiles.filter((f) => !(f in migrationStartupCoverage));
    expect(
      missing,
      `Found ${missing.length} migration SQL file(s) without a coverage entry. ` +
        `Add each one to server/utils/migrationStartupCoverage.ts with either ` +
        `{ helper: "ensureXxx" } (preferred — also register the helper in ` +
        `runStartupMigrations.ts) or { skip: "<reason>" }. See the header ` +
        `comment in migrationStartupCoverage.ts for guidance.\n\nMissing: ` +
        missing.join(", "),
    ).toEqual([]);
  });

  it("has no stale entries pointing at deleted SQL files", () => {
    const sqlSet = new Set(sqlFiles);
    const stale = manifestKeys.filter((k) => !sqlSet.has(k));
    expect(
      stale,
      `Found ${stale.length} coverage entr${stale.length === 1 ? "y" : "ies"} ` +
        `for SQL files that no longer exist under migrations/. Remove them ` +
        `from server/utils/migrationStartupCoverage.ts.\n\nStale: ` +
        stale.join(", "),
    ).toEqual([]);
  });

  it("has either a helper or a skip reason on every entry", () => {
    const malformed: string[] = [];
    for (const [file, entry] of Object.entries(migrationStartupCoverage)) {
      const hasHelper = "helper" in entry && typeof entry.helper === "string" && entry.helper.length > 0;
      const hasSkip = "skip" in entry && typeof (entry as { skip: string }).skip === "string" && (entry as { skip: string }).skip.length > 0;
      if (hasHelper === hasSkip) {
        // either both present (XOR violation) or neither present
        malformed.push(file);
      }
    }
    expect(
      malformed,
      `Coverage entries must have exactly one of { helper } or { skip } (with a non-empty value). ` +
        `Malformed: ${malformed.join(", ")}`,
    ).toEqual([]);
  });

  it("references only helpers that are imported AND registered in the migrations array of runStartupMigrations.ts", () => {
    const notImported: Array<{ file: string; helper: string }> = [];
    const notRegistered: Array<{ file: string; helper: string }> = [];

    for (const [file, entry] of Object.entries(migrationStartupCoverage)) {
      if (!isHelper(entry)) continue;

      // (1) Helper must be imported. Catches typos in the manifest.
      const importRe = new RegExp(
        `^import\\s*\\{[^}]*\\b${entry.helper}\\b[^}]*\\}`,
        "m",
      );
      if (!importRe.test(runStartupSrc)) {
        notImported.push({ file, helper: entry.helper });
        continue;
      }

      // (2) Helper must actually be wired into the `migrations` array as
      // `fn: <helper>`. This is the core check for Task #1127 — an import
      // alone does NOT cause the helper to run on startup; a fresh dev DB
      // would still go missing the column/table. Match `fn: ensureXxx`
      // (with optional whitespace) appearing as a `MigrationStep` entry.
      const registeredRe = new RegExp(`\\bfn\\s*:\\s*${entry.helper}\\b`);
      if (!registeredRe.test(runStartupSrc)) {
        notRegistered.push({ file, helper: entry.helper });
      }
    }

    expect(
      notImported,
      `Coverage manifest references helper(s) that are NOT imported in ` +
        `server/utils/runStartupMigrations.ts. Either import & register the ` +
        `helper, or correct the manifest entry.\n\n` +
        notImported.map((o) => `  ${o.file} -> ${o.helper}`).join("\n"),
    ).toEqual([]);

    expect(
      notRegistered,
      `Coverage manifest references helper(s) that are imported but NOT ` +
        `registered in the \`migrations\` array of runStartupMigrations.ts. ` +
        `Importing the helper is not enough — it must appear as ` +
        `\`{ name: "...", category: "...", fn: <helper> }\` in the ` +
        `migrations array so it actually runs on startup. This is the exact ` +
        `regression class Task #1127 protects against.\n\n` +
        notRegistered.map((o) => `  ${o.file} -> ${o.helper}`).join("\n"),
    ).toEqual([]);
  });
});
