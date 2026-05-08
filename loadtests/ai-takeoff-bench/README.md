# AI Takeoff Accuracy Regression Harness

A benchmark suite that scores the AI takeoff drafter's output against
hand-validated expected line-item sets, so that prompt or model changes
become measurable instead of vibes-driven. See Task #2622.

## Layout

```
loadtests/ai-takeoff-bench/
  README.md              — this file
  budgets.json           — minimum acceptable scores per fixture
  lib/
    scoring.mjs          — precision / recall / quantity-MAPE scorer
    fixtures.mjs         — fixture loader & validator
    replayProvider.mjs   — pre-recorded model output → reconciliation
  fixtures/
    *.json               — one fixture per small plan set
```

The runner script is `scripts/ai-takeoff-bench.mjs`.

## Running locally

```bash
# Replay mode (no API keys needed) — exercises scoring + reconciliation
# math against pre-recorded model outputs. This is the mode CI uses on PRs
# touching server/services/aiEstimator/**.
node scripts/ai-takeoff-bench.mjs --mode=replay

# Live mode (requires DATABASE_URL + ANTHROPIC_API_KEY/OPENAI_API_KEY) —
# exercises the real draft pipeline end-to-end. Nightly CI uses this.
node scripts/ai-takeoff-bench.mjs --mode=live

# Smoke subset — first three fixtures only, the PR gate.
node scripts/ai-takeoff-bench.mjs --mode=replay --subset=smoke
```

Output: a JSON report at `loadtests/ai-takeoff-bench/results/report.json`
(plus a per-run timestamped copy). Exit code 1 when any fixture's score
regresses past `regressionTolerance` in `budgets.json`.

## Curating fixtures

Each fixture is a small JSON file with three sections:

1. **`meta`** — `id`, `description`, `tradesCovered` (4+ trades across the
   set), `subset` (`"smoke"` or `"full"`).
2. **`expected`** — the hand-validated ground-truth line items. Each item
   has `label`, `type` (AREA/LINEAR/COUNT/VOLUME), `unit`, `value`,
   `discipline`, and (optionally) `tolerancePercent` (default 10%).
3. **`replay`** — one or more "batches" mimicking the per-discipline LLM
   outputs that `mapReduceDraftFromPlans` would normally produce. Each
   batch has `discipline` and a list of `measurements` shaped exactly
   like `MapReduceMeasurement` (label/type/value/unit/costCode/rationale/
   sheetCitations). Replay mode feeds these into the real
   `reconcileMeasurements` helper and scores the result.

### How to add a new fixture

1. Pick a real plan set the team has already estimated. Trim it to
   ≤ 20 sheets and ≤ 4 disciplines so a full LLM pass costs cents, not
   dollars.
2. Sit with the senior estimator and write the expected line-item JSON.
   Capture every quantifiable item the estimator would price; record
   the unit and the per-item tolerance (looser for things prone to
   sheet-level overlap, e.g. floor area; tighter for counts).
3. Run `node scripts/ai-takeoff-bench.mjs --mode=live --only=<id>` and
   paste the resulting `replay.batches` payload into the fixture so
   future replay runs are deterministic.
4. Add a per-fixture entry to `budgets.json` with conservative minimums
   (precision ≥ 0.5, recall ≥ 0.5, MAPE ≤ 0.30 is a good starting bar
   for a fresh fixture; tighten as we calibrate).
5. Document the fixture in this README's table below.

### Current fixtures

| ID | Trades | Sheets | Notes |
| -- | ------ | ------ | ----- |
| `concrete-foundation-small`     | C, S       | 4 | Synthetic small concrete + structural foundation set. |
| `electrical-tenant-fitout`      | E          | 5 | Synthetic single-trade electrical fit-out. |
| `mech-plumbing-medical`         | M, P       | 6 | Mechanical + plumbing rough-in for a medical suite. |
| `architectural-finishes`        | A          | 4 | Architectural finish schedule (paint, flooring, ACT). |
| `civil-sitework`                | C, L       | 5 | Civil sitework + landscape (earthwork, paving, plantings). |

The full set covers 6 disciplines (A, S, M, E, P, C, L) across 5
fixtures — meeting the "≥ 4 trades, 5–10 fixtures" bar in the task.
