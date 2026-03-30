/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List all users (admin)
 *     description: Requires SUPER_ADMIN or ADMIN role. Returns all users across organizations.
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: role
 *         in: query
 *         schema: { type: string }
 *       - name: search
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paginated user list }
 *       403: { description: Insufficient permissions }
 *   post:
 *     tags: [Admin]
 *     summary: Create a user (admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertUser'
 *     responses:
 *       201: { description: User created }
 * /api/admin/users/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update a user (admin)
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
 *     responses:
 *       200: { description: User updated }
 *   delete:
 *     tags: [Admin]
 *     summary: Deactivate a user
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: User deactivated }
 * /api/admin/organizations:
 *   get:
 *     tags: [Admin]
 *     summary: List organizations
 *     description: Requires SUPER_ADMIN role.
 *     responses:
 *       200: { description: List of organizations }
 * /api/admin/organizations/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update an organization
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
 *     responses:
 *       200: { description: Organization updated }
 * /api/admin/audit-log:
 *   get:
 *     tags: [Admin]
 *     summary: Get audit log
 *     description: Returns system audit log entries. Requires ADMIN role.
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: action
 *         in: query
 *         schema: { type: string }
 *       - name: userId
 *         in: query
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Paginated audit log entries }
 * /api/admin/feature-flags:
 *   get:
 *     tags: [Admin]
 *     summary: Get feature flags
 *     description: Returns current feature flag settings for the organization.
 *     responses:
 *       200: { description: Feature flags }
 *   post:
 *     tags: [Admin]
 *     summary: Update feature flags
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Feature flags updated }
 * /api/admin/announcements:
 *   get:
 *     tags: [Admin]
 *     summary: List platform announcements
 *     responses:
 *       200: { description: List of announcements }
 *   post:
 *     tags: [Admin]
 *     summary: Create a platform announcement
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               priority: { type: string, enum: [low, medium, high, critical] }
 *     responses:
 *       201: { description: Announcement created }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { users, organizations, auditLog, projects, bids, timeClockShifts, organizationSowItems, organizationWorkTypes, organizationSubscriptions, passwordResetTokens, conversations, conversationParticipants, messages, tasks, notifications, insertUserSchema, aiActionAudit, uploadIntents, aiRuns, media, integrationConnections, platformAnnouncements, announcementDismissals, globalWorkflowTemplates, equipment, contracts } from "@shared/schema";
import { requireAuth, type AuthRequest, hashPassword, generateToken } from "./auth";
import { eq, count, desc, sql, and, gte, lte, isNotNull, like, ilike, sum, inArray, or } from "drizzle-orm";
import crypto from "crypto";
import { sendEmail, getAdminPasswordResetEmailHtml, getPasswordResetEmailText } from "./email";
import { logAudit } from "./auditLogger";
import { sanitizeShortText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { z } from "zod";

const router = Router();

// ========================================
// Routes from platformOrgRoutes.ts
// ========================================

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
    logError("Platform stats error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Platform organizations error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Create organization error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Platform organization detail error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Platform org db-usage error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get SOW items error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Create SOW item error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Update SOW item error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get work types error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Create work type error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create work type" });
  }
});

router.post("/platform/organizations/:orgId/suspend", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const { action } = req.body;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    let newStatus: boolean;
    if (action === "suspend") {
      newStatus = false;
    } else if (action === "reactivate") {
      newStatus = true;
    } else {
      newStatus = !org.isActive;
    }

    if (org.isActive === newStatus) {
      return res.status(400).json({
        error: newStatus ? "Organization is already active" : "Organization is already suspended",
      });
    }

    const [updated] = await db.update(organizations)
      .set({ isActive: newStatus, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();

    await logAudit({
      action: "UPDATE",
      entityType: "organizations",
      entityId: orgId,
      userId: req.user!.id,
      oldValue: JSON.stringify({ isActive: org.isActive }),
      newValue: JSON.stringify({ isActive: newStatus, action: newStatus ? "reactivated" : "suspended" }),
    }, req);

    res.json({
      organization: updated,
      message: newStatus
        ? `Organization "${org.name}" has been reactivated`
        : `Organization "${org.name}" has been suspended`,
    });
  } catch (error: any) {
    logError("Org suspend/reactivate error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update organization status" });
  }
});

router.patch("/platform/users/:userId/role", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const validRoles = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER", "VENDOR", "HUSTLER", "SALES", "MARKETING", "SAFETY_MANAGER", "HR_MANAGER", "EQUIPMENT_MANAGER", "PROJECT_ENGINEER", "PROCUREMENT_MANAGER", "DISPATCHER"];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be one of: " + validRoles.join(", ") });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Cannot change the role of a platform administrator" });
    }

    if (user.role === "ADMIN" && role !== "ADMIN" && user.organizationId) {
      const adminCount = await db.select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(
          eq(users.organizationId, user.organizationId),
          eq(users.role, "ADMIN"),
          eq(users.isActive, true)
        ));
      if (adminCount[0].count <= 1) {
        return res.status(400).json({ error: "Cannot change role: this is the last admin in the organization" });
      }
    }

    const oldRole = user.role;
    const [updated] = await db.update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    await logAudit({
      action: "UPDATE",
      entityType: "users",
      entityId: userId,
      userId: req.user!.id,
      oldValue: JSON.stringify({ role: oldRole }),
      newValue: JSON.stringify({ role, email: user.email }),
    }, req);

    const { passwordHash: _, tokenVersion: _tv, ...userWithoutSensitive } = updated;
    res.json({ user: userWithoutSensitive, message: `Role changed from ${oldRole} to ${role}` });
  } catch (error: any) {
    logError("Change user role error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to change user role" });
  }
});

