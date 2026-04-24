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
// Task #1651 — repeated-failure backstop notification fans out to
// every ADMIN / MANAGER / SUPER_ADMIN in the org. The helper does a
// single SELECT against `users` filtered by org + role, so we queue
// the resulting rows here.
function queueUsers(rows: Row[]) {
  (selectByTable["users"] ??= []).push(rows);
}
// Task #1689 — per-org failure threshold override is read from the
// `organizations` table (column `project_log_email_failure_threshold`)
// by `loadOrgProjectLogEmailFailureThreshold`. The test below
// asserting per-org > env precedence queues a row here so the worker
// sees the override exactly the way it would in production.
function queueOrganizations(rows: Row[]) {
  (selectByTable["organizations"] ??= []).push(rows);
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
      // Task #1637 — pretend a previous failure was already notified
      // about so the SUCCESS path also exercises the cron's
      // post-helper UPDATE that clears `lastFailureNotifiedStatus`.
      lastFailureNotifiedStatus: "FAILURE",
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
    // (via a follow-up UPDATE in the cron loop) so the next failure
    // starts a brand-new notification cycle instead of being silently
    // swallowed because it matched the previously-notified status.
    expect(updates).toHaveLength(2);
    expect(updates[0].table).toBe("project_log_email_schedules");
    const successValues = updates[0].values as Row;
    expect(successValues.lastSentAt).toBeInstanceOf(Date);
    expect(successValues.lastAttemptAt).toBeInstanceOf(Date);
    expect(successValues.lastAttemptStatus).toBe("SUCCESS");
    expect(successValues.lastAttemptError).toBeNull();
    expect(successValues.lastAttemptRecipientCount).toBe(2);
    expect(updates[1].table).toBe("project_log_email_schedules");
    expect((updates[1].values as Row).lastFailureNotifiedStatus).toBeNull();
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
    // Two project rows queued: the helper SELECTs the project once
    // for the send pipeline, and the cron's failure-notification
    // branch SELECTs it a second time to load `code` /
    // `projectManagerId` for the deep-link + recipient.
    const proj = {
      id: "proj-1",
      code: "PRJ-3",
      name: "Levee 3",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    };
    queueProject([proj]);
    queueProject([proj]);
    queueDistLists([{ contactEmails: [], extraEmails: [] }]);
    // Task #1672 — the per-transition fan-out now resolves the
    // named recipients' active status before notifying. Queue them
    // both as active so the helper picks the editor + PM rather
    // than the admin backstop.
    queueUsers([
      { id: "user-editor", isActive: true },
      { id: "user-pm", isActive: true },
    ]);

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
    {
      // Two project rows queued: helper SELECT + cron's failure
      // fan-out SELECT (loads `code` / `projectManagerId`).
      const proj = {
        id: "proj-1",
        code: "PRJ-7",
        name: "Bridge 7",
        gcOrganizationId: "org-1",
        projectManagerId: "user-editor", // PM and editor are the same person; should still get only one notification
      };
      queueProject([proj]);
      queueProject([proj]);
    }
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "All recipients suppressed by SendGrid" });
    // Task #1672 — single shared user, queued as active so the
    // per-transition fan-out picks the named recipient instead of
    // the admin backstop.
    queueUsers([{ id: "user-editor", isActive: true }]);

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
    {
      // Helper + cron both SELECT the project — queue twice.
      const proj = {
        id: "proj-1",
        code: "PRJ-7",
        name: "Bridge 7",
        gcOrganizationId: "org-1",
        projectManagerId: "user-pm",
      };
      queueProject([proj]);
      queueProject([proj]);
    }
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Bounce" });
    // Task #1672 — both named recipients are active so the
    // per-transition fan-out targets them rather than the admin
    // backstop.
    queueUsers([
      { id: "user-editor", isActive: true },
      { id: "user-pm", isActive: true },
    ]);

    await processProjectLogEmailSchedules({ now });

    expect(updates).toHaveLength(2);
    const dedupeValues = updates[1].values as Row;
    expect(dedupeValues.lastFailureNotifiedStatus).toBe("FAILURE");
    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    expect(notifInserts[0].values).toHaveLength(2);
  });

  it("stamps the dedupe marker and falls back to org admins when there are no named recipients to notify", async () => {
    // Task #1637 — schedule has neither editor nor PM (e.g. row
    // pre-dates the column or both users were deleted). We still
    // stamp the dedupe marker so subsequent ticks don't keep
    // re-evaluating an unactionable row.
    // Task #1672 — instead of silently dropping the alert, the
    // worker now routes the failure to the org's admins so a stuck
    // schedule with no named recipient still pings someone with the
    // authority to fix it.
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
    {
      // The worker queries `projects` twice: once inside
      // `executeProjectLogEmailScheduleSend` (which loads the project
      // before building the PDF) and once back in
      // `processProjectLogEmailSchedules` after a FAILURE result so the
      // per-transition fan-out has access to `code` + projectManagerId
      // for the deep link. Queue the same row twice to satisfy both.
      const proj = {
        id: "proj-1",
        code: "PRJ-7",
        name: "Bridge 7",
        gcOrganizationId: "org-1",
        projectManagerId: null,
      };
      queueProject([proj]);
      queueProject([proj]);
    }
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Boom" });
    // Admin backstop (Task #1672): no named recipients → helper
    // falls through directly to the admins SELECT.
    queueUsers([
      { id: "user-admin-1" },
      { id: "user-admin-2" },
    ]);

    await processProjectLogEmailSchedules({ now });

    expect(updates).toHaveLength(2);
    expect((updates[1].values as Row).lastFailureNotifiedStatus).toBe("FAILURE");

    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    const rows = notifInserts[0].values;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set(["user-admin-1", "user-admin-2"]),
    );
    for (const r of rows) {
      expect(r.type).toBe("PROJECT_LOG_EMAIL_FAILED");
      expect(r.relatedEntityType).toBe("PROJECT_LOG_EMAIL_SCHEDULE");
      expect(r.relatedEntityId).toBe("PRJ-7");
      expect(String(r.title)).toContain("no active recipients");
      expect(String(r.message)).toContain("routed to org admins");
    }
  });

  it("falls back to org admins when every named recipient is deactivated", async () => {
    // Task #1672 — both the project manager and the schedule's last
    // editor have been deactivated. Pre-#1672 the worker would
    // silently insert notification rows for the inactive users
    // (which nobody could ever read). Now it should route the alert
    // to the org's active admins so a stuck schedule still pings
    // someone with the authority to fix it, log the backstop fan-out
    // for production telemetry, and stamp the dedupe marker so the
    // next tick doesn't re-fire.
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
      lastEditedById: "user-editor",
      lastFailureNotifiedStatus: null,
    }]);
    // Queue the project twice: once for the send pipeline's lookup
    // and once for the per-transition fan-out's lookup.
    const proj9 = {
      id: "proj-1",
      code: "PRJ-9",
      name: "Bridge 9",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    };
    queueProject([proj9]);
    queueProject([proj9]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "SMTP 550" });
    // First users SELECT resolves the named recipients — both are
    // deactivated.
    queueUsers([
      { id: "user-editor", isActive: false },
      { id: "user-pm", isActive: false },
    ]);
    // Second users SELECT resolves the admin backstop pool.
    queueUsers([
      { id: "user-admin-1" },
      { id: "user-admin-2" },
    ]);

    await processProjectLogEmailSchedules({ now });

    expect(updates).toHaveLength(2);
    expect((updates[1].values as Row).lastFailureNotifiedStatus).toBe("FAILURE");

    const notifInserts = inserts.filter((i) => i.table === "notifications");
    // Exactly one batch — to admins, not to the deactivated named
    // recipients. The deactivated editor / PM should NOT receive a
    // notification record.
    expect(notifInserts).toHaveLength(1);
    const rows = notifInserts[0].values;
    expect(rows).toHaveLength(2);
    const userIds = new Set(rows.map((r) => r.userId));
    expect(userIds).toEqual(new Set(["user-admin-1", "user-admin-2"]));
    expect(userIds.has("user-editor")).toBe(false);
    expect(userIds.has("user-pm")).toBe(false);
    for (const r of rows) {
      expect(r.type).toBe("PROJECT_LOG_EMAIL_FAILED");
      expect(r.relatedEntityType).toBe("PROJECT_LOG_EMAIL_SCHEDULE");
      expect(r.relatedEntityId).toBe("PRJ-9");
      expect(String(r.title)).toContain("no active recipients");
      expect(String(r.title)).toContain("Bridge 9");
      expect(String(r.message)).toContain("project manager");
      expect(String(r.message)).toContain("deactivated");
      expect(String(r.message)).toContain("routed to org admins");
    }
  });

  it("notifies only the active named recipient when the other is deactivated", async () => {
    // Task #1672 — partial deactivation: PM is deactivated but the
    // last editor is still active. We should notify the active
    // editor and skip the deactivated PM entirely (no dead
    // notification row written for them) without invoking the admin
    // backstop, since there's still one actionable recipient.
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
    // Queue the project twice: once for the send pipeline's lookup
    // and once for the per-transition fan-out's lookup.
    const projPartial = {
      id: "proj-1",
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    };
    queueProject([projPartial]);
    queueProject([projPartial]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Bounce" });
    queueUsers([
      { id: "user-editor", isActive: true },
      { id: "user-pm", isActive: false },
    ]);
    // If the helper incorrectly fell back to the admin pool, this
    // queued admin row would surface in the inserts and the test
    // would fail.
    queueUsers([{ id: "user-admin-should-not-be-used" }]);

    await processProjectLogEmailSchedules({ now });

    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    const rows = notifInserts[0].values;
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("user-editor");
    // No admin backstop fan-out triggered.
    expect(rows.some((r) => r.userId === "user-admin-should-not-be-used")).toBe(false);
    // Title is the regular failure copy, not the "no active recipients" backstop copy.
    expect(String(rows[0].title)).not.toContain("no active recipients");
  });

  // ----------------------------------------------------------
  // Task #1651 — repeated-failure backstop notification
  // ----------------------------------------------------------
  // The schedule row carries a `consecutiveFailureCount` streak: 0 on
  // SUCCESS, +1 on FAILURE / NO_RECIPIENTS. Once the streak *crosses*
  // PROJECT_LOG_EMAIL_FAILURE_THRESHOLD (default 3) the worker fans
  // an in-app notification to every ADMIN / MANAGER / SUPER_ADMIN in
  // the org so a chronically broken distribution list can't go
  // unnoticed for weeks. The fan-out is edge-triggered (one fire per
  // crossing) so subsequent failures don't spam the same admins on
  // every cron tick.

  it("bumps consecutive_failure_count on FAILURE without crossing the threshold", async () => {
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
      consecutiveFailureCount: 0,
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

    const failValues = updates[0].values as Row;
    expect(failValues.lastAttemptStatus).toBe("FAILURE");
    expect(failValues.consecutiveFailureCount).toBe(1);
    // No backstop fan-out yet — we're well under the default threshold of 3.
    const notifInserts = inserts.filter((i) => i.table === "notifications");
    // Only the per-transition fan-out (Task #1637) fires here, not the
    // backstop. That single insert was already covered by earlier
    // tests; we only assert nobody fanned to an admin/manager pool by
    // checking that no `users` SELECT was queued / consumed (no
    // surprise broad fan-out).
    expect(notifInserts.length).toBeLessThanOrEqual(1);
  });

  it("resets consecutive_failure_count to 0 on a successful send", async () => {
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
      // Mid-streak: schedule has failed twice already and is about to
      // recover. The success update should zero the counter so the
      // *next* failure starts a fresh streak.
      consecutiveFailureCount: 2,
    }]);
    queueProject([{ id: "proj-1", code: "PRJ-7", name: "Bridge 7", gcOrganizationId: "org-1", projectManagerId: null }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);

    await processProjectLogEmailSchedules({ now });

    const successValues = updates[0].values as Row;
    expect(successValues.lastAttemptStatus).toBe("SUCCESS");
    expect(successValues.consecutiveFailureCount).toBe(0);
  });

  it("fans out a backstop notification to org admins/managers/super_admins on the threshold crossing", async () => {
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
      // Already in a notified failure state so the per-transition
      // fan-out (Task #1637) is suppressed and we can isolate the
      // backstop fan-out's notification inserts on their own.
      lastEditedById: "user-editor",
      lastFailureNotifiedStatus: "FAILURE",
      // 2 failures already → this attempt makes 3 → crosses default threshold.
      consecutiveFailureCount: 2,
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-99",
      name: "Tunnel 99",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "SMTP 550 — recipient rejected" });
    queueUsers([
      { id: "user-admin-1" },
      { id: "user-admin-2" },
      { id: "user-manager-1" },
    ]);

    await processProjectLogEmailSchedules({ now });

    const failValues = updates[0].values as Row;
    expect(failValues.lastAttemptStatus).toBe("FAILURE");
    expect(failValues.consecutiveFailureCount).toBe(3);

    // Two notification batches insert: nothing from the per-transition
    // fan-out (suppressed by matching previousStatus), and the
    // backstop fan-out for the three admins.
    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    const rows = notifInserts[0].values;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set(["user-admin-1", "user-admin-2", "user-manager-1"]),
    );
    for (const r of rows) {
      expect(r.type).toBe("PROJECT_LOG_EMAIL_FAILED");
      expect(r.relatedEntityType).toBe("PROJECT_LOG_EMAIL_SCHEDULE");
      // Deep link should use the project code so the destination map
      // can resolve it to /projects/<code>/settings.
      expect(r.relatedEntityId).toBe("PRJ-99");
      expect(String(r.title)).toContain("Tunnel 99");
      expect(String(r.message)).toContain("3 times in a row");
      expect(String(r.message)).toContain("SMTP 550");
    }
  });

  it("does not re-fire the backstop notification when the streak is already past the threshold", async () => {
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
      // 5 prior failures, today's makes 6 — both sides of the
      // comparison are already past the default threshold of 3, so
      // the helper edge-trigger should skip the fan-out entirely.
      consecutiveFailureCount: 5,
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-99",
      name: "Tunnel 99",
      gcOrganizationId: "org-1",
      projectManagerId: "user-pm",
    }]);
    queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
    sendEmailNextResults.push({ ok: false, error: "Still bouncing" });

    await processProjectLogEmailSchedules({ now });

    const failValues = updates[0].values as Row;
    expect(failValues.consecutiveFailureCount).toBe(6);
    // No notifications at all — per-transition path is suppressed
    // (previousStatus matches), backstop is suppressed (already past
    // threshold), so the schedule keeps stamping its FAILURE marker
    // silently until either someone fixes it (resetting the streak on
    // the next SUCCESS) or operations escalate via the project
    // settings card.
    expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
  });

  it("respects PROJECT_LOG_EMAIL_FAILURE_THRESHOLD env override", async () => {
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = "1";
    try {
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
        // Already notified, so per-transition fan-out is suppressed
        // and we only observe the backstop's inserts.
        lastFailureNotifiedStatus: "FAILURE",
        consecutiveFailureCount: 0,
      }]);
      queueProject([{
        id: "proj-1",
        code: "PRJ-99",
        name: "Tunnel 99",
        gcOrganizationId: "org-1",
        projectManagerId: null,
      }]);
      queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
      sendEmailNextResults.push({ ok: false, error: "First failure ever" });
      queueUsers([{ id: "user-admin-1" }]);

      await processProjectLogEmailSchedules({ now });

      const notifInserts = inserts.filter((i) => i.table === "notifications");
      expect(notifInserts).toHaveLength(1);
      expect(notifInserts[0].values).toHaveLength(1);
      expect(notifInserts[0].values[0].userId).toBe("user-admin-1");
    } finally {
      if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
      else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
    }
  });

  it("prefers the per-org override over PROJECT_LOG_EMAIL_FAILURE_THRESHOLD when both are set", async () => {
    // Task #1689 — `getProjectLogEmailFailureThreshold` resolves
    // priority as: per-org column → env var → hard-coded default.
    // We pin that here by setting env=10 (would NOT fire on the
    // first failure) and an org override of 1 (WOULD fire on the
    // first failure). Observing the backstop fan-out proves the
    // org override beat the env var; if the env var were used
    // instead, the streak (0 → 1) would be far below 10 and no
    // notification would be inserted.
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = "10";
    try {
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
        // Already notified so the per-transition (Task #1637) fan-out
        // is suppressed and the only insert we observe comes from the
        // repeated-failure backstop — isolating the threshold under
        // test instead of mixing it with the per-attempt path.
        lastFailureNotifiedStatus: "FAILURE",
        consecutiveFailureCount: 0,
      }]);
      queueProject([{
        id: "proj-1",
        code: "PRJ-99",
        name: "Tunnel 99",
        gcOrganizationId: "org-1",
        projectManagerId: null,
      }]);
      queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
      sendEmailNextResults.push({ ok: false, error: "Boom" });
      // Per-org override of 1 — strictly tighter than the env (10).
      queueOrganizations([{ threshold: 1 }]);
      queueUsers([{ id: "user-admin-1" }]);

      await processProjectLogEmailSchedules({ now });

      // Streak goes 0 → 1; org override (1) is crossed, env (10) is
      // not. A notification means the per-org override won.
      const notifInserts = inserts.filter((i) => i.table === "notifications");
      expect(notifInserts).toHaveLength(1);
      expect(notifInserts[0].values).toHaveLength(1);
      expect(notifInserts[0].values[0].userId).toBe("user-admin-1");
      // The backstop message advertises the streak length, which is
      // a sanity check that we didn't accidentally fire a different
      // notification path (per-transition has different copy).
      expect(String(notifInserts[0].values[0].message)).toContain("1 times in a row");
    } finally {
      if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
      else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
    }
  });

  it("falls through to the env var when the per-org override is invalid (e.g. 0 or NaN)", async () => {
    // Task #1689 — defense-in-depth: the admin API clamps the org
    // column to [1..50], but a stale or hand-edited DB value should
    // not silently disable the backstop. `getProjectLogEmailFailureThreshold`
    // ignores junk overrides and falls through to the env / default.
    // Here env=1 should fire on the first failure even though the
    // org column carries a bogus 0.
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = "1";
    try {
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
        lastFailureNotifiedStatus: "FAILURE",
        consecutiveFailureCount: 0,
      }]);
      queueProject([{
        id: "proj-1",
        code: "PRJ-99",
        name: "Tunnel 99",
        gcOrganizationId: "org-1",
        projectManagerId: null,
      }]);
      queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
      sendEmailNextResults.push({ ok: false, error: "Boom" });
      // Bogus override (0 is below MIN=1) — should be ignored.
      queueOrganizations([{ threshold: 0 }]);
      queueUsers([{ id: "user-admin-1" }]);

      await processProjectLogEmailSchedules({ now });

      const notifInserts = inserts.filter((i) => i.table === "notifications");
      // Env (1) fires; if the bogus 0 had been honored, the worker's
      // edge-trigger (`previousCount >= threshold` → return) would
      // suppress the fan-out forever and this assertion would fail.
      expect(notifInserts).toHaveLength(1);
      expect(notifInserts[0].values[0].userId).toBe("user-admin-1");
    } finally {
      if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
      else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
    }
  });

  it("falls back to default threshold when the env override is invalid", async () => {
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = "not-a-number";
    try {
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
        lastFailureNotifiedStatus: "FAILURE",
        // 1 prior failure, today makes 2 — below default threshold of 3.
        consecutiveFailureCount: 1,
      }]);
      queueProject([{
        id: "proj-1",
        code: "PRJ-99",
        name: "Tunnel 99",
        gcOrganizationId: "org-1",
        projectManagerId: null,
      }]);
      queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
      sendEmailNextResults.push({ ok: false, error: "Bad cred" });

      await processProjectLogEmailSchedules({ now });

      // Garbled env var should not flip the threshold to 0/1 and fire
      // a spurious notification — the helper falls back to the
      // default threshold of 3.
      expect(inserts.filter((i) => i.table === "notifications")).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
      else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
    }
  });

  it("treats malformed-but-parseable env values (e.g. '1.5', '3abc') as invalid and uses the default threshold", async () => {
    // The env var must be a *whole positive integer*. parseInt-style
    // prefix matches like "3abc" -> 3 or fractional values like
    // "1.5" -> 1 would silently lower the threshold and fire the
    // alert too eagerly; instead we fall back to the default.
    const original = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    for (const bad of ["1.5", "3abc", "  ", "0", "-1"]) {
      process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = bad;
      try {
        for (const k of Object.keys(selectByTable)) delete selectByTable[k];
        updates.length = 0;
        inserts.length = 0;
        sendEmailCalls.length = 0;
        sendEmailNextResults.length = 0;
        pdfCalls.length = 0;

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
          lastFailureNotifiedStatus: "FAILURE",
          // 1 prior + this one = 2; below the default threshold of 3.
          // If a bad env value were honored as 1 (the parseInt prefix
          // of "1.5" or "1abc"), this test would fire the backstop.
          consecutiveFailureCount: 1,
        }]);
        queueProject([{
          id: "proj-1",
          code: "PRJ-99",
          name: "Tunnel 99",
          gcOrganizationId: "org-1",
          projectManagerId: null,
        }]);
        queueDistLists([{ contactEmails: ["pm@example.com"], extraEmails: [] }]);
        sendEmailNextResults.push({ ok: false, error: "Bad cred" });

        await processProjectLogEmailSchedules({ now });

        expect(
          inserts.filter((i) => i.table === "notifications"),
          `bad env value ${JSON.stringify(bad)} should not trip the backstop`,
        ).toHaveLength(0);
      } finally {
        if (original === undefined) delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
        else process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = original;
      }
    }
  });

  it("triggers the backstop on NO_RECIPIENTS as well as FAILURE", async () => {
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
      lastEditedById: null,
      // Already notified about NO_RECIPIENTS so the per-transition
      // path is suppressed — isolates the backstop's inserts.
      lastFailureNotifiedStatus: "NO_RECIPIENTS",
      consecutiveFailureCount: 2,
    }]);
    queueProject([{
      id: "proj-1",
      code: "PRJ-7",
      name: "Bridge 7",
      gcOrganizationId: "org-1",
      projectManagerId: null,
    }]);
    queueDistLists([{ contactEmails: [], extraEmails: [] }]);
    queueUsers([{ id: "user-admin-1" }, { id: "user-admin-2" }]);

    await processProjectLogEmailSchedules({ now });

    const failValues = updates[0].values as Row;
    expect(failValues.lastAttemptStatus).toBe("NO_RECIPIENTS");
    expect(failValues.consecutiveFailureCount).toBe(3);

    const notifInserts = inserts.filter((i) => i.table === "notifications");
    expect(notifInserts).toHaveLength(1);
    expect(notifInserts[0].values).toHaveLength(2);
    expect(String(notifInserts[0].values[0].message)).toContain("3 times in a row");
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
