// Task #2740 — Integration tests that verify the proposed-action apply path
// produces estimate totals matching the cost-delta preview math.
//
// The suite exercises the three mutation variants (add / edit / delete)
// through the real HTTP stack, then asserts that
//   GET /api/bids/:bidId/estimate → totals
// agrees with the arithmetic shown to the user before they clicked Accept.
//
// Auth: ADMIN role + aiEstimatorUserAccess row (mirrors the pattern used in
// ai-estimator-routes.test.ts).  The GET /api/bids/:bidId/estimate route
// also requires hasManagementAccess, which includes ADMIN.
//
// No real AI / OpenAI calls happen — the proposed actions are seeded
// directly into the DB as JSONB (the same shape Claude would produce), so
// the test is purely a DB-mutation integration test.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

vi.mock("../ai/openaiClient", () => ({
  AI_MODEL_GPT5: "gpt-5",
  AI_MODEL_GPT4O: "gpt-4o",
  openai: {
    chat: { completions: { create: vi.fn() } },
  },
}));

vi.mock("../services/aiGovernance", () => ({
  governedAiCall: vi.fn(async (opts: { fn: () => Promise<{ result: unknown }> }) => {
    const { result } = await opts.fn();
    return { result };
  }),
}));

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  estimates,
  estimateLineItems,
  aiEstimatorChatSessions,
  aiEstimatorChatMessages,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setUserAccess } from "../services/aiEstimator/access";

const PREFIX = "__ai_est_cost_totals__";

interface ActorCtx {
  userId: string;
  orgId: string;
  token: string;
}

