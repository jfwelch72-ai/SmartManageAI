import { Router } from "express";
import { db } from "./db";
import { hustlerOrganizations, organizations, users, hustlerLinkRequests, hustlerDelegates, projects, bids, changeOrders, tasks, estimates, notifications } from "@shared/schema";
import { eq, and, or, desc, isNull, inArray, sql, count, sum } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { sendEmail } from "./email";
import { sensitiveLimiter } from "./rateLimiter";
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
        bidsAwarded: 0,
        bidsLost: 0,
        bidWinRate: 0,
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
        totalValue: sql<string>`coalesce(sum(bid_amount)::text, '0')`,
        awarded: sql<number>`count(*) filter (where status = 'AWARDED')::int`,
        lost: sql<number>`count(*) filter (where status = 'LOST')::int`,
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

    const [tasksResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          inArray(tasks.organizationId, orgIds),
          inArray(tasks.status, ["PENDING", "IN_PROGRESS"])
        )
      );

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

      const [pendingTasks] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.organizationId, orgId),
            inArray(tasks.status, ["PENDING", "IN_PROGRESS"])
          )
        );

      const ap = activeProjects?.count || 0;
      const ob = openBids?.count || 0;
      const pt = pendingTasks?.count || 0;
      const healthStatus = ap > 0 ? "ACTIVE" : ob > 0 ? "BIDDING" : pt > 0 ? "PENDING_TASKS" : "IDLE";

      return {
        id: orgId,
        name: org?.name || "Unknown",
        tradeType: org?.tradeType || "OTHER",
        logoUrl: org?.logoUrl,
        activeProjects: ap,
        openBids: ob,
        employees: employees?.count || 0,
        pendingTasks: pt,
        healthStatus,
      };
    }));

    const portfolioAwarded = bidsResult?.awarded || 0;
    const portfolioLost = bidsResult?.lost || 0;
    const portfolioDecided = portfolioAwarded + portfolioLost;
    const portfolioBidWinRate = portfolioDecided > 0 ? Math.round((portfolioAwarded / portfolioDecided) * 100) : 0;

    res.json({
      totalOrganizations: orgIds.length,
      totalActiveProjects: projectsResult?.count || 0,
      totalOpenBids: bidsResult?.count || 0,
      totalPendingChangeOrders: changeOrdersResult?.count || 0,
      totalPendingTasks: tasksResult?.count || 0,
      estimatedBidValue: parseFloat(bidsResult?.totalValue || "0"),
      bidsAwarded: portfolioAwarded,
      bidsLost: portfolioLost,
      bidWinRate: portfolioBidWinRate,
      organizationBreakdown: orgBreakdown,
    });
  } catch (error: any) {
    logError("[Hustler] Failed to fetch portfolio stats", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to generate AI summary", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to fetch organizations", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to link organization", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to switch organization", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to unlink organization", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to get current role", {}, error instanceof Error ? error : new Error(String(error)));
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

    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, req.user.organizationId));
    const orgName = org?.name || "an organization";
    const inviterName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email;
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.APP_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
    const inviteLink = `${baseUrl}/hustler/accept-invite/${token}`;

    try {
      await sendEmail({
        to: hustlerEmail.toLowerCase(),
        subject: `You've been invited to join ${orgName} on SmartManageAI`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">SmartManageAI</h1>
            </div>
            <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
              <h2 style="color: #1a1a1a; font-size: 20px; margin-top: 0;">You've Been Invited!</h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
                <strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on SmartManageAI.
              </p>
              ${message ? `<p style="color: #4b5563; font-size: 14px; line-height: 1.5; background: #fff; padding: 12px; border-radius: 6px; border-left: 3px solid #f59e0b;"><em>"${message}"</em></p>` : ""}
              ${roleOverride ? `<p style="color: #6b7280; font-size: 14px;">Role: <strong>${roleOverride}</strong></p>` : ""}
              <div style="text-align: center; margin: 24px 0;">
                <a href="${inviteLink}" style="background-color: #f59e0b; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Accept Invitation</a>
              </div>
              <p style="color: #9ca3af; font-size: 12px; text-align: center;">This invitation expires in 7 days.</p>
            </div>
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </div>
        `,
        text: `You've been invited to join ${orgName} on SmartManageAI by ${inviterName}. ${message ? `Message: "${message}" ` : ""}Accept the invitation here: ${inviteLink} - This invitation expires in 7 days.`,
      });
      logInfo(`[Hustler] Invite email sent to ${hustlerEmail}`);
    } catch (emailError: any) {
      logError(`[Hustler] Failed to send invite email to ${hustlerEmail}: ${emailError.message}`);
    }

    res.json({
      success: true,
      request: {
        id: newRequest.id,
        hustlerEmail: newRequest.hustlerEmail,
        status: newRequest.status,
        expiresAt: newRequest.expiresAt,
      },
      inviteToken: token,
      inviteLink: `/hustler/accept-invite/${token}`,
      message: "Invite created and email sent to the user.",
    });
  } catch (error: any) {
    logError("[Hustler] Failed to create invite", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to fetch pending invites", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to fetch org requests", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to respond to request", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to process response" });
  }
});

