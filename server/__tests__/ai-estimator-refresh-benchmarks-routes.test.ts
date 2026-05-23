// Task #3038 / Task #3047 — Integration coverage for the two HTTP routes that
// let estimators re-run only the Phase-4 benchmark verification step:
//
//   POST /api/ai-estimator/estimate/:bidId/refresh-benchmarks
//   PATCH /api/ai-estimator/estimate/:estimateId/benchmark-summary
//
// Tests locked in:
//   • 401 when unauthenticated
//   • 403 when the caller has no estimator access
//   • 404 when the bid has no estimate
//   • 422 when the estimate has no line items
//   • 200 happy path (AI call mocked) — verifies DB persistence and JSON shape
//   • AI failure → non-200 response
//   • 429 when the bid belongs to a different org (POST route — blocked path)
//   • PATCH 401 when unauthenticated
//   • PATCH 403 when the estimate belongs to a different org
//   • PATCH 404 when the estimateId doesn't exist in the org
//   • PATCH 200 happy path — verifies DB update
//
// `routedChatCompletion` (the real AI boundary used by
// `refreshBenchmarksForEstimate`) is mocked at the module level so this
// file never touches the real API and runs fully offline.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq } from "drizzle-orm";

// Mock the AI provider boundary used by refreshBenchmarksForEstimate.
const routedChatCompletionMock = vi.fn();
vi.mock("../ai/providers/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/providers/index")>();
  return { ...actual, routedChatCompletion: routedChatCompletionMock };
});

// Governance wrapper — pass through to the fn directly
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
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setUserAccess } from "../services/aiEstimator/access";
import { setFeatureFlag } from "../services/featureFlagService";
import { installAsyncErrorShim } from "../utils/expressAsyncShim";

const PREFIX = "__ai_est_refresh_bm__";

interface ActorCtx {
  userId: string;
  orgId: string | null;
  token: string;
}

let app: Express;
let estimator: ActorCtx;
let noAccessUser: ActorCtx;
let bidWithEstimateId: string;
let bidWithEmptyEstimateId: string;
let bidNoEstimateId: string;
let estimateWithLineItemsId: string;

