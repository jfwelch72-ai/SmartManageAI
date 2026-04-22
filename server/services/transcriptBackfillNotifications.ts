/**
 * Task #1008 — format and dispatch run-completed / run-failed notifications
 * for the CRM transcript backfill admin tool.
 *
 * The transcript backfill history page (Task #1001) lets admins filter runs
 * by operator, but until now the run-completed Slack/email alerts didn't
 * surface the operator's name. Including the display name + email in the
 * alert makes it obvious who to ping when a run fails — without having to
 * open the admin page to look it up.
 *
 * The dispatcher is intentionally a no-op when no destination env vars are
 * configured, so existing deployments keep their current (silent) behavior
 * until ops opts in. The pure formatter is exported separately so it's easy
 * to unit test without touching the network.
 */

import { isValidSlackWebhookUrl } from "./slackService";
import { sendEmail } from "./emailService";
import { logInfo, logWarn } from "../utils/logger";
import {
  aggregateRecentCrmTranscriptBackfillAlertFailures,
  getCrmTranscriptBackfillAlertDelivery,
  getCrmTranscriptBackfillJob,
  getCrmTranscriptBackfillNotificationSettings,
  getCrmTranscriptBackfillOperatorContact,
  listCrmTranscriptBackfillAlertDeliveries,
  listOrgAdminsForAlertFailureFallback,
  recordCrmTranscriptBackfillAlertDelivery,
  type CrmTranscriptBackfillAlertDelivery,
  type CrmTranscriptBackfillAlertFailureDigestEntry,
  type CrmTranscriptBackfillOperatorContact,
  type OrgAdminFailureFallbackRecipient,
} from "../storage";

export type BackfillNotificationJob = {
  id: string;
  orgId: string;
  // Task #1057 — CANCELLED is a distinct terminal state so admins can
  // tell a deliberately-stopped run apart from a crash.
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  completedAt: string | null;
  parentJobId: string | null;
};

export type FormattedBackfillNotification = {
  title: string;
  /** Slack-friendly mrkdwn body. */
  slackBody: string;
  /** Plain-text email body. */
  emailText: string;
  /** Lightly-styled HTML email body. */
  emailHtml: string;
  /** Email subject line. */
  emailSubject: string;
  /** Resolved operator display string ("Jane Doe", "jane@x.co", etc.). */
  operatorDisplay: string;
  /** Resolved operator email or "(no email on file)". */
  operatorEmail: string;
};

const DELETED_OPERATOR_DISPLAY = "Unknown operator (deleted user)";
const NO_EMAIL_DISPLAY = "(no email on file)";

/**
 * Builds a human-friendly display name for the operator with graceful
 * fallbacks when fields are missing or the user record was deleted.
 */
export function describeBackfillOperator(
  operator: CrmTranscriptBackfillOperatorContact | null,
): { display: string; email: string } {
  if (!operator) {
    return { display: DELETED_OPERATOR_DISPLAY, email: NO_EMAIL_DISPLAY };
  }
  const first = (operator.firstName ?? "").trim();
  const last = (operator.lastName ?? "").trim();
  const email = (operator.email ?? "").trim();
  let display: string;
  if (first && last) display = `${first} ${last}`;
  else if (first) display = first;
  else if (last) display = last;
  else if (email) display = email;
  else display = DELETED_OPERATOR_DISPLAY;
  return { display, email: email || NO_EMAIL_DISPLAY };
}

/**
 * Pure formatter — returns the title/bodies for both Slack and email so the
 * caller can dispatch to whichever transports are configured. Centralising
 * the wording also keeps the two channels in sync.
 */
