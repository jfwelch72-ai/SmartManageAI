import cron from "node-cron";
import crypto from "crypto";
import * as outboxService from "../integrations/outboxService";
import * as webhookService from "../integrations/webhookService";
import * as connectionService from "../integrations/connectionService";
import { logInfo, logError, logWarn } from "../utils/logger";
import { recordJobMetrics, loadJobMetricsFromDb, pruneJobMetricsDb } from "../utils/jobMetrics";
import { evaluateJobMetricAlerts, sendJobMetricAlertQuietHoursDigests, setRetentionPolicyUnsupportedPairsForAlerts } from "../utils/jobMetricAlerts";
import { insertNotification, insertNotifications } from "../services/notificationService";
import { db } from "../db";
import { isSupportedRetentionPolicyCombo, integrationWebhookSubscriptions, retentionPolicies, auditLog, jobMetricSamples, qboSyncSchedules, integrationSyncState, socialMediaPosts, crmContacts, crmOrganisations, crmOpportunities, crmOpportunityActivities, notifications, notificationChannelPrefs, organizationNetworkSettings, users, projects, projectProfitabilitySnapshots, uploadIntents, crmAutomations, crmAutomationRuns, userSettings, BIRTHDAY_DIGEST_DEFAULT_WEEKDAY, BIRTHDAY_DIGEST_DEFAULT_HOUR, certifiedPayrollReports, organizationPayrollSettings, payRuns, swpppInspections, organizations, SWPPP_OVERDUE_REMINDER_DEFAULT_CAP, SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS, DOC_OVERDUE_REMINDER_DEFAULT_CAP, DOC_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS, PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_CADENCE, PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_WEEKDAY, PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_HOUR, PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_TIMEZONE, rfis, submittals, submittalReviews, messages, timeEntries, media, aiActionAudit, planDocuments, conversations, projectEmailDistributionLists, projectLogEmailSchedules, projectLogEmailScheduleAttempts, type InsertNotification, type UserRole } from "@shared/schema";
import { getEffectivePermissions } from "../auth";
import { eq, and, lt, lte, gt, gte, sql, or, isNotNull, inArray, desc, isNull, ne } from "drizzle-orm";
import { getProvider } from "../integrations/registry";
import { importChartOfAccounts, exportCustomers, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "../integrations/providers/qbo";
import { publishToPlatform, fetchEngagement } from "../social/publishService";
import { socialAccounts } from "@shared/schema";
import { calculateAllProjectsProfitability } from "../ai/profitabilityEngine";
import { captureWeeklyKpiSnapshots } from "../services/portfolioKpiSnapshotService";
import { bids } from "@shared/schema";
import { eventBus } from "../events";
import { emailAccounts, emailCampaigns, emailCampaignContacts } from "@shared/schema";
import { syncImapAccount, syncOutlookAccount, syncGmailAccount, drainAccountProviderPushes } from "../emailRoutes";
import { processArchivedCertifiedPayrollPurge } from "./certifiedPayrollPurge";
import { pruneProjectLogEmailScheduleAttempts } from "./projectLogEmailScheduleAttemptPrune";
import { purgePlanDocumentMarkupTrash } from "./planDocumentMarkupSoftDeletePurge";
import { processFailedWageDecisionRetries, processStaleWageDecisions } from "../integrations/providers/dol_davis_bacon/sync";
import { processDotPayItemsRefresh } from "./dotPayItemsRefresh";
import { processMissingWageDecisionReminders } from "../services/davisBaconAdminNotifications";
import { processIntegrationSyncRetries, recordSyncFailure, recordSyncSuccess } from "../integrations/syncRetry";
import { pruneSuppressionResets } from "../integrations/audit";
import { qboSyncEntityType } from "../integrations/providers/qbo/sync";
import { processSagePeriodicSync } from "../integrations/providers/sage/sync";
import { ensureAllEmailPushSubscriptions } from "../emailPushNotifications";
import { sendEmail, sendEmailWithResult } from "../services/emailService";
import { buildProjectLogPdfBuffer } from "../services/projectLogService";
import { processDueExecutions } from "../services/sequenceService";
import { geocodePendingProjects } from "../utils/geocodingService";
import { isValidTimezone } from "@shared/timezones";

let outboxTask: ReturnType<typeof cron.schedule> | null = null;
let retentionTask: ReturnType<typeof cron.schedule> | null = null;
let syncScheduleTask: ReturnType<typeof cron.schedule> | null = null;
let socialPostTask: ReturnType<typeof cron.schedule> | null = null;
let tokenExpiryTask: ReturnType<typeof cron.schedule> | null = null;
let complianceCheckTask: ReturnType<typeof cron.schedule> | null = null;
let profitabilityMonitorTask: ReturnType<typeof cron.schedule> | null = null;
let idleOpportunityTask: ReturnType<typeof cron.schedule> | null = null;
let orphanUploadTask: ReturnType<typeof cron.schedule> | null = null;
let bidDueDateTask: ReturnType<typeof cron.schedule> | null = null;
let imapSyncTask: ReturnType<typeof cron.schedule> | null = null;
let providerSyncTask: ReturnType<typeof cron.schedule> | null = null;
let providerPushDrainTask: ReturnType<typeof cron.schedule> | null = null;
let emailPushRenewalTask: ReturnType<typeof cron.schedule> | null = null;
let weeklyReportTask: ReturnType<typeof cron.schedule> | null = null;
let monthlyReportTask: ReturnType<typeof cron.schedule> | null = null;
let dbHealthCheckTask: ReturnType<typeof cron.schedule> | null = null;
let socialEngagementTask: ReturnType<typeof cron.schedule> | null = null;
let scheduledCampaignTask: ReturnType<typeof cron.schedule> | null = null;
let sequenceCadenceTask: ReturnType<typeof cron.schedule> | null = null;
let projectGeocodeTask: ReturnType<typeof cron.schedule> | null = null;
let crmSlaBreachTask: ReturnType<typeof cron.schedule> | null = null;
let crmIdleAutomationTask: ReturnType<typeof cron.schedule> | null = null;
let crmBirthdayDigestTask: ReturnType<typeof cron.schedule> | null = null;
let crmBirthdayDailyTask: ReturnType<typeof cron.schedule> | null = null;
let jobMetricsPruneTask: ReturnType<typeof cron.schedule> | null = null;
let jobMetricAlertsTask: ReturnType<typeof cron.schedule> | null = null;
let jobMetricQuietDigestTask: ReturnType<typeof cron.schedule> | null = null;
// Task #1957 — per-minute pg pool health sampler. Polls
// `getPoolStats()` and publishes `pool_health` job metrics so the
// existing alert engine can page Super Admins when `waiting` stays > 0
// for several consecutive samples (the `waitingSaturated` counter) or
// when `pool_exhausted` events spike (already published on each
// `recordPoolExhaustedEvent` call). See `server/utils/poolHealth.ts`.
let poolHealthSampleTask: ReturnType<typeof cron.schedule> | null = null;
let portfolioKpiSnapshotTask: ReturnType<typeof cron.schedule> | null = null;
let certifiedPayrollDigestTask: ReturnType<typeof cron.schedule> | null = null;
// Task #1606: hourly sweep of `project_log_email_schedules`. Each row is
// gated by its own cadence/weekday/hour/timezone — see
// `processProjectLogEmailSchedules`.
let projectLogEmailScheduleTask: ReturnType<typeof cron.schedule> | null = null;
let swpppOverdueTask: ReturnType<typeof cron.schedule> | null = null;
// Task #1599: nightly RFI / submittal-review overdue escalation sweeps.
let rfiOverdueTask: ReturnType<typeof cron.schedule> | null = null;
let submittalReviewOverdueTask: ReturnType<typeof cron.schedule> | null = null;
let certifiedPayrollPurgeTask: ReturnType<typeof cron.schedule> | null = null;
let wageDecisionRetryTask: ReturnType<typeof cron.schedule> | null = null;
let wageDecisionMissingReminderTask: ReturnType<typeof cron.schedule> | null = null;
let wageDecisionStaleRefreshTask: ReturnType<typeof cron.schedule> | null = null;
let suppressionResetPruneTask: ReturnType<typeof cron.schedule> | null = null;
// Task #1665: nightly retention sweep for the per-attempt history of
// `project_log_email_schedules`. Runs in batches so it can't lock the
// table on large tenants. See `projectLogEmailScheduleAttemptPrune.ts`.
let projectLogEmailAttemptPruneTask: ReturnType<typeof cron.schedule> | null = null;
// Task #1846: nightly hard-delete sweep for soft-deleted
// `plan_document_markups` rows whose `deleted_at` is older than the
// configured retention window (default 30 days). Keeps the table and
// indexes bounded while preserving the one-click undo window.
let planDocumentMarkupTrashPurgeTask: ReturnType<typeof cron.schedule> | null = null;
// Task #1948: quarterly automated refresh of every verbatim DOT
// pay-item catalog. The fetcher (`scripts/fetch-dot-pay-items.ts`) is
// idempotent and only overwrites a per-agency JSON when the parse
// passes its >=200-item / no-artifact guards; the job logs per-agency
// added/removed/changed deltas and emails the on-call rotation if any
// catalog regresses below its `AGENCY_MIN_ITEMS` threshold.
let dotPayItemsRefreshTask: ReturnType<typeof cron.schedule> | null = null;
// Task #1715: daily digest to org ADMIN/SUPER_ADMIN users summarising
// every schedule whose latest attempt was FAILURE / NO_RECIPIENTS so
// admins get a proactive nudge instead of having to remember to open
// the failures dashboard. See `processProjectLogEmailFailuresDigest`.
let projectLogEmailFailuresDigestTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Task #1491 — Publish a per-tick succeeded/failed sample for a cron
 * job so the alert engine in `jobMetricAlerts.ts` can evaluate the
 * tuned stall thresholds in PER_JOB_DEFAULTS. The job name MUST match
 * the snake_case key already present in PER_JOB_DEFAULTS.
 */
function recordJobOutcome(job: string, ok: boolean): void {
  recordJobMetrics(job, { succeeded: ok ? 1 : 0, failed: ok ? 0 : 1 });
}

/**
 * Task #1959 — Publish a `skipped` sample when an overlap guard
 * (Tasks #1949 / #1951) prevents a fresh tick from running because the
 * previous one is still in flight. Without this counter, chronic
 * skipping is invisible on the Job Metrics dashboard — admins can't
 * tell whether a job is *occasionally* slow (one missed tick) or is
 * *chronically* over-budget (and needs to be sharded, batched, or moved
 * to a queue).
 *
 * The counter shape mirrors `recordJobOutcome` (single integer per
 * tick) so the alert engine's default absolute-floor spike rule on
 * `skipped` (see `jobMetricAlerts.ts`) can fire when the per-hour
 * skipped-rate exceeds the configured threshold.
 */
function recordJobSkipped(job: string): void {
  recordJobMetrics(job, { skipped: 1 });
}

// Task #1949 — overlap guards for the chatty 2-minute cron jobs that
// were previously stacking up under load and starving the shared
// Postgres pool. Each guard is a simple in-process boolean: if the
// previous tick is still running when the next one fires, the new
// tick logs and returns instead of piling on. node-cron is
// single-process so a module-level flag is sufficient.
//
// Task #1951 — extended the same pattern to the other long-running
// jobs whose runtime can plausibly exceed their cron interval: the
// CRM sequence cadence runner, the integration sync sweeps (QBO
// schedules + Davis-Bacon/QBO retry), the per-tenant CRM SLA /
// idle-automation sweeps, the project profitability monitor, the
// social engagement poller, and the three hourly email-digest
// fan-outs (project-log schedules, project-log failures, certified
// payroll, CRM contact birthdays).
//
// Jobs intentionally NOT guarded here:
//   - processImapEmailSync / processProviderEmailSync /
//     processProviderPushDrain — already carry their own internal
//     `*Running` single-flight lock with a stale-timeout reset, so a
//     redundant cron-level guard would double-skip.
//   - All daily / weekly / monthly cron jobs (retention,
//     token_expiry, compliance_check, idle_opportunities, swppp /
//     rfi / submittal overdue sweeps, certified_payroll_purge,
//     wage_decision_missing_reminder, wage_decision_stale_refresh,
//     suppression_reset_prune, project_log_email_attempt_prune,
//     plan_document_markup_trash_purge, project_geocode,
//     weekly_report, monthly_report, crm_birthday_daily,
//     portfolio_kpi_snapshot) — they fire once per day at a fixed
//     minute, so a fresh tick can't physically arrive while the
//     previous one is still running.
//   - jobMetricsPrune / jobMetricAlerts / jobMetricQuietDigest —
//     in-memory analysis backed by single-statement DB ops, well
//     under the 15-minute interval.
//   - bidDueDate / orphanUploads / emailPushRenewal / dbHealthCheck
//     — bounded single-statement scans that complete in seconds.
let outboxTickRunning = false;
let socialPostTickRunning = false;
let scheduledCampaignTickRunning = false;
let sequenceCadenceTickRunning = false;
let syncScheduleTickRunning = false;
let integrationSyncRetryTickRunning = false;
let crmSlaBreachTickRunning = false;
let crmIdleAutomationTickRunning = false;
let crmBirthdayDigestTickRunning = false;
let profitabilityMonitorTickRunning = false;
let socialEngagementTickRunning = false;
let projectLogEmailScheduleTickRunning = false;
let projectLogEmailFailuresDigestTickRunning = false;
let certifiedPayrollDigestTickRunning = false;

/**
 * Task #1949 — Distinguish "Postgres pool exhausted / connection
 * timeout" from ordinary query / business-logic errors when logging
 * background-job failures. The two have very different remediations
 * (scale the pool / fix a leak vs. fix the query), but they were
 * previously both logged as a generic `... processing failed` line
 * with `error: String(err)` so production logs couldn't be
 * triaged at a glance.
 *
 * Task #1950 — Also push `pool_exhausted` events into a small
 * in-process ring buffer (`server/utils/poolHealth.ts`) so the
 * admin Job Metrics dashboard can surface the last 50 starvation
 * events without grepping production logs.
 */
function logJobErrorWithKind(job: string, message: string, err: unknown): void {
  const text = err instanceof Error ? err.message : String(err);
  const isConnTimeout = /connection terminated due to connection timeout|timeout exceeded when trying to connect|Connection terminated unexpectedly/i.test(text);
  const kind = isConnTimeout ? "pool_exhausted" : "query_failed";
  logError(message, { error: text, kind, job });
  if (kind === "pool_exhausted") {
    // Lazy import keeps the existing module-load order intact (jobRunner
    // is imported very early; poolHealth pulls in `db.ts`).
    import("../utils/poolHealth")
      .then((mod) => mod.recordPoolExhaustedEvent({ job, message, error: text }))
      .catch(() => {
        // Buffering is best-effort observability — never let it break a
        // job tick.
      });
  }
}

export function startJobRunner() {
  logInfo("Starting background job runner");

  // Task #705: hydrate the in-memory job metrics window from the
  // persisted samples table so trend data survives restarts/deploys.
  // Fire-and-forget — the rest of the runner must not block on it.
  loadJobMetricsFromDb()
    .then((count) => {
      if (count > 0) logInfo("Hydrated job metrics from DB", { samples: count });
    })
    .catch((err) => logError("Job metrics hydration failed", { error: String(err) }));

  // Task #705: trim stale rows hourly so the persistence table stays
  // bounded by the retention window (24h) regardless of job volume.
  jobMetricsPruneTask = cron.schedule("0 * * * *", async () => {
    try {
      const deleted = await pruneJobMetricsDb();
      if (deleted > 0) logInfo("Pruned old job metric samples", { deleted });
    } catch (err) {
      logError("Job metric DB prune failed", { error: String(err) });
    }
  });

  // Task #718: every 15 minutes, scan the rolling 24h job-metric window
  // for spikes vs the trailing baseline and for jobs that have gone
  // silent. Fires in-app notifications to every Super Admin and records
  // a row in `job_metric_alert_events` for the dashboard.
  jobMetricAlertsTask = cron.schedule("*/15 * * * *", async () => {
    try {
      const result = await evaluateJobMetricAlerts();
      if (result.alertsFired.length > 0) {
        logInfo("Job metric alerts fired", {
          fired: result.alertsFired.length,
          suppressed: result.alertsSuppressed,
        });
      }
    } catch (err) {
      logError("Job metric alert evaluation failed", { error: String(err) });
    }
  });

  // Task #754: every 15 minutes, send the quiet-hours digest to any
  // Super Admin who has just exited their quiet-hours window. The
  // function itself is idempotent and skips users still inside their
  // window or with no events to summarize.
  jobMetricQuietDigestTask = cron.schedule("*/15 * * * *", async () => {
    try {
      const result = await sendJobMetricAlertQuietHoursDigests({ recordSends: true });
      if (result.digestsSent > 0) {
        logInfo("Job metric quiet-hours digest sent", {
          digestsSent: result.digestsSent,
          recipientsConsidered: result.recipientsConsidered,
        });
      }
    } catch (err) {
      logError("Job metric quiet-hours digest failed", { error: String(err) });
    }
  });

  // Task #1957 — every minute, sample the live pg pool counters and
  // publish them as `pool_health` job-metric samples so the alert engine
  // can fire on the `waitingSaturated` and `exhausted` counters defined
  // in `PER_JOB_DEFAULTS["pool_health"]`. The sampler is intentionally
  // dynamic-imported to keep the existing module-load order intact
  // (poolHealth pulls in `db.ts`, which transitively imports a number
  // of schema modules; the existing `recordPoolExhaustedEvent`
  // integration already uses the same lazy pattern in
  // `logJobErrorWithKind` above).
  poolHealthSampleTask = cron.schedule("* * * * *", async () => {
    try {
      const mod = await import("../utils/poolHealth");
      mod.samplePoolHealth();
    } catch (err) {
      logError("Pool health sample failed", { error: String(err) });
    }
  });

  outboxTask = cron.schedule("*/2 * * * *", async () => {
    // Task #1949 — overlap guard. The cron fires every 2 minutes, but
    // a single tick that delivers webhooks can take longer than that
    // when a target is slow. Without this guard, slow ticks pile up
    // and exhaust the shared Postgres pool ("Connection terminated
    // due to connection timeout") which then starves user-facing
    // requests like POST /api/website/republish.
    if (outboxTickRunning) {
      logWarn("Outbox processing skipped: previous tick still running");
      recordJobSkipped("outbox");
      return;
    }
    outboxTickRunning = true;
    try {
      await processOutbox();
    } catch (err) {
      logJobErrorWithKind("outbox", "Outbox processing failed", err);
    } finally {
      outboxTickRunning = false;
    }
  });

  retentionTask = cron.schedule("0 2 * * *", async () => {
    try {
      await processRetentionPolicies();
      recordJobOutcome("retention_policy_sweep", true);
    } catch (err) {
      recordJobOutcome("retention_policy_sweep", false);
      logError("Retention processing failed", { error: String(err) });
    }
  });

  syncScheduleTask = cron.schedule("*/15 * * * *", async () => {
    // Task #1951 — overlap guard. Each tick walks every active QBO /
    // integration sync schedule and may issue export/import calls per
    // tenant; on busy systems a single tick can outlast the 15-minute
    // interval, and stacking ticks would multiply Postgres pool
    // pressure on the same scheduled rows.
    if (syncScheduleTickRunning) {
      logWarn("Sync schedule processing skipped: previous tick still running");
      recordJobSkipped("sync_schedules");
      return;
    }
    syncScheduleTickRunning = true;
    try {
      await processSyncSchedules();
    } catch (err) {
      logJobErrorWithKind("sync_schedules", "Sync schedule processing failed", err);
    } finally {
      syncScheduleTickRunning = false;
    }
  });

  socialPostTask = cron.schedule("*/2 * * * *", async () => {
    // Task #1949 — same overlap guard as outbox/scheduled campaigns;
    // a slow social-platform API call must not pile up onto the next
    // tick and starve the connection pool.
    if (socialPostTickRunning) {
      logWarn("Social post processing skipped: previous tick still running");
      recordJobSkipped("social_posts");
      return;
    }
    socialPostTickRunning = true;
    try {
      await processScheduledSocialPosts();
    } catch (err) {
      logJobErrorWithKind("social_posts", "Social post processing failed", err);
    } finally {
      socialPostTickRunning = false;
    }
  });

  tokenExpiryTask = cron.schedule("0 3 * * *", async () => {
    try {
      await checkSocialTokenExpiry();
      recordJobOutcome("social_token_expiry_check", true);
    } catch (err) {
      recordJobOutcome("social_token_expiry_check", false);
      logError("Token expiry check failed", { error: String(err) });
    }
  });

  complianceCheckTask = cron.schedule("0 7 * * *", async () => {
    try {
      await processComplianceExpirations();
      recordJobOutcome("compliance_expiration_check", true);
    } catch (err) {
      recordJobOutcome("compliance_expiration_check", false);
      logError("Compliance expiration check failed", { error: String(err) });
    }
  });

  profitabilityMonitorTask = cron.schedule("*/15 * * * *", async () => {
    // Task #1951 — overlap guard. The profitability sweep loops every
    // active project per org and recomputes margin / earned-value
    // metrics, holding short Postgres connections per project. Under
    // load a single tick can outlast 15 minutes and stack on the next
    // tick, doubling pool pressure on the same project rows.
    if (profitabilityMonitorTickRunning) {
      logWarn("Profitability monitor skipped: previous tick still running");
      recordJobSkipped("profitability");
      return;
    }
    profitabilityMonitorTickRunning = true;
    try {
      await processProfitabilityMonitor();
    } catch (err) {
      logJobErrorWithKind("profitability", "Profitability monitor failed", err);
    } finally {
      profitabilityMonitorTickRunning = false;
    }
  });

  // Task #902: nightly capture of per-project KPI snapshots (health, SPI,
  // CPI, burn) so the portfolio dashboard sparklines and 12-week deltas
  // reflect real direction-of-travel instead of created-RFI counts.
  portfolioKpiSnapshotTask = cron.schedule("15 2 * * *", async () => {
    try {
      await captureWeeklyKpiSnapshots();
      recordJobOutcome("portfolio_kpi_snapshot", true);
    } catch (err) {
      recordJobOutcome("portfolio_kpi_snapshot", false);
      logError("Portfolio KPI snapshot capture failed", { error: String(err) });
    }
  });

  idleOpportunityTask = cron.schedule("0 8 * * *", async () => {
    try {
      await processIdleOpportunities();
      recordJobOutcome("idle_opportunity_check", true);
    } catch (err) {
      recordJobOutcome("idle_opportunity_check", false);
      logError("Idle opportunity check failed", { error: String(err) });
    }
  });

  orphanUploadTask = cron.schedule("*/30 * * * *", async () => {
    try {
      await processOrphanUploads();
    } catch (err) {
      logError("Orphan upload cleanup failed", { error: String(err) });
    }
  });

  bidDueDateTask = cron.schedule("0 * * * *", async () => {
    try {
      await processBidDueDateApproaching();
    } catch (err) {
      logError("Bid due date check failed", { error: String(err) });
    }
  });

  imapSyncTask = cron.schedule("*/15 * * * *", async () => {
    try {
      await processImapEmailSync();
    } catch (err) {
      logError("IMAP email sync failed", { error: String(err) });
    }
  });

  // Task #522/#524: Gmail/Outlook 2-way incremental sync.
  // With push notifications wired up (Task #524), pushes deliver mailbox
  // changes near-instantly; this poll runs every 5 minutes as a safety net
  // for missed events and accounts where push isn't configured.
  providerSyncTask = cron.schedule("*/5 * * * *", async () => {
    try {
      await processProviderEmailSync();
    } catch (err) {
      logError("Provider email sync failed", { error: String(err) });
    }
  });

  // Task #546: dedicated retry loop for queued read/archive push-backs to
  // Gmail/Outlook. `processProviderEmailSync` already drains pushes inline,
  // but it runs on a 5-minute cadence behind a single-flight lock, can be
  // skipped while a long pull is in flight, and a thrown sync error bypasses
  // the rest of an account's drain. This dedicated job runs every 2 minutes
  // and only walks pendingProviderPush rows, so failed PATCHes get retried
  // promptly even when the safety-net poller is busy.
  providerPushDrainTask = cron.schedule("*/2 * * * *", async () => {
    try {
      await processProviderPushDrain();
    } catch (err) {
      logError("Provider push-back drain failed", { error: String(err) });
    }
  });

  // Task #524: keep Gmail watches and Outlook subscriptions alive. Gmail
  // watches expire after up to 7 days; Outlook subscriptions after ~70
  // hours. Renewing every 15 minutes leaves comfortable headroom.
  emailPushRenewalTask = cron.schedule("*/15 * * * *", async () => {
    try {
      await ensureAllEmailPushSubscriptions();
    } catch (err) {
      logError("Email push subscription renewal failed", { error: String(err) });
    }
  });

  // Run once shortly after startup so newly deployed instances catch up
  // without waiting for the first cron tick.
  setTimeout(() => {
    ensureAllEmailPushSubscriptions().catch((err) =>
      logError("Initial email push subscription sweep failed", { error: String(err) }),
    );
  }, 30_000).unref?.();

  weeklyReportTask = cron.schedule("0 7 * * 1", async () => {
    try {
      await processPeriodicReports("WEEKLY");
      recordJobOutcome("periodic_report_weekly", true);
    } catch (err) {
      recordJobOutcome("periodic_report_weekly", false);
      logError("Weekly report generation failed", { error: String(err) });
    }
  });

  monthlyReportTask = cron.schedule("0 7 1 * *", async () => {
    try {
      await processPeriodicReports("MONTHLY");
      recordJobOutcome("periodic_report_monthly", true);
    } catch (err) {
      recordJobOutcome("periodic_report_monthly", false);
      logError("Monthly report generation failed", { error: String(err) });
    }
  });

  dbHealthCheckTask = cron.schedule("0 */6 * * *", async () => {
    try {
      await runDbHealthCheck();
      recordJobOutcome("db_health_check", true);
    } catch (err) {
      recordJobOutcome("db_health_check", false);
      logError("DB health check failed", { error: String(err) });
    }
  });

  socialEngagementTask = cron.schedule("0 */4 * * *", async () => {
    // Task #1951 — overlap guard. The engagement sweep hits every
    // social platform's analytics API per linked account; rate-limited
    // backoffs and slow upstreams mean a tick can plausibly outlast
    // its 4-hour cadence on tenants with many connected pages.
    if (socialEngagementTickRunning) {
      logWarn("Social engagement sync skipped: previous tick still running");
      recordJobSkipped("social_engagement");
      return;
    }
    socialEngagementTickRunning = true;
    try {
      await processSocialEngagement();
    } catch (err) {
      logJobErrorWithKind("social_engagement", "Social engagement sync failed", err);
    } finally {
      socialEngagementTickRunning = false;
    }
  });

  scheduledCampaignTask = cron.schedule("*/2 * * * *", async () => {
    // Task #1949 — overlap guard. Each campaign tick can fan out
    // hundreds of `sendEmail` calls; if a tick takes longer than 2
    // minutes we must NOT start a second one in parallel because
    // each invocation holds Postgres connections per contact update.
    if (scheduledCampaignTickRunning) {
      logWarn("Scheduled campaign processing skipped: previous tick still running");
      recordJobSkipped("scheduled_campaigns");
      return;
    }
    scheduledCampaignTickRunning = true;
    try {
      await processScheduledCampaigns();
    } catch (err) {
      logJobErrorWithKind("scheduled_campaigns", "Scheduled campaign processing failed", err);
    } finally {
      scheduledCampaignTickRunning = false;
    }
  });

  sequenceCadenceTask = cron.schedule("*/2 * * * *", async () => {
    // Task #1951 — overlap guard. The sequence runner walks every due
    // CRM enrolment and fans out emails / waits via the same Postgres
    // pool that user requests use. Without this guard a slow tick
    // (e.g. SMTP timeout) would let the next 2-minute tick pile on
    // and starve the pool.
    if (sequenceCadenceTickRunning) {
      logWarn("Sequence cadence runner skipped: previous tick still running");
      recordJobSkipped("sequence_cadences");
      return;
    }
    sequenceCadenceTickRunning = true;
    try {
      await processDueExecutions();
    } catch (err) {
      logJobErrorWithKind("sequence_cadences", "Sequence cadence runner failed", err);
    } finally {
      sequenceCadenceTickRunning = false;
    }
  });

  // Task #581: nightly geocode projects with addresses but no coordinates
  // so they appear on the Projects map view automatically.
  projectGeocodeTask = cron.schedule("30 4 * * *", async () => {
    try {
      await geocodePendingProjects();
      recordJobOutcome("project_geocode", true);
    } catch (err) {
      recordJobOutcome("project_geocode", false);
      logError("Project geocoding job failed", { error: String(err) });
    }
  });

  // Task #648: detect SLA breaches across all orgs every 5 minutes so the
  // "needs attention" deal queue stays current without an admin manually
  // hitting POST /api/crm/sla/run-check.
  crmSlaBreachTask = cron.schedule("*/5 * * * *", async () => {
    // Task #1951 — overlap guard. The breach sweep walks every org's
    // active deal pipeline; on tenants with thousands of in-flight
    // opportunities a tick can outlast 5 minutes and stack onto the
    // next one, multiplying notification fan-out and pool pressure.
    if (crmSlaBreachTickRunning) {
      logWarn("CRM SLA breach sweep skipped: previous tick still running");
      recordJobSkipped("crm_sla_breaches");
      return;
    }
    crmSlaBreachTickRunning = true;
    try {
      await processCrmSlaBreaches();
    } catch (err) {
      logJobErrorWithKind("crm_sla_breaches", "CRM SLA breach sweep failed", err);
    } finally {
      crmSlaBreachTickRunning = false;
    }
  });

  // Task #648: tick the CRM automation engine for IDLE_DAYS triggers every
  // 10 minutes so idle-day automations actually fire on their own.
  crmIdleAutomationTask = cron.schedule("*/10 * * * *", async () => {
    // Task #1951 — overlap guard. The idle-automation tick evaluates
    // every active automation rule per org and writes
    // crm_automation_runs rows; a slow tick (e.g. SMTP send-step) can
    // exceed the 10-minute interval, so guard against pile-up.
    if (crmIdleAutomationTickRunning) {
      logWarn("CRM idle automation tick skipped: previous tick still running");
      recordJobSkipped("crm_idle_automations");
      return;
    }
    crmIdleAutomationTickRunning = true;
    try {
      await processCrmIdleAutomations();
    } catch (err) {
      logJobErrorWithKind("crm_idle_automations", "CRM idle automation tick failed", err);
    } finally {
      crmIdleAutomationTickRunning = false;
    }
  });

  // Task #682/#692: digest of upcoming CRM contact birthdays. Runs hourly
  // and gates per-recipient on Monday 8am in each user's local timezone so
  // the notification lands during business hours regardless of where the
  // user is, not at the server's wall-clock time.
  crmBirthdayDigestTask = cron.schedule("0 * * * *", async () => {
    // Task #1951 — overlap guard. The hourly digest fans out
    // notifications across every org and recipient timezone; if a
    // slow notification path (email + push) lets a tick stretch past
    // the next hour boundary, the next tick must skip rather than
    // double-deliver birthday reminders.
    if (crmBirthdayDigestTickRunning) {
      logWarn("CRM contact birthday digest skipped: previous tick still running");
      recordJobSkipped("crm_birthday_digest");
      return;
    }
    crmBirthdayDigestTickRunning = true;
    try {
      await processCrmContactBirthdayDigest();
    } catch (err) {
      logJobErrorWithKind("crm_birthday_digest", "CRM contact birthday digest failed", err);
    } finally {
      crmBirthdayDigestTickRunning = false;
    }
  });

  // Task #1116/#1181: digest of certified payroll PDFs to each org's payroll
  // administrators. Runs hourly; per-org cadence/weekday/hour/timezone are
  // honored inside `processCertifiedPayrollWeeklyDigest` so admins can pick
  // their own send time, day, and daily/weekly/biweekly cadence.
  certifiedPayrollDigestTask = cron.schedule("0 * * * *", async () => {
    // Task #1951 — overlap guard. The hourly digest builds and emails
    // certified payroll PDFs per org; PDF generation + SMTP can take
    // many minutes per tenant, so a backed-up tick must not stack on
    // the next hour boundary and double-send.
    if (certifiedPayrollDigestTickRunning) {
      logWarn("Certified payroll weekly digest skipped: previous tick still running");
      recordJobSkipped("certified_payroll_digest");
      return;
    }
    certifiedPayrollDigestTickRunning = true;
    try {
      await processCertifiedPayrollWeeklyDigest();
    } catch (err) {
      logJobErrorWithKind("certified_payroll_digest", "Certified payroll weekly digest failed", err);
    } finally {
      certifiedPayrollDigestTickRunning = false;
    }
  });

  // Task #1606: hourly sweep of `project_log_email_schedules`. Each row
  // is gated by its own cadence/weekday/hour/timezone inside the
  // handler, so the cron itself stays a simple "tick every hour" — the
  // worker decides which projects (if any) get emailed this hour.
  projectLogEmailScheduleTask = cron.schedule("0 * * * *", async () => {
    // Task #1951 — overlap guard. The hourly sweep builds RFI /
    // submittal PDFs and emails them to per-project distribution
    // lists; PDF rendering + SMTP fan-out can outlast an hour on
    // large tenants, and a stacked tick would re-send the same
    // schedules.
    if (projectLogEmailScheduleTickRunning) {
      logWarn("Project log email schedule sweep skipped: previous tick still running");
      recordJobSkipped("project_log_email_schedules");
      return;
    }
    projectLogEmailScheduleTickRunning = true;
    try {
      await processProjectLogEmailSchedules();
      recordJobOutcome("project_log_email_schedules", true);
    } catch (err) {
      recordJobOutcome("project_log_email_schedules", false);
      logJobErrorWithKind("project_log_email_schedules", "Project log email schedule sweep failed", err);
    } finally {
      projectLogEmailScheduleTickRunning = false;
    }
  });

  // Task #1715: digest to org ADMIN / SUPER_ADMIN users summarising
  // every schedule whose latest attempt was FAILURE / NO_RECIPIENTS —
  // same conditions as the rows on /admin/log-email-failures. Catches
  // broken distribution lists proactively so admins don't have to
  // remember to open the dashboard.
  //
  // Task #1732: cron now ticks hourly. Each org has its own
  // cadence/hour/weekday/timezone (columns on `organizations`,
  // defaults DAILY @ 08:00 UTC) and the per-org gate inside the
  // handler picks which orgs (if any) actually fan out on each tick.
  // The dedupe sentinel inside the handler ensures a re-run within
  // the same local day (manual fire, boot during the firing minute)
  // doesn't re-send.
  projectLogEmailFailuresDigestTask = cron.schedule("0 * * * *", async () => {
    // Task #1951 — overlap guard. Same family as the hourly schedule
    // sweep above: the failures digest fans an email to every org's
    // ADMIN / SUPER_ADMIN users, gated by per-org cadence + dedupe.
    // A stacked tick would race the dedupe sentinel and risk
    // duplicate digests during the firing minute.
    if (projectLogEmailFailuresDigestTickRunning) {
      logWarn("Project log email failures digest skipped: previous tick still running");
      recordJobSkipped("project_log_email_failures_digest");
      return;
    }
    projectLogEmailFailuresDigestTickRunning = true;
    try {
      await processProjectLogEmailFailuresDigest();
      recordJobOutcome("project_log_email_failures_digest", true);
    } catch (err) {
      recordJobOutcome("project_log_email_failures_digest", false);
      logJobErrorWithKind("project_log_email_failures_digest", "Project log email failures digest sweep failed", err);
    } finally {
      projectLogEmailFailuresDigestTickRunning = false;
    }
  });

  // Task #1173: nightly sweep that finds OPEN SWPPP inspections whose
  // corrective action due date has passed and notifies the assigned
  // assignee + the project manager once per overdue cycle. Runs at 7am
  // alongside the existing compliance/expiration checks.
  swpppOverdueTask = cron.schedule("0 7 * * *", async () => {
    try {
      await processSwpppOverdueCorrectiveActions();
      recordJobOutcome("swppp_overdue_corrective_actions", true);
    } catch (err) {
      recordJobOutcome("swppp_overdue_corrective_actions", false);
      logError("SWPPP overdue corrective action sweep failed", { error: String(err) });
    }
  });

  // Task #1599: nightly sweep that finds open RFIs whose `dateRequired`
  // has passed and notifies the assignee + project manager. Same 7am
  // cadence as the SWPPP sweep and uses the same per-row dedupe marker
  // + counter pattern so each overdue cycle generates one initial
  // fanout plus N follow-up reminders (per-org cap).
  rfiOverdueTask = cron.schedule("0 7 * * *", async () => {
    try {
      await processRfiOverdueNotifications();
      recordJobOutcome("rfi_overdue_notifications", true);
    } catch (err) {
      recordJobOutcome("rfi_overdue_notifications", false);
      logError("RFI overdue notification sweep failed", { error: String(err) });
    }
  });

  // Task #1599: companion sweep for submittal_reviews. The PENDING /
  // IN_REVIEW review whose parent submittal is past its date_required
  // is what we treat as overdue; the assigned reviewer + project
  // manager get the fanout.
  submittalReviewOverdueTask = cron.schedule("0 7 * * *", async () => {
    try {
      await processSubmittalReviewOverdueNotifications();
      recordJobOutcome("submittal_overdue_notifications", true);
    } catch (err) {
      recordJobOutcome("submittal_overdue_notifications", false);
      logError("Submittal review overdue notification sweep failed", { error: String(err) });
    }
  });

  // Task #1178: nightly cleanup at 03:30 UTC — hard-deletes archived
  // certified payroll PDFs (and their object-storage blobs) older than
  // each org's configured retention window. Runs after the 02:00 retention
  // job and well before business hours so the daily storage cost reclaim
  // shows up in tomorrow's metrics.
  certifiedPayrollPurgeTask = cron.schedule("30 3 * * *", async () => {
    try {
      const result = await processArchivedCertifiedPayrollPurge();
      if (result.rowsPurged > 0) {
        logInfo("Archived certified payroll auto-purge run", result);
      }
      recordJobOutcome("certified_payroll_purge", true);
    } catch (err) {
      recordJobOutcome("certified_payroll_purge", false);
      logError("Archived certified payroll auto-purge failed", { error: String(err) });
    }
  });

  // Task #693: daily morning email reminder routed to each contact's owner
  // (createdById) so account managers see today's birthdays without having to
  // open the CRM. Per-user opt-in/opt-out is handled by the existing
  // notificationTypePrefs (email channel for REMINDER notifications).
  crmBirthdayDailyTask = cron.schedule("0 7 * * *", async () => {
    try {
      await processCrmContactBirthdayDailyDigest();
      recordJobOutcome("crm_birthday_daily_digest", true);
    } catch (err) {
      recordJobOutcome("crm_birthday_daily_digest", false);
      logError("CRM contact birthday daily digest failed", { error: String(err) });
    }
  });

  // Task #1354 + #1368: every 5 minutes, re-attempt every failed
  // integration sync (Davis-Bacon wage decisions, QBO scheduled exports,
  // and any other provider that opts into the generic retry helper)
  // whose backoff window is due. Successful retries clear the failure
  // state so banners/notifications resolve naturally; exhausted rows are
  // left alone for manual intervention.
  wageDecisionRetryTask = cron.schedule("*/5 * * * *", async () => {
    // Task #1951 — overlap guard. The retry sweep walks every failed
    // integration sync row whose backoff is due (Davis-Bacon, QBO,
    // Sage, etc.) and replays the underlying provider call; a slow
    // upstream can plausibly outlast 5 minutes and stack onto the
    // next tick, doubling provider load and pool pressure.
    if (integrationSyncRetryTickRunning) {
      logWarn("Integration sync retry sweep skipped: previous tick still running");
      recordJobSkipped("integration_sync_retry");
      return;
    }
    integrationSyncRetryTickRunning = true;
    try {
      const out = await processIntegrationSyncRetries();
      if (out.attempted > 0) {
        logInfo("Integration sync retry sweep", out);
      }
    } catch (err) {
      logJobErrorWithKind("integration_sync_retry", "Integration sync retry sweep failed", err);
    } finally {
      integrationSyncRetryTickRunning = false;
    }
  });

  // Task #1380: once a day, re-sync every cached Davis-Bacon wage
  // determination whose lastSyncAt has crossed the configured staleness
  // threshold (DOL_DAVIS_BACON_STALE_AFTER_DAYS, default 30 days). Picks
  // 06:00 UTC so the refresh lands well before the morning payroll run
  // window in US timezones. The sweep itself skips rows currently in
  // the failure-backoff lane, so it cannot hammer DOL when prior
  // attempts failed.
  wageDecisionStaleRefreshTask = cron.schedule("0 6 * * *", async () => {
    try {
      const out = await processStaleWageDecisions();
      if (out.candidates > 0) {
        logInfo("Davis-Bacon stale wage decision refresh sweep", out);
      }
    } catch (err) {
      logError("Davis-Bacon stale wage decision refresh failed", { error: String(err) });
    }
  });

  // Task #1512: nightly retention sweep for the
  // `integration_suppression_resets` table. The integrations panel only
  // ever reads the most recent N rows per org, so anything older than
  // INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS (default 90 days) is
  // dead weight that will eventually slow down inserts/queries on busy
  // orgs. Runs at 03:45 UTC alongside the other nightly cleanup jobs.
  suppressionResetPruneTask = cron.schedule("45 3 * * *", async () => {
    try {
      const deleted = await pruneSuppressionResets();
      if (deleted > 0) {
        logInfo("Suppression-reset retention sweep", { deleted });
      }
      recordJobOutcome("suppression_reset_prune", true);
    } catch (err) {
      recordJobOutcome("suppression_reset_prune", false);
      logError("Suppression-reset retention sweep failed", { error: String(err) });
    }
  });

  // Task #1665: nightly retention sweep for
  // `project_log_email_schedule_attempts`. Every cron tick + manual
  // send writes a row, but the project settings UI only ever surfaces
  // the most recent 10 (max 50) per schedule, so anything older than
  // PROJECT_LOG_EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS (90) is dead
  // weight. Batched inside the helper so a large tenant can't hold
  // long row-level locks. Runs at 04:00 UTC alongside the other
  // nightly cleanup jobs.
  projectLogEmailAttemptPruneTask = cron.schedule("0 4 * * *", async () => {
    try {
      const result = await pruneProjectLogEmailScheduleAttempts();
      if (result.deleted > 0 || result.cappedAtMaxBatches) {
        logInfo("Project log email attempt-history retention sweep", {
          deleted: result.deleted,
          batches: result.batches,
          cappedAtMaxBatches: result.cappedAtMaxBatches,
        });
      }
      recordJobOutcome("project_log_email_attempt_prune", true);
    } catch (err) {
      recordJobOutcome("project_log_email_attempt_prune", false);
      logError("Project log email attempt-history retention sweep failed", { error: String(err) });
    }
  });

  // Task #1846: nightly hard-delete sweep for soft-deleted
  // `plan_document_markups` rows whose `deleted_at` is older than the
  // configured retention window (default 30 days). Runs at 04:15 UTC,
  // just after the project-log attempt-history prune so the two
  // batched table sweeps don't overlap. Batched inside the helper so
  // a large tenant can't hold long row-level locks.
  planDocumentMarkupTrashPurgeTask = cron.schedule("15 4 * * *", async () => {
    try {
      const result = await purgePlanDocumentMarkupTrash();
      if (result.deleted > 0 || result.cappedAtMaxBatches) {
        logInfo("Plan document markup trash purge sweep", {
          deleted: result.deleted,
          batches: result.batches,
          cappedAtMaxBatches: result.cappedAtMaxBatches,
          durationMs: result.durationMs,
        });
      }
      recordJobOutcome("plan_document_markup_trash_purge", true);
    } catch (err) {
      recordJobOutcome("plan_document_markup_trash_purge", false);
      logError("Plan document markup trash purge sweep failed", { error: String(err) });
    }
  });

  // Task #1948: quarterly refresh of every verbatim DOT pay-item
  // catalog. Runs at 04:00 UTC on the 1st of Jan/Apr/Jul/Oct so it
  // lands well outside North-American business hours. The handler is
  // idempotent (the underlying fetcher refuses to overwrite a JSON
  // when the parse fails its guards) and emits a single per-agency
  // delta log line + an email to the on-call rotation when a catalog
  // drops below its `AGENCY_MIN_ITEMS` threshold.
  dotPayItemsRefreshTask = cron.schedule("0 4 1 1,4,7,10 *", async () => {
    try {
      // Task #1962 — `processDotPayItemsRefresh` now records its own
      // per-tick `job_metric_samples` row (with both numeric counters
      // *and* per-agency / regression detail in the JSONB column) so the
      // Super Admin DOT pay-item refresh history page can render run
      // history. We no longer need to double-record numeric counters here.
      const out = await processDotPayItemsRefresh();
      logInfo("DOT pay-item quarterly refresh tick", {
        agenciesProcessed: out.agenciesProcessed,
        successes: out.successes,
        failures: out.failures,
        regressions: out.regressions,
        alertsSent: out.alertsSent,
      });
    } catch (err) {
      recordJobOutcome("dot_pay_items_refresh", false);
      logError("DOT pay-item quarterly refresh failed", { error: String(err) });
    }
  });

  // Task #1344: daily 08:00 UTC fan-out reminder to org admins about
  // projects whose Davis-Bacon wage decision has been missing for >24h.
  // The handler itself enforces a 1-per-project-per-week throttle so a
  // daily cadence is the right responsiveness without spamming admins.
  wageDecisionMissingReminderTask = cron.schedule("0 8 * * *", async () => {
    try {
      const out = await processMissingWageDecisionReminders();
      if (out.remindersSent > 0) {
        logInfo("Wage decision missing reminder sweep", out);
      }
      recordJobOutcome("wage_decision_missing_reminder", true);
    } catch (err) {
      recordJobOutcome("wage_decision_missing_reminder", false);
      logError("Wage decision missing reminder sweep failed", { error: String(err) });
    }
  });

  logInfo("Background job runner started (with retention, sync, social post, token expiry, compliance, profitability monitor, idle opportunity, orphan upload, bid due date, IMAP email sync, provider email sync, provider push-back drain, periodic report, DB health check, scheduled campaign, project geocoding, weekly CRM birthday digest, and daily CRM birthday email schedulers)");
}

export function stopJobRunner() {
  if (outboxTask) {
    outboxTask.stop();
    outboxTask = null;
  }
  if (retentionTask) {
    retentionTask.stop();
    retentionTask = null;
  }
  if (syncScheduleTask) {
    syncScheduleTask.stop();
    syncScheduleTask = null;
  }
  if (socialPostTask) {
    socialPostTask.stop();
    socialPostTask = null;
  }
  if (tokenExpiryTask) {
    tokenExpiryTask.stop();
    tokenExpiryTask = null;
  }
  if (complianceCheckTask) {
    complianceCheckTask.stop();
    complianceCheckTask = null;
  }
  if (profitabilityMonitorTask) {
    profitabilityMonitorTask.stop();
    profitabilityMonitorTask = null;
  }
  if (idleOpportunityTask) {
    idleOpportunityTask.stop();
    idleOpportunityTask = null;
  }
  if (bidDueDateTask) {
    bidDueDateTask.stop();
    bidDueDateTask = null;
  }
  if (orphanUploadTask) {
    orphanUploadTask.stop();
    orphanUploadTask = null;
  }
  if (imapSyncTask) {
    imapSyncTask.stop();
    imapSyncTask = null;
  }
  if (providerSyncTask) {
    providerSyncTask.stop();
    providerSyncTask = null;
  }
  if (providerPushDrainTask) {
    providerPushDrainTask.stop();
    providerPushDrainTask = null;
  }
  if (emailPushRenewalTask) {
    emailPushRenewalTask.stop();
    emailPushRenewalTask = null;
  }
  if (weeklyReportTask) {
    weeklyReportTask.stop();
    weeklyReportTask = null;
  }
  if (monthlyReportTask) {
    monthlyReportTask.stop();
    monthlyReportTask = null;
  }
  if (dbHealthCheckTask) {
    dbHealthCheckTask.stop();
    dbHealthCheckTask = null;
  }
  if (socialEngagementTask) {
    socialEngagementTask.stop();
    socialEngagementTask = null;
  }
  if (scheduledCampaignTask) {
    scheduledCampaignTask.stop();
    scheduledCampaignTask = null;
  }
  if (sequenceCadenceTask) {
    sequenceCadenceTask.stop();
    sequenceCadenceTask = null;
  }
  if (projectGeocodeTask) {
    projectGeocodeTask.stop();
    projectGeocodeTask = null;
  }
  if (crmSlaBreachTask) {
    crmSlaBreachTask.stop();
    crmSlaBreachTask = null;
  }
  if (crmIdleAutomationTask) {
    crmIdleAutomationTask.stop();
    crmIdleAutomationTask = null;
  }
  if (crmBirthdayDigestTask) {
    crmBirthdayDigestTask.stop();
    crmBirthdayDigestTask = null;
  }
  if (crmBirthdayDailyTask) {
    crmBirthdayDailyTask.stop();
    crmBirthdayDailyTask = null;
  }
  if (jobMetricsPruneTask) {
    jobMetricsPruneTask.stop();
    jobMetricsPruneTask = null;
  }
  if (jobMetricAlertsTask) {
    jobMetricAlertsTask.stop();
    jobMetricAlertsTask = null;
  }
  if (jobMetricQuietDigestTask) {
    jobMetricQuietDigestTask.stop();
    jobMetricQuietDigestTask = null;
  }
  if (poolHealthSampleTask) {
    poolHealthSampleTask.stop();
    poolHealthSampleTask = null;
  }
  if (portfolioKpiSnapshotTask) {
    portfolioKpiSnapshotTask.stop();
    portfolioKpiSnapshotTask = null;
  }
  if (certifiedPayrollDigestTask) {
    certifiedPayrollDigestTask.stop();
    certifiedPayrollDigestTask = null;
  }
  if (projectLogEmailScheduleTask) {
    projectLogEmailScheduleTask.stop();
    projectLogEmailScheduleTask = null;
  }
  if (projectLogEmailFailuresDigestTask) {
    projectLogEmailFailuresDigestTask.stop();
    projectLogEmailFailuresDigestTask = null;
  }
  if (swpppOverdueTask) {
    swpppOverdueTask.stop();
    swpppOverdueTask = null;
  }
  if (rfiOverdueTask) {
    rfiOverdueTask.stop();
    rfiOverdueTask = null;
  }
  if (submittalReviewOverdueTask) {
    submittalReviewOverdueTask.stop();
    submittalReviewOverdueTask = null;
  }
  if (certifiedPayrollPurgeTask) {
    certifiedPayrollPurgeTask.stop();
    certifiedPayrollPurgeTask = null;
  }
  if (wageDecisionMissingReminderTask) {
    wageDecisionMissingReminderTask.stop();
    wageDecisionMissingReminderTask = null;
  }
  if (wageDecisionRetryTask) {
    wageDecisionRetryTask.stop();
    wageDecisionRetryTask = null;
  }
  if (wageDecisionStaleRefreshTask) {
    wageDecisionStaleRefreshTask.stop();
    wageDecisionStaleRefreshTask = null;
  }
  if (suppressionResetPruneTask) {
    suppressionResetPruneTask.stop();
    suppressionResetPruneTask = null;
  }
  if (projectLogEmailAttemptPruneTask) {
    projectLogEmailAttemptPruneTask.stop();
    projectLogEmailAttemptPruneTask = null;
  }
  if (planDocumentMarkupTrashPurgeTask) {
    planDocumentMarkupTrashPurgeTask.stop();
    planDocumentMarkupTrashPurgeTask = null;
  }
  if (dotPayItemsRefreshTask) {
    dotPayItemsRefreshTask.stop();
    dotPayItemsRefreshTask = null;
  }
  logInfo("Background job runner stopped");
}

export const jobRegistry: Record<string, { fn: () => Promise<void>; description: string; schedule?: string }> = {
  outbox:              { fn: () => processOutbox(),                    description: "Process integration outbox events",      schedule: "*/2 * * * *" },
  retention:           { fn: () => processRetentionPolicies(),         description: "Apply data retention policies",           schedule: "0 2 * * *" },
  sync_schedules:      { fn: () => processSyncSchedules(),             description: "Run QBO / integration sync schedules",   schedule: "*/15 * * * *" },
  social_posts:        { fn: () => processScheduledSocialPosts(),      description: "Publish scheduled social media posts",    schedule: "*/2 * * * *" },
  token_expiry:        { fn: () => checkSocialTokenExpiry(),           description: "Check social account token expiry",       schedule: "0 3 * * *" },
  compliance:          { fn: () => processComplianceExpirations(),     description: "Check compliance/cert expirations",       schedule: "0 7 * * *" },
  profitability:       { fn: () => processProfitabilityMonitor(),      description: "Monitor project profitability",           schedule: "*/15 * * * *" },
  portfolio_kpi_snapshot: { fn: async () => { await captureWeeklyKpiSnapshots(); }, description: "Capture per-project weekly KPI snapshots (health/SPI/CPI/burn)", schedule: "15 2 * * *" },
  idle_opportunities:  { fn: () => processIdleOpportunities(),         description: "Flag idle CRM opportunities",            schedule: "0 8 * * *" },
  orphan_uploads:      { fn: () => processOrphanUploads(),             description: "Clean up orphaned file uploads",          schedule: "*/30 * * * *" },
  bid_due_dates:       { fn: () => processBidDueDateApproaching(),     description: "Notify on approaching bid due dates",     schedule: "0 * * * *" },
  imap_sync:           { fn: () => processImapEmailSync(),             description: "Sync IMAP email accounts",               schedule: "*/15 * * * *" },
  provider_sync:       { fn: () => processProviderEmailSync(),         description: "Sync Gmail/Outlook accounts (2-way safety net)",     schedule: "*/5 * * * *" },
  provider_push_drain: { fn: () => processProviderPushDrain(),         description: "Retry queued read/archive push-backs to Gmail/Outlook", schedule: "*/2 * * * *" },
  email_push_renewal:  { fn: () => ensureAllEmailPushSubscriptions(),  description: "Renew Gmail watch + Outlook subscriptions",          schedule: "*/15 * * * *" },
  weekly_report:       { fn: () => processPeriodicReports("WEEKLY"),   description: "Generate weekly reports",                 schedule: "0 7 * * 1" },
  monthly_report:      { fn: () => processPeriodicReports("MONTHLY"),  description: "Generate monthly reports",                schedule: "0 7 1 * *" },
  db_health_check:     { fn: () => runDbHealthCheck(),                 description: "Run database health check",              schedule: "0 */6 * * *" },
  social_engagement:   { fn: () => processSocialEngagement(),          description: "Sync social media engagement metrics",    schedule: "0 */4 * * *" },
  scheduled_campaigns: { fn: () => processScheduledCampaigns(),        description: "Send scheduled email campaigns",          schedule: "*/2 * * * *" },
  sequence_cadences:   { fn: async () => { await processDueExecutions(); }, description: "Run CRM sequence cadence executions",   schedule: "*/2 * * * *" },
  geocode_projects:    { fn: async () => { await geocodePendingProjects(); }, description: "Geocode projects with addresses but no coordinates",   schedule: "30 4 * * *" },
  crm_sla_breaches:    { fn: () => processCrmSlaBreaches(),            description: "Flag CRM stage SLA breaches across all orgs",         schedule: "*/5 * * * *" },
  crm_idle_automations:{ fn: () => processCrmIdleAutomations(),        description: "Tick CRM automation engine for IDLE_DAYS triggers",   schedule: "*/10 * * * *" },
  crm_birthday_digest: { fn: () => processCrmContactBirthdayDigest({ ignoreTimeOfDay: true }), description: "Send weekly CRM contact birthday digest in each user's local timezone", schedule: "0 * * * *" },
  crm_birthday_daily:  { fn: () => processCrmContactBirthdayDailyDigest(), description: "Daily morning email reminder of today's CRM contact birthdays to contact owners", schedule: "0 7 * * *" },
  job_metric_alerts:   { fn: async () => { await evaluateJobMetricAlerts(); }, description: "Evaluate job metric counters for spikes vs baseline and stalled jobs", schedule: "*/15 * * * *" },
  // Task #754: send the quiet-hours digest to Super Admins who have
  // exited their quiet window so they can catch up on overnight alerts.
  job_metric_quiet_digest: { fn: async () => { await sendJobMetricAlertQuietHoursDigests({ recordSends: true }); }, description: "Send digest of job-metric alerts that fired while a Super Admin was in quiet hours", schedule: "*/15 * * * *" },
  certified_payroll_digest: { fn: () => processCertifiedPayrollWeeklyDigest(), description: "Email payroll administrators a digest of certified payroll PDFs (per-org cadence/time/timezone)", schedule: "0 * * * *" },
  // Task #1606: per-project scheduled email of the RFI / submittal log
  // PDF to the project's email distribution lists. Cadence + send time
  // are stored on each row in `project_log_email_schedules` (default
  // OFF), so existing projects see no behaviour change until someone
  // opts in.
  project_log_email_schedules: { fn: () => processProjectLogEmailSchedules(), description: "Email RFI / submittal log PDFs to project distribution lists on the per-project cadence configured in project_log_email_schedules", schedule: "0 * * * *" },
  swppp_overdue_corrective_actions: { fn: () => processSwpppOverdueCorrectiveActions(), description: "Notify assignees and project managers when SWPPP corrective actions pass their due date without being resolved", schedule: "0 7 * * *" },
  // Task #1599: nightly fan-out + daily reminder cap for overdue RFIs
  // (status IN ('SUBMITTED','UNDER_REVIEW','FORWARDED') AND date_required < now).
  rfi_overdue_notifications: { fn: () => processRfiOverdueNotifications(), description: "Notify RFI assignees and project managers when an RFI passes its required-by date without being answered", schedule: "0 7 * * *" },
  // Task #1599: same pattern for submittal_reviews whose parent
  // submittal's date_required has passed.
  submittal_overdue_notifications: { fn: () => processSubmittalReviewOverdueNotifications(), description: "Notify submittal reviewers and project managers when a PENDING/IN_REVIEW review's parent submittal passes its required-by date", schedule: "0 7 * * *" },
  certified_payroll_purge: { fn: async () => { await processArchivedCertifiedPayrollPurge(); }, description: "Hard-delete archived certified payroll PDFs (and object-storage files) older than each org's retention window (default 3 years)", schedule: "30 3 * * *" },
  // Legacy alias: kept so admin "Run job now" affordances and tests can
  // still invoke a Davis-Bacon-only sweep, but no longer scheduled on
  // its own cron — the generic `integration_sync_retry` job below
  // handles Davis-Bacon alongside every other provider on the same
  // backoff schedule, so running both would double-trigger retries.
  wage_decision_retry: { fn: async () => { await processFailedWageDecisionRetries(); }, description: "[legacy alias] Davis-Bacon-only wage-decision retry sweep — superseded by integration_sync_retry; manual trigger only" },
  integration_sync_retry: { fn: async () => { await processIntegrationSyncRetries(); }, description: "Re-attempt every failed integration sync (Davis-Bacon, QBO, etc.) whose backoff window is due", schedule: "*/5 * * * *" },
  // Task #1600 — every 4h pull Sage Intacct chart of accounts + payment
  // status snapshots for each active sage_intacct connection (gated by
  // the INTEGRATION_SAGE feature flag inside processSagePeriodicSync).
  sage_periodic_sync: { fn: async () => { await processSagePeriodicSync(); }, description: "Sage Intacct periodic sync — refresh chart of accounts and payment status for every active connection (gated by INTEGRATION_SAGE)", schedule: "0 */4 * * *" },
  // Task #1344: daily fan-out to org admins of any project whose Davis-Bacon
  // wage decision has been missing from the cache for >24h. Throttled inside
  // the handler to one reminder per project per week, so a daily cadence
  // gives us the right responsiveness without spamming admins.
  wage_decision_missing_reminder: { fn: async () => { await processMissingWageDecisionReminders(); }, description: "Email/in-app reminder to org admins about projects whose Davis-Bacon wage decision is still uncached after 24h (throttled to 1/project/week)", schedule: "0 8 * * *" },
  // Task #1380: re-sync cached Davis-Bacon wage decisions whose lastSyncAt
  // has crossed the configured staleness threshold (default 30 days).
  wage_decision_stale_refresh: { fn: async () => { await processStaleWageDecisions(); }, description: "Re-sync cached Davis-Bacon wage decisions whose lastSyncAt is older than DOL_DAVIS_BACON_STALE_AFTER_DAYS (default 30 days); skips rows currently in the failure-backoff lane", schedule: "0 6 * * *" },
  // Task #1512: bound the integration_suppression_resets table. Default
  // 90 days; configurable via INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS.
  suppression_reset_prune: { fn: async () => { await pruneSuppressionResets(); }, description: "Delete integration_suppression_resets rows older than INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS (default 90 days)", schedule: "45 3 * * *" },
  // Task #1665: bound the per-attempt history of
  // project_log_email_schedules. Default 90 days; configurable via
  // PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS. Batched inside the
  // helper so a large tenant can't hold long row-level locks.
  project_log_email_attempt_prune: { fn: async () => { await pruneProjectLogEmailScheduleAttempts(); }, description: "Delete project_log_email_schedule_attempts rows older than PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS (default 90 days), in batches", schedule: "0 4 * * *" },
  // Task #1846: bound the soft-deleted slice of plan_document_markups.
  // Default 30 days; configurable via PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS.
  // Batched inside the helper so a large tenant can't hold long row-level
  // locks on the markup table.
  plan_document_markup_trash_purge: { fn: async () => { await purgePlanDocumentMarkupTrash(); }, description: "Hard-delete plan_document_markups rows whose deleted_at is older than PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS (default 30 days), in batches", schedule: "15 4 * * *" },
  // Task #1948: quarterly automated refresh of the verbatim DOT pay-item
  // catalogs (FHWA + every supported state DOT). Logs per-agency
  // added/removed/changed deltas and emails the on-call rotation if
  // any catalog regresses below its `AGENCY_MIN_ITEMS` threshold so
  // the seed data tracks each agency's published spec book without
  // manual intervention.
  dot_pay_items_refresh: { fn: async () => { await processDotPayItemsRefresh(); }, description: "Quarterly refresh of verbatim DOT pay-item catalogs from each agency's published source; logs added/removed/changed per agency and emails on-call when a catalog drops below AGENCY_MIN_ITEMS", schedule: "0 4 1 1,4,7,10 *" },
};

async function processOutbox() {
  const events = await outboxService.getQueuedEvents(25);
  if (events.length === 0) return;

  logInfo("Processing outbox events", { count: events.length });

  for (const event of events) {
    try {
      await outboxService.markProcessing(event.id);

      const subs = await db.select().from(integrationWebhookSubscriptions)
        .where(and(
          eq(integrationWebhookSubscriptions.connectionId, event.connectionId),
          eq(integrationWebhookSubscriptions.eventType, event.eventType),
          eq(integrationWebhookSubscriptions.isActive, true)
        ));

      for (const sub of subs) {
        if (sub.secret) {
          await webhookService.deliverWebhook(sub.targetUrl, event.payload as Record<string, any>, sub.secret);
        }
      }

      await outboxService.markSent(event.id);
    } catch (err) {
      await outboxService.markFailed(event.id, String(err), (event.attempts || 0) + 1);
    }
  }
}

export async function processRetentionPolicies() {
  const startedAt = Date.now();
  let deleted = 0;
  let hardDeleted = 0;
  let policiesProcessed = 0;
  let policiesFailed = 0;
  // Task #1552 — every (entityType, action) combination outside the
  // supported set in `SUPPORTED_RETENTION_POLICY_COMBOS` is currently a
  // no-op at sweep time. We surface those as a separate counter so
  // operators can see in the dashboard exactly how many policies are
  // silently doing nothing, and we log a warning per offender.
  let policiesUnsupported = 0;
  // Task #1573 — collect the offending (entityType, action) pairs so
  // the absolute-floor `policiesUnsupported` spike alert in
  // `jobMetricAlerts.ts` can include them in the message and SendGrid
  // escalation. Pairs are deduped because nothing prevents an operator
  // from creating two enabled policies for the same combo.
  const unsupportedPairs: Array<{ entityType: string; action: string }> = [];
  const unsupportedSeen = new Set<string>();

  const policies = await db.select()
    .from(retentionPolicies)
    .where(eq(retentionPolicies.enabled, true));

  if (policies.length === 0) {
    // Task #1523 — always emit a per-run sample (even on the empty path)
    // so the dashboard shows every nightly tick and the Task #1502 spike
    // rules on `deleted` / `hardDeleted` actually have a baseline to
    // compare against.
    recordJobMetrics("retention_policy_sweep", {
      deleted: 0,
      hardDeleted: 0,
      policiesProcessed: 0,
      policiesFailed: 0,
      policiesUnsupported: 0,
      durationMs: Date.now() - startedAt,
    });
    // Task #1573 — empty-policy run has no offenders; clear the
    // side-channel so a previously-unsupported pair from an earlier
    // run doesn't get attached to a future alert.
    setRetentionPolicyUnsupportedPairsForAlerts([]);
    return;
  }

  logInfo("Processing retention policies", { count: policies.length });

  for (const policy of policies) {
    try {
      const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
      let policyDeleted = 0;

      // Task #1572 — every retention mutation MUST be scoped to the
      // policy's own organization. Without this, an enabled policy in
      // org A would delete/anonymize rows belonging to every other
      // org in the database. Each branch below derives the per-tenant
      // predicate from `policy.organizationId`, either directly (when
      // the target table carries `organization_id`) or via an
      // `inArray(...subselect)` through the canonical parent table
      // (`projects.gcOrganizationId`, `conversations.organizationId`,
      // `users.organizationId`).
      const orgId = policy.organizationId;
      // Subselects of org-owned parent IDs. Wrapped in helpers so the
      // same predicate is reused by the count + mutation paths and
      // can't drift.
      const orgProjectIds = db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.gcOrganizationId, orgId));
      const orgConversationIds = db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.organizationId, orgId));
      const orgUserIds = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.organizationId, orgId));

      if (policy.entityType === "AUDIT_LOGS" && policy.action === "DELETE") {
        // `.returning({ id })` so we can publish a per-policy delete
        // count to the job-metrics surface — the spike rule in
        // jobMetricAlerts.ts (Task #1502) compares this counter against
        // a 5x baseline / 25-row floor.
        // Tenant scoping: audit_log carries no organizationId column,
        // so we narrow via `users.organizationId`. NOTE: `audit_log`
        // schema marks `user_id` as NOT NULL (every row is attributed
        // to an actor), so this scoping covers all rows. If a future
        // schema change relaxes that constraint to allow system /
        // unattributed events, those rows would fall outside any
        // org policy and would need a separate platform-level sweep.
        const removed = await db
          .delete(auditLog)
          .where(and(
            lt(auditLog.createdAt, cutoff),
            inArray(auditLog.userId, orgUserIds),
          ))
          .returning({ id: auditLog.id });
        policyDeleted = removed.length;
        // AUDIT_LOGS DELETE is a true hard-delete (no soft-delete column
        // on this table), so `hardDeleted` mirrors `deleted`.
        deleted += policyDeleted;
        hardDeleted += policyDeleted;
      } else if (policy.entityType === "AI_ACTIONS" && policy.action === "DELETE") {
        // Task #1572 — drop expired AI action audit rows entirely,
        // scoped to the policy's organization.
        const removed = await db
          .delete(aiActionAudit)
          .where(and(
            eq(aiActionAudit.organizationId, orgId),
            lt(aiActionAudit.createdAt, cutoff),
          ))
          .returning({ id: aiActionAudit.id });
        policyDeleted = removed.length;
        deleted += policyDeleted;
        hardDeleted += policyDeleted;
      } else if (policy.entityType === "AI_ACTIONS" && policy.action === "ANONYMIZE") {
        // Task #1572 — keep the row for usage stats but scrub the
        // identifying / free-text columns (actor, prompt rationale,
        // input/output refs, approver). Scoped to the policy's
        // organization. Predicate matches rows where ANY redactable
        // field is still populated, so a row with `actorUserId = null`
        // but a non-empty `rationale` is still anonymized (privacy
        // gap flagged in code review).
        const updated = await db
          .update(aiActionAudit)
          .set({
            actorUserId: null,
            rationale: null,
            inputRefs: null,
            outputRefs: null,
            approvedByUserId: null,
          })
          .where(and(
            eq(aiActionAudit.organizationId, orgId),
            lt(aiActionAudit.createdAt, cutoff),
            or(
              isNotNull(aiActionAudit.actorUserId),
              isNotNull(aiActionAudit.rationale),
              isNotNull(aiActionAudit.inputRefs),
              isNotNull(aiActionAudit.outputRefs),
              isNotNull(aiActionAudit.approvedByUserId),
            ),
          ))
          .returning({ id: aiActionAudit.id });
        policyDeleted = updated.length;
        // ANONYMIZE keeps the row, so it counts toward `deleted`
        // (rows-affected) but NOT `hardDeleted`.
        deleted += policyDeleted;
      } else if (policy.entityType === "DOCUMENTS" && policy.action === "DELETE") {
        // Task #1572 — drop expired plan_documents rows belonging to
        // this org. plan_documents.organizationId is set on every row
        // (per the schema comment), covering both PROJECT- and
        // ORG-scoped documents. Object-storage cleanup is handled by
        // the orphan-upload sweep, so we only remove the metadata row.
        const removed = await db
          .delete(planDocuments)
          .where(and(
            eq(planDocuments.organizationId, orgId),
            lt(planDocuments.uploadedAt, cutoff),
          ))
          .returning({ id: planDocuments.id });
        policyDeleted = removed.length;
        deleted += policyDeleted;
        hardDeleted += policyDeleted;
      } else if (policy.entityType === "TIME_ENTRIES" && policy.action === "DELETE") {
        // Task #1572 — hard-delete time entries past their retention
        // window, scoped to projects owned by the policy's org via
        // `projects.gcOrganizationId`. Note: customers usually want to
        // ANONYMIZE these instead, since they may still need totals
        // for payroll history; DELETE is offered for completeness.
        const removed = await db
          .delete(timeEntries)
          .where(and(
            lt(timeEntries.createdAt, cutoff),
            inArray(timeEntries.projectId, orgProjectIds),
          ))
          .returning({ id: timeEntries.id });
        policyDeleted = removed.length;
        deleted += policyDeleted;
        hardDeleted += policyDeleted;
      } else if (policy.entityType === "TIME_ENTRIES" && policy.action === "ANONYMIZE") {
        // Task #1572 — keep the structural row (so payroll totals stay
        // intact) but strip the free-text PII columns. Scoped via
        // projects.gcOrganizationId.
        const updated = await db
          .update(timeEntries)
          .set({
            notes: null,
            rejectionReason: null,
            updatedAt: new Date(),
          })
          .where(and(
            lt(timeEntries.createdAt, cutoff),
            inArray(timeEntries.projectId, orgProjectIds),
            or(isNotNull(timeEntries.notes), isNotNull(timeEntries.rejectionReason)),
          ))
          .returning({ id: timeEntries.id });
        policyDeleted = updated.length;
        deleted += policyDeleted;
      } else if (policy.entityType === "MESSAGES" && policy.action === "DELETE") {
        // Task #1572 — hard-delete expired messages owned by this
        // org's conversations. Reactions and read receipts cascade on
        // the `messages` FK so they go with it.
        const removed = await db
          .delete(messages)
          .where(and(
            lt(messages.createdAt, cutoff),
            inArray(messages.conversationId, orgConversationIds),
          ))
          .returning({ id: messages.id });
        policyDeleted = removed.length;
        deleted += policyDeleted;
        hardDeleted += policyDeleted;
      } else if (policy.entityType === "MESSAGES" && policy.action === "ANONYMIZE") {
        // Task #1572 — keep the row but scrub the body, attachments
        // and voice memo refs, and flip `isDeleted` so the chat UI
        // hides it. We skip rows that were already redacted to avoid
        // counting them again. Scoped via conversations.organizationId.
        const updated = await db
          .update(messages)
          .set({
            content: "[redacted]",
            attachmentUrl: null,
            attachmentName: null,
            attachmentType: null,
            attachmentSize: null,
            voiceUrl: null,
            voiceDurationSeconds: null,
            isDeleted: true,
          })
          .where(and(
            lt(messages.createdAt, cutoff),
            eq(messages.isDeleted, false),
            inArray(messages.conversationId, orgConversationIds),
          ))
          .returning({ id: messages.id });
        policyDeleted = updated.length;
        deleted += policyDeleted;
      } else if (policy.entityType === "FILE_UPLOADS" && policy.action === "DELETE") {
        // Task #1572 — drop expired media rows owned by this org's
        // projects. Object-storage cleanup for the underlying file is
        // handled by the orphan-upload sweep.
        const removed = await db
          .delete(media)
          .where(and(
            lt(media.uploadedAt, cutoff),
            inArray(media.projectId, orgProjectIds),
          ))
          .returning({ id: media.id });
        policyDeleted = removed.length;
        deleted += policyDeleted;
        hardDeleted += policyDeleted;
      } else if (!isSupportedRetentionPolicyCombo(policy.entityType, policy.action)) {
        // Task #1552 — flag the no-op so operators don't think a
        // misconfigured policy (e.g. NOTIFICATIONS+DELETE) is actually
        // running. We still bump `lastRunAt` below so the row's "last
        // attempt" timestamp stays accurate, but this policy does NOT
        // count toward `policiesProcessed`.
        policiesUnsupported += 1;
        // Task #1573 — capture the offending pair (deduped) so the
        // alert engine can name the misconfigured combos in the
        // `policiesUnsupported` spike alert message.
        const pairKey = `${policy.entityType}::${policy.action}`;
        if (!unsupportedSeen.has(pairKey)) {
          unsupportedSeen.add(pairKey);
          unsupportedPairs.push({
            entityType: policy.entityType,
            action: policy.action,
          });
        }
        logWarn("Retention policy skipped: unsupported entityType/action", {
          policyId: policy.id,
          entityType: policy.entityType,
          action: policy.action,
        });
        await db.update(retentionPolicies)
          .set({ lastRunAt: new Date(), updatedAt: new Date() })
          .where(eq(retentionPolicies.id, policy.id));
        continue;
      }

      await db.update(retentionPolicies)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(retentionPolicies.id, policy.id));

      policiesProcessed += 1;
      logInfo("Retention policy executed", {
        entityType: policy.entityType,
        action: policy.action,
        deleted: policyDeleted,
      });
    } catch (err) {
      policiesFailed += 1;
      logError("Retention policy failed", { policyId: policy.id, error: String(err) });
    }
  }

  // Task #1523 — surface per-run counts so operators see the nightly
  // history on the Jobs dashboard and the Task #1502 over-delete spike
  // rules can fire end-to-end.
  // Task #1552 — `policiesUnsupported` shows how many enabled policies
  // had no real implementation this run.
  recordJobMetrics("retention_policy_sweep", {
    deleted,
    hardDeleted,
    policiesProcessed,
    policiesFailed,
    policiesUnsupported,
    durationMs: Date.now() - startedAt,
  });
  // Task #1573 — publish the offending (entityType, action) pairs (or
  // an empty list when the run was clean) so the absolute-floor
  // `policiesUnsupported` spike alert can name the misconfigured combos
  // in the dashboard message and SendGrid escalation.
  setRetentionPolicyUnsupportedPairsForAlerts(unsupportedPairs);
}

