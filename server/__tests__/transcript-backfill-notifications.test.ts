/**
 * Task #1008 — covers the pure formatter that builds the Slack/email
 * payloads for the transcript-backfill run-completed alerts. The dispatcher
 * itself is a thin wrapper around the existing slack/email transports and
 * is exercised through the worker's finally block, so the unit tests focus
 * on the wording (operator name + email surfacing, deleted-user fallback,
 * retry detection, status verb).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Task #1017 — the dispatcher now consults storage for per-org settings, so
// stub storage out before the module under test is imported. The pure
// formatter tests below don't touch the network or DB. Use vi.hoisted so the
// mock fns are initialized before vi.mock factories run.
const {
  mockGetSettings,
  mockRecordDelivery,
  mockFetch,
  mockSendEmail,
  mockListOrgAdmins,
  mockWasFallbackSent,
  mockRecordFallbackSent,
  mockGetAlertDelivery,
  mockGetBackfillJob,
  mockListAlertDeliveries,
  mockGetOperatorContact,
  mockTryReserveResendCooldown,
  mockReleaseResendCooldown,
} = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockRecordDelivery: vi.fn().mockResolvedValue({}),
  // Task #1031 — the dispatcher now POSTs to the Slack webhook directly so
  // it can record real per-channel success/failure outcomes. Stub global
  // fetch so the unit tests can observe the calls without hitting the net.
  mockFetch: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
  mockSendEmail: vi.fn().mockResolvedValue(true),
  // Task #1051 — fallback email lookup. Default to "no admins" so existing
  // tests don't accidentally trigger fan-out emails; the new dedicated
  // describe block overrides this per case.
  mockListOrgAdmins: vi.fn().mockResolvedValue([]),
  // Task #1067 — persisted dedupe ledger. Default to "never sent" so the
  // existing in-memory dedupe tests behave the same as before.
  mockWasFallbackSent: vi.fn().mockResolvedValue(false),
  mockRecordFallbackSent: vi.fn().mockResolvedValue(undefined),
  // Task #1098 — resend path mocks. Defaults to "no row found" so the
  // existing tests don't accidentally exercise the resend codepath.
  mockGetAlertDelivery: vi.fn().mockResolvedValue(null),
  mockGetBackfillJob: vi.fn().mockResolvedValue(null),
  mockListAlertDeliveries: vi.fn().mockResolvedValue([]),
  mockGetOperatorContact: vi.fn().mockResolvedValue(null),
  // Defaults to "always reserve" — individual cases override to simulate
  // a still-active persisted cooldown.
  mockTryReserveResendCooldown: vi
    .fn()
    .mockResolvedValue({ ok: true, reservedAt: new Date() }),
  mockReleaseResendCooldown: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage", () => ({
  getCrmTranscriptBackfillNotificationSettings: mockGetSettings,
  recordCrmTranscriptBackfillAlertDelivery: mockRecordDelivery,
  listOrgAdminsForAlertFailureFallback: mockListOrgAdmins,
  wasAlertFallbackSentSince: mockWasFallbackSent,
  recordAlertFallbackSent: mockRecordFallbackSent,
  getCrmTranscriptBackfillAlertDelivery: mockGetAlertDelivery,
  getCrmTranscriptBackfillJob: mockGetBackfillJob,
  listCrmTranscriptBackfillAlertDeliveries: mockListAlertDeliveries,
  getCrmTranscriptBackfillOperatorContact: mockGetOperatorContact,
  tryReserveBackfillAlertResendCooldown: mockTryReserveResendCooldown,
  releaseBackfillAlertResendCooldown: mockReleaseResendCooldown,
}));
vi.mock("../services/slackService", () => ({
  isValidSlackWebhookUrl: (u: string) => /^https:\/\/hooks\.slack\.com\//.test(u),
}));
vi.mock("../services/emailService", () => ({
  sendEmail: mockSendEmail,
}));
vi.stubGlobal("fetch", mockFetch);
vi.mock("../utils/logger", () => ({
  logInfo: () => undefined,
  logWarn: () => undefined,
  logError: () => undefined,
}));

import {
  formatBackfillCompletionNotification,
  describeBackfillOperator,
  notifyBackfillCompletion,
  notifyOrgAdminsOfAlertDeliveryFailure,
  buildAlertFailureFallbackContent,
  resolveBackfillNotificationDestinations,
  getBackfillNotificationConfig,
  resendBackfillAlertDelivery,
  sendTestBackfillAlert,
  _resetAlertFailureFallbackDedupeForTests,
  __resetResendCooldownsForTests,
  RESEND_COOLDOWN_MS,
  type BackfillNotificationJob,
} from "../services/transcriptBackfillNotifications";

const baseJob: BackfillNotificationJob = {
  id: "backfill-123-abc",
  orgId: "org-1",
  status: "COMPLETED",
  total: 10,
  processed: 10,
  succeeded: 8,
  failed: 2,
  startedAt: "2026-04-22T12:00:00.000Z",
  completedAt: "2026-04-22T12:05:00.000Z",
  parentJobId: null,
};

describe("describeBackfillOperator", () => {
  it("uses first + last name when available", () => {
    expect(
      describeBackfillOperator({
        id: "u1",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
      }),
    ).toEqual({ display: "Jane Doe", email: "jane@example.com" });
  });

  it("falls back to single name, then email, then deleted label", () => {
    expect(
      describeBackfillOperator({ id: "u1", firstName: "Jane", lastName: null, email: null }),
    ).toEqual({ display: "Jane", email: "(no email on file)" });
    expect(
      describeBackfillOperator({ id: "u1", firstName: null, lastName: null, email: "x@y.co" }),
    ).toEqual({ display: "x@y.co", email: "x@y.co" });
    expect(
      describeBackfillOperator({ id: "u1", firstName: null, lastName: null, email: null }),
    ).toEqual({ display: "Unknown operator (deleted user)", email: "(no email on file)" });
  });

  it("renders the deleted-user fallback when the operator record is missing", () => {
    expect(describeBackfillOperator(null)).toEqual({
      display: "Unknown operator (deleted user)",
      email: "(no email on file)",
    });
  });
});

describe("formatBackfillCompletionNotification", () => {
  it("includes the operator display name and email in every channel", () => {
    const out = formatBackfillCompletionNotification(baseJob, {
      id: "u1",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
    });
    expect(out.title).toBe("Transcript backfill completed");
    expect(out.emailSubject).toBe(
      "[CRM] Transcript backfill completed — started by Jane Doe",
    );
    expect(out.slackBody).toContain("Jane Doe");
    expect(out.slackBody).toContain("jane@example.com");
    expect(out.emailText).toContain("Jane Doe");
    expect(out.emailText).toContain("jane@example.com");
    expect(out.emailHtml).toContain("Jane Doe");
    expect(out.emailHtml).toContain("jane@example.com");
  });

  it("falls back gracefully when the operator was deleted", () => {
    const out = formatBackfillCompletionNotification(baseJob, null);
    expect(out.operatorDisplay).toBe("Unknown operator (deleted user)");
    expect(out.operatorEmail).toBe("(no email on file)");
    expect(out.emailSubject).toContain("Unknown operator (deleted user)");
    expect(out.slackBody).toContain("Unknown operator (deleted user)");
    expect(out.slackBody).toContain("(no email on file)");
  });

  it("flips the verb to 'failed' when the job failed", () => {
    const out = formatBackfillCompletionNotification(
      { ...baseJob, status: "FAILED" },
      { id: "u1", firstName: "Sam", lastName: null, email: "sam@x.co" },
    );
    expect(out.title).toBe("Transcript backfill failed");
    expect(out.emailSubject).toContain("failed");
    expect(out.slackBody).toContain("FAILED");
  });

  // Task #1057 — cancelled runs are a distinct terminal state (admin
  // deliberately stopped the run) rather than a crash, so the verb /
  // subject reads "cancelled" instead of "failed".
  it("uses the 'cancelled' verb when the job was cancelled", () => {
    const out = formatBackfillCompletionNotification(
      { ...baseJob, status: "CANCELLED" },
      { id: "u1", firstName: "Sam", lastName: null, email: "sam@x.co" },
    );
    expect(out.title).toBe("Transcript backfill cancelled");
    expect(out.emailSubject).toContain("cancelled");
    expect(out.emailSubject).not.toContain("failed");
    expect(out.slackBody).toContain("CANCELLED");
  });

  // Task #1091 — pin the cancellation-context surface area. Task #1070 added
  // the canceller display + free-text reason to the cancel completion alert;
  // these tests assert all four output channels (slackBody, emailText,
  // emailHtml, emailSubject) include both the canceller name and the reason
  // when the run was cancelled and a canceller context is passed in.
  describe("CANCELLED with canceller context (Task #1070 / #1091)", () => {
    const operator = {
      id: "u-op",
      firstName: "Olive",
      lastName: "Operator",
      email: "olive@example.com",
    };
    const canceller = {
      id: "u-cancel",
      firstName: "Cassie",
      lastName: "Canceller",
      email: "cassie@example.com",
    };

    it("renders canceller + reason in slackBody, emailText, emailHtml, and emailSubject", () => {
      const out = formatBackfillCompletionNotification(
        {
          ...baseJob,
          status: "CANCELLED",
          cancelledById: canceller.id,
          cancellationReason: "Wrong org targeted",
        },
        operator,
        { canceller },
      );

      // Subject names the canceller and still mentions the operator who
      // started the run, with the dedicated "cancelled" verb.
      expect(out.emailSubject).toBe(
        "[CRM] Transcript backfill cancelled by Cassie Canceller — started by Olive Operator",
      );
      expect(out.emailSubject).toContain("cancelled");
      expect(out.emailSubject).not.toContain("failed");

      // Slack body surfaces both the canceller line and the reason line.
      expect(out.slackBody).toContain("*Cancelled by:* Cassie Canceller <cassie@example.com>");
      expect(out.slackBody).toContain("*Reason:* Wrong org targeted");
      expect(out.slackBody).toContain("*Status:* CANCELLED");

      // Plain-text email mirrors the Slack copy.
      expect(out.emailText).toContain("Cancelled by: Cassie Canceller <cassie@example.com>");
      expect(out.emailText).toContain("Reason: Wrong org targeted");

      // HTML email renders the canceller + reason rows with escaped values.
      expect(out.emailHtml).toContain("Cancelled by");
      expect(out.emailHtml).toContain("Cassie Canceller");
      expect(out.emailHtml).toContain("cassie@example.com");
      expect(out.emailHtml).toContain("Reason");
      expect(out.emailHtml).toContain("Wrong org targeted");
    });

    it("omits the Reason line on every channel when no reason was supplied", () => {
      const out = formatBackfillCompletionNotification(
        {
          ...baseJob,
          status: "CANCELLED",
          cancelledById: canceller.id,
          cancellationReason: null,
        },
        operator,
        { canceller },
      );

      // Canceller line is still present...
      expect(out.slackBody).toContain("*Cancelled by:* Cassie Canceller");
      expect(out.emailText).toContain("Cancelled by: Cassie Canceller");
      expect(out.emailHtml).toContain("Cancelled by");
      expect(out.emailSubject).toContain("by Cassie Canceller");

      // ...but the Reason line/row is suppressed entirely so the alert
      // doesn't read "Reason: null" or print an empty row.
      expect(out.slackBody).not.toContain("*Reason:*");
      expect(out.emailText).not.toMatch(/^Reason:/m);
      expect(out.emailHtml).not.toContain("<strong>Reason</strong>");
    });

    it("falls back to the deleted-user label when cancelledById is set but the canceller record is missing", () => {
      const out = formatBackfillCompletionNotification(
        {
          ...baseJob,
          status: "CANCELLED",
          cancelledById: "u-deleted",
          cancellationReason: "Cleanup after a misfire",
        },
        operator,
        { canceller: null },
      );

      expect(out.emailSubject).toContain("by Unknown operator (deleted user)");
      expect(out.slackBody).toContain("*Cancelled by:* Unknown operator (deleted user)");
      expect(out.slackBody).toContain("(no email on file)");
      expect(out.slackBody).toContain("*Reason:* Cleanup after a misfire");
      expect(out.emailText).toContain(
        "Cancelled by: Unknown operator (deleted user) <(no email on file)>",
      );
      expect(out.emailText).toContain("Reason: Cleanup after a misfire");
      expect(out.emailHtml).toContain("Unknown operator (deleted user)");
      expect(out.emailHtml).toContain("Cleanup after a misfire");
    });

    it("does NOT add canceller wording when status is CANCELLED but no cancellation context is wired in", () => {
      // Defensive: if callers forget to pass cancelContext (and the row
      // also lacks cancelledById), the alert should still render the
      // "cancelled" verb without inventing a canceller line.
      const out = formatBackfillCompletionNotification(
        { ...baseJob, status: "CANCELLED" },
        operator,
      );

      expect(out.title).toBe("Transcript backfill cancelled");
      expect(out.emailSubject).toBe(
        "[CRM] Transcript backfill cancelled — started by Olive Operator",
      );
      expect(out.emailSubject).not.toMatch(/cancelled by/i);
      expect(out.slackBody).not.toContain("Cancelled by:");
      expect(out.emailText).not.toMatch(/^Cancelled by:/m);
      expect(out.emailHtml).not.toContain("<strong>Cancelled by</strong>");
    });

    it("escapes HTML special characters in the canceller name and reason", () => {
      const out = formatBackfillCompletionNotification(
        {
          ...baseJob,
          status: "CANCELLED",
          cancelledById: "u-cancel",
          cancellationReason: "<script>alert('x')</script> & runaway",
        },
        operator,
        {
          canceller: {
            id: "u-cancel",
            firstName: "Eve <evil>",
            lastName: "& Co",
            email: "eve&co@example.com",
          },
        },
      );

      expect(out.emailHtml).not.toContain("<script>alert");
      expect(out.emailHtml).toContain("Eve &lt;evil&gt;");
      expect(out.emailHtml).toContain("&amp; Co");
      expect(out.emailHtml).toContain("eve&amp;co@example.com");
      expect(out.emailHtml).toContain("&lt;script&gt;alert('x')&lt;/script&gt; &amp; runaway");
    });
  });

  it("labels retries distinctly and references the parent job id", () => {
    const out = formatBackfillCompletionNotification(
      { ...baseJob, parentJobId: "backfill-original-xyz" },
      { id: "u1", firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
    );
    expect(out.title).toBe("Transcript backfill retry completed");
    expect(out.slackBody).toContain("backfill-original-xyz");
    expect(out.emailText).toContain("retry of backfill-original-xyz");
    expect(out.emailHtml).toContain("backfill-original-xyz");
  });

  it("escapes HTML special characters in the email body", () => {
    const out = formatBackfillCompletionNotification(baseJob, {
      id: "u1",
      firstName: "Ann <script>",
      lastName: "O'Toole & Co",
      email: "a&b@x.co",
    });
    expect(out.emailHtml).not.toContain("<script>");
    expect(out.emailHtml).toContain("Ann &lt;script&gt;");
    expect(out.emailHtml).toContain("a&amp;b@x.co");
  });
});

describe("resolveBackfillNotificationDestinations (Task #1017)", () => {
  const ORIG_ENV = { ...process.env };
  beforeEach(() => {
    mockGetSettings.mockReset();
    delete process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK;
    delete process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO;
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("uses per-org settings when a row exists (env vars ignored)", async () => {
    process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK =
      "https://hooks.slack.com/services/ENV";
    process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO = "env@example.com";
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: ["alerts@example.com", "ops@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    const out = await resolveBackfillNotificationDestinations("org-1");
    expect(out.slackWebhookUrl).toBe("https://hooks.slack.com/services/ORG");
    expect(out.emailRecipients).toEqual(["alerts@example.com", "ops@example.com"]);
  });

  it("treats an explicitly-cleared per-org row as authoritative (no env fallback)", async () => {
    process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK =
      "https://hooks.slack.com/services/ENV";
    process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO = "env@example.com";
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: null,
      emailRecipients: [],
      updatedAt: new Date(),
      updatedById: null,
    });
    const out = await resolveBackfillNotificationDestinations("org-1");
    expect(out.slackWebhookUrl).toBeNull();
    expect(out.emailRecipients).toEqual([]);
  });

  it("falls back to env vars when no per-org row exists", async () => {
    process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK =
      "https://hooks.slack.com/services/ENV";
    process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO = "a@x.co, b@x.co";
    mockGetSettings.mockResolvedValue(null);
    const out = await resolveBackfillNotificationDestinations("org-1");
    expect(out.slackWebhookUrl).toBe("https://hooks.slack.com/services/ENV");
    expect(out.emailRecipients).toEqual(["a@x.co", "b@x.co"]);
  });

  it("returns no destinations when neither per-org nor env are set", async () => {
    mockGetSettings.mockResolvedValue(null);
    const out = await resolveBackfillNotificationDestinations("org-1");
    expect(out.slackWebhookUrl).toBeNull();
    expect(out.emailRecipients).toEqual([]);
  });
});

describe("notifyBackfillCompletion (Task #1017)", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockRecordDelivery.mockClear();
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(true);
    mockListOrgAdmins.mockReset();
    mockListOrgAdmins.mockResolvedValue([]);
    _resetAlertFailureFallbackDedupeForTests();
    delete process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK;
    delete process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO;
  });

  it("dispatches to per-org Slack + email destinations", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    await notifyBackfillCompletion(baseJob, null);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/ORG",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["alerts@example.com"] }),
    );
  });

  it("is a no-op when no destinations are configured", async () => {
    mockGetSettings.mockResolvedValue(null);
    await notifyBackfillCompletion(baseJob, null);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockRecordDelivery).not.toHaveBeenCalled();
  });

  it("skips an invalid Slack URL but still dispatches email", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://example.com/not-slack",
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    await notifyBackfillCompletion(baseJob, null);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalled();
    // Task #1031 — invalid Slack URL is recorded as a failure so admins can
    // see the misconfiguration in the in-app history card.
    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "slack",
        status: "failure",
      }),
    );
  });

  it("records per-channel success when both transports succeed (Task #1031)", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    await notifyBackfillCompletion(baseJob, null);
    const channels = mockRecordDelivery.mock.calls.map((c) => c[0].channel);
    const statuses = mockRecordDelivery.mock.calls.map((c) => c[0].status);
    expect(channels.sort()).toEqual(["email", "slack"]);
    expect(statuses).toEqual(["success", "success"]);
  });

  it("records a Slack failure when the webhook returns non-2xx (Task #1031)", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: [],
      updatedAt: new Date(),
      updatedById: null,
    });
    mockFetch.mockResolvedValueOnce(
      new Response("invalid_payload", { status: 400 }),
    );
    await notifyBackfillCompletion(baseJob, null);
    expect(mockRecordDelivery).toHaveBeenCalledTimes(1);
    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "slack",
        status: "failure",
        errorMessage: expect.stringContaining("400"),
      }),
    );
  });

  it("records an email failure when the transport returns false (Task #1031)", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: null,
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    mockSendEmail.mockResolvedValueOnce(false);
    await notifyBackfillCompletion(baseJob, null);
    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        status: "failure",
      }),
    );
  });
});

/**
 * Task #1044 — covers `sendTestBackfillAlert`, which the admin "Send test
 * alert" button on the backfill settings card calls. The dispatcher should
 * (a) read the saved per-org settings via `resolveBackfillNotificationDestinations`,
 * (b) report per-channel `configured`/`ok`/`error` shapes the UI can toast on,
 * and (c) gracefully tolerate transport failures on either channel.
 *
 * The Slack POST goes through raw `fetch` (so the helper can surface a real
 * status), so we stub `global.fetch` here. Email goes through the mocked
 * `sendEmail` whose return value drives the `ok` flag.
 */
