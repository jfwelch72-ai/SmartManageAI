// Task #2420 — Unit + integration coverage for the AI Estimator
// "lessons-from-edits" feature (Task #2415).
//
// Locks in:
//   • generateLessonFromFeedback — dedup-by-feedback-id, supersede on
//     different content hash, no-op on identical hash, and the
//     AI_PROVIDER_TAKEOFF flag gate via maybeEnqueueLessonGeneration.
//   • retrieveLessons — strict org-scope isolation and the
//     OR-match across global / cost_code / trade / surface buckets.
//   • GET  /api/ai-estimator/admin/lessons      — canManageAiEstimator gate.
//   • DELETE /api/ai-estimator/admin/lessons/:id — gate + 404 on cross-org id.
//
// The provider-routing layer is mocked so this file never makes a real
// LLM call; we control the JSON the "model" returns to drive each branch
// of the dedup/supersede logic deterministically.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Module-boundary mocks. Hoisted by Vitest before the imports below so the
// real provider router and governance wrapper never load.
// ---------------------------------------------------------------------------
const routedChatCompletionMock = vi.fn();
const isFeatureEnabledMock = vi.fn();

vi.mock("../ai/providers", () => ({
  routedChatCompletion: (...args: unknown[]) => routedChatCompletionMock(...args),
}));

vi.mock("../services/aiGovernance", () => ({
  governedAiCall: vi.fn(async (opts: { fn: () => Promise<{ result: unknown }> }) => {
    const { result } = await opts.fn();
    return { result, blocked: false };
  }),
}));

vi.mock("../services/featureFlagService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/featureFlagService")>();
  return {
    ...actual,
    isFeatureEnabled: (...args: Parameters<typeof actual.isFeatureEnabled>) =>
      isFeatureEnabledMock(...args),
  };
});

import { db } from "../db";
import {
  organizations,
  users,
  aiEstimatorKnowledgeIndex,
} from "@shared/schema";
import {
  generateLessonFromFeedback,
  maybeEnqueueLessonGeneration,
} from "../services/aiEstimator/lessons";
import { retrieveLessons } from "../services/aiEstimator/retrieval";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__ai_est_lessons__";

let orgA: string;
let orgB: string;
let adminA: { userId: string; orgId: string; token: string };
let estimatorA: { userId: string; orgId: string; token: string };
let adminB: { userId: string; orgId: string; token: string };
let app: Express;

function feedbackEvent(overrides: Partial<{
  id: string;
  organizationId: string;
  surface: string;
  costCode: string | null;
  tradeType: string | null;
  outcome: string;
}> = {}) {
  return {
    id: overrides.id ?? `feedback-${Math.random().toString(36).slice(2, 10)}`,
    organizationId: overrides.organizationId ?? orgA,
    userId: null,
    surface: overrides.surface ?? "inline_unit_cost",
    outcome: overrides.outcome ?? "EDITED",
    costCode: overrides.costCode ?? "03-30-00",
    tradeType: overrides.tradeType ?? null,
    originalValue: 100,
    finalValue: 112,
    comment: null,
    aiAuditId: null,
  };
}

function mockLesson(payload: {
  lesson: string;
  scope: "global" | "cost_code" | "trade" | "surface";
  costCode?: string | null;
  tradeType?: string | null;
  biasFactor?: number | null;
  confidence?: number | null;
}) {
  routedChatCompletionMock.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  });
}