/**
 * Task #1551 — per-run history record for the nightly retention policy
 * sweep. Mirrors the shape of `OrphanWageDecisionSweepRecord` so the
 * admin Jobs dashboard can render a "Last run" + "Recent runs" card
 * using the same UI pattern.
 */
export const RETENTION_POLICY_SWEEP_JOB = "retention_policy_sweep";

export interface RetentionPolicySweepResult {
  deleted: number;
  hardDeleted: number;
  policiesProcessed: number;
  policiesFailed: number;
}

export interface RetentionPolicySweepRecord {
  ranAt: string;
  durationMs: number;
  result: RetentionPolicySweepResult;
}

function rowToRetentionSweepRecord(row: {
  recordedAt: Date | string;
  counters: unknown;
}): RetentionPolicySweepRecord {
  const c = (row.counters ?? {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = c[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    ranAt: new Date(row.recordedAt).toISOString(),
    durationMs: num("durationMs"),
    result: {
      deleted: num("deleted"),
      hardDeleted: num("hardDeleted"),
      policiesProcessed: num("policiesProcessed"),
      policiesFailed: num("policiesFailed"),
    },
  };
}

export async function getLastRetentionPolicySweep(): Promise<RetentionPolicySweepRecord | null> {
  try {
    const [row] = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, RETENTION_POLICY_SWEEP_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(1);
    return row ? rowToRetentionSweepRecord(row) : null;
  } catch (err) {
    logError("Failed to load last retention policy sweep", { error: String(err) });
    return null;
  }
}

export async function getRecentRetentionPolicySweeps(
  limit = 10,
): Promise<RetentionPolicySweepRecord[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const rows = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, RETENTION_POLICY_SWEEP_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(safeLimit);
    return rows.map(rowToRetentionSweepRecord);
  } catch (err) {
    logError("Failed to load recent retention policy sweeps", { error: String(err) });
    return [];
  }
}

function computeNextRunAt(frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case "hourly":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "every_6h":
      return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

async function processSyncSchedules() {
  const now = new Date();
  const dueSchedules = await db.select().from(qboSyncSchedules)
    .where(and(
      eq(qboSyncSchedules.isActive, true),
      lte(qboSyncSchedules.nextRunAt, now)
    ));

  if (dueSchedules.length === 0) return;

  logInfo("Processing due sync schedules", { count: dueSchedules.length });

  for (const schedule of dueSchedules) {
    const startTime = Date.now();
    try {
      let connection = await connectionService.getConnection(schedule.connectionId, schedule.organizationId);
      if (!connection || connection.status !== "active") {
        logError("Sync schedule skipped: connection inactive", { scheduleId: schedule.id });
        continue;
      }

      const metadata = (connection.metadata as Record<string, any>) || {};
      if (metadata.expiresAt && new Date(metadata.expiresAt) < now) {
        const provider = getProvider(connection.provider);
        if (provider && metadata.refreshToken) {
          try {
            const newTokens = await provider.refreshToken(connection);
            await connectionService.storeConnectionTokens(connection.id, schedule.organizationId, newTokens);
            connection = (await connectionService.getConnection(connection.id, schedule.organizationId))!;
            logInfo("Token refreshed for scheduled sync", { connectionId: connection.id });
          } catch (refreshErr) {
            logError("Token refresh failed for scheduled sync", { error: String(refreshErr) });
            continue;
          }
        }
      }

      let result;
      let runError: unknown = null;
      try {
        switch (schedule.operation) {
          case "chart_of_accounts":
            result = await importChartOfAccounts(connection, false);
            break;
          case "customers":
            result = await exportCustomers(connection, [], false);
            break;
          case "subcontractor_payments":
            result = await exportSubcontractorPayments(connection, false);
            break;
          case "purchase_orders":
            result = await exportPurchaseOrders(connection, undefined, false);
            break;
          case "reconcile_payments":
            result = await reconcilePayments(connection, false);
            break;
          default:
            logError("Unknown scheduled sync operation", { operation: schedule.operation });
            continue;
        }
      } catch (err) {
        runError = err;
        logError("Scheduled QBO sync threw", { operation: schedule.operation, error: String(err) });
        result = {
          success: false,
          entityType: schedule.operation,
          direction: "export" as const,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [{ message: String(err) }],
        };
      }

      // Task #1368: persist auto-retry bookkeeping for the scheduled QBO
      // operation. On success this clears any prior failure state so the
      // generic sync-retry sweep stops re-firing it; on failure it
      // increments retryCount and schedules the next backoff window so
      // the sweep auto-recovers from transient QBO outages without the
      // owner having to click "Retry sync".
      // Operations that take user payload (customers, etc.) are still
      // tracked here so the failure surfaces in the sync history; the
      // QBO retry handler only re-runs the parameterless ones.
      try {
        const retryEntity = qboSyncEntityType(schedule.operation);
        if (result?.success) {
          await recordSyncSuccess(connection, retryEntity);
        } else {
          const errMsg = runError
            ? String(runError)
            : (result?.errors?.map((e) => e.message).join("; ") || "QBO sync failed");
          await recordSyncFailure(connection, retryEntity, errMsg);
        }
      } catch (err) {
        logError("Failed to persist QBO sync retry state", {
          operation: schedule.operation,
          connectionId: connection.id,
          error: String(err),
        });
      }

      const duration = Date.now() - startTime;

      const syncLog = {
        operation: schedule.operation,
        dryRun: false,
        result,
        duration,
        triggeredBy: "scheduler",
        triggeredAt: new Date().toISOString(),
      };

      const [existing] = await db.select().from(integrationSyncState)
        .where(and(
          eq(integrationSyncState.connectionId, connection.id),
          eq(integrationSyncState.entityType, `sync_log_${schedule.operation}`)
        ));

      const prevLogs = (existing?.metadata as any)?.logs || [];
      prevLogs.unshift(syncLog);
      const logs = prevLogs.slice(0, 50);

      if (existing) {
        await db.update(integrationSyncState)
          .set({
            metadata: { logs, latestResult: result },
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(integrationSyncState.id, existing.id));
      } else {
        await db.insert(integrationSyncState).values({
          organizationId: schedule.organizationId,
          connectionId: connection.id,
          entityType: `sync_log_${schedule.operation}`,
          metadata: { logs, latestResult: result },
          lastSyncAt: new Date(),
        });
      }

      await db.update(qboSyncSchedules)
        .set({
          lastRunAt: now,
          nextRunAt: computeNextRunAt(schedule.frequency),
          updatedAt: new Date(),
        })
        .where(eq(qboSyncSchedules.id, schedule.id));

      logInfo("Scheduled sync completed", { operation: schedule.operation, duration, success: result?.success });
    } catch (err) {
      logError("Scheduled sync failed", { scheduleId: schedule.id, operation: schedule.operation, error: String(err) });

      await db.update(qboSyncSchedules)
        .set({
          lastRunAt: now,
          nextRunAt: computeNextRunAt(schedule.frequency),
          updatedAt: new Date(),
        })
        .where(eq(qboSyncSchedules.id, schedule.id));
    }
  }
}

async function processScheduledSocialPosts() {
  const now = new Date();
  const duePosts = await db.select().from(socialMediaPosts).where(
    and(
      eq(socialMediaPosts.status, "SCHEDULED"),
      lte(socialMediaPosts.scheduledAt, now)
    )
  );

  if (duePosts.length === 0) return;

  logInfo(`Processing ${duePosts.length} scheduled social posts`);

  for (const post of duePosts) {
    try {
      let externalPostId: string | undefined;
      let externalPostUrl: string | undefined;

      if (post.socialAccountId) {
        const account = await db.query.socialAccounts.findFirst({
          where: eq(socialAccounts.id, post.socialAccountId),
        });

        if (account && account.accessTokenEncrypted) {
          const result = await publishToPlatform(
            { id: post.id, content: post.content, platform: post.platform, mediaUrls: post.mediaUrls, hashtags: post.hashtags, title: post.title },
            { id: account.id, platform: account.platform, accountId: account.accountId, accessTokenEncrypted: account.accessTokenEncrypted, refreshTokenEncrypted: account.refreshTokenEncrypted }
          );
          if (!result.success) {
            const errorMsg = result.error || "Platform publishing returned failure";
            const isPlatformNotConfigured = errorMsg.includes("not configured");
            await db.update(socialMediaPosts)
              .set({
                status: isPlatformNotConfigured ? "FAILED" as any : ((post.retryCount || 0) + 1 >= 3 ? "FAILED" as any : "SCHEDULED" as any),
                retryCount: isPlatformNotConfigured ? 3 : (post.retryCount || 0) + 1,
                lastError: errorMsg,
                updatedAt: now,
              })
              .where(eq(socialMediaPosts.id, post.id));
            if (isPlatformNotConfigured || (post.retryCount || 0) + 1 >= 3) {
              await notifyPostOwnerOfFailure(post, errorMsg);
            }
            logError("Social post publish failed", { postId: post.id, platform: post.platform, error: errorMsg });
            continue;
          }
          externalPostId = result.externalPostId;
          externalPostUrl = result.externalPostUrl;
        } else if (account && !account.accessTokenEncrypted) {
          const retries = (post.retryCount || 0) + 1;
          const isFinalFailure = retries >= 3;
          await db.update(socialMediaPosts)
            .set({
              status: isFinalFailure ? "FAILED" as any : "SCHEDULED" as any,
              retryCount: retries,
              lastError: "Social account has no access token. Please reconnect the account.",
              updatedAt: now,
            })
            .where(eq(socialMediaPosts.id, post.id));
          if (isFinalFailure) {
            await notifyPostOwnerOfFailure(post, "Social account has no access token");
          }
          logError("Social account has no token", { postId: post.id });
          continue;
        }
      } else {
        const retries = (post.retryCount || 0) + 1;
        const isFinalFailure = retries >= 3;
        await db.update(socialMediaPosts)
          .set({
            status: isFinalFailure ? "FAILED" as any : "SCHEDULED" as any,
            retryCount: retries,
            lastError: "No social account linked to this post",
            updatedAt: now,
          })
          .where(eq(socialMediaPosts.id, post.id));
        if (isFinalFailure) {
          await notifyPostOwnerOfFailure(post, "No social account linked to this post");
        }
        logError("No social account linked", { postId: post.id });
        continue;
      }

      await db.update(socialMediaPosts)
        .set({
          status: "POSTED",
          publishedAt: now,
          externalPostId: externalPostId || null,
          externalPostUrl: externalPostUrl || null,
          updatedAt: now,
        })
        .where(eq(socialMediaPosts.id, post.id));

      if (post.isRecurring && post.recurringPattern) {
        const pattern = post.recurringPattern as any;
        let nextDate: Date | null = null;

        if (pattern.frequency === "daily") {
          nextDate = new Date(post.scheduledAt!);
          nextDate.setDate(nextDate.getDate() + (pattern.interval || 1));
        } else if (pattern.frequency === "weekly") {
          nextDate = new Date(post.scheduledAt!);
          nextDate.setDate(nextDate.getDate() + 7 * (pattern.interval || 1));
        } else if (pattern.frequency === "monthly") {
          nextDate = new Date(post.scheduledAt!);
          nextDate.setMonth(nextDate.getMonth() + (pattern.interval || 1));
        }

        if (nextDate && (!pattern.endDate || nextDate <= new Date(pattern.endDate))) {
          await db.insert(socialMediaPosts).values({
            organizationId: post.organizationId,
            title: post.title,
            content: post.content,
            platform: post.platform,
            platforms: post.platforms,
            status: "SCHEDULED",
            mediaUrls: post.mediaUrls,
            hashtags: post.hashtags,
            scheduledAt: nextDate,
            campaignTag: post.campaignTag,
            tone: post.tone,
            notes: post.notes,
            isRecurring: true,
            recurringPattern: post.recurringPattern,
            socialAccountId: post.socialAccountId,
            aiGenerated: post.aiGenerated,
            utmSource: post.utmSource,
            utmMedium: post.utmMedium,
            utmCampaign: post.utmCampaign,
            createdById: post.createdById,
          });
          logInfo("Created next recurring social post", { originalId: post.id, nextDate: nextDate.toISOString() });
        }
      }

      logInfo("Social post published", { postId: post.id, platform: post.platform, externalId: externalPostId });
    } catch (err) {
      const retries = (post.retryCount || 0) + 1;
      const isFinalFailure = retries >= 3;
      const newStatus = isFinalFailure ? "FAILED" : "SCHEDULED";
      await db.update(socialMediaPosts)
        .set({
          status: newStatus as any,
          retryCount: retries,
          lastError: String(err),
          updatedAt: now,
        })
        .where(eq(socialMediaPosts.id, post.id));
      if (isFinalFailure) {
        await notifyPostOwnerOfFailure(post, String(err));
      }
      logError("Failed to process social post", { postId: post.id, retries, error: String(err) });
    }
  }
}

async function notifyPostOwnerOfFailure(
  post: { id: string; title: string | null; content: string; platform: string | null; createdById: string | null },
  errorMessage: string
) {
  try {
    if (!post.createdById) return;
    const postLabel = post.title || post.content.substring(0, 50);
    const platformLabel = post.platform || "Unknown";
    const [owner] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, post.createdById)).limit(1);
    await insertNotification({
      userId: post.createdById,
      organizationId: owner?.organizationId || null,
      type: "GENERAL",
      title: `Scheduled post failed: ${platformLabel}`,
      message: `Your scheduled ${platformLabel} post "${postLabel}" failed after 3 attempts. Error: ${errorMessage.substring(0, 200)}`,
      relatedEntityId: post.id,
      relatedEntityType: "SOCIAL_POST",
    });
    logInfo("Failure notification sent to post owner", { postId: post.id, userId: post.createdById });
  } catch (notifErr) {
    logError("Failed to send post failure notification", { postId: post.id, error: String(notifErr) });
  }
}

function getPlatformCreds(platform: string): { clientId: string; clientSecret: string } {
  switch (platform) {
    case "FACEBOOK":
    case "INSTAGRAM":
      return { clientId: process.env.FB_APP_ID || "", clientSecret: process.env.FB_APP_SECRET || "" };
    case "LINKEDIN":
      return { clientId: process.env.LINKEDIN_CLIENT_ID || "", clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "" };
    case "TWITTER":
      return { clientId: process.env.TWITTER_CLIENT_ID || "", clientSecret: process.env.TWITTER_CLIENT_SECRET || "" };
    default:
      return { clientId: "", clientSecret: "" };
  }
}

async function checkSocialTokenExpiry() {
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const expiringAccounts = await db.query.socialAccounts.findMany({
    where: and(
      eq(socialAccounts.status, "CONNECTED"),
      lte(socialAccounts.tokenExpiresAt, sevenDaysFromNow)
    ),
  });

  if (expiringAccounts.length === 0) return;

  logInfo(`Checking ${expiringAccounts.length} accounts with expiring tokens`);

  for (const account of expiringAccounts) {
    try {
      if (account.refreshTokenEncrypted) {
        const { refreshToken: refreshTokenFn } = await import("../social/publishService");
        const creds = getPlatformCreds(account.platform);
        const result = await refreshTokenFn(account.platform, account.refreshTokenEncrypted, creds.clientId, creds.clientSecret);

        if (result) {
          const { default: crypto } = await import("crypto");
          const ENCRYPTION_KEY = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || "";
          const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
          const iv = crypto.randomBytes(16);
          const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
          let encrypted = cipher.update(result.accessToken, "utf8", "hex");
          encrypted += cipher.final("hex");
          const encryptedToken = iv.toString("hex") + ":" + encrypted;

          const expiresAt = result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000) : null;
          await db.update(socialAccounts)
            .set({
              accessTokenEncrypted: encryptedToken,
              tokenExpiresAt: expiresAt,
              lastSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(socialAccounts.id, account.id));
          logInfo("Auto-refreshed token", { accountId: account.id, platform: account.platform });
        } else {
          await db.update(socialAccounts)
            .set({ status: "EXPIRED", lastSyncError: "Token refresh failed", updatedAt: new Date() })
            .where(eq(socialAccounts.id, account.id));
          logError("Token refresh failed, marking as expired", { accountId: account.id });
        }
      } else {
        if (account.tokenExpiresAt && account.tokenExpiresAt <= new Date()) {
          await db.update(socialAccounts)
            .set({ status: "EXPIRED", lastSyncError: "Token expired, no refresh token available", updatedAt: new Date() })
            .where(eq(socialAccounts.id, account.id));
          logError("Token expired without refresh token", { accountId: account.id });
        }
      }
    } catch (err) {
      logError("Error checking token expiry", { accountId: account.id, error: String(err) });
    }
  }
}

async function processComplianceExpirations() {
  const now = new Date();
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const expirationCheck = or(
    and(isNotNull(crmOrganisations.insuranceExpiration), lte(crmOrganisations.insuranceExpiration, fourteenDaysFromNow)),
    and(isNotNull(crmOrganisations.wcInsuranceExpiration), lte(crmOrganisations.wcInsuranceExpiration, fourteenDaysFromNow)),
    and(isNotNull(crmOrganisations.licenseExpiration), lte(crmOrganisations.licenseExpiration, fourteenDaysFromNow)),
    and(isNotNull(crmOrganisations.contractExpiration), lte(crmOrganisations.contractExpiration, fourteenDaysFromNow))
  );

  const orgs = await db
    .select({
      id: crmOrganisations.id,
      name: crmOrganisations.name,
      organizationId: crmOrganisations.organizationId,
      insuranceExpiration: crmOrganisations.insuranceExpiration,
      wcInsuranceExpiration: crmOrganisations.wcInsuranceExpiration,
      licenseExpiration: crmOrganisations.licenseExpiration,
      contractExpiration: crmOrganisations.contractExpiration,
    })
    .from(crmOrganisations)
    .where(and(eq(crmOrganisations.isActive, true), expirationCheck!));

  if (orgs.length === 0) {
    logInfo("Compliance check: no expiring items found");
    return;
  }

  const orgIdSet = new Set(orgs.map(o => o.organizationId));
  const orgIds = [...orgIdSet];

  const managers = await db
    .select({ id: users.id, organizationId: users.organizationId })
    .from(users)
    .where(
      and(
        inArray(users.organizationId, orgIds),
        inArray(users.role, ["ADMIN", "MANAGER"])
      )
    );

  const managersByOrg = new Map<string, string[]>();
  for (const m of managers) {
    if (!m.organizationId) continue;
    const list = managersByOrg.get(m.organizationId) || [];
    list.push(m.id);
    managersByOrg.set(m.organizationId, list);
  }

  const notificationValues: Array<{
    userId: string;
    organizationId: string | null;
    type: "GENERAL";
    title: string;
    message: string;
    relatedEntityId: string;
    relatedEntityType: string;
  }> = [];

  for (const org of orgs) {
    const recipients = managersByOrg.get(org.organizationId) || [];
    if (recipients.length === 0) continue;

    const fields = [
      { type: "General Liability Insurance", date: org.insuranceExpiration },
      { type: "Workers Comp Insurance", date: org.wcInsuranceExpiration },
      { type: "License", date: org.licenseExpiration },
      { type: "Contract", date: org.contractExpiration },
    ];

    for (const field of fields) {
      if (!field.date) continue;
      const expDate = new Date(field.date);
      if (expDate > fourteenDaysFromNow) continue;

      const daysUntil = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const statusLabel = daysUntil <= 0 ? "EXPIRED" : `expires in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`;

      for (const userId of recipients) {
        notificationValues.push({
          userId,
          organizationId: org.organizationId,
          type: "GENERAL",
          title: `Compliance Alert: ${field.type} ${statusLabel}`,
          message: `${org.name} — ${field.type} ${statusLabel}. Please update compliance records.`,
          relatedEntityId: org.id,
          relatedEntityType: "CRM_COMPLIANCE",
        });
      }
    }
  }

  if (notificationValues.length > 0) {
    const existing = await db
      .select({ relatedEntityId: notifications.relatedEntityId, userId: notifications.userId, title: notifications.title })
      .from(notifications)
      .where(
        and(
          eq(notifications.relatedEntityType, "CRM_COMPLIANCE"),
          eq(notifications.isRead, false)
        )
      );

    const existingKeys = new Set(existing.map(e => `${e.userId}:${e.relatedEntityId}:${e.title}`));
    const deduped = notificationValues.filter(n => !existingKeys.has(`${n.userId}:${n.relatedEntityId}:${n.title}`));

    if (deduped.length > 0) {
      await insertNotifications(deduped);
      logInfo("Compliance notifications created", { count: deduped.length });
    } else {
      logInfo("Compliance check: all notifications already exist (unread)");
    }
  }
}

async function processProfitabilityMonitor() {
  logInfo("Starting profitability monitor run");

  // Task #1949 — typed array of `user_role` enum values. Previously this
  // was string-interpolated into a single bound parameter via
  // `sql\`... IN (${FINANCIAL_ROLES.map(r => \`'${r}'\`).join(",")})\``,
  // which Postgres saw as ONE quoted string literal containing
  // commas and crashed every 15 minutes with
  // `invalid input value for enum user_role: "'SUPER_ADMIN','ADMIN',..."`.
  // Use Drizzle's `inArray` so each role binds as its own parameter.
  const FINANCIAL_ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "HUSTLER"];
  const THRESHOLDS = [
    { pct: 5, label: "5%", severity: "MINOR_CONCERN" },
    { pct: 10, label: "10%", severity: "MINOR_CONCERN" },
    { pct: 20, label: "20%", severity: "MAJOR_RISK" },
  ];

  let profitabilityResults: Awaited<ReturnType<typeof calculateAllProjectsProfitability>>;
  try {
    profitabilityResults = await calculateAllProjectsProfitability();
  } catch (err) {
    logError("Profitability calculation error in monitor", { error: String(err) });
    return;
  }

  if (profitabilityResults.length === 0) return;

  const notificationValues: Array<{
    userId: string;
    organizationId: string;
    type: string;
    title: string;
    message: string;
    relatedEntityId: string | null;
    relatedEntityType: string;
  }> = [];

  for (const result of profitabilityResults) {
    const varianceAbs = Math.abs(result.variance_percent);
    const isOverBudget = result.variance < 0;
    if (!isOverBudget) continue;

    const [proj] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(sql`${projects.code} = ${result.project_code}`)
      .limit(1);

    if (!proj) continue;
    // Task #1949 — skip projects with no GC organization. The downstream
    // tables (`projectProfitabilitySnapshots`, `notifications`,
    // `users.organizationId`) all require a non-null org, and there is no
    // one to notify when the project isn't tied to an organization.
    if (!proj.gcOrganizationId) continue;
    const projOrgId: string = proj.gcOrganizationId;

    const [lastSnap] = await db.select()
      .from(projectProfitabilitySnapshots)
      .where(eq(projectProfitabilitySnapshots.projectId, proj.id))
      .orderBy(desc(projectProfitabilitySnapshots.createdAt))
      .limit(1);

    await db.insert(projectProfitabilitySnapshots).values({
      organizationId: projOrgId,
      projectId: proj.id,
      projectCode: result.project_code,
      budget: String(result.budget),
      adjustedBudget: String(result.adjusted_budget),
      totalLaborCost: String(result.total_labor_cost),
      totalMaterialCost: String(result.total_material_cost),
      totalSubcontractorCost: String(result.total_subcontractor_cost),
      totalEquipmentCost: String(result.total_equipment_cost),
      totalTmCost: String(result.total_tm_cost),
      totalOtherExpenses: String(result.total_other_expenses),
      totalActualCost: String(result.total_actual_cost),
      variance: String(result.variance),
      variancePercent: String(result.variance_percent),
      estimatedMargin: String(result.estimated_margin),
      projectedCompletionCost: String(result.projected_completion_cost),
      status: result.status,
      alertThresholdFired: null,
    });

    for (const threshold of THRESHOLDS) {
      if (varianceAbs < threshold.pct) continue;

      const alreadyFired = lastSnap?.alertThresholdFired === threshold.label;
      if (alreadyFired) continue;

      // Task #1949 — `proj` was selected with `gcOrganizationId`; the
      // stale `proj.organizationId` reference returned `undefined`,
      // which Drizzle then bound as NULL and caused the role-list crash
      // to silently match zero rows (when it didn't crash first). Use
      // the field that was actually selected.
      const orgUsers = await db.select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, projOrgId),
            inArray(users.role, FINANCIAL_ROLES),
            eq(users.isActive, true)
          )
        )
        .limit(50);

      const title = `Budget Alert: ${result.project_name} — ${threshold.label} Over`;
      const message = `${result.project_name} is running ${varianceAbs.toFixed(1)}% over budget. Actual cost: $${result.total_actual_cost.toLocaleString()} vs budget $${result.adjusted_budget.toLocaleString()}. Status: ${result.status.replace("_", " ")}.`;

      const existingNotifs = await db.select({ userId: notifications.userId })
        .from(notifications)
        .where(
          and(
            sql`${notifications.relatedEntityType} = 'PROJECT_PROFITABILITY'`,
            sql`${notifications.relatedEntityId} = ${proj.id}`,
            sql`${notifications.title} = ${title}`,
            eq(notifications.isRead, false)
          )
        );
      const alreadyNotifiedUsers = new Set(existingNotifs.map(n => n.userId));

      for (const u of orgUsers) {
        if (alreadyNotifiedUsers.has(u.id)) continue;
        notificationValues.push({
          userId: u.id,
          // Task #1949 — same stale-field fix: `proj` was selected with
          // `gcOrganizationId`, so `proj.organizationId` was always
          // undefined and the notifications inherited a NULL org.
          organizationId: projOrgId,
          type: "GENERAL",
          title,
          message,
          relatedEntityId: proj.id,
          relatedEntityType: "PROJECT_PROFITABILITY",
        });
      }

      await db.update(projectProfitabilitySnapshots)
        .set({ alertThresholdFired: threshold.label })
        .where(eq(projectProfitabilitySnapshots.projectId, proj.id));

      break;
    }
  }

  if (notificationValues.length > 0) {
    await insertNotifications(notificationValues as InsertNotification[]);
    logInfo("Profitability alert notifications sent", { count: notificationValues.length });
  }

  logInfo("Profitability monitor run complete", { projectsChecked: profitabilityResults.length });
}

