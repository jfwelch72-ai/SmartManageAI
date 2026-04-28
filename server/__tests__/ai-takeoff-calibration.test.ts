// Task #2323 — AI takeoff closed-loop feedback.
//
// Pins the calibration job + GET /accuracy + edit-and-accept persistence:
//
//  1. `runAiTakeoffCalibrationJob` upserts (org, trade, bucket) rows into
//     `ai_takeoff_confidence_calibration` using the last-90-day window with
//     accepted = ACCEPTED + EDITED, ignoring buckets below the 30-sample
//     threshold.
//  2. `GET /api/ai-features/takeoff/accuracy` returns the empirical
//     accuracy split by trade and confidence bucket and the top reject
//     reasons.
//  3. The bulk-accept endpoint flips PENDING -> ACCEPTED / EDITED and
//     records the user's edited values.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  aiTakeoffSuggestions,
  aiTakeoffConfidenceCalibration,
  aiTakeoffAnalyses,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { runAiTakeoffCalibrationJob } from "../aiTakeoffFeatureRoutes";

const PREFIX = "__aitakeoffcal__";

let app: Express;
let orgId: string;
let userId: string;
let token: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;
  await db
    .delete(aiTakeoffSuggestions)
    .where(inArray(aiTakeoffSuggestions.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(aiTakeoffConfidenceCalibration)
    .where(inArray(aiTakeoffConfidenceCalibration.organizationId, orgIds))
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
      name: "AI Takeoff Calibration Org",
      slug,
      tradeType: "ELECTRICAL",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "AI",
      lastName: "Reviewer",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    })
    .returning();
  userId = user.id;
  token = generateToken(user.id, user.tokenVersion ?? 0);

  const aiTakeoffRoutes = (await import("../aiTakeoffFeatureRoutes")).default;
  app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api", aiTakeoffRoutes);
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(async () => {
  // Each test owns its own seed data so the order between cases doesn't
  // matter and the calibration counts stay deterministic.
  await db
    .delete(aiTakeoffSuggestions)
    .where(eq(aiTakeoffSuggestions.organizationId, orgId));
  await db
    .delete(aiTakeoffConfidenceCalibration)
    .where(eq(aiTakeoffConfidenceCalibration.organizationId, orgId));
  await db
    .delete(aiTakeoffAnalyses)
    .where(eq(aiTakeoffAnalyses.organizationId, orgId));
});

async function seedAnalysis(): Promise<string> {
  const [a] = await db
    .insert(aiTakeoffAnalyses)
    .values({
      organizationId: orgId,
      tradeType: "ELECTRICAL",
      status: "COMPLETE",
      analysisMode: "QUICK",
      createdByUserId: userId,
    })
    .returning();
  return a.id;
}

let seedCounter = 0;
async function seedSuggestion(opts: {
  analysisId: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EDITED";
  confidence: number;
  reviewedAt?: Date | null;
  rejectReason?: string;
}): Promise<string> {
  seedCounter += 1;
  const [row] = await db
    .insert(aiTakeoffSuggestions)
    .values({
      analysisId: opts.analysisId,
      organizationId: orgId,
      tradeType: "ELECTRICAL",
      itemKey: `seed-item-${seedCounter}`,
      itemType: "outlet",
      description: "Duplex outlet on east wall",
      quantity: 10,
      unit: "EA",
      confidence: opts.confidence,
      status: opts.status,
      reviewedAt: opts.reviewedAt ?? (opts.status === "PENDING" ? null : new Date()),
      reviewedByUserId: opts.status === "PENDING" ? null : userId,
      rejectReason: (opts.rejectReason as any) ?? null,
    })
    .returning();
  return row.id;
}

describe("Task #2323 — runAiTakeoffCalibrationJob", () => {
  it("upserts buckets meeting the 30-sample threshold and skips low-volume buckets", async () => {
    const analysisId = await seedAnalysis();

    // Bucket 90: 24 ACCEPTED + 6 EDITED + 10 REJECTED = 40 reviewed → above threshold.
    // Acceptance rate = (24 + 6) / 40 = 0.75
    const seedPromises: Promise<string>[] = [];
    for (let i = 0; i < 24; i++) {
      seedPromises.push(seedSuggestion({ analysisId, status: "ACCEPTED", confidence: 95 }));
    }
    for (let i = 0; i < 6; i++) {
      seedPromises.push(seedSuggestion({ analysisId, status: "EDITED", confidence: 92 }));
    }
    for (let i = 0; i < 10; i++) {
      seedPromises.push(
        seedSuggestion({
          analysisId,
          status: "REJECTED",
          confidence: 91,
          rejectReason: "WRONG_TRADE",
        }),
      );
    }

    // Bucket 60: only 5 reviewed → below threshold, must be ignored.
    for (let i = 0; i < 3; i++) {
      seedPromises.push(seedSuggestion({ analysisId, status: "ACCEPTED", confidence: 65 }));
    }
    for (let i = 0; i < 2; i++) {
      seedPromises.push(
        seedSuggestion({
          analysisId,
          status: "REJECTED",
          confidence: 60,
          rejectReason: "NOT_PRESENT",
        }),
      );
    }

    // PENDING rows must not feed the calibration math.
    seedPromises.push(seedSuggestion({ analysisId, status: "PENDING", confidence: 95 }));

    await Promise.all(seedPromises);

    const result = await runAiTakeoffCalibrationJob();

    expect(result.rowsUpserted).toBe(1);

    const rows = await db
      .select()
      .from(aiTakeoffConfidenceCalibration)
      .where(eq(aiTakeoffConfidenceCalibration.organizationId, orgId));

    expect(rows).toHaveLength(1);
    expect(rows[0].modelConfidenceBucket).toBe(90);
    expect(rows[0].sampleCount).toBe(40);
    expect(Number(rows[0].empiricalAcceptanceRate)).toBeCloseTo(0.75, 2);
  }, 60_000);
});

