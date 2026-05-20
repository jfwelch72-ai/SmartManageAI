#!/usr/bin/env node
// CI guard — Task #2949.
//
// Ensures replit.md stays lean by enforcing a maximum line count.
// Architectural decisions, gotchas, security notes, and product features
// belong in the dedicated docs files, not back in replit.md:
//
//   docs/architecture/decisions.md  — significant design decisions
//   docs/ops/gotchas.md             — known pitfalls and non-obvious rules
//   docs/ops/security-quickref.md   — security quick reference
//   docs/product/features.md        — product feature inventory
//
// If this check fails, move any new content to the appropriate doc file
// and keep replit.md as a concise index / pointer doc.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TARGET = path.join(ROOT, "replit.md");
const MAX_LINES = 120;

const content = fs.readFileSync(TARGET, "utf8");
// Trim a single trailing newline before counting so the result matches
// `wc -l` semantics (which counts newline characters, not lines).
const lineCount = content.replace(/\n$/, "").split("\n").length;

if (lineCount > MAX_LINES) {
  console.error(
    `[check-replit-md-size] FAIL: replit.md is ${lineCount} lines — exceeds the ${MAX_LINES}-line limit.`
  );
  console.error(
    `[check-replit-md-size] Move new architectural decisions → docs/architecture/decisions.md`
  );
  console.error(
    `[check-replit-md-size]       new gotchas/rules          → docs/ops/gotchas.md`
  );
  console.error(
    `[check-replit-md-size]       new security notes         → docs/ops/security-quickref.md`
  );
  console.error(
    `[check-replit-md-size]       new product features       → docs/product/features.md`
  );
  console.error(
    `[check-replit-md-size] Keep replit.md as a concise index/pointer document.`
  );
  process.exit(1);
}

console.log(
  `[check-replit-md-size] OK: replit.md is ${lineCount} lines (limit ${MAX_LINES}).`
);
