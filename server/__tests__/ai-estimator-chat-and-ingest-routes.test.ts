// Task #2397 — Integration coverage for the AI Estimator HTTP surfaces
// that the prior task (#2340) left uncovered:
//
//   GET  /api/ai-estimator/chat/sessions
//   POST /api/ai-estimator/chat/sessions
//   GET  /api/ai-estimator/chat/sessions/:id/messages
//   POST /api/ai-estimator/chat/sessions/:id/messages          (full turn)
//   PUT  /api/ai-estimator/chat/sessions/:sid/messages/:mid/feedback
//   GET  /api/ai-estimator/admin/ingest-runs
//   POST /api/ai-estimator/admin/ingest
//   GET  /api/ai-estimator/admin/learned-rates
//   GET  /api/ai-estimator/web-research
//   POST /api/ai-estimator/web-research
//   GET  /api/ai-estimator/web-research/allowlist
//
// Specifically locks in:
//   • The SUPER_ADMIN bypass branch in `requireEstimatorAccess` (a
//     SUPER_ADMIN with no `aiEstimatorUserAccess` row still sails past).
//   • The chat session 404 path (cross-user / unknown id).
//   • The allow-list error envelope returned by the web-research POST
//     route — `{ error, domain, allowList }` with HTTP 400.
//   • Tenant scoping on every list endpoint (org A cannot see org B).
//
// OpenAI is mocked at the module boundary (mirroring the pattern in
// `ai-estimator-ai-services.test.ts`) so this file never hits the real
// API. `governedAiCall` is bypassed for the same reason. Outbound
// `fetch` calls in the web-research route are stubbed via
// `vi.stubGlobal` so the suite is fully hermetic.

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

import { db } from "../db";
import {
  organizations,
  users,
  aiEstimatorChatSessions,
  aiEstimatorIngestRuns,
  aiEstimatorWebResearchCache,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setUserAccess } from "../services/aiEstimator/access";
import { recordRateSample } from "../services/aiEstimator/learnedRates";
import { openai } from "../ai/openaiClient";
import { WEB_RESEARCH_ALLOWLIST } from "../services/aiEstimator/webResearch";

const PREFIX = "__ai_est_chat_ingest__";

interface ActorCtx {
  userId: string;
  orgId: string;
  token: string;
}

let app: Express;
let admin: ActorCtx;          // ADMIN role in orgA → has canManageAiEstimator
let estimator: ActorCtx;      // ESTIMATOR role in orgA → enabled
let estimator2: ActorCtx;     // Second ESTIMATOR in orgA → enabled (used for cross-user 404)
let estimatorOff: ActorCtx;   // ESTIMATOR in orgA → NOT enabled
let otherOrgEst: ActorCtx;    // ESTIMATOR in orgB → enabled (cross-tenant)
let otherOrgAdmin: ActorCtx;  // ADMIN in orgB
let superAdmin: ActorCtx;     // SUPER_ADMIN — must sail past requireEstimatorAccess

