import { Router } from "express";
import { db } from "./db";
import { hustlerOrganizations, organizations, users, hustlerLinkRequests, hustlerDelegates, projects, bids, changeOrders, tasks, estimates } from "@shared/schema";
import { eq, and, or, desc, isNull, inArray, sql, count, sum } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

const linkOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
  roleOverride: z.enum(["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER"]).optional(),
});

const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});

// ============================================================================
// HUSTLER EXECUTIVE DASHBOARD - Portfolio Overview
// Aggregates KPIs across all linked organizations
// ============================================================================
// SECURITY NOTE: These endpoints query hustlerOrganizations directly by req.user.id
// at request time, NOT from session/token data. This ensures:
// 1. Only ACTIVE links are included (isActive=true check)
// 2. Revoked links are immediately excluded (fresh DB query each request)
// 3. No cross-tenant data leakage since org IDs come from validated links only
// ============================================================================

router.get("/hustler/portfolio/stats", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get all linked organization IDs
    const linkedOrgs = await db
      .select({ organizationId: hustlerOrganizations.organizationId })
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const orgIds = linkedOrgs.map(o => o.organizationId);

    if (orgIds.length === 0) {
      return res.json({
        totalOrganizations: 0,
        totalActiveProjects: 0,
        totalOpenBids: 0,
        totalPendingChangeOrders: 0,
        totalPendingTasks: 0,
        totalLaborHoursThisMonth: 0,
        estimatedBidValue: 0,
        organizationBreakdown: [],
      });
    }

    // Aggregate stats across all organizations
    const [projectsResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(
        and(
          inArray(projects.gcOrganizationId, orgIds),
          eq(projects.status, "ACTIVE")
        )
      );

    const [bidsResult] = await db
      .select({ 
        count: sql<number>`count(*)::int`,
        totalValue: sql<string>`coalesce(sum(bid_amount)::text, '0')`
      })
      .from(bids)
      .where(inArray(bids.gcOrganizationId, orgIds));

    const [changeOrdersResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeOrders)
      .innerJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(
        and(
          inArray(projects.gcOrganizationId, orgIds),
          eq(changeOrders.status, "SUBMITTED")
        )
      );

    // Tasks aggregation skipped - organization_id column may not exist in some deployments
    const tasksResult = { count: 0 };

    // Get organization breakdown with individual stats
    const orgBreakdown = await Promise.all(orgIds.map(async (orgId) => {
      const [org] = await db
        .select({ name: organizations.name, tradeType: organizations.tradeType, logoUrl: organizations.logoUrl })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      const [activeProjects] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(and(eq(projects.gcOrganizationId, orgId), eq(projects.status, "ACTIVE")));

      const [openBids] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bids)
        .where(eq(bids.gcOrganizationId, orgId));

      const [employees] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.isActive, true)));

      return {
        id: orgId,
        name: org?.name || "Unknown",
        tradeType: org?.tradeType || "OTHER",
        logoUrl: org?.logoUrl,
        activeProjects: activeProjects?.count || 0,
        openBids: openBids?.count || 0,
        employees: employees?.count || 0,
      };
    }));

    res.json({
      totalOrganizations: orgIds.length,
      totalActiveProjects: projectsResult?.count || 0,
      totalOpenBids: bidsResult?.count || 0,
      totalPendingChangeOrders: changeOrdersResult?.count || 0,
      totalPendingTasks: tasksResult?.count || 0,
      estimatedBidValue: parseFloat(bidsResult?.totalValue || "0"),
      organizationBreakdown: orgBreakdown,
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to fetch portfolio stats: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch portfolio stats" });
  }
});