router.post("/platform/users/:userId/transfer", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const { targetOrganizationId } = req.body;

    if (!targetOrganizationId) {
      return res.status(400).json({ error: "Target organization ID is required" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Cannot transfer a platform administrator" });
    }

    const [targetOrg] = await db.select().from(organizations).where(eq(organizations.id, targetOrganizationId)).limit(1);
    if (!targetOrg) {
      return res.status(404).json({ error: "Target organization not found" });
    }

    if (user.organizationId === targetOrganizationId) {
      return res.status(400).json({ error: "User is already in this organization" });
    }

    if (user.role === "ADMIN" && user.organizationId) {
      const [adminCount] = await db.select({ count: count() })
        .from(users)
        .where(and(
          eq(users.organizationId, user.organizationId),
          eq(users.role, "ADMIN"),
          eq(users.isActive, true)
        ));

      if (adminCount.count <= 1) {
        return res.status(400).json({ error: "Cannot transfer the last admin out of an organization. Assign another admin first." });
      }
    }

    const oldOrgId = user.organizationId;
    const [updated] = await db.update(users)
      .set({ organizationId: targetOrganizationId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    const oldOrgName = oldOrgId
      ? (await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, oldOrgId)).limit(1))?.[0]?.name || "Unknown"
      : "None";

    await logAudit({
      action: "UPDATE",
      entityType: "users",
      entityId: userId,
      userId: req.user!.id,
      oldValue: JSON.stringify({ organizationId: oldOrgId, organizationName: oldOrgName }),
      newValue: JSON.stringify({ organizationId: targetOrganizationId, organizationName: targetOrg.name, email: user.email }),
    }, req);

    const { passwordHash: _, tokenVersion: _tv, ...userWithoutSensitive } = updated;
    res.json({
      user: userWithoutSensitive,
      message: `User transferred from "${oldOrgName}" to "${targetOrg.name}"`,
    });
  } catch (error: any) {
    logError("Transfer user error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to transfer user" });
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
    logError("Update organization error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Platform analytics error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Platform organization activity error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch organization activity" });
  }
});

// ========================================
// Routes from platformUserRoutes.ts
// ========================================

const platformCreateUserSchema = insertUserSchema.omit({ passwordHash: true }).extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
  organizationId: z.string().min(1, "Organization is required"),
});

router.post("/platform/users", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      firstName: sanitizeShortText(req.body.firstName),
      lastName: sanitizeShortText(req.body.lastName),
      email: sanitizeEmail(req.body.email),
      phone: req.body.phone ? sanitizePhone(req.body.phone) : undefined,
      password: req.body.password,
    };

    const validationResult = platformCreateUserSchema.safeParse(sanitizedBody);

    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
    }

    const { firstName, lastName, email, phone, role, password, organizationId } = validationResult.data;

    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const passwordHash = await hashPassword(password);

    const [newUser] = await db.insert(users).values({
      firstName,
      lastName,
      email,
      phone: phone || null,
      role: role || "HOURLY_EMPLOYEE",
      isActive: true,
      passwordHash,
      organizationId,
    }).returning();

    await logAudit({
      action: "CREATE",
      entityType: "users",
      entityId: newUser.id,
      userId: req.user!.id,
      newValue: JSON.stringify({ email, firstName, lastName, role: role || "HOURLY_EMPLOYEE", organizationId }),
    }, req);

    const { passwordHash: _, tokenVersion, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (error: any) {
    logError("Platform create user error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.code === '23505') {
      return res.status(409).json({ error: "Email already exists" });
    }
    res.status(500).json({ error: "Failed to create user" });
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
      emailVerified: users.emailVerified,
      organizationId: users.organizationId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.isActive, true), isNotNull(users.organizationId)))
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
    logError("Platform users error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/platform/users/archived", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const archivedUsers = await db.select({
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
    .where(and(eq(users.isActive, false), isNotNull(users.organizationId)))
    .orderBy(desc(users.createdAt));

    const usersWithOrgs = await Promise.all(archivedUsers.map(async (user) => {
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
    logError("Platform archived users error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch archived users" });
  }
});

router.post("/platform/users/:userId/reset-password", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

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

    await sendEmail({
      to: user.email,
      subject: 'Password Reset Required - SmartManageAI',
      html: getAdminPasswordResetEmailHtml(resetLink, user.firstName),
      text: getPasswordResetEmailText(resetLink, user.firstName),
    });

    await logAudit({
      action: "UPDATE",
      entityType: "users",
      entityId: user.id,
      userId: req.user!.id,
      newValue: JSON.stringify({ adminPasswordReset: true, targetEmail: user.email }),
    }, req);

    console.log(`Admin-initiated credential reset for user: ${user.email} by admin: ${req.user!.email}`);
    res.json({ message: `Password reset email sent to ${user.email}` });
  } catch (error: any) {
    logError("Admin password reset error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to initiate password reset" });
  }
});

const impersonationCodes = new Map<string, { token: string; adminEmail: string; targetEmail: string; expiresAt: number }>();

