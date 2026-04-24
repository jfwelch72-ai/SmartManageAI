/**
 * Task #1606 — tests for the per-project scheduled RFI/submittal log
 * email worker (`processProjectLogEmailSchedules` in
 * `server/jobs/jobRunner.ts`).
 *
 * The worker iterates rows in `project_log_email_schedules` and gates
 * each one by cadence/weekday/hour/timezone + the lastSentAt dedupe
 * window. When a row is due, the worker:
 *   1. resolves the project,
 *   2. flattens recipients out of `project_email_distribution_lists`
 *      (project-scoped + org-level fallback),
 *   3. builds the log PDF via `buildProjectLogPdfBuffer`, and
 *   4. emails it as an attachment, then stamps `lastSentAt`.
 *
 * The db, the PDF builder, and the email transport are mocked
 * in-process so the tests are hermetic and fast — same shape as the
 * existing certified-payroll digest test in the suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

const updates: Array<{ table: string; values?: Row; where: boolean }> = [];

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: () => ({ values: async () => undefined, returning: async () => [] }),
  update: (t: unknown) => {
    const table = tableName(t);
    return {
      set: (values: Row) => ({
        where: async () => {
          updates.push({ table, values, where: true });
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

const sendEmailCalls: Array<Record<string, unknown>> = [];
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async (opts: Record<string, unknown>) => {
    sendEmailCalls.push(opts);
    return true;
  }),
}));

const pdfCalls: Array<{ logType: string; project: Record<string, unknown> }> = [];
vi.mock("../services/projectLogService", () => ({
  buildProjectLogPdfBuffer: vi.fn(async (logType: string, project: Record<string, unknown>) => {
    pdfCalls.push({ logType, project });
    return Buffer.from(`pdf:${logType}:${project.id}`);
  }),
}));

let processProjectLogEmailSchedules: typeof import("../jobs/jobRunner")["processProjectLogEmailSchedules"];

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  updates.length = 0;
  sendEmailCalls.length = 0;
  pdfCalls.length = 0;
  ({ processProjectLogEmailSchedules } = await import("../jobs/jobRunner"));
});

afterEach(() => {
  vi.useRealTimers();
});

function queueSchedules(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}
function queueProject(rows: Row[]) {
  (selectByTable["projects"] ??= []).push(rows);
}
function queueDistLists(rows: Row[]) {
  (selectByTable["project_email_distribution_lists"] ??= []).push(rows);
}

describe("processProjectLogEmailSchedules", () => {
  it("does nothing when there are no enabled schedules", async () => {
    queueSchedules([]);
    await processProjectLogEmailSchedules({ now: new Date("2026-04-20T08:00:00Z") });
    expect(sendEmailCalls).toHaveLength(0);
    expect(pdfCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("emails the RFI log PDF and stamps lastSentAt when the schedule is due", async () => {
    const now = new Date("2026-04-20T08:00:00Z"); // Monday 08:00 UTC
    queueSchedules([{
      id: "sched-1",
      organizationId: "org-1",
      projectId: "proj-1",
      logType: "RFI",
      cadence: "WEEKLY",
      weekday: 1,
      hour: 8,
      timezone: "UTC",
      lastSentAt: null,
    }]);
    queueProject([{ id: "proj-1", name: "Bridge 7", gcOrganizationId: "org-1" }]);
    queueDistLists([
      { contactEmails: ["pm@example.com"], extraEmails: ["owner@example.com"] },
    ]);

    await processProjectLogEmailSchedules({ now });

    expect(pdfCalls).toEqual([
      { logType: "RFI", project: { id: "proj-1", name: "Bridge 7", gcOrganizationId: "org-1" } },
    ]);
    expect(sendEmailCalls).toHaveLength(1);
    const sent = sendEmailCalls[0];
    expect(new Set(sent.to as string[])).toEqual(new Set(["pm@example.com", "owner@example.com"]));
    expect(sent.subject).toContain("RFI log");
    expect(sent.subject).toContain("Bridge 7");
    const atts = sent.attachments as Array<Record<string, unknown>>;
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toBe("rfi-log-Bridge_7.pdf");
    expect((atts[0].content as Buffer).toString()).toBe("pdf:RFI:proj-1");
    expect(atts[0].contentType).toBe("application/pdf");

    // lastSentAt was stamped on project_log_email_schedules.
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("project_log_email_schedules");
    expect((updates[0].values as Row).lastSentAt).toBeInstanceOf(Date);
  });

  it("does not fire when the local hour does not match the configured hour", async () => {
    // Monday 08:00 UTC == 01:00 in America/Los_Angeles, schedule wants 08:00 local.
    const now = new Date("2026-04-20T08:00:00Z");
    queueSchedules([{
      id: "sched-1",
      organizationId: "org-1",
      projectId: "proj-1",
      logType: "RFI",
      cadence: "WEEKLY",
      weekday: 1,
      hour: 8,
      timezone: "America/Los_Angeles",
      lastSentAt: null,
    }]);

    await processProjectLogEmailSchedules({ now });
    expect(sendEmailCalls).toHaveLength(0);
    expect(pdfCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("WEEKLY only fires on the configured weekday", async () => {
    // Wednesday 08:00 UTC. Schedule wants Friday (5).
    const now = new Date("2026-04-22T08:00:00Z");
    queueSchedules([{
      id: "sched-1",
      organizationId: "org-1",
      projectId: "proj-1",
      logType: "RFI",
      cadence: "WEEKLY",
      weekday: 5,
      hour: 8,
      timezone: "UTC",
      lastSentAt: null,
    }]);

    await processProjectLogEmailSchedules({ now });
    expect(sendEmailCalls).toHaveLength(0);
  });

  it("BIWEEKLY skips when the last send was less than 13 days ago", async () => {
    const now = new Date("2026-04-20T08:00:00Z"); // Monday 08:00 UTC
    queueSchedules([{
      id: "sched-1",
      organizationId: "org-1",
      projectId: "proj-1",
      logType: "SUBMITTAL",
      cadence: "BIWEEKLY",
      weekday: 1,
      hour: 8,
      timezone: "UTC",
      lastSentAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7d ago
    }]);

    await processProjectLogEmailSchedules({ now });
    expect(sendEmailCalls).toHaveLength(0);
  });

  it("DAILY skips when the last send was less than 23 hours ago (idempotency)", async () => {
    const now = new Date("2026-04-22T08:00:00Z"); // Wednesday 08:00 UTC, weekday irrelevant
    queueSchedules([{
      id: "sched-1",
      organizationId: "org-1",
      projectId: "proj-1",
      logType: "RFI",
      cadence: "DAILY",
      weekday: 1,
      hour: 8,
      timezone: "UTC",
      // Yesterday at the same hour — only 24h ago, but we set a 23h
      // dedupe so this should still skip if we just sent it 1h ago.
      lastSentAt: new Date(now.getTime() - 60 * 60 * 1000),
    }]);

    await processProjectLogEmailSchedules({ now });
    expect(sendEmailCalls).toHaveLength(0);
  });

  it("skips silently when no recipients resolve from the distribution lists", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueSchedules([{
      id: "sched-1",
      organizationId: "org-1",
      projectId: "proj-1",
      logType: "SUBMITTAL",
      cadence: "WEEKLY",
      weekday: 1,
      hour: 8,
      timezone: "UTC",
      lastSentAt: null,
    }]);
    queueProject([{ id: "proj-1", name: "Levee 3", gcOrganizationId: "org-1" }]);
    queueDistLists([{ contactEmails: [], extraEmails: [] }]);

    await processProjectLogEmailSchedules({ now });
    expect(sendEmailCalls).toHaveLength(0);
    expect(pdfCalls).toHaveLength(0);
    expect(updates).toHaveLength(0); // no stamp when nothing was sent
  });

  it("dedupes recipients across overlapping distribution lists (case-insensitive)", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueSchedules([{
      id: "sched-1",
      organizationId: "org-1",
      projectId: "proj-1",
      logType: "SUBMITTAL",
      cadence: "WEEKLY",
      weekday: 1,
      hour: 8,
      timezone: "UTC",
      lastSentAt: null,
    }]);
    queueProject([{ id: "proj-1", name: "Levee 3", gcOrganizationId: "org-1" }]);
    queueDistLists([
      { contactEmails: ["pm@example.com", "PM@Example.com"], extraEmails: ["owner@example.com"] },
      { contactEmails: ["owner@example.com"], extraEmails: ["new@example.com"] },
    ]);

    await processProjectLogEmailSchedules({ now });
    expect(sendEmailCalls).toHaveLength(1);
    const recipients = sendEmailCalls[0].to as string[];
    expect(new Set(recipients)).toEqual(new Set(["pm@example.com", "owner@example.com", "new@example.com"]));
    const atts = sendEmailCalls[0].attachments as Array<Record<string, unknown>>;
    expect(atts[0].filename).toBe("submittal-log-Levee_3.pdf");
  });
});
