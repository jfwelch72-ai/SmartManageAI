/**
 * Task #1483 — integration coverage for the
 * `GET /api/crm/calls/transcripts/backfill/alert-failures-digest` endpoint
 * added in Task #1077. The endpoint backs the in-app "Recent alert
 * failures" card on /admin/transcript-backfill and mirrors the per-channel
 * rollup the daily digest email sends.
 *
 * This is a true end-to-end test: real `crm_transcript_backfill_alert_deliveries`
 * rows are seeded across two orgs and the route runs against the actual
 * `aggregateRecentCrmTranscriptBackfillAlertFailures` storage helper, so a
 * regression in either the SQL aggregation or the route serializer is
 * caught here.
 *
 * Coverage:
 *   - Caller-only org rollup: two seeded orgs each with their own
 *     failures, and each admin only sees their org's totals + rows.
 *     Successful deliveries in the same org are excluded from the count.
 *   - `windowHours` clamp & filter: an older failure outside the default
 *     24h window is excluded but appears once the window widens to 7d
 *     (168h); too-large values are clamped to 720, zero/negative to 1.
 *   - `recentFailures` cap: with >50 seeded failures, the default
 *     response caps `recentFailures` at 20 and a hand-crafted large
 *     `recentSampleLimit` is clamped to 50, so the endpoint can never
 *     return more recent samples than the digest does.
 *   - Auth/role guard: anonymous → 401, non-ADMIN → 403.
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
  crmTranscriptBackfillAlertDeliveries,
} from "@shared/schema";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `alert-failures-digest-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__alert_failures_digest_${SUFFIX}__`;
const ENDPOINT = "/api/crm/calls/transcripts/backfill/alert-failures-digest";

let app: Express;
let server: Server;

let orgAId: string;
let orgBId: string;
let adminAId: string;
let adminBId: string;
let fieldAId: string;
let adminACookie: string;
let adminBCookie: string;
let fieldACookie: string;

// Track inserted delivery ids so the afterAll cleanup is precise even if
// other suites share the table name.
const seededDeliveryIds: string[] = [];

async function makeOrgAndAdmin(label: string) {
  const [org] = await db
    .insert(organizations)
    .values({
      name: `${TEST_ORG_PREFIX}${label}`,
      slug: `${TEST_ORG_PREFIX}${label}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  const [admin] = await db
    .insert(users)
    .values({
      email: `${label}-admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: label,
      lastName: "Admin",
      organizationId: org.id,
      role: "ADMIN",
    })
    .returning();
  return { orgId: org.id, admin };
}

async function seedDelivery(opts: {
  orgId: string;
  jobId: string | null;
  channel: "slack" | "email";
  status: "failure" | "success";
  attemptedAt: Date;
  errorMessage?: string | null;
  recipientSummary?: string;
}) {
  const [row] = await db
    .insert(crmTranscriptBackfillAlertDeliveries)
    .values({
      organizationId: opts.orgId,
      jobId: opts.jobId,
      channel: opts.channel,
      status: opts.status,
      recipientSummary:
        opts.recipientSummary ??
        (opts.channel === "slack" ? "hooks.slack.com" : "ops@example.com"),
      errorMessage: opts.errorMessage ?? null,
      attemptedAt: opts.attemptedAt,
    })
    .returning({ id: crmTranscriptBackfillAlertDeliveries.id });
  seededDeliveryIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const a = await makeOrgAndAdmin("orga");
  orgAId = a.orgId;
  adminAId = a.admin.id;
  adminACookie = `auth_token=${generateToken(a.admin.id, a.admin.tokenVersion)}`;

  const b = await makeOrgAndAdmin("orgb");
  orgBId = b.orgId;
  adminBId = b.admin.id;
  adminBCookie = `auth_token=${generateToken(b.admin.id, b.admin.tokenVersion)}`;

  const [field] = await db
    .insert(users)
    .values({
      email: `orga-field-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Field",
      lastName: "Worker",
      organizationId: orgAId,
      role: "FIELD_WORKER",
    })
    .returning();
  fieldAId = field.id;
  fieldACookie = `auth_token=${generateToken(field.id, field.tokenVersion)}`;

  // ---- Seed failures inside the default 24h window for org A.
  // Spread attemptedAt values close to "now" so they all fall inside
  // the default 24h window. Use real, varied timestamps so the recent-
  // failures ordering (desc by attemptedAt) is meaningful.
  const now = Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;

  // 2 slack + 1 email failure for org A inside 24h.
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-1",
    channel: "slack",
    status: "failure",
    errorMessage: "404 not_found",
    attemptedAt: new Date(now - 2 * hour),
  });
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-2",
    channel: "slack",
    status: "failure",
    errorMessage: "500 boom",
    attemptedAt: new Date(now - 4 * hour),
  });
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-3",
    channel: "email",
    status: "failure",
    errorMessage: "smtp 550",
    attemptedAt: new Date(now - 6 * hour),
  });

  // A SUCCESS row in org A — must NOT count toward the rollup.
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-ok",
    channel: "slack",
    status: "success",
    attemptedAt: new Date(now - 30 * minute),
  });

  // An OLDER failure for org A: 5 days ago. Outside default 24h window
  // but inside the 7d (168h) window. Used to prove the windowHours
  // filter actually narrows the response, not just the request.
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-old",
    channel: "email",
    status: "failure",
    errorMessage: "ancient timeout",
    attemptedAt: new Date(now - 5 * 24 * hour),
  });

  // ---- Org B failures: completely different counts so cross-org
  // leakage in either direction is obvious.
  await seedDelivery({
    orgId: orgBId,
    jobId: "job-B-1",
    channel: "email",
    status: "failure",
    errorMessage: "smtp 421",
    attemptedAt: new Date(now - 3 * hour),
  });
  await seedDelivery({
    orgId: orgBId,
    jobId: "job-B-2",
    channel: "email",
    status: "failure",
    errorMessage: "smtp 421",
    attemptedAt: new Date(now - 5 * hour),
  });
}, 120_000);

afterAll(async () => {
  try {
    if (seededDeliveryIds.length > 0) {
      await db
        .delete(crmTranscriptBackfillAlertDeliveries)
        .where(
          inArray(crmTranscriptBackfillAlertDeliveries.id, seededDeliveryIds),
        )
        .catch(() => {});
    }
    await db
      .delete(users)
      .where(inArray(users.id, [adminAId, adminBId, fieldAId]))
      .catch(() => {});
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [orgAId, orgBId]))
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

type DigestResponse = {
  windowHours: number;
  since: string;
  total: number;
  slackCount: number;
  emailCount: number;
  recentFailures: Array<{
    jobId: string | null;
    channel: "slack" | "email";
    recipientSummary: string;
    errorMessage: string | null;
    attemptedAt: string;
  }>;
};

describe("GET /api/crm/calls/transcripts/backfill/alert-failures-digest", () => {
  it("returns ONLY the caller's org rollup with the 24h window from real seeded failures", async () => {
    const res = await request(app).get(ENDPOINT).set("Cookie", adminACookie);
    expect(res.status).toBe(200);
    const body = res.body as DigestResponse;

    // Org A in the default 24h window: 2 slack failures + 1 email failure.
    // The success row and the 5-day-old email failure must be excluded.
    expect(body.windowHours).toBe(24);
    expect(body.total).toBe(3);
    expect(body.slackCount).toBe(2);
    expect(body.emailCount).toBe(1);

    const jobIds = body.recentFailures.map((f) => f.jobId);
    expect(jobIds).toEqual(
      expect.arrayContaining(["job-A-1", "job-A-2", "job-A-3"]),
    );
    // None of org B's rows leak in.
    for (const jobId of jobIds) {
      expect(jobId).not.toMatch(/^job-B-/);
    }
    // Successful deliveries are excluded.
    expect(jobIds).not.toContain("job-A-ok");
    // Older-than-window failure is excluded.
    expect(jobIds).not.toContain("job-A-old");

    // attemptedAt is serialized to ISO strings and ordered desc.
    for (const f of body.recentFailures) {
      expect(typeof f.attemptedAt).toBe("string");
      expect(new Date(f.attemptedAt).toISOString()).toBe(f.attemptedAt);
    }
    const timestamps = body.recentFailures.map((f) =>
      new Date(f.attemptedAt).getTime(),
    );
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });

  it("returns the OTHER org's own rollup without leaking org A's failures", async () => {
    const res = await request(app).get(ENDPOINT).set("Cookie", adminBCookie);
    expect(res.status).toBe(200);
    const body = res.body as DigestResponse;

    expect(body.total).toBe(2);
    expect(body.emailCount).toBe(2);
    expect(body.slackCount).toBe(0);
    const jobIds = body.recentFailures.map((f) => f.jobId);
    for (const jobId of jobIds) {
      expect(jobId).not.toMatch(/^job-A-/);
    }
  });

  describe("windowHours clamp + filter", () => {
    it("widens the window to 7d (168h) and includes the older failure", async () => {
      const res = await request(app)
        .get(ENDPOINT)
        .query({ windowHours: 168 })
        .set("Cookie", adminACookie);
      expect(res.status).toBe(200);
      const body = res.body as DigestResponse;
      expect(body.windowHours).toBe(168);
      // 24h totals (3) + the older email failure = 4.
      expect(body.total).toBe(4);
      expect(body.emailCount).toBe(2);
      expect(body.slackCount).toBe(2);
      const jobIds = body.recentFailures.map((f) => f.jobId);
      expect(jobIds).toContain("job-A-old");
    });

    it("clamps a too-large windowHours to 720 (and `since` reflects that clamp)", async () => {
      const before = Date.now();
      const res = await request(app)
        .get(ENDPOINT)
        .query({ windowHours: 99999 })
        .set("Cookie", adminACookie);
      expect(res.status).toBe(200);
      const body = res.body as DigestResponse;
      expect(body.windowHours).toBe(720);
      // since ≈ now - 720h. Allow a small wall-clock slack.
      const sinceMs = new Date(body.since).getTime();
      const expectedMs = before - 720 * 60 * 60 * 1000;
      expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(60 * 1000);
    });

    it("clamps zero / negative windowHours up to 1 (excludes everything)", async () => {
      const res = await request(app)
        .get(ENDPOINT)
        .query({ windowHours: 0 })
        .set("Cookie", adminACookie);
      expect(res.status).toBe(200);
      const body = res.body as DigestResponse;
      expect(body.windowHours).toBe(1);
      // Nothing was seeded inside the last hour, so the rollup is zero.
      expect(body.total).toBe(0);
      expect(body.recentFailures).toEqual([]);

      const res2 = await request(app)
        .get(ENDPOINT)
        .query({ windowHours: -10 })
        .set("Cookie", adminACookie);
      expect(res2.status).toBe(200);
      expect((res2.body as DigestResponse).windowHours).toBe(1);
    });

    it("falls back to 24h when windowHours is non-numeric", async () => {
      const res = await request(app)
        .get(ENDPOINT)
        .query({ windowHours: "not-a-number" })
        .set("Cookie", adminACookie);
      expect(res.status).toBe(200);
      expect((res.body as DigestResponse).windowHours).toBe(24);
    });
  });

  describe("recentFailures cap", () => {
    // A separate org so the bulk seeding doesn't pollute the org-A
    // assertions in the rest of the suite.
    let bulkOrgId: string;
    let bulkAdminId: string;
    let bulkCookie: string;
    const TOTAL_BULK = 75;

    beforeAll(async () => {
      const bulk = await makeOrgAndAdmin("bulk");
      bulkOrgId = bulk.orgId;
      bulkAdminId = bulk.admin.id;
      bulkCookie = `auth_token=${generateToken(
        bulk.admin.id,
        bulk.admin.tokenVersion,
      )}`;

      const now = Date.now();
      const minute = 60 * 1000;
      // Seed 75 failures, all inside the default 24h window, with
      // strictly decreasing timestamps so we can also assert ordering.
      for (let i = 0; i < TOTAL_BULK; i += 1) {
        await seedDelivery({
          orgId: bulkOrgId,
          jobId: `job-bulk-${i}`,
          channel: i % 2 === 0 ? "slack" : "email",
          status: "failure",
          errorMessage: `boom-${i}`,
          attemptedAt: new Date(now - i * minute),
        });
      }
    }, 120_000);

    afterAll(async () => {
      try {
        // Delete the bulk-seeded delivery rows before their parent org so
        // FK / cascade ordering can't leave dangling rows even if the
        // schema's ON DELETE CASCADE were ever loosened.
        await db
          .delete(crmTranscriptBackfillAlertDeliveries)
          .where(
            inArray(
              crmTranscriptBackfillAlertDeliveries.organizationId,
              [bulkOrgId],
            ),
          )
          .catch(() => {});
        await db
          .delete(users)
          .where(inArray(users.id, [bulkAdminId]))
          .catch(() => {});
        await db
          .delete(organizations)
          .where(inArray(organizations.id, [bulkOrgId]))
          .catch(() => {});
      } catch {
        /* non-fatal */
      }
    }, 30_000);

    it("caps recentFailures at the default 20 even when the rollup totals are higher", async () => {
      const res = await request(app).get(ENDPOINT).set("Cookie", bulkCookie);
      expect(res.status).toBe(200);
      const body = res.body as DigestResponse;
      // Totals reflect the full count even though the sample is capped.
      expect(body.total).toBe(TOTAL_BULK);
      expect(body.recentFailures.length).toBe(20);
      // Default sample is the 20 most recent rows (job-bulk-0 .. -19).
      const ids = body.recentFailures.map((f) => f.jobId);
      expect(ids[0]).toBe("job-bulk-0");
      expect(ids[ids.length - 1]).toBe("job-bulk-19");
    });

    it("clamps a too-large recentSampleLimit to the digest cap of 50", async () => {
      const res = await request(app)
        .get(ENDPOINT)
        .query({ recentSampleLimit: 9999 })
        .set("Cookie", bulkCookie);
      expect(res.status).toBe(200);
      const body = res.body as DigestResponse;
      expect(body.total).toBe(TOTAL_BULK);
      // Even though we asked for 9999, we never get more than 50.
      expect(body.recentFailures.length).toBe(50);
    });

    it("clamps zero / negative recentSampleLimit up to 1", async () => {
      const res = await request(app)
        .get(ENDPOINT)
        .query({ recentSampleLimit: 0 })
        .set("Cookie", bulkCookie);
      expect(res.status).toBe(200);
      expect((res.body as DigestResponse).recentFailures.length).toBe(1);
    });
  });

  describe("auth + role guard", () => {
    it("rejects unauthenticated callers with 401", async () => {
      const res = await request(app).get(ENDPOINT);
      expect(res.status).toBe(401);
    });

    it("rejects non-ADMIN callers with 403", async () => {
      const res = await request(app).get(ENDPOINT).set("Cookie", fieldACookie);
      expect(res.status).toBe(403);
    });
  });
});