router.post("/platform/users/:userId/impersonate", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Cannot impersonate other platform administrators" });
    }

    if (!user.isActive) {
      return res.status(400).json({ error: "Cannot impersonate an archived user" });
    }

    const impersonationToken = generateToken(user.id, user.tokenVersion);
    const code = crypto.randomBytes(32).toString("hex");
    
    impersonationCodes.set(code, {
      token: impersonationToken,
      adminEmail: req.user!.email,
      targetEmail: user.email,
      expiresAt: Date.now() + 60_000,
    });

    setTimeout(() => impersonationCodes.delete(code), 60_000);

    await logAudit({
      action: "UPDATE",
      entityType: "users",
      entityId: user.id,
      userId: req.user!.id,
      oldValue: null,
      newValue: JSON.stringify({ 
        actionType: "IMPERSONATE",
        impersonatedUser: user.email, 
        adminUser: req.user!.email,
        timestamp: new Date().toISOString()
      }),
    }, req);

    console.log(`SECURITY: Admin ${req.user!.email} impersonating user ${user.email} (${user.id})`);
    
    res.json({ 
      code,
      message: `Impersonation code generated for ${user.email}` 
    });
  } catch (error: any) {
    logError("Impersonate user error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate impersonation token" });
  }
});

router.post("/platform/impersonate/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Code is required" });
    }

    const entry = impersonationCodes.get(code);
    if (!entry) {
      return res.status(404).json({ error: "Invalid or expired impersonation code" });
    }

    if (Date.now() > entry.expiresAt) {
      impersonationCodes.delete(code);
      return res.status(410).json({ error: "Impersonation code has expired" });
    }

    impersonationCodes.delete(code);

    res.cookie("token", entry.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.cookie("impersonation_info", JSON.stringify({ adminEmail: entry.adminEmail, targetEmail: entry.targetEmail }), {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.json({ success: true });
  } catch (error: any) {
    logError("Impersonation exchange error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to exchange impersonation code" });
  }
});

router.post("/platform/users/:userId/restore", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.isActive) {
      return res.status(400).json({ error: "User is already active" });
    }

    const [updated] = await db.update(users)
      .set({ isActive: true })
      .where(eq(users.id, userId))
      .returning();

    await logAudit({
      action: "UPDATE",
      entityType: "users",
      entityId: user.id,
      userId: req.user!.id,
      oldValue: JSON.stringify({ isActive: false }),
      newValue: JSON.stringify({ isActive: true, restored: true }),
    }, req);

    console.log(`User restored: ${user.email} by admin: ${req.user!.email}`);
    res.json({ message: `User ${user.email} has been restored and reactivated` });
  } catch (error: any) {
    logError("Restore user error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to restore user" });
  }
});

router.post("/platform/users/:userId/soft-delete", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Cannot delete platform administrators" });
    }

    const [updated] = await db.update(users)
      .set({ isActive: false })
      .where(eq(users.id, userId))
      .returning();

    await logAudit({
      action: "UPDATE",
      entityType: "users",
      entityId: user.id,
      userId: req.user!.id,
      oldValue: JSON.stringify({ isActive: true }),
      newValue: JSON.stringify({ isActive: false, softDeleted: true }),
    }, req);

    console.log(`User soft-deleted: ${user.email} by admin: ${req.user!.email}`);
    res.json({ message: `User ${user.email} has been deactivated and archived` });
  } catch (error: any) {
    logError("Soft delete user error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to deactivate user" });
  }
});

router.patch("/platform/users/:userId/verify-email", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newStatus = !user.emailVerified;
    const [updated] = await db.update(users)
      .set({ emailVerified: newStatus, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    await logAudit({
      action: "UPDATE",
      entityType: "users",
      entityId: user.id,
      userId: req.user!.id,
      oldValue: JSON.stringify({ emailVerified: user.emailVerified }),
      newValue: JSON.stringify({ emailVerified: newStatus }),
    }, req);

    res.json({ emailVerified: updated.emailVerified, message: `Email ${newStatus ? 'verified' : 'unverified'} for ${user.email}` });
  } catch (error: any) {
    logError("Toggle email verification error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update email verification status" });
  }
});

router.delete("/platform/users/:userId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Cannot permanently delete platform administrators" });
    }

    if (user.isActive) {
      return res.status(400).json({ error: "User must be archived (soft-deleted) before permanent deletion" });
    }

    await db.delete(messages).where(eq(messages.senderId, userId));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.userId, userId));
    await db.delete(conversations).where(eq(conversations.createdById, userId));
    await db.delete(tasks).where(eq(tasks.assignedToId, userId));
    await db.delete(tasks).where(eq(tasks.createdById, userId));
    await db.delete(notifications).where(eq(notifications.userId, userId));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await db.delete(users).where(eq(users.id, userId));

    await logAudit({
      action: "DELETE",
      entityType: "users",
      entityId: userId,
      userId: req.user!.id,
      oldValue: JSON.stringify({ email: user.email, firstName: user.firstName, lastName: user.lastName }),
      newValue: JSON.stringify({ permanentlyDeleted: true }),
    }, req);

    console.log(`User permanently deleted: ${user.email} by admin: ${req.user!.email}`);
    res.json({ message: `User ${user.email} has been permanently deleted` });
  } catch (error: any) {
    logError("Permanent delete user error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to permanently delete user" });
  }
});

// ========================================
// Platform Monitoring & Observability
// ========================================