async function processIdleOpportunities() {
  const IDLE_DAYS = 14;
  const cutoff = new Date(Date.now() - IDLE_DAYS * 24 * 60 * 60 * 1000);

  const openOpps = await db
    .select({
      id: crmOpportunities.id,
      name: crmOpportunities.name,
      organizationId: crmOpportunities.organizationId,
      assignedToId: crmOpportunities.assignedToId,
      contactId: crmOpportunities.contactId,
      stage: crmOpportunities.stage,
      updatedAt: crmOpportunities.updatedAt,
    })
    .from(crmOpportunities)
    .where(
      and(
        sql`${crmOpportunities.stage} NOT IN ('WON', 'LOST')`,
        lt(crmOpportunities.updatedAt, cutoff)
      )
    );

  if (openOpps.length === 0) {
    logInfo("Idle opportunity check: no idle deals found");
    return;
  }

  const oppIds = openOpps.map(o => o.id);
  const recentActivities = await db
    .select({ opportunityId: crmOpportunityActivities.opportunityId })
    .from(crmOpportunityActivities)
    .where(
      and(
        inArray(crmOpportunityActivities.opportunityId, oppIds),
        sql`${crmOpportunityActivities.createdAt} >= ${cutoff}`
      )
    );

  const activeOppIds = new Set(recentActivities.map(a => a.opportunityId));
  const idleOpps = openOpps.filter(o => !activeOppIds.has(o.id));

  if (idleOpps.length === 0) {
    logInfo("Idle opportunity check: all open deals had recent activity");
    return;
  }

  // Task #702: when an opportunity has no explicit assignee, fall back to
  // the contact owner so the relationship handoff still gets the nudge.
  const ownerlessContactIds = Array.from(new Set(
    idleOpps.filter(o => !o.assignedToId && o.contactId).map(o => o.contactId as string)
  ));
  const contactOwnerMap = new Map<string, string>();
  if (ownerlessContactIds.length > 0) {
    const ownerRows = await db
      .select({ id: crmContacts.id, ownerId: crmContacts.ownerId })
      .from(crmContacts)
      .where(inArray(crmContacts.id, ownerlessContactIds));
    for (const r of ownerRows) {
      if (r.ownerId) contactOwnerMap.set(r.id, r.ownerId);
    }
  }

  const assigneeMap = new Map<string, { userId: string; orgId: string; names: string[] }>();
  for (const opp of idleOpps) {
    const recipient = opp.assignedToId
      ?? (opp.contactId ? contactOwnerMap.get(opp.contactId) ?? null : null);
    if (!recipient) continue;
    const key = recipient;
    if (!assigneeMap.has(key)) {
      assigneeMap.set(key, { userId: recipient, orgId: opp.organizationId, names: [] });
    }
    assigneeMap.get(key)!.names.push(opp.name);
  }

  if (assigneeMap.size === 0) {
    logInfo("Idle opportunity check: no assigned users to notify");
    return;
  }

  const uniqueOrgIds = [...new Set([...assigneeMap.values()].map(e => e.orgId))];
  const orgSettings = await db
    .select({ organizationId: organizationNetworkSettings.organizationId, notifyInApp: organizationNetworkSettings.notifyInApp })
    .from(organizationNetworkSettings)
    .where(inArray(organizationNetworkSettings.organizationId, uniqueOrgIds));

  const orgNotifyMap = new Map<string, boolean>();
  for (const s of orgSettings) {
    orgNotifyMap.set(s.organizationId, s.notifyInApp);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const sentTodayRows = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        sql`${notifications.type} = 'CRM_IDLE_OPPORTUNITY'`,
        sql`${notifications.createdAt} >= ${todayStart}`
      )
    );

  const sentTodayUsers = new Set(sentTodayRows.map(n => n.userId));

  const toInsert: InsertNotification[] = [];

  for (const [, entry] of assigneeMap) {
    const inAppEnabled = orgNotifyMap.get(entry.orgId) ?? true;
    if (!inAppEnabled) continue;
    if (sentTodayUsers.has(entry.userId)) continue;

    const count = entry.names.length;
    const preview = entry.names.slice(0, 3).join(", ");
    const extra = count > 3 ? ` and ${count - 3} more` : "";
    toInsert.push({
      userId: entry.userId,
      organizationId: entry.orgId || null,
      type: "CRM_IDLE_OPPORTUNITY",
      title: `${count} pipeline deal${count !== 1 ? "s" : ""} need attention`,
      message: `No activity in ${IDLE_DAYS}+ days: ${preview}${extra}. Open the pipeline to follow up.`,
      relatedEntityType: "CRM_OPPORTUNITY",
    });
  }

  if (toInsert.length > 0) {
    await insertNotifications(toInsert);
    logInfo("Idle opportunity notifications sent", { count: toInsert.length });
  } else {
    logInfo("Idle opportunity check: all assignees already notified today or in-app disabled");
  }
}

