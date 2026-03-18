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
