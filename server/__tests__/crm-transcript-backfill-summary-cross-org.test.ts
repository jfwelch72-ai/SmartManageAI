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
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmCalls,
  crmCallRecordings,
  crmTranscriptBackfillJobs,
  crmTranscriptBackfillNotifications,
  notifications,
  notificationChannelPrefs,
} from "@shared/schema";
import type { AuthRequest } from "../auth";
import {
  clearTestEmailOutbox,
  getTestEmailOutbox,
} from "../services/emailTransport";

// Task #1054 — must exceed BACKFILL_HEARTBEAT_STALE_MS (5 minutes) inside
// the route. Use a generous margin so a slow test runner can't accidentally
// flip a "stale" fixture back into the fresh window.
const BACKFILL_HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const STALE_HEARTBEAT_AGE_MS = BACKFILL_HEARTBEAT_STALE_MS + 60 * 1000;

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
  // Audit-row cleanup must precede the parent jobs delete: the GET-handler
  // reaper schedules a completion email which records a notification row
  // referencing the job id (Task #1022).
  await db.delete(crmTranscriptBackfillNotifications).where(
    sql`${crmTranscriptBackfillNotifications.jobId} IN (
      SELECT ${crmTranscriptBackfillJobs.id} FROM ${crmTranscriptBackfillJobs}
      WHERE ${crmTranscriptBackfillJobs.organizationId} IN (
        SELECT ${organizations.id} FROM ${organizations}
        WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
      )
    )`,
  );
  // Channel-pref rows the test seeds for the operator admins.
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (
      SELECT ${users.id} FROM ${users}
      WHERE ${users.email} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  // In-app notifications inserted by the boot reaper path (Task #1005). The
  // GET-handler reaper doesn't insert these but clear them defensively in
  // case other suites leave rows behind for our orgs.
  await db.delete(notifications).where(
    sql`${notifications.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
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
  opts: { heartbeatAt?: Date } = {},
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
    // Default to a fresh heartbeat so the reaper inside the route doesn't
    // mark the job FAILED before we inspect the response. Stale-heartbeat
    // tests pass an explicit older timestamp via `opts.heartbeatAt`.
    heartbeatAt: opts.heartbeatAt ?? now,
  });
  return id;
}

async function waitForBackfillEmailTick() {
  // scheduleBackfillCompletionEmail wraps the dispatcher in setImmediate
  // and the dispatcher itself awaits a chain of DB lookups + sendEmail.
  // Drain microtasks then sleep to let the noop transport finish.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 100));
}

async function waitForEmailCount(expected: number, timeoutMs = 2000): Promise<void> {
  // Bounded poll instead of a single fixed sleep — keeps slow CI hosts
  // from flaking while still failing fast when something is wrong.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getTestEmailOutbox().length >= expected) return;
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 25));
  }
}

function emailsForJob(jobId: string) {
  // The email builder embeds `Job ID:    <jobId>` in the text body and a
  // `<td>...<jobId>...</td>` row in the HTML, so filtering on the body is
  // a stable, copy-independent way to attribute outbox entries to the
  // job that triggered them.
  return getTestEmailOutbox().filter((e) => {
    const text = typeof e.text === "string" ? e.text : "";
    const html = typeof e.html === "string" ? e.html : "";
    return text.includes(jobId) || html.includes(jobId);
  });
}

let priorEmailTransport: string | undefined;

beforeAll(async () => {
  // Capture completion-email sends in-memory instead of hitting the real
  // Resend transport so we can assert exactly-once dispatch per reaped job.
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";

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
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
});

beforeEach(async () => {
  await cleanupTestData();
  // The completion-email dispatcher dedupes by jobId in a process-local
  // Set, so a previous test's reaped job would otherwise suppress the
  // next test's email. Reset the dedupe set + outbox between cases.
  routes.__resetBackfillNotifiedForTests();
  clearTestEmailOutbox();
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

/**
 * Task #1054 — verify the stale-heartbeat reaper inside the cross-org branch
 * of `GET /api/crm/calls/transcripts/backfill`.
 *
 * Task #1037 only exercises the fresh-heartbeat path, so a regression that
 *   - skipped reapIfStale entirely for cross-org callers,
 *   - ran it twice and double-emailed admins, or
 *   - sent the completion email to the wrong tenant's admins
 * would slip through unnoticed. The cases below seed a stale RUNNING row in
 * one org alongside a fresh RUNNING row in another, then assert that the
 * SUPER_ADMIN cross-org response, the database row, and the email outbox
 * all behave correctly.
 */
describe("transcript backfill summary — cross-org stale reaper (Task #1054)", () => {
  it("reaps a stale-heartbeat RUNNING job in another org, leaves fresh jobs alone, and emails admins exactly once", async () => {
    // Replace the default fresh-heartbeat orgB job with a stale one so the
    // reaper has something to flip. orgA + orgC stay fresh; the response
    // must omit only orgB.
    await db
      .delete(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, runningJobBId));
    const staleHeartbeat = new Date(Date.now() - STALE_HEARTBEAT_AGE_MS);
    runningJobBId = await seedRunningJob(orgBId, adminBId, "runB-stale", {
      heartbeatAt: staleHeartbeat,
    });

    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };

    const res = await request(app).get("/api/crm/calls/transcripts/backfill");
    expect(res.status).toBe(200);
    expect(res.body.crossOrg).toBe(true);

    // The reaper must have stripped orgB's stale job from runningJobs while
    // keeping orgA + orgC's fresh jobs.
    const runningJobs = res.body.runningJobs as Array<{
      id: string;
      status: string;
      organization: { id: string };
    }>;
    const seededIds = runningJobs
      .filter((j) =>
        [runningJobAId, runningJobBId, runningJobCId].includes(j.id),
      )
      .map((j) => j.id)
      .sort();
    expect(seededIds).toEqual([runningJobAId, runningJobCId].sort());
    expect(seededIds).not.toContain(runningJobBId);

    // DB side-effect: the stale row is now FAILED with a completedAt set.
    const [reapedRow] = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(eq(crmTranscriptBackfillJobs.id, runningJobBId));
    expect(reapedRow).toBeDefined();
    expect(reapedRow.status).toBe("FAILED");
    expect(reapedRow.completedAt).not.toBeNull();

    // Fresh peers are untouched: still RUNNING, no completedAt.
    const peerRows = await db
      .select()
      .from(crmTranscriptBackfillJobs)
      .where(
        sql`${crmTranscriptBackfillJobs.id} IN (${runningJobAId}, ${runningJobCId})`,
      );
    expect(peerRows).toHaveLength(2);
    for (const row of peerRows) {
      expect(row.status).toBe("RUNNING");
      expect(row.completedAt).toBeNull();
    }

    // Completion email: scheduled via setImmediate, so let the dispatcher
    // drain. Exactly one email must have been sent, addressed to orgB's
    // admin only — emailing every cross-org admin would leak job activity
    // across tenants. Filter by the reaped jobId in the body (the email
    // builder embeds it on a `Job ID:` line) instead of subject text so
    // the assertion stays stable if subject copy ever changes.
    await waitForEmailCount(1);
    const reapEmails = emailsForJob(runningJobBId);
    expect(reapEmails).toHaveLength(1);
    const recipients = reapEmails[0].to as string[];
    expect(recipients).toHaveLength(1);
    const [adminBRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, adminBId));
    expect(recipients[0]).toBe(adminBRow.email);
  });

  it("reaps every stale RUNNING job exactly once when several orgs go cold simultaneously", async () => {
    // Make orgA and orgB stale, leave orgC fresh. Two reaps in one request
    // — the loop must email both orgs' admins (once each) and never
    // double-fire for the same job id.
    const staleHeartbeat = new Date(Date.now() - STALE_HEARTBEAT_AGE_MS);
    await db
      .update(crmTranscriptBackfillJobs)
      .set({ heartbeatAt: staleHeartbeat })
      .where(
        sql`${crmTranscriptBackfillJobs.id} IN (${runningJobAId}, ${runningJobBId})`,
      );

    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };

    const res = await request(app).get("/api/crm/calls/transcripts/backfill");
    expect(res.status).toBe(200);

    const runningJobs = res.body.runningJobs as Array<{ id: string }>;
    const seededIds = runningJobs
      .filter((j) =>
        [runningJobAId, runningJobBId, runningJobCId].includes(j.id),
      )
      .map((j) => j.id);
    // Only the fresh orgC job should remain.
    expect(seededIds).toEqual([runningJobCId]);

    const reapedRows = await db
      .select({ id: crmTranscriptBackfillJobs.id, status: crmTranscriptBackfillJobs.status })
      .from(crmTranscriptBackfillJobs)
      .where(
        sql`${crmTranscriptBackfillJobs.id} IN (${runningJobAId}, ${runningJobBId})`,
      );
    expect(reapedRows).toHaveLength(2);
    for (const r of reapedRows) {
      expect(r.status).toBe("FAILED");
    }

    await waitForEmailCount(2);

    // Two reaped jobs → exactly two emails, attributed by jobId in the
    // body so the assertion isn't tied to subject-line wording.
    const reapAEmails = emailsForJob(runningJobAId);
    const reapBEmails = emailsForJob(runningJobBId);
    expect(reapAEmails).toHaveLength(1);
    expect(reapBEmails).toHaveLength(1);
    // No stray emails for the still-fresh orgC job.
    expect(emailsForJob(runningJobCId)).toHaveLength(0);
    expect(getTestEmailOutbox()).toHaveLength(2);

    // Recipient sanity: each org's admin gets their own org's email and no
    // one else's. The dispatcher derefs each job back to its tenant, so a
    // regression that mixed up the lookup would fail this check.
    const [adminARow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, adminAId));
    const [adminBRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, adminBId));
    expect(reapAEmails[0].to).toEqual([adminARow.email]);
    expect(reapBEmails[0].to).toEqual([adminBRow.email]);

    // A second GET while the rows are already FAILED must not re-emit any
    // completion emails — the reaper only fires for RUNNING rows, and the
    // dispatcher dedupes by jobId regardless.
    clearTestEmailOutbox();
    const res2 = await request(app).get("/api/crm/calls/transcripts/backfill");
    expect(res2.status).toBe(200);
    await waitForBackfillEmailTick();
    expect(getTestEmailOutbox()).toHaveLength(0);
  });

  it("keeps a fresh-heartbeat RUNNING job in runningJobs and does not schedule a completion email for it", async () => {
    // Sanity guard against a regression where the reaper's age comparison
    // gets inverted — a fresh job must never be reaped or emailed.
    currentUser = { id: superAdminId, role: "SUPER_ADMIN", organizationId: null };

    const res = await request(app).get("/api/crm/calls/transcripts/backfill");
    expect(res.status).toBe(200);

    const runningJobs = res.body.runningJobs as Array<{ id: string; status: string }>;
    const seededIds = runningJobs
      .filter((j) =>
        [runningJobAId, runningJobBId, runningJobCId].includes(j.id),
      )
      .map((j) => j.id)
      .sort();
    expect(seededIds).toEqual(
      [runningJobAId, runningJobBId, runningJobCId].sort(),
    );

    // DB rows are still RUNNING.
    const rows = await db
      .select({ id: crmTranscriptBackfillJobs.id, status: crmTranscriptBackfillJobs.status })
      .from(crmTranscriptBackfillJobs)
      .where(
        sql`${crmTranscriptBackfillJobs.id} IN (${runningJobAId}, ${runningJobBId}, ${runningJobCId})`,
      );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe("RUNNING");
    }

    await waitForBackfillEmailTick();
    expect(getTestEmailOutbox()).toHaveLength(0);
  });
});
