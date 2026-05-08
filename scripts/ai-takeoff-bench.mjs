#!/usr/bin/env node
// AI Takeoff Accuracy Regression Harness — runner.
// Task #2622.
//
// Loads benchmark fixtures from `loadtests/ai-takeoff-bench/fixtures/`,
// runs each one through the takeoff pipeline (replay or live mode),
// scores the result against the hand-validated expected line items,
// compares to `loadtests/ai-takeoff-bench/budgets.json`, and writes a
// JSON report. Exits 1 when any fixture regresses past tolerance.
//
// Usage:
//   node scripts/ai-takeoff-bench.mjs                     # all fixtures, replay
//   node scripts/ai-takeoff-bench.mjs --subset=smoke      # smoke subset (PR gate)
//   node scripts/ai-takeoff-bench.mjs --only=<id>         # single fixture
//   node scripts/ai-takeoff-bench.mjs --mode=live         # call real pipeline
//   node scripts/ai-takeoff-bench.mjs --report=path.json  # custom report path

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAllFixtures } from "../loadtests/ai-takeoff-bench/lib/fixtures.mjs";
import { scorePredictions, compareToBudget } from "../loadtests/ai-takeoff-bench/lib/scoring.mjs";
import { reconcileViaTsx, runLiveTakeoffViaTsx } from "../loadtests/ai-takeoff-bench/lib/replayProvider.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BENCH_DIR = path.join(ROOT, "loadtests", "ai-takeoff-bench");
const FIXTURE_DIR = path.join(BENCH_DIR, "fixtures");
const BUDGETS_PATH = path.join(BENCH_DIR, "budgets.json");
const RESULTS_DIR = path.join(BENCH_DIR, "results");

function parseArgs(argv) {
  const out = { mode: "replay", subset: null, only: null, report: null };
  for (const a of argv) {
    if (a.startsWith("--mode=")) out.mode = a.slice("--mode=".length);
    else if (a.startsWith("--subset=")) out.subset = a.slice("--subset=".length);
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length);
    else if (a.startsWith("--report=")) out.report = a.slice("--report=".length);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: ai-takeoff-bench.mjs [--mode=replay|live] [--subset=smoke] [--only=<id>] [--report=path]");
      process.exit(0);
    }
  }
  return out;
}

function shapePredictions(measurements) {
  return measurements.map((m) => ({
    label: m.label,
    type: m.type,
    unit: m.unit,
    value: m.value,
    // Per-trade scoring uses the first contributing discipline as the
    // prediction's trade. This mirrors how the production
    // `MapReduceMeasurement.contributingDisciplines` field tags each
    // reconciled item; a measurement contributed by multiple
    // disciplines is attributed to the first one for scoring purposes.
    discipline: Array.isArray(m.contributingDisciplines) && m.contributingDisciplines.length > 0
      ? m.contributingDisciplines[0]
      : undefined,
  }));
}

async function runReplay(fixture) {
  // Run pre-recorded per-discipline batches through the real
  // reconciliation helper (via tsx child) so we exercise the production
  // dedupe/merge math without touching the LLM.
  const measurements = reconcileViaTsx(fixture.replay.batches);
  return shapePredictions(measurements);
}

async function runLive(fixture) {
  // Live mode runs the CURRENT model + CURRENT prompt + CURRENT
  // reconciliation logic against the fixture's `live.pagesByDiscipline`
  // text content. Provider selection mirrors production routing
  // (Anthropic if `ANTHROPIC_API_KEY` is set, otherwise OpenAI).
  if (!fixture.live || !fixture.live.pagesByDiscipline) {
    return { skipped: true, reason: "no live.pagesByDiscipline on fixture" };
  }
  const measurements = runLiveTakeoffViaTsx(fixture.live.pagesByDiscipline);
  return {
    skipped: false,
    predicted: shapePredictions(measurements),
  };
}

function liveProviderConfigured() {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const budgets = JSON.parse(fs.readFileSync(BUDGETS_PATH, "utf8"));
  const tolerance = budgets.regressionTolerance ?? 0.15;
  let fixtures = loadAllFixtures(FIXTURE_DIR);
  if (args.subset === "smoke") fixtures = fixtures.filter((f) => f.meta.subset === "smoke");
  if (args.only) fixtures = fixtures.filter((f) => f.meta.id === args.only);
  if (fixtures.length === 0) {
    console.error("[bench] no fixtures matched filter");
    process.exit(2);
  }

  if (args.mode === "live" && !liveProviderConfigured()) {
    console.error(
      "[bench] --mode=live requires ANTHROPIC_API_KEY or OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY). " +
        "Set one and retry.",
    );
    process.exit(2);
  }

  const reportRows = [];
  let anyFailed = false;

  for (const fx of fixtures) {
    const id = fx.meta.id;
    process.stdout.write(`[bench] ${id} (mode=${args.mode}) … `);
    let predicted;
    try {
      if (args.mode === "live") {
        const liveOut = await runLive(fx);
        if (liveOut.skipped) {
          console.log(`SKIP — ${liveOut.reason}`);
          reportRows.push({ id, subset: fx.meta.subset, skipped: true, reason: liveOut.reason, passed: true });
          continue;
        }
        predicted = liveOut.predicted;
      } else {
        predicted = await runReplay(fx);
      }
    } catch (err) {
      console.log(`ERROR — ${err?.message ?? err}`);
      reportRows.push({ id, error: String(err?.message ?? err), passed: false });
      anyFailed = true;
      continue;
    }
    const score = scorePredictions(fx.expected, predicted);
    const budget = budgets.fixtures?.[id] ?? null;
    const cmp = budget ? compareToBudget(score, budget, tolerance) : { passed: true, reasons: ["no budget configured"] };
    if (!cmp.passed) anyFailed = true;
    console.log(
      `precision=${score.precision.toFixed(3)} recall=${score.recall.toFixed(3)} ` +
        `mape=${score.mape.toFixed(3)} matched=${score.matched}/${score.expectedCount} ` +
        `${cmp.passed ? "PASS" : "FAIL"}`,
    );
    for (const [disc, b] of Object.entries(score.byDiscipline)) {
      console.log(
        `  · trade=${disc} precision=${b.precision.toFixed(3)} recall=${b.recall.toFixed(3)} ` +
          `mape=${b.mape.toFixed(3)} matched=${b.matched}/${b.expectedCount}`,
      );
    }
    if (!cmp.passed) {
      for (const r of cmp.reasons) console.log(`  ↳ ${r}`);
    }
    reportRows.push({
      id,
      tradesCovered: fx.meta.tradesCovered,
      subset: fx.meta.subset,
      score,
      budget,
      passed: cmp.passed,
      failureReasons: cmp.passed ? [] : cmp.reasons,
    });
  }

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    subset: args.subset,
    only: args.only,
    regressionTolerance: tolerance,
    fixtures: reportRows,
    summary: {
      total: reportRows.length,
      passed: reportRows.filter((r) => r.passed).length,
      failed: reportRows.filter((r) => !r.passed).length,
    },
  };
  const stampedPath = path.join(RESULTS_DIR, `report-${stamp}.json`);
  const latestPath = args.report ? path.resolve(args.report) : path.join(RESULTS_DIR, "report.json");
  fs.writeFileSync(stampedPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  console.log(`[bench] report → ${path.relative(ROOT, latestPath)}`);
  console.log(`[bench] summary: ${report.summary.passed}/${report.summary.total} passed`);

  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
