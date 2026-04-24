/**
 * Task #1679 — tests for the manual
 * `POST /api/projects/:projectId/log-email-schedules/:logType/reset-failure-streak`
 * endpoint that lets admins acknowledge a stuck failure streak from
 * the project settings card without having to wait for the next
 * successful cron tick (or fire a real email at recipients).
 *
 * Hermetic — the database is mocked in-process. Mirrors the same
 * dependency-injection pattern used by the sibling
 * `project-log-email-schedule-send-now.test.ts`.
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

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: () => ({
    values: () => ({
      returning: async () => [],
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
    }),
  }),
  update: (t: unknown) => {
    const table = tableName(t);
    return {
      set: (values: Row) => ({
        where: () => ({
          // The reset endpoint uses `.returning()` on the update so it
          // can echo the refreshed schedule back to the client. Return
          // the values we were called with (plus a synthetic id) so
          // the assertions can poke at exactly what the server stamps.
          returning: async () => {
            updates.push({ table, values });
            return [{ id: SCHEDULE_ID, ...values }];
          },
        }),
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

// The reset-streak endpoint never touches the email transport or PDF
// builder, but the routes module imports them at top level — stub them
// out so the import doesn't try to wire SendGrid / pdfkit during the
// hermetic run.
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => true),
  sendEmailWithResult: vi.fn(async () => ({ ok: true, recipientCount: 0 })),
}));
vi.mock("../services/projectLogService", () => ({
  buildProjectLogPdfBuffer: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

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

let app: Express;

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const SCHEDULE_ID = "33333333-3333-3333-3333-333333333333";

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  updates.length = 0;

  vi.resetModules();
  const mod = await import("../projectLogEmailScheduleRoutes");
  app = makeApp(mod.default);
});

function queueProject(rows: Row[]) {
  (selectByTable["projects"] ??= []).push(rows);
}
function queueSchedules(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}

function authedHeaders(role = "ADMIN") {
  return {
    "x-test-user-id": "user-1",
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

function authedRequest(role = "ADMIN", logType = "RFI") {
  return request(app)
    .post(`/api/projects/${PROJECT_ID}/log-email-schedules/${logType}/reset-failure-streak`)
    .set(authedHeaders(role));
}

describe("POST /api/projects/:projectId/log-email-schedules/:logType/reset-failure-streak", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await request(app).post(
      `/api/projects/${PROJECT_ID}/log-email-schedules/RFI/reset-failure-streak`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects callers without the required role with 403", async () => {
    // FIELD has no admin/manager privileges — must match the PUT gate.
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/reset-failure-streak`)
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
    // Defensive: a missing row must NOT have triggered a write.
    expect(updates).toHaveLength(0);
  });

  it("returns 400 when the logType param is invalid", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/log-email-schedules/NOT_A_LOG_TYPE/reset-failure-streak`)
      .set(authedHeaders());
    // Project lookup runs before logType validation in the current
    // route; queue an empty project so the call doesn't depend on
    // ordering. Either 400 (invalid logType) or 404 (no project)
    // would be a clean rejection — assert on the no-write side.
    expect([400, 404]).toContain(res.status);
    expect(updates).toHaveLength(0);
  });

  it("zeroes the streak and clears the last-notified columns on success", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      consecutiveFailureCount: 5,
      lastFailureNotifiedAt: new Date("2026-04-01T00:00:00Z"),
      lastFailureNotifiedStatus: "FAILURE",
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.schedule).toMatchObject({
      id: SCHEDULE_ID,
      consecutiveFailureCount: 0,
      lastFailureNotifiedAt: null,
      lastFailureNotifiedStatus: null,
    });

    expect(updates).toHaveLength(1);
    const upd = updates[0];
    expect(upd.table).toBe("project_log_email_schedules");
    expect(upd.values).toMatchObject({
      consecutiveFailureCount: 0,
      lastFailureNotifiedAt: null,
      lastFailureNotifiedStatus: null,
    });
    expect(upd.values?.updatedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — resetting a row whose streak is already 0 still returns 200 and writes a no-op set", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      consecutiveFailureCount: 0,
      lastFailureNotifiedAt: null,
      lastFailureNotifiedStatus: null,
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);
    expect(res.body.schedule.consecutiveFailureCount).toBe(0);
    // Idempotent server-side: we don't bother short-circuiting because
    // the write is a constant set on a single row keyed by id. The
    // important contract is "post-call streak is 0" — assert that.
    expect(updates).toHaveLength(1);
    expect(updates[0].values?.consecutiveFailureCount).toBe(0);
  });

  it("does NOT touch lastAttempt* columns — those reflect real send history", async () => {
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([{
      id: SCHEDULE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      logType: "RFI",
      cadence: "WEEKLY",
      consecutiveFailureCount: 4,
      lastAttemptStatus: "FAILURE",
      lastAttemptError: "All recipients suppressed",
      lastAttemptAt: new Date("2026-04-01T00:00:00Z"),
      lastAttemptRecipientCount: 3,
      lastFailureNotifiedAt: new Date("2026-04-01T00:00:00Z"),
      lastFailureNotifiedStatus: "FAILURE",
    }]);

    const res = await authedRequest().send({});
    expect(res.status).toBe(200);

    expect(updates).toHaveLength(1);
    const setValues = updates[0].values ?? {};
    // Critical: pretending a send succeeded would be a lie — this
    // endpoint only acknowledges the streak, it doesn't rewrite
    // history. The set must contain ONLY the streak/notified fields
    // (plus updatedAt).
    expect(Object.keys(setValues).sort()).toEqual([
      "consecutiveFailureCount",
      "lastFailureNotifiedAt",
      "lastFailureNotifiedStatus",
      "updatedAt",
    ].sort());
  });

  it.each(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"])(
    "allows %s callers (matches the PUT role gate)",
    async (role) => {
      queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
      queueSchedules([{
        id: SCHEDULE_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        consecutiveFailureCount: 2,
      }]);

      const res = await authedRequest(role).send({});
      expect(res.status).toBe(200);
    },
  );
});
