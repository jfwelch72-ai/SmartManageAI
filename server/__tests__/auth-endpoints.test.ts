import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { db } from "../db";
import { auditLog, users, type AuditLog } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { logAuthEvent, logRoleChange } from "../auditLogger";

interface AuthResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  message?: string;
}

interface ErrorResponse {
  error: string;
  details?: Array<{ message: string }>;
}

let app: Express;
let server: Server;
const suffix = Date.now();

beforeAll(async () => {
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
}, 30_000);

type AuditAction = AuditLog["action"];

async function findRecentAudit(
  userId: string,
  action: AuditAction,
  entityId?: string,
) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.action, action)))
    .orderBy(desc(auditLog.createdAt))
    .limit(5);
  if (entityId) {
    return rows.find((r) => r.entityId === entityId);
  }
  return rows[0];
}

describe("Auth Endpoint Integration Tests", () => {
  const testEmail = `integ-auth-${suffix}@test.local`;
  const testPassword = "IntegPass123!";
  let authCookie: string;
  let testUserId: string;

  function extractCookie(res: request.Response): string | null {
    const cookies = res.headers["set-cookie"] as string | string[] | undefined;
    if (!cookies) return null;
    const cookieArr = Array.isArray(cookies) ? cookies : [cookies];
    for (const c of cookieArr) {
      const match = c.match(/auth_token=([^;]+)/);
      if (match) return `auth_token=${match[1]}`;
    }
    return null;
  }

  it("POST /api/auth/register creates user with valid data", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        firstName: "Integration",
        lastName: "Test",
        email: testEmail,
        password: testPassword,
      });

    expect(res.status).toBe(201);
    const body = res.body as AuthResponse;
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(testEmail);
    expect(body.user.firstName).toBe("Integration");
    expect(body.user.role).toBeDefined();

    const cookie = extractCookie(res);
    expect(cookie).toBeTruthy();
  });

  it("POST /api/auth/register rejects duplicate email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        firstName: "Dup",
        lastName: "User",
        email: testEmail,
        password: testPassword,
      });

    expect(res.status).toBe(400);
  });

  it("POST /api/auth/register rejects weak password", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        firstName: "Weak",
        lastName: "Pass",
        email: `integ-weak-${suffix}@test.local`,
        password: "short",
      });

    expect(res.status).toBe(400);
    const body = res.body as ErrorResponse;
    expect(body.error || body.details).toBeDefined();
  });

  it("POST /api/auth/register rejects missing required fields", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: `integ-missing-${suffix}@test.local`,
        password: testPassword,
      });

    expect(res.status).toBe(400);
  });

  it("POST /api/auth/login succeeds with valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(200);
    const body = res.body as AuthResponse;
    expect(body.user || body).toBeDefined();

    const cookie = extractCookie(res);
    expect(cookie).toBeTruthy();
    authCookie = cookie!;

    // Task #2495 — login must write a LOGIN row to the central audit_log.
    const [u] = await db.select().from(users).where(eq(users.email, testEmail)).limit(1);
    expect(u).toBeDefined();
    testUserId = u.id;
    const row = await findRecentAudit(testUserId, "LOGIN", testUserId);
    expect(row).toBeDefined();
    expect(row?.entityType).toBe("users");
    expect(row?.newValue).toContain("password");
  });

  it("POST /api/auth/login rejects invalid password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: testEmail, password: "WrongPassword1!" });

    expect(res.status).toBe(401);

    // Task #2495 — invalid-password attempts (against an existing user)
    // must write a LOGIN_FAILED audit row keyed to that user.
    expect(testUserId).toBeTruthy();
    const row = await findRecentAudit(testUserId, "LOGIN_FAILED", testUserId);
    expect(row).toBeDefined();
    expect(row?.newValue).toContain("invalid_password");
  });

  it("POST /api/auth/login rejects nonexistent email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nonexistent@nowhere.test", password: "Whatever123!" });

    expect(res.status).toBe(401);
  });

  it("GET /api/auth/me returns 401 without auth", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/me returns user with valid cookie", async () => {
    expect(authCookie).toBeTruthy();

    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    const body = res.body as { user: AuthResponse["user"] };
    expect(body.user).toBeDefined();
    expect(body.user.id || body.user.email).toBeDefined();
  });

  it("POST /api/auth/logout clears auth", async () => {
    expect(authCookie).toBeTruthy();

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", authCookie);

    expect(logoutRes.status).toBe(200);

    // Task #2495 — logout must write a LOGOUT row keyed to the user.
    // Allow a brief window for the fire-and-forget insert.
    await new Promise((r) => setTimeout(r, 200));
    const row = await findRecentAudit(testUserId, "LOGOUT", testUserId);
    expect(row).toBeDefined();
    expect(row?.entityType).toBe("users");
  });

  it("POST /api/auth/forgot-password writes a PASSWORD_RESET_REQUESTED audit row", async () => {
    expect(testUserId).toBeTruthy();
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: testEmail });
    // Endpoint always returns 200 (no enumeration), regardless of user existence.
    expect(res.status).toBe(200);

    const row = await findRecentAudit(testUserId, "PASSWORD_RESET_REQUESTED", testUserId);
    expect(row).toBeDefined();
    expect(row?.entityType).toBe("users");
    expect(row?.newValue).toContain("user");
  });

  it("logAuthEvent writes a PASSWORD_RESET row keyed to the target user", async () => {
    // The reset-password route requires a live, non-expired token bound
    // to the user. Exercising the audit helper directly is the most
    // reliable way to assert the end-state row shape without forging
    // a token, and `logAuthEvent` is the same call site the route uses.
    expect(testUserId).toBeTruthy();
    await logAuthEvent(testUserId, "PASSWORD_RESET", { tokenVersionBumped: true });
    const row = await findRecentAudit(testUserId, "PASSWORD_RESET", testUserId);
    expect(row).toBeDefined();
    expect(row?.entityType).toBe("users");
    expect(row?.newValue).toContain("tokenVersionBumped");
  });

  it("logRoleChange writes a ROLE_CHANGED row with before/after roles (PLATFORM scope)", async () => {
    expect(testUserId).toBeTruthy();
    await logRoleChange(
      testUserId,
      testUserId,
      "FIELD_WORKER",
      "MANAGER",
      "PLATFORM",
      { targetEmail: testEmail },
    );
    const row = await findRecentAudit(testUserId, "ROLE_CHANGED", testUserId);
    expect(row).toBeDefined();
    expect(row?.entityType).toBe("users");
    expect(row?.oldValue).toContain("FIELD_WORKER");
    expect(row?.newValue).toContain("MANAGER");
  });

  it("logRoleChange writes ROLE_GRANTED for HUSTLER_ORG scope and ROLE_REVOKED on revoke", async () => {
    expect(testUserId).toBeTruthy();
    const orgId = "00000000-0000-0000-0000-000000000000";
    await logRoleChange(testUserId, testUserId, null, "HUSTLER", "HUSTLER_ORG", {
      organizationId: orgId,
      source: "test_invite",
    });
    const grant = await findRecentAudit(testUserId, "ROLE_GRANTED", testUserId);
    expect(grant).toBeDefined();
    expect(grant?.entityType).toBe("hustlerOrganizations");
    expect(grant?.newValue).toContain("HUSTLER");
    expect(grant?.newValue).toContain(orgId);

    await logRoleChange(testUserId, testUserId, "HUSTLER", null, "HUSTLER_ORG", {
      organizationId: orgId,
      source: "test_unlink",
    });
    const revoke = await findRecentAudit(testUserId, "ROLE_REVOKED", testUserId);
    expect(revoke).toBeDefined();
    expect(revoke?.entityType).toBe("hustlerOrganizations");
    expect(revoke?.oldValue).toContain("HUSTLER");
  });

  it("logAuthEvent writes MFA_ENABLED and MFA_DISABLED rows for the user", async () => {
    expect(testUserId).toBeTruthy();
    await logAuthEvent(testUserId, "MFA_ENABLED", { method: "totp" });
    const enabled = await findRecentAudit(testUserId, "MFA_ENABLED", testUserId);
    expect(enabled).toBeDefined();
    expect(enabled?.entityType).toBe("users");
    expect(enabled?.newValue).toContain("totp");

    await logAuthEvent(testUserId, "MFA_DISABLED", { method: "totp" });
    const disabled = await findRecentAudit(testUserId, "MFA_DISABLED", testUserId);
    expect(disabled).toBeDefined();
    expect(disabled?.entityType).toBe("users");
  });

  it("POST /api/auth/change-password writes a PASSWORD_CHANGE audit row", async () => {
    // Re-login first because the prior test logged us out.
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testEmail, password: testPassword });
    expect(loginRes.status).toBe(200);
    const cookie = extractCookie(loginRes)!;

    const newPassword = "IntegPass123!New";
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: testPassword, newPassword });
    expect(res.status).toBe(200);

    const row = await findRecentAudit(testUserId, "PASSWORD_CHANGE", testUserId);
    expect(row).toBeDefined();
    expect(row?.entityType).toBe("users");
  });

  it("POST /api/dev/test-login returns user for valid role", async () => {
    const res = await request(app)
      .post("/api/dev/test-login")
      .send({ role: "ADMIN" });

    expect(res.status).toBe(200);
    const body = res.body as AuthResponse;
    expect(body.user).toBeDefined();
    expect(body.user.role).toBe("ADMIN");
  });

  it("POST /api/dev/test-login rejects invalid role", async () => {
    const res = await request(app)
      .post("/api/dev/test-login")
      .send({ role: "NONEXISTENT" });

    expect(res.status).toBe(400);
  });
});
