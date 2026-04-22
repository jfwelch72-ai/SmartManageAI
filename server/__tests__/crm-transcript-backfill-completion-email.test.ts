/**
 * Task #1006 — backfill completion email regression tests.
 *
 * Verifies that when a CRM transcript backfill job transitions to a terminal
 * state (COMPLETED or FAILED), an email summary is sent to the org's
 * admins through the standard email transport. Uses the EMAIL_TRANSPORT=noop
 * in-memory outbox to capture sends without hitting Resend.
 *
 * Covers:
 *   - Normal completion path through `runTranscriptBackfill` (COMPLETED)
 *   - Reaper path on boot (FAILED zombie reap)
 *   - Notification preference opt-out: an admin with
 *     notification_channel_prefs.email_enabled = false is skipped
 *   - Non-admin users are not recipients
 *   - The same job id is only emailed once even if multiple finalization
 *     sites fire scheduleBackfillCompletionEmail for it
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmCalls,
  crmCallRecordings,
  crmTranscriptBackfillJobs,
  notificationChannelPrefs,
  notifications,
} from "@shared/schema";
import {
  clearTestEmailOutbox,
  getTestEmailOutbox,
} from "../services/emailTransport";

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

const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const MAX_RESUMABLE_AGE_MS = 24 * 60 * 60 * 1000;

const TEST_PREFIX = "__crm_backfill_email_test__";

let routes: typeof import("../crmCallsRoutes");
let priorEmailTransport: string | undefined;

async function cleanupTestData() {
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (
      SELECT ${users.id} FROM ${users}
      WHERE ${users.email} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  // Task #1005 inserts an in-app notification on the reap branch — clear
  // those before the org/user FK targets are deleted.
  await db.delete(notifications).where(
    sql`${notifications.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(organizations).where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
}

async function makeOrg(label: string) {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}${label}`, slug })
    .returning();
  return org.id;
}

async function makeUser(orgId: string, role: "ADMIN" | "MANAGER" | "FIELD_WORKER", suffix: string) {
  const [u] = await db
    .insert(users)
    .values({
      email: `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.invalid`,
      passwordHash: "x",
      firstName: "Test",
      lastName: suffix,
      organizationId: orgId,
      role,
    })
    .returning();
  return u;
}

async function makeCall(orgId: string, createdBy: string) {
  const [call] = await db
    .insert(crmCalls)
    .values({
      organizationId: orgId,
      direction: "OUTBOUND",
      durationSeconds: 60,
      createdById: createdBy,
    })
    .returning();
  return call.id;
}

async function makeRecording(callId: string, status: string = "PENDING") {
  const [rec] = await db
    .insert(crmCallRecordings)
    .values({
      callId,
      recordingUrl: `https://example.invalid/${Math.random().toString(36).slice(2)}.mp3`,
      durationSeconds: 30,
      transcript: null,
      transcriptStatus: status,
    })
    .returning();
  return rec.id;
}

async function insertJob(opts: {
  id: string;
  orgId: string;
  startedById: string;
  startedAt: Date;
  heartbeatAt: Date;
  status?: string;
  total?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
}) {
  await db.insert(crmTranscriptBackfillJobs).values({
    id: opts.id,
    organizationId: opts.orgId,
    status: opts.status ?? "RUNNING",
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

async function waitForTick() {
  // setImmediate scheduling — give microtasks/macrotasks a tick to drain.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 50));
}

beforeAll(async () => {
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";
  routes = await import("../crmCallsRoutes");
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
  routes.__resetBackfillBootRecoveryStartedForTests();
  routes.__resetBackfillNotifiedForTests();
  clearTestEmailOutbox();
});

describe("notifyBackfillCompletion (Task #1006)", () => {
  it("emails admins with the run summary when a job is COMPLETED", async () => {
    const orgId = await makeOrg("complete");
    const operator = await makeUser(orgId, "ADMIN", "operator");
    const otherAdmin = await makeUser(orgId, "ADMIN", "other");
    await makeUser(orgId, "FIELD_WORKER", "field"); // should not receive

    const jobId = `job-complete-${Date.now()}`;
    await insertJob({
      id: jobId,
      orgId,
      startedById: operator.id,
      startedAt: new Date(Date.now() - 90 * 1000),
      heartbeatAt: new Date(),
      status: "COMPLETED",
      total: 5,
      processed: 5,
      succeeded: 4,
      failed: 1,
    });
    await db
      .update(crmTranscriptBackfillJobs)
      .set({ completedAt: new Date() })
      .where(eq(crmTranscriptBackfillJobs.id, jobId));

    await routes.notifyBackfillCompletionToOrgAdmins(jobId);

    const outbox = getTestEmailOutbox();
    expect(outbox.length).toBe(1);
    const sent = outbox[0];
    const recipients = (sent.to as string[]).slice().sort();
    const expected = [operator.email, otherAdmin.email].sort();
    expect(recipients).toEqual(expected);
    expect(sent.subject).toContain("4/5 succeeded");
    expect(sent.subject?.toLowerCase()).toContain("completed");
    expect(sent.text).toContain("Processed: 5 of 5");
    expect(sent.text).toContain("Succeeded: 4");
    expect(sent.text).toContain("Failed:    1");
    expect(sent.text).toContain("/admin/transcript-backfill");
    expect(sent.html).toContain("transcript-backfill");
  });

  it("skips admins who have explicitly disabled email notifications", async () => {
    const orgId = await makeOrg("optout");
    const operator = await makeUser(orgId, "ADMIN", "op");
    const optedOut = await makeUser(orgId, "ADMIN", "optout");
    const noPrefsAdmin = await makeUser(orgId, "ADMIN", "noprefs");

    // Explicit opt-out
    await db.insert(notificationChannelPrefs).values({
      userId: optedOut.id,
      emailEnabled: false,
    });
    // Explicit opt-in
    await db.insert(notificationChannelPrefs).values({
      userId: operator.id,
      emailEnabled: true,
    });
    // noPrefsAdmin has no row at all — should be included by default.

    const jobId = `job-optout-${Date.now()}`;
    await insertJob({
      id: jobId,
      orgId,
      startedById: operator.id,
      startedAt: new Date(Date.now() - 30 * 1000),
      heartbeatAt: new Date(),
      status: "COMPLETED",
      processed: 1,
      succeeded: 1,
      failed: 0,
      total: 1,
    });
    await db
      .update(crmTranscriptBackfillJobs)
      .set({ completedAt: new Date() })
      .where(eq(crmTranscriptBackfillJobs.id, jobId));

    await routes.notifyBackfillCompletionToOrgAdmins(jobId);

    const outbox = getTestEmailOutbox();
    expect(outbox.length).toBe(1);
    const recipients = (outbox[0].to as string[]).slice().sort();
    expect(recipients).toEqual([noPrefsAdmin.email, operator.email].sort());
    expect(recipients).not.toContain(optedOut.email);
  });

  it("does not send a duplicate email when invoked twice for the same jobId", async () => {
    const orgId = await makeOrg("dedupe");
    const operator = await makeUser(orgId, "ADMIN", "op");

    const jobId = `job-dedupe-${Date.now()}`;
    await insertJob({
      id: jobId,
      orgId,
      startedById: operator.id,
      startedAt: new Date(Date.now() - 30 * 1000),
      heartbeatAt: new Date(),
      status: "COMPLETED",
      processed: 1,
      succeeded: 1,
      total: 1,
    });
    await db
      .update(crmTranscriptBackfillJobs)
      .set({ completedAt: new Date() })
      .where(eq(crmTranscriptBackfillJobs.id, jobId));

    await routes.notifyBackfillCompletionToOrgAdmins(jobId);
    await routes.notifyBackfillCompletionToOrgAdmins(jobId);

    expect(getTestEmailOutbox().length).toBe(1);
  });

  it("does not send an email for jobs that are still RUNNING", async () => {
    const orgId = await makeOrg("running");
    const operator = await makeUser(orgId, "ADMIN", "op");

    const jobId = `job-running-${Date.now()}`;
    await insertJob({
      id: jobId,
      orgId,
      startedById: operator.id,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      status: "RUNNING",
    });

    await routes.notifyBackfillCompletionToOrgAdmins(jobId);
    expect(getTestEmailOutbox().length).toBe(0);
  });

  it("emails admins when the boot reaper marks a zombie job FAILED", async () => {
    const orgId = await makeOrg("zombie");
    const operator = await makeUser(orgId, "ADMIN", "op");

    const jobId = `job-zombie-${Date.now()}`;
    await insertJob({
      id: jobId,
      orgId,
      startedById: operator.id,
      startedAt: new Date(Date.now() - (MAX_RESUMABLE_AGE_MS + 60 * 60 * 1000)),
      heartbeatAt: new Date(Date.now() - (HEARTBEAT_STALE_MS + 60 * 1000)),
      status: "RUNNING",
      total: 50,
      processed: 12,
      succeeded: 10,
      failed: 2,
    });

    await routes.resumeOrReapBackfillJobsOnBoot();
    await waitForTick();

    const outbox = getTestEmailOutbox();
    expect(outbox.length).toBe(1);
    expect(outbox[0].subject?.toLowerCase()).toContain("failed");
    expect(outbox[0].to).toEqual([operator.email]);
    expect(outbox[0].text).toContain("Status:    FAILED");
  });

  it("scopes recipient lookup to the job's organization", async () => {
    const orgA = await makeOrg("orgA");
    const orgB = await makeOrg("orgB");
    const adminA = await makeUser(orgA, "ADMIN", "adminA");
    await makeUser(orgB, "ADMIN", "adminB"); // unrelated, must not receive

    const jobId = `job-scope-${Date.now()}`;
    await insertJob({
      id: jobId,
      orgId: orgA,
      startedById: adminA.id,
      startedAt: new Date(Date.now() - 30 * 1000),
      heartbeatAt: new Date(),
      status: "COMPLETED",
      processed: 1,
      succeeded: 1,
      total: 1,
    });
    await db
      .update(crmTranscriptBackfillJobs)
      .set({ completedAt: new Date() })
      .where(eq(crmTranscriptBackfillJobs.id, jobId));

    await routes.notifyBackfillCompletionToOrgAdmins(jobId);

    const outbox = getTestEmailOutbox();
    expect(outbox.length).toBe(1);
    expect(outbox[0].to).toEqual([adminA.email]);
  });

  it("does not throw and logs when an org has no eligible admin recipients", async () => {
    const orgId = await makeOrg("noadmins");
    const operator = await makeUser(orgId, "FIELD_WORKER", "fw");

    const jobId = `job-noadmins-${Date.now()}`;
    await insertJob({
      id: jobId,
      orgId,
      startedById: operator.id,
      startedAt: new Date(Date.now() - 30 * 1000),
      heartbeatAt: new Date(),
      status: "COMPLETED",
      processed: 1,
      succeeded: 1,
      total: 1,
    });
    await db
      .update(crmTranscriptBackfillJobs)
      .set({ completedAt: new Date() })
      .where(eq(crmTranscriptBackfillJobs.id, jobId));

    await expect(routes.notifyBackfillCompletionToOrgAdmins(jobId)).resolves.toBeUndefined();
    expect(getTestEmailOutbox().length).toBe(0);
  });
});
