import { db } from "../db";
import { notifications, users, notificationTypeEnum } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { deliverNotifications, type NotificationRecord } from "./notificationDelivery";

const APPROVER_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT"] as const;
type ApproverRole = typeof APPROVER_ROLES[number];

type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

interface NotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityId: string;
  relatedEntityType: string;
}

export async function notifyUsers(
  userIds: string[],
  params: NotificationParams,
  organizationId?: string
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    const records = userIds.map(userId => ({
      userId,
      organizationId: organizationId || null,
      type: params.type,
      title: params.title,
      message: params.message,
      relatedEntityId: params.relatedEntityId,
      relatedEntityType: params.relatedEntityType,
    }));

    const inserted = await db.insert(notifications).values(records).returning();
    logInfo("Approval notifications created", {
      type: params.type,
      recipientCount: userIds.length,
      entityId: params.relatedEntityId,
    });
    const deliveryRecords: NotificationRecord[] = inserted.map(n => ({
      id: n.id,
      userId: n.userId,
      type: n.type as NotificationType | null,
      title: n.title,
      message: n.message,
      relatedEntityId: n.relatedEntityId,
      relatedEntityType: n.relatedEntityType,
    }));
    setImmediate(() => {
      deliverNotifications(deliveryRecords).catch(() => undefined);
    });
  } catch (error) {
    logError("Failed to create approval notifications", { error: String(error), type: params.type });
  }
}

export async function getApproverUserIds(
  organizationId: string,
  excludeUserId?: string,
  roles: readonly string[] = APPROVER_ROLES
): Promise<string[]> {
  try {
    const approvers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.isActive, true),
          inArray(users.role, [...roles] as Array<typeof users.$inferSelect.role>)
        )
      );

    return approvers
      .map(u => u.id)
      .filter(id => id !== excludeUserId);
  } catch (error) {
    logError("Failed to fetch approver user IDs", { error: String(error), organizationId });
    return [];
  }
}

export async function notifyApprovers(
  organizationId: string,
  excludeUserId: string,
  params: NotificationParams,
  roles?: readonly string[]
): Promise<void> {
  const approverIds = await getApproverUserIds(organizationId, excludeUserId, roles);
  await notifyUsers(approverIds, params, organizationId);
}

export async function notifySubmitter(
  submitterUserId: string,
  params: NotificationParams,
  organizationId?: string
): Promise<void> {
  await notifyUsers([submitterUserId], params, organizationId);
}
