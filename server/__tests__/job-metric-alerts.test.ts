/**
 * Task #718 — tests for the job metrics alert engine.
 *
 * Mocks the DB so we can exercise rule resolution, spike/stall
 * detection, dedupe, and notification fan-out without the network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface RuleRow {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  threshold: string;
  minAbsolute: number;
  dedupeMinutes: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface EventRow {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  ruleId: string | null;
  message: string;
  observedValue: string | null;
  baselineValue: string | null;
  triggeredAt: Date;
  notifiedUserCount: number;
}

const state = {
  rules: [] as RuleRow[],
  events: [] as EventRow[],
  superAdminIds: ["admin-1", "admin-2"],
  insertedNotifications: [] as Array<Record<string, unknown>>,
  selectMode: "rules" as "rules" | "events" | "users",
  rulesEnabledFilter: false,
  eventsCutoff: null as Date | null,
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
      // Heuristic: notification rows have a "userId"; event rows have "kind"+"job".
      for (const row of arr) {
        const r = row as Record<string, unknown>;
        if (r.userId && r.type) {
          state.insertedNotifications.push(r);
        } else if (r.kind && r.job) {
          state.events.push({
            id: `evt-${state.events.length + 1}`,
            job: String(r.job),
            counter: (r.counter as string | null) ?? null,
            kind: r.kind as "spike" | "stall",
            ruleId: (r.ruleId as string | null) ?? null,
            message: String(r.message),
            observedValue: (r.observedValue as string | null) ?? null,
            baselineValue: (r.baselineValue as string | null) ?? null,
            triggeredAt: (r.triggeredAt as Date) ?? new Date(),
            notifiedUserCount: (r.notifiedUserCount as number) ?? 0,
          });
        }
      }
      // Mimic .returning() chain used by insertNotifications.
      const rows = arr.map((_, i) => ({
        id: `n-${i}`,
        userId: (arr[i] as Record<string, unknown>).userId ?? null,
        type: (arr[i] as Record<string, unknown>).type ?? null,
        title: (arr[i] as Record<string, unknown>).title ?? "",
        message: (arr[i] as Record<string, unknown>).message ?? "",
        relatedEntityId: (arr[i] as Record<string, unknown>).relatedEntityId ?? null,
        relatedEntityType: (arr[i] as Record<string, unknown>).relatedEntityType ?? null,
        createdAt: new Date(),
        readAt: null,
      }));
      const result: Record<string, unknown> = {
        returning: () => Promise.resolve(rows),
        then: (
          onFulfilled: (value: unknown) => unknown,
        ) => Promise.resolve(rows).then(onFulfilled),
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
        rows = state.rules.filter((r) => r.enabled);
      } else if (tableName === "job_metric_alert_events") {
        rows = state.events
          .slice()
          .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
      } else if (tableName === "users") {
        rows = state.superAdminIds.map((id) => ({ id }));
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
    returning: async (_cols: unknown) => [],
  }),
  update: (_table: unknown) => ({
    set: () => ({ where: () => ({ returning: async () => [] }) }),
  }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));
// Notification delivery does background work — we don't need real email/push in tests.
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

let alerts: typeof import("../utils/jobMetricAlerts");

beforeEach(async () => {
  state.rules = [];
  state.events = [];
  state.insertedNotifications = [];
  state.superAdminIds = ["admin-1", "admin-2"];
  alerts = await import("../utils/jobMetricAlerts");
  alerts.setJobMetricAlertsClockForTests(() => Date.now());
});

afterEach(() => {
  alerts.resetJobMetricAlertsClockForTests();
  vi.useRealTimers();
});

const HOUR = 60 * 60 * 1000;

function source(jobs: Array<{ job: string; samples: Array<{ timestamp: number; counters: Record<string, number> }>; latest?: { timestamp: number; counters: Record<string, number> } | null; totals?: Record<string, number> }>) {
  return () =>
    jobs.map((j) => ({
      job: j.job,
      samples: j.samples,
      latest: j.latest ?? (j.samples.length ? j.samples[j.samples.length - 1] : null),
      totals:
        j.totals ??
        j.samples.reduce<Record<string, number>>((acc, s) => {
          for (const [k, v] of Object.entries(s.counters)) acc[k] = (acc[k] ?? 0) + v;
          return acc;
        }, {}),
    }));
}

describe("jobMetricAlerts (Task #718)", () => {
  it("fires a default spike alert when last hour > 3x baseline and >= 5 absolute", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples: Array<{ timestamp: number; counters: Record<string, number> }> = [];
    // 23 prior hourly buckets with avg 2/hr (total 46)
    for (let i = 1; i <= 23; i++) {
      samples.push({ timestamp: now - i * HOUR - 1000, counters: { skippedDedupe: 2 } });
    }
    // last hour: 20 (>> 3 * 2 = 6, and >= 5)
    samples.push({ timestamp: now - 5 * 60 * 1000, counters: { skippedDedupe: 20 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "crm_birthday_digest", samples }]),
    });

    expect(result.alertsFired).toHaveLength(1);
    expect(result.alertsFired[0].kind).toBe("spike");
    expect(result.alertsFired[0].counter).toBe("skippedDedupe");
    expect(result.notifiedAdmins).toBe(2);
    // Each admin gets one notification.
    expect(state.insertedNotifications).toHaveLength(2);
    expect(state.insertedNotifications.every((n) => n.type === "GENERAL")).toBe(true);
    // Event row persisted.
    expect(state.events).toHaveLength(1);
  });

  it("does not fire when the absolute floor is not met", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples: Array<{ timestamp: number; counters: Record<string, number> }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({ timestamp: now - i * HOUR - 1000, counters: { skippedDedupe: 0 } });
    }
    // last hour: 3 (>> baseline of ~0, but < default minAbsolute 5)
    samples.push({ timestamp: now - 5 * 60 * 1000, counters: { skippedDedupe: 3 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "crm_birthday_digest", samples }]),
    });

    expect(result.alertsFired).toHaveLength(0);
  });

  it("does not fire a spike when the baseline is zero (no comparison data)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples = [
      { timestamp: now - 5 * 60 * 1000, counters: { brandNewCounter: 100 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "fresh_job", samples }]),
    });

    expect(result.alertsFired.filter((a) => a.kind === "spike")).toHaveLength(0);
  });

  it("fires a stall alert when the most recent sample is older than the threshold", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples = [
      { timestamp: now - 6 * HOUR, counters: { ticks: 1 } },
    ];

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "stuck_job", samples }]),
    });

    expect(result.alertsFired.some((a) => a.kind === "stall")).toBe(true);
    expect(state.insertedNotifications.length).toBeGreaterThan(0);
  });

  it("dedupes repeated alerts within the dedupe window", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    const samples: Array<{ timestamp: number; counters: Record<string, number> }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({ timestamp: now - i * HOUR - 1000, counters: { c: 1 } });
    }
    samples.push({ timestamp: now - 60_000, counters: { c: 50 } });

    const first = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "j1", samples }]),
    });
    expect(first.alertsFired).toHaveLength(1);

    // Re-run immediately: should be suppressed.
    const second = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "j1", samples }]),
    });
    expect(second.alertsFired).toHaveLength(0);
    expect(second.alertsSuppressed).toBe(1);
  });

  it("respects a custom rule that overrides the spike multiplier and floor", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    state.rules = [
      {
        id: "r1",
        job: "crm_birthday_digest",
        counter: "skippedDedupe",
        kind: "spike",
        threshold: "10",
        minAbsolute: 50,
        dedupeMinutes: 60,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const samples: Array<{ timestamp: number; counters: Record<string, number> }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({ timestamp: now - i * HOUR - 1000, counters: { skippedDedupe: 2 } });
    }
    samples.push({ timestamp: now - 60_000, counters: { skippedDedupe: 20 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "crm_birthday_digest", samples }]),
    });

    // 20 < custom minAbsolute 50, so no fire.
    expect(result.alertsFired).toHaveLength(0);
  });
});
