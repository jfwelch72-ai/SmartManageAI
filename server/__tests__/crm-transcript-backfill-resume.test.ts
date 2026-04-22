/**
 * Task #994 — regression tests for the boot-time resume-or-reap logic that
 * Task #987 added for CRM transcript backfill jobs.
 *
 * Covers the three branches of `resumeOrReapBackfillJobsOnBoot`:
 *   1. Fresh heartbeat → no-op (the job is left alone, presumed owned by
 *      another live instance).
 *   2. Stale heartbeat + recent startedAt → resumed with the original id,
 *      startedAt, startedById, and counters preserved.
 *   3. Stale heartbeat + startedAt older than the max-resumable age → reaped
 *      to FAILED so the per-org guard doesn't block forever.
 *
 * Also verifies the idempotency contract that the resume path relies on:
 * `fetchEligibleRecordingBatch` only returns recordings whose transcript is
 * still NULL with status PENDING or FAILED.
 */

// Boot recovery is no longer auto-fired at module-import time (Task #993
// moved it into server/index.ts after migrations). The tests below drive
// resumeOrReapBackfillJobsOnBoot explicitly and reset the once-per-process
// guard between scenarios via the test-only helper exported below.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmCalls,
  crmCallRecordings,
  crmTranscriptBackfillJobs,
} from "@shared/schema";

// Stub the Whisper-backed transcription service before importing the routes
// module so the worker that resumeOrReapBackfillJobsOnBoot may launch can
// "process" recordings without making network calls or touching object
// storage. The mock immediately reports success, which flips the recording
// status out of PENDING/FAILED so the resumed worker doesn't loop.
vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(async (recordingId: string) => {
    await db
      .update(crmCallRecordings)
      .set({
        transcript: "stub transcript",
        transcriptStatus: "COMPLETED",
        transcribedAt: new Date(),
      })
      .where(eq(crmCallRecordings.id, recordingId));
    return { ok: true as const };
  }),
  queueCallTranscription: vi.fn(),
}));

// Constants mirrored from crmCallsRoutes.ts; if they change there, tweak
// these too.
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const MAX_RESUMABLE_AGE_MS = 24 * 60 * 60 * 1000;

const TEST_PREFIX = "__crm_backfill_resume_test__";

let routes: typeof import("../crmCallsRoutes");

let orgId: string;
let userId: string;
let callId: string;

async function cleanupTestData() {
  // Delete jobs and recordings/calls/users/orgs created by this suite.
  // CASCADE on org → calls → recordings → backfill jobs, but we delete the
  // jobs separately because they only cascade when the org is dropped.
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(organizations).where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
}

async function makeOrgAndUser(label: string) {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}${label}`, slug })
    .returning();
  const [u] = await db
    .insert(users)
    .values({
      email: `${TEST_PREFIX}${label}-${Date.now()}@test.invalid`,
      passwordHash: "x",
      firstName: "Test",
      lastName: "User",
      organizationId: org.id,
      role: "ADMIN",
    })
    .returning();
  return { orgId: org.id, userId: u.id };
}

async function makeCall(orgIdLocal: string, createdBy: string) {
  const [call] = await db
    .insert(crmCalls)
    .values({
      organizationId: orgIdLocal,
      direction: "OUTBOUND",
      durationSeconds: 60,
      createdById: createdBy,
    })
    .returning();
  return call.id;
}

async function makeRecording(opts: {
  callIdLocal: string;
  status?: string;
  transcript?: string | null;
}) {
  const [rec] = await db
    .insert(crmCallRecordings)
    .values({
      callId: opts.callIdLocal,
      recordingUrl: `https://example.invalid/${Math.random().toString(36).slice(2)}.mp3`,
      durationSeconds: 30,
      transcript: opts.transcript ?? null,
      transcriptStatus: opts.status ?? "PENDING",
    })
    .returning();
  return rec.id;
}

async function insertJob(opts: {
  id: string;
  orgIdLocal: string;
  startedById: string;
  startedAt: Date;
  heartbeatAt: Date;
  total?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
}) {
  await db.insert(crmTranscriptBackfillJobs).values({
    id: opts.id,
    organizationId: opts.orgIdLocal,
    status: "RUNNING",
    total: opts.total ?? 5,
    processed: opts.processed ?? 2,
    succeeded: opts.succeeded ?? 2,
    failed: opts.failed ?? 0,
    errors: [],
    startedById: opts.startedById,
    startedAt: opts.startedAt,
    heartbeatAt: opts.heartbeatAt,
  });
}

beforeAll(async () => {
  routes = await import("../crmCallsRoutes");
});

beforeEach(async () => {
  await cleanupTestData();
  routes.__resetBackfillBootRecoveryStartedForTests();
  const seed = await makeOrgAndUser("seed");
  orgId = seed.orgId;
  userId = seed.userId;
  callId = await makeCall(orgId, userId);
});

afterAll(async () => {
  await cleanupTestData();
});