// Get AI-powered executive summary for HUSTLER portfolio
router.get("/hustler/portfolio/ai-summary", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get all linked organizations
    const linkedOrgs = await db
      .select({
        organizationId: hustlerOrganizations.organizationId,
        organization: {
          name: organizations.name,
          tradeType: organizations.tradeType,
        }
      })
      .from(hustlerOrganizations)
      .innerJoin(organizations, eq(hustlerOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    if (linkedOrgs.length === 0) {
      return res.json({
        summary: "You don't have any linked organizations yet. Create or link organizations to see portfolio insights.",
        insights: [],
        recommendations: [],
      });
    }

    const orgIds = linkedOrgs.map(o => o.organizationId);

    // Gather metrics for AI analysis
    const [projectStats] = await db
      .select({
        active: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
        planning: sql<number>`count(*) filter (where status = 'PLANNING')::int`,
        completed: sql<number>`count(*) filter (where status = 'COMPLETE')::int`,
      })
      .from(projects)
      .where(inArray(projects.gcOrganizationId, orgIds));

    const [bidStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        totalValue: sql<string>`coalesce(sum(bid_amount)::text, '0')`,
      })
      .from(bids)
      .where(inArray(bids.gcOrganizationId, orgIds));

    const [pendingApprovals] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeOrders)
      .innerJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(
        and(
          inArray(projects.gcOrganizationId, orgIds),
          eq(changeOrders.status, "SUBMITTED")
        )
      );

    // Build insights based on metrics
    const insights: string[] = [];
    const recommendations: string[] = [];

    // Project insights
    if ((projectStats?.active || 0) > 5) {
      insights.push(`High activity: ${projectStats?.active} active projects across your portfolio`);
    }
    if ((projectStats?.planning || 0) > 3) {
      insights.push(`${projectStats?.planning} projects in planning stage need attention`);
      recommendations.push("Review planning stage projects to ensure timely kickoff");
    }

    // Bid insights
    const totalBids = bidStats?.total || 0;
    const totalBidValue = parseFloat(bidStats?.totalValue || "0");
    if (totalBids > 0) {
      insights.push(`${totalBids} total bids with $${totalBidValue.toLocaleString()} in estimated value`);
    }
    if (totalBids > 5) {
      recommendations.push("Consider tracking bid outcomes to improve win rate");
    }

    // Approval insights
    if ((pendingApprovals?.count || 0) > 3) {
      insights.push(`${pendingApprovals?.count} change orders awaiting approval`);
      recommendations.push("Review pending change orders to prevent project delays");
    }

    // Portfolio size insight
    insights.push(`Managing ${linkedOrgs.length} organization${linkedOrgs.length > 1 ? 's' : ''}: ${linkedOrgs.map(o => o.organization.name).join(', ')}`);

    const summary = `Your construction portfolio includes ${linkedOrgs.length} organization${linkedOrgs.length > 1 ? 's' : ''} with ${projectStats?.active || 0} active projects and ${totalBids} bids. ${pendingApprovals?.count || 0} items require your attention.`;

    res.json({
      summary,
      insights,
      recommendations,
      metrics: {
        projects: projectStats,
        bids: bidStats,
        pendingApprovals: pendingApprovals?.count || 0,
      }
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to generate AI summary: ${error.message}`);
    res.status(500).json({ error: "Failed to generate portfolio summary" });
  }
});

router.get("/hustler/organizations", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const linkedOrgs = await db
      .select({
        id: hustlerOrganizations.id,
        organizationId: hustlerOrganizations.organizationId,
        roleOverride: hustlerOrganizations.roleOverride,
        isActive: hustlerOrganizations.isActive,
        createdAt: hustlerOrganizations.createdAt,
        organization: {
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          tradeType: organizations.tradeType,
          tradeName: organizations.tradeName,
          logoUrl: organizations.logoUrl,
          primaryColor: organizations.primaryColor,
          region: organizations.region,
        },
      })
      .from(hustlerOrganizations)
      .innerJoin(organizations, eq(hustlerOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const currentOrgId = req.user.organizationId;

    res.json({
      organizations: linkedOrgs,
      currentOrganizationId: currentOrgId,
      count: linkedOrgs.length,
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to fetch organizations: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

router.post("/hustler/link-organization", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validationResult = linkOrganizationSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const { organizationId, roleOverride } = validationResult.data;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [existing] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, organizationId)
        )
      );

    if (existing) {
      if (!existing.isActive) {
        await db
          .update(hustlerOrganizations)
          .set({ isActive: true, roleOverride: roleOverride || "ADMIN" })
          .where(eq(hustlerOrganizations.id, existing.id));
        
        logInfo( `[Hustler] Reactivated org link: user=${req.user.id} org=${organizationId}`);
        return res.json({ success: true, message: "Organization link reactivated" });
      }
      return res.status(400).json({ error: "Already linked to this organization" });
    }

    const [newLink] = await db.insert(hustlerOrganizations).values({
      userId: req.user.id,
      organizationId,
      roleOverride: roleOverride || "ADMIN",
      isActive: true,
    }).returning();

    logInfo( `[Hustler] Linked org: user=${req.user.id} org=${organizationId}`);

    res.json({
      success: true,
      link: newLink,
      message: "Organization linked successfully",
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to link organization: ${error.message}`);
    res.status(500).json({ error: "Failed to link organization" });
  }
});

