#!/usr/bin/env node
// Task #2478 — Lint guard for the tenant-isolation seam.
//
// Fails when a server-side file under `server/` constructs its own
// `drizzle({ client: pool })` or imports from `drizzle-orm/node-postgres`
// without going through the shared `./db` proxy. The proxy is what
// routes queries through the AsyncLocalStorage-bound pg client whose
// `app.current_org_id` session var drives RLS — bypassing it would
// silently re-introduce cross-tenant access.
//
// Allowlist: the wrapper itself (`server/db.ts`) and the context module
// (`server/dbContext.ts`) are the only files that may import drizzle
// directly. Tests under `server/__tests__/` are exempt.
//
// Wire into CI by adding to scripts/ci.sh or running directly:
//   node scripts/check-db-imports.mjs
//
// Run the script's own self-tests:
//   node scripts/check-db-imports.mjs --self-test

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../server");

const ALLOWED = new Set([
  path.join(SERVER_DIR, "db.ts"),
  path.join(SERVER_DIR, "dbContext.ts"),
]);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip tests, generated, and node_modules-like dirs.
      if (e === "__tests__" || e === "node_modules" || e === "dist") continue;
      out.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const RE_DRIZZLE_NODE = /from\s+["']drizzle-orm\/node-postgres["']/;
const RE_NEW_POOL = /new\s+Pool\s*\(/;
const RE_DRIZZLE_CALL = /\bdrizzle\s*\(\s*\{\s*client/;

// Returns an array of issue strings for a single file's source text.
// Empty array means the file is clean.
function getFileViolations(src) {
  const issues = [];
  if (RE_DRIZZLE_NODE.test(src)) issues.push("imports from drizzle-orm/node-postgres");
  if (RE_NEW_POOL.test(src)) issues.push("constructs its own pg Pool");
  if (RE_DRIZZLE_CALL.test(src)) issues.push("calls drizzle({ client: ... }) directly");
  return issues;
}

// Task #2674 — additional check for `server/jobs/jobRunner.ts`: every `db.*`
// reference inside a per-tenant loop body must be lexically enclosed in a
// `withJobOrgContext(` (or `runAsSuperadmin(` / `withOrgContext(`) call.
// Without this, a future developer could silently re-introduce cross-tenant
// reads/writes inside the compliance-expiration job — or any other per-org
// loop — while `STRICT_TENANT_RLS=false` masks the bug.
//
// "Per-tenant loop" is detected by iterable name: any
// `for (... of ITER) { ... }` whose ITER identifier matches /^orgs?$|
// ^orgRows$|^organizations$|^activeOrgs$|^tenants$/. This covers every
// per-org loop currently in the file (orgs, orgRows) and the obvious
// future-rename targets without producing false positives on per-row
// loops that happen to carry an `organizationId` column.
// Inner book-keeping loops over the SAME iterable (e.g. `for (const u
// of orgUsers)` inside an already-wrapped block) are not matched —
// their parent loop is, and the parent's wrapper covers them.
const JOB_RUNNER = path.join(SERVER_DIR, "jobs", "jobRunner.ts");

function findMatchingBrace(src, openIdx) {
  // openIdx must point at '{'. Returns index of matching '}', or -1.
  let depth = 0;
  let i = openIdx;
  let inStr = null; // '"' | "'" | '`'
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplateExpr = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
    } else if (inBlockComment) {
      if (c === "*" && n === "/") { inBlockComment = false; i++; }
    } else if (inStr) {
      if (c === "\\") { i++; }
      else if (inStr === "`" && c === "$" && n === "{") { inTemplateExpr++; inStr = null; i++; }
      else if (c === inStr) { inStr = null; }
    } else {
      if (c === "/" && n === "/") { inLineComment = true; i++; }
      else if (c === "/" && n === "*") { inBlockComment = true; i++; }
      else if (c === '"' || c === "'" || c === "`") { inStr = c; }
      else if (c === "{") {
        if (inTemplateExpr > 0) inTemplateExpr++;
        else depth++;
      } else if (c === "}") {
        if (inTemplateExpr > 0) {
          inTemplateExpr--;
          if (inTemplateExpr === 0) { inStr = "`"; }
        } else {
          depth--;
          if (depth === 0) return i;
        }
      }
    }
    i++;
  }
  return -1;
}

// Replace comments and string literals with spaces of equal length so that
// regex offsets still line up with the original source for line-number
// reporting, but `db.` references inside comments / strings don't match.
function stripCommentsAndStrings(src) {
  const out = src.split("");
  let i = 0;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplateExpr = 0;
  const blank = (idx) => { if (out[idx] !== "\n") out[idx] = " "; };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      else blank(i);
    } else if (inBlockComment) {
      if (c === "*" && n === "/") { blank(i); blank(i + 1); inBlockComment = false; i += 2; continue; }
      else blank(i);
    } else if (inStr) {
      if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
      if (inStr === "`" && c === "$" && n === "{") {
        blank(i); blank(i + 1); inTemplateExpr++; inStr = null; i += 2; continue;
      }
      if (c === inStr) { blank(i); inStr = null; i++; continue; }
      blank(i);
    } else {
      if (c === "/" && n === "/") { blank(i); blank(i + 1); inLineComment = true; i += 2; continue; }
      if (c === "/" && n === "*") { blank(i); blank(i + 1); inBlockComment = true; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { blank(i); inStr = c; i++; continue; }
      if (inTemplateExpr > 0) {
        if (c === "{") inTemplateExpr++;
        else if (c === "}") {
          inTemplateExpr--;
          if (inTemplateExpr === 0) { blank(i); inStr = "`"; i++; continue; }
        }
      }
    }
    i++;
  }
  return out.join("");
}

// Core logic for the jobRunner per-org loop check. Accepts the raw source
// text so it can be called from both the production path and self-tests.
// Returns an array of { line } issue objects.
function checkJobRunnerSrc(rawSrc) {
  const src = stripCommentsAndStrings(rawSrc);
  const issues = [];
  const loopRe = /for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+(\w+)\s*\)\s*\{/g;
  const PER_ORG_ITERABLE = /^(orgs?|orgRows|organizations|activeOrgs|tenants)$/;
  let m;
  while ((m = loopRe.exec(src)) !== null) {
    const iterName = m[2];
    if (!PER_ORG_ITERABLE.test(iterName)) continue;
    const openIdx = m.index + m[0].length - 1; // position of '{'
    const closeIdx = findMatchingBrace(src, openIdx);
    if (closeIdx < 0) continue;
    const body = src.slice(openIdx + 1, closeIdx);

    // Find each `db.` reference and ensure it sits inside a
    // `withJobOrgContext(` (or `runAsSuperadmin(` / `withOrgContext(`)
    // call within this loop body.
    const dbRe = /\bdb\s*\./g;
    let dm;
    while ((dm = dbRe.exec(body)) !== null) {
      const dbAbsIdx = openIdx + 1 + dm.index;
      const before = src.slice(openIdx + 1, dbAbsIdx);
      const ctxRe = /\b(?:withJobOrgContext|runAsSuperadmin|withOrgContext)\s*\(/g;
      let cm;
      let enclosed = false;
      while ((cm = ctxRe.exec(before)) !== null) {
        const parenOpen = openIdx + 1 + cm.index + cm[0].length - 1;
        // Find matching ')' for this call.
        let depth = 0;
        let j = parenOpen;
        let inStr = null;
        let lineC = false;
        let blockC = false;
        while (j < src.length) {
          const c = src[j];
          const nn = src[j + 1];
          if (lineC) { if (c === "\n") lineC = false; }
          else if (blockC) { if (c === "*" && nn === "/") { blockC = false; j++; } }
          else if (inStr) {
            if (c === "\\") j++;
            else if (c === inStr) inStr = null;
          } else {
            if (c === "/" && nn === "/") { lineC = true; j++; }
            else if (c === "/" && nn === "*") { blockC = true; j++; }
            else if (c === '"' || c === "'" || c === "`") inStr = c;
            else if (c === "(") depth++;
            else if (c === ")") { depth--; if (depth === 0) break; }
          }
          j++;
        }
        if (j > dbAbsIdx) { enclosed = true; break; }
      }
      if (!enclosed) {
        const lineNo = src.slice(0, dbAbsIdx).split("\n").length;
        issues.push({ line: lineNo });
      }
    }
  }
  return issues;
}

function checkJobRunnerOrgLoops() {
  const rawSrc = readFileSync(JOB_RUNNER, "utf8");
  return checkJobRunnerSrc(rawSrc);
}

function checkRepo() {
  const jobRunnerIssues = checkJobRunnerOrgLoops();
  if (jobRunnerIssues.length > 0) {
    process.stderr.write(
      `[check-db-imports] FAIL — ${jobRunnerIssues.length} db.* reference(s) inside a per-org loop in server/jobs/jobRunner.ts are NOT wrapped in withJobOrgContext(...):\n`,
    );
    for (const i of jobRunnerIssues) {
      process.stderr.write(`  - server/jobs/jobRunner.ts:${i.line}\n`);
    }
    process.stderr.write(
      "\nWrap the per-org loop body in `withJobOrgContext(\"<job-name>\", org.organizationId, async () => { ... })`\n" +
        "so RLS scopes every query to the current tenant. See\n" +
        "docs/architecture/tenant-isolation.md.\n",
    );
    return 1;
  }

  const offenders = [];
  for (const file of walk(SERVER_DIR)) {
    if (ALLOWED.has(file)) continue;
    const src = readFileSync(file, "utf8");
    const issues = getFileViolations(src);
    if (issues.length > 0) {
      offenders.push({ file: path.relative(process.cwd(), file), issues });
    }
  }

  if (offenders.length === 0) {
    process.stdout.write(
      "[check-db-imports] OK — every server file routes through the shared db proxy.\n",
    );
    return 0;
  }

  process.stderr.write(
    `[check-db-imports] FAIL — ${offenders.length} file(s) bypass the tenant-isolation seam:\n`,
  );
  for (const o of offenders) {
    process.stderr.write(`  - ${o.file}\n`);
    for (const i of o.issues) process.stderr.write(`      • ${i}\n`);
  }
  process.stderr.write(
    "\nAll DB access must go through `import { db } from \"./db\"` so the\n" +
      "AsyncLocalStorage-bound RLS client is used. See\n" +
      "docs/architecture/tenant-isolation.md.\n",
  );
  return 1;
}

// -----------------------------------------------------------------------
// Self-tests. Run via:  node scripts/check-db-imports.mjs --self-test
// These lock the guard's behavior so future edits don't silently
// introduce regressions in the detection logic.
// -----------------------------------------------------------------------

function selfTest() {
  const fileCases = [
    {
      name: "no forbidden patterns → clean",
      src: `import { db } from "./db";\nimport { users } from "../shared/schema";\n`,
      expectViolations: 0,
    },
    {
      name: "imports from drizzle-orm/node-postgres → violation",
      src: `import { drizzle } from "drizzle-orm/node-postgres";\n`,
      expectViolations: 1,
    },
    {
      name: "constructs its own pg Pool → violation",
      src: `import { Pool } from "pg";\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\n`,
      expectViolations: 1,
    },
    {
      name: "calls drizzle({ client }) directly → violation",
      src: `const db = drizzle({ client: pool });\n`,
      expectViolations: 1,
    },
    {
      name: "all three violations in one file → 3 violations",
      src:
        `import { drizzle } from "drizzle-orm/node-postgres";\n` +
        `const pool = new Pool({});\n` +
        `const db2 = drizzle({ client: pool });\n`,
      expectViolations: 3,
    },
    {
      name: "drizzle-orm/neon-serverless (different pkg) → clean",
      src: `import { drizzle } from "drizzle-orm/neon-serverless";\n`,
      expectViolations: 0,
    },
  ];

  const jobRunnerCases = [
    {
      name: "no per-org loop → clean",
      src: `for (const item of items) { db.select(); }\n`,
      expectIssues: 0,
    },
    {
      name: "per-org loop with db inside withJobOrgContext → clean",
      src:
        `for (const org of orgs) {\n` +
        `  await withJobOrgContext("job", org.id, async () => {\n` +
        `    await db.select().from(t);\n` +
        `  });\n` +
        `}\n`,
      expectIssues: 0,
    },
    {
      name: "per-org loop with db NOT wrapped → violation",
      src:
        `for (const org of orgs) {\n` +
        `  await db.select().from(t);\n` +
        `}\n`,
      expectIssues: 1,
    },
    {
      name: "per-org loop with db inside runAsSuperadmin → clean",
      src:
        `for (const org of orgs) {\n` +
        `  await runAsSuperadmin("reason", async () => {\n` +
        `    await db.insert(t).values({});\n` +
        `  });\n` +
        `}\n`,
      expectIssues: 0,
    },
    {
      name: "tenants loop with db NOT wrapped → violation",
      src:
        `for (const t2 of tenants) {\n` +
        `  await db.update(u).set({}).where();\n` +
        `}\n`,
      expectIssues: 1,
    },
    {
      name: "db reference in comment inside per-org loop → clean",
      src:
        `for (const org of orgs) {\n` +
        `  // db.select() is intentionally avoided here\n` +
        `}\n`,
      expectIssues: 0,
    },
  ];

  let passed = 0;
  let failed = 0;

  console.log("--- file-level violation checks ---");
  for (const c of fileCases) {
    const got = getFileViolations(c.src).length;
    if (got === c.expectViolations) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.error(`  ✗ ${c.name}: expected ${c.expectViolations} violation(s), got ${got}`);
    }
  }

  console.log("--- jobRunner per-org loop checks ---");
  for (const c of jobRunnerCases) {
    const got = checkJobRunnerSrc(c.src).length;
    if (got === c.expectIssues) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.error(`  ✗ ${c.name}: expected ${c.expectIssues} issue(s), got ${got}`);
    }
  }

  console.log(`\n[self-test] ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}
process.exit(checkRepo());