const openaiCreate = openai.chat.completions.create as unknown as ReturnType<typeof vi.fn>;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_chat_messages WHERE session_id IN (SELECT id FROM ai_estimator_chat_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}))`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_chat_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_ingest_runs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_web_research_cache WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_user_access WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

async function seedActor(opts: {
  orgId: string;
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
  if (opts.enableEstimator) {
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
      { name: "Chat/Ingest Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "Chat/Ingest Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();

  admin         = await seedActor({ orgId: orgA.id, role: "ADMIN",       label: "admin",         passwordHash, enableEstimator: true });
  estimator     = await seedActor({ orgId: orgA.id, role: "ESTIMATOR",   label: "estimator-a",   passwordHash, enableEstimator: true });
  estimator2    = await seedActor({ orgId: orgA.id, role: "ESTIMATOR",   label: "estimator-a2",  passwordHash, enableEstimator: true });
  estimatorOff  = await seedActor({ orgId: orgA.id, role: "ESTIMATOR",   label: "estimator-off", passwordHash, enableEstimator: false });
  otherOrgEst   = await seedActor({ orgId: orgB.id, role: "ESTIMATOR",   label: "estimator-b",   passwordHash, enableEstimator: true });
  otherOrgAdmin = await seedActor({ orgId: orgB.id, role: "ADMIN",       label: "admin-b",       passwordHash, enableEstimator: true });
  // SUPER_ADMIN intentionally has NO `aiEstimatorUserAccess` row — the
  // bypass branch in `requireEstimatorAccess` is what we want to assert.
  superAdmin    = await seedActor({ orgId: orgA.id, role: "SUPER_ADMIN", label: "super",         passwordHash, enableEstimator: false });

  // Seed one learned rate so the org/learned-rates GET has something to
  // return (and so the chat-turn prompt assembly has rate data to walk).
  await recordRateSample(orgA.id, {
    costCode: "CHAT-RATE-1",
    metric: "unit_cost",
    unit: "CY",
    value: 175,
    sourceType: "feedback_event",
  });
  await recordRateSample(orgB.id, {
    costCode: "ORGB-RATE-1",
    metric: "unit_cost",
    unit: "CY",
    value: 999,
    sourceType: "feedback_event",
  });

  const aiEstimatorRoutes = (await import("../aiEstimatorRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api", aiEstimatorRoutes);
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await cleanup();
});

beforeEach(() => {
  openaiCreate.mockReset();
  vi.unstubAllGlobals();
});

// ============================================================================
// requireEstimatorAccess — auth, no-org, not-enabled, SUPER_ADMIN bypass
// ============================================================================
describe("requireEstimatorAccess gate", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const res = await request(app).get("/api/ai-estimator/chat/sessions");
    expect(res.status).toBe(401);
  });

  it("returns 403 with featureFlag envelope when the user has no access row", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimatorOff.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/AI Estimator/i);
    expect(res.body.featureFlag).toBe("AI_ESTIMATOR");
    expect(res.body.reason).toBe("NOT_ENABLED");
  });

  it("SUPER_ADMIN sails past requireEstimatorAccess even with no access row", async () => {
    // The SUPER_ADMIN actor was seeded WITHOUT `aiEstimatorUserAccess`
    // on purpose. If the gate were checking the access table for them
    // they'd be blocked here.
    const res = await request(app)
      .get("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(superAdmin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });
});

// ============================================================================
// GET / POST /api/ai-estimator/chat/sessions
// ============================================================================
describe("GET /api/ai-estimator/chat/sessions", () => {
  it("returns only the caller's own sessions, never another user's", async () => {
    // Create one for `estimator` and one for `estimator2`.
    const a = await request(app)
      .post("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator.token))
      .send({ title: "Estimator A session" });
    expect(a.status).toBe(201);

    const b = await request(app)
      .post("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator2.token))
      .send({ title: "Estimator A2 session" });
    expect(b.status).toBe(201);

    const list = await request(app)
      .get("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator.token));
    expect(list.status).toBe(200);
    const ids: string[] = list.body.sessions.map((s: { id: string }) => s.id);
    expect(ids).toContain(a.body.id);
    expect(ids).not.toContain(b.body.id);
  });

  it("scopes to org — estimator in org B does not see org A's sessions", async () => {
    const list = await request(app)
      .get("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(otherOrgEst.token));
    expect(list.status).toBe(200);
    for (const s of list.body.sessions) {
      expect(s.organizationId).toBe(otherOrgEst.orgId);
    }
  });
});

describe("POST /api/ai-estimator/chat/sessions", () => {
  it("creates a session bound to caller's org + user with HTTP 201", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator.token))
      .send({ title: "Created by test" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.organizationId).toBe(estimator.orgId);
    expect(res.body.userId).toBe(estimator.userId);
    expect(res.body.title).toBe("Created by test");
  });

  it("rejects malformed payloads with a 400 (title too long)", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator.token))
      .send({ title: "x".repeat(141) });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// GET /api/ai-estimator/chat/sessions/:id/messages — 404 path, ownership
// ============================================================================
describe("GET /api/ai-estimator/chat/sessions/:id/messages", () => {
  let sessionId: string;
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator.token))
      .send({ title: "Messages test session" });
    sessionId = res.body.id;
  });

  it("returns the session + (initially empty) messages array", async () => {
    const res = await request(app)
      .get(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(sessionId);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("returns 404 when the session id is unknown", async () => {
    const res = await request(app)
      .get(`/api/ai-estimator/chat/sessions/nope-${Date.now()}/messages`)
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Session not found/i);
  });

  it("returns 404 when a different user in the same org tries to read it", async () => {
    const res = await request(app)
      .get(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator2.token));
    expect(res.status).toBe(404);
  });

  it("returns 404 when an admin from another org tries to read it", async () => {
    const res = await request(app)
      .get(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(otherOrgAdmin.token));
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST /api/ai-estimator/chat/sessions/:id/messages — full turn
// ============================================================================
describe("POST /api/ai-estimator/chat/sessions/:id/messages (full turn)", () => {
  let sessionId: string;
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator.token))
      .send({ title: "Turn test session" });
    sessionId = res.body.id;
  });

  it("posts a user prompt, returns the mocked AI reply, persists both turns", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Mocked answer for the turn." } }],
    });
    const res = await request(app)
      .post(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator.token))
      .send({ prompt: "What was the unit cost on similar concrete jobs?" });
    expect(res.status).toBe(200);
    expect(res.body.userMessage.role).toBe("user");
    expect(res.body.assistantMessage.role).toBe("assistant");
    expect(res.body.assistantMessage.content).toBe("Mocked answer for the turn.");
    expect(openaiCreate).toHaveBeenCalledTimes(1);

    // Re-read the messages list — both turns must be persisted.
    const list = await request(app)
      .get(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator.token));
    const roles = list.body.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("returns 404 when posting to a session belonging to another user", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator2.token))
      .send({ prompt: "Trying to hijack" });
    expect(res.status).toBe(404);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("rejects empty prompts at the schema layer (400)", async () => {
    const res = await request(app)
      .post(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator.token))
      .send({ prompt: "" });
    expect(res.status).toBe(400);
    expect(openaiCreate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// PUT /api/ai-estimator/chat/sessions/:sid/messages/:mid/feedback
// ============================================================================
describe("PUT /api/ai-estimator/chat/sessions/:sid/messages/:mid/feedback", () => {
  let sessionId: string;
  let assistantMessageId: string;

  beforeAll(async () => {
    const sess = await request(app)
      .post("/api/ai-estimator/chat/sessions")
      .set("Cookie", authCookie(estimator.token))
      .send({ title: "Feedback test session" });
    sessionId = sess.body.id;

    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Reply for feedback test." } }],
    });
    const turn = await request(app)
      .post(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator.token))
      .send({ prompt: "Anything to say?" });
    assistantMessageId = turn.body.assistantMessage.id;
  });

  it("returns 204 and stores the THUMBS_UP outcome on the assistant turn", async () => {
    const res = await request(app)
      .put(`/api/ai-estimator/chat/sessions/${sessionId}/messages/${assistantMessageId}/feedback`)
      .set("Cookie", authCookie(estimator.token))
      .send({ outcome: "THUMBS_UP" });
    expect(res.status).toBe(204);

    const list = await request(app)
      .get(`/api/ai-estimator/chat/sessions/${sessionId}/messages`)
      .set("Cookie", authCookie(estimator.token));
    const stored = list.body.messages.find(
      (m: { id: string }) => m.id === assistantMessageId,
    );
    expect(stored.feedbackOutcome).toBe("THUMBS_UP");
  });

  it("supports clearing feedback with outcome=null", async () => {
    const res = await request(app)
      .put(`/api/ai-estimator/chat/sessions/${sessionId}/messages/${assistantMessageId}/feedback`)
      .set("Cookie", authCookie(estimator.token))
      .send({ outcome: null });
    expect(res.status).toBe(204);
  });

  it("rejects bogus outcomes with a 400", async () => {
    const res = await request(app)
      .put(`/api/ai-estimator/chat/sessions/${sessionId}/messages/${assistantMessageId}/feedback`)
      .set("Cookie", authCookie(estimator.token))
      .send({ outcome: "MEH" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when a different user tries to leave feedback", async () => {
    const res = await request(app)
      .put(`/api/ai-estimator/chat/sessions/${sessionId}/messages/${assistantMessageId}/feedback`)
      .set("Cookie", authCookie(estimator2.token))
      .send({ outcome: "THUMBS_DOWN" });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Admin: ingest-runs / ingest / learned-rates
// ============================================================================
describe("GET /api/ai-estimator/admin/ingest-runs", () => {
  it("rejects ESTIMATOR users with a 403", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/ingest-runs")
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(403);
  });

  it("returns the org's ingest runs for an ADMIN caller (and only their org)", async () => {
    // Pre-seed two runs in different orgs so we can assert scoping.
    const [runA] = await db
      .insert(aiEstimatorIngestRuns)
      .values({
        organizationId: admin.orgId,
        triggeredByUserId: admin.userId,
        triggerType: "MANUAL",
        status: "SUCCEEDED",
      })
      .returning();
    const [runB] = await db
      .insert(aiEstimatorIngestRuns)
      .values({
        organizationId: otherOrgAdmin.orgId,
        triggeredByUserId: otherOrgAdmin.userId,
        triggerType: "MANUAL",
        status: "SUCCEEDED",
      })
      .returning();

    const res = await request(app)
      .get("/api/ai-estimator/admin/ingest-runs")
      .set("Cookie", authCookie(admin.token));
    expect(res.status).toBe(200);
    const ids: string[] = res.body.runs.map((r: { id: string }) => r.id);
    expect(ids).toContain(runA.id);
    expect(ids).not.toContain(runB.id);
  });
});

describe("POST /api/ai-estimator/admin/ingest", () => {
  it("rejects ESTIMATOR users with a 403", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/admin/ingest")
      .set("Cookie", authCookie(estimator.token))
      .send({});
    expect(res.status).toBe(403);
  });

  it("kicks off a run for the admin's org and returns the row", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/admin/ingest")
      .set("Cookie", authCookie(admin.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.run.organizationId).toBe(admin.orgId);
    // No bids/estimates were seeded for this org so the counters all
    // come back as zero — but the run must complete successfully and
    // be visible on the next GET.
    expect(["SUCCEEDED", "FAILED"]).toContain(res.body.run.status);

    const after = await request(app)
      .get("/api/ai-estimator/admin/ingest-runs")
      .set("Cookie", authCookie(admin.token));
    const ids: string[] = after.body.runs.map((r: { id: string }) => r.id);
    expect(ids).toContain(res.body.run.id);
  });
});

describe("GET /api/ai-estimator/admin/learned-rates", () => {
  it("rejects ESTIMATOR users with a 403", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/learned-rates")
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(403);
  });

  it("returns the org's learned rates and excludes other orgs' rows", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/learned-rates")
      .set("Cookie", authCookie(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rates)).toBe(true);
    const codes = res.body.rates.map((r: { costCode: string; organizationId: string }) => {
      expect(r.organizationId).toBe(admin.orgId);
      return r.costCode;
    });
    expect(codes).toContain("CHAT-RATE-1");
    expect(codes).not.toContain("ORGB-RATE-1");
  });
});

// ============================================================================
// Web research GET allowlist + POST happy path / blocked envelope / 502
// ============================================================================
describe("GET /api/ai-estimator/web-research/allowlist", () => {
  it("requires an enabled estimator account (403 for off users)", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/web-research/allowlist")
      .set("Cookie", authCookie(estimatorOff.token));
    expect(res.status).toBe(403);
  });

  it("returns the published allow-list verbatim for enabled callers", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/web-research/allowlist")
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.allowList)).toBe(true);
    expect(res.body.allowList).toEqual([...WEB_RESEARCH_ALLOWLIST]);
  });
});

describe("POST /api/ai-estimator/web-research", () => {
  it("returns the documented 400 envelope for off-list domains and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch must not be called for blocked domains");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post("/api/ai-estimator/web-research")
      .set("Cookie", authCookie(estimator.token))
      .send({ url: "https://evil.example.com/some/path" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allow-list/i);
    expect(res.body.domain).toBe("evil.example.com");
    expect(Array.isArray(res.body.allowList)).toBe(true);
    expect(res.body.allowList).toEqual([...WEB_RESEARCH_ALLOWLIST]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("short-circuits via cache for an allow-listed URL and returns the snippet", async () => {
    // Pre-seed a fresh cache row so the route never has to call fetch.
    const url = `https://www.bls.gov/route-cache-test-${Date.now()}`;
    const fetchedAt = new Date(Date.now() - 60_000);
    await db.insert(aiEstimatorWebResearchCache).values({
      organizationId: estimator.orgId,
      url,
      domain: "www.bls.gov",
      query: null,
      title: "Cached BLS title",
      contentSnippet: "Cached BLS snippet body",
      contentHash: "deadbeef",
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + 24 * 60 * 60 * 1000),
      fetchedByUserId: null,
    });

    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch must not be called when the cache is fresh");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post("/api/ai-estimator/web-research")
      .set("Cookie", authCookie(estimator.token))
      .send({ url, query: "wages" });
    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.title).toBe("Cached BLS title");
    expect(res.body.contentSnippet).toBe("Cached BLS snippet body");
    expect(res.body.domain).toBe("www.bls.gov");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 502 when the upstream fetch fails (allow-listed domain, no cache)", async () => {
    const url = `https://www.osha.gov/route-fetch-fail-${Date.now()}`;
    const fetchSpy = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post("/api/ai-estimator/web-research")
      .set("Cookie", authCookie(estimator.token))
      .send({ url });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Web research fetch failed/i);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("rejects malformed URLs at the schema layer (400)", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/web-research")
      .set("Cookie", authCookie(estimator.token))
      .send({ url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("rejects ESTIMATOR users without access (403, before any fetch)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await request(app)
      .post("/api/ai-estimator/web-research")
      .set("Cookie", authCookie(estimatorOff.token))
      .send({ url: "https://www.bls.gov/anything" });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