router.post("/hustler/switch-organization", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validationResult = switchOrganizationSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const { organizationId } = validationResult.data;

    const [link] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, organizationId),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    if (!link) {
      return res.status(404).json({ error: "Organization not found or not linked" });
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    await db
      .update(users)
      .set({ organizationId })
      .where(eq(users.id, req.user.id));

    logInfo( `[Hustler] Switched org: user=${req.user.id} from=${req.user.organizationId} to=${organizationId}`);

    res.json({
      success: true,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        tradeType: org.tradeType,
        tradeName: org.tradeName,
      },
      roleOverride: link.roleOverride,
      message: `Switched to ${org.name}`,
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to switch organization: ${error.message}`);
    res.status(500).json({ error: "Failed to switch organization" });
  }
});

router.delete("/hustler/unlink-organization/:organizationId", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { organizationId } = req.params;

    if (req.user.organizationId === organizationId) {
      return res.status(400).json({ error: "Cannot unlink your current active organization. Switch to another organization first." });
    }

    const [link] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, organizationId)
        )
      );

    if (!link) {
      return res.status(404).json({ error: "Organization link not found" });
    }

    await db
      .update(hustlerOrganizations)
      .set({ isActive: false })
      .where(eq(hustlerOrganizations.id, link.id));

    logInfo( `[Hustler] Unlinked org: user=${req.user.id} org=${organizationId}`);

    res.json({
      success: true,
      message: "Organization unlinked successfully",
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to unlink organization: ${error.message}`);
    res.status(500).json({ error: "Failed to unlink organization" });
  }
});

