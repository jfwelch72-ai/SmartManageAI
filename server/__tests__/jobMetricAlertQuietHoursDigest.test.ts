/**
 * Task #754 — Tests for the once-per-window quiet-hours digest email
 * for Super Admins.
 *
 * Verifies that `sendJobMetricAlertQuietHoursDigests`:
 *   1. Sends a digest to Super Admins after their quiet window closes,
 *      summarizing alerts that fired *inside* that window.
 *   2. Skips users who are still inside their quiet window.
 *   3. Skips users who have opted out via
 *      `jobMetricAlertQuietHoursDigestEnabled = false`.
 *   4. Skips users with no events to summarize, but still bumps the
 *      `lastDigestAt` high-water mark to keep future ticks cheap.
 *   5. Excludes events that fired outside the recipient's quiet
 *      window (e.g. during their daytime hours).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface FakeRecipient {
  id: string;
  email: string;
  receivesJobMetricAlertEmails: boolean;
  digestEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
  quietHoursWeekdays: number[] | null;
  lastDigestAt: Date | null;
  digestFormat: "summary" | "full" | "grouped";
}

interface FakeEvent {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  message: string;
  observedValue: number | null;
  baselineValue: number | null;
  triggeredAt: Date;
}

const updateCalls: Array<{ id: string; lastDigestAt: Date | null }> = [];

const dbMock = {
  update: (_table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (_cond: unknown) => {
        const lastDigestAt = (values.jobMetricAlertQuietHoursLastDigestAt as Date | null) ?? null;
        updateCalls.push({ id: "(captured-via-where)", lastDigestAt });
        return { returning: async () => [] };
      },
    }),
  }),
  insert: (_table: unknown) => ({
    values: (_v: unknown) => ({
      returning: async () => [],
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve([]).then(onFulfilled),
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve([]),
        then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve([]).then(onFulfilled),
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
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

const sendEmailMock = vi.fn(async (_opts: { to: string | string[]; subject: string; text?: string; html?: string }) => true);
vi.mock("../services/emailService", () => ({
  sendEmail: sendEmailMock,
}));

let alerts: typeof import("../utils/jobMetricAlerts");

beforeEach(async () => {
  updateCalls.length = 0;
  sendEmailMock.mockClear();
  sendEmailMock.mockImplementation(async () => true);
  alerts = await import("../utils/jobMetricAlerts");
  alerts.setJobMetricAlertsClockForTests(() => Date.now());
});

afterEach(() => {
  alerts.resetJobMetricAlertsClockForTests();
  vi.useRealTimers();
});

const HOUR = 60 * 60 * 1000;

function makeRecipient(overrides: Partial<FakeRecipient> = {}): FakeRecipient {
  return {
    id: "admin-1",
    email: "admin1@example.com",
    receivesJobMetricAlertEmails: true,
    digestEnabled: true,
    quietHoursEnabled: true,
    // 22:00 → 07:00 UTC window (wraps midnight) — see isInJobMetricAlertQuietWindow.
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    quietHoursTimezone: "UTC",
    quietHoursWeekdays: null,
    lastDigestAt: null,
    digestFormat: "full",
    ...overrides,
  };
}

function makeEvent(triggeredAt: Date, overrides: Partial<FakeEvent> = {}): FakeEvent {
  return {
    id: `evt-${triggeredAt.getTime()}`,
    job: "test_job",
    counter: "errors",
    kind: "spike",
    message: "errors spiked 12.0x baseline (60 vs 5.0)",
    observedValue: 60,
    baselineValue: 5,
    triggeredAt,
    ...overrides,
  };
}

describe("sendJobMetricAlertQuietHoursDigests (Task #754)", () => {
  it("sends a digest to a Super Admin who just exited their quiet window", async () => {
    // 09:00 UTC — outside the 22:00–07:00 quiet window.
    const now = Date.UTC(2026, 0, 15, 9, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);

    // Two events that fired at 02:00 and 04:30 UTC — both inside the
    // recipient's quiet window — and one event at 08:30 UTC that fired
    // *after* the window closed (should be excluded).
    const insideQuiet1 = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));
    const insideQuiet2 = new Date(Date.UTC(2026, 0, 15, 4, 30, 0));
    const afterQuiet = new Date(Date.UTC(2026, 0, 15, 8, 30, 0));

    const recipient = makeRecipient();
    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => [
        makeEvent(insideQuiet1, { id: "e1" }),
        makeEvent(insideQuiet2, { id: "e2", message: "errors spiked 15x baseline" }),
        makeEvent(afterQuiet, { id: "e3", message: "errors spiked 11x baseline (after-window)" }),
      ] as never,
    });

    expect(summary.recipientsConsidered).toBe(1);
    expect(summary.digestsSent).toBe(1);
    expect(summary.digestsSkippedInQuiet).toBe(0);
    expect(summary.digestsSkippedDisabled).toBe(0);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe("admin1@example.com");
    expect(call.subject).toMatch(/2/); // "2 alerts" in subject
    expect(call.text ?? "").not.toContain("after-window");
    // lastDigestAt must be persisted so the next tick won't re-send.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].lastDigestAt?.getTime()).toBe(now);
  });

  it("skips users who are still inside their quiet window", async () => {
    // 03:00 UTC — inside the 22:00–07:00 window.
    const now = Date.UTC(2026, 0, 15, 3, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);

    const recipient = makeRecipient();
    const eventInside = new Date(Date.UTC(2026, 0, 15, 1, 0, 0));

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => [makeEvent(eventInside)] as never,
    });

    expect(summary.digestsSent).toBe(0);
    expect(summary.digestsSkippedInQuiet).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("skips users who have opted out of the digest", async () => {
    const now = Date.UTC(2026, 0, 15, 9, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);

    const recipient = makeRecipient({ digestEnabled: false });
    const eventInside = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => [makeEvent(eventInside)] as never,
    });

    expect(summary.digestsSent).toBe(0);
    expect(summary.digestsSkippedDisabled).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("skips users who have opted out of job-metric alert emails entirely", async () => {
    const now = Date.UTC(2026, 0, 15, 9, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);

    const recipient = makeRecipient({ receivesJobMetricAlertEmails: false });
    const eventInside = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => [makeEvent(eventInside)] as never,
    });

    expect(summary.digestsSent).toBe(0);
    expect(summary.digestsSkippedDisabled).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("skips users whose quiet hours are not configured", async () => {
    const now = Date.UTC(2026, 0, 15, 9, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);

    const recipient = makeRecipient({
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
    });
    const eventInside = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => [makeEvent(eventInside)] as never,
    });

    expect(summary.digestsSent).toBe(0);
    expect(summary.digestsSkippedDisabled).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("bumps lastDigestAt even when there are no matching events", async () => {
    const now = Date.UTC(2026, 0, 15, 9, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);

    const recipient = makeRecipient();
    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => [] as never,
    });

    expect(summary.digestsSent).toBe(0);
    expect(summary.digestsSkippedNoEvents).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    // The high-water mark should still advance to avoid re-scanning.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].lastDigestAt?.getTime()).toBe(now);
  });

  it("does not re-send events older than lastDigestAt", async () => {
    const now = Date.UTC(2026, 0, 15, 9, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);

    // Recipient already received a digest at 08:00 UTC today.
    const previousDigest = new Date(Date.UTC(2026, 0, 15, 8, 0, 0));
    const recipient = makeRecipient({ lastDigestAt: previousDigest });

    // Both events fired before the previous digest was sent.
    const evtA = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));
    const evtB = new Date(Date.UTC(2026, 0, 15, 5, 0, 0));

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => [makeEvent(evtA), makeEvent(evtB)] as never,
    });

    expect(summary.digestsSent).toBe(0);
    expect(summary.digestsSkippedNoEvents).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

/**
 * Task #766 — Direct unit tests for `buildDigestEmailBody` covering
 * each of the three digest detail levels introduced by Task #761:
 *   • "summary" — totals + top jobs only
 *   • "grouped" — events grouped by job, ordered by group size
 *   • "full"    — chronological per-event flat list (legacy default)
 *
 * These tests assert the *content* of the rendered text bodies so
 * future edits to the formatting helpers cannot silently regress
 * totals, ordering, or grouping.
 */
