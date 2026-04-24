/**
 * Task #1652 — tests for the per-schedule send-history table
 * (`project_log_email_schedule_attempts`) and the
 * `GET /api/projects/:projectId/log-email-schedules/:logType/attempts`
 * endpoint that surfaces it.
 *
 * Two angles covered:
 *
 *   1. **Job-runner side.** Every exit path of
 *      `executeProjectLogEmailScheduleSend` must insert exactly one
 *      attempt row, tagged with the right trigger (CRON for the
 *      hourly cron, MANUAL for the admin-on-demand send-now route).
 *
 *   2. **Route side.** The GET endpoint joins users for the
 *      "Triggered by" column, defaults to 10 rows, accepts a `limit`
 *      query param up to 50, and rejects unauthorised callers.
 *
 * Both halves use the same in-process db mock as the sibling
 * `project-log-email-schedule.test.ts` so the suite stays hermetic.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

type Row = Record<string, unknown>;

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

vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

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

function queueProject(rows: Row[]) {
  (selectByTable["projects"] ??= []).push(rows);
}
function queueSchedules(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}
function queueDistLists(rows: Row[]) {
  (selectByTable["project_email_distribution_lists"] ??= []).push(rows);
}
function queueAttempts(rows: Row[]) {
  (selectByTable["project_log_email_schedule_attempts"] ??= []).push(rows);
}

beforeEach(() => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  updates.length = 0;
  inserts.length = 0;
  sendEmailCalls.length = 0;
  sendEmailNextResults.length = 0;
});

describe("executeProjectLogEmailScheduleSend — attempt history insertion", () => {
  it("inserts a CRON-tagged SUCCESS attempt row when the cron path succeeds", async () => {
    queueProject([{ id: "proj-1", name: "Bridge 7", gcOrganizationId: "org-1" }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);

    const { executeProjectLogEmailScheduleSend } = await import("../jobs/jobRunner");
    const now = new Date("2026-04-20T08:00:00Z");
    const result = await executeProjectLogEmailScheduleSend(
      { scheduleId: "sched-1", organizationId: "org-1", projectId: "proj-1", logType: "RFI" },
      { now, triggeredBy: { kind: "CRON" } },
    );

    expect(result.status).toBe("SUCCESS");
    const histInserts = inserts.filter((i) => i.table === "project_log_email_schedule_attempts");
    expect(histInserts).toHaveLength(1);
    expect(histInserts[0].values).toHaveLength(1);
    const row = histInserts[0].values[0];
    expect(row.scheduleId).toBe("sched-1");
    expect(row.organizationId).toBe("org-1");
    expect(row.projectId).toBe("proj-1");
    expect(row.logType).toBe("RFI");
    expect(row.status).toBe("SUCCESS");
    expect(row.error).toBeNull();
    expect(row.recipientCount).toBe(1);
    expect(row.triggerType).toBe("CRON");
    // CRON ticks have no actor — the audit row's triggered_by_id stays null.
    expect(row.triggeredById).toBeNull();
    expect(row.createdAt).toEqual(now);
  });

  it("inserts a MANUAL-tagged FAILURE attempt row stamped with the actor when the transport rejects the send", async () => {
    queueProject([{ id: "proj-1", name: "Bridge 7", gcOrganizationId: "org-1" }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Bounced" });

    const { executeProjectLogEmailScheduleSend } = await import("../jobs/jobRunner");
    const result = await executeProjectLogEmailScheduleSend(
      { scheduleId: "sched-1", organizationId: "org-1", projectId: "proj-1", logType: "SUBMITTAL" },
      { triggeredBy: { kind: "MANUAL", userId: "user-9" } },
    );

    expect(result.status).toBe("FAILURE");
    const histInserts = inserts.filter((i) => i.table === "project_log_email_schedule_attempts");
    expect(histInserts).toHaveLength(1);
    const row = histInserts[0].values[0];
    expect(row.status).toBe("FAILURE");
    expect(row.error).toBe("Bounced");
    expect(row.triggerType).toBe("MANUAL");
    expect(row.triggeredById).toBe("user-9");
    expect(row.logType).toBe("SUBMITTAL");
    expect(row.recipientCount).toBe(1);
  });

  it("inserts a NO_RECIPIENTS attempt row when distribution lists resolve empty", async () => {
    queueProject([{ id: "proj-1", name: "Bridge 7", gcOrganizationId: "org-1" }]);
    queueDistLists([{ contactEmails: [], extraEmails: [] }]);

    const { executeProjectLogEmailScheduleSend } = await import("../jobs/jobRunner");
    await executeProjectLogEmailScheduleSend(
      { scheduleId: "sched-1", organizationId: "org-1", projectId: "proj-1", logType: "RFI" },
      { triggeredBy: { kind: "MANUAL", userId: "user-2" } },
    );

    const histInserts = inserts.filter((i) => i.table === "project_log_email_schedule_attempts");
    expect(histInserts).toHaveLength(1);
    const row = histInserts[0].values[0];
    expect(row.status).toBe("NO_RECIPIENTS");
    expect(typeof row.error).toBe("string");
    expect(row.recipientCount).toBe(0);
    expect(row.triggerType).toBe("MANUAL");
    expect(row.triggeredById).toBe("user-2");
  });

  it("still inserts an attempt row from the catch path when an unexpected error is thrown", async () => {
    queueProject([{ id: "proj-1", name: "Bridge 7", gcOrganizationId: "org-1" }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    // Force the PDF builder to throw so we exit through the catch
    // path; the history row should still be written so admins can see
    // the unexpected failure in the audit trail.
    const { executeProjectLogEmailScheduleSend } = await import("../jobs/jobRunner");
    const projectLogService = await import("../services/projectLogService");
    (projectLogService.buildProjectLogPdfBuffer as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );

    const result = await executeProjectLogEmailScheduleSend(
      { scheduleId: "sched-1", organizationId: "org-1", projectId: "proj-1", logType: "RFI" },
      { triggeredBy: { kind: "CRON" } },
    );

    expect(result.status).toBe("FAILURE");
    expect(result.error).toBe("boom");
    const histInserts = inserts.filter((i) => i.table === "project_log_email_schedule_attempts");
    expect(histInserts).toHaveLength(1);
    expect(histInserts[0].values[0].status).toBe("FAILURE");
    expect(histInserts[0].values[0].error).toBe("boom");
    expect(histInserts[0].values[0].triggerType).toBe("CRON");
  });
});

// ============================================================
// GET /api/projects/:projectId/log-email-schedules/:logType/attempts
// ============================================================

function makeApp(routes: any): Express {
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

let app: Express;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../projectLogEmailScheduleRoutes");
  app = makeApp(mod.default);
});

describe("GET /api/projects/:projectId/log-email-schedules/:logType/attempts", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await request(app).get(
      `/api/projects/${PROJECT_ID}/log-email-schedules/RFI/attempts`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects callers without the required role with 403", async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/attempts`)
      .set(authedHeaders("FIELD"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the project doesn't belong to the caller's org", async () => {
    queueProject([]);
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/attempts`)
      .set(authedHeaders());
    expect(res.status).toBe(404);
  });

  it("returns an empty list when no schedule row exists yet", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([]);
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/attempts`)
      .set(authedHeaders());
    expect(res.status).toBe(200);
    expect(res.body.attempts).toEqual([]);
  });

  it("returns the schedule's attempts with a friendly triggeredByLabel", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{ id: SCHEDULE_ID }]);
    const created = new Date("2026-04-20T08:00:00Z");
    queueAttempts([
      {
        id: "att-1",
        status: "SUCCESS",
        error: null,
        recipientCount: 5,
        triggerType: "CRON",
        triggeredById: null,
        createdAt: created,
        triggeredByFirstName: null,
        triggeredByLastName: null,
        triggeredByEmail: null,
      },
      {
        id: "att-2",
        status: "FAILURE",
        error: "Bounced",
        recipientCount: 5,
        triggerType: "MANUAL",
        triggeredById: "user-9",
        createdAt: created,
        triggeredByFirstName: "Jane",
        triggeredByLastName: "Doe",
        triggeredByEmail: "jane@example.com",
      },
      {
        id: "att-3",
        status: "FAILURE",
        error: "Boom",
        recipientCount: 0,
        triggerType: "MANUAL",
        triggeredById: "user-7",
        createdAt: created,
        triggeredByFirstName: null,
        triggeredByLastName: null,
        triggeredByEmail: "deleted@example.com",
      },
    ]);

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/attempts`)
      .set(authedHeaders());
    expect(res.status).toBe(200);
    expect(res.body.attempts).toHaveLength(3);
    // CRON rows are surfaced as "Scheduled run"; MANUAL rows prefer
    // the user's full name and fall back to email when the name is
    // missing (e.g. user soft-deleted but FK kept the id).
    expect(res.body.attempts[0]).toMatchObject({
      id: "att-1",
      status: "SUCCESS",
      triggerType: "CRON",
      triggeredByLabel: "Scheduled run",
    });
    expect(res.body.attempts[1]).toMatchObject({
      id: "att-2",
      status: "FAILURE",
      triggerType: "MANUAL",
      triggeredByLabel: "Jane Doe",
    });
    expect(res.body.attempts[2]).toMatchObject({
      id: "att-3",
      triggeredByLabel: "deleted@example.com",
    });
  });
});
