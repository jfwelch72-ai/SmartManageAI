// Task #2628 — AI takeoff calibration feedback loop.
//
// Pins the aggregator + prompt-injection helpers:
//
//   1. `runCalibrationAggregatorForOrg` curates exemplars (ACCEPTED /
//      EDITED / REJECTED), proposes a `quantity_bias` PENDING nudge
//      when the team consistently scaled AI quantities away from 1.0x,
//      and writes a daily accuracy snapshot row (per trade + overall).
//   2. Re-running the aggregator is idempotent — no duplicate PENDING
//      nudge, no duplicate snapshot for the same UTC day.
//   3. `acceptCalibrationNudge` writes the factor into
//      `ai_estimator_org_factors.tradeCalibrationFactors` and
//      `formatTradeCalibrationFactorsForPrompt` surfaces it.
//   4. `formatExemplarsForPrompt` renders the curated set in a shape
//      the LLM prompt can lean on.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  aiTakeoffAnalyses,
  aiTakeoffSuggestions,
  aiEstimatorCalibrationExemplars,
  aiEstimatorCalibrationNudges,
  aiEstimatorAccuracySnapshots,
  aiEstimatorOrgFactors,
} from "@shared/schema";
import {
  runCalibrationAggregatorForOrg,
  loadCalibrationExemplars,
  formatExemplarsForPrompt,
  loadTradeCalibrationFactors,
  formatTradeCalibrationFactorsForPrompt,
  acceptCalibrationNudge,
  rejectCalibrationNudge,
  listPendingNudges,
} from "../services/aiEstimator/calibrationLoop";

const PREFIX = "__aicalibloop__";

