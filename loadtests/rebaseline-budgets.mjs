#!/usr/bin/env node
// Rolling re-baseline of `loadtests/budgets.json` from the last N
// nightly k6 summary artifacts. Computes per-endpoint rolling p95 +
// error rate across every summary JSON discovered under the input
// directory, then writes:
//
//   * a candidate budgets.json (round-up + headroom, matching the
//     hand-baseline rules from docs/ops/capacity.md §5)
//   * a markdown summary table (suitable for $GITHUB_STEP_SUMMARY or a
//     PR body) showing per-endpoint current vs candidate values and
//     flagging endpoints whose rolling p95 has drifted more than the
//     configured threshold (default 20%) from the committed budget.
//
// The script's exit code reflects whether *any* endpoint exceeded the
// drift threshold (0 = within tolerance, 10 = drift detected). The
// nightly workflow keys off that to decide whether to open a PR.
//
// Usage:
//   node loadtests/rebaseline-budgets.mjs \
//     --summaries-dir=./artifacts \
//     --out-budgets=./candidate-budgets.json \
//     --out-summary=./rebaseline-summary.md \
//     --threshold=0.20
//
// Only `nightly-summary.json` files are considered by default — the
// noisy-neighbor + smoke runs are excluded because they exercise a
// different traffic shape and would skew the rolling p95.

import fs from "node:fs";
import path from "node:path";
import { extractEndpointMetrics, readSummary } from "./lib/summary.mjs";

const args = process.argv.slice(2);
const opts = {
  summariesDir: null,
  outBudgets: null,
  outSummary: null,
  threshold: 0.20,
  budgetsPath: path.join(path.dirname(new URL(import.meta.url).pathname), "budgets.json"),
  filenameMatch: "nightly-summary",
  cohort: null,
  // Round-up steps mirror the hand-baseline rules in capacity.md §5:
  // cheap reads jump to the next 20 ms, list/aggregate reads to the
  // next 50 ms. We classify by the committed budget (≤ 500 ms = cheap).
  cheapStepMs: 20,
  cheapThresholdMs: 500,
  expensiveStepMs: 50,
  // Headroom layered on top of the rolling p95 before rounding.
  headroom: 0.15,
};

for (const a of args) {
  if (a.startsWith("--summaries-dir=")) opts.summariesDir = a.slice("--summaries-dir=".length);
  else if (a.startsWith("--out-budgets=")) opts.outBudgets = a.slice("--out-budgets=".length);
  else if (a.startsWith("--out-summary=")) opts.outSummary = a.slice("--out-summary=".length);
  else if (a.startsWith("--threshold=")) opts.threshold = Number(a.slice("--threshold=".length));
  else if (a.startsWith("--budgets=")) opts.budgetsPath = a.slice("--budgets=".length);
  else if (a.startsWith("--filename-match=")) opts.filenameMatch = a.slice("--filename-match=".length);
  else if (a.startsWith("--cohort=")) opts.cohort = a.slice("--cohort=".length);
  else if (a.startsWith("--headroom=")) opts.headroom = Number(a.slice("--headroom=".length));
  else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}

if (!opts.summariesDir) {
  console.error("usage: rebaseline-budgets.mjs --summaries-dir=<dir> [--out-budgets=<file>] [--out-summary=<file>] [--threshold=0.20]");
  process.exit(2);
}
if (!Number.isFinite(opts.threshold) || opts.threshold < 0) {
  console.error(`invalid --threshold value: ${opts.threshold}`);
  process.exit(2);
}

const budgets = JSON.parse(fs.readFileSync(opts.budgetsPath, "utf8"));
const endpoints = Object.keys(budgets.endpoints);

// Discover every nightly summary JSON under the input dir (recursively
// so per-run subdirectories from `actions/download-artifact` work).
const summaryFiles = collectSummaryFiles(opts.summariesDir, opts.filenameMatch);
if (summaryFiles.length === 0) {
  console.error(`[rebaseline] no summary files matching "*${opts.filenameMatch}*.json" under ${opts.summariesDir}`);
  // Soft exit — the workflow should still succeed on the very first run
  // before any nightly artifact has accumulated.
  if (opts.outSummary) {
    fs.writeFileSync(opts.outSummary, "_No nightly k6 summaries available yet — skipping rolling re-baseline._\n");
  }
  process.exit(0);
}

console.log(`[rebaseline] aggregating ${summaryFiles.length} summary file(s)`);
for (const f of summaryFiles) console.log(`  - ${f}`);

// Aggregate per-endpoint metrics across every summary file.
const samples = {};
for (const endpoint of endpoints) samples[endpoint] = { p95: [], rate: [] };

let parsedRuns = 0;
for (const file of summaryFiles) {
  let summary;
  try {
    summary = readSummary(file);
  } catch (err) {
    console.warn(`[rebaseline] WARN failed to parse ${file}: ${err.message}`);
    continue;
  }
  const perEndpoint = extractEndpointMetrics(summary, endpoints, { cohort: opts.cohort });
  parsedRuns += 1;
  for (const endpoint of endpoints) {
    const m = perEndpoint[endpoint];
    if (!m) continue;
    if (m.p95 != null) samples[endpoint].p95.push(m.p95);
    if (m.rate != null) samples[endpoint].rate.push(m.rate);
  }
}

if (parsedRuns === 0) {
  console.error("[rebaseline] every summary file failed to parse — refusing to write candidate");
  process.exit(2);
}

// Build the candidate budgets file. The committed budget already
// represents the rounded ceiling, so we compare the rolled-up rolling
// p95 against the committed value (NOT the rolled-up vs new candidate)
// when computing drift. This keeps the gate stable: a single noisy
// night doesn't trip a re-baseline, only a sustained shift does.
const candidate = JSON.parse(JSON.stringify(budgets));
const rows = [];
let driftDetected = false;

