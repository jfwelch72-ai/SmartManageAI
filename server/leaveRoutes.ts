import { Router } from "express";
import { db } from "./db";
import { leaveTypes, leaveRequests, users, calendarEvents, organizations } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { z } from "zod";
import { insertNotification, insertNotifications } from "./services/notificationService";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

async function seedDefaultLeaveTypes(orgId: string) {
  const existing = await db.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.organizationId, orgId)).limit(1);
  if (existing.length > 0) return;

  const defaults = [
    { name: "Vacation", annualAllowance: 15 },
    { name: "Sick", annualAllowance: 10 },
    { name: "Personal", annualAllowance: 3 },
    { name: "Bereavement", annualAllowance: 5 },
    { name: "Jury Duty", annualAllowance: 5 },
    { name: "Other", annualAllowance: 0 },
  ];

  await db.insert(leaveTypes).values(
    defaults.map((d) => ({ ...d, organizationId: orgId, isActive: true }))
  );
}

router.get("/api/leave/types", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await seedDefaultLeaveTypes(orgId);

    const types = await db
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.organizationId, orgId))
      .orderBy(leaveTypes.name);

    res.json(types);
  } catch (error: any) {
    console.error("Get leave types error:", error.message);
    res.status(500).json({ error: "Failed to fetch leave types" });
  }
});

router.post("/api/leave/types", requireAuth, requireRole("ADMIN", "MANAGER", "HR_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const schema = z.object({
      name: z.string().min(1).max(100),
      annualAllowance: z.number().int().min(0),
      isActive: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const [newType] = await db.insert(leaveTypes).values({
      organizationId: orgId,
      name: parsed.data.name,
      annualAllowance: parsed.data.annualAllowance,
      isActive: parsed.data.isActive ?? true,
    }).returning();

    res.status(201).json(newType);
  } catch (error: any) {
    console.error("Create leave type error:", error.message);
    res.status(500).json({ error: "Failed to create leave type" });
  }
});

router.patch("/api/leave/types/:id", requireAuth, requireRole("ADMIN", "MANAGER", "HR_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      annualAllowance: z.number().int().min(0).optional(),
      isActive: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const [updated] = await db
      .update(leaveTypes)
      .set(parsed.data)
      .where(and(eq(leaveTypes.id, req.params.id), eq(leaveTypes.organizationId, orgId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Leave type not found" });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("Update leave type error:", error.message);
    res.status(500).json({ error: "Failed to update leave type" });
  }
});

router.delete("/api/leave/types/:id", requireAuth, requireRole("ADMIN", "MANAGER", "HR_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existing] = await db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(eq(leaveRequests.leaveTypeId, req.params.id))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(leaveTypes)
        .set({ isActive: false })
        .where(and(eq(leaveTypes.id, req.params.id), eq(leaveTypes.organizationId, orgId)))
        .returning();
      if (!updated) {
        return res.status(404).json({ error: "Leave type not found" });
      }
      return res.json(updated);
    }

    const [deleted] = await db
      .delete(leaveTypes)
      .where(and(eq(leaveTypes.id, req.params.id), eq(leaveTypes.organizationId, orgId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Leave type not found" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete leave type error:", error.message);
    res.status(500).json({ error: "Failed to delete leave type" });
  }
});

router.get("/api/leave/balances", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const requestedEmployeeId = req.query.employeeId as string | undefined;
    const userRole = req.user!.role;
    const isManagerRole = ["ADMIN", "MANAGER", "HR_MANAGER", "SUPERINTENDENT"].includes(userRole || "");

    if (requestedEmployeeId && requestedEmployeeId !== req.user!.id && !isManagerRole) {
      return res.status(403).json({ error: "Access denied. Only managers can view other employees' balances." });
    }

    const employeeId = requestedEmployeeId || req.user!.id;

    await seedDefaultLeaveTypes(orgId);

    const types = await db
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.organizationId, orgId), eq(leaveTypes.isActive, true)));

    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;

    const approvedRequests = await db
      .select({
        leaveTypeId: leaveRequests.leaveTypeId,
        totalDays: sql<number>`SUM(
          (${leaveRequests.endDate}::date - ${leaveRequests.startDate}::date) + 1
        )`,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.organizationId, orgId),
          eq(leaveRequests.status, "APPROVED"),
          sql`${leaveRequests.startDate} >= ${yearStart}`,
          sql`${leaveRequests.endDate} <= ${yearEnd}`
        )
      )
      .groupBy(leaveRequests.leaveTypeId);

    const usedMap = new Map(approvedRequests.map((r) => [r.leaveTypeId, Number(r.totalDays) || 0]));

    const balances = types.map((lt) => ({
      leaveTypeId: lt.id,
      leaveTypeName: lt.name,
      annualAllowance: lt.annualAllowance,
      used: usedMap.get(lt.id) || 0,
      remaining: lt.annualAllowance - (usedMap.get(lt.id) || 0),
    }));

    res.json(balances);
  } catch (error: any) {
    console.error("Get leave balances error:", error.message);
    res.status(500).json({ error: "Failed to fetch leave balances" });
  }
});

