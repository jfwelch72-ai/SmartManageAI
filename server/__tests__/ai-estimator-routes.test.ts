// Task #2340 — Integration coverage for the two AI Estimator HTTP
// surfaces called out in the task brief:
//
//   GET  /api/ai-estimator/admin/access  — admin-only
//   PUT  /api/ai-estimator/admin/access  — admin-only
//   POST /api/ai-estimator/feedback      — must update learned rates
//
// The router is mounted directly behind `authMiddleware` so we drive
// auth via signed cookies seeded with `generateToken`. No real OpenAI
// calls happen in these flows — `/feedback` is pure org-data writes.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setUserAccess } from "../services/aiEstimator/access";
import { getLearnedRate } from "../services/aiEstimator/learnedRates";

const PREFIX = "__ai_est_routes__";

interface ActorCtx {
  userId: string;
  orgId: string;
  token: string;
}

let app: Express;
let admin: ActorCtx;          // ADMIN role → has canManageAiEstimator
let estimator: ActorCtx;      // ESTIMATOR role → no admin perm, but enabled
let estimatorOff: ActorCtx;   // ESTIMATOR role → NOT enabled in aiEstimatorUserAccess
let otherOrgAdmin: ActorCtx;  // ADMIN in a sibling org — should not see admin's users

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_feedback_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_user_access WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

