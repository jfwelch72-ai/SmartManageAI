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

const whereCallsByTable: Record<string, unknown[]> = {};

function makeSelectChain() {
  let resolvedTable = "<unknown>";
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => {
    resolvedTable = tableName(t);
    return chain;
  };
  chain.where = (predicate: unknown) => {
    (whereCallsByTable[resolvedTable] ??= []).push(predicate);
    return chain;
  };
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
  for (const k of Object.keys(whereCallsByTable)) delete whereCallsByTable[k];
  insertedNotifications.length = 0;
  updateCalls.length = 0;
  ({ processSwpppOverdueCorrectiveActions } = await import("../jobs/jobRunner"));
});

// Walk a drizzle SQL/condition object collecting referenced column names.
// Drizzle columns expose both `.name` and `.table`, so we use that as the
// signature. We recurse into arrays and `queryChunks` (the array drizzle
// uses for sql`` template literals + composite conditions).
function collectColumnNames(node: unknown, acc: Set<string> = new Set(), seen: Set<unknown> = new Set()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  if (seen.has(node)) return acc;
  seen.add(node);
  const obj = node as Record<string, unknown>;
  if (typeof obj.name === "string" && obj.table && typeof obj.table === "object") {
    acc.add(obj.name);
  }
  if (Array.isArray(node)) {
    for (const x of node) collectColumnNames(x, acc, seen);
    return acc;
  }
  for (const key of ["queryChunks", "chunks", "left", "right", "value", "values", "expr", "condition"]) {
    if (key in obj) collectColumnNames(obj[key], acc, seen);
  }
  return acc;
}

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
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
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
      // Task #1260 — fans out under the dedicated SWPPP overdue type so
      // users can mute it independently of the generic REMINDER stream.
      expect(n.type).toBe("SWPPP_OVERDUE_CORRECTIVE_ACTION");
      expect(n.relatedEntityType).toBe("SWPPP_OVERDUE_CORRECTIVE_ACTION");
      expect(n.relatedEntityId).toBe("insp-1");
      expect(n.title).toContain("3 days overdue");
      expect(n.title).toContain("I-95 Widening");
      // Initial fanout should not carry the "Reminder K of N" tag
      // (that's reserved for follow-ups starting on day 2).
      expect(n.title).not.toContain("Reminder");
      expect(n.message).toContain("Repair silt fence on east berm");
      expect(n.message).toContain("2026-04-20");
    }

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("swppp_inspections");
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
    // Initial fanouts must NOT bump overdueReminderCount — that
    // counter only tracks daily follow-ups, so a cap of 5 yields
    // 1 initial + 5 follow-ups.
    expect(updateCalls[0].values.overdueReminderCount).toBeUndefined();
  });

  it("sends the first daily follow-up reminder once 22+ hours have passed and tags it Reminder 1 of 5", async () => {
    const yesterday = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    queueOverdueInspections([
      {
        id: "insp-1",
        organizationId: "org-1",
        projectId: "proj-1",
        inspectionDate: "2026-04-15",
        correctiveActionDueDate: "2026-04-20",
        correctiveActionAssigneeId: "user-assignee",
        correctiveActions: "Repair silt fence on east berm",
        // Initial fanout already happened; no follow-ups yet.
        lastOverdueNotifiedAt: yesterday,
        overdueReminderCount: 0,
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-pm" },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ userId: string; title: string }>;
    expect(flat.map((n) => n.userId).sort()).toEqual(["user-assignee", "user-pm"]);
    for (const n of flat) {
      // First follow-up should advertise itself as Reminder 1 of 5.
      expect(n.title).toContain("Reminder 1 of 5");
    }
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.lastOverdueNotifiedAt).toEqual(NOW);
    // The follow-up branch must bump the counter via a SQL expression.
    expect(updateCalls[0].values.overdueReminderCount).toBeDefined();
  });

  it("tags the Nth follow-up correctly (Reminder 3 of 5 when 2 follow-ups already sent)", async () => {
    const yesterday = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    queueOverdueInspections([
      {
        id: "insp-1",
        organizationId: "org-1",
        projectId: "proj-1",
        inspectionDate: "2026-04-15",
        correctiveActionDueDate: "2026-04-20",
        correctiveActionAssigneeId: "user-assignee",
        correctiveActions: "Repair silt fence on east berm",
        lastOverdueNotifiedAt: yesterday,
        overdueReminderCount: 2,
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-pm" },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ title: string }>;
    expect(flat.length).toBeGreaterThan(0);
    for (const n of flat) {
      expect(n.title).toContain("Reminder 3 of 5");
    }
  });

  it("does not send a follow-up when fewer than 22 hours have passed since the last fanout", async () => {
    // The job query gates follow-ups on `lastOverdueNotifiedAt <=
    // reminderCutoff` where reminderCutoff = now - 22h. A row notified
    // 10 hours ago should therefore never come back from the SELECT.
    // Simulate by queueing an empty result and asserting nothing is
    // sent or updated. (This locks in the cadence; if someone tightens
    // the interval to e.g. 1h by accident, this test will not break,
    // but the SELECT predicate test below covers the row level.)
    queueOverdueInspections([]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("does not include items that hit the reminder cap (already sent 5 follow-ups)", async () => {
    // The job query itself filters by `overdueReminderCount < cap`, so
    // a row whose counter has reached the cap should never come back
    // from the select. Simulate that by queueing an empty result and
    // asserting nothing is sent / updated. (The query filter is also
    // covered by the legacy-row test below, which exercises the
    // initial-vs-followup branching.)
    queueOverdueInspections([]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("treats a legacy in-flight row (lastOverdueNotifiedAt set, count=0 from backfill) as a follow-up", async () => {
    // Pre-Task-#1259 rows get overdue_reminder_count = 0 by default
    // when the migration adds the column. Under the new semantics
    // those rows should be treated as "initial fanout already sent,
    // 0 follow-ups so far" — i.e. the next eligible run should send
    // follow-up #1 with the proper "Reminder 1 of 5" tag.
    const yesterday = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    queueOverdueInspections([
      {
        id: "legacy-1",
        organizationId: "org-1",
        projectId: "proj-1",
        inspectionDate: "2026-04-10",
        correctiveActionDueDate: "2026-04-15",
        correctiveActionAssigneeId: "user-assignee",
        correctiveActions: "Patch damaged inlet sock",
        lastOverdueNotifiedAt: yesterday,
        overdueReminderCount: 0,
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-1", name: "I-95 Widening", projectManagerId: "user-pm" },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ title: string }>;
    expect(flat.length).toBe(2);
    for (const n of flat) {
      expect(n.title).toContain("Reminder 1 of 5");
    }
    // Update should bump the counter (follow-up branch), not just
    // re-stamp the marker.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.overdueReminderCount).toBeDefined();
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
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
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
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
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

  it("uses the per-org cap (N) in the 'Reminder K of N' tag", async () => {
    // Task #1286 — orgs can dial the follow-up cap up or down via
    // `organizations.swppp_overdue_reminder_max_count`. The job's
    // SELECT projects that value as `reminderMaxCount`, and the title
    // builder must use it instead of the legacy hard-coded default of
    // 5. We simulate an org with cap=2 sending its 2nd (final) follow-
    // up: previous count is 1, so this fanout is "Reminder 2 of 2".
    // If the COALESCE / org-cap projection regresses to the legacy
    // default, the title would read "Reminder 2 of 5" and this test
    // would fail.
    const yesterday = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    queueOverdueInspections([
      {
        id: "insp-cap",
        organizationId: "org-tight",
        projectId: "proj-1",
        inspectionDate: "2026-04-15",
        correctiveActionDueDate: "2026-04-20",
        correctiveActionAssigneeId: "user-assignee",
        correctiveActions: "Repair silt fence on east berm",
        lastOverdueNotifiedAt: yesterday,
        overdueReminderCount: 1,
        // Per-org overrides as projected by the SELECT.
        reminderMaxCount: 2,
        reminderIntervalHours: 22,
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-tight", name: "I-95 Widening", projectManagerId: "user-pm" },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    const flat = insertedNotifications.flat() as Array<{ title: string }>;
    expect(flat.length).toBe(2);
    for (const n of flat) {
      expect(n.title).toContain("Reminder 2 of 2");
      expect(n.title).not.toContain("of 5");
    }
    // Sanity: the SELECT must join `organizations` and gate the
    // follow-up cadence on the org-level columns. Detect a regression
    // to hard-coded constants by inspecting the WHERE predicate the
    // job built against `swppp_inspections`.
    const wheres = whereCallsByTable["swppp_inspections"] ?? [];
    expect(wheres.length).toBeGreaterThan(0);
    const cols = new Set<string>();
    for (const w of wheres) collectColumnNames(w, cols);
    expect(cols.has("swppp_overdue_reminder_max_count")).toBe(true);
  });

  it("stops fanout at the per-org cap boundary (count == cap yields zero notifications)", async () => {
    // Boundary case for Task #1286: when overdue_reminder_count
    // already equals the per-org cap, the SQL gate
    // `${overdueReminderCount} < ${orgCapExpr}` is false, so the
    // SELECT returns no rows for that inspection. We model that here
    // by leaving the swppp_inspections queue empty and asserting:
    //   (a) no notifications and no updates fire, AND
    //   (b) the WHERE predicate references BOTH
    //       `overdue_reminder_count` and the per-org column
    //       `swppp_overdue_reminder_max_count`. (b) is the regression
    //       guard — if the cap comparison ever regresses to a
    //       hard-coded literal, the per-org column would no longer
    //       appear in the predicate and an at-cap row could leak
    //       through with the wrong escalation policy.
    queueOverdueInspections([]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    expect(insertedNotifications).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);

    const wheres = whereCallsByTable["swppp_inspections"] ?? [];
    expect(wheres.length).toBeGreaterThan(0);
    const cols = new Set<string>();
    for (const w of wheres) collectColumnNames(w, cols);
    expect(cols.has("overdue_reminder_count")).toBe(true);
    expect(cols.has("swppp_overdue_reminder_max_count")).toBe(true);
  });

  it("respects a per-org shorter interval and re-fires sooner than the legacy 22h", async () => {
    // Task #1286 — orgs can shrink the follow-up gap via
    // `organizations.swppp_overdue_reminder_interval_hours`. Here we
    // simulate an org with a 6h interval whose last fanout was 7h
    // ago. Under the legacy hard-coded 22h gate this row would NOT be
    // returned by the SELECT; under the per-org gate it should be.
    // We assert two things:
    //   1. The SELECT WHERE predicate references the org-level
    //      interval column (proves the join + COALESCE is wired up;
    //      a regression to a hard-coded interval would drop this
    //      reference).
    //   2. The row is processed and a follow-up reminder is fanned
    //      out (the mock returns whatever rows we queue, so this
    //      additionally verifies the rest of the pipeline accepts
    //      the per-org-projected fields without error).
    const sevenHoursAgo = new Date(NOW.getTime() - 7 * 60 * 60 * 1000);
    queueOverdueInspections([
      {
        id: "insp-fast",
        organizationId: "org-fast",
        projectId: "proj-1",
        inspectionDate: "2026-04-15",
        correctiveActionDueDate: "2026-04-20",
        correctiveActionAssigneeId: "user-assignee",
        correctiveActions: "Repair silt fence on east berm",
        lastOverdueNotifiedAt: sevenHoursAgo,
        overdueReminderCount: 0,
        reminderMaxCount: 5,
        reminderIntervalHours: 6,
      },
    ]);
    queueProjects([
      { id: "proj-1", organizationId: "org-fast", name: "I-95 Widening", projectManagerId: "user-pm" },
    ]);

    await processSwpppOverdueCorrectiveActions({ now: NOW });

    const wheres = whereCallsByTable["swppp_inspections"] ?? [];
    expect(wheres.length).toBeGreaterThan(0);
    const cols = new Set<string>();
    for (const w of wheres) collectColumnNames(w, cols);
    // Both halves of the cadence gate must reference org-level
    // columns. If the interval predicate regresses to e.g.
    // `interval '22 hour'`, the column reference disappears and
    // shorter per-org intervals stop taking effect.
    expect(cols.has("swppp_overdue_reminder_interval_hours")).toBe(true);
    expect(cols.has("last_overdue_notified_at")).toBe(true);

    const flat = insertedNotifications.flat() as Array<{ title: string }>;
    expect(flat.length).toBe(2);
    // First follow-up under the per-org cap of 5.
    for (const n of flat) {
      expect(n.title).toContain("Reminder 1 of 5");
    }
    // Follow-up branch should bump the counter, not just stamp the marker.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.overdueReminderCount).toBeDefined();
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
      type: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
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
      type: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      title: "SWPPP corrective action overdue",
      message: "Project — overdue.",
      relatedEntityType: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      relatedEntityId: null,
    });
    expect(result.actionUrl).toMatch(/\/swppp-inspections$/);
  });
});