router.get("/api/leave/requests", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const statusFilter = req.query.status as string | undefined;
    const employeeFilter = req.query.employeeId as string | undefined;
    const scope = req.query.scope as string | undefined;
    const userRole = req.user!.role;
    const isManagerRole = ["ADMIN", "MANAGER", "HR_MANAGER", "SUPERINTENDENT"].includes(userRole || "");

    const conditions = [eq(leaveRequests.organizationId, orgId)];

    if (statusFilter) {
      conditions.push(eq(leaveRequests.status, statusFilter as any));
    }

    if (scope === "mine") {
      conditions.push(eq(leaveRequests.employeeId, req.user!.id));
    } else if (employeeFilter) {
      if (employeeFilter !== req.user!.id && !isManagerRole) {
        return res.status(403).json({ error: "Access denied" });
      }
      conditions.push(eq(leaveRequests.employeeId, employeeFilter));
    } else if (!isManagerRole) {
      conditions.push(eq(leaveRequests.employeeId, req.user!.id));
    }

    const requests = await db
      .select({
        id: leaveRequests.id,
        employeeId: leaveRequests.employeeId,
        organizationId: leaveRequests.organizationId,
        leaveTypeId: leaveRequests.leaveTypeId,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        reason: leaveRequests.reason,
        status: leaveRequests.status,
        reviewerId: leaveRequests.reviewerId,
        reviewerNote: leaveRequests.reviewerNote,
        reviewedAt: leaveRequests.reviewedAt,
        createdAt: leaveRequests.createdAt,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
        leaveTypeName: leaveTypes.name,
      })
      .from(leaveRequests)
      .leftJoin(users, eq(leaveRequests.employeeId, users.id))
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(and(...conditions))
      .orderBy(desc(leaveRequests.createdAt));

    res.json(requests);
  } catch (error: any) {
    console.error("Get leave requests error:", error.message);
    res.status(500).json({ error: "Failed to fetch leave requests" });
  }
});