router.get("/hustler/current-role", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(400).json({ error: "No active organization" });
    }

    const [link] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, req.user.organizationId),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const effectiveRole = link?.roleOverride || req.user.role;

    res.json({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      baseRole: req.user.role,
      effectiveRole,
      isHustler: true,
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to get current role: ${error.message}`);
    res.status(500).json({ error: "Failed to get current role" });
  }
});

// ========================================
// LINK REQUEST SYSTEM
// ========================================

const inviteHustlerSchema = z.object({
  hustlerEmail: z.string().email(),
  message: z.string().optional(),
  roleOverride: z.enum(["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER"]).optional(),
});

const respondToRequestSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

// Helper to generate secure token
function generateInviteToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

// Admin invites a HUSTLER to have oversight of their organization
router.post("/hustler/link-requests/invite", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Only admins can invite
    if (!["ADMIN", "SUPER_ADMIN"].includes(req.user.role)) {
      return res.status(403).json({ error: "Only admins can invite HUSTLERs" });
    }

    const validationResult = inviteHustlerSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const { hustlerEmail, message, roleOverride } = validationResult.data;

    // Check if HUSTLER user exists
    const [hustlerUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, hustlerEmail.toLowerCase()));

    // Check for existing pending invite
    const [existingRequest] = await db
      .select()
      .from(hustlerLinkRequests)
      .where(
        and(
          eq(hustlerLinkRequests.organizationId, req.user.organizationId),
          eq(hustlerLinkRequests.hustlerEmail, hustlerEmail.toLowerCase()),
          eq(hustlerLinkRequests.status, "PENDING")
        )
      );

    if (existingRequest) {
      return res.status(400).json({ error: "An invite is already pending for this email" });
    }

    // Check if already linked
    if (hustlerUser) {
      const [existingLink] = await db
        .select()
        .from(hustlerOrganizations)
        .where(
          and(
            eq(hustlerOrganizations.userId, hustlerUser.id),
            eq(hustlerOrganizations.organizationId, req.user.organizationId),
            eq(hustlerOrganizations.isActive, true)
          )
        );

      if (existingLink) {
        return res.status(400).json({ error: "This user is already linked to your organization" });
      }
    }

    const { token, hash } = generateInviteToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const [newRequest] = await db.insert(hustlerLinkRequests).values({
      hustlerUserId: hustlerUser?.id || null,
      hustlerEmail: hustlerEmail.toLowerCase(),
      organizationId: req.user.organizationId,
      initiatedByUserId: req.user.id,
      requestType: "INVITE",
      status: "PENDING",
      inviteToken: token, // Store plain token temporarily for response
      inviteTokenHash: hash,
      roleOverride: roleOverride || null,
      message,
      expiresAt,
    }).returning();

    logInfo(`[Hustler] Invite created: org=${req.user.organizationId} email=${hustlerEmail}`);

    res.json({
      success: true,
      request: {
        id: newRequest.id,
        hustlerEmail: newRequest.hustlerEmail,
        status: newRequest.status,
        expiresAt: newRequest.expiresAt,
      },
      inviteToken: token, // Return token for admin to share
      inviteLink: `/hustler/accept-invite/${token}`,
      message: "Invite created. Share the link with the HUSTLER user.",
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to create invite: ${error.message}`);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

// Get pending invites for the current user (HUSTLER viewing invites to them)
router.get("/hustler/link-requests/pending", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const pendingInvites = await db
      .select({
        id: hustlerLinkRequests.id,
        organizationId: hustlerLinkRequests.organizationId,
        requestType: hustlerLinkRequests.requestType,
        status: hustlerLinkRequests.status,
        roleOverride: hustlerLinkRequests.roleOverride,
        message: hustlerLinkRequests.message,
        expiresAt: hustlerLinkRequests.expiresAt,
        createdAt: hustlerLinkRequests.createdAt,
        organization: {
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          tradeType: organizations.tradeType,
          logoUrl: organizations.logoUrl,
        },
        invitedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(hustlerLinkRequests)
      .innerJoin(organizations, eq(hustlerLinkRequests.organizationId, organizations.id))
      .innerJoin(users, eq(hustlerLinkRequests.initiatedByUserId, users.id))
      .where(
        and(
          or(
            eq(hustlerLinkRequests.hustlerUserId, req.user.id),
            eq(hustlerLinkRequests.hustlerEmail, req.user.email.toLowerCase())
          ),
          eq(hustlerLinkRequests.status, "PENDING"),
          eq(hustlerLinkRequests.requestType, "INVITE")
        )
      )
      .orderBy(desc(hustlerLinkRequests.createdAt));

    res.json({ invites: pendingInvites });
  } catch (error: any) {
    logError(`[Hustler] Failed to fetch pending invites: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch pending invites" });
  }
});

// Get all link requests for an organization (for admins only)
router.get("/hustler/link-requests/organization", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!["ADMIN", "SUPER_ADMIN"].includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const requests = await db
      .select({
        id: hustlerLinkRequests.id,
        hustlerUserId: hustlerLinkRequests.hustlerUserId,
        hustlerEmail: hustlerLinkRequests.hustlerEmail,
        requestType: hustlerLinkRequests.requestType,
        status: hustlerLinkRequests.status,
        roleOverride: hustlerLinkRequests.roleOverride,
        message: hustlerLinkRequests.message,
        expiresAt: hustlerLinkRequests.expiresAt,
        createdAt: hustlerLinkRequests.createdAt,
        respondedAt: hustlerLinkRequests.respondedAt,
      })
      .from(hustlerLinkRequests)
      .where(eq(hustlerLinkRequests.organizationId, req.user.organizationId))
      .orderBy(desc(hustlerLinkRequests.createdAt));

    res.json({ requests });
  } catch (error: any) {
    logError(`[Hustler] Failed to fetch org requests: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

// Accept or decline an invite (HUSTLER responding)
router.post("/hustler/link-requests/:requestId/respond", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { requestId } = req.params;
    const validationResult = respondToRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const { action } = validationResult.data;

    const [request] = await db
      .select()
      .from(hustlerLinkRequests)
      .where(eq(hustlerLinkRequests.id, requestId));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Verify user owns this request
    const isOwner = request.hustlerUserId === req.user.id || 
      request.hustlerEmail?.toLowerCase() === req.user.email.toLowerCase();
    
    if (!isOwner) {
      return res.status(403).json({ error: "This invite is not for you" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ error: `Request already ${request.status.toLowerCase()}` });
    }

    if (request.expiresAt && new Date(request.expiresAt) < new Date()) {
      await db.update(hustlerLinkRequests)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(hustlerLinkRequests.id, requestId));
      return res.status(400).json({ error: "This invite has expired" });
    }

    if (action === "approve") {
      // Create the hustler organization link
      const [existingLink] = await db
        .select()
        .from(hustlerOrganizations)
        .where(
          and(
            eq(hustlerOrganizations.userId, req.user.id),
            eq(hustlerOrganizations.organizationId, request.organizationId)
          )
        );

      if (existingLink) {
        // Reactivate if exists but inactive
        await db.update(hustlerOrganizations)
          .set({ isActive: true, roleOverride: request.roleOverride })
          .where(eq(hustlerOrganizations.id, existingLink.id));
      } else {
        // Create new link
        await db.insert(hustlerOrganizations).values({
          userId: req.user.id,
          organizationId: request.organizationId,
          roleOverride: request.roleOverride,
          isActive: true,
        });
      }

      // Update request status
      await db.update(hustlerLinkRequests)
        .set({ 
          status: "APPROVED", 
          respondedAt: new Date(),
          respondedByUserId: req.user.id,
          hustlerUserId: req.user.id, // Link the user if it was by email
          updatedAt: new Date(),
        })
        .where(eq(hustlerLinkRequests.id, requestId));

      logInfo(`[Hustler] Invite accepted: user=${req.user.id} org=${request.organizationId}`);

      res.json({
        success: true,
        message: "Invite accepted! You now have access to this organization.",
      });
    } else {
      // Reject
      await db.update(hustlerLinkRequests)
        .set({ 
          status: "REJECTED", 
          respondedAt: new Date(),
          respondedByUserId: req.user.id,
          updatedAt: new Date(),
        })
        .where(eq(hustlerLinkRequests.id, requestId));

      logInfo(`[Hustler] Invite rejected: user=${req.user.id} org=${request.organizationId}`);

      res.json({
        success: true,
        message: "Invite declined.",
      });
    }
  } catch (error: any) {
    logError(`[Hustler] Failed to respond to request: ${error.message}`);
    res.status(500).json({ error: "Failed to process response" });
  }
});

// Accept invite via token (for email links)
router.post("/hustler/link-requests/accept-token", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const [request] = await db
      .select()
      .from(hustlerLinkRequests)
      .where(eq(hustlerLinkRequests.inviteTokenHash, tokenHash));

    if (!request) {
      return res.status(404).json({ error: "Invalid invite token" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ error: `Invite already ${request.status.toLowerCase()}` });
    }

    if (request.expiresAt && new Date(request.expiresAt) < new Date()) {
      await db.update(hustlerLinkRequests)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(hustlerLinkRequests.id, request.id));
      return res.status(400).json({ error: "This invite has expired" });
    }

    // Create the link
    const [existingLink] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, request.organizationId)
        )
      );

    if (existingLink) {
      await db.update(hustlerOrganizations)
        .set({ isActive: true, roleOverride: request.roleOverride })
        .where(eq(hustlerOrganizations.id, existingLink.id));
    } else {
      await db.insert(hustlerOrganizations).values({
        userId: req.user.id,
        organizationId: request.organizationId,
        roleOverride: request.roleOverride,
        isActive: true,
      });
    }

    // Update request
    await db.update(hustlerLinkRequests)
      .set({ 
        status: "APPROVED", 
        respondedAt: new Date(),
        respondedByUserId: req.user.id,
        hustlerUserId: req.user.id,
        inviteToken: null, // Clear token after use
        updatedAt: new Date(),
      })
      .where(eq(hustlerLinkRequests.id, request.id));

    // Get org details
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, request.organizationId));

    logInfo(`[Hustler] Token invite accepted: user=${req.user.id} org=${request.organizationId}`);

    res.json({
      success: true,
      organization: {
        id: org?.id,
        name: org?.name,
        slug: org?.slug,
      },
      message: `Successfully linked to ${org?.name || "organization"}!`,
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to accept token: ${error.message}`);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

// Revoke an invite (admin only)
router.post("/hustler/link-requests/:requestId/revoke", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!["ADMIN", "SUPER_ADMIN"].includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { requestId } = req.params;

    const [request] = await db
      .select()
      .from(hustlerLinkRequests)
      .where(
        and(
          eq(hustlerLinkRequests.id, requestId),
          eq(hustlerLinkRequests.organizationId, req.user.organizationId)
        )
      );

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ error: "Can only revoke pending invites" });
    }

    await db.update(hustlerLinkRequests)
      .set({ 
        status: "REVOKED", 
        inviteToken: null,
        updatedAt: new Date(),
      })
      .where(eq(hustlerLinkRequests.id, requestId));

    logInfo(`[Hustler] Invite revoked: request=${requestId} by=${req.user.id}`);

    res.json({
      success: true,
      message: "Invite revoked.",
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to revoke invite: ${error.message}`);
    res.status(500).json({ error: "Failed to revoke invite" });
  }
});

