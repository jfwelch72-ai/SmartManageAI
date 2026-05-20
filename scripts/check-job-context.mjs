#!/usr/bin/env node
// Task #2673 — Lint guard for background-job tenant context.
//
// Every file under `server/jobs/` and `server/jobQueue/handlers/` (or
// `server/jobQueue/exports/`) that touches the database MUST also drop
// into a tenant context (`withJobOrgContext`, `withOrgContext`,
// `withSystemJobContext`, or the audited `runAsSuperadmin`). Otherwise
// the queries run against whatever connect-default the pool client has
// — which under `STRICT_TENANT_RLS=true` returns zero rows and silently
// breaks the job.
//
// Allowlist:
//   - `server/jobs/jobRunner.ts` already wraps every cron tick via
//     `withSchedulerLock` (which itself wraps in `withSystemJobContext`)
//     and per-org loops via `withJobOrgContext`, so it satisfies the
//     contract at a coarser layer.
//   - `server/jobQueue/index.ts` wraps every handler invocation in
//     `withOrgContext` when the job carries an organizationId.
//   - Test files under any `__tests__/` folder.
//
// Wire into CI via scripts/ci.sh. Run directly:
//   node scripts/check-job-context.mjs
//
// Run the script's own self-tests:
//   node scripts/check-job-context.mjs --self-test

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../server");

const SCAN_DIRS = [
  path.join(SERVER_DIR, "jobs"),
  path.join(SERVER_DIR, "jobQueue", "handlers"),
  path.join(SERVER_DIR, "jobQueue", "exports"),
];

