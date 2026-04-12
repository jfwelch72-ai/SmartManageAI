import cron from "node-cron";
import crypto from "crypto";
import * as outboxService from "../integrations/outboxService";
import * as webhookService from "../integrations/webhookService";
import * as connectionService from "../integrations/connectionService";
import { logInfo, logError } from "../utils/logger";
import { insertNotification, insertNotifications } from "../services/notificationService";
import { db } from "../db";
import { integrationWebhookSubscriptions, retentionPolicies, auditLog, qboSyncSchedules, integrationSyncState, socialMediaPosts, crmOrganisations, crmOpportunities, crmOpportunityActivities, notifications, organizationNetworkSettings, users, projects, projectProfitabilitySnapshots, uploadIntents, type InsertNotification } from "@shared/schema";
import { eq, and, lt, lte, gt, gte, sql, or, isNotNull, inArray, desc, isNull } from "drizzle-orm";
import { getProvider } from "../integrations/registry";
import { importChartOfAccounts, exportCustomers, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "../integrations/providers/qbo";
import { publishToPlatform, fetchEngagement } from "../social/publishService";
import { socialAccounts } from "@shared/schema";
import { calculateAllProjectsProfitability } from "../ai/profitabilityEngine";
import { bids } from "@shared/schema";
import { eventBus } from "../events";
import { emailAccounts } from "@shared/schema";
import { syncImapAccount, syncOutlookAccount } from "../emailRoutes";

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
let weeklyReportTask: ReturnType<typeof cron.schedule> | null = null;
let monthlyReportTask: ReturnType<typeof cron.schedule> | null = null;
let dbHealthCheckTask: ReturnType<typeof cron.schedule> | null = null;
let socialEngagementTask: ReturnType<typeof cron.schedule> | null = null;

export function startJobRunner() {
  logInfo("Starting background job runner");

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

  logInfo("Background job runner started (with retention, sync, social post, token expiry, compliance, profitability monitor, idle opportunity, orphan upload, bid due date, IMAP email sync, periodic report, and DB health check schedulers)");
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
  weekly_report:       { fn: () => processPeriodicReports("WEEKLY"),   description: "Generate weekly reports",                 schedule: "0 7 * * 1" },
  monthly_report:      { fn: () => processPeriodicReports("MONTHLY"),  description: "Generate monthly reports",                schedule: "0 7 1 * *" },
  db_health_check:     { fn: () => runDbHealthCheck(),                 description: "Run database health check",              schedule: "0 */6 * * *" },
  social_engagement:   { fn: () => processSocialEngagement(),          description: "Sync social media engagement metrics",    schedule: "0 */4 * * *" },
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

  const assigneeMap = new Map<string, { userId: string; orgId: string; names: string[] }>();
  for (const opp of idleOpps) {
    if (!opp.assignedToId) continue;
    const key = opp.assignedToId;
    if (!assigneeMap.has(key)) {
      assigneeMap.set(key, { userId: opp.assignedToId, orgId: opp.organizationId, names: [] });
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

    const outlookAccounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.isActive, true),
          eq(emailAccounts.provider, "OUTLOOK")
        )
      );

    if (imapAccounts.length === 0 && outlookAccounts.length === 0) return;

    if (imapAccounts.length > 0) {
      logInfo("Processing IMAP email sync", { count: imapAccounts.length });
    }
    if (outlookAccounts.length > 0) {
      logInfo("Processing Outlook email sync", { count: outlookAccounts.length });
    }

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

    for (const account of outlookAccounts) {
      try {
        const result = await syncOutlookAccount(account, account.userId);
        if (result.messagesImported > 0) {
          logInfo("Outlook sync completed", {
            account: account.emailAddress,
            messagesImported: result.messagesImported,
            threadsCreated: result.threadsCreated,
          });
        }
        if (result.errors.length > 0) {
          logError("Outlook sync had errors", {
            account: account.emailAddress,
            errors: result.errors.slice(0, 3),
          });
        }
      } catch (err) {
        logError("Outlook sync failed for account", {
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