describe("buildDigestEmailBody (Task #766 — digest detail levels)", () => {
  const windowStart = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));
  const windowEnd = new Date(Date.UTC(2026, 0, 15, 6, 30, 0));

  // A deterministic mixed event set:
  //   • job-a: 3 events (2 spike, 1 stall)
  //   • job-b: 2 events (1 spike, 1 stall)
  //   • job-c: 1 event  (1 spike)
  // Total: 6 events, 4 spikes, 2 stalls, 3 unique jobs,
  // 5 unique job/counter pairs (job-a/errors appears twice).
  function buildMixedEvents() {
    return [
      makeEvent(new Date(Date.UTC(2026, 0, 15, 2, 5, 0)), {
        id: "a1", job: "job-a", counter: "errors", kind: "spike",
        message: "errors spiked 12x baseline",
      }),
      makeEvent(new Date(Date.UTC(2026, 0, 15, 2, 30, 0)), {
        id: "b1", job: "job-b", counter: "latency_ms", kind: "stall",
        message: "latency_ms stalled at 0",
      }),
      makeEvent(new Date(Date.UTC(2026, 0, 15, 3, 0, 0)), {
        id: "a2", job: "job-a", counter: "errors", kind: "spike",
        message: "errors spiked 9x baseline",
      }),
      makeEvent(new Date(Date.UTC(2026, 0, 15, 4, 0, 0)), {
        id: "c1", job: "job-c", counter: "queue_depth", kind: "spike",
        message: "queue_depth spiked 7x baseline",
      }),
      makeEvent(new Date(Date.UTC(2026, 0, 15, 5, 0, 0)), {
        id: "a3", job: "job-a", counter: "warnings", kind: "stall",
        message: "warnings stalled at 0",
      }),
      makeEvent(new Date(Date.UTC(2026, 0, 15, 6, 0, 0)), {
        id: "b2", job: "job-b", counter: "errors", kind: "spike",
        message: "errors spiked 4x baseline",
      }),
    ];
  }

  it("'summary' format renders totals (alerts, spikes, stalls, unique jobs/pairs) and the top-jobs list", () => {
    const events = buildMixedEvents();
    const { text } = alerts.buildDigestEmailBody(
      events as never,
      windowStart,
      windowEnd,
      "summary",
    );

    // Totals block
    expect(text).toContain("6 alerts");
    expect(text).toContain("4 spikes, 2 stalls");
    // 3 unique jobs, 5 unique job/counter pairs
    expect(text).toMatch(/3 jobs.*5 job\/counter pairs/);

    // Top-jobs section, ordered by event count (job-a=3, job-b=2, job-c=1).
    expect(text).toContain("Top jobs:");
    const topSection = text.slice(text.indexOf("Top jobs:"));
    const jobAIdx = topSection.indexOf("job-a");
    const jobBIdx = topSection.indexOf("job-b");
    const jobCIdx = topSection.indexOf("job-c");
    expect(jobAIdx).toBeGreaterThan(-1);
    expect(jobBIdx).toBeGreaterThan(jobAIdx);
    expect(jobCIdx).toBeGreaterThan(jobBIdx);
    expect(topSection).toContain("job-a — 3");
    expect(topSection).toContain("job-b — 2");
    expect(topSection).toContain("job-c — 1");

    // Summary should NOT include the per-event chronological list
    // — that's a "full"-format concern.
    expect(text).not.toContain("errors spiked 12x baseline");
    expect(text).not.toContain("queue_depth spiked 7x baseline");
  });

  it("'grouped' format groups events by job and orders groups by size (largest first)", () => {
    const events = buildMixedEvents();
    const { text } = alerts.buildDigestEmailBody(
      events as never,
      windowStart,
      windowEnd,
      "grouped",
    );

    expect(text).toContain("grouped by job");

    // Group headers exist with their counts.
    expect(text).toContain("job-a (3 alerts):");
    expect(text).toContain("job-b (2 alerts):");
    expect(text).toContain("job-c (1 alert):");

    // Groups must appear in descending size order.
    const aIdx = text.indexOf("job-a (3 alerts):");
    const bIdx = text.indexOf("job-b (2 alerts):");
    const cIdx = text.indexOf("job-c (1 alert):");
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);

    // Each event message should appear under its group, with kind label.
    expect(text).toContain("(spike)");
    expect(text).toContain("(stall)");
    expect(text).toContain("errors spiked 12x baseline");
    expect(text).toContain("queue_depth spiked 7x baseline");

    // Within job-a, event ordering should be chronological:
    // a1 (02:05) → a2 (03:00) → a3 (05:00).
    const groupA = text.slice(aIdx, bIdx);
    const a1 = groupA.indexOf("12x baseline");
    const a2 = groupA.indexOf("9x baseline");
    const a3 = groupA.indexOf("warnings stalled");
    expect(a1).toBeGreaterThan(-1);
    expect(a2).toBeGreaterThan(a1);
    expect(a3).toBeGreaterThan(a2);
  });

  it("'full' format renders a chronological per-event flat list (legacy default)", () => {
    const events = buildMixedEvents();
    const { text } = alerts.buildDigestEmailBody(
      events as never,
      windowStart,
      windowEnd,
      "full",
    );

    // Every event should appear with its job inline (no grouping headers).
    expect(text).not.toContain("(3 alerts):");
    expect(text).not.toContain("Top jobs:");

    for (const e of events) {
      expect(text).toContain(e.job);
      expect(text).toContain(e.message);
      expect(text).toContain(e.triggeredAt.toISOString());
    }

    // Events appear in chronological order matching `events`.
    let cursor = -1;
    for (const e of events) {
      const idx = text.indexOf(e.message);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it("defaults to 'full' format when none is supplied", () => {
    const events = buildMixedEvents();
    const withDefault = alerts.buildDigestEmailBody(
      events as never,
      windowStart,
      windowEnd,
    );
    const withFull = alerts.buildDigestEmailBody(
      events as never,
      windowStart,
      windowEnd,
      "full",
    );
    expect(withDefault.text).toBe(withFull.text);
  });
});

/**
 * Task #766 — End-to-end coverage that the recipient's `digestFormat`
 * preference is propagated all the way through
 * `sendJobMetricAlertQuietHoursDigests` to the rendered email body.
 */
describe("sendJobMetricAlertQuietHoursDigests honors digestFormat (Task #766)", () => {
  function setup() {
    const now = Date.UTC(2026, 0, 15, 9, 0, 0);
    alerts.setJobMetricAlertsClockForTests(() => now);
    const evt1 = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));
    const evt2 = new Date(Date.UTC(2026, 0, 15, 3, 0, 0));
    const evt3 = new Date(Date.UTC(2026, 0, 15, 4, 0, 0));
    const events = [
      makeEvent(evt1, { id: "x1", job: "job-a", message: "errors spiked 10x baseline" }),
      makeEvent(evt2, { id: "x2", job: "job-a", message: "errors spiked 8x baseline" }),
      makeEvent(evt3, { id: "x3", job: "job-b", message: "errors spiked 5x baseline" }),
    ];
    return { events };
  }

  it("renders a 'summary' body for recipients who chose the summary format", async () => {
    const { events } = setup();
    const recipient = makeRecipient({ digestFormat: "summary" });

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => events as never,
    });

    expect(summary.digestsSent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const body = sendEmailMock.mock.calls[0][0].text ?? "";
    // Summary fingerprints
    expect(body).toContain("Totals:");
    expect(body).toContain("3 alerts");
    expect(body).toContain("Top jobs:");
    // Should NOT render the per-event chronological list.
    expect(body).not.toContain("errors spiked 10x baseline");
  });

  it("renders a 'grouped' body for recipients who chose the grouped format", async () => {
    const { events } = setup();
    const recipient = makeRecipient({ digestFormat: "grouped" });

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => events as never,
    });

    expect(summary.digestsSent).toBe(1);
    const body = sendEmailMock.mock.calls[0][0].text ?? "";
    expect(body).toContain("grouped by job");
    expect(body).toContain("job-a (2 alerts):");
    expect(body).toContain("job-b (1 alert):");
    // job-a (size 2) must come before job-b (size 1).
    expect(body.indexOf("job-a (2 alerts):"))
      .toBeLessThan(body.indexOf("job-b (1 alert):"));
  });

  it("renders the 'full' chronological body for recipients who chose the full format", async () => {
    const { events } = setup();
    const recipient = makeRecipient({ digestFormat: "full" });

    const summary = await alerts.sendJobMetricAlertQuietHoursDigests({
      recipientsSource: async () => [recipient as never],
      eventsSource: async () => events as never,
    });

    expect(summary.digestsSent).toBe(1);
    const body = sendEmailMock.mock.calls[0][0].text ?? "";
    expect(body).not.toContain("Totals:");
    expect(body).not.toContain("grouped by job");
    expect(body).toContain("errors spiked 10x baseline");
    expect(body).toContain("errors spiked 8x baseline");
    expect(body).toContain("errors spiked 5x baseline");
    // Chronological ordering preserved.
    const i1 = body.indexOf("errors spiked 10x baseline");
    const i2 = body.indexOf("errors spiked 8x baseline");
    const i3 = body.indexOf("errors spiked 5x baseline");
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });
});
