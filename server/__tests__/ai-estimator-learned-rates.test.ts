// Task #2340 — Unit coverage for `server/services/aiEstimator/learnedRates.ts`.
//
// Locks in:
//   • `recordRateSample` inserts a fresh row with correct stats on first sample
//   • Subsequent samples are appended and the percentiles / mean / median update
//   • `recentSamples` is capped at MAX_SAMPLES (200)
//   • `bulkRecordRateSamples` filters out invalid updates
//   • `summarizeRate` returns the median (or mean fallback) and IQR range
//   • `listLearnedRatesForOrg` is org-scoped and ordered by costCode
//   • Non-finite values are silently skipped (never break the row)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { organizations, aiEstimatorLearnedRates } from "@shared/schema";
import {
  bulkRecordRateSamples,
  getLearnedRate,
  listLearnedRatesForOrg,
  recordRateSample,
  summarizeRate,
} from "../services/aiEstimator/learnedRates";

const PREFIX = "__ai_est_rates__";

let orgId: string;
let otherOrgId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [a, b] = await db
    .insert(organizations)
    .values([
      { name: "Rates Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "Rates Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();
  orgId = a.id;
  otherOrgId = b.id;
}, 30_000);

afterAll(async () => {
  await cleanup();
});

describe("learnedRates — recordRateSample", () => {
  it("creates a row on first sample with single-value statistics", async () => {
    const lookup = { costCode: "03 30 00", metric: "unit_cost" as const, unit: "CY" };
    const row = await recordRateSample(orgId, { ...lookup, value: 250 });
    expect(row.sampleSize).toBe(1);
    expect(Number(row.meanValue)).toBeCloseTo(250, 4);
    expect(Number(row.medianValue)).toBeCloseTo(250, 4);
    expect(Number(row.minValue)).toBeCloseTo(250, 4);
    expect(Number(row.maxValue)).toBeCloseTo(250, 4);
    expect(Array.isArray(row.recentSamples)).toBe(true);
    expect((row.recentSamples as number[]).length).toBe(1);
    expect(row.lastSourceType).toBe("feedback_event");
  });

  it("updates the existing row in place — does not create a duplicate", async () => {
    const lookup = { costCode: "03 30 00", metric: "unit_cost" as const, unit: "CY" };
    await recordRateSample(orgId, { ...lookup, value: 350 });
    await recordRateSample(orgId, { ...lookup, value: 450, sourceType: "estimate_line_item" });

    const found = await getLearnedRate(orgId, lookup);
    expect(found).not.toBeNull();
    expect(found!.sampleSize).toBe(3);
    expect((found!.recentSamples as number[]).sort((a, b) => a - b)).toEqual([250, 350, 450]);
    // Mean = 350, median = 350 for [250, 350, 450].
    expect(Number(found!.meanValue)).toBeCloseTo(350, 4);
    expect(Number(found!.medianValue)).toBeCloseTo(350, 4);
    expect(Number(found!.minValue)).toBeCloseTo(250, 4);
    expect(Number(found!.maxValue)).toBeCloseTo(450, 4);
    expect(found!.lastSourceType).toBe("estimate_line_item");
  });

  it("computes correct p25/p75 percentiles via linear interpolation", async () => {
    const lookup = { costCode: "31 23 00", metric: "production_rate" as const, unit: "CY" };
    for (const v of [100, 200, 300, 400, 500]) {
      await recordRateSample(orgId, { ...lookup, value: v });
    }
    const row = await getLearnedRate(orgId, lookup);
    expect(row).not.toBeNull();
    // For sorted [100,200,300,400,500]: p25 → 200, median → 300, p75 → 400.
    expect(Number(row!.p25Value)).toBeCloseTo(200, 4);
    expect(Number(row!.medianValue)).toBeCloseTo(300, 4);
    expect(Number(row!.p75Value)).toBeCloseTo(400, 4);
  });

  it("caps recentSamples at MAX_SAMPLES (200) using a FIFO trim", async () => {
    const lookup = { costCode: "32 12 16", metric: "labor_hours_per_unit" as const, unit: "SY" };
    for (let i = 1; i <= 205; i++) {
      await recordRateSample(orgId, { ...lookup, value: i });
    }
    const row = await getLearnedRate(orgId, lookup);
    expect(row).not.toBeNull();
    const samples = row!.recentSamples as number[];
    expect(samples.length).toBe(200);
    // The 5 oldest entries (1..5) must have been dropped; the newest (205) is kept.
    expect(samples.includes(1)).toBe(false);
    expect(samples.includes(5)).toBe(false);
    expect(samples.includes(205)).toBe(true);
    expect(row!.sampleSize).toBe(200);
  });

  it("skips non-finite values without breaking the row", async () => {
    const lookup = { costCode: "31 22 13", metric: "unit_cost" as const, unit: "CY" };
    await recordRateSample(orgId, { ...lookup, value: 100 });
    await recordRateSample(orgId, { ...lookup, value: Number.NaN });
    const row = await getLearnedRate(orgId, lookup);
    expect(row).not.toBeNull();
    expect(row!.sampleSize).toBe(1);
    expect(Number(row!.meanValue)).toBeCloseTo(100, 4);
  });
});

describe("learnedRates — bulkRecordRateSamples", () => {
  it("returns the number of valid samples it actually applied", async () => {
    const updates = [
      { costCode: "03 31 00", metric: "unit_cost" as const, unit: "CY", value: 200 },
      { costCode: "03 31 00", metric: "unit_cost" as const, unit: "CY", value: Number.POSITIVE_INFINITY }, // skipped
      { costCode: "", metric: "unit_cost" as const, unit: "CY", value: 1 },                                // skipped
      { costCode: "03 31 00", metric: "unit_cost" as const, unit: "", value: 1 },                          // skipped
      { costCode: "03 31 00", metric: "unit_cost" as const, unit: "CY", value: 220 },
    ];
    const updated = await bulkRecordRateSamples(orgId, updates);
    expect(updated).toBe(2);
    const row = await getLearnedRate(orgId, { costCode: "03 31 00", metric: "unit_cost", unit: "CY" });
    expect(row).not.toBeNull();
    expect(row!.sampleSize).toBe(2);
  });
});

describe("learnedRates — listLearnedRatesForOrg + summarizeRate", () => {
  it("returns rows scoped to the requested org only", async () => {
    await recordRateSample(orgId, { costCode: "ZZZ-ORG-A", metric: "unit_cost", unit: "EA", value: 12 });
    await recordRateSample(otherOrgId, { costCode: "ZZZ-ORG-B", metric: "unit_cost", unit: "EA", value: 45 });

    const aRows = await listLearnedRatesForOrg(orgId);
    const bRows = await listLearnedRatesForOrg(otherOrgId);

    expect(aRows.some((r) => r.costCode === "ZZZ-ORG-A")).toBe(true);
    expect(aRows.some((r) => r.costCode === "ZZZ-ORG-B")).toBe(false);
    expect(bRows.some((r) => r.costCode === "ZZZ-ORG-B")).toBe(true);
    expect(bRows.some((r) => r.costCode === "ZZZ-ORG-A")).toBe(false);
  });

  it("summarizeRate returns nulls for a missing rate", () => {
    // Task #2627 — summary now also carries the applied region
    // multiplier (1 == no adjustment) so the UI can render the math.
    expect(summarizeRate(null)).toEqual({
      point: null,
      range: { low: null, high: null },
      n: 0,
      regionMultiplier: 1,
    });
  });

  it("summarizeRate prefers median for the point value and IQR for the range", async () => {
    const lookup = { costCode: "ZZZ-SUMMARY", metric: "unit_cost" as const, unit: "EA" };
    for (const v of [10, 20, 30, 40, 50]) {
      await recordRateSample(orgId, { ...lookup, value: v });
    }
    const row = await getLearnedRate(orgId, lookup);
    const summary = summarizeRate(row);
    expect(summary.n).toBe(5);
    expect(summary.point).toBeCloseTo(30, 4);
    expect(summary.range.low).toBeCloseTo(20, 4);
    expect(summary.range.high).toBeCloseTo(40, 4);
  });
});
