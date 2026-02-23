import cron from "node-cron";
import * as outboxService from "../integrations/outboxService";
import * as webhookService from "../integrations/webhookService";
import { logInfo, logError } from "../utils/logger";
import { db } from "../db";
import { integrationWebhookSubscriptions, retentionPolicies, auditLog } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";

let outboxTask: ReturnType<typeof cron.schedule> | null = null;
let retentionTask: ReturnType<typeof cron.schedule> | null = null;

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

  logInfo("Background job runner started (with retention scheduler)");
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
