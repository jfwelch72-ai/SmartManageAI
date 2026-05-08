// Precision / recall / quantity-MAPE scorer for the AI takeoff bench.
//
// We align predicted vs expected line items with the SAME identity logic
// the runtime reconciliation uses: (type, normalised unit, normalised
// label). Once aligned:
//   - precision = matched / predicted
//   - recall    = matched / expected
//   - mape      = mean over matched of |predicted - expected| / expected
// MAPE is computed only over MATCHED pairs because unmatched items are
// already counted by precision/recall — double-charging them in MAPE
// would dominate the score.
//
// Per-trade scoring (Task #2622):
//   Multi-trade fixtures (e.g. M+P, C+L) can hide a regression in one
//   trade behind a strong score in the other. To prevent that, we group
//   expected items by their `discipline` field and predicted items by
//   the discipline carried on the prediction (the runner derives this
//   from `MapReduceMeasurement.contributingDisciplines[0]`). Predictions
//   that don't match any expected key are attributed to a synthetic
//   `_unattributed` bucket so per-trade precision stays honest. Per-
//   trade budgets in `budgets.json#fixtures[fid].byTrade.<disc>` are
//   enforced with the same `regressionTolerance` as the overall budget,
//   so a regression in any trade fails the fixture even when the
//   aggregate score is still inside tolerance.