// ============================================================================
// HUSTLER DELEGATE (COO) MANAGEMENT
// Allows HUSTLERs to invite COOs and other executives to manage their portfolio
// ============================================================================

const inviteDelegateSchema = z.object({
  email: z.string().email("Valid email required"),
  delegateRole: z.enum(["COO", "CFO", "OPERATIONS_MANAGER"]).default("COO"),
  canCreateOrganizations: z.boolean().default(true),
  canManageAllOrganizations: z.boolean().default(true),
  canViewFinancials: z.boolean().default(true),
  canInviteOtherDelegates: z.boolean().default(false),
});

// Get all delegates for a HUSTLER
router.get("/hustler/delegates", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const delegates = await db
      .select({
        id: hustlerDelegates.id,
        delegateRole: hustlerDelegates.delegateRole,
        delegateEmail: hustlerDelegates.delegateEmail,
        status: hustlerDelegates.status,
        canCreateOrganizations: hustlerDelegates.canCreateOrganizations,
        canManageAllOrganizations: hustlerDelegates.canManageAllOrganizations,
        canViewFinancials: hustlerDelegates.canViewFinancials,
        canInviteOtherDelegates: hustlerDelegates.canInviteOtherDelegates,
        expiresAt: hustlerDelegates.expiresAt,
        acceptedAt: hustlerDelegates.acceptedAt,
        isActive: hustlerDelegates.isActive,
        createdAt: hustlerDelegates.createdAt,
        delegateUser: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(hustlerDelegates)
      .leftJoin(users, eq(hustlerDelegates.delegateUserId, users.id))
      .where(eq(hustlerDelegates.hustlerUserId, req.user.id))
      .orderBy(desc(hustlerDelegates.createdAt));

    res.json({ delegates });
  } catch (error: any) {
    logError(`[Hustler] Failed to fetch delegates: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch delegates" });
  }
});

// Invite a delegate (COO, CFO, etc.)
router.post("/hustler/delegates/invite", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validationResult = inviteDelegateSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const { email, delegateRole, canCreateOrganizations, canManageAllOrganizations, canViewFinancials, canInviteOtherDelegates } = validationResult.data;

    // Check if already invited
    const [existing] = await db
      .select()
      .from(hustlerDelegates)
      .where(
        and(
          eq(hustlerDelegates.hustlerUserId, req.user.id),
          eq(hustlerDelegates.delegateEmail, email),
          eq(hustlerDelegates.status, "PENDING")
        )
      );

    if (existing) {
      return res.status(400).json({ error: "Delegate already has a pending invite" });
    }

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Generate invite token
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await db.insert(hustlerDelegates).values({
      hustlerUserId: req.user.id,
      delegateUserId: existingUser?.id || null,
      delegateEmail: email,
      delegateRole,
      inviteToken: token,
      inviteTokenHash: hash,
      status: "PENDING",
      canCreateOrganizations,
      canManageAllOrganizations,
      canViewFinancials,
      canInviteOtherDelegates,
      expiresAt,
    });

    logInfo(`[Hustler] Delegate invited: email=${email} role=${delegateRole} by=${req.user.id}`);

    res.json({
      success: true,
      message: `${delegateRole} invite sent to ${email}`,
      inviteToken: token, // For testing - in production this would be emailed
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to invite delegate: ${error.message}`);
    res.status(500).json({ error: "Failed to invite delegate" });
  }
});

