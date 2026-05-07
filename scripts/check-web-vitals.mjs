#!/usr/bin/env node
// Task #2525 — Scheduled Web Vitals quality check.
//
// Scrapes the production `/metrics` endpoint and exits non-zero when
// any of LCP / INP / CLS has a `good_ratio` below the 0.75 threshold
// documented in `docs/ops/capacity.md` § "Frontend Web Vitals".
//
// Used by `.github/workflows/web-vitals-alert.yml`, which runs every
// 30 minutes and pipes failures to the same Slack channel as the
// nightly load-test failure (`SLACK_WEBHOOK_URL`).
//
// Required env:
//   OPS_METRICS_URL    Full URL to the production `/metrics` endpoint
//                      (e.g. https://app.smartmanage.ai/metrics).
// Optional env:
//   OPS_METRICS_TOKEN  Bearer token configured on the server side via
//                      the same env var; required if the prod scrape
//                      endpoint is locked down.
//   WEB_VITALS_MIN_SAMPLES  Minimum samples per metric before the
//                           gate evaluates (default: 100). Avoids
//                           paging on a window that just refilled
//                           after an autoscale event.
//   WEB_VITALS_GOOD_RATIO_FLOOR  Override threshold (default 0.75).
//   WEB_VITALS_METRICS  Comma-separated metric names to check
//                       (default: LCP,INP,CLS).
//
// Exit codes:
//   0  All checked metrics are healthy (or have insufficient samples).
//   1  At least one metric breached the floor — Slack alert fires.
//   2  Configuration / fetch error (script bug, not a quality alert).

const url = process.env.OPS_METRICS_URL;
if (!url) {
  console.error("OPS_METRICS_URL is not set; skipping Web Vitals check.");
  // Exit 0 so the workflow is not noisy in repos where prod monitoring
  // has not been wired up yet (mirrors notify-slack-on-failure's
  // missing-webhook fallback).
  process.exit(0);
}

const token = process.env.OPS_METRICS_TOKEN || "";
const minSamples = Number(process.env.WEB_VITALS_MIN_SAMPLES || 100);
const floor = Number(process.env.WEB_VITALS_GOOD_RATIO_FLOOR || 0.75);
const metrics = (process.env.WEB_VITALS_METRICS || "LCP,INP,CLS")
  .split(",")
  .map((m) => m.trim().toUpperCase())
  .filter(Boolean);

const headers = {};
if (token) headers.authorization = `Bearer ${token}`;

let response;
try {
  response = await fetch(url, { headers });
} catch (err) {
  console.error(`Failed to fetch ${url}: ${err.message || err}`);
  process.exit(2);
}

if (!response.ok) {
  console.error(`Fetch ${url} returned HTTP ${response.status}`);
  process.exit(2);
}

const body = await response.text();

// Parse the two gauges we need from the Prometheus text format.
//   app_web_vitals_good_ratio{metric="LCP"} 0.83
//   app_web_vitals_samples_total{metric="LCP"} 421
const goodRatio = parseSeries(body, "app_web_vitals_good_ratio");
const samples = parseSeries(body, "app_web_vitals_samples_total");

const breaches = [];
const skipped = [];
const healthy = [];

for (const metric of metrics) {
  const ratio = goodRatio[metric];
  const count = samples[metric];
  if (ratio === undefined || count === undefined) {
    skipped.push({ metric, reason: "no samples reported" });
    continue;
  }
  if (count < minSamples) {
    skipped.push({ metric, reason: `only ${count} samples (< ${minSamples})` });
    continue;
  }
  if (ratio < floor) {
    breaches.push({ metric, ratio, count });
  } else {
    healthy.push({ metric, ratio, count });
  }
}

const summary = {
  url,
  threshold: floor,
  minSamples,
  breaches,
  healthy,
  skipped,
};
console.log(JSON.stringify(summary, null, 2));

if (breaches.length > 0) {
  const detail = breaches
    .map((b) => `${b.metric} good_ratio=${b.ratio.toFixed(3)} (n=${b.count})`)
    .join("; ");
  console.error(
    `Web Vitals quality breach: ${detail}. Threshold = ${floor}.`,
  );
  process.exit(1);
}

console.log(
  `OK: ${healthy.length} metric(s) healthy, ${skipped.length} skipped, 0 breaches.`,
);
process.exit(0);

function parseSeries(text, name) {
  const out = {};
  const re = new RegExp(
    `^${name}\\{[^}]*metric="([^"]+)"[^}]*\\}\\s+([0-9eE+\\-\\.]+)`,
    "gm",
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[2]);
    if (Number.isFinite(v)) out[m[1]] = v;
  }
  return out;
}
