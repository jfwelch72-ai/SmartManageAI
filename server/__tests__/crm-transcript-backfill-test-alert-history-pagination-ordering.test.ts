/**
 * Task #1147 — coverage for the deterministic ordering of
 * `listCrmTranscriptBackfillTestAlerts` (and the HTTP endpoint
 * `GET /api/crm/calls/transcripts/backfill/test-alert/history`).
 *
 * The helper orders by `sentAt DESC, id DESC` so paging stays
 * deterministic when two rows share a `sentAt` timestamp. The existing
 * filters test only asserts that two pages don't overlap; it does not
 * pin the exact ordering, including the id-tiebreaker. A regression
 * there could re-order rows or even drop a row across pages without
 * breaking the existing assertions.
 *
 * This file seeds several rows that share an identical `sentAt` (plus
 * one older row to confirm the primary timestamp sort still wins) and
 * asserts that:
 *
 *   - paging through the helper with limit=2 returns every row exactly
 *     once with no duplicates and no missing rows
 *   - the order across pages matches `sentAt DESC, id DESC` with the
 *     id-tiebreaker enforced for the identical-timestamp rows
 *   - the order is stable across repeated invocations
 *   - the HTTP endpoint exhibits the same deterministic behavior
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { listCrmTranscriptBackfillTestAlerts } from "../crm/transcriptBackfillStorage";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `test-alert-pagination-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__test_alert_pagination_${SUFFIX}__`;

const HISTORY_PATH = "/api/crm/calls/transcripts/backfill/test-alert/history";

let app: Express;
let server: Server;

let orgId: string;
let adminUserId: string;
let adminCookie: string;

// 5 rows share `sharedSentAt`; 1 row is one hour older.
const sharedRowIds: string[] = [];
let olderRowId: string;

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
      name: `${TEST_ORG_PREFIX}org`,
      slug: `${TEST_ORG_PREFIX}org`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  orgId = org.id;

  const [admin] = await db
    .insert(users)
    .values({
      email: `admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Pat",
      lastName: "Pager",
      organizationId: orgId,
      role: "ADMIN",
    })
    .returning();
  adminUserId = admin.id;
  adminCookie = `auth_token=${generateToken(admin.id, admin.tokenVersion)}`;

  const sharedSentAt = new Date(Date.now() - 60 * 60 * 1000);
  const olderSentAt = new Date(sharedSentAt.getTime() - 60 * 60 * 1000);

  // Insert 5 rows with the SAME sentAt. We insert them one at a time so
  // each row gets a distinct generated id; the helper must then sort
  // those 5 rows by id DESC to stay deterministic.
  for (let i = 0; i < 5; i++) {
    const [row] = await db
      .insert(crmTranscriptBackfillTestAlerts)
      .values({
        organizationId: orgId,
        sentById: adminUserId,
        sentAt: sharedSentAt,
        operatorDisplay: `Pat Pager ${i}`,
        slackConfigured: true,
        slackOk: true,
        slackError: null,
        emailConfigured: true,
        emailOk: true,
        emailError: null,
        emailRecipients: [],
      })
      .returning({ id: crmTranscriptBackfillTestAlerts.id });
    sharedRowIds.push(row.id);
  }

  const [older] = await db
    .insert(crmTranscriptBackfillTestAlerts)
    .values({
      organizationId: orgId,
      sentById: adminUserId,
      sentAt: olderSentAt,
      operatorDisplay: "Pat Pager older",
      slackConfigured: true,
      slackOk: true,
      slackError: null,
      emailConfigured: true,
      emailOk: true,
      emailError: null,
      emailRecipients: [],
    })
    .returning({ id: crmTranscriptBackfillTestAlerts.id });
  olderRowId = older.id;
}, 60_000);

afterAll(async () => {
  try {
    await db
      .delete(crmTranscriptBackfillTestAlerts)
      .where(inArray(crmTranscriptBackfillTestAlerts.organizationId, [orgId]))
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

// Expected order: 5 shared-timestamp rows in id DESC order, then the
// older row last. This is the contract callers rely on.
function expectedOrder(): string[] {
  const sortedShared = [...sharedRowIds].sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );
  return [...sortedShared, olderRowId];
}

describe("listCrmTranscriptBackfillTestAlerts — stable pagination ordering", () => {
  it("orders shared-timestamp rows by id DESC and keeps older rows after newer ones", async () => {
    const { rows, total } = await listCrmTranscriptBackfillTestAlerts({
      organizationId: orgId,
    });
    expect(total).toBe(6);
    expect(rows.map((r) => r.id)).toEqual(expectedOrder());
  });

  it("paging with limit=2 returns each row exactly once across pages with the expected order", async () => {
    const expected = expectedOrder();
    const collected: string[] = [];
    for (let offset = 0; offset < expected.length; offset += 2) {
      const { rows } = await listCrmTranscriptBackfillTestAlerts({
        organizationId: orgId,
        limit: 2,
        offset,
      });
      collected.push(...rows.map((r) => r.id));
    }
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(expected.length);
  });

  it("returns the same order across repeated invocations (deterministic)", async () => {
    const a = await listCrmTranscriptBackfillTestAlerts({
      organizationId: orgId,
    });
    const b = await listCrmTranscriptBackfillTestAlerts({
      organizationId: orgId,
    });
    expect(a.rows.map((r) => r.id)).toEqual(b.rows.map((r) => r.id));
  });
});

describe("GET /api/crm/calls/transcripts/backfill/test-alert/history — stable pagination ordering", () => {
  it("paging via the HTTP endpoint covers every row exactly once and matches the helper's order", async () => {
    const expected = expectedOrder();
    const collected: string[] = [];
    for (let offset = 0; offset < expected.length; offset += 2) {
      const res = await request(app)
        .get(HISTORY_PATH)
        .query({ limit: 2, offset })
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(expected.length);
      const ids = (res.body.alerts as Array<{ id: string }>).map((r) => r.id);
      collected.push(...ids);
    }
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(expected.length);
  });
});
