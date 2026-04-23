// Task #1473 — End-to-end coverage for the SWPPP overdue
// one-click mute footer link introduced in Task #1287.
//
// Existing unit tests (`swppp-overdue-email-mute.test.ts`) cover the
// endpoint contract with mocked DB; this test exercises the *full*
// flow against the real Postgres test database and the real
// notification delivery pipeline, mirroring the WAGE_DECISION_RATES_CHANGED
// end-to-end test added in Task #1441
// (`wage-decision-rates-changed-mute-e2e.test.ts`).
//
//   1. Two recipient users (the corrective action assignee and the
//      project manager) are seeded into the same org with email
//      channel prefs enabled, plus a project and an OPEN
//      `swppp_inspections` row whose `corrective_action_due_date`
//      sits in the past so the nightly sweep targets it.
//   2. The assignee "clicks" the signed mute link by issuing an HTTP
//      GET to `/api/notifications/mute/swppp-overdue?token=…`.
//   3. We then run the actual nightly sweep
//      (`processSwpppOverdueCorrectiveActions`, scheduled as
//      `swppp_overdue_corrective_actions` in `server/jobs/jobRunner.ts`).
//   4. Assertions:
//        - The muted assignee is NOT emailed and the
//          SWPPP_OVERDUE_CORRECTIVE_ACTION notification is filtered
//          out of their `/api/notifications` feed AND
//          `/api/notifications/unread-count` (per-type
//          `inAppEnabled = false` is honoured by
//          `notificationRoutes2.loadInAppMutedTypes`).
//        - The peer PM still receives BOTH the email (via the noop
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
  swpppInspections,
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

const PREFIX = "__swppp_mute_e2e__";

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
    await db.delete(swpppInspections).where(eq(swpppInspections.organizationId, id));
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
    process.env.SESSION_SECRET = "test-secret-for-swppp-mute-e2e";
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

  // Mount the routers we exercise:
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
  await db.delete(swpppInspections).where(eq(swpppInspections.organizationId, orgId));
  await db.delete(projects).where(eq(projects.gcOrganizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  clearTestEmailOutbox();
});

async function makeRecipient(label: string) {
  const [u] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "Swppp",
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

async function makeOverdueInspection(projectId: string, assigneeId: string) {
  // Due date set well in the past so the sweep classifies it as
  // overdue regardless of when the test runs. `lastOverdueNotifiedAt`
  // is left NULL so the sweep treats this as the initial fanout
  // (rather than a follow-up reminder) — that's the path the mute
  // link is intended to short-circuit.
  const [insp] = await db
    .insert(swpppInspections)
    .values({
      organizationId: orgId,
      projectId,
      inspectionDate: "2026-01-01",
      inspectionType: "ROUTINE",
      status: "OPEN",
      correctiveActions: "Repair silt fence on east berm",
      correctiveActionAssigneeId: assigneeId,
      correctiveActionDueDate: "2026-01-05",
    })
    .returning();
  return insp;
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
          eq(notifications.type, "SWPPP_OVERDUE_CORRECTIVE_ACTION"),
        ),
      )
      .limit(1);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

