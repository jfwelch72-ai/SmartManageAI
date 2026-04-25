/**
 * Task #1638 — tests for the manual `POST /api/projects/:projectId/log-email-schedules/:logType/send-now`
 * endpoint that lets admins immediately retry a failed scheduled log
 * email instead of waiting for the next cron tick.
 *
 * Hermetic — the database, helper, and email transport are mocked
 * in-process so the tests don't need a real Postgres bootstrap.
 * Mirrors the dependency-injection style used by the sibling
 * `project-log-email-schedule.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

type Row = Record<string, unknown>;

// Per-table queue of select results, same pattern as the cron test.
const selectByTable: Record<string, Row[][]> = {};

function tableName(t: unknown): string {
  if (!t || typeof t !== "object") return "<unknown>";
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("Name")) {
      const v = (t as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return "<unknown>";
}

function makeSelectChain() {
  let resolvedTable = "<unknown>";
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => {
    resolvedTable = tableName(t);
    return chain;
  };
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  const settle = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
    try {
      const queue = selectByTable[resolvedTable] ?? [];
      const next = queue.length ? queue.shift()! : [];
      return Promise.resolve(next).then(resolve, reject);
    } catch (err) {
      return reject ? reject(err) : Promise.reject(err);
    }
  };
  chain.then = settle;
  chain.catch = (reject: (e: unknown) => unknown) => settle((v) => v, reject);
  return chain;
}

const updates: Array<{ table: string; values?: Row }> = [];
// Task #1669 — capture `db.insert(...).values(...)` calls so the new
// repeated-failure tests can observe the threshold-backstop fan-out's
// notification rows (the helper writes them via `insertNotifications`,
// which calls `db.insert(notifications).values(rows).returning()`).
// Also supports per-attempt history inserts the helper records.
const inserts: Array<{ table: string; values: Row[] }> = [];

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: (t: unknown) => {
    const table = tableName(t);
    return {
      values: (vals: Row | Row[]) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        inserts.push({ table, values: arr });
        const stamped = arr.map((v, i) => ({ id: `${table}-insert-${i}`, ...v }));
        const thenable: PromiseLike<unknown> & { returning: () => Promise<Row[]> } = {
          returning: async () => stamped,
          then: (resolve, reject) => Promise.resolve(undefined).then(resolve, reject),
        };
        return thenable;
      },
    };
  },
  update: (t: unknown) => {
    const table = tableName(t);
    return {
      set: (values: Row) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    };
  },
  delete: () => ({ where: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// Task #1669 — `insertNotifications` schedules `deliverNotification`
// via `setImmediate`; mock the delivery side to a no-op so the
// in-flight delivery doesn't try to touch the real SendGrid transport
// or DB during the test (the inserts themselves are still observed
// via the `inserts` array on dbMock).
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

// Email + PDF mocks: same shape as the cron test.
const sendEmailCalls: Array<Record<string, unknown>> = [];
const sendEmailNextResults: Array<{ ok: boolean; error?: string }> = [];
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => true),
  sendEmailWithResult: vi.fn(async (opts: Record<string, unknown>) => {
    sendEmailCalls.push(opts);
    const recipients = Array.isArray(opts.to) ? (opts.to as string[]).length : 1;
    if (sendEmailNextResults.length > 0) {
      const next = sendEmailNextResults.shift()!;
      return { ok: next.ok, error: next.error, recipientCount: recipients };
    }
    return { ok: true, recipientCount: recipients };
  }),
}));

vi.mock("../services/projectLogService", () => ({
  buildProjectLogPdfBuffer: vi.fn(async (logType: string, project: Record<string, unknown>) =>
    Buffer.from(`pdf:${logType}:${project.id}`),
  ),
}));

// Lightweight auth shim — let tests set `req.user` via headers
// instead of standing up the real session/cookie middleware.
function makeApp(routes: any): Express {
  // Lazy-require express so the vi.mock above lands first.
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: any }, _res: Response, next: NextFunction) => {
    const userId = req.header("x-test-user-id");
    const orgId = req.header("x-test-org-id");
    const role = req.header("x-test-role");
    if (userId && orgId && role) {
      req.user = { id: userId, organizationId: orgId, role };
    }
    next();
  });
  app.use("/api", routes);
  return app;
}

let app: Express;
let resetDebounce: () => void;

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  updates.length = 0;
  inserts.length = 0;
  sendEmailCalls.length = 0;
  sendEmailNextResults.length = 0;

  vi.resetModules();
  // Task #1831 — install an in-memory rate-limit store before the
  // routes module loads so the new `consumeRateLimit` helper doesn't
  // try to issue real `INSERT ... ON CONFLICT` statements through
  // the dbMock above (which only knows how to return `{ rows: [] }`
  // and would therefore make every claim succeed, breaking the 429
  // rate-limit test below). Importing the rate-limit module here
  // primes the cache; the routes module then reuses the same module
  // instance and so picks up the in-memory store automatically.
  const rateLimitStore = await import("../utils/rateLimitStore");
  rateLimitStore.__setRateLimitStoreForTests(
    rateLimitStore.createInMemoryRateLimitStore(),
  );
  // Re-mount the routes after the module reset so our db mock binds
  // freshly. The db/email/pdf vi.mocks are hoisted and apply to every
  // import, so we don't need to re-declare them.
  const mod = await import("../projectLogEmailScheduleRoutes");
  resetDebounce = mod.__resetSendNowDebounceForTests;
  await resetDebounce();
  app = makeApp(mod.default);
});

function queueProject(rows: Row[]) {
  (selectByTable["projects"] ??= []).push(rows);
}
function queueSchedules(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}
function queueDistLists(rows: Row[]) {
  (selectByTable["project_email_distribution_lists"] ??= []).push(rows);
}
// Task #1669 — repeated-failure backstop notification fans out to
// every ADMIN / MANAGER / SUPER_ADMIN in the org. The helper does a
// single SELECT against `users` filtered by org + role, so we queue
// the resulting rows here.
function queueUsers(rows: Row[]) {
  (selectByTable["users"] ??= []).push(rows);
}

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const SCHEDULE_ID = "33333333-3333-3333-3333-333333333333";

function authedHeaders(role = "ADMIN") {
  return {
    "x-test-user-id": "user-1",
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

function authedRequest(role = "ADMIN") {
  return request(app)
    .post(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/send-now`)
    .set(authedHeaders(role));
}

describe("POST /api/projects/:projectId/log-email-schedules/:logType/send-now", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await request(app).post(
      `/api/projects/${PROJECT_ID}/log-email-schedules/RFI/send-now`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects callers without the required role with 403", async () => {
    // FIELD has no admin/manager privileges.
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/send-now`)
      .set(authedHeaders("FIELD"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the project doesn't belong to the caller's org", async () => {
    queueProject([]); // loadProject finds nothing
    const res = await authedRequest().send({});
    expect(res.status).toBe(404);
  });

  it("returns 400 when the schedule row hasn't been saved yet", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([]); // no schedule row
    const res = await authedRequest().send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no schedule configured/i);
  });

  it("returns 400 when the schedule cadence is OFF", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "OFF",
    }]);
    const res = await authedRequest().send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/off/i);
  });

  it("runs the send pipeline and returns SUCCESS with the refreshed schedule", async () => {
    // 1) loadProject, 2) load schedule row, 3) helper loads project,
    //    4) helper loads dist lists, 5) refresh schedule after send.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      weekday: 1,
      hour: 8,
      timezone: "UTC",
      lastSentAt: null,
    }]);
    queueProject([{ id: PROJECT_ID, name: "Bridge 7", gcOrganizationId: ORG_ID }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastAttemptStatus: "SUCCESS",
      lastAttemptError: null,
      lastAttemptRecipientCount: 1,
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({
      status: "SUCCESS",
      error: null,
      recipientCount: 1,
    });
    expect(res.body.schedule).toMatchObject({ id: SCHEDULE_ID, lastAttemptStatus: "SUCCESS" });

    // Email transport actually called.
    expect(sendEmailCalls).toHaveLength(1);
    expect(sendEmailCalls[0].to).toEqual(["pm@example.com"]);

    // Helper stamped the success outcome on the schedule row.
    expect(updates.some((u) =>
      u.table === "project_log_email_schedules" && u.values?.lastAttemptStatus === "SUCCESS",
    )).toBe(true);
  });

  it("surfaces NO_RECIPIENTS in the response body when distribution lists are empty", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastSentAt: null,
    }]);
    queueProject([{ id: PROJECT_ID, name: "Bridge 7", gcOrganizationId: ORG_ID }]);
    queueDistLists([{ contactEmails: [], extraEmails: [] }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastAttemptStatus: "NO_RECIPIENTS",
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("NO_RECIPIENTS");
    expect(res.body.result.recipientCount).toBe(0);
    expect(typeof res.body.result.error).toBe("string");
    expect(sendEmailCalls).toHaveLength(0);
  });

  it("surfaces FAILURE with the transport error in the response body", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastSentAt: null,
    }]);
    queueProject([{ id: PROJECT_ID, name: "Bridge 7", gcOrganizationId: ORG_ID }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastAttemptStatus: "FAILURE",
    }]);
    sendEmailNextResults.push({ ok: false, error: "All recipients suppressed" });

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("FAILURE");
    expect(res.body.result.error).toBe("All recipients suppressed");
    expect(sendEmailCalls).toHaveLength(1);
  });

  it("rate-limits repeated send-now calls for the same schedule with 429", async () => {
    // First call: full send happens.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastSentAt: null,
    }]);
    queueProject([{ id: PROJECT_ID, name: "Bridge 7", gcOrganizationId: ORG_ID }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    queueSchedules([{ id: SCHEDULE_ID, lastAttemptStatus: "SUCCESS" }]);
    const first = await authedRequest().send({});
    expect(first.status).toBe(200);

    // Second call within 30s: rejected with 429 BEFORE the send pipeline runs.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
    }]);
    const second = await authedRequest().send({});
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
    expect(second.body.retryAfterSeconds).toBeGreaterThan(0);

    // Only the first call should have triggered the email transport.
    expect(sendEmailCalls).toHaveLength(1);
  });

  // ----------------------------------------------------------
  // Task #1669 — repeated-failure backstop notification
  // ----------------------------------------------------------
  // The send-now route now passes `previousConsecutiveFailureCount`
  // from the existing schedule row through to
  // `executeProjectLogEmailScheduleSend`, which in turn drives the
  // edge-triggered backstop fan-out (already covered for the cron
  // path in `project-log-email-schedule.test.ts`). These tests verify
  // the same column read + threshold backstop fires from the manual
  // path, and that a successful manual send resets the streak the
  // same way a successful cron tick does.

  it("crosses the threshold from a manual send and fans out the backstop notification", async () => {
    // Schedule sits one short of the default threshold (3 — see
    // `getProjectLogEmailFailureThreshold` in jobRunner). The manual
    // retry fails again, the helper bumps the streak to 3, and the
    // backstop fires for every ADMIN / MANAGER / SUPER_ADMIN in the
    // org so a chronically broken distribution list can't go
    // unnoticed for weeks.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastSentAt: null,
      // 2 prior failures + this one = 3 → crosses default threshold.
      consecutiveFailureCount: 2,
    }]);
    queueProject([{
      id: PROJECT_ID,
      code: "PRJ-99",
      name: "Tunnel 99",
      gcOrganizationId: ORG_ID,
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "SMTP 550 — recipient rejected" });
    queueUsers([
      { id: "user-admin-1" },
      { id: "user-admin-2" },
      { id: "user-manager-1" },
    ]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastAttemptStatus: "FAILURE",
      consecutiveFailureCount: 3,
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("FAILURE");
    expect(res.body.result.error).toBe("SMTP 550 — recipient rejected");

    // The schedule UPDATE bumps the streak to 3 (= threshold).
    const failUpdates = updates.filter((u) =>
      u.table === "project_log_email_schedules"
      && (u.values as Row).lastAttemptStatus === "FAILURE",
    );
    expect(failUpdates).toHaveLength(1);
    expect((failUpdates[0].values as Row).consecutiveFailureCount).toBe(3);

    // Backstop fan-out fires once and targets every admin/manager/
    // super-admin returned from the queued users SELECT.
    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    const rows = notifInserts[0].values;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set(["user-admin-1", "user-admin-2", "user-manager-1"]),
    );
    for (const r of rows) {
      expect(r.type).toBe("PROJECT_LOG_EMAIL_FAILED");
      expect(r.relatedEntityType).toBe("PROJECT_LOG_EMAIL_SCHEDULE");
      // Deep link uses the project code so the destination map can
      // resolve it to /projects/<code>/settings.
      expect(r.relatedEntityId).toBe("PRJ-99");
      expect(String(r.title)).toContain("Tunnel 99");
      expect(String(r.message)).toContain("3 times in a row");
      expect(String(r.message)).toContain("SMTP 550");
    }
  });

  it("does not re-fire the backstop when the streak is already past the threshold", async () => {
    // Edge-trigger guard: both `previousCount` and `newCount` are
    // already past the default threshold of 3, so the helper must
    // skip the fan-out entirely. The streak still increments and the
    // schedule still records a FAILURE — the only thing that's
    // suppressed is the fresh admin notification.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastSentAt: null,
      // 5 prior failures, this one makes 6 — both sides are past
      // threshold, so backstop is skipped.
      consecutiveFailureCount: 5,
    }]);
    queueProject([{
      id: PROJECT_ID,
      code: "PRJ-99",
      name: "Tunnel 99",
      gcOrganizationId: ORG_ID,
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Still bouncing" });
    queueSchedules([{ id: SCHEDULE_ID, lastAttemptStatus: "FAILURE", consecutiveFailureCount: 6 }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("FAILURE");

    const failUpdates = updates.filter((u) =>
      u.table === "project_log_email_schedules"
      && (u.values as Row).lastAttemptStatus === "FAILURE",
    );
    expect(failUpdates).toHaveLength(1);
    expect((failUpdates[0].values as Row).consecutiveFailureCount).toBe(6);

    expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
  });

  it("triggers the backstop on NO_RECIPIENTS as well as FAILURE", async () => {
    // Empty distribution lists also count toward the streak and can
    // trip the same backstop notification — surfaces "schedule was
    // never going anywhere" alongside transport bounces.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "SUBMITTAL",
      cadence: "WEEKLY",
      lastSentAt: null,
      consecutiveFailureCount: 2,
    }]);
    queueProject([{
      id: PROJECT_ID,
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
    }]);
    queueDistLists([{ contactEmails: [], extraEmails: [] }]);
    queueUsers([{ id: "user-admin-1" }, { id: "user-admin-2" }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      lastAttemptStatus: "NO_RECIPIENTS",
      consecutiveFailureCount: 3,
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("NO_RECIPIENTS");

    const noRecipUpdates = updates.filter((u) =>
      u.table === "project_log_email_schedules"
      && (u.values as Row).lastAttemptStatus === "NO_RECIPIENTS",
    );
    expect(noRecipUpdates).toHaveLength(1);
    expect((noRecipUpdates[0].values as Row).consecutiveFailureCount).toBe(3);

    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    expect(notifInserts[0].values).toHaveLength(2);
    expect(String(notifInserts[0].values[0].message)).toContain("3 times in a row");
  });

  it("resets consecutive_failure_count to 0 after a successful manual send", async () => {
    // Mid-streak schedule recovers via the manual retry. The next
    // failure should start a brand-new streak instead of immediately
    // re-tripping the backstop, so SUCCESS must clear the counter.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastSentAt: null,
      // Mid-streak: schedule has failed twice already and is about
      // to recover under an admin's "Send now" click.
      consecutiveFailureCount: 2,
    }]);
    queueProject([{
      id: PROJECT_ID,
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      lastAttemptStatus: "SUCCESS",
      consecutiveFailureCount: 0,
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("SUCCESS");

    const successUpdates = updates.filter((u) =>
      u.table === "project_log_email_schedules"
      && (u.values as Row).lastAttemptStatus === "SUCCESS",
    );
    expect(successUpdates).toHaveLength(1);
    expect((successUpdates[0].values as Row).consecutiveFailureCount).toBe(0);
    expect((successUpdates[0].values as Row).lastSentAt).toBeInstanceOf(Date);

    // No backstop fan-out on success, regardless of where the
    // streak was sitting before.
    expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
  });

  it("treats a missing consecutiveFailureCount column as 0 so older rows don't spuriously trip the backstop", async () => {
    // Defense-in-depth: a schedule row that pre-dates the
    // consecutive_failure_count column (or got nulled out somehow)
    // must not be treated as "infinitely failing" by the manual
    // path. The route reads `existing.consecutiveFailureCount ?? 0`
    // and the helper coerces it to >= 0, so a single failure on
    // such a row should bump the streak to 1, not the threshold.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      lastSentAt: null,
      consecutiveFailureCount: null,
    }]);
    queueProject([{
      id: PROJECT_ID,
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Bounce" });
    queueSchedules([{
      id: SCHEDULE_ID,
      lastAttemptStatus: "FAILURE",
      consecutiveFailureCount: 1,
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("FAILURE");

    const failUpdates = updates.filter((u) =>
      u.table === "project_log_email_schedules"
      && (u.values as Row).lastAttemptStatus === "FAILURE",
    );
    expect(failUpdates).toHaveLength(1);
    expect((failUpdates[0].values as Row).consecutiveFailureCount).toBe(1);

    // Below the default threshold of 3 — no admin fan-out yet.
    expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
  });
});
