// Task #2398 — Integration coverage for the four AI Estimator HTTP
// routes that prior tasks (#2340, #2397) left untouched at the route
// layer:
//
//   GET  /api/ai-estimator/status
//   POST /api/ai-estimator/suggest/inline
//   POST /api/ai-estimator/draft-estimate
//   POST /api/ai-estimator/draft-takeoff
//
// Specifically locks in:
//   • The per-user feature-flag / canTrain / canManage matrix that
//     `/status` returns (and which every UI surface keys off of):
//       — anonymous            → 401
//       — user with no org     → enabled:false, FEATURE_FLAG_OFF envelope
//       — estimator-off        → enabled:false, canManage:false
//       — estimator-on         → enabled:true,  canManage:false
//       — admin                → enabled:true,  canManage:true
//       — SUPER_ADMIN          → canManage:true even without an
//                                aiEstimatorUserAccess row (role bypass)
//   • The cheap learned-rates lookup behind `/suggest/inline`, including
//     the gating, the 200/null shape when no rate exists, and the 200
//     happy path when a learned rate is present.
//   • The OpenAI `fallback: true` envelope returned by both
//     `/draft-estimate` and `/draft-takeoff` when the AI returns
//     unparseable JSON. Also asserts the happy paths (parsed JSON makes
//     it back through the route).
//   • The 400 / 403 / 401 gating on every endpoint above.
//
// All OpenAI calls are mocked at the module boundary (mirroring the
// pattern in `ai-estimator-ai-services.test.ts` and
// `ai-estimator-chat-and-ingest-routes.test.ts`) so this file never
// hits the real API. `governedAiCall` is bypassed for the same reason,
// and `extractDocumentContent` is stubbed so `/draft-takeoff` never
// has to fetch a real PDF.

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
import { sql } from "drizzle-orm";

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
  extractDocumentContent: vi.fn(async () => [
    { type: "text", text: "Stubbed plan content for /draft-takeoff route test" },
  ]),
}));

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  projects,
  planDocuments,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setUserAccess } from "../services/aiEstimator/access";
import { recordRateSample } from "../services/aiEstimator/learnedRates";
import { setFeatureFlag } from "../services/featureFlagService";
import { openai } from "../ai/openaiClient";

const PREFIX = "__ai_est_sid_routes__";

interface ActorCtx {
  userId: string;
  orgId: string | null;
  token: string;
}

let app: Express;
let admin: ActorCtx;          // ADMIN role in orgA → canManageAiEstimator
let estimator: ActorCtx;      // ESTIMATOR role in orgA → enabled
let estimatorOff: ActorCtx;   // ESTIMATOR role in orgA → NOT enabled
let otherOrgEst: ActorCtx;    // ESTIMATOR in orgB → enabled (cross-tenant guard)
let superAdmin: ActorCtx;     // SUPER_ADMIN in orgA → no access row, must bypass
let noOrgUser: ActorCtx;      // ESTIMATOR with NO organization → status FEATURE_FLAG_OFF

let orgAId: string;
let orgBId: string;
let bidAId: string;
let bidBId: string;
let projectAId: string;
let planDocAId: string;

const openaiCreate = openai.chat.completions.create as unknown as ReturnType<typeof vi.fn>;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_user_access WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM plan_documents WHERE file_name LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

