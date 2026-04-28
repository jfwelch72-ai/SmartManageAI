// Task #2340 — Stub-driven coverage for the four AI Estimator services
// that talk to OpenAI:
//
//   • inlineSuggest        — pure org-data lookup (no AI), but covered
//                            here for completeness alongside the others
//   • chat (sendChatTurn)  — citation pipeline + persisted assistant turn
//   • draftEstimate        — JSON parsing + IDOR guard
//   • takeoffDraft         — plan-document scoping + JSON parsing
//
// All OpenAI calls are mocked at the module boundary so this file never
// hits the real API. `governedAiCall` is bypassed so we can assert the
// downstream behaviour without threading governance fixtures.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";

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

vi.mock("../ai/documentExtractor", () => ({
  extractDocumentContent: vi.fn(async () => [{ type: "text", text: "Plan sheet content for tests" }]),
}));

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  projects,
  planDocuments,
} from "@shared/schema";
import { openai } from "../ai/openaiClient";
import { recordRateSample } from "../services/aiEstimator/learnedRates";
import { suggestInline } from "../services/aiEstimator/inlineSuggest";
import { generateDraftEstimate } from "../services/aiEstimator/draftEstimate";
import { draftTakeoffFromPlans } from "../services/aiEstimator/takeoffDraft";
import { createSession, sendChatTurn } from "../services/aiEstimator/chat";

const PREFIX = "__ai_est_ai__";

