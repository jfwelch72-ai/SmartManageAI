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

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: () => ({ values: async () => undefined, returning: async () => [] }),
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
  sendEmailCalls.length = 0;
  sendEmailNextResults.length = 0;

  vi.resetModules();
  // Re-mount the routes after the module reset so our db mock binds
  // freshly. The db/email/pdf vi.mocks are hoisted and apply to every
  // import, so we don't need to re-declare them.
  const mod = await import("../projectLogEmailScheduleRoutes");
  resetDebounce = mod.__resetSendNowDebounceForTests;
  resetDebounce();
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
});
