import { db } from "../db";
import { notifications, type InsertNotification } from "@shared/schema";
import { deliverNotification, type NotificationRecord } from "./notificationDelivery";

export async function insertNotification(values: InsertNotification): Promise<void> {
  const [inserted] = await db.insert(notifications).values(values).returning();
  if (inserted) {
    const record: NotificationRecord = {
      id: inserted.id,
      userId: inserted.userId,
      type: inserted.type as NotificationRecord["type"],
      title: inserted.title,
      message: inserted.message,
      relatedEntityId: inserted.relatedEntityId,
      relatedEntityType: inserted.relatedEntityType,
    };
    setImmediate(() => {
      deliverNotification(record).catch(() => undefined);
    });
  }
}

// ---------------------------------------------------------------------------
// Task #715: coalesce rapid-fire single-contact CRM reassignments so a new
// owner doesn't get one email per contact when a teammate reassigns dozens of
// contacts one-by-one through the single PUT endpoint. The bulk endpoint
// already collapses into one notification; this helper gives the single-PUT
// path equivalent behaviour.
//
// Strategy: send the *first* reassignment notification immediately so single,
// occasional reassignments still feel snappy. Open a 5-minute coalescing
// window per recipient; any further reassignments arriving inside that window
// are accumulated into a single summary notification flushed when the window
// closes.
// ---------------------------------------------------------------------------

const REASSIGNMENT_COALESCE_WINDOW_MS = 5 * 60 * 1000;

interface PendingReassignment {
  organizationId?: string;
  additionalCount: number;
  reassignerNames: Set<string>;
  firstAdditionalContactId: string | null;
  timer: NodeJS.Timeout;
}

const pendingReassignmentsByRecipient = new Map<string, PendingReassignment>();

export interface QueueContactReassignmentArgs {
  recipientUserId: string;
  organizationId?: string;
  reassignerName: string;
  contactId: string;
  contactName: string;
}

export function queueContactReassignmentNotification(args: QueueContactReassignmentArgs): void {
  const existing = pendingReassignmentsByRecipient.get(args.recipientUserId);
  if (existing) {
    existing.additionalCount += 1;
    existing.reassignerNames.add(args.reassignerName);
    if (!existing.firstAdditionalContactId) {
      existing.firstAdditionalContactId = args.contactId;
    }
    if (!existing.organizationId && args.organizationId) {
      existing.organizationId = args.organizationId;
    }
    return;
  }

  insertNotification({
    userId: args.recipientUserId,
    organizationId: args.organizationId,
    type: "CRM_CONTACT_REASSIGNED",
    title: "A CRM contact was assigned to you",
    message: `${args.reassignerName} assigned ${args.contactName} to you.`,
    relatedEntityId: args.contactId,
    relatedEntityType: "CRM_CONTACT",
  }).catch(() => undefined);

  const timer = setTimeout(() => {
    flushPendingReassignment(args.recipientUserId).catch(() => undefined);
  }, REASSIGNMENT_COALESCE_WINDOW_MS);
  if (typeof timer.unref === "function") timer.unref();

  pendingReassignmentsByRecipient.set(args.recipientUserId, {
    organizationId: args.organizationId,
    additionalCount: 0,
    reassignerNames: new Set<string>(),
    firstAdditionalContactId: null,
    timer,
  });
}

async function flushPendingReassignment(recipientUserId: string): Promise<void> {
  const entry = pendingReassignmentsByRecipient.get(recipientUserId);
  if (!entry) return;
  pendingReassignmentsByRecipient.delete(recipientUserId);
  if (entry.additionalCount === 0) return;

  const count = entry.additionalCount;
  const noun = count === 1 ? "contact" : "contacts";
  const reassigners = Array.from(entry.reassignerNames);
  const reassignerName = reassigners.length === 1 ? reassigners[0] : "Teammates";

  await insertNotification({
    userId: recipientUserId,
    organizationId: entry.organizationId,
    type: "CRM_CONTACT_REASSIGNED",
    title: `${count} more CRM ${noun} assigned to you`,
    message: `${reassignerName} assigned ${count} more ${noun} to you in the last few minutes. Review them in the CRM.`,
    relatedEntityId: entry.firstAdditionalContactId,
    relatedEntityType: "CRM_CONTACT",
  });
}

// Test-only helpers so unit tests can exercise the coalescer without waiting
// the real five minutes.
export function __flushContactReassignmentForTest(recipientUserId: string): Promise<void> {
  const entry = pendingReassignmentsByRecipient.get(recipientUserId);
  if (entry) clearTimeout(entry.timer);
  return flushPendingReassignment(recipientUserId);
}

export function __resetContactReassignmentQueueForTest(): void {
  for (const entry of pendingReassignmentsByRecipient.values()) {
    clearTimeout(entry.timer);
  }
  pendingReassignmentsByRecipient.clear();
}

export async function insertNotifications(valuesList: InsertNotification[]): Promise<void> {
  if (valuesList.length === 0) return;
  const inserted = await db.insert(notifications).values(valuesList).returning();
  if (inserted.length > 0) {
    const records: NotificationRecord[] = inserted.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type as NotificationRecord["type"],
      title: n.title,
      message: n.message,
      relatedEntityId: n.relatedEntityId,
      relatedEntityType: n.relatedEntityType,
    }));
    setImmediate(() => {
      Promise.allSettled(records.map((r) => deliverNotification(r))).catch(() => undefined);
    });
  }
}
