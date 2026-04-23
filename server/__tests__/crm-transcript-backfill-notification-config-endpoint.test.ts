/**
 * Task #1084 — pin the contract that
 * `GET /api/crm/calls/transcripts/backfill/notification-config` includes
 * the resolved heartbeat staleness window (`heartbeatStaleMs`) added by
 * Task #1078. The admin page reads this value to render the cross-org
 * Cancel hint, so a regression that drops the field would silently make
 * the UI lie about how long it takes a stuck backfill to be reaped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { generateToken } from "../auth";
import { BACKFILL_HEARTBEAT_STALE_MS } from "../crmCallsRoutes";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `notif-config-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__notif_config_${SUFFIX}__`;

let app: Express;
let server: Server;

let orgId: string;
let adminUserId: string;
let fieldWorkerUserId: string;
let adminCookie: string;
let fieldWorkerCookie: string;

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `${TEST_ORG_PREFIX}primary`,
      slug: `${TEST_ORG_PREFIX}primary`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  orgId = org.id;

  const [admin] = await db
    .insert(users)
    .values({
      email: `admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Notif",
      lastName: "Admin",
      organizationId: orgId,
      role: "ADMIN",
    })
    .returning();
  adminUserId = admin.id;
  adminCookie = `auth_token=${generateToken(admin.id, admin.tokenVersion)}`;

  const [fw] = await db
    .insert(users)
    .values({
      email: `field-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Notif",
      lastName: "Field",
      organizationId: orgId,
      role: "FIELD_WORKER",
    })
    .returning();
  fieldWorkerUserId = fw.id;
  fieldWorkerCookie = `auth_token=${generateToken(fw.id, fw.tokenVersion)}`;
}, 60_000);

afterAll(async () => {
  try {
    await db
      .delete(users)
      .where(inArray(users.id, [adminUserId, fieldWorkerUserId]))
      .catch(() => {});
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [orgId]))
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("GET /api/crm/calls/transcripts/backfill/notification-config (Task #1078 / #1084)", () => {
  it("includes heartbeatStaleMs matching the resolver's exported value", async () => {
    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/notification-config")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("heartbeatStaleMs");
    expect(typeof res.body.heartbeatStaleMs).toBe("number");
    expect(res.body.heartbeatStaleMs).toBe(BACKFILL_HEARTBEAT_STALE_MS);
    // Must always sit inside the documented [30s, 60min] band.
    expect(res.body.heartbeatStaleMs).toBeGreaterThanOrEqual(30 * 1000);
    expect(res.body.heartbeatStaleMs).toBeLessThanOrEqual(60 * 60 * 1000);

    // Sanity-check the rest of the contract so a regression that drops the
    // sibling fields (which the page also reads) fails here too.
    expect(res.body).toHaveProperty("slack");
    expect(res.body).toHaveProperty("email");
    expect(res.body).toHaveProperty("usingEnvFallback");

    // Task #1130 — the response must also carry the operator's originally
    // requested staleness window (or null if env was unset/invalid) so the
    // admin UI can render a "(clamped from X)" hint when the two diverge.
    expect(res.body).toHaveProperty("heartbeatStaleRequestedMs");
    expect(
      res.body.heartbeatStaleRequestedMs === null ||
        typeof res.body.heartbeatStaleRequestedMs === "number",
    ).toBe(true);
  });

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).get(
      "/api/crm/calls/transcripts/backfill/notification-config",
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-ADMIN callers with 403", async () => {
    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/notification-config")
      .set("Cookie", fieldWorkerCookie);
    expect(res.status).toBe(403);
  });
});
