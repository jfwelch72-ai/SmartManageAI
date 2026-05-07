// Shared helpers for parsing k6 `--summary-export` JSON files. Used by
// both the per-run budget gate (`loadtests/check-budgets.mjs`) and the
// rolling re-baseline job (`loadtests/rebaseline-budgets.mjs`) so the two
// stay calibrated against the same metric extraction logic.

import fs from "node:fs";

// Build a normalized index: { baseName: [{ tags: {k:v}, metric }, ...], ... }
// so we can match by required-tag subset regardless of the order/extra
// tags k6 includes in the submetric key.
export function indexMetrics(metrics) {
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
export function findMetric(indexed, baseName, requiredTags) {
  const candidates = indexed[baseName] || [];
  const requiredKeys = Object.keys(requiredTags);
  if (requiredKeys.length === 0) {
    const untagged = candidates.find((c) => Object.keys(c.tags).length === 0);
    return untagged ? untagged.metric : null;
  }
  const matches = candidates.filter((c) =>
    requiredKeys.every((k) => c.tags[k] === requiredTags[k]),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => Object.keys(a.tags).length - Object.keys(b.tags).length);
  return matches[0].metric;
}

// Extract per-endpoint p95 + error rate from a single k6 summary file.
// Returns { [endpoint]: { p95, rate } } — values omitted when the
// summary doesn't carry a matching tagged submetric.
export function extractEndpointMetrics(summary, endpoints, { cohort = null } = {}) {
  const indexed = indexMetrics(summary.metrics || {});
  const out = {};
  for (const endpoint of endpoints) {
    const requiredTags = { endpoint };
    if (cohort) requiredTags.cohort = cohort;
    const dur = findMetric(indexed, "http_req_duration", requiredTags);
    const fail = findMetric(indexed, "http_req_failed", requiredTags);
    const p95 = dur?.values?.["p(95)"];
    const rate = fail?.values?.rate;
    if (p95 == null && rate == null) continue;
    out[endpoint] = {};
    if (p95 != null) out[endpoint].p95 = p95;
    if (rate != null) out[endpoint].rate = rate;
  }
  return out;
}

export function readSummary(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
