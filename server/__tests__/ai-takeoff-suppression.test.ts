// Task #2342 — AI takeoff suppression floor.
//
// Pins:
//
//  1. GET /api/ai-features/takeoff/suggestions/by-analysis/:id pre-joins
//     the per-(org, trade) calibration map and returns the org's
//     suppression floor + minimum sample count, so the panel can hide
//     low-acceptance buckets without a second round-trip.
//  2. GET/PUT /api/ai-features/takeoff/org-settings round-trips the
//     per-org `aiTakeoffSuppressionFloor` decimal column, including
//     the "off" (`null`) state.
//  3. PUT bounds-checks the floor (0..0.5) and rejects anything
//     outside that range.
//  4. The suggestion rows themselves are NOT deleted — suppression is
//     purely presentational so the calibration job stays accurate.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql, eq } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  aiTakeoffSuggestions,
  aiTakeoffConfidenceCalibration,
  aiTakeoffAnalyses,
  AI_TAKEOFF_SUPPRESSION_MIN_SAMPLES,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__aitakeoffsupp__";

let app: Express;
let orgId: string;
let userId: string;
let adminToken: string;
let estimatorToken: string;

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
      name: "AI Takeoff Suppression Org",
      slug,
      tradeType: "ELECTRICAL",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [admin] = await db
    .insert(users)
    .values({
      email: `${slug}-admin@test.local`,
      passwordHash,
      firstName: "AI",
      lastName: "Admin",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    })
    .returning();
  userId = admin.id;
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [estimator] = await db
    .insert(users)
    .values({
      email: `${slug}-estimator@test.local`,
      passwordHash,
      firstName: "AI",
      lastName: "Estimator",
      role: "ESTIMATOR",
      organizationId: orgId,
      isActive: true,
    })
    .returning();
  estimatorToken = generateToken(estimator.id, estimator.tokenVersion ?? 0);

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
  await db
    .delete(aiTakeoffSuggestions)
    .where(eq(aiTakeoffSuggestions.organizationId, orgId));
  await db
    .delete(aiTakeoffConfidenceCalibration)
    .where(eq(aiTakeoffConfidenceCalibration.organizationId, orgId));
  await db
    .delete(aiTakeoffAnalyses)
    .where(eq(aiTakeoffAnalyses.organizationId, orgId));
  // Reset the per-org floor between tests so cases can opt in
  // explicitly. We round-trip via the column directly to avoid
  // depending on the PUT endpoint that some tests are exercising.
  await db
    .update(organizations)
    .set({ aiTakeoffSuppressionFloor: null })
    .where(eq(organizations.id, orgId));
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
async function seedSuggestion(analysisId: string, confidence: number): Promise<string> {
  seedCounter += 1;
  const [row] = await db
    .insert(aiTakeoffSuggestions)
    .values({
      analysisId,
      organizationId: orgId,
      tradeType: "ELECTRICAL",
      itemKey: `seed-item-${seedCounter}`,
      itemType: "outlet",
      description: "Duplex outlet",
      quantity: 1,
      unit: "EA",
      confidence,
      status: "PENDING",
    })
    .returning();
  return row.id;
}

async function seedCalibration(
  bucket: number,
  rate: number,
  samples: number,
): Promise<void> {
  await db.insert(aiTakeoffConfidenceCalibration).values({
    organizationId: orgId,
    tradeType: "ELECTRICAL",
    modelConfidenceBucket: bucket,
    empiricalAcceptanceRate: String(rate) as any,
    sampleCount: samples,
  });
}

