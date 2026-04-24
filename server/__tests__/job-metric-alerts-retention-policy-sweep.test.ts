/**
 * Task #1502 — Per-job alert defaults for the
 * `retention_policy_sweep` cleanup job (cron `0 2 * * *`).
 *
 * The retention sweep hard-deletes rows past each org's configured
 * retention window. A misconfigured window or a buggy code path could
 * remove a large batch of rows in a single nightly tick, so this suite
 * verifies that the engine's built-in defaults (no operator-authored
 * row in `job_metric_alert_rules`) page Super Admins via SendGrid:
 *   1. when the sweep has been silent for >36h (stall — one full
 *      run-cadence has been missed); and
 *   2. when the `deleted` (or `hardDeleted`) counter spikes ≥5× its
 *      rolling baseline with at least 25 absolute deletions in the
 *      latest tick.
 *
 * Both cases must land an in-app notification AND a SendGrid email
 * for every active, opted-in Super Admin without anyone touching the
 * `job_metric_alert_rules` table. Mirrors the pattern in
 * `job-metric-alerts-wage-decision-orphan-sweep.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface SuperAdminRow {
  id: string;
  email: string;
  isActive: boolean;
  receivesJobMetricAlertEmails: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
  quietHoursWeekdays: number[] | null;
}

const state = {
  superAdmins: [] as SuperAdminRow[],
  insertedNotifications: [] as Array<Record<string, unknown>>,
  insertedEvents: [] as Array<Record<string, unknown>>,
  sendEmailCalls: [] as Array<{ to: string[]; subject: string; text?: string }>,
  sendEmailReturn: true,
};

const NAME_SYM = Symbol.for("drizzle:Name");
function tableNameOf(table: unknown): string {
  if (table && typeof table === "object") {
    const v = (table as Record<symbol, unknown>)[NAME_SYM];
    if (typeof v === "string") return v;
  }
  return "";
}

const dbMock = {
  insert: (_table: unknown) => ({
    values: (rowOrRows: unknown) => {
      const arr = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      for (const row of arr) {
        const r = row as Record<string, unknown>;
        if (r.userId && r.type) {
          state.insertedNotifications.push(r);
        } else if (r.kind && r.job) {
          state.insertedEvents.push(r);
        }
      }
      const rows = arr.map((row, i) => ({
        id: `n-${i}`,
        ...((row as object) ?? {}),
        createdAt: new Date(),
        readAt: null,
      }));
      const result: Record<string, unknown> = {
        returning: () => Promise.resolve(rows),
        then: (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(rows).then(onFulfilled),
      };
      return result;
    },
  }),
  select: (..._args: unknown[]) => {
    const dynamicChain: Record<string, unknown> = {};
    dynamicChain.from = (table: unknown) => {
      const tableName = tableNameOf(table);
      let rows: unknown[] = [];
      if (tableName === "job_metric_alert_rules") {
        rows = [];
      } else if (tableName === "job_metric_alert_events") {
        rows = [];
      } else if (tableName === "users") {
        rows = state.superAdmins.map((u) => ({
          id: u.id,
          email: u.email,
          isActive: u.isActive,
          receivesJobMetricAlertEmails: u.receivesJobMetricAlertEmails,
          quietHoursEnabled: u.quietHoursEnabled,
          quietHoursStart: u.quietHoursStart,
          quietHoursEnd: u.quietHoursEnd,
          quietHoursTimezone: u.quietHoursTimezone,
          quietHoursWeekdays: u.quietHoursWeekdays,
        }));
      }
      const innerChain: Record<string, unknown> = {};
      innerChain.where = (_cond: unknown) => innerChain;
      innerChain.orderBy = (..._args2: unknown[]) => Promise.resolve(rows);
      (innerChain as { then?: unknown }).then = (
        onFulfilled: (value: unknown) => unknown,
      ) => Promise.resolve(rows).then(onFulfilled);
      return innerChain;
    };
    return dynamicChain;
  },
  delete: (_table: unknown) => ({
    where: (_c: unknown) => ({ returning: async (_cols: unknown) => [] }),
  }),
  update: (_table: unknown) => ({
    set: (_values: Record<string, unknown>) => ({
      where: (_cond: unknown) => ({ returning: async () => [] }),
    }),
  }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(
    async (opts: { to: string | string[]; subject: string; text?: string }) => {
      const to = Array.isArray(opts.to) ? opts.to : [opts.to];
      state.sendEmailCalls.push({ to, subject: opts.subject, text: opts.text });
      return state.sendEmailReturn;
    },
  ),
}));

let alerts: typeof import("../utils/jobMetricAlerts");

beforeEach(async () => {
  state.superAdmins = [
    {
      id: "admin-1",
      email: "admin-1@example.com",
      isActive: true,
      receivesJobMetricAlertEmails: true,
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
      quietHoursWeekdays: null,
    },
    {
      id: "admin-2",
      email: "admin-2@example.com",
      isActive: true,
      receivesJobMetricAlertEmails: true,
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
      quietHoursWeekdays: null,
    },
  ];
  state.insertedNotifications = [];
  state.insertedEvents = [];
  state.sendEmailCalls = [];
  state.sendEmailReturn = true;
  alerts = await import("../utils/jobMetricAlerts");
  alerts.setJobMetricAlertsClockForTests(() => Date.now());
});

afterEach(() => {
  alerts.resetJobMetricAlertsClockForTests();
  vi.useRealTimers();
});

const HOUR = 60 * 60 * 1000;
const JOB = "retention_policy_sweep";

describe("jobMetricAlerts — retention_policy_sweep per-job defaults (Task #1502)", () => {
  it("exposes a 36h stall and `deleted`/`hardDeleted` spike overrides out of the box", () => {
    const cfg = alerts.PER_JOB_DEFAULTS[JOB];
    expect(cfg).toBeDefined();
    expect(cfg.stall?.thresholdHours).toBe(36);
    expect(cfg.stall?.dedupeMinutes).toBe(24 * 60);
    expect(cfg.stall?.emailWhenAboveHours).toBe(36);

    for (const counter of ["deleted", "hardDeleted"] as const) {
      expect(cfg.spikes?.[counter]?.multiplier).toBe(5);
      expect(cfg.spikes?.[counter]?.minAbsolute).toBe(25);
      expect(cfg.spikes?.[counter]?.dedupeMinutes).toBe(24 * 60);
      expect(cfg.spikes?.[counter]?.emailWhenAbove).toBe(25);
    }
  });

  it("does NOT fire a stall alert at 24h idle (between expected runs)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples = [
      { timestamp: now - 24 * HOUR, counters: { candidates: 3, deleted: 1 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { candidates: 3, deleted: 1 },
        },
      ],
    });

    expect(result.alertsFired).toHaveLength(0);
    expect(state.sendEmailCalls).toHaveLength(0);
  });

  it("fires a stall alert AND emails Super Admins when the sweep has missed a full run (>36h idle)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples = [
      { timestamp: now - 40 * HOUR, counters: { candidates: 2, deleted: 0 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { candidates: 2, deleted: 0 },
        },
      ],
    });

    const stalls = result.alertsFired.filter((a) => a.kind === "stall");
    expect(stalls).toHaveLength(1);
    expect(stalls[0].job).toBe(JOB);
    expect(stalls[0].emailed).toBe(true);

    expect(result.notifiedAdmins).toBe(2);
    expect(state.insertedNotifications).toHaveLength(2);

    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    expect(state.sendEmailCalls[0].to.slice().sort()).toEqual([
      "admin-1@example.com",
      "admin-2@example.com",
    ]);
    expect(state.sendEmailCalls[0].subject).toContain(JOB);
    expect(state.sendEmailCalls[0].subject.toLowerCase()).toContain("stalled");
  });

  it("fires a `deleted` spike alert AND emails Super Admins when deletions exceed 5x baseline with >=25 rows", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    // 23 prior hourly buckets averaging 2 deleted rows/hour so the
    // baseline is 2.0/hr — then a last-hour run with 200 deletions
    // clears both the 5× multiplier and the 25-absolute floor, and
    // also clears the email escalation threshold.
    const samples: Array<{
      timestamp: number;
      counters: Record<string, number>;
    }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({
        timestamp: now - i * HOUR - 1000,
        counters: { deleted: 2 },
      });
    }
    samples.push({ timestamp: now - 60_000, counters: { deleted: 200 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[samples.length - 1],
          totals: samples.reduce<Record<string, number>>((acc, s) => {
            for (const [k, v] of Object.entries(s.counters))
              acc[k] = (acc[k] ?? 0) + v;
            return acc;
          }, {}),
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "deleted",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].emailed).toBe(true);

    expect(result.notifiedAdmins).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    expect(state.sendEmailCalls[0].subject).toContain(JOB);
    expect(state.sendEmailCalls[0].subject).toContain("deleted");
  });

  it("fires a `hardDeleted` spike alert AND emails Super Admins when hard-deletions exceed 5x baseline with >=25 rows", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples: Array<{
      timestamp: number;
      counters: Record<string, number>;
    }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({
        timestamp: now - i * HOUR - 1000,
        counters: { hardDeleted: 2 },
      });
    }
    samples.push({ timestamp: now - 60_000, counters: { hardDeleted: 200 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[samples.length - 1],
          totals: samples.reduce<Record<string, number>>((acc, s) => {
            for (const [k, v] of Object.entries(s.counters))
              acc[k] = (acc[k] ?? 0) + v;
            return acc;
          }, {}),
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "hardDeleted",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].emailed).toBe(true);

    expect(result.notifiedAdmins).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    expect(state.sendEmailCalls[0].subject).toContain(JOB);
    expect(state.sendEmailCalls[0].subject).toContain("hardDeleted");
  });

  it("does NOT fire the `deleted` spike when only a handful of rows are deleted (below the absolute floor)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples: Array<{
      timestamp: number;
      counters: Record<string, number>;
    }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({
        timestamp: now - i * HOUR - 1000,
        counters: { deleted: 0 },
      });
    }
    // Latest run: 24 deletions — clears the 5× multiplier (baseline 0)
    // but stays below the 25-absolute floor. Should be quiet.
    samples.push({ timestamp: now - 60_000, counters: { deleted: 24 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[samples.length - 1],
          totals: { deleted: 24 },
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "deleted",
    );
    expect(spikes).toHaveLength(0);
    expect(state.sendEmailCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Task #1573 — `policiesUnsupported` absolute-floor spike alert
// ---------------------------------------------------------------------
// `policiesUnsupported` counts enabled retention policies whose
// `(entityType, action)` pair has no implementation in the sweep — they
// silently do nothing every night. The Task #1552 dashboard counter
// surfaces this, but operators can still leave a misconfigured no-op
// policy enabled for weeks. The absolute-floor spike rule (multiplier
// `0`, minAbsolute `1`) ensures any nightly run with `> 0` no-op
// policies pages Super Admins and includes the offending pairs the
// sweep stashed via `setRetentionPolicyUnsupportedPairsForAlerts`.
// ---------------------------------------------------------------------
describe("jobMetricAlerts — retention_policy_sweep `policiesUnsupported` (Task #1573)", () => {
  beforeEach(() => {
    // Each test seeds (or clears) the offender side-channel itself so a
    // pair from one case can't bleed into the next.
    alerts.setRetentionPolicyUnsupportedPairsForAlerts([]);
  });

  it("exposes a `policiesUnsupported` absolute-floor spike override out of the box", () => {
    const cfg = alerts.PER_JOB_DEFAULTS[JOB];
    expect(cfg.spikes?.policiesUnsupported).toBeDefined();
    // multiplier `0` is the new "absolute-floor only" semantic — the
    // engine skips the baseline comparison entirely so any run with at
    // least `minAbsolute` no-op policies pages.
    expect(cfg.spikes?.policiesUnsupported?.multiplier).toBe(0);
    expect(cfg.spikes?.policiesUnsupported?.minAbsolute).toBe(1);
    expect(cfg.spikes?.policiesUnsupported?.dedupeMinutes).toBe(24 * 60);
    // Email escalation matches the floor so the very first nightly run
    // with a no-op policy escalates to SendGrid.
    expect(cfg.spikes?.policiesUnsupported?.emailWhenAbove).toBe(1);
  });

  it("fires a `policiesUnsupported` spike alert AND emails Super Admins on the first run with `policiesUnsupported > 0`, even with zero baseline", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    // Mirror the sweep's side-channel publish that happens at the end of
    // a nightly run so the alert message can name the misconfigured
    // combos.
    alerts.setRetentionPolicyUnsupportedPairsForAlerts([
      { entityType: "NOTIFICATIONS", action: "DELETE" },
      { entityType: "AUDIT_LOGS", action: "ARCHIVE" },
    ]);
    // Single sample in the last hour with `policiesUnsupported: 2` and
    // no prior baseline — historically this would NOT have fired
    // (baseline === 0 short-circuits the spike rule). With the
    // absolute-floor rule it must fire on this very first tick.
    const samples = [
      {
        timestamp: now - 60_000,
        counters: { policiesUnsupported: 2, policiesProcessed: 1 },
      },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { policiesUnsupported: 2, policiesProcessed: 1 },
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "policiesUnsupported",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].emailed).toBe(true);
    // Message names the offending (entityType, action) pairs so
    // operators don't have to crack open the warning logs to find them.
    expect(spikes[0].message).toContain("NOTIFICATIONS/DELETE");
    expect(spikes[0].message).toContain("AUDIT_LOGS/ARCHIVE");
    // ...and avoids the "× baseline" verbiage from the multiplicative
    // spike rules — there is no baseline for this counter.
    expect(spikes[0].message).not.toContain("× baseline");

    expect(result.notifiedAdmins).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    expect(state.sendEmailCalls[0].subject).toContain(JOB);
    expect(state.sendEmailCalls[0].subject).toContain("policiesUnsupported");
    // The escalation copy in the email body must also avoid the
    // baseline phrasing for the absolute-floor rule.
    expect(state.sendEmailCalls[0].text ?? "").not.toContain("× baseline");
    // Offending pairs should ride along in the email body too.
    expect(state.sendEmailCalls[0].text ?? "").toContain(
      "NOTIFICATIONS/DELETE",
    );
  });

  it("does NOT fire when `policiesUnsupported` is 0 even though the counter has shown up before", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    // Yesterday saw 2 no-op policies; today the operator fixed them so
    // the latest tick reports `policiesUnsupported: 0`. The minAbsolute
    // floor is 1, so no alert should fire.
    const samples = [
      {
        timestamp: now - 24 * HOUR - 1000,
        counters: { policiesUnsupported: 2 },
      },
      {
        timestamp: now - 60_000,
        counters: { policiesUnsupported: 0, policiesProcessed: 3 },
      },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[samples.length - 1],
          totals: { policiesUnsupported: 2, policiesProcessed: 3 },
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "policiesUnsupported",
    );
    expect(spikes).toHaveLength(0);
    expect(state.sendEmailCalls).toHaveLength(0);
  });

  it("includes a clean message (no offender list) when the side-channel is empty but the counter is non-zero", async () => {
    // Edge case: the metrics sample shows a non-zero count but the
    // side-channel was never populated (e.g. a stale process restarted
    // between the sweep and the alert tick). The alert must still fire
    // — operators can still pull the offenders from the warning logs.
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    alerts.setRetentionPolicyUnsupportedPairsForAlerts([]);
    const samples = [
      {
        timestamp: now - 60_000,
        counters: { policiesUnsupported: 1 },
      },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { policiesUnsupported: 1 },
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "policiesUnsupported",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].message).not.toContain("Offending policies:");
  });

  it("renders pairs and a `+N more` suffix when the offender list is large enough to risk a runaway message", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    // 12 distinct pairs — the formatter should render the first 10 and
    // collapse the rest into "+2 more" so the message / email body
    // can't blow out under a runaway misconfig.
    const pairs = Array.from({ length: 12 }, (_, i) => ({
      entityType: `ENTITY_${i}`,
      action: "DELETE",
    }));
    alerts.setRetentionPolicyUnsupportedPairsForAlerts(pairs);
    const samples = [
      {
        timestamp: now - 60_000,
        counters: { policiesUnsupported: 12 },
      },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { policiesUnsupported: 12 },
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "policiesUnsupported",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].message).toContain("ENTITY_0/DELETE");
    expect(spikes[0].message).toContain("ENTITY_9/DELETE");
    expect(spikes[0].message).toContain("+2 more");
    // Pairs that were truncated should NOT appear individually.
    expect(spikes[0].message).not.toContain("ENTITY_10/DELETE");
    expect(spikes[0].message).not.toContain("ENTITY_11/DELETE");
  });
});