describe("sendTestBackfillAlert (Task #1030 / #1044)", () => {
  const ORIG_FETCH = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  const operator = {
    id: "u1",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
  };

  beforeEach(() => {
    mockGetSettings.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(true);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "ok",
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK;
    delete process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO;
  });
  afterEach(() => {
    global.fetch = ORIG_FETCH;
  });

  it("targets the saved per-org Slack webhook only when only Slack is saved", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: [],
      updatedAt: new Date(),
      updatedById: null,
    });
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.slack).toEqual({ configured: true, ok: true });
    expect(result.email).toEqual({ configured: false, ok: false });
    expect(result.operatorDisplay).toBe("Jane Doe");
    // Both sample alerts (completed + failed) should be POSTed to the saved URL.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://hooks.slack.com/services/ORG",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("targets the saved per-org email recipients only when only email is saved", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: null,
      emailRecipients: ["alerts@example.com", "ops@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.slack).toEqual({ configured: false, ok: false });
    expect(result.email).toMatchObject({
      configured: true,
      ok: true,
      recipients: ["alerts@example.com", "ops@example.com"],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Two sample alerts → two sendEmail calls, both to the saved recipients.
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    for (const call of mockSendEmail.mock.calls) {
      expect(call[0]).toMatchObject({
        to: ["alerts@example.com", "ops@example.com"],
      });
      expect(call[0].subject).toMatch(/^\[TEST\] /);
    }
  });

  it("dispatches to both channels when both are saved", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.slack).toEqual({ configured: true, ok: true });
    expect(result.email).toMatchObject({
      configured: true,
      ok: true,
      recipients: ["alerts@example.com"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it("returns 'no destinations' shape when neither channel is saved", async () => {
    mockGetSettings.mockResolvedValue(null);
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.slack).toEqual({ configured: false, ok: false });
    expect(result.email).toEqual({ configured: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("flags an invalid Slack URL without attempting a network call", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://example.com/not-slack",
      emailRecipients: [],
      updatedAt: new Date(),
      updatedById: null,
    });
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.slack.configured).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toMatch(/Invalid Slack webhook URL/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a Slack transport failure as ok=false with the error message", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "boom",
    } as unknown as Response);
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.slack.configured).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toMatch(/500/);
    expect(result.slack.error).toMatch(/boom/);
    // Email channel should still succeed independently.
    expect(result.email.ok).toBe(true);
  });

  it("surfaces an email transport failure as ok=false with the error message", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    mockSendEmail.mockRejectedValue(new Error("smtp blew up"));
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.email.configured).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("smtp blew up");
    // Slack channel should remain unaffected.
    expect(result.slack.ok).toBe(true);
  });

  it("reports email ok=false when the transport returns a falsy result", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: null,
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    mockSendEmail.mockResolvedValue(false);
    const result = await sendTestBackfillAlert("org-1", operator);
    expect(result.email.configured).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toMatch(/non-success/i);
  });
});