describe("SWPPP_OVERDUE_CORRECTIVE_ACTION one-click mute — end-to-end (Task #1473)", () => {
  it(
    "muting via the signed link suppresses the next email + in-app feed entry for that user only",
    async () => {
      // Two recipients in the same org — the corrective action
      // assignee (will be muted) and the project manager (peer).
      const muteUser = await makeRecipient("muted-assignee");
      const peerUser = await makeRecipient("peer-pm");
      const project = await makeProject(peerUser.id);
      const inspection = await makeOverdueInspection(project.id, muteUser.id);

      // Step 1: muted user "clicks" the signed mute URL out of their
      // overdue email.
      const { signSwpppMuteToken } = await import("../utils/swpppMuteToken");
      const token = signSwpppMuteToken(muteUser.id);

      const muteRes = await request(app)
        .get(`/api/notifications/mute/swppp-overdue?token=${encodeURIComponent(token)}`)
        .redirects(0);
      // Express `res.redirect` defaults to 302.
      expect(muteRes.status).toBe(302);
      expect(muteRes.headers.location).toBe(
        "/settings/notifications?muted=swppp_overdue#section-swppp-overdue-prefs",
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
            eq(notificationTypePrefs.notificationType, "SWPPP_OVERDUE_CORRECTIVE_ACTION"),
          ),
        )
        .limit(1);
      expect(muteRow).toBeTruthy();
      expect(muteRow.emailEnabled).toBe(false);
      expect(muteRow.inAppEnabled).toBe(false);

      // Step 2: trigger the next SWPPP overdue fanout via the same
      // sweep the nightly cron fires.
      clearTestEmailOutbox();
      const { processSwpppOverdueCorrectiveActions } = await import("../jobs/jobRunner");
      await processSwpppOverdueCorrectiveActions();

      // Note on the in-app contract intentionally exercised below:
      // `processSwpppOverdueCorrectiveActions` always writes a
      // `notifications` row for every targeted recipient (assignee +
      // PM) and then delegates per-channel suppression to
      // `deliverNotification`. The muted user's row IS still inserted
      // by design — the per-type mute
      // (`notification_type_prefs.inAppEnabled = false`) is honoured
      // as a *read-time* filter inside
      // `notificationRoutes2.loadInAppMutedTypes` so that future
      // outbound channels (e.g. SMS, push) can be wired up without
      // each one re-implementing the suppression check. The
      // user-visible behaviour required by Task #1473 is therefore:
      //   (a) no email is sent to the muted user (send-time
      //       suppression), and
      //   (b) the muted user's `/api/notifications` feed and
      //       unread-count both omit the new SWPPP overdue row
      //       (read-time filter).
      // Both of those are asserted explicitly below.

      // Wait for the peer's email to land in the noop outbox; deliver
      // is fire-and-forget via setImmediate.
      await waitFor(() => getTestEmailOutbox().length >= 1, 5_000);
      // Give the muted user's deliverNotification one extra beat to
      // run — it MUST complete and decide not to send.
      await new Promise((r) => setTimeout(r, 250));

      const outbox = getTestEmailOutbox();
      const peerEmails = outbox.filter((e) => e.to.includes(peerUser.email));
      const muteEmails = outbox.filter((e) => e.to.includes(muteUser.email));

      // Peer PM still receives the email; muted assignee does NOT.
      expect(peerEmails.length).toBe(1);
      expect(peerEmails[0].subject.toLowerCase()).toContain("swppp");
      expect(`${peerEmails[0].text ?? ""}${peerEmails[0].html ?? ""}`).toContain(
        project.name,
      );
      expect(muteEmails.length).toBe(0);

      // Both recipients have the in-app row inserted (the mute is a
      // read-time filter, not an insert-time block — deliberate so
      // outbound channels remain independently configurable).
      const muteNote = await waitForNotification(muteUser.id);
      const peerNote = await waitForNotification(peerUser.id);
      expect(muteNote).toBeTruthy();
      expect(peerNote).toBeTruthy();
      expect(muteNote!.relatedEntityId).toBe(inspection.id);
      expect(peerNote!.relatedEntityId).toBe(inspection.id);

      // Step 3: But the muted user's `/api/notifications` feed must
      // hide the row (and the unread-count must agree).
      const muteFeedRes = await request(app)
        .get("/api/notifications")
        .set("Cookie", authCookie(muteUser.id, muteUser.tokenVersion ?? 0));
      expect(muteFeedRes.status).toBe(200);
      const muteFeedTypes = (muteFeedRes.body as Array<{ type: string }>).map(
        (n) => n.type,
      );
      expect(muteFeedTypes).not.toContain("SWPPP_OVERDUE_CORRECTIVE_ACTION");

      const muteUnread = await request(app)
        .get("/api/notifications/unread-count")
        .set("Cookie", authCookie(muteUser.id, muteUser.tokenVersion ?? 0));
      expect(muteUnread.status).toBe(200);
      expect(muteUnread.body.count).toBe(0);

      // The peer PM's feed + unread count DO surface it.
      const peerFeedRes = await request(app)
        .get("/api/notifications")
        .set("Cookie", authCookie(peerUser.id, peerUser.tokenVersion ?? 0));
      expect(peerFeedRes.status).toBe(200);
      const peerFeed = peerFeedRes.body as Array<{ type: string; title: string }>;
      const peerSwpppRow = peerFeed.find(
        (n) => n.type === "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      );
      expect(peerSwpppRow).toBeTruthy();
      expect(peerSwpppRow!.title).toContain(project.name);

      const peerUnread = await request(app)
        .get("/api/notifications/unread-count")
        .set("Cookie", authCookie(peerUser.id, peerUser.tokenVersion ?? 0));
      expect(peerUnread.status).toBe(200);
      expect(peerUnread.body.count).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );
});
