#!/usr/bin/env node
// Task #2478 — Tenant table inventory.
//
// Walks shared/schema/{features,core,operations,crm-upgrade}.ts looking for
// every pgTable definition that contains an `organization_id` column and
// prints the unique sorted list, one table per line.
//
// Used by:
//   - migrations/0096_enable_tenant_rls.sql (manually regenerated when new
//     multi-tenant tables are added)
//   - server/utils/ensureRlsPolicies.ts (the boot-time idempotent applier)
//   - docs/architecture/tenant-isolation.md (audit reference)
//
// Usage:
//   node scripts/inventory-tenant-tables.mjs
//   node scripts/inventory-tenant-tables.mjs --json

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "../shared/schema");

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectFiles(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const tenantTables = new Set();
for (const file of collectFiles(SCHEMA_DIR)) {
  const src = readFileSync(file, "utf8");
  const re = /pgTable\(\s*"([a-z_][a-z0-9_]*)"\s*,\s*\{([\s\S]*?)\}\s*(?:,|\))/g;
  let m;
  while ((m = re.exec(src))) {
    const [, name, body] = m;
    if (/organization_id/.test(body)) tenantTables.add(name);
  }
}

const sorted = [...tenantTables].sort();
if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(sorted, null, 2) + "\n");
} else {
  for (const t of sorted) process.stdout.write(t + "\n");
}
