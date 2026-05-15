#!/usr/bin/env node
// Task #2874 — Lint guard for SSE tenant isolation.
//
// The org-context middleware intentionally skips automatic RLS context setup
// for Server-Sent Events routes to avoid pinning pg pool clients for the
// lifetime of the stream (see SSE_BYPASS_PATHS in
// server/middleware/orgContext.ts). This means every SSE handler must either:
//
//   (a) Call `withOrgContext` within the same file (per-query wrapping for
//       any DB access that happens during the stream), OR
//   (b) Carry a `// sse-org-context: <reason>` annotation explaining why the
//       bypass is intentional and safe (e.g. pure in-memory fan-out with
//       no per-tenant DB queries in the handler body).
//
// The annotation may appear anywhere in the file (top-of-file covers the
// whole file; inline covers only the specific handler). Either form passes
// the guard. The annotation text after the colon becomes the auditable
// justification visible in code review.
//
// Wire into CI by adding to scripts/ci.sh or running directly:
//   node scripts/check-sse-org-context.mjs
//
// Run the script's own self-tests:
//   node scripts/check-sse-org-context.mjs --self-test

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../server");

// Patterns that indicate a file registers an SSE route.
const RE_SSE_CONTENT_TYPE = /['"]Content-Type['"]\s*[:]\s*['"]text\/event-stream['"]/;
const RE_SSE_SETHEADER = /setHeader\s*\(\s*['"]Content-Type['"]\s*,\s*['"]text\/event-stream['"]/;
const RE_SSE_WRITEHEAD = /writeHead\s*\([^)]*text\/event-stream/;

// Pattern for an approved bypass annotation. The reason after the colon is
// mandatory so reviewers have an auditable justification.
const RE_ANNOTATION = /\/\/\s*sse-org-context\s*:/;

// Pattern for the withOrgContext wrapper (import OR call).
const RE_WITH_ORG_CONTEXT = /\bwithOrgContext\b/;

function isSseFile(src) {
  return (
    RE_SSE_CONTENT_TYPE.test(src) ||
    RE_SSE_SETHEADER.test(src) ||
    RE_SSE_WRITEHEAD.test(src)
  );
}

function isCompliant(src) {
  return RE_WITH_ORG_CONTEXT.test(src) || RE_ANNOTATION.test(src);
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (e === "__tests__" || e === "node_modules" || e === "dist") continue;
      out.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function checkRepo() {
  const offenders = [];

  for (const file of walk(SERVER_DIR)) {
    const src = readFileSync(file, "utf8");
    if (!isSseFile(src)) continue;
    if (isCompliant(src)) continue;
    offenders.push(path.relative(process.cwd(), file));
  }

  if (offenders.length === 0) {
    process.stdout.write(
      "[check-sse-org-context] OK — every SSE route file either uses withOrgContext or carries an approved annotation.\n",
    );
    return 0;
  }

  process.stderr.write(
    `[check-sse-org-context] FAIL — ${offenders.length} SSE route file(s) lack tenant-isolation coverage:\n`,
  );
  for (const f of offenders) {
    process.stderr.write(`  - ${f}\n`);
  }
  process.stderr.write(
    `
Each file that emits text/event-stream must EITHER:
  (a) import and call \`withOrgContext\` for any per-query DB access, OR
  (b) carry a top-of-file or inline annotation:
        // sse-org-context: <reason why no per-tenant DB access is needed>

The annotation is the deliberate, reviewable acknowledgement. Reviewers must
inspect every new annotation in PR.

See docs/architecture/tenant-isolation.md — "SSE bypass and tenant isolation".
`,
  );
  return 1;
}

// -----------------------------------------------------------------------
// Self-tests. Run via:  node scripts/check-sse-org-context.mjs --self-test
// These lock the guard's behavior so future edits don't silently
// introduce regressions in the regression-prevention guard itself.
// -----------------------------------------------------------------------

function selfTest() {
  const cases = [
    {
      name: "no SSE content-type → clean (non-SSE file is ignored)",
      src: `import express from "express";\nrouter.get("/data", (req, res) => res.json({}));\n`,
      expectSse: false,
      expectCompliant: true,
    },
    {
      name: "text/event-stream via res.setHeader, no compliance → flagged",
      src: `res.setHeader('Content-Type', 'text/event-stream');\nres.write('data: hello\\n\\n');\n`,
      expectSse: true,
      expectCompliant: false,
    },
    {
      name: "text/event-stream via object literal, no compliance → flagged",
      src: `res.writeHead(200, { 'Content-Type': 'text/event-stream' });\nres.write('data: hi\\n\\n');\n`,
      expectSse: true,
      expectCompliant: false,
    },
    {
      name: "text/event-stream via writeHead args, no compliance → flagged",
      src: `res.writeHead(200, "OK", { "Content-Type": "text/event-stream" });\nres.write('data: hi\\n\\n');\n`,
      expectSse: true,
      expectCompliant: false,
    },
    {
      name: "text/event-stream + withOrgContext → passes",
      src:
        `import { withOrgContext } from "./middleware/orgContext";\n` +
        `res.setHeader('Content-Type', 'text/event-stream');\n` +
        `await withOrgContext(orgId, async () => { /* db query */ });\n`,
      expectSse: true,
      expectCompliant: true,
    },
    {
      name: "text/event-stream + sse-org-context annotation → passes",
      src:
        `// sse-org-context: pure in-memory fan-out, no per-tenant DB queries\n` +
        `res.setHeader('Content-Type', 'text/event-stream');\n` +
        `res.write('data: ping\\n\\n');\n`,
      expectSse: true,
      expectCompliant: true,
    },
    {
      name: "text/event-stream + inline sse-org-context annotation → passes",
      src:
        `res.setHeader('Content-Type', 'text/event-stream');\n` +
        `// sse-org-context: reads only from in-memory cache\n` +
        `res.write('data: ok\\n\\n');\n`,
      expectSse: true,
      expectCompliant: true,
    },
    {
      name: "text/event-stream + withOrgContext referenced only in import → passes",
      src:
        `import { withOrgContext } from "../middleware/orgContext";\n` +
        `res.setHeader('Content-Type', 'text/event-stream');\n`,
      expectSse: true,
      expectCompliant: true,
    },
    {
      name: "sse-org-context annotation without colon → not recognized, flagged",
      src:
        `// sse-org-context safe because no DB\n` +
        `res.setHeader('Content-Type', 'text/event-stream');\n`,
      expectSse: true,
      expectCompliant: false,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const gotSse = isSseFile(c.src);
    const gotCompliant = isCompliant(c.src);

    // An SSE file is "flagged" when isSseFile=true AND isCompliant=false.
    // For non-SSE files the compliance check is irrelevant; we only
    // assert isSseFile matches the expectation.
    const sseOk = gotSse === c.expectSse;
    const complianceOk = !c.expectSse || gotCompliant === c.expectCompliant;

    if (sseOk && complianceOk) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      if (!sseOk) {
        console.error(
          `  ✗ ${c.name}: isSseFile expected ${c.expectSse}, got ${gotSse}`,
        );
      }
      if (!complianceOk) {
        console.error(
          `  ✗ ${c.name}: isCompliant expected ${c.expectCompliant}, got ${gotCompliant}`,
        );
      }
    }
  }

  console.log(`\n[self-test] ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}
process.exit(checkRepo());
