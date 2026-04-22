/**
 * Task #1014 — end-to-end coverage for the large-scale (>50 failure) retry
 * flow that Task #1003 added when it switched the retry endpoint over to the
 * unbounded `failed_recording_ids` jsonb column.
 *
 * Two scenarios are exercised:
 *   1. Large-scale path: drive `runTranscriptBackfill` against an org that has
 *      strictly more than MAX_BACKFILL_ERROR_SAMPLES (50) failing recordings,
 *      then assert that:
 *        * `crm_transcript_backfill_jobs.failed_recording_ids` contains every
 *          failed id (no truncation),
 *        * `crm_transcript_backfill_jobs.errors` is still capped at the
 *          sample limit (regression guard for the cap behavior), and
 *        * POST /api/crm/calls/transcripts/backfill/:jobId/retry creates a
 *          child job whose `total` equals the full failure count, not 50.
 *   2. Legacy fallback: a parent row with empty `failed_recording_ids` but a
 *      populated `errors` sample still drives the retry against the sampled
 *      ids — covers rows persisted before Task #1003 added the column.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { Express, NextFunction, Response } from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmCalls,
  crmCallRecordings,
  crmTranscriptBackfillJobs,
} from "@shared/schema";
import type { AuthRequest } from "../auth";

// Mirror of the constant in crmCallsRoutes.ts. Kept here so a future change
// to the production cap forces a deliberate update of this regression test.
const MAX_BACKFILL_ERROR_SAMPLES = 50;

// Force every recording to "fail" so we can deterministically populate the
// parent job's failed_recording_ids / errors columns. The mock leaves the
// recording row untouched so it stays eligible (transcript NULL, status
// PENDING/FAILED) for the subsequent retry.
vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(async (recordingId: string) => ({
    ok: false as const,
    error: `simulated whisper failure for ${recordingId}`,
  })),
  queueCallTranscription: vi.fn(),
}));

const TEST_PREFIX = "__crm_backfill_retry_test__";

let routes: typeof import("../crmCallsRoutes");
let app: Express;

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
      lastName: "Admin",
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

beforeAll(async () => {
  routes = await import("../crmCallsRoutes");

  const express = await import("express");
  app = express.default();
  app.use(express.default.json());

  // Inject a fake authenticated user before the router runs so the
  // requireAuth / requireRole("ADMIN") middlewares accept the request. The
  // middleware reads `req.user`, and `resolveOrg` reads
  // `req.user.organizationId`, so providing both is enough.
  app.use((req: AuthRequest, _res: Response, next: NextFunction) => {
    req.user = {
      id: userId,
      email: "irrelevant@test.invalid",
      firstName: "Test",
      lastName: "Admin",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    } as AuthRequest["user"];
    next();
  });
  app.use(routes.default);
});

afterAll(async () => {
  await cleanupTestData();
});

beforeEach(async () => {
  await cleanupTestData();
  const seed = await makeOrgAndUser("seed");
  orgId = seed.orgId;
  userId = seed.userId;
  callId = await makeCall(orgId, userId);
});

describe("transcript backfill retry — large-scale failure coverage (Task #1014)", () => {
  it(
    "persists every failed recording id past the sample cap and retries them all",
    async () => {
      // Seed strictly more than MAX_BACKFILL_ERROR_SAMPLES recordings so the
      // sample-cap branch in `runTranscriptBackfill` is exercised. 60 keeps
      // the test fast while still being comfortably above 50.
      const FAILURE_COUNT = MAX_BACKFILL_ERROR_SAMPLES + 10;
      const recordingIds: string[] = [];
      for (let i = 0; i < FAILURE_COUNT; i++) {
        recordingIds.push(await makeRecording(callId));
      }

      // Create the parent backfill job row directly so we don't have to
      // round-trip through the POST endpoint (which would paginate forever
      // because every recording stays PENDING after the mocked failure).
      const parentJobId = `parent-backfill-${Date.now()}`;
      const [parentRow] = await db
        .insert(crmTranscriptBackfillJobs)
        .values({
          id: parentJobId,
          organizationId: orgId,
          status: "RUNNING",
          total: FAILURE_COUNT,
          processed: 0,
          succeeded: 0,
          failed: 0,
          errors: [],
          failedRecordingIds: [],
          startedById: userId,
        })
        .returning();

      const job = routes.__rowToBackfillStateForTests(parentRow);
      // Cap at exactly the failure count so the worker stops after one pass
      // instead of paginating into other PENDING rows in the org (none here,
      // but this matches what the POST endpoint does with maxRecords).
      await routes.__runTranscriptBackfillForTests(job, recordingIds, 2, FAILURE_COUNT);

      const [persistedParent] = await db
        .select()
        .from(crmTranscriptBackfillJobs)
        .where(eq(crmTranscriptBackfillJobs.id, parentJobId));
      expect(persistedParent.status).toBe("COMPLETED");
      expect(persistedParent.processed).toBe(FAILURE_COUNT);
      expect(persistedParent.failed).toBe(FAILURE_COUNT);
      expect(persistedParent.succeeded).toBe(0);

      // The unbounded column captured every failure …
      const persistedFailedIds = (persistedParent.failedRecordingIds ?? []) as string[];
      expect(persistedFailedIds).toHaveLength(FAILURE_COUNT);
      expect(new Set(persistedFailedIds)).toEqual(new Set(recordingIds));

      // … while the legacy `errors` sample is still capped (regression guard
      // for Task #1003's cap behavior).
      const persistedErrors =
        (persistedParent.errors ?? []) as Array<{ recordingId: string; error: string }>;
      expect(persistedErrors).toHaveLength(MAX_BACKFILL_ERROR_SAMPLES);
      // Every sampled id must also appear in the unbounded column.
      for (const sample of persistedErrors) {
        expect(persistedFailedIds).toContain(sample.recordingId);
      }

      // Hit the actual retry endpoint and assert the child job covers every
      // failure, not just the bounded sample.
      const retryRes = await request(app)
        .post(`/api/crm/calls/transcripts/backfill/${parentJobId}/retry`)
        .send({ concurrency: 2 });

      expect(retryRes.status).toBe(202);
      expect(retryRes.body.parentJobId).toBe(parentJobId);
      expect(retryRes.body.total).toBe(FAILURE_COUNT);
      expect(typeof retryRes.body.jobId).toBe("string");

      const childJobId = retryRes.body.jobId as string;
      const [childRow] = await db
        .select()
        .from(crmTranscriptBackfillJobs)
        .where(eq(crmTranscriptBackfillJobs.id, childJobId));
      expect(childRow).toBeDefined();
      expect(childRow.parentJobId).toBe(parentJobId);
      // Critical assertion: the child total reflects every failed recording,
      // not the 50-row sample cap. A regression that re-bound the retry to
      // the `errors` sample would land here as childRow.total === 50.
      expect(childRow.total).toBe(FAILURE_COUNT);
      expect(childRow.total).toBeGreaterThan(MAX_BACKFILL_ERROR_SAMPLES);
    },
    60_000,
  );

  it(
    "falls back to the legacy `errors` sample when failed_recording_ids is empty",
    async () => {
      // Simulates a parent row persisted before Task #1003 added the
      // unbounded column: failed_recording_ids is empty but `errors` carries
      // the (sampled) failed ids. The retry endpoint must still queue every
      // sampled id by union-merging the two sources.
      const SAMPLE_COUNT = 5;
      const sampledIds: string[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        sampledIds.push(await makeRecording(callId));
      }

      const legacyParentId = `legacy-parent-${Date.now()}`;
      await db.insert(crmTranscriptBackfillJobs).values({
        id: legacyParentId,
        organizationId: orgId,
        status: "FAILED",
        total: SAMPLE_COUNT,
        processed: SAMPLE_COUNT,
        succeeded: 0,
        failed: SAMPLE_COUNT,
        errors: sampledIds.map((recordingId) => ({
          recordingId,
          error: "legacy whisper failure",
        })),
        failedRecordingIds: [],
        startedById: userId,
        completedAt: new Date(),
      });

      const retryRes = await request(app)
        .post(`/api/crm/calls/transcripts/backfill/${legacyParentId}/retry`)
        .send({ concurrency: 1 });

      expect(retryRes.status).toBe(202);
      expect(retryRes.body.parentJobId).toBe(legacyParentId);
      expect(retryRes.body.total).toBe(SAMPLE_COUNT);

      const childJobId = retryRes.body.jobId as string;
      const [childRow] = await db
        .select()
        .from(crmTranscriptBackfillJobs)
        .where(eq(crmTranscriptBackfillJobs.id, childJobId));
      expect(childRow).toBeDefined();
      expect(childRow.parentJobId).toBe(legacyParentId);
      expect(childRow.total).toBe(SAMPLE_COUNT);
    },
    30_000,
  );
});