/**
 * Task #1051 — fallback email to org admins when an alert delivery fails.
 * Covers (a) the standalone helper's dedupe + opt-out behavior, (b) the
 * `notifyBackfillCompletion` integration so a recorded failure row also
 * fans out an email, and (c) the content builder.
 */
describe("notifyOrgAdminsOfAlertDeliveryFailure (Task #1051)", () => {
  const adminA = {
    id: "u-admin-a",
    email: "admin-a@example.com",
    firstName: "Ada",
    lastName: "Admin",
  };
  const adminB = {
    id: "u-admin-b",
    email: "admin-b@example.com",
    firstName: null,
    lastName: null,
  };

  beforeEach(() => {
    mockListOrgAdmins.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(true);
    mockWasFallbackSent.mockReset();
    mockWasFallbackSent.mockResolvedValue(false);
    mockRecordFallbackSent.mockReset();
    mockRecordFallbackSent.mockResolvedValue(undefined);
    _resetAlertFailureFallbackDedupeForTests();
  });

  it("emails every eligible admin with a one-line summary + history link", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA, adminB]);
    const sent = await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    });
    expect(sent).toBe(2);
    // Task #1066 + Task #1076: the failing channel is forwarded so per-channel
    // mutes (e.g. "ignore Slack failures") can be honored at lookup time, and
    // the "realtime" stream filter excludes admins who opted into digest-only
    // / none.
    expect(mockListOrgAdmins).toHaveBeenCalledWith("org-1", "slack", "realtime");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const call = mockSendEmail.mock.calls[0][0];
    expect(call.to).toEqual(["admin-a@example.com", "admin-b@example.com"]);
    expect(call.subject).toMatch(/alert delivery failed/i);
    expect(call.text).toContain("Slack webhook returned 404");
    expect(call.text).toContain("hooks.slack.com");
    expect(call.text).toContain("/admin/transcript-backfill");
    expect(call.html).toContain("/admin/transcript-backfill");
  });

  it("is a no-op when the org has no eligible admins", async () => {
    mockListOrgAdmins.mockResolvedValue([]);
    const sent = await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "email",
      recipientSummary: "ops@example.com",
      errorMessage: "smtp 550",
    });
    expect(sent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("de-duplicates identical failures within the dedupe window", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    const input = {
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack" as const,
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    };
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(1);
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(0);
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(0);
    // Only the very first call should have hit the email transport.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("treats a different channel/error/recipient as a distinct failure", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-1",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    });
    // Different channel — should send.
    await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-1",
      channel: "email",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    });
    // Different error message — should send.
    await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-1",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 500",
    });
    // Different org — should send.
    await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-2",
      jobId: "job-1",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    });
    expect(mockSendEmail).toHaveBeenCalledTimes(4);
  });

  it("never throws when the email transport fails", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockSendEmail.mockRejectedValueOnce(new Error("smtp blew up"));
    await expect(
      notifyOrgAdminsOfAlertDeliveryFailure({
        orgId: "org-1",
        jobId: "job-1",
        channel: "email",
        recipientSummary: "ops@example.com",
        errorMessage: "smtp 550",
      }),
    ).resolves.toBe(0);
  });

  it("does not start the dedupe window when the email transport fails", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    // First attempt fails — should NOT mark the key, so a retry within the
    // window still goes out instead of being silently suppressed.
    mockSendEmail.mockResolvedValueOnce(false);
    const input = {
      orgId: "org-1",
      jobId: "job-1",
      channel: "slack" as const,
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 500",
    };
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(0);
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(1);
    // Now the second (successful) call set the key — third call should dedupe.
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(0);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it("does not start the dedupe window when the admin lookup fails", async () => {
    mockListOrgAdmins.mockRejectedValueOnce(new Error("db down"));
    mockListOrgAdmins.mockResolvedValueOnce([adminA]);
    const input = {
      orgId: "org-1",
      jobId: "job-1",
      channel: "slack" as const,
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 500",
    };
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(0);
    // Second attempt should still go through — the failed first attempt
    // must not have started the dedupe window.
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(1);
  });

  it("never throws when the admin lookup fails", async () => {
    mockListOrgAdmins.mockRejectedValueOnce(new Error("db down"));
    await expect(
      notifyOrgAdminsOfAlertDeliveryFailure({
        orgId: "org-1",
        jobId: "job-1",
        channel: "slack",
        recipientSummary: "hooks.slack.com",
        errorMessage: "Slack webhook returned 404",
      }),
    ).resolves.toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // Task #1067 — cross-process dedupe via the persisted ledger. The first
  // batch of cases simulates a fresh process (cold in-memory cache) seeing
  // a key that another process / a previous instance has already sent
  // within the dedupe window.
  it("respects the persisted dedupe ledger after a restart (in-memory cache cold)", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockWasFallbackSent.mockResolvedValueOnce(true);
    const sent = await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    });
    expect(sent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockListOrgAdmins).not.toHaveBeenCalled();
    // The ledger lookup must have been keyed off org + channel + a SHA-256
    // hash of the (trimmed/truncated) error message so very long messages
    // can't blow up the row width.
    expect(mockWasFallbackSent).toHaveBeenCalledTimes(1);
    const [keyArg, sinceArg] = mockWasFallbackSent.mock.calls[0];
    expect(keyArg).toMatchObject({
      orgId: "org-1",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
    });
    expect(keyArg.errorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sinceArg).toBeInstanceOf(Date);
  });

  it("persists the dedupe key after a successful send so other processes see it", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    const sent = await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    });
    expect(sent).toBe(1);
    expect(mockRecordFallbackSent).toHaveBeenCalledTimes(1);
    const persistedKey = mockRecordFallbackSent.mock.calls[0][0];
    expect(persistedKey).toMatchObject({
      orgId: "org-1",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
    });
    expect(persistedKey.errorHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not persist the dedupe key when the send fails", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockSendEmail.mockResolvedValueOnce(false);
    const sent = await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 500",
    });
    expect(sent).toBe(0);
    expect(mockRecordFallbackSent).not.toHaveBeenCalled();
  });

  it("still sends when the persisted dedupe lookup throws (DB read fails open)", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockWasFallbackSent.mockRejectedValueOnce(new Error("db down"));
    const sent = await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 500",
    });
    expect(sent).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("still returns the admin count when persisting the dedupe key fails", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockRecordFallbackSent.mockRejectedValueOnce(new Error("db write failed"));
    const sent = await notifyOrgAdminsOfAlertDeliveryFailure({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 500",
    });
    expect(sent).toBe(1);
  });

  it("uses the in-memory cache as a fast-path and skips the DB lookup on repeats", async () => {
    mockListOrgAdmins.mockResolvedValue([adminA]);
    const input = {
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack" as const,
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    };
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(1);
    expect(await notifyOrgAdminsOfAlertDeliveryFailure(input)).toBe(0);
    // First call hit the ledger; second call short-circuited on the cache.
    expect(mockWasFallbackSent).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("notifyBackfillCompletion fallback wiring (Task #1051)", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockRecordDelivery.mockClear();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(true);
    mockListOrgAdmins.mockReset();
    mockListOrgAdmins.mockResolvedValue([
      {
        id: "u-admin-a",
        email: "admin-a@example.com",
        firstName: "Ada",
        lastName: "Admin",
      },
    ]);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    mockWasFallbackSent.mockReset();
    mockWasFallbackSent.mockResolvedValue(false);
    mockRecordFallbackSent.mockReset();
    mockRecordFallbackSent.mockResolvedValue(undefined);
    _resetAlertFailureFallbackDedupeForTests();
  });

  it("emails admins after a Slack failure row is recorded", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: [],
      updatedAt: new Date(),
      updatedById: null,
    });
    mockFetch.mockResolvedValueOnce(new Response("invalid_payload", { status: 400 }));
    await notifyBackfillCompletion(baseJob, null);

    // The original Slack failure should be recorded, and the fallback email
    // should be sent to the org's admins.
    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "slack", status: "failure" }),
    );
    // Task #1066 + Task #1076 — failing channel forwarded for per-channel mute,
    // plus the "realtime" stream filter excludes digest-only / none recipients.
    expect(mockListOrgAdmins).toHaveBeenCalledWith("org-1", "slack", "realtime");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const call = mockSendEmail.mock.calls[0][0];
    expect(call.to).toEqual(["admin-a@example.com"]);
    expect(call.subject).toMatch(/alert delivery failed/i);
  });

  it("does not email admins after a successful dispatch", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/ORG",
      emailRecipients: [],
      updatedAt: new Date(),
      updatedById: null,
    });
    await notifyBackfillCompletion(baseJob, null);
    expect(mockListOrgAdmins).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("emails admins after an email-transport failure (separate from the original recipient list)", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: null,
      emailRecipients: ["alerts@example.com"],
      updatedAt: new Date(),
      updatedById: null,
    });
    // First call is the original alert dispatch and fails; second call is
    // the fallback fan-out and must succeed.
    mockSendEmail.mockResolvedValueOnce(false);
    mockSendEmail.mockResolvedValueOnce(true);
    await notifyBackfillCompletion(baseJob, null);
    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", status: "failure" }),
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail.mock.calls[1][0].to).toEqual(["admin-a@example.com"]);
  });
});

