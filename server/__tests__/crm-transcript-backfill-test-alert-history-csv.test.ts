/**
 * Task #1149 — coverage for the test-alert history CSV exporter added in
 * Task #1096:
 *
 *   GET /api/crm/calls/transcripts/backfill/test-alert/history.csv
 *
 * The endpoint mirrors the JSON history filters (sender / slackOk /
 * emailOk / anyFailed / sentAfter / sentBefore / organizationId) and the
 * SUPER_ADMIN cross-org behavior of the JSON sibling. A regression that
 * dropped a filter from the CSV path or relaxed org scoping would
 * silently leak rows from another tenant or strip filters from the
 * exported file with zero visible signal in the UI, so we exercise:
 *
 *   - filter passthrough (sender, per-channel result, date range)
 *   - cross-org isolation for org-scoped admins (cannot read another org)
 *   - SUPER_ADMIN cross-org (omit organizationId vs scope to one)
 *   - CSV escaping for fields containing commas, double quotes, and
 *     newlines (operator snapshot, error messages, recipient list)
 *
 * The 100k-row safety cap is exercised in a sibling test that mocks the
 * storage helper so we don't have to seed 100,000 audit rows just to
 * trip the bound.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import Papa from "papaparse";

import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillTestAlerts,
} from "@shared/schema";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `test-alert-history-csv-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__test_alert_history_csv_${SUFFIX}__`;

const CSV_PATH =
  "/api/crm/calls/transcripts/backfill/test-alert/history.csv";

let app: Express;
let server: Server;

let primaryOrgId: string;
let otherOrgId: string;
let adminUserId: string;
let otherAdminUserId: string;
let superAdminUserId: string;
let adminCookie: string;
let superAdminCookie: string;

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
  slackError?: string | null;
  emailError?: string | null;
  emailRecipients?: string[];
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
      slackError:
        opts.slackError !== undefined
          ? opts.slackError
          : opts.slackOk
          ? null
          : "boom",
      emailConfigured: true,
      emailOk: opts.emailOk,
      emailError:
        opts.emailError !== undefined
          ? opts.emailError
          : opts.emailOk
          ? null
          : "boom",
      emailRecipients: opts.emailRecipients ?? [],
    })
    .returning({ id: crmTranscriptBackfillTestAlerts.id });
  return row.id;
}

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
    sentById: null,
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

function parseCsv(body: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const result = Papa.parse<string[]>(body.replace(/\n$/, ""), {
    skipEmptyLines: false,
  });
  const data = result.data as string[][];
  const headers = data[0];
  const rows = data.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

describe("GET /test-alert/history.csv (Task #1149)", () => {
  it("rejects unauthenticated callers", async () => {
    const res = await request(app).get(CSV_PATH);
    expect(res.status).toBe(401);
  });

  it("emits a CSV with the documented headers and one row per audit entry in the caller's org", async () => {
    const res = await request(app).get(CSV_PATH).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment;\s*filename="transcript-backfill-test-alert-history-/,
    );

    const { headers, rows } = parseCsv(res.text);
    expect(headers).toEqual([
      "id",
      "organization_id",
      "organization_name",
      "sent_at",
      "sender_name",
      "sender_email",
      "operator_display",
      "slack_configured",
      "slack_ok",
      "slack_error",
      "email_configured",
      "email_ok",
      "email_error",
      "email_recipients",
    ]);

    const ids = rows.map((r) => r.id);
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
    for (const row of rows) {
      expect(row.organization_id).toBe(primaryOrgId);
      expect(row.organization_name).toBe(`${TEST_ORG_PREFIX}primary`);
    }
  });

  it("passes through the sender filter", async () => {
    const res = await request(app)
      .get(CSV_PATH)
      .query({ sender: "headless" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const { rows } = parseCsv(res.text);
    expect(rows.map((r) => r.id)).toEqual([rowEmailFailPrimaryId]);
  });

  it("passes through per-channel result filters (slackOk=false)", async () => {
    const res = await request(app)
      .get(CSV_PATH)
      .query({ slackOk: "false" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const { rows } = parseCsv(res.text);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([rowSlackFailPrimaryId, rowBothFailPrimaryId]),
    );
    expect(ids).not.toContain(rowBothOkPrimaryId);
    expect(ids).not.toContain(rowEmailFailPrimaryId);
    expect(ids).not.toContain(rowOldPrimaryId);
    // slack_ok column reflects the filter outcome.
    expect(rows.every((r) => r.slack_ok === "false")).toBe(true);
  });

  it("passes through anyFailed=true", async () => {
    const res = await request(app)
      .get(CSV_PATH)
      .query({ anyFailed: "true" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const ids = parseCsv(res.text).rows.map((r) => r.id);
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

  it("passes through the sentAfter / sentBefore date range", async () => {
    const now = Date.now();
    const sentAfter = new Date(now - 7 * DAY).toISOString();
    const sentBefore = new Date(now - 30 * 60 * 1000).toISOString();
    const res = await request(app)
      .get(CSV_PATH)
      .query({ sentAfter, sentBefore })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const ids = parseCsv(res.text).rows.map((r) => r.id);
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

  it("hard-locks an org-scoped ADMIN to their own org even when ?organizationId spoofs another org", async () => {
    const res = await request(app)
      .get(CSV_PATH)
      .query({ organizationId: otherOrgId })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const { rows } = parseCsv(res.text);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(rowOtherOrgId);
    for (const row of rows) {
      expect(row.organization_id).toBe(primaryOrgId);
    }
  });

  it("returns every org's rows for SUPER_ADMIN by default and scopes when organizationId is supplied", async () => {
    const allRes = await request(app)
      .get(CSV_PATH)
      .set("Cookie", superAdminCookie);
    expect(allRes.status).toBe(200);
    const allIds = parseCsv(allRes.text).rows.map((r) => r.id);
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
      .get(CSV_PATH)
      .query({ organizationId: otherOrgId })
      .set("Cookie", superAdminCookie);
    expect(scopedRes.status).toBe(200);
    const scoped = parseCsv(scopedRes.text);
    expect(scoped.rows.map((r) => r.id)).toEqual([rowOtherOrgId]);
    for (const row of scoped.rows) {
      expect(row.organization_id).toBe(otherOrgId);
    }
  });

  it("escapes fields containing commas, double quotes, and embedded newlines", async () => {
    // Add a row whose every text field needs CSV escaping. The route
    // hand-rolls the escaping (`/[",\n\r]/.test(s)`), so any regression
    // in that helper would corrupt the column boundary, the row
    // boundary, or the embedded quotes — all of which are exercised
    // here through a real CSV parser.
    await clearAuditRows();
    const trickyOperator = `Op "Quoted", with, commas\nand a newline`;
    const trickyError = `boom\r\n"oops"`;
    const trickyRecipients = [
      `weird,addr@example.com`,
      `quoted "name" <q@example.com>`,
    ];
    const trickyId = await seedAlert({
      organizationId: primaryOrgId,
      sentById: null,
      sentAt: new Date("2026-01-15T12:34:56.000Z"),
      operatorDisplay: trickyOperator,
      slackOk: false,
      emailOk: false,
      slackError: trickyError,
      emailError: trickyError,
      emailRecipients: trickyRecipients,
    });

    const res = await request(app).get(CSV_PATH).set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const { headers, rows } = parseCsv(res.text);
    expect(headers).toContain("operator_display");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(trickyId);
    expect(row.operator_display).toBe(trickyOperator);
    // sender_name falls back to operator_display when there is no joined
    // user and no sender email — same escaping applies.
    expect(row.sender_name).toBe(trickyOperator);
    expect(row.slack_error).toBe(trickyError);
    expect(row.email_error).toBe(trickyError);
    expect(row.email_recipients).toBe(trickyRecipients.join("; "));
    expect(row.sent_at).toBe("2026-01-15T12:34:56.000Z");
  });
});
