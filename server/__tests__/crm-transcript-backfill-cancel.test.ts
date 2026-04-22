/**
 * Task #1071 — end-to-end coverage for the Cancelled terminal state added in
 * Task #1057. Task #1057 only shipped a unit test for the notification verb;
 * this suite pins the *integration* contract:
 *
 *   1. Live worker path: a backfill is in flight, the cancel endpoint is
 *      hit, and the worker exits with status === "CANCELLED" (not FAILED) so
 *      the badge / history filter / completion notification can render the
 *      dedicated cancelled wording.
 *   2. Stale-worker reap path: the job row's heartbeat is past the stale
 *      threshold (worker is gone), the cancel endpoint reaps the row
 *      directly, and again the persisted status is "CANCELLED".
 *
 * The UI half (active-job badge + history filter) is exercised in the
 * companion Playwright spec at e2e/admin-transcript-backfill-cancel.spec.ts.
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
// Import the resolved threshold from the route module so the stale-reap
// test stays in sync if BACKFILL_HEARTBEAT_STALE_MS env override is set.
import { BACKFILL_HEARTBEAT_STALE_MS as HEARTBEAT_STALE_MS } from "../crmCallsRoutes";

// Stub out the Whisper-backed transcription with a deliberately slow,
// always-succeeding implementation so the live-cancel test has time to
// fire the cancel request mid-flight without racing the worker to the
// last recording.
const transcribeMock = vi.fn(async (recordingId: string) => {
  await new Promise((resolve) => setTimeout(resolve, 80));
  await db
    .update(crmCallRecordings)
    .set({
      transcript: "stub transcript",
      transcriptStatus: "COMPLETED",
      transcribedAt: new Date(),
    })
    .where(eq(crmCallRecordings.id, recordingId));
  return { ok: true as const };
});

vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: (id: string) => transcribeMock(id),
  queueCallTranscription: vi.fn(),
}));

const TEST_PREFIX = "__crm_backfill_cancel_test__";

let routes: typeof import("../crmCallsRoutes");
let app: Express;
let priorEmailTransport: string | undefined;

let orgId: string;
let userId: string;
let callId: string;
// Mutable holder for the supertest middleware so each test's freshly-seeded
// org/user is the one that requireAuth sees (beforeEach reassigns the
// outer orgId/userId, and the middleware below dereferences them on each
// request rather than capturing the values at registration time).
const currentRequester: { userId: string; orgId: string } = {
  userId: "",
  orgId: "",
};

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
  // Pin the email transport to noop so the completion-email side effect
  // (fired from runTranscriptBackfill's finally + the reap branch) never
  // makes a real Resend call during this suite.
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";

  routes = await import("../crmCallsRoutes");

  const express = await import("express");
  app = express.default();
  app.use(express.default.json());

  // Inject a fake authenticated ADMIN before the router runs so the
  // requireAuth / requireRole("ADMIN") middlewares accept the request.
  app.use((req: AuthRequest, _res: Response, next: NextFunction) => {
    req.user = {
      id: currentRequester.userId,
      email: "irrelevant@test.invalid",
      firstName: "Test",
      lastName: "Admin",
      role: "ADMIN",
      organizationId: currentRequester.orgId,
      isActive: true,
    } as AuthRequest["user"];
    next();
  });
  app.use(routes.default);
});

afterAll(async () => {
  await cleanupTestData();
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
});

beforeEach(async () => {
  await cleanupTestData();
  routes.__resetBackfillCancelRequestsForTests();
  transcribeMock.mockClear();
  const seed = await makeOrgAndUser("seed");
  orgId = seed.orgId;
  userId = seed.userId;
  callId = await makeCall(orgId, userId);
  currentRequester.userId = userId;
  currentRequester.orgId = orgId;
});

describe("POST /api/crm/calls/transcripts/backfill/:jobId/cancel", () => {
  it(
    "live worker path: cancel endpoint flips the persisted job to CANCELLED (not FAILED)",
    async () => {
      // Seed enough recordings that the worker can't drain them all before
      // we issue the cancel request. The slow transcribe stub gives ~80ms
      // per recording, so 8 recordings means ~640ms of work — plenty of
      // headroom for the cancel request to land mid-run.
      const recordingIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        recordingIds.push(await makeRecording(callId));
      }

      const jobId = `live-cancel-${Date.now()}`;
      const [parentRow] = await db
        .insert(crmTranscriptBackfillJobs)
        .values({
          id: jobId,
          organizationId: orgId,
          status: "RUNNING",
          total: recordingIds.length,
          processed: 0,
          succeeded: 0,
          failed: 0,
          errors: [],
          failedRecordingIds: [],
          startedById: userId,
          // Fresh heartbeat → the cancel endpoint must take the live path
          // (cooperative signal) rather than the stale-reap shortcut.
          heartbeatAt: new Date(),
        })
        .returning();

      const job = routes.__rowToBackfillStateForTests(parentRow);

      // Kick the worker off in the background, mirroring the production
      // `void runTranscriptBackfill(...)` at the POST endpoint. We retain
      // the promise so the test can deterministically await its terminal
      // exit before asserting on the persisted row.
      const workerPromise = routes.__runTranscriptBackfillForTests(
        job,
        recordingIds,
        1,
        recordingIds.length,
      );

      // Give the worker a moment to start the first transcription so the
      // cancel signal is observed inside the loop, not before it begins.
      await new Promise((resolve) => setTimeout(resolve, 120));

      const cancelRes = await request(app)
        .post(`/api/crm/calls/transcripts/backfill/${jobId}/cancel`)
        .send({});
      expect(cancelRes.status).toBe(202);
      expect(cancelRes.body).toMatchObject({
        jobId,
        status: "CANCELLING",
        reaped: false,
      });

      await workerPromise;

      const [persisted] = await db
        .select()
        .from(crmTranscriptBackfillJobs)
        .where(eq(crmTranscriptBackfillJobs.id, jobId));
      expect(persisted).toBeDefined();
      // Critical assertion: the dedicated CANCELLED status persists. A
      // regression that re-routed the live cancel back through FAILED
      // would land here.
      expect(persisted.status).toBe("CANCELLED");
      expect(persisted.completedAt).not.toBeNull();
      // The worker stops cooperatively, so at least some recordings get
      // processed but strictly fewer than the total (otherwise the cancel
      // arrived after the run already finished naturally and the test
      // isn't exercising the cancellation branch).
      expect(persisted.processed).toBeGreaterThan(0);
      expect(persisted.processed).toBeLessThan(recordingIds.length);
    },
    30_000,
  );

  it(
    "stale-worker path: cancel endpoint reaps the row to CANCELLED when the heartbeat is past the stale threshold",
    async () => {
      // Create a RUNNING row whose heartbeat is older than the stale
      // threshold — the worker is presumed dead (process restart since
      // last heartbeat). The cancel endpoint must mark the row terminal
      // directly with the dedicated CANCELLED status (Task #1057).
      const jobId = `stale-cancel-${Date.now()}`;
      const staleHeartbeat = new Date(Date.now() - (HEARTBEAT_STALE_MS + 60 * 1000));
      await db.insert(crmTranscriptBackfillJobs).values({
        id: jobId,
        organizationId: orgId,
        status: "RUNNING",
        total: 10,
        processed: 4,
        succeeded: 4,
        failed: 0,
        errors: [],
        failedRecordingIds: [],
        startedById: userId,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        heartbeatAt: staleHeartbeat,
      });

      const cancelRes = await request(app)
        .post(`/api/crm/calls/transcripts/backfill/${jobId}/cancel`)
        .send({});
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body).toMatchObject({
        jobId,
        status: "CANCELLED",
        reaped: true,
      });

      const [persisted] = await db
        .select()
        .from(crmTranscriptBackfillJobs)
        .where(eq(crmTranscriptBackfillJobs.id, jobId));
      expect(persisted).toBeDefined();
      expect(persisted.status).toBe("CANCELLED");
      expect(persisted.completedAt).not.toBeNull();
      // The reap branch must not touch counters — admins still see what
      // got done before the worker died.
      expect(persisted.processed).toBe(4);
      expect(persisted.succeeded).toBe(4);
      expect(persisted.failed).toBe(0);
      // The transcription stub must not have been invoked — the row was
      // reaped directly without spinning up a worker.
      expect(transcribeMock).not.toHaveBeenCalled();
    },
    20_000,
  );

  it(
    "rejects cancel on a non-RUNNING job with 409 (idempotency guard)",
    async () => {
      const jobId = `already-cancelled-${Date.now()}`;
      await db.insert(crmTranscriptBackfillJobs).values({
        id: jobId,
        organizationId: orgId,
        status: "CANCELLED",
        total: 5,
        processed: 2,
        succeeded: 2,
        failed: 0,
        errors: [],
        failedRecordingIds: [],
        startedById: userId,
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(Date.now() - 30_000),
      });

      const res = await request(app)
        .post(`/api/crm/calls/transcripts/backfill/${jobId}/cancel`)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.status).toBe("CANCELLED");
    },
    10_000,
  );
});