let app: Express;
let actor: ActorCtx;

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM ai_estimator_chat_messages
    WHERE session_id IN (
      SELECT id FROM ai_estimator_chat_sessions
      WHERE organization_id IN (
        SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM ai_estimator_chat_sessions
    WHERE organization_id IN (
      SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM estimate_line_items
    WHERE estimate_id IN (
      SELECT id FROM estimates
      WHERE bid_id IN (
        SELECT id FROM bids
        WHERE gc_organization_id IN (
          SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
        )
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM estimates
    WHERE bid_id IN (
      SELECT id FROM bids
      WHERE gc_organization_id IN (
        SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM bids
    WHERE gc_organization_id IN (
      SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
    )
  `).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_user_access WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const passwordHash = await bcrypt.hash("TestPass123!", 4);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: "Cost Totals Test Org",
      slug: `${PREFIX}org-${stamp}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}admin-${stamp}@test.local`,
      passwordHash,
      firstName: "CostTest",
      lastName: "Admin",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  await setUserAccess({
    organizationId: org.id,
    userId: user.id,
    enabled: true,
    changedById: user.id,
  });

  actor = {
    userId: user.id,
    orgId: org.id,
    token: generateToken(user.id, user.tokenVersion ?? 0),
  };

  const [aiEstimatorRoutes, estimateRoutesMod] = await Promise.all([
    import("../aiEstimatorRoutes").then((m) => m.default),
    import("../estimateRoutes").then((m) => m.default),
  ]);

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api", aiEstimatorRoutes);
  app.use(estimateRoutesMod);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

function authCookie(token: string) {
  return [`auth_token=${token}`];
}

async function seedBidAndEstimate() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [bid] = await db
    .insert(bids)
    .values({
      name: `Cost Totals Bid ${stamp}`,
      code: `${PREFIX}B-${stamp}`,
      clientName: "Test Client",
      gcOrganizationId: actor.orgId,
      status: "DRAFT",
    })
    .returning();

  const [estimate] = await db
    .insert(estimates)
    .values({
      bidId: bid.id,
      createdById: actor.userId,
      status: "DRAFT",
    })
    .returning();

  return { bidId: bid.id, estimateId: estimate.id };
}

async function seedSession(bidId: string, estimateId: string) {
  const [session] = await db
    .insert(aiEstimatorChatSessions)
    .values({
      organizationId: actor.orgId,
      userId: actor.userId,
      bidId,
      estimateId,
    })
    .returning();
  return session;
}

async function seedMessageWithActions(sessionId: string, proposedActions: unknown[]) {
  const [message] = await db
    .insert(aiEstimatorChatMessages)
    .values({
      sessionId,
      role: "assistant",
      content: "I suggest the following change:",
      proposedActions,
    })
    .returning();
  return message;
}

async function applyAction(sessionId: string, messageId: string, toolCallId: string) {
  return request(app)
    .post(
      `/api/ai-estimator/chat/sessions/${sessionId}/messages/${messageId}/proposed-actions/apply`,
    )
    .set("Cookie", authCookie(actor.token))
    .send({ toolCallId });
}

async function rejectAction(sessionId: string, messageId: string, toolCallId: string) {
  return request(app)
    .post(
      `/api/ai-estimator/chat/sessions/${sessionId}/messages/${messageId}/proposed-actions/reject`,
    )
    .set("Cookie", authCookie(actor.token))
    .send({ toolCallId });
}

interface EstimateTotals {
  totalCost: number;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  subcontractCost: number;
  consumablesCost: number;
  overheadAllocation: number;
  profitAllocation: number;
}

async function getTotals(bidId: string): Promise<EstimateTotals> {
  const res = await request(app)
    .get(`/api/bids/${bidId}/estimate`)
    .set("Cookie", authCookie(actor.token));
  expect(res.status).toBe(200);
  return res.body.estimate.totals as EstimateTotals;
}

// ============================================================================
// ADD action
// ============================================================================

describe("AI proposed action: add — cost totals", () => {
  it("totalCost on GET /api/bids/:bidId/estimate equals materialCost+laborCost+equipmentCost+subcontractCost from the payload", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();
    const session = await seedSession(bidId, estimateId);

    const toolCallId = "tc-add-001";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "add",
        payload: {
          description: "Concrete footing 18\" deep",
          category: "CONCRETE",
          unit: "CY",
          quantity: 10,
          materialCost: 500,
          laborCost: 300,
          equipmentCost: 200,
          subcontractCost: 0,
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(201);

    // The returned line item totalCost must equal the sum of cost components.
    expect(Number(applyRes.body.lineItem.totalCost)).toBe(1000); // 500+300+200+0

    // The aggregate totals from the estimate endpoint must match.
    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(1000);
    expect(totals.materialCost).toBe(500);
    expect(totals.laborCost).toBe(300);
    expect(totals.equipmentCost).toBe(200);
    expect(totals.subcontractCost).toBe(0);
  });

  it("subcontractCost-only item: totalCost equals subcontractCost", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();
    const session = await seedSession(bidId, estimateId);

    const toolCallId = "tc-add-sub";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "add",
        payload: {
          description: "MEP subcontract",
          category: "PLUMBING",
          unit: "LS",
          quantity: 1,
          materialCost: 0,
          laborCost: 0,
          equipmentCost: 0,
          subcontractCost: 4500,
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(201);
    expect(Number(applyRes.body.lineItem.totalCost)).toBe(4500);

    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(4500);
    expect(totals.subcontractCost).toBe(4500);
    expect(totals.materialCost).toBe(0);
    expect(totals.laborCost).toBe(0);
  });

  it("successive add actions accumulate correctly in the estimate totals", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();
    const session = await seedSession(bidId, estimateId);

    // First add: laborCost=400, equipmentCost=600 → total=1000
    const msg1 = await seedMessageWithActions(session.id, [
      {
        toolCallId: "tc-add-acc-1",
        action: "add",
        payload: {
          description: "Excavation",
          category: "EXCAVATION",
          unit: "CY",
          quantity: 20,
          materialCost: 0,
          laborCost: 400,
          equipmentCost: 600,
          subcontractCost: 0,
        },
      },
    ]);
    const r1 = await applyAction(session.id, msg1.id, "tc-add-acc-1");
    expect(r1.status).toBe(201);

    // Second add: materialCost=1500, laborCost=250 → total=1750
    const msg2 = await seedMessageWithActions(session.id, [
      {
        toolCallId: "tc-add-acc-2",
        action: "add",
        payload: {
          description: "Steel reinforcement",
          category: "STRUCTURAL_STEEL",
          unit: "LF",
          quantity: 100,
          materialCost: 1500,
          laborCost: 250,
          equipmentCost: 0,
          subcontractCost: 0,
        },
      },
    ]);
    const r2 = await applyAction(session.id, msg2.id, "tc-add-acc-2");
    expect(r2.status).toBe(201);

    const totals = await getTotals(bidId);
    // (0+400+600+0) + (1500+250+0+0) = 2750
    expect(totals.totalCost).toBe(2750);
    expect(totals.materialCost).toBe(1500);
    expect(totals.laborCost).toBe(650);
    expect(totals.equipmentCost).toBe(600);
  });
});

// ============================================================================
// EDIT action
// ============================================================================

describe("AI proposed action: edit — cost totals", () => {
  it("reducing a cost component lowers totalCost by the delta", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();

    // Seed an existing item: material=700, labor=300 → totalCost=1000
    const [existing] = await db
      .insert(estimateLineItems)
      .values({
        estimateId,
        category: "CONCRETE",
        description: "Foundation slab",
        quantity: "5.00",
        unit: "CY",
        materialCost: "700.00",
        laborCost: "300.00",
        equipmentCost: "0.00",
        subcontractCost: "0.00",
        consumablesCost: "0.00",
        overheadAllocation: "0.00",
        profitAllocation: "0.00",
        laborHours: "0",
        equipmentHours: "0",
        totalCost: "1000.00",
      })
      .returning();

    const session = await seedSession(bidId, estimateId);
    const toolCallId = "tc-edit-reduce";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "edit",
        payload: {
          lineItemId: existing.id,
          materialCost: 500, // was 700 → delta = -200
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(200);
    // Updated total: 500+300+0+0 = 800
    expect(Number(applyRes.body.lineItem.totalCost)).toBe(800);

    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(800);
    expect(totals.materialCost).toBe(500);
    expect(totals.laborCost).toBe(300);
  });

  it("increasing a cost component raises totalCost by the delta", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();

    const [existing] = await db
      .insert(estimateLineItems)
      .values({
        estimateId,
        category: "ELECTRICAL",
        description: "Panel installation",
        quantity: "1.00",
        unit: "EA",
        materialCost: "800.00",
        laborCost: "200.00",
        equipmentCost: "0.00",
        subcontractCost: "0.00",
        consumablesCost: "0.00",
        overheadAllocation: "0.00",
        profitAllocation: "0.00",
        laborHours: "0",
        equipmentHours: "0",
        totalCost: "1000.00",
      })
      .returning();

    const session = await seedSession(bidId, estimateId);
    const toolCallId = "tc-edit-increase";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "edit",
        payload: {
          lineItemId: existing.id,
          laborCost: 600, // was 200 → delta = +400
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(200);
    // Updated total: 800+600+0+0 = 1400
    expect(Number(applyRes.body.lineItem.totalCost)).toBe(1400);

    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(1400);
    expect(totals.materialCost).toBe(800);
    expect(totals.laborCost).toBe(600);
  });

  it("editing only description/quantity leaves totalCost unchanged", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();

    const [existing] = await db
      .insert(estimateLineItems)
      .values({
        estimateId,
        category: "PAVING",
        description: "Asphalt paving",
        quantity: "10.00",
        unit: "SY",
        materialCost: "600.00",
        laborCost: "400.00",
        equipmentCost: "0.00",
        subcontractCost: "0.00",
        consumablesCost: "0.00",
        overheadAllocation: "0.00",
        profitAllocation: "0.00",
        laborHours: "0",
        equipmentHours: "0",
        totalCost: "1000.00",
      })
      .returning();

    const session = await seedSession(bidId, estimateId);
    const toolCallId = "tc-edit-noncost";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "edit",
        payload: {
          lineItemId: existing.id,
          description: "Asphalt paving (revised scope)",
          quantity: 15, // quantity change — does NOT recalculate cost components
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(200);
    // totalCost must remain 600+400+0+0 = 1000 (cost components are unchanged)
    expect(Number(applyRes.body.lineItem.totalCost)).toBe(1000);

    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(1000);
    expect(totals.materialCost).toBe(600);
    expect(totals.laborCost).toBe(400);
  });

  it("simultaneous edit of multiple cost components recalculates total from scratch", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();

    const [existing] = await db
      .insert(estimateLineItems)
      .values({
        estimateId,
        category: "MASONRY",
        description: "CMU block wall",
        quantity: "100.00",
        unit: "SF",
        materialCost: "1200.00",
        laborCost: "800.00",
        equipmentCost: "0.00",
        subcontractCost: "0.00",
        consumablesCost: "0.00",
        overheadAllocation: "0.00",
        profitAllocation: "0.00",
        laborHours: "0",
        equipmentHours: "0",
        totalCost: "2000.00",
      })
      .returning();

    const session = await seedSession(bidId, estimateId);
    const toolCallId = "tc-edit-multi";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "edit",
        payload: {
          lineItemId: existing.id,
          materialCost: 900,   // was 1200
          laborCost: 700,      // was 800
          equipmentCost: 150,  // was 0
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(200);
    // New total: 900+700+150+0 = 1750
    expect(Number(applyRes.body.lineItem.totalCost)).toBe(1750);

    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(1750);
    expect(totals.materialCost).toBe(900);
    expect(totals.laborCost).toBe(700);
    expect(totals.equipmentCost).toBe(150);
  });
});

// ============================================================================
// DELETE action
// ============================================================================

describe("AI proposed action: delete — cost totals", () => {
  it("totalCost decreases by the deleted item's cost, keeping the remaining items intact", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();

    // Item to be deleted: totalCost=2000
    const [toDelete] = await db
      .insert(estimateLineItems)
      .values({
        estimateId,
        category: "CONCRETE",
        description: "Duplicate scope",
        quantity: "1.00",
        unit: "LS",
        materialCost: "1200.00",
        laborCost: "800.00",
        equipmentCost: "0.00",
        subcontractCost: "0.00",
        consumablesCost: "0.00",
        overheadAllocation: "0.00",
        profitAllocation: "0.00",
        laborHours: "0",
        equipmentHours: "0",
        totalCost: "2000.00",
      })
      .returning();

    // Item to keep: totalCost=500
    await db.insert(estimateLineItems).values({
      estimateId,
      category: "ELECTRICAL",
      description: "Lighting package",
      quantity: "1.00",
      unit: "LS",
      materialCost: "300.00",
      laborCost: "200.00",
      equipmentCost: "0.00",
      subcontractCost: "0.00",
      consumablesCost: "0.00",
      overheadAllocation: "0.00",
      profitAllocation: "0.00",
      laborHours: "0",
      equipmentHours: "0",
      totalCost: "500.00",
    });

    const session = await seedSession(bidId, estimateId);
    const toolCallId = "tc-del-001";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "delete",
        payload: {
          lineItemId: toDelete.id,
          reason: "Removing duplicate scope",
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.deleted).toBe(true);
    expect(applyRes.body.lineItemId).toBe(toDelete.id);

    // Only the 500-cost item should remain in the totals.
    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(500);
    expect(totals.materialCost).toBe(300);
    expect(totals.laborCost).toBe(200);
  });

  it("deleting the only line item leaves totals at zero", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();

    const [onlyItem] = await db
      .insert(estimateLineItems)
      .values({
        estimateId,
        category: "GC",
        description: "General conditions",
        quantity: "1.00",
        unit: "LS",
        materialCost: "0.00",
        laborCost: "5000.00",
        equipmentCost: "0.00",
        subcontractCost: "0.00",
        consumablesCost: "0.00",
        overheadAllocation: "0.00",
        profitAllocation: "0.00",
        laborHours: "0",
        equipmentHours: "0",
        totalCost: "5000.00",
      })
      .returning();

    const session = await seedSession(bidId, estimateId);
    const toolCallId = "tc-del-only";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "delete",
        payload: { lineItemId: onlyItem.id },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.deleted).toBe(true);

    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(0);
    expect(totals.materialCost).toBe(0);
    expect(totals.laborCost).toBe(0);
  });
});

// ============================================================================
// Idempotency and rejection
// ============================================================================

describe("AI proposed action: idempotency and rejection", () => {
  it("applying the same add action twice only inserts one item (idempotent)", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();
    const session = await seedSession(bidId, estimateId);

    const toolCallId = "tc-idem-add";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "add",
        payload: {
          description: "Idempotency test item",
          category: "GENERAL",
          unit: "LS",
          quantity: 1,
          materialCost: 100,
          laborCost: 50,
          equipmentCost: 0,
          subcontractCost: 0,
        },
      },
    ]);

    // First apply — 201 Created
    const first = await applyAction(session.id, message.id, toolCallId);
    expect(first.status).toBe(201);

    // Second apply — 200 alreadyApplied (idempotent, no second insert)
    const second = await applyAction(session.id, message.id, toolCallId);
    expect(second.status).toBe(200);
    expect(second.body.alreadyApplied).toBe(true);

    // Totals must reflect exactly ONE item, not two.
    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(150); // 100+50
    expect(totals.materialCost).toBe(100);
    expect(totals.laborCost).toBe(50);
  });

  it("rejected action does not mutate the estimate and a subsequent apply returns 409", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();
    const session = await seedSession(bidId, estimateId);

    const toolCallId = "tc-rej-001";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "add",
        payload: {
          description: "Rejected high-cost item",
          category: "GENERAL",
          unit: "LS",
          quantity: 1,
          materialCost: 99999,
          laborCost: 0,
          equipmentCost: 0,
          subcontractCost: 0,
        },
      },
    ]);

    // Reject the proposed action.
    const rejectRes = await rejectAction(session.id, message.id, toolCallId);
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.rejected).toBe(true);

    // Attempting to apply after rejection must be blocked (409).
    const applyAfterReject = await applyAction(session.id, message.id, toolCallId);
    expect(applyAfterReject.status).toBe(409);

    // The estimate totals must remain at zero — no item was inserted.
    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(0);
  });

  it("applying an edit to a non-existent line item returns 404 and leaves totals unchanged", async () => {
    const { bidId, estimateId } = await seedBidAndEstimate();

    // One real item so the estimate is not empty.
    await db.insert(estimateLineItems).values({
      estimateId,
      category: "CONCRETE",
      description: "Real item",
      quantity: "1.00",
      unit: "LS",
      materialCost: "250.00",
      laborCost: "250.00",
      equipmentCost: "0.00",
      subcontractCost: "0.00",
      consumablesCost: "0.00",
      overheadAllocation: "0.00",
      profitAllocation: "0.00",
      laborHours: "0",
      equipmentHours: "0",
      totalCost: "500.00",
    });

    const session = await seedSession(bidId, estimateId);
    const toolCallId = "tc-edit-404";
    const message = await seedMessageWithActions(session.id, [
      {
        toolCallId,
        action: "edit",
        payload: {
          lineItemId: "00000000-0000-0000-0000-000000000000", // does not exist
          materialCost: 999,
        },
      },
    ]);

    const applyRes = await applyAction(session.id, message.id, toolCallId);
    expect(applyRes.status).toBe(404);

    // Totals must be unchanged (still 500).
    const totals = await getTotals(bidId);
    expect(totals.totalCost).toBe(500);
  });
});
