import { Router } from "express";
import { db } from "./db";
import { users, organizations, auditLog, projects, bids, timeClockShifts, organizationSowItems, organizationWorkTypes, organizationCalculators } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, count, desc, sql, and, gte, isNotNull } from "drizzle-orm";

const router = Router();

function requireSuperAdmin(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Access denied. Platform admin access required." });
  }
  next();
}

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

router.get("/platform/analytics", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [recentAuditCount] = await db.select({ count: count() })
      .from(auditLog)
      .where(gte(auditLog.createdAt, sevenDaysAgo));

    const [projectsCreated] = await db.select({ count: count() })
      .from(projects)
      .where(gte(projects.createdAt, thirtyDaysAgo));

    const [bidsCreated] = await db.select({ count: count() })
      .from(bids)
      .where(gte(bids.createdAt, thirtyDaysAgo));

    const [shiftsLogged] = await db.select({ count: count() })
      .from(timeClockShifts)
      .where(gte(timeClockShifts.clockIn, thirtyDaysAgo));

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
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

    res.json({
      weeklyActions: recentAuditCount.count,
      monthlyProjectsCreated: projectsCreated.count,
      monthlyBidsCreated: bidsCreated.count,
      monthlyShiftsLogged: shiftsLogged.count,
      recentActivity,
    });
  } catch (error: any) {
    console.error("Platform analytics error:", error.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

router.get("/platform/users", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const allUsers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      organizationId: users.organizationId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(isNotNull(users.organizationId))
    .orderBy(desc(users.createdAt));

    const usersWithOrgs = await Promise.all(allUsers.map(async (user) => {
      if (user.organizationId) {
        const [org] = await db.select({ name: organizations.name, tradeType: organizations.tradeType })
          .from(organizations)
          .where(eq(organizations.id, user.organizationId));
        return { ...user, organization: org };
      }
      return { ...user, organization: null };
    }));

    res.json(usersWithOrgs);
  } catch (error: any) {
    console.error("Platform users error:", error.message);
    res.status(500).json({ error: "Failed to fetch users" });
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

export default router;
