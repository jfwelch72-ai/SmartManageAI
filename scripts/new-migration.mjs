#!/usr/bin/env node
// Task #2685 — Migration prefix generator.
//
// Hands out the next free 4-digit prefix in `migrations/` so two
// developers working on parallel branches don't accidentally pick the
// same one. Refuses to run when ANY duplicate prefix already exists in
// `migrations/` — including the historical duplicates tracked for
// renumber in Task #2435 — so collisions get fixed first instead of
// being layered on. (The companion CI guard
// `scripts/check-migration-collisions.mjs` is the one that tolerates
// historical duplicates so the build stays green; the generator is
// stricter on purpose.)
//
// Usage:
//   node scripts/new-migration.mjs <slug>
//
// Example:
//   node scripts/new-migration.mjs add_widget_color
//     -> writes migrations/0106_add_widget_color.sql (empty placeholder)
//
// After creating the file, register it in
// `server/utils/migrationStartupCoverage.ts` (and add a startup helper
// in `server/utils/runStartupMigrations.ts` if the migration is more
// than a baseline / one-off backfill). Resolution playbook:
// docs/ops/migration-collisions.md

import { readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");

const SLUG_RE = /^[a-z0-9][a-z0-9_]*$/;
const PREFIX_RE = /^(\d{4})_/;

const slug = process.argv[2];
if (!slug) {
  process.stderr.write(
    "Usage: node scripts/new-migration.mjs <slug>\n\n" +
      "Slug must be lowercase letters/digits/underscores, e.g. add_widget_color\n",
  );
  process.exit(2);
}
if (!SLUG_RE.test(slug)) {
  process.stderr.write(
    `Invalid slug "${slug}". Use lowercase letters, digits, and underscores only (must start with a letter or digit).\n`,
  );
  process.exit(2);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const prefixes = new Map();
for (const f of files) {
  const m = PREFIX_RE.exec(f);
  if (!m) continue;
  const p = m[1];
  if (!prefixes.has(p)) prefixes.set(p, []);
  prefixes.get(p).push(f);
}

const collisions = [...prefixes.entries()].filter(([, list]) => list.length > 1);
if (collisions.length > 0) {
  process.stderr.write(
    `[new-migration] Refusing to run — ${collisions.length} duplicate prefix(es) in migrations/:\n`,
  );
  for (const [prefix, list] of collisions) {
    process.stderr.write(`  - ${prefix}:\n`);
    for (const f of list) process.stderr.write(`      • ${f}\n`);
  }
  process.stderr.write(
    "\nResolve duplicates first (see docs/ops/migration-collisions.md), then retry.\n",
  );
  process.exit(1);
}

let highest = 0;
for (const p of prefixes.keys()) {
  const n = Number.parseInt(p, 10);
  if (Number.isFinite(n) && n > highest) highest = n;
}

const next = highest + 1;
if (next > 9999) {
  process.stderr.write(
    `[new-migration] Highest prefix ${String(highest).padStart(4, "0")} cannot be incremented within 4 digits. Time to switch to timestamp-based names.\n`,
  );
  process.exit(1);
}

const nextPrefix = String(next).padStart(4, "0");
const filename = `${nextPrefix}_${slug}.sql`;
const target = path.join(MIGRATIONS_DIR, filename);

if (existsSync(target)) {
  process.stderr.write(`[new-migration] ${filename} already exists. Refusing to overwrite.\n`);
  process.exit(1);
}

const body = `-- ${filename}
-- TODO: describe the migration here.
-- After writing the SQL, register this filename in
--   server/utils/migrationStartupCoverage.ts
-- and (if it's more than a one-off baseline) add a matching helper in
--   server/utils/runStartupMigrations.ts
-- See docs/ops/migration-collisions.md for the full playbook.
`;

writeFileSync(target, body);
process.stdout.write(
  `[new-migration] Created migrations/${filename}\n` +
    `Next steps:\n` +
    `  1. Write the SQL.\n` +
    `  2. Register it in server/utils/migrationStartupCoverage.ts.\n` +
    `  3. Add a startup helper in server/utils/runStartupMigrations.ts if needed.\n`,
);
