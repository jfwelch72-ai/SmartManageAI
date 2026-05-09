// Task #2735 — Integration coverage for the AI chat panel undo flow
// (POST .../proposed-actions/undo).
//
// Covers:
//   • Happy path — undo an "add" action: newly-created line item is deleted,
//     action decision is reset to idle (no decision/undoSnapshot).
//   • Happy path — undo an "edit" action: line item fields are restored to
//     previousValues captured in the undoSnapshot.
//   • Happy path — undo a "delete" action: line item is re-inserted with a
//     new id from the previousData snapshot.
//   • Already-undone: calling undo a second time on the same action returns 409.
//   • Missing undoSnapshot → 409 (no snapshot to reverse).
//   • Action has not been applied (decision != "applied") → 409.
//   • Action was rejected → 409.
//   • Wrong toolCallId → 404.
//   • Org isolation: a user in org B cannot access org A's session → 404.
//
// OpenAI is mocked at the module boundary so no real AI calls happen.
// All DB operations use real Postgres (same dev DB) with a cleanup guard.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq, and } from "drizzle-orm";

vi.mock("../ai/openaiClient", () => ({
  AI_MODEL_GPT5: "gpt-5",
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
  projects,
  estimates,
  estimateLineItems,
  aiEstimatorChatSessions,
  aiEstimatorChatMessages,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setUserAccess } from "../services/aiEstimator/access";

const PREFIX = "__undo_flow__";

// ─── Typed interface for proposed actions ──────────────────────────────────────

interface ProposedActionUndoSnapshot {
  lineItemId?: string;
  previousValues?: Record<string, unknown>;
  previousData?: Record<string, unknown>;
}

interface ProposedAction {
  toolCallId: string;
  action: "add" | "edit" | "delete";
  payload: Record<string, unknown>;
  decision?: "applied" | "rejected";
  decisionAt?: string;
  undoSnapshot?: ProposedActionUndoSnapshot;
  validationError?: string;
}

// ─── Context types ─────────────────────────────────────────────────────────────

interface ActorCtx {
  userId: string;
  orgId: string;
  token: string;
}

interface ScenarioCtx {
  actor: ActorCtx;
  estimateId: string;
  sessionId: string;
  messageId: string;
}

let app: Express;
let actorA: ActorCtx;
let actorB: ActorCtx;

// ─── helpers ──────────────────────────────────────────────────────────────────

function authCookie(token: string) {
  return [`auth_token=${token}`];
}

function undoUrl(ctx: ScenarioCtx): string {
  return `/api/ai-estimator/chat/sessions/${ctx.sessionId}/messages/${ctx.messageId}/proposed-actions/undo`;
}

async function getProposedActions(messageId: string): Promise<ProposedAction[]> {
  const [row] = await db
    .select({ proposedActions: aiEstimatorChatMessages.proposedActions })
    .from(aiEstimatorChatMessages)
    .where(eq(aiEstimatorChatMessages.id, messageId))
    .limit(1);
  return (row?.proposedActions as ProposedAction[]) ?? [];
}

// ─── seed helpers ─────────────────────────────────────────────────────────────

async function seedOrgAndUser(
  label: string,
  passwordHash: string,
): Promise<ActorCtx> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `${PREFIX}${label}-${stamp}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Undo Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}${label}-${stamp}@test.local`,
      passwordHash,
      firstName: label,
      lastName: "Tester",
      role: "ESTIMATOR",
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

  return {
    userId: user.id,
    orgId: org.id,
    token: generateToken(user.id, user.tokenVersion ?? 0),
  };
}

/**
 * Seed a project → estimate → chat-session → chat-message scaffold for an
 * actor. Returns the IDs needed to call the undo endpoint.
 *
 * `proposedActions` is the raw JSONB array written directly to the message
 * so tests can control the exact state (decision, undoSnapshot, etc.).
 */
async function seedScenario(
  actor: ActorCtx,
  proposedActions: ProposedAction[],
): Promise<ScenarioCtx> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [project] = await db
    .insert(projects)
    .values({
      name: `Undo Project ${stamp}`,
      code: `${PREFIX}P-${stamp}`.slice(0, 50),
      clientName: "Test Client",
      gcOrganizationId: actor.orgId,
      status: "ACTIVE",
    })
    .returning();

  const [estimate] = await db
    .insert(estimates)
    .values({
      projectId: project.id,
      status: "DRAFT",
      createdById: actor.userId,
    })
    .returning();

  const [session] = await db
    .insert(aiEstimatorChatSessions)
    .values({
      organizationId: actor.orgId,
      userId: actor.userId,
      estimateId: estimate.id,
    })
    .returning();

  const [message] = await db
    .insert(aiEstimatorChatMessages)
    .values({
      sessionId: session.id,
      role: "assistant",
      content: "Here are my suggested changes.",
      proposedActions: proposedActions as ProposedAction[],
    })
    .returning();

  return {
    actor,
    estimateId: estimate.id,
    sessionId: session.id,
    messageId: message.id,
  };
}