interface ApiRequestEvent {
  timestamp: number;
  isError: boolean;
}

const apiRequestTracker = new Map<string, ApiRequestEvent[]>();
const MAX_EVENTS_PER_ORG = 10000;
const MAX_EVENT_AGE_MS = 31 * 24 * 60 * 60 * 1000;

export function trackApiRequest(orgId: string | null, isError: boolean) {
  if (!orgId) return;
  const now = Date.now();
  const cutoff = now - MAX_EVENT_AGE_MS;
  const events = (apiRequestTracker.get(orgId) || []).filter(e => e.timestamp >= cutoff);
  events.push({ timestamp: now, isError });
  if (events.length > MAX_EVENTS_PER_ORG) {
    events.splice(0, events.length - MAX_EVENTS_PER_ORG);
  }
  apiRequestTracker.set(orgId, events);
}

function getApiMetricsForPeriod(orgId: string, sinceMs: number): { requests: number; errors: number } {
  const events = apiRequestTracker.get(orgId) || [];
  let requests = 0;
  let errors = 0;
  for (const e of events) {
    if (e.timestamp >= sinceMs) {
      requests++;
      if (e.isError) errors++;
    }
  }
  return { requests, errors };
}

router.get("/platform/monitoring/api-usage", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const period = req.query.period as string || "7d";
    const daysMap: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };
    const days = daysMap[period] || 7;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const sinceMs = since.getTime();

    const auditMetrics = await db
      .select({
        orgId: users.organizationId,
        orgName: organizations.name,
        auditedActions: count(auditLog.id),
      })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.userId, users.id))
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(gte(auditLog.createdAt, since))
      .groupBy(users.organizationId, organizations.name);

    const allOrgIds = new Set<string>();
    auditMetrics.forEach(m => { if (m.orgId) allOrgIds.add(m.orgId); });
    apiRequestTracker.forEach((_, orgId) => allOrgIds.add(orgId));

    const orgNames = new Map<string, string>();
    auditMetrics.forEach(m => { if (m.orgId && m.orgName) orgNames.set(m.orgId, m.orgName); });

    const missingOrgIds = Array.from(allOrgIds).filter(id => !orgNames.has(id));
    if (missingOrgIds.length > 0) {
      const missingOrgs = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(sql`${organizations.id} IN (${sql.join(missingOrgIds.map(id => sql`${id}`), sql`, `)})`);
      missingOrgs.forEach(o => orgNames.set(o.id, o.name));
    }

    const result = Array.from(allOrgIds).map(orgId => {
      const auditRow = auditMetrics.find(m => m.orgId === orgId);
      const periodMetrics = getApiMetricsForPeriod(orgId, sinceMs);
      return {
        organizationId: orgId,
        organizationName: orgNames.get(orgId) || "Unknown",
        auditedActions: auditRow?.auditedActions || 0,
        totalRequests: periodMetrics.requests,
        totalErrors: periodMetrics.errors,
        errorRate: periodMetrics.requests > 0
          ? Math.round((periodMetrics.errors / periodMetrics.requests) * 100 * 100) / 100
          : 0,
      };
    });

    res.json({
      period,
      since: since.toISOString(),
      organizations: result.sort((a, b) => (b.totalRequests + b.auditedActions) - (a.totalRequests + a.auditedActions)),
    });
  } catch (error: any) {
    logError("Platform monitoring API usage error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch API usage metrics" });
  }
});

router.get("/platform/monitoring/ai-usage", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const period = req.query.period as string || "7d";
    const daysMap: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };
    const days = daysMap[period] || 7;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const aiUsage = await db
      .select({
        orgId: aiActionAudit.organizationId,
        orgName: organizations.name,
        totalCalls: count(aiActionAudit.id),
        totalTokensIn: sum(aiActionAudit.tokensIn),
        totalTokensOut: sum(aiActionAudit.tokensOut),
        totalCost: sum(aiActionAudit.costEstimate),
      })
      .from(aiActionAudit)
      .innerJoin(organizations, eq(aiActionAudit.organizationId, organizations.id))
      .where(gte(aiActionAudit.createdAt, since))
      .groupBy(aiActionAudit.organizationId, organizations.name);

    const aiRunsByOrg = await db
      .select({
        orgId: users.organizationId,
        orgName: organizations.name,
        runCount: count(aiRuns.id),
      })
      .from(aiRuns)
      .innerJoin(users, eq(aiRuns.triggeredById, users.id))
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(gte(aiRuns.createdAt, since))
      .groupBy(users.organizationId, organizations.name);

    const allOrgIds = new Set([
      ...aiUsage.map(u => u.orgId),
      ...aiRunsByOrg.map(r => r.orgId),
    ]);

    const merged = Array.from(allOrgIds).map(orgId => {
      const usage = aiUsage.find(u => u.orgId === orgId);
      const runs = aiRunsByOrg.find(r => r.orgId === orgId);
      return {
        organizationId: orgId,
        organizationName: usage?.orgName || runs?.orgName || "Unknown",
        totalCalls: usage?.totalCalls || 0,
        tokensIn: Number(usage?.totalTokensIn) || 0,
        tokensOut: Number(usage?.totalTokensOut) || 0,
        totalTokens: (Number(usage?.totalTokensIn) || 0) + (Number(usage?.totalTokensOut) || 0),
        estimatedCost: Number(usage?.totalCost) || 0,
        aiRuns: runs?.runCount || 0,
      };
    });

    res.json({
      period,
      since: since.toISOString(),
      organizations: merged.sort((a, b) => b.totalCalls - a.totalCalls),
    });
  } catch (error: any) {
    logError("Platform monitoring AI usage error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch AI usage metrics" });
  }
});

