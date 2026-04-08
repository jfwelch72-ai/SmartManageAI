import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";

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

describe("Auth Endpoint Integration Tests", () => {
  const testEmail = `integ-auth-${suffix}@test.local`;
  const testPassword = "IntegPass123!";
  let authCookie: string;

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
  });

  it("POST /api/auth/login rejects invalid password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: testEmail, password: "WrongPassword1!" });

    expect(res.status).toBe(401);
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
