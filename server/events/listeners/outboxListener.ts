import { eventBus } from "../eventBus";
import { db } from "../../db";
import { integrationWebhookSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { enqueueEvent } from "../../integrations/outboxService";
import { logError } from "../../utils/logger";
import type { DomainEvent } from "../eventTypes";

async function fanOutToWebhooks(event: DomainEvent): Promise<void> {
  try {
    const subscriptions = await db
      .select()
      .from(integrationWebhookSubscriptions)
      .where(
        and(
          eq(integrationWebhookSubscriptions.organizationId, event.orgId),
          eq(integrationWebhookSubscriptions.eventType, event.type),
          eq(integrationWebhookSubscriptions.isActive, true)
        )
      );

    for (const sub of subscriptions) {
      await enqueueEvent(
        event.orgId,
        sub.connectionId,
        event.type,
        {
          event: event.type,
          orgId: event.orgId,
          actorId: event.actorId,
          timestamp: event.timestamp.toISOString(),
          payload: event.payload,
        },
        `${sub.connectionId}:${event.type}:${event.timestamp.getTime()}`
      );
    }
  } catch (err) {
    logError("outboxListener: fanOutToWebhooks failed", {
      error: String(err),
      eventType: event.type,
      orgId: event.orgId,
    });
  }
}

export function registerOutboxListener(): void {
  eventBus.onAll(fanOutToWebhooks);
}
