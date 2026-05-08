// Task #2623 — Sheet classification confidence + review queue.
//
// Covers:
//   GET  /api/ai-estimator/bids/:bidId/sheet-index/review-queue
//   POST /api/ai-estimator/bids/:bidId/sheets/:sheetId/discipline
//   POST /api/ai-estimator/bids/:bidId/legend-symbols/:id/(accept|reject)
//   PATCH /api/ai-estimator/bids/:bidId/legend-symbols/:id
//
// And the sticky-override pipeline guard: a sheet stamped with
// `discipline_source = 'USER'` is excluded from the review queue and
// from re-classification.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  takeoffSheets,
  aiEstimatorLegendSymbols,
  aiEstimatorOrgFactors,
  aiEstimatorUserAccess,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__ai_est_review__";

interface Ctx {
  orgId: string;
  userId: string;
  token: string;
  bidId: string;
  // Sheets seeded with varying confidence/source.
  sheetLowAi: string;        // AI, score 0.4 — should appear in queue
  sheetHighAi: string;       // AI, score 0.95 — should NOT appear
  sheetUserConfirmed: string; // USER source — should NOT appear (sticky)
  sheetUnscored: string;     // discipline set, score null — appears
  legendSymbolId: string;
}

let ctx: Ctx;
let app: Express;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_legend_symbols WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_org_factors WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_user_access WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db
    .insert(organizations)
    .values({ name: "Review Org", slug: `${PREFIX}${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}user-${stamp}@test.local`,
      passwordHash,
      firstName: "Review",
      lastName: "User",
      role: "ESTIMATOR",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  await db.insert(aiEstimatorUserAccess).values({
    organizationId: org.id,
    userId: user.id,
    enabled: true,
    canTrain: true,
    enabledAt: new Date(),
    enabledByUserId: user.id,
  });
  // Pin the org's threshold to 0.6 so the test is independent of any
  // future default change.
  await db
    .insert(aiEstimatorOrgFactors)
    .values({ organizationId: org.id, lowConfidenceThreshold: 0.6 });

  const [bid] = await db
    .insert(bids)
    .values({ name: "Review Bid", code: `${PREFIX}B-${stamp}`, clientName: "Client", gcOrganizationId: org.id })
    .returning();

  const inserted = await db
    .insert(takeoffSheets)
    .values([
      {
        bidId: bid.id,
        imageUrl: "https://example.com/sheet-low.png",
        sheetIndex: 0,
        sheetName: `${PREFIX}low`,
        sheetNumber: "M-101",
        discipline: "M",
        disciplineConfidence: "LOW",
        disciplineSource: "AI_DETECTED",
        disciplineConfidenceScore: 0.4,
        disciplineRationale: "Title block partially obscured",
      },
      {
        bidId: bid.id,
        imageUrl: "https://example.com/sheet-high.png",
        sheetIndex: 1,
        sheetName: `${PREFIX}high`,
        sheetNumber: "A-101",
        discipline: "A",
        disciplineConfidence: "HIGH",
        disciplineSource: "AI_DETECTED",
        disciplineConfidenceScore: 0.95,
        disciplineRationale: "Title block reads ARCHITECTURAL",
      },
      {
        bidId: bid.id,
        imageUrl: "https://example.com/sheet-user.png",
        sheetIndex: 2,
        sheetName: `${PREFIX}user`,
        sheetNumber: "S-001",
        discipline: "S",
        disciplineConfidence: "HIGH",
        disciplineSource: "USER",
        disciplineConfidenceScore: 0.3,
      },
      {
        bidId: bid.id,
        imageUrl: "https://example.com/sheet-unscored.png",
        sheetIndex: 3,
        sheetName: `${PREFIX}unscored`,
        sheetNumber: "E-001",
        discipline: "E",
        disciplineConfidence: "MEDIUM",
        disciplineSource: "FILENAME_HEURISTIC",
        disciplineConfidenceScore: null,
      },
    ])
    .returning({ id: takeoffSheets.id, sheetIndex: takeoffSheets.sheetIndex });
  const byIdx = new Map(inserted.map((s) => [s.sheetIndex, s.id]));

  const [legendSymbol] = await db
    .insert(aiEstimatorLegendSymbols)
    .values({
      organizationId: org.id,
      bidId: bid.id,
      symbolCode: "D-1",
      definition: "Door type 1",
      trade: "A",
      count: 4,
      source: "AI_DETECTED",
      reviewStatus: "PENDING_REVIEW",
    })
    .returning();

  ctx = {
    orgId: org.id,
    userId: user.id,
    token: generateToken(user.id, user.tokenVersion ?? 0),
    bidId: bid.id,
    sheetLowAi: byIdx.get(0)!,
    sheetHighAi: byIdx.get(1)!,
    sheetUserConfirmed: byIdx.get(2)!,
    sheetUnscored: byIdx.get(3)!,
    legendSymbolId: legendSymbol.id,
  };

  const aiEstimatorRoutes = (await import("../aiEstimatorRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api", aiEstimatorRoutes);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

function authCookie(token: string) {
  return [`auth_token=${token}`];
}

describe("GET /api/ai-estimator/bids/:bidId/sheet-index/review-queue", () => {
  it("returns only sheets with confidence below the org threshold and no human override", async () => {
    const res = await request(app)
      .get(`/api/ai-estimator/bids/${ctx.bidId}/sheet-index/review-queue`)
      .set("Cookie", authCookie(ctx.token));
    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(0.6);
    expect(Array.isArray(res.body.sheets)).toBe(true);
    const ids = res.body.sheets.map((s: { sheetId: string }) => s.sheetId);
    expect(ids).toContain(ctx.sheetLowAi);
    expect(ids).toContain(ctx.sheetUnscored);
    expect(ids).not.toContain(ctx.sheetHighAi);
    expect(ids).not.toContain(ctx.sheetUserConfirmed);
  });
});

describe("POST /api/ai-estimator/bids/:bidId/sheets/:sheetId/discipline", () => {
  it("rejects an invalid discipline code with 400", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/bids/${ctx.bidId}/sheets/${ctx.sheetLowAi}/discipline`)
      .set("Cookie", authCookie(ctx.token))
      .send({ discipline: "Z" });
    expect(res.status).toBe(400);
  });

  it("stamps discipline_source=USER, reviewedById, reviewedAt and removes the sheet from the queue", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/bids/${ctx.bidId}/sheets/${ctx.sheetLowAi}/discipline`)
      .set("Cookie", authCookie(ctx.token))
      .send({ discipline: "P" });
    expect(res.status).toBe(200);
    expect(res.body.discipline).toBe("P");
    expect(res.body.disciplineSource).toBe("USER");
    expect(res.body.reviewedById).toBe(ctx.userId);
    expect(res.body.reviewedAt).toBeTruthy();

    // DB state confirms the override was persisted.
    const [row] = await db
      .select()
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, ctx.sheetLowAi));
    expect(row.discipline).toBe("P");
    expect(row.disciplineSource).toBe("USER");
    expect(row.reviewedById).toBe(ctx.userId);
    expect(row.reviewedAt).not.toBeNull();

    // And the queue no longer surfaces it.
    const queueRes = await request(app)
      .get(`/api/ai-estimator/bids/${ctx.bidId}/sheet-index/review-queue`)
      .set("Cookie", authCookie(ctx.token));
    const ids = queueRes.body.sheets.map((s: { sheetId: string }) => s.sheetId);
    expect(ids).not.toContain(ctx.sheetLowAi);
  });
});

