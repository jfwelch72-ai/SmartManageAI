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

import { sendSlackMessage, isValidSlackWebhookUrl } from "./slackService";
import { sendEmail } from "./emailService";
import { logInfo, logWarn } from "../utils/logger";
import type { CrmTranscriptBackfillOperatorContact } from "../storage";

export type BackfillNotificationJob = {
  id: string;
  orgId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
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

  const isFailure = job.status === "FAILED";
  const isRetry = !!job.parentJobId;
  const verb = isFailure ? "failed" : "completed";
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
 * Dispatches the formatted notification to whichever transports are
 * configured via env. Both channels are best-effort: a transport failure is
 * logged but never throws, so the caller (the backfill worker's `finally`
 * block) can keep doing its bookkeeping.
 *
 * Configuration:
 *   - `CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK` — Slack incoming webhook URL.
 *   - `CRM_BACKFILL_NOTIFY_EMAIL_TO` — comma-separated recipient list.
 *
 * If neither is set the function is a no-op (with a debug log).
 */
export async function notifyBackfillCompletion(
  job: BackfillNotificationJob,
  operator: CrmTranscriptBackfillOperatorContact | null,
): Promise<void> {
  const slackWebhook = (process.env.CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK || "").trim();
  const emailTo = (process.env.CRM_BACKFILL_NOTIFY_EMAIL_TO || "").trim();
  if (!slackWebhook && !emailTo) return;

  const formatted = formatBackfillCompletionNotification(job, operator);

  const tasks: Array<Promise<unknown>> = [];

  if (slackWebhook) {
    if (!isValidSlackWebhookUrl(slackWebhook)) {
      logWarn(
        "transcriptBackfillNotifications: ignoring invalid CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK",
        { jobId: job.id },
      );
    } else {
      tasks.push(
        sendSlackMessage(slackWebhook, formatted.title, formatted.slackBody).catch((err) => {
          logWarn("transcriptBackfillNotifications: slack dispatch failed", {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    }
  }

  if (emailTo) {
    const recipients = emailTo
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length > 0) {
      tasks.push(
        sendEmail({
          to: recipients,
          subject: formatted.emailSubject,
          text: formatted.emailText,
          html: formatted.emailHtml,
        }).catch((err) => {
          logWarn("transcriptBackfillNotifications: email dispatch failed", {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    }
  }

  await Promise.all(tasks);
  logInfo("transcriptBackfillNotifications: dispatched", {
    jobId: job.id,
    status: job.status,
    operator: formatted.operatorDisplay,
  });
}