router.get("/platform/monitoring/storage-usage", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const uploadStats = await db
      .select({
        orgId: uploadIntents.organizationId,
        orgName: organizations.name,
        fileCount: count(uploadIntents.id),
        totalSize: sum(uploadIntents.fileSize),
      })
      .from(uploadIntents)
      .innerJoin(organizations, eq(uploadIntents.organizationId, organizations.id))
      .groupBy(uploadIntents.organizationId, organizations.name);

    res.json({
      organizations: uploadStats.map((s) => ({
        organizationId: s.orgId,
        organizationName: s.orgName,
        totalFiles: s.fileCount,
        totalSizeBytes: Number(s.totalSize) || 0,
        totalSizeMB: Math.round((Number(s.totalSize) || 0) / (1024 * 1024) * 100) / 100,
      })).sort((a, b) => b.totalSizeBytes - a.totalSizeBytes),
    });
  } catch (error: any) {
    logError("Platform monitoring storage usage error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch storage usage metrics" });
  }
});

router.get("/platform/monitoring/integration-health", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const connections = await db
      .select({
        id: integrationConnections.id,
        organizationId: integrationConnections.organizationId,
        orgName: organizations.name,
        provider: integrationConnections.provider,
        status: integrationConnections.status,
        displayName: integrationConnections.displayName,
        lastSyncAt: integrationConnections.lastSyncAt,
        lastSyncError: integrationConnections.lastSyncError,
        createdAt: integrationConnections.createdAt,
      })
      .from(integrationConnections)
      .innerJoin(organizations, eq(integrationConnections.organizationId, organizations.id))
      .orderBy(organizations.name, integrationConnections.provider);

    const byOrg = new Map<string, {
      organizationId: string;
      organizationName: string;
      connections: typeof connections;
    }>();

    for (const conn of connections) {
      if (!byOrg.has(conn.organizationId)) {
        byOrg.set(conn.organizationId, {
          organizationId: conn.organizationId,
          organizationName: conn.orgName,
          connections: [],
        });
      }
      byOrg.get(conn.organizationId)!.connections.push(conn);
    }

    const orgResults = Array.from(byOrg.values()).map((entry) => {
      const healthy = entry.connections.filter(c => c.status === "active").length;
      const failing = entry.connections.filter(c => c.status === "error").length;
      const disconnected = entry.connections.filter(c => c.status === "disconnected").length;
      const total = entry.connections.length;
      const overallStatus = failing > 0 ? "failing"
        : disconnected > 0 ? "partial"
        : healthy === total ? "healthy"
        : "unknown";

      return {
        organizationId: entry.organizationId,
        organizationName: entry.organizationName,
        overallStatus,
        healthyCount: healthy,
        failingCount: failing,
        disconnectedCount: disconnected,
        totalConnections: total,
        connections: entry.connections.map(c => ({
          id: c.id,
          provider: c.provider,
          status: c.status,
          displayName: c.displayName,
          lastSyncAt: c.lastSyncAt,
          lastSyncError: c.lastSyncError,
        })),
      };
    });

    res.json({
      organizations: orgResults,
      platformIntegrations: {
        sendgrid: !!process.env.SENDGRID_API_KEY,
        objectStorage: !!process.env.PRIVATE_OBJECT_DIR,
        openai: !!process.env.OPENAI_API_KEY,
      },
    });
  } catch (error: any) {
    logError("Platform monitoring integration health error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch integration health" });
  }
});

router.get("/platform/monitoring/audit-logs", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string) || 50));
    const offset = (page - 1) * pageSize;

    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const orgId = req.query.orgId as string | undefined;
    const userId = req.query.userId as string | undefined;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    if (startDate && isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Invalid startDate" });
    }
    if (endDate && isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid endDate" });
    }

    const conditions = [];

    if (action) {
      conditions.push(sql`${auditLog.action} = ${action}`);
    }
    if (entityType) {
      conditions.push(eq(auditLog.entityType, entityType));
    }
    if (orgId) {
      conditions.push(eq(users.organizationId, orgId));
    }
    if (userId) {
      conditions.push(eq(auditLog.userId, userId));
    }
    if (startDate) {
      conditions.push(gte(auditLog.createdAt, startDate));
    }
    if (endDate) {
      const endOfDay = new Date(endDate as string);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLog.createdAt, endOfDay));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const entries = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        oldValue: auditLog.oldValue,
        newValue: auditLog.newValue,
        ipAddress: auditLog.ipAddress,
        createdAt: auditLog.createdAt,
        userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
        userEmail: users.email,
        organizationId: users.organizationId,
        organizationName: organizations.name,
      })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.userId, users.id))
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .where(whereClause)
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.userId, users.id))
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .where(whereClause);

    const actionTypes = await db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .orderBy(auditLog.action);

    const entityTypes = await db
      .selectDistinct({ entityType: auditLog.entityType })
      .from(auditLog)
      .orderBy(auditLog.entityType);

    res.json({
      entries,
      total: totalResult.count,
      page,
      pageSize,
      totalPages: Math.ceil(totalResult.count / pageSize),
      filters: {
        actions: actionTypes.map(a => a.action),
        entityTypes: entityTypes.map(e => e.entityType),
      },
    });
  } catch (error: any) {
    logError("Platform monitoring audit logs error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

// ========================================
// Platform Announcements
// ========================================

router.get("/platform/announcements", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const all = await db.select().from(platformAnnouncements).orderBy(desc(platformAnnouncements.createdAt));
    res.json(all);
  } catch (error: any) {
    logError("Get announcements error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch announcements" });
  }
});

