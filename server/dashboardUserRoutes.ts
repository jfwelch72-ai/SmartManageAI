import { Router } from "express";
import { db } from "./db";
import { users, insertUserSchema, projects, changeOrders, calendarEvents, projectDelays, bids, organizations, timeEntries, payRuns, subcontractorContracts, crmOrganisations, organizationDocuments, subcontractorPayments, subcontractorBillingSchedule, procurementItems } from "@shared/schema";
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

// ====================
// Dashboard Alerts Widget
// ====================

interface Alert {
  id: string;
  type: "INSURANCE_EXPIRING" | "OVER_BUDGET" | "UNAPPROVED_TIME" | "LATE_SUB_PAYMENT" | "LOW_MARGIN";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  entityId?: string;
  link?: string;
}

router.get("/api/dashboard/alerts", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ alerts: [], counts: { critical: 0, warning: 0, info: 0 } });
    }

    const alerts: Alert[] = [];
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1. Insurance Expiring — organization documents
    try {
      const orgDocCond = shouldFilter && orgId ? sql`AND od."organization_id" = ${orgId}` : sql``;
      const docResult = await db.execute(sql`
        SELECT od."id", od."name", od."type"::text, od."expires_at", od."organization_id",
               o."name" as org_name
        FROM "organization_documents" od
        JOIN "organizations" o ON od."organization_id" = o."id"
        WHERE od."is_active" = true
          AND od."expires_at" IS NOT NULL
          AND od."expires_at" <= ${thirtyDaysFromNow.toISOString()}::date
          ${orgDocCond}
        ORDER BY od."expires_at" ASC
        LIMIT 20
      `);
      for (const row of docResult.rows as any[]) {
        const expiresAt = new Date(row.expires_at);
        const isExpired = expiresAt <= now;
        const docType = (row.type || "").replace(/_/g, " ").replace(/INSURANCE CERT /i, "").toLowerCase();
        alerts.push({
          id: `ins-doc-${row.id}`,
          type: "INSURANCE_EXPIRING",
          severity: isExpired ? "critical" : "warning",
          title: isExpired ? "Insurance Expired" : "Insurance Expiring Soon",
          description: `${row.name || docType} for ${row.org_name} ${isExpired ? "expired" : "expires"} ${expiresAt.toLocaleDateString()}`,
          entityId: row.organization_id,
        });
      }

      // CRM organisations insurance
      const crmCond = shouldFilter && orgId ? sql`AND co."organization_id" = ${orgId}` : sql``;
      const crmResult = await db.execute(sql`
        SELECT co."id", co."name" as company_name,
               co."insurance_expiration", co."wc_insurance_expiration"
        FROM "crm_organisations" co
        WHERE (
          (co."insurance_expiration" IS NOT NULL AND co."insurance_expiration" <= ${thirtyDaysFromNow.toISOString()}::timestamp)
          OR (co."wc_insurance_expiration" IS NOT NULL AND co."wc_insurance_expiration" <= ${thirtyDaysFromNow.toISOString()}::timestamp)
        )
        ${crmCond}
        LIMIT 20
      `);
      for (const row of crmResult.rows as any[]) {
        if (row.insurance_expiration) {
          const exp = new Date(row.insurance_expiration);
          if (exp <= thirtyDaysFromNow) {
            alerts.push({
              id: `ins-crm-gl-${row.id}`,
              type: "INSURANCE_EXPIRING",
              severity: exp <= now ? "critical" : "warning",
              title: exp <= now ? "Vendor Insurance Expired" : "Vendor Insurance Expiring",
              description: `General liability for ${row.company_name || "vendor"} ${exp <= now ? "expired" : "expires"} ${exp.toLocaleDateString()}`,
              entityId: row.id,
            });
          }
        }
        if (row.wc_insurance_expiration) {
          const exp = new Date(row.wc_insurance_expiration);
          if (exp <= thirtyDaysFromNow) {
            alerts.push({
              id: `ins-crm-wc-${row.id}`,
              type: "INSURANCE_EXPIRING",
              severity: exp <= now ? "critical" : "warning",
              title: exp <= now ? "Workers Comp Expired" : "Workers Comp Expiring",
              description: `Workers comp for ${row.company_name || "vendor"} ${exp <= now ? "expired" : "expires"} ${exp.toLocaleDateString()}`,
              entityId: row.id,
            });
          }
        }
      }
    } catch (e) {
      console.error("Alerts: insurance check error:", e);
    }

    // 2. Over Budget Projects
    try {
      const projOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const budgetResult = await db.execute(sql`
        SELECT
          p."id", p."name", p."code",
          COALESCE(p."contract_amount", p."budget", 0)::numeric as base_budget,
          COALESCE((
            SELECT SUM(co2."amount"::numeric)
            FROM "change_orders" co2
            WHERE co2."project_id" = p."id" AND co2."status"::text = 'APPROVED'
          ), 0) as approved_cos,
          COALESCE((
            SELECT SUM(
              te."hours_regular"::numeric * COALESCE(u."cost_rate_regular"::numeric, 50)
              + te."hours_overtime"::numeric * COALESCE(u."cost_rate_overtime"::numeric, 75)
            )
            FROM "time_entries" te
            JOIN "users" u ON te."user_id" = u."id"
            WHERE te."project_id" = p."id"
          ), 0) as labor_cost,
          COALESCE((
            SELECT SUM(pi."quantity"::numeric * pi."unit_cost"::numeric)
            FROM "procurement_items" pi
            WHERE pi."project_id" = p."id" AND pi."status"::text != 'CANCELLED'
          ), 0) as material_cost
        FROM "projects" p
        WHERE p."status"::text = 'ACTIVE'
          ${projOrgCond}
        LIMIT 50
      `);
      for (const row of budgetResult.rows as any[]) {
        const baseBudget = parseFloat(row.base_budget) || 0;
        if (baseBudget <= 0) continue;
        const adjustedBudget = baseBudget + (parseFloat(row.approved_cos) || 0);
        const actualCost = (parseFloat(row.labor_cost) || 0) + (parseFloat(row.material_cost) || 0);
        const variance = adjustedBudget - actualCost;
        const variancePct = (variance / adjustedBudget) * 100;

        if (variancePct < 0) {
          alerts.push({
            id: `budget-${row.id}`,
            type: "OVER_BUDGET",
            severity: "critical",
            title: "Project Over Budget",
            description: `${row.name} is $${Math.abs(variance).toLocaleString(undefined, { maximumFractionDigits: 0 })} over budget (${Math.abs(variancePct).toFixed(1)}%)`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        } else if (variancePct < 10) {
          alerts.push({
            id: `budget-${row.id}`,
            type: "OVER_BUDGET",
            severity: "warning",
            title: "Budget Nearly Exhausted",
            description: `${row.name} has only ${variancePct.toFixed(1)}% budget remaining ($${variance.toLocaleString(undefined, { maximumFractionDigits: 0 })} left)`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        }
      }
    } catch (e) {
      console.error("Alerts: budget check error:", e);
    }

    // 3. Unapproved Time Entries
    try {
      const teOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const criticalTimeResult = await db.execute(sql`
        SELECT COUNT(*)::int as count
        FROM "time_entries" te
        JOIN "projects" p ON te."project_id" = p."id"
        WHERE te."approval_status"::text = 'PENDING'
          AND te."created_at" < ${sevenDaysAgo.toISOString()}::timestamp
          ${teOrgCond}
      `);
      const criticalCount = (criticalTimeResult.rows[0] as any)?.count || 0;

      const warningTimeResult = await db.execute(sql`
        SELECT COUNT(*)::int as count
        FROM "time_entries" te
        JOIN "projects" p ON te."project_id" = p."id"
        WHERE te."approval_status"::text = 'PENDING'
          AND te."created_at" >= ${sevenDaysAgo.toISOString()}::timestamp
          AND te."created_at" < ${fortyEightHoursAgo.toISOString()}::timestamp
          ${teOrgCond}
      `);
      const warningCount = (warningTimeResult.rows[0] as any)?.count || 0;

      if (criticalCount > 0) {
        alerts.push({
          id: "time-critical",
          type: "UNAPPROVED_TIME",
          severity: "critical",
          title: "Time Entries Overdue for Approval",
          description: `${criticalCount} time ${criticalCount === 1 ? "entry" : "entries"} pending approval for over 7 days`,
        });
      }
      if (warningCount > 0) {
        alerts.push({
          id: "time-warning",
          type: "UNAPPROVED_TIME",
          severity: "warning",
          title: "Unapproved Time Entries",
          description: `${warningCount} time ${warningCount === 1 ? "entry" : "entries"} pending approval for over 48 hours`,
        });
      }
    } catch (e) {
      console.error("Alerts: time entry check error:", e);
    }

    // 4. Late Subcontractor Payments
    try {
      const subOrgCond = shouldFilter && orgId ? sql`AND sp."organization_id" = ${orgId}` : sql``;
      const latePayResult = await db.execute(sql`
        SELECT sp."id", sp."amount", sp."invoice_number",
               sc."contract_number",
               co."company_name" as sub_name
        FROM "subcontractor_payments" sp
        JOIN "subcontractor_contracts" sc ON sp."contract_id" = sc."id"
        LEFT JOIN "crm_organisations" co ON sc."subcontractor_id" = co."id"
        WHERE sp."status" = 'APPROVED'
          AND sp."paid_at" IS NULL
          AND sp."approved_at" < ${sevenDaysAgo.toISOString()}::timestamp
          ${subOrgCond}
        LIMIT 20
      `);
      for (const row of latePayResult.rows as any[]) {
        alerts.push({
          id: `subpay-${row.id}`,
          type: "LATE_SUB_PAYMENT",
          severity: "critical",
          title: "Late Subcontractor Payment",
          description: `$${parseFloat(row.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })} owed to ${row.sub_name || row.contract_number} (approved but unpaid 7+ days)`,
          entityId: row.id,
        });
      }

      // Check billing schedule past due
      const billingOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const lateBillingResult = await db.execute(sql`
        SELECT sbs."id", sbs."description", sbs."scheduled_amount", sbs."scheduled_date",
               sc."contract_number",
               co."company_name" as sub_name
        FROM "subcontractor_billing_schedule" sbs
        JOIN "subcontractor_contracts" sc ON sbs."contract_id" = sc."id"
        JOIN "projects" p ON sc."project_id" = p."id"
        LEFT JOIN "crm_organisations" co ON sc."subcontractor_id" = co."id"
        WHERE sbs."status" = 'PENDING'
          AND sbs."scheduled_date" IS NOT NULL
          AND sbs."scheduled_date" < ${now.toISOString()}::timestamp
          ${billingOrgCond}
        LIMIT 20
      `);
      for (const row of lateBillingResult.rows as any[]) {
        const scheduledDate = new Date(row.scheduled_date);
        const daysLate = Math.floor((now.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24));
        alerts.push({
          id: `subbill-${row.id}`,
          type: "LATE_SUB_PAYMENT",
          severity: daysLate > 14 ? "critical" : "warning",
          title: "Past Due Subcontractor Milestone",
          description: `$${parseFloat(row.scheduled_amount).toLocaleString(undefined, { maximumFractionDigits: 0 })} to ${row.sub_name || row.contract_number} is ${daysLate} days past due`,
          entityId: row.id,
        });
      }
    } catch (e) {
      console.error("Alerts: subcontractor payment check error:", e);
    }

    // 5. Low Gross Margin
    try {
      const marginOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const marginResult = await db.execute(sql`
        SELECT
          p."id", p."name", p."code",
          COALESCE(p."contract_amount", p."budget", 0)::numeric as base_budget,
          COALESCE((
            SELECT SUM(co2."amount"::numeric)
            FROM "change_orders" co2
            WHERE co2."project_id" = p."id" AND co2."status"::text = 'APPROVED'
          ), 0) as approved_cos,
          COALESCE((
            SELECT SUM(
              te."hours_regular"::numeric * COALESCE(u."cost_rate_regular"::numeric, 50)
              + te."hours_overtime"::numeric * COALESCE(u."cost_rate_overtime"::numeric, 75)
            )
            FROM "time_entries" te
            JOIN "users" u ON te."user_id" = u."id"
            WHERE te."project_id" = p."id"
          ), 0) as labor_cost,
          COALESCE((
            SELECT SUM(pi."quantity"::numeric * pi."unit_cost"::numeric)
            FROM "procurement_items" pi
            WHERE pi."project_id" = p."id" AND pi."status"::text != 'CANCELLED'
          ), 0) as material_cost
        FROM "projects" p
        WHERE p."status"::text = 'ACTIVE'
          ${marginOrgCond}
        LIMIT 50
      `);
      for (const row of marginResult.rows as any[]) {
        const baseBudget = parseFloat(row.base_budget) || 0;
        if (baseBudget <= 0) continue;
        const adjustedBudget = baseBudget + (parseFloat(row.approved_cos) || 0);
        const actualCost = (parseFloat(row.labor_cost) || 0) + (parseFloat(row.material_cost) || 0);
        const margin = adjustedBudget - actualCost;
        const marginPct = (margin / adjustedBudget) * 100;

        if (marginPct >= 0 && marginPct < 5) {
          alerts.push({
            id: `margin-${row.id}`,
            type: "LOW_MARGIN",
            severity: "critical",
            title: "Critically Low Margin",
            description: `${row.name} has only ${marginPct.toFixed(1)}% gross margin ($${margin.toLocaleString(undefined, { maximumFractionDigits: 0 })} remaining)`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        } else if (marginPct >= 5 && marginPct < 15) {
          alerts.push({
            id: `margin-${row.id}`,
            type: "LOW_MARGIN",
            severity: "warning",
            title: "Low Gross Margin",
            description: `${row.name} margin is ${marginPct.toFixed(1)}% — below 15% threshold`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        }
      }
    } catch (e) {
      console.error("Alerts: margin check error:", e);
    }

    // Sort: critical first, then warning, then info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const counts = {
      critical: alerts.filter(a => a.severity === "critical").length,
      warning: alerts.filter(a => a.severity === "warning").length,
      info: alerts.filter(a => a.severity === "info").length,
    };

    res.json({ alerts, counts });
  } catch (error) {
    console.error("Alerts endpoint error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Workforce Snapshot Widget
// ====================

router.get("/api/dashboard/workforce-snapshot", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ activeWorkers: 0, totalWorkers: 0, overtimePercent: 0, laborCostToday: 0, absentWorkers: 0 });
    }

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    const orgCond = shouldFilter && orgId ? sql`AND u."organization_id" = ${orgId}` : sql``;

    // Total field workers in the org (non-admin roles that typically log time)
    const totalResult = await db.execute(sql`
      SELECT COUNT(DISTINCT u."id")::int as count
      FROM "users" u
      WHERE u."is_active" = true
        AND u."role"::text IN ('HOURLY_EMPLOYEE', 'SUPERINTENDENT', 'MAINTENANCE_MANAGER', 'MANAGER', 'HUSTLER')
        ${orgCond}
    `);
    const totalWorkers = (totalResult.rows[0] as any)?.count || 0;

    // Active workers today: distinct users with time entries dated today OR open clock shifts
    // Scope consistently by user.organization_id to match totalWorkers definition
    const activeResult = await db.execute(sql`
      SELECT COUNT(DISTINCT worker_id)::int as count FROM (
        SELECT te."user_id" as worker_id
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        WHERE te."date"::date = ${todayStr}::date
          ${orgCond}
        UNION
        SELECT tcs."user_id" as worker_id
        FROM "time_clock_shifts" tcs
        JOIN "users" u ON tcs."user_id" = u."id"
        WHERE (tcs."clock_in"::date = ${todayStr}::date OR tcs."clock_out" IS NULL)
          ${orgCond}
      ) active_workers
    `);
    const activeWorkers = (activeResult.rows[0] as any)?.count || 0;

    // Overtime % and labor cost from today's time entries (scoped by user org)
    const hoursResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(te."hours_regular"::numeric), 0) as total_regular,
        COALESCE(SUM(te."hours_overtime"::numeric), 0) as total_overtime,
        COALESCE(SUM(
          te."hours_regular"::numeric * COALESCE(u."cost_rate_regular"::numeric, 50)
          + te."hours_overtime"::numeric * COALESCE(u."cost_rate_overtime"::numeric, 75)
        ), 0) as labor_cost
      FROM "time_entries" te
      JOIN "users" u ON te."user_id" = u."id"
      WHERE te."date"::date = ${todayStr}::date
        ${orgCond}
    `);
    const totalRegular = parseFloat((hoursResult.rows[0] as any)?.total_regular) || 0;
    const totalOvertime = parseFloat((hoursResult.rows[0] as any)?.total_overtime) || 0;
    const laborCostToday = parseFloat((hoursResult.rows[0] as any)?.labor_cost) || 0;
    const totalHours = totalRegular + totalOvertime;
    const overtimePercent = totalHours > 0 ? (totalOvertime / totalHours) * 100 : 0;

    const absentWorkers = Math.max(0, totalWorkers - activeWorkers);

    res.json({
      activeWorkers,
      totalWorkers,
      overtimePercent: Math.round(overtimePercent * 10) / 10,
      laborCostToday: Math.round(laborCostToday * 100) / 100,
      absentWorkers,
    });
  } catch (error) {
    console.error("Workforce snapshot error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Cash Position Widget
// ====================

router.get("/api/dashboard/cash-position", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ accountsReceivable: 0, accountsPayable: 0, payrollLiability: 0, netCashFlow: 0 });
    }

    const orgCond = shouldFilter && orgId ? sql`AND i."organization_id" = ${orgId}` : sql``;
    const projOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
    const payOrgCond = shouldFilter && orgId ? sql`AND sp."organization_id" = ${orgId}` : sql``;
    const prOrgCond = shouldFilter && orgId ? sql`AND pr."organization_id" = ${orgId}` : sql``;

    // 1. Accounts Receivable: outstanding T&M invoices (SENT but not PAID/VOID)
    let accountsReceivable = 0;
    try {
      const arResult = await db.execute(sql`
        SELECT COALESCE(SUM(i."total"::numeric), 0) as total
        FROM "tm_invoices" i
        WHERE i."status"::text = 'SENT'
          ${orgCond}
      `);
      accountsReceivable = parseFloat((arResult.rows[0] as any)?.total) || 0;
    } catch (e) {
      console.error("Cash position: AR error:", e);
    }

    // 2. Accounts Payable: unpaid subcontractor payments + committed procurement costs
    let accountsPayable = 0;
    try {
      const subPayResult = await db.execute(sql`
        SELECT COALESCE(SUM(sp."amount"::numeric), 0) as total
        FROM "subcontractor_payments" sp
        WHERE sp."status" IN ('PENDING', 'APPROVED')
          ${payOrgCond}
      `);
      accountsPayable += parseFloat((subPayResult.rows[0] as any)?.total) || 0;

      const procResult = await db.execute(sql`
        SELECT COALESCE(SUM(pi."quantity"::numeric * pi."unit_cost"::numeric), 0) as total
        FROM "procurement_items" pi
        JOIN "projects" p ON pi."project_id" = p."id"
        WHERE pi."status"::text IN ('ORDERED', 'DELIVERED')
          ${projOrgCond}
      `);
      accountsPayable += parseFloat((procResult.rows[0] as any)?.total) || 0;
    } catch (e) {
      console.error("Cash position: AP error:", e);
    }

    // 3. Payroll Liability: unpaid pay runs
    let payrollLiability = 0;
    try {
      const payrollResult = await db.execute(sql`
        SELECT COALESCE(SUM(pr."total_labor_cost"::numeric), 0) as total
        FROM "pay_runs" pr
        WHERE pr."status"::text IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING')
          ${prOrgCond}
      `);
      payrollLiability = parseFloat((payrollResult.rows[0] as any)?.total) || 0;
    } catch (e) {
      console.error("Cash position: payroll error:", e);
    }

    const netCashFlow = accountsReceivable - accountsPayable - payrollLiability;

    res.json({
      accountsReceivable: Math.round(accountsReceivable * 100) / 100,
      accountsPayable: Math.round(accountsPayable * 100) / 100,
      payrollLiability: Math.round(payrollLiability * 100) / 100,
      netCashFlow: Math.round(netCashFlow * 100) / 100,
    });
  } catch (error) {
    console.error("Cash position error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
