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
// Task #1637 — captured `db.insert(...).values(...)` calls so tests can
// assert the new failure-notification fan-out. Existing Task #1606
// behaviour didn't insert anything via the worker, so the old mock
// returned a fire-and-forget no-op; the new mock has to also support
// `.returning()` because `insertNotifications` reads back the inserted
// rows to feed `deliverNotification` (mocked separately).
const inserts: Array<{ table: string; values: Row[] }> = [];

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: (t: unknown) => {
    const table = tableName(t);
    return {
      values: (vals: Row | Row[]) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        inserts.push({ table, values: arr });
        const stamped = arr.map((v, i) => ({ id: `${table}-insert-${i}`, ...v }));
        const thenable: PromiseLike<unknown> & { returning: () => Promise<Row[]> } = {
          returning: async () => stamped,
          then: (resolve, reject) => Promise.resolve(undefined).then(resolve, reject),
        };
        return thenable;
      },
    };
  },
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

// Task #1637 — `insertNotifications` (used by the failure fan-out)
// schedules `deliverNotification` via `setImmediate`. Mock the
// delivery side to a no-op so the in-flight delivery doesn't try to
// touch the real SendGrid transport / DB during the test (the inserts
// themselves are still observed via the `inserts` array on dbMock).
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

const sendEmailCalls: Array<Record<string, unknown>> = [];
// Task #1622 — `processProjectLogEmailSchedules` now uses
// `sendEmailWithResult` so it can persist the failure reason on the
// schedule row. The mock here lets tests force a failure by pushing
// onto `sendEmailNextResults`.
const sendEmailNextResults: Array<{ ok: boolean; error?: string; recipientCount?: number }> = [];
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async (opts: Record<string, unknown>) => {
    sendEmailCalls.push(opts);
    return true;
  }),
  sendEmailWithResult: vi.fn(async (opts: Record<string, unknown>) => {
    sendEmailCalls.push(opts);
    const recipients = Array.isArray(opts.to) ? (opts.to as string[]).length : 1;
    if (sendEmailNextResults.length > 0) {
      const next = sendEmailNextResults.shift()!;
      return { ok: next.ok, error: next.error, recipientCount: next.recipientCount ?? recipients };
    }
    return { ok: true, recipientCount: recipients };
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
  inserts.length = 0;
  sendEmailCalls.length = 0;
  sendEmailNextResults.length = 0;
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
      lastEditedById: null,
      lastFailureNotifiedStatus: null,
    }]);
    queueProject([{ id: "proj-1", code: "PRJ-7", name: "Bridge 7", gcOrganizationId: "org-1", projectManagerId: null }]);
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

    // lastSentAt was stamped on project_log_email_schedules. Task #1622
    // also stamps the per-attempt outcome (status=SUCCESS, no error,
    // recipient count) so the project settings UI can report it.
    // Task #1637 — SUCCESS path also clears `lastFailureNotifiedStatus`
    // so the next failure starts a brand-new notification cycle
    // instead of being silently swallowed.
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("project_log_email_schedules");
    const successValues = updates[0].values as Row;
    expect(successValues.lastSentAt).toBeInstanceOf(Date);
    expect(successValues.lastAttemptAt).toBeInstanceOf(Date);
    expect(successValues.lastAttemptStatus).toBe("SUCCESS");
    expect(successValues.lastAttemptError).toBeNull();
    expect(successValues.lastAttemptRecipientCount).toBe(2);
    expect(successValues.lastFailureNotifiedStatus).toBeNull();
    // No fan-out on success.
    expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
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

  it("stamps NO_RECIPIENTS and notifies the editor + PM when no recipients resolve", async () => {
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
      // Task #1637 — exercise the failure fan-out: editor + PM both
      // present, no prior failure has been notified about, so the
      // worker should record a fresh notification per recipient.
      lastEditedById: "user-editor",
      lastFailureNotifiedStatus: null,
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-3",
      name: "Levee 3",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    }]);
    queueDistLists([{ contactEmails: [], extraEmails: [] }]);

    await processProjectLogEmailSchedules({ now });
    expect(sendEmailCalls).toHaveLength(0);
    expect(pdfCalls).toHaveLength(0);
    // Task #1622 — even though nothing went out, the worker stamps
    // NO_RECIPIENTS so the project settings UI can show admins that the
    // distribution lists are empty. `lastSentAt` is intentionally left
    // alone so cadence dedupe windows still treat the row as never-sent
    // and retry on the next firing.
    // Task #1637 — followed by a second update that stamps the
    // dedupe marker (lastFailureNotifiedStatus = NO_RECIPIENTS) so
    // the next tick won't re-fan the same notification.
    expect(updates).toHaveLength(2);
    expect(updates[0].table).toBe("project_log_email_schedules");
    const noRecipValues = updates[0].values as Row;
    expect(noRecipValues.lastSentAt).toBeUndefined();
    expect(noRecipValues.lastAttemptStatus).toBe("NO_RECIPIENTS");
    expect(noRecipValues.lastAttemptRecipientCount).toBe(0);
    expect(typeof noRecipValues.lastAttemptError).toBe("string");

    const dedupeValues = updates[1].values as Row;
    expect(dedupeValues.lastFailureNotifiedStatus).toBe("NO_RECIPIENTS");
    expect(dedupeValues.lastFailureNotifiedAt).toBeInstanceOf(Date);

    // One notification per deduped recipient, deep-linked to the
    // project's human-readable code.
    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    const rows = notifInserts[0].values;
    expect(rows).toHaveLength(2);
    const userIds = new Set(rows.map((r) => r.userId));
    expect(userIds).toEqual(new Set(["user-editor", "user-pm"]));
    for (const r of rows) {
      expect(r.type).toBe("PROJECT_LOG_EMAIL_FAILED");
      expect(r.relatedEntityType).toBe("PROJECT_LOG_EMAIL_SCHEDULE");
      expect(r.relatedEntityId).toBe("PRJ-3");
      expect(String(r.title)).toContain("Levee 3");
      expect(String(r.message)).toContain("Levee 3");
    }
  });

  it("records FAILURE with the provider error and fans out a notification when the email transport returns ok=false", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
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
      lastEditedById: "user-editor",
      lastFailureNotifiedStatus: null,
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: "org-1",
      projectManagerId: "user-editor", // PM and editor are the same person; should still get only one notification
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "All recipients suppressed by SendGrid" });

    await processProjectLogEmailSchedules({ now });

    expect(sendEmailCalls).toHaveLength(1);
    // lastSentAt is NOT stamped — we want the next cadence tick to try
    // again rather than believe today's send already happened.
    // Two updates: per-attempt FAILURE stamp + dedupe marker stamp.
    expect(updates).toHaveLength(2);
    const failValues = updates[0].values as Row;
    expect(failValues.lastSentAt).toBeUndefined();
    expect(failValues.lastAttemptStatus).toBe("FAILURE");
    expect(failValues.lastAttemptError).toBe("All recipients suppressed by SendGrid");
    expect(failValues.lastAttemptRecipientCount).toBe(1);
    expect(failValues.lastAttemptAt).toBeInstanceOf(Date);

    const dedupeValues = updates[1].values as Row;
    expect(dedupeValues.lastFailureNotifiedStatus).toBe("FAILURE");

    // Editor and PM are the same user — should only receive one
    // notification, not two.
    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    expect(notifInserts[0].values).toHaveLength(1);
    expect(notifInserts[0].values[0].userId).toBe("user-editor");
    expect(notifInserts[0].values[0].type).toBe("PROJECT_LOG_EMAIL_FAILED");
    expect(String(notifInserts[0].values[0].message)).toContain("All recipients suppressed by SendGrid");
  });

  it("dedupes the failure notification when the prior attempt already had the same status", async () => {
    // Task #1637 — same FAILURE status that was previously notified
    // about: the worker still stamps the per-attempt FAILURE marker
    // (so the project settings panel keeps showing "Last send
    // failed") but does NOT re-emit a notification for what is the
    // same persistent failure mode.
    const now = new Date("2026-04-20T08:00:00Z");
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
      lastEditedById: "user-editor",
      lastFailureNotifiedStatus: "FAILURE",
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Bounce again" });

    await processProjectLogEmailSchedules({ now });

    expect(updates).toHaveLength(1);
    expect((updates[0].values as Row).lastAttemptStatus).toBe("FAILURE");
    expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
  });

  it("re-notifies when the failure status transitions (e.g. NO_RECIPIENTS -> FAILURE)", async () => {
    // Task #1637 — even though the schedule was already in a notified
    // failure state, the new attempt represents a different failure
    // mode and is worth surfacing on its own.
    const now = new Date("2026-04-20T08:00:00Z");
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
      lastEditedById: "user-editor",
      lastFailureNotifiedStatus: "NO_RECIPIENTS",
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Bounce" });

    await processProjectLogEmailSchedules({ now });

    expect(updates).toHaveLength(2);
    const dedupeValues = updates[1].values as Row;
    expect(dedupeValues.lastFailureNotifiedStatus).toBe("FAILURE");
    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    expect(notifInserts[0].values).toHaveLength(2);
  });

  it("stamps the dedupe marker even when there are no recipients to notify", async () => {
    // Task #1637 — schedule has neither editor nor PM (e.g. row
    // pre-dates the column or both users were deleted). We still
    // stamp the dedupe marker so subsequent ticks don't keep
    // re-evaluating an unactionable row; the project settings panel
    // remains the source of truth for unattended failures.
    const now = new Date("2026-04-20T08:00:00Z");
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
      lastEditedById: null,
      lastFailureNotifiedStatus: null,
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: "org-1",
      projectManagerId: null,
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Boom" });

    await processProjectLogEmailSchedules({ now });

    expect(updates).toHaveLength(2);
    expect((updates[1].values as Row).lastFailureNotifiedStatus).toBe("FAILURE");
    expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
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
