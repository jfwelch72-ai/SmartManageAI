/**
 * Task #749 — regression tests for the `receivesJobMetricAlertEmails`
 * opt-out filter in the job-metric alert engine.
 *
 * Verifies that:
 *   1. Only Super Admins with `receivesJobMetricAlertEmails === true`
 *      receive a SendGrid email when an alert escalates.
 *   2. Opted-out Super Admins still receive the in-app notification.
 *   3. When *every* Super Admin has opted out, no email is sent.
 *   4. When *every* Super Admin has opted in, all of them receive email.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface SuperAdminRow {
  id: string;
  email: string;
  isActive: boolean;
  receivesJobMetricAlertEmails: boolean;
}

const state = {
  superAdmins: [] as SuperAdminRow[],
  insertedNotifications: [] as Array<Record<string, unknown>>,
  insertedEvents: [] as Array<Record<string, unknown>>,
  sendEmailCalls: [] as Array<{ to: string[]; subject: string }>,
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
  sendEmail: vi.fn(async (opts: { to: string | string[]; subject: string }) => {
    const to = Array.isArray(opts.to) ? opts.to : [opts.to];
    state.sendEmailCalls.push({ to, subject: opts.subject });
    return state.sendEmailReturn;
  }),
}));

let alerts: typeof import("../utils/jobMetricAlerts");

beforeEach(async () => {
  state.superAdmins = [];
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

/**
 * Build a metrics source that produces a guaranteed email-escalating
 * spike: 23 prior hourly buckets averaging 1/hr (baseline ≈ 1) and a
 * last-hour total of 50 — well above the default 10x email threshold
 * and the 5-absolute floor.
 */
function escalatingSpikeSource(now: number, job: string, counter: string) {
  const samples: Array<{ timestamp: number; counters: Record<string, number> }> = [];
  for (let i = 1; i <= 23; i++) {
    samples.push({ timestamp: now - i * HOUR - 1000, counters: { [counter]: 1 } });
  }
  samples.push({ timestamp: now - 60_000, counters: { [counter]: 50 } });
  return () => [
    {
      job,
      samples,
      latest: samples[samples.length - 1],
      totals: samples.reduce<Record<string, number>>((acc, s) => {
        for (const [k, v] of Object.entries(s.counters)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {}),
    },
  ];
}

describe("jobMetricAlerts — receivesJobMetricAlertEmails opt-out (Task #749)", () => {
  it("emails only opted-in Super Admins while still notifying everyone in-app", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    state.superAdmins = [
      { id: "admin-in-1", email: "in1@example.com", isActive: true, receivesJobMetricAlertEmails: true },
      { id: "admin-out-1", email: "out1@example.com", isActive: true, receivesJobMetricAlertEmails: false },
      { id: "admin-in-2", email: "in2@example.com", isActive: true, receivesJobMetricAlertEmails: true },
      { id: "admin-out-2", email: "out2@example.com", isActive: true, receivesJobMetricAlertEmails: false },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: escalatingSpikeSource(now, "noisy_job", "skippedDedupe"),
    });

    expect(result.alertsFired).toHaveLength(1);
    expect(result.alertsFired[0].emailed).toBe(true);

    // In-app: every active Super Admin (4) receives a notification.
    expect(result.notifiedAdmins).toBe(4);
    expect(state.insertedNotifications).toHaveLength(4);
    const notifiedUserIds = state.insertedNotifications.map((n) => n.userId).sort();
    expect(notifiedUserIds).toEqual(
      ["admin-in-1", "admin-in-2", "admin-out-1", "admin-out-2"].sort(),
    );

    // Email: exactly one send, addressed only to opted-in admins.
    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    const recipients = state.sendEmailCalls[0].to.slice().sort();
    expect(recipients).toEqual(["in1@example.com", "in2@example.com"]);
    expect(recipients).not.toContain("out1@example.com");
    expect(recipients).not.toContain("out2@example.com");
  });

  it("sends no email when every Super Admin has opted out, but still notifies them in-app", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    state.superAdmins = [
      { id: "admin-out-1", email: "out1@example.com", isActive: true, receivesJobMetricAlertEmails: false },
      { id: "admin-out-2", email: "out2@example.com", isActive: true, receivesJobMetricAlertEmails: false },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: escalatingSpikeSource(now, "quiet_job", "skippedDedupe"),
    });

    expect(result.alertsFired).toHaveLength(1);
    expect(result.alertsFired[0].emailed).toBe(false);
    expect(result.emailsSent).toBe(0);
    expect(state.sendEmailCalls).toHaveLength(0);

    // In-app delivery is unchanged by the opt-out.
    expect(result.notifiedAdmins).toBe(2);
    expect(state.insertedNotifications).toHaveLength(2);
  });

  it("emails every Super Admin when all are opted in", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    state.superAdmins = [
      { id: "admin-in-1", email: "in1@example.com", isActive: true, receivesJobMetricAlertEmails: true },
      { id: "admin-in-2", email: "in2@example.com", isActive: true, receivesJobMetricAlertEmails: true },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: escalatingSpikeSource(now, "all_in_job", "skippedDedupe"),
    });

    expect(result.alertsFired).toHaveLength(1);
    expect(result.alertsFired[0].emailed).toBe(true);
    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    const recipients = state.sendEmailCalls[0].to.slice().sort();
    expect(recipients).toEqual(["in1@example.com", "in2@example.com"]);
    expect(result.notifiedAdmins).toBe(2);
  });

  it("ignores opted-in Super Admins who are inactive", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    state.superAdmins = [
      { id: "admin-active", email: "active@example.com", isActive: true, receivesJobMetricAlertEmails: true },
      { id: "admin-inactive", email: "inactive@example.com", isActive: false, receivesJobMetricAlertEmails: true },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: escalatingSpikeSource(now, "active_only_job", "skippedDedupe"),
    });

    expect(result.alertsFired).toHaveLength(1);
    expect(result.notifiedAdmins).toBe(1);
    expect(state.insertedNotifications).toHaveLength(1);
    expect(state.insertedNotifications[0].userId).toBe("admin-active");

    expect(result.emailsSent).toBe(1);
    expect(state.sendEmailCalls).toHaveLength(1);
    expect(state.sendEmailCalls[0].to).toEqual(["active@example.com"]);
  });
});
