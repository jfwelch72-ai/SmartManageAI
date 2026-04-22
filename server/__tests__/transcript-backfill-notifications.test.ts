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
const { mockGetSettings, mockRecordDelivery, mockFetch, mockSendEmail } = vi.hoisted(
  () => ({
    mockGetSettings: vi.fn(),
    mockRecordDelivery: vi.fn().mockResolvedValue({}),
    // Task #1031 — the dispatcher now POSTs to the Slack webhook directly so
    // it can record real per-channel success/failure outcomes. Stub global
    // fetch so the unit tests can observe the calls without hitting the net.
    mockFetch: vi.fn().mockResolvedValue(
      new Response("ok", { status: 200 }),
    ),
    mockSendEmail: vi.fn().mockResolvedValue(true),
  }),
);
vi.mock("../storage", () => ({
  getCrmTranscriptBackfillNotificationSettings: mockGetSettings,
  recordCrmTranscriptBackfillAlertDelivery: mockRecordDelivery,
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
  resolveBackfillNotificationDestinations,
  sendTestBackfillAlert,
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
