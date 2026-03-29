import { logError } from "./utils/logger";
import { Router } from "express";
import crypto from "crypto";
import { db } from "./db";
import {
  users, projects, organizations, timeClockShifts, attendanceLogs,
  employeePerformanceProfiles, performanceReviews, safetyIncidents,
  qualityIssues, supervisorNotes, workerLogs, userSkills, skills,
  userCertifications, userEquipmentCompetencies, tradeFeatures,
  passwordResetTokens,
} from "@shared/schema";
import { requireAuth, hashPassword, type AuthRequest } from "./auth";
import { authLimiter } from "./rateLimiter";
import { eq, desc, sql, and, isNull, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "./auditLogger";
import { sendEmail, getPasswordResetEmailHtml, getPasswordResetEmailText } from "./email";
import { sanitizeEmail } from "./sanitization";

const router = Router();

  // ====================
  // Manage Workers Routes
  // ====================

  router.get("/api/auth/manage-workers", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const { project, trade, role, employmentType } = req.query as Record<string, string | undefined>;

      const conditions: SQL[] = [eq(users.organizationId, orgId)];
      if (trade) conditions.push(eq(users.tradeSpecialization, trade));
      if (role) conditions.push(eq(users.role, role as any));
      if (employmentType) conditions.push(eq(users.employmentType, employmentType));

      const orgUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
        avatarUrl: users.avatarUrl,
        tradeSpecialization: users.tradeSpecialization,
        employmentType: users.employmentType,
        createdAt: users.createdAt,
      }).from(users).where(and(...conditions));

      const workerIds = orgUsers.map(u => u.id);
      if (workerIds.length === 0) {
        res.json([]);
        return;
      }

      const openShifts = await db.select().from(timeClockShifts)
        .where(and(
          inArray(timeClockShifts.userId, workerIds),
          isNull(timeClockShifts.clockOut)
        ));

      const todayStr = new Date().toISOString().slice(0, 10);
      const todayAttendance = await db.select().from(attendanceLogs)
        .where(and(
          inArray(attendanceLogs.userId, workerIds),
          eq(attendanceLogs.date, todayStr)
        ));

      const perfProfiles = await db.select().from(employeePerformanceProfiles)
        .where(inArray(employeePerformanceProfiles.userId, workerIds));

      const recentShifts = await db.select().from(timeClockShifts)
        .where(and(
          inArray(timeClockShifts.userId, workerIds),
          sql`${timeClockShifts.projectId} IS NOT NULL`
        ))
        .orderBy(desc(timeClockShifts.clockIn));

      const openShiftMap = new Map(openShifts.map(s => [s.userId, s]));
      const attendanceMap = new Map(todayAttendance.map(a => [a.userId, a]));
      const perfMap = new Map(perfProfiles.map(p => [p.userId, p]));
      const projectIdMap = new Map<string, string | null>();
      for (const shift of recentShifts) {
        if (!projectIdMap.has(shift.userId)) {
          projectIdMap.set(shift.userId, shift.projectId);
        }
      }

      const uniqueProjectIds = Array.from(new Set(Array.from(projectIdMap.values()).filter(Boolean))) as string[];
      const projectNameMap = new Map<string, string>();
      if (uniqueProjectIds.length > 0) {
        const projectRows = await db.select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, uniqueProjectIds));
        for (const p of projectRows) {
          projectNameMap.set(p.id, p.name);
        }
      }

      let results = orgUsers.map(u => {
        let clockStatus = "INACTIVE";
        if (openShiftMap.has(u.id)) {
          clockStatus = "ON_DUTY";
        } else if (attendanceMap.has(u.id)) {
          clockStatus = attendanceMap.get(u.id)!.status;
        }
        const perf = perfMap.get(u.id);
        const projId = projectIdMap.get(u.id) || null;
        return {
          ...u,
          clockStatus,
          experienceLevel: perf?.experienceLevel || null,
          currentProjectId: projId,
          currentProject: projId ? (projectNameMap.get(projId) || null) : null,
        };
      });

      if (project) {
        results = results.filter(w => w.currentProjectId === project);
      }

      res.json(results);
    } catch (error) {
      logError("Error fetching manage-workers list:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/manage-workers/kpi-dashboard", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER"];
      if (!userRole || !managerRoles.includes(userRole)) { res.status(403).json({ error: "Insufficient permissions" }); return; }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const orgUsers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role, isActive: users.isActive })
        .from(users).where(eq(users.organizationId, orgId));
      const workerIds = orgUsers.map(u => u.id);
      if (workerIds.length === 0) {
        res.json({ summary: { totalWorkers: 0, activeWorkers: 0, onDutyNow: 0, avgAttendanceRate: 0, avgOverallRating: 0 }, attendanceDistribution: [], performanceTrend: [], safetyQualityOverview: [], topPerformers: [] });
        return;
      }

      const totalWorkers = orgUsers.length;
      const activeWorkers = orgUsers.filter(u => u.isActive).length;

      const openShifts = await db.select({ userId: timeClockShifts.userId }).from(timeClockShifts)
        .where(and(inArray(timeClockShifts.userId, workerIds), isNull(timeClockShifts.clockOut)));
      const onDutyNow = new Set(openShifts.map(s => s.userId)).size;

      const allAttendance = await db.select({ status: attendanceLogs.status, date: attendanceLogs.date })
        .from(attendanceLogs).where(inArray(attendanceLogs.userId, workerIds));

      const attendanceCounts: Record<string, number> = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0, HALF_DAY: 0 };
      for (const a of allAttendance) {
        const key = a.status || "ABSENT";
        attendanceCounts[key] = (attendanceCounts[key] || 0) + 1;
      }
      const totalAttendanceRecords = allAttendance.length;
      const presentAndLate = (attendanceCounts["PRESENT"] || 0) + (attendanceCounts["LATE"] || 0);
      const avgAttendanceRate = totalAttendanceRecords > 0 ? Math.round((presentAndLate / totalAttendanceRecords) * 100) : 0;

      const attendanceDistribution = Object.entries(attendanceCounts)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => ({ status, count }));

      const allReviews = await db.select({
        userId: performanceReviews.userId,
        overallRating: performanceReviews.overallRating,
        productivityRating: performanceReviews.productivityRating,
        qualityRating: performanceReviews.qualityRating,
        safetyRating: performanceReviews.safetyRating,
        communicationRating: performanceReviews.communicationRating,
        leadershipRating: performanceReviews.leadershipRating,
        reviewDate: performanceReviews.reviewDate,
      }).from(performanceReviews).where(inArray(performanceReviews.userId, workerIds));

      const avgOverallRating = allReviews.length > 0
        ? Math.round((allReviews.reduce((s, r) => s + r.overallRating, 0) / allReviews.length) * 10) / 10
        : 0;

      const monthlyReviews: Record<string, { sum: number; count: number; prod: number; prodC: number; qual: number; qualC: number; safe: number; safeC: number }> = {};
      for (const r of allReviews) {
        const month = r.reviewDate ? r.reviewDate.substring(0, 7) : "unknown";
        if (!monthlyReviews[month]) monthlyReviews[month] = { sum: 0, count: 0, prod: 0, prodC: 0, qual: 0, qualC: 0, safe: 0, safeC: 0 };
        monthlyReviews[month].sum += r.overallRating;
        monthlyReviews[month].count++;
        if (r.productivityRating) { monthlyReviews[month].prod += r.productivityRating; monthlyReviews[month].prodC++; }
        if (r.qualityRating) { monthlyReviews[month].qual += r.qualityRating; monthlyReviews[month].qualC++; }
        if (r.safetyRating) { monthlyReviews[month].safe += r.safetyRating; monthlyReviews[month].safeC++; }
      }
      const performanceTrend = Object.entries(monthlyReviews)
        .filter(([month]) => month !== "unknown")
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([month, d]) => ({
          month,
          overall: Math.round((d.sum / d.count) * 10) / 10,
          productivity: d.prodC > 0 ? Math.round((d.prod / d.prodC) * 10) / 10 : null,
          quality: d.qualC > 0 ? Math.round((d.qual / d.qualC) * 10) / 10 : null,
          safety: d.safeC > 0 ? Math.round((d.safe / d.safeC) * 10) / 10 : null,
        }));

      const allSafety = await db.select({ severity: safetyIncidents.severity, date: safetyIncidents.date })
        .from(safetyIncidents).where(inArray(safetyIncidents.userId, workerIds));
      const allQuality = await db.select({ category: qualityIssues.category, date: qualityIssues.date })
        .from(qualityIssues).where(inArray(qualityIssues.userId, workerIds));

      const monthlySafetyQuality: Record<string, { safetyCount: number; qualityCount: number; critical: number }> = {};
      for (const s of allSafety) {
        const m = s.date ? s.date.substring(0, 7) : "unknown";
        if (!monthlySafetyQuality[m]) monthlySafetyQuality[m] = { safetyCount: 0, qualityCount: 0, critical: 0 };
        monthlySafetyQuality[m].safetyCount++;
        if (s.severity === "Critical" || s.severity === "High") monthlySafetyQuality[m].critical++;
      }
      for (const q of allQuality) {
        const m = q.date ? q.date.substring(0, 7) : "unknown";
        if (!monthlySafetyQuality[m]) monthlySafetyQuality[m] = { safetyCount: 0, qualityCount: 0, critical: 0 };
        monthlySafetyQuality[m].qualityCount++;
      }
      const safetyQualityOverview = Object.entries(monthlySafetyQuality)
        .filter(([month]) => month !== "unknown")
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([month, d]) => ({ month, safetyIncidents: d.safetyCount, qualityIssues: d.qualityCount, criticalIncidents: d.critical }));

      const workerRatings: Record<string, { sum: number; count: number }> = {};
      for (const r of allReviews) {
        if (!workerRatings[r.userId]) workerRatings[r.userId] = { sum: 0, count: 0 };
        workerRatings[r.userId].sum += r.overallRating;
        workerRatings[r.userId].count++;
      }
      const topPerformers = Object.entries(workerRatings)
        .map(([uid, d]) => ({ userId: uid, avgRating: Math.round((d.sum / d.count) * 10) / 10, reviewCount: d.count }))
        .sort((a, b) => b.avgRating - a.avgRating || b.reviewCount - a.reviewCount)
        .slice(0, 5)
        .map(tp => {
          const u = orgUsers.find(u => u.id === tp.userId);
          return { ...tp, firstName: u?.firstName || "", lastName: u?.lastName || "", role: u?.role || "" };
        });

      res.json({
        summary: { totalWorkers, activeWorkers, onDutyNow, avgAttendanceRate, avgOverallRating },
        attendanceDistribution,
        performanceTrend,
        safetyQualityOverview,
        topPerformers,
      });
    } catch (error) {
      logError("Error fetching KPI dashboard:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/manage-workers/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const { passwordHash, tokenVersion, ...userInfo } = targetUser;

      const [performanceProfile] = await db.select().from(employeePerformanceProfiles)
        .where(eq(employeePerformanceProfiles.userId, targetId)).limit(1);

      const workerSkillsRaw = await db.select({
        id: userSkills.id,
        skillName: skills.name,
        rating: userSkills.starRating,
        isVerified: userSkills.verificationStatus,
        verifiedByUserId: userSkills.verifiedByUserId,
        verifiedAt: userSkills.verifiedAt,
        createdAt: userSkills.addedAt,
      }).from(userSkills)
        .innerJoin(skills, eq(userSkills.skillId, skills.id))
        .where(eq(userSkills.userId, targetId));

      const workerSkills = workerSkillsRaw.map(s => ({
        ...s,
        rating: s.rating ?? 0,
        isVerified: s.isVerified === "verified",
      }));

      const certifications = await db.select().from(userCertifications)
        .where(eq(userCertifications.userId, targetId));

      const recentAttendance = await db.select().from(attendanceLogs)
        .where(eq(attendanceLogs.userId, targetId))
        .orderBy(desc(attendanceLogs.createdAt))
        .limit(30);

      const workerSafetyIncidents = await db.select().from(safetyIncidents)
        .where(eq(safetyIncidents.userId, targetId))
        .orderBy(desc(safetyIncidents.createdAt));

      const workerQualityIssues = await db.select().from(qualityIssues)
        .where(eq(qualityIssues.userId, targetId))
        .orderBy(desc(qualityIssues.createdAt));

      const workerPerformanceReviews = await db.select().from(performanceReviews)
        .where(eq(performanceReviews.userId, targetId))
        .orderBy(desc(performanceReviews.createdAt));

      const workerSupervisorNotes = await db.select().from(supervisorNotes)
        .where(eq(supervisorNotes.userId, targetId))
        .orderBy(desc(supervisorNotes.createdAt));

      const workerLogEntries = await db.select().from(workerLogs)
        .where(eq(workerLogs.userId, targetId))
        .orderBy(desc(workerLogs.createdAt))
        .limit(50);

      const recentShiftsRaw = await db.select({
        id: timeClockShifts.id,
        userId: timeClockShifts.userId,
        projectId: timeClockShifts.projectId,
        projectName: projects.name,
        clockIn: timeClockShifts.clockIn,
        clockOut: timeClockShifts.clockOut,
        totalHours: timeClockShifts.totalHours,
        notes: timeClockShifts.notes,
      }).from(timeClockShifts)
        .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
        .where(eq(timeClockShifts.userId, targetId))
        .orderBy(desc(timeClockShifts.clockIn))
        .limit(20);

      const [currentShiftRaw] = await db.select({
        id: timeClockShifts.id,
        userId: timeClockShifts.userId,
        projectId: timeClockShifts.projectId,
        projectName: projects.name,
        clockIn: timeClockShifts.clockIn,
        clockOut: timeClockShifts.clockOut,
        totalHours: timeClockShifts.totalHours,
        notes: timeClockShifts.notes,
      }).from(timeClockShifts)
        .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
        .where(and(
          eq(timeClockShifts.userId, targetId),
          isNull(timeClockShifts.clockOut)
        ))
        .orderBy(desc(timeClockShifts.clockIn))
        .limit(1);

      res.json({
        user: userInfo,
        performanceProfile: performanceProfile || null,
        skills: workerSkills,
        certifications,
        attendanceLogs: recentAttendance,
        safetyIncidents: workerSafetyIncidents,
        qualityIssues: workerQualityIssues,
        performanceReviews: workerPerformanceReviews,
        supervisorNotes: workerSupervisorNotes,
        workerLogs: workerLogEntries,
        timeClockShifts: recentShiftsRaw,
        currentShift: currentShiftRaw || null,
      });
    } catch (error) {
      logError("Error fetching worker profile:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/manage-workers/:id/logs", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const logSchema = z.object({
        note: z.string().min(1, "Note is required"),
        category: z.enum(["GENERAL", "COMMENDATION", "INCIDENT", "ATTENDANCE", "OTHER"]).default("GENERAL"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd format"),
      });

      const parsed = logSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
        return;
      }

      const creatorName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || "Manager";
      const [newLog] = await db.insert(workerLogs).values({
        userId: targetId,
        organizationId: orgId,
        date: parsed.data.date,
        note: parsed.data.note,
        category: parsed.data.category,
        createdBy: userId,
        createdByName: creatorName,
      }).returning();

      res.status(201).json(newLog);
    } catch (error) {
      logError("Error creating worker log:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/manage-workers/:id/notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER", "SUPERINTENDENT"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const noteSchema = z.object({
        note: z.string().min(1, "Note is required"),
      });

      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
        return;
      }

      const creatorName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || "Supervisor";
      const [newNote] = await db.insert(supervisorNotes).values({
        userId: targetId,
        organizationId: orgId,
        note: parsed.data.note,
        createdBy: userId,
        createdByName: creatorName,
      }).returning();

      res.status(201).json(newNote);
    } catch (error) {
      logError("Error creating supervisor note:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/manage-workers/:id/assign-project", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER", "SUPERINTENDENT"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const assignSchema = z.object({
        projectId: z.string().min(1, "Project is required"),
        notes: z.string().optional(),
      });

      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
        return;
      }

      const [project] = await db.select().from(projects).where(
        and(eq(projects.id, parsed.data.projectId), eq(projects.gcOrganizationId, orgId))
      ).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found in your organization" }); return; }

      const inactiveStatuses = ["COMPLETED", "CANCELLED", "CLOSED"];
      if (project.status && inactiveStatuses.includes(project.status)) {
        res.status(400).json({ error: `Cannot assign to a ${project.status.toLowerCase()} project` });
        return;
      }

      const now = new Date();
      const openShifts = await db.select().from(timeClockShifts).where(
        and(eq(timeClockShifts.userId, targetId), isNull(timeClockShifts.clockOut))
      );
      for (const shift of openShifts) {
        const clockInTime = new Date(shift.clockIn);
        const diffMs = now.getTime() - clockInTime.getTime();
        const hours = (diffMs / (1000 * 60 * 60)).toFixed(2);
        await db.update(timeClockShifts)
          .set({ clockOut: now, totalHours: hours })
          .where(eq(timeClockShifts.id, shift.id));
      }

      const [newShift] = await db.insert(timeClockShifts).values({
        userId: targetId,
        projectId: parsed.data.projectId,
        clockIn: new Date(),
        notes: parsed.data.notes || `Assigned to ${project.name} by manager`,
        organizationId: orgId,
      }).returning();

      const creatorName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || "Manager";
      await db.insert(workerLogs).values({
        userId: targetId,
        organizationId: orgId,
        date: new Date().toISOString().slice(0, 10),
        note: `Assigned to project: ${project.name}${parsed.data.notes ? ` - ${parsed.data.notes}` : ""}`,
        category: "GENERAL",
        createdBy: userId,
        createdByName: creatorName,
      });

      res.status(201).json({ shift: newShift, projectName: project.name });
    } catch (error) {
      logError("Error assigning worker to project:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/manage-workers/:id/skills", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER", "SUPERINTENDENT"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const addSkillSchema = z.object({
        skillName: z.string().min(1, "Skill name is required").max(200),
        starRating: z.number().min(0).max(5).optional().default(0),
      });

      const parsed = addSkillSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
        return;
      }

      let [existingSkill] = await db.select().from(skills).where(eq(skills.name, parsed.data.skillName)).limit(1);
      if (!existingSkill) {
        [existingSkill] = await db.insert(skills).values({ name: parsed.data.skillName }).returning();
      }

      const [newUserSkill] = await db.insert(userSkills).values({
        userId: targetId,
        skillId: existingSkill.id,
        starRating: parsed.data.starRating,
      }).returning();

      res.status(201).json({ userSkill: newUserSkill, skillName: existingSkill.name });
    } catch (error) {
      logError("Error adding skill to worker:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/api/auth/manage-workers/:id/skills/:userSkillId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER", "SUPERINTENDENT"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const userSkillId = req.params.userSkillId;

      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const [existingUserSkill] = await db.select().from(userSkills).where(
        and(eq(userSkills.id, userSkillId), eq(userSkills.userId, targetId))
      ).limit(1);
      if (!existingUserSkill) {
        res.status(404).json({ error: "Skill not found for this worker" });
        return;
      }

      await db.delete(userSkills).where(eq(userSkills.id, userSkillId));
      res.json({ success: true });
    } catch (error) {
      logError("Error removing skill from worker:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.patch("/api/auth/manage-workers/:id/skills/:userSkillId/rating", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER", "SUPERINTENDENT"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const userSkillId = req.params.userSkillId;

      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const ratingSchema = z.object({
        starRating: z.number().min(0).max(5),
      });
      const parsed = ratingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
        return;
      }

      const [existingUserSkill] = await db.select().from(userSkills).where(
        and(eq(userSkills.id, userSkillId), eq(userSkills.userId, targetId))
      ).limit(1);
      if (!existingUserSkill) {
        res.status(404).json({ error: "Skill not found for this worker" });
        return;
      }

      const [updated] = await db.update(userSkills)
        .set({ starRating: parsed.data.starRating })
        .where(eq(userSkills.id, userSkillId))
        .returning();

      res.json(updated);
    } catch (error) {
      logError("Error updating skill rating:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.patch("/api/auth/manage-workers/:id/status", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const managerRoles = ["ADMIN", "MANAGER", "OFFICE_MANAGER"];
      if (!userRole || !managerRoles.includes(userRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      if (!orgId) { res.status(400).json({ error: "No organization assigned" }); return; }

      const targetId = req.params.id;
      const statusSchema = z.object({
        isActive: z.boolean(),
      });

      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
        return;
      }

      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "Worker not found" }); return; }
      if (targetUser.organizationId !== orgId) {
        res.status(403).json({ error: "Worker not in your organization" });
        return;
      }

      const [updated] = await db.update(users)
        .set({ isActive: parsed.data.isActive, updatedAt: new Date() })
        .where(eq(users.id, targetId))
        .returning();

      if (!updated) { res.status(404).json({ error: "Worker not found" }); return; }

      const { passwordHash, tokenVersion, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      logError("Error updating worker status:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-equipment-competencies", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const competencies = await db.select().from(userEquipmentCompetencies)
        .where(eq(userEquipmentCompetencies.userId, userId))
        .orderBy(desc(userEquipmentCompetencies.createdAt));
      res.json(competencies);
    } catch (error) {
      logError("Error fetching equipment competencies:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/my-equipment-competencies", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      if (!orgId) { res.status(400).json({ error: "No organization associated" }); return; }

      const compSchema = z.object({ equipmentName: z.string().min(1).max(500).transform(v => v.trim()) });
      const parsed = compSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Equipment name is required" }); return; }

      const [existingComp] = await db.select().from(userEquipmentCompetencies)
        .where(and(
          eq(userEquipmentCompetencies.userId, userId),
          eq(userEquipmentCompetencies.equipmentName, parsed.data.equipmentName)
        )).limit(1);
      if (existingComp) { res.status(409).json({ error: "Equipment competency already added" }); return; }

      const [comp] = await db.insert(userEquipmentCompetencies).values({
        userId,
        organizationId: orgId,
        equipmentName: parsed.data.equipmentName,
      }).returning();

      res.status(201).json(comp);
    } catch (error) {
      logError("Error adding equipment competency:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/api/auth/my-equipment-competencies/:compId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { compId } = req.params;
      const [existing] = await db.select().from(userEquipmentCompetencies)
        .where(and(eq(userEquipmentCompetencies.id, compId), eq(userEquipmentCompetencies.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Equipment competency not found" }); return; }

      await db.delete(userEquipmentCompetencies).where(eq(userEquipmentCompetencies.id, compId));
      res.json({ message: "Equipment competency removed" });
    } catch (error) {
      logError("Error removing equipment competency:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get trade features for current user's organization
  router.get("/api/trade-features", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const [user] = await db
        .select({ organizationId: users.organizationId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user?.organizationId) {
        res.json({ features: [], tradeType: null });
        return;
      }

      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, user.organizationId))
        .limit(1);

      if (!org?.tradeType) {
        res.json({ features: [], tradeType: null });
        return;
      }

      let features;
      
      if (org.tradeType === "GENERAL_CONTRACTOR") {
        // GC mode: Return all unique features across all trades (deduplicated by featureKey)
        // Get all enabled features and deduplicate by featureKey, keeping first occurrence
        const allFeatures = await db
          .select()
          .from(tradeFeatures)
          .where(eq(tradeFeatures.isEnabled, true))
          .orderBy(tradeFeatures.sortOrder, tradeFeatures.tradeType);

        // Deduplicate by featureKey (keep first occurrence which has lowest sortOrder)
        const seenKeys = new Set<string>();
        features = allFeatures.filter(f => {
          if (seenKeys.has(f.featureKey)) return false;
          seenKeys.add(f.featureKey);
          return true;
        });
      } else {
        // Single trade mode: Return features for the specific trade only
        features = await db
          .select()
          .from(tradeFeatures)
          .where(
            and(
              eq(tradeFeatures.tradeType, org.tradeType),
              eq(tradeFeatures.isEnabled, true)
            )
          )
          .orderBy(tradeFeatures.sortOrder);
      }

      res.json({ features, tradeType: org.tradeType });
    } catch (error) {
      logError("Error fetching trade features:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Initialize admin user (one-time setup)
  router.post("/api/auth/init", async (req: AuthRequest, res) => {
    try {
      // Check if any users exist
      const existingUsers = await db.select().from(users).limit(1);
      
      if (existingUsers.length > 0) {
        res.status(400).json({ error: "System already initialized" });
        return;
      }

      // Create admin user
      const passwordHashVal = await hashPassword("admin123");
      
      const [adminUser] = await db.insert(users).values({
        firstName: "Admin",
        lastName: "User",
        email: "admin@tfrllc.com",
        role: "ADMIN",
        isActive: true,
        passwordHash: passwordHashVal,
      }).returning();

      const { passwordHash: _, ...userWithoutPassword } = adminUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Admin user created. Email: admin@tfrllc.com, Password: admin123. Please change this password!"
      });
    } catch (error) {
      logError("Init error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Forgot Password - Request password reset email
  router.post("/api/auth/forgot-password", authLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
      });

      const validationResult = schema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }

      const { email } = validationResult.data;
      const sanitizedEmail = sanitizeEmail(email);
      if (!sanitizedEmail) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }

      const [user] = await db.select().from(users).where(eq(users.email, sanitizedEmail)).limit(1);

      if (user && user.isActive) {
        await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash,
          expiresAt,
        });

        const baseUrl = process.env.REPLIT_DEV_DOMAIN
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : process.env.APP_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
        const resetLink = `${baseUrl}/reset-password?token=${token}`;

        const emailSent = await sendEmail({
          to: user.email,
          subject: 'Password Reset Request - SmartManageAI',
          html: getPasswordResetEmailHtml(resetLink, user.firstName),
          text: getPasswordResetEmailText(resetLink, user.firstName),
        });

        if (emailSent) {
          console.log(`Credential reset email sent successfully for: ${sanitizedEmail}`);
        } else {
          // Log failure but don't expose to user (security: prevents email enumeration)
          logError(`CRITICAL: Credential reset email FAILED to send for: ${sanitizedEmail}`);
        }
      }

      // Always return success message to prevent email enumeration attacks
      res.json({ message: "If an account with that email exists, a password reset link has been sent." });
    } catch (error) {
      logError("Forgot password error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reset Password - Set new password using token
  router.post("/api/auth/reset-password", authLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        token: z.string().min(1),
        password: z.string().min(8, "Password must be at least 8 characters"),
      });

      const validationResult = schema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { token, password } = validationResult.data;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt)
          )
        )
        .limit(1);

      if (!resetToken) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }

      if (new Date() > resetToken.expiresAt) {
        res.status(400).json({ error: "Reset token has expired" });
        return;
      }

      const newPasswordHash = await hashPassword(password);

      await db.update(users).set({
        passwordHash: newPasswordHash,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, resetToken.userId));

      await db.update(passwordResetTokens).set({
        usedAt: new Date(),
      }).where(eq(passwordResetTokens.id, resetToken.id));

      await logAudit({
        action: "UPDATE",
        entityType: "users",
        entityId: resetToken.userId,
        userId: resetToken.userId,
        newValue: JSON.stringify({ passwordReset: true }),
      });

      const completedUserId = resetToken?.userId;
      console.log(`Credential reset completed for user: ${completedUserId}`);
      res.json({ message: "Password has been reset successfully. Please login with your new password." });
    } catch (error) {
      logError("Reset password error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Validate Reset Token - Check if token is valid without using it
  router.get("/api/auth/validate-reset-token", async (req: AuthRequest, res) => {
    try {
      const token = req.query.token as string;
      
      if (!token) {
        res.status(400).json({ valid: false, error: "No token provided" });
        return;
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt)
          )
        )
        .limit(1);

      if (!resetToken) {
        res.json({ valid: false, error: "Invalid or expired reset token" });
        return;
      }

      if (new Date() > resetToken.expiresAt) {
        res.json({ valid: false, error: "Reset token has expired" });
        return;
      }

      res.json({ valid: true });
    } catch (error) {
      logError("Validate token error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ valid: false, error: "Internal server error" });
    }
  });

export default router;
