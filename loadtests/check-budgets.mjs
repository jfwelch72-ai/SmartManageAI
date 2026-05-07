#!/usr/bin/env node
// Reads a k6 `--summary-export` JSON file and compares per-endpoint p95
// latency + error rate against `loadtests/budgets.json`. Exits 1 when a
// budget is breached by more than `regressionTolerance`.
//
// Usage:
//   node loadtests/check-budgets.mjs loadtests/results/smoke-summary.json
//   node loadtests/check-budgets.mjs --cohort=quiet loadtests/results/noisy-summary.json

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let cohortFilter = null;
let requireAll = false;
let minMeasured = 0;
const positional = [];
for (const a of args) {
  if (a.startsWith("--cohort=")) cohortFilter = a.slice("--cohort=".length);
  else if (a === "--require-all") requireAll = true;
  else if (a.startsWith("--min-measured=")) {
    minMeasured = Number(a.slice("--min-measured=".length));
    if (!Number.isFinite(minMeasured) || minMeasured < 0) {
      console.error(`invalid --min-measured value: ${a}`);
      process.exit(2);
    }
  } else positional.push(a);
}
const summaryPath = positional[0];
if (!summaryPath) {
  console.error("usage: check-budgets.mjs [--cohort=<name>] <summary.json>");
  process.exit(2);
}

const here = path.dirname(new URL(import.meta.url).pathname);
const budgetsPath = path.join(here, "budgets.json");
const budgets = JSON.parse(fs.readFileSync(budgetsPath, "utf8"));
const tolerance = budgets.regressionTolerance ?? 0.15;

if (!fs.existsSync(summaryPath)) {
  console.error(`[budgets] summary file not found: ${summaryPath}`);
  process.exit(2);
}
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

// k6's summary export shape:
//   metrics.http_req_duration.values.p(95)
//   metrics["http_req_duration{endpoint:GET /healthz}"]?.values["p(95)"]
//   metrics.http_req_failed.values.rate
const metrics = summary.metrics || {};
const indexed = indexMetrics(metrics);
const violations = [];
const ok = [];
const missing = [];

for (const [endpoint, budget] of Object.entries(budgets.endpoints)) {
  const requiredTags = { endpoint };
  if (cohortFilter) requiredTags.cohort = cohortFilter;

  const dur = findMetric(indexed, "http_req_duration", requiredTags);
  const fail = findMetric(indexed, "http_req_failed", requiredTags);
  const p95 = dur?.values?.["p(95)"];
  const rate = fail?.values?.rate;

  if (p95 == null && rate == null) {
    missing.push(endpoint);
    continue;
  }

  const allowedP95 = budget.p95Ms * (1 + tolerance);
  const allowedRate = (budget.errorRate ?? 0.01) + 0.001;

  const row = { endpoint, p95: round(p95), budgetP95: budget.p95Ms, rate: round4(rate), budgetRate: budget.errorRate };
  if (p95 != null && p95 > allowedP95) {
    violations.push({ ...row, kind: "latency" });
  } else if (rate != null && rate > allowedRate) {
    violations.push({ ...row, kind: "errors" });
  } else {
    ok.push(row);
  }
}

console.log(`[budgets] cohort=${cohortFilter || "all"}  tolerance=${(tolerance * 100).toFixed(0)}%`);
console.log("[budgets] OK:");
for (const r of ok) {
  console.log(`  PASS  ${r.endpoint.padEnd(36)} p95=${fmt(r.p95)}ms (≤ ${r.budgetP95}) err=${fmt(r.rate)} (≤ ${r.budgetRate})`);
}
if (missing.length) {
  console.log("[budgets] not measured (skipped, no metric in summary):");
  for (const e of missing) console.log(`  SKIP  ${e}`);
}
if (violations.length) {
  console.log("[budgets] VIOLATIONS:");
  for (const v of violations) {
    console.log(`  FAIL  ${v.endpoint.padEnd(36)} ${v.kind}: p95=${fmt(v.p95)}ms (> ${v.budgetP95}*${1 + tolerance}) err=${fmt(v.rate)} (> ${v.budgetRate})`);
  }
  process.exit(1);
}

if (requireAll && missing.length) {
  console.log("[budgets] FAIL — --require-all set and the following endpoints have no matching metrics in the summary:");
  for (const e of missing) console.log(`  MISSING  ${e}`);
  console.log("[budgets] Either tag the requests in the scenario, seed the auth fixture, or remove the budget entry.");
  process.exit(1);
}

if (minMeasured > 0 && ok.length < minMeasured) {
  console.log(
    `[budgets] FAIL — --min-measured=${minMeasured} set but only ${ok.length} endpoint(s) had matching metrics. ` +
      `This is the noisy-neighbor coverage floor: a quiet cohort that touched fewer endpoints than expected ` +
      `usually means the heavy cohort starved it (the very regression this scenario is supposed to detect) ` +
      `or that the auth fixture failed to seed.`,
  );
  process.exit(1);
}

console.log(`[budgets] all ${ok.length} measured endpoints within budget`);

// Build a normalized index: { baseName: [{ tags: {k:v}, metric }, ...], ... }
// so we can match by required-tag subset regardless of the order/extra
// tags k6 includes in the submetric key.
function indexMetrics(metrics) {
  const out = {};
  for (const [key, metric] of Object.entries(metrics)) {
    const m = key.match(/^([^{]+)(?:\{(.*)\})?$/);
    if (!m) continue;
    const baseName = m[1];
    const tagStr = m[2] || "";
    const tags = {};
    if (tagStr) {
      for (const pair of tagStr.split(",")) {
        const eq = pair.indexOf(":");
        if (eq < 0) continue;
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (k) tags[k] = v;
      }
    }
    (out[baseName] ||= []).push({ tags, metric });
  }
  return out;
}

// Find a metric whose tags include ALL required tags. Never falls back
// to the untagged/global metric — that fallback was masking real
// missing-data conditions in earlier revisions and could cause heavy-
// cohort traffic to leak into the quiet-cohort budget check.
function findMetric(indexed, baseName, requiredTags) {
  const candidates = indexed[baseName] || [];
  const requiredKeys = Object.keys(requiredTags);
  if (requiredKeys.length === 0) {
    // Untagged lookup is only safe when no filter was requested.
    const untagged = candidates.find((c) => Object.keys(c.tags).length === 0);
    return untagged ? untagged.metric : null;
  }
  const matches = candidates.filter((c) =>
    requiredKeys.every((k) => c.tags[k] === requiredTags[k]),
  );
  if (matches.length === 0) return null;
  // Prefer the most specific match (fewest extra tags) so a tag-rich
  // submetric doesn't shadow a tighter one.
  matches.sort((a, b) => Object.keys(a.tags).length - Object.keys(b.tags).length);
  return matches[0].metric;
}

function round(n) { return n == null ? null : Math.round(n * 10) / 10; }
function round4(n) { return n == null ? null : Math.round(n * 10000) / 10000; }
function fmt(n) { return n == null ? "n/a" : String(n); }
