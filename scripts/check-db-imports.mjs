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

const offenders = [];
const RE_DRIZZLE_NODE = /from\s+["']drizzle-orm\/node-postgres["']/;
const RE_NEW_POOL = /new\s+Pool\s*\(/;
const RE_DRIZZLE_CALL = /\bdrizzle\s*\(\s*\{\s*client/;

for (const file of walk(SERVER_DIR)) {
  if (ALLOWED.has(file)) continue;
  const src = readFileSync(file, "utf8");
  const issues = [];
  if (RE_DRIZZLE_NODE.test(src)) issues.push("imports from drizzle-orm/node-postgres");
  if (RE_NEW_POOL.test(src)) issues.push("constructs its own pg Pool");
  if (RE_DRIZZLE_CALL.test(src)) issues.push("calls drizzle({ client: ... }) directly");
  if (issues.length > 0) {
    offenders.push({ file: path.relative(process.cwd(), file), issues });
  }
}

if (offenders.length === 0) {
  process.stdout.write(
    "[check-db-imports] OK — every server file routes through the shared db proxy.\n",
  );
  process.exit(0);
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
process.exit(1);