describe("buildAlertFailureFallbackContent (Task #1051)", () => {
  it("includes the channel, error, recipient, and admin page URL", () => {
    const content = buildAlertFailureFallbackContent({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "Slack webhook returned 404",
    });
    expect(content.summary).toMatch(/Slack/);
    expect(content.summary).toMatch(/hooks\.slack\.com/);
    expect(content.text).toContain("Slack webhook returned 404");
    expect(content.text).toContain("/admin/transcript-backfill");
    expect(content.html).toContain("/admin/transcript-backfill");
    expect(content.html).toContain("Slack webhook returned 404");
  });

  it("renders sensible placeholders when the error message is missing", () => {
    const content = buildAlertFailureFallbackContent({
      orgId: "org-1",
      jobId: null,
      channel: "email",
      recipientSummary: "",
      errorMessage: null,
    });
    expect(content.text).toContain("(no error message recorded)");
    expect(content.text).toContain("(no recipients on file)");
    // No Job ID row when jobId is null.
    expect(content.text).not.toMatch(/^Job ID/m);
  });

  it("escapes HTML special characters in the error message", () => {
    const content = buildAlertFailureFallbackContent({
      orgId: "org-1",
      jobId: "job-xyz",
      channel: "slack",
      recipientSummary: "hooks.slack.com",
      errorMessage: "<script>alert('x')</script>",
    });
    expect(content.html).not.toContain("<script>alert");
    expect(content.html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
// Task #1072 — regression coverage for the env-var inline last-test panel.
// `getBackfillNotificationConfig` powers the admin transcript-backfill page's
// "Notification destinations" card; the new `usingEnvFallback` +
// `lastTestAt` / `lastTestResult` fields decide whether the inline panel is
// rendered. These tests pin the field values for the three scenarios the UI
// branches on: no per-org row, an empty per-org row written by the test
// endpoint in env-fallback mode, and a fully-populated per-org row.
// ---------------------------------------------------------------------------
describe("getBackfillNotificationConfig (Task #1063 / #1072)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    mockGetSettings.mockReset();
    process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK =
      "https://hooks.slack.com/services/T000/B000/abc";
    process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO = "ops@example.com";
  });

  afterEach(() => {
    process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK =
      ORIGINAL_ENV.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK;
    process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO =
      ORIGINAL_ENV.CRM_BACKFILL_NOTIFY_EMAIL_TO;
  });

  it("flags usingEnvFallback=true with null lastTest fields when no per-org row exists", async () => {
    mockGetSettings.mockResolvedValue(null);

    const cfg = await getBackfillNotificationConfig("org-1");

    expect(cfg.slack).toEqual({ configured: true, valid: true });
    expect(cfg.email).toEqual({
      configured: true,
      recipients: ["ops@example.com"],
    });
    expect(cfg.usingEnvFallback).toBe(true);
    expect(cfg.lastTestAt).toBeNull();
    expect(cfg.lastTestResult).toBeNull();
  });

  it("flags usingEnvFallback=true and surfaces persisted lastTest fields when the per-org row has empty destinations", async () => {
    const testedAt = new Date("2026-04-22T12:00:00.000Z");
    const lastTestResult = {
      slack: { configured: true, ok: true },
      email: {
        configured: true,
        ok: false,
        error: "550 Recipient mailbox unavailable",
        recipients: ["ops@example.com"],
      },
      operatorDisplay: "Site Admin <admin@test.invalid>",
    };
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "",
      emailRecipients: [],
      updatedById: null,
      updatedAt: testedAt,
      lastTestAt: testedAt,
      lastTestResult,
    });

    const cfg = await getBackfillNotificationConfig("org-1");

    // The per-org row exists, so the destination summary reflects its
    // (empty) destinations rather than the env-var values — but
    // `usingEnvFallback` still holds because nothing per-org is saved, so
    // the inline lastTest panel needs to render in the env-var card.
    expect(cfg.slack.configured).toBe(false);
    expect(cfg.email.configured).toBe(false);
    expect(cfg.email.recipients).toEqual([]);
    expect(cfg.usingEnvFallback).toBe(true);
    expect(cfg.lastTestAt).toBe(testedAt.toISOString());
    expect(cfg.lastTestResult).toEqual(lastTestResult);
  });

  it("flags usingEnvFallback=false when a per-org row has saved destinations, and still surfaces lastTest fields", async () => {
    const testedAt = new Date("2026-04-22T13:00:00.000Z");
    const lastTestResult = {
      slack: { configured: true, ok: true },
      email: { configured: true, ok: true, recipients: ["team@example.com"] },
      operatorDisplay: "Site Admin <admin@test.invalid>",
    };
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/T111/B111/xyz",
      emailRecipients: ["team@example.com"],
      updatedById: "user-1",
      updatedAt: testedAt,
      lastTestAt: testedAt,
      lastTestResult,
    });

    const cfg = await getBackfillNotificationConfig("org-1");

    // Per-org destinations win over the env vars now that the row has them.
    expect(cfg.slack).toEqual({ configured: true, valid: true });
    expect(cfg.email).toEqual({
      configured: true,
      recipients: ["team@example.com"],
    });
    expect(cfg.usingEnvFallback).toBe(false);
    expect(cfg.lastTestAt).toBe(testedAt.toISOString());
    expect(cfg.lastTestResult).toEqual(lastTestResult);
  });

  it("flags usingEnvFallback=true when the per-org row exists with empty destinations and no lastTest data", async () => {
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: null,
      emailRecipients: [],
      updatedById: null,
      updatedAt: new Date("2026-04-22T11:00:00.000Z"),
      lastTestAt: null,
      lastTestResult: null,
    });

    const cfg = await getBackfillNotificationConfig("org-1");

    expect(cfg.usingEnvFallback).toBe(true);
    expect(cfg.lastTestAt).toBeNull();
    expect(cfg.lastTestResult).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task #1098 — the resend cooldown used to live in an in-process Map. The
