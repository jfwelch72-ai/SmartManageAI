/**
 * Task #1047 — backfill summary routing regression tests.
 *
 * Verifies that `notifyBackfillCompletionToOrgAdmins` routes per-admin
 * backfill summaries through the right channel (email / slack / teams /
 * none) and respects the per-admin "only notify on failure" filter for
 * both COMPLETED and FAILED job statuses.
 *
 * Also covers two regression paths from earlier tasks that still need
 * to hold:
 *   - Legacy notification_channel_prefs.email_enabled = false continues
 *     to suppress email even when the new channel preference is "email".
 *   - Slack/Teams admins without a configured webhook URL are silently
 *     skipped — they don't fall back to email and don't crash dispatch.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillJobs,
  notificationChannelPrefs,
} from "@shared/schema";
import {
  clearTestEmailOutbox,
  getTestEmailOutbox,
} from "../services/emailTransport";

vi.mock("../services/slackService", async () => {
  const actual = await vi.importActual<typeof import("../services/slackService")>(
    "../services/slackService",
  );
  return {
    ...actual,
    sendSlackMessage: vi.fn(async () => undefined),
  };
});

vi.mock("../services/teamsService", async () => {
  const actual = await vi.importActual<typeof import("../services/teamsService")>(
    "../services/teamsService",
  );
  return {
    ...actual,
    sendTeamsMessage: vi.fn(async () => undefined),
  };
});

vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(async () => ({ ok: true as const })),
  queueCallTranscription: vi.fn(),
}));

const TEST_PREFIX = "__crm_backfill_routing_test__";
const VALID_SLACK_URL = "https://hooks.slack.com/services/T000/B000/abcdef";
const VALID_TEAMS_URL = "https://example.webhook.office.com/webhookb2/abc";

let routes: typeof import("../crmCallsRoutes");
let slackService: typeof import("../services/slackService");
let teamsService: typeof import("../services/teamsService");
let priorEmailTransport: string | undefined;

async function cleanupTestData() {
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (
      SELECT ${users.id} FROM ${users}
      WHERE ${users.email} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db.delete(organizations).where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
}

async function makeOrg(label: string) {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}${label}`, slug })
    .returning();
  return org.id;
}

async function makeAdmin(
  orgId: string,
  suffix: string,
  opts: {
    channel?: "email" | "slack" | "teams" | "none";
    onFailureOnly?: boolean;
  } = {},
) {
  const [u] = await db
    .insert(users)
    .values({
      email: `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.invalid`,
      passwordHash: "x",
      firstName: "Test",
      lastName: suffix,
      organizationId: orgId,
      role: "ADMIN",
      crmBackfillSummaryChannel: opts.channel ?? "email",
      crmBackfillSummaryOnFailureOnly: opts.onFailureOnly ?? false,
    })
    .returning();
  return u;
}

async function setPrefs(
  userId: string,
  prefs: Partial<{
    emailEnabled: boolean;
    slackWebhookUrl: string | null;
    teamsWebhookUrl: string | null;
  }>,
) {
  await db.insert(notificationChannelPrefs).values({
    userId,
    emailEnabled: prefs.emailEnabled ?? true,
    slackWebhookUrl: prefs.slackWebhookUrl ?? null,
    teamsWebhookUrl: prefs.teamsWebhookUrl ?? null,
  });
}

async function insertJob(opts: {
  id: string;
  orgId: string;
  startedById: string;
  status: "COMPLETED" | "FAILED";
  total?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
}) {
  const startedAt = new Date(Date.now() - 60 * 1000);
  await db.insert(crmTranscriptBackfillJobs).values({
    id: opts.id,
    organizationId: opts.orgId,
    status: opts.status,
    total: opts.total ?? 5,
    processed: opts.processed ?? 5,
    succeeded: opts.succeeded ?? (opts.status === "COMPLETED" ? 5 : 0),
    failed: opts.failed ?? (opts.status === "FAILED" ? 5 : 0),
    errors: [],
    startedById: opts.startedById,
    startedAt,
    heartbeatAt: new Date(),
    completedAt: new Date(),
  });
}

let jobCounter = 0;
function uniqueJobId(label: string): string {
  jobCounter += 1;
  return `routing-${label}-${Date.now()}-${jobCounter}`;
}

beforeAll(async () => {
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";
  routes = await import("../crmCallsRoutes");
  slackService = await import("../services/slackService");
  teamsService = await import("../services/teamsService");
});

afterAll(async () => {
  await cleanupTestData();
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
});

beforeEach(async () => {
  await cleanupTestData();
  routes.__resetBackfillNotifiedForTests();
  clearTestEmailOutbox();
  vi.mocked(slackService.sendSlackMessage).mockClear();
  vi.mocked(teamsService.sendTeamsMessage).mockClear();
});

describe("notifyBackfillCompletionToOrgAdmins channel routing (Task #1047)", () => {
  describe("channel=email", () => {
    it("emails admin on COMPLETED runs", async () => {
      const orgId = await makeOrg("email-completed");
      const admin = await makeAdmin(orgId, "a", { channel: "email" });
      const jobId = uniqueJobId("email-completed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].to).toEqual([admin.email]);
      expect(vi.mocked(slackService.sendSlackMessage)).not.toHaveBeenCalled();
      expect(vi.mocked(teamsService.sendTeamsMessage)).not.toHaveBeenCalled();
    });

    it("emails admin on FAILED runs", async () => {
      const orgId = await makeOrg("email-failed");
      const admin = await makeAdmin(orgId, "a", { channel: "email" });
      const jobId = uniqueJobId("email-failed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "FAILED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].to).toEqual([admin.email]);
      expect(outbox[0].subject?.toLowerCase()).toContain("failed");
    });

    it("legacy emailEnabled=false suppresses email even when channel=email", async () => {
      const orgId = await makeOrg("email-legacy-optout");
      const admin = await makeAdmin(orgId, "a", { channel: "email" });
      await setPrefs(admin.id, { emailEnabled: false });
      const jobId = uniqueJobId("email-legacy");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(slackService.sendSlackMessage)).not.toHaveBeenCalled();
      expect(vi.mocked(teamsService.sendTeamsMessage)).not.toHaveBeenCalled();
    });
  });

  describe("channel=slack", () => {
    it("posts to slack on COMPLETED runs and does not email", async () => {
      const orgId = await makeOrg("slack-completed");
      const admin = await makeAdmin(orgId, "a", { channel: "slack" });
      await setPrefs(admin.id, { slackWebhookUrl: VALID_SLACK_URL });
      const jobId = uniqueJobId("slack-completed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(slackService.sendSlackMessage)).toHaveBeenCalledTimes(1);
      const [url, title] = vi.mocked(slackService.sendSlackMessage).mock.calls[0];
      expect(url).toBe(VALID_SLACK_URL);
      expect(String(title).toLowerCase()).toContain("completed");
    });

    it("posts to slack on FAILED runs", async () => {
      const orgId = await makeOrg("slack-failed");
      const admin = await makeAdmin(orgId, "a", { channel: "slack" });
      await setPrefs(admin.id, { slackWebhookUrl: VALID_SLACK_URL });
      const jobId = uniqueJobId("slack-failed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "FAILED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(vi.mocked(slackService.sendSlackMessage)).toHaveBeenCalledTimes(1);
      const [, title] = vi.mocked(slackService.sendSlackMessage).mock.calls[0];
      expect(String(title).toLowerCase()).toContain("failed");
    });

    it("silently skips slack admins with no configured webhook URL", async () => {
      const orgId = await makeOrg("slack-no-webhook");
      const admin = await makeAdmin(orgId, "a", { channel: "slack" });
      // No prefs row at all, and no webhook column even if there were one.
      const jobId = uniqueJobId("slack-no-webhook");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(slackService.sendSlackMessage)).not.toHaveBeenCalled();
    });

    it("silently skips slack admins whose webhook URL is invalid", async () => {
      const orgId = await makeOrg("slack-bad-webhook");
      const admin = await makeAdmin(orgId, "a", { channel: "slack" });
      await setPrefs(admin.id, { slackWebhookUrl: "https://evil.example.com/hook" });
      const jobId = uniqueJobId("slack-bad-webhook");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(slackService.sendSlackMessage)).not.toHaveBeenCalled();
    });
  });

  describe("channel=teams", () => {
    it("posts to teams on COMPLETED runs and does not email", async () => {
      const orgId = await makeOrg("teams-completed");
      const admin = await makeAdmin(orgId, "a", { channel: "teams" });
      await setPrefs(admin.id, { teamsWebhookUrl: VALID_TEAMS_URL });
      const jobId = uniqueJobId("teams-completed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(teamsService.sendTeamsMessage)).toHaveBeenCalledTimes(1);
      const [url, title] = vi.mocked(teamsService.sendTeamsMessage).mock.calls[0];
      expect(url).toBe(VALID_TEAMS_URL);
      expect(String(title).toLowerCase()).toContain("completed");
    });

    it("posts to teams on FAILED runs", async () => {
      const orgId = await makeOrg("teams-failed");
      const admin = await makeAdmin(orgId, "a", { channel: "teams" });
      await setPrefs(admin.id, { teamsWebhookUrl: VALID_TEAMS_URL });
      const jobId = uniqueJobId("teams-failed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "FAILED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(vi.mocked(teamsService.sendTeamsMessage)).toHaveBeenCalledTimes(1);
      const [, title] = vi.mocked(teamsService.sendTeamsMessage).mock.calls[0];
      expect(String(title).toLowerCase()).toContain("failed");
    });

    it("silently skips teams admins with no configured webhook URL", async () => {
      const orgId = await makeOrg("teams-no-webhook");
      const admin = await makeAdmin(orgId, "a", { channel: "teams" });
      const jobId = uniqueJobId("teams-no-webhook");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(teamsService.sendTeamsMessage)).not.toHaveBeenCalled();
    });

    it("silently skips teams admins whose webhook URL is invalid", async () => {
      const orgId = await makeOrg("teams-bad-webhook");
      const admin = await makeAdmin(orgId, "a", { channel: "teams" });
      await setPrefs(admin.id, { teamsWebhookUrl: "https://malicious.example.com/hook" });
      const jobId = uniqueJobId("teams-bad-webhook");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(teamsService.sendTeamsMessage)).not.toHaveBeenCalled();
    });
  });

  describe("channel=none", () => {
    it("does not dispatch on any channel for COMPLETED runs", async () => {
      const orgId = await makeOrg("none-completed");
      const admin = await makeAdmin(orgId, "a", { channel: "none" });
      // Even with a real Slack webhook configured, channel="none" wins.
      await setPrefs(admin.id, {
        slackWebhookUrl: VALID_SLACK_URL,
        teamsWebhookUrl: VALID_TEAMS_URL,
      });
      const jobId = uniqueJobId("none-completed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(slackService.sendSlackMessage)).not.toHaveBeenCalled();
      expect(vi.mocked(teamsService.sendTeamsMessage)).not.toHaveBeenCalled();
    });

    it("does not dispatch on any channel for FAILED runs either", async () => {
      const orgId = await makeOrg("none-failed");
      const admin = await makeAdmin(orgId, "a", { channel: "none" });
      const jobId = uniqueJobId("none-failed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "FAILED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
      expect(vi.mocked(slackService.sendSlackMessage)).not.toHaveBeenCalled();
      expect(vi.mocked(teamsService.sendTeamsMessage)).not.toHaveBeenCalled();
    });
  });

  describe("onFailureOnly filter", () => {
    it("suppresses summary on COMPLETED runs when onFailureOnly=true", async () => {
      const orgId = await makeOrg("failonly-completed");
      const admin = await makeAdmin(orgId, "a", {
        channel: "email",
        onFailureOnly: true,
      });
      const jobId = uniqueJobId("failonly-completed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      expect(getTestEmailOutbox()).toHaveLength(0);
    });

    it("still delivers summary on FAILED runs when onFailureOnly=true", async () => {
      const orgId = await makeOrg("failonly-failed");
      const admin = await makeAdmin(orgId, "a", {
        channel: "email",
        onFailureOnly: true,
      });
      const jobId = uniqueJobId("failonly-failed");
      await insertJob({ id: jobId, orgId, startedById: admin.id, status: "FAILED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].to).toEqual([admin.email]);
    });

    it("applies the failure filter independently per admin", async () => {
      const orgId = await makeOrg("failonly-mixed");
      const always = await makeAdmin(orgId, "always", {
        channel: "email",
        onFailureOnly: false,
      });
      const failuresOnly = await makeAdmin(orgId, "failonly", {
        channel: "email",
        onFailureOnly: true,
      });
      const jobId = uniqueJobId("failonly-mixed");
      await insertJob({ id: jobId, orgId, startedById: always.id, status: "COMPLETED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].to).toEqual([always.email]);
      expect(outbox[0].to).not.toContain(failuresOnly.email);
    });
  });

  describe("mixed channels in one org", () => {
    it("fans the same FAILED run out to email, slack, and teams while skipping channel=none", async () => {
      const orgId = await makeOrg("mixed-failed");
      const emailAdmin = await makeAdmin(orgId, "email", { channel: "email" });
      const slackAdmin = await makeAdmin(orgId, "slack", { channel: "slack" });
      await setPrefs(slackAdmin.id, { slackWebhookUrl: VALID_SLACK_URL });
      const teamsAdmin = await makeAdmin(orgId, "teams", { channel: "teams" });
      await setPrefs(teamsAdmin.id, { teamsWebhookUrl: VALID_TEAMS_URL });
      const silenced = await makeAdmin(orgId, "none", { channel: "none" });

      const jobId = uniqueJobId("mixed-failed");
      await insertJob({ id: jobId, orgId, startedById: emailAdmin.id, status: "FAILED" });

      await routes.notifyBackfillCompletionToOrgAdmins(jobId);

      const outbox = getTestEmailOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].to).toEqual([emailAdmin.email]);
      expect(outbox[0].to).not.toContain(silenced.email);

      expect(vi.mocked(slackService.sendSlackMessage)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(slackService.sendSlackMessage).mock.calls[0][0]).toBe(VALID_SLACK_URL);

      expect(vi.mocked(teamsService.sendTeamsMessage)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(teamsService.sendTeamsMessage).mock.calls[0][0]).toBe(VALID_TEAMS_URL);
    });
  });
});