async function seedActor(opts: {
  orgId: string;
  role: "ADMIN" | "ESTIMATOR";
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

beforeAll(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [orgA, orgB] = await db
    .insert(organizations)
    .values([
      { name: "Routes Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "Routes Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();

  admin = await seedActor({ orgId: orgA.id, role: "ADMIN", label: "admin", passwordHash, enableEstimator: true });
  estimator = await seedActor({ orgId: orgA.id, role: "ESTIMATOR", label: "estimator-on", passwordHash, enableEstimator: true });
  estimatorOff = await seedActor({ orgId: orgA.id, role: "ESTIMATOR", label: "estimator-off", passwordHash, enableEstimator: false });
  otherOrgAdmin = await seedActor({ orgId: orgB.id, role: "ADMIN", label: "other-admin", passwordHash, enableEstimator: true });

  // Mount the router under the same `/api` base used in production so the
  // route paths in the tests match what the frontend actually calls.
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

describe("GET /api/ai-estimator/admin/access — admin-only", () => {
  it("rejects unauthenticated callers (401)", async () => {
    const res = await request(app).get("/api/ai-estimator/admin/access");
    expect(res.status).toBe(401);
  });

  it("rejects ESTIMATOR users without canManageAiEstimator (403)", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(estimator.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/canManageAiEstimator/);
  });

  it("returns the org's user access matrix for ADMIN callers", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    const ids = res.body.users.map((u: { userId: string }) => u.userId);
    expect(ids).toContain(admin.userId);
    expect(ids).toContain(estimator.userId);
    expect(ids).toContain(estimatorOff.userId);
    // The other-org admin must not leak across the tenant boundary.
    expect(ids).not.toContain(otherOrgAdmin.userId);

    const onRow = res.body.users.find((u: { userId: string }) => u.userId === estimator.userId);
    const offRow = res.body.users.find((u: { userId: string }) => u.userId === estimatorOff.userId);
    expect(onRow?.enabled).toBe(true);
    expect(offRow?.enabled).toBe(false);
  });

  it("scopes the user list to the caller's org", async () => {
    const res = await request(app)
      .get("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(otherOrgAdmin.token));
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u: { userId: string }) => u.userId);
    expect(ids).toEqual([otherOrgAdmin.userId]);
  });
});

describe("PUT /api/ai-estimator/admin/access — admin-only", () => {
  it("rejects ESTIMATOR users (403)", async () => {
    const res = await request(app)
      .put("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(estimator.token))
      .send({ userId: estimatorOff.userId, enabled: true });
    expect(res.status).toBe(403);
  });

  it("flips a user's enabled flag and the change is visible on the next GET", async () => {
    const putRes = await request(app)
      .put("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(admin.token))
      .send({ userId: estimatorOff.userId, enabled: true, canTrain: true });
    expect(putRes.status).toBe(200);
    expect(putRes.body.enabled).toBe(true);
    expect(putRes.body.canTrain).toBe(true);

    const getRes = await request(app)
      .get("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(admin.token));
    expect(getRes.status).toBe(200);
    const row = getRes.body.users.find((u: { userId: string }) => u.userId === estimatorOff.userId);
    expect(row.enabled).toBe(true);
    expect(row.canTrain).toBe(true);

    // Reset for downstream tests in case of re-runs.
    await request(app)
      .put("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(admin.token))
      .send({ userId: estimatorOff.userId, enabled: false });
  });

  it("rejects malformed payloads with a validation error", async () => {
    const res = await request(app)
      .put("/api/ai-estimator/admin/access")
      .set("Cookie", authCookie(admin.token))
      .send({ userId: estimatorOff.userId /* missing enabled */ });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ai-estimator/feedback — updates learned rates", () => {
  it("rejects ESTIMATOR users that have not been granted access (403)", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/feedback")
      .set("Cookie", authCookie(estimatorOff.token))
      .send({
        surface: "inline_unit_cost",
        outcome: "ACCEPTED",
        targetType: "estimate_line_item",
        costCode: "ROUTE-FB-1",
        rateSample: { metric: "unit_cost", unit: "CY", value: 200 },
      });
    expect(res.status).toBe(403);
    expect(res.body.featureFlag).toBe("AI_ESTIMATOR");
  });

  it("ACCEPTED + finite rateSample writes a feedback event AND updates the learned rate", async () => {
    const lookup = { costCode: "ROUTE-FB-ACCEPT", metric: "unit_cost" as const, unit: "CY" };
    expect(await getLearnedRate(estimator.orgId, lookup)).toBeNull();

    const res = await request(app)
      .post("/api/ai-estimator/feedback")
      .set("Cookie", authCookie(estimator.token))
      .send({
        surface: "inline_unit_cost",
        outcome: "ACCEPTED",
        targetType: "estimate_line_item",
        costCode: lookup.costCode,
        rateSample: { metric: lookup.metric, unit: lookup.unit, value: 312.5 },
      });
    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(estimator.orgId);
    expect(res.body.outcome).toBe("ACCEPTED");

    const rate = await getLearnedRate(estimator.orgId, lookup);
    expect(rate).not.toBeNull();
    expect(rate!.sampleSize).toBe(1);
    expect(Number(rate!.meanValue)).toBeCloseTo(312.5, 4);
  });

  it("EDITED with a different value appends another sample to the same row", async () => {
    const lookup = { costCode: "ROUTE-FB-ACCEPT", metric: "unit_cost" as const, unit: "CY" };

    const res = await request(app)
      .post("/api/ai-estimator/feedback")
      .set("Cookie", authCookie(estimator.token))
      .send({
        surface: "inline_unit_cost",
        outcome: "EDITED",
        targetType: "estimate_line_item",
        costCode: lookup.costCode,
        rateSample: { metric: lookup.metric, unit: lookup.unit, value: 287.5 },
      });
    expect(res.status).toBe(201);

    const rate = await getLearnedRate(estimator.orgId, lookup);
    expect(rate!.sampleSize).toBe(2);
    expect(Number(rate!.meanValue)).toBeCloseTo(300, 4);
  });

  it("REJECTED outcome records the event but does NOT update learned rates", async () => {
    const lookup = { costCode: "ROUTE-FB-REJECT", metric: "unit_cost" as const, unit: "CY" };

    const res = await request(app)
      .post("/api/ai-estimator/feedback")
      .set("Cookie", authCookie(estimator.token))
      .send({
        surface: "inline_unit_cost",
        outcome: "REJECTED",
        targetType: "estimate_line_item",
        costCode: lookup.costCode,
        rateSample: { metric: lookup.metric, unit: lookup.unit, value: 999 },
      });
    expect(res.status).toBe(201);
    expect(await getLearnedRate(estimator.orgId, lookup)).toBeNull();
  });

  it("rejects non-finite sample values at the schema layer (400)", async () => {
    const res = await request(app)
      .post("/api/ai-estimator/feedback")
      .set("Cookie", authCookie(estimator.token))
      .send({
        surface: "inline_unit_cost",
        outcome: "ACCEPTED",
        targetType: "estimate_line_item",
        costCode: "ROUTE-FB-NAN",
        // JSON has no NaN literal; null should also fail since z.number() is required.
        rateSample: { metric: "unit_cost", unit: "CY", value: null },
      });
    expect(res.status).toBe(400);
  });
});
