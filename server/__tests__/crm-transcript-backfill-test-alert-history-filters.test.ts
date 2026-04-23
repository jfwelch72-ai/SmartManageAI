/**
 * Task #1097 — coverage for the test-alert history filters added in
 * Task #1061 to:
 *
 *   GET /api/crm/calls/transcripts/backfill/test-alert/history
 *
 * and the underlying storage helper `listCrmTranscriptBackfillTestAlerts`.
 *
 * The endpoint accepts: `sender`, `slackOk`, `emailOk`, `anyFailed`,
 * `sentAfter`, `sentBefore`, plus the older `organizationId` /
 * `limit` / `offset` knobs. Each filter is independent and combined
 * with AND. We seed a small fixture across two orgs / multiple
 * channel-result combos / staggered timestamps and assert that:
 *
 *   - each individual filter trims the result set as expected, with
 *     `total` reflecting the filtered count (not the unfiltered total)
 *   - filters compose correctly when combined
 *   - cross-org isolation still holds for org-scoped admins (mirrors
 *     `crm-transcript-backfill-history-cross-org.test.ts`)
 *   - SUPER_ADMIN can see every org by default and may scope to one
 *     via `?organizationId=...`
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillTestAlerts,
} from "@shared/schema";
import { generateToken } from "../auth";
import { listCrmTranscriptBackfillTestAlerts } from "../storage";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `test-alert-history-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__test_alert_history_${SUFFIX}__`;

const HISTORY_PATH = "/api/crm/calls/transcripts/backfill/test-alert/history";

let app: Express;
let server: Server;

let primaryOrgId: string;
let otherOrgId: string;
let adminUserId: string;
let otherAdminUserId: string;
let superAdminUserId: string;
let adminCookie: string;
let superAdminCookie: string;

// Stable references for the seeded rows so each test can assert on
// specific ids rather than re-deriving them from the response.
let rowBothOkPrimaryId: string;
let rowSlackFailPrimaryId: string;
let rowEmailFailPrimaryId: string;
let rowBothFailPrimaryId: string;
let rowOldPrimaryId: string;
let rowOtherOrgId: string;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const [primaryOrg, otherOrg] = await db
    .insert(organizations)
    .values([
      {
        name: `${TEST_ORG_PREFIX}primary`,
        slug: `${TEST_ORG_PREFIX}primary`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
      },
      {
        name: `${TEST_ORG_PREFIX}other`,
        slug: `${TEST_ORG_PREFIX}other`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
      },
    ])
    .returning();
  primaryOrgId = primaryOrg.id;
  otherOrgId = otherOrg.id;

  const [admin, otherAdmin, superAdmin] = await db
    .insert(users)
    .values([
      {
        email: `admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "x",
        firstName: "Jane",
        lastName: "Sender",
        organizationId: primaryOrgId,
        role: "ADMIN",
      },
      {
        email: `other-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "x",
        firstName: "Carlos",
        lastName: "Other",
        organizationId: otherOrgId,
        role: "ADMIN",
      },
      {
        email: `super-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "x",
        firstName: "Super",
        lastName: "Root",
        organizationId: primaryOrgId,
        role: "SUPER_ADMIN",
      },
    ])
    .returning();
  adminUserId = admin.id;
  otherAdminUserId = otherAdmin.id;
  superAdminUserId = superAdmin.id;
  adminCookie = `auth_token=${generateToken(admin.id, admin.tokenVersion)}`;
  superAdminCookie = `auth_token=${generateToken(
    superAdmin.id,
    superAdmin.tokenVersion,
  )}`;
}, 60_000);

afterAll(async () => {
  try {
    await db
      .delete(crmTranscriptBackfillTestAlerts)
      .where(
        inArray(crmTranscriptBackfillTestAlerts.organizationId, [
          primaryOrgId,
          otherOrgId,
        ]),
      )
      .catch(() => {});
    await db
      .delete(users)
      .where(
        inArray(users.id, [adminUserId, otherAdminUserId, superAdminUserId]),
      )
      .catch(() => {});
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [primaryOrgId, otherOrgId]))
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function clearAuditRows() {
  await db
    .delete(crmTranscriptBackfillTestAlerts)
    .where(
      inArray(crmTranscriptBackfillTestAlerts.organizationId, [
        primaryOrgId,
        otherOrgId,
      ]),
    );
}

async function seedAlert(opts: {
  organizationId: string;
  sentById: string | null;
  sentAt: Date;
  operatorDisplay: string;
  slackOk: boolean;
  emailOk: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(crmTranscriptBackfillTestAlerts)
    .values({
      organizationId: opts.organizationId,
      sentById: opts.sentById,
      sentAt: opts.sentAt,
      operatorDisplay: opts.operatorDisplay,
      slackConfigured: true,
      slackOk: opts.slackOk,
      slackError: opts.slackOk ? null : "boom",
      emailConfigured: true,
      emailOk: opts.emailOk,
      emailError: opts.emailOk ? null : "boom",
      emailRecipients: [],
    })
    .returning({ id: crmTranscriptBackfillTestAlerts.id });
  return row.id;
}

// Seed the same fixture before each test so they are independent.
//   primary org rows:
//     rowBothOkPrimary       — slack ok, email ok, 1h ago, sender Jane
//     rowSlackFailPrimary    — slack fail, email ok, 5h ago, sender Jane
//     rowEmailFailPrimary    — slack ok, email fail, 2d ago, operatorDisplay "Headless Bot"
//                              and a NULL sender so we still match it via the snapshot
//     rowBothFailPrimary     — slack fail, email fail, 10d ago, sender Jane
//     rowOldPrimary          — slack ok, email ok, 60d ago, sender Jane
//   other org rows:
//     rowOtherOrg            — slack ok, email ok, 1h ago, sender Carlos
beforeEach(async () => {
  await clearAuditRows();
  const now = Date.now();

  rowBothOkPrimaryId = await seedAlert({
    organizationId: primaryOrgId,
    sentById: adminUserId,
    sentAt: new Date(now - 1 * HOUR),
    operatorDisplay: "Jane Sender",
    slackOk: true,
    emailOk: true,
  });
  rowSlackFailPrimaryId = await seedAlert({
    organizationId: primaryOrgId,
    sentById: adminUserId,
    sentAt: new Date(now - 5 * HOUR),
    operatorDisplay: "Jane Sender",
    slackOk: false,
    emailOk: true,
  });
  rowEmailFailPrimaryId = await seedAlert({
    organizationId: primaryOrgId,
    sentById: null, // user was deleted; only the snapshot remains
    sentAt: new Date(now - 2 * DAY),
    operatorDisplay: "Headless Bot",
    slackOk: true,
    emailOk: false,
  });
  rowBothFailPrimaryId = await seedAlert({
    organizationId: primaryOrgId,
    sentById: adminUserId,
    sentAt: new Date(now - 10 * DAY),
    operatorDisplay: "Jane Sender",
    slackOk: false,
    emailOk: false,
  });
  rowOldPrimaryId = await seedAlert({
    organizationId: primaryOrgId,
    sentById: adminUserId,
    sentAt: new Date(now - 60 * DAY),
    operatorDisplay: "Jane Sender",
    slackOk: true,
    emailOk: true,
  });
  rowOtherOrgId = await seedAlert({
    organizationId: otherOrgId,
    sentById: otherAdminUserId,
    sentAt: new Date(now - 1 * HOUR),
    operatorDisplay: "Carlos Other",
    slackOk: true,
    emailOk: true,
  });
});

describe("GET /api/crm/calls/transcripts/backfill/test-alert/history — filters", () => {
  it("rejects unauthenticated callers", async () => {
    const res = await request(app).get(HISTORY_PATH);
    expect(res.status).toBe(401);
  });

  it("returns every row in the caller's org with no filters", async () => {
    const res = await request(app).get(HISTORY_PATH).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.crossOrg).toBe(false);
    expect(res.body.total).toBe(5);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        rowBothOkPrimaryId,
        rowSlackFailPrimaryId,
        rowEmailFailPrimaryId,
        rowBothFailPrimaryId,
        rowOldPrimaryId,
      ]),
    );
    // Cross-org isolation: the other org's row never appears.
    expect(ids).not.toContain(rowOtherOrgId);
  });

  it("filters by sender free-text against the joined user", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ sender: "jane" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        rowBothOkPrimaryId,
        rowSlackFailPrimaryId,
        rowBothFailPrimaryId,
        rowOldPrimaryId,
      ]),
    );
    // The "Headless Bot" row has a NULL sender and a different snapshot
    // so it is correctly excluded from a "jane" search.
    expect(ids).not.toContain(rowEmailFailPrimaryId);
  });

  it("filters by sender against the operatorDisplay snapshot when the user was deleted", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ sender: "headless" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual([rowEmailFailPrimaryId]);
  });

  it("filters by slackOk=false (Slack delivery failures only)", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ slackOk: "false" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([rowSlackFailPrimaryId, rowBothFailPrimaryId]),
    );
  });

  it("filters by emailOk=true", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ emailOk: "true" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        rowBothOkPrimaryId,
        rowSlackFailPrimaryId,
        rowOldPrimaryId,
      ]),
    );
    expect(ids).not.toContain(rowEmailFailPrimaryId);
    expect(ids).not.toContain(rowBothFailPrimaryId);
  });

  it("filters by anyFailed=true (slackOk=false OR emailOk=false)", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ anyFailed: "true" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        rowSlackFailPrimaryId,
        rowEmailFailPrimaryId,
        rowBothFailPrimaryId,
      ]),
    );
    expect(ids).not.toContain(rowBothOkPrimaryId);
    expect(ids).not.toContain(rowOldPrimaryId);
  });

  it("filters by anyFailed=false (both channels ok)", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ anyFailed: "false" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([rowBothOkPrimaryId, rowOldPrimaryId]),
    );
  });

  it("filters by sentAfter / sentBefore date range", async () => {
    const now = Date.now();
    const sentAfter = new Date(now - 7 * DAY).toISOString();
    const sentBefore = new Date(now - 30 * 60 * 1000).toISOString();
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ sentAfter, sentBefore })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    // Window covers everything from 7d ago up to 30 minutes ago, which
    // includes the 1h-old, 5h-old, and 2d-old rows but excludes the 10d
    // and 60d rows (and the not-yet-1h-old row, which is younger than
    // 30min? — no, it's 1h old so it qualifies).
    expect(res.body.total).toBe(3);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        rowBothOkPrimaryId,
        rowSlackFailPrimaryId,
        rowEmailFailPrimaryId,
      ]),
    );
    expect(ids).not.toContain(rowBothFailPrimaryId);
    expect(ids).not.toContain(rowOldPrimaryId);
  });

  it("composes multiple filters with AND", async () => {
    // sender=jane AND anyFailed=true ⇒ Jane's two failure rows only
    // (Slack-fail @5h and both-fail @10d), excluding the headless row.
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ sender: "jane", anyFailed: "true" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([rowSlackFailPrimaryId, rowBothFailPrimaryId]),
    );
    expect(ids).not.toContain(rowEmailFailPrimaryId);
  });

  it("hard-locks an org-scoped ADMIN to their own org even when ?organizationId spoofs another org", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ organizationId: otherOrgId })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.crossOrg).toBe(false);
    expect(res.body.total).toBe(5);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(rowOtherOrgId);
    // Every emitted row must belong to the caller's org.
    for (const row of res.body.alerts as Array<{ organizationId: string }>) {
      expect(row.organizationId).toBe(primaryOrgId);
    }
  });

  it("returns every org's rows for SUPER_ADMIN by default and scopes when organizationId is supplied", async () => {
    const allRes = await request(app)
      .get(HISTORY_PATH)
      .set("Cookie", superAdminCookie);
    expect(allRes.status).toBe(200);
    expect(allRes.body.crossOrg).toBe(true);
    const allIds = (allRes.body.alerts as Array<{ id: string }>).map(
      (r) => r.id,
    );
    expect(allIds).toEqual(
      expect.arrayContaining([
        rowBothOkPrimaryId,
        rowSlackFailPrimaryId,
        rowEmailFailPrimaryId,
        rowBothFailPrimaryId,
        rowOldPrimaryId,
        rowOtherOrgId,
      ]),
    );

    const scopedRes = await request(app)
      .get(HISTORY_PATH)
      .query({ organizationId: otherOrgId })
      .set("Cookie", superAdminCookie);
    expect(scopedRes.status).toBe(200);
    expect(scopedRes.body.crossOrg).toBe(false);
    expect(scopedRes.body.total).toBe(1);
    const scopedIds = (scopedRes.body.alerts as Array<{ id: string }>).map(
      (r) => r.id,
    );
    expect(scopedIds).toEqual([rowOtherOrgId]);
  });

  // Task #1148 — malformed filter values used to be silently dropped via
  // a Number.isNaN check, which made an admin-UI typo look like the
  // filter just didn't narrow anything. The endpoint now hard-fails with
  // a 400 so the bug surfaces immediately.
  it("rejects malformed sentAfter with 400 instead of silently ignoring it", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ sentAfter: "not-a-date" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(/sentAfter/);
  });

  it("rejects malformed sentBefore with 400", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ sentBefore: "yesterdayish" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sentBefore/);
  });

  it("rejects malformed slackOk / emailOk / anyFailed booleans with 400", async () => {
    for (const param of ["slackOk", "emailOk", "anyFailed"] as const) {
      const res = await request(app)
        .get(HISTORY_PATH)
        .query({ [param]: "maybe" })
        .set("Cookie", adminCookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(new RegExp(param));
    }
  });

  it("still treats empty filter values as 'unset' (no 400)", async () => {
    // An empty string is what a cleared input field sends; it should not
    // be treated as a malformed value, matching the previous behavior.
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({
        sentAfter: "",
        sentBefore: "",
        slackOk: "",
        emailOk: "",
        anyFailed: "",
      })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
  });

  it("still accepts canonical boolean / ISO values", async () => {
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({
        slackOk: "true",
        anyFailed: "false",
        sentAfter: new Date(Date.now() - 365 * DAY).toISOString(),
      })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
  });

  it("rejects malformed filters on the CSV exporter too", async () => {
    const res = await request(app)
      .get(`${HISTORY_PATH}.csv`)
      .query({ sentAfter: "garbage" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sentAfter/);
  });

  it("composes filters with the SUPER_ADMIN cross-org view", async () => {
    // anyFailed=true across every org should still only return Jane's
    // 3 failure rows in the primary org (the other org has no failures).
    const res = await request(app)
      .get(HISTORY_PATH)
      .query({ anyFailed: "true" })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.body.crossOrg).toBe(true);
    expect(res.body.total).toBe(3);
    const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        rowSlackFailPrimaryId,
        rowEmailFailPrimaryId,
        rowBothFailPrimaryId,
      ]),
    );
    expect(ids).not.toContain(rowOtherOrgId);
  });
});

describe("listCrmTranscriptBackfillTestAlerts — storage helper", () => {
  it("matches the email column when filtering by sender", async () => {
    const { rows, total } = await listCrmTranscriptBackfillTestAlerts({
      organizationId: primaryOrgId,
      sender: TEST_EMAIL_DOMAIN.split(".")[0], // unique substring of admin email
    });
    expect(total).toBe(4);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        rowBothOkPrimaryId,
        rowSlackFailPrimaryId,
        rowBothFailPrimaryId,
        rowOldPrimaryId,
      ]),
    );
    expect(ids).not.toContain(rowEmailFailPrimaryId);
  });

  it("returns paginated rows with a stable total", async () => {
    const page1 = await listCrmTranscriptBackfillTestAlerts({
      organizationId: primaryOrgId,
      limit: 2,
      offset: 0,
    });
    const page2 = await listCrmTranscriptBackfillTestAlerts({
      organizationId: primaryOrgId,
      limit: 2,
      offset: 2,
    });
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    const overlap = page1.rows
      .map((r) => r.id)
      .filter((id) => page2.rows.some((r) => r.id === id));
    expect(overlap).toEqual([]);
  });

  it("returns rows from every org when organizationId is omitted", async () => {
    const { rows, total } = await listCrmTranscriptBackfillTestAlerts({});
    expect(total).toBeGreaterThanOrEqual(6);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([rowOtherOrgId]));
  });

  it("combines anyFailed=true with a sentAfter window", async () => {
    const sentAfter = new Date(Date.now() - 7 * DAY);
    const { rows, total } = await listCrmTranscriptBackfillTestAlerts({
      organizationId: primaryOrgId,
      anyFailed: true,
      sentAfter,
    });
    expect(total).toBe(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([rowSlackFailPrimaryId, rowEmailFailPrimaryId]),
    );
    expect(ids).not.toContain(rowBothFailPrimaryId); // 10d ago, outside window
  });
});