async function processOrphanUploads() {
  const ORPHAN_CUTOFF_MINUTES = 30;
  const cutoff = new Date(Date.now() - ORPHAN_CUTOFF_MINUTES * 60 * 1000);

  const orphans = await db
    .select()
    .from(uploadIntents)
    .where(
      and(
        isNull(uploadIntents.confirmedAt),
        lt(uploadIntents.createdAt, cutoff)
      )
    )
    .limit(50);

  if (orphans.length === 0) return;

  logInfo("Processing orphan uploads", { count: orphans.length });

  const { ObjectStorageService } = await import("../objectStorage");
  const objectStorageService = new ObjectStorageService();

  let deleted = 0;
  let failed = 0;

  const { objectStorageClient } = await import("../objectStorage");

  for (const orphan of orphans) {
    try {
      const { bucketName, objectName } = parseBucketObjectPath(orphan.objectKey);

      try {
        const bucketRef = objectStorageClient.bucket(bucketName);
        const fileRef = bucketRef.file(objectName);
        const [exists] = await fileRef.exists();
        if (exists) {
          await fileRef.delete();
          logInfo("Deleted orphan GCS object", { objectKey: orphan.objectKey });
        }
      } catch (gcsErr) {
        logError("Failed to delete orphan GCS object", { objectKey: orphan.objectKey, error: String(gcsErr) });
        failed++;
        continue;
      }

      await db.delete(uploadIntents).where(eq(uploadIntents.id, orphan.id));
      deleted++;
    } catch (err) {
      logError("Error processing orphan upload", { intentId: orphan.id, error: String(err) });
      failed++;
    }
  }

  logInfo("Orphan upload cleanup complete", { deleted, failed });
}

async function processBidDueDateApproaching() {
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { domainEvents } = await import("@shared/schema");

  const upcomingBids = await db
    .select()
    .from(bids)
    .where(
      and(
        inArray(bids.status, ["ACTIVE", "SUBMITTED"]),
        isNotNull(bids.dueDate),
        gt(bids.dueDate, now),
        lte(bids.dueDate, in48h)
      )
    );

  if (upcomingBids.length === 0) return;

  const recentAlerts = await db
    .select({ payload: domainEvents.payload })
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.type, "bid.due_date_approaching"),
        gt(domainEvents.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))
      )
    );

  const alertedKeys = new Set<string>();
  for (const row of recentAlerts) {
    const p = row.payload as Record<string, unknown> | null;
    if (p && typeof p === "object" && typeof p.bidId === "string") {
      const hrs = typeof p.hoursRemaining === "number" ? p.hoursRemaining : 99;
      const threshold = hrs <= 24 ? "24h" : "48h";
      alertedKeys.add(`${p.bidId}:${threshold}`);
    }
  }

  let alerted = 0;
  for (const bid of upcomingBids) {
    if (!bid.dueDate) continue;
    const hoursRemaining = Math.round((bid.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60));
    const threshold = hoursRemaining <= 24 ? "24h" : "48h";
    const dedupeKey = `${bid.id}:${threshold}`;

    if (alertedKeys.has(dedupeKey)) continue;

    await eventBus.emit({
      type: "bid.due_date_approaching",
      version: 1,
      orgId: bid.gcOrganizationId || "",
      actorId: "system",
      timestamp: now,
      payload: {
        bidId: bid.id,
        bidCode: bid.code,
        title: bid.name,
        dueDate: bid.dueDate.toISOString(),
        hoursRemaining,
        estimatorId: bid.estimatorId,
      },
    });

    alerted++;
  }

  if (alerted > 0) {
    logInfo(`Bid due date approaching: alerted for ${alerted} bid(s)`);
  }
}

function parseBucketObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  const path = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  const parts = path.split("/");
  if (parts.length < 3) {
    throw new Error(`Invalid path: ${fullPath}`);
  }
  return {
    bucketName: parts[1],
    objectName: parts.slice(2).join("/"),
  };
}

let imapSyncRunning = false;
let imapSyncStartedAt: number | null = null;
const IMAP_SYNC_STALE_TIMEOUT_MS = 10 * 60 * 1000;

async function processImapEmailSync() {
  if (imapSyncRunning) {
    if (imapSyncStartedAt && Date.now() - imapSyncStartedAt > IMAP_SYNC_STALE_TIMEOUT_MS) {
      logError("IMAP sync lock appears stale, resetting", {
        startedAt: new Date(imapSyncStartedAt).toISOString(),
        staleDurationMs: Date.now() - imapSyncStartedAt,
      });
      imapSyncRunning = false;
      imapSyncStartedAt = null;
    } else {
      logInfo("IMAP sync already in progress, skipping");
      return;
    }
  }
  imapSyncRunning = true;
  imapSyncStartedAt = Date.now();

  try {
    const imapAccounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.isActive, true),
          eq(emailAccounts.provider, "IMAP"),
          isNotNull(emailAccounts.imapHost)
        )
      );

    if (imapAccounts.length === 0) return;

    logInfo("Processing IMAP email sync", { count: imapAccounts.length });

    for (const account of imapAccounts) {
      try {
        const result = await syncImapAccount(account, account.userId);
        if (result.messagesImported > 0) {
          logInfo("IMAP sync completed", {
            account: account.emailAddress,
            messagesImported: result.messagesImported,
            threadsCreated: result.threadsCreated,
          });
        }
        if (result.errors.length > 0) {
          logError("IMAP sync had errors", {
            account: account.emailAddress,
            errors: result.errors.slice(0, 3),
          });
        }
      } catch (err) {
        logError("IMAP sync failed for account", {
          account: account.emailAddress,
          error: String(err),
        });
      }
    }
  } finally {
    imapSyncRunning = false;
    imapSyncStartedAt = null;
  }
}

let providerSyncRunning = false;
let providerSyncStartedAt: number | null = null;
const PROVIDER_SYNC_STALE_TIMEOUT_MS = 5 * 60 * 1000;

async function processProviderEmailSync() {
  if (providerSyncRunning) {
    if (providerSyncStartedAt && Date.now() - providerSyncStartedAt > PROVIDER_SYNC_STALE_TIMEOUT_MS) {
      logError("Provider sync lock appears stale, resetting", {
        startedAt: new Date(providerSyncStartedAt).toISOString(),
      });
      providerSyncRunning = false;
      providerSyncStartedAt = null;
    } else {
      logInfo("Provider sync already in progress, skipping");
      return;
    }
  }
  providerSyncRunning = true;
  providerSyncStartedAt = Date.now();

  try {
    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.isActive, true),
          inArray(emailAccounts.provider, ["GMAIL", "OUTLOOK"]),
        )
      );

    if (accounts.length === 0) return;

    for (const account of accounts) {
      // Skip accounts that need user reconnection (e.g. scope upgrade)
      if (account.syncStatus === "NEEDS_RECONNECT") continue;
      try {
        // Drain any queued state push-backs (read/archive) before pulling new state
        await drainAccountProviderPushes(account);

        const result = account.provider === "GMAIL"
          ? await syncGmailAccount(account, account.userId)
          : await syncOutlookAccount(account, account.userId);
        if (result.messagesImported > 0) {
          logInfo(`${account.provider} sync completed`, {
            account: account.emailAddress,
            messagesImported: result.messagesImported,
            threadsCreated: result.threadsCreated,
          });
        }
        if (result.errors.length > 0) {
          logError(`${account.provider} sync had errors`, {
            account: account.emailAddress,
            errors: result.errors.slice(0, 3),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`${account.provider} sync failed for account`, {
          account: account.emailAddress,
          error: message,
        });
        try {
          // Persist failure state so it surfaces in the UI and the next run
          // can decide whether to retry or wait for reconnect.
          const isReconnect = /NEEDS_RECONNECT|invalid_grant|401|403/i.test(message);
          await db
            .update(emailAccounts)
            .set({
              syncStatus: isReconnect ? "NEEDS_RECONNECT" : "ERROR",
              lastSyncError: message.slice(0, 500),
              updatedAt: new Date(),
            })
            .where(eq(emailAccounts.id, account.id));
        } catch (persistErr) {
          logError("Failed to persist sync error state", { account: account.emailAddress }, persistErr instanceof Error ? persistErr : new Error(String(persistErr)));
        }
      }
    }
  } finally {
    providerSyncRunning = false;
    providerSyncStartedAt = null;
  }
}

let providerPushDrainRunning = false;
let providerPushDrainStartedAt: number | null = null;
const PROVIDER_PUSH_DRAIN_STALE_TIMEOUT_MS = 5 * 60 * 1000;

export async function processProviderPushDrain(): Promise<void> {
  if (providerPushDrainRunning) {
    if (
      providerPushDrainStartedAt &&
      Date.now() - providerPushDrainStartedAt > PROVIDER_PUSH_DRAIN_STALE_TIMEOUT_MS
    ) {
      logError("Provider push-back drain lock appears stale, resetting", {
        startedAt: new Date(providerPushDrainStartedAt).toISOString(),
      });
      providerPushDrainRunning = false;
      providerPushDrainStartedAt = null;
    } else {
      logInfo("Provider push-back drain already in progress, skipping");
      return;
    }
  }
  providerPushDrainRunning = true;
  providerPushDrainStartedAt = Date.now();

  try {
    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.isActive, true),
          inArray(emailAccounts.provider, ["GMAIL", "OUTLOOK"]),
        ),
      );

    if (accounts.length === 0) {
      logInfo("Provider push-back drain tick: no active Gmail/Outlook accounts");
      return;
    }

    let drained = 0;
    let skipped = 0;
    let failed = 0;
    for (const account of accounts) {
      if (account.syncStatus === "NEEDS_RECONNECT") {
        skipped++;
        continue;
      }
      try {
        await drainAccountProviderPushes(account);
        drained++;
      } catch (err) {
        failed++;
        logError("Provider push-back drain failed for account", {
          account: account.emailAddress,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logInfo("Provider push-back drain tick complete", {
      total: accounts.length,
      drained,
      skipped,
      failed,
    });
  } finally {
    providerPushDrainRunning = false;
    providerPushDrainStartedAt = null;
  }
}

async function processPeriodicReports(type: "WEEKLY" | "MONTHLY") {
  try {
    const { projectReports } = await import("@shared/schema/operations");
    const { aggregateReportData, generateReportPDF, streamToBuffer, persistPdfToStorage } = await import("../projectReportRoutes");
    const { sendEmail } = await import("../services/emailService");

    const settingCol = type === "WEEKLY" ? "auto_weekly" : "auto_monthly";
    const enabledResult = await db.execute(
      sql`SELECT p.id, p.gc_organization_id FROM projects p
          JOIN project_report_settings prs ON prs.project_id = p.id
          WHERE p.status = 'ACTIVE' AND prs.${sql.raw(settingCol)} = true`
    );
    const activeProjects = (enabledResult.rows || []) as Array<{ id: string; gc_organization_id: string }>;

    if (activeProjects.length === 0) return;

    const now = new Date();

    for (const project of activeProjects) {
      try {
        let startStr: string;
        let endStr: string;

        if (type === "WEEKLY") {
          const weekEnd = new Date(now);
          weekEnd.setDate(weekEnd.getDate() - 1);
          const weekStart = new Date(weekEnd);
          weekStart.setDate(weekStart.getDate() - 6);
          startStr = weekStart.toISOString().split("T")[0];
          endStr = weekEnd.toISOString().split("T")[0];
        } else {
          const monthEnd = new Date(now);
          monthEnd.setDate(monthEnd.getDate() - 1);
          const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 1);
          startStr = monthStart.toISOString().split("T")[0];
          endStr = monthEnd.toISOString().split("T")[0];
        }

        const existing = await db.select({ id: projectReports.id }).from(projectReports)
          .where(and(
            eq(projectReports.projectId, project.id),
            eq(projectReports.reportType, type),
            eq(projectReports.dateRangeStart, startStr),
          ));

        if (existing.length > 0) continue;

        const reportData = await aggregateReportData(project.id, startStr, endStr, type);
        const reportId = crypto.randomUUID();
        const pdfStorageKey = `reports/${project.id}/${reportId}.pdf`;

        try {
          const orgResult = await db.execute(
            sql`SELECT name, primary_color FROM organizations WHERE id = ${project.gcOrganizationId}`
          );
          const orgRow = (orgResult.rows || [])[0] as { name?: string; primary_color?: string } | undefined;
          const branding = {
            organizationName: orgRow?.name || "SmartManageAI",
            primaryColor: orgRow?.primary_color || "#1a365d",
          };
          const pdfStream = generateReportPDF(reportData, branding);
          const pdfBuffer = await streamToBuffer(pdfStream);
          await persistPdfToStorage(pdfStorageKey, pdfBuffer);
        } catch (pdfErr) {
          logError(`Failed to persist PDF for scheduled report ${reportId}`, {}, pdfErr instanceof Error ? pdfErr : new Error(String(pdfErr)));
        }

        const [report] = await db.insert(projectReports).values({
          id: reportId,
          projectId: project.id,
          reportType: type,
          title: `${type === "WEEKLY" ? "Weekly" : "Monthly"} Report: ${startStr} to ${endStr}`,
          dateRangeStart: startStr,
          dateRangeEnd: endStr,
          status: "COMPLETED",
          reportData,
          pdfStorageKey,
          generatedAt: now,
        }).returning();

        const settingsResult = await db.execute(
          sql`SELECT email_recipients FROM project_report_settings WHERE project_id = ${project.id}`
        );
        const settingsRow = (settingsResult.rows || [])[0] as { email_recipients?: string[] } | undefined;
        const lastRecipients = settingsRow?.email_recipients;

        const orgAdmins = await db.select({ id: users.id }).from(users)
          .where(and(
            eq(users.organizationId, project.gc_organization_id),
            inArray(users.role, ["SUPER_ADMIN", "ADMIN", "MANAGER"]),
          ));

        const projectName = reportData.project?.name || "Project";
        const reportLabel = type === "WEEKLY" ? "Weekly" : "Monthly";
        const notificationMessage = `${reportLabel} Progress Report for ${projectName} (${startStr} to ${endStr}) is ready.`;

        if (orgAdmins.length > 0) {
          try {
            const notifs: InsertNotification[] = orgAdmins.map(u => ({
              userId: u.id,
              type: "GENERAL" as const,
              title: `${reportLabel} Report Ready`,
              message: notificationMessage,
              organizationId: project.gc_organization_id,
              metadata: { projectId: project.id, reportId: report.id, reportType: type },
            }));
            await insertNotifications(notifs);
          } catch (notifErr) {
            logError("Failed to insert report notifications", { projectId: project.id, error: String(notifErr) });
          }
        }

        if (lastRecipients && Array.isArray(lastRecipients) && lastRecipients.length > 0) {
          try {
            await sendEmail({
              to: lastRecipients as string[],
              subject: `${reportLabel} Progress Report - ${projectName} (${startStr} to ${endStr})`,
              html: `<h2>${reportLabel} Progress Report</h2>
                <p><strong>Project:</strong> ${projectName}</p>
                <p><strong>Period:</strong> ${startStr} to ${endStr}</p>
                <p><strong>Labor Hours:</strong> ${reportData.labor?.totalHours || 0} (${reportData.labor?.uniqueWorkers || 0} workers)</p>
                <p><strong>Safety Incidents:</strong> ${reportData.safety?.totalIncidents || 0}</p>
                <p><strong>Schedule Tasks:</strong> ${reportData.schedule?.completedTasks || 0}/${reportData.schedule?.totalTasks || 0} completed</p>
                <p><strong>Change Orders:</strong> ${reportData.changeOrders?.total || 0}</p>
                ${reportData.healthScore !== null ? `<p><strong>Health Score:</strong> ${reportData.healthScore}/100</p>` : ""}
                <p>Log in to SmartManageAI to view the full report and download the PDF.</p>`,
            });
          } catch (emailErr) {
            logError("Failed to send periodic report email", { projectId: project.id, error: String(emailErr) });
          }
        }

        logInfo("Periodic report generated", { projectId: project.id, type, reportId: report.id });
      } catch (projErr) {
        logError("Periodic report failed for project", { projectId: project.id, error: String(projErr) });
      }
    }
  } catch (err) {
    logError("Periodic report processing error", { error: String(err) });
  }
}

async function processSocialEngagement() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const postedPosts = await db
    .select()
    .from(socialMediaPosts)
    .where(
      and(
        eq(socialMediaPosts.status, "POSTED"),
        isNotNull(socialMediaPosts.externalPostId),
        isNotNull(socialMediaPosts.socialAccountId),
        gte(socialMediaPosts.publishedAt, thirtyDaysAgo)
      )
    );

  if (postedPosts.length === 0) return;

  logInfo("Processing social engagement sync", { count: postedPosts.length });

  let updated = 0;
  let failed = 0;

  for (const post of postedPosts) {
    try {
      if (!post.socialAccountId || !post.externalPostId) continue;

      const account = await db.query.socialAccounts.findFirst({
        where: eq(socialAccounts.id, post.socialAccountId),
      });

      if (!account || !account.accessTokenEncrypted) continue;

      const engagement = await fetchEngagement(
        { externalPostId: post.externalPostId, platform: post.platform },
        { id: account.id, platform: account.platform, accountId: account.accountId, accessTokenEncrypted: account.accessTokenEncrypted, refreshTokenEncrypted: account.refreshTokenEncrypted }
      );

      if (engagement) {
        await db.execute(
          sql`UPDATE social_media_posts SET
            engagement_likes = ${engagement.likes},
            engagement_comments = ${engagement.comments},
            engagement_shares = ${engagement.shares},
            engagement_reach = ${engagement.reach},
            engagement_impressions = ${engagement.impressions},
            engagement_clicks = ${engagement.clicks},
            engagement_updated_at = NOW(),
            updated_at = NOW()
          WHERE id = ${post.id}`
        );
        updated++;
      }
    } catch (err) {
      failed++;
      logError("Engagement sync failed for post", { postId: post.id, error: String(err) });
    }
  }

  logInfo("Social engagement sync complete", { updated, failed, total: postedPosts.length });
}