// Files allowlisted because their tenant context is established by a
// structural chokepoint — there is no callsite-level option. This
// allowlist is purely structural; deferred-TODO entries are not
// permitted. Adding a new entry requires a tenant-isolation review and
// a comment naming the chokepoint that establishes context.
//
// What is NOT allowlisted (and why it stays that way):
//   - server/jobs/jobRunner.ts: passes naturally because every cron
//     callback in the file uses `withJobOrgContext` (per-org) or
//     `withSystemJobContext` (cross-tenant) at the callsite.
//   - server/jobs/{certifiedPayrollPurge,dotPayItemsRefresh,
//     orgHardDeleteSweep,planDocumentMarkupSoftDeletePurge,
//     projectLogEmailScheduleAttemptPrune}.ts: each main exported
//     function wraps its body in `withSystemJobContext("<name>", …)`
//     (audited via `runAsSuperadmin`).
const ALLOWED = new Set([
  // pg-boss queue runtime. Lines ~285 wrap every handler invocation
  // in `withOrgContext({ organizationId, source: "job:<name>",
  // isSuperadmin: false }, async () => def.handler(payload, ctx))`
  // whenever the enqueued job carries an organizationId. This file is
  // the wrapper — exempting it from the wrapper-presence check is
  // necessary, not optional.
  path.join(SERVER_DIR, "jobQueue", "index.ts"),
  // Barrel re-export of jobs/jobRunner.ts. No DB calls of its own.
  path.join(SERVER_DIR, "jobs", "index.ts"),
  // Queue handlers / exports below are dispatched EXCLUSIVELY through
  // the jobQueue runtime above and ALWAYS receive a payload with
  // `organizationId` (enforced by the enqueue path in
  // `server/jobQueue/index.ts` — every `enqueueJob` callsite passes
  // `organizationId`). The wrap therefore happens on every invocation
  // at the runtime layer; adding a redundant inner wrap would just
  // double-checkout a pool client. If you add a NEW queue handler,
  // you must EITHER keep this invariant (handler invoked only via
  // jobQueue runtime with an orgId payload) and add it here, OR
  // wrap explicitly inside the handler body and skip this allowlist.
  path.join(SERVER_DIR, "jobQueue", "handlers", "aiDocument.ts"),
  path.join(SERVER_DIR, "jobQueue", "handlers", "planSetIngest.ts"),
  path.join(SERVER_DIR, "jobQueue", "handlers", "tileRendererStub.ts"),
  // Task #2760 — Real tile renderer. Dispatched exclusively through the
  // jobQueue runtime above, which always wraps with withOrgContext when the
  // job carries an organizationId (the pdf_tile_prerender enqueue paths pass
  // organizationId). No inner wrap needed.
  path.join(SERVER_DIR, "jobQueue", "handlers", "tileRendererReal.ts"),
  path.join(SERVER_DIR, "jobQueue", "exports", "auditExport.ts"),
  path.join(SERVER_DIR, "jobQueue", "exports", "changeOrderBulkPdf.ts"),
  path.join(SERVER_DIR, "jobQueue", "exports", "payrollAcknowledgement.ts"),
]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (e === "__tests__" || e === "node_modules" || e === "dist") continue;
      out.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const RE_DB_IMPORT = /import\s+\{[^}]*\bdb\b[^}]*\}\s+from\s+["']\.\.?\/(\.\.\/)*db["']/;
const RE_DB_USE = /\bdb\.(select|insert|update|delete|execute|transaction|query|with)\b/;
const RE_CONTEXT = /\b(withJobOrgContext|withOrgContext|withSystemJobContext|runAsSuperadmin)\b/;

// Returns true if the file's source requires a context wrapper (has DB
// access) but doesn't have one — i.e. it is an offender.
function isJobFileOffender(src) {
  if (!RE_DB_IMPORT.test(src) && !RE_DB_USE.test(src)) return false;
  if (RE_CONTEXT.test(src)) return false;
  return true;
}

// -----------------------------------------------------------------------
// Self-tests. Run via:  node scripts/check-job-context.mjs --self-test
// These lock the guard's behavior so future edits don't silently
// introduce regressions in the detection logic.
// -----------------------------------------------------------------------

function selfTest() {
  const cases = [
    {
      name: "no DB import or usage → clean (not an offender)",
      src: `export async function run() { console.log("noop"); }\n`,
      expectOffender: false,
    },
    {
      name: "db import present, no db.* usage → flagged (import alone triggers the check)",
      src: `import { db } from "../../db";\nexport async function run() { return; }\n`,
      expectOffender: true,
    },
    {
      name: "db.select used, no context wrapper → offender",
      src:
        `import { db } from "../db";\n` +
        `export async function run() {\n` +
        `  const rows = await db.select().from(users);\n` +
        `}\n`,
      expectOffender: true,
    },
    {
      name: "db.insert used, no context wrapper → offender",
      src:
        `export async function run() {\n` +
        `  await db.insert(events).values({ type: "x" });\n` +
        `}\n`,
      expectOffender: true,
    },
    {
      name: "db.select used with withJobOrgContext → clean",
      src:
        `import { db } from "../db";\n` +
        `import { withJobOrgContext } from "../dbContext";\n` +
        `export async function run(orgId) {\n` +
        `  await withJobOrgContext("job", orgId, async () => {\n` +
        `    await db.select().from(users);\n` +
        `  });\n` +
        `}\n`,
      expectOffender: false,
    },
    {
      name: "db.update used with withSystemJobContext → clean",
      src:
        `import { db } from "../db";\n` +
        `export async function run() {\n` +
        `  await withSystemJobContext("purge-job", async () => {\n` +
        `    await db.update(tbl).set({ deleted: true });\n` +
        `  });\n` +
        `}\n`,
      expectOffender: false,
    },
    {
      name: "db.delete used with runAsSuperadmin → clean",
      src:
        `export async function run() {\n` +
        `  await runAsSuperadmin("hard-delete", async () => {\n` +
        `    await db.delete(rows).where(eq(rows.id, id));\n` +
        `  });\n` +
        `}\n`,
      expectOffender: false,
    },
    {
      name: "db.execute used with withOrgContext → clean",
      src:
        `import { db } from "../../db";\n` +
        `export async function handle(payload) {\n` +
        `  await withOrgContext({ organizationId: payload.orgId }, async () => {\n` +
        `    await db.execute(sql);\n` +
        `  });\n` +
        `}\n`,
      expectOffender: false,
    },
    {
      name: "db.transaction used, no wrapper → offender",
      src:
        `import { db } from "../db";\n` +
        `await db.transaction(async (tx) => { tx.insert(t).values({}); });\n`,
      expectOffender: true,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const got = isJobFileOffender(c.src);
    if (got === c.expectOffender) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.error(
        `  ✗ ${c.name}: expected isOffender=${c.expectOffender}, got ${got}`,
      );
    }
  }

  console.log(`\n[self-test] ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

const offenders = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    if (ALLOWED.has(file)) continue;
    const src = readFileSync(file, "utf8");
    if (!isJobFileOffender(src)) continue;
    offenders.push(path.relative(process.cwd(), file));
  }
}

if (offenders.length === 0) {
  process.stdout.write(
    "[check-job-context] OK — every background-job file routes DB access through a tenant context.\n",
  );
  process.exit(0);
}

process.stderr.write(
  `[check-job-context] FAIL — ${offenders.length} background-job file(s) touch the database without a tenant context wrapper:\n`,
);
for (const f of offenders) {
  process.stderr.write(`  - ${f}\n`);
}
process.stderr.write(
  "\nWrap per-org work in `withJobOrgContext(\"<job-name>\", orgId, async () => { ... })`,\n" +
    "global sweeps in `withSystemJobContext(\"<job-name>\", async () => { ... })`,\n" +
    "and audited platform-admin reads in `runAsSuperadmin(\"<reason>\", ...)`.\n" +
    "See docs/architecture/tenant-isolation.md.\n",
);
process.exit(1);