router.post("/platform/announcements", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { title, message, targetOrgIds, isActive, expiresAt } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required" });
    }
    const [announcement] = await db.insert(platformAnnouncements).values({
      title,
      message,
      targetOrgIds: targetOrgIds && targetOrgIds.length > 0 ? targetOrgIds : null,
      isActive: isActive !== undefined ? isActive : true,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdById: req.user!.id,
    }).returning();
    res.status(201).json(announcement);
  } catch (error: any) {
    logError("Create announcement error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create announcement" });
  }
});

router.patch("/platform/announcements/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.message !== undefined) updates.message = req.body.message;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    if (req.body.expiresAt !== undefined) updates.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    if (req.body.targetOrgIds !== undefined) updates.targetOrgIds = req.body.targetOrgIds && req.body.targetOrgIds.length > 0 ? req.body.targetOrgIds : null;

    const [updated] = await db.update(platformAnnouncements).set(updates).where(eq(platformAnnouncements.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Announcement not found" });
    res.json(updated);
  } catch (error: any) {
    logError("Update announcement error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update announcement" });
  }
});

router.delete("/platform/announcements/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await db.delete(platformAnnouncements).where(eq(platformAnnouncements.id, id));
    res.json({ message: "Announcement deleted" });
  } catch (error: any) {
    logError("Delete announcement error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete announcement" });
  }
});

router.get("/platform/announcements/active", requireAuth, async (req: AuthRequest, res) => {
  try {
    const now = new Date();
    const active = await db.select().from(platformAnnouncements)
      .where(and(
        eq(platformAnnouncements.isActive, true),
        or(
          sql`${platformAnnouncements.expiresAt} IS NULL`,
          gte(platformAnnouncements.expiresAt, now)
        )
      ))
      .orderBy(desc(platformAnnouncements.createdAt));

    const orgId = req.user?.organizationId;
    const filtered = active.filter(a => {
      if (!a.targetOrgIds || a.targetOrgIds.length === 0) return true;
      return orgId && a.targetOrgIds.includes(orgId);
    });

    const dismissed = await db.select({ announcementId: announcementDismissals.announcementId })
      .from(announcementDismissals)
      .where(eq(announcementDismissals.userId, req.user!.id));
    const dismissedIds = new Set(dismissed.map(d => d.announcementId));

    const result = filtered.filter(a => !dismissedIds.has(a.id));
    res.json(result);
  } catch (error: any) {
    logError("Get active announcements error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch active announcements" });
  }
});

router.post("/platform/announcements/:id/dismiss", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await db.insert(announcementDismissals).values({
      announcementId: id,
      userId: req.user!.id,
    }).onConflictDoNothing();
    res.json({ message: "Announcement dismissed" });
  } catch (error: any) {
    logError("Dismiss announcement error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to dismiss announcement" });
  }
});

// ========================================
// Read-Only Org Data Browser
// ========================================

router.get("/platform/organizations/:orgId/projects", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const orgProjects = await db.select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
      contractAmount: projects.contractAmount,
      budgetAmount: projects.budgetAmount,
      startDate: projects.startDate,
      endDate: projects.endDate,
      createdAt: projects.createdAt,
    }).from(projects)
      .innerJoin(users, or(
        eq(projects.estimatorId, users.id),
        eq(projects.superintendentId, users.id),
        eq(projects.projectManagerId, users.id)
      ))
      .where(eq(users.organizationId, orgId))
      .orderBy(desc(projects.createdAt));

    const uniqueProjects = Array.from(new Map(orgProjects.map(p => [p.id, p])).values());
    res.json(uniqueProjects);
  } catch (error: any) {
    logError("Get org projects error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch organization projects" });
  }
});

router.get("/platform/organizations/:orgId/bids", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const orgBids = await db.select({
      id: bids.id,
      projectName: bids.projectName,
      status: bids.status,
      bidAmount: bids.bidAmount,
      clientName: bids.clientName,
      bidDate: bids.bidDate,
      createdAt: bids.createdAt,
    }).from(bids)
      .innerJoin(users, eq(bids.estimatorId, users.id))
      .where(eq(users.organizationId, orgId))
      .orderBy(desc(bids.createdAt));

    res.json(orgBids);
  } catch (error: any) {
    logError("Get org bids error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch organization bids" });
  }
});

router.get("/platform/organizations/:orgId/contracts", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const orgContracts = await db.select({
      id: contracts.id,
      contractNumber: contracts.contractNumber,
      contractType: contracts.contractType,
      status: contracts.status,
      contractValue: contracts.contractValue,
      effectiveDate: contracts.effectiveDate,
      expirationDate: contracts.expirationDate,
      createdAt: contracts.createdAt,
    }).from(contracts)
      .where(eq(contracts.organizationId, orgId))
      .orderBy(desc(contracts.createdAt));

    res.json(orgContracts);
  } catch (error: any) {
    logError("Get org contracts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch organization contracts" });
  }
});

