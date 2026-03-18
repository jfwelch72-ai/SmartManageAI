import { Router } from "express";
import { db } from "./db";
import { payrollNotifications, users, projects, notifications } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";
import { deliverNotification, type NotificationRecord } from "./services/notificationDelivery";

const router = Router();

router.get("/api/payroll-notifications", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(payrollNotifications.organizationId, orgId));
    }

    const { status, limit = "20" } = req.query;
    if (status) {
      conditions.push(eq(payrollNotifications.status, status as string));
    }

    const notificationList = await db
      .select({
        notification: payrollNotifications,
        manager: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(payrollNotifications)
      .leftJoin(users, eq(payrollNotifications.approvingManagerId, users.id))
      .leftJoin(projects, eq(payrollNotifications.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(payrollNotifications.createdAt))
      .limit(parseInt(limit as string));

    const formatted = notificationList.map(({ notification, manager, project }) => ({
      ...notification,
      managerName: manager ? `${manager.firstName} ${manager.lastName}` : "Unknown",
      projectName: project?.name,
      projectCode: project?.code,
    }));

    res.json(formatted);
  } catch (error) {
    console.error("Get payroll notifications error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/payroll-notifications", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const schema = z.object({
      periodStart: z.string(),
      periodEnd: z.string(),
      projectId: z.string().optional().nullable(),
      totalShiftsApproved: z.number().optional().default(0),
      totalTimeEntriesApproved: z.number().optional().default(0),
      totalHours: z.string().optional().nullable(),
    });

    const data = schema.parse(req.body);

    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }

    const officeManagers = await db
      .select()
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        eq(users.role, "OFFICE_MANAGER")
      ))
      .limit(1);

    const officeManagerId = officeManagers.length > 0 ? officeManagers[0].id : null;

    const [notification] = await db.insert(payrollNotifications).values({
      organizationId: orgId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      projectId: data.projectId || null,
      approvingManagerId: req.user!.id,
      officeManagerId,
      status: "PENDING",
      totalShiftsApproved: data.totalShiftsApproved,
      totalTimeEntriesApproved: data.totalTimeEntriesApproved,
      totalHours: data.totalHours || null,
    }).returning();

    if (officeManagerId) {
      const [insertedNotif] = await db.insert(notifications).values({
        userId: officeManagerId,
        type: "GENERAL",
        title: "Payroll Ready for Processing",
        message: `Time entries for period ${data.periodStart} to ${data.periodEnd} have been approved and are ready for payroll processing.`,
        relatedEntityId: notification.id,
        relatedEntityType: "payrollNotification",
      }).returning();
      if (insertedNotif) {
        const notifRecord: NotificationRecord = {
          id: insertedNotif.id,
          userId: insertedNotif.userId,
          type: insertedNotif.type as NotificationRecord["type"],
          title: insertedNotif.title,
          message: insertedNotif.message,
          relatedEntityId: insertedNotif.relatedEntityId,
          relatedEntityType: insertedNotif.relatedEntityType,
        };
        setImmediate(() => {
          deliverNotification(notifRecord).catch(() => undefined);
        });
      }
    }

    res.status(201).json(notification);
  } catch (error) {
    console.error("Create payroll notification error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/payroll-notifications/:id/process", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [notification] = await db
      .select()
      .from(payrollNotifications)
      .where(eq(payrollNotifications.id, req.params.id))
      .limit(1);

    if (!notification) {
      return res.status(404).json({ error: "Payroll notification not found" });
    }

    if (shouldFilter && orgId && notification.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [updated] = await db
      .update(payrollNotifications)
      .set({
        status: "PROCESSED",
        processedAt: new Date(),
        processedById: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(payrollNotifications.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Process payroll notification error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