// reservation now lives in `crm_transcript_backfill_alert_resend_cooldowns`
// via the storage helpers `tryReserveBackfillAlertResendCooldown` /
// `releaseBackfillAlertResendCooldown`, so the window survives a restart
// and is shared across replicas. These tests exercise the dispatcher
// against the storage mocks to confirm a) it asks the persisted store
// before doing any work and surfaces COOLDOWN when the store rejects, and
// b) clearing any in-process state (the equivalent of a restart) does NOT
// open a window because the next call still consults the persisted store.
// ---------------------------------------------------------------------------
describe("resendBackfillAlertDelivery cooldown (Task #1098)", () => {
  beforeEach(() => {
    mockGetAlertDelivery.mockReset();
    mockGetBackfillJob.mockReset();
    mockListAlertDeliveries.mockReset();
    mockGetOperatorContact.mockReset();
    mockTryReserveResendCooldown.mockReset();
    mockReleaseResendCooldown.mockReset();
    mockGetSettings.mockReset();
    mockFetch.mockReset();
    mockSendEmail.mockReset();
    mockRecordDelivery.mockReset();

    mockGetAlertDelivery.mockResolvedValue({
      id: "del-1",
      orgId: "org-1",
      jobId: "job-1",
      channel: "slack",
      status: "failure",
      recipientSummary: "hooks.slack.com",
      errorMessage: "boom",
      attemptedAt: new Date("2026-04-22T12:00:00.000Z"),
      source: "automatic",
    });
    mockGetBackfillJob.mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      status: "FAILED",
      total: 1,
      processed: 1,
      succeeded: 0,
      failed: 1,
      startedAt: new Date("2026-04-22T11:55:00.000Z"),
      completedAt: new Date("2026-04-22T12:00:00.000Z"),
      parentJobId: null,
      startedById: null,
    });
    mockListAlertDeliveries.mockResolvedValue([
      {
        id: "del-2",
        orgId: "org-1",
        jobId: "job-1",
        channel: "slack",
        status: "success",
        recipientSummary: "hooks.slack.com",
        errorMessage: null,
        attemptedAt: new Date("2026-04-22T12:00:30.000Z"),
        source: "resend",
      },
      {
        id: "del-1",
        orgId: "org-1",
        jobId: "job-1",
        channel: "slack",
        status: "failure",
        recipientSummary: "hooks.slack.com",
        errorMessage: "boom",
        attemptedAt: new Date("2026-04-22T12:00:00.000Z"),
        source: "automatic",
      },
    ]);
    mockGetSettings.mockResolvedValue({
      organizationId: "org-1",
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/X",
      emailRecipients: [],
    });
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    mockSendEmail.mockResolvedValue(true);
    mockRecordDelivery.mockResolvedValue({});
    __resetResendCooldownsForTests();
  });

  it("asks the persisted store and dispatches when the slot is available", async () => {
    const reservedAt = new Date("2026-04-22T12:00:05.000Z");
    mockTryReserveResendCooldown.mockResolvedValueOnce({
      ok: true,
      reservedAt,
    });

    const result = await resendBackfillAlertDelivery(
      "org-1",
      "del-1",
      "admin-1",
      reservedAt.getTime(),
    );

    expect(result.ok).toBe(true);
    expect(mockTryReserveResendCooldown).toHaveBeenCalledTimes(1);
    const [keyArg, cooldownArg] = mockTryReserveResendCooldown.mock.calls[0];
    expect(keyArg).toEqual({ orgId: "org-1", jobId: "job-1", channel: "slack" });
    expect(cooldownArg).toBe(RESEND_COOLDOWN_MS);
    // Slack POST happened — the dispatch was not short-circuited.
    expect(mockFetch).toHaveBeenCalled();
    // Successful dispatch is NOT rolled back, so release must not run.
    expect(mockReleaseResendCooldown).not.toHaveBeenCalled();
  });

  it("returns COOLDOWN with retryAfterSeconds when the persisted store rejects", async () => {
    mockTryReserveResendCooldown.mockResolvedValueOnce({
      ok: false,
      retryAfterSeconds: 17,
    });

    const result = await resendBackfillAlertDelivery(
      "org-1",
      "del-1",
      "admin-1",
      new Date("2026-04-22T12:00:13.000Z").getTime(),
    );

    expect(result).toEqual({
      ok: false,
      reason: "COOLDOWN",
      retryAfterSeconds: 17,
    });
    // No dispatch, no follow-up DB lookups beyond the initial delivery
    // fetch — the cooldown short-circuits the path.
    expect(mockGetBackfillJob).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still rejects a second resend within 30s after the in-process state is reset (simulated restart)", async () => {
    // First click: persisted store accepts.
    const firstReservedAt = new Date("2026-04-22T12:00:00.000Z");
    mockTryReserveResendCooldown.mockResolvedValueOnce({
      ok: true,
      reservedAt: firstReservedAt,
    });
    const first = await resendBackfillAlertDelivery(
      "org-1",
      "del-1",
      "admin-1",
      firstReservedAt.getTime(),
    );
    expect(first.ok).toBe(true);

    // Simulate a process restart / fresh replica picking up the next click:
    // any in-process bookkeeping the dispatcher still has is wiped, but the
    // persisted store remembers the recent reservation and continues to
    // reject within the cooldown window.
    __resetResendCooldownsForTests();
    mockTryReserveResendCooldown.mockResolvedValueOnce({
      ok: false,
      retryAfterSeconds: 25,
    });
    mockFetch.mockClear();

    const secondClickAt = new Date("2026-04-22T12:00:05.000Z");
    const second = await resendBackfillAlertDelivery(
      "org-1",
      "del-1",
      "admin-1",
      secondClickAt.getTime(),
    );

    expect(second).toEqual({
      ok: false,
      reason: "COOLDOWN",
      retryAfterSeconds: 25,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rolls back the persisted reservation when the channel has no destination", async () => {
    const reservedAt = new Date("2026-04-22T12:00:05.000Z");
    mockTryReserveResendCooldown.mockResolvedValueOnce({
      ok: true,
      reservedAt,
    });
    // Settings have an empty webhook so the slack channel is unconfigured.
    mockGetSettings.mockResolvedValueOnce({
      organizationId: "org-1",
      slackWebhookUrl: "",
      emailRecipients: [],
    });

    const result = await resendBackfillAlertDelivery(
      "org-1",
      "del-1",
      "admin-1",
      reservedAt.getTime(),
    );

    expect(result).toEqual({
      ok: false,
      reason: "CHANNEL_NOT_CONFIGURED",
    });
    expect(mockReleaseResendCooldown).toHaveBeenCalledWith(
      { orgId: "org-1", jobId: "job-1", channel: "slack" },
      reservedAt,
    );
  });
});
