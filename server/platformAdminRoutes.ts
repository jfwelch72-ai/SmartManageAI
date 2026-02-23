import { Router } from "express";
import crypto from "crypto";
import { db } from "./db";
import { users, organizations, auditLog, projects, bids, timeClockShifts, organizationSowItems, organizationWorkTypes, organizationCalculators, passwordResetTokens, conversations, conversationParticipants, messages, tasks, notifications, scopeItems, estimateLineItems, dailyScopeProgress, estimates, organizationSubscriptions, organizationAddOns, organizationUsage } from "@shared/schema";
import { requireAuth, type AuthRequest, generateToken } from "./auth";
import { eq, count, desc, sql, and, gte, isNotNull, ilike, like } from "drizzle-orm";
import { sendEmail, getAdminPasswordResetEmailHtml, getPasswordResetEmailText } from "./email";
import { logAudit } from "./auditLogger";
import { PLAN_INFO, ADDON_INFO, HUSTLER_PLAN_INFO, type PlanTier, type AddOnKey } from "@shared/billing/plans";

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

    const baseUrl = process.env.APP_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
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

    console.log(`Admin-initiated password reset for user: ${user.email} by admin: ${req.user!.email}`);
    res.json({ message: `Password reset email sent to ${user.email}` });
  } catch (error: any) {
    console.error("Admin password reset error:", error.message);
    res.status(500).json({ error: "Failed to initiate password reset" });
  }
});

router.get("/platform/audit-report", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const fs = await import("fs");
    const path = await import("path");
    
    const reportPath = path.join(process.cwd(), "audit/reports/audit-report.json");
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: "No audit report found. Run the audit first." });
    }
    
    const reportContent = fs.readFileSync(reportPath, "utf-8");
    const report = JSON.parse(reportContent);
    
    res.json(report);
  } catch (error: any) {
    console.error("Audit report fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch audit report" });
  }
});

let lastAuditRun = 0;
const AUDIT_COOLDOWN_MS = 60000;

router.post("/platform/run-audit", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const now = Date.now();
    if (now - lastAuditRun < AUDIT_COOLDOWN_MS) {
      const waitTime = Math.ceil((AUDIT_COOLDOWN_MS - (now - lastAuditRun)) / 1000);
      return res.status(429).json({ error: `Rate limited. Please wait ${waitTime} seconds before running another audit.` });
    }
    
    lastAuditRun = now;
    
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    await logAudit({
      action: "CREATE",
      entityType: "system_audit",
      entityId: "platform-audit",
      userId: req.user!.id,
      newValue: JSON.stringify({ actionType: "run_audit", triggeredAt: new Date().toISOString() }),
    }, req);
    
    res.json({ message: "Audit started. Refresh the page in a few seconds to see results." });
    
    execAsync("npm run audit", { timeout: 120000 }).catch((error) => {
      console.error("Audit execution error:", error.message);
    });
    
  } catch (error: any) {
    console.error("Audit run error:", error.message);
    res.status(500).json({ error: "Failed to run audit" });
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
    console.error("Platform archived users error:", error.message);
    res.status(500).json({ error: "Failed to fetch archived users" });
  }
});

// Impersonate user - generate a temporary login token for Super Admin to access user account
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

    // Generate a short-lived token for impersonation (1 hour expiry)
    const impersonationToken = generateToken(user.id, user.tokenVersion);

    // Log the impersonation action for audit purposes (using UPDATE as the action type)
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
      token: impersonationToken,
      message: `Impersonation token generated for ${user.email}` 
    });
  } catch (error: any) {
    console.error("Impersonate user error:", error.message);
    res.status(500).json({ error: "Failed to generate impersonation token" });
  }
});