export function formatBackfillCompletionNotification(
  job: BackfillNotificationJob,
  operator: CrmTranscriptBackfillOperatorContact | null,
): FormattedBackfillNotification {
  const { display: operatorDisplay, email: operatorEmail } =
    describeBackfillOperator(operator);

  // Task #1057 — separate "cancelled" verb so the email subject and Slack
  // headline don't read as a crash for deliberately-stopped runs. Existing
  // FAILED rows still surface as "failed".
  const isFailure = job.status === "FAILED";
  const isCancelled = job.status === "CANCELLED";
  const isRetry = !!job.parentJobId;
  const verb = isCancelled ? "cancelled" : isFailure ? "failed" : "completed";
  const kind = isRetry ? "Transcript backfill retry" : "Transcript backfill";
  const title = `${kind} ${verb}`;
  const emailSubject = `[CRM] ${title} — started by ${operatorDisplay}`;

  const startedAt = job.startedAt;
  const completedAt = job.completedAt ?? new Date().toISOString();

  const slackBody = [
    `*Status:* ${job.status}`,
    `*Started by:* ${operatorDisplay} <${operatorEmail}>`,
    `*Job:* \`${job.id}\`${isRetry ? ` (retry of \`${job.parentJobId}\`)` : ""}`,
    `*Counts:* ${job.succeeded} succeeded / ${job.failed} failed / ${job.processed} processed of ${job.total}`,
    `*Started:* ${startedAt}`,
    `*Finished:* ${completedAt}`,
  ].join("\n");

  const emailText = [
    `${title}.`,
    ``,
    `Started by: ${operatorDisplay} <${operatorEmail}>`,
    `Job id: ${job.id}${isRetry ? ` (retry of ${job.parentJobId})` : ""}`,
    `Status: ${job.status}`,
    `Succeeded: ${job.succeeded}`,
    `Failed: ${job.failed}`,
    `Processed: ${job.processed} of ${job.total}`,
    `Started at: ${startedAt}`,
    `Finished at: ${completedAt}`,
  ].join("\n");

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const emailHtml = `
    <div style="font-family: -apple-system, system-ui, sans-serif; font-size: 14px; color: #111;">
      <h2 style="margin:0 0 12px 0;">${escape(title)}</h2>
      <table cellspacing="0" cellpadding="4" style="border-collapse:collapse;">
        <tr><td><strong>Started by</strong></td><td>${escape(operatorDisplay)} &lt;${escape(operatorEmail)}&gt;</td></tr>
        <tr><td><strong>Job id</strong></td><td><code>${escape(job.id)}</code>${isRetry ? ` (retry of <code>${escape(job.parentJobId!)}</code>)` : ""}</td></tr>
        <tr><td><strong>Status</strong></td><td>${escape(job.status)}</td></tr>
        <tr><td><strong>Succeeded</strong></td><td>${job.succeeded}</td></tr>
        <tr><td><strong>Failed</strong></td><td>${job.failed}</td></tr>
        <tr><td><strong>Processed</strong></td><td>${job.processed} of ${job.total}</td></tr>
        <tr><td><strong>Started</strong></td><td>${escape(startedAt)}</td></tr>
        <tr><td><strong>Finished</strong></td><td>${escape(completedAt)}</td></tr>
      </table>
    </div>
  `.trim();

  return {
    title,
    slackBody,
    emailText,
    emailHtml,
    emailSubject,
    operatorDisplay,
    operatorEmail,
  };
}

/**
 * Resolved destinations for a single notification dispatch — exported for
 * testing and so the caller can inject pre-fetched settings if it wants to
 * avoid a second DB round-trip.
 */
export type ResolvedBackfillNotificationDestinations = {
  slackWebhookUrl: string | null;
  emailRecipients: string[];
};

/**
 * Task #1017 — resolve where to send alerts for a given org. Per-org settings
 * (configured by admins from the in-app settings UI) are the primary source;
 * env vars are kept as a fallback so existing deployments keep working until
 * they migrate. We treat the per-org row as authoritative as soon as ANY
 * destination is set on it, so an admin can intentionally clear a destination
 * without it silently re-falling-back to the env var.
 */
export async function resolveBackfillNotificationDestinations(
  orgId: string,
): Promise<ResolvedBackfillNotificationDestinations> {
  const settings = await getCrmTranscriptBackfillNotificationSettings(orgId);
  if (settings) {
    return {
      slackWebhookUrl: (settings.slackWebhookUrl ?? "").trim() || null,
      emailRecipients: (settings.emailRecipients ?? [])
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  const envSlack = (process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK || "").trim();
  const envEmail = (process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO || "").trim();
  return {
    slackWebhookUrl: envSlack || null,
    emailRecipients: envEmail
      ? envEmail
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Task #1051 — fallback email to org admins when an alert delivery fails.
//
// Task #1031 records failed Slack/email dispatch attempts so admins can see
// them on the admin transcript-backfill page, but admins still had to load
// the page to notice. To catch a misconfigured webhook or expired SMTP key
// without anyone refreshing the dashboard, every recorded failure now also
// emails the org's admins (respecting their per-user preferences via
// `listOrgAdminsForAlertFailureFallback`).
//
// Identical failures are de-duplicated within `FAILURE_FALLBACK_DEDUPE_MS`
// (default: 1 hour) keyed by org + channel + recipient summary + error
// message, so a continuously-broken webhook can't mailbomb every admin
// every retry. The dedupe map is in-memory and per-process, which matches
// the granularity we need (operational pager-style alerts) without a new
// DB table — losing the cache across deploys/restarts at worst means a
// single extra email after a deploy, which is acceptable.
// ---------------------------------------------------------------------------

const FAILURE_FALLBACK_DEDUPE_MS = 60 * 60 * 1000; // 1 hour
const failureFallbackDedupe = new Map<string, number>();

/** Test seam: clears the dedupe cache between unit tests. */
export function _resetAlertFailureFallbackDedupeForTests(): void {
  failureFallbackDedupe.clear();
}

function buildFallbackDedupeKey(input: {
  orgId: string;
  channel: "slack" | "email";
  recipientSummary: string;
  errorMessage: string | null;
}): string {
  const err = (input.errorMessage ?? "").trim().slice(0, 200);
  return `${input.orgId}|${input.channel}|${input.recipientSummary.trim().slice(0, 200)}|${err}`;
}

function isFailureFallbackDeduped(
  key: string,
  now: number = Date.now(),
): boolean {
  // Drop expired entries opportunistically so the map can't grow unbounded
  // in long-running processes that see lots of distinct failures.
  for (const [k, ts] of failureFallbackDedupe) {
    if (now - ts >= FAILURE_FALLBACK_DEDUPE_MS) failureFallbackDedupe.delete(k);
  }
  const last = failureFallbackDedupe.get(key);
  return last !== undefined && now - last < FAILURE_FALLBACK_DEDUPE_MS;
}

function markFailureFallbackSent(key: string, now: number = Date.now()): void {
  failureFallbackDedupe.set(key, now);
}

function describeAdminRecipient(
  recipient: OrgAdminFailureFallbackRecipient,
): string {
  const first = (recipient.firstName ?? "").trim();
  const last = (recipient.lastName ?? "").trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return recipient.email;
}

export type AlertFailureFallbackInput = {
  orgId: string;
  jobId: string | null;
  channel: "slack" | "email";
  recipientSummary: string;
  errorMessage: string | null;
};

export type AlertFailureFallbackContent = {
  subject: string;
  text: string;
  html: string;
  /** One-line human summary used at the top of both bodies. */
  summary: string;
  historyUrl: string;
};

export function buildAlertFailureFallbackContent(
  input: AlertFailureFallbackInput,
): AlertFailureFallbackContent {
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const historyUrl = baseUrl
    ? `${baseUrl}/admin/transcript-backfill`
    : "/admin/transcript-backfill";
  const channelLabel = input.channel === "slack" ? "Slack" : "email";
  const summary =
    `Transcript backfill alert failed to deliver via ${channelLabel} ` +
    `to ${input.recipientSummary || "(no recipients on file)"}.`;
  const subject = `[CRM] Transcript backfill alert delivery failed (${channelLabel})`;

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const text = [
    summary,
    "",
    `Channel:  ${channelLabel}`,
    `Recipient: ${input.recipientSummary || "(none)"}`,
    `Error:    ${input.errorMessage ?? "(no error message recorded)"}`,
    input.jobId ? `Job ID:   ${input.jobId}` : null,
    "",
    `Open the admin transcript-backfill page to review and fix the destination:`,
    historyUrl,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;font-size:14px;color:#111;">
      <p style="margin:0 0 12px;"><strong>${escape(summary)}</strong></p>
      <table cellspacing="0" cellpadding="4" style="border-collapse:collapse;">
        <tr><td><strong>Channel</strong></td><td>${escape(channelLabel)}</td></tr>
        <tr><td><strong>Recipient</strong></td><td>${escape(input.recipientSummary || "(none)")}</td></tr>
        <tr><td><strong>Error</strong></td><td>${escape(input.errorMessage ?? "(no error message recorded)")}</td></tr>
        ${input.jobId ? `<tr><td><strong>Job ID</strong></td><td><code>${escape(input.jobId)}</code></td></tr>` : ""}
      </table>
      <p style="margin:16px 0 0;">
        <a href="${escape(historyUrl)}" style="color:#2563eb;">Open the admin transcript-backfill page</a>
        to review delivery history and fix the destination.
      </p>
    </div>
  `.trim();

  return { subject, text, html, summary, historyUrl };
}

/**
 * Sends the fallback email to every eligible org admin. Returns the number
 * of admins notified (0 when deduped, opted out, or the email transport
 * declines). Never throws — a fallback failure must never bubble up and
 * break the dispatcher's bookkeeping.
 */
export async function notifyOrgAdminsOfAlertDeliveryFailure(
  input: AlertFailureFallbackInput,
): Promise<number> {
  try {
    // Check (don't yet record) the dedupe key first so a transient lookup or
    // transport failure on the first try doesn't suppress the next hour of
    // genuine alerts. We only mark the key after a successful send below.
    const key = buildFallbackDedupeKey(input);
    if (isFailureFallbackDeduped(key)) {
      logInfo(
        "transcriptBackfillNotifications: fallback email suppressed (deduped)",
        { orgId: input.orgId, channel: input.channel, jobId: input.jobId },
      );
      return 0;
    }

    const admins = await listOrgAdminsForAlertFailureFallback(input.orgId);
    if (admins.length === 0) {
      logInfo(
        "transcriptBackfillNotifications: fallback email skipped (no eligible admins)",
        { orgId: input.orgId, channel: input.channel, jobId: input.jobId },
      );
      return 0;
    }

    const content = buildAlertFailureFallbackContent(input);
    const recipients = admins.map((a) => a.email);
    const ok = await sendEmail({
      to: recipients,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    if (!ok) {
      logWarn(
        "transcriptBackfillNotifications: fallback email transport returned non-success",
        { orgId: input.orgId, channel: input.channel, jobId: input.jobId },
      );
      return 0;
    }
    markFailureFallbackSent(key);
    logInfo("transcriptBackfillNotifications: fallback email dispatched", {
      orgId: input.orgId,
      channel: input.channel,
      jobId: input.jobId,
      adminCount: admins.length,
      admins: admins.map(describeAdminRecipient),
    });
    return admins.length;
  } catch (err) {
    logWarn(
      "transcriptBackfillNotifications: fallback email dispatch threw",
      {
        orgId: input.orgId,
        channel: input.channel,
        jobId: input.jobId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return 0;
  }
}

/**
 * Dispatches the formatted notification to whichever transports are
 * configured. Per-organization settings (Task #1017) are the primary source;
 * env vars (`CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK`,
 * `CRM_BACKFILL_NOTIFY_EMAIL_TO`) are used only when no per-org row exists.
 * Both channels are best-effort: a transport failure is logged but never
 * throws, so the caller (the backfill worker's `finally` block) can keep
 * doing its bookkeeping. If neither destination is set the function is a
 * no-op.
 */
export async function notifyBackfillCompletion(
  job: BackfillNotificationJob,
  operator: CrmTranscriptBackfillOperatorContact | null,
  destinationsOverride?: ResolvedBackfillNotificationDestinations,
): Promise<void> {
  const destinations =
    destinationsOverride ??
    (await resolveBackfillNotificationDestinations(job.orgId));
  const slackWebhook = destinations.slackWebhookUrl ?? "";
  const recipients = destinations.emailRecipients;
  if (!slackWebhook && recipients.length === 0) return;

  const formatted = formatBackfillCompletionNotification(job, operator);

  const tasks: Array<Promise<unknown>> = [];

  // Task #1031 — every dispatch attempt (success or failure) is recorded so
  // admins can confirm delivery from the in-app history card. Recording is
  // best-effort: a logging failure must never bubble up and break the
  // backfill worker's `finally` block.
  const recordDelivery = async (
    channel: "slack" | "email",
    status: "success" | "failure",
    recipientSummary: string,
    errorMessage?: string,
  ) => {
    try {
      await recordCrmTranscriptBackfillAlertDelivery({
        organizationId: job.orgId,
        jobId: job.id,
        channel,
        status,
        recipientSummary,
        errorMessage: errorMessage ?? null,
      });
    } catch (err) {
      logWarn("transcriptBackfillNotifications: failed to record delivery", {
        jobId: job.id,
        channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Task #1051 — fan out a fallback email to org admins so a misconfigured
    // webhook is noticed without anyone loading the admin page. Best-effort:
    // `notifyOrgAdminsOfAlertDeliveryFailure` swallows its own errors.
    if (status === "failure") {
      await notifyOrgAdminsOfAlertDeliveryFailure({
        orgId: job.orgId,
        jobId: job.id,
        channel,
        recipientSummary,
        errorMessage: errorMessage ?? null,
      });
    }
  };

  const slackTarget = (() => {
    try {
      return new URL(slackWebhook).host;
    } catch {
      return slackWebhook ? "slack" : "";
    }
  })();

  if (slackWebhook) {
    if (!isValidSlackWebhookUrl(slackWebhook)) {
      const msg = "Invalid Slack webhook URL (must be https://hooks.slack.com/...)";
      logWarn(
        "transcriptBackfillNotifications: ignoring invalid Slack webhook URL",
        { jobId: job.id, orgId: job.orgId },
      );
      tasks.push(recordDelivery("slack", "failure", slackTarget, msg));
    } else {
      tasks.push(
        postSlackWebhook(slackWebhook, formatted.title, formatted.slackBody)
          .then(
            () => recordDelivery("slack", "success", slackTarget),
            (err) => {
              const message = err instanceof Error ? err.message : String(err);
              logWarn("transcriptBackfillNotifications: slack dispatch failed", {
                jobId: job.id,
                error: message,
              });
              return recordDelivery("slack", "failure", slackTarget, message);
            },
          ),
      );
    }
  }

  if (recipients.length > 0) {
    const recipientSummary = recipients.join(", ");
    tasks.push(
      sendEmail({
        to: recipients,
        subject: formatted.emailSubject,
        text: formatted.emailText,
        html: formatted.emailHtml,
      }).then(
        (ok) => {
          if (ok) {
            return recordDelivery("email", "success", recipientSummary);
          }
          return recordDelivery(
            "email",
            "failure",
            recipientSummary,
            "Email transport returned a non-success result",
          );
        },
        (err) => {
          const message = err instanceof Error ? err.message : String(err);
          logWarn("transcriptBackfillNotifications: email dispatch failed", {
            jobId: job.id,
            error: message,
          });
          return recordDelivery("email", "failure", recipientSummary, message);
        },
      ),
    );
  }

  await Promise.all(tasks);
  logInfo("transcriptBackfillNotifications: dispatched", {
    jobId: job.id,
    status: job.status,
    operator: formatted.operatorDisplay,
  });
}

/**
 * Task #1018 — admin "send test alert" support. Dispatches a sample
 * COMPLETED and a sample FAILED notification using the same formatter as
 * the real run-completed dispatcher, so admins can verify their Slack
 * webhook / email recipient list end-to-end without waiting for a real
 * backfill. Returns per-channel results so the UI can show a separate
 * toast for Slack and email.
 *
 * Unlike `notifyBackfillCompletion`, this helper performs the Slack POST
 * itself so it can surface a real success/failure status per channel
 * (the shared `sendSlackMessage` swallows transport errors via logging).
 */
export type TestAlertChannelResult = {
  configured: boolean;
  ok: boolean;
  error?: string;
  recipients?: string[];
};

export type TestAlertResult = {
  slack: TestAlertChannelResult;
  email: TestAlertChannelResult;
  operatorDisplay: string;
};

/**
 * Task #1032 — read-only summary of which alert destinations are wired up,
 * for the admin transcript backfill page. Intentionally never returns the
 * Slack webhook URL itself (it's a credential); we only surface whether
 * one is configured and whether it parses as a valid Slack URL.
 *
 * Email recipients are safe to surface so admins can see exactly who would
 * receive a real alert.
 */
export type BackfillNotificationConfig = {
  slack: {
    configured: boolean;
    /** False when CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK is set but malformed. */
    valid: boolean;
  };
  email: {
    configured: boolean;
    recipients: string[];
  };
};

/**
 * Task #1059 — read the destination summary from the same per-org settings
 * source the test-alert button and run-completed dispatcher use, so the
 * admin panel reflects what would actually be targeted. Falls back to the
 * legacy env vars via `resolveBackfillNotificationDestinations` when no
 * per-org row exists. The Slack webhook URL itself is intentionally never
 * returned — only a configured/valid summary.
 */
export async function getBackfillNotificationConfig(
  orgId: string,
): Promise<BackfillNotificationConfig> {
  const destinations = await resolveBackfillNotificationDestinations(orgId);
  const slackWebhook = (destinations.slackWebhookUrl ?? "").trim();
  const recipients = destinations.emailRecipients;
  return {
    slack: {
      configured: slackWebhook.length > 0,
      valid: slackWebhook.length > 0 ? isValidSlackWebhookUrl(slackWebhook) : false,
    },
    email: {
      configured: recipients.length > 0,
      recipients,
    },
  };
}

function buildSampleJobs(orgId: string): BackfillNotificationJob[] {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const completedAt = now.toISOString();
  const baseId = `test-alert-${now.getTime()}`;
  return [
    {
      id: `${baseId}-completed`,
      orgId,
      status: "COMPLETED",
      total: 12,
      processed: 12,
      succeeded: 12,
      failed: 0,
      startedAt,
      completedAt,
      parentJobId: null,
    },
    {
      id: `${baseId}-failed`,
      orgId,
      status: "FAILED",
      total: 12,
      processed: 12,
      succeeded: 9,
      failed: 3,
      startedAt,
      completedAt,
      parentJobId: null,
    },
  ];
}

// Task #1031 — direct webhook POST so the dispatcher can record real
// success/failure outcomes per channel (the shared `sendSlackMessage` helper
// swallows transport errors via logging, which would make every recorded
// Slack delivery look "successful" even on a 4xx).
async function postSlackWebhook(
  webhookUrl: string,
  title: string,
  message: string,
): Promise<void> {
  const payload = {
    blocks: [
      { type: "header", text: { type: "plain_text", text: title, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: message } },
    ],
  };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Slack webhook returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
}

async function postSlackTest(
  webhookUrl: string,
  formatted: FormattedBackfillNotification,
): Promise<void> {
  const payload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `[TEST] ${formatted.title}`,
          emoji: true,
        },
      },
      { type: "section", text: { type: "mrkdwn", text: formatted.slackBody } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              ":test_tube: This is a *test* alert dispatched from the admin transcript backfill page.",
          },
        ],
      },
    ],
  };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

export async function sendTestBackfillAlert(
  orgId: string,
  operator: CrmTranscriptBackfillOperatorContact | null,
  destinationsOverride?: ResolvedBackfillNotificationDestinations,
): Promise<TestAlertResult> {
  // Task #1030 — use the *currently-saved* per-org destinations (Slack
  // webhook + email recipients from the in-app settings card) rather than
  // env vars, so admins can verify their saved settings end-to-end right
  // after pressing Save. `resolveBackfillNotificationDestinations` already
  // falls back to the legacy env vars when no per-org row exists, so older
  // deployments that haven't migrated keep working.
  const destinations =
    destinationsOverride ??
    (await resolveBackfillNotificationDestinations(orgId));
  const slackWebhook = (destinations.slackWebhookUrl ?? "").trim();
  const emailRecipients = destinations.emailRecipients;

  const [completedJob, failedJob] = buildSampleJobs(orgId);
  const completedFormatted = formatBackfillCompletionNotification(completedJob, operator);
  const failedFormatted = formatBackfillCompletionNotification(failedJob, operator);

  const slackResult: TestAlertChannelResult = { configured: false, ok: false };
  if (slackWebhook) {
    slackResult.configured = true;
    if (!isValidSlackWebhookUrl(slackWebhook)) {
      slackResult.error = "Invalid Slack webhook URL (must be https://hooks.slack.com/...)";
    } else {
      try {
        await postSlackTest(slackWebhook, completedFormatted);
        await postSlackTest(slackWebhook, failedFormatted);
        slackResult.ok = true;
      } catch (err) {
        slackResult.error = err instanceof Error ? err.message : String(err);
        logWarn("transcriptBackfillNotifications: test slack dispatch failed", {
          orgId,
          error: slackResult.error,
        });
      }
    }
  }

  const emailResult: TestAlertChannelResult = { configured: false, ok: false };
  if (emailRecipients.length > 0) {
    emailResult.configured = true;
    const recipients = emailRecipients;
    emailResult.recipients = recipients;
    {
      try {
        const subjects = [completedFormatted, failedFormatted].map((f) => ({
          ...f,
          emailSubject: `[TEST] ${f.emailSubject}`,
          emailText:
            `(Test alert dispatched from the admin transcript backfill page.)\n\n` +
            f.emailText,
          emailHtml:
            `<p style="font-family:-apple-system,system-ui,sans-serif;font-size:12px;color:#666;">` +
            `Test alert dispatched from the admin transcript backfill page.</p>` +
            f.emailHtml,
        }));
        const results = await Promise.all(
          subjects.map((f) =>
            sendEmail({
              to: recipients,
              subject: f.emailSubject,
              text: f.emailText,
              html: f.emailHtml,
            }),
          ),
        );
        if (results.every(Boolean)) {
          emailResult.ok = true;
        } else {
          emailResult.error = "Email transport returned a non-success result (check server logs)";
        }
      } catch (err) {
        emailResult.error = err instanceof Error ? err.message : String(err);
        logWarn("transcriptBackfillNotifications: test email dispatch failed", {
          orgId,
          error: emailResult.error,
        });
      }
    }
  }

  logInfo("transcriptBackfillNotifications: test alert dispatched", {
    orgId,
    operator: completedFormatted.operatorDisplay,
    slack: { configured: slackResult.configured, ok: slackResult.ok },
    email: { configured: emailResult.configured, ok: emailResult.ok },
  });

  return {
    slack: slackResult,
    email: emailResult,
    operatorDisplay: completedFormatted.operatorDisplay,
  };
}

// ---------------------------------------------------------------------------
// Task #1050 — admin "Resend" action for a previously-failed alert delivery.
// Re-runs the same dispatch (same job id, same channel) using the org's
// currently-saved destinations and writes a brand-new delivery row reflecting
// the new outcome. Successful or non-existent deliveries are rejected so the
// UI can never accidentally double-fire a working alert.
// ---------------------------------------------------------------------------
export type ResendBackfillAlertResult =
  | { ok: true; delivery: CrmTranscriptBackfillAlertDelivery }
  | {
      ok: false;
      reason:
        | "NOT_FOUND"
        | "NOT_FAILED"
        | "JOB_MISSING"
        | "CHANNEL_NOT_CONFIGURED";
    };

export async function resendBackfillAlertDelivery(
  orgId: string,
  deliveryId: string,
): Promise<ResendBackfillAlertResult> {
  const original = await getCrmTranscriptBackfillAlertDelivery(deliveryId, orgId);
  if (!original) return { ok: false, reason: "NOT_FOUND" };
  if (original.status !== "failure") return { ok: false, reason: "NOT_FAILED" };
  // Test-alert rows (and any orphaned deliveries whose backing job was
  // garbage-collected) can't be replayed because we no longer have the
  // counts/operator context the formatter needs.
  if (!original.jobId) return { ok: false, reason: "JOB_MISSING" };

  const job = await getCrmTranscriptBackfillJob(original.jobId, orgId);
  if (!job) return { ok: false, reason: "JOB_MISSING" };

  const operator = job.startedById
    ? await getCrmTranscriptBackfillOperatorContact(job.startedById)
    : null;

  const destinations = await resolveBackfillNotificationDestinations(orgId);
  // Restrict the dispatch to ONLY the channel that originally failed so
  // resending a broken Slack delivery doesn't re-fire the (already
  // successful) email to the same recipients.
  const channel = original.channel as "slack" | "email";
  const restricted: ResolvedBackfillNotificationDestinations = {
    slackWebhookUrl: channel === "slack" ? destinations.slackWebhookUrl : null,
    emailRecipients: channel === "email" ? destinations.emailRecipients : [],
  };
  if (
    (channel === "slack" && !restricted.slackWebhookUrl) ||
    (channel === "email" && restricted.emailRecipients.length === 0)
  ) {
    return { ok: false, reason: "CHANNEL_NOT_CONFIGURED" };
  }

  const startedAt =
    job.startedAt instanceof Date
      ? job.startedAt.toISOString()
      : String(job.startedAt);
  const completedAt = job.completedAt
    ? job.completedAt instanceof Date
      ? job.completedAt.toISOString()
      : String(job.completedAt)
    : null;

  await notifyBackfillCompletion(
    {
      id: job.id,
      orgId: job.organizationId,
      status: job.status as "RUNNING" | "COMPLETED" | "FAILED",
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      startedAt,
      completedAt,
      parentJobId: job.parentJobId ?? null,
    },
    operator,
    restricted,
  );

  // `notifyBackfillCompletion` writes the new delivery row itself; pull it
  // back out so the caller can return it to the UI without an extra round
  // trip from the client.
  const recent = await listCrmTranscriptBackfillAlertDeliveries(orgId, 20);
  const newRow =
    recent.find(
      (r) =>
        r.jobId === job.id &&
        r.channel === channel &&
        r.id !== original.id &&
        r.attemptedAt >= original.attemptedAt,
    ) ?? null;
  if (!newRow) {
    // The dispatcher should always have recorded a row, but if persistence
    // failed (logged as a warning inside `notifyBackfillCompletion`) we
    // still treat the resend as having taken place rather than throwing.
    logWarn(
      "transcriptBackfillNotifications: resend dispatched but new delivery row not found",
      { orgId, jobId: job.id, channel, originalDeliveryId: original.id },
    );
    return {
      ok: true,
      delivery: {
        ...original,
        id: original.id,
        status: "failure",
        errorMessage: "Resend dispatched but outcome row could not be located.",
        attemptedAt: new Date(),
      },
    };
  }
  return { ok: true, delivery: newRow };
}

// ---------------------------------------------------------------------------
// Task #1065 — daily digest of alert delivery failures.
//
// Task #1051 already fans out a real-time email on every individual failure,
// but a transient hiccup followed by a recovery still produces a one-off
// email with no overall context. This digest aggregates the previous 24h
// of `crm_transcript_backfill_alert_deliveries` failure rows per org and
// sends one summary email per day to the same admins the real-time
// fallback uses (so admin opt-outs still apply). Orgs with zero failures
// in the window are skipped entirely — the digest is silent on quiet days.
// ---------------------------------------------------------------------------

export type AlertFailureDigestContent = {
  subject: string;
  text: string;
  html: string;
  /** One-line human summary used at the top of both bodies. */
  summary: string;
  historyUrl: string;
};

export type AlertFailureDigestInput = {
  entry: CrmTranscriptBackfillAlertFailureDigestEntry;
  /** Window length in hours (e.g. 24). Used in the summary wording. */
  windowHours: number;
};

function pluralizeFailures(n: number): string {
  return n === 1 ? "1 alert delivery failed" : `${n} alert deliveries failed`;
}

function describeChannelBreakdown(slack: number, email: number): string {
  const parts: string[] = [];
  if (slack > 0) parts.push(slack === 1 ? "1 Slack" : `${slack} Slack`);
  if (email > 0) parts.push(email === 1 ? "1 email" : `${email} email`);
  return parts.join(", ");
}

export function buildAlertFailureDigestContent(
  input: AlertFailureDigestInput,
): AlertFailureDigestContent {
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const historyUrl = baseUrl
    ? `${baseUrl}/admin/transcript-backfill`
    : "/admin/transcript-backfill";
  const { entry, windowHours } = input;
  const breakdown = describeChannelBreakdown(entry.slackCount, entry.emailCount);
  const summary =
    `${pluralizeFailures(entry.total)} in the last ${windowHours}h` +
    (breakdown ? ` — ${breakdown}.` : ".");
  const subject = `[CRM] Daily transcript backfill alert digest — ${pluralizeFailures(entry.total)}`;

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const recentLines = entry.recentFailures.map((f) => {
    const when = f.attemptedAt.toISOString();
    const channel = f.channel === "slack" ? "Slack" : "email";
    const job = f.jobId ? ` (job ${f.jobId})` : "";
    const err = f.errorMessage ? ` — ${f.errorMessage}` : "";
    return `  • ${when}  ${channel} → ${f.recipientSummary || "(none)"}${job}${err}`;
  });

  const text = [
    summary,
    "",
    `Failures by channel:`,
    `  Slack: ${entry.slackCount}`,
    `  Email: ${entry.emailCount}`,
    "",
    entry.recentFailures.length > 0
      ? `Most recent failures (up to ${entry.recentFailures.length}):`
      : null,
    ...recentLines,
    "",
    `Open the admin transcript-backfill page to review delivery history:`,
    historyUrl,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const recentRows = entry.recentFailures
    .map(
      (f) => `
        <tr>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;white-space:nowrap;">${escape(f.attemptedAt.toISOString())}</td>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;">${escape(f.channel === "slack" ? "Slack" : "email")}</td>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;">${escape(f.recipientSummary || "(none)")}</td>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;">${escape(f.errorMessage ?? "")}</td>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;">${f.jobId ? `<code>${escape(f.jobId)}</code>` : ""}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;font-size:14px;color:#111;">
      <p style="margin:0 0 12px;"><strong>${escape(summary)}</strong></p>
      <table cellspacing="0" cellpadding="4" style="border-collapse:collapse;margin-bottom:12px;">
        <tr><td><strong>Slack failures</strong></td><td>${entry.slackCount}</td></tr>
        <tr><td><strong>Email failures</strong></td><td>${entry.emailCount}</td></tr>
        <tr><td><strong>Total</strong></td><td>${entry.total}</td></tr>
      </table>
      ${
        entry.recentFailures.length > 0
          ? `<p style="margin:0 0 4px;"><strong>Most recent failures</strong></p>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:4px 8px;">When</th>
              <th style="padding:4px 8px;">Channel</th>
              <th style="padding:4px 8px;">Recipient</th>
              <th style="padding:4px 8px;">Error</th>
              <th style="padding:4px 8px;">Job</th>
            </tr>
          </thead>
          <tbody>${recentRows}</tbody>
        </table>`
          : ""
      }
      <p style="margin:16px 0 0;">
        <a href="${escape(historyUrl)}" style="color:#2563eb;">Open the admin transcript-backfill page</a>
        to review delivery history.
      </p>
    </div>
  `.trim();

  return { subject, text, html, summary, historyUrl };
}

export type AlertFailureDigestRunSummary = {
  windowHours: number;
  orgsWithFailures: number;
  orgsNotified: number;
  emailsSent: number;
  totalFailures: number;
};

/**
 * Runs the digest: fetches the previous `windowHours` of failures, groups
 * them by org, and emails each org's eligible admins one summary message.
 * Best-effort per org — a failure for one org never blocks the others.
 * Returns counters useful for logs and tests.
 */
export async function runAlertFailureDigest(
  options: { now?: Date; windowHours?: number; recentSampleLimit?: number } = {},
): Promise<AlertFailureDigestRunSummary> {
  const windowHours = options.windowHours ?? 24;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  const aggregates = await aggregateRecentCrmTranscriptBackfillAlertFailures(
    since,
    { recentSampleLimit: options.recentSampleLimit ?? 10 },
  );

  let orgsNotified = 0;
  let emailsSent = 0;
  let totalFailures = 0;

  for (const entry of aggregates) {
    totalFailures += entry.total;
    try {
      const admins = await listOrgAdminsForAlertFailureFallback(
        entry.organizationId,
      );
      if (admins.length === 0) {
        logInfo(
          "transcriptBackfillNotifications: digest skipped (no eligible admins)",
          { orgId: entry.organizationId, total: entry.total },
        );
        continue;
      }
      const content = buildAlertFailureDigestContent({ entry, windowHours });
      const ok = await sendEmail({
        to: admins.map((a) => a.email),
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      if (!ok) {
        logWarn(
          "transcriptBackfillNotifications: digest email transport returned non-success",
          { orgId: entry.organizationId, total: entry.total },
        );
        continue;
      }
      orgsNotified += 1;
      emailsSent += admins.length;
      logInfo("transcriptBackfillNotifications: digest dispatched", {
        orgId: entry.organizationId,
        total: entry.total,
        slackCount: entry.slackCount,
        emailCount: entry.emailCount,
        adminCount: admins.length,
      });
    } catch (err) {
      logWarn("transcriptBackfillNotifications: digest dispatch threw", {
        orgId: entry.organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    windowHours,
    orgsWithFailures: aggregates.length,
    orgsNotified,
    emailsSent,
    totalFailures,
  };
}
