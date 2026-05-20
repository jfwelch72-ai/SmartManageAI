#!/usr/bin/env node
// Task #2672 — Freeze guard for the retired legacy storage monolith.
//
// `server/storage.ts` was a ~2,240-line god-module touched by every CRM,
// digest, DOT-facets, and org-admin-alerts route. It was retired in
// Task #2672 and split into per-domain seam files:
//
//   server/executiveDigest/storage.ts
//   server/crm/transcriptBackfillStorage.ts
//   server/dot/payItemPickerFacetsStorage.ts
//
// This guard fails the build if anyone:
//   1. re-creates `server/storage.ts`, or
//   2. imports from `./storage` / `../storage` anywhere under `server/`
//      (the per-domain `server/<domain>/storage.ts` files are fine — only
//      the bare top-level path is banned).
//
// Wire into CI by adding to scripts/ci.sh or running directly:
//   node scripts/check-legacy-storage.mjs
//
// Run the script's own self-tests:
//   node scripts/check-legacy-storage.mjs --self-test

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const LEGACY_FILE = path.join(SERVER_DIR, "storage.ts");

// Banned import specifiers: bare "./storage" from anything in server/, or
// "../storage" from anything in server/<dir>/. Per-domain seam imports like
// "./executiveDigest/storage" or "../crm/transcriptBackfillStorage" are
// allowed (they don't match the bare patterns below).
const RE_BARE_SAME_DIR = /from\s+["']\.\/storage["']/;
const RE_BARE_PARENT = /from\s+["']\.\.\/storage["']/;

// Returns true if the source text imports from the retired legacy storage path.
// `relPath` is the file's path relative to ROOT (used to honour the bids allowlist).
function hasLegacyImport(src, relPath) {
  // The per-domain bids seam legitimately imports `../storage` to pick
  // up its own contract (server/bids/storage.ts). Skip it.
  if (relPath.startsWith("server/bids/")) return false;
  return RE_BARE_SAME_DIR.test(src) || RE_BARE_PARENT.test(src);
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "dist") continue;
      out.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// -----------------------------------------------------------------------
// Self-tests. Run via:  node scripts/check-legacy-storage.mjs --self-test
// These lock the guard's behavior so future edits don't silently
// introduce regressions in the detection logic.
// -----------------------------------------------------------------------

function selfTest() {
  const cases = [
    {
      name: `bare "./storage" import → flagged`,
      src: `import { foo } from "./storage";\n`,
      relPath: "server/someRoute.ts",
      expectLegacy: true,
    },
    {
      name: `bare "../storage" import → flagged`,
      src: `import { bar } from "../storage";\n`,
      relPath: "server/crm/someFile.ts",
      expectLegacy: true,
    },
    {
      name: `subdomain import "./executiveDigest/storage" → clean`,
      src: `import { baz } from "./executiveDigest/storage";\n`,
      relPath: "server/routes.ts",
      expectLegacy: false,
    },
    {
      name: `"./storageHelper" (not bare) → clean`,
      src: `import { qux } from "./storageHelper";\n`,
      relPath: "server/someRoute.ts",
      expectLegacy: false,
    },
    {
      name: `"./storage/foo" (path extension) → clean`,
      src: `import { x } from "./storage/foo";\n`,
      relPath: "server/someRoute.ts",
      expectLegacy: false,
    },
    {
      name: `server/bids/ importing "../storage" → allowlisted, clean`,
      src: `import { BidStorage } from "../storage";\n`,
      relPath: "server/bids/bidRoutes.ts",
      expectLegacy: false,
    },
    {
      name: `server/bids/ importing "./storage" → allowlisted, clean`,
      src: `import { BidStorage } from "./storage";\n`,
      relPath: "server/bids/storage.drizzle.ts",
      expectLegacy: false,
    },
    {
      name: `no import at all → clean`,
      src: `export function hello() { return 42; }\n`,
      relPath: "server/someRoute.ts",
      expectLegacy: false,
    },
    {
      name: `double-quoted "../storage" → flagged`,
      src: `import { Foo } from "../storage";\n`,
      relPath: "server/nested/deep.ts",
      expectLegacy: true,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const got = hasLegacyImport(c.src, c.relPath);
    if (got === c.expectLegacy) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.error(
        `  ✗ ${c.name}: expected hasLegacyImport=${c.expectLegacy}, got ${got}`,
      );
    }
  }

  console.log(`\n[self-test] ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

const failures = [];

if (existsSync(LEGACY_FILE)) {
  failures.push(
    `server/storage.ts is back. It was retired in Task #2672 — move new helpers into a per-domain seam under server/<domain>/storage.ts (see docs/architecture/storage-pattern.md).`,
  );
}

if (existsSync(SERVER_DIR)) {
  for (const file of walk(SERVER_DIR)) {
    const rel = path.relative(ROOT, file);
    const src = readFileSync(file, "utf8");
    if (hasLegacyImport(src, rel)) {
      failures.push(
        `${rel} imports from the retired legacy "server/storage.ts" path. Move the import to the matching per-domain seam (server/<domain>/storage.ts).`,
      );
    }
  }
}

if (failures.length === 0) {
  process.stdout.write(
    "[check-legacy-storage] OK — server/storage.ts stays retired.\n",
  );
  process.exit(0);
}

process.stderr.write(
  `[check-legacy-storage] FAIL — ${failures.length} violation(s):\n`,
);
for (const f of failures) process.stderr.write(`  - ${f}\n`);
process.stderr.write(
  "\nSee docs/architecture/storage-pattern.md for the per-domain storage seam pattern.\n",
);
process.exit(1);