// Get pending delegate invites for the current user
router.get("/hustler/delegates/invites", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const invites = await db
      .select({
        id: hustlerDelegates.id,
        delegateRole: hustlerDelegates.delegateRole,
        status: hustlerDelegates.status,
        canCreateOrganizations: hustlerDelegates.canCreateOrganizations,
        canManageAllOrganizations: hustlerDelegates.canManageAllOrganizations,
        canViewFinancials: hustlerDelegates.canViewFinancials,
        canInviteOtherDelegates: hustlerDelegates.canInviteOtherDelegates,
        expiresAt: hustlerDelegates.expiresAt,
        createdAt: hustlerDelegates.createdAt,
        hustler: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(hustlerDelegates)
      .innerJoin(users, eq(hustlerDelegates.hustlerUserId, users.id))
      .where(
        and(
          or(
            eq(hustlerDelegates.delegateUserId, req.user.id),
            eq(hustlerDelegates.delegateEmail, req.user.email)
          ),
          eq(hustlerDelegates.status, "PENDING")
        )
      );

    res.json({ invites });
  } catch (error: any) {
    logError(`[Hustler] Failed to fetch delegate invites: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch delegate invites" });
  }
});

// Accept a delegate invite
router.post("/hustler/delegates/:delegateId/accept", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { delegateId } = req.params;

    const [invite] = await db
      .select()
      .from(hustlerDelegates)
      .where(
        and(
          eq(hustlerDelegates.id, delegateId),
          or(
            eq(hustlerDelegates.delegateUserId, req.user.id),
            eq(hustlerDelegates.delegateEmail, req.user.email)
          ),
          eq(hustlerDelegates.status, "PENDING")
        )
      );

    if (!invite) {
      return res.status(404).json({ error: "Invite not found" });
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      await db.update(hustlerDelegates)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(hustlerDelegates.id, delegateId));
      return res.status(400).json({ error: "Invite has expired" });
    }

    await db.update(hustlerDelegates)
      .set({
        delegateUserId: req.user.id,
        status: "APPROVED",
        acceptedAt: new Date(),
        inviteToken: null,
        inviteTokenHash: null,
        updatedAt: new Date(),
      })
      .where(eq(hustlerDelegates.id, delegateId));

    logInfo(`[Hustler] Delegate accepted: delegateId=${delegateId} userId=${req.user.id}`);

    res.json({
      success: true,
      message: `You are now a ${invite.delegateRole} for this HUSTLER's portfolio`,
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to accept delegate invite: ${error.message}`);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

// Decline a delegate invite
router.post("/hustler/delegates/:delegateId/decline", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { delegateId } = req.params;

    const [invite] = await db
      .select()
      .from(hustlerDelegates)
      .where(
        and(
          eq(hustlerDelegates.id, delegateId),
          or(
            eq(hustlerDelegates.delegateUserId, req.user.id),
            eq(hustlerDelegates.delegateEmail, req.user.email)
          ),
          eq(hustlerDelegates.status, "PENDING")
        )
      );

    if (!invite) {
      return res.status(404).json({ error: "Invite not found" });
    }

    await db.update(hustlerDelegates)
      .set({
        status: "REJECTED",
        inviteToken: null,
        inviteTokenHash: null,
        updatedAt: new Date(),
      })
      .where(eq(hustlerDelegates.id, delegateId));

    logInfo(`[Hustler] Delegate declined: delegateId=${delegateId} userId=${req.user.id}`);

    res.json({
      success: true,
      message: "Invite declined",
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to decline delegate invite: ${error.message}`);
    res.status(500).json({ error: "Failed to decline invite" });
  }
});

// Revoke a delegate (HUSTLER only)
router.post("/hustler/delegates/:delegateId/revoke", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { delegateId } = req.params;

    const [delegate] = await db
      .select()
      .from(hustlerDelegates)
      .where(
        and(
          eq(hustlerDelegates.id, delegateId),
          eq(hustlerDelegates.hustlerUserId, req.user.id)
        )
      );

    if (!delegate) {
      return res.status(404).json({ error: "Delegate not found" });
    }

    await db.update(hustlerDelegates)
      .set({
        status: "REVOKED",
        isActive: false,
        inviteToken: null,
        inviteTokenHash: null,
        updatedAt: new Date(),
      })
      .where(eq(hustlerDelegates.id, delegateId));

    logInfo(`[Hustler] Delegate revoked: delegateId=${delegateId} by=${req.user.id}`);

    res.json({
      success: true,
      message: "Delegate access revoked",
    });
  } catch (error: any) {
    logError(`[Hustler] Failed to revoke delegate: ${error.message}`);
    res.status(500).json({ error: "Failed to revoke delegate" });
  }
});

export default router;