async function cleanup(): Promise<void> {
  await db
    .execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`)
    .catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [a, b] = await db
    .insert(organizations)
    .values([
      { name: "Lessons Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "Lessons Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();
  orgA = a.id;
  orgB = b.id;

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const seed = async (orgId: string, role: "ADMIN" | "ESTIMATOR", label: string) => {
    const [u] = await db
      .insert(users)
      .values({
        email: `${PREFIX}${label}-${stamp}@test.local`,
        passwordHash,
        firstName: label,
        lastName: "User",
        role,
        organizationId: orgId,
        isActive: true,
      })
      .returning();
    return { userId: u.id, orgId, token: generateToken(u.id, u.tokenVersion ?? 0) };
  };
  adminA = await seed(orgA, "ADMIN", "admin-a");
  estimatorA = await seed(orgA, "ESTIMATOR", "estimator-a");
  adminB = await seed(orgB, "ADMIN", "admin-b");

  const aiEstimatorRoutes = (await import("../aiEstimatorRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api", aiEstimatorRoutes);

  // Default: flag is on. Individual tests can override.
  isFeatureEnabledMock.mockResolvedValue(true);
}, 60_000);

afterAll(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

// =====================================================================
// generateLessonFromFeedback — dedup / supersede / no-op branches
// =====================================================================
describe("generateLessonFromFeedback — dedup, supersede, no-op", () => {
  it("inserts a brand-new active lesson when the bucket is empty", async () => {
    mockLesson({
      lesson: "Add 12% bias to mobilization on small jobs",
      scope: "cost_code",
      costCode: "03-30-00-FRESH",
      biasFactor: 1.12,
      confidence: 0.55,
    });
    const ev = feedbackEvent({ costCode: "03-30-00-FRESH" });
    const row = await generateLessonFromFeedback(ev);
    expect(row).not.toBeNull();
    expect(row!.lessonStatus).toBe("active");
    expect(row!.lessonScope).toBe("cost_code");
    expect(row!.costCode).toBe("03-30-00-FRESH");
    expect(row!.supersedesRowId).toBeNull();
    expect(row!.derivedFromFeedbackIds).toEqual([ev.id]);
  });

  it("dedups by feedback-event id — second call for the same event is a no-op", async () => {
    const ev = feedbackEvent({ costCode: "03-30-00-DUPE" });
    mockLesson({
      lesson: "Bias mobilization +5%",
      scope: "cost_code",
      costCode: "03-30-00-DUPE",
      biasFactor: 1.05,
      confidence: 0.4,
    });
    const first = await generateLessonFromFeedback(ev);
    expect(first).not.toBeNull();

    routedChatCompletionMock.mockClear();
    const second = await generateLessonFromFeedback(ev);
    expect(second).toBeNull();
    // Provider must NOT be called the second time around — the feedback-id
    // dedup short-circuits before we spend an LLM call.
    expect(routedChatCompletionMock).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(
        and(
          eq(aiEstimatorKnowledgeIndex.organizationId, orgA),
          eq(aiEstimatorKnowledgeIndex.costCode, "03-30-00-DUPE"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("no-ops when a different event yields the SAME content hash in the same bucket", async () => {
    // First event: writes a lesson.
    const ev1 = feedbackEvent({ costCode: "03-30-00-SAMEHASH" });
    mockLesson({
      lesson: "Always include weekend OT in labor hours",
      scope: "cost_code",
      costCode: "03-30-00-SAMEHASH",
      confidence: 0.5,
    });
    const r1 = await generateLessonFromFeedback(ev1);
    expect(r1).not.toBeNull();

    // Second, distinct event but identical lesson text + scope + bucket key
    // → contentHash matches → existing row is returned, no new insert.
    const ev2 = feedbackEvent({ costCode: "03-30-00-SAMEHASH" });
    mockLesson({
      lesson: "  Always include weekend OT in labor hours  ", // same after trim/lower
      scope: "cost_code",
      costCode: "03-30-00-SAMEHASH",
      confidence: 0.5,
    });
    const r2 = await generateLessonFromFeedback(ev2);
    expect(r2).not.toBeNull();
    expect(r2!.id).toBe(r1!.id);
    expect(r2!.lessonStatus).toBe("active");

    const rows = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(
        and(
          eq(aiEstimatorKnowledgeIndex.organizationId, orgA),
          eq(aiEstimatorKnowledgeIndex.costCode, "03-30-00-SAMEHASH"),
        ),
      );
    // Exactly one row — supersede-on-same-hash must not insert a duplicate.
    expect(rows).toHaveLength(1);
  });

  it("supersedes the prior row when the same bucket gets a DIFFERENT hash", async () => {
    const ev1 = feedbackEvent({ costCode: "03-30-00-SUPER" });
    mockLesson({
      lesson: "Bias mobilization +10%",
      scope: "cost_code",
      costCode: "03-30-00-SUPER",
      biasFactor: 1.1,
      confidence: 0.5,
    });
    const r1 = await generateLessonFromFeedback(ev1);
    expect(r1).not.toBeNull();

    const ev2 = feedbackEvent({ costCode: "03-30-00-SUPER" });
    mockLesson({
      lesson: "Bias mobilization +20% on jobs under $250K",
      scope: "cost_code",
      costCode: "03-30-00-SUPER",
      biasFactor: 1.2,
      confidence: 0.6,
    });
    const r2 = await generateLessonFromFeedback(ev2);
    expect(r2).not.toBeNull();
    expect(r2!.id).not.toBe(r1!.id);
    expect(r2!.supersedesRowId).toBe(r1!.id);
    expect(r2!.lessonStatus).toBe("active");
    // Provenance carries forward both feedback ids.
    expect(r2!.derivedFromFeedbackIds).toEqual([ev1.id, ev2.id]);

    // The prior row is now stale — never deleted.
    const [prior] = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(eq(aiEstimatorKnowledgeIndex.id, r1!.id));
    expect(prior.lessonStatus).toBe("stale");
  });

  it("returns null and never writes a row for non-EDITED outcomes", async () => {
    routedChatCompletionMock.mockClear();
    const r = await generateLessonFromFeedback(feedbackEvent({ outcome: "ACCEPTED" }));
    expect(r).toBeNull();
    expect(routedChatCompletionMock).not.toHaveBeenCalled();
  });
});

// =====================================================================
// maybeEnqueueLessonGeneration — AI_PROVIDER_TAKEOFF flag gate
// =====================================================================
describe("maybeEnqueueLessonGeneration — AI_PROVIDER_TAKEOFF gate", () => {
  it("does NOT call the provider when the flag is off", async () => {
    routedChatCompletionMock.mockClear();
    isFeatureEnabledMock.mockResolvedValueOnce(false);
    await maybeEnqueueLessonGeneration(feedbackEvent({ costCode: "GATE-OFF" }));
    // Give the fire-and-forget a microtask to settle (it shouldn't run).
    await new Promise((r) => setImmediate(r));
    expect(routedChatCompletionMock).not.toHaveBeenCalled();
  });

  it("does NOT call the provider for non-EDITED outcomes regardless of the flag", async () => {
    routedChatCompletionMock.mockClear();
    isFeatureEnabledMock.mockResolvedValueOnce(true);
    await maybeEnqueueLessonGeneration(feedbackEvent({ outcome: "REJECTED" }));
    await new Promise((r) => setImmediate(r));
    expect(routedChatCompletionMock).not.toHaveBeenCalled();
  });

  it("schedules generation when the flag is on and the outcome is EDITED", async () => {
    routedChatCompletionMock.mockClear();
    isFeatureEnabledMock.mockResolvedValueOnce(true);
    mockLesson({
      lesson: "Trim production rate by 8% on rainy weeks",
      scope: "global",
      confidence: 0.4,
    });
    await maybeEnqueueLessonGeneration(feedbackEvent({ costCode: "GATE-ON" }));
    // Wait for the fire-and-forget to settle. The generator awaits a DB
    // write so a couple of microtask flushes is enough.
    for (let i = 0; i < 10 && routedChatCompletionMock.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(routedChatCompletionMock).toHaveBeenCalledTimes(1);
  });
});

// =====================================================================
// retrieveLessons — org isolation + OR-match across scopes
// =====================================================================
describe("retrieveLessons — org isolation + scope OR-match", () => {
  let lessonGlobalA: string;
  let lessonCostCodeA: string;
  let lessonTradeA: string;
  let lessonSurfaceA: string;
  let lessonStaleA: string;
  let lessonGlobalB: string;

  beforeAll(async () => {
    // Wipe any rows left from earlier suites so this isolation matrix is
    // self-contained.
    await db.execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id IN (${orgA}, ${orgB}) AND source_type = 'qualitative_lesson'`);

    const insert = async (vals: {
      orgId: string;
      scope: "global" | "cost_code" | "trade" | "surface";
      costCode?: string | null;
      tradeType?: string | null;
      surface?: string | null;
      status?: "active" | "stale" | "deleted";
      title: string;
    }) => {
      const [row] = await db
        .insert(aiEstimatorKnowledgeIndex)
        .values({
          organizationId: vals.orgId,
          sourceType: "qualitative_lesson",
          sourceId: `lesson:${Math.random().toString(36).slice(2, 10)}`,
          title: vals.title,
          contentSnippet: vals.title,
          lessonScope: vals.scope,
          lessonStatus: vals.status ?? "active",
          costCode: vals.costCode ?? null,
          tradeType: vals.tradeType ?? null,
          lessonSurface: vals.surface ?? null,
          contentHash: Math.random().toString(36).slice(2),
        })
        .returning();
      return row.id;
    };

    lessonGlobalA = await insert({ orgId: orgA, scope: "global", title: "GLOBAL-A" });
    lessonCostCodeA = await insert({
      orgId: orgA, scope: "cost_code", costCode: "RET-CC-1", title: "CC-A",
    });
    lessonTradeA = await insert({
      orgId: orgA, scope: "trade", tradeType: "ELECTRICAL", title: "TRADE-A",
    });
    lessonSurfaceA = await insert({
      orgId: orgA, scope: "surface", surface: "inline_unit_cost", title: "SURFACE-A",
    });
    lessonStaleA = await insert({
      orgId: orgA, scope: "global", status: "stale", title: "STALE-A",
    });
    lessonGlobalB = await insert({ orgId: orgB, scope: "global", title: "GLOBAL-B" });
  });

  it("never returns lessons from another org", async () => {
    const got = await retrieveLessons({ organizationId: orgA, costCode: "RET-CC-1", tradeType: "ELECTRICAL", surface: "inline_unit_cost" });
    const ids = got.map((r) => r.id);
    expect(ids).not.toContain(lessonGlobalB);
    for (const r of got) expect(r.organizationId).toBe(orgA);
  });

  it("excludes stale and deleted rows", async () => {
    const got = await retrieveLessons({ organizationId: orgA });
    const ids = got.map((r) => r.id);
    expect(ids).not.toContain(lessonStaleA);
    for (const r of got) expect(r.lessonStatus).toBe("active");
  });

  it("OR-matches global + cost_code + trade + surface buckets in a single query", async () => {
    const got = await retrieveLessons({
      organizationId: orgA,
      costCode: "RET-CC-1",
      tradeType: "ELECTRICAL",
      surface: "inline_unit_cost",
    });
    const ids = got.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([
      lessonGlobalA, lessonCostCodeA, lessonTradeA, lessonSurfaceA,
    ]));
  });

  it("ignores cost_code rows when costCode is not supplied (still returns global)", async () => {
    const got = await retrieveLessons({ organizationId: orgA });
    const ids = got.map((r) => r.id);
    expect(ids).toContain(lessonGlobalA);
    expect(ids).not.toContain(lessonCostCodeA);
    expect(ids).not.toContain(lessonTradeA);
    expect(ids).not.toContain(lessonSurfaceA);
  });

  it("does not match a cost_code row whose code differs from the query", async () => {
    const got = await retrieveLessons({ organizationId: orgA, costCode: "RET-CC-DOES-NOT-EXIST" });
    const ids = got.map((r) => r.id);
    expect(ids).toContain(lessonGlobalA);
    expect(ids).not.toContain(lessonCostCodeA);
  });
});