interface Ctx {
  orgA: string;
  orgB: string;
  userA: string;
  bidA: string;
  bidB: string;
  projectA: string;
  planDocA: string;
}
let ctx: Ctx;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_chat_messages WHERE session_id IN (SELECT id FROM ai_estimator_chat_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}))`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_chat_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM plan_documents WHERE file_name LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [orgA, orgB] = await db
    .insert(organizations)
    .values([
      { name: "AI Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "AI Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();
  const [userA] = await db
    .insert(users)
    .values({
      email: `${PREFIX}u-${stamp}@test.local`,
      passwordHash,
      firstName: "AI",
      lastName: "User",
      role: "ESTIMATOR",
      organizationId: orgA.id,
      isActive: true,
    })
    .returning();
  const [bidA, bidB] = await db
    .insert(bids)
    .values([
      { name: "AI Bid A", code: `${PREFIX}BA-${stamp}`, clientName: "Client", gcOrganizationId: orgA.id },
      { name: "AI Bid B", code: `${PREFIX}BB-${stamp}`, clientName: "Client", gcOrganizationId: orgB.id },
    ])
    .returning();
  const [projectA] = await db
    .insert(projects)
    .values({
      name: "AI Project A",
      code: `${PREFIX}PA-${stamp}`,
      clientName: "Client",
      gcOrganizationId: orgA.id,
      status: "ACTIVE",
    })
    .returning();
  const [planDocA] = await db
    .insert(planDocuments)
    .values({
      scope: "PROJECT",
      projectId: projectA.id,
      organizationId: orgA.id,
      type: "PLANS",
      title: "Plan A",
      fileName: `${PREFIX}plan-a-${stamp}.pdf`,
      fileUrl: "https://example.com/plan-a.pdf",
      uploadedById: userA.id,
    })
    .returning();
  ctx = {
    orgA: orgA.id,
    orgB: orgB.id,
    userA: userA.id,
    bidA: bidA.id,
    bidB: bidB.id,
    projectA: projectA.id,
    planDocA: planDocA.id,
  };
}, 60_000);

afterAll(async () => {
  await cleanup();
});

const openaiCreate = openai.chat.completions.create as unknown as ReturnType<typeof vi.fn>;

describe("inlineSuggest — pure learned-rates lookup, never hits OpenAI", () => {
  it("returns null when no learned rate exists", async () => {
    openaiCreate.mockClear();
    const out = await suggestInline({
      organizationId: ctx.orgA,
      costCode: "INLINE-MISSING",
      metric: "unit_cost",
      unit: "CY",
    });
    expect(out).toBeNull();
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns a summary built from learned rates without calling OpenAI", async () => {
    openaiCreate.mockClear();
    const lookup = { costCode: "INLINE-OK", metric: "unit_cost" as const, unit: "CY" };
    for (const v of [100, 150, 200]) {
      await recordRateSample(ctx.orgA, { ...lookup, value: v });
    }
    const out = await suggestInline({
      organizationId: ctx.orgA,
      costCode: lookup.costCode,
      metric: lookup.metric,
      unit: lookup.unit,
    });
    expect(out).not.toBeNull();
    expect(out!.point).toBeCloseTo(150, 4);
    expect(out!.sampleSize).toBe(3);
    expect(out!.source).toBe("learned_rate");
    expect(openaiCreate).not.toHaveBeenCalled();
  });
});

describe("sendChatTurn — citation pipeline with mocked OpenAI", () => {
  it("persists user + assistant turns and returns the AI answer", async () => {
    openaiCreate.mockReset();
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Per your past 3 jobs the unit cost averages $150/CY." } }],
    });

    const session = await createSession({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      bidId: ctx.bidA,
      title: "Test conversation",
    });
    const out = await sendChatTurn({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      session,
      prompt: "What did similar concrete jobs cost us?",
    });
    if ("blocked" in out && out.blocked) throw new Error("unexpected block");
    expect(out.userMessage.role).toBe("user");
    expect(out.userMessage.content).toBe("What did similar concrete jobs cost us?");
    expect(out.assistantMessage.role).toBe("assistant");
    expect(out.assistantMessage.content).toContain("$150/CY");
    // Citations array exists (may be empty without retrieval rows).
    expect(Array.isArray(out.assistantMessage.citations)).toBe(true);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("falls back to a safe default when the model returns null content", async () => {
    openaiCreate.mockReset();
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });
    const session = await createSession({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      bidId: ctx.bidA,
      title: "Empty answer test",
    });
    const out = await sendChatTurn({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      session,
      prompt: "Anything?",
    });
    if ("blocked" in out && out.blocked) throw new Error("unexpected block");
    expect(out.assistantMessage.content).toMatch(/don't have enough information/i);
  });
});

describe("generateDraftEstimate — JSON parsing + IDOR guard", () => {
  it("returns blocked=true when the bid belongs to a different org", async () => {
    openaiCreate.mockReset();
    const out = await generateDraftEstimate({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      bidId: ctx.bidB, // owned by orgB
    });
    expect(out.blocked).toBe(true);
    expect(out.result).toBeNull();
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("parses the AI JSON envelope into a structured DraftEstimateResult", async () => {
    openaiCreate.mockReset();
    openaiCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              lines: [
                {
                  description: "Slab on grade",
                  costCode: "03 30 00",
                  quantity: 100,
                  unit: "CY",
                  unitCost: 150,
                  laborHours: 8,
                  totalCost: 15000,
                  rationale: "Rate from learned data",
                  citationIds: [],
                },
              ],
              notes: "Drafted from 3 prior jobs",
              confidence: 72,
            }),
          },
        },
      ],
    });

    const out = await generateDraftEstimate({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      bidId: ctx.bidA,
      scopeNotes: "concrete slab",
    });
    expect(out.blocked).toBeUndefined();
    expect(out.result).not.toBeNull();
    expect(out.result!.lines).toHaveLength(1);
    expect(out.result!.lines[0].description).toBe("Slab on grade");
    expect(out.result!.confidence).toBe(72);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("returns a fallback result (no parseable JSON) when the model emits garbage", async () => {
    openaiCreate.mockReset();
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json" } }],
    });
    const out = await generateDraftEstimate({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      bidId: ctx.bidA,
    });
    expect(out.result).toBeNull();
    expect(out.reason).toMatch(/parseable JSON/i);
  });
});

describe("draftTakeoffFromPlans — org scoping + JSON parsing", () => {
  it("returns a friendly fallback when no plans exist for the org", async () => {
    openaiCreate.mockReset();
    const out = await draftTakeoffFromPlans({
      organizationId: ctx.orgB, // orgB has no plan documents
      userId: ctx.userA,
      planDocumentIds: [ctx.planDocA], // tries to smuggle orgA's doc — must not work
    });
    expect(out.result).toBeNull();
    expect(out.reason).toMatch(/no plan documents/i);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("parses the AI JSON envelope into a structured TakeoffDraftResult", async () => {
    openaiCreate.mockReset();
    openaiCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              measurements: [
                {
                  label: "Foundation slab",
                  type: "AREA",
                  value: 1200,
                  unit: "SF",
                  costCode: "03 30 00",
                  rationale: "Visible on plan",
                },
              ],
              notes: "",
              confidence: 60,
            }),
          },
        },
      ],
    });

    const out = await draftTakeoffFromPlans({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      planDocumentIds: [ctx.planDocA],
      scopeNotes: "site work",
    });
    expect(out.blocked).toBeUndefined();
    expect(out.result).not.toBeNull();
    expect(out.result!.measurements).toHaveLength(1);
    expect(out.result!.measurements[0].label).toBe("Foundation slab");
    expect(out.result!.confidence).toBe(60);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });
});
