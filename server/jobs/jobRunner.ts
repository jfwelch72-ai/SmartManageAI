import cron from "node-cron";
import * as outboxService from "../integrations/outboxService";
import * as webhookService from "../integrations/webhookService";
import * as connectionService from "../integrations/connectionService";
import { logInfo, logError } from "../utils/logger";
import { db } from "../db";
import { integrationWebhookSubscriptions, retentionPolicies, auditLog, qboSyncSchedules, integrationSyncState, socialMediaPosts, crmOrganisations, crmOpportunities, crmOpportunityActivities, notifications, organizationNetworkSettings, users, projects, projectProfitabilitySnapshots, type InsertNotification } from "@shared/schema";
import { eq, and, lt, lte, sql, or, isNotNull, inArray, desc } from "drizzle-orm";
import { getProvider } from "../integrations/registry";
import { importChartOfAccounts, exportCustomers, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "../integrations/providers/qbo";
import { publishToPlatform } from "../social/publishService";
import { socialAccounts } from "@shared/schema";
import { calculateAllProjectsProfitability } from "../ai/profitabilityEngine";

let outboxTask: ReturnType<typeof cron.schedule> | null = null;
let retentionTask: ReturnType<typeof cron.schedule> | null = null;
let syncScheduleTask: ReturnType<typeof cron.schedule> | null = null;
let socialPostTask: ReturnType<typeof cron.schedule> | null = null;
let tokenExpiryTask: ReturnType<typeof cron.schedule> | null = null;
let complianceCheckTask: ReturnType<typeof cron.schedule> | null = null;
let profitabilityMonitorTask: ReturnType<typeof cron.schedule> | null = null;
let idleOpportunityTask: ReturnType<typeof cron.schedule> | null = null;

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

  logInfo("Background job runner started (with retention, sync, social post, token expiry, compliance, profitability monitor, and idle opportunity schedulers)");
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
  logInfo("Background job runner stopped");
}

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
          externalPostId = result.externalPostId;
          externalPostUrl = result.externalPostUrl;
        } else if (account && !account.accessTokenEncrypted) {
          logInfo("Social account has no token, marking as published locally", { postId: post.id });
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
    await db.insert(notifications).values({
      userId: post.createdById,
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
        inArray(users.role, ["ADMIN", "MANAGER", "OFFICE_MANAGER", "PROCUREMENT_MANAGER"])
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
      await db.insert(notifications).values(deduped);
      logInfo("Compliance notifications created", { count: deduped.length });
    } else {
      logInfo("Compliance check: all notifications already exist (unread)");
    }
  }
}

async function processProfitabilityMonitor() {
  logInfo("Starting profitability monitor run");

  const FINANCIAL_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HUSTLER", "PROJECT_ENGINEER", "PROCUREMENT_MANAGER"];
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
    await db.insert(notifications).values(notificationValues as any);
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
      type: "CRM_IDLE_OPPORTUNITY",
      title: `${count} pipeline deal${count !== 1 ? "s" : ""} need attention`,
      message: `No activity in ${IDLE_DAYS}+ days: ${preview}${extra}. Open the pipeline to follow up.`,
      relatedEntityType: "CRM_OPPORTUNITY",
    });
  }

  if (toInsert.length > 0) {
    await db.insert(notifications).values(toInsert);
    logInfo("Idle opportunity notifications sent", { count: toInsert.length });
  } else {
    logInfo("Idle opportunity check: all assignees already notified today or in-app disabled");
  }
}
