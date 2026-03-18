import { Router } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import { 
  timeClockShifts, timeClockEvents, users, projects, timeEntries,
  kpiAssignments, kpiTemplates, kpiEntries
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
    console.error("KPI auto-capture failed:", err);
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

    if (data.projectId) {
      const [project] = await db.select().from(projects).where(eq(projects.id, data.projectId)).limit(1);
      if (project?.siteLatitude && project?.siteLongitude) {
        if (data.latitude && data.longitude) {
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

    const [newShift] = await db.insert(timeClockShifts).values({
      userId: req.user!.id,
      projectId: data.projectId || null,
      clockIn: now,
      clockInLatitude: data.latitude || null,
      clockInLongitude: data.longitude || null,
      notes: data.notes || null,
      autoClockOut: false,
      geofenceStatus,
      approvalStatus: "PENDING",
    }).returning();

    await db.insert(timeClockEvents).values({
      shiftId: newShift.id,
      eventType: "CLOCK_IN",
      timestamp: now,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
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

    eventBus.emit({
      type: "timeclock.checked_in",
      orgId: req.user!.organizationId || "",
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: {
        shiftId: newShift.id,
        userId: req.user!.id,
        projectId: data.projectId || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
      },
    });

    res.status(201).json({ ...newShift, geofenceWarning });
  } catch (error) {
    console.error("Clock-in error:", error);
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
        clockOutLatitude: data.latitude || null,
        clockOutLongitude: data.longitude || null,
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
      latitude: data.latitude || null,
      longitude: data.longitude || null,
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

    eventBus.emit({
      type: "timeclock.checked_out",
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
    console.error("Clock-out error:", error);
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
    console.error("Get current shift error:", error);
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
    console.error("Get my shifts error:", error);
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
    console.error("Update notes error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/pending-approvals", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const pendingShifts = await db
      .select({
        shift: timeClockShifts,
        user: users,
        project: projects,
      })
      .from(timeClockShifts)
      .leftJoin(users, eq(timeClockShifts.userId, users.id))
      .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
      .where(and(
        eq(timeClockShifts.approvalStatus, "PENDING"),
        sql`${timeClockShifts.clockOut} IS NOT NULL`
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
    console.error("Get pending approvals error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/active-shifts", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const activeShifts = await db
      .select({
        shift: timeClockShifts,
        user: users,
        project: projects,
      })
      .from(timeClockShifts)
      .leftJoin(users, eq(timeClockShifts.userId, users.id))
      .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
      .where(sql`${timeClockShifts.clockOut} IS NULL`)
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
    console.error("Get active shifts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/employee/:userId/shifts", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate, page = "1", pageSize = "50" } = req.query;

    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);
    const offset = (pageNum - 1) * pageSizeNum;

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
    console.error("Get employee shifts error:", error);
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

    const [shift] = await db
      .select()
      .from(timeClockShifts)
      .where(eq(timeClockShifts.id, req.params.id))
      .limit(1);

    if (!shift) {
      res.status(404).json({ error: "Shift not found" });
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
    console.error("Adjust shift error:", error);
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

    const [shift] = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.id, req.params.id),
        isNull(timeClockShifts.clockOut)
      ))
      .limit(1);

    if (!shift) {
      res.status(404).json({ error: "Active shift not found" });
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
    console.error("Admin clock-out error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-clock/shifts/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "HR_MANAGER", "DISPATCHER"), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      createTimeEntry: z.boolean().optional(),
    });

    const data = schema.parse(req.body);

    const [shift] = await db
      .select()
      .from(timeClockShifts)
      .where(eq(timeClockShifts.id, req.params.id))
      .limit(1);

    if (!shift) {
      res.status(404).json({ error: "Shift not found" });
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
          notes: shift.notes || `Auto-created from time clock shift`,
          approvedById: req.user!.id,
          approvedAt: new Date(),
        }).returning();
        
        timeEntryId = newTimeEntry.id;
      } catch (error) {
        console.error("Failed to create time entry during approval:", error);
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
        .catch(err => console.error("Production rate capture failed:", err));
    }

    const [shiftUser] = await db.select().from(users).where(eq(users.id, shift.userId)).limit(1);
    if (shiftUser?.organizationId && shift.clockIn) {
      checkAndNotifyWeeklyReport(shiftUser.organizationId, req.user!.id, shift.clockIn)
        .catch(err => console.error("Weekly report check failed:", err));

      const totalHrs = parseFloat(shift.totalHours || "0");
      captureKpiFromShift(shift.userId, shiftUser.organizationId, totalHrs, shift.clockIn)
        .catch(err => console.error("KPI auto-capture failed:", err));
    }

    res.json({ ...updatedShift, timeEntryCreated: !!timeEntryId, timeEntryId });
  } catch (error) {
    console.error("Approve shift error:", error);
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

    const [shift] = await db
      .select()
      .from(timeClockShifts)
      .where(eq(timeClockShifts.id, req.params.id))
      .limit(1);

    if (!shift) {
      res.status(404).json({ error: "Shift not found" });
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
    console.error("Reject shift error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/time-clock/live", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
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
      .leftJoin(users, eq(timeClockShifts.userId, users.id))
      .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
      .where(isNull(timeClockShifts.clockOut))
      .orderBy(desc(timeClockShifts.clockIn));

    res.json(activeShifts);
  } catch (error) {
    console.error("Get live shifts error:", error);
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
    console.error("Auto clock-out worker error:", error);
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
    console.error("Get project labor hours error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
