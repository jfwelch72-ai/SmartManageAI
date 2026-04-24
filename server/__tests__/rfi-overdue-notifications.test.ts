/**
 * Task #1599: tests for the RFI overdue notification sweep in
 * `server/jobs/jobRunner.ts` (`processRfiOverdueNotifications`).
 * Mirrors the SWPPP sweep test harness so the same hermetic in-process
 * mock contract covers both crons.
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
  chain.from = (t: unknown) => { resolvedTable = tableName(t); return chain; };
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
  insert: () => ({ values: async () => undefined }),
  update: (t: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => { updateCalls.push({ table: tableName(t), values }); },
    }),
  }),
  delete: () => ({ where: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

const insertedNotifications: unknown[][] = [];
vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
  insertNotifications: vi.fn(async (rows: unknown[]) => { insertedNotifications.push(rows); }),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

let processRfiOverdueNotifications: typeof import("../jobs/jobRunner")["processRfiOverdueNotifications"];

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  insertedNotifications.length = 0;
  updateCalls.length = 0;
  ({ processRfiOverdueNotifications } = await import("../jobs/jobRunner"));
});

const queueOverdueRfis = (rows: Row[]) => { (selectByTable["rfis"] ??= []).push(rows); };
const queueProjects = (rows: Row[]) => { (selectByTable["projects"] ??= []).push(rows); };

describe("processRfiOverdueNotifications", () => {
  const NOW = new Date("2026-04-23T12:00:00Z");

  it("notifies the assignee + project manager and stamps lastOverdueNotifiedAt on initial fanout", async () => {
    queueOverdueRfis([
      {
        id: "rfi-1",
        organizationId: "org-1",
        projectId: "proj-1",
        rfiNumber: "RFI-0001",
        subject: "Conduit routing under MSE wall",
        status: "OPEN",
        dateRequired: new Date("2026-04-20T00:00:00Z"),
        assignedToId: "user-assignee",
        forwardedToId: null,
        submittedById: "user-pm",
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
        reminderMaxCount: 5,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([{ id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-pm" }]);

    await processRfiOverdueNotifications({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ userId: string; type: string; relatedEntityType: string; title: string; message: string }>;
    expect(flat.map((n) => n.userId).sort()).toEqual(["user-assignee", "user-pm"]);
    for (const n of flat) {
      expect(n.type).toBe("GENERAL");
      expect(n.relatedEntityType).toBe("RFI");
      expect(n.title).toContain("RFI #RFI-0001");
      expect(n.title).toContain("3 days overdue");
      expect(n.title).toContain("I-95 Widening");
      expect(n.title).not.toContain("Reminder");
      expect(n.message).toContain("Conduit routing under MSE wall");
    }
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
    expect(updateCalls[0].values.overdueReminderCount).toBeUndefined();
  });

  it("routes a FORWARDED RFI to the forwarded-to user instead of the original assignee", async () => {
    queueOverdueRfis([
      {
        id: "rfi-2",
        organizationId: "org-1",
        projectId: "proj-1",
        rfiNumber: "RFI-0002",
        subject: "Pavement section query",
        status: "FORWARDED",
        dateRequired: new Date("2026-04-20T00:00:00Z"),
        assignedToId: "user-orig",
        forwardedToId: "user-fwd",
        submittedById: "user-pm",
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
        reminderMaxCount: 5,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([{ id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-pm" }]);

    await processRfiOverdueNotifications({ now: NOW });

    const ids = (insertedNotifications.flat() as Array<{ userId: string }>).map((n) => n.userId).sort();
    expect(ids).toEqual(["user-fwd", "user-pm"]);
    expect(ids).not.toContain("user-orig");
  });

  it("tags follow-ups with 'Reminder K of N' using the per-org cap", async () => {
    const yesterday = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    queueOverdueRfis([
      {
        id: "rfi-3",
        organizationId: "org-tight",
        projectId: "proj-1",
        rfiNumber: "RFI-0003",
        subject: "X",
        status: "OPEN",
        dateRequired: new Date("2026-04-20T00:00:00Z"),
        assignedToId: "user-assignee",
        forwardedToId: null,
        submittedById: "user-pm",
        lastOverdueNotifiedAt: yesterday,
        overdueReminderCount: 1,
        reminderMaxCount: 2,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([{ id: "proj-1", organizationId: "org-tight", name: "I-95 Widening", projectManagerId: "user-pm" }]);

    await processRfiOverdueNotifications({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ title: string }>;
    for (const n of flat) {
      expect(n.title).toContain("Reminder 2 of 2");
      expect(n.title).not.toContain("of 5");
    }
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.overdueReminderCount).toBeDefined();
  });

  it("still marks an RFI notified when there are no recipients to avoid re-scanning forever", async () => {
    queueOverdueRfis([
      {
        id: "rfi-4",
        organizationId: "org-1",
        projectId: "proj-1",
        rfiNumber: "RFI-0004",
        subject: "Lonely",
        status: "OPEN",
        dateRequired: new Date("2026-04-20T00:00:00Z"),
        assignedToId: null,
        forwardedToId: null,
        submittedById: null,
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
        reminderMaxCount: 5,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([{ id: "proj-1", organizationId: "org-1", name: "I-95", projectManagerId: null }]);

    await processRfiOverdueNotifications({ now: NOW });

    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
  });

  it("does nothing when no RFIs are overdue", async () => {
    queueOverdueRfis([]);
    await processRfiOverdueNotifications({ now: NOW });
    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});
