/**
 * Task #1060 — coverage for the new
 * GET /api/crm/calls/transcripts/backfill/test-alert/usage endpoint.
 *
 * The endpoint powers the "how often is this button being clicked"
 * rollup that sits between the latest-test indicator and the audit
 * history list on the admin transcript backfill page. The contract
 * under test is:
 *
 *   - org-scoped admins only ever see their own org's counts
 *   - 24h / 7d / 30d windows are computed correctly relative to "now"
 *   - audit rows older than 30d are excluded from every window
 *   - unauthenticated callers are rejected (401)
 *
 * We seed audit rows directly so we don't have to drive the dispatcher
 * (and therefore don't need to stub Slack/email transports here — the
 * usage endpoint never touches them).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillTestAlerts,
} from "@shared/schema";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `test-alert-usage-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__test_alert_usage_${SUFFIX}__`;

const USAGE_PATH = "/api/crm/calls/transcripts/backfill/test-alert/usage";

let app: Express;
let server: Server;

let primaryOrgId: string;
let otherOrgId: string;
let adminUserId: string;
let otherAdminUserId: string;
let superAdminUserId: string;
let adminCookie: string;
let superAdminCookie: string;

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
        firstName: "Test",
        lastName: "Admin",
        organizationId: primaryOrgId,
        role: "ADMIN",
      },
      {
        email: `other-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "x",
        firstName: "Other",
        lastName: "Admin",
        organizationId: otherOrgId,
        role: "ADMIN",
      },
      {
        email: `super-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "x",
        firstName: "Super",
        lastName: "Admin",
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
      .where(inArray(users.id, [adminUserId, otherAdminUserId, superAdminUserId]))
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

async function seedAlert(orgId: string, sentById: string, sentAt: Date) {
  await db.insert(crmTranscriptBackfillTestAlerts).values({
    organizationId: orgId,
    sentById,
    sentAt,
    operatorDisplay: "seed",
    slackConfigured: false,
    slackOk: false,
    slackError: null,
    emailConfigured: false,
    emailOk: false,
    emailError: null,
    emailRecipients: [],
  });
}

describe("GET /api/crm/calls/transcripts/backfill/test-alert/usage", () => {
  it("rejects unauthenticated callers", async () => {
    const res = await request(app).get(USAGE_PATH);
    expect(res.status).toBe(401);
  });

  it("counts rows in the 24h / 7d / 30d windows for the caller's org", async () => {
    await clearAuditRows();

    const now = Date.now();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    // Inside 24h (also inside 7d and 30d).
    await seedAlert(primaryOrgId, adminUserId, new Date(now - 30 * minute));
    await seedAlert(primaryOrgId, adminUserId, new Date(now - 6 * hour));
    // Inside 7d but outside 24h.
    await seedAlert(primaryOrgId, adminUserId, new Date(now - 3 * day));
    // Inside 30d but outside 7d.
    await seedAlert(primaryOrgId, adminUserId, new Date(now - 20 * day));
    // Older than 30d — should be excluded everywhere.
    await seedAlert(primaryOrgId, adminUserId, new Date(now - 45 * day));
    // Different org — must NOT bleed into the caller's counts.
    await seedAlert(otherOrgId, otherAdminUserId, new Date(now - 30 * minute));
    await seedAlert(otherOrgId, otherAdminUserId, new Date(now - 5 * day));

    const res = await request(app).get(USAGE_PATH).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.last24h).toBe(2);
    expect(res.body.last7d).toBe(3);
    expect(res.body.last30d).toBe(4);
    // Org-scoped admins must never see the cross-org flag flipped on.
    expect(res.body.crossOrg).toBe(false);
    expect(typeof res.body.windowEndsAt).toBe("string");
  });

  it("returns zeros when the org has no recorded test alerts", async () => {
    await clearAuditRows();

    const res = await request(app).get(USAGE_PATH).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.last24h).toBe(0);
    expect(res.body.last7d).toBe(0);
    expect(res.body.last30d).toBe(0);
    expect(res.body.crossOrg).toBe(false);
  });

  it("lets SUPER_ADMIN see cross-org totals when no organizationId is passed", async () => {
    await clearAuditRows();

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    // Two rows in the primary org, one in the other org — all inside 24h.
    await seedAlert(primaryOrgId, adminUserId, new Date(now - hour));
    await seedAlert(primaryOrgId, adminUserId, new Date(now - 2 * hour));
    await seedAlert(otherOrgId, otherAdminUserId, new Date(now - 3 * hour));
    // One row outside 24h but inside 7d — counts toward 7d/30d totals only.
    await seedAlert(otherOrgId, otherAdminUserId, new Date(now - 4 * day));

    const res = await request(app)
      .get(USAGE_PATH)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.body.last24h).toBe(3);
    expect(res.body.last7d).toBe(4);
    expect(res.body.last30d).toBe(4);
    expect(res.body.crossOrg).toBe(true);
  });

  it("lets SUPER_ADMIN scope to a single org via ?organizationId", async () => {
    await clearAuditRows();

    const now = Date.now();
    const hour = 60 * 60 * 1000;

    // 1 row in primary, 2 rows in other — all inside 24h.
    await seedAlert(primaryOrgId, adminUserId, new Date(now - hour));
    await seedAlert(otherOrgId, otherAdminUserId, new Date(now - hour));
    await seedAlert(otherOrgId, otherAdminUserId, new Date(now - 2 * hour));

    const res = await request(app)
      .get(`${USAGE_PATH}?organizationId=${otherOrgId}`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    // The scoped count must only reflect the explicitly-requested org,
    // proving the org filter is honoured (not silently widened).
    expect(res.body.last24h).toBe(2);
    expect(res.body.last7d).toBe(2);
    expect(res.body.last30d).toBe(2);
    // crossOrg flips false the moment a SUPER_ADMIN scopes to one tenant.
    expect(res.body.crossOrg).toBe(false);
  });

  it("ignores ?organizationId from non-super-admins (cannot peek at other orgs)", async () => {
    await clearAuditRows();

    // A row exists in the other org but the caller is a plain ADMIN, so
    // the route should ignore the query param and only count their own
    // org (which has zero rows here).
    await seedAlert(otherOrgId, otherAdminUserId, new Date());

    const res = await request(app)
      .get(`${USAGE_PATH}?organizationId=${otherOrgId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.last24h).toBe(0);
    expect(res.body.last7d).toBe(0);
    expect(res.body.last30d).toBe(0);
    expect(res.body.crossOrg).toBe(false);
  });
});
