/**
 * Task #1116: tests for the weekly certified payroll digest job in
 * `server/jobs/jobRunner.ts` (`processCertifiedPayrollWeeklyDigest`).
 *
 * The function under test:
 *   - Looks at every org with at least one `certified_payroll_reports` row in
 *     the last 7 days.
 *   - Skips an org whose `organization_payroll_settings` row has
 *     `work_week_end_notification_enabled = false`.
 *   - For each remaining org, resolves recipients to active users whose
 *     effective permissions include `canManagePayroll`, and inserts an
 *     in-app + email notification with the per-project / per-variant
 *     breakdown plus a deep link to /payroll/certified-history with the
 *     date range pre-applied (the date range is encoded in
 *     `relatedEntityId` as `YYYY-MM-DD|YYYY-MM-DD`).
 *
 * The db and notification service are mocked in-process so the tests are
 * hermetic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type Row = Record<string, unknown>;

const executeQueue: Array<{ rows: Row[] }> = [];
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
  execute: async () =>
    executeQueue.length ? executeQueue.shift()! : { rows: [] },
  select: (_cols?: unknown) => makeSelectChain(),
  insert: () => ({ values: async () => undefined }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  delete: () => ({ where: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

const insertedNotifications: unknown[][] = [];
vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
  insertNotifications: vi.fn(async (rows: unknown[]) => {
    insertedNotifications.push(rows);
  }),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

const effectivePermsByUser: Record<string, Record<string, boolean | string>> = {};
vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return {
    ...actual,
    getEffectivePermissions: vi.fn(async (userId: string) => effectivePermsByUser[userId] ?? {}),
  };
});

let processCertifiedPayrollWeeklyDigest: typeof import("../jobs/jobRunner")["processCertifiedPayrollWeeklyDigest"];

beforeEach(async () => {
  executeQueue.length = 0;
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  for (const k of Object.keys(effectivePermsByUser)) delete effectivePermsByUser[k];
  insertedNotifications.length = 0;
  ({ processCertifiedPayrollWeeklyDigest } = await import("../jobs/jobRunner"));
});

afterEach(() => {
  vi.useRealTimers();
});

function queueOrgs(orgIds: string[]) {
  executeQueue.push({ rows: orgIds.map((id) => ({ id })) });
}

function queueOrgSettings(rows: Row[]) {
  (selectByTable["organization_payroll_settings"] ??= []).push(rows);
}

function queueReports(rows: Row[]) {
  (selectByTable["certified_payroll_reports"] ??= []).push(rows);
}

function queueUsers(rows: Row[]) {
  (selectByTable["users"] ??= []).push(rows);
}

describe("processCertifiedPayrollWeeklyDigest", () => {
  it("sends a digest to users with canManagePayroll and skips others", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    queueOrgs(["org-1"]);
    queueOrgSettings([{ enabled: true }]);
    queueReports([
      { projectId: "proj-1", projectName: "Bridge 7", variant: "WH-347", generatedAt: new Date(), payRunId: "pr-1" },
      { projectId: "proj-1", projectName: "Bridge 7", variant: "WH-347", generatedAt: new Date(), payRunId: "pr-2" },
      { projectId: "proj-2", projectName: "Levee 3", variant: "CA-A1131", generatedAt: new Date(), payRunId: "pr-3" },
    ]);
    queueUsers([
      { id: "admin-1", role: "ADMIN" },
      { id: "viewer-1", role: "FIELD" },
    ]);

    effectivePermsByUser["admin-1"] = { canManagePayroll: true };
    effectivePermsByUser["viewer-1"] = { canManagePayroll: false };

    await processCertifiedPayrollWeeklyDigest({ now });

    const flat = insertedNotifications.flat() as Array<{
      userId: string;
      organizationId: string;
      type: string;
      title: string;
      message: string;
      relatedEntityType: string;
      relatedEntityId: string;
    }>;
    expect(flat.map((n) => n.userId)).toEqual(["admin-1"]);
    expect(flat[0].organizationId).toBe("org-1");
    expect(flat[0].type).toBe("REMINDER");
    expect(flat[0].relatedEntityType).toBe("CERTIFIED_PAYROLL_DIGEST");
    // Date range is encoded for the deep link.
    expect(flat[0].relatedEntityId).toMatch(/^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/);
    const [start, end] = flat[0].relatedEntityId.split("|");
    expect(end).toBe("2026-04-20");
    expect(start).toBe("2026-04-13");
    // Body has a header + breakdown lines.
    expect(flat[0].title).toContain("3 reports");
    expect(flat[0].message).toContain("Bridge 7 — WH-347: 2");
    expect(flat[0].message).toContain("Levee 3 — CA-A1131: 1");
    expect(flat[0].message).toContain("3 reports across 2 projects");
  });

  it("does nothing for orgs with no reports in the last 7 days", async () => {
    queueOrgs([]);
    await processCertifiedPayrollWeeklyDigest({ now: new Date("2026-04-20T08:00:00Z") });
    expect(insertedNotifications).toHaveLength(0);
  });

  it("respects the org-level workWeekEndNotificationEnabled gate", async () => {
    queueOrgs(["org-1"]);
    queueOrgSettings([{ enabled: false }]);

    await processCertifiedPayrollWeeklyDigest({ now: new Date("2026-04-20T08:00:00Z") });

    expect(insertedNotifications).toHaveLength(0);
  });

  it("skips an org with no eligible recipients even when reports exist", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueOrgs(["org-1"]);
    queueOrgSettings([{ enabled: true }]);
    queueReports([
      { projectId: "proj-1", projectName: "Bridge 7", variant: "WH-347", generatedAt: new Date(), payRunId: "pr-1" },
    ]);
    queueUsers([
      { id: "field-1", role: "FIELD" },
    ]);
    effectivePermsByUser["field-1"] = { canManagePayroll: false };

    await processCertifiedPayrollWeeklyDigest({ now });

    expect(insertedNotifications).toHaveLength(0);
  });

  it("groups reports without a project under (All projects)", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueOrgs(["org-1"]);
    queueOrgSettings([]);
    queueReports([
      { projectId: null, projectName: null, variant: "WH-347", generatedAt: new Date(), payRunId: "pr-1" },
      { projectId: null, projectName: null, variant: "WH-347", generatedAt: new Date(), payRunId: "pr-2" },
    ]);
    queueUsers([{ id: "admin-1", role: "ADMIN" }]);
    effectivePermsByUser["admin-1"] = { canManagePayroll: true };

    await processCertifiedPayrollWeeklyDigest({ now });

    const flat = insertedNotifications.flat() as Array<{ message: string }>;
    expect(flat).toHaveLength(1);
    expect(flat[0].message).toContain("(All projects) — WH-347: 2");
  });
});

describe("certified payroll digest email composition", () => {
  it("renders an HTML breakdown and a deep link with the date range pre-applied", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const result = composeEmailContent({
      id: "n1",
      userId: "u1",
      type: "REMINDER",
      title: "Weekly certified payroll digest: 3 reports",
      message: [
        "Certified payroll PDFs generated 2026-04-13 – 2026-04-20: 3 reports across 2 projects.",
        "",
        "Bridge 7 — WH-347: 2",
        "Levee 3 — CA-A1131: 1",
      ].join("\n"),
      relatedEntityType: "CERTIFIED_PAYROLL_DIGEST",
      relatedEntityId: "2026-04-13|2026-04-20",
    });
    expect(result.actionUrl).toContain("/payroll/certified-history?startDate=2026-04-13&endDate=2026-04-20");
    expect(result.actionText).toBe("Open Certified Payroll History");
    expect(result.html).toBeDefined();
    expect(result.html!).toContain("Bridge 7");
    expect(result.html!).toContain("WH-347");
    expect(result.html!).toContain("CA-A1131");
    // Counts cell is rendered.
    expect(result.html!).toMatch(/>\s*2\s*</);
    expect(result.html!).toMatch(/>\s*1\s*</);
  });

  it("ignores invalid relatedEntityId date encodings without breaking", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const result = composeEmailContent({
      id: "n1",
      userId: "u1",
      type: "REMINDER",
      title: "Weekly certified payroll digest",
      message: "Header line only",
      relatedEntityType: "CERTIFIED_PAYROLL_DIGEST",
      relatedEntityId: "garbage",
    });
    // Falls back to the page root with no query string.
    expect(result.actionUrl).toMatch(/\/payroll\/certified-history$/);
    expect(result.html).toContain("Header line only");
  });
});
