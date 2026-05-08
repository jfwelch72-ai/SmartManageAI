/**
 * Task #1142 — regression coverage for the "Cancelled by" history filter
 * added in Task #1090.
 *
 * The new filter lives in three places that all have to agree on the same
 * `cancelledById` semantics, otherwise the admin UI's quick-pick dropdown
 * silently mismatches the listing it filters:
 *
 *   1. Storage: `listCrmTranscriptBackfillJobs({ cancelledById })` and
 *      `locateCrmTranscriptBackfillJobPage(jobId, { cancelledById })`
 *      must both restrict to rows whose `cancelled_by_id` equals the
 *      supplied user id, and must AND-combine cleanly with `startedById`.
 *   2. Routes: `GET /api/crm/calls/transcripts/backfill/history` and
 *      `…/history/locate` must parse the `cancelledById` query param and
 *      forward it to storage.
 *   3. Routes: `GET /api/crm/calls/transcripts/backfill/cancellers` must
 *      return distinct cancellers with their job counts.
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
import {
  listCrmTranscriptBackfillJobs,
  locateCrmTranscriptBackfillJobPage,
} from "../crm/transcriptBackfillStorage";
import type { AuthRequest } from "../auth";

// crmCallsRoutes pulls in the transcription service transitively. Stub it
// out so the suite stays fast and offline, matching the convention used
// by the cross-org history suite this test sits next to.
vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(),
  queueCallTranscription: vi.fn(),
}));

const TEST_PREFIX = "__crm_backfill_cancelled_by__";

let routes: typeof import("../crmCallsRoutes");
let app: Express;

type FakeUser = {
  id: string;
  role: "ADMIN" | "SUPER_ADMIN";
  organizationId: string | null;
};
let currentUser: FakeUser | null = null;

let orgId: string;
let otherOrgId: string;
let adminId: string;
let starterAId: string;
let starterBId: string;
let cancellerXId: string;
let cancellerYId: string;
let otherOrgCancellerId: string;

// Job ids — naming is `<starter>_<canceller-or-status>`.
let jobAxId: string; // started by A, cancelled by X
let jobAyId: string; // started by A, cancelled by Y
let jobBxId: string; // started by B, cancelled by X
let jobBcompletedId: string; // started by B, completed (no canceller)
let jobOtherOrgId: string; // different org, cancelled by canceller in that org

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

async function seedJob(opts: {
  organizationId: string;
  startedById: string;
  cancelledById?: string | null;
  status?: string;
  startedAt?: Date;
  label: string;
}): Promise<string> {
  const id = `${TEST_PREFIX}${opts.label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(crmTranscriptBackfillJobs).values({
    id,
    organizationId: opts.organizationId,
    status: opts.status ?? (opts.cancelledById ? "CANCELLED" : "COMPLETED"),
    total: 1,
    processed: 1,
    succeeded: opts.cancelledById ? 0 : 1,
    failed: 0,
    errors: [],
    failedRecordingIds: [],
    startedById: opts.startedById,
    startedAt: opts.startedAt ?? new Date(),
    completedAt: new Date(),
    cancelledById: opts.cancelledById ?? null,
    cancellationReason: opts.cancelledById ? "test cancel" : null,
  });
  return id;
}

beforeAll(async () => {
  routes = await import("../crmCallsRoutes");

  const express = await import("express");
  app = express.default();
  app.use(express.default.json());

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

  orgId = await makeOrg("org");
  otherOrgId = await makeOrg("other");

  adminId = await makeUser("admin", "ADMIN", orgId);
  starterAId = await makeUser("starterA", "ADMIN", orgId);
  starterBId = await makeUser("starterB", "ADMIN", orgId);
  cancellerXId = await makeUser("cancX", "ADMIN", orgId);
  cancellerYId = await makeUser("cancY", "ADMIN", orgId);
  otherOrgCancellerId = await makeUser("otherCanc", "ADMIN", otherOrgId);

  // Use distinct startedAt so ordering is deterministic across runs.
  const t0 = Date.now();
  jobAxId = await seedJob({
    organizationId: orgId,
    startedById: starterAId,
    cancelledById: cancellerXId,
    startedAt: new Date(t0 - 4000),
    label: "Ax",
  });
  jobAyId = await seedJob({
    organizationId: orgId,
    startedById: starterAId,
    cancelledById: cancellerYId,
    startedAt: new Date(t0 - 3000),
    label: "Ay",
  });
  jobBxId = await seedJob({
    organizationId: orgId,
    startedById: starterBId,
    cancelledById: cancellerXId,
    startedAt: new Date(t0 - 2000),
    label: "Bx",
  });
  jobBcompletedId = await seedJob({
    organizationId: orgId,
    startedById: starterBId,
    cancelledById: null,
    status: "COMPLETED",
    startedAt: new Date(t0 - 1000),
    label: "Bc",
  });
  jobOtherOrgId = await seedJob({
    organizationId: otherOrgId,
    startedById: starterAId, // user lives in another org but FK is set null on delete only
    cancelledById: otherOrgCancellerId,
    startedAt: new Date(t0 - 500),
    label: "OO",
  });
});

describe("storage: listCrmTranscriptBackfillJobs({ cancelledById })", () => {
  it("returns only rows cancelled by the supplied user, scoped to the org", async () => {
    const { rows, total } = await listCrmTranscriptBackfillJobs({
      organizationId: orgId,
      cancelledById: cancellerXId,
    });
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([jobAxId, jobBxId].sort());
    expect(total).toBe(2);
    // Other-org row must not leak in even though we're filtering by the
    // canceller user id.
    expect(ids).not.toContain(jobOtherOrgId);
    // The completed (no canceller) and Y-cancelled rows must be excluded.
    expect(ids).not.toContain(jobBcompletedId);
    expect(ids).not.toContain(jobAyId);
    // Joined canceller fields are populated for every returned row.
    for (const row of rows) {
      expect(row.cancelledById).toBe(cancellerXId);
      expect(row.cancelledByLastName).toBe("cancX");
    }
  });

  it("AND-combines with startedById so both filters narrow the result together", async () => {
    const { rows, total } = await listCrmTranscriptBackfillJobs({
      organizationId: orgId,
      cancelledById: cancellerXId,
      startedById: starterAId,
    });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([jobAxId]);

    // A starter/canceller combo with no overlap returns nothing.
    const empty = await listCrmTranscriptBackfillJobs({
      organizationId: orgId,
      cancelledById: cancellerYId,
      startedById: starterBId,
    });
    expect(empty.total).toBe(0);
    expect(empty.rows).toEqual([]);
  });
});

describe("GET /api/crm/calls/transcripts/backfill/history?cancelledById", () => {
  it("parses cancelledById, forwards it to storage, and respects it in the JSON response", async () => {
    currentUser = { id: adminId, role: "ADMIN", organizationId: orgId };

    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/history")
      .query({ cancelledById: cancellerXId });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = (res.body.jobs as Array<{ id: string }>).map((j) => j.id).sort();
    expect(ids).toEqual([jobAxId, jobBxId].sort());
    // Each row should carry the canceller payload built by the route.
    for (const job of res.body.jobs as Array<{ cancelledBy: { id: string } | null }>) {
      expect(job.cancelledBy).not.toBeNull();
      expect(job.cancelledBy!.id).toBe(cancellerXId);
    }

    // Combined with startedById, the listing narrows further.
    const combo = await request(app)
      .get("/api/crm/calls/transcripts/backfill/history")
      .query({ cancelledById: cancellerXId, startedById: starterAId });
    expect(combo.status).toBe(200);
    expect(combo.body.total).toBe(1);
    expect((combo.body.jobs as Array<{ id: string }>).map((j) => j.id)).toEqual([
      jobAxId,
    ]);
  });
});

describe("GET /api/crm/calls/transcripts/backfill/history/locate?cancelledById", () => {
  it("respects cancelledById when computing the page offset for a job", async () => {
    currentUser = { id: adminId, role: "ADMIN", organizationId: orgId };

    // Only two jobs match cancelledById=X (jobAx older, jobBx newer). The
    // listing orders by startedAt DESC so jobBx is at offset 0 and jobAx
    // at offset 1.
    const newer = await request(app)
      .get("/api/crm/calls/transcripts/backfill/history/locate")
      .query({ jobId: jobBxId, cancelledById: cancellerXId });
    expect(newer.status).toBe(200);
    expect(newer.body.found).toBe(true);
    expect(newer.body.filteredOut).toBe(false);
    expect(newer.body.offset).toBe(0);

    const older = await request(app)
      .get("/api/crm/calls/transcripts/backfill/history/locate")
      .query({ jobId: jobAxId, cancelledById: cancellerXId });
    expect(older.status).toBe(200);
    expect(older.body.found).toBe(true);
    expect(older.body.filteredOut).toBe(false);
    expect(older.body.offset).toBe(1);

    // A job that doesn't match the filter falls back to the unfiltered
    // listing and reports filteredOut so the UI can clear the filter
    // before navigating.
    const mismatch = await request(app)
      .get("/api/crm/calls/transcripts/backfill/history/locate")
      .query({ jobId: jobBcompletedId, cancelledById: cancellerXId });
    expect(mismatch.status).toBe(200);
    expect(mismatch.body.found).toBe(true);
    expect(mismatch.body.filteredOut).toBe(true);
  });

  it("storage helper directly honors cancelledById for completeness", async () => {
    // Belt-and-suspenders: exercise the storage helper without the route
    // wrapper so a route-only regression can't mask a storage bug.
    const result = await locateCrmTranscriptBackfillJobPage(jobAxId, {
      organizationId: orgId,
      cancelledById: cancellerXId,
    });
    expect(result.found).toBe(true);
    expect(result.filteredOut).toBe(false);
    expect(result.offset).toBe(1);
  });
});

describe("GET /api/crm/calls/transcripts/backfill/cancellers", () => {
  it("returns distinct cancellers in this org with their job counts", async () => {
    currentUser = { id: adminId, role: "ADMIN", organizationId: orgId };

    const res = await request(app).get(
      "/api/crm/calls/transcripts/backfill/cancellers",
    );
    expect(res.status).toBe(200);
    const cancellers = res.body.cancellers as Array<{
      id: string;
      jobCount: number;
      lastName: string | null;
      email: string | null;
    }>;

    const byId = new Map(cancellers.map((c) => [c.id, c]));
    // Both org cancellers present; other-org canceller absent.
    expect(byId.has(cancellerXId)).toBe(true);
    expect(byId.has(cancellerYId)).toBe(true);
    expect(byId.has(otherOrgCancellerId)).toBe(false);
    // Starters who never cancelled anything must not appear.
    expect(byId.has(starterAId)).toBe(false);
    expect(byId.has(starterBId)).toBe(false);

    // Counts: cancellerX cancelled jobAx + jobBx (=2), cancellerY cancelled
    // only jobAy (=1).
    expect(byId.get(cancellerXId)!.jobCount).toBe(2);
    expect(byId.get(cancellerYId)!.jobCount).toBe(1);
  });
});
