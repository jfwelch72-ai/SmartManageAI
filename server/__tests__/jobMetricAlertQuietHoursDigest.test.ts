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