export function normaliseLabel(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normaliseUnit(s) {
  return String(s ?? "").trim().toUpperCase();
}

export function identityKey(m) {
  return `${m.type}|${normaliseUnit(m.unit)}|${normaliseLabel(m.label)}`;
}

const UNATTRIBUTED = "_unattributed";

function emptyTradeBucket() {
  return {
    precision: 0,
    recall: 0,
    mape: 0,
    matched: 0,
    expectedCount: 0,
    predictedCount: 0,
    unmatchedExpected: [],
    unmatchedPredicted: [],
  };
}

/**
 * Score a predicted line-item set against the expected set.
 * @param {Array<{label,type,unit,value,discipline?,tolerancePercent?}>} expected
 * @param {Array<{label,type,unit,value,discipline?}>} predicted
 * @returns {{precision:number, recall:number, mape:number, matched:number,
 *            expectedCount:number, predictedCount:number,
 *            unmatchedExpected:string[], unmatchedPredicted:string[],
 *            perItem:Array<{key:string,expected:number,predicted:number,
 *                          deltaPct:number,withinTolerance:boolean,
 *                          discipline:string}>,
 *            byDiscipline:Record<string, ReturnType<typeof emptyTradeBucket>>}}
 */
export function scorePredictions(expected, predicted) {
  const expectedByKey = new Map();
  for (const e of expected) expectedByKey.set(identityKey(e), e);
  const predictedByKey = new Map();
  for (const p of predicted) {
    const k = identityKey(p);
    const cur = predictedByKey.get(k);
    if (!cur || Math.abs(p.value) > Math.abs(cur.value)) predictedByKey.set(k, p);
  }

  const byDiscipline = {};
  function bucket(disc) {
    const key = disc || UNATTRIBUTED;
    if (!byDiscipline[key]) byDiscipline[key] = emptyTradeBucket();
    return byDiscipline[key];
  }
  // Pre-seed buckets with all expected disciplines so a trade with zero
  // predictions still surfaces (recall=0) instead of disappearing.
  for (const e of expected) bucket(e.discipline);

  for (const e of expectedByKey.values()) bucket(e.discipline).expectedCount += 1;
  for (const p of predictedByKey.values()) bucket(p.discipline).predictedCount += 1;

  let matched = 0;
  let mapeSum = 0;
  let mapeN = 0;
  const perItem = [];
  const unmatchedExpected = [];
  const unmatchedPredicted = [];

  for (const [k, e] of expectedByKey) {
    const p = predictedByKey.get(k);
    const b = bucket(e.discipline);
    if (!p) {
      unmatchedExpected.push(k);
      b.unmatchedExpected.push(k);
      continue;
    }
    matched++;
    b.matched += 1;
    const denom = Math.abs(e.value) > 1e-9 ? Math.abs(e.value) : 1;
    const deltaPct = Math.abs(p.value - e.value) / denom;
    const tol = (e.tolerancePercent ?? 10) / 100;
    perItem.push({
      key: k,
      expected: e.value,
      predicted: p.value,
      deltaPct,
      withinTolerance: deltaPct <= tol,
      discipline: e.discipline ?? UNATTRIBUTED,
    });
    mapeSum += deltaPct;
    mapeN += 1;
    b.mape += deltaPct; // accumulate; divide at end
  }
  for (const [k, p] of predictedByKey) {
    if (!expectedByKey.has(k)) {
      unmatchedPredicted.push(k);
      bucket(p.discipline).unmatchedPredicted.push(k);
    }
  }

  // Finalise per-trade rates.
  for (const disc of Object.keys(byDiscipline)) {
    const b = byDiscipline[disc];
    b.precision = b.predictedCount === 0 ? 0 : b.matched / b.predictedCount;
    b.recall = b.expectedCount === 0 ? 0 : b.matched / b.expectedCount;
    b.mape = b.matched === 0 ? 0 : b.mape / b.matched;
  }

  const precision = predictedByKey.size === 0 ? 0 : matched / predictedByKey.size;
  const recall = expectedByKey.size === 0 ? 0 : matched / expectedByKey.size;
  const mape = mapeN === 0 ? 0 : mapeSum / mapeN;

  return {
    precision,
    recall,
    mape,
    matched,
    expectedCount: expectedByKey.size,
    predictedCount: predictedByKey.size,
    unmatchedExpected,
    unmatchedPredicted,
    perItem,
    byDiscipline,
  };
}

function checkOne(actual, budget, tol, label, mode) {
  // mode: "floor" → actual >= budget*(1-tol); "ceil" → actual <= budget*(1+tol)
  if (typeof budget !== "number") return null;
  if (mode === "floor") {
    const floor = budget * (1 - tol);
    if (actual < floor) {
      return `${label} ${actual.toFixed(3)} < floor ${floor.toFixed(3)} (budget ${budget})`;
    }
  } else {
    const ceil = budget * (1 + tol);
    if (actual > ceil) {
      return `${label} ${actual.toFixed(3)} > ceiling ${ceil.toFixed(3)} (budget ${budget})`;
    }
  }
  return null;
}

/**
 * Compare a fixture score against its budget. Returns `{ passed, reasons[] }`.
 * Tolerance is applied lenient-side for floor metrics (precision/recall:
 * `actual >= floor - tolerance*floor`) and for ceiling metrics
 * (mape: `actual <= ceiling + tolerance*ceiling`).
 *
 * Per-trade thresholds live under `budget.byTrade.<disciplineCode>` and
 * are checked with the SAME tolerance. ANY per-trade regression fails
 * the fixture, so a strong overall score can't mask a single bad trade.
 */
export function compareToBudget(score, budget, regressionTolerance = 0.15) {
  const reasons = [];
  const tol = regressionTolerance;
  const overallChecks = [
    checkOne(score.precision, budget.minPrecision, tol, "precision", "floor"),
    checkOne(score.recall, budget.minRecall, tol, "recall", "floor"),
    checkOne(score.mape, budget.maxMape, tol, "mape", "ceil"),
  ].filter(Boolean);
  reasons.push(...overallChecks);

  if (budget.byTrade && typeof budget.byTrade === "object") {
    for (const [disc, tradeBudget] of Object.entries(budget.byTrade)) {
      const tradeScore = score.byDiscipline?.[disc];
      if (!tradeScore) {
        reasons.push(`[trade ${disc}] no scored items (expected discipline missing from fixture predictions)`);
        continue;
      }
      const tradeChecks = [
        checkOne(tradeScore.precision, tradeBudget.minPrecision, tol, `[trade ${disc}] precision`, "floor"),
        checkOne(tradeScore.recall, tradeBudget.minRecall, tol, `[trade ${disc}] recall`, "floor"),
        checkOne(tradeScore.mape, tradeBudget.maxMape, tol, `[trade ${disc}] mape`, "ceil"),
      ].filter(Boolean);
      reasons.push(...tradeChecks);
    }
  }
  return { passed: reasons.length === 0, reasons };
}
