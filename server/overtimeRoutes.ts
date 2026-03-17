import { Router } from "express";
import { db } from "./db";
import { timeClockShifts, users, projects, overtimeRequests } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";

const router = Router();

router.get("/api/overtime-requests/approvers", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const approvers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        sql`${users.role} IN ('SUPERINTENDENT', 'OFFICE_MANAGER', 'MANAGER', 'ADMIN')`
      ))
      .orderBy(users.firstName);
    res.json(approvers);
  } catch (error) {
    console.error("Get OT approvers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/overtime-requests", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shiftId, requestedHours, superintendentId, notes } = req.body;
    if (!shiftId || !requestedHours || !superintendentId) {
      res.status(400).json({ error: "shiftId, requestedHours, and superintendentId are required" });
      return;
    }

    const hours = parseFloat(requestedHours);
    if (isNaN(hours) || hours <= 0) {
      res.status(400).json({ error: "requestedHours must be a positive number" });
      return;
    }

    const [shift] = await db.select().from(timeClockShifts).where(eq(timeClockShifts.id, shiftId));
    if (!shift) { res.status(404).json({ error: "Shift not found" }); return; }
    if (shift.userId !== req.user!.id) { res.status(403).json({ error: "Not your shift" }); return; }

    const [existing] = await db.select().from(overtimeRequests)
      .where(and(eq(overtimeRequests.shiftId, shiftId), eq(overtimeRequests.userId, req.user!.id)));
    if (existing) { res.status(400).json({ error: "Overtime request already exists for this shift" }); return; }

    const [sup] = await db.select({ id: users.id, organizationId: users.organizationId })
      .from(users).where(eq(users.id, superintendentId));
    if (!sup || sup.organizationId !== req.user!.organizationId) {
      res.status(400).json({ error: "Invalid approver selected" }); return;
    }

    const [otRequest] = await db.insert(overtimeRequests).values({
      shiftId,
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      requestedHours: hours.toFixed(2),
      superintendentId,
      notes: notes ? sanitizeText(notes) : null,
    }).returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "overtime_request",
      entityId: otRequest.id,
      action: "OVERTIME_REQUEST_CREATED",
      oldValue: null,
      newValue: JSON.stringify(otRequest),
    }, req);

    await notifyApprovers(
      req.user!.organizationId,
      req.user!.id,
      {
        type: "OVERTIME_REQUESTED",
        title: "Overtime Request",
        message: `${req.user!.firstName} ${req.user!.lastName} has requested ${hours} hours of overtime`,
        relatedEntityId: otRequest.id,
        relatedEntityType: "overtime_request",
      }
    );

    res.status(201).json(otRequest);
  } catch (error) {
    console.error("Create OT request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/overtime-requests/my", requireAuth, async (req: AuthRequest, res) => {
  try {
    const requests = await db.select().from(overtimeRequests)
      .where(eq(overtimeRequests.userId, req.user!.id))
      .orderBy(desc(overtimeRequests.createdAt));

    const shiftIds = [...new Set(requests.map(r => r.shiftId))];
    const shifts = shiftIds.length > 0
      ? await db.select().from(timeClockShifts)
          .where(sql`${timeClockShifts.id} IN (${sql.join(shiftIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const shiftMap = new Map(shifts.map(s => [s.id, s]));

    const enriched = requests.map(r => ({
      ...r,
      shift: shiftMap.get(r.shiftId) || null,
    }));

    res.json(enriched);
  } catch (error) {
    console.error("Get my OT requests error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/overtime-requests/by-shifts", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shiftIds } = req.body;
    if (!shiftIds || !Array.isArray(shiftIds) || shiftIds.length === 0) {
      res.json([]);
      return;
    }
    const requests = await db.select().from(overtimeRequests)
      .where(sql`${overtimeRequests.shiftId} IN (${sql.join(shiftIds.map((id: string) => sql`${id}`), sql`, `)})`);
    res.json(requests);
  } catch (error) {
    console.error("Get OT by shifts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/overtime-requests/pending", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const requests = await db.select().from(overtimeRequests)
      .where(and(
        eq(overtimeRequests.organizationId, orgId),
        eq(overtimeRequests.status, "PENDING"),
      ))
      .orderBy(desc(overtimeRequests.createdAt));

    const userIds = [...new Set(requests.map(r => r.userId))];
    const shiftIds = [...new Set(requests.map(r => r.shiftId))];

    const userRows = userIds.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
          .from(users).where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const userMap = new Map(userRows.map(u => [u.id, u]));

    const shifts = shiftIds.length > 0
      ? await db.select().from(timeClockShifts)
          .where(sql`${timeClockShifts.id} IN (${sql.join(shiftIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const shiftMap = new Map(shifts.map(s => [s.id, s]));

    const projectIds = [...new Set(shifts.filter(s => s.projectId).map(s => s.projectId!))];
    const projectRows = projectIds.length > 0
      ? await db.select({ id: projects.id, name: projects.name, code: projects.code })
          .from(projects).where(sql`${projects.id} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const projectMap = new Map(projectRows.map(p => [p.id, p]));

    const enriched = requests.map(r => {
      const shift = shiftMap.get(r.shiftId);
      return {
        ...r,
        user: userMap.get(r.userId) || null,
        shift: shift || null,
        project: shift?.projectId ? projectMap.get(shift.projectId) || null : null,
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error("Get pending OT requests error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/overtime-requests/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { approvedHours } = req.body;

    const [otReq] = await db.select().from(overtimeRequests).where(eq(overtimeRequests.id, id));
    if (!otReq) { res.status(404).json({ error: "Overtime request not found" }); return; }
    if (otReq.organizationId !== req.user!.organizationId) { res.status(403).json({ error: "Access denied" }); return; }
    if (otReq.status !== "PENDING") { res.status(400).json({ error: "Request already processed" }); return; }

    const hours = approvedHours ? parseFloat(approvedHours) : parseFloat(otReq.requestedHours);

    const [updated] = await db.update(overtimeRequests)
      .set({
        status: "APPROVED",
        approvedHours: hours.toFixed(2),
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(overtimeRequests.id, id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "overtime_request",
      entityId: id,
      action: "OVERTIME_REQUEST_APPROVED",
      oldValue: JSON.stringify({ status: "PENDING" }),
      newValue: JSON.stringify(updated),
    }, req);

    await notifySubmitter(otReq.userId, {
      type: "OVERTIME_APPROVED",
      title: "Overtime Approved",
      message: `Your overtime request for ${hours} hours has been approved`,
      relatedEntityId: id,
      relatedEntityType: "overtime_request",
    });

    res.json(updated);
  } catch (error) {
    console.error("Approve OT request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/overtime-requests/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) { res.status(400).json({ error: "Rejection reason is required" }); return; }

    const [otReq] = await db.select().from(overtimeRequests).where(eq(overtimeRequests.id, id));
    if (!otReq) { res.status(404).json({ error: "Overtime request not found" }); return; }
    if (otReq.organizationId !== req.user!.organizationId) { res.status(403).json({ error: "Access denied" }); return; }
    if (otReq.status !== "PENDING") { res.status(400).json({ error: "Request already processed" }); return; }

    const [updated] = await db.update(overtimeRequests)
      .set({
        status: "REJECTED",
        rejectionReason: sanitizeText(reason),
        updatedAt: new Date(),
      })
      .where(eq(overtimeRequests.id, id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "overtime_request",
      entityId: id,
      action: "OVERTIME_REQUEST_REJECTED",
      oldValue: JSON.stringify({ status: "PENDING" }),
      newValue: JSON.stringify(updated),
    }, req);

    await notifySubmitter(otReq.userId, {
      type: "OVERTIME_REJECTED",
      title: "Overtime Rejected",
      message: `Your overtime request has been rejected: ${reason}`,
      relatedEntityId: id,
      relatedEntityType: "overtime_request",
    });

    res.json(updated);
  } catch (error) {
    console.error("Reject OT request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
