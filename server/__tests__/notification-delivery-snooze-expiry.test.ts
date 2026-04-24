/**
 * Task #1747 — Outbound delivery (email/SMS/push/Teams/Slack) must
 * honor the same snooze-expiry semantics as the dashboard mute card
 * and the in-app feed: a `notification_type_prefs` override row whose
 * `muted_until` is in the past is treated as if it didn't exist, so
 * delivery falls back to the channel-level default.
 *
 * Without this guarantee, an admin could see "auto-clears in 0 days"
 * on /admin/log-email-failures yet still have their digest email
 * suppressed, defeating the whole point of the snooze.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- DB stub ----------------------------------------------------------
// Three sequential `db.select()` calls in `deliverNotification`:
//   1) users row             (email/phone/org/opt-out)
//   2) notification_channel_prefs row
//   3) notification_type_prefs row (this is the one task #1747 exercises)
type Row = Record<string, unknown>;
const selectQueue: Row[][] = [];

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  const settle = (resolve: (v: Row[]) => unknown) => {
    const rows = selectQueue.shift() ?? [];
    return Promise.resolve(rows).then(resolve);
  };
  chain.then = settle;
  return chain;
}

const dbMock = {
  select: () => makeSelectChain(),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

// ---- Mocks for downstream side-effects ---------------------------------
// CRITICAL: must mock ../services/emailService (the actual sender used
// by deliverEmail in notificationDelivery.ts). Failing to mock this
// would cause real Resend emails to fire from the test suite.
const sendEmailMock = vi.fn(async () => true);
vi.mock("../services/emailService", () => ({
  sendEmail: sendEmailMock,
  sendEmailWithResult: vi.fn(async () => ({ success: true })),
  sendNotificationEmail: vi.fn(async () => true),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

// `deliverNotification` reads APP_BASE_URL/etc from env at call time —
// nothing else is read.

let deliverNotification: typeof import("../services/notificationDelivery")["deliverNotification"];

beforeEach(async () => {
  selectQueue.length = 0;
  sendEmailMock.mockClear();
  vi.resetModules();
  ({ deliverNotification } = await import("../services/notificationDelivery"));
});

const baseNotification = {
  id: "n-1",
  userId: "u-1",
  organizationId: "org-1",
  type: "PROJECT_LOG_EMAIL_FAILURES_DIGEST" as const,
  title: "Daily failures digest",
  message: "3 schedules failed in the last 24h.",
};

describe("loadEffectivePrefs honors muted_until snooze expiry", () => {
  it("ignores a type override row whose mutedUntil is in the past", async () => {
    selectQueue.push([{ email: "admin@example.com", phone: null, organizationId: "org-1", integrationSyncExhaustedEmailOptOut: false }]);
    // Channel: email ON.
    selectQueue.push([{
      emailEnabled: true, smsEnabled: false, pushEnabled: false,
      teamsEnabled: false, slackEnabled: false,
      smsPhoneNumber: null, teamsWebhookUrl: null, slackWebhookUrl: null,
    }]);
    // Type override: email OFF, but mutedUntil is yesterday ⇒ ignored.
    selectQueue.push([{
      emailEnabled: false, smsEnabled: null, pushEnabled: null,
      teamsEnabled: null, slackEnabled: null,
      mutedUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
    }]);

    await deliverNotification({ ...baseNotification });
    // Channel default (true) wins ⇒ email goes out.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("respects a type override whose mutedUntil is still in the future", async () => {
    selectQueue.push([{ email: "admin@example.com", phone: null, organizationId: "org-1", integrationSyncExhaustedEmailOptOut: false }]);
    selectQueue.push([{
      emailEnabled: true, smsEnabled: false, pushEnabled: false,
      teamsEnabled: false, slackEnabled: false,
      smsPhoneNumber: null, teamsWebhookUrl: null, slackWebhookUrl: null,
    }]);
    // Active snooze ⇒ override applies, email suppressed.
    selectQueue.push([{
      emailEnabled: false, smsEnabled: null, pushEnabled: null,
      teamsEnabled: null, slackEnabled: null,
      mutedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }]);

    await deliverNotification({ ...baseNotification });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("respects an indefinite mute (mutedUntil = null) — historical behavior", async () => {
    selectQueue.push([{ email: "admin@example.com", phone: null, organizationId: "org-1", integrationSyncExhaustedEmailOptOut: false }]);
    selectQueue.push([{
      emailEnabled: true, smsEnabled: false, pushEnabled: false,
      teamsEnabled: false, slackEnabled: false,
      smsPhoneNumber: null, teamsWebhookUrl: null, slackWebhookUrl: null,
    }]);
    // No deadline = forever mute.
    selectQueue.push([{
      emailEnabled: false, smsEnabled: null, pushEnabled: null,
      teamsEnabled: null, slackEnabled: null,
      mutedUntil: null,
    }]);

    await deliverNotification({ ...baseNotification });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
