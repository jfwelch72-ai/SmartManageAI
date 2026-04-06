/**
 * @openapi
 * /api/overtime-requests/approvers:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get overtime request approvers
 *     responses:
 *       200: { description: List of approvers }
 * /api/overtime-requests:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Submit overtime request
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shiftId, reason]
 *             properties:
 *               shiftId: { type: string, format: uuid }
 *               reason: { type: string }
 *     responses:
 *       201: { description: Overtime request created }
 * /api/overtime-requests/my:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get my overtime requests
 *     responses:
 *       200: { description: List of overtime requests }
 * /api/overtime-requests/by-shifts:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Get overtime requests by shift IDs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shiftIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Overtime requests for given shifts }
 * /api/overtime-requests/pending:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get pending overtime requests
 *     description: Requires manager-level role.
 *     responses:
 *       200: { description: Pending overtime requests }
 * /api/overtime-requests/{id}/approve:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Approve overtime request
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Overtime request approved }
 * /api/overtime-requests/{id}/reject:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Reject overtime request
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Overtime request rejected }
 * /api/overtime-rules:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: List overtime rules
 *     description: Requires ADMIN or MANAGER role.
 *     responses:
 *       200: { description: List of overtime rules }
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Create overtime rule
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Overtime rule created }
 * /api/overtime-rules/{id}:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get overtime rule details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Overtime rule details }
 *   patch:
 *     tags: [Time & Attendance]
 *     summary: Update overtime rule
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Overtime rule updated }
 *   delete:
 *     tags: [Time & Attendance]
 *     summary: Delete overtime rule
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Overtime rule deleted }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { timeClockShifts, users, projects, overtimeRequests, overtimeRules } from "@shared/schema";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
import { z } from "zod";

const router = Router();

router.get("/api/overtime-requests/approvers", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const approvers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        sql`${users.role} IN ('SUPERINTENDENT', 'MANAGER', 'ADMIN')`
      ))
      .orderBy(users.firstName);
    res.json(approvers);
  } catch (error) {
    logError("Get OT approvers error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Create OT request error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get my OT requests error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get OT by shifts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/overtime-requests/pending", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    logError("Get pending OT requests error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/overtime-requests/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    }, req.user?.organizationId);

    res.json(updated);
  } catch (error) {
    logError("Approve OT request error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/overtime-requests/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    }, req.user?.organizationId);

    res.json(updated);
  } catch (error) {
    logError("Reject OT request error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/overtime-rules", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const rules = await db.select().from(overtimeRules)
      .where(eq(overtimeRules.organizationId, orgId))
      .orderBy(desc(overtimeRules.createdAt));
    res.json(rules.map(formatRuleResponse));
  } catch (error) {
    logError("Get overtime rules error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/overtime-rules/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [rule] = await db.select().from(overtimeRules)
      .where(and(eq(overtimeRules.id, req.params.id), eq(overtimeRules.organizationId, req.user!.organizationId)));
    if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
    res.json(formatRuleResponse(rule));
  } catch (error) {
    logError("Get overtime rule error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

function formatRuleResponse(rule: Record<string, unknown>) {
  return {
    id: rule.id,
    organizationId: rule.organizationId,
    projectId: rule.projectId,
    dailyOtThreshold: parseFloat(String(rule.dailyThreshold)) || 8,
    dailyDtThreshold: parseFloat(String(rule.doubleTimeThreshold)) || 12,
    weeklyOtThreshold: parseFloat(String(rule.weeklyThreshold)) || 40,
    weeklyDtThreshold: parseFloat(String(rule.weeklyDtThreshold)) || 60,
    otMultiplier: parseFloat(String(rule.otMultiplier)) || 1.5,
    dtMultiplier: parseFloat(String(rule.dtMultiplier)) || 2.0,
    isActive: rule.isActive,
    consecutiveDayRule: rule.consecutiveDayRule,
    consecutiveDayThreshold: rule.consecutiveDayThreshold,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

router.post("/api/overtime-rules", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      projectId: z.string().optional().nullable(),
      dailyOtThreshold: z.number().optional().default(8),
      dailyDtThreshold: z.number().optional().default(12),
      weeklyOtThreshold: z.number().optional().default(40),
      weeklyDtThreshold: z.number().optional().default(60),
      otMultiplier: z.number().optional().default(1.5),
      dtMultiplier: z.number().optional().default(2.0),
      dailyThreshold: z.string().optional(),
      weeklyThreshold: z.string().optional(),
      doubleTimeThreshold: z.string().optional().nullable(),
      consecutiveDayRule: z.boolean().optional().default(false),
      consecutiveDayThreshold: z.number().optional().default(7),
    });

    const data = schema.parse(req.body);
    const orgId = req.user!.organizationId;

    const dailyThreshold = data.dailyThreshold || String(data.dailyOtThreshold);
    const weeklyThreshold = data.weeklyThreshold || String(data.weeklyOtThreshold);
    const doubleTimeThreshold = data.doubleTimeThreshold || String(data.dailyDtThreshold);

    const dailyVal = parseFloat(dailyThreshold);
    const weeklyVal = parseFloat(weeklyThreshold);
    const dtVal = doubleTimeThreshold ? parseFloat(doubleTimeThreshold) : null;
    const weeklyDtVal = data.weeklyDtThreshold;

    if (dailyVal < 0 || weeklyVal < 0 || !isFinite(dailyVal) || !isFinite(weeklyVal)) {
      res.status(400).json({ error: "Thresholds must be non-negative finite numbers" });
      return;
    }
    if (dtVal !== null && (dtVal < dailyVal || !isFinite(dtVal))) {
      res.status(400).json({ error: "Daily double-time threshold must be >= daily OT threshold" });
      return;
    }
    if (weeklyDtVal < weeklyVal) {
      res.status(400).json({ error: "Weekly double-time threshold must be >= weekly OT threshold" });
      return;
    }
    if (data.otMultiplier < 1 || data.dtMultiplier < 1) {
      res.status(400).json({ error: "Multipliers must be >= 1.0" });
      return;
    }

    if (data.projectId) {
      const [proj] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
        .from(projects).where(eq(projects.id, data.projectId));
      if (!proj || proj.gcOrganizationId !== orgId) {
        res.status(400).json({ error: "Project not found or does not belong to your organization" });
        return;
      }
    }

    if (!data.projectId) {
      const [existing] = await db.select().from(overtimeRules)
        .where(and(
          eq(overtimeRules.organizationId, orgId),
          isNull(overtimeRules.projectId),
          eq(overtimeRules.isActive, true),
        ));
      if (existing) {
        res.status(400).json({ error: "An active org-level overtime rule already exists. Edit or deactivate it first." });
        return;
      }
    }

    const [rule] = await db.insert(overtimeRules).values({
      organizationId: orgId,
      projectId: data.projectId || null,
      dailyThreshold,
      weeklyThreshold,
      doubleTimeThreshold,
      weeklyDtThreshold: String(data.weeklyDtThreshold),
      otMultiplier: String(data.otMultiplier),
      dtMultiplier: String(data.dtMultiplier),
      consecutiveDayRule: data.consecutiveDayRule,
      consecutiveDayThreshold: data.consecutiveDayThreshold,
    }).returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "overtime_rule",
      entityId: rule.id,
      action: "CREATE",
      oldValue: null,
      newValue: JSON.stringify(rule),
    }, req);

    res.status(201).json(formatRuleResponse(rule));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input", details: error.errors });
      return;
    }
    logError("Create overtime rule error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/overtime-rules/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      dailyOtThreshold: z.number().optional(),
      dailyDtThreshold: z.number().optional(),
      weeklyOtThreshold: z.number().optional(),
      weeklyDtThreshold: z.number().optional(),
      otMultiplier: z.number().min(1).optional(),
      dtMultiplier: z.number().min(1).optional(),
      dailyThreshold: z.string().optional(),
      weeklyThreshold: z.string().optional(),
      doubleTimeThreshold: z.string().optional().nullable(),
      consecutiveDayRule: z.boolean().optional(),
      consecutiveDayThreshold: z.number().int().min(1).optional(),
      isActive: z.boolean().optional(),
    });

    const data = schema.parse(req.body);
    const orgId = req.user!.organizationId;

    const [existing] = await db.select().from(overtimeRules)
      .where(and(eq(overtimeRules.id, req.params.id), eq(overtimeRules.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }

    const effectiveDaily = data.dailyOtThreshold !== undefined ? data.dailyOtThreshold
      : data.dailyThreshold !== undefined ? parseFloat(data.dailyThreshold)
      : parseFloat(existing.dailyThreshold);
    const effectiveWeekly = data.weeklyOtThreshold !== undefined ? data.weeklyOtThreshold
      : data.weeklyThreshold !== undefined ? parseFloat(data.weeklyThreshold)
      : parseFloat(existing.weeklyThreshold);
    const effectiveDailyDt = data.dailyDtThreshold !== undefined ? data.dailyDtThreshold
      : data.doubleTimeThreshold !== undefined ? (data.doubleTimeThreshold !== null ? parseFloat(data.doubleTimeThreshold) : null)
      : (existing.doubleTimeThreshold ? parseFloat(existing.doubleTimeThreshold) : null);
    const effectiveWeeklyDt = data.weeklyDtThreshold !== undefined ? data.weeklyDtThreshold
      : (existing.weeklyDtThreshold ? parseFloat(existing.weeklyDtThreshold) : 60);
    const effectiveOtMul = data.otMultiplier !== undefined ? data.otMultiplier : parseFloat(existing.otMultiplier || "1.5");
    const effectiveDtMul = data.dtMultiplier !== undefined ? data.dtMultiplier : parseFloat(existing.dtMultiplier || "2.0");

    if (effectiveDaily < 0 || effectiveWeekly < 0 || !isFinite(effectiveDaily) || !isFinite(effectiveWeekly)) {
      res.status(400).json({ error: "Thresholds must be non-negative finite numbers" });
      return;
    }
    if (effectiveDailyDt !== null && effectiveDailyDt < effectiveDaily) {
      res.status(400).json({ error: "Daily double-time threshold must be >= daily OT threshold" });
      return;
    }
    if (effectiveWeeklyDt < effectiveWeekly) {
      res.status(400).json({ error: "Weekly double-time threshold must be >= weekly OT threshold" });
      return;
    }
    if (effectiveOtMul < 1 || effectiveDtMul < 1) {
      res.status(400).json({ error: "Multipliers must be >= 1.0" });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.dailyOtThreshold !== undefined) updates.dailyThreshold = String(data.dailyOtThreshold);
    if (data.dailyThreshold !== undefined) updates.dailyThreshold = data.dailyThreshold;
    if (data.weeklyOtThreshold !== undefined) updates.weeklyThreshold = String(data.weeklyOtThreshold);
    if (data.weeklyThreshold !== undefined) updates.weeklyThreshold = data.weeklyThreshold;
    if (data.dailyDtThreshold !== undefined) updates.doubleTimeThreshold = String(data.dailyDtThreshold);
    if (data.doubleTimeThreshold !== undefined) updates.doubleTimeThreshold = data.doubleTimeThreshold;
    if (data.weeklyDtThreshold !== undefined) updates.weeklyDtThreshold = String(data.weeklyDtThreshold);
    if (data.otMultiplier !== undefined) updates.otMultiplier = String(data.otMultiplier);
    if (data.dtMultiplier !== undefined) updates.dtMultiplier = String(data.dtMultiplier);
    if (data.consecutiveDayRule !== undefined) updates.consecutiveDayRule = data.consecutiveDayRule;
    if (data.consecutiveDayThreshold !== undefined) updates.consecutiveDayThreshold = data.consecutiveDayThreshold;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    const [updated] = await db.update(overtimeRules).set(updates)
      .where(eq(overtimeRules.id, req.params.id)).returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "overtime_rule",
      entityId: req.params.id,
      action: "UPDATE",
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);

    res.json(formatRuleResponse(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input", details: error.errors });
      return;
    }
    logError("Update overtime rule error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/overtime-rules/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const [existing] = await db.select().from(overtimeRules)
      .where(and(eq(overtimeRules.id, req.params.id), eq(overtimeRules.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }

    await db.delete(overtimeRules).where(eq(overtimeRules.id, req.params.id));

    await logAudit({
      userId: req.user!.id,
      entityType: "overtime_rule",
      entityId: req.params.id,
      action: "DELETE",
      oldValue: JSON.stringify(existing),
      newValue: null,
    }, req);

    res.json({ success: true });
  } catch (error) {
    logError("Delete overtime rule error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
