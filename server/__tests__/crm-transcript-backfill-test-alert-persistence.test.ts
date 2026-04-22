/**
 * Task #1064 — integration coverage for the persisted last-test-alert
 * health indicator added in Task #1045. The dispatcher itself
 * (Slack/email transport wiring) is exercised by
 * `transcript-backfill-notifications.test.ts`; here we pin the
 * persistence side-effects on the per-org settings row so a regression
 * in either:
 *
 *   - POST /api/crm/calls/transcripts/backfill/test-alert
 *     (must persist `last_test_at` + `last_test_result`)
 *   - DELETE /api/crm/calls/transcripts/backfill/notification-settings
 *     /last-test
 *     (must clear the last-test fields without touching destinations)
 *
 * is caught before the inline health chip on the settings card silently
 * stops working.
 *
 * The test stubs the dispatcher itself so we don't hit Slack or
 * SendGrid from the test runner — the route's persistence + audit
 * behaviour is the contract under test, not the transports.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

const { mockSendTestBackfillAlert } = vi.hoisted(() => ({
  mockSendTestBackfillAlert: vi.fn(),
}));

// Stub the transcript-backfill notifications service so the route
// records a deterministic per-channel result and never opens a socket.
// `notifyBackfillCompletion` and `getBackfillNotificationConfig` are
// also imported by the route module, so we re-export the real impls
// to keep unrelated routes working.
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

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `test-alert-persist-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__test_alert_persist_${SUFFIX}__`;

let app: Express;
let server: Server;

let orgId: string;
let adminUserId: string;
let adminCookie: string;

const TEST_ALERT_PATH = "/api/crm/calls/transcripts/backfill/test-alert";
const DISMISS_LAST_TEST_PATH =
  "/api/crm/calls/transcripts/backfill/notification-settings/last-test";

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
      firstName: "Test",
      lastName: "Admin",
      organizationId: orgId,
      role: "ADMIN",
    })
    .returning();
  adminUserId = admin.id;
  adminCookie = `auth_token=${generateToken(admin.id, admin.tokenVersion)}`;
}, 60_000);

afterAll(async () => {
  try {
    await db
      .delete(crmTranscriptBackfillTestAlerts)
      .where(eq(crmTranscriptBackfillTestAlerts.organizationId, orgId))
      .catch(() => {});
    await db
      .delete(crmTranscriptBackfillNotificationSettings)
      .where(eq(crmTranscriptBackfillNotificationSettings.organizationId, orgId))
      .catch(() => {});
    await db
      .delete(users)
      .where(inArray(users.id, [adminUserId]))
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

async function readSettingsRow() {
  const [row] = await db
    .select()
    .from(crmTranscriptBackfillNotificationSettings)
    .where(eq(crmTranscriptBackfillNotificationSettings.organizationId, orgId))
    .limit(1);
  return row ?? null;
}

async function clearSettingsRow() {
  await db
    .delete(crmTranscriptBackfillNotificationSettings)
    .where(eq(crmTranscriptBackfillNotificationSettings.organizationId, orgId));
}

async function clearAuditRows() {
  await db
    .delete(crmTranscriptBackfillTestAlerts)
    .where(eq(crmTranscriptBackfillTestAlerts.organizationId, orgId));
}

describe("POST /api/crm/calls/transcripts/backfill/test-alert — persistence", () => {
  it("persists last_test_at and last_test_result on the per-org settings row", async () => {
    await clearSettingsRow();
    await clearAuditRows();
    mockSendTestBackfillAlert.mockReset();
    mockSendTestBackfillAlert.mockResolvedValueOnce(HEALTHY_RESULT);

    const before = Date.now();
    const res = await request(app)
      .post(TEST_ALERT_PATH)
      .set("Cookie", adminCookie)
      .send({});
    const after = Date.now();

    expect(res.status).toBe(200);
    // The route returns the dispatch result + the testedAt it used so the
    // UI can render the panel without a follow-up settings refetch.
    expect(res.body.slack).toEqual(HEALTHY_RESULT.slack);
    expect(res.body.email).toEqual(HEALTHY_RESULT.email);
    expect(res.body.operatorDisplay).toBe(HEALTHY_RESULT.operatorDisplay);
    expect(typeof res.body.testedAt).toBe("string");

    const row = await readSettingsRow();
    expect(row).not.toBeNull();
    expect(row!.lastTestAt).toBeInstanceOf(Date);
    const lastTestMs = row!.lastTestAt!.getTime();
    // Allow a small clock fudge — the route stamps a fresh `new Date()`
    // immediately before calling the storage helper.
    expect(lastTestMs).toBeGreaterThanOrEqual(before - 1_000);
    expect(lastTestMs).toBeLessThanOrEqual(after + 1_000);

    // The full per-channel result is round-tripped into the JSONB column
    // so the settings card can render the chips on first load without
    // re-firing the test.
    expect(row!.lastTestResult).toEqual(HEALTHY_RESULT);

    expect(mockSendTestBackfillAlert).toHaveBeenCalledTimes(1);
    expect(mockSendTestBackfillAlert.mock.calls[0][0]).toBe(orgId);
  });

  it("rejects unauthenticated callers and never persists for them", async () => {
    await clearSettingsRow();
    await clearAuditRows();
    mockSendTestBackfillAlert.mockReset();

    const res = await request(app).post(TEST_ALERT_PATH).send({});
    expect(res.status).toBe(401);

    expect(mockSendTestBackfillAlert).not.toHaveBeenCalled();
    expect(await readSettingsRow()).toBeNull();
  });
});

describe("DELETE /api/crm/calls/transcripts/backfill/notification-settings/last-test", () => {
  it("clears last-test fields without touching slack/email destinations", async () => {
    await clearSettingsRow();
    await clearAuditRows();

    // Seed the row directly so we can assert that destinations survive
    // the clear operation. We also seed a non-null lastTestAt /
    // lastTestResult so we can prove the DELETE actually nulls them.
    const seededRecipients = ["alerts@example.com", "ops@example.com"];
    const seededWebhook = "https://hooks.slack.com/services/SEEDED";
    await db
      .insert(crmTranscriptBackfillNotificationSettings)
      .values({
        organizationId: orgId,
        slackWebhookUrl: seededWebhook,
        emailRecipients: seededRecipients,
        updatedById: adminUserId,
        updatedAt: new Date(),
        lastTestAt: new Date("2026-04-22T10:00:00.000Z"),
        lastTestResult: HEALTHY_RESULT,
      });

    const seeded = await readSettingsRow();
    expect(seeded).not.toBeNull();
    expect(seeded!.lastTestAt).toBeInstanceOf(Date);
    expect(seeded!.lastTestResult).toEqual(HEALTHY_RESULT);

    const res = await request(app)
      .delete(DISMISS_LAST_TEST_PATH)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const after = await readSettingsRow();
    expect(after).not.toBeNull();
    // Last-test fields must be cleared.
    expect(after!.lastTestAt).toBeNull();
    expect(after!.lastTestResult).toBeNull();
    // Destinations must NOT be touched — that's the contract that lets
    // admins dismiss the chip without re-saving their settings.
    expect(after!.slackWebhookUrl).toBe(seededWebhook);
    expect(after!.emailRecipients).toEqual(seededRecipients);
  });

  it("is a safe no-op when there is no settings row yet", async () => {
    await clearSettingsRow();
    await clearAuditRows();

    const res = await request(app)
      .delete(DISMISS_LAST_TEST_PATH)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // No row should be created by the dismiss call.
    expect(await readSettingsRow()).toBeNull();
  });

  it("rejects unauthenticated callers", async () => {
    const res = await request(app).delete(DISMISS_LAST_TEST_PATH);
    expect(res.status).toBe(401);
  });
});
