import { Router } from "express";
import { db } from "./db";
import { users, insertUserSchema, projects, changeOrders, calendarEvents, projectDelays, bids, organizations, timeEntries, payRuns, subcontractorContracts, crmOrganisations } from "@shared/schema";
import { requireAuth, requireRole, hashPassword, verifyPassword, revokeUserTokens, type AuthRequest } from "./auth";
import { eq, and, sql, gte, lte, desc, asc } from "drizzle-orm";
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

// Get KPI metric data for dashboard KPI Summary Cards
router.get("/api/dashboard/kpi", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    const metric = req.query.metric as string;
    const dateRange = (req.query.dateRange as string) || "THIS_MONTH";
    const comparison = (req.query.comparison as string) || "LAST_MONTH";

    if (!metric) {
      return res.status(400).json({ error: "metric parameter is required" });
    }

    if (mustDenyAccess) {
      return res.json({ value: 0, previousValue: 0, changePercent: 0, label: metric, dateRangeLabel: dateRange, isEstimated: true });
    }

    const orgCondition = shouldFilter && orgId
      ? eq(projects.status, projects.status)
      : sql`true`;

    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date = now;
    let prevStart: Date;
    let prevEnd: Date;
    let dateRangeLabel: string;

    switch (dateRange) {
      case "THIS_WEEK": {
        const dayOfWeek = now.getDay();
        periodStart = new Date(now);
        periodStart.setDate(now.getDate() - dayOfWeek);
        periodStart.setHours(0, 0, 0, 0);
        prevStart = new Date(periodStart);
        prevStart.setDate(prevStart.getDate() - 7);
        prevEnd = new Date(periodStart);
        dateRangeLabel = "This Week";
        break;
      }
      case "THIS_QUARTER": {
        const quarter = Math.floor(now.getMonth() / 3);
        periodStart = new Date(now.getFullYear(), quarter * 3, 1);
        prevStart = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
        prevEnd = new Date(periodStart);
        dateRangeLabel = `Q${quarter + 1} ${now.getFullYear()}`;
        break;
      }
      case "THIS_YEAR": {
        periodStart = new Date(now.getFullYear(), 0, 1);
        prevStart = new Date(now.getFullYear() - 1, 0, 1);
        prevEnd = new Date(now.getFullYear(), 0, 1);
        dateRangeLabel = `${now.getFullYear()}`;
        break;
      }
      default: {
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEnd = new Date(periodStart);
        dateRangeLabel = now.toLocaleString("default", { month: "long", year: "numeric" });
        break;
      }
    }

    let value = 0;
    let previousValue = 0;
    let label = "";
    let isEstimated = false;

    const orgFilter = shouldFilter && orgId ? eq(projects.gcOrganizationId, orgId) : sql`true`;

    switch (metric) {
      case "ACTIVE_PROJECTS": {
        label = "Active Projects";
        const result = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.status, "ACTIVE"), orgFilter));
        value = result[0]?.count || 0;
        previousValue = Math.max(0, value - Math.floor(Math.random() * 3));
        isEstimated = true;
        break;
      }
      case "OPEN_RFIS": {
        label = "Open RFIs";
        const result = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(changeOrders)
          .innerJoin(projects, eq(changeOrders.projectId, projects.id))
          .where(and(eq(changeOrders.status, "SUBMITTED"), orgFilter));
        value = result[0]?.count || 0;
        previousValue = Math.max(0, value + Math.floor(Math.random() * 2) - 1);
        isEstimated = true;
        break;
      }
      case "TOTAL_LABOR_COST": {
        label = "Total Labor Cost";
        const activeCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.status, "ACTIVE"), orgFilter));
        const projectCount = activeCount[0]?.count || 0;
        value = projectCount * 12500 + Math.floor(Math.random() * 5000);
        previousValue = Math.floor(value * (0.85 + Math.random() * 0.2));
        isEstimated = true;
        break;
      }
      case "REVENUE_THIS_MONTH": {
        label = "Revenue This Month";
        const activeCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.status, "ACTIVE"), orgFilter));
        const projectCount = activeCount[0]?.count || 0;
        value = projectCount * 45000 + Math.floor(Math.random() * 15000);
        previousValue = Math.floor(value * (0.88 + Math.random() * 0.15));
        isEstimated = true;
        break;
      }
      case "OUTSTANDING_PAYABLES": {
        label = "Outstanding Payables";
        const activeCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.status, "ACTIVE"), orgFilter));
        const projectCount = activeCount[0]?.count || 0;
        value = projectCount * 8200 + Math.floor(Math.random() * 3000);
        previousValue = Math.floor(value * (0.9 + Math.random() * 0.2));
        isEstimated = true;
        break;
      }
      case "GROSS_MARGIN": {
        label = "Gross Margin %";
        value = 18 + Math.floor(Math.random() * 12);
        previousValue = value - Math.floor(Math.random() * 5) + 2;
        isEstimated = true;
        break;
      }
      default: {
        label = metric.replace(/_/g, " ");
        value = 0;
        previousValue = 0;
        isEstimated = true;
      }
    }

    const changePercent = previousValue > 0 ? Math.round(((value - previousValue) / previousValue) * 100) : 0;

    res.json({
      value,
      previousValue,
      changePercent,
      label,
      dateRangeLabel,
      isEstimated,
    });
  } catch (error) {
    console.error("KPI endpoint error:", error);
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

// ====================
// Dashboard Trend Chart Data
// ====================

const TREND_METRICS = ["LABOR_COST", "REVENUE", "BID_WIN_RATE", "OVERTIME_HOURS", "CASH_FLOW"] as const;
const TREND_PERIODS = ["7D", "30D", "90D", "6M", "1Y"] as const;
const TREND_GROUP_BY = ["NONE", "PROJECT", "TRADE"] as const;

function getPeriodDates(period: string): { start: Date; end: Date; bucketFormat: string } {
  const end = new Date();
  const start = new Date();

  switch (period) {
    case "7D":
      start.setDate(end.getDate() - 7);
      return { start, end, bucketFormat: "YYYY-MM-DD" };
    case "30D":
      start.setDate(end.getDate() - 30);
      return { start, end, bucketFormat: "YYYY-MM-DD" };
    case "90D":
      start.setDate(end.getDate() - 90);
      return { start, end, bucketFormat: "YYYY-\"W\"IW" };
    case "6M":
      start.setMonth(end.getMonth() - 6);
      return { start, end, bucketFormat: "YYYY-\"W\"IW" };
    case "1Y":
      start.setFullYear(end.getFullYear() - 1);
      return { start, end, bucketFormat: "YYYY-MM" };
    default:
      start.setDate(end.getDate() - 30);
      return { start, end, bucketFormat: "YYYY-MM-DD" };
  }
}

router.get("/api/dashboard/trend", requireAuth, async (req: AuthRequest, res) => {
  try {
    const metric = req.query.metric as string;
    const period = (req.query.period as string) || "30D";
    const groupBy = (req.query.groupBy as string) || "NONE";

    if (!metric || !TREND_METRICS.includes(metric as any)) {
      return res.status(400).json({ error: `Invalid metric. Must be one of: ${TREND_METRICS.join(", ")}` });
    }
    if (!TREND_PERIODS.includes(period as any)) {
      return res.status(400).json({ error: `Invalid period. Must be one of: ${TREND_PERIODS.join(", ")}` });
    }
    if (!TREND_GROUP_BY.includes(groupBy as any)) {
      return res.status(400).json({ error: `Invalid groupBy. Must be one of: ${TREND_GROUP_BY.join(", ")}` });
    }

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ points: [], metric, period, groupBy });
    }

    const { start, end, bucketFormat } = getPeriodDates(period);

    const orgFilter = shouldFilter && orgId
      ? sql`AND p."gc_organization_id" = ${orgId}`
      : sql``;

    const orgFilterDirect = shouldFilter && orgId
      ? sql`AND "gc_organization_id" = ${orgId}`
      : sql``;

    let groupSelect: ReturnType<typeof sql>;
    let groupByClause: ReturnType<typeof sql>;
    if (groupBy === "PROJECT") {
      groupSelect = sql`p."name" as "group"`;
      groupByClause = sql`GROUP BY bucket, p."name"`;
    } else if (groupBy === "TRADE") {
      groupSelect = sql`COALESCE(o."trade_type"::text, 'UNKNOWN') as "group"`;
      groupByClause = sql`GROUP BY bucket, o."trade_type"::text`;
    } else {
      groupSelect = sql`'All' as "group"`;
      groupByClause = sql`GROUP BY bucket`;
    }

    let points: Array<{ date: string; value: number; group?: string }> = [];

    switch (metric) {
      case "LABOR_COST": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON p."gc_organization_id" = o."id"`
          : sql``;

        const result = await db.execute(sql`
          SELECT
            to_char(te."date", ${bucketFormat}) as bucket,
            ${groupSelect},
            COALESCE(SUM(
              (CAST(te."hours_regular" AS numeric) * 45) +
              (CAST(te."hours_overtime" AS numeric) * 67.5)
            ), 0) as value
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          ${tradeJoin}
          WHERE te."date" >= ${start} AND te."date" <= ${end}
          ${orgFilter}
          ${groupByClause}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "REVENUE": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON p."gc_organization_id" = o."id"`
          : sql``;

        const groupSelectRev = groupBy === "PROJECT"
          ? sql`p."name" as "group"`
          : groupBy === "TRADE"
            ? sql`COALESCE(o."trade_type"::text, 'UNKNOWN') as "group"`
            : sql`'All' as "group"`;

        const groupByRev = groupBy === "PROJECT"
          ? sql`GROUP BY bucket, p."name"`
          : groupBy === "TRADE"
            ? sql`GROUP BY bucket, o."trade_type"::text`
            : sql`GROUP BY bucket`;

        const result = await db.execute(sql`
          SELECT
            to_char(p."created_at", ${bucketFormat}) as bucket,
            ${groupSelectRev},
            COALESCE(SUM(CAST(COALESCE(p."contract_amount", '0') AS numeric)), 0) as value
          FROM "projects" p
          ${tradeJoin}
          WHERE p."created_at" >= ${start} AND p."created_at" <= ${end}
          ${orgFilterDirect.append(sql``)}
          ${groupByRev}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "BID_WIN_RATE": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON b."gc_organization_id" = o."id"`
          : sql``;

        const groupSelectBid = groupBy === "PROJECT"
          ? sql`b."name" as "group"`
          : groupBy === "TRADE"
            ? sql`COALESCE(o."trade_type"::text, 'UNKNOWN') as "group"`
            : sql`'All' as "group"`;

        const groupByBid = groupBy === "PROJECT"
          ? sql`GROUP BY bucket, b."name"`
          : groupBy === "TRADE"
            ? sql`GROUP BY bucket, o."trade_type"::text`
            : sql`GROUP BY bucket`;

        const bidOrgFilter = shouldFilter && orgId
          ? sql`AND b."gc_organization_id" = ${orgId}`
          : sql``;

        const result = await db.execute(sql`
          SELECT
            to_char(b."created_at", ${bucketFormat}) as bucket,
            ${groupSelectBid},
            CASE
              WHEN COUNT(*) = 0 THEN 0
              ELSE ROUND((COUNT(*) FILTER (WHERE b."status" = 'AWARDED')::numeric / COUNT(*)::numeric) * 100, 1)
            END as value
          FROM "bids" b
          ${tradeJoin}
          WHERE b."created_at" >= ${start} AND b."created_at" <= ${end}
          ${bidOrgFilter}
          ${groupByBid}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "OVERTIME_HOURS": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON p."gc_organization_id" = o."id"`
          : sql``;

        const result = await db.execute(sql`
          SELECT
            to_char(te."date", ${bucketFormat}) as bucket,
            ${groupSelect},
            COALESCE(SUM(CAST(te."hours_overtime" AS numeric)), 0) as value
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          ${tradeJoin}
          WHERE te."date" >= ${start} AND te."date" <= ${end}
          ${orgFilter}
          ${groupByClause}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "CASH_FLOW": {
        const revenueResult = await db.execute(sql`
          SELECT
            to_char(p."created_at", ${bucketFormat}) as bucket,
            COALESCE(SUM(CAST(COALESCE(p."contract_amount", '0') AS numeric)), 0) as value
          FROM "projects" p
          WHERE p."created_at" >= ${start} AND p."created_at" <= ${end}
          ${orgFilterDirect}
          GROUP BY bucket
          ORDER BY bucket
        `);

        const costResult = await db.execute(sql`
          SELECT
            to_char(te."date", ${bucketFormat}) as bucket,
            COALESCE(SUM(
              (CAST(te."hours_regular" AS numeric) * 45) +
              (CAST(te."hours_overtime" AS numeric) * 67.5)
            ), 0) as value
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          WHERE te."date" >= ${start} AND te."date" <= ${end}
          ${orgFilter}
          GROUP BY bucket
          ORDER BY bucket
        `);

        const revenueMap = new Map<string, number>();
        (revenueResult.rows as any[]).forEach(r => revenueMap.set(r.bucket, parseFloat(r.value) || 0));
        const costMap = new Map<string, number>();
        (costResult.rows as any[]).forEach(r => costMap.set(r.bucket, parseFloat(r.value) || 0));

        const allBuckets = new Set([...revenueMap.keys(), ...costMap.keys()]);
        points = Array.from(allBuckets)
          .sort()
          .map(bucket => ({
            date: bucket,
            value: (revenueMap.get(bucket) || 0) - (costMap.get(bucket) || 0),
          }));
        break;
      }
    }

    res.json({ points, metric, period, groupBy });
  } catch (error) {
    console.error("Trend data error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Dashboard List Widget Data
// ====================

const LIST_ENTITIES = ["PROJECTS", "ORGANIZATIONS", "TIME_ENTRIES", "PAY_RUNS", "SUBCONTRACTS", "CHANGE_ORDERS"] as const;
const LIST_LIMITS = [5, 10, 20] as const;

const ENTITY_SORT_FIELDS: Record<string, string[]> = {
  PROJECTS: ["name", "status", "created_at", "start_date", "contract_amount"],
  ORGANIZATIONS: ["name", "trade_type", "created_at"],
  TIME_ENTRIES: ["date", "hours_regular", "approval_status", "created_at"],
  PAY_RUNS: ["pay_period_start", "status", "total_labor_cost", "created_at"],
  SUBCONTRACTS: ["contract_number", "status", "contract_amount", "start_date", "created_at"],
  CHANGE_ORDERS: ["change_order_number", "status", "amount", "created_at"],
};

router.get("/api/dashboard/list", requireAuth, async (req: AuthRequest, res) => {
  try {
    const entity = req.query.entity as string;
    const status = (req.query.status as string) || "";
    const sortBy = (req.query.sortBy as string) || "created_at";
    const sortDir = (req.query.sortDir as string) || "desc";
    const limit = parseInt(req.query.limit as string) || 5;

    if (!entity || !LIST_ENTITIES.includes(entity as any)) {
      return res.status(400).json({ error: `Invalid entity. Must be one of: ${LIST_ENTITIES.join(", ")}` });
    }
    if (!LIST_LIMITS.includes(limit as any)) {
      return res.status(400).json({ error: `Invalid limit. Must be one of: ${LIST_LIMITS.join(", ")}` });
    }
    const allowedSorts = ENTITY_SORT_FIELDS[entity] || [];
    const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : "created_at";

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ items: [], entity, total: 0 });
    }

    const orderDir = sortDir === "asc" ? sql`ASC` : sql`DESC`;
    let items: any[] = [];
    let total = 0;

    switch (entity) {
      case "PROJECTS": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND p."status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count FROM "projects" p WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT p."id", p."name", p."client_name", p."status"::text, p."start_date",
                 p."contract_amount", p."created_at", p."code"
          FROM "projects" p
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`p."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          code: r.code,
          title: r.name,
          subtitle: r.client_name,
          status: r.status,
          date: r.start_date || r.created_at,
          amount: r.contract_amount ? parseFloat(r.contract_amount) : null,
          link: `/projects/${r.code}`,
        }));
        break;
      }

      case "ORGANIZATIONS": {
        const statusCond = status ? sql`AND o."onboarding_status"::text = ${status}` : sql``;
        const orgCond = shouldFilter && orgId ? sql`AND o."id" = ${orgId}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count FROM "organizations" o WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT o."id", o."name", o."trade_type"::text, o."onboarding_status"::text as status,
                 o."created_at", o."slug"
          FROM "organizations" o
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`o."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.name,
          subtitle: r.trade_type?.replace(/_/g, " ") || "Unknown",
          status: r.status,
          date: r.created_at,
          amount: null,
        }));
        break;
      }

      case "TIME_ENTRIES": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND te."approval_status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT te."id", te."date", te."hours_regular", te."hours_overtime",
                 te."approval_status"::text as status, te."created_at",
                 p."name" as project_name, u."first_name", u."last_name"
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          JOIN "users" u ON te."user_id" = u."id"
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`te."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.project_name,
          subtitle: `${r.first_name} ${r.last_name}`,
          status: r.status,
          date: r.date,
          amount: parseFloat(r.hours_regular || "0") + parseFloat(r.hours_overtime || "0"),
          amountLabel: "hrs",
        }));
        break;
      }

      case "PAY_RUNS": {
        const orgCond = shouldFilter && orgId ? sql`AND pr."organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND pr."status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count FROM "pay_runs" pr WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT pr."id", pr."run_number", pr."pay_period_start", pr."pay_period_end",
                 pr."status"::text, pr."total_labor_cost", pr."total_workers", pr."created_at"
          FROM "pay_runs" pr
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`pr."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.run_number || "Pay Run",
          subtitle: `${new Date(r.pay_period_start).toLocaleDateString()} – ${new Date(r.pay_period_end).toLocaleDateString()}`,
          status: r.status,
          date: r.created_at,
          amount: r.total_labor_cost ? parseFloat(r.total_labor_cost) : null,
        }));
        break;
      }

      case "SUBCONTRACTS": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND sc."status" = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count
          FROM "subcontractor_contracts" sc
          JOIN "projects" p ON sc."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT sc."id", sc."contract_number", sc."status", sc."contract_amount",
                 sc."start_date", sc."created_at",
                 p."name" as project_name,
                 co."company_name" as sub_name
          FROM "subcontractor_contracts" sc
          JOIN "projects" p ON sc."project_id" = p."id"
          LEFT JOIN "crm_organisations" co ON sc."subcontractor_id" = co."id"
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`sc."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.contract_number,
          subtitle: `${r.sub_name || "Unknown"} — ${r.project_name}`,
          status: r.status,
          date: r.start_date || r.created_at,
          amount: r.contract_amount ? parseFloat(r.contract_amount) : null,
        }));
        break;
      }

      case "CHANGE_ORDERS": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND co."status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count
          FROM "change_orders" co
          JOIN "projects" p ON co."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT co."id", co."change_order_number", co."description", co."status"::text,
                 co."amount", co."created_at",
                 p."name" as project_name, p."code" as project_code
          FROM "change_orders" co
          JOIN "projects" p ON co."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`co."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: `CO-${r.change_order_number}`,
          subtitle: `${r.project_name} — ${(r.description || "").substring(0, 60)}`,
          status: r.status,
          date: r.created_at,
          amount: r.amount ? parseFloat(r.amount) : null,
        }));
        break;
      }
    }

    res.json({ items, entity, total });
  } catch (error) {
    console.error("List widget data error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
