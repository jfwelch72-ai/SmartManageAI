import cron from "node-cron";
import crypto from "crypto";
import * as outboxService from "../integrations/outboxService";
import * as webhookService from "../integrations/webhookService";
import * as connectionService from "../integrations/connectionService";
import { logInfo, logError } from "../utils/logger";
import { recordJobMetrics, loadJobMetricsFromDb, pruneJobMetricsDb } from "../utils/jobMetrics";
import { evaluateJobMetricAlerts } from "../utils/jobMetricAlerts";
import { insertNotification, insertNotifications } from "../services/notificationService";
import { db } from "../db";
import { integrationWebhookSubscriptions, retentionPolicies, auditLog, qboSyncSchedules, integrationSyncState, socialMediaPosts, crmContacts, crmOrganisations, crmOpportunities, crmOpportunityActivities, notifications, notificationChannelPrefs, organizationNetworkSettings, users, projects, projectProfitabilitySnapshots, uploadIntents, crmAutomations, crmAutomationRuns, userSettings, BIRTHDAY_DIGEST_DEFAULT_WEEKDAY, BIRTHDAY_DIGEST_DEFAULT_HOUR, type InsertNotification } from "@shared/schema";
import { eq, and, lt, lte, gt, gte, sql, or, isNotNull, inArray, desc, isNull } from "drizzle-orm";
import { getProvider } from "../integrations/registry";
import { importChartOfAccounts, exportCustomers, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "../integrations/providers/qbo";
import { publishToPlatform, fetchEngagement } from "../social/publishService";
import { socialAccounts } from "@shared/schema";
import { calculateAllProjectsProfitability } from "../ai/profitabilityEngine";
import { bids } from "@shared/schema";
import { eventBus } from "../events";
import { emailAccounts, emailCampaigns, emailCampaignContacts } from "@shared/schema";
import { syncImapAccount, syncOutlookAccount, syncGmailAccount, drainAccountProviderPushes } from "../emailRoutes";
import { ensureAllEmailPushSubscriptions } from "../emailPushNotifications";
import { sendEmail } from "../services/emailService";
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

  outboxTask = cron.schedule("*/2 * * * *", async () => {
    try {
      await processOutbox();
    } catch (err) {
      logError("Outbox processing failed", { error: String(err) });
    }
  });

  retentionTask = cron.schedule("0 2 * * *", async () => {
    try {
      await processRetentionPolicies();
    } catch (err) {
      logError("Retention processing failed", { error: String(err) });
    }
  });

  syncScheduleTask = cron.schedule("*/15 * * * *", async () => {
    try {
      await processSyncSchedules();
    } catch (err) {
      logError("Sync schedule processing failed", { error: String(err) });
    }
  });

  socialPostTask = cron.schedule("*/2 * * * *", async () => {
    try {
      await processScheduledSocialPosts();
    } catch (err) {
      logError("Social post processing failed", { error: String(err) });
    }
  });

  tokenExpiryTask = cron.schedule("0 3 * * *", async () => {
    try {
      await checkSocialTokenExpiry();
    } catch (err) {
      logError("Token expiry check failed", { error: String(err) });
    }
  });

  complianceCheckTask = cron.schedule("0 7 * * *", async () => {
    try {
      await processComplianceExpirations();
    } catch (err) {
      logError("Compliance expiration check failed", { error: String(err) });
    }
  });

  profitabilityMonitorTask = cron.schedule("*/15 * * * *", async () => {
    try {
      await processProfitabilityMonitor();
    } catch (err) {
      logError("Profitability monitor failed", { error: String(err) });
    }
  });

  idleOpportunityTask = cron.schedule("0 8 * * *", async () => {
    try {
      await processIdleOpportunities();
    } catch (err) {
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
    } catch (err) {
      logError("Weekly report generation failed", { error: String(err) });
    }
  });

  monthlyReportTask = cron.schedule("0 7 1 * *", async () => {
    try {
      await processPeriodicReports("MONTHLY");
    } catch (err) {
      logError("Monthly report generation failed", { error: String(err) });
    }
  });

  dbHealthCheckTask = cron.schedule("0 */6 * * *", async () => {
    try {
      await runDbHealthCheck();
    } catch (err) {
      logError("DB health check failed", { error: String(err) });
    }
  });

  socialEngagementTask = cron.schedule("0 */4 * * *", async () => {
    try {
      await processSocialEngagement();
    } catch (err) {
      logError("Social engagement sync failed", { error: String(err) });
    }
  });

  scheduledCampaignTask = cron.schedule("*/2 * * * *", async () => {
    try {
      await processScheduledCampaigns();
    } catch (err) {
      logError("Scheduled campaign processing failed", { error: String(err) });
    }
  });

  sequenceCadenceTask = cron.schedule("*/2 * * * *", async () => {
    try {
      await processDueExecutions();
    } catch (err) {
      logError("Sequence cadence runner failed", { error: String(err) });
    }
  });

  // Task #581: nightly geocode projects with addresses but no coordinates
  // so they appear on the Projects map view automatically.
  projectGeocodeTask = cron.schedule("30 4 * * *", async () => {
    try {
      await geocodePendingProjects();
    } catch (err) {
      logError("Project geocoding job failed", { error: String(err) });
    }
  });

  // Task #648: detect SLA breaches across all orgs every 5 minutes so the
  // "needs attention" deal queue stays current without an admin manually
  // hitting POST /api/crm/sla/run-check.
  crmSlaBreachTask = cron.schedule("*/5 * * * *", async () => {
    try {
      await processCrmSlaBreaches();
    } catch (err) {
      logError("CRM SLA breach sweep failed", { error: String(err) });
    }
  });

  // Task #648: tick the CRM automation engine for IDLE_DAYS triggers every
  // 10 minutes so idle-day automations actually fire on their own.
  crmIdleAutomationTask = cron.schedule("*/10 * * * *", async () => {
    try {
      await processCrmIdleAutomations();
    } catch (err) {
      logError("CRM idle automation tick failed", { error: String(err) });
    }
  });

  // Task #682/#692: digest of upcoming CRM contact birthdays. Runs hourly
  // and gates per-recipient on Monday 8am in each user's local timezone so
  // the notification lands during business hours regardless of where the
  // user is, not at the server's wall-clock time.
  crmBirthdayDigestTask = cron.schedule("0 * * * *", async () => {
    try {
      await processCrmContactBirthdayDigest();
    } catch (err) {
      logError("CRM contact birthday digest failed", { error: String(err) });
    }
  });

  // Task #693: daily morning email reminder routed to each contact's owner
  // (createdById) so account managers see today's birthdays without having to
  // open the CRM. Per-user opt-in/opt-out is handled by the existing
  // notificationTypePrefs (email channel for REMINDER notifications).
  crmBirthdayDailyTask = cron.schedule("0 7 * * *", async () => {
    try {
      await processCrmContactBirthdayDailyDigest();
    } catch (err) {
      logError("CRM contact birthday daily digest failed", { error: String(err) });
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
  logInfo("Background job runner stopped");
}

export const jobRegistry: Record<string, { fn: () => Promise<void>; description: string; schedule: string }> = {
  outbox:              { fn: () => processOutbox(),                    description: "Process integration outbox events",      schedule: "*/2 * * * *" },
  retention:           { fn: () => processRetentionPolicies(),         description: "Apply data retention policies",           schedule: "0 2 * * *" },
  sync_schedules:      { fn: () => processSyncSchedules(),             description: "Run QBO / integration sync schedules",   schedule: "*/15 * * * *" },
  social_posts:        { fn: () => processScheduledSocialPosts(),      description: "Publish scheduled social media posts",    schedule: "*/2 * * * *" },
  token_expiry:        { fn: () => checkSocialTokenExpiry(),           description: "Check social account token expiry",       schedule: "0 3 * * *" },
  compliance:          { fn: () => processComplianceExpirations(),     description: "Check compliance/cert expirations",       schedule: "0 7 * * *" },
  profitability:       { fn: () => processProfitabilityMonitor(),      description: "Monitor project profitability",           schedule: "*/15 * * * *" },
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

async function processRetentionPolicies() {
  const policies = await db.select()
    .from(retentionPolicies)
    .where(eq(retentionPolicies.enabled, true));

  if (policies.length === 0) return;

  logInfo("Processing retention policies", { count: policies.length });

  for (const policy of policies) {
    try {
      const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);

      if (policy.entityType === "AUDIT_LOGS" && policy.action === "DELETE") {
        await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
      }

      await db.update(retentionPolicies)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(retentionPolicies.id, policy.id));

      logInfo("Retention policy executed", { entityType: policy.entityType, action: policy.action });
    } catch (err) {
      logError("Retention policy failed", { policyId: policy.id, error: String(err) });
    }
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

  const FINANCIAL_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "HUSTLER"];
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

    const [lastSnap] = await db.select()
      .from(projectProfitabilitySnapshots)
      .where(eq(projectProfitabilitySnapshots.projectId, proj.id))
      .orderBy(desc(projectProfitabilitySnapshots.createdAt))
      .limit(1);

    await db.insert(projectProfitabilitySnapshots).values({
      organizationId: proj.gcOrganizationId,
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

      const orgUsers = await db.select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, proj.organizationId),
            sql`${users.role} IN (${FINANCIAL_ROLES.map(r => `'${r}'`).join(",")})`,
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
          organizationId: proj.organizationId || proj.gcOrganizationId || null,
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
