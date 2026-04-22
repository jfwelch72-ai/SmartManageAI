/**
 * Task #1020 — regression coverage for the cross-org transcript backfill
 * history view added in Task #1007.
 *
 * The history endpoints (`GET /api/crm/calls/transcripts/backfill/history`
 * and `…/history.csv`) intentionally treat SUPER_ADMINs and org-scoped
 * ADMINs differently:
 *
 *   * Org-scoped ADMIN: must be hard-locked to their own org. Even if they
 *     pass `?organizationId=<other-org>` the response must only contain
 *     rows from their own organization.
 *   * SUPER_ADMIN: sees every org by default (`crossOrg: true`) and may
 *     scope to a single org by passing `?organizationId=<id>`.
 *
 * A regression in `resolveOrg`, `getOrgIdForFilter`, or
 * `listCrmTranscriptBackfillJobs` could quietly leak one tenant's history
 * into another's view, or block super admins from the cross-org view, so
 * we exercise both endpoints against a three-org fixture for both roles.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { Express, NextFunction, Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillJobs,
} from "@shared/schema";
import type { AuthRequest } from "../auth";

// The history endpoints don't drive the worker, but importing
// crmCallsRoutes triggers transitive imports that pull in the
// transcription service. Stubbing it keeps the suite fast and offline,
// matching the convention used by the other backfill suites.
vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(),
  queueCallTranscription: vi.fn(),
}));

const TEST_PREFIX = "__crm_backfill_history_xorg__";

let routes: typeof import("../crmCallsRoutes");
let app: Express;

// The auth-injection middleware reads from this so each test can pivot
// the caller between an org-scoped ADMIN and a SUPER_ADMIN without
// re-mounting the router.
type FakeUser = {
  id: string;
  role: "ADMIN" | "SUPER_ADMIN";
  organizationId: string | null;
};
let currentUser: FakeUser | null = null;

let orgAId: string;
let orgBId: string;
let orgCId: string;
let adminAId: string;
let adminBId: string;
let superAdminId: string;

// One job id per org so we can spot-check membership in the response.
let jobAId: string;
let jobBId: string;
let jobCId: string;

async function cleanupTestData() {
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
  await db.delete(organizations).where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
}

async function makeOrg(label: string): Promise<string> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}${label}`, slug })
    .returning();
  return org.id;
}

async function makeUser(
  label: string,
  role: "ADMIN" | "SUPER_ADMIN",
  organizationId: string | null,
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.invalid`,
      passwordHash: "x",
      firstName: "Test",
      lastName: label,
      organizationId,
      role,
    })
    .returning();
  return u.id;
}

async function seedJob(
  organizationId: string,
  startedById: string,
  label: string,
): Promise<string> {
  const id = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(crmTranscriptBackfillJobs).values({
    id,
    organizationId,
    status: "COMPLETED",
    total: 1,
    processed: 1,
    succeeded: 1,
    failed: 0,
    errors: [],
    failedRecordingIds: [],
    startedById,
    startedAt: new Date(),
    completedAt: new Date(),
  });
  return id;
}

beforeAll(async () => {
  routes = await import("../crmCallsRoutes");

  const express = await import("express");
  app = express.default();
  app.use(express.default.json());

  // Inject whatever user the active test selected. The history endpoints
  // require ADMIN or SUPER_ADMIN, and resolveOrg reads
  // req.user.organizationId, so we provide both.
  app.use((req: AuthRequest, res: Response, next: NextFunction) => {
    if (!currentUser) {
      res.status(401).json({ error: "no test user configured" });
      return;
    }
    req.user = {
      id: currentUser.id,
      email: "irrelevant@test.invalid",
      firstName: "Test",
      lastName: "Caller",
      role: currentUser.role,
      organizationId: currentUser.organizationId,
      isActive: true,
    } as AuthRequest["user"];
    next();
  });
  app.use(routes.default);
  // Surface route-level errors as JSON so failed assertions show the real
  // cause instead of a bare 500.
  app.use((err: unknown, _req: AuthRequest, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  });
});

afterAll(async () => {
  await cleanupTestData();
});

beforeEach(async () => {
  await cleanupTestData();
  currentUser = null;

  orgAId = await makeOrg("orgA");
  orgBId = await makeOrg("orgB");
  orgCId = await makeOrg("orgC");

  adminAId = await makeUser("adminA", "ADMIN", orgAId);
  adminBId = await makeUser("adminB", "ADMIN", orgBId);
  // SUPER_ADMINs in this codebase typically don't carry an organizationId;
  // getOrgIdForFilter ignores it for them anyway.
  superAdminId = await makeUser("super", "SUPER_ADMIN", null);

  jobAId = await seedJob(orgAId, adminAId, "jobA");
  jobBId = await seedJob(orgBId, adminBId, "jobB");
  jobCId = await seedJob(orgCId, adminAId, "jobC");
});

function parseCsv(body: string): { headers: string[]; rows: Record<string, string>[] } {
  // The CSV writer never emits embedded newlines for our seeded rows
  // (no commas/quotes/newlines in the values), so a naive split is safe
  // here. If that ever changes, swap in a real parser.
  const lines = body.trim().split("\n");
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

describe("transcript backfill history — cross-org access (Task #1020)", () => {
  describe("GET /history", () => {
    it("locks an org-scoped ADMIN to their own org even when they pass another org's id", async () => {
      currentUser = { id: adminAId, role: "ADMIN", organizationId: orgAId };

      // Bare request: only the caller's own org rows.
      const res = await request(app).get(
        "/api/crm/calls/transcripts/backfill/history",
      );
      expect(res.status).toBe(200);
      expect(res.body.crossOrg).toBe(false);
      const ids = (res.body.jobs as Array<{ id: string }>).map((j) => j.id);
      expect(ids).toContain(jobAId);
      expect(ids).not.toContain(jobBId);
      expect(ids).not.toContain(jobCId);
      const orgIds = new Set(
        (res.body.jobs as Array<{ organization: { id: string } }>).map(
          (j) => j.organization.id,
        ),
      );
      expect(orgIds).toEqual(new Set([orgAId]));

      // Hostile request: explicitly ask for org B. Must still only see A.
      const spoofRes = await request(app)
        .get("/api/crm/calls/transcripts/backfill/history")
        .query({ organizationId: orgBId });
      expect(spoofRes.status).toBe(200);
      expect(spoofRes.body.crossOrg).toBe(false);
      const spoofIds = (spoofRes.body.jobs as Array<{ id: string }>).map((j) => j.id);
      expect(spoofIds).toContain(jobAId);
      expect(spoofIds).not.toContain(jobBId);
      expect(spoofIds).not.toContain(jobCId);
    });

    it("returns every org's rows for SUPER_ADMIN by default and scopes when organizationId is supplied", async () => {
      currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };

      // Default cross-org view: every seeded job appears, with the
      // crossOrg flag flipped on so the UI can render the org column.
      const allRes = await request(app).get(
        "/api/crm/calls/transcripts/backfill/history",
      );
      expect(allRes.status).toBe(200);
      expect(allRes.body.crossOrg).toBe(true);
      const allIds = (allRes.body.jobs as Array<{ id: string }>).map((j) => j.id);
      expect(allIds).toEqual(expect.arrayContaining([jobAId, jobBId, jobCId]));
      const allOrgIds = new Set(
        (allRes.body.jobs as Array<{ organization: { id: string } }>).map(
          (j) => j.organization.id,
        ),
      );
      // Exactly the three seeded orgs — no extra rows leaking in from
      // other suites and none missing.
      expect(allOrgIds.size).toBe(3);
      expect(allOrgIds.has(orgAId)).toBe(true);
      expect(allOrgIds.has(orgBId)).toBe(true);
      expect(allOrgIds.has(orgCId)).toBe(true);

      // Scoped to a single org via the query string.
      const scopedRes = await request(app)
        .get("/api/crm/calls/transcripts/backfill/history")
        .query({ organizationId: orgBId });
      expect(scopedRes.status).toBe(200);
      expect(scopedRes.body.crossOrg).toBe(false);
      const scopedIds = (scopedRes.body.jobs as Array<{ id: string }>).map(
        (j) => j.id,
      );
      expect(scopedIds).toContain(jobBId);
      expect(scopedIds).not.toContain(jobAId);
      expect(scopedIds).not.toContain(jobCId);
      const scopedOrgIds = new Set(
        (scopedRes.body.jobs as Array<{ organization: { id: string } }>).map(
          (j) => j.organization.id,
        ),
      );
      expect(scopedOrgIds.size).toBe(1);
      expect(scopedOrgIds).toEqual(new Set([orgBId]));
    });
  });

  describe("GET /history.csv", () => {
    it("locks an org-scoped ADMIN to their own org's rows even when organizationId spoofs another org", async () => {
      currentUser = { id: adminAId, role: "ADMIN", organizationId: orgAId };

      const res = await request(app)
        .get("/api/crm/calls/transcripts/backfill/history.csv")
        .query({ organizationId: orgBId });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);

      const { headers, rows } = parseCsv(res.text);
      // Task #1007 added these two columns; their absence would mean a
      // regression in the CSV writer.
      expect(headers).toEqual(
        expect.arrayContaining(["organization_id", "organization_name"]),
      );

      const ids = rows.map((r) => r.id);
      expect(ids).toContain(jobAId);
      expect(ids).not.toContain(jobBId);
      expect(ids).not.toContain(jobCId);
      // Every emitted row must belong to the caller's org.
      for (const row of rows) {
        expect(row.organization_id).toBe(orgAId);
        expect(row.organization_name).toBe(`${TEST_PREFIX}orgA`);
      }
    });

    it("exports every org's rows for SUPER_ADMIN by default and scopes when organizationId is supplied", async () => {
      currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };

      const allRes = await request(app).get(
        "/api/crm/calls/transcripts/backfill/history.csv",
      );
      expect(allRes.status).toBe(200);
      expect(allRes.headers["content-type"]).toMatch(/text\/csv/);
      const all = parseCsv(allRes.text);
      expect(all.headers).toEqual(
        expect.arrayContaining(["organization_id", "organization_name"]),
      );
      const allIds = all.rows.map((r) => r.id);
      expect(allIds).toEqual(expect.arrayContaining([jobAId, jobBId, jobCId]));
      const allOrgIds = new Set(all.rows.map((r) => r.organization_id));
      expect(allOrgIds.has(orgAId)).toBe(true);
      expect(allOrgIds.has(orgBId)).toBe(true);
      expect(allOrgIds.has(orgCId)).toBe(true);
      // org_name column must be populated, not blank.
      const namesForA = all.rows
        .filter((r) => r.organization_id === orgAId)
        .map((r) => r.organization_name);
      expect(namesForA.every((n) => n === `${TEST_PREFIX}orgA`)).toBe(true);

      const scopedRes = await request(app)
        .get("/api/crm/calls/transcripts/backfill/history.csv")
        .query({ organizationId: orgCId });
      expect(scopedRes.status).toBe(200);
      const scoped = parseCsv(scopedRes.text);
      const scopedIds = scoped.rows.map((r) => r.id);
      expect(scopedIds).toContain(jobCId);
      expect(scopedIds).not.toContain(jobAId);
      expect(scopedIds).not.toContain(jobBId);
      for (const row of scoped.rows) {
        expect(row.organization_id).toBe(orgCId);
        expect(row.organization_name).toBe(`${TEST_PREFIX}orgC`);
      }
    });
  });
});