// ─── global setup / teardown ──────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  // Delete in dependency order; all keyed on org slug prefix.
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
      WHERE project_id IN (
        SELECT id FROM projects WHERE gc_organization_id IN (
          SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
        )
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM estimates
    WHERE project_id IN (
      SELECT id FROM projects WHERE gc_organization_id IN (
        SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM projects
    WHERE gc_organization_id IN (
      SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM ai_estimator_user_access
    WHERE organization_id IN (
      SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM users WHERE email LIKE ${PREFIX + "%"}
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}
  `).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  actorA = await seedOrgAndUser("actor-a", passwordHash);
  actorB = await seedOrgAndUser("actor-b", passwordHash);

  const aiEstimatorRoutes = (await import("../aiEstimatorRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api", aiEstimatorRoutes);

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (!res.headersSent) {
      res.status(err?.status ?? 500).json({ error: err?.message ?? "error" });
    }
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// Undo an "add" action (happy path)
// ─────────────────────────────────────────────────────────────────────────────

describe("undo add action", () => {
  it("deletes the created line item and resets the action decision", async () => {
    // Create a real line item so the undo has something to delete.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projSlug = `${PREFIX}add-p-${stamp}`.slice(0, 50);

    const [project] = await db.insert(projects).values({
      name: `Add Undo Project ${stamp}`,
      code: projSlug,
      clientName: "Test Client",
      gcOrganizationId: actorA.orgId,
      status: "ACTIVE",
    }).returning();

    const [estimate] = await db.insert(estimates).values({
      projectId: project.id,
      status: "DRAFT",
      createdById: actorA.userId,
    }).returning();

    const [lineItem] = await db.insert(estimateLineItems).values({
      estimateId: estimate.id,
      category: "GENERAL",
      description: "Test add line item",
      quantity: "10",
      unit: "HR",
      materialCost: "0",
      laborCost: "500",
      laborHours: "10",
      equipmentCost: "0",
      equipmentHours: "0",
      subcontractCost: "0",
      consumablesCost: "0",
      overheadAllocation: "0",
      profitAllocation: "0",
      totalCost: "500",
      source: "MANUAL",
    }).returning();

    const toolCallId = `tc-add-${stamp}`;
    const proposedActions: ProposedAction[] = [
      {
        toolCallId,
        action: "add",
        payload: { description: "Test add line item", category: "GENERAL", unit: "HR", quantity: "10" },
        decision: "applied",
        decisionAt: new Date().toISOString(),
        undoSnapshot: { lineItemId: lineItem.id },
      },
    ];

    const [session] = await db.insert(aiEstimatorChatSessions).values({
      organizationId: actorA.orgId,
      userId: actorA.userId,
      estimateId: estimate.id,
    }).returning();

    const [message] = await db.insert(aiEstimatorChatMessages).values({
      sessionId: session.id,
      role: "assistant",
      content: "AI added a line item.",
      proposedActions: proposedActions as ProposedAction[],
    }).returning();

    const res = await request(app)
      .post(`/api/ai-estimator/chat/sessions/${session.id}/messages/${message.id}/proposed-actions/undo`)
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });

    expect(res.status).toBe(200);
    expect(res.body.undone).toBe(true);
    expect(res.body.toolCallId).toBe(toolCallId);

    // Line item must be gone.
    const remaining = await db
      .select({ id: estimateLineItems.id })
      .from(estimateLineItems)
      .where(eq(estimateLineItems.id, lineItem.id));
    expect(remaining).toHaveLength(0);

    // The action's decision/undoSnapshot must be cleared.
    const actions = await getProposedActions(message.id);
    const action = actions.find((a) => a.toolCallId === toolCallId);
    expect(action).toBeDefined();
    expect(action?.decision).toBeUndefined();
    expect(action?.undoSnapshot).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Undo an "edit" action (happy path)
// ─────────────────────────────────────────────────────────────────────────────

describe("undo edit action", () => {
  it("restores previous field values and resets the action decision", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projSlug = `${PREFIX}edit-p-${stamp}`.slice(0, 50);

    const [project] = await db.insert(projects).values({
      name: `Edit Undo Project ${stamp}`,
      code: projSlug,
      clientName: "Test Client",
      gcOrganizationId: actorA.orgId,
      status: "ACTIVE",
    }).returning();

    const [estimate] = await db.insert(estimates).values({
      projectId: project.id,
      status: "DRAFT",
      createdById: actorA.userId,
    }).returning();

    // Insert the line item in its post-edit state (description changed by AI).
    const [lineItem] = await db.insert(estimateLineItems).values({
      estimateId: estimate.id,
      category: "CONCRETE",
      description: "AI-edited description",
      quantity: "20",
      unit: "SF",
      materialCost: "800",
      laborCost: "0",
      laborHours: "0",
      equipmentCost: "0",
      equipmentHours: "0",
      subcontractCost: "0",
      consumablesCost: "0",
      overheadAllocation: "0",
      profitAllocation: "0",
      totalCost: "800",
      source: "MANUAL",
    }).returning();

    const toolCallId = `tc-edit-${stamp}`;
    const previousValues: Record<string, unknown> = {
      description: "Original description",
      category: "CONCRETE",
      quantity: "10",
      unit: "SF",
      materialCost: "400",
      laborCost: "0",
      equipmentCost: "0",
      subcontractCost: "0",
      totalCost: "400",
    };

    const proposedActions: ProposedAction[] = [
      {
        toolCallId,
        action: "edit",
        payload: { lineItemId: lineItem.id, description: "AI-edited description", quantity: "20" },
        decision: "applied",
        decisionAt: new Date().toISOString(),
        undoSnapshot: { lineItemId: lineItem.id, previousValues },
      },
    ];

    const [session] = await db.insert(aiEstimatorChatSessions).values({
      organizationId: actorA.orgId,
      userId: actorA.userId,
      estimateId: estimate.id,
    }).returning();

    const [message] = await db.insert(aiEstimatorChatMessages).values({
      sessionId: session.id,
      role: "assistant",
      content: "AI edited a line item.",
      proposedActions: proposedActions as ProposedAction[],
    }).returning();

    const res = await request(app)
      .post(`/api/ai-estimator/chat/sessions/${session.id}/messages/${message.id}/proposed-actions/undo`)
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });

    expect(res.status).toBe(200);
    expect(res.body.undone).toBe(true);
    expect(res.body.toolCallId).toBe(toolCallId);

    // Line item should have the previous description and quantity.
    const [restored] = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.id, lineItem.id));
    expect(restored).toBeDefined();
    expect(restored.description).toBe("Original description");
    expect(Number(restored.quantity)).toBe(10);
    expect(Number(restored.materialCost)).toBe(400);

    // Action decision cleared.
    const actions = await getProposedActions(message.id);
    const action = actions.find((a) => a.toolCallId === toolCallId);
    expect(action?.decision).toBeUndefined();
    expect(action?.undoSnapshot).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Undo a "delete" action (happy path)
// ─────────────────────────────────────────────────────────────────────────────

describe("undo delete action", () => {
  it("re-inserts the previously deleted line item with a new id", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projSlug = `${PREFIX}del-p-${stamp}`.slice(0, 50);

    const [project] = await db.insert(projects).values({
      name: `Delete Undo Project ${stamp}`,
      code: projSlug,
      clientName: "Test Client",
      gcOrganizationId: actorA.orgId,
      status: "ACTIVE",
    }).returning();

    const [estimate] = await db.insert(estimates).values({
      projectId: project.id,
      status: "DRAFT",
      createdById: actorA.userId,
    }).returning();

    const toolCallId = `tc-del-${stamp}`;
    // The line item was already deleted by the AI, so we store its data in
    // the snapshot only — no live row exists in the DB.
    const previousData: Record<string, unknown> = {
      estimateId: estimate.id,
      category: "GENERAL",
      description: "Excavator rental",
      quantity: "5",
      unit: "DAY",
      materialCost: "0",
      laborCost: "0",
      laborHours: "0",
      equipmentCost: "1500",
      equipmentHours: "5",
      subcontractCost: "0",
      consumablesCost: "0",
      overheadAllocation: "0",
      profitAllocation: "0",
      totalCost: "1500",
      source: "MANUAL",
    };

    const proposedActions: ProposedAction[] = [
      {
        toolCallId,
        action: "delete",
        payload: { lineItemId: "some-deleted-id" },
        decision: "applied",
        decisionAt: new Date().toISOString(),
        undoSnapshot: { previousData },
      },
    ];

    const [session] = await db.insert(aiEstimatorChatSessions).values({
      organizationId: actorA.orgId,
      userId: actorA.userId,
      estimateId: estimate.id,
    }).returning();

    const [message] = await db.insert(aiEstimatorChatMessages).values({
      sessionId: session.id,
      role: "assistant",
      content: "AI deleted a line item.",
      proposedActions: proposedActions as ProposedAction[],
    }).returning();

    const res = await request(app)
      .post(`/api/ai-estimator/chat/sessions/${session.id}/messages/${message.id}/proposed-actions/undo`)
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });

    expect(res.status).toBe(201);
    expect(res.body.undone).toBe(true);
    expect(res.body.toolCallId).toBe(toolCallId);

    // A new line item should exist in the estimate.
    const reinserted = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimate.id));
    expect(reinserted).toHaveLength(1);
    expect(reinserted[0].description).toBe("Excavator rental");
    expect(Number(reinserted[0].equipmentCost)).toBe(1500);

    // Action decision cleared.
    const actions = await getProposedActions(message.id);
    const action = actions.find((a) => a.toolCallId === toolCallId);
    expect(action?.decision).toBeUndefined();
    expect(action?.undoSnapshot).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────

describe("undo error cases", () => {
  it("returns 409 when the action has no undoSnapshot", async () => {
    const toolCallId = `tc-no-snap-${Date.now()}`;
    const ctx = await seedScenario(actorA, [
      {
        toolCallId,
        action: "add",
        payload: { description: "Some item" },
        decision: "applied",
        decisionAt: new Date().toISOString(),
        // undoSnapshot intentionally omitted
      },
    ]);

    const res = await request(app)
      .post(undoUrl(ctx))
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/undo snapshot/i);
  });

  it("returns 409 when the action has not been applied", async () => {
    const toolCallId = `tc-not-applied-${Date.now()}`;
    const ctx = await seedScenario(actorA, [
      {
        toolCallId,
        action: "add",
        payload: { description: "Some item" },
        // No decision field — still at idle state
      },
    ]);

    const res = await request(app)
      .post(undoUrl(ctx))
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not been applied/i);
  });

  it("returns 409 when the action was rejected (not applied)", async () => {
    const toolCallId = `tc-rejected-${Date.now()}`;
    const ctx = await seedScenario(actorA, [
      {
        toolCallId,
        action: "add",
        payload: { description: "Some item" },
        decision: "rejected",
        decisionAt: new Date().toISOString(),
      },
    ]);

    const res = await request(app)
      .post(undoUrl(ctx))
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not been applied/i);
  });

  it("returns 404 when the toolCallId does not match any action", async () => {
    const toolCallId = `tc-real-${Date.now()}`;
    const ctx = await seedScenario(actorA, [
      {
        toolCallId,
        action: "add",
        payload: { description: "Some item" },
        decision: "applied",
        decisionAt: new Date().toISOString(),
        undoSnapshot: { lineItemId: "fake-id" },
      },
    ]);

    const res = await request(app)
      .post(undoUrl(ctx))
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId: "tc-wrong-id" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 when the session belongs to another org (org isolation)", async () => {
    const toolCallId = `tc-isolation-${Date.now()}`;
    // Seed under org A
    const ctx = await seedScenario(actorA, [
      {
        toolCallId,
        action: "add",
        payload: { description: "Some item" },
        decision: "applied",
        decisionAt: new Date().toISOString(),
        undoSnapshot: { lineItemId: "fake-id" },
      },
    ]);

    // Actor B from org B tries to undo org A's action
    const res = await request(app)
      .post(undoUrl(ctx))
      .set("Cookie", authCookie(actorB.token))
      .send({ toolCallId });

    // `getSessionForUser` scopes by orgId+userId so org B's user sees no
    // session → 404.
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/session not found/i);
  });

  it("returns 409 when calling undo a second time on the same already-undone action", async () => {
    // Seed a scenario with a line item that can be deleted (undo of add).
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projSlug = `${PREFIX}2nd-undo-p-${stamp}`.slice(0, 50);

    const [project] = await db.insert(projects).values({
      name: `Second Undo Project ${stamp}`,
      code: projSlug,
      clientName: "Test Client",
      gcOrganizationId: actorA.orgId,
      status: "ACTIVE",
    }).returning();

    const [estimate] = await db.insert(estimates).values({
      projectId: project.id,
      status: "DRAFT",
      createdById: actorA.userId,
    }).returning();

    const [lineItem] = await db.insert(estimateLineItems).values({
      estimateId: estimate.id,
      category: "GENERAL",
      description: "Second undo test item",
      quantity: "1",
      unit: "LS",
      materialCost: "0",
      laborCost: "100",
      laborHours: "2",
      equipmentCost: "0",
      equipmentHours: "0",
      subcontractCost: "0",
      consumablesCost: "0",
      overheadAllocation: "0",
      profitAllocation: "0",
      totalCost: "100",
      source: "MANUAL",
    }).returning();

    const toolCallId = `tc-2nd-undo-${stamp}`;
    const proposedActions: ProposedAction[] = [
      {
        toolCallId,
        action: "add",
        payload: { description: "Second undo test item" },
        decision: "applied",
        decisionAt: new Date().toISOString(),
        undoSnapshot: { lineItemId: lineItem.id },
      },
    ];

    const [session] = await db.insert(aiEstimatorChatSessions).values({
      organizationId: actorA.orgId,
      userId: actorA.userId,
      estimateId: estimate.id,
    }).returning();

    const [message] = await db.insert(aiEstimatorChatMessages).values({
      sessionId: session.id,
      role: "assistant",
      content: "AI added a test item.",
      proposedActions: proposedActions as ProposedAction[],
    }).returning();

    const endpoint = `/api/ai-estimator/chat/sessions/${session.id}/messages/${message.id}/proposed-actions/undo`;

    // First undo — must succeed.
    const first = await request(app)
      .post(endpoint)
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });
    expect(first.status).toBe(200);
    expect(first.body.undone).toBe(true);

    // Second undo on the same action — decision was cleared by the first call,
    // so the action is no longer in "applied" state → 409.
    const second = await request(app)
      .post(endpoint)
      .set("Cookie", authCookie(actorA.token))
      .send({ toolCallId });
    expect(second.status).toBe(409);
  });
});