router.post("/api/leave/requests", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const schema = z.object({
      leaveTypeId: z.string().min(1),
      startDate: z.string().min(1),
      endDate: z.string().min(1),
      reason: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    if (parsed.data.endDate < parsed.data.startDate) {
      return res.status(400).json({ error: "End date must be on or after start date" });
    }

    const [leaveType] = await db
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.id, parsed.data.leaveTypeId), eq(leaveTypes.organizationId, orgId)));

    if (!leaveType) {
      return res.status(400).json({ error: "Invalid leave type" });
    }

    const [newRequest] = await db.insert(leaveRequests).values({
      employeeId: req.user!.id,
      organizationId: orgId,
      leaveTypeId: parsed.data.leaveTypeId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason || null,
    }).returning();

    const adminsAndManagers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, orgId),
          sql`${users.role} IN ('ADMIN', 'MANAGER', 'HR_MANAGER')`,
          eq(users.isActive, true)
        )
      );

    if (adminsAndManagers.length > 0) {
      await insertNotifications(
        adminsAndManagers.map((u) => ({
          userId: u.id,
          type: "TIME_OFF_REQUEST" as const,
          title: "Leave Request Submitted",
          message: `${req.user!.firstName} ${req.user!.lastName} requested ${leaveType.name} leave from ${parsed.data.startDate} to ${parsed.data.endDate}`,
          relatedEntityId: newRequest.id,
          relatedEntityType: "leaveRequest",
        }))
      );
    }

    res.status(201).json(newRequest);
  } catch (error: any) {
    console.error("Create leave request error:", error.message);
    res.status(500).json({ error: "Failed to create leave request" });
  }
});

router.post("/api/leave/requests/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "HR_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const note = req.body.note || null;

    const [request] = await db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, req.params.id), eq(leaveRequests.organizationId, orgId)));

    if (!request) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ error: "Only pending requests can be approved" });
    }

    const [updated] = await db
      .update(leaveRequests)
      .set({
        status: "APPROVED",
        reviewerId: req.user!.id,
        reviewerNote: note,
        reviewedAt: new Date(),
      })
      .where(eq(leaveRequests.id, req.params.id))
      .returning();

    const [leaveType] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, request.leaveTypeId));

    const startDate = new Date(request.startDate + "T00:00:00");
    const endDate = new Date(request.endDate + "T23:59:59");

    await db.insert(calendarEvents).values({
      eventType: "TIME_OFF_APPROVED",
      title: `${leaveType?.name || "Leave"} - Approved`,
      description: `leave_request:${updated.id}${request.reason ? ` - ${request.reason}` : ""}`,
      startDate,
      endDate,
      allDay: true,
      userId: request.employeeId,
      createdById: req.user!.id,
    });

    await insertNotification({
      userId: request.employeeId,
      type: "LEAVE_APPROVED" as const,
      title: "Leave Request Approved",
      message: `Your ${leaveType?.name || "leave"} request (${request.startDate} to ${request.endDate}) has been approved${note ? `: ${note}` : ""}`,
      relatedEntityId: updated.id,
      relatedEntityType: "leaveRequest",
    });

    res.json(updated);
  } catch (error: any) {
    console.error("Approve leave request error:", error.message);
    res.status(500).json({ error: "Failed to approve leave request" });
  }
});

router.post("/api/leave/requests/:id/deny", requireAuth, requireRole("ADMIN", "MANAGER", "HR_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const note = req.body.note || null;

    const [request] = await db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, req.params.id), eq(leaveRequests.organizationId, orgId)));

    if (!request) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    if (request.status !== "PENDING" && request.status !== "APPROVED") {
      return res.status(400).json({ error: "Only pending or approved requests can be denied" });
    }

    const wasApproved = request.status === "APPROVED";

    const [updated] = await db
      .update(leaveRequests)
      .set({
        status: "DENIED",
        reviewerId: req.user!.id,
        reviewerNote: note,
        reviewedAt: new Date(),
      })
      .where(eq(leaveRequests.id, req.params.id))
      .returning();

    const [leaveType] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, request.leaveTypeId));

    if (wasApproved) {
      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.eventType, "TIME_OFF_APPROVED"),
            eq(calendarEvents.userId, request.employeeId),
            sql`${calendarEvents.description} LIKE ${"leave_request:" + request.id + "%"}`
          )
        );
    }

    const actionLabel = wasApproved ? "Revoked" : "Denied";

    await insertNotification({
      userId: request.employeeId,
      type: "LEAVE_DENIED" as const,
      title: `Leave Request ${actionLabel}`,
      message: `Your ${leaveType?.name || "leave"} request (${request.startDate} to ${request.endDate}) has been ${actionLabel.toLowerCase()}${note ? `: ${note}` : ""}`,
      relatedEntityId: updated.id,
      relatedEntityType: "leaveRequest",
    });

    res.json(updated);
  } catch (error: any) {
    console.error("Deny leave request error:", error.message);
    res.status(500).json({ error: "Failed to deny leave request" });
  }
});