// Cross-org fixtures — org B data accessed by org A's estimator
let orgBEstimator: ActorCtx;
let orgBBidId: string;
let orgBEstimateId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"}))`).catch(() => {});
  await db.execute(sql`DELETE FROM estimates WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM feature_flag_manual_changes WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM feature_flag_preset_applications WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_user_access WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [orgA] = await db
    .insert(organizations)
    .values([
      { name: "BM Refresh Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();

  await setFeatureFlag(orgA.id, "AI_ESTIMATOR", true, null);

  const seedActor = async (opts: {
    orgId: string | null;
    role: "ADMIN" | "ESTIMATOR" | "SUPER_ADMIN";
    label: string;
    enableEstimator?: boolean;
  }): Promise<ActorCtx> => {
    const [user] = await db
      .insert(users)
      .values({
        email: `${PREFIX}${opts.label}-${stamp}@test.local`,
        passwordHash,
        firstName: opts.label,
        lastName: "User",
        role: opts.role,
        organizationId: opts.orgId,
        isActive: true,
      })
      .returning();
    if (opts.enableEstimator && opts.orgId) {
      await setUserAccess({ organizationId: opts.orgId, userId: user.id, enabled: true, changedById: user.id });
    }
    return { userId: user.id, orgId: opts.orgId, token: generateToken(user.id, user.tokenVersion ?? 0) };
  };

  estimator    = await seedActor({ orgId: orgA.id, role: "ESTIMATOR", label: "est-on",  enableEstimator: true });
  noAccessUser = await seedActor({ orgId: orgA.id, role: "ESTIMATOR", label: "est-off", enableEstimator: false });

  // Bid with an estimate that has line items
  const [bidFull] = await db
    .insert(bids)
    .values({ name: "Full Bid", code: `${PREFIX}BF-${stamp}`, clientName: "C", gcOrganizationId: orgA.id })
    .returning();
  bidWithEstimateId = bidFull.id;

  const [estFull] = await db
    .insert(estimates)
    .values({ bidId: bidFull.id, baseBidAmount: "50000", createdById: estimator.userId })
    .returning();
  estimateWithLineItemsId = estFull.id;

  await db.insert(estimateLineItems).values([
    { estimateId: estFull.id, category: "CONCRETE",         description: "Slab on grade",   quantity: "100", unit: "CY",  totalCost: "15000", laborHours: "8" },
    { estimateId: estFull.id, category: "STRUCTURAL_STEEL", description: "Rebar placement", quantity: "50",  unit: "TON", totalCost: "12000", laborHours: "4" },
  ]);

  // Bid with an estimate but NO line items
  const [bidEmpty] = await db
    .insert(bids)
    .values({ name: "Empty Bid", code: `${PREFIX}BE-${stamp}`, clientName: "C", gcOrganizationId: orgA.id })
    .returning();
  bidWithEmptyEstimateId = bidEmpty.id;

  await db
    .insert(estimates)
    .values({ bidId: bidEmpty.id, baseBidAmount: "0", createdById: estimator.userId });

  // Bid with no estimate at all
  const [bidNone] = await db
    .insert(bids)
    .values({ name: "No Estimate Bid", code: `${PREFIX}BN-${stamp}`, clientName: "C", gcOrganizationId: orgA.id })
    .returning();
  bidNoEstimateId = bidNone.id;

  // ── Org B: separate tenant — used for cross-org isolation tests ──────────
  const [orgB] = await db
    .insert(organizations)
    .values([
      { name: "BM Refresh Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();

  await setFeatureFlag(orgB.id, "AI_ESTIMATOR", true, null);

  orgBEstimator = await seedActor({ orgId: orgB.id, role: "ESTIMATOR", label: "est-b", enableEstimator: true });

  const [orgBBid] = await db
    .insert(bids)
    .values({ name: "Org B Bid", code: `${PREFIX}BB-${stamp}`, clientName: "C", gcOrganizationId: orgB.id })
    .returning();
  orgBBidId = orgBBid.id;

  const [orgBEst] = await db
    .insert(estimates)
    .values({ bidId: orgBBid.id, baseBidAmount: "10000", createdById: orgBEstimator.userId })
    .returning();
  orgBEstimateId = orgBEst.id;

  await db.insert(estimateLineItems).values([
    { estimateId: orgBEst.id, category: "CONCRETE", description: "Foundation pour", quantity: "50", unit: "CY", totalCost: "8000", laborHours: "6" },
  ]);

  // Install async error shim so rejected async route handlers propagate to
  // Express error middleware instead of hanging the request (Express 4 only).
  installAsyncErrorShim();

  const aiEstimatorRoutes = (await import("../aiEstimatorRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api", aiEstimatorRoutes);
  // Error handler so async route failures return a 500 instead of hanging.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  routedChatCompletionMock.mockReset();
});

function authCookie(token: string) {
  return [`auth_token=${token}`];
}

function makeBenchmarkResponse(benchmarkSummary: string, overallConfidence: string) {
  return {
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ benchmarkSummary, overallConfidence }) }, finish_reason: "end_turn" }],
    usage: { prompt_tokens: 120, completion_tokens: 80 },
    model: "claude-sonnet-4-5",
    provider: "anthropic" as const,
    fallbackUsed: false,
    latencyMs: 200,
  };
}

// ============================================================================
// POST /api/ai-estimator/estimate/:bidId/refresh-benchmarks
// ============================================================================
describe("POST /api/ai-estimator/estimate/:bidId/refresh-benchmarks", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const res = await request(app).post(`/api/ai-estimator/estimate/${bidWithEstimateId}/refresh-benchmarks`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no estimator access", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/estimate/${bidWithEstimateId}/refresh-benchmarks`)
      .set("Cookie", authCookie(noAccessUser.token));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the bid doesn't exist in the org (random UUID)", async () => {
    // A bid ID that has never been created in any org — the estimate lookup
    // finds nothing and the route returns 404 immediately without ever
    // reaching the AI layer.
    const ghostBidId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .post(`/api/ai-estimator/estimate/${ghostBidId}/refresh-benchmarks`)
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the bid has no estimate", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/estimate/${bidNoEstimateId}/refresh-benchmarks`)
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 422 when the estimate has no line items", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/estimate/${bidWithEmptyEstimateId}/refresh-benchmarks`)
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with benchmarkSummary + overallConfidence and persists them to DB", async () => {
    const summary = "Material costs are within 5% of RS Means Q1 2026 indices.";
    const confidence = "MEDIUM";
    routedChatCompletionMock.mockResolvedValueOnce(makeBenchmarkResponse(summary, confidence));

    const res = await request(app)
      .post(`/api/ai-estimator/estimate/${bidWithEstimateId}/refresh-benchmarks`)
      .set("Cookie", authCookie(estimator.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      estimateId: estimateWithLineItemsId,
      benchmarkSummary: expect.any(String),
      overallConfidence: expect.any(String),
    });

    // Verify DB persistence
    const [row] = await db
      .select({ bs: estimates.aiDraftBenchmarkSummary, oc: estimates.aiDraftOverallConfidence })
      .from(estimates)
      .where(eq(estimates.id, estimateWithLineItemsId));
    expect(row.bs).not.toBeNull();
    expect(row.oc).not.toBeNull();
  });

  it("returns a non-200 status when the AI call throws", async () => {
    routedChatCompletionMock.mockRejectedValueOnce(new Error("AI upstream timeout"));

    const res = await request(app)
      .post(`/api/ai-estimator/estimate/${bidWithEstimateId}/refresh-benchmarks`)
      .set("Cookie", authCookie(estimator.token));

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 429 (blocked) when the bid belongs to a different org", async () => {
    // Org A's estimator attempts to refresh benchmarks on Org B's bid.
    // The service layer catches the ResourceOwnershipError from assertBidInOrg
    // and returns { blocked: true }, which the route converts to a 429.
    const res = await request(app)
      .post(`/api/ai-estimator/estimate/${orgBBidId}/refresh-benchmarks`)
      .set("Cookie", authCookie(estimator.token));

    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty("error");
  });
});