async function runDbHealthCheck() {
  const start = Date.now();
  try {
    const result = await db.execute(sql`SELECT 1 AS ok, NOW() AS server_time`);
    const elapsed = Date.now() - start;
    if (elapsed > 5000) {
      logError("DB health check slow", { responseTimeMs: elapsed });
    } else {
      logInfo("DB health check passed", { responseTimeMs: elapsed });
    }

    const connResult = await db.execute(sql`
      SELECT numbackends AS active_connections, 
             datname AS database_name
      FROM pg_stat_database 
      WHERE datname = current_database()
    `);
    const row = (connResult.rows || [])[0] as { active_connections?: number } | undefined;
    if (row?.active_connections && Number(row.active_connections) > 80) {
      logError("DB connection pool nearing limit", { activeConnections: row.active_connections });
    }
  } catch (err) {
    logError("DB health check failed", { responseTimeMs: Date.now() - start, error: String(err) });
  }
}

async function processScheduledCampaigns() {
  const now = new Date();
  const claimed = await db
    .update(emailCampaigns)
    .set({ status: "SENDING" })
    .where(
      and(
        eq(emailCampaigns.status, "SCHEDULED"),
        lte(emailCampaigns.scheduledAt, now)
      )
    )
    .returning();

  if (claimed.length === 0) return;

  logInfo("Processing scheduled email campaigns", { count: claimed.length });

  for (const campaign of claimed) {
    try {

      const contacts = await db
        .select()
        .from(emailCampaignContacts)
        .where(
          and(
            eq(emailCampaignContacts.campaignId, campaign.id),
            eq(emailCampaignContacts.status, "PENDING")
          )
        );

      let totalSent = 0;
      let totalBounced = 0;

      for (const contact of contacts) {
        try {
          const campaignFrom = campaign.fromName
            ? `${campaign.fromName} <${campaign.replyTo || process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev'}>`
            : undefined;

          const success = await sendEmail({
            to: contact.email,
            subject: campaign.subject,
            html: campaign.htmlContent,
            text: campaign.textContent || undefined,
            from: campaignFrom,
            replyTo: campaign.replyTo || undefined,
          });

          if (success) {
            totalSent++;
            await db.update(emailCampaignContacts).set({ status: "SENT", sentAt: new Date() }).where(eq(emailCampaignContacts.id, contact.id));
          } else {
            totalBounced++;
            await db.update(emailCampaignContacts).set({ status: "BOUNCED", errorMessage: "Resend delivery failed — check sender domain verification" }).where(eq(emailCampaignContacts.id, contact.id));
          }
        } catch (err) {
          totalBounced++;
          const errMsg = err instanceof Error ? err.message : String(err);
          await db.update(emailCampaignContacts).set({ status: "FAILED", errorMessage: errMsg.substring(0, 500) }).where(eq(emailCampaignContacts.id, contact.id));
        }
      }

      await db.update(emailCampaigns).set({
        status: "SENT",
        sentAt: new Date(),
        totalRecipients: contacts.length,
        totalSent,
        totalBounced,
      }).where(eq(emailCampaigns.id, campaign.id));

      logInfo(`Scheduled campaign sent: "${campaign.name}"`, { id: campaign.id, totalSent, totalBounced });
    } catch (err) {
      logError(`Failed to process scheduled campaign: ${campaign.id}`, { error: String(err) });
      await db.update(emailCampaigns).set({ status: "FAILED" }).where(eq(emailCampaigns.id, campaign.id));
    }
  }
}

// Task #648: scheduled SLA breach sweep across all orgs.
async function processCrmSlaBreaches() {
  const { checkAndFlagSlaBreaches } = await import("../services/crmSlaService");
  const result = await checkAndFlagSlaBreaches();
  if (result.flagged > 0) {
    logInfo("CRM SLA breach sweep complete", { flagged: result.flagged });
  }
}

// Task #648: tick the automation engine for IDLE_DAYS triggers. For every
// active IDLE_DAYS automation we look for open opportunities in that org
// whose latest activity (or updatedAt fallback) is older than the configured
// idleDays threshold, then run the automation through the existing engine.
// We dedupe via crm_automation_runs so a deal that has already triggered the
// same automation in its current idle stretch doesn't get re-fired on every
// tick — but if the deal becomes active again and goes idle later, it will
// re-trigger.
async function processCrmIdleAutomations() {
  const automations = await db
    .select()
    .from(crmAutomations)
    .where(and(
      eq(crmAutomations.trigger, "IDLE_DAYS"),
      eq(crmAutomations.isActive, true),
    ));

  if (automations.length === 0) return;

  const { runSingleAutomation } = await import("../services/crmAutomationEngine");
  const now = Date.now();
  let totalFired = 0;

  // Group by org so we can do one opp/activity scan per org regardless of how
  // many IDLE_DAYS automations the org has. Each opportunity is then evaluated
  // against every automation individually so dedupe stays per (automation,
  // entity) and the engine isn't re-invoked redundantly.
  const byOrg = new Map<string, typeof automations>();
  for (const a of automations) {
    const list = byOrg.get(a.organizationId) ?? [];
    list.push(a);
    byOrg.set(a.organizationId, list);
  }

  for (const [orgId, orgAutomations] of byOrg) {
    try {
      // Use the smallest configured threshold to define the candidate window.
      const thresholds = orgAutomations.map((a) => {
        const cfg = (a.triggerConfig as Record<string, any>) || {};
        const raw = Number(cfg.idleDays);
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
      });
      const minThreshold = Math.min(...thresholds);
      const minCutoff = new Date(now - minThreshold * 24 * 60 * 60 * 1000);

      const candidates = await db
        .select({
          id: crmOpportunities.id,
          updatedAt: crmOpportunities.updatedAt,
        })
        .from(crmOpportunities)
        .where(and(
          eq(crmOpportunities.organizationId, orgId),
          sql`${crmOpportunities.stage} NOT IN ('WON', 'LOST')`,
          isNull(crmOpportunities.wonAt),
          isNull(crmOpportunities.lostAt),
          lt(crmOpportunities.updatedAt, minCutoff),
        ));

      if (candidates.length === 0) continue;

      const oppIds = candidates.map((c) => c.id);

      // True latest activity per opp = max(latest activity.createdAt,
      // opportunity.updatedAt). updatedAt is the fallback; activities advance
      // it independently of opportunity row writes, so we can't rely on
      // updatedAt alone.
      const latestActivityRows = await db
        .select({
          opportunityId: crmOpportunityActivities.opportunityId,
          latest: sql<Date>`max(${crmOpportunityActivities.createdAt})`,
        })
        .from(crmOpportunityActivities)
        .where(inArray(crmOpportunityActivities.opportunityId, oppIds))
        .groupBy(crmOpportunityActivities.opportunityId);
      const latestActivityByOpp = new Map<string, Date>();
      for (const r of latestActivityRows) {
        if (r.latest) latestActivityByOpp.set(r.opportunityId, new Date(r.latest as any));
      }

      type EnrichedOpp = { id: string; latestActivityAt: Date; idleDays: number };
      const enriched: EnrichedOpp[] = candidates.map((c) => {
        const fromActivity = latestActivityByOpp.get(c.id);
        const latestActivityAt = fromActivity && fromActivity > c.updatedAt ? fromActivity : c.updatedAt;
        const idleDays = Math.floor((now - latestActivityAt.getTime()) / (24 * 60 * 60 * 1000));
        return { id: c.id, latestActivityAt, idleDays };
      }).filter((o) => o.idleDays >= minThreshold);

      if (enriched.length === 0) continue;

      // Dedupe lookup: most recent SUCCESS run per (automation, entity) for
      // any of this org's IDLE_DAYS automations against any of these opps.
      const automationIds = orgAutomations.map((a) => a.id);
      // Only consider SUCCESS rows so a transient FAILED run on a previous
      // tick doesn't permanently suppress retries until the deal sees new
      // activity.
      const priorRuns = await db
        .select({
          automationId: crmAutomationRuns.automationId,
          entityId: crmAutomationRuns.entityId,
          createdAt: crmAutomationRuns.createdAt,
        })
        .from(crmAutomationRuns)
        .where(and(
          inArray(crmAutomationRuns.automationId, automationIds),
          eq(crmAutomationRuns.entityType, "OPPORTUNITY"),
          inArray(crmAutomationRuns.entityId, enriched.map((o) => o.id)),
          eq(crmAutomationRuns.status, "SUCCESS"),
        ));
      const lastRun = new Map<string, Date>(); // key: `${automationId}::${entityId}`
      for (const r of priorRuns) {
        const key = `${r.automationId}::${r.entityId}`;
        const prev = lastRun.get(key);
        if (!prev || r.createdAt > prev) lastRun.set(key, r.createdAt);
      }

      for (const opp of enriched) {
        for (let i = 0; i < orgAutomations.length; i++) {
          const auto = orgAutomations[i];
          const threshold = thresholds[i];
          if (opp.idleDays < threshold) continue;

          // Skip if a prior run for THIS automation+opp is newer than the
          // deal's last activity. A new idle stretch (after fresh activity)
          // will re-arm the automation.
          const last = lastRun.get(`${auto.id}::${opp.id}`);
          if (last && last > opp.latestActivityAt) continue;

          try {
            const ok = await runSingleAutomation(
              { id: auto.id, actions: auto.actions },
              {
                orgId,
                trigger: "IDLE_DAYS",
                entityType: "OPPORTUNITY",
                entityId: opp.id,
                context: { idleDays: opp.idleDays },
              },
            );
            if (ok) totalFired++;
          } catch (err) {
            logError("CRM idle automation fire failed", { automationId: auto.id, opportunityId: opp.id, error: String(err) });
          }
        }
      }
    } catch (err) {
      logError("CRM idle automation org iteration failed", { orgId, error: String(err) });
    }
  }

  if (totalFired > 0) {
    logInfo("CRM idle automations fired", { count: totalFired, automations: automations.length });
  }
}


// Task #698: per-user birthday reminder cadence. Returns a map of userId →
// cadence (defaults to DAILY_LOOKAHEAD when no row exists for the user, which
// matches the database default and preserves prior behaviour).
type BirthdayCadence = "OFF" | "DAILY_TODAY" | "DAILY_LOOKAHEAD" | "WEEKLY";
async function loadBirthdayCadences(userIds: string[]): Promise<Map<string, BirthdayCadence>> {
  const out = new Map<string, BirthdayCadence>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: notificationChannelPrefs.userId, cadence: notificationChannelPrefs.birthdayReminderCadence })
    .from(notificationChannelPrefs)
    .where(inArray(notificationChannelPrefs.userId, userIds));
  for (const r of rows) out.set(r.userId, (r.cadence as BirthdayCadence) ?? "DAILY_LOOKAHEAD");
  for (const id of userIds) if (!out.has(id)) out.set(id, "DAILY_LOOKAHEAD");
  return out;
}

// Server-side fallback timezone used when a recipient has no saved
// preference. We use process.env.TZ when set so operators can override the
// container's wall-clock zone via the standard env var; otherwise fall back
// to the process's resolved timezone, then UTC as a last resort.
export function getServerDefaultTimezone(): string {
  const envTz = process.env.TZ;
  if (envTz && isValidTimezone(envTz)) return envTz;
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && isValidTimezone(resolved)) return resolved;
  } catch {
    // ignore
  }
  return "UTC";
}

// Returns the weekday (0=Sun..6=Sat), hour (0-23), and calendar Y/M/D for
// `now` rendered in the given IANA timezone. Falls back to the server
// default zone if the supplied zone is invalid. Computing the calendar
// date in the recipient's zone is required so that the digest's
// "today / in N days" window matches the user's local date — a server in
// UTC can still be on Sunday while a user in Asia/Tokyo is already on
// their local Monday 8am.
export function getLocalDateParts(now: Date, timezone: string): {
  weekday: number;
  hour: number;
  year: number;
  month: number;
  day: number;
  tz: string;
} {
  const tz = isValidTimezone(timezone) ? timezone : getServerDefaultTimezone();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[get("weekday")] ?? 0;
  // Intl can return "24" for midnight in some locales — normalise to 0.
  let hour = parseInt(get("hour"), 10);
  if (!Number.isFinite(hour) || hour === 24) hour = 0;
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  return { weekday, hour, year, month, day, tz };
}

const BIRTHDAY_DIGEST_RELATED_ENTITY_TYPE = "CRM_CONTACT_BIRTHDAY";
const BIRTHDAY_DIGEST_DEDUPE_DAYS = 7;

export async function processCrmContactBirthdayDigest(opts: { ignoreTimeOfDay?: boolean } = {}) {
  const ignoreTimeOfDay = opts.ignoreTimeOfDay === true;
  const now = new Date();
  const serverTz = getServerDefaultTimezone();

  const orgsResult = await db.execute(
    sql`SELECT DISTINCT organization_id AS id FROM crm_contacts WHERE birthday IS NOT NULL`,
  );
  const orgs = (orgsResult.rows || []) as Array<{ id: string }>;
  if (orgs.length === 0) {
    // Task #700: still publish a zero-sample so the metrics surface shows
    // the job ran and produced no work this tick (helps distinguish a
    // stalled scheduler from a genuinely empty week).
    recordJobMetrics("crm_birthday_digest", {
      digestsSent: 0,
      skippedTimeOfDay: 0,
      skippedDedupe: 0,
      skippedNoBirthdays: 0,
      ignoreTimeOfDay: ignoreTimeOfDay ? 1 : 0,
    });
    return;
  }

  const horizonDays = 7;

  type ContactBirthday = { firstName: string | null; lastName: string | null; orgName: string | null; month: number; day: number };
  type UpcomingItem = { name: string; orgName: string | null; daysUntil: number; monthDay: string };

  // Build upcoming list anchored to a specific local date. We only care
  // about month/day for matching since birthdays repeat annually, so the
  // local Y/M/D drives the "today vs in N days" computation.
  function buildUpcoming(contacts: ContactBirthday[], localY: number, localM: number, localD: number): UpcomingItem[] {
    const todayDate = new Date(Date.UTC(localY, localM - 1, localD));
    const list: UpcomingItem[] = [];
    for (const c of contacts) {
      let next = new Date(Date.UTC(localY, c.month - 1, c.day));
      if (next < todayDate) next = new Date(Date.UTC(localY + 1, c.month - 1, c.day));
      const diffDays = Math.round((next.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= horizonDays) {
        list.push({
          name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
          orgName: c.orgName ?? null,
          daysUntil: diffDays,
          monthDay: `${c.month}/${c.day}`,
        });
      }
    }
    list.sort((a, b) => a.daysUntil - b.daysUntil);
    return list;
  }

  let totalDigests = 0;
  let totalSkippedTimeOfDay = 0;
  let totalSkippedDedupe = 0;
  let totalSkippedNoBirthdays = 0;

  for (const org of orgs) {
    try {
      // Task #696: respect per-user opt-out of the CRM birthday digest. We
      // LEFT JOIN user_settings so users who never visited the preferences
      // page (NULL row) keep the existing default-on behaviour. Only rows
      // explicitly flagged opt-out are excluded.
      const recipients = await db
        .select({
          id: users.id,
          timezone: users.timezone,
          weekdayPref: userSettings.birthdayDigestWeekday,
          hourPref: userSettings.birthdayDigestHour,
        })
        .from(users)
        .leftJoin(userSettings, eq(userSettings.userId, users.id))
        .where(and(
          eq(users.organizationId, org.id),
          eq(users.isActive, true),
          inArray(users.role, ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"]),
          or(
            isNull(userSettings.crmBirthdayDigestOptOut),
            eq(userSettings.crmBirthdayDigestOptOut, false),
          ),
        ));
      if (recipients.length === 0) continue;

      // Task #698: weekly digest only goes to users whose birthday reminder
      // cadence is explicitly WEEKLY. Default cadence is DAILY_LOOKAHEAD, so
      // existing users must opt in to keep receiving the weekly summary.
      const weeklyCadenceMap = await loadBirthdayCadences(recipients.map((r) => r.id));
      const weeklyRecipients = recipients.filter((r) => weeklyCadenceMap.get(r.id) === "WEEKLY");
      if (weeklyRecipients.length === 0) continue;

      // Resolve each recipient's effective timezone and current local
      // wall-clock once. We need both the time-of-day (to gate the user's
      // chosen weekday/hour) and the calendar Y/M/D (to compute the
      // upcoming-birthday window from the user's local date, not the
      // server's). Each user can pick their preferred delivery weekday/hour
      // in App Preferences; defaults are Mon 8am local.
      const recipientLocal = weeklyRecipients.map((u) => {
        const tz = u.timezone && isValidTimezone(u.timezone) ? u.timezone : serverTz;
        const local = getLocalDateParts(now, tz);
        const targetWeekday = u.weekdayPref ?? BIRTHDAY_DIGEST_DEFAULT_WEEKDAY;
        const targetHour = u.hourPref ?? BIRTHDAY_DIGEST_DEFAULT_HOUR;
        return { id: u.id, tz, local, targetWeekday, targetHour };
      });

      // Filter to recipients whose local wall-clock matches their preferred
      // weekday/hour. When triggered manually (ignoreTimeOfDay), keep all.
      const eligible = ignoreTimeOfDay
        ? recipientLocal
        : recipientLocal.filter((r) => {
            const match =
              r.local.weekday === r.targetWeekday &&
              r.local.hour === r.targetHour;
            if (!match) totalSkippedTimeOfDay++;
            return match;
          });
      if (eligible.length === 0) continue;

      // 7-day per-user dedupe: skip recipients who already received a
      // birthday digest within the rolling window. Belt-and-braces against
      // hourly cron drift, manual re-runs, and DST transitions that could
      // otherwise let two ticks both look like Monday 8am.
      const dedupeCutoff = new Date(now.getTime() - BIRTHDAY_DIGEST_DEDUPE_DAYS * 24 * 60 * 60 * 1000);
      const recentlyNotified = await db
        .select({ userId: notifications.userId })
        .from(notifications)
        .where(and(
          inArray(notifications.userId, eligible.map((u) => u.id)),
          eq(notifications.relatedEntityType, BIRTHDAY_DIGEST_RELATED_ENTITY_TYPE),
          gte(notifications.createdAt, dedupeCutoff),
        ));
      const recentlyNotifiedIds = new Set(recentlyNotified.map((r) => r.userId));
      const toNotify = eligible.filter((u) => {
        if (recentlyNotifiedIds.has(u.id)) {
          totalSkippedDedupe++;
          return false;
        }
        return true;
      });
      if (toNotify.length === 0) continue;

      // Load org contacts with valid birthday month/day once per org and
      // reuse the parsed list across recipients.
      const contactRows = await db
        .select({
          firstName: crmContacts.firstName,
          lastName: crmContacts.lastName,
          birthday: crmContacts.birthday,
          orgName: crmOrganisations.name,
        })
        .from(crmContacts)
        .leftJoin(crmOrganisations, eq(crmOrganisations.id, crmContacts.organisationId))
        .where(and(eq(crmContacts.organizationId, org.id), isNotNull(crmContacts.birthday)));

      const contacts: ContactBirthday[] = [];
      for (const c of contactRows) {
        const bd = c.birthday ? String(c.birthday) : null;
        const m = bd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(bd) : null;
        if (!m) continue;
        const month = parseInt(m[2], 10);
        const day = parseInt(m[3], 10);
        if (!month || !day) continue;
        contacts.push({ firstName: c.firstName, lastName: c.lastName, orgName: c.orgName, month, day });
      }

      // Group recipients by their local calendar date so we only build
      // the digest body once per (orgId, localYMD) bucket — every user in
      // the same local date sees an identical message.
      const byDate = new Map<string, typeof toNotify>();
      for (const r of toNotify) {
        const key = `${r.local.year}-${String(r.local.month).padStart(2, "0")}-${String(r.local.day).padStart(2, "0")}`;
        const bucket = byDate.get(key);
        if (bucket) bucket.push(r);
        else byDate.set(key, [r]);
      }

      const notifs: InsertNotification[] = [];
      for (const [, bucket] of byDate) {
        const sample = bucket[0].local;
        const upcoming = buildUpcoming(contacts, sample.year, sample.month, sample.day);
        if (upcoming.length === 0) {
          totalSkippedNoBirthdays += bucket.length;
          continue;
        }
        const lines = upcoming.map((u) => {
          const when = u.daysUntil === 0
            ? "today"
            : `in ${u.daysUntil} day${u.daysUntil === 1 ? "" : "s"} (${u.monthDay})`;
          return `${u.name}${u.orgName ? ` — ${u.orgName}` : ""}: ${when}`;
        });
        const message = `Upcoming contact birthdays this week:\n${lines.join("\n")}`;
        const title = upcoming.length === 1
          ? "1 contact birthday this week"
          : `${upcoming.length} contact birthdays this week`;
        for (const r of bucket) {
          notifs.push({
            userId: r.id,
            organizationId: org.id,
            type: "REMINDER" as const,
            title,
            message,
            relatedEntityType: BIRTHDAY_DIGEST_RELATED_ENTITY_TYPE,
          });
        }
      }

      if (notifs.length === 0) continue;
      await insertNotifications(notifs);
      totalDigests += notifs.length;
    } catch (err) {
      logError("CRM contact birthday digest org iteration failed", { orgId: org.id, error: String(err) });
    }
  }

  // Task #700: always record per-tick counters to the in-process metrics
  // surface so admins can spot regressions (DST bug spiking dedupe, empty
  // weeks dominated by no-birthdays, etc.) even on ticks that produced no
  // digests. Logging stays gated to noisy ticks to avoid log spam.
  recordJobMetrics("crm_birthday_digest", {
    digestsSent: totalDigests,
    skippedTimeOfDay: totalSkippedTimeOfDay,
    skippedDedupe: totalSkippedDedupe,
    skippedNoBirthdays: totalSkippedNoBirthdays,
    ignoreTimeOfDay: ignoreTimeOfDay ? 1 : 0,
  });

  if (totalDigests > 0 || totalSkippedDedupe > 0) {
    logInfo("CRM contact birthday digest tick", {
      notifications: totalDigests,
      skippedTimeOfDay: totalSkippedTimeOfDay,
      skippedDedupe: totalSkippedDedupe,
      skippedNoBirthdays: totalSkippedNoBirthdays,
      ignoreTimeOfDay,
    });
  }
}

// Task #706: one-off "Send a test now" trigger for the App Preferences UI.
// Builds the same digest the weekly tick would build, but for a single
// recipient and with both the time-of-day gate and the 7-day dedupe window
// bypassed so estimators can preview their digest immediately. The endpoint
// that calls this enforces its own rate limit to prevent abuse.
export async function sendCrmContactBirthdayDigestForUser(
  userId: string,
  organizationId: string,
): Promise<{
  sent: boolean;
  reason?: string;
  upcomingCount?: number;
  emailAttempted?: boolean;
  emailSent?: boolean;
  emailRecipient?: string | null;
}> {
  const now = new Date();
  const serverTz = getServerDefaultTimezone();

  const [user] = await db
    .select({
      id: users.id,
      timezone: users.timezone,
      email: users.email,
      firstName: users.firstName,
    })
    .from(users)
    .where(and(
      eq(users.id, userId),
      eq(users.organizationId, organizationId),
      eq(users.isActive, true),
    ))
    .limit(1);
  if (!user) return { sent: false, reason: "user_not_found" };

  const tz = user.timezone && isValidTimezone(user.timezone) ? user.timezone : serverTz;
  const local = getLocalDateParts(now, tz);

  const contactRows = await db
    .select({
      firstName: crmContacts.firstName,
      lastName: crmContacts.lastName,
      birthday: crmContacts.birthday,
      orgName: crmOrganisations.name,
    })
    .from(crmContacts)
    .leftJoin(crmOrganisations, eq(crmOrganisations.id, crmContacts.organisationId))
    .where(and(eq(crmContacts.organizationId, organizationId), isNotNull(crmContacts.birthday)));

  type ContactBirthday = { firstName: string | null; lastName: string | null; orgName: string | null; month: number; day: number };
  const contacts: ContactBirthday[] = [];
  for (const c of contactRows) {
    const bd = c.birthday ? String(c.birthday) : null;
    const m = bd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(bd) : null;
    if (!m) continue;
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (!month || !day) continue;
    contacts.push({ firstName: c.firstName, lastName: c.lastName, orgName: c.orgName, month, day });
  }

  const horizonDays = 7;
  const todayDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const upcoming = contacts
    .map((c) => {
      let next = new Date(Date.UTC(local.year, c.month - 1, c.day));
      if (next < todayDate) next = new Date(Date.UTC(local.year + 1, c.month - 1, c.day));
      const daysUntil = Math.round((next.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      return { c, daysUntil };
    })
    .filter((u) => u.daysUntil >= 0 && u.daysUntil <= horizonDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (upcoming.length === 0) {
    return { sent: false, reason: "no_upcoming_birthdays", upcomingCount: 0 };
  }

  const lines = upcoming.map((u) => {
    const name = `${u.c.firstName ?? ""} ${u.c.lastName ?? ""}`.trim();
    const when = u.daysUntil === 0
      ? "today"
      : `in ${u.daysUntil} day${u.daysUntil === 1 ? "" : "s"} (${u.c.month}/${u.c.day})`;
    return `${name}${u.c.orgName ? ` — ${u.c.orgName}` : ""}: ${when}`;
  });
  const title = upcoming.length === 1
    ? "1 contact birthday this week (test)"
    : `${upcoming.length} contact birthdays this week (test)`;
  const message = `Test digest — upcoming contact birthdays this week:\n${lines.join("\n")}`;

  await insertNotification({
    userId,
    organizationId,
    type: "REMINDER" as const,
    title,
    message,
    relatedEntityType: BIRTHDAY_DIGEST_RELATED_ENTITY_TYPE,
  });

  // Task #716: also email the digest to the requester so they can verify
  // formatting/deliverability outside the in-app notification surface. The
  // body mirrors the weekly tick's plain-text body, wrapped in a light HTML
  // shell consistent with other transactional emails (sendNotificationEmail).
  let emailAttempted = false;
  let emailSent = false;
  const recipientEmail = user.email && user.email.includes("@") ? user.email : null;
  if (recipientEmail) {
    emailAttempted = true;
    const greeting = user.firstName ? `Hi ${user.firstName},` : "Hi,";
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const listItemsHtml = upcoming
      .map((u) => {
        const name = `${u.c.firstName ?? ""} ${u.c.lastName ?? ""}`.trim();
        const when = u.daysUntil === 0
          ? "today"
          : `in ${u.daysUntil} day${u.daysUntil === 1 ? "" : "s"} (${u.c.month}/${u.c.day})`;
        const orgPart = u.c.orgName ? ` — ${escapeHtml(u.c.orgName)}` : "";
        return `<li style="margin: 4px 0;"><strong>${escapeHtml(name)}</strong>${orgPart}: ${escapeHtml(when)}</li>`;
      })
      .join("");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">${escapeHtml(title)}</h2>
        <p style="color: #666;">${escapeHtml(greeting)}</p>
        <p style="color: #666;">This is a test of your CRM contact birthday digest. Upcoming contact birthdays in the next 7 days:</p>
        <ul style="color: #333; line-height: 1.6; padding-left: 20px;">${listItemsHtml}</ul>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">This is a test message triggered from App Preferences &gt; Birthday Digest Delivery. The real weekly digest is delivered on your chosen weekday and hour.</p>
      </div>
    `;
    try {
      emailSent = await sendEmail({
        to: recipientEmail,
        subject: `[Test] ${title}`,
        html,
        text: message,
      });
    } catch (err) {
      logError("Birthday digest test email send threw", { userId, error: String(err) });
      emailSent = false;
    }
  }

  return {
    sent: true,
    upcomingCount: upcoming.length,
    emailAttempted,
    emailSent,
    emailRecipient: recipientEmail,
  };
}

// Task #693: daily morning email reminder routed to each contact's owner so
// account managers see today's birthdays even when they aren't in the app.
// Recipients are the contact's explicit ownerId (Task #699), falling back to
// createdById for legacy contacts that pre-date the owner field; contacts with
// no owner
// fall back to the org's admins/managers/estimators. Per-user opt-in/opt-out
// is honoured automatically by deliverNotification, which only sends email
// when the user has the email channel enabled for REMINDER notifications in
// notificationTypePrefs / notificationChannelPrefs.
async function processCrmContactBirthdayDailyDigest() {
  const orgsResult = await db.execute(
    sql`SELECT DISTINCT organization_id AS id FROM crm_contacts WHERE birthday IS NOT NULL AND is_active = true`,
  );
  const orgs = (orgsResult.rows || []) as Array<{ id: string }>;
  if (orgs.length === 0) return;

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();
  // Include the next 2 days as a gentle heads-up so owners can prepare
  // (e.g. send a card). Today still appears prominently in the digest.
  const horizonDays = 2;

  let totalDigests = 0;

  for (const org of orgs) {
    try {
      const contacts = await db
        .select({
          id: crmContacts.id,
          firstName: crmContacts.firstName,
          lastName: crmContacts.lastName,
          birthday: crmContacts.birthday,
          createdById: crmContacts.createdById,
          ownerId: crmContacts.ownerId,
          orgName: crmOrganisations.name,
        })
        .from(crmContacts)
        .leftJoin(crmOrganisations, eq(crmOrganisations.id, crmContacts.organisationId))
        .where(and(
          eq(crmContacts.organizationId, org.id),
          isNotNull(crmContacts.birthday),
          eq(crmContacts.isActive, true),
        ));

      type Item = { name: string; orgName: string | null; daysUntil: number; monthDay: string; ownerId: string | null };
      const matching: Item[] = [];
      for (const c of contacts) {
        const bd = c.birthday ? String(c.birthday) : null;
        const m = bd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(bd) : null;
        if (!m) continue;
        const month = parseInt(m[2], 10);
        const day = parseInt(m[3], 10);
        if (!month || !day) continue;
        const todayDate = new Date(todayY, todayM - 1, todayD);
        let next = new Date(todayY, month - 1, day);
        if (next < todayDate) next = new Date(todayY + 1, month - 1, day);
        const diffDays = Math.round((next.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0 || diffDays > horizonDays) continue;
        matching.push({
          name: `${c.firstName} ${c.lastName}`.trim(),
          orgName: c.orgName ?? null,
          daysUntil: diffDays,
          monthDay: `${month}/${day}`,
          ownerId: c.ownerId ?? c.createdById ?? null,
        });
      }

      if (matching.length === 0) continue;

      // Group items by owner. Items with no owner go to the org-wide bucket
      // (admins / managers / estimators) so they aren't dropped silently.
      const byOwner = new Map<string, Item[]>();
      const orphanItems: Item[] = [];
      for (const item of matching) {
        if (item.ownerId) {
          const arr = byOwner.get(item.ownerId) ?? [];
          arr.push(item);
          byOwner.set(item.ownerId, arr);
        } else {
          orphanItems.push(item);
        }
      }

      // Drop owner buckets whose items don't include a birthday today; the
      // daily digest is meant to surface today's birthdays specifically, and
      // owners with only +1/+2-day reminders shouldn't be emailed every
      // morning leading up to the date.
      for (const [ownerId, items] of Array.from(byOwner.entries())) {
        if (!items.some((i) => i.daysUntil === 0)) {
          byOwner.delete(ownerId);
        }
      }
      const orphanHasToday = orphanItems.some((i) => i.daysUntil === 0);
      if (byOwner.size === 0 && !orphanHasToday) continue;

      // Validate owner ids still belong to the org and are active users.
      let validOwnerIds = new Set<string>();
      const ownerIds = Array.from(byOwner.keys());
      if (ownerIds.length > 0) {
        const ownerRows = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            inArray(users.id, ownerIds),
            eq(users.organizationId, org.id),
            eq(users.isActive, true),
          ));
        validOwnerIds = new Set(ownerRows.map((r) => r.id));
      }

      // Drop items whose owner is no longer valid back into the orphan
      // bucket. (We've already filtered out owner buckets that lacked a
      // birthday today above, so any items moved here will include today.)
      let revalidatedOrphanHasToday = orphanHasToday;
      for (const ownerId of ownerIds) {
        if (!validOwnerIds.has(ownerId)) {
          const items = byOwner.get(ownerId) ?? [];
          orphanItems.push(...items);
          if (items.some((i) => i.daysUntil === 0)) revalidatedOrphanHasToday = true;
          byOwner.delete(ownerId);
        }
      }

      let fallbackRecipientIds: string[] = [];
      if (orphanItems.length > 0 && revalidatedOrphanHasToday) {
        const fallbackRows = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.organizationId, org.id),
            eq(users.isActive, true),
            inArray(users.role, ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"]),
          ));
        fallbackRecipientIds = fallbackRows.map((r) => r.id);
      }

      // Task #698: load cadence prefs for all candidate recipients (owners +
      // fallback) so we can drop OFF/WEEKLY users entirely and trim
      // lookahead-only items for users who chose DAILY_TODAY.
      const allRecipientIds = Array.from(new Set([...byOwner.keys(), ...fallbackRecipientIds]));
      const cadenceMap = await loadBirthdayCadences(allRecipientIds);
      const isDailyOptedIn = (id: string) => {
        const c = cadenceMap.get(id) ?? "DAILY_LOOKAHEAD";
        return c === "DAILY_TODAY" || c === "DAILY_LOOKAHEAD";
      };
      const trimItemsForCadence = (id: string, items: Item[]): Item[] => {
        const c = cadenceMap.get(id) ?? "DAILY_LOOKAHEAD";
        return c === "DAILY_TODAY" ? items.filter((i) => i.daysUntil === 0) : items;
      };

      const buildDigest = (items: Item[]): { title: string; message: string } => {
        items.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
        const todayCount = items.filter((i) => i.daysUntil === 0).length;
        const lines = items.map((u) => {
          const when = u.daysUntil === 0
            ? "today"
            : `in ${u.daysUntil} day${u.daysUntil === 1 ? "" : "s"} (${u.monthDay})`;
          return `${u.name}${u.orgName ? ` — ${u.orgName}` : ""}: ${when}`;
        });
        const header = todayCount > 0
          ? `Contact birthdays today${horizonDays > 0 ? " (and next few days)" : ""}:`
          : "Upcoming contact birthdays:";
        const message = `${header}\n${lines.join("\n")}`;
        const title = todayCount === 1
          ? "1 contact birthday today"
          : todayCount > 1
            ? `${todayCount} contact birthdays today`
            : `${items.length} upcoming contact birthday${items.length === 1 ? "" : "s"}`;
        return { title, message };
      };

      const notifs: InsertNotification[] = [];

      for (const [ownerId, items] of byOwner.entries()) {
        // Task #698: respect this owner's birthday cadence preference.
        if (!isDailyOptedIn(ownerId)) continue;
        const trimmed = trimItemsForCadence(ownerId, items);
        if (trimmed.length === 0) continue;
        const { title, message } = buildDigest(trimmed);
        notifs.push({
          userId: ownerId,
          organizationId: org.id,
          type: "REMINDER" as const,
          title,
          message,
          relatedEntityType: "CRM_CONTACT_BIRTHDAY",
        });
      }

      if (orphanItems.length > 0 && fallbackRecipientIds.length > 0) {
        for (const userId of fallbackRecipientIds) {
          if (!isDailyOptedIn(userId)) continue;
          const trimmed = trimItemsForCadence(userId, orphanItems);
          if (trimmed.length === 0) continue;
          const { title, message } = buildDigest(trimmed);
          notifs.push({
            userId,
            organizationId: org.id,
            type: "REMINDER" as const,
            title,
            message,
            relatedEntityType: "CRM_CONTACT_BIRTHDAY",
          });
        }
      }

      if (notifs.length === 0) continue;
      await insertNotifications(notifs);
      totalDigests += notifs.length;
    } catch (err) {
      logError("CRM contact birthday daily digest org iteration failed", { orgId: org.id, error: String(err) });
    }
  }

  if (totalDigests > 0) {
    logInfo("CRM contact birthday daily digest sent", { notifications: totalDigests });
  }
}

// Task #1116: weekly digest of certified payroll PDFs generated in the last 7
// days for each org's payroll administrators. Surfaces totals by project and
// form variant so payroll admins catch missing certified payrolls before DOT
// audits without having to visit /payroll/certified-history.
//
// Gates:
//   - Sender: org-level `organization_payroll_settings.work_week_end_notification_enabled`
//     must be true (or no settings row, in which case the org default of true
//     applies).
//   - Recipient: each user's effective `canManagePayroll` permission via the
//     same `getEffectivePermissions` resolver used by the API. Inactive users
//     and users in other orgs are filtered out automatically.
//   - Channel/email: each recipient's `notificationChannelPrefs` and
//     `notificationTypePrefs` decide whether the in-app row produced by
//     `insertNotifications` results in an email send (handled by
//     `deliverNotification`). Notification type is "REMINDER".
//
// Date range:
//   - Window is `[now - 7d, now]`.
//   - Encoded into `relatedEntityId` as `"YYYY-MM-DD|YYYY-MM-DD"` so the
//     email composer can produce a deep link to /payroll/certified-history
//     with the date range pre-applied.
export async function processCertifiedPayrollWeeklyDigest(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  // Task #1181: query a 14-day window so any org with BIWEEKLY cadence still
  // shows up; per-org gates below decide which subset of that window each
  // org's digest actually summarizes.
  const lookbackDays = 14;
  const lookbackSince = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const orgsResult = await db.execute(
    sql`SELECT DISTINCT organization_id AS id FROM certified_payroll_reports WHERE generated_at >= ${lookbackSince.toISOString()}`,
  );
  const orgs = (orgsResult.rows || []) as Array<{ id: string }>;
  if (orgs.length === 0) return;

  let totalDigests = 0;

  for (const org of orgs) {
    try {
      // Task #1181: pull the per-org cadence/weekday/hour/timezone alongside
      // the legacy `enabled` boolean. Backward compat: if there's no settings
      // row at all, treat it as the original Monday 8am UTC weekly schedule.
      const [settings] = await db
        .select({
          enabled: organizationPayrollSettings.workWeekEndNotificationEnabled,
          cadence: organizationPayrollSettings.certifiedPayrollDigestCadence,
          weekday: organizationPayrollSettings.certifiedPayrollDigestWeekday,
          hour: organizationPayrollSettings.certifiedPayrollDigestHour,
          timezone: organizationPayrollSettings.certifiedPayrollDigestTimezone,
          lastSentAt: organizationPayrollSettings.certifiedPayrollDigestLastSentAt,
        })
        .from(organizationPayrollSettings)
        .where(eq(organizationPayrollSettings.organizationId, org.id))
        .limit(1);

      // Org-level hard off-switch retained from Task #1116.
      if (settings && settings.enabled === false) continue;

      const cadence = (settings?.cadence ?? "WEEKLY") as "OFF" | "DAILY" | "WEEKLY" | "BIWEEKLY";
      if (cadence === "OFF") continue;

      const weekday = settings?.weekday ?? 1;
      const hour = settings?.hour ?? 8;
      const tz = settings?.timezone ?? "UTC";
      const lastSentAt = settings?.lastSentAt ?? null;

      const local = getLocalDateParts(now, tz);
      // Hour-precision gate (cron fires hourly).
      if (local.hour !== hour) continue;
      if ((cadence === "WEEKLY" || cadence === "BIWEEKLY") && local.weekday !== weekday) continue;
      if (cadence === "BIWEEKLY" && lastSentAt) {
        const daysSince = (now.getTime() - new Date(lastSentAt).getTime()) / (24 * 60 * 60 * 1000);
        if (daysSince < 13) continue;
      }
      // Idempotency: don't send the same daily/weekly digest twice in the
      // same firing hour (e.g. if cron fires twice or the job is run
      // manually). For DAILY skip if a digest has gone out in the last 23h.
      if (lastSentAt) {
        const hoursSince = (now.getTime() - new Date(lastSentAt).getTime()) / (60 * 60 * 1000);
        if (cadence === "DAILY" && hoursSince < 23) continue;
        if (cadence === "WEEKLY" && hoursSince < 23) continue;
      }

      const windowDays = cadence === "DAILY" ? 1 : cadence === "BIWEEKLY" ? 14 : 7;
      const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
      const startStr = since.toISOString().slice(0, 10);
      const endStr = now.toISOString().slice(0, 10);

      // Aggregate certified payroll reports for this org over the window,
      // grouped by project + variant.
      const rows = await db
        .select({
          projectId: certifiedPayrollReports.projectId,
          projectName: projects.name,
          variant: certifiedPayrollReports.variant,
          generatedAt: certifiedPayrollReports.generatedAt,
          payRunId: certifiedPayrollReports.payRunId,
        })
        .from(certifiedPayrollReports)
        .leftJoin(projects, eq(projects.id, certifiedPayrollReports.projectId))
        .where(and(
          eq(certifiedPayrollReports.organizationId, org.id),
          gte(certifiedPayrollReports.generatedAt, since),
        ));

      if (rows.length === 0) continue;

      type Bucket = { projectName: string; variant: string; count: number };
      const buckets = new Map<string, Bucket>();
      const projectIds = new Set<string>();
      for (const r of rows) {
        const projectName = r.projectName ?? "(All projects)";
        const key = `${projectName}\u0000${r.variant}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          buckets.set(key, { projectName, variant: r.variant, count: 1 });
        }
        if (r.projectId) projectIds.add(r.projectId);
      }

      const sorted = Array.from(buckets.values()).sort((a, b) => {
        if (a.projectName !== b.projectName) return a.projectName.localeCompare(b.projectName);
        return a.variant.localeCompare(b.variant);
      });

      // Resolve recipients: active users in the org whose effective
      // permissions include canManagePayroll.
      const orgUsers = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.organizationId, org.id), eq(users.isActive, true)));

      const recipientIds: string[] = [];
      for (const u of orgUsers) {
        try {
          const perms = await getEffectivePermissions(u.id, org.id, u.role);
          if (perms.canManagePayroll) recipientIds.push(u.id);
        } catch (err) {
          logError("Certified payroll digest: failed resolving permissions", { userId: u.id, orgId: org.id, error: String(err) });
        }
      }

      if (recipientIds.length === 0) continue;

      const totalReports = rows.length;
      const projectCount = projectIds.size + (rows.some((r) => !r.projectId) ? 1 : 0);
      const headerLine = `Certified payroll PDFs generated ${startStr} – ${endStr}: ${totalReports} report${totalReports === 1 ? "" : "s"} across ${projectCount} project${projectCount === 1 ? "" : "s"}.`;
      const breakdownLines = sorted.map((b) => `${b.projectName} — ${b.variant}: ${b.count}`);
      const message = [headerLine, "", ...breakdownLines].join("\n");
      const title = `Weekly certified payroll digest: ${totalReports} report${totalReports === 1 ? "" : "s"}`;

      const notifs: InsertNotification[] = recipientIds.map((userId) => ({
        userId,
        organizationId: org.id,
        type: "REMINDER" as const,
        title,
        message,
        relatedEntityType: "CERTIFIED_PAYROLL_DIGEST",
        relatedEntityId: `${startStr}|${endStr}`,
      }));

      await insertNotifications(notifs);
      totalDigests += notifs.length;

      // Task #1181: stamp lastSentAt so BIWEEKLY skips its off-week and
      // DAILY/WEEKLY can't double-fire within the same hour. Upsert if
      // there's no settings row yet (org was running on defaults).
      try {
        if (settings) {
          await db
            .update(organizationPayrollSettings)
            .set({ certifiedPayrollDigestLastSentAt: now, updatedAt: new Date() })
            .where(eq(organizationPayrollSettings.organizationId, org.id));
        } else {
          await db
            .insert(organizationPayrollSettings)
            .values({ organizationId: org.id, certifiedPayrollDigestLastSentAt: now });
        }
      } catch (err) {
        logError("Certified payroll digest: failed to stamp lastSentAt", { orgId: org.id, error: String(err) });
      }
    } catch (err) {
      logError("Certified payroll weekly digest org iteration failed", { orgId: org.id, error: String(err) });
    }
  }

  if (totalDigests > 0) {
    logInfo("Certified payroll weekly digest sent", { notifications: totalDigests });
  }
}

