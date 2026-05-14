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
  process.exit(0);
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
process.exit(1);
