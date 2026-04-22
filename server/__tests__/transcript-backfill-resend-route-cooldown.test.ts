/**
 * Task #1099 — pin the HTTP contract of the "Resend failed alert delivery"
 * cooldown added in Task #1068. The admin UI relies on:
 *   - HTTP 429 on the second click inside the window
 *   - the `Retry-After` header (in seconds) for standards-compliant clients
 *   - a JSON body of shape `{ reason: "COOLDOWN", retryAfterSeconds, error }`
 *     so the React card can render "Just resent — try again in N seconds"
 *     without parsing headers
 *
 * Service-level cooldown semantics are pinned by the sibling
 * `transcript-backfill-resend-cooldown.test.ts` suite. This file only
 * pins the route → response wiring, so we intercept
 * `resendBackfillAlertDelivery` and assert the response shape produced by
 * `server/crmCallsRoutes.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

const { mockResend } = vi.hoisted(() => ({ mockResend: vi.fn() }));

vi.mock("../services/transcriptBackfillNotifications", async () => {
  const actual = await vi.importActual<
    typeof import("../services/transcriptBackfillNotifications")
  >("../services/transcriptBackfillNotifications");
  return {
    ...actual,
    resendBackfillAlertDelivery: mockResend,
  };
});

import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `resend-route-cooldown-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__resend_route_cooldown_${SUFFIX}__`;
const RESEND_PATH = (id: string) =>
  `/api/crm/calls/transcripts/backfill/alert-deliveries/${id}/resend`;

let app: Express;
let server: Server;
let orgId: string;
let adminId: string;
let adminCookie: string;

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
      name: `${TEST_ORG_PREFIX}org`,
      slug: `${TEST_ORG_PREFIX}org`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  orgId = org.id;

  const [admin] = await db
    .insert(users)
    .values({
      email: `admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Resend",
      lastName: "Admin",
      organizationId: orgId,
      role: "ADMIN",
    })
    .returning();
  adminId = admin.id;
  adminCookie = `auth_token=${generateToken(admin.id, admin.tokenVersion)}`;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(users).where(inArray(users.id, [adminId])).catch(() => {});
    await db
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

beforeEach(() => {
  mockResend.mockReset();
});

const FAKE_DELIVERY_ID = "delivery-under-test";

describe("POST /api/crm/calls/transcripts/backfill/alert-deliveries/:id/resend — 429", () => {
  it("returns 200 then 429 with Retry-After + COOLDOWN body on a rapid double-click", async () => {
    // First call succeeds (the helper would actually dispatch); second
    // call returns the COOLDOWN tuple the route must translate into a
    // 429 + Retry-After response.
    mockResend
      .mockResolvedValueOnce({
        ok: true,
        delivery: {
          id: "new-delivery",
          organizationId: orgId,
          jobId: "job-1",
          channel: "email",
          status: "success",
          recipientSummary: "ops@example.com",
          errorMessage: null,
          attemptedAt: new Date(),
          source: "resend",
          triggeredById: adminId,
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: "COOLDOWN",
        retryAfterSeconds: 25,
      });

    const first = await request(app)
      .post(RESEND_PATH(FAKE_DELIVERY_ID))
      .set("Cookie", adminCookie)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.delivery?.id).toBe("new-delivery");

    const second = await request(app)
      .post(RESEND_PATH(FAKE_DELIVERY_ID))
      .set("Cookie", adminCookie)
      .send({});

    expect(second.status).toBe(429);

    // Standards-compliant Retry-After header (seconds, integer >= 1).
    const retryAfter = second.headers["retry-after"];
    expect(retryAfter).toBeDefined();
    const retryAfterNum = Number(retryAfter);
    expect(Number.isInteger(retryAfterNum)).toBe(true);
    expect(retryAfterNum).toBe(25);

    // JSON body contract used by the admin UI.
    expect(second.body.reason).toBe("COOLDOWN");
    expect(second.body.retryAfterSeconds).toBe(25);
    expect(second.body.retryAfterSeconds).toBe(retryAfterNum);
    expect(typeof second.body.error).toBe("string");
    // Friendly user-facing copy includes the countdown so the admin UI
    // can render it directly without re-templating.
    expect(second.body.error).toContain("25");
    expect(second.body.error.length).toBeGreaterThan(0);

    // The route handler must propagate the acting admin's user id to
    // the helper so resend rows get tagged with `triggeredById`.
    expect(mockResend).toHaveBeenCalledTimes(2);
    for (const call of mockResend.mock.calls) {
      expect(call[0]).toBe(orgId);
      expect(call[1]).toBe(FAKE_DELIVERY_ID);
      expect(call[2]).toBe(adminId);
    }
  });

  it("does not 429 when the helper returns a non-cooldown failure", async () => {
    // Sanity-check that the route only maps reason='COOLDOWN' to 429 —
    // other failure reasons must keep their existing 404/409 mapping so
    // a future refactor that widens the cooldown branch can't quietly
    // start short-circuiting unrelated errors as rate-limit responses.
    mockResend.mockResolvedValueOnce({ ok: false, reason: "NOT_FOUND" });

    const res = await request(app)
      .post(RESEND_PATH("missing-id"))
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(404);
    expect(res.headers["retry-after"]).toBeUndefined();
    expect(res.body.reason).toBe("NOT_FOUND");
  });
});
