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

import { isValidSlackWebhookUrl, sendSlackMessage } from "./slackService";
import { sendEmail } from "./emailService";
import { logInfo, logWarn } from "../utils/logger";
import { createHash } from "crypto";
import {
  aggregateRecentCrmTranscriptBackfillAlertFailures,
  findQuietCrmTranscriptBackfillOrgsSince,
  getCrmTranscriptBackfillAlertDelivery,
  getCrmTranscriptBackfillJob,
  getCrmTranscriptBackfillNotificationSettings,
  getCrmTranscriptBackfillOperatorContact,
  getCrmTranscriptBackfillTestAlertUsageSummary,
  getOrganizationDisplayInfoByIds,
  listCrmTranscriptBackfillAlertDeliveries,
  listOrgAdminsForAlertFailureFallback,
  pruneAlertFallbackSentBefore,
  pruneBackfillAlertResendCooldownsBefore,
  recordAlertFallbackSent,
  recordCrmTranscriptBackfillAlertDelivery,
  recordCrmTranscriptBackfillThresholdAlert,
  releaseBackfillAlertResendCooldown,
  summarizeOrgAdminAlertFailureFallbackMutes,
  tryReserveBackfillAlertResendCooldown,
  wasAlertFallbackSentSince,
  type AlertFailureFallbackMuteSummary,
  type AlertFallbackSentKey,
  getCrmTranscriptBackfillAlertDelivery as _getDeliveryForType,
  type CrmTranscriptBackfillAlertFailureDigestEntry,
  type CrmTranscriptBackfillOperatorContact,
  type CrmTranscriptBackfillQuietOrgEntry,
  type OrgAdminFailureFallbackRecipient,
} from "../crm/transcriptBackfillStorage";

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
  // Task #1070 — populated when the run was cancelled so the formatter can
  // surface the canceller (and optional reason) in the alert copy. Both
  // fields stay null on COMPLETED / FAILED runs.
  cancelledById?: string | null;
  cancellationReason?: string | null;
};