// Accept invite via token (public - for email links, auto-creates user if needed)
router.post("/hustler/link-requests/accept-invite", sensitiveLimiter, async (req, res) => {
  try {
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
      return res.status(404).json({ error: "Invalid or expired invite link" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ error: `This invite has already been ${request.status.toLowerCase()}` });
    }

    if (request.expiresAt && new Date(request.expiresAt) < new Date()) {
      await db.update(hustlerLinkRequests)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(hustlerLinkRequests.id, request.id));
      return res.status(400).json({ error: "This invite has expired" });
    }

    const email = request.hustlerEmail.toLowerCase();
    let [existingUser] = await db.select().from(users).where(eq(users.email, email));

    let userId: string;
    let requiresPasswordSetup = false;

    if (existingUser) {
      if (!existingUser.isActive) {
        return res.status(403).json({ error: "Your account has been deactivated. Please contact support." });
      }
      userId = existingUser.id;
    } else {
      const { hashPassword } = await import("./auth");
      const tempPassword = crypto.randomBytes(16).toString("hex");
      const passwordHash = await hashPassword(tempPassword);
      const emailPrefix = email.split("@")[0].replace(/[^a-zA-Z]/g, " ").trim();
      const firstName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1) || "User";

      const [newUser] = await db.insert(users).values({
        email,
        passwordHash,
        firstName,
        lastName: "",
        role: "HUSTLER",
        organizationId: request.organizationId,
        isActive: true,
        emailVerified: true,
      }).returning();

      userId = newUser.id;
      existingUser = newUser;
      requiresPasswordSetup = true;
      logInfo(`[Hustler] Auto-created user for invite: ${email} (id=${userId})`);
    }

    const [existingLink] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, userId),
          eq(hustlerOrganizations.organizationId, request.organizationId)
        )
      );

    if (existingLink) {
      await db.update(hustlerOrganizations)
        .set({ isActive: true, roleOverride: request.roleOverride })
        .where(eq(hustlerOrganizations.id, existingLink.id));
    } else {
      await db.insert(hustlerOrganizations).values({
        userId,
        organizationId: request.organizationId,
        roleOverride: request.roleOverride,
        isActive: true,
      });
    }

    await db.update(hustlerLinkRequests)
      .set({
        status: "APPROVED",
        respondedAt: new Date(),
        respondedByUserId: userId,
        hustlerUserId: userId,
        inviteToken: null,
        updatedAt: new Date(),
      })
      .where(eq(hustlerLinkRequests.id, request.id));

    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, request.organizationId));

    const { generateToken, setAuthCookie } = await import("./auth");
    const jwtToken = generateToken(userId, existingUser.tokenVersion ?? 0);
    setAuthCookie(res, jwtToken);

    logInfo(`[Hustler] Invite accepted via email link: user=${userId} org=${request.organizationId}`);

    const { passwordHash: _, tokenVersion: __, ...sanitizedUser } = existingUser;
    res.json({
      success: true,
      requiresPasswordSetup,
      user: sanitizedUser,
      organization: { name: org?.name || "Organization" },
      message: `Successfully joined ${org?.name || "the organization"}!`,
    });
  } catch (error: any) {
    logError("[Hustler] Failed to accept invite via link", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

// Accept invite via token (authenticated - for logged-in users)
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
    logError("[Hustler] Failed to accept token", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to revoke invite", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to fetch delegates", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to invite delegate", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to fetch delegate invites", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to accept delegate invite", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to decline delegate invite", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("[Hustler] Failed to revoke delegate", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to revoke delegate" });
  }
});

// ============================================================================
// UNIFIED INBOX - Aggregate tasks and notifications across all linked orgs
// ============================================================================

router.get("/hustler/unified-inbox", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get all linked organization IDs
    const linkedOrgs = await db
      .select({ 
        organizationId: hustlerOrganizations.organizationId,
        orgName: organizations.name 
      })
      .from(hustlerOrganizations)
      .innerJoin(organizations, eq(hustlerOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const orgIds = linkedOrgs.map(o => o.organizationId);
    const orgNameMap = new Map(linkedOrgs.map(o => [o.organizationId, o.orgName]));

    if (orgIds.length === 0) {
      return res.json({
        items: [],
        counts: { tasks: 0, notifications: 0, total: 0 },
        organizations: [],
      });
    }

    // Parse query params for filtering
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const typeFilter = req.query.type as string; // 'task', 'notification', or undefined for all
    const statusFilter = req.query.status as string; // 'unread', 'pending', etc.

    // Fetch enough items to satisfy pagination (offset + limit from each source)
    const fetchLimit = offset + limit;

    // Fetch tasks across all linked organizations using INNER JOIN to properly scope by org
    const taskItems = typeFilter === 'notification' ? [] : await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        createdAt: tasks.createdAt,
        projectName: projects.name,
        projectOrgId: projects.gcOrganizationId,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          inArray(projects.gcOrganizationId, orgIds),
          statusFilter === 'pending' ? eq(tasks.status, 'PENDING') : undefined
        )
      )
      .orderBy(desc(tasks.createdAt))
      .limit(fetchLimit);

    // Fetch notifications across all linked organizations
    const notificationItems = typeFilter === 'task' ? [] : await db
      .select({
        id: notifications.id,
        type: notifications.type,
        message: notifications.message,
        isRead: notifications.isRead,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        createdAt: notifications.createdAt,
        organizationId: notifications.organizationId,
      })
      .from(notifications)
      .where(
        and(
          inArray(notifications.organizationId, orgIds),
          statusFilter === 'unread' ? eq(notifications.isRead, false) : undefined
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(fetchLimit);

    // Transform and merge items into unified format
    const unifiedItems: Array<{
      id: string;
      type: 'task' | 'notification';
      title: string;
      description: string | null;
      status: string;
      priority: string | null;
      organizationId: string | null;
      organizationName: string | null;
      projectId: string | null;
      projectName: string | null;
      entityType: string | null;
      entityId: string | null;
      createdAt: Date | null;
      dueDate: Date | null;
      isRead: boolean | null;
    }> = [];

    // Add tasks
    for (const task of taskItems) {
      unifiedItems.push({
        id: task.id,
        type: 'task',
        title: task.title || 'Untitled Task',
        description: task.description,
        status: task.status || 'PENDING',
        priority: task.priority,
        organizationId: task.projectOrgId,
        organizationName: task.projectOrgId ? orgNameMap.get(task.projectOrgId) || null : null,
        projectId: task.projectId,
        projectName: task.projectName,
        entityType: 'task',
        entityId: task.id,
        createdAt: task.createdAt,
        dueDate: task.dueDate,
        isRead: null,
      });
    }

    // Add notifications
    for (const notif of notificationItems) {
      unifiedItems.push({
        id: notif.id,
        type: 'notification',
        title: notif.type || 'Notification',
        description: notif.message,
        status: notif.isRead ? 'READ' : 'UNREAD',
        priority: null,
        organizationId: notif.organizationId,
        organizationName: notif.organizationId ? orgNameMap.get(notif.organizationId) || null : null,
        projectId: null,
        projectName: null,
        entityType: notif.entityType,
        entityId: notif.entityId,
        createdAt: notif.createdAt,
        dueDate: null,
        isRead: notif.isRead,
      });
    }

    // Sort by createdAt descending and apply pagination
    unifiedItems.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    const paginatedItems = unifiedItems.slice(offset, offset + limit);

    // Get counts
    const [taskCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(inArray(projects.gcOrganizationId, orgIds));

    const [notifCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(inArray(notifications.organizationId, orgIds));

    const [unreadNotifCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          inArray(notifications.organizationId, orgIds),
          eq(notifications.isRead, false)
        )
      );

    res.json({
      items: paginatedItems,
      counts: {
        tasks: taskCount?.count || 0,
        notifications: notifCount?.count || 0,
        unreadNotifications: unreadNotifCount?.count || 0,
        total: (taskCount?.count || 0) + (notifCount?.count || 0),
      },
      organizations: linkedOrgs.map(o => ({
        id: o.organizationId,
        name: o.orgName,
      })),
      pagination: {
        limit,
        offset,
        hasMore: unifiedItems.length > offset + limit,
      },
    });
  } catch (error: any) {
    logError("[Hustler] Failed to fetch unified inbox", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch unified inbox" });
  }
});

// Mark notification as read (for unified inbox)
router.post("/hustler/notifications/:notificationId/read", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { notificationId } = req.params;

    // Get all linked organization IDs for security check
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
      return res.status(403).json({ error: "No linked organizations" });
    }

    // Verify notification belongs to a linked org
    const [notif] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          inArray(notifications.organizationId, orgIds)
        )
      );

    if (!notif) {
      return res.status(404).json({ error: "Notification not found" });
    }

    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, notificationId));

    res.json({ success: true });
  } catch (error: any) {
    logError("[Hustler] Failed to mark notification read", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

// Mark all notifications as read for a HUSTLER user across all orgs
router.post("/hustler/notifications/mark-all-read", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
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
      return res.json({ success: true, count: 0 });
    }

    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          inArray(notifications.organizationId, orgIds),
          eq(notifications.isRead, false)
        )
      );

    logInfo(`[Hustler] Marked all notifications read for user=${req.user.id}`);

    res.json({ success: true });
  } catch (error: any) {
    logError("[Hustler] Failed to mark all notifications read", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to mark notifications as read" });
  }
});