// ============================================================
// Task #1606: per-project scheduled RFI / submittal log emails
// ============================================================
//
// Each row in `project_log_email_schedules` represents one project +
// log type (RFI or SUBMITTAL) and carries its own cadence, weekday,
// hour, and timezone. The cron tick is hourly; this function decides
// which rows are *due* this tick by mirroring the gating logic the
// certified-payroll digest uses (Task #1181):
//
//   - cadence === "OFF"            → skip
//   - local hour !== row.hour      → skip (cron is hour-precision)
//   - WEEKLY/BIWEEKLY: weekday gate against the local weekday
//   - BIWEEKLY: skip if lastSentAt < 13 days ago
//   - DAILY/WEEKLY: skip if lastSentAt < 23 hours ago (idempotency
//     against duplicate cron firings or manual re-runs)
//
// Recipients are derived from `project_email_distribution_lists` —
// project-scoped lists for the project plus org-level lists with a
// NULL projectId — so existing distribution-list management screens
// already cover who gets what without a parallel "who do I email"
// concept on the schedule row itself. If no list resolves to any
// addresses we log + skip (no point materialising a PDF nobody
// receives).
//
// On a successful send we stamp `lastSentAt` so the dedupe gates
// above will keep us from double-firing.
//
// Task #1638 — the per-row "do the send" path is factored into
// `executeProjectLogEmailScheduleSend` below so the new manual
// `POST .../send-now` endpoint can run the exact same
// flatten-recipients → build PDF → send → stamp-outcome pipeline
// without duplicating the logic. The cron retains its gating logic
// here (cadence/weekday/hour/lastSentAt dedupe) and just delegates
// the actual send.
export async function processProjectLogEmailSchedules(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();

  const schedules = await db
    .select({
      id: projectLogEmailSchedules.id,
      organizationId: projectLogEmailSchedules.organizationId,
      projectId: projectLogEmailSchedules.projectId,
      logType: projectLogEmailSchedules.logType,
      cadence: projectLogEmailSchedules.cadence,
      weekday: projectLogEmailSchedules.weekday,
      hour: projectLogEmailSchedules.hour,
      timezone: projectLogEmailSchedules.timezone,
      lastSentAt: projectLogEmailSchedules.lastSentAt,
      // Task #1637 — pulled so the failure fan-out can target the
      // last editor of the cadence, and so the dedupe gate can skip
      // sending a fresh notification when the most recent failure
      // has already been notified about.
      lastEditedById: projectLogEmailSchedules.lastEditedById,
      lastFailureNotifiedStatus: projectLogEmailSchedules.lastFailureNotifiedStatus,
      // Task #1651 — pulled so the helper can compute the
      // pre-attempt streak that drives the threshold backstop. Reads
      // from a single sweep SELECT instead of a per-schedule lookup
      // inside the helper to keep the cron's DB chatter linear.
      consecutiveFailureCount: projectLogEmailSchedules.consecutiveFailureCount,
    })
    .from(projectLogEmailSchedules)
    .where(ne(projectLogEmailSchedules.cadence, "OFF"));

  if (schedules.length === 0) return;

  let totalSent = 0;

  for (const sched of schedules) {
    const cadence = sched.cadence as "OFF" | "DAILY" | "WEEKLY" | "BIWEEKLY";
    if (cadence === "OFF") continue;

    const weekday = sched.weekday ?? 1;
    const hour = sched.hour ?? 8;
    const tz = isValidTimezone(sched.timezone) ? sched.timezone : "UTC";
    const lastSentAt = sched.lastSentAt;

    const local = getLocalDateParts(now, tz);
    if (local.hour !== hour) continue;
    if ((cadence === "WEEKLY" || cadence === "BIWEEKLY") && local.weekday !== weekday) continue;
    if (cadence === "BIWEEKLY" && lastSentAt) {
      const daysSince = (now.getTime() - new Date(lastSentAt).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSince < 13) continue;
    }
    if (lastSentAt) {
      const hoursSince = (now.getTime() - new Date(lastSentAt).getTime()) / (60 * 60 * 1000);
      if ((cadence === "DAILY" || cadence === "WEEKLY") && hoursSince < 23) continue;
    }

    const result = await executeProjectLogEmailScheduleSend(
      {
        scheduleId: sched.id,
        organizationId: sched.organizationId,
        projectId: sched.projectId,
        logType: sched.logType,
        // Task #1651 — pass the pre-attempt streak through so the
        // helper can edge-trigger the threshold backstop without
        // needing its own SELECT.
        previousConsecutiveFailureCount: sched.consecutiveFailureCount ?? 0,
      },
      // Task #1652 — tag the per-attempt history row as a CRON tick
      // so the project settings panel can distinguish scheduled runs
      // from admin-triggered "Send now" retries.
      { now, triggeredBy: { kind: "CRON" } },
    );

    if (result.status === "SUCCESS") {
      totalSent += 1;
      // Task #1637 — clear the failure-notification dedupe marker on
      // success so the *next* failure starts a brand-new notification
      // cycle instead of being silently swallowed because it happens
      // to match the previously-notified status. The shared helper
      // (Task #1638) doesn't know about this column since the manual
      // send-now path also clears it on success via the same logic
      // applied here for the cron path. lastFailureNotifiedAt is
      // left as-is for forensic history.
      if (sched.lastFailureNotifiedStatus !== null) {
        await db
          .update(projectLogEmailSchedules)
          .set({
            lastFailureNotifiedStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(projectLogEmailSchedules.id, sched.id));
      }
      continue;
    }

    if (result.status === "PROJECT_NOT_FOUND") {
      // No project means no actionable deep-link to surface — skip
      // the notification rather than emit one that goes nowhere.
      continue;
    }

    if (result.status === "FAILURE" || result.status === "NO_RECIPIENTS") {
      // Task #1637 — fan a one-shot in-app notification to the
      // schedule's last editor + the project manager. The dedupe
      // gate inside the helper compares `previousStatus` against the
      // new status so a persistent failure isn't re-notified every
      // cron tick, while a transition (e.g. NO_RECIPIENTS -> FAILURE)
      // does send a fresh notification. We re-query the project here
      // to pick up `code` (used as the deep-link relatedEntityId) and
      // the project manager id (second recipient). If the project
      // was deleted between the helper's lookup and now, skip the
      // notification rather than emit one with no actionable URL.
      try {
        const [projInfo] = await db
          .select({
            code: projects.code,
            name: projects.name,
            projectManagerId: projects.projectManagerId,
          })
          .from(projects)
          .where(eq(projects.id, sched.projectId))
          .limit(1);
        if (projInfo) {
          await maybeNotifyProjectLogEmailFailure({
            scheduleId: sched.id,
            organizationId: sched.organizationId,
            logType: sched.logType === "SUBMITTAL" ? "SUBMITTAL" : "RFI",
            status: result.status,
            previousStatus: sched.lastFailureNotifiedStatus,
            lastEditedById: sched.lastEditedById,
            projectManagerId: projInfo.projectManagerId,
            projectCode: projInfo.code,
            projectName: projInfo.name,
            reason: result.error ?? "Unknown error",
            now,
          });
        }
      } catch (notifyErr) {
        logError("Failed to fan out project log email failure notification", {
          scheduleId: sched.id,
          error: String(notifyErr),
        });
      }
    }
  }

  if (totalSent > 0) {
    logInfo("Project log email schedules sent", { sent: totalSent });
  }
}

/**
 * Task #1638 — shared helper that runs the per-schedule send pipeline
 * (flatten distribution-list recipients → build the log PDF → call
 * `sendEmailWithResult` → stamp the per-attempt outcome columns on
 * the schedule row). Used by both:
 *
 *   1. The hourly cron in `processProjectLogEmailSchedules` after it
 *      decides a row is due, and
 *   2. The new manual `POST /api/projects/:projectId/log-email-schedules/:logType/send-now`
 *      endpoint that lets an admin retry immediately after fixing a
 *      bad distribution list, instead of waiting up to a week for
 *      the next WEEKLY tick.
 *
 * The helper is intentionally GATING-FREE — it always attempts the
 * send and stamps `lastSentAt` on success (so a manual send still
 * counts toward the cadence dedupe window and the next cron tick
 * won't double-fire). Callers that need cadence/weekday/hour gating
 * (i.e. the cron) apply it before calling.
 */
export interface ExecuteProjectLogEmailScheduleSendInput {
  scheduleId: string;
  organizationId: string;
  projectId: string;
  logType: string;
  // Task #1651 — running tally of consecutive FAILURE / NO_RECIPIENTS
  // attempts on this schedule before the current one, read from
  // `project_log_email_schedules.consecutive_failure_count` by the
  // caller. The cron loads it as part of its sweep SELECT and the
  // send-now route reads it from the existing schedule row. Defaults
  // to 0 when the caller doesn't pass it (older callers / tests),
  // which keeps the threshold backstop quiet rather than firing a
  // spurious alert on the very first observed failure.
  previousConsecutiveFailureCount?: number;
}

export type ProjectLogEmailScheduleSendStatus =
  | "SUCCESS"
  | "FAILURE"
  | "NO_RECIPIENTS"
  | "PROJECT_NOT_FOUND";

export interface ExecuteProjectLogEmailScheduleSendResult {
  status: ProjectLogEmailScheduleSendStatus;
  error: string | null;
  recipientCount: number;
  // Task #1651 — counter value persisted on the schedule row after
  // this attempt: 0 on SUCCESS, previous + 1 on FAILURE /
  // NO_RECIPIENTS, unchanged (= input previous) on PROJECT_NOT_FOUND
  // since the helper bails before stamping the row in that branch.
  // Callers can use it to drive their own UX (e.g. the send-now route
  // can surface "this is the 3rd failure in a row").
  consecutiveFailureCount: number;
}

// Task #1652 — every call to the helper records who/what triggered
// the send so the new per-schedule history table can show admins
// "this was a cron tick at 8:00am" vs "this was Jane manually
// retrying at 8:42am after fixing the address book". The cron path
// passes { kind: "CRON" }; the manual `POST .../send-now` route
// passes { kind: "MANUAL", userId } from the authenticated request.
export type ProjectLogEmailScheduleSendTrigger =
  | { kind: "CRON" }
  | { kind: "MANUAL"; userId: string | null };

export async function executeProjectLogEmailScheduleSend(
  input: ExecuteProjectLogEmailScheduleSendInput,
  opts: { now?: Date; triggeredBy?: ProjectLogEmailScheduleSendTrigger } = {},
): Promise<ExecuteProjectLogEmailScheduleSendResult> {
  const now = opts.now ?? new Date();
  const logType = input.logType === "SUBMITTAL" ? "SUBMITTAL" : "RFI";
  const previousConsecutiveFailureCount = Math.max(
    0,
    input.previousConsecutiveFailureCount ?? 0,
  );
  // Task #1651 — every failed branch increments by 1; SUCCESS resets
  // to 0. We compute it once per branch so the threshold-crossing
  // check after the update can use the same value the row was just
  // stamped with.
  const nextFailureCount = previousConsecutiveFailureCount + 1;
  // Task #1652 — default to CRON so existing callers (and tests) that
  // haven't been updated still produce a valid history row. The cron
  // path always passes the trigger explicitly below.
  const trigger: ProjectLogEmailScheduleSendTrigger = opts.triggeredBy ?? { kind: "CRON" };

  // Task #1652 — small helper so each of the four exit paths
  // (NO_RECIPIENTS, transport FAILURE, SUCCESS, catch FAILURE)
  // writes exactly one immutable history row with the same shape.
  // Wrapped in its own try/catch so a history-write failure can
  // never mask the real per-attempt outcome we want to return.
  async function recordAttempt(args: {
    status: "SUCCESS" | "FAILURE" | "NO_RECIPIENTS";
    error: string | null;
    recipientCount: number;
  }): Promise<void> {
    try {
      await db.insert(projectLogEmailScheduleAttempts).values({
        scheduleId: input.scheduleId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        logType,
        status: args.status,
        error: args.error,
        recipientCount: args.recipientCount,
        triggerType: trigger.kind,
        triggeredById: trigger.kind === "MANUAL" ? trigger.userId : null,
        createdAt: now,
      });
    } catch (histErr) {
      logError("Failed to record project log email schedule attempt history", {
        scheduleId: input.scheduleId,
        status: args.status,
        error: String(histErr),
      });
    }
  }

  try {
    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        code: projects.code,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      // Defensive: the cron filters by schedule rows whose projectId
      // exists, but if the project was deleted between the schedule
      // load and now, surface it cleanly instead of throwing. We
      // deliberately leave the counter alone — there's nothing
      // actionable for an admin to fix, and the schedule row will be
      // GC'd by the FK cascade once the project deletion settles.
      return {
        status: "PROJECT_NOT_FOUND",
        error: "Project not found.",
        recipientCount: 0,
        consecutiveFailureCount: previousConsecutiveFailureCount,
      };
    }

    // Distribution lists: project-scoped + org-level fallback.
    const lists = await db
      .select({
        contactEmails: projectEmailDistributionLists.contactEmails,
        extraEmails: projectEmailDistributionLists.extraEmails,
      })
      .from(projectEmailDistributionLists)
      .where(and(
        eq(projectEmailDistributionLists.organizationId, input.organizationId),
        or(
          eq(projectEmailDistributionLists.projectId, input.projectId),
          isNull(projectEmailDistributionLists.projectId),
        ),
      ));

    const recipientSet = new Set<string>();
    for (const l of lists) {
      for (const e of l.contactEmails ?? []) {
        if (e && e.includes("@")) recipientSet.add(e.trim().toLowerCase());
      }
      for (const e of l.extraEmails ?? []) {
        if (e && e.includes("@")) recipientSet.add(e.trim().toLowerCase());
      }
    }

    if (recipientSet.size === 0) {
      // Task #1622 — stamp NO_RECIPIENTS so the project settings UI
      // can surface "Last send failed" with a clear hint to fix the
      // distribution lists. Note we deliberately do NOT touch
      // `lastSentAt` here so the cadence dedupe windows continue to
      // treat this as "never sent" and keep retrying on the next
      // firing — the only thing that changes is that admins now have
      // an in-app signal that nothing went out.
      const noRecipientsError = "No recipients resolved from the project's distribution lists.";
      logInfo("Project log email schedule has no recipients; skipping", {
        scheduleId: input.scheduleId,
        projectId: input.projectId,
        logType,
      });
      await db
        .update(projectLogEmailSchedules)
        .set({
          lastAttemptAt: now,
          lastAttemptStatus: "NO_RECIPIENTS",
          lastAttemptError: noRecipientsError,
          lastAttemptRecipientCount: 0,
          // Task #1651 — bump the streak so a quietly-empty
          // distribution list can still trip the backstop notification
          // once it crosses the threshold.
          consecutiveFailureCount: nextFailureCount,
          updatedAt: new Date(),
        })
        .where(eq(projectLogEmailSchedules.id, input.scheduleId));
      await maybeNotifyProjectLogEmailRepeatedFailure({
        scheduleId: input.scheduleId,
        organizationId: input.organizationId,
        logType,
        previousCount: previousConsecutiveFailureCount,
        newCount: nextFailureCount,
        reason: noRecipientsError,
        projectName: project.name,
        projectCode: project.code,
      });
      // Task #1652 — append the per-attempt audit row alongside the
      // schedule-row stamp + threshold-backstop fan-out.
      await recordAttempt({ status: "NO_RECIPIENTS", error: noRecipientsError, recipientCount: 0 });
      return {
        status: "NO_RECIPIENTS",
        error: noRecipientsError,
        recipientCount: 0,
        consecutiveFailureCount: nextFailureCount,
      };
    }

    const pdfBuffer = await buildProjectLogPdfBuffer(logType, {
      id: project.id,
      name: project.name,
      gcOrganizationId: project.gcOrganizationId,
    });

    const logLabel = logType === "RFI" ? "RFI" : "Submittal";
    const safeName = project.name.replace(/[^a-z0-9]+/gi, "_");
    const filename = `${logType.toLowerCase()}-log-${safeName}.pdf`;
    const subject = `${logLabel} log — ${project.name}`;
    const text = `Attached is the latest ${logLabel} log for project "${project.name}".`;
    const html = `<p>Attached is the latest ${logLabel} log for project <strong>${project.name}</strong>.</p>`;

    const recipients = Array.from(recipientSet);
    const result = await sendEmailWithResult({
      to: recipients,
      subject,
      text,
      html,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
    });

    if (!result.ok) {
      // Task #1622 — record the FAILURE so the project settings panel
      // can show "Last send failed: <reason>". Like NO_RECIPIENTS we
      // skip stamping `lastSentAt` so the next cadence tick will try
      // again instead of believing today's send already happened.
      const errMsg = result.error ?? "Unknown email send error";
      logError("Project log email send failed", {
        scheduleId: input.scheduleId,
        projectId: input.projectId,
        logType,
        error: result.error,
        recipients: recipients.length,
      });
      await db
        .update(projectLogEmailSchedules)
        .set({
          lastAttemptAt: now,
          lastAttemptStatus: "FAILURE",
          lastAttemptError: errMsg,
          lastAttemptRecipientCount: recipients.length,
          // Task #1651 — bump the streak so the threshold backstop
          // notification can fire once enough consecutive failures
          // accumulate without forcing admins to poll the project
          // settings panel.
          consecutiveFailureCount: nextFailureCount,
          updatedAt: new Date(),
        })
        .where(eq(projectLogEmailSchedules.id, input.scheduleId));
      await maybeNotifyProjectLogEmailRepeatedFailure({
        scheduleId: input.scheduleId,
        organizationId: input.organizationId,
        logType,
        previousCount: previousConsecutiveFailureCount,
        newCount: nextFailureCount,
        reason: errMsg,
        projectName: project.name,
        projectCode: project.code,
      });
      // Task #1652 — append the per-attempt audit row for this
      // transport-FAILURE branch.
      await recordAttempt({ status: "FAILURE", error: errMsg, recipientCount: recipients.length });
      return {
        status: "FAILURE",
        error: errMsg,
        recipientCount: recipients.length,
        consecutiveFailureCount: nextFailureCount,
      };
    }

    await db
      .update(projectLogEmailSchedules)
      .set({
        lastSentAt: now,
        // Task #1622 — clear any prior failure marker on success so
        // the UI badge disappears as soon as the next scheduled run
        // recovers. We keep the recipient count + status so admins
        // can still see how many people received the most recent
        // successful send at a glance.
        lastAttemptAt: now,
        lastAttemptStatus: "SUCCESS",
        lastAttemptError: null,
        lastAttemptRecipientCount: recipients.length,
        // Task #1651 — a single successful send (manual or cron)
        // resets the consecutive-failure streak so a recovered
        // distribution list immediately clears the backstop counter
        // and the *next* failure starts a brand-new cycle.
        consecutiveFailureCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(projectLogEmailSchedules.id, input.scheduleId));

    // Task #1652 — append the per-attempt audit row for the
    // SUCCESS branch.
    await recordAttempt({ status: "SUCCESS", error: null, recipientCount: recipients.length });
    return {
      status: "SUCCESS",
      error: null,
      recipientCount: recipients.length,
      consecutiveFailureCount: 0,
    };
  } catch (err) {
    // Task #1622 — record an unexpected failure (PDF builder threw,
    // db lookup blew up, etc.) so it's visible in-app rather than
    // disappearing into the server log. Wrapped in its own try/catch
    // because we never want telemetry writes to mask the original
    // iteration error.
    const errMsg = err instanceof Error ? err.message : String(err);
    logError("Project log email schedule iteration failed", {
      scheduleId: input.scheduleId,
      projectId: input.projectId,
      logType,
      error: errMsg,
    });
    try {
      await db
        .update(projectLogEmailSchedules)
        .set({
          lastAttemptAt: now,
          lastAttemptStatus: "FAILURE",
          lastAttemptError: errMsg.slice(0, 500),
          // Task #1651 — even unexpected failures (PDF builder
          // threw, lookup blew up) count toward the consecutive
          // streak. From an admin's perspective the schedule is
          // broken regardless of which layer faulted, and the
          // backstop notification surface should react the same way.
          consecutiveFailureCount: nextFailureCount,
          updatedAt: new Date(),
        })
        .where(eq(projectLogEmailSchedules.id, input.scheduleId));
    } catch (stampErr) {
      logError("Failed to stamp project log email schedule failure", {
        scheduleId: input.scheduleId,
        error: String(stampErr),
      });
    }
    // Task #1651 — also try the threshold backstop on the catch path.
    // We don't have project name/code (the failure may have happened
    // mid-lookup) so we pass null and let the helper fall back to the
    // schedule id for the deep link. Wrapped in its own try/catch so
    // a failed fan-out can never mask the original iteration error.
    try {
      await maybeNotifyProjectLogEmailRepeatedFailure({
        scheduleId: input.scheduleId,
        organizationId: input.organizationId,
        logType,
        previousCount: previousConsecutiveFailureCount,
        newCount: nextFailureCount,
        reason: errMsg.slice(0, 500),
        projectName: null,
        projectCode: null,
      });
    } catch (notifyErr) {
      logError("Failed to fan out project log email repeated-failure notification", {
        scheduleId: input.scheduleId,
        error: String(notifyErr),
      });
    }
    // Task #1652 — record a history row for the catch-path FAILURE so
    // the audit trail covers unexpected exceptions (PDF builder threw,
    // db lookup blew up, etc.) the same way it covers the transport
    // FAILURE path above. `recordAttempt` is itself try/catch-wrapped
    // so it can never mask the original iteration error.
    await recordAttempt({ status: "FAILURE", error: errMsg.slice(0, 500), recipientCount: 0 });
    return {
      status: "FAILURE",
      error: errMsg,
      recipientCount: 0,
      consecutiveFailureCount: nextFailureCount,
    };
  }
}

// ============================================================
// Task #1637 — failure-notification fan-out helper
// ============================================================
//
// Called from `processProjectLogEmailSchedules` whenever an attempt
// transitions into FAILURE or NO_RECIPIENTS. Two behaviours combined
// in one place so the FAILURE path, the NO_RECIPIENTS path, and the
// catch path all stay consistent:
//
//   1. **Dedupe.** We compare the new attempt's status against
//      `previousStatus` (= the schedule's `lastFailureNotifiedStatus`
//      column we read into memory at the top of the sweep). If they
//      match, the same persistent failure has already been notified
//      about and we silently skip — this prevents the hourly cron
//      from re-pinging the editor every tick while the cadence stays
//      broken. A transition (e.g. NO_RECIPIENTS -> FAILURE) does
//      send a fresh notification because it represents a new failure
//      mode worth surfacing. The dedupe marker is cleared back to
//      NULL on a successful send so the *next* failure starts a
//      brand-new cycle.
//
//   2. **Fan-out.** We deliver to a deduped Set of {lastEditedById,
//      projectManagerId} so the schedule's last editor and the
//      project manager each get exactly one notification per
//      transition (and the same person filling both roles only gets
//      one). If neither id is set we still stamp the dedupe marker
//      so subsequent ticks won't keep re-evaluating an unactionable
//      row.
//
// The notification is typed `PROJECT_LOG_EMAIL_FAILED` and uses
// relatedEntityType `PROJECT_LOG_EMAIL_SCHEDULE` with the project's
// human-readable `code` as relatedEntityId. The client-side
// destination map (notificationDestination.ts) and the email
// composer's entityUrlMap (notificationDelivery.ts) both turn that
// into a `/projects/<code>` deep link, which lands on the project
// detail page where the "Scheduled log emails" card surfaces the
// "Last send failed" badge that the editor needs to act on.
async function maybeNotifyProjectLogEmailFailure(args: {
  scheduleId: string;
  organizationId: string;
  logType: "RFI" | "SUBMITTAL";
  status: "FAILURE" | "NO_RECIPIENTS";
  previousStatus: string | null;
  lastEditedById: string | null;
  projectManagerId: string | null;
  projectCode: string | null;
  projectName: string;
  reason: string;
  now: Date;
}): Promise<void> {
  // Dedupe: same failure mode already notified about? Skip the
  // fan-out but DON'T re-stamp — there's nothing new to record.
  if (args.previousStatus === args.status) return;

  const namedRecipientIds = new Set<string>();
  if (args.lastEditedById) namedRecipientIds.add(args.lastEditedById);
  if (args.projectManagerId) namedRecipientIds.add(args.projectManagerId);

  // Task #1672 — resolve the named recipients so we can filter out
  // anyone whose account has been deactivated. Pre-#1672 the worker
  // happily wrote a notification row for inactive users (matching the
  // "(inactive)" badge the project settings card surfaces), which
  // meant a schedule that started failing while both pointers (PM +
  // last editor) had been deactivated would silently drop its alerts:
  // the rows were created, but nobody could ever read them. Now we
  // (a) skip inactive named recipients on the per-transition fan-out
  // and (b) fall back to the org's admins/managers when zero active
  // named recipients remain so a stuck schedule still pings someone
  // with the authority to fix it. We scope the lookup to the
  // schedule's organization to defend against any cross-tenant
  // pointer drift — surfacing a recipient from a different org would
  // be both confusing and a privacy leak. Mirrors the same active/
  // inactive resolution the GET handler in
  // `projectLogEmailScheduleRoutes.ts` (Task #1655) does for the
  // settings card.
  const activeRecipientIds = new Set<string>();
  if (namedRecipientIds.size > 0) {
    const namedRows = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(and(
        inArray(users.id, Array.from(namedRecipientIds)),
        eq(users.organizationId, args.organizationId),
      ));
    for (const row of namedRows) {
      if (row.isActive) activeRecipientIds.add(row.id);
    }
  }

  const logLabel = args.logType === "SUBMITTAL" ? "submittal" : "RFI";
  const reasonLabel = args.status === "NO_RECIPIENTS"
    ? "no recipients resolved from the project's distribution lists"
    : args.reason;
  const baseTitle = args.status === "NO_RECIPIENTS"
    ? `Scheduled ${logLabel} log email skipped: ${args.projectName}`
    : `Scheduled ${logLabel} log email failed: ${args.projectName}`;
  const baseMessage = `The scheduled ${logLabel} log email for ${args.projectName} did not send — ${reasonLabel}.`;
  const relatedEntityId = args.projectCode ?? args.scheduleId;

  let routedTo: "named" | "admin_backstop" | "none" = "none";
  let backstopRecipientCount = 0;

  if (activeRecipientIds.size > 0) {
    routedTo = "named";
    const notifs: InsertNotification[] = Array.from(activeRecipientIds).map((userId) => ({
      userId,
      organizationId: args.organizationId,
      type: "PROJECT_LOG_EMAIL_FAILED" as const,
      title: baseTitle,
      message: baseMessage,
      relatedEntityType: "PROJECT_LOG_EMAIL_SCHEDULE",
      // Fall back to the schedule id when the project has no `code`
      // — keeps the notification record valid even if the deep-link
      // can't fully resolve.
      relatedEntityId,
    }));
    await insertNotifications(notifs);
  } else {
    // Task #1672 — zero active named recipients (either none
    // resolved at all, or every named recipient is deactivated).
    // Route the alert to the org's admins so a stuck schedule never
    // silently drops its alerts. We deliberately re-query rather
    // than reusing the repeated-failure backstop helper because the
    // signals mean different things: this fan-out fires on the
    // *very first* failure transition when the named pointers are
    // unactionable, while the repeated-failure backstop fires only
    // after the streak crosses a configurable threshold. Both can
    // legitimately fire on the same tick (and that's fine — admins
    // see one "named recipients are inactive" alert and one
    // "schedule has failed N times" alert, which is what you want
    // when both conditions are true). We also filter the admin pool
    // to active accounts so we don't cascade the same dead-mailbox
    // problem.
    const adminRows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.organizationId, args.organizationId),
        inArray(users.role, ["SUPER_ADMIN", "ADMIN", "MANAGER"]),
        eq(users.isActive, true),
      ));

    if (adminRows.length > 0) {
      routedTo = "admin_backstop";
      backstopRecipientCount = adminRows.length;
      const backstopTitle = args.status === "NO_RECIPIENTS"
        ? `Scheduled ${logLabel} log email skipped (no active recipients): ${args.projectName}`
        : `Scheduled ${logLabel} log email failed (no active recipients): ${args.projectName}`;
      const backstopMessage = namedRecipientIds.size > 0
        ? `${baseMessage} The project manager and the schedule's last editor are deactivated, so this alert is being routed to org admins instead.`
        : `${baseMessage} The schedule has no project manager or last editor on file, so this alert is being routed to org admins instead.`;

      const notifs: InsertNotification[] = adminRows.map((row) => ({
        userId: row.id,
        organizationId: args.organizationId,
        type: "PROJECT_LOG_EMAIL_FAILED" as const,
        title: backstopTitle,
        message: backstopMessage,
        relatedEntityType: "PROJECT_LOG_EMAIL_SCHEDULE",
        relatedEntityId,
      }));
      await insertNotifications(notifs);

      // Task #1672 — surface the backstop fan-out in production
      // telemetry so on-call can see "we lost the named recipients
      // and routed to admins" without having to inspect the DB. A
      // warning level is appropriate: nothing is broken (the alert
      // landed somewhere), but the schedule is in a degraded state
      // until someone re-assigns a PM / last editor.
      logWarn("Project log email failure notification routed to org admin backstop", {
        scheduleId: args.scheduleId,
        organizationId: args.organizationId,
        status: args.status,
        namedRecipientCount: namedRecipientIds.size,
        activeRecipientCount: 0,
        backstopRecipientCount,
        reason: namedRecipientIds.size > 0
          ? "all_named_recipients_inactive"
          : "no_named_recipients",
      });
    } else {
      // No admins to notify either (rare — happens during initial
      // setup or after a bulk role/active change). We still stamp
      // the dedupe marker below so the row doesn't get re-evaluated
      // every tick; the project settings card remains the source of
      // truth for unattended failures. Log it loudly so on-call can
      // see that the alert was effectively dropped.
      logWarn("Project log email failure notification dropped — no active recipients and no admins to back-stop", {
        scheduleId: args.scheduleId,
        organizationId: args.organizationId,
        status: args.status,
        namedRecipientCount: namedRecipientIds.size,
      });
    }
  }

  // Stamp the dedupe marker regardless of whether we found someone
  // to notify so a schedule with no actionable recipients doesn't
  // get re-evaluated every tick.
  await db
    .update(projectLogEmailSchedules)
    .set({
      lastFailureNotifiedAt: args.now,
      lastFailureNotifiedStatus: args.status,
      updatedAt: new Date(),
    })
    .where(eq(projectLogEmailSchedules.id, args.scheduleId));

  logInfo("Project log email failure notification fanned out", {
    scheduleId: args.scheduleId,
    status: args.status,
    namedRecipients: namedRecipientIds.size,
    activeRecipients: activeRecipientIds.size,
    routedTo,
    backstopRecipientCount,
  });
}

