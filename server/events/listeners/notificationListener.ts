import { eventBus } from "../eventBus";
import { db } from "../../db";
import { notifications, users, bids } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logError } from "../../utils/logger";
import { deliverNotifications } from "../../services/notificationDelivery";
import type {
  ChangeOrderApprovedEvent,
  ChangeOrderRejectedEvent,
  PayrollRunCompletedEvent,
  BidConvertedToProjectEvent,
  BidSubmittedEvent,
  BidStatusChangedEvent,
  BidAssignedEvent,
  BidDueDateApproachingEvent,
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

  eventBus.on("bid.submitted", async (event: BidSubmittedEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      await insertNotifications(
        adminIds,
        "BID_SUBMITTED",
        "Bid Submitted to Client",
        `Bid "${event.payload.title}" (${event.payload.bidCode}) has been submitted to ${event.payload.clientName || "client"}`,
        event.payload.bidId,
        "bid"
      );
    } catch (err) {
      logError("notificationListener: bid.submitted failed", { error: String(err) });
    }
  });

  eventBus.on("bid.status_changed", async (event: BidStatusChangedEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      const statusMessages: Record<string, string> = {
        AWARDED: `Bid "${event.payload.title}" (${event.payload.bidCode}) has been awarded!`,
        LOST: `Bid "${event.payload.title}" (${event.payload.bidCode}) was marked as lost.`,
        CANCELLED: `Bid "${event.payload.title}" (${event.payload.bidCode}) has been cancelled.`,
      };
      const message = statusMessages[event.payload.newStatus] ||
        `Bid "${event.payload.title}" (${event.payload.bidCode}) status changed from ${event.payload.oldStatus} to ${event.payload.newStatus}`;

      const recipientIds = new Set(adminIds);

      const [bid] = await db
        .select({ estimatorId: bids.estimatorId })
        .from(bids)
        .where(eq(bids.id, event.payload.bidId))
        .limit(1);
      if (bid?.estimatorId) recipientIds.add(bid.estimatorId);

      await insertNotifications(
        Array.from(recipientIds),
        "BID_STATUS_CHANGED",
        "Bid Status Changed",
        message,
        event.payload.bidId,
        "bid"
      );
    } catch (err) {
      logError("notificationListener: bid.status_changed failed", { error: String(err) });
    }
  });

  eventBus.on("bid.assigned", async (event: BidAssignedEvent) => {
    try {
      await insertNotifications(
        [event.payload.estimatorId],
        "BID_ASSIGNED",
        "Bid Assignment",
        `You have been assigned to bid "${event.payload.title}" (${event.payload.bidCode})`,
        event.payload.bidId,
        "bid"
      );
    } catch (err) {
      logError("notificationListener: bid.assigned failed", { error: String(err) });
    }
  });

  eventBus.on("bid.due_date_approaching", async (event: BidDueDateApproachingEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      const recipientIds = new Set(adminIds);
      if (event.payload.estimatorId) recipientIds.add(event.payload.estimatorId);

      const hoursLabel = event.payload.hoursRemaining <= 24 ? "24 hours" : "48 hours";
      await insertNotifications(
        Array.from(recipientIds),
        "BID_DUE_DATE_APPROACHING",
        "Bid Due Date Approaching",
        `Bid "${event.payload.title}" (${event.payload.bidCode}) is due within ${hoursLabel} (${event.payload.dueDate})`,
        event.payload.bidId,
        "bid"
      );
    } catch (err) {
      logError("notificationListener: bid.due_date_approaching failed", { error: String(err) });
    }
  });
}
