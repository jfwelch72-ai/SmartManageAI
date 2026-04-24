// Task #1746 — End-to-end coverage for the
// PROJECT_LOG_EMAIL_FAILURES_DIGEST one-click mute footer link.
//
// Mirrors `swppp-overdue-mute-e2e.test.ts` (Task #1473) and
// `davis-bacon-auto-sync-failed-mute-e2e.test.ts` (Task #1474):
//
//   1. Two active org admins are seeded into the same org with email
//      channel prefs enabled — both are eligible recipients of the
//      daily failures digest. A failing project_log_email_schedules row
//      is seeded so the digest sweep has something to fan out about.
//   2. One admin "clicks" the signed mute link by issuing an HTTP GET
//      to `/api/notifications/mute/log-email-failures-digest?token=…`.
//   3. We then trigger the actual nightly sweep
//      (`processProjectLogEmailFailuresDigest`, scheduled hourly in
//      `server/jobs/jobRunner.ts`) at the org's local digest hour.
//   4. Assertions:
//        - The mute endpoint redirects back to the failures dashboard
//          with `?muted=log_email_failures_digest`.
//        - The muted admin is NOT emailed and the
//          PROJECT_LOG_EMAIL_FAILURES_DIGEST notification is filtered
//          out of their `/api/notifications` feed AND
//          `/api/notifications/unread-count` (per-type
//          `inAppEnabled = false` is honoured by
//          `notificationRoutes2.loadInAppMutedTypes`).
//        - The peer admin still receives BOTH the email (via the noop
//          email outbox) and the in-app feed row.
//        - The notifications row IS still inserted for the muted user
//          by design (mute is a read-time filter, not an insert-time
//          block — same contract documented in Task #1473's notes).

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import {
  notificationChannelPrefs,
  notificationTypePrefs,
  notifications,
  organizations,
  projectLogEmailSchedules,
  projects,
  users,
} from "@shared/schema";
import {
  authMiddleware,
  generateToken,
} from "../auth";
import {
  clearTestEmailOutbox,
  getTestEmailOutbox,
} from "../services/emailTransport";

const PREFIX = "__plefd_mute_e2e__";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let app: Express;
let orgId: string;
let priorEmailTransport: string | undefined;
let priorSessionSecret: string | undefined;

