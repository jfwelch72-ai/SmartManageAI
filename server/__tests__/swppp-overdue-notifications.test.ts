/**
 * Task #1173: tests for the SWPPP overdue corrective action sweep in
 * `server/jobs/jobRunner.ts` (`processSwpppOverdueCorrectiveActions`).
 *
 * The function under test:
 *   - Selects OPEN swppp_inspections whose corrective_action_due_date is
 *     before today and that have not yet had a notification fanout
 *     (last_overdue_notified_at IS NULL).
 *   - Notifies the corrective action assignee + the project's project
 *     manager once per overdue cycle.
 *   - Marks each scanned inspection's last_overdue_notified_at so the
 *     next nightly run does not re-notify the same item.
 *
 * The db and notification service are mocked in-process so the tests
 * are hermetic, mirroring the pattern used by the certified payroll
 * digest tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

const selectByTable: Record<string, Row[][]> = {};
const updateCalls: Array<{ table: string; values: Record<string, unknown> }> = [];

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
  select: (_cols?: unknown) => makeSelectChain(),
  insert: () => ({ values: async () => undefined }),
  update: (t: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        updateCalls.push({ table: tableName(t), values });
      },
    }),
  }),
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

let processSwpppOverdueCorrectiveActions: typeof import("../jobs/jobRunner")["processSwpppOverdueCorrectiveActions"];

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  insertedNotifications.length = 0;
  updateCalls.length = 0;
  ({ processSwpppOverdueCorrectiveActions } = await import("../jobs/jobRunner"));
});

function queueOverdueInspections(rows: Row[]) {
  (selectByTable["swppp_inspections"] ??= []).push(rows);
}

function queueProjects(rows: Row[]) {
  (selectByTable["projects"] ??= []).push(rows);
}

describe("processSwpppOverdueCorrectiveActions", () => {
  const NOW = new Date("2026-04-23T12:00:00Z");

  it("notifies the assignee and project manager and stamps lastOverdueNotifiedAt", async () => {
    queueOverdueInspections([
      {
        id: "insp-1",
        organizationId: "org-1",
        projectId: "proj-1",
        inspectionDate: "2026-04-15",
        correctiveActionDueDate: "2026-04-20",
        correctiveActionAssigneeId: "user-assignee",
        correctiveActions: "Repair silt fence on east berm",
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-pm" },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{
      userId: string;
      organizationId: string;
      type: string;
      title: string;
      message: string;
      relatedEntityType: string;
      relatedEntityId: string;
    }>;
    const userIds = flat.map((n) => n.userId).sort();
    expect(userIds).toEqual(["user-assignee", "user-pm"]);
    for (const n of flat) {
      expect(n.organizationId).toBe("org-1");
      expect(n.type).toBe("REMINDER");
      expect(n.relatedEntityType).toBe("SWPPP_OVERDUE_CORRECTIVE_ACTION");
      expect(n.relatedEntityId).toBe("insp-1");
      expect(n.title).toContain("3 days overdue");
      expect(n.title).toContain("I-95 Widening");
      expect(n.message).toContain("Repair silt fence on east berm");
      expect(n.message).toContain("2026-04-20");
    }

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("swppp_inspections");
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
  });

  it("dedupes when assignee and project manager are the same person", async () => {
    queueOverdueInspections([
      {
        id: "insp-2",
        organizationId: "org-1",
        projectId: "proj-1",
        inspectionDate: "2026-04-10",
        correctiveActionDueDate: "2026-04-22",
        correctiveActionAssigneeId: "user-shared",
        correctiveActions: "Re-stake inlet protection",
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-shared" },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ userId: string }>;
    expect(flat.map((n) => n.userId)).toEqual(["user-shared"]);
  });

  it("still marks an item notified when there are no recipients to avoid re-scanning forever", async () => {
    queueOverdueInspections([
      {
        id: "insp-3",
        organizationId: "org-1",
        projectId: "proj-1",
        inspectionDate: "2026-04-10",
        correctiveActionDueDate: "2026-04-15",
        correctiveActionAssigneeId: null,
        correctiveActions: null,
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: null },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
  });

  it("does nothing when no inspections are overdue", async () => {
    queueOverdueInspections([]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("SWPPP overdue email composition", () => {
  it("builds a deep link to the SWPPP inspection", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const result = composeEmailContent({
      id: "n1",
      userId: "u1",
      type: "REMINDER",
      title: "SWPPP corrective action 3 days overdue: I-95 Widening",
      message: "I-95 Widening — corrective action was due 2026-04-20 (3 days overdue).\nRepair silt fence",
      relatedEntityType: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      relatedEntityId: "insp-1",
    });
    expect(result.actionUrl).toContain("/swppp-inspections?inspectionId=insp-1");
    expect(result.actionText).toBe("Open SWPPP Inspection");
    expect(result.subject).toContain("SWPPP Corrective Action Overdue");
  });

  it("falls back to the list page when there is no inspection id", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const result = composeEmailContent({
      id: "n1",
      userId: "u1",
      type: "REMINDER",
      title: "SWPPP corrective action overdue",
      message: "Project — overdue.",
      relatedEntityType: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      relatedEntityId: null,
    });
    expect(result.actionUrl).toMatch(/\/swppp-inspections$/);
  });
});
