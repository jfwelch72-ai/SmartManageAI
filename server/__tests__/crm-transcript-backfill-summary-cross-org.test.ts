/**
 * Task #1037 — regression coverage for the SUPER_ADMIN cross-org roll-up on
 * `GET /api/crm/calls/transcripts/backfill` (added by Task #1019). The
 * existing `crm-transcript-backfill-retry.test.ts` only covers the retry
 * endpoint, leaving the summary endpoint's cross-org behavior untested.
 *
 * The endpoint intentionally treats SUPER_ADMINs and org-scoped admins
 * differently:
 *
 *   * Org-scoped ADMIN: hard-locked to their own org. The pending count and
 *     `activeJob` only ever reflect their own organization, even when a
 *     hostile request supplies `?organizationId=<other-org>`. The cross-org
 *     fields (`crossOrg`, `runningJobs`) must never appear in their
 *     response.
 *   * SUPER_ADMIN with no `organizationId`: cross-org roll-up. `pending`
 *     sums every org's missing transcripts, `crossOrg` is `true`,
 *     `activeJob` is `null` (the UI uses `runningJobs` instead so it
 *     doesn't pin its single-job poller to one tenant), and `runningJobs`
 *     contains every currently-running job tagged with its organization.
 *   * SUPER_ADMIN with `?organizationId=<id>`: scoped to that single org,
 *     identical shape to the org-scoped admin path except `crossOrg`
 *     stays present and is `false` plus `scopedOrganizationId` echoes the
 *     selected id.
 *
 * A regression that re-binds the pending count to the caller's own org for
 * super admins (or that hides cross-org running jobs) would slip through
 * silently without these assertions.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { Express, NextFunction, Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmCalls,
  crmCallRecordings,
  crmTranscriptBackfillJobs,
} from "@shared/schema";
import type { AuthRequest } from "../auth";

// Importing crmCallsRoutes pulls in the whisper service transitively. The
// summary endpoint never invokes it, but stubbing keeps the suite hermetic
// and matches the convention used by the other backfill suites.
vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(),
  queueCallTranscription: vi.fn(),
}));

const TEST_PREFIX = "__crm_backfill_summary_xorg__";

let routes: typeof import("../crmCallsRoutes");
let app: Express;

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

// One running job per org so we can spot-check cross-org membership and
// the org-scoped case independently.
let runningJobAId: string;
let runningJobBId: string;
let runningJobCId: string;

async function cleanupTestData() {
  // Delete jobs first so the FK to organizations doesn't block the org delete.
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  // Recordings → calls → users → organizations.
  await db.delete(crmCallRecordings).where(
    sql`${crmCallRecordings.callId} IN (
      SELECT ${crmCalls.id} FROM ${crmCalls}
      WHERE ${crmCalls.organizationId} IN (
        SELECT ${organizations.id} FROM ${organizations}
        WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
      )
    )`,
  );
  await db.delete(crmCalls).where(
    sql`${crmCalls.organizationId} IN (
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

async function seedPendingRecording(orgId: string, createdBy: string): Promise<void> {
  const [call] = await db
    .insert(crmCalls)
    .values({
      organizationId: orgId,
      direction: "OUTBOUND",
      durationSeconds: 60,
      createdById: createdBy,
    })
    .returning();
  await db.insert(crmCallRecordings).values({
    callId: call.id,
    recordingUrl: `https://example.invalid/${Math.random().toString(36).slice(2)}.mp3`,
    durationSeconds: 30,
    transcript: null,
    transcriptStatus: "PENDING",
  });
}

async function seedRunningJob(
  organizationId: string,
  startedById: string,
  label: string,
): Promise<string> {
  const id = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  await db.insert(crmTranscriptBackfillJobs).values({
    id,
    organizationId,
    status: "RUNNING",
    total: 10,
    processed: 1,
    succeeded: 1,
    failed: 0,
    errors: [],
    failedRecordingIds: [],
    startedById,
    startedAt: now,
    // Fresh heartbeat so the reaper inside the route doesn't mark the job
    // FAILED before we inspect the response.
    heartbeatAt: now,
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

  orgAId = await makeOrg("orgA");
  orgBId = await makeOrg("orgB");
  orgCId = await makeOrg("orgC");

  adminAId = await makeUser("adminA", "ADMIN", orgAId);
  adminBId = await makeUser("adminB", "ADMIN", orgBId);
  superAdminId = await makeUser("super", "SUPER_ADMIN", null);

  // Distinct pending counts per org so we can prove the SUPER_ADMIN sum is
  // a true cross-org roll-up rather than any single org's number.
  // orgA → 1, orgB → 2, orgC → 3 (sum = 6).
  await seedPendingRecording(orgAId, adminAId);
  await seedPendingRecording(orgBId, adminBId);
  await seedPendingRecording(orgBId, adminBId);
  await seedPendingRecording(orgCId, adminAId);
  await seedPendingRecording(orgCId, adminAId);
  await seedPendingRecording(orgCId, adminAId);

  runningJobAId = await seedRunningJob(orgAId, adminAId, "runA");
  runningJobBId = await seedRunningJob(orgBId, adminBId, "runB");
  runningJobCId = await seedRunningJob(orgCId, adminAId, "runC");
});

describe("transcript backfill summary — cross-org access (Task #1037)", () => {
  it("returns a platform-wide pending count and running jobs from every org for SUPER_ADMIN by default", async () => {
    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };

    const res = await request(app).get("/api/crm/calls/transcripts/backfill");
    expect(res.status).toBe(200);
    // Sum of every seeded org's pending recordings, not any single org.
    expect(res.body.pending).toBe(6);
    expect(res.body.crossOrg).toBe(true);
    expect(res.body.scopedOrganizationId).toBeNull();
    // The cross-org branch leaves activeJob null on purpose so the UI
    // doesn't pin its single-job poller to one tenant.
    expect(res.body.activeJob).toBeNull();

    const runningJobs = res.body.runningJobs as Array<{
      id: string;
      status: string;
      organization: { id: string; name: string | null; slug: string | null };
    }>;
    expect(Array.isArray(runningJobs)).toBe(true);

    // Filter to the jobs this test seeded so we aren't sensitive to other
    // suites' RUNNING fixtures (the suite cleans up its own rows but
    // parallel test runs in CI could leave unrelated rows behind).
    const seededJobs = runningJobs.filter((j) =>
      [runningJobAId, runningJobBId, runningJobCId].includes(j.id),
    );
    expect(seededJobs).toHaveLength(3);
    for (const j of seededJobs) {
      expect(j.status).toBe("RUNNING");
    }

    const orgIds = new Set(seededJobs.map((j) => j.organization.id));
    expect(orgIds).toEqual(new Set([orgAId, orgBId, orgCId]));

    const orgNames = new Set(
      seededJobs.map((j) => j.organization.name).filter(Boolean) as string[],
    );
    expect(orgNames).toEqual(
      new Set([
        `${TEST_PREFIX}orgA`,
        `${TEST_PREFIX}orgB`,
        `${TEST_PREFIX}orgC`,
      ]),
    );
  });

  it("scopes pending count and active job to one org when SUPER_ADMIN passes ?organizationId=", async () => {
    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };

    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill")
      .query({ organizationId: orgCId });
    expect(res.status).toBe(200);
    // Only orgC's pending recordings (3), not the platform sum (6).
    expect(res.body.pending).toBe(3);
    expect(res.body.crossOrg).toBe(false);
    expect(res.body.scopedOrganizationId).toBe(orgCId);
    // The single-org branch returns runningJobs as undefined (only set
    // when crossOrg is true) and surfaces the running job for that org via
    // activeJob instead.
    expect(res.body.runningJobs).toBeUndefined();
    expect(res.body.activeJob).not.toBeNull();
    expect(res.body.activeJob.id).toBe(runningJobCId);
    expect(res.body.activeJob.status).toBe("RUNNING");
  });

  it("hard-locks org-scoped ADMINs to their own org regardless of any organizationId query", async () => {
    currentUser = { id: adminAId, role: "ADMIN", organizationId: orgAId };

    // Bare request: only orgA's numbers.
    const ownRes = await request(app).get("/api/crm/calls/transcripts/backfill");
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.pending).toBe(1);
    expect(ownRes.body.activeJob).not.toBeNull();
    expect(ownRes.body.activeJob.id).toBe(runningJobAId);
    // Cross-org fields must not leak into an org-scoped admin's response.
    expect(ownRes.body.crossOrg).toBeUndefined();
    expect(ownRes.body.scopedOrganizationId).toBeUndefined();
    expect(ownRes.body.runningJobs).toBeUndefined();

    // Hostile request: explicitly ask for orgB. Must still only see orgA's
    // pending count and running job — the orgId param is a no-op for
    // org-scoped admins.
    const spoofRes = await request(app)
      .get("/api/crm/calls/transcripts/backfill")
      .query({ organizationId: orgBId });
    expect(spoofRes.status).toBe(200);
    expect(spoofRes.body.pending).toBe(1);
    expect(spoofRes.body.activeJob).not.toBeNull();
    expect(spoofRes.body.activeJob.id).toBe(runningJobAId);
    expect(spoofRes.body.crossOrg).toBeUndefined();
    expect(spoofRes.body.runningJobs).toBeUndefined();
  });
});