// ============================================================================
// PATCH /api/ai-estimator/estimate/:estimateId/benchmark-summary
// ============================================================================
describe("PATCH /api/ai-estimator/estimate/:estimateId/benchmark-summary", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const res = await request(app)
      .patch(`/api/ai-estimator/estimate/${estimateWithLineItemsId}/benchmark-summary`)
      .send({ benchmarkSummary: "summary", overallConfidence: "HIGH" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the estimateId is a random UUID not in this org", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/ai-estimator/estimate/${fakeId}/benchmark-summary`)
      .set("Cookie", authCookie(estimator.token))
      .send({ benchmarkSummary: "x", overallConfidence: "LOW" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the estimate belongs to a different org", async () => {
    // Org A's estimator attempts to overwrite the benchmark summary on an
    // estimate owned by Org B.  The route resolves the estimate, calls
    // assertBidInOrg, catches the ResourceOwnershipError, and returns 403.
    const res = await request(app)
      .patch(`/api/ai-estimator/estimate/${orgBEstimateId}/benchmark-summary`)
      .set("Cookie", authCookie(estimator.token))
      .send({ benchmarkSummary: "injected summary from wrong org", overallConfidence: "LOW" });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with { ok: true } and persists the summary", async () => {
    const payload = {
      benchmarkSummary: "Costs inline with ENR Building Cost Index. Confidence HIGH.",
      overallConfidence: "HIGH",
    };

    const res = await request(app)
      .patch(`/api/ai-estimator/estimate/${estimateWithLineItemsId}/benchmark-summary`)
      .set("Cookie", authCookie(estimator.token))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // Verify DB persistence
    const [row] = await db
      .select({ bs: estimates.aiDraftBenchmarkSummary, oc: estimates.aiDraftOverallConfidence })
      .from(estimates)
      .where(eq(estimates.id, estimateWithLineItemsId));
    expect(row.bs).toBe(payload.benchmarkSummary);
    expect(row.oc).toBe(payload.overallConfidence);
  });
});
