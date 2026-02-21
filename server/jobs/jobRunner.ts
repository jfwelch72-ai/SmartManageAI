import cron from "node-cron";
import * as outboxService from "../integrations/outboxService";
import * as webhookService from "../integrations/webhookService";
import { logInfo, logError } from "../utils/logger";
import { db } from "../db";
import { integrationWebhookSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";

let outboxTask: ReturnType<typeof cron.schedule> | null = null;

export function startJobRunner() {
  logInfo("Starting background job runner");

  outboxTask = cron.schedule("*/2 * * * *", async () => {
    try {
      await processOutbox();
    } catch (err) {
      logError("Outbox processing failed", { error: String(err) });
    }
  });

  logInfo("Background job runner started");
}

export function stopJobRunner() {
  if (outboxTask) {
    outboxTask.stop();
    outboxTask = null;
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
