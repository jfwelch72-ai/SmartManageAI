/**
 * Task #1065 — daily digest of CRM transcript-backfill alert delivery
 * failures. Covers the pure content builder and the per-org dispatcher
 * loop (admin lookup / dedupe-style skipping / best-effort isolation).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAggregateFailures,
  mockListOrgAdmins,
  mockSendEmail,
  mockGetSettings,
  mockRecordDelivery,
  mockPruneAlertFallbackSentBefore,
  mockPruneBackfillAlertResendCooldownsBefore,
  mockFindQuietOrgs,
  mockGetOrgInfo,
} = vi.hoisted(() => ({
  mockAggregateFailures: vi.fn(),
  mockListOrgAdmins: vi.fn(),
  mockSendEmail: vi.fn().mockResolvedValue(true),
  mockGetSettings: vi.fn(),
  mockRecordDelivery: vi.fn().mockResolvedValue({}),
  mockPruneAlertFallbackSentBefore: vi.fn().mockResolvedValue(undefined),
  mockPruneBackfillAlertResendCooldownsBefore: vi
    .fn()
    .mockResolvedValue(undefined),
  // Task #1569 — quiet-orgs lookup + display-info batch lookup used by
  // `runAlertFailureDigest` to render the new "Quiet orgs in the last 24h"
  // section. Defaults to "no quiet orgs" so existing tests (which only
  // exercise the failure path) keep their original behavior.
  mockFindQuietOrgs: vi.fn().mockResolvedValue([]),
  mockGetOrgInfo: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../storage", () => ({
  aggregateRecentCrmTranscriptBackfillAlertFailures: mockAggregateFailures,
  findQuietCrmTranscriptBackfillOrgsSince: mockFindQuietOrgs,
  getOrganizationDisplayInfoByIds: mockGetOrgInfo,
  listOrgAdminsForAlertFailureFallback: mockListOrgAdmins,
  getCrmTranscriptBackfillNotificationSettings: mockGetSettings,
  recordCrmTranscriptBackfillAlertDelivery: mockRecordDelivery,
  pruneAlertFallbackSentBefore: mockPruneAlertFallbackSentBefore,
  pruneBackfillAlertResendCooldownsBefore:
    mockPruneBackfillAlertResendCooldownsBefore,
}));
vi.mock("../services/slackService", () => ({
  isValidSlackWebhookUrl: () => true,
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
  buildAlertFailureDigestContent,
  runAlertFailureDigest,
} from "../services/transcriptBackfillNotifications";

const baseEntry = {
  organizationId: "org-1",
  total: 3,
  slackCount: 2,
  emailCount: 1,
  recentFailures: [
    {
      jobId: "job-a",
      channel: "slack" as const,
      recipientSummary: "hooks.slack.com",
      errorMessage: "404 not_found",
      attemptedAt: new Date("2026-04-22T08:30:00.000Z"),
    },
    {
      jobId: "job-b",
      channel: "email" as const,
      recipientSummary: "ops@example.com",
      errorMessage: "smtp 550",
      attemptedAt: new Date("2026-04-22T03:15:00.000Z"),
    },
    {
      jobId: null,
      channel: "slack" as const,
      recipientSummary: "hooks.slack.com",
      errorMessage: null,
      attemptedAt: new Date("2026-04-21T22:05:00.000Z"),
    },
  ],
};

describe("buildAlertFailureDigestContent (Task #1065)", () => {
  it("renders a one-line summary with channel breakdown", () => {
    const content = buildAlertFailureDigestContent({
      entry: baseEntry,
      windowHours: 24,
    });
    expect(content.summary).toBe(
      "3 alert deliveries failed in the last 24h — 2 Slack, 1 email.",
    );
    expect(content.subject).toContain("3 alert deliveries failed");
  });

  it("uses singular wording when there is exactly one failure", () => {
    const content = buildAlertFailureDigestContent({
      entry: {
        organizationId: "org-1",
        total: 1,
        slackCount: 0,
        emailCount: 1,
        recentFailures: [],
      },
      windowHours: 24,
    });
    expect(content.summary).toBe(
      "1 alert delivery failed in the last 24h — 1 email.",
    );
  });

  it("includes the recent failure rows and a link back to the admin page", () => {
    const content = buildAlertFailureDigestContent({
      entry: baseEntry,
      windowHours: 24,
    });
    expect(content.text).toContain("hooks.slack.com");
    expect(content.text).toContain("404 not_found");
    expect(content.text).toContain("ops@example.com");
    expect(content.text).toContain("/admin/transcript-backfill");
    expect(content.html).toContain("/admin/transcript-backfill");
    expect(content.html).toContain("hooks.slack.com");
    expect(content.html).toContain("smtp 550");
  });

  it("escapes HTML in error messages and recipients", () => {
    const content = buildAlertFailureDigestContent({
      entry: {
        organizationId: "org-1",
        total: 1,
        slackCount: 1,
        emailCount: 0,
        recentFailures: [
          {
            jobId: "j",
            channel: "slack",
            recipientSummary: "<evil>",
            errorMessage: "boom <script>",
            attemptedAt: new Date("2026-04-22T00:00:00.000Z"),
          },
        ],
      },
      windowHours: 24,
    });
    expect(content.html).not.toContain("<evil>");
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;evil&gt;");
    expect(content.html).toContain("&lt;script&gt;");
  });

  it("uses APP_BASE_URL for the history link when set", () => {
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://app.example.com/";
    try {
      const content = buildAlertFailureDigestContent({
        entry: baseEntry,
        windowHours: 24,
      });
      expect(content.historyUrl).toBe(
        "https://app.example.com/admin/transcript-backfill",
      );
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prev;
    }
  });
});

describe("runAlertFailureDigest (Task #1065)", () => {
  const adminA = {
    id: "u-a",
    email: "a@example.com",
    firstName: "Ada",
    lastName: null,
  };
  const adminB = {
    id: "u-b",
    email: "b@example.com",
    firstName: null,
    lastName: null,
  };

  beforeEach(() => {
    mockAggregateFailures.mockReset();
    mockListOrgAdmins.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(true);
    mockPruneAlertFallbackSentBefore.mockReset();
    mockPruneAlertFallbackSentBefore.mockResolvedValue(undefined);
    mockPruneBackfillAlertResendCooldownsBefore.mockReset();
    mockPruneBackfillAlertResendCooldownsBefore.mockResolvedValue(undefined);
    // Task #1569 — default the new lookups to "nothing quiet" so existing
    // tests keep behaving as before. Tests that exercise the new path
    // override these.
    mockFindQuietOrgs.mockReset();
    mockFindQuietOrgs.mockResolvedValue([]);
    mockGetOrgInfo.mockReset();
    mockGetOrgInfo.mockResolvedValue(new Map());
  });

  it("is a no-op when no orgs had failures in the window", async () => {
    mockAggregateFailures.mockResolvedValue([]);
    const fixedNow = new Date("2026-04-22T12:00:00.000Z");
    const summary = await runAlertFailureDigest({ now: fixedNow });
    expect(summary).toEqual({
      windowHours: 24,
      orgsWithFailures: 0,
      orgsNotified: 0,
      emailsSent: 0,
      totalFailures: 0,
      quietOrgs: 0,
      prunedBefore: new Date("2026-04-15T12:00:00.000Z"),
      resendCooldownPrunedBefore: new Date("2026-04-21T12:00:00.000Z"),
    });
    expect(mockListOrgAdmins).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("emails one digest per org to all eligible admins", async () => {
    mockAggregateFailures.mockResolvedValue([
      baseEntry,
      { ...baseEntry, organizationId: "org-2", total: 1, slackCount: 1, emailCount: 0 },
    ]);
    mockListOrgAdmins.mockImplementation(async (orgId: string) =>
      orgId === "org-1" ? [adminA, adminB] : [adminA],
    );
    const summary = await runAlertFailureDigest();
    expect(summary.orgsWithFailures).toBe(2);
    expect(summary.orgsNotified).toBe(2);
    expect(summary.emailsSent).toBe(3);
    expect(summary.totalFailures).toBe(4);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const firstCall = mockSendEmail.mock.calls[0][0];
    expect(firstCall.to).toEqual(["a@example.com", "b@example.com"]);
    expect(firstCall.subject).toContain("3 alert deliveries failed");
    // Task #1076 — the digest run asks for admins opted into the "digest"
    // stream so realtime-only / none recipients are excluded.
    expect(mockListOrgAdmins).toHaveBeenCalledWith("org-1", undefined, "digest");
    expect(mockListOrgAdmins).toHaveBeenCalledWith("org-2", undefined, "digest");
  });

  it("skips orgs with no eligible admins without throwing", async () => {
    mockAggregateFailures.mockResolvedValue([baseEntry]);
    mockListOrgAdmins.mockResolvedValue([]);
    const summary = await runAlertFailureDigest();
    expect(summary.orgsWithFailures).toBe(1);
    expect(summary.orgsNotified).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("counts a non-success email transport as not-notified", async () => {
    mockAggregateFailures.mockResolvedValue([baseEntry]);
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockSendEmail.mockResolvedValue(false);
    const summary = await runAlertFailureDigest();
    expect(summary.orgsNotified).toBe(0);
    expect(summary.emailsSent).toBe(0);
  });

  it("isolates per-org failures so one bad org doesn't block the rest", async () => {
    mockAggregateFailures.mockResolvedValue([
      baseEntry,
      { ...baseEntry, organizationId: "org-2" },
    ]);
    mockListOrgAdmins.mockImplementation(async (orgId: string) => {
      if (orgId === "org-1") throw new Error("db down");
      return [adminA];
    });
    const summary = await runAlertFailureDigest();
    expect(summary.orgsNotified).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toEqual(["a@example.com"]);
  });

  it("respects an explicit windowHours override", async () => {
    mockAggregateFailures.mockResolvedValue([]);
    const fixedNow = new Date("2026-04-22T12:00:00.000Z");
    await runAlertFailureDigest({ now: fixedNow, windowHours: 48 });
    const sinceArg = (mockAggregateFailures.mock.calls[0] as unknown[])[0] as Date;
    expect(sinceArg.toISOString()).toBe("2026-04-20T12:00:00.000Z");
  });

  // Task #1082 — the persisted dedupe ledger (`alert_fallback_sent`) must be
  // pruned by the daily digest run so it can't grow without bound.
  it("prunes the persisted dedupe ledger to a 7-day cutoff after the digest run", async () => {
    mockAggregateFailures.mockResolvedValue([baseEntry]);
    mockListOrgAdmins.mockResolvedValue([adminA]);
    const fixedNow = new Date("2026-04-22T12:00:00.000Z");
    const summary = await runAlertFailureDigest({ now: fixedNow });
    expect(mockPruneAlertFallbackSentBefore).toHaveBeenCalledTimes(1);
    const cutoff = (mockPruneAlertFallbackSentBefore.mock.calls[0] as unknown[])[0] as Date;
    // Cutoff is exactly 7 days before `now`, which is comfortably larger
    // than the 1-hour FAILURE_FALLBACK_DEDUPE_MS window so housekeeping
    // can't accidentally re-enable a deduped alert.
    expect(cutoff.toISOString()).toBe("2026-04-15T12:00:00.000Z");
    const ageMs = fixedNow.getTime() - cutoff.getTime();
    expect(ageMs).toBeGreaterThan(60 * 60 * 1000);
    expect(summary.prunedBefore?.toISOString()).toBe(
      "2026-04-15T12:00:00.000Z",
    );
  });

  it("still returns a successful summary when the prune step throws", async () => {
    mockAggregateFailures.mockResolvedValue([baseEntry]);
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockPruneAlertFallbackSentBefore.mockRejectedValue(new Error("db down"));
    const summary = await runAlertFailureDigest();
    expect(summary.orgsNotified).toBe(1);
    expect(summary.prunedBefore).toBeNull();
    expect(mockPruneAlertFallbackSentBefore).toHaveBeenCalledTimes(1);
  });

  // Task #1137 — same housekeeping for the persisted resend cooldown
  // ledger added in Task #1098. Without a periodic prune the table grows
  // one row per resent alert delivery forever.
  it("prunes the resend cooldown ledger to a 1-day cutoff after the digest run", async () => {
    mockAggregateFailures.mockResolvedValue([baseEntry]);
    mockListOrgAdmins.mockResolvedValue([adminA]);
    const fixedNow = new Date("2026-04-22T12:00:00.000Z");
    const summary = await runAlertFailureDigest({ now: fixedNow });
    expect(mockPruneBackfillAlertResendCooldownsBefore).toHaveBeenCalledTimes(1);
    const cutoff = mockPruneBackfillAlertResendCooldownsBefore.mock
      .calls[0][0] as Date;
    // Cutoff is exactly 1 day before `now`, comfortably larger than the
    // 30-second RESEND_COOLDOWN_MS so housekeeping cannot accidentally
    // release an active reservation.
    expect(cutoff.toISOString()).toBe("2026-04-21T12:00:00.000Z");
    const ageMs = fixedNow.getTime() - cutoff.getTime();
    expect(ageMs).toBeGreaterThan(30_000);
    expect(summary.resendCooldownPrunedBefore?.toISOString()).toBe(
      "2026-04-21T12:00:00.000Z",
    );
  });

  it("still returns a successful summary when the resend-cooldown prune throws", async () => {
    mockAggregateFailures.mockResolvedValue([baseEntry]);
    mockListOrgAdmins.mockResolvedValue([adminA]);
    mockPruneBackfillAlertResendCooldownsBefore.mockRejectedValue(
      new Error("db down"),
    );
    const summary = await runAlertFailureDigest();
    expect(summary.orgsNotified).toBe(1);
    expect(summary.resendCooldownPrunedBefore).toBeNull();
    // The fallback-sent prune is independent and still runs successfully.
    expect(summary.prunedBefore).not.toBeNull();
    expect(mockPruneBackfillAlertResendCooldownsBefore).toHaveBeenCalledTimes(1);
  });

  // Task #1569 — quiet orgs (had backfill activity in the window but ZERO
  // alert deliveries) should now also receive a digest so platform support
  // catches silent pipelines from their inbox.
  describe("quiet orgs (Task #1569)", () => {
    const quietEntry = {
      organizationId: "org-quiet",
      jobsInWindow: 5,
      lastJobAt: new Date("2026-04-22T11:30:00.000Z"),
    };

    it("dispatches a digest to quiet-only orgs even when they have no failures", async () => {
      mockAggregateFailures.mockResolvedValue([]);
      mockFindQuietOrgs.mockResolvedValue([quietEntry]);
      mockGetOrgInfo.mockResolvedValue(
        new Map([
          ["org-quiet", { name: "Acme Construction", slug: "acme" }],
        ]),
      );
      mockListOrgAdmins.mockResolvedValue([adminA]);

      const summary = await runAlertFailureDigest();

      expect(summary.orgsNotified).toBe(1);
      expect(summary.quietOrgs).toBe(1);
      expect(summary.totalFailures).toBe(0);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      const sent = mockSendEmail.mock.calls[0][0];
      expect(sent.to).toEqual(["a@example.com"]);
      // Subject leans on the quiet-pipeline phrasing rather than "0 failures"
      // so admins immediately recognize the signal in their inbox.
      expect(sent.subject).toContain("silent");
      expect(sent.subject).not.toContain("0 alert deliveries failed");
      // Both bodies surface the org name + jobs-in-window + last activity.
      expect(sent.text).toContain("Quiet orgs in the last 24h");
      expect(sent.text).toContain("Acme Construction");
      expect(sent.text).toContain("5 jobs");
      expect(sent.text).toContain("2026-04-22T11:30:00.000Z");
      expect(sent.html).toContain("Quiet orgs in the last 24h");
      expect(sent.html).toContain("Acme Construction");
    });

    it("skips quiet orgs that are already in the failure rollup to avoid double-emailing", async () => {
      mockAggregateFailures.mockResolvedValue([baseEntry]);
      // Pretend the same org appears in both lists (defensive — quiet orgs
      // by definition have no deliveries, so this is theoretical).
      mockFindQuietOrgs.mockResolvedValue([
        { ...quietEntry, organizationId: "org-1" },
      ]);
      mockListOrgAdmins.mockResolvedValue([adminA]);

      const summary = await runAlertFailureDigest();

      // The failure dispatch fires once and includes the quiet section
      // attached to that org's own digest. The quiet-only loop must NOT
      // also dispatch a second email for the same org.
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(summary.orgsNotified).toBe(1);
      expect(summary.quietOrgs).toBe(0);
      const sent = mockSendEmail.mock.calls[0][0];
      // The failure subject still wins for orgs with failures, but the
      // body now includes the quiet-orgs section.
      expect(sent.subject).toContain("3 alert deliveries failed");
      expect(sent.text).toContain("Quiet orgs in the last 24h");
    });

    it("dispatches a separate digest per quiet org when multiple are silent", async () => {
      mockAggregateFailures.mockResolvedValue([]);
      mockFindQuietOrgs.mockResolvedValue([
        quietEntry,
        {
          organizationId: "org-quiet-2",
          jobsInWindow: 1,
          lastJobAt: new Date("2026-04-22T08:00:00.000Z"),
        },
      ]);
      mockGetOrgInfo.mockResolvedValue(
        new Map([
          ["org-quiet", { name: "Acme", slug: "acme" }],
          ["org-quiet-2", { name: "Beta Builders", slug: "beta" }],
        ]),
      );
      mockListOrgAdmins.mockResolvedValue([adminA]);

      const summary = await runAlertFailureDigest();

      expect(summary.quietOrgs).toBe(2);
      expect(summary.orgsNotified).toBe(2);
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
      expect(mockListOrgAdmins).toHaveBeenCalledWith(
        "org-quiet",
        undefined,
        "digest",
      );
      expect(mockListOrgAdmins).toHaveBeenCalledWith(
        "org-quiet-2",
        undefined,
        "digest",
      );
    });

    it("falls back to the org id when the display lookup yields nothing", async () => {
      mockAggregateFailures.mockResolvedValue([]);
      mockFindQuietOrgs.mockResolvedValue([quietEntry]);
      // No display info available for the org.
      mockGetOrgInfo.mockResolvedValue(new Map());
      mockListOrgAdmins.mockResolvedValue([adminA]);

      await runAlertFailureDigest();
      const sent = mockSendEmail.mock.calls[0][0];
      expect(sent.text).toContain("org-quiet");
    });

    it("still runs the failure dispatch when the quiet-orgs lookup throws", async () => {
      mockAggregateFailures.mockResolvedValue([baseEntry]);
      mockFindQuietOrgs.mockRejectedValue(new Error("db down"));
      mockListOrgAdmins.mockResolvedValue([adminA]);

      const summary = await runAlertFailureDigest();

      expect(summary.orgsNotified).toBe(1);
      expect(summary.quietOrgs).toBe(0);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      // The dispatched failure email has no quiet section since the lookup
      // failed (degrades gracefully rather than blocking the run).
      const sent = mockSendEmail.mock.calls[0][0];
      expect(sent.text).not.toContain("Quiet orgs in the last 24h");
    });

    it("skips quiet orgs with no eligible admins", async () => {
      mockAggregateFailures.mockResolvedValue([]);
      mockFindQuietOrgs.mockResolvedValue([quietEntry]);
      mockListOrgAdmins.mockResolvedValue([]);

      const summary = await runAlertFailureDigest();
      expect(summary.quietOrgs).toBe(0);
      expect(summary.orgsNotified).toBe(0);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("isolates a thrown quiet-org dispatch from the others", async () => {
      mockAggregateFailures.mockResolvedValue([]);
      mockFindQuietOrgs.mockResolvedValue([
        quietEntry,
        {
          organizationId: "org-quiet-2",
          jobsInWindow: 2,
          lastJobAt: new Date("2026-04-22T09:00:00.000Z"),
        },
      ]);
      mockListOrgAdmins.mockImplementation(async (orgId: string) => {
        if (orgId === "org-quiet") throw new Error("db down");
        return [adminA];
      });

      const summary = await runAlertFailureDigest();
      expect(summary.quietOrgs).toBe(1);
      expect(summary.orgsNotified).toBe(1);
    });
  });
});

describe("buildAlertFailureDigestContent quiet section (Task #1569)", () => {
  const baseEmptyEntry = {
    organizationId: "org-q",
    total: 0,
    slackCount: 0,
    emailCount: 0,
    recentFailures: [],
  };

  it("renders a 'silent' subject and quiet-orgs body when only quiet orgs are present", () => {
    const content = buildAlertFailureDigestContent({
      entry: baseEmptyEntry,
      windowHours: 24,
      quietOrgs: [
        {
          organizationId: "org-q",
          organizationName: "Acme",
          organizationSlug: "acme",
          jobsInWindow: 4,
          lastJobAt: new Date("2026-04-22T10:00:00.000Z"),
        },
      ],
    });
    expect(content.subject).toBe(
      "[CRM] Daily transcript backfill alert digest — 1 quiet org silent",
    );
    expect(content.summary).toContain(
      "1 quiet org ran backfill but reported no alert deliveries",
    );
    expect(content.text).toContain("Quiet orgs in the last 24h");
    expect(content.text).toContain("Acme — 4 jobs in window");
    expect(content.html).toContain("Quiet orgs in the last 24h");
    expect(content.html).toContain("Acme");
  });

  it("omits the quiet section entirely when the list is empty", () => {
    const content = buildAlertFailureDigestContent({
      entry: baseEntry,
      windowHours: 24,
      quietOrgs: [],
    });
    expect(content.text).not.toContain("Quiet orgs in the last 24h");
    expect(content.html).not.toContain("Quiet orgs in the last 24h");
    // Failure subject is unchanged so existing real-time-failure-only
    // deliveries keep their original phrasing.
    expect(content.subject).toContain("3 alert deliveries failed");
  });

  it("escapes HTML in the org name", () => {
    const content = buildAlertFailureDigestContent({
      entry: baseEmptyEntry,
      windowHours: 24,
      quietOrgs: [
        {
          organizationId: "org-q",
          organizationName: "<script>",
          organizationSlug: null,
          jobsInWindow: 1,
          lastJobAt: new Date("2026-04-22T10:00:00.000Z"),
        },
      ],
    });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });
});
