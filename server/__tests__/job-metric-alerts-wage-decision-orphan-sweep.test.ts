/**
 * Task #1463 — Per-job alert defaults for the
 * `wage_decision_orphan_sweep` cleanup job.
 *
 * The orphan sweep runs as a side-effect of the wage-decision retry
 * sweep and publishes per-run counters via `recordJobMetrics`. A
 * misconfigured retention window or a buggy code path could delete an
 * unusually large batch of rows in a single tick, so this suite
 * verifies that the engine's built-in defaults (no operator-authored
 * row in `job_metric_alert_rules`) page Super Admins via SendGrid:
 *   1. when the sweep has been silent for >36h (stall — one full
 *      run-cadence has been missed); and
 *   2. when the `deleted` counter spikes ≥5× its rolling baseline
 *      with at least 10 absolute deletions in the latest tick.
 *
 * Both cases must land an in-app notification AND a SendGrid email
 * for every active, opted-in Super Admin without anyone touching the
 * `job_metric_alert_rules` table.
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
const JOB = "wage_decision_orphan_sweep";

describe("jobMetricAlerts — wage_decision_orphan_sweep per-job defaults (Task #1463)", () => {
  it("exposes a 36h stall and a `deleted`-counter spike override out of the box", () => {
    const cfg = alerts.PER_JOB_DEFAULTS[JOB];
    expect(cfg).toBeDefined();
    expect(cfg.stall?.thresholdHours).toBe(36);
    expect(cfg.stall?.emailWhenAboveHours).toBe(36);
    expect(cfg.spikes?.deleted?.multiplier).toBe(5);
    expect(cfg.spikes?.deleted?.minAbsolute).toBe(10);
    expect(cfg.spikes?.deleted?.emailWhenAbove).toBe(10);
    // Dedupe matches the once-daily natural cadence so a sustained
    // outage doesn't re-page on every 15-minute alert tick.
    expect(cfg.spikes?.deleted?.dedupeMinutes).toBe(24 * 60);
    expect(cfg.stall?.dedupeMinutes).toBe(24 * 60);
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

  it("fires a `deleted` spike alert AND emails Super Admins when deletions exceed 5x baseline with >=10 rows", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    // 23 prior hourly buckets averaging 1 deleted row/hour so the
    // baseline is 1.0/hr — then a last-hour run with 50 deletions
    // clears both the 5× multiplier and the 10-absolute floor, and
    // also clears the email escalation threshold.
    const samples: Array<{
      timestamp: number;
      counters: Record<string, number>;
    }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({
        timestamp: now - i * HOUR - 1000,
        counters: { deleted: 1 },
      });
    }
    samples.push({ timestamp: now - 60_000, counters: { deleted: 50 } });

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
    // Latest run: 9 deletions — clears the 5× multiplier (baseline 0)
    // but stays below the 10-absolute floor. Should be quiet.
    samples.push({ timestamp: now - 60_000, counters: { deleted: 9 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[samples.length - 1],
          totals: { deleted: 9 },
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