async function seedActor(opts: {
  orgId: string | null;
  role: "ADMIN" | "ESTIMATOR" | "SUPER_ADMIN";
  label: string;
  passwordHash: string;
  enableEstimator?: boolean;
}): Promise<ActorCtx> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}${opts.label}-${stamp}@test.local`,
      passwordHash: opts.passwordHash,
      firstName: opts.label,
      lastName: "User",
      role: opts.role,
      organizationId: opts.orgId,
      isActive: true,
    })
    .returning();
  if (opts.enableEstimator && opts.orgId) {
    await setUserAccess({
      organizationId: opts.orgId,
      userId: user.id,
      enabled: true,
      changedById: user.id,
    });
  }
  return {
    userId: user.id,
    orgId: opts.orgId,
    token: generateToken(user.id, user.tokenVersion ?? 0),
  };
}

function authCookie(token: string) {
  return [`auth_token=${token}`];
}

beforeAll(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [orgA, orgB] = await db
    .insert(organizations)
    .values([
      { name: "SID Routes Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "SID Routes Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();
  orgAId = orgA.id;
  orgBId = orgB.id;

  // Flip the AI_ESTIMATOR feature flag ON for orgA so /status reports
  // featureFlagOn:true. Leave orgB at the default (false) so we can
  // assert that branch in the cross-tenant cases below.
  await setFeatureFlag(orgA.id, "AI_ESTIMATOR", true, null);

  admin        = await seedActor({ orgId: orgA.id, role: "ADMIN",       label: "admin",         passwordHash, enableEstimator: true });
  estimator    = await seedActor({ orgId: orgA.id, role: "ESTIMATOR",   label: "estimator-on",  passwordHash, enableEstimator: true });
  estimatorOff = await seedActor({ orgId: orgA.id, role: "ESTIMATOR",   label: "estimator-off", passwordHash, enableEstimator: false });
  otherOrgEst  = await seedActor({ orgId: orgB.id, role: "ESTIMATOR",   label: "estimator-b",   passwordHash, enableEstimator: true });
  // SUPER_ADMIN intentionally has NO `aiEstimatorUserAccess` row — the
  // role-based bypass branch in `requireEstimatorAccess` is what we want
  // to assert.
  superAdmin   = await seedActor({ orgId: orgA.id, role: "SUPER_ADMIN", label: "super",         passwordHash, enableEstimator: false });
  // User with no org tests the early-return FEATURE_FLAG_OFF envelope
  // in `/status`.
  noOrgUser    = await seedActor({ orgId: null,    role: "ESTIMATOR",   label: "no-org",        passwordHash });

  // Seed a learned rate for the org/cost-code/metric tuple used by the
  // `/suggest/inline` happy path.
  for (const v of [120, 140, 160]) {
    await recordRateSample(orgA.id, {
      costCode: "INLINE-ROUTE-OK",
      metric: "unit_cost",
      unit: "CY",
      value: v,
      sourceType: "feedback_event",
    });
  }

  // A bid + project + plan document in orgA so /draft-estimate and
  // /draft-takeoff have something to chew on. A bid in orgB is also
  // seeded so we can prove the IDOR guard in /draft-estimate kicks in
  // with the documented `blocked` reason.
  const [bidA, bidB] = await db
    .insert(bids)
    .values([
      { name: "SID Bid A", code: `${PREFIX}BA-${stamp}`, clientName: "Client A", gcOrganizationId: orgA.id },
      { name: "SID Bid B", code: `${PREFIX}BB-${stamp}`, clientName: "Client B", gcOrganizationId: orgB.id },
    ])
    .returning();
  bidAId = bidA.id;
  bidBId = bidB.id;

  const [projectA] = await db
    .insert(projects)
    .values({
      name: "SID Project A",
      code: `${PREFIX}PA-${stamp}`,
      clientName: "Client A",
      gcOrganizationId: orgA.id,
      status: "ACTIVE",
    })
    .returning();
  projectAId = projectA.id;

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
      uploadedById: admin.userId,
    })
    .returning();
  planDocAId = planDocA.id;

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

beforeEach(() => {
  openaiCreate.mockReset();
});

// ============================================================================
// GET /api/ai-estimator/status
// ============================================================================
describe("GET /api/ai-estimator/status", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const res = await request(app).get("/api/ai-estimator/status");
    expect(res.status).toBe(401);
  });

  it("returns the FEATURE_FLAG_OFF envelope for users with no organization", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/status")
      .set("Cookie", authCookie(noOrgUser.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      reason: "FEATURE_FLAG_OFF",
      featureFlagOn: false,
      canTrain: false,
      canManage: false,
    });
  });

  it("returns enabled:false / canManage:false for an estimator without an access row", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/status")
      .set("Cookie", authCookie(estimatorOff.token));
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.canTrain).toBe(false);
    expect(res.body.canManage).toBe(false);
    expect(res.body.featureFlagOn).toBe(true);
    expect(res.body.reason).toBe("NOT_ENABLED");
  });

  it("returns enabled:true / canManage:false for an estimator with the access row", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/status")
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    // ESTIMATOR role does NOT carry canManageAiEstimator by default.
    expect(res.body.canManage).toBe(false);
    expect(res.body.featureFlagOn).toBe(true);
    expect(res.body.reason).toBe("OK");
  });

  it("returns canManage:true for ADMIN callers (role-based override)", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/status")
      .set("Cookie", authCookie(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.canManage).toBe(true);
    expect(res.body.featureFlagOn).toBe(true);
  });

  it("returns canManage:true for SUPER_ADMIN even without an access row", async () => {
    // The SUPER_ADMIN actor was seeded WITHOUT `aiEstimatorUserAccess`
    // on purpose. `enabled` follows the access table (still false) but
    // `canManage` must come back true via the role check, which is what
    // the admin UI keys off of.
    const res = await request(app)
      .get("/api/ai-estimator/status")
      .set("Cookie", authCookie(superAdmin.token));
    expect(res.status).toBe(200);
    expect(res.body.canManage).toBe(true);
    expect(res.body.enabled).toBe(false);
  });

  it("reports featureFlagOn:false for an org that has not turned the flag on", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/status")
      .set("Cookie", authCookie(otherOrgEst.token));
    expect(res.status).toBe(200);
    expect(res.body.featureFlagOn).toBe(false);
  });
});

// ============================================================================
// POST /api/ai-estimator/suggest/inline
// ============================================================================
describe("POST /api/ai-estimator/suggest/inline", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/suggest/inline")
      .send({ costCode: "INLINE-ROUTE-OK", metric: "unit_cost", unit: "CY" });
    expect(res.status).toBe(401);
  });

  it("returns 403 with the featureFlag envelope for estimator-off users", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/suggest/inline")
      .set("Cookie", authCookie(estimatorOff.token))
      .send({ costCode: "INLINE-ROUTE-OK", metric: "unit_cost", unit: "CY" });
    expect(res.status).toBe(403);
    expect(res.body.featureFlag).toBe("AI_ESTIMATOR");
    expect(res.body.reason).toBe("NOT_ENABLED");
  });

  it("returns 400 when the body is missing required fields", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/suggest/inline")
      .set("Cookie", authCookie(estimator.token))
      .send({ costCode: "X" }); // missing metric + unit
    expect(res.status).toBe(400);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when metric is not in the enum", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/suggest/inline")
      .set("Cookie", authCookie(estimator.token))
      .send({ costCode: "X", metric: "garbage", unit: "CY" });
    expect(res.status).toBe(400);
  });

  it("returns suggestion:null when no learned rate exists for the tuple", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/suggest/inline")
      .set("Cookie", authCookie(estimator.token))
      .send({ costCode: "INLINE-ROUTE-MISSING", metric: "unit_cost", unit: "CY" });
    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBeNull();
    // Pure org-data lookup — must NEVER call OpenAI.
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns the learned-rate summary when one exists, never calling OpenAI", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/suggest/inline")
      .set("Cookie", authCookie(estimator.token))
      .send({ costCode: "INLINE-ROUTE-OK", metric: "unit_cost", unit: "CY" });
    expect(res.status).toBe(200);
    expect(res.body.suggestion).not.toBeNull();
    expect(res.body.suggestion.source).toBe("learned_rate");
    expect(res.body.suggestion.metric).toBe("unit_cost");
    expect(res.body.suggestion.unit).toBe("CY");
    expect(res.body.suggestion.costCode).toBe("INLINE-ROUTE-OK");
    expect(res.body.suggestion.point).toBeCloseTo(140, 4);
    expect(res.body.suggestion.sampleSize).toBe(3);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller's org (orgB cannot see orgA's rate)", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/suggest/inline")
      .set("Cookie", authCookie(otherOrgEst.token))
      .send({ costCode: "INLINE-ROUTE-OK", metric: "unit_cost", unit: "CY" });
    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBeNull();
  });
});

// ============================================================================
// POST /api/ai-estimator/draft-estimate
// ============================================================================
describe("POST /api/ai-estimator/draft-estimate", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/draft-estimate")
      .send({ bidId: bidAId });
    expect(res.status).toBe(401);
  });

  it("returns 403 for estimator-off users", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/draft-estimate")
      .set("Cookie", authCookie(estimatorOff.token))
      .send({ bidId: bidAId });
    expect(res.status).toBe(403);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when the body has no bidId", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/draft-estimate")
      .set("Cookie", authCookie(estimator.token))
      .send({});
    expect(res.status).toBe(400);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns the parsed estimate when OpenAI returns valid JSON", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              lines: [
                {
                  description: "Concrete footings",
                  costCode: "03-30-00",
                  quantity: 25,
                  unit: "CY",
                  unitCost: 175,
                  laborHours: 10,
                  totalCost: 4375,
                  rationale: "From learned rates",
                  citationIds: [],
                },
              ],
              notes: "Mocked draft notes",
              confidence: 78,
            }),
          },
        },
      ],
    });

    const res = await request(app)
      .post("/api/ai-estimator/draft-estimate")
      .set("Cookie", authCookie(estimator.token))
      .send({ bidId: bidAId, scopeNotes: "Concrete only" });
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBeUndefined();
    expect(Array.isArray(res.body.lines)).toBe(true);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].costCode).toBe("03-30-00");
    expect(res.body.notes).toBe("Mocked draft notes");
    expect(res.body.confidence).toBe(78);
    expect(Array.isArray(res.body.citations)).toBe(true);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("returns the documented `fallback: true` envelope when OpenAI returns unparseable content", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "this is not json {{{" } }],
    });

    const res = await request(app)
      .post("/api/ai-estimator/draft-estimate")
      .set("Cookie", authCookie(estimator.token))
      .send({ bidId: bidAId });
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message).toMatch(/parseable JSON|did not produce/i);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("returns the blocked envelope (HTTP 429) when the bid is not in the caller's org", async () => {
    // The route forwards `out.blocked` from `generateDraftEstimate` to
    // `blockedResponse(...)`, which is a 429 with `error: "AI quota exceeded"`
    // and a `reason` describing what actually happened. Cross-tenant
    // bidId here triggers the IDOR guard and returns blocked:true with
    // a "Bid not found in this organization" reason — never OpenAI.
    const res = await request(app)
      .post("/api/ai-estimator/draft-estimate")
      .set("Cookie", authCookie(estimator.token))
      .send({ bidId: bidBId });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("AI quota exceeded");
    expect(res.body.reason).toMatch(/Bid not found in this organization/i);
    expect(openaiCreate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// POST /api/ai-estimator/draft-takeoff
// ============================================================================
describe("POST /api/ai-estimator/draft-takeoff", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/draft-takeoff")
      .send({ projectId: projectAId });
    expect(res.status).toBe(401);
  });

  it("returns 403 for estimator-off users", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/draft-takeoff")
      .set("Cookie", authCookie(estimatorOff.token))
      .send({ projectId: projectAId });
    expect(res.status).toBe(403);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when neither planDocumentIds nor projectId is supplied", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/draft-takeoff")
      .set("Cookie", authCookie(estimator.token))
      .send({});
    expect(res.status).toBe(400);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns the parsed takeoff when OpenAI returns valid JSON", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              measurements: [
                {
                  label: "Slab on grade",
                  type: "AREA",
                  value: 1200,
                  unit: "SF",
                  costCode: "03-30-00",
                  rationale: "Counted from plan A1",
                },
              ],
              notes: "Mocked takeoff notes",
              confidence: 82,
            }),
          },
        },
      ],
    });

    const res = await request(app)
      .post("/api/ai-estimator/draft-takeoff")
      .set("Cookie", authCookie(estimator.token))
      .send({ planDocumentIds: [planDocAId] });
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBeUndefined();
    expect(Array.isArray(res.body.measurements)).toBe(true);
    expect(res.body.measurements).toHaveLength(1);
    expect(res.body.measurements[0].type).toBe("AREA");
    expect(res.body.notes).toBe("Mocked takeoff notes");
    expect(res.body.confidence).toBe(82);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("returns the `fallback: true` envelope when OpenAI returns unparseable content", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "definitely not json <<<<<<" } }],
    });

    const res = await request(app)
      .post("/api/ai-estimator/draft-takeoff")
      .set("Cookie", authCookie(estimator.token))
      .send({ projectId: projectAId });
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message).toMatch(/parseable JSON/i);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("returns the `fallback: true` envelope without calling OpenAI when no plan documents resolve in the org", async () => {
    // Cross-tenant project id resolves to zero in-org documents, which
    // short-circuits before any OpenAI call and returns the documented
    // "No plan documents found" fallback envelope.
    const res = await request(app)
      .post("/api/ai-estimator/draft-takeoff")
      .set("Cookie", authCookie(otherOrgEst.token))
      .send({ projectId: projectAId });
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(res.body.message).toMatch(/No plan documents/i);
    expect(openaiCreate).not.toHaveBeenCalled();
  });
});
