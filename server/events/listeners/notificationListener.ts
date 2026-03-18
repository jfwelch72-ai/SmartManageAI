import { eventBus } from "../eventBus";
import { db } from "../../db";
import { notifications, users } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logError } from "../../utils/logger";
import { deliverNotifications } from "../../services/notificationDelivery";
import type {
  ChangeOrderApprovedEvent,
  ChangeOrderRejectedEvent,
  PayrollRunCompletedEvent,
  BidConvertedToProjectEvent,
} from "../eventTypes";

type NotificationType = NonNullable<(typeof notifications.$inferInsert)["type"]>;

const ADMIN_ROLES = ["ADMIN", "MANAGER", "OFFICE_MANAGER"] as const;
type AdminRole = (typeof ADMIN_ROLES)[number];

async function getAdminUserIds(orgId: string): Promise<string[]> {
  try {
    const roles: AdminRole[] = [...ADMIN_ROLES];
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, orgId),
          eq(users.isActive, true),
          inArray(users.role, roles as unknown as string[])
        )
      );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

async function insertNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  message: string,
  relatedEntityId: string,
  relatedEntityType: string
): Promise<void> {
  if (userIds.length === 0) return;
  const records = userIds.map((userId) => ({
    userId,
    type,
    title,
    message,
    relatedEntityId,
    relatedEntityType,
  }));
  const inserted = await db.insert(notifications).values(records).returning();
  setImmediate(() => {
    deliverNotifications(inserted as Parameters<typeof deliverNotifications>[0]).catch(() => undefined);
  });
}

export function registerNotificationListener(): void {
  eventBus.on("change_order.approved", async (event: ChangeOrderApprovedEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      await insertNotifications(
        adminIds,
        "CHANGE_ORDER_APPROVED",
        "Change Order Approved",
        `Change order on project was approved for $${event.payload.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        event.payload.changeOrderId,
        "changeOrder"
      );
    } catch (err) {
      logError("notificationListener: change_order.approved failed", { error: String(err) });
    }
  });

  eventBus.on("change_order.rejected", async (event: ChangeOrderRejectedEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      await insertNotifications(
        adminIds,
        "CHANGE_ORDER_REJECTED",
        "Change Order Rejected",
        `Change order was rejected: ${event.payload.reason}`,
        event.payload.changeOrderId,
        "changeOrder"
      );
    } catch (err) {
      logError("notificationListener: change_order.rejected failed", { error: String(err) });
    }
  });

  eventBus.on("payroll.run.completed", async (event: PayrollRunCompletedEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      await insertNotifications(
        adminIds,
        "BILLING_READY",
        "Payroll Run Completed",
        `Pay run for ${event.payload.periodStart} – ${event.payload.periodEnd} has been marked PAID ($${event.payload.totalGross.toLocaleString("en-US", { minimumFractionDigits: 2 })} gross, ${event.payload.employeeCount} employees)`,
        event.payload.payRunId,
        "payRun"
      );
    } catch (err) {
      logError("notificationListener: payroll.run.completed failed", { error: String(err) });
    }
  });

  eventBus.on("bid.converted_to_project", async (event: BidConvertedToProjectEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      await insertNotifications(
        adminIds,
        "PROJECT_ASSIGNMENT",
        "Bid Converted to Project",
        `Bid ${event.payload.bidCode} has been converted to project ${event.payload.projectCode}`,
        event.payload.projectId,
        "project"
      );
    } catch (err) {
      logError("notificationListener: bid.converted_to_project failed", { error: String(err) });
    }
  });
}
