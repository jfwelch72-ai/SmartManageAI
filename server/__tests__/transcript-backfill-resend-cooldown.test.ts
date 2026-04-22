/**
 * Task #1099 — pin the per-(org, job, channel) resend cooldown added in
 * Task #1068 so a future refactor can't silently delete the rate limit
 * and reopen the Slack/Resend spam vector. We exercise the service-level
 * `resendBackfillAlertDelivery` helper directly with an injectable clock
 * (the `now` parameter the helper already accepts) so the tests don't
 * have to wait wall-clock seconds and don't monkey-patch `Date.now`.
 *
 * The dispatcher (`notifyBackfillCompletion`) lives in the same module
 * and can't be replaced through `vi.mock` of its own exports, so we
 * sterilize it by stubbing its downstream collaborators instead:
 *   - storage helpers return canned rows / no-op writes
 *   - `sendEmail` resolves true so the email branch records "success"
 *   - no Slack webhook is configured, so `postSlackWebhook` never runs
 * That keeps the run hermetic (no DB writes, no network) while still
 * letting the real cooldown reservation code path execute end-to-end.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_A = `org-a-${SUFFIX}`;
const ORG_B = `org-b-${SUFFIX}`;
const JOB_ID = `job-${SUFFIX}`;
const DELIVERY_ID = `delivery-${SUFFIX}`;

const failedDelivery = {
  id: DELIVERY_ID,
  organizationId: ORG_A,
  jobId: JOB_ID,
  channel: "email" as const,
  status: "failure" as const,
  recipientSummary: "ops@example.com",
  errorMessage: "smtp 500",
  attemptedAt: new Date("2026-04-22T10:00:00.000Z"),
  triggeredById: null,
  source: "automatic" as const,
};

const job = {
  id: JOB_ID,
  organizationId: ORG_A,
  status: "COMPLETED" as const,
  total: 10,
  processed: 10,
  succeeded: 9,
  failed: 1,
  errors: [],
  failedRecordingIds: [],
  startedById: null,
  parentJobId: null,
  startedAt: new Date("2026-04-22T09:55:00.000Z"),
  completedAt: new Date("2026-04-22T10:00:00.000Z"),
  heartbeatAt: new Date("2026-04-22T10:00:00.000Z"),
  updatedAt: new Date("2026-04-22T10:00:00.000Z"),
  concurrency: null,
  maxRecords: null,
  cancelledById: null,
  cancellationReason: null,
};

const newRowFactory = () => ({
  ...failedDelivery,
  id: `delivery-new-${Math.random().toString(36).slice(2, 8)}`,
  status: "success" as const,
  errorMessage: null,
  attemptedAt: new Date(),
  triggeredById: null,
  source: "resend" as const,
});

const mockGetDelivery = vi.fn(async () => failedDelivery);
const mockGetJob = vi.fn(async () => job);
const mockGetOperator = vi.fn(async () => null);
const mockGetSettings = vi.fn(async () => ({
  organizationId: ORG_A,
  slackWebhookUrl: null,
  emailRecipients: ["ops@example.com"],
}));
const mockListDeliveries = vi.fn(async () => [newRowFactory(), failedDelivery]);
const mockRecordDelivery = vi.fn(async () => undefined);
const mockListOrgAdmins = vi.fn(async () => []);
const mockWasFallbackSent = vi.fn(async () => false);
const mockRecordFallbackSent = vi.fn(async () => undefined);
const mockAggregateFailures = vi.fn(async () => []);

vi.mock("../storage", async () => {
  const actual = await vi.importActual<typeof import("../storage")>(
    "../storage",
  );
  return {
    ...actual,
    getCrmTranscriptBackfillAlertDelivery: (...args: unknown[]) =>
      mockGetDelivery(...(args as [])),
    getCrmTranscriptBackfillJob: (...args: unknown[]) =>
      mockGetJob(...(args as [])),
    getCrmTranscriptBackfillOperatorContact: (...args: unknown[]) =>
      mockGetOperator(...(args as [])),
    getCrmTranscriptBackfillNotificationSettings: (...args: unknown[]) =>
      mockGetSettings(...(args as [])),
    listCrmTranscriptBackfillAlertDeliveries: (...args: unknown[]) =>
      mockListDeliveries(...(args as [])),
    recordCrmTranscriptBackfillAlertDelivery: (...args: unknown[]) =>
      mockRecordDelivery(...(args as [])),
    listOrgAdminsForAlertFailureFallback: (...args: unknown[]) =>
      mockListOrgAdmins(...(args as [])),
    wasAlertFallbackSentSince: (...args: unknown[]) =>
      mockWasFallbackSent(...(args as [])),
    recordAlertFallbackSent: (...args: unknown[]) =>
      mockRecordFallbackSent(...(args as [])),
    aggregateRecentCrmTranscriptBackfillAlertFailures: (...args: unknown[]) =>
      mockAggregateFailures(...(args as [])),
  };
});

vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => true),
}));

// Importing AFTER vi.mock so the module under test sees the mocked storage.
const {
  resendBackfillAlertDelivery,
  __resetResendCooldownsForTests,
  RESEND_COOLDOWN_MS,
} = await import("../services/transcriptBackfillNotifications");

beforeEach(() => {
  __resetResendCooldownsForTests();
  // Re-prime the canned shapes — individual tests may shadow these.
  mockGetDelivery.mockReset().mockResolvedValue(failedDelivery);
  mockGetJob.mockReset().mockResolvedValue(job);
  mockGetOperator.mockReset().mockResolvedValue(null);
  mockGetSettings.mockReset().mockResolvedValue({
    organizationId: ORG_A,
    slackWebhookUrl: null,
    emailRecipients: ["ops@example.com"],
  });
  mockListDeliveries
    .mockReset()
    .mockImplementation(async () => [newRowFactory(), failedDelivery]);
  mockRecordDelivery.mockReset().mockResolvedValue(undefined);
  mockListOrgAdmins.mockReset().mockResolvedValue([]);
});

afterAll(() => {
  __resetResendCooldownsForTests();
});

describe("resendBackfillAlertDelivery — cooldown branch (Task #1068 / #1099)", () => {
  it("publishes the documented 30 second window via RESEND_COOLDOWN_MS", () => {
    expect(RESEND_COOLDOWN_MS).toBe(30_000);
  });

  it("returns COOLDOWN with retryAfterSeconds when called twice inside the window", async () => {
    const t0 = 1_000_000_000_000;

    const first = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0,
    );
    expect(first.ok).toBe(true);

    // 5s later — well inside the 30s window.
    const second = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0 + 5_000,
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.reason).toBe("COOLDOWN");
    if (second.reason !== "COOLDOWN") throw new Error("unreachable");
    // Window had 25s left → ceil(25) = 25 seconds.
    expect(second.retryAfterSeconds).toBe(25);

    // The cooled-down call must NOT re-enter the dispatcher: storage
    // reads after the cooldown gate (job lookup, settings lookup, etc.)
    // were each called exactly once during the first attempt.
    expect(mockGetJob).toHaveBeenCalledTimes(1);
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
    expect(mockListDeliveries).toHaveBeenCalledTimes(1);
  });

  it("clamps retryAfterSeconds to at least 1 even when only milliseconds remain", async () => {
    const t0 = 1_000_000_000_000;
    await resendBackfillAlertDelivery(ORG_A, DELIVERY_ID, null, t0);

    // 29.999s in — only 1ms of the window left. The implementation must
    // still surface a positive integer so HTTP `Retry-After` stays valid.
    const blocked = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0 + RESEND_COOLDOWN_MS - 1,
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok || blocked.reason !== "COOLDOWN") {
      throw new Error("expected COOLDOWN");
    }
    expect(Number.isInteger(blocked.retryAfterSeconds)).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it("releases the cooldown once the window has elapsed (post-window reset)", async () => {
    const t0 = 1_000_000_000_000;

    const first = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0,
    );
    expect(first.ok).toBe(true);

    // Exactly at the window boundary the cooldown must release: the
    // implementation gates on `now - last < RESEND_COOLDOWN_MS`, so a
    // delta equal to the window is allowed through.
    const after = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0 + RESEND_COOLDOWN_MS,
    );
    expect(after.ok).toBe(true);

    // Two real dispatches → dispatcher-side reads ran twice.
    expect(mockGetJob).toHaveBeenCalledTimes(2);
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });

  it("scopes the cooldown per organization", async () => {
    const t0 = 1_000_000_000_000;

    // Org A sends and is now in cooldown for that (job, channel).
    const a = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0,
    );
    expect(a.ok).toBe(true);

    // For org B we need the storage helpers to return rows belonging to
    // org B so the cooldown key (org-scoped) genuinely differs.
    const orgBDelivery = { ...failedDelivery, organizationId: ORG_B };
    const orgBJob = { ...job, organizationId: ORG_B };
    mockGetDelivery.mockResolvedValueOnce(orgBDelivery);
    mockGetJob.mockResolvedValueOnce(orgBJob);
    mockGetSettings.mockResolvedValueOnce({
      organizationId: ORG_B,
      slackWebhookUrl: null,
      emailRecipients: ["other@example.com"],
    });

    const b = await resendBackfillAlertDelivery(
      ORG_B,
      DELIVERY_ID,
      null,
      t0 + 1_000,
    );
    expect(b.ok).toBe(true);

    // And org A is still cooled down inside the window.
    const aAgain = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0 + 2_000,
    );
    expect(aAgain.ok).toBe(false);
    if (aAgain.ok || aAgain.reason !== "COOLDOWN") {
      throw new Error("expected org A to remain cooled down");
    }
  });

  it("__resetResendCooldownsForTests clears in-memory state between cases", async () => {
    const t0 = 1_000_000_000_000;
    await resendBackfillAlertDelivery(ORG_A, DELIVERY_ID, null, t0);

    // Inside the window, this would 429 — but resetting wipes the map.
    __resetResendCooldownsForTests();

    const fresh = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0 + 1_000,
    );
    expect(fresh.ok).toBe(true);
  });

  it("does not consume the window when a precondition (NOT_FAILED) trips before reservation", async () => {
    const t0 = 1_000_000_000_000;
    // Pretend the original delivery already succeeded — the helper short-
    // circuits BEFORE setting any cooldown timestamp, so a follow-up call
    // for a real failure on the same key must NOT be rate-limited.
    mockGetDelivery
      .mockResolvedValueOnce({ ...failedDelivery, status: "success" })
      .mockResolvedValueOnce(failedDelivery);

    const first = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0,
    );
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("unreachable");
    expect(first.reason).toBe("NOT_FAILED");

    const second = await resendBackfillAlertDelivery(
      ORG_A,
      DELIVERY_ID,
      null,
      t0 + 1_000,
    );
    expect(second.ok).toBe(true);
  });
});
