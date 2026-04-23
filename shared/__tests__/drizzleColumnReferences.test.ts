import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { is, Table, getTableColumns } from "drizzle-orm";
import * as schema from "@shared/schema";

/**
 * Task #1210 — Catch invalid Drizzle column references before they ship.
 *
 * Drizzle's column accessors return `any`, so a typo like
 * `projects.organizationId` (when the real column is `gcOrganizationId`)
 * compiles cleanly and only blows up at runtime with a Postgres syntax
 * error when the affected route is hit.
 *
 * This test scans server source files for `<table>.<prop>` references
 * where `<table>` is a Drizzle table imported from `@shared/schema`
 * (including aliased imports) and asserts that `<prop>` is either a
 * real column on that table or one of a small set of well-known
 * non-column Drizzle properties.
 *
 * Pre-existing violations are tracked in
 * `shared/__tests__/drizzleColumnReferences.baseline.json`. The test
 * fails when:
 *   - a new violation is introduced (entry not in the baseline), or
 *   - a baseline entry no longer matches any code (so the allowlist
 *     stays honest as bugs get fixed).
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SERVER_DIR = join(REPO_ROOT, "server");
const BASELINE_PATH = join(__dirname, "drizzleColumnReferences.baseline.json");

// Properties exposed on Drizzle table objects that are not user columns
// but are legitimately accessed in code/types.
const ALLOWED_NON_COLUMN_PROPS = new Set([
  "_",
  "$inferSelect",
  "$inferInsert",
  "getSQL",
  "getName",
  "enableRLS",
  "extraConfigBuilder",
]);

// Build map: exported name -> Set<columnKey>
const tableColumnsByExportName = new Map<string, Set<string>>();
for (const [exportName, val] of Object.entries(schema as Record<string, unknown>)) {
  if (val && typeof val === "object" && is(val as object, Table)) {
    const cols = Object.keys(getTableColumns(val as never));
    tableColumnsByExportName.set(exportName, new Set(cols));
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === "dist") continue;
      walk(full, out);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

// Strip line and block comments so we don't false-positive on commented code.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Parse `import { a, b as c } from "@shared/schema..."` (and the
// relative `../shared/schema` variant) into a map: localName -> exportName.
function parseSchemaImports(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const importRe =
    /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*['"]((?:@shared\/schema|(?:\.{1,2}\/)+shared\/schema)(?:\/[^'"]*)?)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) !== null) {
    const specifiers = m[1].split(",");
    for (const raw of specifiers) {
      const spec = raw.trim().replace(/^type\s+/, "");
      if (!spec) continue;
      const asMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        map.set(asMatch[2], asMatch[1]);
      } else if (/^\w+$/.test(spec)) {
        map.set(spec, spec);
      }
    }
  }
  return map;
}

interface BadRef {
  file: string; // relative to repo root, posix-style
  line: number;
  table: string;
  prop: string;
}

function findBadReferences(file: string, src: string): BadRef[] {
  const cleaned = stripComments(src);
  const importMap = parseSchemaImports(cleaned);
  if (importMap.size === 0) return [];

  const bad: BadRef[] = [];
  const lines = cleaned.split("\n");

  for (const [local, exportName] of importMap) {
    const cols = tableColumnsByExportName.get(exportName);
    if (!cols) continue; // not a Drizzle pgTable export

    const refRe = new RegExp(`(?<![\\w$.])${local}\\.([A-Za-z_$][\\w$]*)`, "g");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*import\b/.test(line)) continue;
      let mm: RegExpExecArray | null;
      while ((mm = refRe.exec(line)) !== null) {
        const prop = mm[1];
        if (cols.has(prop)) continue;
        if (ALLOWED_NON_COLUMN_PROPS.has(prop)) continue;
        bad.push({
          file: relative(REPO_ROOT, file).split("\\").join("/"),
          line: i + 1,
          table: exportName,
          prop,
        });
      }
    }
  }
  return bad;
}

interface BaselineEntry {
  table: string;
  prop: string;
  file: string;
}

function loadBaseline(): BaselineEntry[] {
  const raw = readFileSync(BASELINE_PATH, "utf8");
  return JSON.parse(raw) as BaselineEntry[];
}

function baselineKey(e: { table: string; prop: string; file: string }): string {
  return `${e.table}.${e.prop}@${e.file}`;
}

describe("Drizzle column references in server/", () => {
  it("introspects at least one table from @shared/schema", () => {
    expect(tableColumnsByExportName.size).toBeGreaterThan(0);
    expect(tableColumnsByExportName.get("projects")?.has("gcOrganizationId")).toBe(true);
  });

  it("references only real columns (or known pre-existing exceptions)", () => {
    const files = walk(SERVER_DIR);
    const found: BadRef[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      found.push(...findBadReferences(file, src));
    }

    // Collapse to a set of unique (table, prop, file) triples — line numbers
    // are intentionally excluded so trivial reformatting doesn't churn the
    // baseline.
    const foundTriples = new Map<string, BadRef>();
    for (const r of found) {
      const key = baselineKey(r);
      if (!foundTriples.has(key)) foundTriples.set(key, r);
    }

    // Optional dev affordance: write the current set as the baseline.
    if (process.env.UPDATE_DRIZZLE_COLUMN_BASELINE === "1") {
      const sorted = [...foundTriples.values()]
        .map(({ table, prop, file }) => ({ table, prop, file }))
        .sort((a, b) =>
          a.file.localeCompare(b.file) ||
          a.table.localeCompare(b.table) ||
          a.prop.localeCompare(b.prop),
        );
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
    }

    const baseline = loadBaseline();
    const baselineKeys = new Set(baseline.map(baselineKey));
    const foundKeys = new Set(foundTriples.keys());

    const newViolations = [...foundTriples.values()].filter(
      (r) => !baselineKeys.has(baselineKey(r)),
    );
    const stale = baseline.filter((b) => !foundKeys.has(baselineKey(b)));

    if (newViolations.length === 0 && stale.length === 0) return;

    const lines: string[] = [];
    if (newViolations.length > 0) {
      lines.push(
        "New Drizzle column reference(s) point at columns that do not exist on the imported table:",
      );
      for (const v of newViolations) {
        lines.push(`  - ${v.table}.${v.prop}  at  ${v.file}:${v.line}`);
      }
      lines.push(
        "Fix the typo (or rename the column) so the reference matches the schema in shared/schema/.",
      );
    }
    if (stale.length > 0) {
      lines.push(
        "Pre-existing Drizzle column reference(s) recorded in the baseline are no longer present:",
      );
      for (const s of stale) {
        lines.push(`  - ${s.table}.${s.prop}  in  ${s.file}`);
      }
      lines.push(
        "Re-record the baseline with `UPDATE_DRIZZLE_COLUMN_BASELINE=1 npm test -- shared/__tests__/drizzleColumnReferences.test.ts`.",
      );
    }
    throw new Error(lines.join("\n"));
  });
});