// ============================================================
// Task #1651 — repeated-failure backstop notification
// ============================================================
//
// `maybeNotifyProjectLogEmailFailure` (Task #1637) only pings the
// schedule's last editor + project manager once per failure-mode
// transition. That's great for "the schedule just broke" but it
// silently stops nagging anyone after the first ping, so a chronically
// broken distribution list can keep failing every cron tick for weeks
// while the only signal lives on a project settings card nobody opens.
//
// This helper is the louder backstop. Once the schedule's
// `consecutive_failure_count` *crosses* a configurable threshold
// (default 3, env `PROJECT_LOG_EMAIL_FAILURE_THRESHOLD`), it fans an
// in-app notification to every ADMIN / MANAGER / SUPER_ADMIN in the
// project's organization so somebody with the authority to fix the
// distribution list actually sees it. We only fire on the *crossing*
// (previous < threshold && new >= threshold) so a streak that keeps
// climbing past the threshold doesn't spam the same admins on every
// subsequent tick — they'll get re-notified when the streak resets and
// re-crosses, which is exactly the "it broke again" signal we want.
//
// Task #1668 — the threshold is now ALSO overridable per-organization
// via `organizations.project_log_email_failure_threshold`. Resolution
// order, highest precedence first:
//   1. per-org column (when populated)
//   2. env var PROJECT_LOG_EMAIL_FAILURE_THRESHOLD (when valid)
//   3. hard-coded fallback (`PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD`)
// Each layer is independently validated so a garbled value in one tier
// silently falls through to the next instead of disabling the backstop.
// Validation asymmetry is intentional: the org-override path is
// reachable only via the admin API which clamps to [MIN..MAX] (1..50)
// using the shared schema bounds, whereas the env var path is an
// operator escape hatch that only requires "positive integer". Ops
// occasionally need to push the threshold above 50 temporarily during
// a known incident without a code change, so we deliberately don't
// re-apply the UI's 50 cap here.
const PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD = 3;

function isPositiveIntegerThreshold(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 1;
}

// Exported (kept from incoming `main` change) so callers outside this
// module — currently the worker test harness — can introspect the
// resolved threshold without re-implementing the precedence rules.
export function getProjectLogEmailFailureThreshold(orgOverride?: number | null): number {
  // Tier 1: per-org override. Validated the same way as the env var so
  // a stale/garbled DB value (shouldn't happen — the API guards on
  // write — but defensive in case of manual SQL) doesn't accidentally
  // fire the backstop on the very first failure.
  if (orgOverride !== undefined && orgOverride !== null) {
    if (isPositiveIntegerThreshold(orgOverride)) return orgOverride;
    // Fall through to env / default if the column value is junk.
  }
  // Tier 2: env override.
  const raw = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
  if (!raw) return PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD;
  // Guardrails: the env value must be a *whole positive integer* —
  // not just something `parseInt` happens to consume a prefix of.
  // `Number(raw)` is strict (returns NaN for "3abc" and 1.5 for
  // "1.5"), then we additionally reject non-integer / non-positive
  // values so a typo like "3.5" or "1abc" silently falls back to the
  // default rather than masquerading as a working override.
  const trimmed = raw.trim();
  if (trimmed === "") return PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD;
  const parsed = Number(trimmed);
  if (!isPositiveIntegerThreshold(parsed)) {
    return PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD;
  }
  return parsed;
}

// Task #1668 — resolves the per-org override (if any) for
// `getProjectLogEmailFailureThreshold`. Kept as a tiny helper so the
// backstop fan-out below stays readable and the SELECT is centralised
// (also makes it easy to mock / stub in tests). Returns `null` when
// the org has no override set OR when the lookup fails — never throws.
async function loadOrgProjectLogEmailFailureThreshold(
  organizationId: string,
): Promise<number | null> {
  try {
    const [row] = await db
      .select({ threshold: organizations.projectLogEmailFailureThreshold })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row?.threshold ?? null;
  } catch (err) {
    // Telemetry-only — a failed lookup MUST NOT block the fan-out, the
    // env / global default keeps the backstop functional.
    logWarn("Failed to load per-org project log email failure threshold", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function maybeNotifyProjectLogEmailRepeatedFailure(args: {
  scheduleId: string;
  organizationId: string;
  logType: "RFI" | "SUBMITTAL";
  previousCount: number;
  newCount: number;
  reason: string;
  projectName: string | null;
  projectCode: string | null;
}): Promise<void> {
  // Task #1668 — read the per-org override (if any) before resolving
  // the threshold so each org can dial in its own tolerance. NULL
  // (no override) falls through to the env / global default.
  const orgOverride = await loadOrgProjectLogEmailFailureThreshold(args.organizationId);
  const threshold = getProjectLogEmailFailureThreshold(orgOverride);
  // Edge-trigger only: we want one fan-out the moment the streak
  // reaches the threshold, not a fresh fan-out on every subsequent
  // failure. A SUCCESS resets the counter to 0 and the next streak
  // can re-cross cleanly.
  if (args.previousCount >= threshold) return;
  if (args.newCount < threshold) return;

  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(
      eq(users.organizationId, args.organizationId),
      inArray(users.role, ["SUPER_ADMIN", "ADMIN", "MANAGER"]),
    ));

  if (admins.length === 0) {
    // No admins in the org to notify (rare, but possible during
    // setup or after a bulk role change). Log and bail — there's no
    // value in writing a notification with no recipient, and we
    // don't want to leave a "stuck" sentinel that prevents a
    // re-cross from re-trying the fan-out.
    logWarn("Project log email repeated-failure notification: no admins to notify", {
      scheduleId: args.scheduleId,
      organizationId: args.organizationId,
      newCount: args.newCount,
      threshold,
    });
    return;
  }

  const logLabel = args.logType === "SUBMITTAL" ? "submittal" : "RFI";
  const projectLabel = args.projectName ?? "a project";
  const title = `Scheduled ${logLabel} log email failing repeatedly: ${projectLabel}`;
  const message = `The scheduled ${logLabel} log email for ${projectLabel} has failed ${args.newCount} times in a row — ${args.reason}. Update the project's distribution lists or schedule to resolve.`;

  const notifs: InsertNotification[] = admins.map((u) => ({
    userId: u.id,
    organizationId: args.organizationId,
    type: "PROJECT_LOG_EMAIL_FAILED" as const,
    title,
    message,
    relatedEntityType: "PROJECT_LOG_EMAIL_SCHEDULE",
    // The notification destination map keys off project code to deep
    // link to /projects/<code>; fall back to the schedule id so the
    // record is still valid when the catch-path couldn't load the
    // project row.
    relatedEntityId: args.projectCode ?? args.scheduleId,
  }));
  await insertNotifications(notifs);

  logInfo("Project log email repeated-failure notification fanned out", {
    scheduleId: args.scheduleId,
    organizationId: args.organizationId,
    threshold,
    newCount: args.newCount,
    recipients: admins.length,
  });
}

// ============================================================
// Task #1715 — daily failures-digest fan-out
// ============================================================
//
// The per-failure ping (Task #1637) and the repeated-failure backstop
// (Task #1651) both fire only on transitions: the first one when a
// schedule first crosses into FAILURE / NO_RECIPIENTS, the second one
// when the consecutive-failure streak crosses the configured threshold.
// Once the dedupe markers are stamped, neither fires again until the
// schedule recovers, which means a chronically broken schedule only
// surfaces in the org failures dashboard (Task #1666). Admins who
// don't open that dashboard end up missing the signal entirely.
//
// This helper closes the loop with a once-a-day digest. It mirrors the
// dashboard query exactly — every schedule whose latest attempt was
// FAILURE or NO_RECIPIENTS — and fans an in-app + email notification
// to each org's active ADMIN / SUPER_ADMIN users. The notification's
// related entity points at /admin/log-email-failures (resolved by both
// the email composer's entityUrlMap and the in-app destination map),
// so a click lands directly on the dashboard the digest summarises.
//
// Recipient role gate is the same as the dashboard's `relatedEntityType`-
// based access (ADMIN / SUPER_ADMIN). MANAGER / SUPERINTENDENT are
// intentionally *excluded* from the digest — the per-failure ping
// already targets the project manager and the schedule's last editor,
// and the digest's purpose is to surface "everywhere this is broken"
// at the org level rather than per-project.
//
// Per-user opt-out is the existing `notification_type_prefs` row for
// `PROJECT_LOG_EMAIL_FAILURES_DIGEST` — admins can mute the digest
// (in-app and / or email) independently of the per-failure pings via
// the standard notification settings page. No new opt-out plumbing is
// required.
//
// Dedupe: a `relatedEntityId` of "YYYY-MM-DD" (in the org's local
// timezone) lets us keep this helper idempotent — re-running on the
// same local day only inserts rows for orgs that haven't already
// received that day's digest. We rely on the `notifications` table
// itself for the dedupe sentinel rather than adding a new column to
// `organizations`, which keeps the schema surface area smaller and
// means a manual rerun (e.g. operator firing the cron from a debug
// endpoint) is safe.
//
// Task #1732: this function now ticks hourly and consults per-org
// cadence / weekday / hour / timezone columns on `organizations` to
// decide which orgs (if any) actually fan out on this tick. The
// defaults — DAILY at 08:00 UTC — preserve the original behavior for
// orgs that have never touched the new settings.
//
// Task #1750 — opt-in knobs so the admin "Send test digest now" button
// (`POST /api/organizations/project-log-email-settings/test-digest`)
// can reuse this exact code path without going around it. None of the
// new options change behavior when omitted, so the cron caller is
// unaffected:
//
//   - `organizationIds` limits the per-org loop to a specific set.
//     The route uses this to scope the test send to the caller's org
//     so an admin can't accidentally trigger every tenant's digest.
//   - `bypassScheduleGate` skips the cadence / hour / weekday gate so
//     the test send fires immediately regardless of when the org's
//     real digest is configured to land. This bypass *also* covers
//     cadence === "OFF": an admin verifying the recipient list on a
//     paused org should still be able to fire a one-off without
//     first re-enabling the schedule (so the route never sees a
//     CADENCE_OFF skip on this code path).
//   - `dedupeKeyOverride` swaps the YYYY-MM-DD dedupe sentinel for a
//     caller-supplied string so the test send doesn't suppress the
//     same day's real digest. The route generates a unique
//     `test-<isoTimestamp>` key per click; multiple test sends within
//     the same minute deliberately bypass the dedupe (each click is a
//     fresh record).
//
// Returns a per-org summary the route uses to render
// "Test digest sent to N admins" — the cron caller ignores it.
export type ProjectLogEmailFailuresDigestSummary = {
  totalNotifications: number;
  totalOrgsNotified: number;
  perOrg: Map<string, {
    notificationCount: number;
    failingScheduleCount: number;
    skipped: false;
  } | {
    notificationCount: 0;
    failingScheduleCount: number;
    skipped: true;
    reason:
      | "CADENCE_OFF"
      | "HOUR_GATE"
      | "WEEKDAY_GATE"
      | "ALREADY_SENT_TODAY"
      | "NO_ADMINS"
      | "ITERATION_FAILED"
      | "NO_FAILURES";
  }>;
};

export async function processProjectLogEmailFailuresDigest(opts: {
  now?: Date;
  organizationIds?: string[];
  bypassScheduleGate?: boolean;
  dedupeKeyOverride?: string;
} = {}): Promise<ProjectLogEmailFailuresDigestSummary> {
  const now = opts.now ?? new Date();
  const summary: ProjectLogEmailFailuresDigestSummary = {
    totalNotifications: 0,
    totalOrgsNotified: 0,
    perOrg: new Map(),
  };
  const orgFilter = opts.organizationIds && opts.organizationIds.length > 0
    ? new Set(opts.organizationIds)
    : null;

  // Pull every failing schedule in one sweep, joined with the project
  // row so the digest body can render "Project name (code)" without a
  // second round-trip per row. Org-scoped on both sides of the join
  // matches the same defense-in-depth used by the dashboard endpoint
  // (Task #1666). Capped to a sane maximum so a single misconfigured
  // tenant with thousands of stale schedules can't blow the message
  // size; the body footer surfaces the truncation when it bites.
  const FAILURES_DIGEST_PER_ORG_CAP = 100;
  const failures = await db
    .select({
      scheduleId: projectLogEmailSchedules.id,
      organizationId: projectLogEmailSchedules.organizationId,
      projectId: projectLogEmailSchedules.projectId,
      projectName: projects.name,
      projectCode: projects.code,
      logType: projectLogEmailSchedules.logType,
      cadence: projectLogEmailSchedules.cadence,
      lastAttemptAt: projectLogEmailSchedules.lastAttemptAt,
      lastAttemptStatus: projectLogEmailSchedules.lastAttemptStatus,
      lastAttemptError: projectLogEmailSchedules.lastAttemptError,
      lastAttemptRecipientCount: projectLogEmailSchedules.lastAttemptRecipientCount,
      consecutiveFailureCount: projectLogEmailSchedules.consecutiveFailureCount,
    })
    .from(projectLogEmailSchedules)
    .innerJoin(projects, and(
      eq(projects.id, projectLogEmailSchedules.projectId),
      eq(projects.gcOrganizationId, projectLogEmailSchedules.organizationId),
    ))
    .where(inArray(projectLogEmailSchedules.lastAttemptStatus, ["FAILURE", "NO_RECIPIENTS"]))
    .orderBy(desc(projectLogEmailSchedules.lastAttemptAt));

  if (failures.length === 0) {
    // Task #1750 — when an org filter is set (typical for the admin
    // "test digest" route), surface a per-org skipped entry so the
    // route can render "No failing schedules" instead of falling back
    // to a generic "0 admins notified" message.
    if (orgFilter) {
      for (const id of orgFilter) {
        summary.perOrg.set(id, {
          notificationCount: 0,
          failingScheduleCount: 0,
          skipped: true,
          reason: "NO_FAILURES",
        });
      }
    }
    return summary;
  }

  // Group by org so each org's admins get one digest covering only
  // their own failing schedules. When the caller supplied an org
  // filter (test-send route, Task #1750), drop everything else here so
  // the per-org loop and the org-settings lookup below only consider
  // the requested orgs.
  const byOrg = new Map<string, typeof failures>();
  for (const row of failures) {
    if (orgFilter && !orgFilter.has(row.organizationId)) continue;
    const list = byOrg.get(row.organizationId);
    if (list) list.push(row);
    else byOrg.set(row.organizationId, [row]);
  }
  if (orgFilter) {
    // Pre-populate skipped entries for filter orgs that had no failing
    // schedules so the route always sees a per-org row for every org
    // it asked about. The success path overwrites these entries below.
    for (const id of orgFilter) {
      if (!byOrg.has(id)) {
        summary.perOrg.set(id, {
          notificationCount: 0,
          failingScheduleCount: 0,
          skipped: true,
          reason: "NO_FAILURES",
        });
      }
    }
  }

  // Task #1732: load per-org schedule overrides for every org with
  // failures in one round-trip. Orgs missing a row (shouldn't happen
  // in production since FK-tied, but defensive in tests where the
  // mock select returns []) fall back to the column defaults: DAILY
  // at 08:00 in UTC.
  const orgIds = Array.from(byOrg.keys());
  const orgSettingsRows = orgIds.length > 0
    ? await db
        .select({
          id: organizations.id,
          cadence: organizations.projectLogEmailFailuresDigestCadence,
          weekday: organizations.projectLogEmailFailuresDigestWeekday,
          hour: organizations.projectLogEmailFailuresDigestHour,
          timezone: organizations.projectLogEmailFailuresDigestTimezone,
        })
        .from(organizations)
        .where(inArray(organizations.id, orgIds))
    : [];
  const orgSettingsById = new Map<string, {
    cadence: string;
    weekday: number;
    hour: number;
    timezone: string;
  }>();
  for (const row of orgSettingsRows) {
    orgSettingsById.set(row.id, {
      cadence: row.cadence ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_CADENCE,
      weekday: row.weekday ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_WEEKDAY,
      hour: row.hour ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_HOUR,
      timezone: row.timezone ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_TIMEZONE,
    });
  }

  let totalNotifications = 0;
  let totalOrgsNotified = 0;

  for (const [organizationId, rows] of byOrg) {
    try {
      // Task #1732: per-org schedule gate. Defaults (DAILY @ 08:00 UTC)
      // apply when the org row is missing or any column is unexpectedly
      // null, preserving the original hard-coded behavior for orgs that
      // haven't touched the new settings.
      const settings = orgSettingsById.get(organizationId) ?? {
        cadence: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_CADENCE,
        weekday: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_WEEKDAY,
        hour: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_HOUR,
        timezone: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_TIMEZONE,
      };
      // Cadence "OFF" skips for the scheduled cron (the org has opted
      // out of automatic sends), but the test-send route (Task #1750)
      // can override this via `bypassScheduleGate: true` so an admin
      // can verify the digest payload / recipient list even on an
      // org whose cadence is currently OFF.
      if (settings.cadence === "OFF" && !opts.bypassScheduleGate) {
        summary.perOrg.set(organizationId, {
          notificationCount: 0,
          failingScheduleCount: rows.length,
          skipped: true,
          reason: "CADENCE_OFF",
        });
        continue;
      }
      const local = getLocalDateParts(now, settings.timezone);
      if (!opts.bypassScheduleGate) {
        if (local.hour !== settings.hour) {
          summary.perOrg.set(organizationId, {
            notificationCount: 0,
            failingScheduleCount: rows.length,
            skipped: true,
            reason: "HOUR_GATE",
          });
          continue;
        }
        if (settings.cadence === "WEEKLY" && local.weekday !== settings.weekday) {
          summary.perOrg.set(organizationId, {
            notificationCount: 0,
            failingScheduleCount: rows.length,
            skipped: true,
            reason: "WEEKDAY_GATE",
          });
          continue;
        }
      }

      // Dedupe sentinel: org's local calendar date. With the per-org
      // hour/weekday gate above, the handler can only fire once per
      // local day per org, so a YYYY-MM-DD key is enough to make a
      // re-run within the same firing hour (manual debug invocation,
      // boot during the firing minute) idempotent.
      //
      // Task #1750 — the test-send route swaps in a unique
      // `test-<isoTimestamp>` so the test record can't collide with
      // (and thereby suppress) the same day's real digest, and so
      // multiple test clicks within the same minute each produce a
      // fresh notification row for the admin to inspect.
      const dayKey = `${local.year.toString().padStart(4, "0")}-${local.month
        .toString()
        .padStart(2, "0")}-${local.day.toString().padStart(2, "0")}`;
      const dedupeKey = opts.dedupeKeyOverride ?? dayKey;

      // Idempotency: skip orgs that already received today's digest.
      // Querying the notifications table directly keeps the dedupe
      // information close to where the row is written and avoids a
      // schema change. Skipped for the test-send path which always
      // supplies a fresh per-click key (so the lookup would never
      // match anyway, but skipping it saves a round-trip).
      if (!opts.dedupeKeyOverride) {
        const [existing] = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(
            eq(notifications.organizationId, organizationId),
            eq(notifications.type, "PROJECT_LOG_EMAIL_FAILURES_DIGEST"),
            eq(notifications.relatedEntityType, "PROJECT_LOG_EMAIL_FAILURES_DIGEST"),
            eq(notifications.relatedEntityId, dedupeKey),
          ))
          .limit(1);
        if (existing) {
          summary.perOrg.set(organizationId, {
            notificationCount: 0,
            failingScheduleCount: rows.length,
            skipped: true,
            reason: "ALREADY_SENT_TODAY",
          });
          continue;
        }
      }

      // Resolve recipients: active ADMIN / SUPER_ADMIN users in the
      // org. MANAGER / SUPERINTENDENT can already see the dashboard
      // (Task #1666) but the digest itself is org-admin-only — they
      // get the per-failure ping (Task #1637) for projects they own.
      const adminRows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.organizationId, organizationId),
          inArray(users.role, ["SUPER_ADMIN", "ADMIN"]),
          eq(users.isActive, true),
        ));

      if (adminRows.length === 0) {
        // No-one to notify — log loudly so on-call can see that the
        // digest was effectively dropped (rare; happens during initial
        // setup or after a bulk role change).
        logWarn("Project log email failures digest: no admins to notify", {
          organizationId,
          failingSchedules: rows.length,
        });
        summary.perOrg.set(organizationId, {
          notificationCount: 0,
          failingScheduleCount: rows.length,
          skipped: true,
          reason: "NO_ADMINS",
        });
        continue;
      }

      const truncated = rows.length > FAILURES_DIGEST_PER_ORG_CAP;
      const renderRows = truncated ? rows.slice(0, FAILURES_DIGEST_PER_ORG_CAP) : rows;

      const failureCount = rows.filter((r) => r.lastAttemptStatus === "FAILURE").length;
      const noRecipientsCount = rows.filter((r) => r.lastAttemptStatus === "NO_RECIPIENTS").length;
      const headerLine = `${rows.length} scheduled log email${rows.length === 1 ? "" : "s"} ${rows.length === 1 ? "is" : "are"} currently failing — ${failureCount} send error${failureCount === 1 ? "" : "s"}, ${noRecipientsCount} with no recipients.`;

      const breakdownLines = renderRows.map((r) => {
        const logLabel = r.logType === "SUBMITTAL" ? "Submittal" : "RFI";
        const statusLabel = r.lastAttemptStatus === "NO_RECIPIENTS" ? "no recipients" : "failed";
        const projectLabel = r.projectCode ? `${r.projectName} (${r.projectCode})` : r.projectName;
        const reason = (r.lastAttemptError ?? "Unknown error").slice(0, 200);
        const streak = r.consecutiveFailureCount && r.consecutiveFailureCount > 1
          ? ` — ${r.consecutiveFailureCount} consecutive failures`
          : "";
        return `${projectLabel} — ${logLabel} log (${r.cadence.toLowerCase()}): ${statusLabel}${streak}. ${reason}`;
      });

      const truncationFooter = truncated
        ? [
            "",
            `…and ${rows.length - FAILURES_DIGEST_PER_ORG_CAP} more — open the dashboard for the full list.`,
          ]
        : [];

      const message = [headerLine, "", ...breakdownLines, ...truncationFooter].join("\n");
      const title = `Scheduled log email failures: ${rows.length} schedule${rows.length === 1 ? "" : "s"} need attention`;

      const notifs: InsertNotification[] = adminRows.map((u) => ({
        userId: u.id,
        organizationId,
        type: "PROJECT_LOG_EMAIL_FAILURES_DIGEST" as const,
        title,
        message,
        relatedEntityType: "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
        // The day key doubles as the dedupe sentinel for the
        // org-level idempotency check above and as a stable
        // relatedEntityId for the email composer's entityUrlMap, which
        // ignores the value when building the dashboard URL. The test
        // send (Task #1750) supplies a unique per-click key here so
        // the row is distinguishable in the admin's notifications
        // list and doesn't collide with the same day's real digest.
        relatedEntityId: dedupeKey,
      }));

      await insertNotifications(notifs);
      totalNotifications += notifs.length;
      totalOrgsNotified += 1;
      summary.perOrg.set(organizationId, {
        notificationCount: notifs.length,
        failingScheduleCount: rows.length,
        skipped: false,
      });
    } catch (err) {
      logError("Project log email failures digest org iteration failed", {
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
      summary.perOrg.set(organizationId, {
        notificationCount: 0,
        failingScheduleCount: rows.length,
        skipped: true,
        reason: "ITERATION_FAILED",
      });
    }
  }

  summary.totalNotifications = totalNotifications;
  summary.totalOrgsNotified = totalOrgsNotified;

  if (totalNotifications > 0) {
    logInfo("Project log email failures digest sent", {
      orgs: totalOrgsNotified,
      notifications: totalNotifications,
    });
  }

  return summary;
}