router.get("/platform/organizations/:orgId/equipment", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const orgEquipment = await db.select({
      id: equipment.id,
      name: equipment.name,
      equipmentCode: equipment.equipmentCode,
      type: equipment.type,
      status: equipment.status,
      make: equipment.make,
      model: equipment.model,
      currentHours: equipment.currentHours,
      purchasePrice: equipment.purchasePrice,
    }).from(equipment)
      .where(eq(equipment.organizationId, orgId))
      .orderBy(equipment.name);

    res.json(orgEquipment);
  } catch (error: any) {
    logError("Get org equipment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch organization equipment" });
  }
});

router.get("/platform/organizations/:orgId/financials", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const financials = await db.execute(sql`
      WITH org_users AS (
        SELECT id FROM users WHERE organization_id = ${orgId}
      ),
      org_projects AS (
        SELECT id, contract_amount, budget_amount FROM projects
        WHERE estimator_id IN (SELECT id FROM org_users)
          OR superintendent_id IN (SELECT id FROM org_users)
          OR project_manager_id IN (SELECT id FROM org_users)
      ),
      org_bids AS (
        SELECT id, bid_amount FROM bids WHERE estimator_id IN (SELECT id FROM org_users)
      )
      SELECT
        COALESCE(SUM(p.contract_amount), 0)::text AS total_contract_value,
        COALESCE(SUM(p.budget_amount), 0)::text AS total_budget,
        (SELECT COUNT(*) FROM org_projects)::int AS project_count,
        COALESCE(SUM(b.bid_amount), 0)::text AS total_bid_value,
        (SELECT COUNT(*) FROM org_bids)::int AS bid_count,
        (SELECT COUNT(*) FROM pay_runs WHERE organization_id = ${orgId})::int AS payroll_runs
      FROM org_projects p
      FULL OUTER JOIN org_bids b ON false
    `);

    const row = financials.rows[0] || {};
    res.json({
      totalContractValue: row.total_contract_value || "0",
      totalBudget: row.total_budget || "0",
      projectCount: row.project_count || 0,
      totalBidValue: row.total_bid_value || "0",
      bidCount: row.bid_count || 0,
      payrollRuns: row.payroll_runs || 0,
    });
  } catch (error: any) {
    logError("Get org financials error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch organization financials" });
  }
});

// ========================================
// Global Workflow Templates
// ========================================

router.get("/platform/workflow-templates", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const templates = await db.select().from(globalWorkflowTemplates).orderBy(desc(globalWorkflowTemplates.updatedAt));
    res.json(templates);
  } catch (error: any) {
    logError("Get global workflow templates error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch workflow templates" });
  }
});

router.post("/platform/workflow-templates", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, description, entityType, isPublished, templateData } = req.body;
    if (!name || !entityType || !templateData) {
      return res.status(400).json({ error: "Name, entityType, and templateData are required" });
    }
    const [template] = await db.insert(globalWorkflowTemplates).values({
      name,
      description: description || null,
      entityType,
      isPublished: isPublished || false,
      templateData,
      createdById: req.user!.id,
    }).returning();
    res.status(201).json(template);
  } catch (error: any) {
    logError("Create global workflow template error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create workflow template" });
  }
});

router.patch("/platform/workflow-templates/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.entityType !== undefined) updates.entityType = req.body.entityType;
    if (req.body.isPublished !== undefined) updates.isPublished = req.body.isPublished;
    if (req.body.templateData !== undefined) updates.templateData = req.body.templateData;

    const [updated] = await db.update(globalWorkflowTemplates).set(updates).where(eq(globalWorkflowTemplates.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Template not found" });
    res.json(updated);
  } catch (error: any) {
    logError("Update global workflow template error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update workflow template" });
  }
});

router.delete("/platform/workflow-templates/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await db.delete(globalWorkflowTemplates).where(eq(globalWorkflowTemplates.id, id));
    res.json({ message: "Template deleted" });
  } catch (error: any) {
    logError("Delete global workflow template error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete workflow template" });
  }
});

// ========================================
// Data Export & Deletion
// ========================================

