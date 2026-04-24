/**
 * Task #1599: tests for the submittal-review overdue notification sweep
 * in `server/jobs/jobRunner.ts`
 * (`processSubmittalReviewOverdueNotifications`).
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

let processSubmittalReviewOverdueNotifications: typeof import("../jobs/jobRunner")["processSubmittalReviewOverdueNotifications"];

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  insertedNotifications.length = 0;
  updateCalls.length = 0;
  ({ processSubmittalReviewOverdueNotifications } = await import("../jobs/jobRunner"));
});

const queueOverdueReviews = (rows: Row[]) => { (selectByTable["submittal_reviews"] ??= []).push(rows); };
const queueProjects = (rows: Row[]) => { (selectByTable["projects"] ??= []).push(rows); };

describe("processSubmittalReviewOverdueNotifications", () => {
  const NOW = new Date("2026-04-23T12:00:00Z");

  it("scopes the overdue sweep to IN_REVIEW only — PENDING (future-step) reviewers are not pinged", async () => {
    const { SUBMITTAL_REVIEW_OPEN_STATUSES } = await import("../jobs/jobRunner");
    // PENDING means a future chain step that has not yet activated. The
    // assigned reviewer is not yet ball-in-court, so reminding them
    // would be premature. Only IN_REVIEW is overdue-eligible.
    expect(Array.from(SUBMITTAL_REVIEW_OPEN_STATUSES)).toEqual(["IN_REVIEW"]);
    expect(SUBMITTAL_REVIEW_OPEN_STATUSES).not.toContain("PENDING");
  });

  it("notifies the reviewer + project manager and stamps lastOverdueNotifiedAt on initial fanout", async () => {
    queueOverdueReviews([
      {
        id: "rev-1",
        organizationId: "org-1",
        submittalId: "sub-1",
        reviewerId: "user-reviewer",
        reviewerName: "Sam Reviewer",
        sequenceOrder: 1,
        status: "IN_REVIEW",
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
        submittalNumber: "SUB-0001",
        submittalSubject: "30-mil HDPE liner shop drawings",
        projectId: "proj-1",
        dateRequired: new Date("2026-04-20T00:00:00Z"),
        reminderMaxCount: 5,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([{ id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-pm" }]);

    await processSubmittalReviewOverdueNotifications({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ userId: string; type: string; relatedEntityType: string; relatedEntityId: string; title: string; message: string }>;
    expect(flat.map((n) => n.userId).sort()).toEqual(["user-pm", "user-reviewer"]);
    for (const n of flat) {
      expect(n.type).toBe("GENERAL");
      expect(n.relatedEntityType).toBe("SUBMITTAL_REVIEW");
      expect(n.relatedEntityId).toBe("rev-1");
      expect(n.title).toContain("Submittal #SUB-0001");
      expect(n.title).toContain("3 days overdue");
      expect(n.title).toContain("I-95 Widening");
      expect(n.title).not.toContain("Reminder");
      expect(n.message).toContain("30-mil HDPE liner shop drawings");
      expect(n.message).toContain("Sam Reviewer");
      expect(n.message).toContain("step 1");
    }
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("submittal_reviews");
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
    expect(updateCalls[0].values.overdueReminderCount).toBeUndefined();
  });

  it("tags follow-ups with 'Reminder K of N' using the per-org cap", async () => {
    const yesterday = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    queueOverdueReviews([
      {
        id: "rev-2",
        organizationId: "org-tight",
        submittalId: "sub-1",
        reviewerId: "user-reviewer",
        reviewerName: "Sam Reviewer",
        sequenceOrder: 1,
        status: "IN_REVIEW",
        lastOverdueNotifiedAt: yesterday,
        overdueReminderCount: 1,
        submittalNumber: "SUB-0002",
        submittalSubject: "X",
        projectId: "proj-1",
        dateRequired: new Date("2026-04-20T00:00:00Z"),
        reminderMaxCount: 2,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([{ id: "proj-1", organizationId: "org-tight", name: "I-95 Widening", projectManagerId: "user-pm" }]);

    await processSubmittalReviewOverdueNotifications({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ title: string }>;
    for (const n of flat) {
      expect(n.title).toContain("Reminder 2 of 2");
      expect(n.title).not.toContain("of 5");
    }
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.overdueReminderCount).toBeDefined();
  });

  it("still marks a review notified when there are no recipients", async () => {
    queueOverdueReviews([
      {
        id: "rev-3",
        organizationId: "org-1",
        submittalId: "sub-1",
        reviewerId: null,
        reviewerName: "(external)",
        sequenceOrder: 1,
        status: "IN_REVIEW",
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
        submittalNumber: "SUB-0003",
        submittalSubject: "Lonely",
        projectId: "proj-1",
        dateRequired: new Date("2026-04-20T00:00:00Z"),
        reminderMaxCount: 5,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([{ id: "proj-1", organizationId: "org-1", name: "I-95", projectManagerId: null }]);

    await processSubmittalReviewOverdueNotifications({ now: NOW });

    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
  });

  it("does nothing when no submittal reviews are overdue", async () => {
    queueOverdueReviews([]);
    await processSubmittalReviewOverdueNotifications({ now: NOW });
    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});
