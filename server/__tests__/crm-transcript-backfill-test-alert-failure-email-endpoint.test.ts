/**
 * Task #1140 — automated coverage for the "Send test" alert-delivery-failure
 * email button (`POST /api/notifications/test-alert-failure-email`) added in
 * Task #1086.
 *
 * Mirrors the structure of
 * `crm-transcript-backfill-test-summary-endpoint.test.ts` so the two preview
 * endpoints stay covered the same way:
 *   - role gate (non-admin rejected)
 *   - missing-email-on-file rejection
 *   - SMTP-failure handling (route returns 502 on transport failure / throw)
 *   - realtime + digest delivery success paths, asserting the `[Test]` subject
 *     prefix and that the sample is delivered ONLY to the requesting admin
 *     (never the rest of the org).
 *
 * The default `EMAIL_TRANSPORT=noop` path is used for the success cases so we
 * can inspect the captured outbox. For the failure path we wrap `sendEmail`
 * via `vi.mock` and override its return value for that single test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { organizations, users } from "@shared/schema";
import {
  clearTestEmailOutbox,
  getTestEmailOutbox,
} from "../services/emailTransport";
import { generateToken } from "../auth";

// Wrap the real emailService so success paths exercise the noop transport
// (and capture into the in-memory outbox), but individual tests can still
// override `sendEmail`'s behavior to simulate SMTP failures / throws.
vi.mock("../services/emailService", async () => {
  const actual = await vi.importActual<typeof import("../services/emailService")>(
    "../services/emailService",
  );
  const mockSend = vi.fn(actual.sendEmail);
  return {
    ...actual,
    sendEmail: mockSend,
    __mockSendEmail: mockSend,
  };
});

const TEST_PREFIX = "__test_alert_failure_email__";
const ENDPOINT = "/api/notifications/test-alert-failure-email";

let app: Express;
let server: Server;
let priorEmailTransport: string | undefined;
let sendEmailMock: ReturnType<typeof vi.fn>;

async function cleanupTestData() {
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
  await db
    .delete(users)
    .where(sql`${users.firstName} = 'Test' AND ${users.lastName} LIKE ${`${TEST_PREFIX}%`}`);
  await db
    .delete(organizations)
    .where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
}

async function makeOrg(label: string) {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}${label}`, slug })
    .returning();
  return org;
}

async function makeUser(
  orgId: string,
  suffix: string,
  opts: {
    role?: "ADMIN" | "MANAGER" | "FIELD_WORKER";
    email?: string;
    firstName?: string;
    lastName?: string;
  } = {},
) {
  const email =
    opts.email ??
    `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.invalid`;
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: "x",
      firstName: opts.firstName ?? "Test",
      lastName: opts.lastName ?? `${TEST_PREFIX}${suffix}`,
      organizationId: orgId,
      role: opts.role ?? "ADMIN",
    })
    .returning();
  return u;
}

function authCookie(user: { id: string; tokenVersion: number | null }): string {
  return `auth_token=${generateToken(user.id, user.tokenVersion)}`;
}

beforeAll(async () => {
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";

  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");
  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  // Capture the wrapped sendEmail mock created above.
  const emailService = (await import("../services/emailService")) as unknown as {
    __mockSendEmail: ReturnType<typeof vi.fn>;
  };
  sendEmailMock = emailService.__mockSendEmail;
}, 60_000);

afterAll(async () => {
  await cleanupTestData();
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

beforeEach(async () => {
  await cleanupTestData();
  clearTestEmailOutbox();
  // Reset to default behavior: delegate to the real sendEmail (which honors
  // EMAIL_TRANSPORT=noop and writes into the outbox).
  sendEmailMock.mockReset();
  const actual = await vi.importActual<typeof import("../services/emailService")>(
    "../services/emailService",
  );
  sendEmailMock.mockImplementation(actual.sendEmail);
});

describe("POST /api/notifications/test-alert-failure-email (Task #1140)", () => {
  describe("auth + role guards", () => {
    it("rejects unauthenticated callers with 401", async () => {
      const res = await request(app).post(ENDPOINT).send({});
      expect(res.status).toBe(401);
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("rejects non-admin authenticated callers with 403", async () => {
      const org = await makeOrg("nonadmin");
      const fieldWorker = await makeUser(org.id, "fw", { role: "FIELD_WORKER" });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(fieldWorker))
        .send({});

      expect(res.status).toBe(403);
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("rejects MANAGER (admin-only endpoint) with 403", async () => {
      const org = await makeOrg("mgr");
      const manager = await makeUser(org.id, "mgr", { role: "MANAGER" });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(manager))
        .send({});

      expect(res.status).toBe(403);
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });
  });

  describe("input validation", () => {
    it("returns 400 when stream is not 'realtime' or 'digest'", async () => {
      const org = await makeOrg("badstream");
      const admin = await makeUser(org.id, "admin");

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({ stream: "weekly" });

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.toLowerCase()).toContain("stream");
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("returns 400 when the admin has no email address on file", async () => {
      const org = await makeOrg("noemail");
      // Schema requires non-null email, so use whitespace-only — the route
      // trims and treats it as missing, which is the failure mode the button
      // surfaces in production for legacy SSO accounts.
      const admin = await makeUser(org.id, "noemail", {
        email: `${TEST_PREFIX}placeholder-${Date.now()}@test.invalid`,
      });
      await db
        .update(users)
        .set({ email: "   " })
        .where(sql`${users.id} = ${admin.id}`);

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({ stream: "realtime" });

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.toLowerCase()).toContain("email");
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });
  });

  describe("delivery success paths", () => {
    it("realtime: delivers a [Test]-prefixed sample to the requesting admin only", async () => {
      const org = await makeOrg("realtime-ok");
      const admin = await makeUser(org.id, "admin");
      // Other admin that must NEVER receive the preview — the button is a
      // self-test, not a fan-out to the org's admin list.
      const otherAdmin = await makeUser(org.id, "other");

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({ stream: "realtime" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, stream: "realtime", target: admin.email });

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      const sent = outbox[0];

      expect(sent.to).toEqual([admin.email]);
      expect(sent.to).not.toContain(otherAdmin.email);
      expect(sent.subject?.startsWith("[Test] ")).toBe(true);
      // Underlying real-time fallback subject mentions the channel (Slack).
      expect(sent.subject).toContain("Transcript backfill alert delivery failed");
      // Sample-banner copy makes it clear this is a preview, not a real alert.
      expect(sent.text).toContain("sample alert-delivery-failure email");
      expect(sent.text).toContain("preview the format");
      expect(sent.html).toContain("sample alert-delivery-failure email");
    });

    it("realtime: defaults to realtime when no stream field is provided", async () => {
      const org = await makeOrg("default-stream");
      const admin = await makeUser(org.id, "admin");

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.stream).toBe("realtime");

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].subject?.startsWith("[Test] ")).toBe(true);
    });

    it("digest: delivers a [Test]-prefixed digest sample to the requesting admin only", async () => {
      const org = await makeOrg("digest-ok");
      const admin = await makeUser(org.id, "admin");
      const otherAdmin = await makeUser(org.id, "other");

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({ stream: "digest" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, stream: "digest", target: admin.email });

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      const sent = outbox[0];

      expect(sent.to).toEqual([admin.email]);
      expect(sent.to).not.toContain(otherAdmin.email);
      expect(sent.subject?.startsWith("[Test] ")).toBe(true);
      // Digest subject identifies itself as a daily digest with a failure count.
      expect(sent.subject).toContain("Daily transcript backfill alert digest");
      expect(sent.subject).toMatch(/alert deliver(y|ies) failed/);
      // Banner makes clear it's a sample, not a real digest.
      expect(sent.text).toContain("sample alert-delivery-failure digest");
      expect(sent.text).toContain("preview the format");
      // Sample digest body should include the failures-by-channel breakdown.
      expect(sent.text).toContain("Failures by channel");
      expect(sent.html).toContain("sample alert-delivery-failure digest");
    });
  });

  describe("SMTP failure handling", () => {
    it("returns 502 when sendEmail returns false (transport reported failure)", async () => {
      const org = await makeOrg("smtp-false");
      const admin = await makeUser(org.id, "admin");

      sendEmailMock.mockResolvedValueOnce(false);

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({ stream: "realtime" });

      expect(res.status).toBe(502);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.toLowerCase()).toContain("transport");
      // sendEmail was attempted exactly once (not retried by the route).
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const [opts] = sendEmailMock.mock.calls[0];
      expect(opts.to).toEqual([admin.email]);
      expect(String(opts.subject).startsWith("[Test] ")).toBe(true);
    });

    it("returns 502 when sendEmail throws (e.g. SMTP transport raised)", async () => {
      const org = await makeOrg("smtp-throw");
      const admin = await makeUser(org.id, "admin");

      sendEmailMock.mockRejectedValueOnce(new Error("SMTP 550 mailbox unavailable"));

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({ stream: "digest" });

      expect(res.status).toBe(502);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error).toContain("SMTP 550 mailbox unavailable");
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const [opts] = sendEmailMock.mock.calls[0];
      // Even on the failure path the email was addressed only to the admin —
      // a regression that broadcast to the org would still show up here.
      expect(opts.to).toEqual([admin.email]);
    });
  });
});
