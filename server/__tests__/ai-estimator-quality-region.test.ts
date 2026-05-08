// Task #2627 — Quality filter (LOST/CANCELLED bid exclusion) + region
// multiplier coverage on top of the learned-rates store.
//
// Locks in:
//   • LOST + CANCELLED bid samples are dropped from `summarizeRate`
//     when `excludeCancelledLostJobs` is on (default).
//   • Disabling the org factor brings the samples back in.
//   • `applyRegionMultiplier` scales numeric values; `null` stays `null`.
//   • `summarizeRate({ regionMultiplier })` adjusts point + range and
//     echoes the multiplier back so the UI can render the math.
//   • Region factor CRUD respects org isolation.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  bids,
  aiEstimatorOrgFactors,
} from "@shared/schema";
import {
  bulkRecordRateSamples,
  getLearnedRate,
  summarizeRate,
} from "../services/aiEstimator/learnedRates";
import {
  applyRegionMultiplier,
  createRegionFactor,
  listRegionFactors,
  updateRegionFactor,
  deleteRegionFactor,
} from "../services/aiEstimator/regionFactors";

const PREFIX = "__ai_est_qr__";

let orgId: string;
let otherOrgId: string;
let lostBidId: string;
let cancelledBidId: string;
let wonBidId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_region_factors WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_org_factors WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [a, b] = await db
    .insert(organizations)
    .values([
      { name: "QR Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "QR Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();
  orgId = a.id;
  otherOrgId = b.id;

  const [lost, cancelled, won] = await db
    .insert(bids)
    .values([
      { name: "Lost Bid", code: `${PREFIX}LOST-${stamp}`, clientName: "X", gcOrganizationId: orgId, status: "LOST" },
      { name: "Cancelled Bid", code: `${PREFIX}CXL-${stamp}`, clientName: "X", gcOrganizationId: orgId, status: "CANCELLED" },
      { name: "Won Bid", code: `${PREFIX}WON-${stamp}`, clientName: "X", gcOrganizationId: orgId, status: "AWARDED" },
    ])
    .returning();
  lostBidId = lost.id;
  cancelledBidId = cancelled.id;
  wonBidId = won.id;
}, 30_000);

afterAll(async () => {
  await cleanup();
});

describe("learnedRates — quality filter (Task #2627)", () => {
  it("drops samples whose bidId is LOST or CANCELLED when the org factor is on (default)", async () => {
    const lookup = { costCode: "QR-QUAL-1", metric: "unit_cost" as const, unit: "EA" };
    // 3 won-bid samples + 2 lost + 1 cancelled. With the filter on
    // (default), only the 3 won samples should land in the rate.
    const updated = await bulkRecordRateSamples(orgId, [
      { ...lookup, value: 100, bidId: wonBidId },
      { ...lookup, value: 110, bidId: wonBidId },
      { ...lookup, value: 120, bidId: wonBidId },
      { ...lookup, value: 999, bidId: lostBidId },
      { ...lookup, value: 999, bidId: lostBidId },
      { ...lookup, value: 999, bidId: cancelledBidId },
    ]);
    expect(updated).toBe(3);
    const row = await getLearnedRate(orgId, lookup);
    expect(row).not.toBeNull();
    expect(row!.sampleSize).toBe(3);
    const samples = (row!.recentSamples as number[]).sort((a, b) => a - b);
    expect(samples).toEqual([100, 110, 120]);
  });

  it("includes LOST/CANCELLED samples again when the filter is disabled", async () => {
    // Flip the org-level factor off.
    await db
      .insert(aiEstimatorOrgFactors)
      .values({ organizationId: orgId, excludeCancelledLostJobs: false })
      .onConflictDoUpdate({
        target: aiEstimatorOrgFactors.organizationId,
        set: { excludeCancelledLostJobs: false, updatedAt: new Date() },
      });

    const lookup = { costCode: "QR-QUAL-2", metric: "unit_cost" as const, unit: "EA" };
    const updated = await bulkRecordRateSamples(orgId, [
      { ...lookup, value: 100, bidId: wonBidId },
      { ...lookup, value: 200, bidId: lostBidId },
      { ...lookup, value: 300, bidId: cancelledBidId },
    ]);
    expect(updated).toBe(3);
    const row = await getLearnedRate(orgId, lookup);
    expect(row!.sampleSize).toBe(3);

    // Re-enable so subsequent tests see default behavior.
    await db
      .update(aiEstimatorOrgFactors)
      .set({ excludeCancelledLostJobs: true, updatedAt: new Date() })
      .where(sql`organization_id = ${orgId}`);
  });
});

describe("region multiplier (Task #2627)", () => {
  it("applyRegionMultiplier scales finite values and passes nulls through", () => {
    expect(applyRegionMultiplier(100, 1.15)).toBeCloseTo(115, 6);
    expect(applyRegionMultiplier(null, 1.15)).toBeNull();
    // Defensive: bogus multipliers leave the value untouched.
    expect(applyRegionMultiplier(100, 0)).toBe(100);
    expect(applyRegionMultiplier(100, -1)).toBe(100);
    expect(applyRegionMultiplier(100, Number.NaN)).toBe(100);
    expect(applyRegionMultiplier(100, undefined)).toBe(100);
  });

  it("summarizeRate({ regionMultiplier }) adjusts point + range and echoes the multiplier", async () => {
    const lookup = { costCode: "QR-REGION-1", metric: "unit_cost" as const, unit: "EA" };
    await bulkRecordRateSamples(orgId, [
      { ...lookup, value: 10, bidId: wonBidId },
      { ...lookup, value: 20, bidId: wonBidId },
      { ...lookup, value: 30, bidId: wonBidId },
      { ...lookup, value: 40, bidId: wonBidId },
      { ...lookup, value: 50, bidId: wonBidId },
    ]);
    const row = await getLearnedRate(orgId, lookup);
    expect(row).not.toBeNull();

    const baseline = summarizeRate(row);
    expect(baseline.regionMultiplier).toBe(1);
    expect(baseline.point).toBeCloseTo(30, 4);
    expect(baseline.range.low).toBeCloseTo(20, 4);
    expect(baseline.range.high).toBeCloseTo(40, 4);

    const adjusted = summarizeRate(row, { regionMultiplier: 1.25 });
    expect(adjusted.regionMultiplier).toBe(1.25);
    expect(adjusted.point).toBeCloseTo(37.5, 4);
    expect(adjusted.range.low).toBeCloseTo(25, 4);
    expect(adjusted.range.high).toBeCloseTo(50, 4);

    // Bogus multiplier falls back to no adjustment.
    const fallback = summarizeRate(row, { regionMultiplier: -1 });
    expect(fallback.point).toBeCloseTo(30, 4);
  });
});

describe("region factor CRUD (Task #2627)", () => {
  it("create / list / update / delete is org-scoped", async () => {
    const created = await createRegionFactor({
      organizationId: orgId,
      name: "Bay Area Metro",
      regionType: "METRO",
      code: "SFO",
      multiplier: 1.32,
      notes: "High cost-of-living adjustment",
      isActive: true,
      createdById: null,
      updatedById: null,
    });
    expect(created.id).toBeTruthy();
    expect(created.multiplier).toBeCloseTo(1.32, 4);

    // Different org must NOT see this row.
    const otherOrgList = await listRegionFactors(otherOrgId);
    expect(otherOrgList.find((r) => r.id === created.id)).toBeUndefined();

    const aList = await listRegionFactors(orgId);
    expect(aList.some((r) => r.id === created.id)).toBe(true);

    const patched = await updateRegionFactor(orgId, created.id, { multiplier: 1.4 });
    expect(patched).not.toBeNull();
    expect(patched!.multiplier).toBeCloseTo(1.4, 4);

    // Cross-tenant update returns null (no row matched).
    const crossUpdate = await updateRegionFactor(otherOrgId, created.id, { multiplier: 9 });
    expect(crossUpdate).toBeNull();

    await deleteRegionFactor(orgId, created.id);
    const after = await listRegionFactors(orgId, { includeArchived: true });
    expect(after.find((r) => r.id === created.id)).toBeUndefined();
  });

  it("listRegionFactors hides archived rows by default but exposes them with includeArchived", async () => {
    const archived = await createRegionFactor({
      organizationId: orgId,
      name: "Legacy Region",
      regionType: "CUSTOM",
      code: null,
      multiplier: 1.05,
      notes: null,
      isActive: false,
      createdById: null,
      updatedById: null,
    });
    const visible = await listRegionFactors(orgId);
    expect(visible.find((r) => r.id === archived.id)).toBeUndefined();
    const all = await listRegionFactors(orgId, { includeArchived: true });
    expect(all.find((r) => r.id === archived.id)).toBeDefined();
    await deleteRegionFactor(orgId, archived.id);
  });
});
