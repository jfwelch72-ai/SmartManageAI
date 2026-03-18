import { db } from "../db";
import { notifications, users } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { deliverNotifications } from "./notificationDelivery";

const APPROVER_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT"] as const;

interface NotificationParams {
  type: string;
  title: string;
  message: string;
  relatedEntityId: string;
  relatedEntityType: string;
}

export async function notifyUsers(
  userIds: string[],
  params: NotificationParams
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    const records = userIds.map(userId => ({
      userId,
      type: params.type as any,
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
    setImmediate(() => {
      deliverNotifications(inserted as Parameters<typeof deliverNotifications>[0]).catch(() => undefined);
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
          inArray(users.role, roles as any)
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
  await notifyUsers(approverIds, params);
}

export async function notifySubmitter(
  submitterUserId: string,
  params: NotificationParams
): Promise<void> {
  await notifyUsers([submitterUserId], params);
}
