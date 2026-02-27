import cron from "node-cron";
import * as outboxService from "../integrations/outboxService";
import * as webhookService from "../integrations/webhookService";
import * as connectionService from "../integrations/connectionService";
import { logInfo, logError } from "../utils/logger";
import { db } from "../db";
import { integrationWebhookSubscriptions, retentionPolicies, auditLog, qboSyncSchedules, integrationSyncState, socialMediaPosts } from "@shared/schema";
import { eq, and, lt, lte, sql } from "drizzle-orm";
import { getProvider } from "../integrations/registry";
import { importChartOfAccounts, exportCustomers, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "../integrations/providers/qbo";

let outboxTask: ReturnType<typeof cron.schedule> | null = null;
let retentionTask: ReturnType<typeof cron.schedule> | null = null;
let syncScheduleTask: ReturnType<typeof cron.schedule> | null = null;
let socialPostTask: ReturnType<typeof cron.schedule> | null = null;

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

  logInfo("Background job runner started (with retention, sync, and social post schedulers)");
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
      await db.update(socialMediaPosts)
        .set({
          status: "POSTED",
          publishedAt: now,
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

      logInfo("Social post published", { postId: post.id, platform: post.platform });
    } catch (err) {
      const retries = (post.retryCount || 0) + 1;
      const newStatus = retries >= 3 ? "FAILED" : "SCHEDULED";
      await db.update(socialMediaPosts)
        .set({
          status: newStatus as any,
          retryCount: retries,
          lastError: String(err),
          updatedAt: now,
        })
        .where(eq(socialMediaPosts.id, post.id));
      logError("Failed to process social post", { postId: post.id, retries, error: String(err) });
    }
  }
}