for (const endpoint of endpoints) {
  const committed = budgets.endpoints[endpoint];
  const ps = samples[endpoint].p95;
  const rs = samples[endpoint].rate;

  if (ps.length === 0) {
    rows.push({
      endpoint,
      runs: 0,
      committedP95: committed.p95Ms,
      rollingP95: null,
      candidateP95: committed.p95Ms,
      committedErr: committed.errorRate,
      rollingErr: null,
      candidateErr: committed.errorRate,
      drift: null,
      flagged: false,
      note: "no samples",
    });
    continue;
  }

  // Rolling p95 = the maximum of the per-run p95s. Average would mask
  // a recent regression at the tail of the window; we want the gate to
  // track the worst sustained night, then add headroom on top.
  const rollingP95 = Math.max(...ps);
  const rollingErr = rs.length ? Math.max(...rs) : null;

  const driftRatio = (rollingP95 - committed.p95Ms) / committed.p95Ms;
  const flagged = Math.abs(driftRatio) >= opts.threshold;

  const candidateP95 = roundUpP95(rollingP95 * (1 + opts.headroom), {
    cheapStepMs: opts.cheapStepMs,
    cheapThresholdMs: opts.cheapThresholdMs,
    expensiveStepMs: opts.expensiveStepMs,
  });
  // Round error rate up to the next 0.005 step (matches the granularity
  // of the existing committed values: 0.0 / 0.005 / 0.01).
  const candidateErr = rollingErr == null
    ? committed.errorRate
    : Math.max(committed.errorRate, roundUpStep(rollingErr, 0.005));

  if (flagged) {
    driftDetected = true;
    candidate.endpoints[endpoint] = { p95Ms: candidateP95, errorRate: candidateErr };
  }

  rows.push({
    endpoint,
    runs: ps.length,
    committedP95: committed.p95Ms,
    rollingP95: round1(rollingP95),
    candidateP95,
    committedErr: committed.errorRate,
    rollingErr: rollingErr == null ? null : round4(rollingErr),
    candidateErr,
    drift: round3(driftRatio),
    flagged,
    note: "",
  });
}

// Stamp candidate metadata so a reviewer can tell at a glance which
// nightly window produced it. Intentionally omits `generatedAt` to keep
// the committed file diff stable across nights when the numbers haven't
// changed — the timestamp lives in the markdown summary / PR body
// instead, so we don't churn the PR every run.
candidate.$rebaseline = {
  runs: parsedRuns,
  thresholdPct: opts.threshold,
  headroomPct: opts.headroom,
  driftDetected,
};

if (opts.outBudgets) {
  fs.mkdirSync(path.dirname(opts.outBudgets), { recursive: true });
  fs.writeFileSync(opts.outBudgets, JSON.stringify(candidate, null, 2) + "\n");
  console.log(`[rebaseline] wrote candidate budgets to ${opts.outBudgets}`);
}

const md = renderMarkdown(rows, {
  runs: parsedRuns,
  threshold: opts.threshold,
  headroom: opts.headroom,
  driftDetected,
});
if (opts.outSummary) {
  fs.mkdirSync(path.dirname(opts.outSummary), { recursive: true });
  fs.writeFileSync(opts.outSummary, md);
  console.log(`[rebaseline] wrote summary to ${opts.outSummary}`);
} else {
  process.stdout.write(md);
}

process.exit(driftDetected ? 10 : 0);

function collectSummaryFiles(dir, match) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.endsWith(".json") && ent.name.includes(match)) out.push(full);
    }
  }
  return out.sort();
}

function roundUpP95(ms, { cheapStepMs, cheapThresholdMs, expensiveStepMs }) {
  const step = ms <= cheapThresholdMs ? cheapStepMs : expensiveStepMs;
  return Math.ceil(ms / step) * step;
}

function roundUpStep(value, step) {
  return Math.ceil(value / step) * step;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round3(n) { return Math.round(n * 1000) / 1000; }
function round4(n) { return Math.round(n * 10000) / 10000; }

function renderMarkdown(rows, meta) {
  const lines = [];
  lines.push(`# Load-test budget re-baseline`);
  lines.push("");
  lines.push(`- Aggregated runs: **${meta.runs}**`);
  lines.push(`- Drift threshold: **${(meta.threshold * 100).toFixed(0)}%**`);
  lines.push(`- Headroom applied to candidate: **${(meta.headroom * 100).toFixed(0)}%**`);
  lines.push(`- Drift detected: **${meta.driftDetected ? "yes" : "no"}**`);
  lines.push("");
  lines.push("| Endpoint | Runs | Committed p95 | Rolling p95 (max) | Drift | Candidate p95 | Committed err | Rolling err | Candidate err | Flag |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |");
  for (const r of rows) {
    const drift = r.drift == null ? "—" : `${(r.drift * 100).toFixed(1)}%`;
    const flag = r.flagged ? "⚠️" : (r.note ? `_${r.note}_` : "");
    lines.push(
      `| \`${r.endpoint}\` | ${r.runs} | ${r.committedP95} | ${r.rollingP95 ?? "—"} | ${drift} | ${r.candidateP95} | ${r.committedErr} | ${r.rollingErr ?? "—"} | ${r.candidateErr} | ${flag} |`,
    );
  }
  lines.push("");
  if (meta.driftDetected) {
    lines.push("> One or more endpoints exceeded the drift threshold. A draft PR has been opened with the candidate `loadtests/budgets.json`.");
  } else {
    lines.push("> All endpoints within tolerance — no PR opened.");
  }
  lines.push("");
  return lines.join("\n");
}