// ========================================
// BENCHMARKING - Cross-Organization Comparison
// ========================================

router.get("/hustler/benchmarking", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get all linked organization IDs
    const linkedOrgs = await db
      .select({
        organizationId: hustlerOrganizations.organizationId,
        orgName: organizations.name,
        tradeType: organizations.tradeType,
        logoUrl: organizations.logoUrl,
      })
      .from(hustlerOrganizations)
      .innerJoin(organizations, eq(hustlerOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const orgIds = linkedOrgs.map(o => o.organizationId);

    if (orgIds.length === 0) {
      return res.json({
        organizations: [],
        metrics: {},
        rankings: {},
      });
    }

    // Gather metrics per organization for benchmarking
    const orgMetrics = await Promise.all(orgIds.map(async (orgId) => {
      const orgInfo = linkedOrgs.find(o => o.organizationId === orgId);

      // Active projects
      const [projectStats] = await db
        .select({
          active: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
          completed: sql<number>`count(*) filter (where status = 'COMPLETE')::int`,
          totalValue: sql<string>`coalesce(sum(contract_amount)::text, '0')`,
        })
        .from(projects)
        .where(eq(projects.gcOrganizationId, orgId));

      // Bids with win/loss tracking
      const [bidStats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          totalValue: sql<string>`coalesce(sum(bid_amount)::text, '0')`,
          awarded: sql<number>`count(*) filter (where status = 'AWARDED')::int`,
          lost: sql<number>`count(*) filter (where status = 'LOST')::int`,
        })
        .from(bids)
        .where(eq(bids.gcOrganizationId, orgId));

      // Employees
      const [employeeStats] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.isActive, true)));

      // Change orders pending
      const [coStats] = await db
        .select({ pending: sql<number>`count(*)::int` })
        .from(changeOrders)
        .innerJoin(projects, eq(changeOrders.projectId, projects.id))
        .where(
          and(
            eq(projects.gcOrganizationId, orgId),
            eq(changeOrders.status, "SUBMITTED")
          )
        );

      const activeProjects = projectStats?.active || 0;
      const employees = employeeStats?.count || 0;
      const projectsPerEmployee = employees > 0 ? (activeProjects / employees).toFixed(2) : "0";
      const awarded = bidStats?.awarded || 0;
      const lost = bidStats?.lost || 0;
      const decidedBids = awarded + lost;
      const bidWinRate = decidedBids > 0 ? Math.round((awarded / decidedBids) * 100) : 0;

      return {
        organizationId: orgId,
        name: orgInfo?.orgName || "Unknown",
        tradeType: orgInfo?.tradeType || "OTHER",
        logoUrl: orgInfo?.logoUrl,
        metrics: {
          activeProjects,
          completedProjects: projectStats?.completed || 0,
          totalProjectValue: parseFloat(projectStats?.totalValue || "0"),
          totalBids: bidStats?.total || 0,
          bidsAwarded: awarded,
          bidsLost: lost,
          bidPipeline: parseFloat(bidStats?.totalValue || "0"),
          employees,
          pendingChangeOrders: coStats?.pending || 0,
          projectsPerEmployee: parseFloat(projectsPerEmployee),
          bidWinRate,
        },
      };
    }));

    // Calculate rankings
    const rankings = {
      byActiveProjects: [...orgMetrics].sort((a, b) => b.metrics.activeProjects - a.metrics.activeProjects).map(o => o.organizationId),
      byBidPipeline: [...orgMetrics].sort((a, b) => b.metrics.bidPipeline - a.metrics.bidPipeline).map(o => o.organizationId),
      byEmployees: [...orgMetrics].sort((a, b) => b.metrics.employees - a.metrics.employees).map(o => o.organizationId),
      byEfficiency: [...orgMetrics].sort((a, b) => b.metrics.projectsPerEmployee - a.metrics.projectsPerEmployee).map(o => o.organizationId),
    };

    // Calculate portfolio totals
    const portfolioTotals = {
      totalActiveProjects: orgMetrics.reduce((sum, o) => sum + o.metrics.activeProjects, 0),
      totalCompletedProjects: orgMetrics.reduce((sum, o) => sum + o.metrics.completedProjects, 0),
      totalProjectValue: orgMetrics.reduce((sum, o) => sum + o.metrics.totalProjectValue, 0),
      totalBidPipeline: orgMetrics.reduce((sum, o) => sum + o.metrics.bidPipeline, 0),
      totalEmployees: orgMetrics.reduce((sum, o) => sum + o.metrics.employees, 0),
      totalPendingCOs: orgMetrics.reduce((sum, o) => sum + o.metrics.pendingChangeOrders, 0),
    };

    res.json({
      organizations: orgMetrics,
      rankings,
      portfolioTotals,
    });
  } catch (error: any) {
    logError("[Hustler] Failed to fetch benchmarking data", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch benchmarking data" });
  }
});