router.get("/platform/organizations/:orgId/export", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const orgUsers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.organizationId, orgId));

    const userIds = orgUsers.map(u => u.id);

    let orgProjects: any[] = [];
    let orgBids: any[] = [];
    let orgTasks: any[] = [];
    let orgEquipment: any[] = [];
    let orgContracts: any[] = [];

    if (userIds.length > 0) {
      orgProjects = await db.select().from(projects).where(
        or(
          inArray(projects.estimatorId, userIds),
          inArray(projects.superintendentId, userIds),
          inArray(projects.projectManagerId, userIds)
        )
      );

      orgBids = await db.select().from(bids).where(inArray(bids.estimatorId, userIds));
    }

    orgTasks = await db.select().from(tasks).where(eq(tasks.organizationId, orgId));
    orgEquipment = await db.select().from(equipment).where(eq(equipment.organizationId, orgId));
    orgContracts = await db.select().from(contracts).where(eq(contracts.organizationId, orgId));

    const financialSummary = await db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(contract_amount) FROM projects WHERE estimator_id = ANY(${userIds}) OR superintendent_id = ANY(${userIds}) OR project_manager_id = ANY(${userIds})), 0)::text AS total_contract_value,
        COALESCE((SELECT SUM(bid_amount) FROM bids WHERE estimator_id = ANY(${userIds})), 0)::text AS total_bid_value,
        (SELECT COUNT(*) FROM pay_runs WHERE organization_id = ${orgId})::int AS payroll_runs
    `);

    const exportData = {
      exportedAt: new Date().toISOString(),
      organization: org,
      users: orgUsers,
      projects: orgProjects,
      bids: orgBids,
      tasks: orgTasks,
      equipment: orgEquipment,
      contracts: orgContracts,
      financialSummary: financialSummary.rows[0] || {},
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="org-${org.slug}-export-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(exportData);
  } catch (error: any) {
    logError("Data export error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to export organization data" });
  }
});

router.post("/platform/organizations/:orgId/delete-all-data", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const { confirmationName } = req.body;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) return res.status(404).json({ error: "Organization not found" });

    if (confirmationName !== org.name) {
      return res.status(400).json({ error: "Organization name does not match. Please type the exact organization name to confirm deletion." });
    }

    const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, orgId));
    const userIds = orgUsers.map(u => u.id);

    await db.transaction(async (tx) => {
      await tx.delete(tasks).where(eq(tasks.organizationId, orgId));
      await tx.delete(equipment).where(eq(equipment.organizationId, orgId));
      await tx.delete(organizationSowItems).where(eq(organizationSowItems.organizationId, orgId));
      await tx.delete(organizationWorkTypes).where(eq(organizationWorkTypes.organizationId, orgId));
      await tx.delete(contracts).where(eq(contracts.organizationId, orgId));

      if (userIds.length > 0) {
        await tx.delete(notifications).where(inArray(notifications.userId, userIds));
        await tx.delete(messages).where(inArray(messages.senderId, userIds));
        await tx.delete(conversationParticipants).where(inArray(conversationParticipants.userId, userIds));
        await tx.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, userIds));
        await tx.delete(announcementDismissals).where(inArray(announcementDismissals.userId, userIds));

        await tx.execute(sql`DELETE FROM bids WHERE estimator_id = ANY(${userIds})`);
        await tx.execute(sql`DELETE FROM projects WHERE estimator_id = ANY(${userIds}) OR superintendent_id = ANY(${userIds}) OR project_manager_id = ANY(${userIds})`);
      }

      await tx.delete(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, orgId));
      await tx.delete(users).where(eq(users.organizationId, orgId));
      await tx.delete(organizations).where(eq(organizations.id, orgId));
    });

    await logAudit({
      action: "DELETE",
      entityType: "organizations",
      entityId: orgId,
      userId: req.user!.id,
      oldValue: JSON.stringify({ name: org.name, slug: org.slug }),
      newValue: JSON.stringify({ fullDataDeletion: true, deletedAt: new Date().toISOString() }),
    }, req);

    console.log(`COMPLIANCE: Full data deletion for org "${org.name}" (${orgId}) by admin: ${req.user!.email}`);
    res.json({ message: `All data for organization "${org.name}" has been permanently deleted` });
  } catch (error: any) {
    logError("Data deletion error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete organization data. The operation was rolled back." });
  }
});

// ========================================
// View as Organization (Read-only dashboard for support)
// ========================================

router.get("/platform/organizations/:orgId/view-dashboard", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const [org] = await db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      tradeType: organizations.tradeType,
      isActive: organizations.isActive,
      region: organizations.region,
      createdAt: organizations.createdAt,
    }).from(organizations).where(eq(organizations.id, orgId));

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
    })
    .from(users)
    .where(eq(users.organizationId, orgId))
    .orderBy(users.role);

    const userIds = orgUsers.map(u => u.id);

    let orgProjects: { id: string; name: string; status: string; createdAt: Date }[] = [];
    if (userIds.length > 0) {
      orgProjects = await db.select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(
        or(
          inArray(projects.estimatorId, userIds),
          inArray(projects.superintendentId, userIds),
          inArray(projects.projectManagerId, userIds),
        )
      )
      .orderBy(desc(projects.createdAt))
      .limit(50);
    }

    let orgBids: { id: string; name: string; status: string; createdAt: Date }[] = [];
    if (userIds.length > 0) {
      orgBids = await db.select({
        id: bids.id,
        name: bids.name,
        status: bids.status,
        createdAt: bids.createdAt,
      })
      .from(bids)
      .where(inArray(bids.estimatorId, userIds))
      .orderBy(desc(bids.createdAt))
      .limit(50);
    }

    const [equipmentCount] = await db.select({ count: count() })
      .from(equipment)
      .where(eq(equipment.organizationId, orgId));

    const [taskCount] = await db.select({ count: count() })
      .from(tasks)
      .where(eq(tasks.organizationId, orgId));

    const activeProjects = orgProjects.filter(p => p.status === "ACTIVE").length;
    const completedProjects = orgProjects.filter(p => p.status === "COMPLETE" || p.status === "CLOSED").length;

    res.json({
      organization: org,
      stats: {
        userCount: orgUsers.length,
        projectCount: orgProjects.length,
        bidCount: orgBids.length,
        activeProjects,
        completedProjects,
        totalEquipment: equipmentCount?.count || 0,
        totalTasks: taskCount?.count || 0,
      },
      recentProjects: orgProjects,
      recentBids: orgBids,
      users: orgUsers,
    });
  } catch (error: any) {
    console.error("View as organization error:", error.message);
    res.status(500).json({ error: "Failed to load organization dashboard" });
  }
});

export default router;
