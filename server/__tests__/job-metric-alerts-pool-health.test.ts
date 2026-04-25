/**
 * Task #1957 — Per-job alert defaults for the synthetic `pool_health`
 * job populated by `server/utils/poolHealth.ts`.
 *
 * Two absolute-floor spike rules let Super Admins get paged the moment
 * the shared pg pool starts starving instead of needing to keep the
 * Job Metrics dashboard open:
 *
 *   1. `exhausted` — fires when the per-hour count of `pool_exhausted`
 *      events meets `POOL_HEALTH_EXHAUSTED_FLOOR_PER_HOUR` (default 1).
 *      Email escalation kicks in at the higher email floor (default 3)
 *      so a single transient blip pages in-app but a sustained outage
 *      also lands in operators' inboxes.
 *   2. `waitingSaturated` — fires whenever the periodic sampler has
 *      observed `waiting > 0` for several consecutive ticks. Floor of
 *      1 means any such episode pages immediately, with email
 *      escalation on the first episode too.
 *
 * Both rules must land an in-app notification AND a SendGrid email
 * for every active, opted-in Super Admin without anyone touching the
 * `job_metric_alert_rules` table. Mirrors the pattern in
 * `job-metric-alerts-retention-policy-sweep.test.ts`.
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
const JOB = "pool_health";

describe("jobMetricAlerts — pool_health per-job defaults (Task #1957)", () => {
  it("exposes absolute-floor spike rules on `exhausted` and `waitingSaturated`, plus a 1h stall", () => {
    const cfg = alerts.PER_JOB_DEFAULTS[JOB];
    expect(cfg).toBeDefined();

    // Stall: sampler runs every minute, so 1h silence is a real
    // problem (cron stopped, process hung).
    expect(cfg.stall?.thresholdHours).toBe(1);
    expect(cfg.stall?.dedupeMinutes).toBe(60);
    expect(cfg.stall?.emailWhenAboveHours).toBe(1);

    // `exhausted` is an absolute-floor rule (multiplier 0) so the
    // baseline-zero divide-by-zero guard doesn't silently swallow it.
    expect(cfg.spikes?.exhausted?.multiplier).toBe(0);
    expect(cfg.spikes?.exhausted?.minAbsolute).toBe(
      alerts.POOL_HEALTH_EXHAUSTED_FLOOR_PER_HOUR,
    );
    expect(cfg.spikes?.exhausted?.dedupeMinutes).toBe(60);
    expect(cfg.spikes?.exhausted?.emailWhenAbove).toBe(
      alerts.POOL_HEALTH_EXHAUSTED_EMAIL_FLOOR_PER_HOUR,
    );

    // `waitingSaturated` always pages — the consecutive-sample guard
    // already lives in `samplePoolHealth`, so any published event is
    // already a real saturation episode.
    expect(cfg.spikes?.waitingSaturated?.multiplier).toBe(0);
    expect(cfg.spikes?.waitingSaturated?.minAbsolute).toBe(1);
    expect(cfg.spikes?.waitingSaturated?.dedupeMinutes).toBe(60);
    expect(cfg.spikes?.waitingSaturated?.emailWhenAbove).toBe(1);
  });

  it("fires an `exhausted` spike alert AND emails Super Admins on the first event of the hour", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    // Single `exhausted: 1` sample in the last hour — clears the
    // default email floor of 3 only when there are 3 events in the
    // hour, but the in-app alert should still fire on the first.
    const samples: Array<{
      timestamp: number;
      counters: Record<string, number>;
    }> = [];
    for (let i = 0; i < 5; i++) {
      samples.push({ timestamp: now - 60_000 - i * 1000, counters: { exhausted: 1, sampled: 1 } });
    }

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
      (a) => a.kind === "spike" && a.counter === "exhausted",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].emailed).toBe(true);

    expect(result.notifiedAdmins).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    expect(state.sendEmailCalls[0].to.slice().sort()).toEqual([
      "admin-1@example.com",
      "admin-2@example.com",
    ]);
    expect(state.sendEmailCalls[0].subject).toContain(JOB);
    expect(state.sendEmailCalls[0].subject).toContain("exhausted");
  });

  it("fires the `exhausted` in-app alert (no email) when below the email escalation floor", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    // One event in the trailing hour: clears the in-app floor of 1
    // but stays under the email floor of 3.
    const samples = [
      { timestamp: now - 60_000, counters: { exhausted: 1, sampled: 1 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { exhausted: 1, sampled: 1 },
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "exhausted",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].emailed).toBe(false);

    expect(result.notifiedAdmins).toBe(2);
    expect(result.emailsSent).toBe(0);
    expect(state.sendEmailCalls).toHaveLength(0);
  });

  it("fires a `waitingSaturated` spike alert AND emails on the very first saturation episode", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    const samples = [
      { timestamp: now - 60_000, counters: { waitingSaturated: 1, sampled: 1, waiting: 4 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { waitingSaturated: 1, sampled: 1, waiting: 4 },
        },
      ],
    });

    const spikes = result.alertsFired.filter(
      (a) => a.kind === "spike" && a.counter === "waitingSaturated",
    );
    expect(spikes).toHaveLength(1);
    expect(spikes[0].emailed).toBe(true);

    expect(result.notifiedAdmins).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    expect(state.sendEmailCalls[0].subject).toContain(JOB);
    expect(state.sendEmailCalls[0].subject).toContain("waitingSaturated");
  });

  it("stays quiet on a healthy sampler (heartbeat only, no exhausted / saturation)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    // Pure heartbeat samples for the last hour: no exhausted events,
    // no saturation episodes. Should not raise any alert.
    const samples: Array<{
      timestamp: number;
      counters: Record<string, number>;
    }> = [];
    for (let i = 0; i < 30; i++) {
      samples.push({ timestamp: now - i * 60_000, counters: { sampled: 1, waiting: 0, active: 2 } });
    }

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: samples.reduce<Record<string, number>>((acc, s) => {
            for (const [k, v] of Object.entries(s.counters))
              acc[k] = (acc[k] ?? 0) + v;
            return acc;
          }, {}),
        },
      ],
    });

    expect(result.alertsFired).toHaveLength(0);
    expect(state.sendEmailCalls).toHaveLength(0);
  });

  it("fires a stall alert when the sampler has been silent for over 1h", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    const samples = [
      { timestamp: now - 90 * 60 * 1000, counters: { sampled: 1, waiting: 0 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { sampled: 1, waiting: 0 },
        },
      ],
    });

    const stalls = result.alertsFired.filter((a) => a.kind === "stall");
    expect(stalls).toHaveLength(1);
    expect(stalls[0].job).toBe(JOB);
    expect(stalls[0].emailed).toBe(true);
    expect(result.notifiedAdmins).toBe(2);
    expect(result.emailsSent).toBe(1);
  });

  it("does NOT fire a stall alert at 30 minutes idle (within the threshold)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    const samples = [
      { timestamp: now - 30 * 60 * 1000, counters: { sampled: 1, waiting: 0 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: () => [
        {
          job: JOB,
          samples,
          latest: samples[0],
          totals: { sampled: 1, waiting: 0 },
        },
      ],
    });

    expect(result.alertsFired.filter((a) => a.kind === "stall")).toHaveLength(0);
  });

  it("emits at most one in-app notification per Super Admin per tick (no duplicates from `sampled` heartbeat)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    // Mix in plenty of healthy `sampled` heartbeat counters alongside
    // a single `exhausted` event. The engine should fire exactly one
    // `exhausted` spike and zero spikes for `sampled` / `waiting` /
    // `active` (which have no rule wired and thus inherit only the
    // generic spike default — which requires ≥5 absolute and a
    // non-zero baseline, neither of which the heartbeat satisfies).
    const samples: Array<{
      timestamp: number;
      counters: Record<string, number>;
    }> = [];
    for (let i = 0; i < 40; i++) {
      samples.push({ timestamp: now - i * 60_000, counters: { sampled: 1, waiting: 0, active: 1 } });
    }
    samples.push({ timestamp: now - 30_000, counters: { exhausted: 1, sampled: 1 } });

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

    // Exactly one alert: the `exhausted` spike. The `sampled` /
    // `waiting` / `active` heartbeat gauges must not page anyone.
    expect(result.alertsFired).toHaveLength(1);
    expect(result.alertsFired[0].counter).toBe("exhausted");
    // One in-app notification per admin (×2 admins).
    expect(state.insertedNotifications).toHaveLength(2);
  });
});
