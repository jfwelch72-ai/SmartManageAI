import { Router } from "express";
import { db } from "./db";
import { users, insertUserSchema, projects, changeOrders, calendarEvents, projectDelays } from "@shared/schema";
import { requireAuth, requireRole, hashPassword, verifyPassword, revokeUserTokens, type AuthRequest } from "./auth";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { sensitiveLimiter } from "./rateLimiter";
import { logAudit } from "./auditLogger";
import { sanitizeShortText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { getOrgIdForFilter, verifyUserOrgAccess } from "./orgFilter";

const router = Router();

// ====================
// Dashboard Routes
// ====================

// Get dashboard statistics
router.get("/api/dashboard/stats", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    // Organization filtering: SUPER_ADMIN sees all, others see only their org's data
    const { shouldFilter, orgId, isSuperAdmin: isSuperAdminUser, mustDenyAccess } = getOrgIdForFilter(req);
    
    // SECURITY: Users without org can't see any dashboard stats
    if (mustDenyAccess) {
      return res.json({
        activeProjectsCount: 0,
        pendingChangeOrdersCount: 0,
        pendingTimeOffCount: 0,
        activeDelaysCount: 0,
        delaysNeedingAckCount: 0,
        pendingInspectionsCount: 0,
        scheduledInspectionsCount: 0,
        aiTasksCount: 0,
        openBidsCount: 0,
        estimatedBidValue: 0
      });
    }
    
    // Build organization filter condition for projects
    const orgCondition = shouldFilter && orgId 
      ? eq(projects.gcOrganizationId, orgId) 
      : sql`true`;

    // Count active projects (filtered by org)
    const activeProjectsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.status, "ACTIVE"), orgCondition));
    const activeProjectsCount = activeProjectsResult[0]?.count || 0;

    // Count submitted change orders awaiting client response (filtered by org via project join)
    let pendingChangeOrdersCount = 0;
    if (shouldFilter && orgId) {
      const pendingCOResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(changeOrders)
        .innerJoin(projects, eq(changeOrders.projectId, projects.id))
        .where(and(
          eq(changeOrders.status, "SUBMITTED"),
          eq(projects.gcOrganizationId, orgId)
        ));
      pendingChangeOrdersCount = pendingCOResult[0]?.count || 0;
    } else {
      const pendingCOResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(changeOrders)
        .where(eq(changeOrders.status, "SUBMITTED"));
      pendingChangeOrdersCount = pendingCOResult[0]?.count || 0;
    }

    // Count pending time-off requests (filtered by user's org)
    let pendingTimeOffCount = 0;
    if (shouldFilter && orgId) {
      const pendingTimeOffResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(calendarEvents)
        .innerJoin(users, eq(calendarEvents.userId, users.id))
        .where(sql`${calendarEvents.eventType} = 'TIME_OFF_REQUEST' AND ${calendarEvents.approvedById} IS NULL AND ${users.organizationId} = ${orgId}`);
      pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;
    } else {
      const pendingTimeOffResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(calendarEvents)
        .where(sql`${calendarEvents.eventType} = 'TIME_OFF_REQUEST' AND ${calendarEvents.approvedById} IS NULL`);
      pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;
    }

    // Count active delays (filtered by org via project join)
    let activeDelaysCount = 0;
    if (shouldFilter && orgId) {
      const activeDelaysResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectDelays)
        .innerJoin(projects, eq(projectDelays.projectId, projects.id))
        .where(sql`${projectDelays.status} IN ('DRAFT', 'SUBMITTED') AND ${projects.gcOrganizationId} = ${orgId}`);
      activeDelaysCount = activeDelaysResult[0]?.count || 0;
    } else {
      const activeDelaysResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectDelays)
        .where(sql`${projectDelays.status} IN ('DRAFT', 'SUBMITTED')`);
      activeDelaysCount = activeDelaysResult[0]?.count || 0;
    }

    // Count delays requiring acknowledgment (filtered by org via project join)
    let delaysNeedingAckCount = 0;
    if (shouldFilter && orgId) {
      const delaysNeedingAckResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectDelays)
        .innerJoin(projects, eq(projectDelays.projectId, projects.id))
        .where(and(
          eq(projectDelays.status, "SUBMITTED"),
          eq(projects.gcOrganizationId, orgId)
        ));
      delaysNeedingAckCount = delaysNeedingAckResult[0]?.count || 0;
    } else {
      const delaysNeedingAckResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectDelays)
        .where(eq(projectDelays.status, "SUBMITTED"));
      delaysNeedingAckCount = delaysNeedingAckResult[0]?.count || 0;
    }

    // Count delays requiring change orders (filtered by org via project join)
    let delaysNeedingChangeOrderCount = 0;
    if (shouldFilter && orgId) {
      const delaysNeedingCOResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectDelays)
        .innerJoin(projects, eq(projectDelays.projectId, projects.id))
        .where(sql`${projectDelays.changeOrderRequired} = true AND ${projectDelays.linkedChangeOrderId} IS NULL AND ${projects.gcOrganizationId} = ${orgId}`);
      delaysNeedingChangeOrderCount = delaysNeedingCOResult[0]?.count || 0;
    } else {
      const delaysNeedingCOResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectDelays)
        .where(sql`${projectDelays.changeOrderRequired} = true AND ${projectDelays.linkedChangeOrderId} IS NULL`);
      delaysNeedingChangeOrderCount = delaysNeedingCOResult[0]?.count || 0;
    }

    res.json({
      activeProjectsCount,
      pendingChangeOrdersCount,
      pendingTimeOffCount,
      activeDelaysCount,
      delaysNeedingAckCount,
      delaysNeedingChangeOrderCount,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get comprehensive dashboard snapshot for AI analysis
router.get("/api/dashboard/snapshot", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required for dashboard snapshot" });
    }

    const { buildDashboardSnapshot, buildAISnapshotData } = await import("./dataPipelineService");
    
    const snapshot = await buildDashboardSnapshot(orgId);
    const aiData = await buildAISnapshotData(orgId);
    
    res.json({ snapshot, aiData });
  } catch (error) {
    console.error("Dashboard snapshot error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Aggregate time tracking data for production rate calculations
router.post("/api/dashboard/aggregate-time-tracking", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { startDate, endDate } = req.body;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const { aggregateTimeTrackingToProductionRates } = await import("./dataPipelineService");
    
    const result = await aggregateTimeTrackingToProductionRates(orgId, start, end);
    
    res.json(result);
  } catch (error) {
    console.error("Time tracking aggregation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// User Management Routes
// ====================

// Create user schema (omit passwordHash, add password)
const createUserSchema = insertUserSchema.omit({ passwordHash: true }).extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Update user schema
const updateUserSchema = insertUserSchema.omit({ passwordHash: true }).partial().extend({
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

// Get all users (Admin/Manager/Office Manager)
router.get("/api/users", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    // Organization filtering: SUPER_ADMIN sees all users, others see only their org's users
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    // SECURITY: Users without org can't see any users
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    let allUsers;
    if (shouldFilter && orgId) {
      allUsers = await db.select().from(users).where(eq(users.organizationId, orgId));
    } else {
      allUsers = await db.select().from(users);
    }
    const usersWithoutPasswords = allUsers.map(({ passwordHash, ...user }) => user);
    res.json(usersWithoutPasswords);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user by ID (Admin/Manager only)
router.get("/api/users/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!verifyUserOrgAccess(req, res, user)) return;

    const { passwordHash, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create user (Admin only)
router.post("/api/users", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      firstName: sanitizeShortText(req.body.firstName),
      lastName: sanitizeShortText(req.body.lastName),
      email: sanitizeEmail(req.body.email),
      phone: sanitizePhone(req.body.phone),
      password: req.body.password, // Don't sanitize passwords - preserve exact input
    };

    const validationResult = createUserSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { firstName, lastName, email, phone, role, password } = validationResult.data;

    const passwordHash = await hashPassword(password);

    // Auto-assign to requesting admin's organization
    const [newUser] = await db.insert(users).values({
      firstName,
      lastName,
      email,
      phone: phone || null,
      role: role || "HOURLY_EMPLOYEE",
      isActive: true,
      passwordHash,
      organizationId: req.user!.organizationId,
    }).returning();

    const { passwordHash: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (error: any) {
    console.error("Create user error:", error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: "Email already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Update user (Admin only)
router.patch("/api/users/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const [targetUser] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }
    if (!verifyUserOrgAccess(req, res, targetUser)) return;

    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      firstName: req.body.firstName ? sanitizeShortText(req.body.firstName) : undefined,
      lastName: req.body.lastName ? sanitizeShortText(req.body.lastName) : undefined,
      email: req.body.email ? sanitizeEmail(req.body.email) : undefined,
      phone: req.body.phone ? sanitizePhone(req.body.phone) : undefined,
      password: req.body.password, // Don't sanitize passwords - preserve exact input
    };

    const validationResult = updateUserSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { firstName, lastName, email, phone, role, isActive, password } = validationResult.data;
    
    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password !== undefined) updateData.passwordHash = await hashPassword(password);
    
    updateData.updatedAt = new Date();

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, req.params.id))
      .returning();

    if (!updatedUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { passwordHash, tokenVersion, ...userWithoutPassword } = updatedUser;
    res.json(userWithoutPassword);
  } catch (error: any) {
    console.error("Update user error:", error);
    if (error.code === '23505') {
      res.status(409).json({ error: "Email already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Update user cost rates (Admin only)
router.patch("/api/users/:id/cost-rates", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const { costRateRegular, costRateOvertime } = req.body;

    if (costRateRegular === undefined || costRateRegular === null || costRateRegular === "") {
      res.status(400).json({ error: "Regular cost rate is required" });
      return;
    }

    if (costRateOvertime === undefined || costRateOvertime === null || costRateOvertime === "") {
      res.status(400).json({ error: "Overtime cost rate is required" });
      return;
    }

    const regularRate = Number(costRateRegular);
    const overtimeRate = Number(costRateOvertime);

    if (isNaN(regularRate) || isNaN(overtimeRate) || regularRate < 0 || overtimeRate < 0) {
      res.status(400).json({ error: "Cost rates must be valid non-negative numbers" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!verifyUserOrgAccess(req, res, user)) return;

    const [updated] = await db
      .update(users)
      .set({ 
        costRateRegular: regularRate.toFixed(2), 
        costRateOvertime: overtimeRate.toFixed(2),
        updatedAt: new Date() 
      })
      .where(eq(users.id, req.params.id))
      .returning();

    const { passwordHash, tokenVersion, ...userWithoutPassword } = updated;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error("Update cost rates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke all user tokens (logout all devices) - Admin only
router.post("/api/users/:id/revoke-tokens", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!verifyUserOrgAccess(req, res, user)) return;

    await revokeUserTokens(req.params.id);

    // Audit log
    await logAudit({
      userId: req.user!.id,
      entityType: "USER",
      entityId: req.params.id,
      action: "REVOKE_TOKENS",
      oldValue: null,
      newValue: JSON.stringify({ revokedBy: req.user!.email }),
    }, req);

    res.json({ success: true, message: "All tokens revoked. User will need to log in again." });
  } catch (error) {
    console.error("Revoke tokens error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Change own password
router.post("/api/auth/change-password", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, "Password must be at least 8 characters"),
    });

    const data = schema.parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const isValid = await verifyPassword(data.currentPassword, user.passwordHash);
    
    if (!isValid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const newPasswordHash = await hashPassword(data.newPassword);

    await db
      .update(users)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
