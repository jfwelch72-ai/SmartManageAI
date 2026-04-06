import { eventBus } from "../eventBus";
import { db } from "../../db";
import { notifications, users, bids } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import {logError, logWarn } from "../../utils/logger";
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
  BudgetAlertTriggeredEvent,
  DocumentRevisionCreatedEvent,
  ProjectCreatedEvent,
  ProjectStatusChangedEvent,
  SafetyIncidentCreatedEvent,
  InspectionCompletedEvent,
} from "../eventTypes";

type NotificationType = NonNullable<(typeof notifications.$inferInsert)["type"]>;

const ADMIN_ROLES = ["ADMIN", "MANAGER"] as const;
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
    logWarn("Non-critical operation failed");
    return [];
  }
}

async function insertNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  message: string,
  relatedEntityId: string,
  relatedEntityType: string,
  organizationId?: string
): Promise<void> {
  if (userIds.length === 0) return;
  const records = userIds.map((userId) => ({
    userId,
    organizationId: organizationId || null,
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
        "changeOrder",
        event.orgId
      );
      const { evaluateBudgetAlerts } = await import("../../costLedgerRoutes");
      evaluateBudgetAlerts(event.payload.projectId).catch(e =>
        logError("notificationListener: budget alert eval after CO approval failed", { error: String(e) })
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
        "changeOrder",
        event.orgId
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
        "payRun",
        event.orgId
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
        "project",
        event.orgId
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
        "bid",
        event.orgId
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
        "bid",
        event.orgId
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
        "bid",
        event.orgId
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
        "bid",
        event.orgId
      );
    } catch (err) {
      logError("notificationListener: bid.due_date_approaching failed", { error: String(err) });
    }
  });

  eventBus.on("budget.alert_triggered", async (event: BudgetAlertTriggeredEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      const costCodeLabel = event.payload.costCode ? `Cost code ${event.payload.costCode}` : "Project total";
      const level = event.payload.alertLevel === "CRITICAL" ? "CRITICAL" : "Warning";
      await insertNotifications(
        adminIds,
        "BUDGET_ALERT",
        `Budget ${level}: ${event.payload.projectCode}`,
        `${costCodeLabel} has reached ${event.payload.currentPercent.toFixed(0)}% of budget (${level} threshold: ${event.payload.thresholdPercent.toFixed(0)}%)`,
        event.payload.projectId,
        "project",
        event.orgId
      );
    } catch (err) {
      logError("notificationListener: budget.alert_triggered failed", { error: String(err) });
    }
  });

  eventBus.on("project.created", async (event: ProjectCreatedEvent) => {
    try {
      const { projects } = await import("@shared/schema");

      const adminIds = await getAdminUserIds(event.orgId);
      const recipientIds = new Set(adminIds);

      const [project] = await db
        .select({
          projectManagerId: projects.projectManagerId,
          estimatorId: projects.estimatorId,
          superintendentId: projects.superintendentId,
        })
        .from(projects)
        .where(eq(projects.id, event.payload.projectId))
        .limit(1);

      if (project) {
        if (project.projectManagerId) recipientIds.add(project.projectManagerId);
        if (project.estimatorId) recipientIds.add(project.estimatorId);
        if (project.superintendentId) recipientIds.add(project.superintendentId);
      }

      await insertNotifications(
        Array.from(recipientIds),
        "PROJECT_ASSIGNMENT",
        "New Project Created",
        `Project "${event.payload.name}" (${event.payload.projectCode}) has been created with status ${event.payload.projectStatus}`,
        event.payload.projectId,
        "project",
        event.orgId
      );
    } catch (err) {
      logError("notificationListener: project.created failed", { error: String(err) });
    }
  });

  eventBus.on("project.status_changed", async (event: ProjectStatusChangedEvent) => {
    try {
      const { projects, projectEmployeeRates } = await import("@shared/schema");

      const [project] = await db
        .select({
          estimatorId: projects.estimatorId,
          superintendentId: projects.superintendentId,
          projectManagerId: projects.projectManagerId,
        })
        .from(projects)
        .where(eq(projects.id, event.payload.projectId))
        .limit(1);

      const adminIds = await getAdminUserIds(event.orgId);
      const recipientIds = new Set(adminIds);

      if (project) {
        if (project.estimatorId) recipientIds.add(project.estimatorId);
        if (project.superintendentId) recipientIds.add(project.superintendentId);
        if (project.projectManagerId) recipientIds.add(project.projectManagerId);
      }

      const teamRows = await db
        .select({ userId: projectEmployeeRates.userId })
        .from(projectEmployeeRates)
        .where(eq(projectEmployeeRates.projectId, event.payload.projectId));
      for (const row of teamRows) {
        recipientIds.add(row.userId);
      }

      await insertNotifications(
        Array.from(recipientIds),
        "PROJECT_ASSIGNMENT",
        "Project Status Changed",
        `Project ${event.payload.projectCode} status changed from ${event.payload.oldStatus} to ${event.payload.newStatus}`,
        event.payload.projectId,
        "project",
        event.orgId
      );
    } catch (err) {
      logError("notificationListener: project.status_changed failed", { error: String(err) });
    }
  });

  eventBus.on("safety.incident_created", async (event: SafetyIncidentCreatedEvent) => {
    try {
      const adminIds = await getAdminUserIds(event.orgId);
      const safetyRoles = ["SUPERINTENDENT"] as const;
      const safetyRows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, event.orgId),
            eq(users.isActive, true),
            inArray(users.role, [...safetyRoles] as unknown as string[])
          )
        );
      const recipientIds = new Set([...adminIds, ...safetyRows.map(r => r.id)]);
      await insertNotifications(
        Array.from(recipientIds),
        "GENERAL",
        "Safety Incident Reported",
        `A safety incident (severity: ${event.payload.severity}) has been reported and requires attention`,
        event.payload.incidentId,
        "safetyIncident",
        event.orgId
      );
    } catch (err) {
      logError("notificationListener: safety.incident_created failed", { error: String(err) });
    }
  });

  eventBus.on("inspection.completed", async (event: InspectionCompletedEvent) => {
    try {
      const { projects, projectEmployeeRates } = await import("@shared/schema");

      const [project] = await db
        .select({
          estimatorId: projects.estimatorId,
          superintendentId: projects.superintendentId,
          projectManagerId: projects.projectManagerId,
        })
        .from(projects)
        .where(eq(projects.id, event.payload.projectId))
        .limit(1);

      const adminIds = await getAdminUserIds(event.orgId);
      const recipientIds = new Set(adminIds);

      if (project) {
        if (project.estimatorId) recipientIds.add(project.estimatorId);
        if (project.superintendentId) recipientIds.add(project.superintendentId);
        if (project.projectManagerId) recipientIds.add(project.projectManagerId);
      }

      const teamRows = await db
        .select({ userId: projectEmployeeRates.userId })
        .from(projectEmployeeRates)
        .where(eq(projectEmployeeRates.projectId, event.payload.projectId));
      for (const row of teamRows) {
        recipientIds.add(row.userId);
      }

      await insertNotifications(
        Array.from(recipientIds),
        "GENERAL",
        "Inspection Completed",
        `Inspection completed with status: ${event.payload.status}`,
        event.payload.inspectionId,
        "inspection",
        event.orgId
      );
    } catch (err) {
      logError("notificationListener: inspection.completed failed", { error: String(err) });
    }
  });

  eventBus.on("document.revision_created", async (event: DocumentRevisionCreatedEvent) => {
    try {
      const { projects, projectEmployeeRates } = await import("@shared/schema");

      const [project] = await db
        .select({
          estimatorId: projects.estimatorId,
          superintendentId: projects.superintendentId,
          projectManagerId: projects.projectManagerId,
          code: projects.code,
        })
        .from(projects)
        .where(eq(projects.id, event.payload.projectId))
        .limit(1);

      const adminIds = await getAdminUserIds(event.orgId);
      const recipientIds = new Set(adminIds);

      if (project) {
        if (project.estimatorId) recipientIds.add(project.estimatorId);
        if (project.superintendentId) recipientIds.add(project.superintendentId);
        if (project.projectManagerId) recipientIds.add(project.projectManagerId);
      }

      const teamRows = await db
        .select({ userId: projectEmployeeRates.userId })
        .from(projectEmployeeRates)
        .where(eq(projectEmployeeRates.projectId, event.payload.projectId));
      for (const row of teamRows) {
        recipientIds.add(row.userId);
      }

      recipientIds.delete(event.actorId);

      const projectCode = event.payload.projectCode || project?.code || "";
      const uploaderLabel = event.payload.uploadedByName || "A team member";
      const entityRef = projectCode
        ? `${projectCode}:${event.payload.documentId}`
        : event.payload.documentId;
      await insertNotifications(
        Array.from(recipientIds),
        "DOCUMENT_REVISION_CREATED",
        "New Drawing Revision",
        `${uploaderLabel} uploaded revision #${event.payload.revisionNumber} for "${event.payload.documentTitle}" (${event.payload.sourceType})`,
        entityRef,
        "drawingRevision",
        event.orgId
      );
    } catch (err) {
      logError("notificationListener: document.revision_created failed", { error: String(err) });
    }
  });
}