describe("Task #2342 — GET /suggestions/by-analysis enriches calibration", () => {
  it("returns suggestions plus calibration map and per-org floor", async () => {
    const analysisId = await seedAnalysis();
    await seedSuggestion(analysisId, 95);
    await seedSuggestion(analysisId, 65);
    await seedCalibration(90, 0.85, 60);
    await seedCalibration(60, 0.05, 50);
    await db
      .update(organizations)
      .set({ aiTakeoffSuppressionFloor: "0.15" as any })
      .where(eq(organizations.id, orgId));

    const res = await request(app)
      .get(`/api/ai-features/takeoff/suggestions/by-analysis/${analysisId}`)
      .set("Cookie", [`auth_token=${adminToken}`])
      .expect(200);

    expect(res.body.suggestions).toHaveLength(2);
    expect(res.body.calibration).toHaveLength(2);
    expect(res.body.suppressionFloor).toBeCloseTo(0.15, 4);
    expect(res.body.suppressionMinSamples).toBe(
      AI_TAKEOFF_SUPPRESSION_MIN_SAMPLES,
    );

    const bucket60 = res.body.calibration.find(
      (c: { bucket: number }) => c.bucket === 60,
    );
    expect(bucket60.empiricalAcceptanceRate).toBeCloseTo(0.05, 4);
    expect(bucket60.sampleCount).toBe(50);
  }, 30_000);

  it("returns suppressionFloor=null when the org has not opted in", async () => {
    const analysisId = await seedAnalysis();
    await seedSuggestion(analysisId, 95);

    const res = await request(app)
      .get(`/api/ai-features/takeoff/suggestions/by-analysis/${analysisId}`)
      .set("Cookie", [`auth_token=${adminToken}`])
      .expect(200);

    expect(res.body.suppressionFloor).toBeNull();
    expect(res.body.calibration).toEqual([]);
    expect(res.body.suggestions).toHaveLength(1);
  }, 30_000);

  it("does not delete suggestion rows when the floor is set (presentational only)", async () => {
    const analysisId = await seedAnalysis();
    // Two suggestions in the worst bucket — calibration says ~5%
    // acceptance which is well below a 15% floor.
    await seedSuggestion(analysisId, 65);
    await seedSuggestion(analysisId, 62);
    await seedCalibration(60, 0.05, 50);
    await db
      .update(organizations)
      .set({ aiTakeoffSuppressionFloor: "0.15" as any })
      .where(eq(organizations.id, orgId));

    const res = await request(app)
      .get(`/api/ai-features/takeoff/suggestions/by-analysis/${analysisId}`)
      .set("Cookie", [`auth_token=${adminToken}`])
      .expect(200);

    // Backend never filters — the panel is responsible for the visual
    // suppression. This is the contract the calibration job depends on.
    expect(res.body.suggestions).toHaveLength(2);

    const dbRows = await db
      .select()
      .from(aiTakeoffSuggestions)
      .where(eq(aiTakeoffSuggestions.analysisId, analysisId));
    expect(dbRows).toHaveLength(2);
  }, 30_000);
});

describe("Task #2342 — GET/PUT /api/ai-features/takeoff/org-settings", () => {
  it("GET returns the recommended default and bounds when unset", async () => {
    const res = await request(app)
      .get("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${adminToken}`])
      .expect(200);

    expect(res.body.suppressionFloor).toBeNull();
    expect(res.body.defaults.recommended).toBeCloseTo(0.15, 4);
    expect(res.body.defaults.minSamples).toBe(
      AI_TAKEOFF_SUPPRESSION_MIN_SAMPLES,
    );
    expect(res.body.bounds.min).toBe(0);
    expect(res.body.bounds.max).toBeCloseTo(0.5, 4);
  }, 30_000);

  it("PUT round-trips a value as ADMIN", async () => {
    await request(app)
      .put("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${adminToken}`])
      .send({ suppressionFloor: 0.2 })
      .expect(200);

    const get = await request(app)
      .get("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${adminToken}`])
      .expect(200);
    expect(get.body.suppressionFloor).toBeCloseTo(0.2, 4);
  }, 30_000);

  it("PUT can clear the floor by sending null (turn off)", async () => {
    await db
      .update(organizations)
      .set({ aiTakeoffSuppressionFloor: "0.2" as any })
      .where(eq(organizations.id, orgId));

    await request(app)
      .put("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${adminToken}`])
      .send({ suppressionFloor: null })
      .expect(200);

    const get = await request(app)
      .get("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${adminToken}`])
      .expect(200);
    expect(get.body.suppressionFloor).toBeNull();
  }, 30_000);

  it("PUT rejects values outside the 0..0.5 bound", async () => {
    await request(app)
      .put("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${adminToken}`])
      .send({ suppressionFloor: 0.9 })
      .expect(400);

    await request(app)
      .put("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${adminToken}`])
      .send({ suppressionFloor: -0.1 })
      .expect(400);
  }, 30_000);

  it("PUT requires ADMIN role", async () => {
    await request(app)
      .put("/api/ai-features/takeoff/org-settings")
      .set("Cookie", [`auth_token=${estimatorToken}`])
      .send({ suppressionFloor: 0.15 })
      .expect(403);
  }, 30_000);
});
