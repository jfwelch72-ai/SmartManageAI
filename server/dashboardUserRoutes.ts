import { Router } from "express";
import { db } from "./db";
import { users, insertUserSchema, projects, changeOrders, calendarEvents, projectDelays, bids, organizations, timeEntries, payRuns, subcontractorContracts, crmOrganisations, organizationDocuments, subcontractorPayments, subcontractorBillingSchedule, procurementItems, scheduleOfValues, sovLineItems, estimates, estimateLineItems, rfis, safetyTrainings, safetyTrainingAssignments } from "@shared/schema";
import { requireAuth, requireRole, requireRoleOrFeature, hashPassword, verifyPassword, revokeUserTokens, type AuthRequest } from "./auth";
import { eq, and, sql, gte, lte, desc, asc } from "drizzle-orm";
import { z } from "zod";
import { sensitiveLimiter } from "./rateLimiter";
import { logAudit } from "./auditLogger";
import { sanitizeShortText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { getOrgIdForFilter, verifyUserOrgAccess } from "./orgFilter";
import { orgScopedCache } from "./cache";

const DASHBOARD_CACHE_TTL = 60_000;

const router = Router();

// ====================
// Dashboard Routes
// ====================

// Get dashboard statistics
router.get("/api/dashboard/stats", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, isSuperAdmin: isSuperAdminUser, mustDenyAccess } = getOrgIdForFilter(req);
    
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

    const result = await orgScopedCache(orgId, "dashboard:stats", DASHBOARD_CACHE_TTL, async () => {
      const orgCondition = shouldFilter && orgId 
        ? eq(projects.gcOrganizationId, orgId) 
        : sql`true`;

      const activeProjectsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(and(eq(projects.status, "ACTIVE"), orgCondition));
      const activeProjectsCount = activeProjectsResult[0]?.count || 0;

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

      return {
        activeProjectsCount,
        pendingChangeOrdersCount,
        pendingTimeOffCount,
        activeDelaysCount,
        delaysNeedingAckCount,
        delaysNeedingChangeOrderCount,
      };
    });

    res.json(result);
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
        const rfiOrgFilter = shouldFilter && orgId ? eq(rfis.organizationId, orgId) : sql`true`;
        const result = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(rfis)
          .where(and(sql`${rfis.status} IN ('SUBMITTED', 'UNDER_REVIEW')`, rfiOrgFilter));
        value = result[0]?.count || 0;
        const prevResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(rfis)
          .where(and(
            sql`${rfis.status} IN ('ANSWERED', 'CLOSED')`,
            sql`${rfis.dateAnswered} >= ${prevStart.toISOString()}::timestamp`,
            sql`${rfis.dateAnswered} < ${periodStart.toISOString()}::timestamp`,
            rfiOrgFilter
          ));
        previousValue = prevResult[0]?.count || 0;
        isEstimated = false;
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
        const revOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const revTmOrgCond = shouldFilter && orgId ? sql`AND i."organization_id" = ${orgId}` : sql``;
        const revResult = await db.execute(sql`
          SELECT
            COALESCE((
              SELECT SUM(sli."this_period_completed"::numeric)
              FROM "sov_line_items" sli
              JOIN "schedule_of_values" sov ON sli."sov_id" = sov."id"
              JOIN "projects" p ON sov."project_id" = p."id"
              WHERE sli."updated_at" >= ${periodStart.toISOString()}::timestamp
                AND sli."updated_at" < ${periodEnd.toISOString()}::timestamp
                ${revOrgCond}
            ), 0) +
            COALESCE((
              SELECT SUM(i."total"::numeric)
              FROM "tm_invoices" i
              WHERE i."status"::text IN ('SENT', 'PAID')
                AND i."created_at" >= ${periodStart.toISOString()}::timestamp
                AND i."created_at" < ${periodEnd.toISOString()}::timestamp
                ${revTmOrgCond}
            ), 0) as total
        `);
        value = parseFloat((revResult.rows[0] as any)?.total || "0");
        const prevRevResult = await db.execute(sql`
          SELECT
            COALESCE((
              SELECT SUM(sli."this_period_completed"::numeric)
              FROM "sov_line_items" sli
              JOIN "schedule_of_values" sov ON sli."sov_id" = sov."id"
              JOIN "projects" p ON sov."project_id" = p."id"
              WHERE sli."updated_at" >= ${prevStart.toISOString()}::timestamp
                AND sli."updated_at" < ${prevEnd.toISOString()}::timestamp
                ${revOrgCond}
            ), 0) +
            COALESCE((
              SELECT SUM(i."total"::numeric)
              FROM "tm_invoices" i
              WHERE i."status"::text IN ('SENT', 'PAID')
                AND i."created_at" >= ${prevStart.toISOString()}::timestamp
                AND i."created_at" < ${prevEnd.toISOString()}::timestamp
                ${revTmOrgCond}
            ), 0) as total
        `);
        previousValue = parseFloat((prevRevResult.rows[0] as any)?.total || "0");
        isEstimated = false;
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
        const gmOrgCond = shouldFilter && orgId ? sql`AND pps."organization_id" = ${orgId}` : sql``;
        // Use the latest profitability snapshot per project to compute org-wide margin
        const gmResult = await db.execute(sql`
          WITH latest_snapshots AS (
            SELECT DISTINCT ON (pps."project_id")
              pps."adjusted_budget"::numeric as adjusted_budget,
              pps."total_actual_cost"::numeric as total_actual_cost,
              pps."estimated_margin"::numeric as estimated_margin
            FROM "project_profitability_snapshots" pps
            WHERE 1=1 ${gmOrgCond}
            ORDER BY pps."project_id", pps."created_at" DESC
          )
          SELECT
            COALESCE(SUM(adjusted_budget), 0) as total_budget,
            COALESCE(SUM(total_actual_cost), 0) as total_cost,
            COALESCE(SUM(estimated_margin), 0) as total_margin
          FROM latest_snapshots
        `);
        const totalBudget = parseFloat((gmResult.rows[0] as any)?.total_budget || "0");
        const totalCost = parseFloat((gmResult.rows[0] as any)?.total_cost || "0");
        // Derive margin directly from contract (adjusted budget) minus actual cost for accuracy
        value = totalBudget > 0 ? Math.round(((totalBudget - totalCost) / totalBudget) * 100) : 0;

        // Previous period: snapshots created in the previous month window
        const prevGmOrgCond = shouldFilter && orgId ? sql`AND pps."organization_id" = ${orgId}` : sql``;
        const prevGmResult = await db.execute(sql`
          WITH prev_latest AS (
            SELECT DISTINCT ON (pps."project_id")
              pps."adjusted_budget"::numeric as adjusted_budget,
              pps."total_actual_cost"::numeric as total_actual_cost,
              pps."estimated_margin"::numeric as estimated_margin
            FROM "project_profitability_snapshots" pps
            WHERE pps."created_at" < ${prevEnd.toISOString()}::timestamp
              ${prevGmOrgCond}
            ORDER BY pps."project_id", pps."created_at" DESC
          )
          SELECT
            COALESCE(SUM(adjusted_budget), 0) as total_budget,
            COALESCE(SUM(total_actual_cost), 0) as total_cost
          FROM prev_latest
        `);
        const prevBudget = parseFloat((prevGmResult.rows[0] as any)?.total_budget || "0");
        const prevCost = parseFloat((prevGmResult.rows[0] as any)?.total_cost || "0");
        previousValue = prevBudget > 0 ? Math.round(((prevBudget - prevCost) / prevBudget) * 100) : 0;
        isEstimated = false;
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

    if (email !== undefined || password !== undefined || isActive === false) {
      updateData.tokenVersion = sql`COALESCE(${users.tokenVersion}, 0) + 1`;
    }
    
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

router.post("/api/auth/set-initial-password", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      password: z.string().min(8, "Password must be at least 8 characters"),
    });

    const data = schema.parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const accountAge = Date.now() - new Date(user.createdAt!).getTime();
    if (accountAge > 24 * 60 * 60 * 1000) {
      return res.status(403).json({ error: "Initial password setup window has expired. Use change password instead." });
    }

    const newPasswordHash = await hashPassword(data.password);

    await db
      .update(users)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    res.json({ success: true, message: "Password set successfully" });
  } catch (error) {
    console.error("Set initial password error:", error);
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

    const trendCacheKey = `dashboard:trend:${metric}:${period}:${groupBy}`;
    const trendResult = await orgScopedCache(orgId, trendCacheKey, DASHBOARD_CACHE_TTL, async () => {

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

    return { points, metric, period, groupBy };
    });

    res.json(trendResult);
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

    const alertsResult = await orgScopedCache(orgId, "dashboard:alerts", DASHBOARD_CACHE_TTL, async () => {
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

    return { alerts, counts };
    });

    res.json(alertsResult);
  } catch (error) {
    console.error("Alerts endpoint error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Workforce Snapshot Widget
// ====================

router.get("/api/dashboard/workforce-snapshot", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER", "HR_MANAGER"], "canManagePayroll"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ activeWorkers: 0, totalWorkers: 0, overtimePercent: 0, laborCostToday: 0, absentWorkers: 0 });
    }

    const wfResult = await orgScopedCache(orgId, "dashboard:workforce-snapshot", DASHBOARD_CACHE_TTL, async () => {
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

    return {
      activeWorkers,
      totalWorkers,
      overtimePercent: Math.round(overtimePercent * 10) / 10,
      laborCostToday: Math.round(laborCostToday * 100) / 100,
      absentWorkers,
    };
    });

    res.json(wfResult);
  } catch (error) {
    console.error("Workforce snapshot error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Cash Position Widget
// ====================

router.get("/api/dashboard/cash-position", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER"], "canAccessFinancials"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ accountsReceivable: 0, accountsPayable: 0, payrollLiability: 0, netCashFlow: 0 });
    }

    const cpResult = await orgScopedCache(orgId, "dashboard:cash-position", DASHBOARD_CACHE_TTL, async () => {
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

    return {
      accountsReceivable: Math.round(accountsReceivable * 100) / 100,
      accountsPayable: Math.round(accountsPayable * 100) / 100,
      payrollLiability: Math.round(payrollLiability * 100) / 100,
      netCashFlow: Math.round(netCashFlow * 100) / 100,
    };
    });

    res.json(cpResult);
  } catch (error) {
    console.error("Cash position error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// SOV Progress Widget
// ====================

router.get("/api/dashboard/sov-progress", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER"], "canAccessFinancials"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({
        billedPercent: 0,
        completePercent: 0,
        totalScheduledValue: 0,
        totalCompletedToDate: 0,
        totalBilled: 0,
        laborCost: 0,
        sovValue: 0,
        laborToSovPercent: 0,
        retainageHeld: 0,
        avgRetainagePercent: 0,
        projects: [],
      });
    }

    const orgCond = shouldFilter && orgId ? sql`AND s."organization_id" = ${orgId}` : sql``;

    // 1. Aggregate SOV totals (% billed vs % complete)
    let billedPercent = 0;
    let completePercent = 0;
    let totalScheduledValue = 0;
    let totalCompletedToDate = 0;
    let totalBilled = 0;

    try {
      const sovTotals = await db.execute(sql`
        SELECT
          COALESCE(SUM(s."total_scheduled_value"::numeric), 0) as scheduled_value,
          COALESCE(SUM(s."total_completed_to_date"::numeric), 0) as completed_to_date,
          COALESCE(SUM(COALESCE(s."total_previously_completed"::numeric, 0) + COALESCE(s."total_this_period"::numeric, 0)), 0) as total_billed
        FROM "schedule_of_values" s
        WHERE s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
          ${orgCond}
      `);
      const row = sovTotals.rows[0] as any;
      totalScheduledValue = parseFloat(row?.scheduled_value) || 0;
      totalCompletedToDate = parseFloat(row?.completed_to_date) || 0;
      totalBilled = parseFloat(row?.total_billed) || 0;

      if (totalScheduledValue > 0) {
        completePercent = Math.round((totalCompletedToDate / totalScheduledValue) * 10000) / 100;
        billedPercent = Math.round((totalBilled / totalScheduledValue) * 10000) / 100;
      }
    } catch (e) {
      console.error("SOV progress: totals error:", e);
    }

    // 2. Per-project breakdown (top 5 active projects with SOVs)
    let projectBreakdown: Array<{ name: string; billedPercent: number; completePercent: number }> = [];
    try {
      const projResult = await db.execute(sql`
        SELECT
          p."name" as project_name,
          COALESCE(SUM(s."total_scheduled_value"::numeric), 0) as scheduled_value,
          COALESCE(SUM(s."total_completed_to_date"::numeric), 0) as completed_to_date,
          COALESCE(SUM(COALESCE(s."total_previously_completed"::numeric, 0) + COALESCE(s."total_this_period"::numeric, 0)), 0) as total_billed
        FROM "schedule_of_values" s
        JOIN "projects" p ON s."project_id" = p."id"
        WHERE s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
          ${orgCond}
        GROUP BY p."id", p."name"
        HAVING SUM(s."total_scheduled_value"::numeric) > 0
        ORDER BY SUM(s."total_scheduled_value"::numeric) DESC
        LIMIT 5
      `);
      projectBreakdown = (projResult.rows as any[]).map((r) => {
        const sv = parseFloat(r.scheduled_value) || 0;
        return {
          name: r.project_name || "Unnamed Project",
          billedPercent: sv > 0 ? Math.round((parseFloat(r.total_billed) / sv) * 10000) / 100 : 0,
          completePercent: sv > 0 ? Math.round((parseFloat(r.completed_to_date) / sv) * 10000) / 100 : 0,
        };
      });
    } catch (e) {
      console.error("SOV progress: project breakdown error:", e);
    }

    // 3. Labor cost vs SOV value
    let laborCost = 0;
    let sovValue = totalScheduledValue;
    let laborToSovPercent = 0;
    try {
      const laborResult = await db.execute(sql`
        SELECT COALESCE(SUM(
          (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
          COALESCE(u."cost_rate"::numeric, 50)
        ), 0) as labor_cost
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        WHERE EXISTS (
          SELECT 1 FROM "schedule_of_values" s
          WHERE s."project_id" = te."project_id"
            AND s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
            ${orgCond}
        )
      `);
      laborCost = parseFloat((laborResult.rows[0] as any)?.labor_cost) || 0;
      if (sovValue > 0) {
        laborToSovPercent = Math.round((laborCost / sovValue) * 10000) / 100;
      }
    } catch (e) {
      console.error("SOV progress: labor cost error:", e);
    }

    // 4. Retainage held
    let retainageHeld = 0;
    let avgRetainagePercent = 0;
    try {
      const retResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(s."total_retainage"::numeric), 0) as retainage_held,
          CASE
            WHEN COUNT(*) > 0 THEN COALESCE(AVG(s."retainage_percent"::numeric), 0)
            ELSE 0
          END as avg_retainage_percent
        FROM "schedule_of_values" s
        WHERE s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
          ${orgCond}
      `);
      const retRow = retResult.rows[0] as any;
      retainageHeld = parseFloat(retRow?.retainage_held) || 0;
      avgRetainagePercent = Math.round((parseFloat(retRow?.avg_retainage_percent) || 0) * 100) / 100;
    } catch (e) {
      console.error("SOV progress: retainage error:", e);
    }

    res.json({
      billedPercent,
      completePercent,
      totalScheduledValue: Math.round(totalScheduledValue * 100) / 100,
      totalCompletedToDate: Math.round(totalCompletedToDate * 100) / 100,
      totalBilled: Math.round(totalBilled * 100) / 100,
      laborCost: Math.round(laborCost * 100) / 100,
      sovValue: Math.round(sovValue * 100) / 100,
      laborToSovPercent,
      retainageHeld: Math.round(retainageHeld * 100) / 100,
      avgRetainagePercent,
      projects: projectBreakdown,
    });
  } catch (error) {
    console.error("SOV progress error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Bid Pipeline Widget
// ====================

router.get("/api/dashboard/bid-pipeline", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ activeBids: 0, pipelineValue: 0, winRate: 0, laborExposure: 0, awardedCount: 0, lostCount: 0 });
    }

    const bpResult = await orgScopedCache(orgId, "dashboard:bid-pipeline", DASHBOARD_CACHE_TTL, async () => {
    const orgCond = shouldFilter && orgId ? sql`AND b."gc_organization_id" = ${orgId}` : sql``;

    let activeBids = 0;
    let pipelineValue = 0;
    let winRate = 0;
    let laborExposure = 0;
    let awardedCount = 0;
    let lostCount = 0;

    try {
      const activeResult = await db.execute(sql`
        SELECT
          COUNT(*) as active_count,
          COALESCE(SUM(b."bid_amount"::numeric), 0) as pipeline_value
        FROM "bids" b
        WHERE b."status"::text = 'ACTIVE'
          ${orgCond}
      `);
      const row = activeResult.rows[0] as any;
      activeBids = parseInt(row?.active_count) || 0;
      pipelineValue = parseFloat(row?.pipeline_value) || 0;
    } catch (e) {
      console.error("Bid pipeline: active bids error:", e);
    }

    try {
      const rateResult = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE b."status"::text = 'AWARDED') as awarded,
          COUNT(*) FILTER (WHERE b."status"::text = 'LOST') as lost
        FROM "bids" b
        WHERE b."status"::text IN ('AWARDED', 'LOST')
          ${orgCond}
      `);
      const row = rateResult.rows[0] as any;
      awardedCount = parseInt(row?.awarded) || 0;
      lostCount = parseInt(row?.lost) || 0;
      const total = awardedCount + lostCount;
      if (total > 0) {
        winRate = Math.round((awardedCount / total) * 10000) / 100;
      }
    } catch (e) {
      console.error("Bid pipeline: win rate error:", e);
    }

    try {
      const laborResult = await db.execute(sql`
        SELECT COALESCE(SUM(eli."labor_cost"::numeric), 0) as labor_exposure
        FROM "estimate_line_items" eli
        JOIN "estimates" e ON eli."estimate_id" = e."id"
        JOIN "bids" b ON e."bid_id" = b."id"
        WHERE b."status"::text = 'ACTIVE'
          ${orgCond}
      `);
      laborExposure = parseFloat((laborResult.rows[0] as any)?.labor_exposure) || 0;
    } catch (e) {
      console.error("Bid pipeline: labor exposure error:", e);
    }

    return {
      activeBids,
      pipelineValue: Math.round(pipelineValue * 100) / 100,
      winRate,
      laborExposure: Math.round(laborExposure * 100) / 100,
      awardedCount,
      lostCount,
    };
    });

    res.json(bpResult);
  } catch (error) {
    console.error("Bid pipeline error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================
// Cost Code Breakdown Widget
// ============================

router.get("/api/dashboard/cost-code-breakdown", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER"], "canAccessFinancials"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ items: [], totalLaborCost: 0, totalBudgeted: 0, totalActual: 0 });
    }

    const mode = (req.query.mode as string) || "labor";
    const projectId = req.query.projectId as string | undefined;
    const groupByDivision = req.query.groupByDivision === "true";

    const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
    const projectCond = projectId ? sql`AND te."project_id" = ${projectId}` : sql``;

    if (mode === "budget_vs_actual") {
      let items: Array<{ costCode: string; budgeted: number; actual: number }> = [];
      let totalBudgeted = 0;
      let totalActual = 0;

      try {
        const budgetProjectCond = projectId
          ? (shouldFilter && orgId
            ? sql`AND e."project_id" = ${projectId} AND EXISTS (SELECT 1 FROM "projects" pp WHERE pp."id" = ${projectId} AND pp."gc_organization_id" = ${orgId})`
            : sql`AND e."project_id" = ${projectId}`)
          : sql``;
        const budgetOrgCond = (!projectId && shouldFilter && orgId)
          ? sql`AND (
              (e."project_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "projects" pp WHERE pp."id" = e."project_id" AND pp."gc_organization_id" = ${orgId}))
              OR (e."bid_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "bids" bb WHERE bb."id" = e."bid_id" AND bb."gc_organization_id" = ${orgId}))
            )`
          : sql``;

        const budgetGroupExpr = groupByDivision
          ? sql`COALESCE('Division ' || SPLIT_PART(SPLIT_PART(COALESCE(NULLIF(TRIM(eli."work_type_code"), ''), NULLIF(TRIM(eli."category"), ''), ''), ' - ', 1), '-', 1), 'Unassigned')`
          : sql`COALESCE(UPPER(TRIM(SPLIT_PART(COALESCE(NULLIF(TRIM(eli."work_type_code"), ''), NULLIF(TRIM(eli."category"), '')), ' - ', 1))), 'Unassigned')`;

        const budgetResult = await db.execute(sql`
          SELECT
            ${budgetGroupExpr} as cost_code,
            SUM(eli."labor_cost"::numeric) as budgeted
          FROM "estimate_line_items" eli
          JOIN "estimates" e ON eli."estimate_id" = e."id"
          WHERE eli."labor_cost"::numeric > 0
            ${budgetProjectCond}
            ${budgetOrgCond}
          GROUP BY ${budgetGroupExpr}
          ORDER BY SUM(eli."labor_cost"::numeric) DESC
          LIMIT 10
        `);

        const budgetMap = new Map<string, number>();
        for (const row of budgetResult.rows as any[]) {
          budgetMap.set(row.cost_code, parseFloat(row.budgeted) || 0);
          totalBudgeted += parseFloat(row.budgeted) || 0;
        }

        const actualGroupExpr = groupByDivision
          ? sql`COALESCE('Division ' || SPLIT_PART(SPLIT_PART(COALESCE(te."cost_code", ''), ' - ', 1), '-', 1), 'Unassigned')`
          : sql`COALESCE(UPPER(NULLIF(TRIM(SPLIT_PART(te."cost_code", ' - ', 1)), '')), 'Unassigned')`;

        const actualResult = await db.execute(sql`
          SELECT
            ${actualGroupExpr} as cost_code,
            SUM(
              (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
              COALESCE(u."cost_rate_regular"::numeric, 50)
            ) as actual
          FROM "time_entries" te
          JOIN "users" u ON te."user_id" = u."id"
          JOIN "projects" p ON te."project_id" = p."id"
          WHERE 1=1
            ${orgCond}
            ${projectCond}
          GROUP BY ${actualGroupExpr}
          ORDER BY SUM(
            (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
            COALESCE(u."cost_rate_regular"::numeric, 50)
          ) DESC
          LIMIT 10
        `);

        const allCodes = new Set<string>();
        const actualMap = new Map<string, number>();
        for (const row of actualResult.rows as any[]) {
          actualMap.set(row.cost_code, parseFloat(row.actual) || 0);
          totalActual += parseFloat(row.actual) || 0;
          allCodes.add(row.cost_code);
        }
        for (const code of budgetMap.keys()) {
          allCodes.add(code);
        }

        items = Array.from(allCodes).map(code => ({
          costCode: code,
          budgeted: Math.round((budgetMap.get(code) || 0) * 100) / 100,
          actual: Math.round((actualMap.get(code) || 0) * 100) / 100,
        })).sort((a, b) => Math.max(b.budgeted, b.actual) - Math.max(a.budgeted, a.actual)).slice(0, 10);
      } catch (e) {
        console.error("Cost code breakdown: budget vs actual error:", e);
      }

      return res.json({
        items,
        totalBudgeted: Math.round(totalBudgeted * 100) / 100,
        totalActual: Math.round(totalActual * 100) / 100,
        totalLaborCost: 0,
      });
    }

    // Default: labor mode
    let items: Array<{ costCode: string; laborCost: number; hours: number }> = [];
    let totalLaborCost = 0;

    try {
      const groupExpr = groupByDivision
        ? sql`COALESCE('Division ' || SPLIT_PART(SPLIT_PART(COALESCE(te."cost_code", ''), ' - ', 1), '-', 1), 'Unassigned')`
        : sql`COALESCE(te."cost_code", 'Unassigned')`;

      const result = await db.execute(sql`
        SELECT
          ${groupExpr} as cost_code,
          SUM(
            (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
            COALESCE(u."cost_rate_regular"::numeric, 50)
          ) as labor_cost,
          SUM(te."hours_regular"::numeric + te."hours_overtime"::numeric) as total_hours
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        JOIN "projects" p ON te."project_id" = p."id"
        WHERE 1=1
          ${orgCond}
          ${projectCond}
        GROUP BY ${groupExpr}
        ORDER BY SUM(
          (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
          COALESCE(u."cost_rate_regular"::numeric, 50)
        ) DESC
      `);

      const rows = result.rows as any[];
      const top10 = rows.slice(0, 10);
      const rest = rows.slice(10);

      for (const row of top10) {
        const cost = parseFloat(row.labor_cost) || 0;
        items.push({
          costCode: row.cost_code,
          laborCost: Math.round(cost * 100) / 100,
          hours: Math.round((parseFloat(row.total_hours) || 0) * 100) / 100,
        });
        totalLaborCost += cost;
      }

      if (rest.length > 0) {
        let otherCost = 0;
        let otherHours = 0;
        for (const row of rest) {
          otherCost += parseFloat(row.labor_cost) || 0;
          otherHours += parseFloat(row.total_hours) || 0;
        }
        items.push({
          costCode: "Other",
          laborCost: Math.round(otherCost * 100) / 100,
          hours: Math.round(otherHours * 100) / 100,
        });
        totalLaborCost += otherCost;
      }
    } catch (e) {
      console.error("Cost code breakdown: labor error:", e);
    }

    res.json({
      items,
      totalLaborCost: Math.round(totalLaborCost * 100) / 100,
      totalBudgeted: 0,
      totalActual: 0,
    });
  } catch (error) {
    console.error("Cost code breakdown error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================
// Schedule Impact Widget
// ============================

router.get("/api/dashboard/schedule-impact", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({
        dailyAllocation: [],
        projectForecast: [],
        conflicts: [],
        summary: { totalAssignedNext7Days: 0, peakDay: null, peakWorkers: 0, conflictCount: 0 },
      });
    }

    const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 6);
    const endStr = endDate.toISOString().split("T")[0];

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const next7Days: Array<{ date: string; dayLabel: string }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      next7Days.push({
        date: d.toISOString().split("T")[0],
        dayLabel: dayLabels[d.getDay()],
      });
    }

    // 1. Daily Allocation - workers assigned per day via crew_project_assignments
    let dailyAllocation: Array<{ date: string; dayLabel: string; assignedWorkers: number; projectCount: number }> = [];

    try {
      const dailyResult = await db.execute(sql`
        SELECT
          d.day::date as day_date,
          COUNT(DISTINCT cm."user_id") as worker_count,
          COUNT(DISTINCT cpa."project_id") as project_count
        FROM generate_series(${todayStr}::date, ${endStr}::date, '1 day'::interval) AS d(day)
        LEFT JOIN "crew_project_assignments" cpa
          ON (cpa."start_date"::date <= d.day::date AND (cpa."end_date"::date >= d.day::date OR cpa."end_date" IS NULL))
        LEFT JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        LEFT JOIN "projects" p ON cpa."project_id" = p."id"
        WHERE 1=1 ${orgCond}
        GROUP BY d.day::date
        ORDER BY d.day::date
      `);

      const dailyMap = new Map<string, { workers: number; projects: number }>();
      for (const row of dailyResult.rows as any[]) {
        const dateKey = new Date(row.day_date).toISOString().split("T")[0];
        dailyMap.set(dateKey, {
          workers: parseInt(row.worker_count) || 0,
          projects: parseInt(row.project_count) || 0,
        });
      }

      dailyAllocation = next7Days.map(d => ({
        date: d.date,
        dayLabel: d.dayLabel,
        assignedWorkers: dailyMap.get(d.date)?.workers || 0,
        projectCount: dailyMap.get(d.date)?.projects || 0,
      }));
    } catch (e) {
      console.error("Schedule impact: daily allocation error:", e);
      dailyAllocation = next7Days.map(d => ({ date: d.date, dayLabel: d.dayLabel, assignedWorkers: 0, projectCount: 0 }));
    }

    // 2. Project Forecast - top 5 projects by worker count
    let projectForecast: Array<{ projectId: string; projectName: string; crewCount: number; workerCount: number; startDate: string | null; endDate: string | null }> = [];

    try {
      const forecastResult = await db.execute(sql`
        SELECT
          p."id" as project_id,
          p."name" as project_name,
          COUNT(DISTINCT cpa."crew_id") as crew_count,
          COUNT(DISTINCT cm."user_id") as worker_count,
          MIN(cpa."start_date")::text as start_date,
          MAX(cpa."end_date")::text as end_date
        FROM "crew_project_assignments" cpa
        JOIN "projects" p ON cpa."project_id" = p."id"
        LEFT JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        WHERE (cpa."start_date"::date <= ${endStr}::date OR cpa."start_date" IS NULL)
          AND (cpa."end_date"::date >= ${todayStr}::date OR cpa."end_date" IS NULL)
          ${orgCond}
        GROUP BY p."id", p."name"
        ORDER BY COUNT(DISTINCT cm."user_id") DESC
        LIMIT 5
      `);

      projectForecast = (forecastResult.rows as any[]).map(row => ({
        projectId: row.project_id,
        projectName: row.project_name,
        crewCount: parseInt(row.crew_count) || 0,
        workerCount: parseInt(row.worker_count) || 0,
        startDate: row.start_date ? row.start_date.split("T")[0] : null,
        endDate: row.end_date ? row.end_date.split("T")[0] : null,
      }));
    } catch (e) {
      console.error("Schedule impact: project forecast error:", e);
    }

    // 3. Conflicts - workers assigned to multiple projects on same day
    let conflicts: Array<{ userId: string; userName: string; date: string; projects: string[] }> = [];
    let conflictCount = 0;

    try {
      const conflictCountResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM (
          SELECT cm."user_id", d.day::date
          FROM generate_series(${todayStr}::date, ${endStr}::date, '1 day'::interval) AS d(day)
          JOIN "crew_project_assignments" cpa
            ON (cpa."start_date"::date <= d.day::date AND (cpa."end_date"::date >= d.day::date OR cpa."end_date" IS NULL))
          JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
          JOIN "projects" p ON cpa."project_id" = p."id"
          WHERE 1=1 ${orgCond}
          GROUP BY cm."user_id", d.day::date
          HAVING COUNT(DISTINCT cpa."project_id") > 1
        ) conflicts_sub
      `);
      conflictCount = parseInt((conflictCountResult.rows as any[])[0]?.total) || 0;

      const conflictResult = await db.execute(sql`
        SELECT
          cm."user_id",
          u."full_name" as user_name,
          d.day::date as conflict_date,
          array_agg(DISTINCT p."name") as project_names
        FROM generate_series(${todayStr}::date, ${endStr}::date, '1 day'::interval) AS d(day)
        JOIN "crew_project_assignments" cpa
          ON (cpa."start_date"::date <= d.day::date AND (cpa."end_date"::date >= d.day::date OR cpa."end_date" IS NULL))
        JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        JOIN "projects" p ON cpa."project_id" = p."id"
        JOIN "users" u ON cm."user_id" = u."id"
        WHERE 1=1 ${orgCond}
        GROUP BY cm."user_id", u."full_name", d.day::date
        HAVING COUNT(DISTINCT cpa."project_id") > 1
        ORDER BY d.day::date, u."full_name"
        LIMIT 10
      `);

      conflicts = (conflictResult.rows as any[]).map(row => ({
        userId: row.user_id,
        userName: row.user_name || "Unknown",
        date: new Date(row.conflict_date).toISOString().split("T")[0],
        projects: row.project_names || [],
      }));
    } catch (e) {
      console.error("Schedule impact: conflicts error:", e);
    }

    // Unique workers across the 7-day window
    let totalUniqueWorkers = 0;
    try {
      const uniqueResult = await db.execute(sql`
        SELECT COUNT(DISTINCT cm."user_id")::int as total
        FROM "crew_project_assignments" cpa
        JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        JOIN "projects" p ON cpa."project_id" = p."id"
        WHERE (cpa."start_date"::date <= ${endStr}::date OR cpa."start_date" IS NULL)
          AND (cpa."end_date"::date >= ${todayStr}::date OR cpa."end_date" IS NULL)
          ${orgCond}
      `);
      totalUniqueWorkers = parseInt((uniqueResult.rows as any[])[0]?.total) || 0;
    } catch (e) {
      console.error("Schedule impact: unique workers error:", e);
    }

    // Summary
    let peakDay: string | null = null;
    let peakWorkers = 0;

    for (const day of dailyAllocation) {
      if (day.assignedWorkers > peakWorkers) {
        peakWorkers = day.assignedWorkers;
        peakDay = day.dayLabel;
      }
    }

    res.json({
      dailyAllocation,
      projectForecast,
      conflicts,
      summary: {
        totalAssignedNext7Days: totalUniqueWorkers,
        peakDay,
        peakWorkers,
        conflictCount,
      },
    });
  } catch (error) {
    console.error("Schedule impact error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Labor Utilization Widget
// ====================
router.get("/api/dashboard/labor-utilization", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER", "HR_MANAGER"], "canManagePayroll"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ utilizedPercent: 0, workedHours: 0, availableHours: 0, billablePercent: 0, sparkline: [] });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const orgCond = shouldFilter && orgId ? sql`AND u."organization_id" = ${orgId}` : sql``;
    const projOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;

    // Total active field workers
    const totalResult = await db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM "users" u
      WHERE u."is_active" = true
        AND u."role" IN ('HOURLY_EMPLOYEE', 'SUPERINTENDENT', 'PROJECT_ENGINEER', 'DISPATCHER', 'EQUIPMENT_MANAGER', 'MAINTENANCE_MANAGER')
        ${orgCond}
    `);
    const totalWorkers = (totalResult.rows[0] as any)?.count || 0;

    // Workers with time entries today (restricted to field-worker roles to match denominator)
    const activeResult = await db.execute(sql`
      SELECT COUNT(DISTINCT te."user_id")::int as count,
             COALESCE(SUM(te."hours_regular"::numeric + te."hours_overtime"::numeric), 0) as worked_hours
      FROM "time_entries" te
      JOIN "users" u ON te."user_id" = u."id"
      WHERE te."date" = ${todayStart.toISOString().split('T')[0]}::date
        AND u."role" IN ('HOURLY_EMPLOYEE', 'SUPERINTENDENT', 'PROJECT_ENGINEER', 'DISPATCHER', 'EQUIPMENT_MANAGER', 'MAINTENANCE_MANAGER')
        AND u."is_active" = true
        ${orgCond}
    `);
    const activeWorkers = (activeResult.rows[0] as any)?.count || 0;
    const workedHours = parseFloat((activeResult.rows[0] as any)?.worked_hours || "0");

    // Worker-based utilization: workers with time entries today / total active field workers * 100
    const utilizedPercent = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

    // Billable hours (time on active projects)
    const billableResult = await db.execute(sql`
      SELECT COALESCE(SUM(te."hours_regular"::numeric + te."hours_overtime"::numeric), 0) as billable_hours
      FROM "time_entries" te
      JOIN "projects" p ON te."project_id" = p."id"
      WHERE te."date" = ${todayStart.toISOString().split('T')[0]}::date
        AND p."status" = 'ACTIVE'
        ${projOrgCond}
    `);
    const billableHours = parseFloat((billableResult.rows[0] as any)?.billable_hours || "0");
    const billablePercent = workedHours > 0 ? Math.round((billableHours / workedHours) * 100) : 0;

    // 7-day sparkline (worker-based: distinct workers per day / total workers)
    const sparkline: { date: string; utilizedPercent: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayDate = new Date(now);
      dayDate.setDate(now.getDate() - i);
      const dayStr = dayDate.toISOString().split('T')[0];
      const dayResult = await db.execute(sql`
        SELECT COUNT(DISTINCT te."user_id")::int as active_workers
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        WHERE te."date" = ${dayStr}::date
          AND u."role" IN ('HOURLY_EMPLOYEE', 'SUPERINTENDENT', 'PROJECT_ENGINEER', 'DISPATCHER', 'EQUIPMENT_MANAGER', 'MAINTENANCE_MANAGER')
          AND u."is_active" = true
          ${orgCond}
      `);
      const dayActive = parseInt((dayResult.rows[0] as any)?.active_workers || "0");
      const dayPct = totalWorkers > 0 ? Math.round((dayActive / totalWorkers) * 100) : 0;
      sparkline.push({ date: dayStr, utilizedPercent: Math.min(dayPct, 100) });
    }

    const availableHours = totalWorkers * 8;
    res.json({ utilizedPercent: Math.min(utilizedPercent, 100), workedHours, availableHours, billablePercent, activeWorkers, totalWorkers, sparkline });
  } catch (error) {
    console.error("Labor utilization error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Safety Summary Widget
// ====================
router.get("/api/dashboard/safety-summary", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SAFETY_MANAGER", "HR_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ overdueCount: 0, dueThisWeekCount: 0, completionRate: 0, overdueItems: [] });
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const orgCond = shouldFilter && orgId ? sql`AND sta."organization_id" = ${orgId}` : sql``;

    // Total assignments and completed
    const totalResult = await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN sta."completed_at" IS NOT NULL THEN 1 END)::int as completed,
        COUNT(CASE WHEN sta."completed_at" IS NULL AND sta."due_date" IS NOT NULL AND sta."due_date"::date < ${todayStr}::date THEN 1 END)::int as overdue,
        COUNT(CASE WHEN sta."completed_at" IS NULL AND sta."due_date" IS NOT NULL AND sta."due_date"::date >= ${todayStr}::date AND sta."due_date"::date <= ${endOfWeek}::date THEN 1 END)::int as due_this_week
      FROM "safety_training_assignments" sta
      WHERE 1=1 ${orgCond}
    `);
    const row = (totalResult.rows[0] as any) || {};
    const total = row.total || 0;
    const completed = row.completed || 0;
    const overdueCount = row.overdue || 0;
    const dueThisWeekCount = row.due_this_week || 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Overdue items with employee name and training title
    const overdueResult = await db.execute(sql`
      SELECT
        sta."id",
        CONCAT(u."first_name", ' ', u."last_name") as employee_name,
        st."title" as training_title,
        sta."due_date",
        ${todayStr}::date - sta."due_date"::date as days_overdue
      FROM "safety_training_assignments" sta
      JOIN "users" u ON sta."employee_id" = u."id"
      JOIN "safety_trainings" st ON sta."training_id" = st."id"
      WHERE sta."completed_at" IS NULL
        AND sta."due_date" IS NOT NULL
        AND sta."due_date"::date < ${todayStr}::date
        ${orgCond}
      ORDER BY sta."due_date" ASC
      LIMIT 5
    `);
    const overdueItems = (overdueResult.rows as any[]).map(r => ({
      id: r.id,
      employeeName: r.employee_name,
      trainingTitle: r.training_title,
      dueDate: r.due_date,
      daysOverdue: parseInt(r.days_overdue) || 0,
    }));

    res.json({ overdueCount, dueThisWeekCount, completionRate, total, completed, overdueItems });
  } catch (error) {
    console.error("Safety summary error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Orders Pending Widget
// ====================
router.get("/api/dashboard/change-orders-pending", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER"], "canAccessFinancials"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ count: 0, totalValue: 0, items: [] });
    }

    const now = new Date();
    const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;

    const summaryResult = await db.execute(sql`
      SELECT
        COUNT(*)::int as count,
        COALESCE(SUM(co."amount"::numeric), 0) as total_value
      FROM "change_orders" co
      JOIN "projects" p ON co."project_id" = p."id"
      WHERE co."status"::text = 'SUBMITTED'
        ${orgCond}
    `);
    const count = (summaryResult.rows[0] as any)?.count || 0;
    const totalValue = parseFloat((summaryResult.rows[0] as any)?.total_value || "0");

    const itemsResult = await db.execute(sql`
      SELECT
        co."id",
        co."change_order_number",
        co."description",
        co."amount",
        co."created_at",
        p."name" as project_name,
        ${now.toISOString()}::timestamp - co."created_at" as age_interval
      FROM "change_orders" co
      JOIN "projects" p ON co."project_id" = p."id"
      WHERE co."status"::text = 'SUBMITTED'
        ${orgCond}
      ORDER BY co."created_at" DESC
      LIMIT 5
    `);

    const items = (itemsResult.rows as any[]).map(r => ({
      id: r.id,
      coNumber: r.change_order_number,
      description: (r.description || "").substring(0, 60),
      amount: parseFloat(r.amount || "0"),
      projectName: r.project_name,
      daysPending: Math.floor((now.getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }));

    res.json({ count, totalValue, items });
  } catch (error) {
    console.error("Change orders pending error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