router.get("/api/leave/team-calendar", requireAuth, requireRole("ADMIN", "MANAGER", "HR_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const approvedLeave = await db
      .select({
        id: leaveRequests.id,
        employeeId: leaveRequests.employeeId,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        leaveTypeName: leaveTypes.name,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
      })
      .from(leaveRequests)
      .leftJoin(users, eq(leaveRequests.employeeId, users.id))
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(
        and(
          eq(leaveRequests.organizationId, orgId),
          eq(leaveRequests.status, "APPROVED")
        )
      )
      .orderBy(leaveRequests.startDate);

    res.json(approvedLeave);
  } catch (error: any) {
    console.error("Get team calendar error:", error.message);
    res.status(500).json({ error: "Failed to fetch team calendar" });
  }
});

router.delete("/api/leave/requests/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [request] = await db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, req.params.id), eq(leaveRequests.organizationId, orgId)));

    if (!request) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    if (request.employeeId !== req.user!.id) {
      return res.status(403).json({ error: "You can only cancel your own leave requests" });
    }

    if (request.status === "DENIED") {
      return res.status(400).json({ error: "Cannot cancel a denied request" });
    }

    const wasApproved = request.status === "APPROVED";

    if (wasApproved) {
      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.eventType, "TIME_OFF_APPROVED"),
            eq(calendarEvents.userId, request.employeeId),
            sql`${calendarEvents.description} LIKE ${"leave_request:" + request.id + "%"}`
          )
        );
    }

    await db.delete(leaveRequests).where(eq(leaveRequests.id, req.params.id));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Cancel leave request error:", error.message);
    res.status(500).json({ error: "Failed to cancel leave request" });
  }
});

router.patch("/api/leave/requests/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [request] = await db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, req.params.id), eq(leaveRequests.organizationId, orgId)));

    if (!request) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    if (request.employeeId !== req.user!.id) {
      return res.status(403).json({ error: "You can only edit your own leave requests" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ error: "Only pending requests can be edited" });
    }

    const schema = z.object({
      leaveTypeId: z.string().min(1).optional(),
      startDate: z.string().min(1).optional(),
      endDate: z.string().min(1).optional(),
      reason: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    if (parsed.data.leaveTypeId) {
      const [newType] = await db
        .select()
        .from(leaveTypes)
        .where(and(eq(leaveTypes.id, parsed.data.leaveTypeId), eq(leaveTypes.organizationId, orgId), eq(leaveTypes.isActive, true)));
      if (!newType) {
        return res.status(400).json({ error: "Invalid leave type" });
      }
    }

    const updates: Record<string, string> = {};
    if (parsed.data.leaveTypeId) updates.leaveTypeId = parsed.data.leaveTypeId;
    if (parsed.data.startDate) updates.startDate = parsed.data.startDate;
    if (parsed.data.endDate) updates.endDate = parsed.data.endDate;
    if (parsed.data.reason !== undefined) updates.reason = parsed.data.reason;

    const effectiveStart = parsed.data.startDate || request.startDate;
    const effectiveEnd = parsed.data.endDate || request.endDate;
    if (effectiveEnd < effectiveStart) {
      return res.status(400).json({ error: "End date must be on or after start date" });
    }

    const [updated] = await db
      .update(leaveRequests)
      .set(updates)
      .where(eq(leaveRequests.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error("Update leave request error:", error.message);
    res.status(500).json({ error: "Failed to update leave request" });
  }
});

export default router;
