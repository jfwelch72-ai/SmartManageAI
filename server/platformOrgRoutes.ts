import { Router } from "express";
import { db } from "./db";
import { users, organizations, auditLog, projects, bids, timeClockShifts, organizationSowItems, organizationWorkTypes, organizationSubscriptions } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, count, desc, sql, and, gte, lte, isNotNull } from "drizzle-orm";

const router = Router();

function requireSuperAdmin(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Access denied. Platform admin access required." });
  }
  next();
}

router.get("/platform/health", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  const startTime = Date.now();
  const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};

  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1 AS ok`);
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.database = { status: "unhealthy", detail: err.message };
  }

  try {
    const [lastAction] = await db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    checks.backgroundJobs = {
      status: lastAction ? "healthy" : "unknown",
      detail: lastAction
        ? `Last activity: ${lastAction.createdAt?.toISOString()}`
        : "No recent activity recorded",
    };
  } catch (err: any) {
    checks.backgroundJobs = { status: "unhealthy", detail: err.message };
  }

  const uptimeSeconds = Math.floor(process.uptime());
  const memUsage = process.memoryUsage();

  const overall = Object.values(checks).every((c) => c.status === "healthy")
    ? "healthy"
    : Object.values(checks).some((c) => c.status === "unhealthy")
      ? "unhealthy"
      : "degraded";

  res.json({
    status: overall,
    uptimeSeconds,
    memoryUsageMb: Math.round(memUsage.rss / 1024 / 1024),
    responseTimeMs: Date.now() - startTime,
    checks,
  });
});

router.get("/platform/stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const [orgCount] = await db.select({ count: count() }).from(organizations);
    const [userCount] = await db.select({ count: count() }).from(users).where(isNotNull(users.organizationId));
    const [activeUserCount] = await db.select({ count: count() }).from(users).where(and(eq(users.isActive, true), isNotNull(users.organizationId)));
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const [recentOrgs] = await db.select({ count: count() })
      .from(organizations)
      .where(gte(organizations.createdAt, thirtyDaysAgo));

    const orgsByTrade = await db.select({
      tradeType: organizations.tradeType,
      count: count(),
    })
    .from(organizations)
    .groupBy(organizations.tradeType);

    const usersByRole = await db.select({
      role: users.role,
      count: count(),
    })
    .from(users)
    .where(isNotNull(users.organizationId))
    .groupBy(users.role);

    res.json({
      totalOrganizations: orgCount.count,
      totalUsers: userCount.count,
      activeUsers: activeUserCount.count,
      newOrganizationsLast30Days: recentOrgs.count,
      organizationsByTrade: orgsByTrade,
      usersByRole: usersByRole.filter(u => u.role !== "SUPER_ADMIN"),
    });
  } catch (error: any) {
    console.error("Platform stats error:", error.message);
    res.status(500).json({ error: "Failed to fetch platform stats" });
  }
});

router.get("/platform/organizations", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const allOrgs = await db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      tradeType: organizations.tradeType,
      tradeName: organizations.tradeName,
      onboardingStatus: organizations.onboardingStatus,
      isActive: organizations.isActive,
      region: organizations.region,
      typicalCrewSize: organizations.typicalCrewSize,
      websiteUrl: organizations.websiteUrl,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt));

    const orgsWithUserCounts = await Promise.all(allOrgs.map(async (org) => {
      const [userCountResult] = await db.select({ count: count() })
        .from(users)
        .where(eq(users.organizationId, org.id));
      
      return {
        ...org,
        userCount: userCountResult.count,
      };
    }));

    res.json(orgsWithUserCounts);
  } catch (error: any) {
    console.error("Platform organizations error:", error.message);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

router.post("/platform/organizations", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, slug, tradeType, region, email, phone } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Organization name is required" });
    }

    const finalSlug = (slug && typeof slug === "string" && slug.trim().length > 0)
      ? slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      : name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    const [existingSlug] = await db.select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, finalSlug));

    if (existingSlug) {
      return res.status(409).json({ error: "An organization with this slug already exists" });
    }

    const [newOrg] = await db.insert(organizations).values({
      name: name.trim(),
      slug: finalSlug,
      tradeType: tradeType || "GENERAL_CONTRACTOR",
      region: region || null,
      email: email || null,
      phone: phone || null,
      onboardingStatus: "NOT_STARTED",
      isActive: true,
    }).returning();

    res.status(201).json(newOrg);
  } catch (error: any) {
    console.error("Create organization error:", error.message);
    res.status(500).json({ error: "Failed to create organization" });
  }
});

router.get("/platform/organizations/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const orgUsers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.organizationId, orgId))
    .orderBy(desc(users.createdAt));

    const [projectCount] = await db.select({ count: count() }).from(projects);
    const [bidCount] = await db.select({ count: count() }).from(bids);

    res.json({
      organization: org,
      users: orgUsers,
      stats: {
        projectCount: projectCount.count,
        bidCount: bidCount.count,
        userCount: orgUsers.length,
      },
    });
  } catch (error: any) {
    console.error("Platform organization detail error:", error.message);
    res.status(500).json({ error: "Failed to fetch organization details" });
  }
});

router.get("/platform/organizations/:orgId/db-usage", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const metrics = await db.execute(sql`
      WITH org_users AS (
        SELECT id FROM users WHERE organization_id = ${orgId}
      ),
      org_projects AS (
        SELECT id FROM projects WHERE estimator_id IN (SELECT id FROM org_users)
          OR superintendent_id IN (SELECT id FROM org_users)
          OR project_manager_id IN (SELECT id FROM org_users)
      ),
      org_bids AS (
        SELECT id FROM bids WHERE estimator_id IN (SELECT id FROM org_users)
      )
      SELECT
        (SELECT COUNT(*) FROM org_users)::int AS users,
        (SELECT COUNT(*) FROM org_projects)::int AS projects,
        (SELECT COUNT(*) FROM org_bids)::int AS bids,
        (SELECT COUNT(*) FROM estimates WHERE project_id IN (SELECT id FROM org_projects) OR bid_id IN (SELECT id FROM org_bids))::int AS estimates,
        (SELECT COUNT(*) FROM change_orders WHERE project_id IN (SELECT id FROM org_projects))::int AS change_orders,
        (SELECT COUNT(*) FROM tasks WHERE organization_id = ${orgId})::int AS tasks,
        (SELECT COUNT(*) FROM equipment WHERE organization_id = ${orgId})::int AS equipment,
        (SELECT COUNT(*) FROM social_media_posts WHERE organization_id = ${orgId})::int AS social_posts,
        (SELECT COUNT(*) FROM audit_log WHERE user_id IN (SELECT id FROM org_users))::int AS audit_entries,
        (SELECT COUNT(*) FROM media WHERE project_id IN (SELECT id FROM org_projects))::int AS documents,
        (SELECT COUNT(*) FROM organization_sow_items WHERE organization_id = ${orgId})::int AS sow_items,
        (SELECT COUNT(*) FROM organization_work_types WHERE organization_id = ${orgId})::int AS work_types,
        (SELECT COUNT(*) FROM pay_runs WHERE organization_id = ${orgId})::int AS pay_runs,
        (SELECT COUNT(*) FROM calendar_events WHERE created_by_id IN (SELECT id FROM org_users))::int AS calendar_events
    `);

    const row = metrics.rows[0] || {};

    res.json({
      users: row.users || 0,
      projects: row.projects || 0,
      bids: row.bids || 0,
      estimates: row.estimates || 0,
      changeOrders: row.change_orders || 0,
      tasks: row.tasks || 0,
      equipment: row.equipment || 0,
      socialPosts: row.social_posts || 0,
      auditEntries: row.audit_entries || 0,
      documents: row.documents || 0,
      sowItems: row.sow_items || 0,
      workTypes: row.work_types || 0,
      payRuns: row.pay_runs || 0,
      calendarEvents: row.calendar_events || 0,
    });
  } catch (error: any) {
    console.error("Platform org db-usage error:", error.message);
    res.status(500).json({ error: "Failed to fetch database usage" });
  }
});

router.get("/platform/organizations/:orgId/sow-items", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    
    const items = await db.select()
      .from(organizationSowItems)
      .where(eq(organizationSowItems.organizationId, orgId))
      .orderBy(organizationSowItems.displayOrder);

    res.json(items);
  } catch (error: any) {
    console.error("Get SOW items error:", error.message);
    res.status(500).json({ error: "Failed to fetch SOW items" });
  }
});

router.post("/platform/organizations/:orgId/sow-items", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const { name, categoryName, code, description, unit } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: "Name and code are required" });
    }

    const [maxOrder] = await db.select({ 
      maxOrder: sql<number>`COALESCE(MAX(display_order), 0)` 
    })
    .from(organizationSowItems)
    .where(eq(organizationSowItems.organizationId, orgId));

    const [newItem] = await db.insert(organizationSowItems).values({
      organizationId: orgId,
      name,
      categoryName: categoryName || "General",
      code,
      description: description || null,
      unit: unit || "EACH",
      displayOrder: (maxOrder?.maxOrder || 0) + 1,
      isActive: true,
    }).returning();

    res.json(newItem);
  } catch (error: any) {
    console.error("Create SOW item error:", error.message);
    res.status(500).json({ error: "Failed to create SOW item" });
  }
});

router.patch("/platform/organizations/:orgId/sow-items/:itemId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId, itemId } = req.params;
    const updates = req.body;

    const [updated] = await db.update(organizationSowItems)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(organizationSowItems.id, itemId),
        eq(organizationSowItems.organizationId, orgId)
      ))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "SOW item not found" });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("Update SOW item error:", error.message);
    res.status(500).json({ error: "Failed to update SOW item" });
  }
});

router.get("/platform/organizations/:orgId/work-types", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    
    const items = await db.select()
      .from(organizationWorkTypes)
      .where(eq(organizationWorkTypes.organizationId, orgId));

    res.json(items);
  } catch (error: any) {
    console.error("Get work types error:", error.message);
    res.status(500).json({ error: "Failed to fetch work types" });
  }
});

router.post("/platform/organizations/:orgId/work-types", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const { name, unit, defaultProductionRate } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const [newItem] = await db.insert(organizationWorkTypes).values({
      organizationId: orgId,
      name,
      unit: unit || "SF",
      defaultProductionRate: defaultProductionRate || null,
      isActive: true,
    }).returning();

    res.json(newItem);
  } catch (error: any) {
    console.error("Create work type error:", error.message);
    res.status(500).json({ error: "Failed to create work type" });
  }
});

router.patch("/platform/organizations/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const updates = req.body;

    const [updated] = await db.update(organizations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Organization not found" });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("Update organization error:", error.message);
    res.status(500).json({ error: "Failed to update organization" });
  }
});

router.get("/platform/analytics", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;

    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - days);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);

    const [recentAuditCount] = await db.select({ count: count() })
      .from(auditLog)
      .where(gte(auditLog.createdAt, sevenDaysAgo));

    const [projectsCreated] = await db.select({ count: count() })
      .from(projects)
      .where(gte(projects.createdAt, startDate));

    const [bidsCreated] = await db.select({ count: count() })
      .from(bids)
      .where(gte(bids.createdAt, startDate));

    const [shiftsLogged] = await db.select({ count: count() })
      .from(timeClockShifts)
      .where(gte(timeClockShifts.clockIn, startDate));

    const subscriptionsByPlan = await db.select({
      planTier: organizationSubscriptions.planTier,
      status: organizationSubscriptions.status,
      count: count(),
    })
    .from(organizationSubscriptions)
    .groupBy(organizationSubscriptions.planTier, organizationSubscriptions.status);

    const planPrices: Record<string, number> = {
      free: 0,
      starter: 49,
      professional: 149,
      enterprise: 499,
    };

    let mrr = 0;
    let activeSubscriptions = 0;
    const planBreakdown: Record<string, number> = {};

    for (const sub of subscriptionsByPlan) {
      if (sub.status === "active" || sub.status === "trialing") {
        activeSubscriptions += sub.count;
        mrr += (planPrices[sub.planTier] || 0) * sub.count;
      }
      planBreakdown[`${sub.planTier}_${sub.status}`] = sub.count;
    }

    const trendPoints: Array<{ date: string; orgs: number; users: number }> = [];
    const bucketCount = Math.min(days, 12);
    const bucketSize = Math.ceil(days / bucketCount);

    for (let i = 0; i < bucketCount; i++) {
      const bucketEnd = new Date(now);
      bucketEnd.setDate(now.getDate() - (i * bucketSize));
      const bucketStart = new Date(bucketEnd);
      bucketStart.setDate(bucketEnd.getDate() - bucketSize);

      const [orgsBucket] = await db.select({ count: count() })
        .from(organizations)
        .where(and(gte(organizations.createdAt, bucketStart), lte(organizations.createdAt, bucketEnd)));

      const [usersBucket] = await db.select({ count: count() })
        .from(users)
        .where(and(gte(users.createdAt, bucketStart), lte(users.createdAt, bucketEnd), isNotNull(users.organizationId)));

      trendPoints.unshift({
        date: bucketStart.toISOString().split("T")[0],
        orgs: orgsBucket.count,
        users: usersBucket.count,
      });
    }

    const [totalActivityCount] = await db.select({ count: count() })
      .from(auditLog)
      .where(gte(auditLog.createdAt, startDate));

    const offset = (page - 1) * pageSize;
    const recentActivity = await db.select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      userId: auditLog.userId,
      oldValue: auditLog.oldValue,
      newValue: auditLog.newValue,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(gte(auditLog.createdAt, startDate))
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize)
    .offset(offset);

    res.json({
      weeklyActions: recentAuditCount.count,
      monthlyProjectsCreated: projectsCreated.count,
      monthlyBidsCreated: bidsCreated.count,
      monthlyShiftsLogged: shiftsLogged.count,
      mrr,
      activeSubscriptions,
      planBreakdown,
      trend: trendPoints,
      recentActivity,
      activityTotal: totalActivityCount.count,
      activityPage: page,
      activityPageSize: pageSize,
      days,
    });
  } catch (error: any) {
    console.error("Platform analytics error:", error.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

router.get("/platform/organizations/:orgId/activity", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const entries = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        oldValue: auditLog.oldValue,
        newValue: auditLog.newValue,
        createdAt: auditLog.createdAt,
        userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
        userEmail: users.email,
      })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.userId, users.id))
      .where(eq(users.organizationId, orgId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.userId, users.id))
      .where(eq(users.organizationId, orgId));

    res.json({
      entries,
      total: totalResult.count,
      page,
      limit,
    });
  } catch (error: any) {
    console.error("Platform organization activity error:", error.message);
    res.status(500).json({ error: "Failed to fetch organization activity" });
  }
});

export default router;
