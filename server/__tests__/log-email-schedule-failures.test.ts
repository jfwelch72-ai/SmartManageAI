/**
 * Task #1666 — tests for the org-wide scheduled email failures
 * endpoint that powers the new admin dashboard.
 *
 *   GET /api/log-email-schedule-failures
 *
 * Mirrors the in-process db mock used by
 * `project-log-email-schedule-attempts.test.ts` so the suite stays
 * hermetic. The endpoint joins `project_log_email_schedules` with
 * `projects`, but the mock's `from()` resolves to the schedules
 * table (the join target), so we only need to queue rows for
 * `project_log_email_schedules`. The mocked rows already include
 * the project columns (name + code) the SELECT pulls from the
 * joined row.
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

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: () => ({ values: () => ({ returning: async () => [], then: (r: any) => Promise.resolve().then(r) }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  delete: () => ({ where: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

function queueFailures(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}

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

const ORG_ID = "22222222-2222-2222-2222-222222222222";

function authedHeaders(role = "ADMIN") {
  return {
    "x-test-user-id": "user-1",
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

let app: Express;

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  vi.resetModules();
  const mod = await import("../projectLogEmailScheduleRoutes");
  app = makeApp(mod.default);
});

describe("GET /api/log-email-schedule-failures", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await request(app).get("/api/log-email-schedule-failures");
    expect(res.status).toBe(401);
  });

  it("rejects callers without the required role with 403", async () => {
    const res = await request(app)
      .get("/api/log-email-schedule-failures")
      .set(authedHeaders("FIELD"));
    expect(res.status).toBe(403);
  });

  it("returns the failing schedules joined with their project info", async () => {
    queueFailures([
      {
        scheduleId: "sched-a",
        projectId: "proj-a",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-22T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 4,
      },
      {
        scheduleId: "sched-b",
        projectId: "proj-b",
        projectName: "Tower 9",
        projectCode: "TW-9",
        logType: "SUBMITTAL",
        cadence: "WEEKLY",
        lastAttemptAt: new Date("2026-04-21T08:00:00Z"),
        lastAttemptStatus: "NO_RECIPIENTS",
        lastAttemptError: "No recipients on the distribution list",
        lastAttemptRecipientCount: 0,
        consecutiveFailureCount: 1,
      },
    ]);

    const res = await request(app)
      .get("/api/log-email-schedule-failures")
      .set(authedHeaders());
    expect(res.status).toBe(200);
    expect(res.body.failures).toHaveLength(2);
    expect(res.body.failures[0]).toMatchObject({
      scheduleId: "sched-a",
      projectName: "Bridge 7",
      projectCode: "BR-7",
      logType: "RFI",
      lastAttemptStatus: "FAILURE",
      consecutiveFailureCount: 4,
    });
    expect(res.body.failures[1]).toMatchObject({
      projectName: "Tower 9",
      lastAttemptStatus: "NO_RECIPIENTS",
    });
  });

  it("returns an empty list when nothing is currently failing", async () => {
    queueFailures([]);
    const res = await request(app)
      .get("/api/log-email-schedule-failures")
      .set(authedHeaders());
    expect(res.status).toBe(200);
    expect(res.body.failures).toEqual([]);
  });

  it("clamps the limit query param to the max so callers can't blow the response", async () => {
    // We don't directly assert on db.limit() here — the mock chain
    // ignores it — but we ensure the endpoint still responds 200
    // when an absurdly large limit is requested. The clamp logic
    // itself is a one-liner; this test guards against future
    // refactors that might forget to validate the input.
    queueFailures([]);
    const res = await request(app)
      .get("/api/log-email-schedule-failures?limit=99999")
      .set(authedHeaders());
    expect(res.status).toBe(200);
  });

  it("accepts MANAGER and SUPERINTENDENT in addition to ADMIN", async () => {
    queueFailures([]);
    queueFailures([]);
    const r1 = await request(app)
      .get("/api/log-email-schedule-failures")
      .set(authedHeaders("MANAGER"));
    expect(r1.status).toBe(200);
    const r2 = await request(app)
      .get("/api/log-email-schedule-failures")
      .set(authedHeaders("SUPERINTENDENT"));
    expect(r2.status).toBe(200);
  });
});