// =====================================================================
// Admin endpoints — permission gate + cross-org 404
// =====================================================================
describe("GET /api/ai-estimator/admin/lessons — permission gate", () => {
  function authCookie(token: string) { return [`auth_token=${token}`]; }

  it("rejects unauthenticated callers (401)", async () => {
    const res = await request(app).get("/api/ai-estimator/admin/lessons");
    expect(res.status).toBe(401);
  });

  it("rejects ESTIMATOR users without canManageAiEstimator (403)", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/lessons")
      .set("Cookie", authCookie(estimatorA.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/canManageAiEstimator/);
  });

  it("returns the org's active lessons for ADMIN callers", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/lessons")
      .set("Cookie", authCookie(adminA.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.lessons)).toBe(true);
    // adminA should see only orgA lessons.
    const titles = res.body.lessons.map((l: { title: string }) => l.title);
    expect(titles).toContain("GLOBAL-A");
    expect(titles).not.toContain("GLOBAL-B");
    // Stale rows are hidden by default (activeOnly=true).
    expect(titles).not.toContain("STALE-A");
  });

  it("includeStale=true surfaces non-active rows for the same org", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/lessons?includeStale=true")
      .set("Cookie", authCookie(adminA.token));
    expect(res.status).toBe(200);
    const titles = res.body.lessons.map((l: { title: string }) => l.title);
    expect(titles).toContain("STALE-A");
  });

  it("does not leak orgA lessons to an admin in orgB", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/lessons")
      .set("Cookie", authCookie(adminB.token));
    expect(res.status).toBe(200);
    const titles = res.body.lessons.map((l: { title: string }) => l.title);
    expect(titles).toContain("GLOBAL-B");
    expect(titles).not.toContain("GLOBAL-A");
  });
});

