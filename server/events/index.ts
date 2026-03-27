export { eventBus } from "./eventBus";
export type { DomainEvent, DomainEventType } from "./eventTypes";
export { ALL_DOMAIN_EVENT_TYPES } from "./eventTypes";

import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { domainEvents } from "@shared/schema";
import { eventBus } from "./eventBus";
import { ALL_DOMAIN_EVENT_TYPES } from "./eventTypes";
import type { DomainEvent, DomainEventType } from "./eventTypes";
import { registerNotificationListener } from "./listeners/notificationListener";
import { registerOutboxListener } from "./listeners/outboxListener";
import { registerHiringEventListener } from "./listeners/hiringEventListener";
import { registerAuditListener } from "./listeners/auditListener";
import { registerCrmEventListener } from "./listeners/crmEventListener";
import { registerHealthScoreListener } from "./listeners/healthScoreListener";
import { logError, logInfo } from "../utils/logger";

let initialized = false;

export function initializeEventBus(): void {
  if (initialized) return;
  initialized = true;

  registerNotificationListener();
  registerOutboxListener();
  registerHiringEventListener();
  registerAuditListener();
  registerCrmEventListener();
  registerHealthScoreListener();

  // Startup health check: error if any event type has no listeners registered.
  for (const type of ALL_DOMAIN_EVENT_TYPES) {
    if (eventBus.getListenerCount(type) === 0) {
      logError(`EventBus: no listeners registered for event type "${type}"`, {
        eventType: type,
      });
    }
  }

  // Startup replay: re-dispatch any PENDING events older than 60 s (crash recovery).
  void replayPendingEvents();
}

/**
 * Query stale PENDING domain events and re-dispatch them to in-process listeners.
 * A row is considered stale if it has been PENDING for more than 60 seconds,
 * which indicates the server crashed before it could mark the event PROCESSED.
 */
async function replayPendingEvents(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 60_000);

    const pending = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.status, "PENDING"),
          lt(domainEvents.createdAt, cutoff)
        )
      );

    if (pending.length === 0) return;

    logInfo(`EventBus replay: found ${pending.length} stale PENDING event(s) — re-dispatching`);

    for (const row of pending) {
      const event = {
        type: row.type,
        version: row.version,
        orgId: row.orgId,
        actorId: row.actorId,
        timestamp: row.createdAt,
        payload: row.payload,
      } as unknown as DomainEvent;

      await eventBus.replay(row.id, event);
    }
  } catch (err) {
    logError("EventBus replay: failed to query stale PENDING events", {
      error: String(err),
    });
  }
}
