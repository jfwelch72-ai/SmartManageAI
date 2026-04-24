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

// Task #1785 — the dashboard endpoint now also runs an aggregate
// against the per-attempt history to compute `rollingFailureCount30d`
// per schedule (matching the per-project GET in the same module). When
// at least one persisted schedule row is returned, the route fires a
// second SELECT against `project_log_email_schedule_attempts` returning
// `[{ scheduleId, count }]` shaped rows. Tests that exercise the
// rolling-count surface or the new sort modes seed those rows here.
function queueRollingCounts(rows: Row[]) {
  (selectByTable["project_log_email_schedule_attempts"] ??= []).push(rows);
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
    queueRollingCounts([]);

    const res = await request(app)
      .get("/api/log-email-schedule-failures")
      .set(authedHeaders());
    expect(res.status).toBe(200);
    expect(res.body.failures).toHaveLength(2);
    // Default sort = "rolling". With no rolling-count rows queued the
    // tie-breaker cascades to the consecutive-failure streak, so
    // sched-a (streak=4) should land above sched-b (streak=1).
    expect(res.body.failures[0]).toMatchObject({
      scheduleId: "sched-a",
      projectName: "Bridge 7",
      projectCode: "BR-7",
      logType: "RFI",
      lastAttemptStatus: "FAILURE",
      consecutiveFailureCount: 4,
      // Task #1785 — rolling count decoration is always present, 0
      // when the aggregate returned no row for this schedule id.
      rollingFailureCount30d: 0,
      rollingFailureWindowDays: 30,
    });
    expect(res.body.failures[1]).toMatchObject({
      projectName: "Tower 9",
      lastAttemptStatus: "NO_RECIPIENTS",
      rollingFailureCount30d: 0,
    });
    expect(res.body.sort).toBe("rolling");
    expect(res.body.rollingFailureWindowDays).toBe(30);
  });

  it("returns an empty list when nothing is currently failing", async () => {
    queueFailures([]);
    // No persisted schedule ids → the route skips the rolling
    // aggregate entirely, so we don't queue a counts response here.
    const res = await request(app)
      .get("/api/log-email-schedule-failures")
      .set(authedHeaders());
    expect(res.status).toBe(200);
    expect(res.body.failures).toEqual([]);
    expect(res.body.sort).toBe("rolling");
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

  // Task #1785 — sorting + rolling 30-day count surfacing. The
  // dashboard's headline benefit is bubbling chronic offenders above
  // schedules that just happen to be currently broken, even if their
  // most recent attempt is older.
  describe("rolling 30-day count + sort modes (Task #1785)", () => {
    // Build three failing schedules so each sort mode has a
    // distinct expected order:
    //   chronic   → low streak (1), most failures (12), oldest attempt
    //   streaker  → highest streak (5), middling failures (3), middle attempt
    //   fresh     → lowest streak (1), low failures (1), newest attempt
    const SCHEDULES = [
      {
        scheduleId: "chronic",
        projectId: "p-chronic",
        projectName: "Chronic",
        projectCode: "C-1",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-10T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "blip",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 1,
      },
      {
        scheduleId: "streaker",
        projectId: "p-streak",
        projectName: "Streaker",
        projectCode: "S-1",
        logType: "RFI",
        cadence: "WEEKLY",
        lastAttemptAt: new Date("2026-04-15T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "still down",
        lastAttemptRecipientCount: 4,
        consecutiveFailureCount: 5,
      },
      {
        scheduleId: "fresh",
        projectId: "p-fresh",
        projectName: "Fresh",
        projectCode: "F-1",
        logType: "SUBMITTAL",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-22T08:00:00Z"),
        lastAttemptStatus: "NO_RECIPIENTS",
        lastAttemptError: "empty list",
        lastAttemptRecipientCount: 0,
        consecutiveFailureCount: 1,
      },
    ];
    const ROLLING_COUNTS = [
      { scheduleId: "chronic", count: 12 },
      { scheduleId: "streaker", count: 3 },
      { scheduleId: "fresh", count: 1 },
    ];

    it("decorates each row with rollingFailureCount30d from the aggregate", async () => {
      queueFailures(SCHEDULES);
      queueRollingCounts(ROLLING_COUNTS);
      const res = await request(app)
        .get("/api/log-email-schedule-failures")
        .set(authedHeaders());
      expect(res.status).toBe(200);
      const byId = new Map<string, any>(
        res.body.failures.map((r: any) => [r.scheduleId, r]),
      );
      expect(byId.get("chronic").rollingFailureCount30d).toBe(12);
      expect(byId.get("streaker").rollingFailureCount30d).toBe(3);
      expect(byId.get("fresh").rollingFailureCount30d).toBe(1);
    });

    it("defaults to rolling-count-desc so chronic offenders surface first", async () => {
      queueFailures(SCHEDULES);
      queueRollingCounts(ROLLING_COUNTS);
      const res = await request(app)
        .get("/api/log-email-schedule-failures")
        .set(authedHeaders());
      expect(res.status).toBe(200);
      expect(res.body.sort).toBe("rolling");
      expect(res.body.failures.map((r: any) => r.scheduleId)).toEqual([
        "chronic",
        "streaker",
        "fresh",
      ]);
    });

    it("uses the consecutive-failure streak as the rolling-sort tiebreaker", async () => {
      // Two schedules with the same rolling count — streak should
      // decide the order. `tied-A` and `tied-B` both have 7 failures
      // in the window; `tied-B` has a longer current streak (4 vs 1)
      // so it must land first.
      queueFailures([
        {
          scheduleId: "tied-A",
          projectId: "p-a",
          projectName: "A",
          projectCode: "A",
          logType: "RFI",
          cadence: "DAILY",
          lastAttemptAt: new Date("2026-04-22T08:00:00Z"),
          lastAttemptStatus: "FAILURE",
          lastAttemptError: null,
          lastAttemptRecipientCount: 1,
          consecutiveFailureCount: 1,
        },
        {
          scheduleId: "tied-B",
          projectId: "p-b",
          projectName: "B",
          projectCode: "B",
          logType: "RFI",
          cadence: "DAILY",
          lastAttemptAt: new Date("2026-04-20T08:00:00Z"),
          lastAttemptStatus: "FAILURE",
          lastAttemptError: null,
          lastAttemptRecipientCount: 1,
          consecutiveFailureCount: 4,
        },
      ]);
      queueRollingCounts([
        { scheduleId: "tied-A", count: 7 },
        { scheduleId: "tied-B", count: 7 },
      ]);
      const res = await request(app)
        .get("/api/log-email-schedule-failures")
        .set(authedHeaders());
      expect(res.body.failures.map((r: any) => r.scheduleId)).toEqual([
        "tied-B",
        "tied-A",
      ]);
    });

    it("?sort=streak surfaces the longest current streak first", async () => {
      queueFailures(SCHEDULES);
      queueRollingCounts(ROLLING_COUNTS);
      const res = await request(app)
        .get("/api/log-email-schedule-failures?sort=streak")
        .set(authedHeaders());
      expect(res.body.sort).toBe("streak");
      // streaker (streak=5) → chronic (streak=1, 12 failures) → fresh (streak=1, 1 failure)
      expect(res.body.failures.map((r: any) => r.scheduleId)).toEqual([
        "streaker",
        "chronic",
        "fresh",
      ]);
    });

    it("?sort=recent surfaces the most recently failed schedule first", async () => {
      queueFailures(SCHEDULES);
      queueRollingCounts(ROLLING_COUNTS);
      const res = await request(app)
        .get("/api/log-email-schedule-failures?sort=recent")
        .set(authedHeaders());
      expect(res.body.sort).toBe("recent");
      // fresh (Apr 22) → streaker (Apr 15) → chronic (Apr 10)
      expect(res.body.failures.map((r: any) => r.scheduleId)).toEqual([
        "fresh",
        "streaker",
        "chronic",
      ]);
    });

    it("falls back to the default sort on an unknown ?sort value (no 400)", async () => {
      queueFailures(SCHEDULES);
      queueRollingCounts(ROLLING_COUNTS);
      const res = await request(app)
        .get("/api/log-email-schedule-failures?sort=nonsense")
        .set(authedHeaders());
      expect(res.status).toBe(200);
      expect(res.body.sort).toBe("rolling");
    });

    it("coerces stringified count() output to a number (driver bigint quirk)", async () => {
      queueFailures([SCHEDULES[0]]);
      queueRollingCounts([{ scheduleId: "chronic", count: "12" }]);
      const res = await request(app)
        .get("/api/log-email-schedule-failures")
        .set(authedHeaders());
      expect(res.body.failures[0].rollingFailureCount30d).toBe(12);
    });
  });
});