// ============================================================================
// CONSOLIDATED PORTFOLIO EXPORT - CSV Download
// ============================================================================

router.get("/hustler/portfolio/export", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const linkedOrgs = await db
      .select({
        organizationId: hustlerOrganizations.organizationId,
        orgName: organizations.name,
        tradeType: organizations.tradeType,
      })
      .from(hustlerOrganizations)
      .innerJoin(organizations, eq(hustlerOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const orgIds = linkedOrgs.map(o => o.organizationId);

    if (orgIds.length === 0) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="portfolio-report-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send("No linked organizations found.\n");
    }

    const orgRows = await Promise.all(orgIds.map(async (orgId) => {
      const orgInfo = linkedOrgs.find(o => o.organizationId === orgId);

      const [projectStats] = await db
        .select({
          active: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
          completed: sql<number>`count(*) filter (where status = 'COMPLETE')::int`,
          planning: sql<number>`count(*) filter (where status = 'PLANNING')::int`,
          totalValue: sql<string>`coalesce(sum(contract_amount)::text, '0')`,
        })
        .from(projects)
        .where(eq(projects.gcOrganizationId, orgId));

      const [bidStats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          totalValue: sql<string>`coalesce(sum(bid_amount)::text, '0')`,
          awarded: sql<number>`count(*) filter (where status = 'AWARDED')::int`,
          lost: sql<number>`count(*) filter (where status = 'LOST')::int`,
          active: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
        })
        .from(bids)
        .where(eq(bids.gcOrganizationId, orgId));

      const [employeeStats] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.isActive, true)));

      const [coStats] = await db
        .select({ pending: sql<number>`count(*)::int` })
        .from(changeOrders)
        .innerJoin(projects, eq(changeOrders.projectId, projects.id))
        .where(
          and(
            eq(projects.gcOrganizationId, orgId),
            eq(changeOrders.status, "SUBMITTED")
          )
        );

      const awarded = bidStats?.awarded || 0;
      const lost = bidStats?.lost || 0;
      const decided = awarded + lost;
      const winRate = decided > 0 ? Math.round((awarded / decided) * 100) : 0;

      return {
        organization: orgInfo?.orgName || "Unknown",
        tradeType: orgInfo?.tradeType || "OTHER",
        activeProjects: projectStats?.active || 0,
        planningProjects: projectStats?.planning || 0,
        completedProjects: projectStats?.completed || 0,
        totalProjectValue: parseFloat(projectStats?.totalValue || "0"),
        totalBids: bidStats?.total || 0,
        activeBids: bidStats?.active || 0,
        bidsAwarded: awarded,
        bidsLost: lost,
        bidWinRate: `${winRate}%`,
        bidPipeline: parseFloat(bidStats?.totalValue || "0"),
        employees: employeeStats?.count || 0,
        pendingChangeOrders: coStats?.pending || 0,
      };
    }));

    const headers = [
      "Organization", "Trade Type", "Active Projects", "Planning Projects", "Completed Projects",
      "Total Project Value ($)", "Total Bids", "Active Bids", "Bids Awarded", "Bids Lost",
      "Bid Win Rate", "Bid Pipeline ($)", "Employees", "Pending Change Orders"
    ];

    const escapeCsv = (val: string | number) => {
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    let csv = headers.map(escapeCsv).join(",") + "\n";

    for (const row of orgRows) {
      csv += [
        row.organization, row.tradeType, row.activeProjects, row.planningProjects,
        row.completedProjects, row.totalProjectValue, row.totalBids, row.activeBids,
        row.bidsAwarded, row.bidsLost, row.bidWinRate, row.bidPipeline,
        row.employees, row.pendingChangeOrders,
      ].map(escapeCsv).join(",") + "\n";
    }

    csv += "\n";
    csv += "Portfolio Totals\n";
    csv += `Total Organizations,${orgRows.length}\n`;
    csv += `Total Active Projects,${orgRows.reduce((s, r) => s + r.activeProjects, 0)}\n`;
    csv += `Total Completed Projects,${orgRows.reduce((s, r) => s + r.completedProjects, 0)}\n`;
    csv += `Total Project Value ($),${orgRows.reduce((s, r) => s + r.totalProjectValue, 0)}\n`;
    csv += `Total Bids,${orgRows.reduce((s, r) => s + r.totalBids, 0)}\n`;
    const totalAwarded = orgRows.reduce((s, r) => s + r.bidsAwarded, 0);
    const totalLost = orgRows.reduce((s, r) => s + r.bidsLost, 0);
    const totalDecided = totalAwarded + totalLost;
    csv += `Overall Bid Win Rate,${totalDecided > 0 ? Math.round((totalAwarded / totalDecided) * 100) : 0}%\n`;
    csv += `Total Bid Pipeline ($),${orgRows.reduce((s, r) => s + r.bidPipeline, 0)}\n`;
    csv += `Total Employees,${orgRows.reduce((s, r) => s + r.employees, 0)}\n`;
    csv += `Total Pending Change Orders,${orgRows.reduce((s, r) => s + r.pendingChangeOrders, 0)}\n`;
    csv += `\nReport Generated,${new Date().toISOString()}\n`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="portfolio-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error: any) {
    logError("[Hustler] Failed to export portfolio", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to export portfolio report" });
  }
});

export default router;
