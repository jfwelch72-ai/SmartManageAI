/**
 * @openapi
 * /api/time-clock/clock-in:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Clock in
 *     description: Start a new shift for the authenticated user. Validates geofence if configured.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId: { type: string, format: uuid }
 *               costCode: { type: string }
 *               notes: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       201: { description: Clocked in successfully }
 *       400: { description: Already clocked in }
 * /api/time-clock/clock-out:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Clock out
 *     description: End the current active shift for the authenticated user.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200: { description: Clocked out successfully }
 *       400: { description: No active shift }
 * /api/time-clock/my-current-shift:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get current active shift
 *     description: Returns the currently active shift for the authenticated user, if any.
 *     responses:
 *       200:
 *         description: Active shift or null
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TimeClockShift'
 * /api/time-clock/my-shifts:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get my shifts
 *     description: Returns shift history for the authenticated user. Supports date range filtering.
 *     parameters:
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: List of shifts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TimeClockShift'
 * /api/time-clock/my-shifts/{id}/notes:
 *   patch:
 *     tags: [Time & Attendance]
 *     summary: Update shift notes
 *     description: Allows the employee to update notes on their own shift.
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
 *             properties:
 *               notes: { type: string }
 *     responses:
 *       200: { description: Notes updated }
 * /api/time-clock/my-shift/cost-code:
 *   patch:
 *     tags: [Time & Attendance]
 *     summary: Update cost code on active shift
 *     description: Change the cost code on the current active shift.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [costCode]
 *             properties:
 *               costCode: { type: string }
 *     responses:
 *       200: { description: Cost code updated }
 *       400: { description: No active shift }
 * /api/time-clock/pending-approvals:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get shifts pending approval
 *     description: Returns shifts awaiting manager approval. Requires ADMIN, MANAGER, SUPERINTENDENT, OFFICE_MANAGER, HR_MANAGER, or DISPATCHER role.
 *     responses:
 *       200: { description: List of pending shifts }
 * /api/time-clock/active-shifts:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get all currently active shifts
 *     description: Returns all employees currently clocked in. Requires manager-level role.
 *     responses:
 *       200: { description: List of active shifts }
 * /api/time-clock/employee/{userId}/shifts:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get shifts for a specific employee
 *     description: Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Employee shift history }
 * /api/time-clock/shifts/{id}/adjust:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Adjust a shift (manager)
 *     description: Allows managers to adjust clock-in/out times on a shift. Requires manager-level role.
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
 *             properties:
 *               clockIn: { type: string, format: date-time }
 *               clockOut: { type: string, format: date-time }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Shift adjusted }
 * /api/time-clock/shift/{id}/admin-clock-out:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Admin clock out an employee
 *     description: Forces clock-out for a specific shift. Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Employee clocked out }
 * /api/time-clock/shifts/{id}/approve:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Approve a shift
 *     description: Requires ADMIN, MANAGER, SUPERINTENDENT, OFFICE_MANAGER, HR_MANAGER, or DISPATCHER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Shift approved }
 * /api/time-clock/shifts/{id}/reject:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Reject a shift
 *     description: Requires manager-level role.
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
 *       200: { description: Shift rejected }
 * /api/time-clock/live:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get live time clock dashboard data
 *     description: Returns real-time overview of who is clocked in. Requires ADMIN or MANAGER role.
 *     responses:
 *       200: { description: Live time clock data }
 * /api/time-clock/auto-clock-out-worker:
 *   post:
 *     tags: [Time & Attendance]
 *     summary: Auto clock-out a worker
 *     description: Triggers automatic clock-out for a specific worker. Requires ADMIN role.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Worker auto clocked out }
 * /api/projects/{projectId}/labor-hours:
 *   get:
 *     tags: [Time & Attendance]
 *     summary: Get labor hours for a project
 *     description: Returns labor hour breakdown by employee for a specific project. Requires ADMIN, MANAGER, or SUPERINTENDENT role.
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Labor hours breakdown }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import { 
  timeClockShifts, timeClockEvents, users, projects, timeEntries,
  kpiAssignments, kpiTemplates, kpiEntries, orgCostCodes, organizations, projectCostCodes
} from "@shared/schema";
import { eq, and, desc, gte, lte, isNull, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { z } from "zod";
import { 
  captureProductionRateFromShift, 
  checkAndNotifyWeeklyReport, 
  MAX_SHIFT_HOURS 
} from "./timeClockHelpers";

const router = Router();

const GEOFENCE_RADIUS = 200;

async function getProjectEligibleCostCodes(organizationId: string, projectId: string | null): Promise<Set<string>> {
  if (projectId) {
    const assigned = await db.select({ costCode: projectCostCodes.costCode })
      .from(projectCostCodes)
      .where(and(eq(projectCostCodes.projectId, projectId), eq(projectCostCodes.isActive, true)));
    if (assigned.length > 0) {
      return new Set(assigned.map(a => a.costCode));
    }
  }

  const { getCostCodesForTrade } = await import("@shared/costCodes");
  const [org] = await db.select({ tradeType: organizations.tradeType })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const tradeType = org?.tradeType || "OTHER";
  const staticCodes = getCostCodesForTrade(tradeType);

  const orgRows = await db.select().from(orgCostCodes)
    .where(and(eq(orgCostCodes.organizationId, organizationId)));

  const activeCustom = orgRows.filter(r => r.isCustom && r.isActive);
  const orgCodeSet = new Set(orgRows.map(r => r.code));
  const deactivated = new Set(orgRows.filter(r => !r.isActive).map(r => r.code));

  const eligible = new Set<string>();
  for (const cc of activeCustom) {
    eligible.add(cc.code);
  }
  for (const sc of staticCodes) {
    if (!orgCodeSet.has(sc.code) || (orgCodeSet.has(sc.code) && !deactivated.has(sc.code))) {
      eligible.add(sc.code);
    }
  }

  return eligible;
}

async function validateCostCode(organizationId: string, costCode: string, projectId?: string | null): Promise<boolean> {
  const eligible = await getProjectEligibleCostCodes(organizationId, projectId || null);
  return eligible.has(costCode);
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function captureKpiFromShift(userId: string, orgId: string, totalHours: number, shiftDate: Date) {
  try {
    const assignments = await db
      .select({
        assignmentId: kpiAssignments.id,
        templateName: kpiTemplates.name,
      })
      .from(kpiAssignments)
      .innerJoin(kpiTemplates, eq(kpiAssignments.kpiTemplateId, kpiTemplates.id))
      .where(and(
        eq(kpiAssignments.userId, userId),
        eq(kpiAssignments.isActive, true),
      ));

    const periodStart = shiftDate.toISOString().split("T")[0];
    const periodEnd = periodStart;

    for (const a of assignments) {
      const name = (a.templateName || "").toLowerCase();
      let value: number | null = null;

      if (name.includes("hours worked")) {
        value = totalHours;
      } else if (name.includes("overtime ratio")) {
        const regularHours = Math.min(totalHours, 8);
        const overtimeHours = Math.max(0, totalHours - 8);
        value = totalHours > 0 ? (overtimeHours / totalHours) * 100 : 0;
      }

      if (value !== null) {
        await db.insert(kpiEntries).values({
          organizationId: orgId,
          kpiAssignmentId: a.assignmentId,
          actualValue: value.toFixed(2),
          periodStart,
          periodEnd,
          source: "auto",
          notes: `Auto-captured from time clock shift on ${periodStart}`,
          recordedBy: userId,
        });
      }
    }
  } catch (err) {
    logError("KPI auto-capture failed:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

router.post("/api/time-clock/clock-in", requireAuth, async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const schema = z.object({
      projectId: z.string().optional().nullable(),
      costCode: z.string().optional().nullable(),
      latitude: z.number().optional().nullable(),
      longitude: z.number().optional().nullable(),
      notes: z.string().optional().nullable(),
    });

    const data = schema.parse(sanitizedBody);

    const [activeShift] = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.userId, req.user!.id),
        isNull(timeClockShifts.clockOut)
      ))
      .limit(1);

    if (activeShift) {
      res.status(400).json({ error: "You already have an active shift. Please clock out first." });
      return;
    }

    const now = new Date();

    let geofenceStatus: string = "NOT_CONFIGURED";
    let geofenceWarning: string | null = null;

    let enforcementMode: string = "OFF";

    if (data.projectId) {
      const [project] = await db.select().from(projects).where(
        and(eq(projects.id, data.projectId), eq(projects.gcOrganizationId, req.user!.organizationId))
      ).limit(1);
      if (!project) {
        res.status(400).json({ error: "Project not found or does not belong to your organization" });
        return;
      }
      enforcementMode = project?.geofenceEnforcement || "OFF";
      if (project?.siteLatitude && project?.siteLongitude) {
        if (data.latitude != null && data.longitude != null) {
          const distance = calculateDistance(data.latitude, data.longitude, project.siteLatitude, project.siteLongitude);
          const radius = project.geofenceRadius || GEOFENCE_RADIUS;
          if (distance <= radius) {
            geofenceStatus = "WITHIN_RANGE";
          } else {
            geofenceStatus = "OUT_OF_RANGE";
            geofenceWarning = `You are approximately ${Math.round(distance)}m from the project site (allowed: ${radius}m).`;
          }
        } else {
          geofenceStatus = "NO_GPS";
        }
      }
    }

    if (enforcementMode === "BLOCK" && (geofenceStatus === "OUT_OF_RANGE" || geofenceStatus === "NO_GPS")) {
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: "BLOCKED",
        action: "CLOCK_IN_BLOCKED",
        oldValue: null,
        newValue: JSON.stringify({
          projectId: data.projectId,
          geofenceStatus,
          reason: geofenceStatus === "NO_GPS" ? "GPS unavailable" : geofenceWarning,
          location: data.latitude && data.longitude ? [data.latitude, data.longitude] : null,
        }),
      }, req);

      res.status(403).json({
        error: geofenceStatus === "NO_GPS"
          ? "Clock-in blocked: GPS is required for this project but is unavailable."
          : `Clock-in blocked: ${geofenceWarning}`,
        geofenceStatus,
        blocked: true,
      });
      return;
    }

    if (data.costCode) {
      const isValid = await validateCostCode(req.user!.organizationId, data.costCode, data.projectId);
      if (!isValid) {
        res.status(400).json({ error: "Invalid or inactive cost code for this project" });
        return;
      }
    }

    const [newShift] = await db.insert(timeClockShifts).values({
      userId: req.user!.id,
      projectId: data.projectId || null,
      costCode: data.costCode || null,
      clockIn: now,
      clockInLatitude: data.latitude != null ? data.latitude : null,
      clockInLongitude: data.longitude != null ? data.longitude : null,
      notes: data.notes || null,
      autoClockOut: false,
      geofenceStatus,
      approvalStatus: "PENDING",
    }).returning();

    await db.insert(timeClockEvents).values({
      shiftId: newShift.id,
      eventType: "CLOCK_IN",
      timestamp: now,
      latitude: data.latitude != null ? data.latitude : null,
      longitude: data.longitude != null ? data.longitude : null,
      notes: data.notes || null,
      performedById: req.user!.id,
    });

    await logAudit({
      userId: req.user!.id,
      entityType: "TIME_CLOCK_SHIFT",
      entityId: newShift.id,
      action: "CLOCK_IN",
      oldValue: null,
      newValue: JSON.stringify({ projectId: data.projectId, location: data.latitude && data.longitude ? [data.latitude, data.longitude] : null }),
    }, req);

    await eventBus.emit({
      type: "timeclock.checked_in",
      version: 1,
      orgId: req.user!.organizationId || "",
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: {
        shiftId: newShift.id,
        userId: req.user!.id,
        projectId: data.projectId || null,
        lat: data.latitude != null ? data.latitude : null,
        lng: data.longitude != null ? data.longitude : null,
      },
    });

    res.status(201).json({ ...newShift, geofenceWarning });
  } catch (error) {
    logError("Clock-in error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-clock/clock-out", requireAuth, async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const schema = z.object({
      latitude: z.number().optional().nullable(),
      longitude: z.number().optional().nullable(),
      notes: z.string().optional().nullable(),
    });

    const data = schema.parse(sanitizedBody);

    const [activeShift] = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.userId, req.user!.id),
        isNull(timeClockShifts.clockOut)
      ))
      .limit(1);

    if (!activeShift) {
      res.status(400).json({ error: "No active shift found. Please clock in first." });
      return;
    }

    const now = new Date();
    const clockInTime = new Date(activeShift.clockIn);
    const totalHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

    const [updatedShift] = await db
      .update(timeClockShifts)
      .set({
        clockOut: now,
        clockOutLatitude: data.latitude != null ? data.latitude : null,
        clockOutLongitude: data.longitude != null ? data.longitude : null,
        totalHours: totalHours.toString(),
        notes: data.notes || activeShift.notes,
        updatedAt: now,
      })
      .where(eq(timeClockShifts.id, activeShift.id))
      .returning();

    await db.insert(timeClockEvents).values({
      shiftId: activeShift.id,
      eventType: "CLOCK_OUT",
      timestamp: now,
      latitude: data.latitude != null ? data.latitude : null,
      longitude: data.longitude != null ? data.longitude : null,
      notes: data.notes || null,
      performedById: req.user!.id,
    });

    await logAudit({
      userId: req.user!.id,
      entityType: "TIME_CLOCK_SHIFT",
      entityId: activeShift.id,
      action: "CLOCK_OUT",
      oldValue: JSON.stringify({ clockIn: activeShift.clockIn }),
      newValue: JSON.stringify({ clockOut: now, totalHours }),
    }, req);

    await eventBus.emit({
      type: "timeclock.checked_out",
      version: 1,
      orgId: req.user!.organizationId || "",
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: {
        shiftId: activeShift.id,
        userId: req.user!.id,
        totalHours,
        projectId: activeShift.projectId || null,
      },
    });

    res.json(updatedShift);
  } catch (error) {
    logError("Clock-out error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/my-current-shift", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [activeShift] = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.userId, req.user!.id),
        isNull(timeClockShifts.clockOut)
      ))
      .limit(1);

    if (!activeShift) {
      res.json({ shift: null, project: null });
      return;
    }

    let project = null;
    if (activeShift.projectId) {
      const [projectData] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, activeShift.projectId))
        .limit(1);
      project = projectData || null;
    }

    res.json({ shift: activeShift, project });
  } catch (error) {
    logError("Get current shift error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/my-shifts", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate, page = "1", pageSize = "50" } = req.query;

    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);
    const offset = (pageNum - 1) * pageSizeNum;

    const conditions = [eq(timeClockShifts.userId, req.user!.id)];
    
    if (startDate) {
      conditions.push(gte(timeClockShifts.clockIn, new Date(startDate as string)));
    }
    if (endDate) {
      conditions.push(lte(timeClockShifts.clockIn, new Date(endDate as string)));
    }

    const shifts = await db
      .select()
      .from(timeClockShifts)
      .where(and(...conditions))
      .orderBy(desc(timeClockShifts.clockIn))
      .limit(pageSizeNum)
      .offset(offset);

    const projectIds = [...new Set(shifts.filter(s => s.projectId).map(s => s.projectId!))];
    let projectMap = new Map<string, { id: string; name: string; code: string | null }>();
    if (projectIds.length > 0) {
      const projectRows = await db.select({ id: projects.id, name: projects.name, code: projects.code })
        .from(projects)
        .where(and(inArray(projects.id, projectIds), eq(projects.gcOrganizationId, req.user!.organizationId)));
      projectMap = new Map(projectRows.map(p => [p.id, p]));
    }

    const enriched = shifts.map(s => ({
      ...s,
      project: s.projectId ? projectMap.get(s.projectId) || null : null,
    }));

    res.json(enriched);
  } catch (error) {
    logError("Get my shifts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/time-clock/my-shifts/:id/notes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const schema = z.object({
      notes: z.string(),
    });

    const data = schema.parse(sanitizedBody);

    const [shift] = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.id, req.params.id),
        eq(timeClockShifts.userId, req.user!.id)
      ))
      .limit(1);

    if (!shift) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }

    const [updatedShift] = await db
      .update(timeClockShifts)
      .set({ notes: data.notes, updatedAt: new Date() })
      .where(eq(timeClockShifts.id, req.params.id))
      .returning();

    res.json(updatedShift);
  } catch (error) {
    logError("Update notes error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/time-clock/my-shift/cost-code", requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      costCode: z.string().nullable(),
    });

    const data = schema.parse(req.body);

    const [activeShift] = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.userId, req.user!.id),
        isNull(timeClockShifts.clockOut)
      ))
      .limit(1);

    if (!activeShift) {
      res.status(400).json({ error: "No active shift found." });
      return;
    }

    if (data.costCode) {
      const isValid = await validateCostCode(req.user!.organizationId, data.costCode, activeShift.projectId);
      if (!isValid) {
        res.status(400).json({ error: "Invalid or inactive cost code for this project" });
        return;
      }
    }

    const [updatedShift] = await db
      .update(timeClockShifts)
      .set({ costCode: data.costCode, updatedAt: new Date() })
      .where(eq(timeClockShifts.id, activeShift.id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "TIME_CLOCK_SHIFT",
      entityId: activeShift.id,
      action: "UPDATE_COST_CODE",
      oldValue: JSON.stringify({ costCode: activeShift.costCode }),
      newValue: JSON.stringify({ costCode: data.costCode }),
    }, req);

    res.json(updatedShift);
  } catch (error) {
    logError("Update cost code error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/pending-approvals", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const pendingShifts = await db
      .select({
        shift: timeClockShifts,
        user: users,
        project: projects,
      })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
      .where(and(
        eq(timeClockShifts.approvalStatus, "PENDING"),
        sql`${timeClockShifts.clockOut} IS NOT NULL`,
        eq(users.organizationId, orgId)
      ))
      .orderBy(desc(timeClockShifts.clockOut));

    const formattedShifts = pendingShifts.map(({ shift, user, project }) => ({
      ...shift,
      user: user ? {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      } : null,
      project: project ? {
        id: project.id,
        name: project.name,
        code: project.code,
      } : null,
      userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
      userEmail: user?.email,
      projectName: project?.name,
      projectCode: project?.code,
    }));

    res.json(formattedShifts);
  } catch (error) {
    logError("Get pending approvals error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/active-shifts", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const activeShifts = await db
      .select({
        shift: timeClockShifts,
        user: users,
        project: projects,
      })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
      .where(and(
        sql`${timeClockShifts.clockOut} IS NULL`,
        eq(users.organizationId, orgId)
      ))
      .orderBy(desc(timeClockShifts.clockIn));

    const formattedShifts = activeShifts.map(({ shift, user, project }) => ({
      ...shift,
      user: user ? {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      } : null,
      project: project ? {
        id: project.id,
        name: project.name,
        code: project.code,
      } : null,
      userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
      userEmail: user?.email,
      projectName: project?.name,
      projectCode: project?.code,
    }));

    res.json(formattedShifts);
  } catch (error) {
    logError("Get active shifts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/employee/:userId/shifts", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate, page = "1", pageSize = "50" } = req.query;

    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);
    const offset = (pageNum - 1) * pageSizeNum;

    const [targetUser] = await db.select({ id: users.id, organizationId: users.organizationId })
      .from(users).where(eq(users.id, req.params.userId)).limit(1);
    if (!targetUser || targetUser.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const conditions = [eq(timeClockShifts.userId, req.params.userId)];
    
    if (startDate) {
      conditions.push(gte(timeClockShifts.clockIn, new Date(startDate as string)));
    }
    if (endDate) {
      conditions.push(lte(timeClockShifts.clockIn, new Date(endDate as string)));
    }

    const shifts = await db
      .select()
      .from(timeClockShifts)
      .where(and(...conditions))
      .orderBy(desc(timeClockShifts.clockIn))
      .limit(pageSizeNum)
      .offset(offset);

    res.json(shifts);
  } catch (error) {
    logError("Get employee shifts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-clock/shifts/:id/adjust", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      reason: req.body.reason ? sanitizeText(req.body.reason) : undefined,
    };

    const schema = z.object({
      clockIn: z.string().optional(),
      clockOut: z.string().optional(),
      projectId: z.string().optional().nullable(),
      notes: z.string().optional(),
      reason: z.string().min(1, "Reason for adjustment is required"),
      adminOverride: z.boolean().optional(),
    });

    const data = schema.parse(sanitizedBody);

    const [shiftWithUser] = await db
      .select({ shift: timeClockShifts, userOrgId: users.organizationId })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(eq(timeClockShifts.id, req.params.id))
      .limit(1);

    if (!shiftWithUser) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }

    const shift = shiftWithUser.shift;

    if (shiftWithUser.userOrgId !== req.user!.organizationId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (shift.approvalStatus === "APPROVED") {
      if (req.user!.role !== "ADMIN" || !data.adminOverride) {
        res.status(403).json({ 
          error: "This shift has been approved and is locked. Only administrators can adjust approved shifts with explicit override." 
        });
        return;
      }
    }

    const updates: any = { updatedAt: new Date() };
    
    if (shift.approvalStatus === "APPROVED" && req.user!.role === "ADMIN" && data.adminOverride) {
      updates.notes = shift.notes ? `${shift.notes}\nAdmin override adjustment: ${data.reason}` : `Admin override adjustment: ${data.reason}`;
    } else if (shift.approvalStatus === "APPROVED") {
      updates.approvalStatus = "PENDING";
      updates.approvedById = null;
      updates.approvedAt = null;
    }

    if (data.clockIn) updates.clockIn = new Date(data.clockIn);
    if (data.clockOut) updates.clockOut = new Date(data.clockOut);
    if (data.projectId !== undefined) updates.projectId = data.projectId;
    if (data.notes) updates.notes = data.notes;

    if (data.clockIn || data.clockOut) {
      const clockIn = data.clockIn ? new Date(data.clockIn) : new Date(shift.clockIn);
      const clockOut = data.clockOut ? new Date(data.clockOut) : (shift.clockOut ? new Date(shift.clockOut) : null);
      if (clockOut) {
        const totalHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
        updates.totalHours = totalHours.toString();
      }
    }

    const [updatedShift] = await db
      .update(timeClockShifts)
      .set(updates)
      .where(eq(timeClockShifts.id, req.params.id))
      .returning();

    await db.insert(timeClockEvents).values({
      shiftId: req.params.id,
      eventType: "ADJUSTMENT",
      timestamp: new Date(),
      notes: `Manager adjustment: ${data.reason}`,
      performedById: req.user!.id,
    });

    await logAudit({
      userId: req.user!.id,
      entityType: "TIME_CLOCK_SHIFT",
      entityId: req.params.id,
      action: "ADJUST",
      oldValue: JSON.stringify(shift),
      newValue: JSON.stringify({ ...updates, reason: data.reason }),
    }, req);

    res.json(updatedShift);
  } catch (error) {
    logError("Adjust shift error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-clock/shift/:id/admin-clock-out", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      reason: req.body.reason ? sanitizeText(req.body.reason) : undefined,
    };

    const schema = z.object({
      reason: z.string().min(1, "Reason is required"),
    });

    const data = schema.parse(sanitizedBody);

    const [shiftWithUser] = await db
      .select({ shift: timeClockShifts, userOrgId: users.organizationId })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(and(
        eq(timeClockShifts.id, req.params.id),
        isNull(timeClockShifts.clockOut)
      ))
      .limit(1);

    if (!shiftWithUser) {
      res.status(404).json({ error: "Active shift not found" });
      return;
    }

    const shift = shiftWithUser.shift;

    if (shiftWithUser.userOrgId !== req.user!.organizationId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const now = new Date();
    const clockInTime = new Date(shift.clockIn);
    const totalHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

    const [updatedShift] = await db
      .update(timeClockShifts)
      .set({
        clockOut: now,
        totalHours: totalHours.toString(),
        autoClockOut: true,
        updatedAt: now,
        notes: shift.notes ? `${shift.notes}\nAdmin clock-out: ${data.reason}` : `Admin clock-out: ${data.reason}`,
      })
      .where(eq(timeClockShifts.id, req.params.id))
      .returning();

    await db.insert(timeClockEvents).values({
      shiftId: req.params.id,
      eventType: "ADMIN_OVERRIDE",
      timestamp: now,
      notes: `Admin forced clock-out: ${data.reason}`,
      performedById: req.user!.id,
    });

    await logAudit({
      userId: req.user!.id,
      entityType: "TIME_CLOCK_SHIFT",
      entityId: req.params.id,
      action: "CLOCK_OUT",
      oldValue: JSON.stringify({ adminOverride: false }),
      newValue: JSON.stringify({ adminOverride: true, reason: data.reason }),
    }, req);

    res.json(updatedShift);
  } catch (error) {
    logError("Admin clock-out error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-clock/shifts/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      createTimeEntry: z.boolean().optional(),
    });

    const data = schema.parse(req.body);

    const [shiftWithUser] = await db
      .select({ shift: timeClockShifts, userOrgId: users.organizationId })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(eq(timeClockShifts.id, req.params.id))
      .limit(1);

    if (!shiftWithUser) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }

    const shift = shiftWithUser.shift;

    if (shiftWithUser.userOrgId !== req.user!.organizationId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (shift.approvalStatus !== "PENDING") {
      res.status(400).json({ error: `Shift has already been ${shift.approvalStatus.toLowerCase()}` });
      return;
    }

    if (!shift.clockOut) {
      res.status(400).json({ error: "Cannot approve shift that hasn't been clocked out" });
      return;
    }

    const [updatedShift] = await db
      .update(timeClockShifts)
      .set({
        approvalStatus: "APPROVED",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(timeClockShifts.id, req.params.id))
      .returning();

    let timeEntryId: string | null = null;
    if (data.createTimeEntry && shift.projectId) {
      try {
        let totalHours = parseFloat(shift.totalHours || "0");
        if (totalHours > 24) totalHours = 24;
        if (totalHours < 0) totalHours = 0;
        const regularHours = Math.min(totalHours, 8);
        const overtimeHours = Math.max(0, totalHours - 8);

        const [newTimeEntry] = await db.insert(timeEntries).values({
          userId: shift.userId,
          projectId: shift.projectId,
          date: shift.clockIn,
          hoursRegular: regularHours.toString(),
          hoursOvertime: overtimeHours.toString(),
          costCode: shift.costCode || null,
          notes: shift.notes || `Auto-created from time clock shift`,
          approvedById: req.user!.id,
          approvedAt: new Date(),
        }).returning();
        
        timeEntryId = newTimeEntry.id;
      } catch (error) {
        logError("Failed to create time entry during approval:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(timeClockShifts)
          .set({ approvalStatus: "PENDING", approvedById: null, approvedAt: null })
          .where(eq(timeClockShifts.id, req.params.id));
        throw error;
      }
    }

    await logAudit({
      userId: req.user!.id,
      entityType: "TIME_CLOCK_SHIFT",
      entityId: req.params.id,
      action: "APPROVE",
      oldValue: JSON.stringify({ status: "PENDING" }),
      newValue: JSON.stringify({ status: "APPROVED", createTimeEntry: data.createTimeEntry, timeEntryId }),
    }, req);

    if (shift.projectId && shift.clockIn) {
      const totalHours = parseFloat(shift.totalHours || "0");
      captureProductionRateFromShift(shift.projectId, shift.userId, shift.clockIn, totalHours)
        .catch(err => logError("Production rate capture failed:", {}, err instanceof Error ? err : new Error(String(err))));
    }

    const [shiftUser] = await db.select().from(users).where(eq(users.id, shift.userId)).limit(1);
    if (shiftUser?.organizationId && shift.clockIn) {
      checkAndNotifyWeeklyReport(shiftUser.organizationId, req.user!.id, shift.clockIn)
        .catch(err => logError("Weekly report check failed:", {}, err instanceof Error ? err : new Error(String(err))));

      const totalHrs = parseFloat(shift.totalHours || "0");
      captureKpiFromShift(shift.userId, shiftUser.organizationId, totalHrs, shift.clockIn)
        .catch(err => logError("KPI auto-capture failed:", {}, err instanceof Error ? err : new Error(String(err))));
    }

    res.json({ ...updatedShift, timeEntryCreated: !!timeEntryId, timeEntryId });
  } catch (error) {
    logError("Approve shift error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-clock/shifts/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      reason: req.body.reason ? sanitizeText(req.body.reason) : undefined,
    };

    const schema = z.object({
      reason: z.string().min(1, "Rejection reason is required"),
    });

    const data = schema.parse(sanitizedBody);

    const [shiftWithUser] = await db
      .select({ shift: timeClockShifts, userOrgId: users.organizationId })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(eq(timeClockShifts.id, req.params.id))
      .limit(1);

    if (!shiftWithUser) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }

    const shift = shiftWithUser.shift;

    if (shiftWithUser.userOrgId !== req.user!.organizationId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (shift.approvalStatus !== "PENDING") {
      res.status(400).json({ error: `Shift has already been ${shift.approvalStatus.toLowerCase()}` });
      return;
    }

    const [updatedShift] = await db
      .update(timeClockShifts)
      .set({
        approvalStatus: "REJECTED",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        notes: shift.notes ? `${shift.notes}\nREJECTED: ${data.reason}` : `REJECTED: ${data.reason}`,
        updatedAt: new Date(),
      })
      .where(eq(timeClockShifts.id, req.params.id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "TIME_CLOCK_SHIFT",
      entityId: req.params.id,
      action: "REJECT",
      oldValue: JSON.stringify({ status: "PENDING" }),
      newValue: JSON.stringify({ status: "REJECTED", reason: data.reason }),
    }, req);

    res.json(updatedShift);
  } catch (error) {
    logError("Reject shift error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/live", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const activeShifts = await db
      .select({
        shift: timeClockShifts,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
        },
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
      .where(and(isNull(timeClockShifts.clockOut), eq(users.organizationId, orgId)))
      .orderBy(desc(timeClockShifts.clockIn));

    res.json(activeShifts);
  } catch (error) {
    logError("Get live shifts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-clock/auto-clock-out-worker", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const cutoffTime = new Date(Date.now() - MAX_SHIFT_HOURS * 60 * 60 * 1000);

    const longShifts = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        isNull(timeClockShifts.clockOut),
        lte(timeClockShifts.clockIn, cutoffTime)
      ));

    const results = [];

    for (const shift of longShifts) {
      const now = new Date();
      const clockInTime = new Date(shift.clockIn);
      const totalHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

      const [updatedShift] = await db
        .update(timeClockShifts)
        .set({
          clockOut: now,
          totalHours: totalHours.toString(),
          autoClockOut: true,
          updatedAt: now,
          notes: shift.notes ? `${shift.notes}\nAuto-clocked out after ${MAX_SHIFT_HOURS} hours` : `Auto-clocked out after ${MAX_SHIFT_HOURS} hours`,
        })
        .where(eq(timeClockShifts.id, shift.id))
        .returning();

      await db.insert(timeClockEvents).values({
        shiftId: shift.id,
        eventType: "AUTO_CLOCK_OUT",
        timestamp: now,
        notes: `Auto-clocked out after ${MAX_SHIFT_HOURS} hours`,
        performedById: req.user!.id,
      });

      results.push(updatedShift);
    }

    res.json({ count: results.length, shifts: results });
  } catch (error) {
    logError("Auto clock-out worker error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:projectId/labor-hours", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { startDate, endDate, approvalStatus, userId, sortBy } = req.query;

    const conditions = [eq(timeClockShifts.projectId, projectId)];
    
    if (startDate) conditions.push(gte(timeClockShifts.clockIn, new Date(startDate as string)));
    if (endDate) conditions.push(lte(timeClockShifts.clockIn, new Date(endDate as string)));
    if (approvalStatus && approvalStatus !== 'ALL') conditions.push(eq(timeClockShifts.approvalStatus, approvalStatus as any));
    if (userId) conditions.push(eq(timeClockShifts.userId, userId as string));

    let orderByClause;
    switch (sortBy) {
      case "date-asc": orderByClause = timeClockShifts.clockIn; break;
      case "hours-desc": orderByClause = desc(sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0)`); break;
      case "hours-asc": orderByClause = sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0)`; break;
      case "cost-desc": orderByClause = desc(sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0) * COALESCE(CAST(${users.costRateRegular} AS NUMERIC), 0)`); break;
      case "cost-asc": orderByClause = sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0) * COALESCE(CAST(${users.costRateRegular} AS NUMERIC), 0)`; break;
      case "employee-asc": orderByClause = users.firstName; break;
      case "employee-desc": orderByClause = desc(users.firstName); break;
      case "date-desc": default: orderByClause = desc(timeClockShifts.clockIn); break;
    }

    const shiftsData = await db
      .select({
        shift: timeClockShifts,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
          costRateRegular: users.costRateRegular,
          costRateOvertime: users.costRateOvertime,
        },
      })
      .from(timeClockShifts)
      .leftJoin(users, eq(timeClockShifts.userId, users.id))
      .where(and(...conditions))
      .orderBy(orderByClause);

    const shiftsWithCosts = shiftsData.map(({ shift, user }) => {
      const totalHours = shift.totalHours ? parseFloat(shift.totalHours) : 0;
      const hourlyRate = user?.costRateRegular ? parseFloat(user.costRateRegular) : 0;
      const laborCost = totalHours * hourlyRate;
      return {
        ...shift,
        userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
        userEmail: user?.email,
        userRole: user?.role,
        hourlyRate,
        laborCost,
      };
    });

    const totalHours = shiftsWithCosts.reduce((sum, s) => sum + (s.totalHours ? parseFloat(s.totalHours) : 0), 0);
    const totalLaborCost = shiftsWithCosts.reduce((sum, s) => sum + s.laborCost, 0);
    const averageHourlyRate = totalHours > 0 ? totalLaborCost / totalHours : 0;

    res.json({
      shifts: shiftsWithCosts,
      summary: { totalShifts: shiftsWithCosts.length, totalHours, totalLaborCost, averageHourlyRate },
    });
  } catch (error) {
    logError("Get project labor hours error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
