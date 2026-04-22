/**
 * Task #1012 — verify that the boot resume path actually honors the
 * persisted `concurrency` and `maxRecords` knobs that Task #992 added to
 * `crm_transcript_backfill_jobs`.
 *
 * Two scenarios:
 *   1. A row started with non-default concurrency/maxRecords (e.g. 4 / 50)
 *      is resumed with EXACTLY those values — not the
 *      `BACKFILL_RESUME_CONCURRENCY` default and not an uncapped run.
 *   2. A legacy row with NULL concurrency/max_records (representing a job
 *      that was created before Task #992 shipped) falls back to
 *      `BACKFILL_RESUME_CONCURRENCY` (= 2) and a null cap, preserving the
 *      pre-#992 behavior.
 *
 * We use the `__setResumeRunTranscriptBackfillForTests` test seam exported
 * by `crmCallsRoutes` to swap in a stub for `runTranscriptBackfill`. That
 * lets us assert on the exact call args without racing the real worker.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmCalls,
  crmCallRecordings,
  crmTranscriptBackfillJobs,
  notifications,
} from "@shared/schema";

// Defensive: same Whisper stub the sibling resume test uses, in case the
// real worker is ever invoked instead of the seam (e.g. a future refactor
// removes the seam without updating this test).
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

// Mirror of the constant in crmCallsRoutes.ts. If you change it there, change
// it here.
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const BACKFILL_RESUME_CONCURRENCY_DEFAULT = 2;

const TEST_PREFIX = "__crm_backfill_knobs_test__";

let routes: typeof import("../crmCallsRoutes");

let orgId: string;
let userId: string;
let callId: string;

async function cleanupTestData() {
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(notifications).where(
    sql`${notifications.userId} IN (
      SELECT ${users.id} FROM ${users}
      WHERE ${users.email} LIKE ${`${TEST_PREFIX}%`}
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

async function makeRecording(callIdLocal: string) {
  const [rec] = await db
    .insert(crmCallRecordings)
    .values({
      callId: callIdLocal,
      recordingUrl: `https://example.invalid/${Math.random().toString(36).slice(2)}.mp3`,
      durationSeconds: 30,
      transcript: null,
      transcriptStatus: "PENDING",
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
  concurrency: number | null;
  maxRecords: number | null;
}) {
  await db.insert(crmTranscriptBackfillJobs).values({
    id: opts.id,
    organizationId: opts.orgIdLocal,
    status: "RUNNING",
    total: 100,
    processed: 10,
    succeeded: 10,
    failed: 0,
    errors: [],
    startedById: opts.startedById,
    startedAt: opts.startedAt,
    heartbeatAt: opts.heartbeatAt,
    concurrency: opts.concurrency,
    maxRecords: opts.maxRecords,
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
  // Make sure the resume path has at least one eligible recording so it
  // reaches the runTranscriptBackfill call (the empty-eligible branch
  // short-circuits to COMPLETED before invoking the worker).
  await makeRecording(callId);
});

afterEach(() => {
  // Restore the real worker between scenarios so a stub from one test never
  // leaks into another.
  routes.__setResumeRunTranscriptBackfillForTests(null);
});

afterAll(async () => {
  await cleanupTestData();
});

describe("resumeOrReapBackfillJobsOnBoot — persisted knobs (Task #1012)", () => {
  it("invokes runTranscriptBackfill with the row's persisted concurrency and maxRecords", async () => {
    const stub = vi.fn(async () => {});
    routes.__setResumeRunTranscriptBackfillForTests(stub);

    const jobId = `job-knobs-${Date.now()}`;
    const startedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago — resumable
    const heartbeatAt = new Date(Date.now() - (HEARTBEAT_STALE_MS + 60 * 1000)); // stale
    await insertJob({
      id: jobId,
      orgIdLocal: orgId,
      startedById: userId,
      startedAt,
      heartbeatAt,
      concurrency: 4,
      maxRecords: 50,
    });

    await routes.resumeOrReapBackfillJobsOnBoot();

    expect(stub).toHaveBeenCalledTimes(1);
    const [jobArg, eligibleArg, concurrencyArg, maxRecordsArg] = stub.mock.calls[0] as [
      { id: string; orgId: string; processed: number; total: number },
      string[],
      number,
      number | null,
    ];
    // Job state passed through must keep the original id and counters so
    // the resumed run continues from where it stopped.
    expect(jobArg.id).toBe(jobId);
    expect(jobArg.orgId).toBe(orgId);
    expect(jobArg.processed).toBe(10);
    expect(jobArg.total).toBe(100);
    expect(Array.isArray(eligibleArg)).toBe(true);
    expect(eligibleArg.length).toBeGreaterThan(0);
    // The two values under test:
    expect(concurrencyArg).toBe(4);
    expect(maxRecordsArg).toBe(50);
  });

  it("falls back to BACKFILL_RESUME_CONCURRENCY and an uncapped run for legacy NULL rows", async () => {
    const stub = vi.fn(async () => {});
    routes.__setResumeRunTranscriptBackfillForTests(stub);

    const jobId = `job-legacy-${Date.now()}`;
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    const heartbeatAt = new Date(Date.now() - (HEARTBEAT_STALE_MS + 60 * 1000));
    await insertJob({
      id: jobId,
      orgIdLocal: orgId,
      startedById: userId,
      startedAt,
      heartbeatAt,
      concurrency: null,
      maxRecords: null,
    });

    // Sanity-check the row really does store NULLs (no DB-side default
    // sneaking in and masking the behavior we're about to assert on).
    const [persisted] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, jobId));
    expect(persisted.concurrency).toBeNull();
    expect(persisted.maxRecords).toBeNull();

    await routes.resumeOrReapBackfillJobsOnBoot();

    expect(stub).toHaveBeenCalledTimes(1);
    const [, , concurrencyArg, maxRecordsArg] = stub.mock.calls[0] as [
      unknown,
      string[],
      number,
      number | null,
    ];
    expect(concurrencyArg).toBe(BACKFILL_RESUME_CONCURRENCY_DEFAULT);
    expect(maxRecordsArg).toBeNull();
  });
});