// ============================================================
// Task #1173 + Task #1259: SWPPP overdue corrective action notifications
// ============================================================
//
// We surface overdue corrective actions in the UI already, but nothing
// actively pings the assignee or PM, which means an overdue item only
// gets noticed if someone happens to open the SWPPP page. This sweep
// closes the loop:
//
//   - Looks for OPEN inspections (`status = 'OPEN'`) with a non-null
//     `correctiveActionDueDate` that is strictly before today's date.
//   - First overdue cycle: when `lastOverdueNotifiedAt IS NULL`, the
//     sweep fans out the initial notification and stamps the marker
//     to `now`. The follow-up counter (`overdueReminderCount`) is NOT
//     incremented by the initial fanout — it tracks daily reminders
//     only. The SWPPP routes reset the marker (and the count) when
//     the due date is moved forward or the inspection is re-opened so
//     a fresh cycle can fire.
//   - Daily nudges (Task #1259): once the initial fanout has happened,
//     subsequent runs send another reminder when at least
//     `SWPPP_OVERDUE_REMINDER_INTERVAL_MS` has passed since the last
//     fanout, bumping `overdueReminderCount` by 1 each time, until it
//     reaches `SWPPP_OVERDUE_REMINDER_CAP`. With the default cap of 5
//     this means: 1 initial + up to 5 follow-ups = at most 6 fanouts
//     per overdue cycle. Resolving the inspection stops reminders
//     naturally (the OPEN filter excludes RESOLVED rows).
//   - Notifies the corrective action assignee plus the project manager.
//     Each recipient gets at most one in-app + email notification per
//     fanout (initial or daily reminder).
//
// The notification is a `REMINDER` with `relatedEntityType =
// "SWPPP_OVERDUE_CORRECTIVE_ACTION"` and `relatedEntityId = inspection.id`
// so the email composer can deep-link to the inspection list filtered
// to the right project.

// Default cap on total follow-up reminders per overdue cycle. Used as a
// fallback when an organization has no per-org override configured.
// Task #1286 promoted this from a hard-coded constant to a per-org
// column on `organizations` (swppp_overdue_reminder_max_count); admins
// can dial it up or down per tenant from the SWPPP settings card on the
// company-notifications tab. The env var is preserved so tests and
// operators can still override the default for fresh orgs.
const SWPPP_OVERDUE_REMINDER_CAP = Math.max(
  1,
  Number.parseInt(process.env.SWPPP_OVERDUE_REMINDER_CAP ?? String(SWPPP_OVERDUE_REMINDER_DEFAULT_CAP), 10) || SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
);
// Default minimum gap (in hours) between consecutive reminder fanouts.
// 22h is the same convention used by other daily-cadence digests in
// this codebase — it sits just under 24h so a daily cron at the same
// wall-clock time still triggers the next reminder (cron jitter would
// otherwise push the next eligible run past 24h and skip a day).
// Per-org override lives on `organizations.swppp_overdue_reminder_interval_hours`.
const SWPPP_OVERDUE_REMINDER_INTERVAL_HOURS = SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS;

export async function processSwpppOverdueCorrectiveActions(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  // We compare a YYYY-MM-DD string against `correctiveActionDueDate`
  // (a DATE column) so the cutoff respects calendar days rather than
  // wall-clock instants — an item due "today" is not overdue until
  // tomorrow.
  const todayStr = now.toISOString().slice(0, 10);

  // Pick up:
  //   - Brand new overdue items (lastOverdueNotifiedAt IS NULL), or
  //   - Items that already had at least one fanout but are still under
  //     their org's cap and whose last fanout was long enough ago
  //     (per the org's interval setting) to send a follow-up reminder.
  //
  // Task #1286 — the cap and interval are joined in from
  // `organizations` so each tenant can tune its escalation policy
  // independently. COALESCE guards against any DB drift where the
  // columns are missing or NULL despite the NOT NULL DEFAULT.
  const orgCapExpr = sql<number>`COALESCE(${organizations.swpppOverdueReminderMaxCount}, ${SWPPP_OVERDUE_REMINDER_CAP})`;
  const orgIntervalExpr = sql<number>`COALESCE(${organizations.swpppOverdueReminderIntervalHours}, ${SWPPP_OVERDUE_REMINDER_INTERVAL_HOURS})`;

  const overdue = await db
    .select({
      id: swpppInspections.id,
      organizationId: swpppInspections.organizationId,
      projectId: swpppInspections.projectId,
      inspectionDate: swpppInspections.inspectionDate,
      correctiveActionDueDate: swpppInspections.correctiveActionDueDate,
      correctiveActionAssigneeId: swpppInspections.correctiveActionAssigneeId,
      correctiveActions: swpppInspections.correctiveActions,
      lastOverdueNotifiedAt: swpppInspections.lastOverdueNotifiedAt,
      overdueReminderCount: swpppInspections.overdueReminderCount,
      reminderMaxCount: orgCapExpr,
      reminderIntervalHours: orgIntervalExpr,
    })
    .from(swpppInspections)
    .innerJoin(organizations, eq(swpppInspections.organizationId, organizations.id))
    .where(and(
      eq(swpppInspections.status, "OPEN"),
      isNotNull(swpppInspections.correctiveActionDueDate),
      lt(swpppInspections.correctiveActionDueDate, todayStr),
      or(
        isNull(swpppInspections.lastOverdueNotifiedAt),
        and(
          sql`${swpppInspections.overdueReminderCount} < ${orgCapExpr}`,
          sql`${swpppInspections.lastOverdueNotifiedAt} <= (${now}::timestamp - (${orgIntervalExpr} * interval '1 hour'))`,
        ),
      ),
    ));

  if (overdue.length === 0) return;

  // Look up project name + PM, but only for projects that belong to the
  // same organization as the inspection — guard against the (extremely
  // unlikely) cross-org project reference so we never route an overdue
  // notification to a PM in the wrong tenant.
  const projectKeyByInspection = new Map<string, string>();
  for (const r of overdue) projectKeyByInspection.set(r.id, `${r.organizationId}::${r.projectId}`);
  const projectIds = Array.from(new Set(overdue.map((r) => r.projectId)));
  const orgIds = Array.from(new Set(overdue.map((r) => r.organizationId)));
  const projectRows = projectIds.length
    ? await db
        .select({ id: projects.id, organizationId: projects.gcOrganizationId, name: projects.name, projectManagerId: projects.projectManagerId })
        .from(projects)
        .where(and(inArray(projects.id, projectIds), inArray(projects.gcOrganizationId, orgIds)))
    : [];
  const projectByKey = new Map(projectRows.map((p) => [`${p.organizationId}::${p.id}`, p]));

  const notifs: InsertNotification[] = [];
  // Track initial vs follow-up fanouts separately so the UPDATE can
  // bump `overdueReminderCount` only for follow-ups. Inspections with
  // no recipients are still recorded so we don't keep re-scanning the
  // same row every night.
  const initialNotifiedIds: string[] = [];
  const followupNotifiedIds: string[] = [];

  for (const item of overdue) {
    const proj = projectByKey.get(`${item.organizationId}::${item.projectId}`);
    const projectName = proj?.name ?? "(Unknown project)";
    const dueStr = item.correctiveActionDueDate ? String(item.correctiveActionDueDate) : "";
    const dueDate = dueStr ? new Date(`${dueStr}T00:00:00Z`) : null;
    const daysOverdue = dueDate
      ? Math.max(0, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    // De-dupe within a single fanout so the assignee and PM (if they're
    // the same person) only get one notification per inspection.
    const recipientIds = new Set<string>();
    if (item.correctiveActionAssigneeId) recipientIds.add(item.correctiveActionAssigneeId);
    if (proj?.projectManagerId) recipientIds.add(proj.projectManagerId);

    // Whether this fanout is the initial overdue notification or a
    // daily follow-up. Determined by whether the row has ever been
    // notified for the current overdue cycle.
    const isFollowUp = item.lastOverdueNotifiedAt != null;

    if (recipientIds.size === 0) {
      // Nothing to notify for this inspection (no assignee, no PM).
      // Still mark it as notified so we don't keep scanning it every
      // night — the UI overdue badge remains the source of truth and
      // someone with edit access will need to reassign it.
      if (isFollowUp) followupNotifiedIds.push(item.id);
      else initialNotifiedIds.push(item.id);
      continue;
    }

    const correctiveActionLabel = (item.correctiveActions ?? "").trim().slice(0, 200) || "Corrective action";
    const overdueLabel = daysOverdue > 0
      ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
      : "overdue";
    // Tag follow-ups with "Reminder K of N" so the recipient can tell
    // at a glance that escalation is ongoing. K = previous follow-up
    // count + 1, capped by the org-specific reminder cap (Task #1286).
    // Initial fanout wording is unchanged from Task #1173. The cap
    // falls back to the legacy default when the joined org column is
    // missing (e.g. in tests that mock the DB without the new field).
    const followupNumber = (item.overdueReminderCount ?? 0) + 1;
    const orgReminderCap = Number(item.reminderMaxCount ?? SWPPP_OVERDUE_REMINDER_CAP) || SWPPP_OVERDUE_REMINDER_CAP;
    const reminderTag = isFollowUp ? ` (Reminder ${followupNumber} of ${orgReminderCap})` : "";
    const title = `SWPPP corrective action ${overdueLabel}: ${projectName}${reminderTag}`;
    const message = `${projectName} — corrective action was due ${dueStr || "(no date)"} (${overdueLabel}).\n${correctiveActionLabel}`;

    for (const userId of recipientIds) {
      notifs.push({
        userId,
        organizationId: item.organizationId,
        // Task #1260 — Use the dedicated SWPPP overdue type so users can
        // mute these alerts in their notification preferences without
        // also silencing every other generic REMINDER notification.
        type: "SWPPP_OVERDUE_CORRECTIVE_ACTION" as const,
        title,
        message,
        relatedEntityType: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
        relatedEntityId: item.id,
      });
    }
    if (isFollowUp) followupNotifiedIds.push(item.id);
    else initialNotifiedIds.push(item.id);
  }

  if (notifs.length > 0) {
    await insertNotifications(notifs);
  }

  // Two batched updates: initial fanouts only stamp the marker
  // (counter stays at 0), follow-ups bump the counter by 1.
  if (initialNotifiedIds.length > 0) {
    await db
      .update(swpppInspections)
      .set({ lastOverdueNotifiedAt: now })
      .where(inArray(swpppInspections.id, initialNotifiedIds));
  }
  if (followupNotifiedIds.length > 0) {
    await db
      .update(swpppInspections)
      .set({
        lastOverdueNotifiedAt: now,
        overdueReminderCount: sql`${swpppInspections.overdueReminderCount} + 1`,
      })
      .where(inArray(swpppInspections.id, followupNotifiedIds));
  }

  if (notifs.length > 0) {
    logInfo("SWPPP overdue corrective action notifications sent", {
      notifications: notifs.length,
      inspections: initialNotifiedIds.length + followupNotifiedIds.length,
      initialFanouts: initialNotifiedIds.length,
      followupReminders: followupNotifiedIds.length,
    });
  }
}

// ============================================================
// Task #1599: RFI / submittal-review overdue notifications
// ============================================================
//
// Mirrors `processSwpppOverdueCorrectiveActions` above. Two parallel
// sweeps share a single per-org policy on `organizations`:
//   - doc_overdue_reminder_max_count   (default 5)
//   - doc_overdue_reminder_interval_hours (default 22)
// ...so an admin can dial the document-control escalation cadence
// independently of the SWPPP cadence.
//
// An RFI is "overdue" when:
//   - status IN ('SUBMITTED','UNDER_REVIEW','FORWARDED'); AND
//   - dateRequired IS NOT NULL AND dateRequired < now.
//
// A submittal_review is "overdue" when:
//   - the review row's status IN ('PENDING','IN_REVIEW'); AND
//   - the parent submittal.dateRequired < now.
//
// Both sweeps fan one notification per recipient per fanout (assignee
// + PM, deduped). Initial fanout stamps lastOverdueNotifiedAt; daily
// follow-ups bump overdueReminderCount until the per-org cap is hit.
// Resolving the row (RFI -> ANSWERED/CLOSED, review -> any non-pending
// status) takes it out of the SELECT so reminders stop naturally.

const DOC_OVERDUE_REMINDER_CAP = Math.max(
  1,
  Number.parseInt(
    process.env.DOC_OVERDUE_REMINDER_CAP ?? String(DOC_OVERDUE_REMINDER_DEFAULT_CAP),
    10,
  ) || DOC_OVERDUE_REMINDER_DEFAULT_CAP,
);
const DOC_OVERDUE_REMINDER_INTERVAL_HOURS = DOC_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS;

const RFI_OVERDUE_OPEN_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "FORWARDED"] as const;
// Only the *active* chain step (IN_REVIEW) is overdue-eligible. PENDING
// rows are future steps the chain has not yet activated, so the assigned
// reviewer is not yet ball-in-court and pinging them would be noise.
export const SUBMITTAL_REVIEW_OPEN_STATUSES = ["IN_REVIEW"] as const;

export async function processRfiOverdueNotifications(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();

  // Per-org cap + interval (Task #1599) joined in. COALESCE guards
  // against any DB drift where the columns are missing or NULL despite
  // the NOT NULL DEFAULT — same pattern as the SWPPP sweep.
  const orgCapExpr = sql<number>`COALESCE(${organizations.docOverdueReminderMaxCount}, ${DOC_OVERDUE_REMINDER_CAP})`;
  const orgIntervalExpr = sql<number>`COALESCE(${organizations.docOverdueReminderIntervalHours}, ${DOC_OVERDUE_REMINDER_INTERVAL_HOURS})`;

  const overdue = await db
    .select({
      id: rfis.id,
      organizationId: rfis.organizationId,
      projectId: rfis.projectId,
      rfiNumber: rfis.rfiNumber,
      subject: rfis.subject,
      status: rfis.status,
      dateRequired: rfis.dateRequired,
      assignedToId: rfis.assignedToId,
      forwardedToId: rfis.forwardedToId,
      submittedById: rfis.submittedById,
      lastOverdueNotifiedAt: rfis.lastOverdueNotifiedAt,
      overdueReminderCount: rfis.overdueReminderCount,
      reminderMaxCount: orgCapExpr,
      reminderIntervalHours: orgIntervalExpr,
    })
    .from(rfis)
    .innerJoin(organizations, eq(rfis.organizationId, organizations.id))
    .where(and(
      inArray(rfis.status, RFI_OVERDUE_OPEN_STATUSES as unknown as string[]),
      isNotNull(rfis.dateRequired),
      lt(rfis.dateRequired, now),
      or(
        isNull(rfis.lastOverdueNotifiedAt),
        and(
          sql`${rfis.overdueReminderCount} < ${orgCapExpr}`,
          sql`${rfis.lastOverdueNotifiedAt} <= (${now}::timestamp - (${orgIntervalExpr} * interval '1 hour'))`,
        ),
      ),
    ));

  if (overdue.length === 0) return;

  const projectIds = Array.from(new Set(overdue.map((r) => r.projectId)));
  const orgIds = Array.from(new Set(overdue.map((r) => r.organizationId)));
  const projectRows = projectIds.length
    ? await db
        .select({ id: projects.id, organizationId: projects.gcOrganizationId, name: projects.name, projectManagerId: projects.projectManagerId })
        .from(projects)
        .where(and(inArray(projects.id, projectIds), inArray(projects.gcOrganizationId, orgIds)))
    : [];
  const projectByKey = new Map(projectRows.map((p) => [`${p.organizationId}::${p.id}`, p]));

  const notifs: InsertNotification[] = [];
  const initialNotifiedIds: string[] = [];
  const followupNotifiedIds: string[] = [];

  for (const item of overdue) {
    const proj = projectByKey.get(`${item.organizationId}::${item.projectId}`);
    const projectName = proj?.name ?? "(Unknown project)";
    const dueDate = item.dateRequired ? new Date(item.dateRequired) : null;
    const dueStr = dueDate ? dueDate.toISOString().slice(0, 10) : "";
    const daysOverdue = dueDate
      ? Math.max(0, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())) / (1000 * 60 * 60 * 24)))
      : 0;

    const recipientIds = new Set<string>();
    // Forwarded RFIs route to the forwarded-to user as the active
    // assignee for this hop; otherwise the originally-assigned user.
    if (item.status === "FORWARDED" && item.forwardedToId) recipientIds.add(item.forwardedToId);
    else if (item.assignedToId) recipientIds.add(item.assignedToId);
    if (proj?.projectManagerId) recipientIds.add(proj.projectManagerId);

    const isFollowUp = item.lastOverdueNotifiedAt != null;
    if (recipientIds.size === 0) {
      // Nothing to notify — still mark as notified so we don't re-scan
      // every night. Same defensive policy as the SWPPP sweep.
      if (isFollowUp) followupNotifiedIds.push(item.id);
      else initialNotifiedIds.push(item.id);
      continue;
    }

    const overdueLabel = daysOverdue > 0
      ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
      : "overdue";
    const followupNumber = (item.overdueReminderCount ?? 0) + 1;
    const orgReminderCap = Number(item.reminderMaxCount ?? DOC_OVERDUE_REMINDER_CAP) || DOC_OVERDUE_REMINDER_CAP;
    const reminderTag = isFollowUp ? ` (Reminder ${followupNumber} of ${orgReminderCap})` : "";
    const subjectLabel = (item.subject ?? "").trim().slice(0, 200) || "(no subject)";
    const title = `RFI #${item.rfiNumber} ${overdueLabel}: ${projectName}${reminderTag}`;
    const message = `${projectName} — RFI #${item.rfiNumber} (${subjectLabel}) was due ${dueStr || "(no date)"} (${overdueLabel}).`;

    for (const userId of recipientIds) {
      notifs.push({
        userId,
        organizationId: item.organizationId,
        type: "GENERAL" as const,
        title,
        message,
        relatedEntityType: "RFI",
        relatedEntityId: item.id,
      });
    }
    if (isFollowUp) followupNotifiedIds.push(item.id);
    else initialNotifiedIds.push(item.id);
  }

  if (notifs.length > 0) {
    await insertNotifications(notifs);
  }

  if (initialNotifiedIds.length > 0) {
    await db
      .update(rfis)
      .set({ lastOverdueNotifiedAt: now })
      .where(inArray(rfis.id, initialNotifiedIds));
  }
  if (followupNotifiedIds.length > 0) {
    await db
      .update(rfis)
      .set({
        lastOverdueNotifiedAt: now,
        overdueReminderCount: sql`${rfis.overdueReminderCount} + 1`,
      })
      .where(inArray(rfis.id, followupNotifiedIds));
  }

  if (notifs.length > 0) {
    logInfo("RFI overdue notifications sent", {
      notifications: notifs.length,
      rfis: initialNotifiedIds.length + followupNotifiedIds.length,
      initialFanouts: initialNotifiedIds.length,
      followupReminders: followupNotifiedIds.length,
    });
  }
}

export async function processSubmittalReviewOverdueNotifications(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();

  const orgCapExpr = sql<number>`COALESCE(${organizations.docOverdueReminderMaxCount}, ${DOC_OVERDUE_REMINDER_CAP})`;
  const orgIntervalExpr = sql<number>`COALESCE(${organizations.docOverdueReminderIntervalHours}, ${DOC_OVERDUE_REMINDER_INTERVAL_HOURS})`;

  // The "due" timestamp lives on the parent submittal, not the review
  // row, so we join through to pull `dateRequired`. submittal_reviews
  // doesn't have a project_id either — also pulled from the parent.
  const overdue = await db
    .select({
      id: submittalReviews.id,
      organizationId: submittalReviews.organizationId,
      submittalId: submittalReviews.submittalId,
      reviewerId: submittalReviews.reviewerId,
      reviewerName: submittalReviews.reviewerName,
      sequenceOrder: submittalReviews.sequenceOrder,
      status: submittalReviews.status,
      lastOverdueNotifiedAt: submittalReviews.lastOverdueNotifiedAt,
      overdueReminderCount: submittalReviews.overdueReminderCount,
      submittalNumber: submittals.submittalNumber,
      submittalSubject: submittals.subject,
      projectId: submittals.projectId,
      dateRequired: submittals.dateRequired,
      reminderMaxCount: orgCapExpr,
      reminderIntervalHours: orgIntervalExpr,
    })
    .from(submittalReviews)
    .innerJoin(submittals, eq(submittalReviews.submittalId, submittals.id))
    .innerJoin(organizations, eq(submittalReviews.organizationId, organizations.id))
    .where(and(
      inArray(submittalReviews.status, SUBMITTAL_REVIEW_OPEN_STATUSES as unknown as string[]),
      isNotNull(submittals.dateRequired),
      lt(submittals.dateRequired, now),
      or(
        isNull(submittalReviews.lastOverdueNotifiedAt),
        and(
          sql`${submittalReviews.overdueReminderCount} < ${orgCapExpr}`,
          sql`${submittalReviews.lastOverdueNotifiedAt} <= (${now}::timestamp - (${orgIntervalExpr} * interval '1 hour'))`,
        ),
      ),
    ));

  if (overdue.length === 0) return;

  const projectIds = Array.from(new Set(overdue.map((r) => r.projectId)));
  const orgIds = Array.from(new Set(overdue.map((r) => r.organizationId)));
  const projectRows = projectIds.length
    ? await db
        .select({ id: projects.id, organizationId: projects.gcOrganizationId, name: projects.name, projectManagerId: projects.projectManagerId })
        .from(projects)
        .where(and(inArray(projects.id, projectIds), inArray(projects.gcOrganizationId, orgIds)))
    : [];
  const projectByKey = new Map(projectRows.map((p) => [`${p.organizationId}::${p.id}`, p]));

  const notifs: InsertNotification[] = [];
  const initialNotifiedIds: string[] = [];
  const followupNotifiedIds: string[] = [];

  for (const item of overdue) {
    const proj = projectByKey.get(`${item.organizationId}::${item.projectId}`);
    const projectName = proj?.name ?? "(Unknown project)";
    const dueDate = item.dateRequired ? new Date(item.dateRequired) : null;
    const dueStr = dueDate ? dueDate.toISOString().slice(0, 10) : "";
    const daysOverdue = dueDate
      ? Math.max(0, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())) / (1000 * 60 * 60 * 24)))
      : 0;

    const recipientIds = new Set<string>();
    if (item.reviewerId) recipientIds.add(item.reviewerId);
    if (proj?.projectManagerId) recipientIds.add(proj.projectManagerId);

    const isFollowUp = item.lastOverdueNotifiedAt != null;
    if (recipientIds.size === 0) {
      if (isFollowUp) followupNotifiedIds.push(item.id);
      else initialNotifiedIds.push(item.id);
      continue;
    }

    const overdueLabel = daysOverdue > 0
      ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
      : "overdue";
    const followupNumber = (item.overdueReminderCount ?? 0) + 1;
    const orgReminderCap = Number(item.reminderMaxCount ?? DOC_OVERDUE_REMINDER_CAP) || DOC_OVERDUE_REMINDER_CAP;
    const reminderTag = isFollowUp ? ` (Reminder ${followupNumber} of ${orgReminderCap})` : "";
    const subjectLabel = (item.submittalSubject ?? "").trim().slice(0, 200) || "(no subject)";
    const title = `Submittal #${item.submittalNumber} review ${overdueLabel}: ${projectName}${reminderTag}`;
    const message = `${projectName} — Submittal #${item.submittalNumber} (${subjectLabel}) — review by ${item.reviewerName ?? "(unassigned)"} (step ${item.sequenceOrder}) was due ${dueStr || "(no date)"} (${overdueLabel}).`;

    for (const userId of recipientIds) {
      notifs.push({
        userId,
        organizationId: item.organizationId,
        type: "GENERAL" as const,
        title,
        message,
        relatedEntityType: "SUBMITTAL_REVIEW",
        relatedEntityId: item.id,
      });
    }
    if (isFollowUp) followupNotifiedIds.push(item.id);
    else initialNotifiedIds.push(item.id);
  }

  if (notifs.length > 0) {
    await insertNotifications(notifs);
  }

  if (initialNotifiedIds.length > 0) {
    await db
      .update(submittalReviews)
      .set({ lastOverdueNotifiedAt: now })
      .where(inArray(submittalReviews.id, initialNotifiedIds));
  }
  if (followupNotifiedIds.length > 0) {
    await db
      .update(submittalReviews)
      .set({
        lastOverdueNotifiedAt: now,
        overdueReminderCount: sql`${submittalReviews.overdueReminderCount} + 1`,
      })
      .where(inArray(submittalReviews.id, followupNotifiedIds));
  }

  if (notifs.length > 0) {
    logInfo("Submittal review overdue notifications sent", {
      notifications: notifs.length,
      reviews: initialNotifiedIds.length + followupNotifiedIds.length,
      initialFanouts: initialNotifiedIds.length,
      followupReminders: followupNotifiedIds.length,
    });
  }
}