let orgId: string;
let userId: string;
let analysisId: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;
  await db
    .delete(aiEstimatorCalibrationExemplars)
    .where(inArray(aiEstimatorCalibrationExemplars.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(aiEstimatorCalibrationNudges)
    .where(inArray(aiEstimatorCalibrationNudges.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(aiEstimatorAccuracySnapshots)
    .where(inArray(aiEstimatorAccuracySnapshots.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(aiEstimatorOrgFactors)
    .where(inArray(aiEstimatorOrgFactors.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(aiTakeoffSuggestions)
    .where(inArray(aiTakeoffSuggestions.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(aiTakeoffAnalyses)
    .where(inArray(aiTakeoffAnalyses.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(users)
    .where(inArray(users.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(organizations)
    .where(inArray(organizations.id, orgIds))
    .catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: "AI Calibration Loop Org",
      slug,
      tradeType: "ELECTRICAL",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash: await bcrypt.hash("TestPass123!", 10),
      firstName: "Calib",
      lastName: "Reviewer",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    })
    .returning();
  userId = user.id;

  const [analysis] = await db
    .insert(aiTakeoffAnalyses)
    .values({
      organizationId: orgId,
      tradeType: "ELECTRICAL",
      status: "COMPLETE",
      analysisMode: "QUICK",
      createdByUserId: userId,
    })
    .returning();
  analysisId = analysis.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(async () => {
  await db.delete(aiEstimatorCalibrationExemplars).where(eq(aiEstimatorCalibrationExemplars.organizationId, orgId));
  await db.delete(aiEstimatorCalibrationNudges).where(eq(aiEstimatorCalibrationNudges.organizationId, orgId));
  await db.delete(aiEstimatorAccuracySnapshots).where(eq(aiEstimatorAccuracySnapshots.organizationId, orgId));
  await db.delete(aiEstimatorOrgFactors).where(eq(aiEstimatorOrgFactors.organizationId, orgId));
  await db.delete(aiTakeoffSuggestions).where(eq(aiTakeoffSuggestions.organizationId, orgId));
});

let seedCounter = 0;
async function seedSuggestion(opts: {
  status: "ACCEPTED" | "EDITED" | "REJECTED";
  quantity?: number;
  editedQuantity?: number | null;
  description?: string;
  rejectReason?: "WRONG_TRADE" | "DUPLICATE" | "NOT_PRESENT" | "WRONG_QUANTITY" | "WRONG_LOCATION" | "OTHER";
  reviewedAt?: Date;
  tradeType?:
    | "ELECTRICAL"
    | "PLUMBING";
}): Promise<string> {
  seedCounter += 1;
  const [row] = await db
    .insert(aiTakeoffSuggestions)
    .values({
      analysisId,
      organizationId: orgId,
      tradeType: opts.tradeType ?? "ELECTRICAL",
      itemKey: `loop-seed-${seedCounter}`,
      itemType: "outlet",
      description: opts.description ?? "Duplex outlet on east wall",
      quantity: opts.quantity ?? 10,
      unit: "EA",
      confidence: 80,
      status: opts.status,
      reviewedByUserId: userId,
      reviewedAt: opts.reviewedAt ?? new Date(),
      editedQuantity: opts.editedQuantity ?? null,
      rejectReason: opts.rejectReason,
    })
    .returning();
  return row.id;
}

describe("AI takeoff calibration feedback loop", () => {
  it("curates exemplars across ACCEPTED / EDITED / REJECTED kinds", async () => {
    await seedSuggestion({ status: "ACCEPTED", description: "20A receptacle (accepted)" });
    await seedSuggestion({ status: "EDITED", quantity: 10, editedQuantity: 12, description: "Wall pack (edited)" });
    await seedSuggestion({
      status: "REJECTED",
      description: "Mech equipment (wrong trade)",
      rejectReason: "WRONG_TRADE",
    });

    const out = await runCalibrationAggregatorForOrg(orgId);
    expect(out.exemplarsWritten).toBe(3);

    const ex = await loadCalibrationExemplars({ organizationId: orgId, tradeType: "ELECTRICAL", limit: 10 });
    const kinds = ex.map((e) => e.kind).sort();
    expect(kinds).toEqual(["ACCEPTED", "EDITED", "REJECTED"]);

    const text = formatExemplarsForPrompt(ex);
    expect(text).toContain("Accepted");
    expect(text).toContain("Edited");
    expect(text).toContain("Rejected");
    expect(text).toContain("20A receptacle");
    expect(text).toContain("WRONG_TRADE");
  });

  it("proposes a PENDING quantity_bias nudge when ≥10 EDITED rows show consistent bias", async () => {
    // 12 EDITED rows scaling AI's 10 → 12 (a +20% bias).
    for (let i = 0; i < 12; i++) {
      await seedSuggestion({
        status: "EDITED",
        quantity: 10,
        editedQuantity: 12,
        description: `Conduit run #${i}`,
      });
    }

    const out = await runCalibrationAggregatorForOrg(orgId);
    expect(out.nudgesProposed).toBe(1);

    const nudges = await listPendingNudges(orgId);
    expect(nudges).toHaveLength(1);
    expect(nudges[0].metric).toBe("quantity_bias");
    expect(nudges[0].tradeType).toBe("ELECTRICAL");
    expect(nudges[0].sampleSize).toBe(12);
    expect(nudges[0].suggestedFactor).toBeCloseTo(1.2, 3);

    // Idempotent: a second run should not duplicate the PENDING nudge.
    const out2 = await runCalibrationAggregatorForOrg(orgId);
    expect(out2.nudgesProposed).toBe(0);
    const nudges2 = await listPendingNudges(orgId);
    expect(nudges2).toHaveLength(1);
  });

  it("does not propose a nudge when the average bias is within ±5%", async () => {
    // 12 EDITED rows but only +2% — under the NUDGE_MIN_BIAS floor.
    for (let i = 0; i < 12; i++) {
      await seedSuggestion({ status: "EDITED", quantity: 100, editedQuantity: 102 });
    }
    const out = await runCalibrationAggregatorForOrg(orgId);
    expect(out.nudgesProposed).toBe(0);
    expect(await listPendingNudges(orgId)).toHaveLength(0);
  });

  it("writes a daily accuracy snapshot per trade + an overall row, idempotent within the day", async () => {
    await seedSuggestion({ status: "ACCEPTED" });
    await seedSuggestion({ status: "EDITED", quantity: 10, editedQuantity: 11 });
    await seedSuggestion({ status: "REJECTED", rejectReason: "NOT_PRESENT" });

    const fixedNow = new Date("2026-05-08T12:00:00Z");
    await runCalibrationAggregatorForOrg(orgId, { now: fixedNow });
    await runCalibrationAggregatorForOrg(orgId, { now: fixedNow });

    const snaps = await db
      .select()
      .from(aiEstimatorAccuracySnapshots)
      .where(eq(aiEstimatorAccuracySnapshots.organizationId, orgId));
    expect(snaps).toHaveLength(2); // one ELECTRICAL + one overall
    const overall = snaps.find((s) => s.tradeType === null);
    expect(overall).toBeDefined();
    expect(overall!.totalSuggestions).toBe(3);
    expect(overall!.acceptedCount).toBe(1);
    expect(overall!.editedCount).toBe(1);
    expect(overall!.rejectedCount).toBe(1);
    // (1 + 1) / 3
    expect(overall!.acceptanceRate).toBeCloseTo(2 / 3, 3);
  });

  it("acceptCalibrationNudge writes factor into org-factors and surfaces it on the prompt", async () => {
    for (let i = 0; i < 12; i++) {
      await seedSuggestion({ status: "EDITED", quantity: 10, editedQuantity: 12 });
    }
    await runCalibrationAggregatorForOrg(orgId);
    const [nudge] = await listPendingNudges(orgId);
    expect(nudge).toBeDefined();

    const accepted = await acceptCalibrationNudge(orgId, nudge.id, userId);
    expect(accepted?.status).toBe("ACCEPTED");

    const factors = await loadTradeCalibrationFactors(orgId);
    expect(factors.ELECTRICAL?.quantity_bias).toBeCloseTo(1.2, 3);

    const text = formatTradeCalibrationFactorsForPrompt(factors, "ELECTRICAL");
    expect(text).toContain("ELECTRICAL");
    expect(text).toContain("scale quantities by");
  });

  it("rejectCalibrationNudge closes the nudge without writing a factor", async () => {
    for (let i = 0; i < 12; i++) {
      await seedSuggestion({ status: "EDITED", quantity: 10, editedQuantity: 12 });
    }
    await runCalibrationAggregatorForOrg(orgId);
    const [nudge] = await listPendingNudges(orgId);

    const out = await rejectCalibrationNudge(orgId, nudge.id, userId);
    expect(out?.status).toBe("REJECTED");
    expect(await listPendingNudges(orgId)).toHaveLength(0);

    const [factorsRow] = await db
      .select()
      .from(aiEstimatorOrgFactors)
      .where(eq(aiEstimatorOrgFactors.organizationId, orgId));
    // No factors row written, OR if one exists the map should be empty.
    if (factorsRow) {
      const map = factorsRow.tradeCalibrationFactors as Record<string, unknown>;
      expect(map.ELECTRICAL).toBeUndefined();
    }
  });

  it("formatExemplarsForPrompt returns empty string for no exemplars", () => {
    expect(formatExemplarsForPrompt([])).toBe("");
  });
});
