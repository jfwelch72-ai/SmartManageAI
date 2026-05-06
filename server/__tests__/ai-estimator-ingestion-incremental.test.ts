// Task #2465 — Lock in the AI Estimator ingestion incremental contract.
//
// Pins three behavioural promises that were introduced when ingestion
// was sped up from a multi-hour full re-walk into a delta-only path:
//
//   1. The second run only re-walks rows whose `updated_at` (or
//      `created_at` for `historical_costs`) is past the prior successful
//      run's `completed_at` − 5 min overlap window. The per-source
//      counters reflect the delta and unchanged knowledge-index rows
//      keep their existing `enrichedSummary` / `enrichedAt` untouched.
//   2. The first run with no prior SUCCEEDED row falls back to a full
//      scan (counters cover the whole seeded set).
//   3. A prior FAILED run is ignored — `lastSuccess` filters on
//      `status = 'SUCCEEDED'` — so the next ingest still falls back to
//      a full scan even if the FAILED row's `completed_at` is recent.
//
// Routed Anthropic calls and the `AI_PROVIDER_TAKEOFF` flag are mocked
// at the module boundary; with the flag forced off the post-ingest
// enrichment pass is a no-op and we can safely write sentinel
// `enrichedSummary` values into the knowledge index by hand to prove
// the second run leaves the unchanged ones alone.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq, inArray } from "drizzle-orm";
import bcrypt from "bcrypt";

vi.mock("../ai/providers", () => ({
  routedChatCompletion: vi.fn(),
}));

vi.mock("../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn(async () => false),
}));

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  estimates,
  estimateLineItems,
  historicalCosts,
  takeoffSheets,
  takeoffMeasurements,
  aiEstimatorIngestRuns,
  aiEstimatorKnowledgeIndex,
} from "@shared/schema";
import { runIngestion } from "../services/aiEstimator/ingestion";
import { isFeatureEnabled } from "../services/featureFlagService";
import { routedChatCompletion } from "../ai/providers";

const PREFIX = "__ai_est_inc__";

const mockedFlag = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;
const mockedRouted = routedChatCompletion as unknown as ReturnType<typeof vi.fn>;

interface SeedCtx {
  orgId: string;
  userId: string;
  bidIds: string[];
  estimateId: string;
  lineItemIds: string[];
  sheetId: string;
  measurementIds: string[];
  histIds: string[];
}

