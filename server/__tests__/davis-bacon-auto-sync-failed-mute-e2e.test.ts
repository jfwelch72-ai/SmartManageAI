// Task #1474 — End-to-end coverage for the DAVIS_BACON_AUTO_SYNC_FAILED
// one-click mute footer link introduced in Task #1361.
//
// Existing unit tests (`davis-bacon-auto-sync-email-mute.test.ts`) cover
// the endpoint contract with mocked DB; this test exercises the *full*
// flow against the real Postgres test database and the real notification
// delivery pipeline (modeled on the WAGE_DECISION_RATES_CHANGED end-to-end
// suite for Task #1441):
//
//   1. Two active org admins are seeded into the same org with email
//      channel prefs enabled — both are eligible recipients of the
//      Davis-Bacon auto-sync failure fan-out.
//   2. One admin "clicks" the signed mute link by issuing an HTTP GET to
//      `/api/notifications/mute/davis-bacon-auto-sync-failed?token=…`.
//   3. We then trigger the failure fan-out via
//      `notifyOrgAdminsOfWageDecisionSyncFailure`, the same call used by
//      the manual + background sync failure paths.
//   4. Assertions:
//        - The muted admin is NOT emailed and the
//          DAVIS_BACON_AUTO_SYNC_FAILED notification is filtered out of
//          their `/api/notifications` feed AND
//          `/api/notifications/unread-count` (per-type
//          `inAppEnabled = false` is honoured by
//          `notificationRoutes2.loadInAppMutedTypes`).
//        - The peer admin still receives BOTH the email (via the noop
//          email outbox) and the in-app feed row.
//        - We also document the read-time-filter contract explicitly:
//          the `notifications` row IS still inserted for the muted
//          user by design (so other outbound channels remain
//          independently configurable per Task #1260's comment in
//          `shared/schema/operations.ts`); only the user-visible feed
//          is suppressed.

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

const PREFIX = "__dbasf_mute_e2e__";

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
    process.env.SESSION_SECRET = "test-secret-for-dbasf-mute-e2e";
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

  // Build a minimal Express app that mounts the two routers we exercise:
  //   * notificationPreferencesRoutes for the signed mute endpoint.
  //   * notificationRoutes2 for the in-app feed (`/api/notifications`).
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
    // Leave the test-only fallback in place — other suites importing the
    // mute-token util in the same vitest worker rely on it being set.
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
  await db.delete(projects).where(eq(projects.gcOrganizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  clearTestEmailOutbox();
});

async function makeAdmin(label: string) {
  const [u] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "DB",
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
          eq(notifications.type, "DAVIS_BACON_AUTO_SYNC_FAILED"),
        ),
      )
      .limit(1);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

describe("DAVIS_BACON_AUTO_SYNC_FAILED one-click mute — end-to-end (Task #1474)", () => {
  it(
    "muting via the signed link suppresses the next email + in-app feed entry for that user only",
    async () => {
      const decisionNumber = "CA20261474";

      // Two active org admins — both are eligible recipients of the
      // Davis-Bacon auto-sync failure fan-out. Mute one of them only.
      const muteUser = await makeAdmin("muted-admin");
      const peerUser = await makeAdmin("peer-admin");

      // Step 1: muted admin "clicks" the signed mute URL out of their email.
      const { signDavisBaconMuteToken } = await import(
        "../utils/davisBaconMuteToken"
      );
      const token = signDavisBaconMuteToken(muteUser.id);

      const muteRes = await request(app)
        .get(`/api/notifications/mute/davis-bacon-auto-sync-failed?token=${encodeURIComponent(token)}`)
        .redirects(0);
      // Express `res.redirect` defaults to 302.
      expect(muteRes.status).toBe(302);
      expect(muteRes.headers.location).toBe(
        "/settings/notifications?muted=davis_bacon_auto_sync_failed#section-davis-bacon-auto-sync-failed-prefs",
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
            eq(notificationTypePrefs.notificationType, "DAVIS_BACON_AUTO_SYNC_FAILED"),
          ),
        )
        .limit(1);
      expect(muteRow).toBeTruthy();
      expect(muteRow.emailEnabled).toBe(false);
      expect(muteRow.inAppEnabled).toBe(false);

      // Step 2: Trigger the next DAVIS_BACON_AUTO_SYNC_FAILED notification
      // via the same fan-out the manual + background sync failure paths use.
      clearTestEmailOutbox();
      const { notifyOrgAdminsOfWageDecisionSyncFailure } = await import(
        "../services/davisBaconAdminNotifications"
      );
      const out = await notifyOrgAdminsOfWageDecisionSyncFailure({
        organizationId: orgId,
        decisionNumber,
        errorMessage: "DOL upstream returned 503 Service Unavailable",
        source: "background_sync",
      });
      // Sanity: the fan-out targeted both admins.
      // Note on the in-app contract intentionally exercised below:
      // `notifyOrgAdminsOfWageDecisionSyncFailure` always writes a
      // `notifications` row for every targeted admin and then delegates
      // per-channel suppression to `deliverNotification`. The muted
      // user's row IS still inserted by design — the per-type mute
      // (`notification_type_prefs.inAppEnabled = false`) is honoured as
      // a *read-time* filter inside
      // `notificationRoutes2.loadInAppMutedTypes` so that future
      // outbound channels (e.g. SMS, push) can be wired up without each
      // one re-implementing the suppression check. The user-visible
      // behaviour required by Task #1474 is therefore:
      //   (a) no email is sent to the muted user (send-time suppression),
      //       and
      //   (b) the muted user's `/api/notifications` feed and unread-count
      //       both omit the new DAVIS_BACON_AUTO_SYNC_FAILED row
      //       (read-time filter).
      // Both of those are asserted explicitly below.
      expect(out.recipients).toBe(2);

      // Wait for the peer's email to land in the noop outbox; deliver
      // is fire-and-forget via setImmediate.
      await waitFor(() => getTestEmailOutbox().length >= 1, 5_000);
      // Give the muted user's deliverNotification one extra beat to run
      // — it MUST complete and decide not to send.
      await new Promise((r) => setTimeout(r, 250));

      const outbox = getTestEmailOutbox();
      const peerEmails = outbox.filter((e) => e.to.includes(peerUser.email));
      const muteEmails = outbox.filter((e) => e.to.includes(muteUser.email));

      // Peer admin still receives the email; muted admin does NOT.
      expect(peerEmails.length).toBe(1);
      expect(peerEmails[0].subject.toLowerCase()).toContain("davis-bacon auto-sync failed");
      expect(`${peerEmails[0].text ?? ""}${peerEmails[0].html ?? ""}`).toContain(
        decisionNumber,
      );
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
      expect(muteFeedTypes).not.toContain("DAVIS_BACON_AUTO_SYNC_FAILED");

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
      const peerFeed = peerFeedRes.body as Array<{ type: string; message: string }>;
      const peerFailureRow = peerFeed.find(
        (n) => n.type === "DAVIS_BACON_AUTO_SYNC_FAILED",
      );
      expect(peerFailureRow).toBeTruthy();
      expect(peerFailureRow!.message).toContain(decisionNumber);

      const peerUnread = await request(app)
        .get("/api/notifications/unread-count")
        .set("Cookie", authCookie(peerUser.id, peerUser.tokenVersion ?? 0));
      expect(peerUnread.status).toBe(200);
      expect(peerUnread.body.count).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );
});
