import type { Express } from "express";
import { db } from "./db";
import { timeClockShifts, timeClockEvents, users, projects, timeEntries } from "@shared/schema";
import { eq, and, desc, gte, lte, isNull, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { z } from "zod";

// Geolocation radius check (in meters)
const GEOFENCE_RADIUS = 200; // 200 meters

// Maximum shift hours before auto-clock-out
const MAX_SHIFT_HOURS = 16;

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function registerTimeClockRoutes(app: Express): void {
  // Clock In
  app.post("/api/time-clock/clock-in", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
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

      // Check if user already has an active shift
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

      // Create new shift
      const [newShift] = await db.insert(timeClockShifts).values({
        userId: req.user!.id,
        projectId: data.projectId || null,
        clockIn: now,
        clockInLatitude: data.latitude || null,
        clockInLongitude: data.longitude || null,
        notes: data.notes || null,
        autoClockOut: false,
        approvalStatus: "PENDING",
      }).returning();

      // Log clock-in event
      await db.insert(timeClockEvents).values({
        shiftId: newShift.id,
        eventType: "CLOCK_IN",
        timestamp: now,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        notes: data.notes || null,
        performedById: req.user!.id,
      });

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: newShift.id,
        action: "CLOCK_IN",
        oldValue: null,
        newValue: JSON.stringify({ projectId: data.projectId, location: data.latitude && data.longitude ? [data.latitude, data.longitude] : null }),
      }, req);

      res.status(201).json(newShift);
    } catch (error) {
      console.error("Clock-in error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Clock Out
  app.post("/api/time-clock/clock-out", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
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

      // Find active shift
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

      // Update shift with clock-out
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

      // Log clock-out event
      await db.insert(timeClockEvents).values({
        shiftId: activeShift.id,
        eventType: "CLOCK_OUT",
        timestamp: now,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        notes: data.notes || null,
        performedById: req.user!.id,
      });

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: activeShift.id,
        action: "CLOCK_OUT",
        oldValue: JSON.stringify({ clockIn: activeShift.clockIn }),
        newValue: JSON.stringify({ clockOut: now, totalHours }),
      }, req);

      res.json(updatedShift);
    } catch (error) {
      console.error("Clock-out error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get current active shift
  app.get("/api/time-clock/my-current-shift", requireAuth, async (req: AuthRequest, res) => {
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

      // Fetch project if shift has projectId
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

  // Get my shifts
  app.get("/api/time-clock/my-shifts", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, page = "1", pageSize = "50" } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      const offset = (pageNum - 1) * pageSizeNum;

      // Build conditions array to avoid query chaining issues
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

      res.json(shifts);
    } catch (error) {
      console.error("Get my shifts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update shift notes (employee only)
  app.patch("/api/time-clock/my-shifts/:id/notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      const schema = z.object({
        notes: z.string(),
      });

      const data = schema.parse(sanitizedBody);

      // Verify ownership
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

  // Get pending shift approvals (managers only)
  app.get("/api/time-clock/pending-approvals", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Get all shifts that are clocked out and pending approval
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

      // Flatten the response to match the expected frontend format
      const formattedShifts = pendingShifts.map(({ shift, user, project }) => ({
        ...shift,
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

  // Get active shifts (managers only)
  app.get("/api/time-clock/active-shifts", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Get all shifts that are currently clocked in (no clock out time)
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

      // Flatten the response to match the expected frontend format
      const formattedShifts = activeShifts.map(({ shift, user, project }) => ({
        ...shift,
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

  // Get employee shifts (managers only)
  app.get("/api/time-clock/employee/:userId/shifts", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, page = "1", pageSize = "50" } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      const offset = (pageNum - 1) * pageSizeNum;

      // Build conditions array to avoid query chaining issues
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

  // Adjust shift (managers only)
  app.post("/api/time-clock/shifts/:id/adjust", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
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

      // Check if shift is approved - only ADMIN can adjust approved shifts with override
      if (shift.approvalStatus === "APPROVED") {
        if (req.user!.role !== "ADMIN" || !data.adminOverride) {
          res.status(403).json({ 
            error: "This shift has been approved and is locked. Only administrators can adjust approved shifts with explicit override." 
          });
          return;
        }
      }

      const updates: any = { updatedAt: new Date() };
      
      // Reset approval if manager is adjusting (unless admin override)
      if (shift.approvalStatus === "APPROVED" && req.user!.role === "ADMIN" && data.adminOverride) {
        // Admin override - keep approval but log it
        updates.notes = shift.notes ? `${shift.notes}\nAdmin override adjustment: ${data.reason}` : `Admin override adjustment: ${data.reason}`;
      } else if (shift.approvalStatus === "APPROVED") {
        // This shouldn't happen due to the check above, but as a safety measure
        updates.approvalStatus = "PENDING";
        updates.approvedById = null;
        updates.approvedAt = null;
      }

      if (data.clockIn) {
        updates.clockIn = new Date(data.clockIn);
      }

      if (data.clockOut) {
        updates.clockOut = new Date(data.clockOut);
      }

      if (data.projectId !== undefined) {
        updates.projectId = data.projectId;
      }

      if (data.notes) {
        updates.notes = data.notes;
      }

      // Recalculate total hours if either time changed
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

      // Log adjustment event
      await db.insert(timeClockEvents).values({
        shiftId: req.params.id,
        eventType: "ADJUSTMENT",
        timestamp: new Date(),
        notes: `Manager adjustment: ${data.reason}`,
        performedById: req.user!.id,
      });

      // Audit log
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

  // Admin clock-out (managers only)
  app.post("/api/time-clock/shift/:id/admin-clock-out", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
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

      // Log admin override event
      await db.insert(timeClockEvents).values({
        shiftId: req.params.id,
        eventType: "ADMIN_OVERRIDE",
        timestamp: now,
        notes: `Admin forced clock-out: ${data.reason}`,
        performedById: req.user!.id,
      });

      // Audit log
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

  // Approve shift (managers only)
  app.post("/api/time-clock/shifts/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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

      // Optionally create time entry
      let timeEntryId: string | null = null;
      if (data.createTimeEntry && shift.projectId) {
        try {
          const totalHours = parseFloat(shift.totalHours || "0");
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
          // Rollback the approval if time entry creation fails
          await db
            .update(timeClockShifts)
            .set({
              approvalStatus: "PENDING",
              approvedById: null,
              approvedAt: null,
            })
            .where(eq(timeClockShifts.id, req.params.id));
          
          throw error;
        }
      }

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: req.params.id,
        action: "APPROVE",
        oldValue: JSON.stringify({ status: "PENDING" }),
        newValue: JSON.stringify({ status: "APPROVED", createTimeEntry: data.createTimeEntry, timeEntryId }),
      }, req);

      res.json({ ...updatedShift, timeEntryCreated: !!timeEntryId, timeEntryId });
    } catch (error) {
      console.error("Approve shift error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reject shift (managers only)
  app.post("/api/time-clock/shifts/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
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

      // Audit log
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

  // Get live clock-in status (managers only)
  app.get("/api/time-clock/live", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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

  // Auto clock-out worker function (called by scheduled task)
  app.post("/api/time-clock/auto-clock-out-worker", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
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

  // Get project labor hours (managers, superintendents, and admins only)
  app.get("/api/projects/:projectId/labor-hours", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { startDate, endDate, approvalStatus, userId, sortBy } = req.query;

      // Build conditions array
      const conditions = [eq(timeClockShifts.projectId, projectId)];
      
      if (startDate) {
        conditions.push(gte(timeClockShifts.clockIn, new Date(startDate as string)));
      }
      if (endDate) {
        conditions.push(lte(timeClockShifts.clockIn, new Date(endDate as string)));
      }
      if (approvalStatus && approvalStatus !== 'ALL') {
        conditions.push(eq(timeClockShifts.approvalStatus, approvalStatus as any));
      }
      if (userId) {
        conditions.push(eq(timeClockShifts.userId, userId as string));
      }

      // Determine order by clause based on sortBy parameter
      let orderByClause;
      switch (sortBy) {
        case "date-asc":
          orderByClause = timeClockShifts.clockIn;
          break;
        case "hours-desc":
          orderByClause = desc(sql`CAST(${timeClockShifts.totalHours} AS NUMERIC)`);
          break;
        case "hours-asc":
          orderByClause = sql`CAST(${timeClockShifts.totalHours} AS NUMERIC)`;
          break;
        case "cost-desc":
          orderByClause = desc(sql`CAST(${timeClockShifts.totalHours} AS NUMERIC) * COALESCE(CAST(${users.costRateRegular} AS NUMERIC), 0)`);
          break;
        case "cost-asc":
          orderByClause = sql`CAST(${timeClockShifts.totalHours} AS NUMERIC) * COALESCE(CAST(${users.costRateRegular} AS NUMERIC), 0)`;
          break;
        case "employee-asc":
          orderByClause = users.firstName;
          break;
        case "employee-desc":
          orderByClause = desc(users.firstName);
          break;
        case "date-desc":
        default:
          orderByClause = desc(timeClockShifts.clockIn);
          break;
      }

      // Get shifts with employee details
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

      // Calculate labor costs for each shift
      const shiftsWithCosts = shiftsData.map(({ shift, user }) => {
        const totalHours = shift.totalHours ? parseFloat(shift.totalHours) : 0;
        const hourlyRate = user?.costRateRegular ? parseFloat(user.costRateRegular) : 0;
        const laborCost = totalHours * hourlyRate;

        return {
          ...shift,
          userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
          userEmail: user?.email,
          userRole: user?.role,
          hourlyRate: hourlyRate,
          laborCost: laborCost,
        };
      });

      // Calculate aggregate metrics
      const totalHours = shiftsWithCosts.reduce((sum, shift) => sum + (shift.totalHours ? parseFloat(shift.totalHours) : 0), 0);
      const totalLaborCost = shiftsWithCosts.reduce((sum, shift) => sum + shift.laborCost, 0);
      const averageHourlyRate = totalHours > 0 ? totalLaborCost / totalHours : 0;

      res.json({
        shifts: shiftsWithCosts,
        summary: {
          totalShifts: shiftsWithCosts.length,
          totalHours: totalHours,
          totalLaborCost: totalLaborCost,
          averageHourlyRate: averageHourlyRate,
        },
      });
    } catch (error) {
      console.error("Get project labor hours error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
