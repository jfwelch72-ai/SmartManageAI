/**
 * Task #1675 — tests for the new GET `/api/me/failure-alert-routes`
 * endpoint. Verifies:
 *   - Routes where the caller is the PM are surfaced
 *   - Routes where the caller is the schedule's last editor are surfaced
 *   - PM + last editor on the same schedule are deduped to a single
 *     entry tagged with `asPm: true, asLastEditor: true`
 *   - OFF schedules are not surfaced (the worker doesn't fan out for
 *     them, so they wouldn't actually page the user)
 *   - Multiple log types on the same project are grouped under one
 *     entry sorted by name
 *   - Auth is required
 *
 * Hermetic — mirrors the in-process db mocks used by
 * `project-log-email-schedule-get-recipients.test.ts` so the tests
 * don't need a real Postgres bootstrap.
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
  insert: () => ({ values: async () => undefined, returning: async () => [] }),
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

vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => true),
  sendEmailWithResult: vi.fn(async () => ({ ok: true, recipientCount: 0 })),
}));

vi.mock("../services/projectLogService", () => ({
  buildProjectLogPdfBuffer: vi.fn(async () => Buffer.from("pdf")),
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

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  vi.resetModules();
  const mod = await import("../projectLogEmailScheduleRoutes");
  app = makeApp(mod.default);
});

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const OTHER_USER = "99999999-9999-9999-9999-999999999999";

function authedHeaders(role = "MANAGER") {
  return {
    "x-test-user-id": ME,
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

function authedGet() {
  return request(app)
    .get(`/api/me/failure-alert-routes`)
    .set(authedHeaders());
}

function queueRoutesQuery(rows: Row[]) {
  // The endpoint's only SELECT joins schedules → projects, so the
  // mock keys it under the from-table (project_log_email_schedules).
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}

describe("GET /api/me/failure-alert-routes", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/me/failure-alert-routes");
    expect(res.status).toBe(401);
  });

  it("returns an empty array when the user is on no schedules", async () => {
    queueRoutesQuery([]);
    const res = await authedGet();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ routes: [] });
  });

  it("surfaces routes where the caller is the PM and tags asPm", async () => {
    queueRoutesQuery([
      {
        projectId: "p1",
        projectCode: "BR-7",
        projectName: "Bridge 7",
        logType: "RFI",
        cadence: "WEEKLY",
        projectManagerId: ME,
        lastEditedById: OTHER_USER,
      },
    ]);
    const res = await authedGet();
    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    expect(res.body.routes[0]).toMatchObject({
      projectId: "p1",
      projectCode: "BR-7",
      projectName: "Bridge 7",
    });
    expect(res.body.routes[0].logTypes).toEqual([
      { logType: "RFI", cadence: "WEEKLY", asPm: true, asLastEditor: false },
    ]);
  });

  it("surfaces routes where the caller is the last editor (but not PM)", async () => {
    queueRoutesQuery([
      {
        projectId: "p2",
        projectCode: "TUN-3",
        projectName: "Tunnel 3",
        logType: "SUBMITTAL",
        cadence: "DAILY",
        projectManagerId: OTHER_USER,
        lastEditedById: ME,
      },
    ]);
    const res = await authedGet();
    expect(res.status).toBe(200);
    expect(res.body.routes[0].logTypes).toEqual([
      { logType: "SUBMITTAL", cadence: "DAILY", asPm: false, asLastEditor: true },
    ]);
  });

  it("tags asPm + asLastEditor true when the caller is both", async () => {
    queueRoutesQuery([
      {
        projectId: "p3",
        projectCode: "DAM-1",
        projectName: "Dam 1",
        logType: "RFI",
        cadence: "BIWEEKLY",
        projectManagerId: ME,
        lastEditedById: ME,
      },
    ]);
    const res = await authedGet();
    expect(res.body.routes[0].logTypes[0]).toMatchObject({
      asPm: true,
      asLastEditor: true,
    });
  });

  it("groups multiple log types under one project entry, sorted by logType", async () => {
    queueRoutesQuery([
      {
        projectId: "p4",
        projectCode: "RD-9",
        projectName: "Road 9",
        logType: "SUBMITTAL",
        cadence: "WEEKLY",
        projectManagerId: ME,
        lastEditedById: OTHER_USER,
      },
      {
        projectId: "p4",
        projectCode: "RD-9",
        projectName: "Road 9",
        logType: "RFI",
        cadence: "DAILY",
        projectManagerId: ME,
        lastEditedById: ME,
      },
    ]);
    const res = await authedGet();
    expect(res.body.routes).toHaveLength(1);
    expect(res.body.routes[0].logTypes.map((t: any) => t.logType)).toEqual(["RFI", "SUBMITTAL"]);
  });

  it("excludes OFF schedules even if the SQL filter is bypassed (defense-in-depth)", async () => {
    queueRoutesQuery([
      {
        projectId: "p-off",
        projectCode: "OFF-1",
        projectName: "Off Schedule Project",
        logType: "RFI",
        cadence: "OFF",
        projectManagerId: ME,
        lastEditedById: OTHER_USER,
      },
      {
        projectId: "p-on",
        projectCode: "ON-1",
        projectName: "Active Project",
        logType: "SUBMITTAL",
        cadence: "WEEKLY",
        projectManagerId: ME,
        lastEditedById: OTHER_USER,
      },
    ]);
    const res = await authedGet();
    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    expect(res.body.routes[0].projectId).toBe("p-on");
  });

  it("sorts multiple projects by name", async () => {
    queueRoutesQuery([
      {
        projectId: "p-z",
        projectCode: "Z",
        projectName: "Zeta Project",
        logType: "RFI",
        cadence: "WEEKLY",
        projectManagerId: ME,
        lastEditedById: OTHER_USER,
      },
      {
        projectId: "p-a",
        projectCode: "A",
        projectName: "Alpha Project",
        logType: "RFI",
        cadence: "WEEKLY",
        projectManagerId: ME,
        lastEditedById: OTHER_USER,
      },
    ]);
    const res = await authedGet();
    expect(res.body.routes.map((r: any) => r.projectName)).toEqual([
      "Alpha Project",
      "Zeta Project",
    ]);
  });
});
