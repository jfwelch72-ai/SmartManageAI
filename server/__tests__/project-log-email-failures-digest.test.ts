/**
 * Task #1715 — tests for the daily failures-digest fan-out
 * (`processProjectLogEmailFailuresDigest` in
 * `server/jobs/jobRunner.ts`).
 *
 * The function under test:
 *   - Pulls every schedule whose latest attempt status is FAILURE
 *     or NO_RECIPIENTS, joined with the project row for the row
 *     contents the email body renders.
 *   - Groups by org and, per-org:
 *       * Skips if today's digest was already sent (idempotency
 *         check against the notifications table).
 *       * Resolves recipients to active ADMIN / SUPER_ADMIN users.
 *       * Inserts one PROJECT_LOG_EMAIL_FAILURES_DIGEST notification
 *         per recipient with relatedEntityId = "YYYY-MM-DD" so the
 *         next run on the same day is a no-op.
 *
 * The db and notification service are mocked in-process so the suite
 * stays hermetic. Mirrors the shape used by
 * `project-log-email-schedule.test.ts`.
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

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
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

let processProjectLogEmailFailuresDigest:
  typeof import("../jobs/jobRunner")["processProjectLogEmailFailuresDigest"];

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  insertedNotifications.length = 0;
  ({ processProjectLogEmailFailuresDigest } = await import("../jobs/jobRunner"));
});

afterEach(() => {
  vi.useRealTimers();
});

function queueFailures(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}
function queueExistingDigest(rows: Row[]) {
  (selectByTable["notifications"] ??= []).push(rows);
}
function queueAdmins(rows: Row[]) {
  (selectByTable["users"] ??= []).push(rows);
}
// Task #1732 — per-org schedule overrides for the failures-digest
// fan-out are loaded in one round-trip after the failures sweep and
// before the per-org loop. Tests that don't queue an organizations
// row still exercise the column defaults (DAILY @ 08:00 UTC) via
// the in-handler fallback; this helper is for tests that want to
// pin a specific cadence/hour/weekday/timezone for an org.
function queueOrgSettings(rows: Row[]) {
  (selectByTable["organizations"] ??= []).push(rows);
}

const ORG_A = "org-aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "org-bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("processProjectLogEmailFailuresDigest", () => {
  it("does nothing when no schedules are currently failing", async () => {
    queueFailures([]);
    await processProjectLogEmailFailuresDigest({ now: new Date("2026-04-20T08:00:00Z") });
    expect(insertedNotifications).toHaveLength(0);
  });

  it("fans out a digest to every active ADMIN / SUPER_ADMIN in the org", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced (5.1.1)",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 4,
      },
      {
        scheduleId: "sched-2",
        organizationId: ORG_A,
        projectId: "proj-2",
        projectName: "Tower 9",
        projectCode: "TW-9",
        logType: "SUBMITTAL",
        cadence: "WEEKLY",
        lastAttemptAt: new Date("2026-04-18T08:00:00Z"),
        lastAttemptStatus: "NO_RECIPIENTS",
        lastAttemptError: "No recipients resolved",
        lastAttemptRecipientCount: 0,
        consecutiveFailureCount: 1,
      },
    ]);
    queueExistingDigest([]); // No prior digest today.
    queueAdmins([
      { id: "admin-1" },
      { id: "admin-2" },
    ]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(1);
    const batch = insertedNotifications[0] as Array<{
      userId: string;
      organizationId: string;
      type: string;
      title: string;
      message: string;
      relatedEntityType: string;
      relatedEntityId: string;
    }>;
    expect(batch.map((n) => n.userId).sort()).toEqual(["admin-1", "admin-2"]);
    for (const n of batch) {
      expect(n.organizationId).toBe(ORG_A);
      expect(n.type).toBe("PROJECT_LOG_EMAIL_FAILURES_DIGEST");
      expect(n.relatedEntityType).toBe("PROJECT_LOG_EMAIL_FAILURES_DIGEST");
      expect(n.relatedEntityId).toBe("2026-04-20");
      expect(n.title).toContain("2 schedules need attention");
      expect(n.message).toContain("Bridge 7 (BR-7)");
      expect(n.message).toContain("RFI log");
      expect(n.message).toContain("Tower 9 (TW-9)");
      expect(n.message).toContain("Submittal log");
      expect(n.message).toContain("no recipients");
      expect(n.message).toContain("4 consecutive failures");
      expect(n.message).toContain("Bounced (5.1.1)");
    }
  });

  it("skips an org whose digest already went out today (idempotency)", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 2,
      },
    ]);
    // Prior digest already exists for today — skip the fan-out.
    queueExistingDigest([{ id: "existing-digest-row" }]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(0);
  });

  it("groups failures per org and never crosses tenant boundaries", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-a",
        organizationId: ORG_A,
        projectId: "proj-a",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 1,
      },
      {
        scheduleId: "sched-b",
        organizationId: ORG_B,
        projectId: "proj-b",
        projectName: "Levee 3",
        projectCode: "LV-3",
        logType: "SUBMITTAL",
        cadence: "WEEKLY",
        lastAttemptAt: new Date("2026-04-18T08:00:00Z"),
        lastAttemptStatus: "NO_RECIPIENTS",
        lastAttemptError: "No recipients",
        lastAttemptRecipientCount: 0,
        consecutiveFailureCount: 1,
      },
    ]);
    // Org A: no digest yet today, has admins.
    queueExistingDigest([]);
    queueAdmins([{ id: "admin-A" }]);
    // Org B: no digest yet today, has admins.
    queueExistingDigest([]);
    queueAdmins([{ id: "admin-B" }]);

    await processProjectLogEmailFailuresDigest({ now });

    // Two batches, one per org, each with only that org's failures.
    expect(insertedNotifications).toHaveLength(2);
    const allNotifs = insertedNotifications.flat() as Array<{
      organizationId: string;
      userId: string;
      message: string;
    }>;
    const byOrg: Record<string, typeof allNotifs> = {};
    for (const n of allNotifs) {
      (byOrg[n.organizationId] ??= []).push(n);
    }
    expect(byOrg[ORG_A]).toHaveLength(1);
    expect(byOrg[ORG_A][0].userId).toBe("admin-A");
    expect(byOrg[ORG_A][0].message).toContain("Bridge 7");
    expect(byOrg[ORG_A][0].message).not.toContain("Levee 3");
    expect(byOrg[ORG_B]).toHaveLength(1);
    expect(byOrg[ORG_B][0].userId).toBe("admin-B");
    expect(byOrg[ORG_B][0].message).toContain("Levee 3");
    expect(byOrg[ORG_B][0].message).not.toContain("Bridge 7");
  });

  it("does not insert anything for an org that has no admins to notify", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 1,
      },
    ]);
    queueExistingDigest([]);
    queueAdmins([]); // Empty — nobody to notify.

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(0);
  });

  it("truncates the body when an org has more failing schedules than the per-org cap", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    const PER_ORG_CAP = 100;
    const overflowCount = 5;
    const total = PER_ORG_CAP + overflowCount;
    const rows: Row[] = [];
    for (let i = 0; i < total; i += 1) {
      rows.push({
        scheduleId: `sched-${i}`,
        organizationId: ORG_A,
        projectId: `proj-${i}`,
        projectName: `Project ${i}`,
        projectCode: `PR-${i}`,
        logType: i % 2 === 0 ? "RFI" : "SUBMITTAL",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 1,
        consecutiveFailureCount: 1,
      });
    }
    queueFailures(rows);
    queueExistingDigest([]);
    queueAdmins([{ id: "admin-1" }]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(1);
    const batch = insertedNotifications[0] as Array<{ message: string; title: string }>;
    expect(batch).toHaveLength(1);
    // Header reflects the *full* failure count, not the truncated one.
    expect(batch[0].title).toContain(`${total} schedules`);
    // Truncation footer surfaces the overflow so admins know to open
    // the dashboard for the rest.
    expect(batch[0].message).toContain(`…and ${overflowCount} more`);
    // The capped slice is rendered (last visible row is index 99).
    expect(batch[0].message).toContain("Project 99");
    // Items past the cap are not rendered inline (only the footer).
    expect(batch[0].message).not.toContain("Project 100 — ");
  });

  // -----------------------------------------------------------
  // Task #1732 — per-org schedule (cadence + weekday + hour + tz)
  // -----------------------------------------------------------
  // The handler is now invoked hourly; the per-org gate inside
  // decides which orgs (if any) actually fan out on each tick.
  // These cases lock in the gating behavior so a future refactor
  // can't silently regress it.

  it("skips orgs whose digest cadence is OFF", async () => {
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 2,
      },
    ]);
    queueOrgSettings([
      { id: ORG_A, cadence: "OFF", weekday: 1, hour: 8, timezone: "UTC" },
    ]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(0);
  });

  it("skips orgs when the current local hour does not match the configured hour", async () => {
    // Tick fires at 08:00 UTC but org wants the digest at 09:00 UTC.
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 2,
      },
    ]);
    queueOrgSettings([
      { id: ORG_A, cadence: "DAILY", weekday: 1, hour: 9, timezone: "UTC" },
    ]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(0);
  });

  it("respects the org's local timezone when gating on the configured hour", async () => {
    // 12:00 UTC is 08:00 in America/New_York during EDT (UTC-4 in
    // April). Org wants the digest at 08:00 NY time, so this tick
    // fires even though the server's UTC hour (12) is not 8.
    const now = new Date("2026-04-20T12:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 2,
      },
    ]);
    queueOrgSettings([
      { id: ORG_A, cadence: "DAILY", weekday: 1, hour: 8, timezone: "America/New_York" },
    ]);
    queueExistingDigest([]);
    queueAdmins([{ id: "admin-NY" }]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(1);
    const batch = insertedNotifications[0] as Array<{
      relatedEntityId: string;
      organizationId: string;
    }>;
    expect(batch[0].organizationId).toBe(ORG_A);
    // Local date in NY (UTC-4 during EDT) at 13:00 UTC is still
    // April 20th — dedupe key uses the *local* date so two orgs
    // in different zones can't accidentally share an entityId.
    expect(batch[0].relatedEntityId).toBe("2026-04-20");
  });

  it("only fires WEEKLY orgs on the configured weekday", async () => {
    // 2026-04-20 is a Monday (weekday=1). Org configured for Tuesday
    // (weekday=2) should be skipped even though hour matches.
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 2,
      },
    ]);
    queueOrgSettings([
      { id: ORG_A, cadence: "WEEKLY", weekday: 2, hour: 8, timezone: "UTC" },
    ]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(0);
  });

  it("fires WEEKLY orgs when the current local weekday matches", async () => {
    // 2026-04-20 is a Monday (weekday=1). Org configured for Monday.
    const now = new Date("2026-04-20T08:00:00Z");
    queueFailures([
      {
        scheduleId: "sched-1",
        organizationId: ORG_A,
        projectId: "proj-1",
        projectName: "Bridge 7",
        projectCode: "BR-7",
        logType: "RFI",
        cadence: "DAILY",
        lastAttemptAt: new Date("2026-04-19T08:00:00Z"),
        lastAttemptStatus: "FAILURE",
        lastAttemptError: "Bounced",
        lastAttemptRecipientCount: 3,
        consecutiveFailureCount: 2,
      },
    ]);
    queueOrgSettings([
      { id: ORG_A, cadence: "WEEKLY", weekday: 1, hour: 8, timezone: "UTC" },
    ]);
    queueExistingDigest([]);
    queueAdmins([{ id: "admin-1" }]);

    await processProjectLogEmailFailuresDigest({ now });

    expect(insertedNotifications).toHaveLength(1);
  });
});