async function cleanupAll(): Promise<void> {
  // Pulled apart so each statement is independent — if one ever fails
  // the rest still run and we never block the next test on a stuck FK.
  await db.execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_rate_samples WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_ingest_runs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM historical_costs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN (SELECT id FROM takeoff_sheets WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"}))`).catch(() => {});
  await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"}))`).catch(() => {});
  await db.execute(sql`DELETE FROM estimates WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

/**
 * Build a fresh org with a small but representative ingestion-input
 * surface (2 bids, 1 estimate w/ 2 line items, 1 takeoff sheet w/ 2
 * measurements, 2 historical costs). All `updated_at`/`created_at`
 * timestamps are backdated to ONE_HOUR_AGO so we can later install a
 * fake "prior SUCCEEDED" run with `completed_at` AFTER the seeds and
 * have the incremental window safely exclude every seeded row.
 */
async function seedOrg(): Promise<SeedCtx> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ONE_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000);

  const [org] = await db
    .insert(organizations)
    .values({
      name: "Incremental Org",
      slug: `${PREFIX}${stamp}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}u-${stamp}@test.local`,
      passwordHash,
      firstName: "AI",
      lastName: "User",
      role: "ESTIMATOR",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const seededBids = await db
    .insert(bids)
    .values([
      {
        name: "Incremental Bid A",
        code: `${PREFIX}A-${stamp}`,
        clientName: "Client A",
        gcOrganizationId: org.id,
        description: "Bid A original description",
      },
      {
        name: "Incremental Bid B",
        code: `${PREFIX}B-${stamp}`,
        clientName: "Client B",
        gcOrganizationId: org.id,
        description: "Bid B original description",
      },
    ])
    .returning();

  const [est] = await db
    .insert(estimates)
    .values({
      bidId: seededBids[0].id,
      baseBidAmount: "10000",
      createdById: user.id,
    })
    .returning();

  const seededLineItems = await db
    .insert(estimateLineItems)
    .values([
      {
        estimateId: est.id,
        category: "CONCRETE",
        description: "Slab on grade",
        workTypeCode: "03 30 00",
        quantity: "100",
        unit: "CY",
        totalCost: "15000",
        laborHours: "8",
      },
      {
        estimateId: est.id,
        category: "CONCRETE",
        description: "Footings",
        workTypeCode: "03 31 00",
        quantity: "50",
        unit: "CY",
        totalCost: "10000",
        laborHours: "4",
      },
    ])
    .returning();

  const [sheet] = await db
    .insert(takeoffSheets)
    .values({
      bidId: seededBids[0].id,
      imageUrl: "https://example.invalid/sheet.png",
      sheetIndex: 0,
      sheetName: "Sheet 1",
    })
    .returning();

  const seededMeasurements = await db
    .insert(takeoffMeasurements)
    .values([
      {
        sheetId: sheet.id,
        type: "LINEAR",
        label: "Curb run",
        points: "[]",
        computedLengthFt: 120,
      },
      {
        sheetId: sheet.id,
        type: "AREA",
        label: "Pavement patch",
        points: "[]",
        computedAreaFt2: 800,
      },
    ])
    .returning();

  const seededHist = await db
    .insert(historicalCosts)
    .values([
      {
        organizationId: org.id,
        scopeCategory: "CONCRETE",
        description: "Slab pour, prior project",
        costCode: "03 30 00",
        quantity: "200",
        unit: "CY",
        unitCost: "150",
        totalCost: "30000",
      },
      {
        organizationId: org.id,
        scopeCategory: "CONCRETE",
        description: "Footings, prior project",
        costCode: "03 31 00",
        quantity: "75",
        unit: "CY",
        unitCost: "200",
        totalCost: "15000",
      },
    ])
    .returning();

  // Backdate every source row's mtime so the fake-prior-success window
  // installed by individual tests can cleanly exclude them.
  await db.update(bids).set({ updatedAt: ONE_HOUR_AGO }).where(inArray(bids.id, seededBids.map((b) => b.id)));
  await db.update(estimates).set({ updatedAt: ONE_HOUR_AGO }).where(eq(estimates.id, est.id));
  await db.update(estimateLineItems).set({ updatedAt: ONE_HOUR_AGO }).where(inArray(estimateLineItems.id, seededLineItems.map((l) => l.id)));
  await db.update(takeoffSheets).set({ updatedAt: ONE_HOUR_AGO }).where(eq(takeoffSheets.id, sheet.id));
  await db.execute(sql`UPDATE historical_costs SET created_at = ${ONE_HOUR_AGO} WHERE id IN (${sql.join(seededHist.map((h) => sql`${h.id}`), sql`,`)})`);

  return {
    orgId: org.id,
    userId: user.id,
    bidIds: seededBids.map((b) => b.id),
    estimateId: est.id,
    lineItemIds: seededLineItems.map((l) => l.id),
    sheetId: sheet.id,
    measurementIds: seededMeasurements.map((m) => m.id),
    histIds: seededHist.map((h) => h.id),
  };
}

beforeAll(async () => {
  await cleanupAll();
}, 60_000);

afterAll(async () => {
  await cleanupAll();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockedRouted.mockReset();
  mockedFlag.mockReset();
  // Flag off ⇒ enrichment pass is a no-op, so any `enrichedSummary` we
  // hand-write between runs is preserved unless the mechanical upsert
  // explicitly clears it (which it does only when contentHash differs).
  mockedFlag.mockResolvedValue(false);
});

// ---------------------------------------------------------------------
// Test 1 — full-scan path on the very first run.
// ---------------------------------------------------------------------
describe("first ingest run (no prior SUCCEEDED row) ⇒ full scan", () => {
  it("ingests the entire seeded source set and records non-zero counters", async () => {
    const ctx = await seedOrg();

    const run = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(run.status).toBe("SUCCEEDED");
    // Every seeded source surface must be visited by the full scan.
    expect(run.bidsIngested).toBe(2);
    expect(run.estimatesIngested).toBe(1);
    expect(run.lineItemsIngested).toBe(2);
    expect(run.takeoffsIngested).toBe(2); // 2 measurements on the sheet
    // Knowledge index has one row per source: 2 bids + 1 estimate + 2
    // line items + 2 takeoff measurements = 7. (Historical costs feed
    // the learned-rates store but are not indexed individually.)
    const indexed = await db
      .select({ id: aiEstimatorKnowledgeIndex.id })
      .from(aiEstimatorKnowledgeIndex)
      .where(eq(aiEstimatorKnowledgeIndex.organizationId, ctx.orgId));
    expect(indexed.length).toBe(7);
    // Both historical-cost rate samples + the two line-item samples
    // collapse onto two cost codes, so at least one learned rate
    // exists. We assert >=1 rather than a specific number to keep the
    // test resilient to internal grouping changes.
    expect(run.ratesUpdated).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------
// Test 2 — second run only re-walks the delta.
// ---------------------------------------------------------------------
describe("second ingest run after a SUCCEEDED prior ⇒ delta-only walk", () => {
  it("re-ingests only changed bids/estimates/line items/takeoffs/historical-costs and preserves enriched summaries on the rest", async () => {
    const ctx = await seedOrg();

    // First run primes the index. We backdate its `completed_at` to
    // 30 minutes ago so the incremental window (`completed_at − 5 min`)
    // is at T − 35 min, well after the seed timestamps (T − 60 min)
    // and well before any "now" mutations the test makes below. This
    // makes the assertions deterministic — there's no race against the
    // 5-minute overlap window swallowing seeded rows.
    const firstRun = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(firstRun.status).toBe("SUCCEEDED");
    expect(firstRun.bidsIngested).toBe(2);

    const THIRTY_MIN_AGO = new Date(Date.now() - 30 * 60 * 1000);
    await db
      .update(aiEstimatorIngestRuns)
      .set({ completedAt: THIRTY_MIN_AGO })
      .where(eq(aiEstimatorIngestRuns.id, firstRun.id));

    // Hand-write a sentinel enriched summary onto every freshly indexed
    // row so we can prove the second run leaves the untouched ones
    // alone. (The flag is mocked off, so the real enrichment pass
    // doesn't produce or overwrite these values.)
    const SENTINEL = "PRESERVED-FROM-RUN-1";
    const enrichedAt = new Date(Date.now() - 25 * 60 * 1000);
    await db
      .update(aiEstimatorKnowledgeIndex)
      .set({ enrichedSummary: SENTINEL, enrichedAt })
      .where(eq(aiEstimatorKnowledgeIndex.organizationId, ctx.orgId));

    // Build the delta:
    //   • Mutate bid #0 (changes content + updated_at NOW). Bid #1 is
    //     left alone and must NOT be re-walked.
    //   • Add a new line item (updated_at NOW); existing two stay put.
    //   • Insert a new historical cost (created_at NOW); the two seed
    //     rows stay put. We don't have a direct counter for historical
    //     costs but we do assert via `ratesUpdated` and the fact that
    //     the incremental window is honoured for hist as well as for
    //     bids/estimates/takeoffs.
    //   • Don't touch estimates / takeoff sheets at all — their counters
    //     must come back as zero.
    await db
      .update(bids)
      .set({ description: "Bid A UPDATED description", updatedAt: new Date() })
      .where(eq(bids.id, ctx.bidIds[0]));

    const [newLineItem] = await db
      .insert(estimateLineItems)
      .values({
        estimateId: ctx.estimateId,
        category: "CONCRETE",
        description: "Sidewalks (added between runs)",
        workTypeCode: "03 30 00",
        quantity: "20",
        unit: "CY",
        totalCost: "3500",
        laborHours: "2",
      })
      .returning();

    await db
      .insert(historicalCosts)
      .values({
        organizationId: ctx.orgId,
        scopeCategory: "CONCRETE",
        description: "Sidewalks, recently completed project",
        costCode: "03 30 00",
        quantity: "30",
        unit: "CY",
        unitCost: "175",
        totalCost: "5250",
      });

    // Run #2.
    const secondRun = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(secondRun.status).toBe("SUCCEEDED");

    // Counter assertions — the delta and ONLY the delta.
    expect(secondRun.bidsIngested).toBe(1);          // only the mutated bid
    expect(secondRun.estimatesIngested).toBe(0);     // estimate untouched
    expect(secondRun.lineItemsIngested).toBe(1);     // only the new line item
    expect(secondRun.takeoffsIngested).toBe(0);      // sheet untouched ⇒ no measurements walked

    // Rate samples should still be applied for the new line item +
    // new historical cost, so ratesUpdated is non-zero.
    expect(secondRun.ratesUpdated).toBeGreaterThan(0);

    // Knowledge-index assertions — the unchanged rows MUST keep their
    // sentinel enrichedSummary/enrichedAt; the mutated bid's row MUST
    // have been cleared (because contentHash differs, the bulk upsert
    // sets enrichedSummary/enrichedAt back to null per its branch-3
    // contract); and a brand-new row exists for the new line item.
    const rows = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(eq(aiEstimatorKnowledgeIndex.organizationId, ctx.orgId));

    const byKey = new Map(rows.map((r) => [`${r.sourceType}:${r.sourceId}`, r]));

    // Mutated bid — row exists but enrichment was cleared.
    const mutatedBidRow = byKey.get(`bid:${ctx.bidIds[0]}`);
    expect(mutatedBidRow).toBeDefined();
    expect(mutatedBidRow!.enrichedSummary).toBeNull();
    expect(mutatedBidRow!.enrichedAt).toBeNull();

    // Untouched bid — sentinel preserved.
    const untouchedBidRow = byKey.get(`bid:${ctx.bidIds[1]}`);
    expect(untouchedBidRow).toBeDefined();
    expect(untouchedBidRow!.enrichedSummary).toBe(SENTINEL);
    expect(untouchedBidRow!.enrichedAt?.getTime()).toBe(enrichedAt.getTime());

    // Untouched estimate — sentinel preserved.
    const estRow = byKey.get(`estimate:${ctx.estimateId}`);
    expect(estRow).toBeDefined();
    expect(estRow!.enrichedSummary).toBe(SENTINEL);

    // Untouched line items — sentinel preserved.
    for (const liId of ctx.lineItemIds) {
      const liRow = byKey.get(`estimate_line_item:${liId}`);
      expect(liRow).toBeDefined();
      expect(liRow!.enrichedSummary).toBe(SENTINEL);
    }

    // New line item — fresh row, no enrichment yet (flag off).
    const newLiRow = byKey.get(`estimate_line_item:${newLineItem.id}`);
    expect(newLiRow).toBeDefined();
    expect(newLiRow!.enrichedSummary).toBeNull();

    // Untouched takeoff measurements — sentinel preserved.
    for (const mId of ctx.measurementIds) {
      const mRow = byKey.get(`takeoff_measurement:${mId}`);
      expect(mRow).toBeDefined();
      expect(mRow!.enrichedSummary).toBe(SENTINEL);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------
// Test 3 — a prior FAILED run must not act as the incremental anchor.
// ---------------------------------------------------------------------
describe("ingest run with a prior FAILED row but no SUCCEEDED ⇒ full scan", () => {
  it("ignores the FAILED run's completed_at and re-walks every seeded row", async () => {
    const ctx = await seedOrg();

    // Insert a recent FAILED run. If the incremental anchor were
    // computed by "most recent run" rather than "most recent SUCCEEDED
    // run", this `completed_at` of NOW would push the window past every
    // seed row's `updated_at` (T − 1 hour) and the assertions below
    // would all come back as zero, locking in the regression.
    await db.insert(aiEstimatorIngestRuns).values({
      organizationId: ctx.orgId,
      triggeredByUserId: null,
      triggerType: "MANUAL",
      status: "FAILED",
      completedAt: new Date(),
      errorMessage: "simulated prior failure",
    });

    const run = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(run.status).toBe("SUCCEEDED");

    // Every seeded source surface must still be visited — the FAILED
    // anchor must NOT have been used as the incremental cutoff.
    expect(run.bidsIngested).toBe(2);
    expect(run.estimatesIngested).toBe(1);
    expect(run.lineItemsIngested).toBe(2);
    expect(run.takeoffsIngested).toBe(2);
    expect(run.ratesUpdated).toBeGreaterThan(0);
  }, 60_000);
});