describe("Legend symbol HITL — accept / reject / edit", () => {
  it("PATCH edits the symbol and stamps EDITED", async () => {
    const res = await request(app)
      .patch(`/api/ai-estimator/bids/${ctx.bidId}/legend-symbols/${ctx.legendSymbolId}`)
      .set("Cookie", authCookie(ctx.token))
      .send({ count: 7, definition: "Door type 1 (3'-0\" x 7'-0\" HM)" });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(7);
    expect(res.body.definition).toContain("Door type 1");
    expect(res.body.reviewStatus).toBe("EDITED");
  });

  it("POST /accept flips reviewStatus to ACCEPTED", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/bids/${ctx.bidId}/legend-symbols/${ctx.legendSymbolId}/accept`)
      .set("Cookie", authCookie(ctx.token));
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe("ACCEPTED");
  });

  it("POST /reject flips reviewStatus to REJECTED so the schedule-accept path skips it", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/bids/${ctx.bidId}/legend-symbols/${ctx.legendSymbolId}/reject`)
      .set("Cookie", authCookie(ctx.token));
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe("REJECTED");

    // Sanity-check the row in the DB.
    const [row] = await db
      .select()
      .from(aiEstimatorLegendSymbols)
      .where(eq(aiEstimatorLegendSymbols.id, ctx.legendSymbolId));
    expect(row.reviewStatus).toBe("REJECTED");
  });

  it("list endpoint hides REJECTED symbols by default — pipeline guard", async () => {
    // Seed a fresh symbol on the same bid so we can flip it to REJECTED
    // and prove it disappears from the default list.
    const [extra] = await db
      .insert(aiEstimatorLegendSymbols)
      .values({
        organizationId: ctx.orgId,
        bidId: ctx.bidId,
        symbolCode: "W-2",
        definition: "Window type 2",
        trade: "A",
        count: 3,
        source: "AI_DETECTED",
        reviewStatus: "PENDING_REVIEW",
      })
      .returning();

    const beforeRes = await request(app)
      .get(`/api/ai-estimator/bids/${ctx.bidId}/legend-symbols`)
      .set("Cookie", authCookie(ctx.token));
    expect(beforeRes.status).toBe(200);
    const beforeIds = beforeRes.body.symbols.map((s: { id: string }) => s.id);
    expect(beforeIds).toContain(extra.id);

    await request(app)
      .post(`/api/ai-estimator/bids/${ctx.bidId}/legend-symbols/${extra.id}/reject`)
      .set("Cookie", authCookie(ctx.token));

    const afterRes = await request(app)
      .get(`/api/ai-estimator/bids/${ctx.bidId}/legend-symbols`)
      .set("Cookie", authCookie(ctx.token));
    const afterIds = afterRes.body.symbols.map((s: { id: string }) => s.id);
    expect(afterIds).not.toContain(extra.id);
  });

  it("returns 404 for a symbol id that does not exist", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/bids/${ctx.bidId}/legend-symbols/00000000-0000-0000-0000-000000000000/accept`)
      .set("Cookie", authCookie(ctx.token));
    expect(res.status).toBe(404);
  });
});