// Restore archived user (set isActive to true)
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
    console.error("Restore user error:", error.message);
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
    console.error("Soft delete user error:", error.message);
    res.status(500).json({ error: "Failed to deactivate user" });
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

    // Clean up all related records before deleting the user
    // Order matters due to foreign key dependencies
    
    // Messages sent by user
    await db.delete(messages).where(eq(messages.senderId, userId));
    
    // Conversation participants
    await db.delete(conversationParticipants).where(eq(conversationParticipants.userId, userId));
    
    // Conversations created by user
    await db.delete(conversations).where(eq(conversations.createdById, userId));
    
    // Tasks assigned to or created by user
    await db.delete(tasks).where(eq(tasks.assignedToId, userId));
    await db.delete(tasks).where(eq(tasks.createdById, userId));
    
    // Notifications
    await db.delete(notifications).where(eq(notifications.userId, userId));
    
    // Password reset tokens
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    
    // Finally delete the user
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
    console.error("Permanent delete user error:", error.message);
    res.status(500).json({ error: "Failed to permanently delete user" });
  }
});

// Backfill organizationSowItemId for scope_items, estimate_line_items, and daily_scope_progress
// Matches by description similarity within the same organization
router.post("/platform/backfill-sow-links", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const results = {
      scopeItemsUpdated: 0,
      estimateLineItemsUpdated: 0,
      dailyProgressUpdated: 0,
      sovLineItemsUpdated: 0,
      errors: [] as string[],
    };

    // Get all organizations with their SOW items
    const allOrgs = await db.select({ id: organizations.id }).from(organizations);

    for (const org of allOrgs) {
      // Get organization's SOW items for matching
      const orgSowItems = await db
        .select()
        .from(organizationSowItems)
        .where(eq(organizationSowItems.organizationId, org.id));

      if (orgSowItems.length === 0) continue;

      // Build a lookup map for faster matching (normalized name -> sowItem)
      const sowLookup = new Map<string, typeof orgSowItems[0]>();
      for (const sow of orgSowItems) {
        const normalizedName = sow.name.toLowerCase().trim();
        sowLookup.set(normalizedName, sow);
      }

      // Get all scope items that don't have organizationSowItemId but belong to projects
      // linked to this organization's estimates/bids
      const unlinkedScopeItems = await db.execute(sql`
        SELECT si.* FROM scope_items si
        JOIN projects p ON si.project_id = p.id
        JOIN estimates e ON e.project_id = p.id
        JOIN bids b ON e.bid_id = b.id
        WHERE b.gc_organization_id = ${org.id}
        AND si.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedScopeItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db
            .update(scopeItems)
            .set({ organizationSowItemId: matchedSow.id, updatedAt: new Date() })
            .where(eq(scopeItems.id, item.id));
          results.scopeItemsUpdated++;

          // Also update any daily progress entries for this scope item
          const updatedProgress = await db
            .update(dailyScopeProgress)
            .set({ organizationSowItemId: matchedSow.id })
            .where(and(
              eq(dailyScopeProgress.scopeItemId, item.id),
              sql`${dailyScopeProgress.organizationSowItemId} IS NULL`
            ))
            .returning();
          results.dailyProgressUpdated += updatedProgress.length;
        }
      }

      // Get estimate line items that don't have organizationSowItemId
      const unlinkedLineItems = await db.execute(sql`
        SELECT eli.* FROM estimate_line_items eli
        JOIN estimates e ON eli.estimate_id = e.id
        JOIN bids b ON e.bid_id = b.id
        WHERE b.gc_organization_id = ${org.id}
        AND eli.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedLineItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db
            .update(estimateLineItems)
            .set({ organizationSowItemId: matchedSow.id, updatedAt: new Date() })
            .where(eq(estimateLineItems.id, item.id));
          results.estimateLineItemsUpdated++;
        }
      }

      // Get SOV line items that don't have organizationSowItemId but belong to this org's projects
      const unlinkedSovLineItems = await db.execute(sql`
        SELECT sli.* FROM sov_line_items sli
        JOIN schedule_of_values sov ON sli.sov_id = sov.id
        WHERE sov.organization_id = ${org.id}
        AND sli.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedSovLineItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db.execute(sql`
            UPDATE sov_line_items 
            SET organization_sow_item_id = ${matchedSow.id}, updated_at = NOW()
            WHERE id = ${item.id}
          `);
          results.sovLineItemsUpdated++;
        }
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "system",
      entityId: "sow_backfill",
      oldValue: null,
      newValue: JSON.stringify(results),
    }, req);

    console.log("SOW backfill completed:", results);
    res.json({
      message: "SOW link backfill completed",
      ...results,
    });
  } catch (error: any) {
    console.error("SOW backfill error:", error.message);
    res.status(500).json({ error: "Failed to backfill SOW links", details: error.message });
  }
});

// Get SOW link statistics for monitoring
router.get("/platform/sow-link-stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const stats = await db.execute(sql`
      SELECT 
        'scope_items_without_sow' as metric, COUNT(*) as count 
      FROM scope_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'estimate_line_items_without_sow' as metric, COUNT(*) as count 
      FROM estimate_line_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'daily_progress_without_sow' as metric, COUNT(*) as count 
      FROM daily_scope_progress WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'sov_line_items_without_sow' as metric, COUNT(*) as count 
      FROM sov_line_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'total_scope_items' as metric, COUNT(*) as count FROM scope_items
      UNION ALL
      SELECT 'total_estimate_line_items' as metric, COUNT(*) as count FROM estimate_line_items
      UNION ALL
      SELECT 'total_daily_progress' as metric, COUNT(*) as count FROM daily_scope_progress
      UNION ALL
      SELECT 'total_sov_line_items' as metric, COUNT(*) as count FROM sov_line_items
    `);

    res.json(stats.rows);
  } catch (error: any) {
    console.error("SOW stats error:", error.message);
    res.status(500).json({ error: "Failed to get SOW link stats" });
  }
});

router.get("/platform/subscriptions/stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const byPlanTier = await db.select({
      planTier: organizationSubscriptions.planTier,
      count: count(),
    })
    .from(organizationSubscriptions)
    .groupBy(organizationSubscriptions.planTier);

    const byStatus = await db.select({
      status: organizationSubscriptions.status,
      count: count(),
    })
    .from(organizationSubscriptions)
    .groupBy(organizationSubscriptions.status);

    const addonStats = await db.select({
      addonKey: organizationAddOns.addonKey,
      count: count(),
    })
    .from(organizationAddOns)
    .where(eq(organizationAddOns.status, "active"))
    .groupBy(organizationAddOns.addonKey);

    const [totalOrgs] = await db.select({ count: count() }).from(organizationSubscriptions);

    let estimatedMrr = 0;
    for (const row of byPlanTier) {
      const info = PLAN_INFO[row.planTier as PlanTier];
      if (info) {
        estimatedMrr += info.price * row.count;
      }
    }

    const activeAddonCount = await db.select({ count: count() })
      .from(organizationAddOns)
      .where(eq(organizationAddOns.status, "active"));

    for (const addon of addonStats) {
      const info = ADDON_INFO[addon.addonKey as AddOnKey];
      if (info) {
        estimatedMrr += info.price * addon.count;
      }
    }

    const recentChanges = await db.select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      newValue: auditLog.newValue,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.entityType, "subscription"))
    .orderBy(desc(auditLog.createdAt))
    .limit(10);

    res.json({
      totalSubscriptions: totalOrgs.count,
      byPlanTier,
      byStatus,
      addonAdoption: addonStats,
      estimatedMrr,
      recentChanges,
    });
  } catch (error: any) {
    console.error("Subscription stats error:", error.message);
    res.status(500).json({ error: "Failed to get subscription stats" });
  }
});

router.get("/platform/subscriptions", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { planTier, status, search, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (planTier && planTier !== "all") {
      conditions.push(eq(organizationSubscriptions.planTier, planTier as string));
    }
    if (status && status !== "all") {
      conditions.push(eq(organizationSubscriptions.status, status as string));
    }

    let searchCondition: any = undefined;
    if (search && typeof search === "string" && search.trim()) {
      searchCondition = ilike(organizations.name, `%${search.trim()}%`);
    }

    const allConditions = searchCondition
      ? (conditions.length > 0 ? and(...conditions, searchCondition) : searchCondition)
      : (conditions.length > 0 ? and(...conditions) : undefined);

    const baseQuery = db
      .select({
        subscriptionId: organizationSubscriptions.id,
        orgId: organizations.id,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        tradeType: organizations.tradeType,
        planTier: organizationSubscriptions.planTier,
        status: organizationSubscriptions.status,
        billingProvider: organizationSubscriptions.billingProvider,
        currentPeriodEnd: organizationSubscriptions.currentPeriodEnd,
        createdAt: organizationSubscriptions.createdAt,
        updatedAt: organizationSubscriptions.updatedAt,
      })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id));

    const dataQuery = allConditions
      ? baseQuery.where(allConditions)
      : baseQuery;

    const rows = await dataQuery
      .orderBy(desc(organizationSubscriptions.updatedAt))
      .limit(limitNum)
      .offset(offset);

    const countQuery = db
      .select({ count: count() })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id));

    const [totalRow] = allConditions
      ? await countQuery.where(allConditions)
      : await countQuery;

    const orgIds = rows.map(r => r.orgId);
    let userCounts: Record<string, number> = {};
    let addonCounts: Record<string, number> = {};

    if (orgIds.length > 0) {
      const userCountRows = await db.select({
        orgId: users.organizationId,
        count: count(),
      })
      .from(users)
      .where(sql`${users.organizationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`)
      .groupBy(users.organizationId);

      for (const r of userCountRows) {
        if (r.orgId) userCounts[r.orgId] = r.count;
      }

      const addonCountRows = await db.select({
        orgId: organizationAddOns.organizationId,
        count: count(),
      })
      .from(organizationAddOns)
      .where(and(
        sql`${organizationAddOns.organizationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`,
        eq(organizationAddOns.status, "active")
      ))
      .groupBy(organizationAddOns.organizationId);

      for (const r of addonCountRows) {
        addonCounts[r.orgId] = r.count;
      }
    }

    const subscriptions = rows.map(r => ({
      ...r,
      userCount: userCounts[r.orgId] || 0,
      activeAddonCount: addonCounts[r.orgId] || 0,
      planPrice: PLAN_INFO[r.planTier as PlanTier]?.price || 0,
      planName: PLAN_INFO[r.planTier as PlanTier]?.name || r.planTier,
    }));

    res.json({
      subscriptions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalRow.count,
        totalPages: Math.ceil(totalRow.count / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Subscriptions list error:", error.message);
    res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

router.get("/platform/subscriptions/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const [subscription] = await db.select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .limit(1);

    const addons = await db.select()
      .from(organizationAddOns)
      .where(eq(organizationAddOns.organizationId, orgId));

    const usage = await db.select()
      .from(organizationUsage)
      .where(eq(organizationUsage.organizationId, orgId));

    const [userCount] = await db.select({ count: count() })
      .from(users)
      .where(eq(users.organizationId, orgId));

    const recentAudit = await db.select()
      .from(auditLog)
      .where(and(
        eq(auditLog.entityType, "subscription"),
        eq(auditLog.entityId, orgId)
      ))
      .orderBy(desc(auditLog.createdAt))
      .limit(20);

    res.json({
      organization: { id: org.id, name: org.name, slug: org.slug, tradeType: org.tradeType, createdAt: org.createdAt },
      subscription: subscription || null,
      addons,
      usage,
      userCount: userCount.count,
      planInfo: subscription ? PLAN_INFO[subscription.planTier as PlanTier] : null,
      recentAudit,
    });
  } catch (error: any) {
    console.error("Subscription detail error:", error.message);
    res.status(500).json({ error: "Failed to get subscription details" });
  }
});

router.patch("/platform/subscriptions/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const { planTier, status } = req.body;

    const [subscription] = await db.select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .limit(1);

    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    const updates: any = { updatedAt: new Date() };
    const changes: string[] = [];

    if (planTier && ["free", "starter", "professional", "enterprise"].includes(planTier)) {
      changes.push(`planTier: ${subscription.planTier} → ${planTier}`);
      updates.planTier = planTier;
    }

    if (status && ["active", "trialing", "past_due", "canceled"].includes(status)) {
      changes.push(`status: ${subscription.status} → ${status}`);
      updates.status = status;
    }

    if (changes.length === 0) {
      return res.status(400).json({ error: "No valid changes provided" });
    }

    const [updated] = await db.update(organizationSubscriptions)
      .set(updates)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .returning();

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: orgId,
        action: "UPDATE",
        newValue: JSON.stringify({ changes, planTier: updates.planTier, status: updates.status }),
      },
      req
    );

    res.json({ subscription: updated, changes });
  } catch (error: any) {
    console.error("Subscription update error:", error.message);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

router.patch("/platform/subscriptions/:orgId/addons/:addonKey", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId, addonKey } = req.params;
    const { status } = req.body;

    if (!status || !["active", "inactive"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'active' or 'inactive'" });
    }

    const [existing] = await db.select()
      .from(organizationAddOns)
      .where(and(
        eq(organizationAddOns.organizationId, orgId),
        eq(organizationAddOns.addonKey, addonKey)
      ))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db.update(organizationAddOns)
        .set({ status, updatedAt: new Date() })
        .where(eq(organizationAddOns.id, existing.id))
        .returning();
    } else {
      [result] = await db.insert(organizationAddOns)
        .values({ organizationId: orgId, addonKey: addonKey as any, status, updatedAt: new Date() })
        .returning();
    }

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: orgId,
        action: "UPDATE",
        newValue: JSON.stringify({ addon: addonKey, status }),
      },
      req
    );

    res.json({ addon: result });
  } catch (error: any) {
    console.error("Addon update error:", error.message);
    res.status(500).json({ error: "Failed to update addon" });
  }
});

router.post("/platform/subscriptions", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { organizationId, planTier, status, billingProvider } = req.body;

    if (!organizationId) {
      return res.status(400).json({ error: "organizationId is required" });
    }

    if (!planTier || !["free", "starter", "professional", "enterprise"].includes(planTier)) {
      return res.status(400).json({ error: "Valid planTier is required (free, starter, professional, enterprise)" });
    }

    const [org] = await db.select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [existing] = await db.select({ id: organizationSubscriptions.id })
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Organization already has a subscription. Use the update endpoint instead." });
    }

    const [newSub] = await db.insert(organizationSubscriptions)
      .values({
        organizationId,
        planTier: planTier as any,
        status: status || "active",
        billingProvider: billingProvider || "manual",
      })
      .returning();

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: organizationId,
        action: "CREATE",
        newValue: JSON.stringify({ planTier, status: status || "active", orgName: org.name }),
      },
      req
    );

    res.status(201).json({ subscription: newSub });
  } catch (error: any) {
    console.error("Create subscription error:", error.message);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

router.delete("/platform/subscriptions/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const [existing] = await db.select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    await db.delete(organizationAddOns)
      .where(eq(organizationAddOns.organizationId, orgId));

    await db.delete(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId));

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: orgId,
        action: "DELETE",
        oldValue: JSON.stringify({ planTier: existing.planTier, status: existing.status }),
      },
      req
    );

    res.json({ success: true, message: "Subscription deleted" });
  } catch (error: any) {
    console.error("Delete subscription error:", error.message);
    res.status(500).json({ error: "Failed to delete subscription" });
  }
});

router.get("/platform/organizations-without-subscription", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const orgsWithSubs = db.select({ orgId: organizationSubscriptions.organizationId }).from(organizationSubscriptions);

    const orgsWithoutSubs = await db.select({
      id: organizations.id,
      name: organizations.name,
      tradeType: organizations.tradeType,
    })
      .from(organizations)
      .where(sql`${organizations.id} NOT IN (${orgsWithSubs})`)
      .orderBy(organizations.name)
      .limit(100);

    res.json(orgsWithoutSubs);
  } catch (error: any) {
    console.error("Fetch orgs without subscription error:", error.message);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

export default router;
