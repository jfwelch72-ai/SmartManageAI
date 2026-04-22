/**
 * Task #1073 — pin the per-org test-alert cooldown contract added in
 * Task #1053. The cooldown is the only thing standing between an admin
 * (or a misclick on the "Send test alert" button) and an avalanche of
 * Slack messages + emails to the configured recipients, so the 429
 * response shape is part of our public contract: the admin UI uses
 * `cooldownSeconds`, `retryAfterSeconds`, and `nextAllowedAt` to disable
 * the button + render a tooltip, and standards-compliant clients use the
 * `Retry-After` header to back off.
 *
 * The dispatcher itself is stubbed so this suite never opens a Slack or
 * SendGrid socket — we are pinning the rate-limit branch in
 * `server/crmCallsRoutes.ts`, not the transports.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";

const { mockSendTestBackfillAlert } = vi.hoisted(() => ({
  mockSendTestBackfillAlert: vi.fn(),
}));

vi.mock("../services/transcriptBackfillNotifications", async () => {
  const actual = await vi.importActual<
    typeof import("../services/transcriptBackfillNotifications")
  >("../services/transcriptBackfillNotifications");
  return {
    ...actual,
    sendTestBackfillAlert: mockSendTestBackfillAlert,
  };
});

import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillNotificationSettings,
  crmTranscriptBackfillTestAlerts,
} from "@shared/schema";
import { generateToken } from "../auth";

const TEST_ALERT_COOLDOWN_SECONDS = 30;

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `test-alert-cooldown-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__test_alert_cooldown_${SUFFIX}__`;

let app: Express;
let server: Server;

let orgAId: string;
let orgBId: string;
let adminAId: string;
let adminBId: string;
let adminACookie: string;
let adminBCookie: string;

const TEST_ALERT_PATH = "/api/crm/calls/transcripts/backfill/test-alert";

const HEALTHY_RESULT = {
  slack: { configured: true, ok: true },
  email: {
    configured: true,
    ok: true,
    recipients: ["alerts@example.com"],
  },
  operatorDisplay: "Test Admin",
} as const;

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const [orgA] = await db
    .insert(organizations)
    .values({
      name: `${TEST_ORG_PREFIX}a`,
      slug: `${TEST_ORG_PREFIX}a`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  orgAId = orgA.id;

  const [orgB] = await db
    .insert(organizations)
    .values({
      name: `${TEST_ORG_PREFIX}b`,
      slug: `${TEST_ORG_PREFIX}b`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  orgBId = orgB.id;

  const [adminA] = await db
    .insert(users)
    .values({
      email: `admin-a-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Admin",
      lastName: "A",
      organizationId: orgAId,
      role: "ADMIN",
    })
    .returning();
  adminAId = adminA.id;
  adminACookie = `auth_token=${generateToken(adminA.id, adminA.tokenVersion)}`;

  const [adminB] = await db
    .insert(users)
    .values({
      email: `admin-b-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Admin",
      lastName: "B",
      organizationId: orgBId,
      role: "ADMIN",
    })
    .returning();
  adminBId = adminB.id;
  adminBCookie = `auth_token=${generateToken(adminB.id, adminB.tokenVersion)}`;
}, 60_000);

afterAll(async () => {
  try {
    await db
      .delete(crmTranscriptBackfillTestAlerts)
      .where(inArray(crmTranscriptBackfillTestAlerts.organizationId, [orgAId, orgBId]))
      .catch(() => {});
    await db
      .delete(crmTranscriptBackfillNotificationSettings)
      .where(
        inArray(crmTranscriptBackfillNotificationSettings.organizationId, [
          orgAId,
          orgBId,
        ]),
      )
      .catch(() => {});
    await db
      .delete(users)
      .where(inArray(users.id, [adminAId, adminBId]))
      .catch(() => {});
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [orgAId, orgBId]))
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function clearOrgState(orgId: string) {
  await db
    .delete(crmTranscriptBackfillTestAlerts)
    .where(eq(crmTranscriptBackfillTestAlerts.organizationId, orgId));
  await db
    .delete(crmTranscriptBackfillNotificationSettings)
    .where(eq(crmTranscriptBackfillNotificationSettings.organizationId, orgId));
}

/**
 * Backdate every audit row for an org so the cooldown window has
 * already elapsed. Cleaner than waiting 30s of wall-clock time, and
 * still exercises the real route — the route reads `sentAt` from the
 * latest audit row, so rewriting it in-place is the right surface
 * to manipulate.
 */
async function backdateAuditRows(orgId: string, secondsAgo: number) {
  await db.execute(sql`
    UPDATE crm_transcript_backfill_test_alerts
    SET sent_at = NOW() - (${secondsAgo}::int * INTERVAL '1 second')
    WHERE organization_id = ${orgId}
  `);
}