// Task #1070 — optional second-actor context passed to the formatter so the
// run-completed alert can name the admin who clicked Cancel. Operator and
// canceller share the same shape because both are looked up via the same
// `getCrmTranscriptBackfillOperatorContact` helper.
export type BackfillCancellerContext = {
  canceller: CrmTranscriptBackfillOperatorContact | null;
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
  cancelContext?: BackfillCancellerContext,
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

  // Task #1070 — when the run was cancelled, resolve the canceller's
  // display string the same way we resolve the operator. Use the user
  // contact passed in the context; fall back to a "deleted user" string
  // when the row had a cancelledById but the user record is gone.
  let cancelledByDisplay: string | null = null;
  let cancelledByEmail: string | null = null;
  if (isCancelled) {
    if (cancelContext?.canceller) {
      const described = describeBackfillOperator(cancelContext.canceller);
      cancelledByDisplay = described.display;
      cancelledByEmail = described.email;
    } else if (job.cancelledById) {
      cancelledByDisplay = DELETED_OPERATOR_DISPLAY;
      cancelledByEmail = NO_EMAIL_DISPLAY;
    }
  }
  const cancellationReason =
    isCancelled && job.cancellationReason ? job.cancellationReason : null;

  // Task #1070 — name the canceller in the email subject so admins can spot
  // who stopped a run from their inbox without opening the message. Only
  // applied to CANCELLED runs; COMPLETED / FAILED keep the original
  // "started by" subject.
  const emailSubject = isCancelled && cancelledByDisplay
    ? `[CRM] ${title} by ${cancelledByDisplay} — started by ${operatorDisplay}`
    : `[CRM] ${title} — started by ${operatorDisplay}`;

  const startedAt = job.startedAt;
  const completedAt = job.completedAt ?? new Date().toISOString();

  const slackCancelLines: string[] = [];
  if (isCancelled && cancelledByDisplay) {
    slackCancelLines.push(
      `*Cancelled by:* ${cancelledByDisplay} <${cancelledByEmail ?? NO_EMAIL_DISPLAY}>`,
    );
    if (cancellationReason) {
      slackCancelLines.push(`*Reason:* ${cancellationReason}`);
    }
  }

  const slackBody = [
    `*Status:* ${job.status}`,
    `*Started by:* ${operatorDisplay} <${operatorEmail}>`,
    ...slackCancelLines,
    `*Job:* \`${job.id}\`${isRetry ? ` (retry of \`${job.parentJobId}\`)` : ""}`,
    `*Counts:* ${job.succeeded} succeeded / ${job.failed} failed / ${job.processed} processed of ${job.total}`,
    `*Started:* ${startedAt}`,
    `*Finished:* ${completedAt}`,
  ].join("\n");

  const emailCancelLines: string[] = [];
  if (isCancelled && cancelledByDisplay) {
    emailCancelLines.push(
      `Cancelled by: ${cancelledByDisplay} <${cancelledByEmail ?? NO_EMAIL_DISPLAY}>`,
    );
    if (cancellationReason) {
      emailCancelLines.push(`Reason: ${cancellationReason}`);
    }
  }

  const emailText = [
    `${title}.`,
    ``,
    `Started by: ${operatorDisplay} <${operatorEmail}>`,
    ...emailCancelLines,
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

  const cancelHtmlRows = isCancelled && cancelledByDisplay
    ? `
        <tr><td><strong>Cancelled by</strong></td><td>${escape(cancelledByDisplay)} &lt;${escape(cancelledByEmail ?? NO_EMAIL_DISPLAY)}&gt;</td></tr>
        ${cancellationReason ? `<tr><td><strong>Reason</strong></td><td>${escape(cancellationReason)}</td></tr>` : ""}
    `
    : "";

  const emailHtml = `
    <div style="font-family: -apple-system, system-ui, sans-serif; font-size: 14px; color: #111;">
      <h2 style="margin:0 0 12px 0;">${escape(title)}</h2>
      <table cellspacing="0" cellpadding="4" style="border-collapse:collapse;">
        <tr><td><strong>Started by</strong></td><td>${escape(operatorDisplay)} &lt;${escape(operatorEmail)}&gt;</td></tr>
        ${cancelHtmlRows}
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
// every retry.
//
// Task #1067 — the dedupe state is persisted in `alert_fallback_sent` so a
// deploy or restart can't reset the window: every process consults the same
// ledger before fan-out. The in-memory Map is kept as a fast-path so the
// common case (a webhook that's been broken for 5 minutes already) avoids
// a DB round-trip on every retry.
// ---------------------------------------------------------------------------

const FAILURE_FALLBACK_DEDUPE_MS = 60 * 60 * 1000; // 1 hour
const failureFallbackDedupe = new Map<string, number>();

/** Test seam: clears the dedupe cache between unit tests. */
export function _resetAlertFailureFallbackDedupeForTests(): void {
  failureFallbackDedupe.clear();
}

type NormalizedFallbackInput = {
  orgId: string;
  channel: "slack" | "email";
  recipientSummary: string;
  errorMessage: string;
};

function normalizeFallbackInput(input: {
  orgId: string;
  channel: "slack" | "email";
  recipientSummary: string;
  errorMessage: string | null;
}): NormalizedFallbackInput {
  return {
    orgId: input.orgId,
    channel: input.channel,
    recipientSummary: input.recipientSummary.trim().slice(0, 200),
    errorMessage: (input.errorMessage ?? "").trim().slice(0, 200),
  };
}

function buildInProcessDedupeKey(n: NormalizedFallbackInput): string {
  return `${n.orgId}|${n.channel}|${n.recipientSummary}|${n.errorMessage}`;
}

function buildPersistedDedupeKey(n: NormalizedFallbackInput): AlertFallbackSentKey {
  // Hashing keeps the row narrow even for very long error messages, and
  // means the lookup index can use a fixed-length char column.
  const errorHash = createHash("sha256")
    .update(n.errorMessage)
    .digest("hex");
  return {
    orgId: n.orgId,
    channel: n.channel,
    recipientSummary: n.recipientSummary,
    errorHash,
  };
}

function isFailureFallbackDedupedInMemory(
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

function markFailureFallbackSentInMemory(
  key: string,
  now: number = Date.now(),
): void {
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
    //
    // Task #1067 — consult the in-memory cache first as a fast-path, then
    // fall back to the persisted ledger so a deploy/restart can't reset the
    // dedupe window. A DB read failure must never suppress the alert.
    const normalized = normalizeFallbackInput(input);
    const memKey = buildInProcessDedupeKey(normalized);
    if (isFailureFallbackDedupedInMemory(memKey)) {
      logInfo(
        "transcriptBackfillNotifications: fallback email suppressed (deduped, in-memory)",
        { orgId: input.orgId, channel: input.channel, jobId: input.jobId },
      );
      return 0;
    }
    const persistedKey = buildPersistedDedupeKey(normalized);
    const since = new Date(Date.now() - FAILURE_FALLBACK_DEDUPE_MS);
    let dedupedByDb = false;
    try {
      dedupedByDb = await wasAlertFallbackSentSince(persistedKey, since);
    } catch (err) {
      logWarn(
        "transcriptBackfillNotifications: persisted dedupe lookup failed; proceeding with send",
        {
          orgId: input.orgId,
          channel: input.channel,
          jobId: input.jobId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    if (dedupedByDb) {
      // Mirror into the in-memory cache so subsequent checks in this process
      // don't have to round-trip again.
      markFailureFallbackSentInMemory(memKey);
      logInfo(
        "transcriptBackfillNotifications: fallback email suppressed (deduped, persisted)",
        { orgId: input.orgId, channel: input.channel, jobId: input.jobId },
      );
      return 0;
    }

    // Task #1066 + Task #1076: pass the failing channel so per-admin per-channel
    // mutes (e.g. "ignore Slack failures, still tell me about email failures")
    // are honored, AND pass the "realtime" stream so admins who opted into
    // digest-only / none are excluded from the real-time fan-out.
    const admins = await listOrgAdminsForAlertFailureFallback(
      input.orgId,
      input.channel,
      "realtime",
    );
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
    markFailureFallbackSentInMemory(memKey);
    // Task #1067 — persist the dedupe key so other processes (and this
    // process after a restart) see the same window. Best-effort: a write
    // failure is logged but must never bubble up; the in-memory cache
    // still suppresses repeats within this process.
    try {
      await recordAlertFallbackSent(persistedKey);
    } catch (err) {
      logWarn(
        "transcriptBackfillNotifications: failed to persist fallback dedupe key",
        {
          orgId: input.orgId,
          channel: input.channel,
          jobId: input.jobId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
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

// ---------------------------------------------------------------------------
// Task #1152 — proactive heads-up when a per-channel realtime recipient
// count drops to zero. The admin transcript-backfill page (Task #1102)
// already surfaces these counters, but admins only notice on their next
// visit. We fire a one-off email (or, when no admin remains reachable,
// post to the legacy Slack webhook) the first time a channel is fully
// silenced by mutes, so coverage gaps are caught immediately.
//
// The helper is fire-and-forget from the per-user / admin-driven
// preference-write endpoints in `authProfileRoutes.ts` and
// `crmCallsRoutes.ts`. It must never throw and must never block the
// PATCH response.
//
// Debounce strategy: we reuse the persisted `alert_fallback_sent` ledger
// with a synthetic channel id (`coverage-gap-slack` / `coverage-gap-email`)
// so toggling preferences back-and-forth doesn't spam the org. The window
// is intentionally longer than the per-failure dedupe (24h) because once
// admins know the gap exists they're expected to either fix it or
// acknowledge it on the dashboard. A small in-memory cache short-circuits
// the common case where multiple PATCHes from the same admin land within
// the same minute.
// ---------------------------------------------------------------------------

const COVERAGE_GAP_DEDUPE_MS = 24 * 60 * 60 * 1000; // 24 hours
const coverageGapInMemoryDedupe = new Map<string, number>();

/** Test seam: clears the in-memory coverage-gap dedupe cache. */
export function _resetCoverageGapDedupeForTests(): void {
  coverageGapInMemoryDedupe.clear();
}

function buildCoverageGapInMemoryKey(
  orgId: string,
  channel: "slack" | "email",
): string {
  return `${orgId}|coverage-gap-${channel}`;
}

function buildCoverageGapPersistedKey(
  orgId: string,
  channel: "slack" | "email",
): AlertFallbackSentKey {
  return {
    orgId,
    channel: `coverage-gap-${channel}`,
    recipientSummary: `coverage-gap-${channel}`,
    errorHash: createHash("sha256")
      .update(`coverage-gap|${channel}`)
      .digest("hex"),
  };
}

export type CoverageGapNotificationContent = {
  subject: string;
  text: string;
  html: string;
  slackTitle: string;
  slackMessage: string;
};

export function buildCoverageGapNotificationContent(input: {
  channel: "slack" | "email";
  mutedAdminCount: number;
}): CoverageGapNotificationContent {
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const adminUrl = baseUrl
    ? `${baseUrl}/admin/transcript-backfill`
    : "/admin/transcript-backfill";
  const channelLabel = input.channel === "slack" ? "Slack" : "email";
  const summary =
    `Nobody is left to receive transcript-backfill ${channelLabel} ` +
    `delivery-failure alerts: ${input.mutedAdminCount} admin` +
    `${input.mutedAdminCount === 1 ? " has" : "s have"} muted the ` +
    `${channelLabel} fallback for this org.`;
  const subject = `[CRM] No admins left receiving ${channelLabel} alert-failure pages`;
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = [
    summary,
    "",
    `If a transcript-backfill alert fails to deliver via ${channelLabel}, ` +
      `nobody on this org will be paged automatically until coverage is restored.`,
    "",
    `Open the admin transcript-backfill page to review who has muted what ` +
      `and re-balance coverage:`,
    adminUrl,
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;font-size:14px;color:#111;">
      <p style="margin:0 0 12px;"><strong>${escape(summary)}</strong></p>
      <p style="margin:0 0 12px;">If a transcript-backfill alert fails to deliver via ${escape(channelLabel)}, nobody on this org will be paged automatically until coverage is restored.</p>
      <p style="margin:16px 0 0;">
        <a href="${escape(adminUrl)}" style="color:#2563eb;">Open the admin transcript-backfill page</a>
        to review who has muted what and re-balance coverage.
      </p>
    </div>
  `.trim();
  const slackTitle = `No admins left receiving ${channelLabel} alert-failure pages`;
  const slackMessage = [
    `*${summary}*`,
    `*Review:* <${adminUrl}|Open admin transcript backfill>`,
  ].join("\n");
  return { subject, text, html, slackTitle, slackMessage };
}

/**
 * Inspects the org's per-channel realtime recipient counts and, for each
 * channel that has just been fully silenced by active mutes, fires a one-off
 * heads-up so admins notice the gap immediately. Best-effort: returns the
 * channels for which a notification was actually dispatched. Never throws.
 */
export async function notifyOrgAdminsOfFallbackCoverageGap(
  orgId: string,
): Promise<Array<"slack" | "email">> {
  const dispatched: Array<"slack" | "email"> = [];
  let summary: AlertFailureFallbackMuteSummary;
  try {
    summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
  } catch (err) {
    logWarn(
      "transcriptBackfillNotifications: coverage-gap summary lookup failed",
      { orgId, error: err instanceof Error ? err.message : String(err) },
    );
    return dispatched;
  }

  for (const channel of ["slack", "email"] as const) {
    const ch = summary[channel];
    // Only fire when the gap is *caused by* an active mute. Orgs with no
    // admins at all (effectiveRecipientCount === 0 AND mutedAdminCount === 0)
    // shouldn't trigger this — there's no transition from "covered" to
    // "uncovered" to warn about.
    if (ch.effectiveRecipientCount !== 0) continue;
    if (ch.mutedAdminCount === 0) continue;

    const memKey = buildCoverageGapInMemoryKey(orgId, channel);
    const now = Date.now();
    // Drop expired in-memory entries opportunistically.
    for (const [k, ts] of coverageGapInMemoryDedupe) {
      if (now - ts >= COVERAGE_GAP_DEDUPE_MS)
        coverageGapInMemoryDedupe.delete(k);
    }
    const lastInMem = coverageGapInMemoryDedupe.get(memKey);
    if (lastInMem !== undefined && now - lastInMem < COVERAGE_GAP_DEDUPE_MS) {
      continue;
    }

    const persistedKey = buildCoverageGapPersistedKey(orgId, channel);
    const since = new Date(now - COVERAGE_GAP_DEDUPE_MS);
    let dedupedByDb = false;
    try {
      dedupedByDb = await wasAlertFallbackSentSince(persistedKey, since);
    } catch (err) {
      logWarn(
        "transcriptBackfillNotifications: coverage-gap dedupe lookup failed; proceeding",
        { orgId, channel, error: err instanceof Error ? err.message : String(err) },
      );
    }
    if (dedupedByDb) {
      coverageGapInMemoryDedupe.set(memKey, now);
      continue;
    }

    // Find any admins still reachable via the realtime stream on *some*
    // channel — these are the "remaining admins" the task talks about.
    // We pass `undefined` for the channel filter so an admin who only
    // muted (say) Slack is still emailed about the Slack-coverage gap.
    let remaining: OrgAdminFailureFallbackRecipient[] = [];
    try {
      remaining = await listOrgAdminsForAlertFailureFallback(
        orgId,
        undefined,
        "realtime",
      );
    } catch (err) {
      logWarn(
        "transcriptBackfillNotifications: coverage-gap admin lookup failed",
        { orgId, channel, error: err instanceof Error ? err.message : String(err) },
      );
    }

    const content = buildCoverageGapNotificationContent({
      channel,
      mutedAdminCount: ch.mutedAdminCount,
    });

    let delivered = false;
    if (remaining.length > 0) {
      try {
        const ok = await sendEmail({
          to: remaining.map((a) => a.email),
          subject: content.subject,
          text: content.text,
          html: content.html,
        });
        if (ok) {
          delivered = true;
          logInfo(
            "transcriptBackfillNotifications: coverage-gap email dispatched",
            { orgId, channel, adminCount: remaining.length },
          );
        } else {
          logWarn(
            "transcriptBackfillNotifications: coverage-gap email transport returned non-success",
            { orgId, channel },
          );
        }
      } catch (err) {
        logWarn(
          "transcriptBackfillNotifications: coverage-gap email threw",
          { orgId, channel, error: err instanceof Error ? err.message : String(err) },
        );
      }
    } else {
      // No admins are reachable via any realtime channel. Fall back to
      // the legacy Slack webhook (per-org settings or env var) so somebody
      // is still notified that nobody is on duty.
      let slackWebhook: string | null = null;
      try {
        const destinations = await resolveBackfillNotificationDestinations(orgId);
        slackWebhook = (destinations.slackWebhookUrl ?? "").trim() || null;
      } catch (err) {
        logWarn(
          "transcriptBackfillNotifications: coverage-gap legacy destination lookup failed",
          { orgId, channel, error: err instanceof Error ? err.message : String(err) },
        );
      }
      if (slackWebhook && isValidSlackWebhookUrl(slackWebhook)) {
        try {
          await sendSlackMessage(
            slackWebhook,
            content.slackTitle,
            content.slackMessage,
          );
          delivered = true;
          logInfo(
            "transcriptBackfillNotifications: coverage-gap slack heads-up posted",
            { orgId, channel },
          );
        } catch (err) {
          logWarn(
            "transcriptBackfillNotifications: coverage-gap slack post threw",
            {
              orgId,
              channel,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      } else {
        logInfo(
          "transcriptBackfillNotifications: coverage-gap heads-up skipped (no recipients and no legacy slack webhook)",
          { orgId, channel },
        );
      }
    }

    if (delivered) {
      coverageGapInMemoryDedupe.set(memKey, now);
      try {
        await recordAlertFallbackSent(persistedKey);
      } catch (err) {
        logWarn(
          "transcriptBackfillNotifications: failed to persist coverage-gap dedupe key",
          { orgId, channel, error: err instanceof Error ? err.message : String(err) },
        );
      }
      dispatched.push(channel);
    }
  }
  return dispatched;
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
// Task #1069 — when this dispatch is itself the result of an admin
// clicking Resend, callers pass `provenance` so the new delivery rows
// are tagged with the acting admin's id and `source='resend'`. The
// regular backfill worker omits this argument and rows continue to be
// recorded as automatic dispatches.
export type BackfillCompletionProvenance = {
  source: "automatic" | "resend";
  triggeredById: string | null;
};

export async function notifyBackfillCompletion(
  job: BackfillNotificationJob,
  operator: CrmTranscriptBackfillOperatorContact | null,
  cancelContextOrDestinations?:
    | BackfillCancellerContext
    | ResolvedBackfillNotificationDestinations,
  destinationsOverride?: ResolvedBackfillNotificationDestinations,
  provenance: BackfillCompletionProvenance = {
    source: "automatic",
    triggeredById: null,
  },
): Promise<void> {
  // Task #1070 — backwards-compatible signature: accept either
  // `(job, operator, destinationsOverride)` (legacy) or
  // `(job, operator, cancelContext, destinationsOverride?)` (new). We
  // disambiguate by sniffing for the cancelContext-shaped property.
  let cancelContext: BackfillCancellerContext | undefined;
  let destinations: ResolvedBackfillNotificationDestinations | undefined;
  if (
    cancelContextOrDestinations &&
    "canceller" in (cancelContextOrDestinations as object)
  ) {
    cancelContext = cancelContextOrDestinations as BackfillCancellerContext;
    destinations = destinationsOverride;
  } else {
    destinations = cancelContextOrDestinations as
      | ResolvedBackfillNotificationDestinations
      | undefined;
  }
  const resolved =
    destinations ??
    (await resolveBackfillNotificationDestinations(job.orgId));
  const slackWebhook = resolved.slackWebhookUrl ?? "";
  const recipients = resolved.emailRecipients;
  if (!slackWebhook && recipients.length === 0) return;

  const formatted = formatBackfillCompletionNotification(
    job,
    operator,
    cancelContext,
  );

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
        source: provenance.source,
        triggeredById: provenance.triggeredById,
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
  // Task #1063 — surface the same persisted last-test outcome the per-org
  // settings card uses, so the env-var/system-wide notification panel can
  // show the destinations' last-known health when no per-org row exists
  // (i.e. the deployment is still falling back to env vars). The data lives
  // on the per-org settings row written by the test endpoint.
  lastTestAt: string | null;
  lastTestResult: TestAlertResult | null;
  /**
   * True when no per-org destinations are saved (either no settings row
   * exists at all, or the row exists but both `slackWebhookUrl` and
   * `emailRecipients` are empty — which happens in deployments still on
   * the legacy env vars, where the test endpoint upserts a row to record
   * the last-test result without any per-org destinations being saved).
   * The admin UI uses this to decide whether to render the inline last-
   * test panel inside the env-var summary card (the per-org settings card
   * is empty in this mode and shouldn't double-render the panel).
   */
  usingEnvFallback: boolean;
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
  // Task #1063 — read both the resolved destinations (env-var fallback aware)
  // AND the raw per-org settings row so we can (a) flag whether the env-var
  // fallback is in use and (b) surface the persisted last-test outcome
  // alongside the env-var summary panel.
  const [destinations, settings] = await Promise.all([
    resolveBackfillNotificationDestinations(orgId),
    getCrmTranscriptBackfillNotificationSettings(orgId),
  ]);
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
    lastTestAt: settings?.lastTestAt ? settings.lastTestAt.toISOString() : null,
    lastTestResult: settings?.lastTestResult ?? null,
    // Task #1063 — "fallback" means no per-org destinations are in play:
    // either the row is absent (true env-var fallback), or it exists with
    // both destinations empty (which happens after a test alert in
    // env-fallback mode upserts the row to persist lastTest data). In
    // both cases the per-org settings card has no destinations to show,
    // so the env-var summary card is the right place for the inline
    // last-test panel.
    usingEnvFallback:
      settings === null ||
      ((settings.slackWebhookUrl ?? "").trim() === "" &&
        (settings.emailRecipients ?? []).length === 0),
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
export type CrmTranscriptBackfillAlertDelivery = NonNullable<Awaited<ReturnType<typeof _getDeliveryForType>>>;
export type ResendBackfillAlertResult =
  | { ok: true; delivery: CrmTranscriptBackfillAlertDelivery }
  | {
      ok: false;
      reason:
        | "NOT_FOUND"
        | "NOT_FAILED"
        | "JOB_MISSING"
        | "CHANNEL_NOT_CONFIGURED";
    }
  | { ok: false; reason: "COOLDOWN"; retryAfterSeconds: number };

// Task #1068 — short per-(delivery, channel) cooldown to keep an admin (or a
// script driving the admin button) from spamming Slack / Resend with the same
// alert burst. We key on (orgId, jobId, channel) so the limit also follows
// the *new* delivery row a successful resend creates — otherwise a fresh
// failure row would let a fast clicker bypass the cooldown immediately.
//
// Task #1098 — the reservation now lives in
// `crm_transcript_backfill_alert_resend_cooldowns` (via
// `tryReserveBackfillAlertResendCooldown` in storage) instead of an
// in-process Map, so the window survives a restart/deploy and is shared
// across replicas. The atomic upsert in storage handles the equivalent of
// the previous "stamp before any awaited work" trick — two concurrent
// reservers (in this process or on another pod) cannot both win.
export const RESEND_COOLDOWN_MS = 30_000;

// Kept as a no-op for backwards compatibility with callers/tests that used
// to clear the in-process Map. The persisted ledger is now reset by tests
// that mock the storage module, so this function intentionally does nothing.
export function __resetResendCooldownsForTests(): void {
  // intentionally empty: cooldown state lives in the database now
}

export async function resendBackfillAlertDelivery(
  orgId: string,
  deliveryId: string,
  // Task #1069 — id of the admin who clicked Resend. Propagated through
  // `notifyBackfillCompletion` so the new delivery row is tagged with
  // `source='resend'` and the acting admin's id, which lets the in-app
  // history render "Resent by Jane at 3:14pm" alongside the new outcome.
  triggeredById: string | null = null,
  // Task #1068 — injectable clock for the resend cooldown so tests can
  // advance time without monkey-patching `Date.now`.
  now: number = Date.now(),
): Promise<ResendBackfillAlertResult> {
  const original = await getCrmTranscriptBackfillAlertDelivery(deliveryId, orgId);
  if (!original) return { ok: false, reason: "NOT_FOUND" };
  if (original.status !== "failure") return { ok: false, reason: "NOT_FAILED" };
  // Test-alert rows (and any orphaned deliveries whose backing job was
  // garbage-collected) can't be replayed because we no longer have the
  // counts/operator context the formatter needs.
  if (!original.jobId) return { ok: false, reason: "JOB_MISSING" };

  // Cooldown check + reservation must be atomic — Node is single-threaded
  // between awaits, but two near-simultaneous clicks (or two clicks landing
  // on different replicas) that both pass a naive "read then write" check
  // would still double-fire Slack/Resend. Task #1098 moved the reservation
  // into a persisted upsert so the database enforces the same atomicity
  // across the whole fleet, and the window survives a restart/deploy.
  // Anchored on jobId so a resend that produces a brand-new failure row
  // stays cooled down too.
  const cdKey = {
    orgId,
    jobId: original.jobId,
    channel: original.channel,
  };
  const reservation = await tryReserveBackfillAlertResendCooldown(
    cdKey,
    RESEND_COOLDOWN_MS,
    new Date(now),
  );
  if (!reservation.ok) {
    return {
      ok: false,
      reason: "COOLDOWN",
      retryAfterSeconds: reservation.retryAfterSeconds,
    };
  }
  const reservedAt = reservation.reservedAt;

  const job = await getCrmTranscriptBackfillJob(original.jobId, orgId);
  if (!job) {
    // Roll back the reservation only if we lost it on a precondition failure
    // before any external dispatch ran — otherwise an admin who hits a
    // missing-job edge case would be locked out for 30s for no reason.
    await releaseBackfillAlertResendCooldown(cdKey, reservedAt);
    return { ok: false, reason: "JOB_MISSING" };
  }

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
    // Roll back the reservation — nothing was dispatched, so there's no
    // recipient to protect.
    await releaseBackfillAlertResendCooldown(cdKey, reservedAt);
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

  // Cooldown was already reserved atomically before any awaited work above;
  // the dispatch below proceeds under that reservation. A throw from the
  // notifier still consumes the window, which intentionally prevents
  // tight-loop retries against a perma-broken channel.
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
    // Task #1070 added a `cancelContextOrDestinations` parameter between
    // `operator` and `destinationsOverride`; positional resolution treats
    // the 3rd arg as destinations when it lacks a `canceller` field, so we
    // pass `undefined` for the legacy `destinationsOverride` slot to land
    // provenance in the correct (5th) parameter position.
    undefined,
    { source: "resend", triggeredById },
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
// fallback uses (so admin opt-outs still apply).
//
// Task #1569 — the dispatcher also emails admins of "quiet" orgs (had
// transcript-backfill activity in the window but produced ZERO alert
// delivery rows). On a fully healthy day — no failures AND no quiet
// orgs — no email is sent.
// ---------------------------------------------------------------------------

export type AlertFailureDigestContent = {
  subject: string;
  text: string;
  html: string;
  /** One-line human summary used at the top of both bodies. */
  summary: string;
  historyUrl: string;
};

// Task #1569 — per-org context for the "Quiet orgs in the last 24h" section
// of the digest email. Mirrors the in-app card added in Task #1548 so
// platform support catches silent pipelines from their inbox without
// opening the admin page on a quiet day.
export type AlertFailureDigestQuietOrg = {
  organizationId: string;
  organizationName: string | null;
  organizationSlug: string | null;
  jobsInWindow: number;
  lastJobAt: Date;
};

export type AlertFailureDigestInput = {
  entry: CrmTranscriptBackfillAlertFailureDigestEntry;
  /** Window length in hours (e.g. 24). Used in the summary wording. */
  windowHours: number;
  /**
   * Task #1569 — orgs that ran transcript backfill in the window but
   * produced ZERO alert delivery rows. When non-empty, the digest renders
   * an extra "Quiet orgs in the last 24h" section. The section is omitted
   * entirely when empty so healthy days don't grow the email.
   */
  quietOrgs?: AlertFailureDigestQuietOrg[];
};

function pluralizeFailures(n: number): string {
  if (n === 0) return "no alert delivery failures";
  return n === 1 ? "1 alert delivery failed" : `${n} alert deliveries failed`;
}

function pluralizeQuietOrgs(n: number): string {
  return n === 1 ? "1 quiet org" : `${n} quiet orgs`;
}

function describeQuietOrg(q: AlertFailureDigestQuietOrg): string {
  return q.organizationName || q.organizationSlug || q.organizationId;
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
  const quietOrgs = input.quietOrgs ?? [];
  const breakdown = describeChannelBreakdown(entry.slackCount, entry.emailCount);
  const failurePart =
    `${pluralizeFailures(entry.total)} in the last ${windowHours}h` +
    (breakdown ? ` — ${breakdown}.` : ".");
  // Task #1569 — when the org has no failures but the alert pipeline has
  // gone silent, lead with the quiet-orgs signal in the summary so admins
  // immediately see why they're getting an email on an otherwise quiet day.
  const quietPart =
    quietOrgs.length > 0
      ? ` ${pluralizeQuietOrgs(quietOrgs.length)} ran backfill but reported no alert deliveries.`
      : "";
  const summary = failurePart + quietPart;
  // Task #1569 — give "quiet pipeline" digests a distinct subject so they
  // don't all read as "0 alert deliveries failed" in admins' inboxes.
  const subject =
    entry.total === 0 && quietOrgs.length > 0
      ? `[CRM] Daily transcript backfill alert digest — ${pluralizeQuietOrgs(quietOrgs.length)} silent`
      : `[CRM] Daily transcript backfill alert digest — ${pluralizeFailures(entry.total)}`;

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const recentLines = entry.recentFailures.map((f) => {
    const when = f.attemptedAt.toISOString();
    const channel = f.channel === "slack" ? "Slack" : "email";
    const job = f.jobId ? ` (job ${f.jobId})` : "";
    const err = f.errorMessage ? ` — ${f.errorMessage}` : "";
    return `  • ${when}  ${channel} → ${f.recipientSummary || "(none)"}${job}${err}`;
  });

  // Task #1569 — text rendering of the quiet-orgs section. Each line
  // mirrors the in-app card (Task #1548): org name, jobs-in-window count,
  // last activity timestamp.
  const quietLines = quietOrgs.map((q) => {
    const name = describeQuietOrg(q);
    const jobs = `${q.jobsInWindow} job${q.jobsInWindow === 1 ? "" : "s"}`;
    const last = q.lastJobAt.toISOString();
    return `  • ${name} — ${jobs} in window, last activity ${last}`;
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
    quietOrgs.length > 0 ? "" : null,
    quietOrgs.length > 0
      ? `Quiet orgs in the last ${windowHours}h (ran backfill, no alert deliveries):`
      : null,
    ...quietLines,
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

  // Task #1569 — HTML rendering of the quiet-orgs section. Same columns
  // as the in-app card (org, jobs-in-window, last activity) so the email
  // and the dashboard stay visually aligned.
  const quietRows = quietOrgs
    .map(
      (q) => `
        <tr>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;">${escape(describeQuietOrg(q))}</td>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;">${q.jobsInWindow}</td>
          <td style="padding:4px 8px;border-top:1px solid #e5e7eb;white-space:nowrap;">${escape(q.lastJobAt.toISOString())}</td>
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
      ${
        quietOrgs.length > 0
          ? `<p style="margin:16px 0 4px;"><strong>Quiet orgs in the last ${windowHours}h</strong> <span style="color:#6b7280;font-weight:normal;">— ran backfill but reported no alert deliveries</span></p>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:4px 8px;">Organization</th>
              <th style="padding:4px 8px;">Jobs in window</th>
              <th style="padding:4px 8px;">Last activity</th>
            </tr>
          </thead>
          <tbody>${quietRows}</tbody>
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
  // Task #1569 — number of quiet-ONLY orgs (had backfill activity in the
  // window, zero alert deliveries, AND no failure rollup) that received a
  // synthetic silent-pipeline digest as a result of the new dispatch loop.
  // Quiet orgs that overlap with the failure aggregator are counted under
  // `orgsNotified` instead since they piggyback on their existing failure
  // digest (the quiet section is appended; no second email is sent).
  quietOrgs: number;
  // Task #1082 — set to the cutoff date used to prune the persisted
  // `alert_fallback_sent` ledger after the digest run completes, or null
  // if the prune step was skipped or failed.
  prunedBefore: Date | null;
  // Task #1137 — set to the cutoff date used to prune the persisted
  // `crm_transcript_backfill_alert_resend_cooldowns` ledger after the
  // digest run completes, or null if the prune step was skipped or failed.
  resendCooldownPrunedBefore: Date | null;
};

// Task #1082 — keep the persisted dedupe ledger from growing forever. The
// retention window must be comfortably larger than `FAILURE_FALLBACK_DEDUPE_MS`
// (1 hour) so housekeeping can never accidentally re-enable a deduped alert.
const ALERT_FALLBACK_SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Task #1137 — keep the persisted resend cooldown ledger from growing
// forever. The retention window must be comfortably larger than
// `RESEND_COOLDOWN_MS` (30 s) so housekeeping can never accidentally
// release an active reservation.
const RESEND_COOLDOWN_RETENTION_MS = 24 * 60 * 60 * 1000; // 1 day

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

  // Task #1569 — also fetch the "quiet" orgs (had backfill activity in
  // the window but zero alert delivery rows). These are the silent
  // pipelines surfaced by the in-app card added in Task #1548; the
  // digest now emails their admins too so the signal isn't trapped
  // behind the dashboard. A storage failure here must not block the
  // failure rollup, which is the more critical signal.
  let quietOrgEntries: CrmTranscriptBackfillQuietOrgEntry[] = [];
  try {
    quietOrgEntries = await findQuietCrmTranscriptBackfillOrgsSince(since);
  } catch (err) {
    logWarn(
      "transcriptBackfillNotifications: quiet-orgs lookup failed; digest will run without quiet section",
      { error: err instanceof Error ? err.message : String(err) },
    );
  }

  // Task #1569 — resolve display names for both failure orgs and quiet
  // orgs in a single batch lookup so each digest can render the friendly
  // name (matching the in-app card). A lookup failure simply degrades
  // each section to org-id-only labels; we don't bail.
  const failureOrgIds = aggregates.map((a) => a.organizationId);
  const quietOrgIds = quietOrgEntries.map((q) => q.organizationId);
  const allOrgIds = Array.from(new Set([...failureOrgIds, ...quietOrgIds]));
  let orgInfoById = new Map<
    string,
    { name: string | null; slug: string | null }
  >();
  if (allOrgIds.length > 0) {
    try {
      orgInfoById = await getOrganizationDisplayInfoByIds(allOrgIds);
    } catch (err) {
      logWarn(
        "transcriptBackfillNotifications: org display lookup failed; digest will fall back to org ids",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }
  const buildQuietOrg = (
    q: CrmTranscriptBackfillQuietOrgEntry,
  ): AlertFailureDigestQuietOrg => {
    const meta = orgInfoById.get(q.organizationId);
    return {
      organizationId: q.organizationId,
      organizationName: meta?.name ?? null,
      organizationSlug: meta?.slug ?? null,
      jobsInWindow: q.jobsInWindow,
      lastJobAt: q.lastJobAt,
    };
  };

  // Index quiet orgs by id so we can attach a per-org quiet entry to its
  // own digest below. Quiet orgs by definition have no deliveries (success
  // OR failure), so the overlap with failure orgs should be empty in
  // practice — but if a quiet org somehow also appears in the failure
  // aggregator, attaching its quiet context is the safer behavior.
  const quietByOrgId = new Map<string, CrmTranscriptBackfillQuietOrgEntry>(
    quietOrgEntries.map((q) => [q.organizationId, q]),
  );
  const failureOrgIdSet = new Set(failureOrgIds);

  let orgsNotified = 0;
  let emailsSent = 0;
  let totalFailures = 0;
  let quietOrgsNotified = 0;

  // Helper: dispatch a digest for a single org. Returns true if the email
  // was accepted by the transport, false otherwise. Per-org failures are
  // isolated so one bad org never blocks the rest.
  const dispatchOne = async (
    entry: CrmTranscriptBackfillAlertFailureDigestEntry,
    orgQuietOrgs: AlertFailureDigestQuietOrg[],
  ): Promise<{ sent: boolean; recipientCount: number }> => {
    // Task #1076: only deliver the daily rollup to admins who opted into
    // the digest stream (mode `digest` or `both`). Real-time-only / none
    // recipients are skipped here.
    const admins = await listOrgAdminsForAlertFailureFallback(
      entry.organizationId,
      undefined,
      "digest",
    );
    if (admins.length === 0) {
      logInfo(
        "transcriptBackfillNotifications: digest skipped (no eligible admins)",
        {
          orgId: entry.organizationId,
          total: entry.total,
          quietOrgCount: orgQuietOrgs.length,
        },
      );
      return { sent: false, recipientCount: 0 };
    }
    const content = buildAlertFailureDigestContent({
      entry,
      windowHours,
      quietOrgs: orgQuietOrgs,
    });
    const ok = await sendEmail({
      to: admins.map((a) => a.email),
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    if (!ok) {
      logWarn(
        "transcriptBackfillNotifications: digest email transport returned non-success",
        {
          orgId: entry.organizationId,
          total: entry.total,
          quietOrgCount: orgQuietOrgs.length,
        },
      );
      return { sent: false, recipientCount: 0 };
    }
    logInfo("transcriptBackfillNotifications: digest dispatched", {
      orgId: entry.organizationId,
      total: entry.total,
      slackCount: entry.slackCount,
      emailCount: entry.emailCount,
      quietOrgCount: orgQuietOrgs.length,
      adminCount: admins.length,
    });
    return { sent: true, recipientCount: admins.length };
  };

  for (const entry of aggregates) {
    totalFailures += entry.total;
    try {
      const ownQuiet = quietByOrgId.get(entry.organizationId);
      const orgQuietOrgs = ownQuiet ? [buildQuietOrg(ownQuiet)] : [];
      const result = await dispatchOne(entry, orgQuietOrgs);
      if (result.sent) {
        orgsNotified += 1;
        emailsSent += result.recipientCount;
      }
    } catch (err) {
      logWarn("transcriptBackfillNotifications: digest dispatch threw", {
        orgId: entry.organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Task #1569 — quiet-only orgs: orgs that ran backfill in the window
  // but produced zero alert deliveries AND have no failure rollup. They
  // wouldn't otherwise receive a digest, but they're exactly the silent
  // pipelines platform support needs to catch — so we synthesize a
  // zero-failure entry and dispatch a digest dominated by the quiet
  // section. Per-org failures are isolated as above.
  for (const quiet of quietOrgEntries) {
    if (failureOrgIdSet.has(quiet.organizationId)) continue;
    try {
      const syntheticEntry: CrmTranscriptBackfillAlertFailureDigestEntry = {
        organizationId: quiet.organizationId,
        total: 0,
        slackCount: 0,
        emailCount: 0,
        recentFailures: [],
      };
      const result = await dispatchOne(syntheticEntry, [buildQuietOrg(quiet)]);
      if (result.sent) {
        orgsNotified += 1;
        emailsSent += result.recipientCount;
        quietOrgsNotified += 1;
      }
    } catch (err) {
      logWarn(
        "transcriptBackfillNotifications: quiet-org digest dispatch threw",
        {
          orgId: quiet.organizationId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // Task #1082 — opportunistically prune the persisted dedupe ledger so it
  // can't grow without bound. Best-effort: a prune failure is logged but
  // never fails the digest run.
  const pruneCutoff = new Date(now.getTime() - ALERT_FALLBACK_SENT_RETENTION_MS);
  let prunedBefore: Date | null = null;
  try {
    await pruneAlertFallbackSentBefore(pruneCutoff);
    prunedBefore = pruneCutoff;
  } catch (err) {
    logWarn(
      "transcriptBackfillNotifications: alert_fallback_sent prune failed",
      {
        cutoff: pruneCutoff.toISOString(),
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  // Task #1137 — same housekeeping for the persisted resend cooldown
  // ledger added in Task #1098. Each successful "Resend" click upserts a
  // row that's normally only cleared on rollback, so without this the
  // table grows one row per resent alert delivery forever. The cutoff is
  // comfortably larger than the 30s cooldown window so an active
  // reservation can never be deleted out from under a concurrent caller.
  const resendCooldownPruneCutoff = new Date(
    now.getTime() - RESEND_COOLDOWN_RETENTION_MS,
  );
  let resendCooldownPrunedBefore: Date | null = null;
  try {
    await pruneBackfillAlertResendCooldownsBefore(resendCooldownPruneCutoff);
    resendCooldownPrunedBefore = resendCooldownPruneCutoff;
  } catch (err) {
    logWarn(
      "transcriptBackfillNotifications: resend_cooldowns prune failed",
      {
        cutoff: resendCooldownPruneCutoff.toISOString(),
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return {
    windowHours,
    orgsWithFailures: aggregates.length,
    orgsNotified,
    emailsSent,
    totalFailures,
    quietOrgs: quietOrgsNotified,
    prunedBefore,
    resendCooldownPrunedBefore,
  };
}

// ---------------------------------------------------------------------------
// Task #1094 — passive threshold-breach notifier for the test-alert button.
//
// Task #1060 added a usage rollup that surfaces test-alert frequency on the
// admin transcript-backfill page, but that information is only useful if an
// admin happens to look. A threshold check (default: 20 dispatches in the
// trailing 24h per org, configurable from `BackfillNotificationSettingsCard`)
// fans out a Slack/email notification through the same destinations the
// run-completed alerts use, so runaway scripts or curious users get caught
// even when nobody is watching the admin page.
//
// The notifier is fire-and-forget from the test-alert POST handler: it must
// never block the admin's button click and must never throw. A throttle
// window (default: 1h) prevents the alert channel from being spammed on
// every subsequent click while a sustained breach is unfolding.
// ---------------------------------------------------------------------------

export const DEFAULT_TEST_ALERT_THRESHOLD_PER_DAY = 20;
export const TEST_ALERT_THRESHOLD_NOTIFY_THROTTLE_MS = 60 * 60 * 1000; // 1h

export type TestAlertThresholdBreach = {
  orgId: string;
  count: number;
  threshold: number;
  windowHours: number;
  /** Pre-computed link back to the admin page for the alert body. */
  adminUrl: string;
};

export type FormattedThresholdBreachNotification = {
  title: string;
  slackBody: string;
  emailSubject: string;
  emailText: string;
  emailHtml: string;
};

export function formatTestAlertThresholdBreach(
  breach: TestAlertThresholdBreach,
): FormattedThresholdBreachNotification {
  const title = "Transcript backfill test-alert button hit usage threshold";
  const summary =
    `Org ${breach.orgId} dispatched ${breach.count} test alerts in the last ` +
    `${breach.windowHours}h (threshold: ${breach.threshold}).`;

  const slackBody = [
    `*Org:* \`${breach.orgId}\``,
    `*Count:* ${breach.count} test alerts in the last ${breach.windowHours}h`,
    `*Threshold:* ${breach.threshold}`,
    `*Review:* <${breach.adminUrl}|Open admin transcript backfill>`,
  ].join("\n");

  const emailSubject = `[CRM] Test-alert usage exceeded threshold (${breach.count}/${breach.threshold} in ${breach.windowHours}h)`;
  const emailText = [
    summary,
    ``,
    `Open the admin transcript-backfill page to review who is firing the button:`,
    breach.adminUrl,
  ].join("\n");

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const emailHtml = `
    <div style="font-family:-apple-system,system-ui,sans-serif;font-size:14px;color:#111;">
      <p style="margin:0 0 12px;"><strong>${escape(summary)}</strong></p>
      <table cellspacing="0" cellpadding="4" style="border-collapse:collapse;">
        <tr><td><strong>Org</strong></td><td><code>${escape(breach.orgId)}</code></td></tr>
        <tr><td><strong>Count (${breach.windowHours}h)</strong></td><td>${breach.count}</td></tr>
        <tr><td><strong>Threshold</strong></td><td>${breach.threshold}</td></tr>
      </table>
      <p style="margin:16px 0 0;">
        <a href="${escape(breach.adminUrl)}" style="color:#2563eb;">Open the admin transcript-backfill page</a>
        to review who is firing the button.
      </p>
    </div>
  `.trim();

  return { title, slackBody, emailSubject, emailText, emailHtml };
}

function buildAdminTranscriptBackfillUrl(): string {
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return baseUrl
    ? `${baseUrl}/admin/transcript-backfill`
    : "/admin/transcript-backfill";
}

export type ThresholdBreachCheckResult =
  | { dispatched: false; reason: "BELOW_THRESHOLD" | "THROTTLED" | "NO_DESTINATIONS" }
  | { dispatched: true; count: number; threshold: number };

/**
 * Run the threshold check for an org. Intended to be called fire-and-forget
 * from the test-alert POST handler after the audit row has been written.
 * Never throws; a transport / DB failure is logged and reported as
 * `dispatched: false`.
 */
export async function checkAndNotifyTestAlertThresholdBreach(
  orgId: string,
  options: { now?: Date } = {},
): Promise<ThresholdBreachCheckResult> {
  const now = options.now ?? new Date();
  try {
    const settings = await getCrmTranscriptBackfillNotificationSettings(orgId);
    const threshold =
      settings?.testAlertThresholdPerDay ?? DEFAULT_TEST_ALERT_THRESHOLD_PER_DAY;
    // A non-positive threshold disables the check entirely so admins can
    // opt out without us having to model a separate "enabled" flag.
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return { dispatched: false, reason: "BELOW_THRESHOLD" };
    }

    const usage = await getCrmTranscriptBackfillTestAlertUsageSummary({
      organizationId: orgId,
    });
    if (usage.last24h < threshold) {
      return { dispatched: false, reason: "BELOW_THRESHOLD" };
    }

    if (
      settings?.lastThresholdAlertAt &&
      now.getTime() - new Date(settings.lastThresholdAlertAt).getTime() <
        TEST_ALERT_THRESHOLD_NOTIFY_THROTTLE_MS
    ) {
      return { dispatched: false, reason: "THROTTLED" };
    }

    const destinations = await resolveBackfillNotificationDestinations(orgId);
    const slackWebhook = (destinations.slackWebhookUrl ?? "").trim();
    const recipients = destinations.emailRecipients;
    if (!slackWebhook && recipients.length === 0) {
      return { dispatched: false, reason: "NO_DESTINATIONS" };
    }

    const formatted = formatTestAlertThresholdBreach({
      orgId,
      count: usage.last24h,
      threshold,
      windowHours: 24,
      adminUrl: buildAdminTranscriptBackfillUrl(),
    });

    const tasks: Array<Promise<unknown>> = [];
    if (slackWebhook && isValidSlackWebhookUrl(slackWebhook)) {
      tasks.push(
        postSlackWebhook(slackWebhook, formatted.title, formatted.slackBody)
          .catch((err) => {
            logWarn(
              "transcriptBackfillNotifications: threshold-breach slack dispatch failed",
              {
                orgId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }),
      );
    }
    if (recipients.length > 0) {
      tasks.push(
        sendEmail({
          to: recipients,
          subject: formatted.emailSubject,
          text: formatted.emailText,
          html: formatted.emailHtml,
        }).catch((err) => {
          logWarn(
            "transcriptBackfillNotifications: threshold-breach email dispatch failed",
            {
              orgId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }),
      );
    }
    await Promise.all(tasks);

    try {
      await recordCrmTranscriptBackfillThresholdAlert(orgId, now);
    } catch (err) {
      logWarn(
        "transcriptBackfillNotifications: failed to persist threshold-alert timestamp",
        {
          orgId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }

    logInfo("transcriptBackfillNotifications: threshold-breach dispatched", {
      orgId,
      count: usage.last24h,
      threshold,
    });
    return { dispatched: true, count: usage.last24h, threshold };
  } catch (err) {
    logWarn(
      "transcriptBackfillNotifications: threshold-breach check threw",
      {
        orgId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return { dispatched: false, reason: "BELOW_THRESHOLD" };
  }
}
