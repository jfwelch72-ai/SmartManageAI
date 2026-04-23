/**
 * Task #1345 — Lock down which server files are allowed to write to
 * `prevailingWageRates` or `projects.wageDecision`. The two allow-listed
 * files (`server/laborRateRoutes.ts` for prevailing wage rate rows and
 * `server/projectCrudRoutes.ts` for project-level wage decisions) are
 * already wired to call `queueWageDecisionSync` (verified by the
 * #1312 / #1331 auto-sync test suites). If a new code path starts
 * inserting/updating those columns without going through one of those
 * routes, this test fails so the author either:
 *   1. Adds `queueWageDecisionSync` to the new path themselves, AND
 *   2. Updates the allow-list below alongside a dedicated auto-sync test.
 *
 * The audit performed for #1345 found no other writers today, so the
 * allow-list is intentionally tight.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep as pathSep } from "node:path";

const SERVER_DIR = join(process.cwd(), "server");

// Files that legitimately mutate prevailing-wage / project-wage-decision
// state and have already been wired to call queueWageDecisionSync. Paths
// are relative to the server tree (forward slashes) so that a future file
// dropped in a subdirectory with a colliding basename can't accidentally
// inherit the allow-list. Keep these paths in sync with the actual
// implementations.
//
// NOTE: this guard is intentionally heuristic — it greps for Drizzle
// `.insert(prevailingWageRates)` / `.update(prevailingWageRates)` and
// `.insert(projects)` / `.update(projects)` shapes. Raw SQL writers
// (`db.execute(sql\`INSERT INTO prevailing_wage_rates ...\`)` etc.) are
// out of scope and must be reviewed by hand if anyone ever introduces
// one; in that case, add the writer here AND wire `queueWageDecisionSync`
// into the new path.
const PREVAILING_WAGE_RATE_WRITERS = new Set<string>([
  "laborRateRoutes.ts",
]);

const PROJECT_WAGE_DECISION_WRITERS = new Set<string>([
  "projectCrudRoutes.ts",
]);

// File names (relative to the server tree) that are out of scope: tests
// freely insert seed rows for assertions and the shared schema obviously
// names the columns. Anything else triggers the guard.
const IGNORED_DIR_SEGMENTS = ["__tests__", "node_modules"];

function listServerSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (IGNORED_DIR_SEGMENTS.includes(entry)) continue;
      out.push(...listServerSourceFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

describe("Task #1345 — wage decision write-path coverage", () => {
  const files = listServerSourceFiles(SERVER_DIR);

  it("only allow-listed files write to prevailingWageRates", () => {
    // Matches `db.insert(prevailingWageRates)` / `tx.insert(prevailingWageRates)`
    // and the equivalent `.update(prevailingWageRates)` regardless of the
    // db handle name. Drizzle is the only ORM in use, so these two call
    // shapes cover every write path.
    const writePattern = /\.(insert|update)\s*\(\s*prevailingWageRates\b/;
    const offenders: string[] = [];

    for (const file of files) {
      const src = readSource(file);
      if (!writePattern.test(src)) continue;
      const rel = relative(SERVER_DIR, file).split(pathSep).join("/");
      if (PREVAILING_WAGE_RATE_WRITERS.has(rel)) continue;
      offenders.push(relative(process.cwd(), file));
    }

    expect(
      offenders,
      `New write paths to prevailingWageRates were detected. Each new path ` +
        `must call queueWageDecisionSync (see server/laborRateRoutes.ts for ` +
        `the reference implementation) and be added to the allow-list in ` +
        `this test alongside a dedicated auto-sync regression test:\n` +
        offenders.map((p) => `  - ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("only allow-listed files write projects.wageDecision", () => {
    // A file is only suspicious if it actually mutates the `projects`
    // table (drizzle insert/update) AND mentions `wageDecision:` as an
    // object key (the shape every existing setter uses, see
    // projectCrudRoutes.ts). Files that merely SELECT the column or
    // build output objects with `wageDecision:` are intentionally
    // excluded — those don't write the database.
    const projectMutationPattern = /\.(insert|update)\s*\(\s*projects\b/;
    const wageKeyPattern = /\bwageDecision\s*:/;
    const offenders: string[] = [];

    for (const file of files) {
      const src = readSource(file);
      if (!projectMutationPattern.test(src)) continue;
      if (!wageKeyPattern.test(src)) continue;
      const rel = relative(SERVER_DIR, file).split(pathSep).join("/");
      if (PROJECT_WAGE_DECISION_WRITERS.has(rel)) continue;
      offenders.push(relative(process.cwd(), file));
    }

    expect(
      offenders,
      `New write paths to projects.wageDecision were detected. Each new ` +
        `path must call queueWageDecisionSync (see ` +
        `server/projectCrudRoutes.ts for the reference implementation) ` +
        `and be added to the allow-list in this test alongside a ` +
        `dedicated auto-sync regression test:\n` +
        offenders.map((p) => `  - ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("allow-listed prevailingWageRates writers actually call queueWageDecisionSync", () => {
    // Belt-and-suspenders: if someone strips the sync call out of a
    // file that was previously wired up, fail loudly here. The dedicated
    // route-level auto-sync tests (#1312 / #1331) cover behaviour, but
    // this catches the regression at the source-grep level too.
    const missing: string[] = [];
    for (const name of PREVAILING_WAGE_RATE_WRITERS) {
      const src = readSource(join(SERVER_DIR, name));
      if (!/queueWageDecisionSync\b/.test(src)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("allow-listed project wageDecision writers actually call queueWageDecisionSync", () => {
    const missing: string[] = [];
    for (const name of PROJECT_WAGE_DECISION_WRITERS) {
      const src = readSource(join(SERVER_DIR, name));
      if (!/queueWageDecisionSync\b/.test(src)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });
});
