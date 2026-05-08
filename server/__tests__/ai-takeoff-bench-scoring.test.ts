// Task #2622 — per-trade scoring & budget enforcement guard.
// Proves that the AI takeoff regression bench fails the OVERALL fixture
// when ANY single trade regresses past tolerance, even if the other
// trades still pass. This is the masking-prevention guarantee called
// out in the task acceptance criteria.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs sibling, no .d.ts
import { scorePredictions, compareToBudget } from "../../loadtests/ai-takeoff-bench/lib/scoring.mjs";

const expected = [
  { label: "VAV box", type: "COUNT", unit: "EA", value: 8, discipline: "M", tolerancePercent: 0 },
  { label: "Supply ductwork 12\"", type: "LINEAR", unit: "LF", value: 420, discipline: "M", tolerancePercent: 10 },
  { label: "Sink fixture", type: "COUNT", unit: "EA", value: 6, discipline: "P", tolerancePercent: 0 },
  { label: "Water closet", type: "COUNT", unit: "EA", value: 4, discipline: "P", tolerancePercent: 0 },
];

describe("ai-takeoff-bench scoring (per-trade)", () => {
  it("partitions precision/recall/MAPE by discipline", () => {
    const predicted = [
      { label: "VAV box", type: "COUNT", unit: "EA", value: 8, discipline: "M" },
      { label: "Supply ductwork 12\"", type: "LINEAR", unit: "LF", value: 420, discipline: "M" },
      { label: "Sink fixture", type: "COUNT", unit: "EA", value: 6, discipline: "P" },
      { label: "Water closet", type: "COUNT", unit: "EA", value: 4, discipline: "P" },
    ];
    const score = scorePredictions(expected, predicted);
    expect(score.byDiscipline.M.recall).toBe(1);
    expect(score.byDiscipline.P.recall).toBe(1);
    expect(score.byDiscipline.M.mape).toBe(0);
    expect(score.byDiscipline.P.mape).toBe(0);
  });

  it("a per-trade regression fails the fixture even when overall passes (M strong, P weak)", () => {
    // Mechanical perfect; plumbing misses 3 of 2 expected items (75%
    // recall would be marginal — we miss BOTH plumbing items here).
    const predicted = [
      { label: "VAV box", type: "COUNT", unit: "EA", value: 8, discipline: "M" },
      { label: "Supply ductwork 12\"", type: "LINEAR", unit: "LF", value: 420, discipline: "M" },
      // Plumbing items missing entirely.
    ];
    const score = scorePredictions(expected, predicted);
    // Overall recall is 2/4 = 0.5 — so overall already fails too.
    // The KEY assertion is that the failure REASONS surface the
    // per-trade plumbing miss explicitly, not just the overall number.
    const cmp = compareToBudget(
      score,
      {
        minPrecision: 0.50, minRecall: 0.50, maxMape: 0.20,
        byTrade: {
          M: { minRecall: 0.80, maxMape: 0.10 },
          P: { minRecall: 0.80, maxMape: 0.10 },
        },
      },
      0.15,
    );
    expect(cmp.passed).toBe(false);
    expect(cmp.reasons.some((r: string) => r.includes("[trade P] recall"))).toBe(true);
    expect(cmp.reasons.some((r: string) => r.includes("[trade M]"))).toBe(false);
  });

  it("a per-trade regression fails even when overall is INSIDE tolerance", () => {
    // 3 of 4 items match → overall recall = 0.75. Overall budget set
    // very loose (0.50). Per-trade plumbing budget tighter (0.80).
    // Plumbing missed 1 of 2 (recall=0.5) → trade fails, fixture fails.
    const predicted = [
      { label: "VAV box", type: "COUNT", unit: "EA", value: 8, discipline: "M" },
      { label: "Supply ductwork 12\"", type: "LINEAR", unit: "LF", value: 420, discipline: "M" },
      { label: "Sink fixture", type: "COUNT", unit: "EA", value: 6, discipline: "P" },
      // Water closet missing.
    ];
    const score = scorePredictions(expected, predicted);
    expect(score.recall).toBeGreaterThanOrEqual(0.74);
    const cmp = compareToBudget(
      score,
      {
        // Overall thresholds intentionally loose so they would pass.
        minPrecision: 0.50, minRecall: 0.50, maxMape: 0.50,
        byTrade: {
          M: { minRecall: 0.80, maxMape: 0.10 },
          P: { minRecall: 0.80, maxMape: 0.10 },
        },
      },
      0.15,
    );
    expect(cmp.passed).toBe(false);
    // Mechanical bucket should NOT trigger — only plumbing.
    const plumbingFailures = cmp.reasons.filter((r: string) => r.includes("[trade P]"));
    const mechFailures = cmp.reasons.filter((r: string) => r.includes("[trade M]"));
    expect(plumbingFailures.length).toBeGreaterThan(0);
    expect(mechFailures.length).toBe(0);
  });

  it("attributes unmatched predictions to a stable _unattributed bucket", () => {
    const predicted = [
      { label: "VAV box", type: "COUNT", unit: "EA", value: 8, discipline: "M" },
      { label: "Phantom item", type: "COUNT", unit: "EA", value: 99 }, // no discipline
    ];
    const score = scorePredictions(expected, predicted);
    expect(score.byDiscipline._unattributed).toBeDefined();
    expect(score.byDiscipline._unattributed.predictedCount).toBe(1);
    expect(score.byDiscipline._unattributed.matched).toBe(0);
  });

  it("seeds buckets for every expected discipline so an empty trade still surfaces", () => {
    // No predictions at all — both M and P should be present with recall=0.
    const score = scorePredictions(expected, []);
    expect(score.byDiscipline.M).toBeDefined();
    expect(score.byDiscipline.P).toBeDefined();
    expect(score.byDiscipline.M.recall).toBe(0);
    expect(score.byDiscipline.P.recall).toBe(0);
  });
});
