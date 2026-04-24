/**
 * Task #1649 — tests for the GET
 * `/api/projects/:projectId/log-email-schedules` endpoint's new
 * `failureNotificationRecipients` decoration. Verifies:
 *   - PM + last editor are surfaced (deduped) on each schedule row
 *   - users from outside the caller's org are filtered out
 *   - the empty state ([] recipients) surfaces when both pointers
 *     are null on the schedule + the project has no PM
 *   - the default OFF row (no schedule persisted) still gets the PM
 *
 * Hermetic — mirrors the in-process db/email/pdf mocks used by
 * `project-log-email-schedule-send-now.test.ts` so the tests don't
 * need a real Postgres bootstrap.
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

function queueProject(rows: Row[]) {
  (selectByTable["projects"] ??= []).push(rows);
}
function queueSchedules(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}
function queueUsers(rows: Row[]) {
  (selectByTable["users"] ??= []).push(rows);
}
// Task #1680 — the GET endpoint runs an aggregate against the
// per-attempt history when there is at least one persisted schedule
// row. Tests use this helper to seed `[{ scheduleId, count }]` shaped
// rows that mimic the GROUP BY result.
function queueScheduleAttempts(rows: Row[]) {
  (selectByTable["project_log_email_schedule_attempts"] ??= []).push(rows);
}

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const PM_ID = "44444444-4444-4444-4444-444444444444";
const EDITOR_ID = "55555555-5555-5555-5555-555555555555";

function authedHeaders(role = "ADMIN") {
  return {
    "x-test-user-id": "user-1",
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

function authedGet() {
  return request(app)
    .get(`/api/projects/${PROJECT_ID}/log-email-schedules`)
    .set(authedHeaders());
}

describe("GET /api/projects/:projectId/log-email-schedules — failure notification recipients", () => {
  it("surfaces PM + last editor (deduped) on each schedule row", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: PM_ID,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastEditedById: EDITOR_ID,
      },
    ]);
    queueUsers([
      { id: PM_ID, firstName: "Pat", lastName: "Manager", email: "pm@example.com", isActive: true },
      { id: EDITOR_ID, firstName: "Ed", lastName: "Editor", email: "editor@example.com", isActive: true },
    ]);

    const res = await authedGet();
    expect(res.status).toBe(200);
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.failureNotificationRecipients).toEqual([
      { id: PM_ID, firstName: "Pat", lastName: "Manager", email: "pm@example.com", isActive: true },
      { id: EDITOR_ID, firstName: "Ed", lastName: "Editor", email: "editor@example.com", isActive: true },
    ]);

    // The default-OFF SUBMITTAL row (no schedule persisted) should
    // still surface the PM since the worker would still notify them
    // if a future schedule failed.
    const submittal = res.body.schedules.find((s: any) => s.logType === "SUBMITTAL");
    expect(submittal.failureNotificationRecipients).toEqual([
      { id: PM_ID, firstName: "Pat", lastName: "Manager", email: "pm@example.com", isActive: true },
    ]);
  });

  it("dedupes when the PM is also the last editor", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: PM_ID,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        lastEditedById: PM_ID,
      },
    ]);
    queueUsers([
      { id: PM_ID, firstName: "Pat", lastName: "Manager", email: "pm@example.com", isActive: true },
    ]);

    const res = await authedGet();
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.failureNotificationRecipients).toHaveLength(1);
    expect(rfi.failureNotificationRecipients[0].id).toBe(PM_ID);
    expect(rfi.failureNotificationRecipients[0].isActive).toBe(true);
  });

  // Task #1655 — `isActive` is mirrored straight from `users.is_active`
  // so the card can flag deactivated recipients without re-querying.
  // Mixed and all-inactive cases share the same server payload shape;
  // the empty-state decision is handled client-side so the worker's
  // own dedupe (which still creates notification rows for inactive
  // users) stays the source of truth.
  it("surfaces isActive on each recipient (mixed active/inactive)", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: PM_ID,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        lastEditedById: EDITOR_ID,
      },
    ]);
    queueUsers([
      { id: PM_ID, firstName: "Pat", lastName: "Manager", email: "pm@example.com", isActive: true },
      { id: EDITOR_ID, firstName: "Ed", lastName: "Editor", email: "editor@example.com", isActive: false },
    ]);

    const res = await authedGet();
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.failureNotificationRecipients).toEqual([
      { id: PM_ID, firstName: "Pat", lastName: "Manager", email: "pm@example.com", isActive: true },
      { id: EDITOR_ID, firstName: "Ed", lastName: "Editor", email: "editor@example.com", isActive: false },
    ]);
  });

  it("surfaces isActive=false when every resolved recipient is inactive", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: PM_ID,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        lastEditedById: EDITOR_ID,
      },
    ]);
    queueUsers([
      { id: PM_ID, firstName: "Pat", lastName: "Manager", email: "pm@example.com", isActive: false },
      { id: EDITOR_ID, firstName: "Ed", lastName: "Editor", email: "editor@example.com", isActive: false },
    ]);

    const res = await authedGet();
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.failureNotificationRecipients.every((r: any) => r.isActive === false)).toBe(true);
    expect(rfi.failureNotificationRecipients.map((r: any) => r.id).sort()).toEqual(
      [PM_ID, EDITOR_ID].sort(),
    );
  });

  it("returns the empty state when the project has no PM and no schedule editor", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: null,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        lastEditedById: null,
      },
    ]);
    // No user lookup required — userIdsToResolve is empty so the
    // route must skip the users select entirely.

    const res = await authedGet();
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.failureNotificationRecipients).toEqual([]);
    const submittal = res.body.schedules.find((s: any) => s.logType === "SUBMITTAL");
    expect(submittal.failureNotificationRecipients).toEqual([]);
  });

  it("filters out users that are not in the caller's organization", async () => {
    // The PM pointer is set, but the users-table fetch returns no
    // matching row (simulating a cross-tenant pointer or a deleted
    // user). The route must surface an empty recipient list rather
    // than leaking a stale id with no display name.
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: PM_ID,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        lastEditedById: null,
      },
    ]);
    queueUsers([]); // org-scoped lookup returns nothing.

    const res = await authedGet();
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.failureNotificationRecipients).toEqual([]);
  });
});

// Task #1667 — the GET endpoint surfaces (a) the per-row
// `consecutiveFailureCount` so the project settings card can render
// "Failed N times in a row", and (b) a top-level `failureThreshold`
// so the card can color the badge to match the worker's escalation.
describe("GET /api/projects/:projectId/log-email-schedules — failure streak surfacing", () => {
  it("includes consecutiveFailureCount on persisted rows and 0 on default-OFF rows", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: null,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastEditedById: null,
        consecutiveFailureCount: 2,
      },
    ]);

    const res = await authedGet();
    expect(res.status).toBe(200);
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.consecutiveFailureCount).toBe(2);
    // The default-OFF SUBMITTAL row was not persisted; the route must
    // synthesize a 0 streak so the client doesn't have to defensively
    // probe for an undefined value.
    const submittal = res.body.schedules.find((s: any) => s.logType === "SUBMITTAL");
    expect(submittal.consecutiveFailureCount).toBe(0);
  });

  it("surfaces the env-driven failureThreshold (default 3)", async () => {
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    try {
      queueProject([{
        id: PROJECT_ID,
        name: "Bridge 7",
        gcOrganizationId: ORG_ID,
        projectManagerId: null,
      }]);
      queueSchedules([]);

      const res = await authedGet();
      expect(res.status).toBe(200);
      expect(res.body.failureThreshold).toBe(3);
    } finally {
      if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
      else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
    }
  });

  it("respects PROJECT_LOG_EMAIL_FAILURE_THRESHOLD env override", async () => {
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = "5";
    try {
      queueProject([{
        id: PROJECT_ID,
        name: "Bridge 7",
        gcOrganizationId: ORG_ID,
        projectManagerId: null,
      }]);
      queueSchedules([]);

      const res = await authedGet();
      expect(res.status).toBe(200);
      expect(res.body.failureThreshold).toBe(5);
    } finally {
      if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
      else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
    }
  });

  it("falls back to the default threshold when the env override is malformed", async () => {
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = "not-a-number";
    try {
      queueProject([{
        id: PROJECT_ID,
        name: "Bridge 7",
        gcOrganizationId: ORG_ID,
        projectManagerId: null,
      }]);
      queueSchedules([]);

      const res = await authedGet();
      expect(res.status).toBe(200);
      expect(res.body.failureThreshold).toBe(3);
    } finally {
      if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
      else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
    }
  });
});

// Task #1680 — the GET endpoint surfaces a rolling 30-day failure
// count per schedule, computed from the immutable per-attempt history.
// This sits beside the existing `consecutiveFailureCount` streak so
// admins can tell apart a chronically flaky pipeline (where the streak
// keeps resetting on the occasional successful tick) from a one-off
// transport blip.
describe("GET /api/projects/:projectId/log-email-schedules — rolling 30-day failure surfacing", () => {
  it("decorates persisted rows with rollingFailureCount30d from the attempts aggregate", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: null,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastEditedById: null,
        consecutiveFailureCount: 0,
      },
      {
        id: "s-sub",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "SUBMITTAL",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastEditedById: null,
        consecutiveFailureCount: 0,
      },
    ]);
    // Aggregate result: only the RFI schedule has failures in the
    // window. The SUBMITTAL row should still surface 0, not undefined.
    queueScheduleAttempts([
      { scheduleId: "s-rfi", count: 12 },
    ]);

    const res = await authedGet();
    expect(res.status).toBe(200);
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    const sub = res.body.schedules.find((s: any) => s.logType === "SUBMITTAL");
    expect(rfi.rollingFailureCount30d).toBe(12);
    expect(rfi.rollingFailureWindowDays).toBe(30);
    expect(sub.rollingFailureCount30d).toBe(0);
    expect(sub.rollingFailureWindowDays).toBe(30);
  });

  it("synthesizes 0 for default-OFF rows even when no attempts query runs", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: null,
    }]);
    // No persisted schedule rows at all: the route must skip the
    // attempts aggregate entirely and still return both default-OFF
    // synthesized rows with rollingFailureCount30d = 0.
    queueSchedules([]);

    const res = await authedGet();
    expect(res.status).toBe(200);
    expect(res.body.schedules).toHaveLength(2);
    for (const s of res.body.schedules) {
      expect(s.rollingFailureCount30d).toBe(0);
      expect(s.rollingFailureWindowDays).toBe(30);
    }
  });

  it("coerces stringified count() output (driver bigint quirk) to a number", async () => {
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: null,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastEditedById: null,
        consecutiveFailureCount: 0,
      },
    ]);
    // Some Postgres drivers return count() as a string even after an
    // ::int cast — defend against that so the client can render the
    // value directly without re-parsing.
    queueScheduleAttempts([
      { scheduleId: "s-rfi", count: "7" },
    ]);

    const res = await authedGet();
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.rollingFailureCount30d).toBe(7);
  });

  it("keeps the rolling count visible even after a successful recovery (chronic vs flaky)", async () => {
    // Mirrors the brief's core motivating case: the schedule's most
    // recent attempt was a SUCCESS (so consecutiveFailureCount is 0
    // and the streak badge would disappear), but it has chronically
    // failed throughout the window. The rolling count must still
    // surface so admins can prioritise the chronic problem.
    queueProject([{
      id: PROJECT_ID,
      name: "Bridge 7",
      gcOrganizationId: ORG_ID,
      projectManagerId: null,
    }]);
    queueSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastEditedById: null,
        consecutiveFailureCount: 0,
        lastAttemptStatus: "SUCCESS",
      },
    ]);
    queueScheduleAttempts([
      { scheduleId: "s-rfi", count: 9 },
    ]);

    const res = await authedGet();
    const rfi = res.body.schedules.find((s: any) => s.logType === "RFI");
    expect(rfi.consecutiveFailureCount).toBe(0);
    expect(rfi.lastAttemptStatus).toBe("SUCCESS");
    expect(rfi.rollingFailureCount30d).toBe(9);
  });
});
