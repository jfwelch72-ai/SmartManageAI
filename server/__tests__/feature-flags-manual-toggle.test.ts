import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";

interface MeResponse {
  user: { id: string; role: string; organizationId: string | null };
}

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

async function loginAs(role: string): Promise<{ cookie: string; orgId: string | null; userId: string }> {
  const res = await request(app).post("/api/dev/test-login").send({ role });
  expect(res.status, `dev login (${role}) failed: ${res.text}`).toBe(200);
  const cookie = extractCookie(res);
  expect(cookie).toBeTruthy();
  const me = await request(app).get("/api/auth/me").set("Cookie", cookie!);
  expect(me.status).toBe(200);
  const body = me.body as MeResponse;
  return { cookie: cookie!, orgId: body.user.organizationId, userId: body.user.id };
}

beforeAll(async () => {
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
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}, 30_000);

describe("PATCH /api/feature-flags/:orgId individual toggle + manual change audit", () => {
  it("SUPER_ADMIN can flip a single flag; audit row records who/when/before/after", async () => {
    const admin = await loginAs("ADMIN");
    expect(admin.orgId).toBeTruthy();
    const sa = await loginAs("SUPER_ADMIN");

    // Read current value first.
    const before = await request(app)
      .get(`/api/feature-flags/${admin.orgId}`)
      .set("Cookie", sa.cookie);
    expect(before.status).toBe(200);
    const beforeVal: boolean = !!before.body.flags["BIM_VIEWER"];
    const target = !beforeVal;

    const patch = await request(app)
      .patch(`/api/feature-flags/${admin.orgId}`)
      .set("Cookie", sa.cookie)
      .send({ flag: "BIM_VIEWER", enabled: target });
    expect(patch.status, `patch failed: ${patch.text}`).toBe(200);
    expect(patch.body.flags.BIM_VIEWER).toBe(target);

    const list = await request(app)
      .get(`/api/feature-flags/${admin.orgId}/manual-flag-changes?page=1&pageSize=10`)
      .set("Cookie", sa.cookie);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.length).toBeGreaterThan(0);
    const top = list.body.items[0];
    expect(top.flagKey).toBe("BIM_VIEWER");
    expect(top.previousValue).toBe(beforeVal);
    expect(top.newValue).toBe(target);
    expect(top.changedBy?.id).toBe(sa.userId);
  });

  it("ADMIN cannot use PATCH to flip individual flags (returns 403)", async () => {
    const admin = await loginAs("ADMIN");
    const res = await request(app)
      .patch(`/api/feature-flags/${admin.orgId}`)
      .set("Cookie", admin.cookie)
      .send({ flag: "BIM_VIEWER", enabled: true });
    expect(res.status).toBe(403);
  });

  it("ADMIN can read manual-flag-changes for own org but not another", async () => {
    const admin = await loginAs("ADMIN");
    const ok = await request(app)
      .get(`/api/feature-flags/${admin.orgId}/manual-flag-changes`)
      .set("Cookie", admin.cookie);
    expect(ok.status).toBe(200);
    const denied = await request(app)
      .get(`/api/feature-flags/00000000-0000-0000-0000-000000000000/manual-flag-changes`)
      .set("Cookie", admin.cookie);
    expect(denied.status).toBe(403);
  });

  it("Invalid flag key returns 400", async () => {
    const admin = await loginAs("ADMIN");
    const sa = await loginAs("SUPER_ADMIN");
    const res = await request(app)
      .patch(`/api/feature-flags/${admin.orgId}`)
      .set("Cookie", sa.cookie)
      .send({ flag: "NOT_A_FLAG", enabled: true });
    expect(res.status).toBe(400);
  });

  it("Re-applying same value does not create a new audit row", async () => {
    const admin = await loginAs("ADMIN");
    const sa = await loginAs("SUPER_ADMIN");
    // Force ON
    await request(app)
      .patch(`/api/feature-flags/${admin.orgId}`)
      .set("Cookie", sa.cookie)
      .send({ flag: "DOCUMENT_CONTROL", enabled: true });
    const before = await request(app)
      .get(`/api/feature-flags/${admin.orgId}/manual-flag-changes?pageSize=1`)
      .set("Cookie", sa.cookie);
    const beforeTotal: number = before.body.total;
    // Set ON again — no change
    await request(app)
      .patch(`/api/feature-flags/${admin.orgId}`)
      .set("Cookie", sa.cookie)
      .send({ flag: "DOCUMENT_CONTROL", enabled: true });
    const after = await request(app)
      .get(`/api/feature-flags/${admin.orgId}/manual-flag-changes?pageSize=1`)
      .set("Cookie", sa.cookie);
    expect(after.body.total).toBe(beforeTotal);
  });
});