describe("DELETE /api/ai-estimator/admin/lessons/:id — gate + cross-org 404", () => {
  function authCookie(token: string) { return [`auth_token=${token}`]; }

  let targetLessonId: string;

  beforeAll(async () => {
    const [row] = await db
      .insert(aiEstimatorKnowledgeIndex)
      .values({
        organizationId: orgA,
        sourceType: "qualitative_lesson",
        sourceId: `lesson:del-${Math.random().toString(36).slice(2, 8)}`,
        title: "DELETE-TARGET-A",
        contentSnippet: "DELETE-TARGET-A",
        lessonScope: "global",
        lessonStatus: "active",
        contentHash: Math.random().toString(36).slice(2),
      })
      .returning();
    targetLessonId = row.id;
  });

  it("rejects ESTIMATOR users without canManageAiEstimator (403)", async () => {
    const res = await request(app)
      .delete(`/api/ai-estimator/admin/lessons/${targetLessonId}`)
      .set("Cookie", authCookie(estimatorA.token));
    expect(res.status).toBe(403);
  });

  it("returns 404 when an admin in another org tries to delete the row", async () => {
    const res = await request(app)
      .delete(`/api/ai-estimator/admin/lessons/${targetLessonId}`)
      .set("Cookie", authCookie(adminB.token));
    expect(res.status).toBe(404);

    // Row must still be active — soft-delete must NOT have run.
    const [row] = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(eq(aiEstimatorKnowledgeIndex.id, targetLessonId));
    expect(row.lessonStatus).toBe("active");
  });

  it("soft-deletes the row when called by an admin in the owning org", async () => {
    const res = await request(app)
      .delete(`/api/ai-estimator/admin/lessons/${targetLessonId}`)
      .set("Cookie", authCookie(adminA.token));
    expect(res.status).toBe(204);

    const [row] = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(eq(aiEstimatorKnowledgeIndex.id, targetLessonId));
    expect(row.lessonStatus).toBe("deleted");
  });

  it("returns 404 for an unknown lesson id even within the caller's org", async () => {
    const res = await request(app)
      .delete(`/api/ai-estimator/admin/lessons/00000000-0000-0000-0000-000000000000`)
      .set("Cookie", authCookie(adminA.token));
    expect(res.status).toBe(404);
  });
});
