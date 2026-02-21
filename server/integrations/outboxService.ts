import { db } from "../db";
import { integrationEventsOutbox } from "@shared/schema";
import { eq, and, lt, inArray } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import crypto from "crypto";

export async function enqueueEvent(
  orgId: string,
  connectionId: string,
  eventType: string,
  payload: Record<string, any>,
  idempotencyKey?: string
) {
  const key = idempotencyKey || `${connectionId}:${eventType}:${crypto.randomUUID()}`;
  const [event] = await db.insert(integrationEventsOutbox).values({
    organizationId: orgId,
    connectionId,
    eventType,
    payload,
    status: "queued",
    idempotencyKey: key,
  }).returning();
  logInfo("Outbox event enqueued", { eventId: event.id, eventType, orgId });
  return event;
}

export async function getQueuedEvents(limit: number = 50) {
  return db.select().from(integrationEventsOutbox)
    .where(eq(integrationEventsOutbox.status, "queued"))
    .limit(limit);
}

export async function markProcessing(eventId: string) {
  await db.update(integrationEventsOutbox)
    .set({ status: "processing" as any, attempts: 1, lastAttemptAt: new Date() })
    .where(eq(integrationEventsOutbox.id, eventId));
}

export async function markSent(eventId: string) {
  await db.update(integrationEventsOutbox)
    .set({ status: "sent" as any })
    .where(eq(integrationEventsOutbox.id, eventId));
  logInfo("Outbox event sent", { eventId });
}

export async function markFailed(eventId: string, error: string, attempts: number) {
  const status = attempts >= 5 ? "dead_letter" : "failed";
  await db.update(integrationEventsOutbox)
    .set({ status: status as any, lastError: error, attempts, lastAttemptAt: new Date() })
    .where(eq(integrationEventsOutbox.id, eventId));
  if (status === "dead_letter") {
    logError("Outbox event dead-lettered", { eventId, error, attempts });
  }
}

export async function requeueFailed() {
  const result = await db.update(integrationEventsOutbox)
    .set({ status: "queued" as any })
    .where(eq(integrationEventsOutbox.status, "failed"))
    .returning();
  return result.length;
}

export async function getOutboxEvents(orgId: string, limit: number = 100) {
  return db.select().from(integrationEventsOutbox)
    .where(eq(integrationEventsOutbox.organizationId, orgId))
    .limit(limit);
}
