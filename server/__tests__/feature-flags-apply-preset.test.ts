import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";

interface MeResponse {
  user: { id: string; role: string; organizationId: string | null };
}

interface FlagsResponse {
  flags: Record<string, boolean>;
  keys: string[];
}

const HEAVY_CIVIL_USER_FLAGS = [
  "DOT_PAY_ITEMS",
  "DBE_TRACKING",
  "WH_347_PAYROLL",
  "HAUL_TICKETS",
  "DAILY_INSPECTOR_REPORTS",
  "SWPPP_INSPECTIONS",
  "SURETY_BONDS",
  "BUY_AMERICA",
  "MASS_HAUL_ANALYZER",
] as const;

let app: Express;
let server: Server;
let originalNodeEnv: string | undefined;

function extractCookie(res: request.Response): string | null {
  const cookies = res.headers["set-cookie"] as string | string[] | undefined;
  if (!cookies) return null;
  const arr = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of arr) {
    const m = c.match(/auth_token=([^;]+)/);
    if (m) return `auth_token=${m[1]}`;
  }
  return null;
}

async function loginAs(role: string, linkOrg = false): Promise<{ cookie: string; orgId: string | null; userId: string }> {
  const res = await request(app)
    .post("/api/dev/test-login")
    .send({ role, linkOrg });
  expect(res.status, `dev login (${role}) failed: ${res.text}`).toBe(200);
  const cookie = extractCookie(res);
  expect(cookie, `no auth cookie returned for ${role}`).toBeTruthy();

  const me = await request(app).get("/api/auth/me").set("Cookie", cookie!);
  expect(me.status).toBe(200);
  const body = me.body as MeResponse;
  return { cookie: cookie!, orgId: body.user.organizationId, userId: body.user.id };
}

beforeAll(async () => {
  // /api/dev/test-login is gated by isDevSeedEnabled() which checks
  // NODE_ENV === "development". Vitest defaults NODE_ENV to "test", so
  // override before importing routes. We restore it in afterAll to avoid
  // leaking state across files in shared workers.
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());

  server = await registerRoutes(app);
}, 60_000);

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
}, 30_000);

describe("POST /api/feature-flags/:orgId/apply-preset", () => {
  it("ADMIN same-org: returns 200 and enables all 9 Heavy Civil flags", async () => {
    const admin = await loginAs("ADMIN");
    expect(admin.orgId).toBeTruthy();

    const apply = await request(app)
      .post(`/api/feature-flags/${admin.orgId}/apply-preset`)
      .set("Cookie", admin.cookie)
      .send({ tradeType: "ROADWAY_CONSTRUCTION" });
    expect(apply.status, `apply-preset failed: ${apply.text}`).toBe(200);

    // Verify via GET as SUPER_ADMIN (the only role allowed on GET /:orgId).
    const sa = await loginAs("SUPER_ADMIN");
    const flagsRes = await request(app)
      .get(`/api/feature-flags/${admin.orgId}`)
      .set("Cookie", sa.cookie);
    expect(flagsRes.status).toBe(200);
    const body = flagsRes.body as FlagsResponse;
    for (const flag of HEAVY_CIVIL_USER_FLAGS) {
      expect(body.flags[flag], `flag ${flag} should be true after apply-preset`).toBe(true);
    }
    // The marker preset flag should also be on.
    expect(body.flags["HEAVY_CIVIL_PRESET"]).toBe(true);
  });

  it("SUPER_ADMIN cross-org: returns 200", async () => {
    // Get an org id from a fresh ADMIN login, then call as SUPER_ADMIN (no org).
    const admin = await loginAs("ADMIN");
    expect(admin.orgId).toBeTruthy();

    const sa = await loginAs("SUPER_ADMIN");
    expect(sa.orgId).toBeNull();

    const res = await request(app)
      .post(`/api/feature-flags/${admin.orgId}/apply-preset`)
      .set("Cookie", sa.cookie)
      .send({ tradeType: "ROADWAY_CONSTRUCTION" });
    expect(res.status, `super-admin apply-preset failed: ${res.text}`).toBe(200);
  });

  it("ADMIN cross-org: returns 403", async () => {
    const admin = await loginAs("ADMIN");
    const otherOrgId = "00000000-0000-0000-0000-000000000000";
    expect(otherOrgId).not.toBe(admin.orgId);

    const res = await request(app)
      .post(`/api/feature-flags/${otherOrgId}/apply-preset`)
      .set("Cookie", admin.cookie)
      .send({ tradeType: "ROADWAY_CONSTRUCTION" });
    expect(res.status).toBe(403);
  });

  for (const role of ["MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"]) {
    it(`Non-admin ${role}: returns 403 even on own org`, async () => {
      const u = await loginAs(role);
      expect(u.orgId).toBeTruthy();
      const res = await request(app)
        .post(`/api/feature-flags/${u.orgId}/apply-preset`)
        .set("Cookie", u.cookie)
        .send({ tradeType: "ROADWAY_CONSTRUCTION" });
      expect(res.status).toBe(403);
    });
  }

  it("Missing tradeType: returns 400", async () => {
    const admin = await loginAs("ADMIN");
    const res = await request(app)
      .post(`/api/feature-flags/${admin.orgId}/apply-preset`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(String(res.body?.error || "")).toMatch(/tradeType/i);
  });

  it("Invalid tradeType: returns 400", async () => {
    const admin = await loginAs("ADMIN");
    const res = await request(app)
      .post(`/api/feature-flags/${admin.orgId}/apply-preset`)
      .set("Cookie", admin.cookie)
      .send({ tradeType: "NOT_A_REAL_TRADE" });
    expect(res.status).toBe(400);
    expect(String(res.body?.error || "")).toMatch(/invalid/i);
  });
});