describe("POST /api/crm/calls/transcripts/backfill/test-alert — cooldown", () => {
  it("returns 429 with Retry-After + cooldown body when fired twice inside the window", async () => {
    await clearOrgState(orgAId);
    mockSendTestBackfillAlert.mockReset();
    mockSendTestBackfillAlert.mockResolvedValue(HEALTHY_RESULT);

    const firstSentBeforeMs = Date.now();
    const first = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminACookie)
      .send({});
    expect(first.status).toBe(200);
    expect(mockSendTestBackfillAlert).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminACookie)
      .send({});
    const secondReceivedAtMs = Date.now();

    expect(second.status).toBe(429);

    // The dispatcher must NOT be invoked for the rate-limited call —
    // that's the whole point of the cooldown.
    expect(mockSendTestBackfillAlert).toHaveBeenCalledTimes(1);

    // Retry-After header is the standards-compliant signal; it must be
    // a positive integer in seconds, never larger than the cooldown.
    const retryAfterHeader = second.headers["retry-after"];
    expect(retryAfterHeader).toBeDefined();
    const retryAfterFromHeader = Number(retryAfterHeader);
    expect(Number.isInteger(retryAfterFromHeader)).toBe(true);
    expect(retryAfterFromHeader).toBeGreaterThanOrEqual(1);
    expect(retryAfterFromHeader).toBeLessThanOrEqual(TEST_ALERT_COOLDOWN_SECONDS);

    // JSON body contract used by the admin UI.
    expect(second.body.cooldownSeconds).toBe(TEST_ALERT_COOLDOWN_SECONDS);
    expect(typeof second.body.retryAfterSeconds).toBe("number");
    expect(Number.isInteger(second.body.retryAfterSeconds)).toBe(true);
    expect(second.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(second.body.retryAfterSeconds).toBeLessThanOrEqual(
      TEST_ALERT_COOLDOWN_SECONDS,
    );
    // Header and body must agree so clients can pick either signal.
    expect(second.body.retryAfterSeconds).toBe(retryAfterFromHeader);

    expect(typeof second.body.nextAllowedAt).toBe("string");
    const nextAllowedMs = Date.parse(second.body.nextAllowedAt);
    expect(Number.isFinite(nextAllowedMs)).toBe(true);
    // nextAllowedAt = first send + 30s. Allow generous fudge for clock
    // skew between Date.now() in the test and the route.
    const expectedFloor = firstSentBeforeMs + (TEST_ALERT_COOLDOWN_SECONDS * 1000) - 2_000;
    const expectedCeiling =
      secondReceivedAtMs + (TEST_ALERT_COOLDOWN_SECONDS * 1000) + 2_000;
    expect(nextAllowedMs).toBeGreaterThanOrEqual(expectedFloor);
    expect(nextAllowedMs).toBeLessThanOrEqual(expectedCeiling);

    // Surface a human-readable error string for non-UI clients (curl, CI).
    expect(typeof second.body.error).toBe("string");
    expect(second.body.error.length).toBeGreaterThan(0);
  });

  it("scopes the cooldown per organization — a different org can fire immediately", async () => {
    await clearOrgState(orgAId);
    await clearOrgState(orgBId);
    mockSendTestBackfillAlert.mockReset();
    mockSendTestBackfillAlert.mockResolvedValue(HEALTHY_RESULT);

    const a = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminACookie)
      .send({});
    expect(a.status).toBe(200);

    // Org B has never fired a test alert, so the cooldown branch in the
    // route must be a no-op for it — even though org A is mid-cooldown.
    const b = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminBCookie)
      .send({});
    expect(b.status).toBe(200);

    expect(mockSendTestBackfillAlert).toHaveBeenCalledTimes(2);
    const calledOrgIds = mockSendTestBackfillAlert.mock.calls.map(
      (call) => call[0],
    );
    expect(calledOrgIds).toContain(orgAId);
    expect(calledOrgIds).toContain(orgBId);

    // And re-firing on org A inside its window still 429s, proving the
    // org-B success above didn't reset org A's clock.
    const aAgain = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminACookie)
      .send({});
    expect(aAgain.status).toBe(429);
    expect(aAgain.body.cooldownSeconds).toBe(TEST_ALERT_COOLDOWN_SECONDS);
  });

  it("allows a new dispatch once the cooldown window has elapsed", async () => {
    await clearOrgState(orgAId);
    mockSendTestBackfillAlert.mockReset();
    mockSendTestBackfillAlert.mockResolvedValue(HEALTHY_RESULT);

    const first = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminACookie)
      .send({});
    expect(first.status).toBe(200);

    // Confirm we'd be inside the cooldown right now.
    const blocked = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminACookie)
      .send({});
    expect(blocked.status).toBe(429);

    // Backdate the only audit row so the route sees a `sentAt` older
    // than the cooldown window. This is the same surface the route
    // reads, so it's the right place to simulate the clock advancing.
    await backdateAuditRows(orgAId, TEST_ALERT_COOLDOWN_SECONDS + 5);

    const after = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminACookie)
      .send({});
    expect(after.status).toBe(200);
    expect(after.body.slack).toEqual(HEALTHY_RESULT.slack);
    expect(after.body.email).toEqual(HEALTHY_RESULT.email);

    // Two successful dispatches + one rate-limited (which must not call
    // the dispatcher) = 2 total invocations.
    expect(mockSendTestBackfillAlert).toHaveBeenCalledTimes(2);
  });
});
