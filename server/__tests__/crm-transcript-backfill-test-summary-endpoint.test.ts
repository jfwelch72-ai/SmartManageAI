/**
 * Task #1056 — automated coverage for the "Send test summary" admin endpoint
 * (`POST /api/notifications/test-backfill-summary`) added in Task #1046.
 *
 * Two layers of coverage:
 *   1. Unit tests for the pure `buildBackfillSummaryContent` builder, which
 *      both the test endpoint and the real run-completion dispatcher share.
 *      Pins the `[Test]` prefix / sample-summary banner wording so future
 *      refactors can't silently change the preview copy that admins see.
 *   2. Integration tests that exercise the endpoint through Express +
 *      supertest. Verifies the role gate, the `channel="none"` guard, the
 *      missing-webhook 400 responses, and the success paths for email,
 *      Slack, and Teams (delivery target + `[Test]` prefix on every
 *      channel). Slack / Teams are exercised by mocking `global.fetch` so
 *      the suite never opens an outbound socket.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  notificationChannelPrefs,
} from "@shared/schema";
import {
  clearTestEmailOutbox,
  getTestEmailOutbox,
} from "../services/emailTransport";
import { generateToken } from "../auth";
import { buildBackfillSummaryContent } from "../crmCallsRoutes";

const TEST_PREFIX = "__test_summary_endpoint__";
const VALID_SLACK_URL = "https://hooks.slack.com/services/T000/B000/abcdef";
const VALID_TEAMS_URL = "https://example.webhook.office.com/webhookb2/abc";

const ENDPOINT = "/api/notifications/test-backfill-summary";

let app: Express;
let server: Server;
let priorEmailTransport: string | undefined;
let realFetch: typeof globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

async function cleanupTestData() {
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (
      SELECT ${users.id} FROM ${users}
      WHERE ${users.email} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
  await db.delete(organizations).where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
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
    channel?: "email" | "slack" | "teams" | "none";
    email?: string | null;
  } = {},
) {
  const email =
    opts.email === null
      ? null
      : (opts.email ??
        `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.invalid`);
  const [u] = await db
    .insert(users)
    .values({
      email: email as string, // schema allows nullable for the no-email branch
      passwordHash: "x",
      firstName: "Test",
      lastName: suffix,
      organizationId: orgId,
      role: opts.role ?? "ADMIN",
      crmBackfillSummaryChannel: opts.channel ?? "email",
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

  realFetch = globalThis.fetch;
}, 60_000);

afterAll(async () => {
  await cleanupTestData();
  globalThis.fetch = realFetch;
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
  fetchMock = vi.fn(async () =>
    new Response("ok", { status: 200 }),
  );
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

describe("buildBackfillSummaryContent (Task #1056)", () => {
  const baseInput = {
    jobId: "job-abc-123",
    status: "COMPLETED" as const,
    total: 42,
    processed: 42,
    succeeded: 39,
    failed: 3,
    startedAt: new Date("2026-01-15T12:00:00.000Z"),
    completedAt: new Date("2026-01-15T12:04:12.000Z"),
    parentJobId: null,
    orgName: "Acme Construction",
    operatorName: "Alex Admin",
  };

  it("produces the production-style summary when testPrefix is false", () => {
    const out = buildBackfillSummaryContent({ ...baseInput, testPrefix: false });

    // Subject is the canonical "<run label> <status> — <succeeded>/<total> succeeded"
    // with no [Test] prefix and no sample banner anywhere.
    expect(out.subject).toBe("Transcript backfill completed — 39/42 succeeded");
    expect(out.subject.startsWith("[Test]")).toBe(false);
    expect(out.text.startsWith("Transcript backfill completed")).toBe(true);
    expect(out.text).toContain("Status:    COMPLETED");
    expect(out.text).toContain("Processed: 42 of 42");
    expect(out.text).toContain("Succeeded: 39");
    expect(out.text).toContain("Failed:    3");
    expect(out.text).toContain("Operator:  Alex Admin");
    expect(out.text).toContain("Job ID:    job-abc-123");
    expect(out.text).not.toContain("sample summary");
    expect(out.text).not.toContain("No real backfill ran");

    expect(out.html).toContain("Transcript backfill");
    expect(out.html).toContain("Acme Construction");
    expect(out.html).not.toContain("Sample summary");
    expect(out.html).not.toContain("[Test]");

    expect(out.chatTitle).toBe(out.subject);
    expect(out.chatBody).toContain("*Status:* COMPLETED");
    expect(out.chatBody).toContain("*Counts:* 39 succeeded / 3 failed / 42 of 42");
    expect(out.chatBody).not.toContain(":test_tube:");
  });

  it("adds [Test] markers + sample-summary banner on every channel when testPrefix is true", () => {
    const out = buildBackfillSummaryContent({ ...baseInput, testPrefix: true });

    // Subject: the [Test] prefix is what makes the message unmistakably a
    // preview in any inbox / channel listing.
    expect(out.subject.startsWith("[Test] ")).toBe(true);
    expect(out.subject).toBe("[Test] Transcript backfill completed — 39/42 succeeded");

    // Plain text body opens with the sample-summary banner.
    expect(
      out.text.startsWith(
        "This is a sample summary triggered from your Notification Preferences. No real backfill ran.",
      ),
    ).toBe(true);
    // …and still contains the same metrics block as a real run summary so
    // admins can preview the wording end-to-end.
    expect(out.text).toContain("Processed: 42 of 42");
    expect(out.text).toContain("Succeeded: 39");

    // HTML banner: the colored callout block plus the headline that calls
    // out it's a sample.
    expect(out.html).toContain("Sample summary");
    expect(out.html).toContain("No real backfill ran");
    // The escaped "[Test] " prefix shows up in the H2 headline too.
    expect(out.html).toContain("[Test] Transcript backfill completed");

    // Chat body footer (Slack/Teams) carries its own sample-summary line.
    expect(out.chatTitle).toBe(out.subject);
    expect(out.chatBody).toContain(":test_tube:");
    expect(out.chatBody).toContain("Sample summary triggered from Notification Preferences");
  });

  it("uses 'retry' wording when parentJobId is set", () => {
    const out = buildBackfillSummaryContent({
      ...baseInput,
      parentJobId: "parent-job-xyz",
      testPrefix: true,
    });
    expect(out.subject).toContain("Transcript backfill retry completed");
    expect(out.text).toContain("Transcript backfill retry completed");
  });
});

describe("POST /api/notifications/test-backfill-summary (Task #1056)", () => {
  describe("auth + role guards", () => {
    it("rejects unauthenticated callers with 401", async () => {
      const res = await request(app).post(ENDPOINT).send({});
      expect(res.status).toBe(401);
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects non-admin authenticated callers with 403", async () => {
      const org = await makeOrg("nonadmin");
      const fieldWorker = await makeUser(org.id, "fw", {
        role: "FIELD_WORKER",
        channel: "email",
      });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(fieldWorker))
        .send({});

      expect(res.status).toBe(403);
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("channel guard rails", () => {
    it("returns 400 with a clear error when the admin's channel is 'none'", async () => {
      const org = await makeOrg("channel-none");
      const admin = await makeUser(org.id, "admin", { channel: "none" });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.toLowerCase()).toContain("don't notify me");
      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns 400 when channel=slack but no Slack webhook URL is configured", async () => {
      const org = await makeOrg("slack-missing");
      const admin = await makeUser(org.id, "admin", { channel: "slack" });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.toLowerCase()).toContain("slack webhook");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns 400 when channel=slack but the configured webhook URL is invalid", async () => {
      const org = await makeOrg("slack-bad");
      const admin = await makeUser(org.id, "admin", { channel: "slack" });
      await db.insert(notificationChannelPrefs).values({
        userId: admin.id,
        slackWebhookUrl: "https://evil.example.com/hook",
      });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.toLowerCase()).toContain("invalid");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns 400 when channel=teams but no Teams webhook URL is configured", async () => {
      const org = await makeOrg("teams-missing");
      const admin = await makeUser(org.id, "admin", { channel: "teams" });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.toLowerCase()).toContain("teams webhook");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns 400 when channel=teams but the configured webhook URL is invalid", async () => {
      const org = await makeOrg("teams-bad");
      const admin = await makeUser(org.id, "admin", { channel: "teams" });
      await db.insert(notificationChannelPrefs).values({
        userId: admin.id,
        teamsWebhookUrl: "https://malicious.example.com/hook",
      });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.toLowerCase()).toContain("invalid");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("delivery success paths", () => {
    it("emails the admin's own address with a [Test]-prefixed sample summary", async () => {
      const org = await makeOrg("email-ok");
      const admin = await makeUser(org.id, "admin", { channel: "email" });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, channel: "email", target: admin.email });

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      const sent = outbox[0];
      // The sample is delivered ONLY to the admin who triggered the test —
      // never fanned out to other admins or the org's recipient list.
      expect(sent.to).toEqual([admin.email]);
      expect(sent.subject?.startsWith("[Test] ")).toBe(true);
      expect(sent.subject).toContain("39/42 succeeded");
      expect(sent.text).toContain("sample summary");
      expect(sent.text).toContain("No real backfill ran");
      expect(sent.html).toContain("Sample summary");

      // The fetch-based Slack/Teams paths must NOT fire on the email branch.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts the sample to the admin's stored Slack webhook with the [Test] prefix", async () => {
      const org = await makeOrg("slack-ok");
      const admin = await makeUser(org.id, "admin", { channel: "slack" });
      await db.insert(notificationChannelPrefs).values({
        userId: admin.id,
        slackWebhookUrl: VALID_SLACK_URL,
      });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, channel: "slack" });

      // Email transport must stay quiet on the slack branch.
      expect(getTestEmailOutbox()).toHaveLength(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(VALID_SLACK_URL);
      expect(init.method).toBe("POST");
      expect(String(init.body)).toContain("[Test] Transcript backfill completed");
      // History action button is part of the Slack block kit payload.
      expect(String(init.body)).toContain("View backfill history");
    });

    it("posts the sample to the admin's stored Teams webhook with the [Test] prefix", async () => {
      const org = await makeOrg("teams-ok");
      const admin = await makeUser(org.id, "admin", { channel: "teams" });
      await db.insert(notificationChannelPrefs).values({
        userId: admin.id,
        teamsWebhookUrl: VALID_TEAMS_URL,
      });

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, channel: "teams" });

      expect(getTestEmailOutbox()).toHaveLength(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(VALID_TEAMS_URL);
      expect(init.method).toBe("POST");
      const body = String(init.body);
      expect(body).toContain("AdaptiveCard");
      expect(body).toContain("[Test] Transcript backfill completed");
      expect(body).toContain("View backfill history");
    });

    it("returns 502 when the Slack webhook responds with a non-2xx status", async () => {
      const org = await makeOrg("slack-502");
      const admin = await makeUser(org.id, "admin", { channel: "slack" });
      await db.insert(notificationChannelPrefs).values({
        userId: admin.id,
        slackWebhookUrl: VALID_SLACK_URL,
      });
      fetchMock.mockResolvedValueOnce(
        new Response("invalid_payload", { status: 400 }),
      );

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/Slack webhook returned 400/);
    });

    it("returns 502 when the Teams webhook responds with a non-2xx status", async () => {
      const org = await makeOrg("teams-502");
      const admin = await makeUser(org.id, "admin", { channel: "teams" });
      await db.insert(notificationChannelPrefs).values({
        userId: admin.id,
        teamsWebhookUrl: VALID_TEAMS_URL,
      });
      fetchMock.mockResolvedValueOnce(
        new Response("rejected", { status: 500 }),
      );

      const res = await request(app)
        .post(ENDPOINT)
        .set("Cookie", authCookie(admin))
        .send({});

      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/Teams webhook returned 500/);
    });
  });
});
