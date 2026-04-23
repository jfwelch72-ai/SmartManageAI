/**
 * Task #1152 — covers `notifyOrgAdminsOfFallbackCoverageGap`, the
 * proactive heads-up that fires when a per-channel realtime
 * alert-failure recipient count drops to zero. Stubs storage and the
 * email/slack transports so the helper can be exercised without
 * touching the network or DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSummarize,
  mockListAdmins,
  mockSendEmail,
  mockSendSlack,
  mockGetSettings,
  mockWasFallbackSent,
  mockRecordFallbackSent,
} = vi.hoisted(() => ({
  mockSummarize: vi.fn(),
  mockListAdmins: vi.fn(),
  mockSendEmail: vi.fn().mockResolvedValue(true),
  mockSendSlack: vi.fn().mockResolvedValue(undefined),
  mockGetSettings: vi.fn().mockResolvedValue(null),
  mockWasFallbackSent: vi.fn().mockResolvedValue(false),
  mockRecordFallbackSent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../storage", () => ({
  summarizeOrgAdminAlertFailureFallbackMutes: mockSummarize,
  listOrgAdminsForAlertFailureFallback: mockListAdmins,
  getCrmTranscriptBackfillNotificationSettings: mockGetSettings,
  wasAlertFallbackSentSince: mockWasFallbackSent,
  recordAlertFallbackSent: mockRecordFallbackSent,
  // Unused-but-imported by the module under test.
  aggregateRecentCrmTranscriptBackfillAlertFailures: vi.fn(),
  getCrmTranscriptBackfillAlertDelivery: vi.fn(),
  getCrmTranscriptBackfillJob: vi.fn(),
  getCrmTranscriptBackfillOperatorContact: vi.fn(),
  getCrmTranscriptBackfillTestAlertUsageSummary: vi.fn(),
  listCrmTranscriptBackfillAlertDeliveries: vi.fn(),
  pruneAlertFallbackSentBefore: vi.fn(),
  pruneBackfillAlertResendCooldownsBefore: vi.fn(),
  recordCrmTranscriptBackfillAlertDelivery: vi.fn(),
  recordCrmTranscriptBackfillThresholdAlert: vi.fn(),
  releaseBackfillAlertResendCooldown: vi.fn(),
  tryReserveBackfillAlertResendCooldown: vi.fn(),
}));

vi.mock("../services/slackService", () => ({
  isValidSlackWebhookUrl: (u: string) => /^https:\/\/hooks\.slack\.com\//.test(u),
  sendSlackMessage: mockSendSlack,
}));

vi.mock("../services/emailService", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../utils/logger", () => ({
  logInfo: () => undefined,
  logWarn: () => undefined,
  logError: () => undefined,
}));

import {
  notifyOrgAdminsOfFallbackCoverageGap,
  buildCoverageGapNotificationContent,
  _resetCoverageGapDedupeForTests,
} from "../services/transcriptBackfillNotifications";

beforeEach(() => {
  vi.clearAllMocks();
  mockWasFallbackSent.mockResolvedValue(false);
  mockRecordFallbackSent.mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(true);
  mockSendSlack.mockResolvedValue(undefined);
  mockGetSettings.mockResolvedValue(null);
  _resetCoverageGapDedupeForTests();
});

describe("buildCoverageGapNotificationContent", () => {
  it("singular phrasing when one admin muted", () => {
    const c = buildCoverageGapNotificationContent({
      channel: "slack",
      mutedAdminCount: 1,
    });
    expect(c.subject).toMatch(/Slack/);
    expect(c.text).toMatch(/1 admin has muted/);
    expect(c.html).toMatch(/Slack/);
    expect(c.slackTitle).toMatch(/Slack/);
  });

  it("plural phrasing when multiple admins muted", () => {
    const c = buildCoverageGapNotificationContent({
      channel: "email",
      mutedAdminCount: 3,
    });
    expect(c.text).toMatch(/3 admins have muted/);
  });
});

describe("notifyOrgAdminsOfFallbackCoverageGap", () => {
  it("emails remaining admins when a channel hits zero by mute", async () => {
    mockSummarize.mockResolvedValue({
      slack: { mutedAdminCount: 2, effectiveRecipientCount: 0 },
      email: { mutedAdminCount: 0, effectiveRecipientCount: 1 },
      digest: { eligibleRecipientCount: 1, streamMutedAdminCount: 0 },
    });
    mockListAdmins.mockResolvedValue([
      { id: "u1", email: "a@x.co", firstName: "A", lastName: null },
      { id: "u2", email: "b@x.co", firstName: null, lastName: null },
    ]);

    const result = await notifyOrgAdminsOfFallbackCoverageGap("org-1");

    expect(result).toEqual(["slack"]);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const call = mockSendEmail.mock.calls[0][0];
    expect(call.to).toEqual(["a@x.co", "b@x.co"]);
    expect(call.subject).toMatch(/Slack/);
    expect(mockRecordFallbackSent).toHaveBeenCalledTimes(1);
    expect(mockSendSlack).not.toHaveBeenCalled();
  });

  it("does not fire when zero recipients but no admin actively muted (e.g. empty org)", async () => {
    mockSummarize.mockResolvedValue({
      slack: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
      email: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
      digest: { eligibleRecipientCount: 0, streamMutedAdminCount: 0 },
    });
    const result = await notifyOrgAdminsOfFallbackCoverageGap("org-1");
    expect(result).toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSlack).not.toHaveBeenCalled();
  });

  it("falls back to legacy slack webhook when no admins remain reachable", async () => {
    mockSummarize.mockResolvedValue({
      slack: { mutedAdminCount: 0, effectiveRecipientCount: 1 },
      email: { mutedAdminCount: 4, effectiveRecipientCount: 0 },
      digest: { eligibleRecipientCount: 0, streamMutedAdminCount: 0 },
    });
    // No admins reachable via realtime stream on any channel.
    mockListAdmins.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue({
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/X",
      emailRecipients: [],
    });

    const result = await notifyOrgAdminsOfFallbackCoverageGap("org-1");

    expect(result).toEqual(["email"]);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSlack).toHaveBeenCalledTimes(1);
    const [url, title, message] = mockSendSlack.mock.calls[0];
    expect(url).toMatch(/hooks\.slack\.com/);
    expect(title).toMatch(/email/);
    expect(message).toMatch(/email/);
    expect(mockRecordFallbackSent).toHaveBeenCalledTimes(1);
  });

  it("debounces via persisted ledger so toggling preferences does not spam", async () => {
    mockSummarize.mockResolvedValue({
      slack: { mutedAdminCount: 1, effectiveRecipientCount: 0 },
      email: { mutedAdminCount: 0, effectiveRecipientCount: 1 },
      digest: { eligibleRecipientCount: 1, streamMutedAdminCount: 0 },
    });
    mockListAdmins.mockResolvedValue([
      { id: "u1", email: "a@x.co", firstName: null, lastName: null },
    ]);
    // First call — fires.
    await notifyOrgAdminsOfFallbackCoverageGap("org-1");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // Persisted ledger now reports "already sent" — second call must be a no-op.
    mockWasFallbackSent.mockResolvedValue(true);
    _resetCoverageGapDedupeForTests(); // clear in-memory so we exercise the DB path
    const result = await notifyOrgAdminsOfFallbackCoverageGap("org-1");
    expect(result).toEqual([]);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("in-memory dedupe short-circuits repeat calls in the same process", async () => {
    mockSummarize.mockResolvedValue({
      slack: { mutedAdminCount: 1, effectiveRecipientCount: 0 },
      email: { mutedAdminCount: 0, effectiveRecipientCount: 1 },
      digest: { eligibleRecipientCount: 1, streamMutedAdminCount: 0 },
    });
    mockListAdmins.mockResolvedValue([
      { id: "u1", email: "a@x.co", firstName: null, lastName: null },
    ]);
    await notifyOrgAdminsOfFallbackCoverageGap("org-1");
    await notifyOrgAdminsOfFallbackCoverageGap("org-1");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    // Second call must not have re-checked the persisted ledger.
    expect(mockWasFallbackSent).toHaveBeenCalledTimes(1);
  });

  it("never throws when the storage summary lookup fails", async () => {
    mockSummarize.mockRejectedValue(new Error("db down"));
    await expect(
      notifyOrgAdminsOfFallbackCoverageGap("org-1"),
    ).resolves.toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does nothing when no admins reachable AND no legacy slack webhook configured", async () => {
    mockSummarize.mockResolvedValue({
      slack: { mutedAdminCount: 0, effectiveRecipientCount: 1 },
      email: { mutedAdminCount: 2, effectiveRecipientCount: 0 },
      digest: { eligibleRecipientCount: 0, streamMutedAdminCount: 0 },
    });
    mockListAdmins.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue(null);
    // Also clear env-var fallback for the duration of this test.
    const prev = process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK;
    delete process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK;
    try {
      const result = await notifyOrgAdminsOfFallbackCoverageGap("org-1");
      expect(result).toEqual([]);
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(mockSendSlack).not.toHaveBeenCalled();
      expect(mockRecordFallbackSent).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined)
        process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK = prev;
    }
  });
});
