/**
 * Task #1058 — server-side coverage for the cross-tenant start / cancel code
 * paths added in Task #1036:
 *
 *   * `POST /api/crm/calls/transcripts/backfill` honors `body.organizationId`
 *     for SUPER_ADMINs and silently ignores it for org-scoped ADMINs.
 *   * `POST /api/crm/calls/transcripts/backfill/:jobId/cancel`
 *       - SUPER_ADMINs can cancel a job in any tenant (live worker → FAILED,
 *         stale heartbeat → reaped directly to FAILED with `reaped: true`).
 *       - Org-scoped ADMINs get 404 trying to cancel another tenant's job.
 *
 * The two new code paths had no automated coverage prior to this suite, so
 * a regression in the org-scope guard could let a super admin start a
 * backfill in the wrong tenant or let an org-scoped admin escape their own
 * org via the cancel endpoint. These tests pin both contracts.
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

// The start endpoint kicks off a background worker that transcribes
// recordings; stub it so the suite stays fast and offline. We also need
// to be able to flip the cancellation flag mid-recording for the "live
// worker → FAILED" scenario, which is wired up below via vi.fn().mockImplementation.
const transcribeMock = vi.fn(async (_recordingId: string) => ({
  ok: true as const,
  transcript: "stub",
}));
vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: (id: string) => transcribeMock(id),
  queueCallTranscription: vi.fn(),
}));

// Run-completion notifications hit Slack/email; stub them out so tests
// are deterministic and offline. Notification config + test-alert helpers
// must still import-clean even though we don't exercise them here.
vi.mock("../services/transcriptBackfillNotifications", () => ({
  notifyBackfillCompletion: vi.fn(async () => undefined),
  getBackfillNotificationConfig: vi.fn(async () => ({
    slack: { configured: false, valid: false, source: "env" },
    email: { configured: false, recipients: [], source: "env" },
  })),
  sendTestBackfillAlert: vi.fn(async () => ({
    operatorDisplay: null,
    slack: { configured: false, ok: false },
    email: { configured: false, ok: false, recipients: [] },
  })),
  resolveBackfillNotificationDestinations: vi.fn(async () => ({
    slackWebhookUrl: null,
    emailRecipients: [],
  })),
}));

const TEST_PREFIX = "__crm_backfill_start_cancel_xorg__";

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
let adminAId: string;
let adminBId: string;
let superAdminId: string;

async function cleanupTestData() {
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
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

async function makeRecording(orgId: string, createdById: string): Promise<string> {
  const [call] = await db
    .insert(crmCalls)
    .values({
      organizationId: orgId,
      direction: "OUTBOUND",
      durationSeconds: 60,
      createdById,
    })
    .returning();
  const [rec] = await db
    .insert(crmCallRecordings)
    .values({
      callId: call.id,
      recordingUrl: `https://example.invalid/${Math.random().toString(36).slice(2)}.mp3`,
      durationSeconds: 30,
      transcript: null,
      transcriptStatus: "PENDING",
    })
    .returning();
  return rec.id;
}

async function seedRunningJob(
  orgId: string,
  startedById: string,
  opts: { heartbeatAt?: Date; id?: string } = {},
): Promise<string> {
  const id =
    opts.id ?? `${TEST_PREFIX}job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(crmTranscriptBackfillJobs).values({
    id,
    organizationId: orgId,
    status: "RUNNING",
    total: 1,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    failedRecordingIds: [],
    startedById,
    startedAt: new Date(),
    heartbeatAt: opts.heartbeatAt ?? new Date(),
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
  routes.__resetBackfillCancelRequestsForTests();
  transcribeMock.mockReset();
  transcribeMock.mockImplementation(async () => ({ ok: true as const, transcript: "stub" }));
  currentUser = null;

  orgAId = await makeOrg("orgA");
  orgBId = await makeOrg("orgB");
  adminAId = await makeUser("adminA", "ADMIN", orgAId);
  adminBId = await makeUser("adminB", "ADMIN", orgBId);
  superAdminId = await makeUser("super", "SUPER_ADMIN", null);
});

describe("POST /api/crm/calls/transcripts/backfill — cross-tenant start (Task #1036)", () => {
  it("lets a SUPER_ADMIN start a backfill in another tenant via body.organizationId", async () => {
    // Seed an eligible recording in org B so the start endpoint has work
    // to enqueue against the targeted tenant.
    await makeRecording(orgBId, adminBId);

    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };
    const res = await request(app)
      .post("/api/crm/calls/transcripts/backfill")
      .send({ organizationId: orgBId, maxRecords: 1, concurrency: 1 });

    expect(res.status).toBe(202);
    expect(typeof res.body.jobId).toBe("string");

    // The persisted job must belong to org B (the targeted tenant), not to
    // the SUPER_ADMIN's null/own org.
    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, res.body.jobId));
    expect(row).toBeDefined();
    expect(row.organizationId).toBe(orgBId);
    expect(row.startedById).toBe(superAdminId);
  });

  it("ignores body.organizationId for an org-scoped ADMIN and stays in their own org", async () => {
    // Seed eligibility in BOTH orgs. If the guard regresses and honors
    // body.organizationId for org-scoped admins, the persisted job would
    // land in org B; the assertion below would catch it.
    await makeRecording(orgAId, adminAId);
    await makeRecording(orgBId, adminBId);

    currentUser = { id: adminAId, role: "ADMIN", organizationId: orgAId };
    const res = await request(app)
      .post("/api/crm/calls/transcripts/backfill")
      .send({ organizationId: orgBId, maxRecords: 1, concurrency: 1 });

    expect(res.status).toBe(202);
    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, res.body.jobId));
    expect(row).toBeDefined();
    expect(row.organizationId).toBe(orgAId); // NOT orgBId
    expect(row.startedById).toBe(adminAId);
  });
});

describe("POST /api/crm/calls/transcripts/backfill/:jobId/cancel — cross-tenant guard (Task #1036)", () => {
  it("lets a SUPER_ADMIN cancel a RUNNING job in another tenant", async () => {
    const jobId = await seedRunningJob(orgBId, adminBId);

    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };
    const res = await request(app).post(
      `/api/crm/calls/transcripts/backfill/${jobId}/cancel`,
    );

    // Worker is "alive" (fresh heartbeat) so the endpoint signals
    // cooperative cancellation and returns 202 / CANCELLING.
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      jobId,
      status: "CANCELLING",
      reaped: false,
    });
  });

  it("returns 404 when an org-scoped ADMIN tries to cancel another tenant's job", async () => {
    const jobId = await seedRunningJob(orgBId, adminBId);

    currentUser = { id: adminAId, role: "ADMIN", organizationId: orgAId };
    const res = await request(app).post(
      `/api/crm/calls/transcripts/backfill/${jobId}/cancel`,
    );

    expect(res.status).toBe(404);

    // The job row must remain RUNNING — the cancel attempt should not
    // mutate state cross-org even on the failure path.
    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, jobId));
    expect(row.status).toBe("RUNNING");
  });

  it("reaps a stale-heartbeat job directly to FAILED with reaped:true", async () => {
    // Heartbeat older than BACKFILL_HEARTBEAT_STALE_MS (5 min) — the
    // worker is presumed dead so cancel marks the row FAILED directly
    // instead of waiting for a non-existent worker to cooperate.
    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000);
    const jobId = await seedRunningJob(orgBId, adminBId, {
      heartbeatAt: staleHeartbeat,
    });

    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };
    const res = await request(app).post(
      `/api/crm/calls/transcripts/backfill/${jobId}/cancel`,
    );

    expect(res.status).toBe(200);
    expect(res.body.reaped).toBe(true);
    expect(res.body.status).toBe("FAILED");

    const [row] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, jobId));
    expect(row.status).toBe("FAILED");
    expect(row.completedAt).not.toBeNull();
  });

  it(
    "flips a live worker to FAILED when cancellation is requested mid-run",
    async () => {
      // Drive the actual worker so we can prove the cooperative cancel
      // path transitions the persisted row to FAILED. We enqueue several
      // recordings; the mock requests cancellation after the first one
      // completes, so the worker exits at the next iteration check.
      const recordingIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        recordingIds.push(await makeRecording(orgBId, adminBId));
      }

      const jobId = `${TEST_PREFIX}live-${Date.now()}`;
      const [parentRow] = await db
        .insert(crmTranscriptBackfillJobs)
        .values({
          id: jobId,
          organizationId: orgBId,
          status: "RUNNING",
          total: recordingIds.length,
          processed: 0,
          succeeded: 0,
          failed: 0,
          errors: [],
          failedRecordingIds: [],
          startedById: superAdminId,
        })
        .returning();

      transcribeMock.mockImplementation(async (recordingId: string) => {
        // Signal cancellation as soon as the first recording is processed.
        // The worker checks the cancel set before pulling the next id, so
        // the run terminates with status === FAILED once this batch drains.
        routes.__requestBackfillCancelForTests(jobId);
        return { ok: true as const, transcript: `stub-${recordingId}` };
      });

      const job = routes.__rowToBackfillStateForTests(parentRow);
      await routes.__runTranscriptBackfillForTests(
        job,
        recordingIds,
        1,
        recordingIds.length,
      );

      const [persisted] = await db
        .select()
        .from(crmTranscriptBackfillJobs)
        .where(eq(crmTranscriptBackfillJobs.id, jobId));

      expect(persisted.status).toBe("FAILED");
      // The cancel landed before all recordings were processed, so the
      // run is partial — proves we stopped early rather than draining.
      expect(persisted.processed).toBeLessThan(recordingIds.length);
      expect(persisted.completedAt).not.toBeNull();
    },
    30_000,
  );
});