describe("Task #2323 — GET /api/ai-features/takeoff/accuracy", () => {
  it("returns aggregated accuracy by trade, bucket, and reject reasons", async () => {
    const analysisId = await seedAnalysis();
    const seeds: Promise<string>[] = [];
    for (let i = 0; i < 4; i++) {
      seeds.push(seedSuggestion({ analysisId, status: "ACCEPTED", confidence: 95 }));
    }
    for (let i = 0; i < 1; i++) {
      seeds.push(seedSuggestion({ analysisId, status: "EDITED", confidence: 88 }));
    }
    for (let i = 0; i < 2; i++) {
      seeds.push(
        seedSuggestion({
          analysisId,
          status: "REJECTED",
          confidence: 75,
          rejectReason: "DUPLICATE",
        }),
      );
    }
    seeds.push(seedSuggestion({ analysisId, status: "PENDING", confidence: 95 }));
    await Promise.all(seeds);

    const res = await request(app)
      .get("/api/ai-features/takeoff/accuracy?days=90")
      .set("Cookie", [`auth_token=${token}`])
      .expect(200);

    expect(res.body.totals.ACCEPTED).toBe(4);
    expect(res.body.totals.EDITED).toBe(1);
    expect(res.body.totals.REJECTED).toBe(2);
    expect(res.body.totals.PENDING).toBe(1);
    expect(res.body.reviewed).toBe(7);
    // (4 + 1) / 7 ≈ 0.714
    expect(res.body.accuracy).toBeCloseTo(5 / 7, 2);

    const electrical = res.body.accuracyByTrade.find(
      (r: { tradeType: string }) => r.tradeType === "ELECTRICAL",
    );
    expect(electrical).toBeTruthy();
    expect(electrical.accepted).toBe(4);
    expect(electrical.edited).toBe(1);
    expect(electrical.rejected).toBe(2);

    const reasons = res.body.rejectReasons.map((r: { reason: string }) => r.reason);
    expect(reasons).toContain("DUPLICATE");
  }, 30_000);
});

describe("Task #2323 — POST /api/ai-features/takeoff/suggestions/bulk-accept", () => {
  it("flips PENDING -> ACCEPTED and EDITED, recording edited values", async () => {
    const analysisId = await seedAnalysis();
    const acceptedId = await seedSuggestion({
      analysisId,
      status: "PENDING",
      confidence: 90,
    });
    const editedId = await seedSuggestion({
      analysisId,
      status: "PENDING",
      confidence: 88,
    });

    const res = await request(app)
      .post("/api/ai-features/takeoff/suggestions/bulk-accept")
      .set("Cookie", [`auth_token=${token}`])
      .send({
        analysisId,
        acceptances: [
          { suggestionId: acceptedId },
          {
            suggestionId: editedId,
            editedQuantity: 14,
            editedUnit: "EA",
            editedItemType: "junction_box",
          },
        ],
        rejections: [],
      })
      .expect(200);

    expect(res.body.accepted).toBe(1);
    expect(res.body.edited).toBe(1);

    const [acceptedRow] = await db
      .select()
      .from(aiTakeoffSuggestions)
      .where(
        and(
          eq(aiTakeoffSuggestions.id, acceptedId),
          eq(aiTakeoffSuggestions.organizationId, orgId),
        ),
      );
    expect(acceptedRow.status).toBe("ACCEPTED");
    expect(acceptedRow.editedQuantity).toBeNull();

    const [editedRow] = await db
      .select()
      .from(aiTakeoffSuggestions)
      .where(
        and(
          eq(aiTakeoffSuggestions.id, editedId),
          eq(aiTakeoffSuggestions.organizationId, orgId),
        ),
      );
    expect(editedRow.status).toBe("EDITED");
    expect(Number(editedRow.editedQuantity)).toBe(14);
    expect(editedRow.editedUnit).toBe("EA");
    expect(editedRow.editedItemType).toBe("junction_box");
  }, 30_000);
});