async function cleanup() {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  for (const id of ids) {
    await db.delete(notifications).where(eq(notifications.organizationId, id));
    await db
      .delete(notificationTypePrefs)
      .where(
        sql`${notificationTypePrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${id})`,
      );
    await db
      .delete(notificationChannelPrefs)
      .where(
        sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${id})`,
      );
    await db
      .delete(projectLogEmailSchedules)
      .where(eq(projectLogEmailSchedules.organizationId, id));
    await db.delete(projects).where(eq(projects.gcOrganizationId, id));
    await db.delete(users).where(eq(users.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
}

beforeAll(async () => {
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";
  priorSessionSecret = process.env.SESSION_SECRET;
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = "test-secret-for-plefd-mute-e2e";
  }

  await cleanup();
  const [org] = await db
    .insert(organizations)
    .values({
      name: `${PREFIX}org`,
      slug: `${PREFIX}org-${Date.now()}`,
    })
    .returning();
  orgId = org.id;

  const prefsRoutes = (await import("../notificationPreferencesRoutes")).default;
  const feedRoutes = (await import("../notificationRoutes2")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(prefsRoutes);
  app.use(feedRoutes);
});

afterAll(async () => {
  await cleanup();
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
  if (priorSessionSecret === undefined) {
    // Leave the test-only fallback in place — other suites importing
    // the mute-token util in the same vitest worker rely on it being
    // set.
  } else {
    process.env.SESSION_SECRET = priorSessionSecret;
  }
});

beforeEach(async () => {
  await db.delete(notifications).where(eq(notifications.organizationId, orgId));
  await db
    .delete(notificationTypePrefs)
    .where(
      sql`${notificationTypePrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${orgId})`,
    );
  await db
    .delete(notificationChannelPrefs)
    .where(
      sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${orgId})`,
    );
  await db
    .delete(projectLogEmailSchedules)
    .where(eq(projectLogEmailSchedules.organizationId, orgId));
  await db.delete(projects).where(eq(projects.gcOrganizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  clearTestEmailOutbox();
});

async function makeAdmin(label: string) {
  const [u] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "Digest",
      lastName: label,
      email: `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
      role: "ADMIN",
      isActive: true,
      passwordHash: "x",
    })
    .returning();
  // Default channel prefs are all-off; opt the recipient into email so
  // the delivery pipeline will actually try to send via the noop
  // transport when the per-type override doesn't suppress it.
  await db.insert(notificationChannelPrefs).values({
    userId: u.id,
    emailEnabled: true,
  });
  return u;
}

async function makeProject(projectManagerId: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [p] = await db
    .insert(projects)
    .values({
      name: `${PREFIX}proj-${suffix}`,
      code: `${PREFIX}p-${suffix}`,
      clientName: "Acme",
      gcOrganizationId: orgId,
      projectManagerId,
    })
    .returning();
  return p;
}

async function makeFailingSchedule(projectId: string) {
  const [sched] = await db
    .insert(projectLogEmailSchedules)
    .values({
      organizationId: orgId,
      projectId,
      logType: "RFI",
      cadence: "DAILY",
      // Mark the schedule's most recent attempt as a transport FAILURE
      // so the digest sweep picks it up.
      lastAttemptAt: new Date(),
      lastAttemptStatus: "FAILURE",
      lastAttemptError: "Test bounce — invalid recipient",
      lastAttemptRecipientCount: 0,
      consecutiveFailureCount: 1,
    })
    .returning();
  return sched;
}

function authCookie(userId: string, tokenVersion: number | null) {
  return `auth_token=${generateToken(userId, tokenVersion)}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function waitForNotification(userId: string) {
  for (let i = 0; i < 200; i++) {
    const [row] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, "PROJECT_LOG_EMAIL_FAILURES_DIGEST"),
        ),
      )
      .limit(1);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

describe("PROJECT_LOG_EMAIL_FAILURES_DIGEST one-click mute — end-to-end (Task #1746)", () => {
  it(
    "muting via the signed link suppresses the next digest email + in-app feed entry for that user only",
    async () => {
      // Two active admins — both are eligible recipients of the daily
      // failures digest. Mute one of them only.
      const muteUser = await makeAdmin("muted-admin");
      const peerUser = await makeAdmin("peer-admin");

      // Step 1: muted admin "clicks" the signed mute URL out of their
      // digest email.
      const { signLogEmailFailuresDigestMuteToken } = await import(
        "../utils/logEmailFailuresDigestMuteToken"
      );
      const token = signLogEmailFailuresDigestMuteToken(muteUser.id);

      const muteRes = await request(app)
        .get(`/api/notifications/mute/log-email-failures-digest?token=${encodeURIComponent(token)}`)
        .redirects(0);
      // Express `res.redirect` defaults to 302.
      expect(muteRes.status).toBe(302);
      expect(muteRes.headers.location).toBe(
        "/admin/log-email-failures?muted=log_email_failures_digest",
      );

      // The mute endpoint upserted the per-type prefs row with email +
      // in-app disabled — the contract `deliverNotification` and
      // `notificationRoutes2.loadInAppMutedTypes` consume below.
      const [muteRow] = await db
        .select()
        .from(notificationTypePrefs)
        .where(
          and(
            eq(notificationTypePrefs.userId, muteUser.id),
            eq(notificationTypePrefs.notificationType, "PROJECT_LOG_EMAIL_FAILURES_DIGEST"),
          ),
        )
        .limit(1);
      expect(muteRow).toBeTruthy();
      expect(muteRow.emailEnabled).toBe(false);
      expect(muteRow.inAppEnabled).toBe(false);

      // Seed a failing schedule so the digest sweep has something to
      // fan out about.
      const project = await makeProject(peerUser.id);
      await makeFailingSchedule(project.id);

      // Step 2: trigger the digest fan-out via the same sweep the
      // hourly cron fires. Pass a deterministic `now` aligned with the
      // org's default digest hour (08:00 UTC) so the per-org schedule
      // gate inside `processProjectLogEmailFailuresDigest` lets this
      // org through regardless of when the test runs.
      clearTestEmailOutbox();
      const { processProjectLogEmailFailuresDigest } = await import("../jobs/jobRunner");
      const now = new Date();
      now.setUTCHours(8, 30, 0, 0);
      await processProjectLogEmailFailuresDigest({ now });

      // Wait for the peer's email to land in the noop outbox; deliver
      // is fire-and-forget via setImmediate.
      await waitFor(() => getTestEmailOutbox().length >= 1, 5_000);
      // Give the muted user's deliverNotification one extra beat to
      // run — it MUST complete and decide not to send.
      await new Promise((r) => setTimeout(r, 250));

      const outbox = getTestEmailOutbox();
      const peerEmails = outbox.filter((e) => e.to.includes(peerUser.email));
      const muteEmails = outbox.filter((e) => e.to.includes(muteUser.email));

      // Peer admin still receives the digest email; muted admin does NOT.
      expect(peerEmails.length).toBe(1);
      expect(peerEmails[0].subject.toLowerCase()).toContain("scheduled log email failures");
      // The HTML body should carry the one-click mute footer link.
      expect(peerEmails[0].html ?? "").toContain(
        "/api/notifications/mute/log-email-failures-digest?token=",
      );
      expect(peerEmails[0].html ?? "").toContain("data-testid=\"link-mute-log-email-failures-digest\"");
      expect(muteEmails.length).toBe(0);

      // Both recipients have the in-app row inserted (the mute is a
      // read-time filter, not an insert-time block — deliberate so
      // outbound channels remain independently configurable).
      const muteNote = await waitForNotification(muteUser.id);
      const peerNote = await waitForNotification(peerUser.id);
      expect(muteNote).toBeTruthy();
      expect(peerNote).toBeTruthy();

      // Step 3: But the muted user's `/api/notifications` feed must
      // hide the row (and the unread-count must agree).
      const muteFeedRes = await request(app)
        .get("/api/notifications")
        .set("Cookie", authCookie(muteUser.id, muteUser.tokenVersion ?? 0));
      expect(muteFeedRes.status).toBe(200);
      const muteFeedTypes = (muteFeedRes.body as Array<{ type: string }>).map(
        (n) => n.type,
      );
      expect(muteFeedTypes).not.toContain("PROJECT_LOG_EMAIL_FAILURES_DIGEST");

      const muteUnread = await request(app)
        .get("/api/notifications/unread-count")
        .set("Cookie", authCookie(muteUser.id, muteUser.tokenVersion ?? 0));
      expect(muteUnread.status).toBe(200);
      expect(muteUnread.body.count).toBe(0);

      // The peer admin's feed + unread count DO surface it.
      const peerFeedRes = await request(app)
        .get("/api/notifications")
        .set("Cookie", authCookie(peerUser.id, peerUser.tokenVersion ?? 0));
      expect(peerFeedRes.status).toBe(200);
      const peerFeed = peerFeedRes.body as Array<{ type: string; title: string }>;
      const peerDigestRow = peerFeed.find(
        (n) => n.type === "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
      );
      expect(peerDigestRow).toBeTruthy();
      expect(peerDigestRow!.title.toLowerCase()).toContain("scheduled log email failures");

      const peerUnread = await request(app)
        .get("/api/notifications/unread-count")
        .set("Cookie", authCookie(peerUser.id, peerUser.tokenVersion ?? 0));
      expect(peerUnread.status).toBe(200);
      expect(peerUnread.body.count).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it("an invalid mute token redirects back to the dashboard with mute=invalid", async () => {
    const res = await request(app)
      .get(`/api/notifications/mute/log-email-failures-digest?token=not-a-valid-token`)
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/admin/log-email-failures?mute=invalid");
  });
});