describe("resumeOrReapBackfillJobsOnBoot", () => {
  it("leaves jobs with a fresh heartbeat alone (no-op branch)", async () => {
    const jobId = `job-fresh-${Date.now()}`;
    const startedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const heartbeatAt = new Date(Date.now() - 30 * 1000); // 30s ago — fresh
    await insertJob({
      id: jobId,
      orgIdLocal: orgId,
      startedById: userId,
      startedAt,
      heartbeatAt,
      total: 10,
      processed: 4,
      succeeded: 4,
    });

    await routes.resumeOrReapBackfillJobsOnBoot();

    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, jobId));
    expect(row).toBeDefined();
    expect(row.status).toBe("RUNNING");
    // Heartbeat must NOT have been bumped: the job was left alone.
    expect(row.heartbeatAt.getTime()).toBe(heartbeatAt.getTime());
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
    expect(row.processed).toBe(4);
    expect(row.completedAt).toBeNull();
  });

  it("reaps zombie jobs whose startedAt exceeds the max resumable age", async () => {
    const jobId = `job-reap-${Date.now()}`;
    const startedAt = new Date(Date.now() - (MAX_RESUMABLE_AGE_MS + 60 * 60 * 1000));
    const heartbeatAt = new Date(Date.now() - (HEARTBEAT_STALE_MS + 60 * 1000));
    await insertJob({
      id: jobId,
      orgIdLocal: orgId,
      startedById: userId,
      startedAt,
      heartbeatAt,
      total: 50,
      processed: 12,
      succeeded: 10,
      failed: 2,
    });

    await routes.resumeOrReapBackfillJobsOnBoot();

    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, jobId));
    expect(row.status).toBe("FAILED");
    expect(row.completedAt).not.toBeNull();
    // The reap path doesn't touch counters — admins still see what got done.
    expect(row.processed).toBe(12);
    expect(row.succeeded).toBe(10);
    expect(row.failed).toBe(2);
  });

  it("resumes interrupted jobs while preserving id, startedAt, startedById and counters", async () => {
    // Make some recordings the resumed worker can pick up so the resume path
    // exercises the runTranscriptBackfill launch (mocked transcribe).
    await makeRecording({ callIdLocal: callId, status: "PENDING" });
    await makeRecording({ callIdLocal: callId, status: "FAILED" });

    const jobId = `job-resume-${Date.now()}`;
    const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago — well under max
    const heartbeatAt = new Date(Date.now() - (HEARTBEAT_STALE_MS + 60 * 1000));
    await insertJob({
      id: jobId,
      orgIdLocal: orgId,
      startedById: userId,
      startedAt,
      heartbeatAt,
      total: 10,
      processed: 3,
      succeeded: 3,
      failed: 0,
    });

    await routes.resumeOrReapBackfillJobsOnBoot();

    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, jobId));
    expect(row).toBeDefined();
    // id and startedAt/startedById are preserved so the admin sees a single
    // continuous progress bar.
    expect(row.id).toBe(jobId);
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
    expect(row.startedById).toBe(userId);
    // Counters monotonically advance — they must never drop below the
    // pre-resume snapshot.
    expect(row.processed).toBeGreaterThanOrEqual(3);
    expect(row.succeeded).toBeGreaterThanOrEqual(3);
    // Heartbeat was bumped so a concurrent boot of another instance won't
    // try to resume the same job in parallel.
    expect(row.heartbeatAt.getTime()).toBeGreaterThan(heartbeatAt.getTime());
  });

  it("closes out resumed jobs with no remaining eligible recordings", async () => {
    // No PENDING/FAILED recordings created — the resumed worker has nothing
    // to do and should mark the job COMPLETED instead of leaving it RUNNING.
    const jobId = `job-resume-empty-${Date.now()}`;
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    const heartbeatAt = new Date(Date.now() - (HEARTBEAT_STALE_MS + 60 * 1000));
    await insertJob({
      id: jobId,
      orgIdLocal: orgId,
      startedById: userId,
      startedAt,
      heartbeatAt,
      total: 5,
      processed: 5,
      succeeded: 5,
    });

    await routes.resumeOrReapBackfillJobsOnBoot();

    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, jobId));
    expect(row.status).toBe("COMPLETED");
    expect(row.completedAt).not.toBeNull();
    expect(row.id).toBe(jobId);
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
  });
});

describe("fetchEligibleRecordingBatch (resume idempotency contract)", () => {
  it("only returns recordings whose transcript is NULL with status PENDING or FAILED", async () => {
    const pendingId = await makeRecording({ callIdLocal: callId, status: "PENDING" });
    const failedId = await makeRecording({ callIdLocal: callId, status: "FAILED" });
    // Already-transcribed recordings must not be re-queued even if the
    // status string somehow still reads PENDING — the NULL transcript guard
    // is the canonical check.
    await makeRecording({
      callIdLocal: callId,
      status: "PENDING",
      transcript: "already done",
    });
    await makeRecording({ callIdLocal: callId, status: "COMPLETED" });
    await makeRecording({ callIdLocal: callId, status: "IN_PROGRESS" });

    const batch = await routes.fetchEligibleRecordingBatch(orgId, new Set(), 100);
    const sorted = [...batch].sort();
    const expected = [pendingId, failedId].sort();
    expect(sorted).toEqual(expected);
  });

  it("respects the excludeIds set so resumed runs don't reprocess in-flight recordings", async () => {
    const a = await makeRecording({ callIdLocal: callId, status: "PENDING" });
    const b = await makeRecording({ callIdLocal: callId, status: "FAILED" });

    const batch = await routes.fetchEligibleRecordingBatch(
      orgId,
      new Set([a]),
      100,
    );
    expect(batch).toEqual([b]);
  });

  it("scopes results to the requesting org", async () => {
    const other = await makeOrgAndUser("other");
    const otherCall = await makeCall(other.orgId, other.userId);
    await makeRecording({ callIdLocal: otherCall, status: "PENDING" });
    const mine = await makeRecording({ callIdLocal: callId, status: "PENDING" });

    const batch = await routes.fetchEligibleRecordingBatch(orgId, new Set(), 100);
    expect(batch).toEqual([mine]);
  });
});
