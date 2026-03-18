import { eventBus } from "../eventBus";
import { db } from "../../db";
import { integrationWebhookSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { enqueueEvent } from "../../integrations/outboxService";
import { logError } from "../../utils/logger";
import type { DomainEvent } from "../eventTypes";

function getEntityId(event: DomainEvent): string {
  switch (event.type) {
    case "project.created":
    case "project.status_changed":
      return event.payload.projectId;
    case "bid.submitted":
    case "bid.converted_to_project":
      return event.payload.bidId;
    case "change_order.approved":
    case "change_order.rejected":
      return event.payload.changeOrderId;
    case "timeclock.checked_in":
    case "timeclock.checked_out":
      return event.payload.shiftId;
    case "payroll.run.completed":
      return event.payload.payRunId;
  }
}

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

    const entityId = getEntityId(event);

    for (const sub of subscriptions) {
      await enqueueEvent(
        event.orgId,
        sub.connectionId,
        event.type,
        {
          event: event.type,
          version: event.version,
          orgId: event.orgId,
          actorId: event.actorId,
          timestamp: event.timestamp.toISOString(),
          payload: event.payload,
        },
        // Idempotency key includes entity ID to prevent collision
        // when multiple distinct events of the same type occur within the same millisecond.
        `${sub.connectionId}:${event.type}:${entityId}:${event.timestamp.getTime()}`
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
