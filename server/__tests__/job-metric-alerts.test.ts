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
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  snoozedUntil: Date | null;
  snoozedById: string | null;
  emailed: boolean;
  emailedRecipientCount: number;
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
            acknowledgedAt: (r.acknowledgedAt as Date | null) ?? null,
            acknowledgedById: (r.acknowledgedById as string | null) ?? null,
            snoozedUntil: (r.snoozedUntil as Date | null) ?? null,
            snoozedById: (r.snoozedById as string | null) ?? null,
            emailed: (r.emailed as boolean | undefined) ?? false,
            emailedRecipientCount: (r.emailedRecipientCount as number | undefined) ?? 0,
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
        rows = state.superAdminIds.map((id) => ({
          id,
          email: `${id}@example.com`,
          isActive: true,
          firstName: null,
          lastName: null,
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
    returning: async (_cols: unknown) => [],
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (_cond: unknown) => ({
        returning: async () => {
          const tableName = tableNameOf(table);
          if (tableName !== "job_metric_alert_events") return [];
          // The mock can't decode drizzle's where() expression, so apply
          // the update to the most recently-inserted matching row. Tests
          // that exercise update() seed a single event and target it.
          const target = state.events[state.events.length - 1];
          if (!target) return [];
          Object.assign(target, values);
          return [target];
        },
      }),
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
// Notification delivery does background work — we don't need real email/push in tests.
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));
const sendEmailMock = vi.fn(async () => true);
vi.mock("../services/emailService", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
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

  it("suppresses re-firing for a job/counter/kind with an active snoozedUntil", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    // Seed a previously-snoozed event for the same job/counter/kind that
    // we're about to (otherwise) trigger. snoozedUntil is in the future
    // and acknowledgedAt is set (snooze marks ack).
    state.events.push({
      id: "evt-prior",
      job: "snoozed_job",
      counter: "c",
      kind: "spike",
      ruleId: null,
      message: "prior",
      observedValue: "10.0000",
      baselineValue: "1.0000",
      // Triggered far enough in the past that the dedupe window alone
      // wouldn't suppress (default dedupe 60min) — only the snooze does.
      triggeredAt: new Date(now - 6 * HOUR),
      notifiedUserCount: 0,
      acknowledgedAt: new Date(now - 6 * HOUR),
      acknowledgedById: "admin-1",
      snoozedUntil: new Date(now + 2 * HOUR),
      snoozedById: "admin-1",
      emailed: false,
      emailedRecipientCount: 0,
    });

    const samples: Array<{ timestamp: number; counters: Record<string, number> }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({ timestamp: now - i * HOUR - 1000, counters: { c: 1 } });
    }
    samples.push({ timestamp: now - 60_000, counters: { c: 50 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "snoozed_job", samples }]),
    });

    expect(result.alertsFired).toHaveLength(0);
    expect(result.alertsSuppressed).toBe(1);
    // No new event row was persisted (only the seeded one remains).
    expect(state.events).toHaveLength(1);
    // No new admin notifications either.
    expect(state.insertedNotifications).toHaveLength(0);
  });

  it("excludes acknowledged events from activeByJob in listRecentJobMetricAlertEvents", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);

    // Acknowledged event in the active window (last hour) — should NOT
    // count toward activeByJob.
    state.events.push({
      id: "evt-ack",
      job: "ack_job",
      counter: "c",
      kind: "spike",
      ruleId: null,
      message: "acked",
      observedValue: "10.0000",
      baselineValue: "1.0000",
      triggeredAt: new Date(now - 10 * 60 * 1000),
      notifiedUserCount: 1,
      acknowledgedAt: new Date(now - 5 * 60 * 1000),
      acknowledgedById: "admin-1",
      snoozedUntil: null,
      snoozedById: null,
      emailed: false,
      emailedRecipientCount: 0,
    });
    // Unacknowledged event in the active window — SHOULD count.
    state.events.push({
      id: "evt-open",
      job: "open_job",
      counter: "c",
      kind: "spike",
      ruleId: null,
      message: "open",
      observedValue: "10.0000",
      baselineValue: "1.0000",
      triggeredAt: new Date(now - 5 * 60 * 1000),
      notifiedUserCount: 1,
      acknowledgedAt: null,
      acknowledgedById: null,
      snoozedUntil: null,
      snoozedById: null,
      emailed: false,
      emailedRecipientCount: 0,
    });

    const { events, activeByJob } = await alerts.listRecentJobMetricAlertEvents();

    expect(events).toHaveLength(2);
    expect(activeByJob).toEqual({ open_job: 1 });
    expect(activeByJob.ack_job).toBeUndefined();
  });

  it("persists emailed=true and recipient count when email escalation threshold is met (Task #739)", async () => {
    const now = Date.now();
    alerts.setJobMetricAlertsClockForTests(() => now);
    sendEmailMock.mockClear();
    sendEmailMock.mockResolvedValueOnce(true);

    // Custom rule with an email threshold that the observed multiplier
    // will easily cross (50 in last hour vs 1/hr baseline = 50× ≥ 5×).
    state.rules = [
      {
        id: "r-email",
        job: "pageable_job",
        counter: "c",
        kind: "spike",
        threshold: "3",
        minAbsolute: 5,
        dedupeMinutes: 60,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RuleRow & { emailWhenAbove: string },
    ];
    // Rules are loaded via raw select in the code under test and then
    // passed through `ruleFromRow`, which reads `emailWhenAbove` off the
    // row. Cast through unknown so we can attach the field.
    (state.rules[0] as unknown as { emailWhenAbove: string }).emailWhenAbove = "5";

    const samples: Array<{ timestamp: number; counters: Record<string, number> }> = [];
    for (let i = 1; i <= 23; i++) {
      samples.push({ timestamp: now - i * HOUR - 1000, counters: { c: 1 } });
    }
    samples.push({ timestamp: now - 60_000, counters: { c: 50 } });

    const result = await alerts.evaluateJobMetricAlerts({
      metricsSource: source([{ job: "pageable_job", samples }]),
    });

    expect(result.alertsFired).toHaveLength(1);
    expect(result.alertsFired[0].emailed).toBe(true);
    expect(result.emailsSent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // The persisted event row must carry the email outcome so the
    // dashboard list can render the "Emailed" badge.
    expect(state.events).toHaveLength(1);
    expect(state.events[0].emailed).toBe(true);
    expect(state.events[0].emailedRecipientCount).toBe(2);
  });

  it("snoozeJobMetricAlertEvent rejects non-positive hours", async () => {
    await expect(
      alerts.snoozeJobMetricAlertEvent("evt-x", "admin-1", 0),
    ).rejects.toThrow(/positive/i);
    await expect(
      alerts.snoozeJobMetricAlertEvent("evt-x", "admin-1", -3),
    ).rejects.toThrow(/positive/i);
    await expect(
      alerts.snoozeJobMetricAlertEvent("evt-x", "admin-1", Number.NaN),
    ).rejects.toThrow(/positive/i);
  });
});
