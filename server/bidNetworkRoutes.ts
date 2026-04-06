import { Router, Response } from "express";
import { db } from "./db";
import { 
  organizationNetworkSettings, 
  subcontractorBidRequests, 
  subcontractorBidInvitations, 
  subcontractorBidResponses,
  bidRequestClarifications,
  organizations,
  projects,
  notifications,
  users
} from "@shared/schema";
import { eq, and, or, desc, sql, isNull, ne, inArray, like } from "drizzle-orm";
import { requireAuth, requireRole, requireFeaturePermission, requireAnyFeaturePermission, AuthRequest } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { insertNotifications } from "./services/notificationService";
import { 
  sendBidInvitationNotification, 
  sendBidResponseNotification,
  sendClarificationNotification,
  createBidNetworkInAppNotification 
} from "./bidNetworkNotifications";

const router = Router();

router.use(requireAuth, requireAnyFeaturePermission('canAccessBidNetworkGC', 'canAccessBidNetworkInbox'));

// ============================================
// ORGANIZATION NETWORK SETTINGS
// ============================================

// Get organization's network settings
// Restricted to ADMIN, MANAGER, ESTIMATOR (roles that can use bid network) + SUPER_ADMIN for platform admin
router.get("/settings/:organizationId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId } = req.params;
    const user = req.user!;
    
    // Security: User must belong to the organization or be SUPER_ADMIN
    if (user.organizationId !== organizationId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const [settings] = await db
      .select()
      .from(organizationNetworkSettings)
      .where(eq(organizationNetworkSettings.organizationId, organizationId));
    
    if (!settings) {
      // Return default settings if none exist
      return res.json({
        organizationId,
        isNetworkEnabled: true,
        canReceiveBidInvites: true,
        canSendBidRequests: true,
        tradeSpecialties: [],
        notifyByEmail: true,
        notifyInApp: true,
        exists: false
      });
    }
    
    res.json({ ...settings, exists: true });
  } catch (error) {
    logError("Failed to get network settings", undefined, error as Error);
    res.status(500).json({ error: "Failed to get network settings" });
  }
});

// Create or update organization's network settings
// Restricted to ADMIN only (SUPER_ADMIN handled separately in code)
router.post("/settings", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = req.body;
    
    // Determine target organization with proper authorization
    let organizationId: string;
    
    if (data.organizationId && data.organizationId !== user.organizationId) {
      // Attempting to modify another organization's settings
      // Only SUPER_ADMIN can do this
      if (user.role !== "SUPER_ADMIN") {
        return res.status(403).json({ error: "Cannot modify settings for another organization" });
      }
      organizationId = data.organizationId;
    } else {
      // Use user's own organization
      organizationId = user.organizationId!;
    }
    
    // Check if settings exist
    const [existing] = await db
      .select()
      .from(organizationNetworkSettings)
      .where(eq(organizationNetworkSettings.organizationId, organizationId));
    
    if (existing) {
      // Update
      const [updated] = await db
        .update(organizationNetworkSettings)
        .set({
          ...data,
          updatedAt: new Date()
        })
        .where(eq(organizationNetworkSettings.organizationId, organizationId))
        .returning();
      
      logInfo("Network settings updated", { organizationId, userId: user.id });
      return res.json(updated);
    } else {
      // Create
      const [created] = await db
        .insert(organizationNetworkSettings)
        .values({
          ...data,
          organizationId
        })
        .returning();
      
      logInfo("Network settings created", { organizationId, userId: user.id });
      return res.json(created);
    }
  } catch (error) {
    logError("Failed to save network settings", undefined, error as Error);
    res.status(500).json({ error: "Failed to save network settings" });
  }
});

// ============================================
// BID REQUESTS (GC Creates)
// ============================================

// List bid requests for an organization (as GC)
// Restricted to roles that can manage bids
router.get("/requests", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { status, projectId } = req.query;
    
    // Build conditions array
    const conditions = [eq(subcontractorBidRequests.organizationId, user.organizationId!)];
    
    if (status && status !== "all") {
      conditions.push(eq(subcontractorBidRequests.status, status as any));
    }
    
    if (projectId) {
      conditions.push(eq(subcontractorBidRequests.projectId, projectId as string));
    }
    
    const results = await db
      .select({
        request: subcontractorBidRequests,
        project: projects
      })
      .from(subcontractorBidRequests)
      .leftJoin(projects, eq(subcontractorBidRequests.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(subcontractorBidRequests.createdAt));
    
    res.json(results.map(r => ({
      ...r.request,
      project: r.project
    })));
  } catch (error) {
    logError("Failed to list bid requests", undefined, error as Error);
    res.status(500).json({ error: "Failed to list bid requests" });
  }
});

// Get single bid request with invitations and responses
// Restricted to roles that can manage bids
router.get("/requests/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    
    const [request] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, id));
    
    if (!request) {
      return res.status(404).json({ error: "Bid request not found" });
    }
    
    // Security: Only the owning org can see full details
    if (request.organizationId !== user.organizationId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Get invitations
    const invitations = await db
      .select({
        invitation: subcontractorBidInvitations,
        organization: organizations
      })
      .from(subcontractorBidInvitations)
      .leftJoin(organizations, eq(subcontractorBidInvitations.invitedOrganizationId, organizations.id))
      .where(eq(subcontractorBidInvitations.bidRequestId, id));
    
    // Get responses
    const responses = await db
      .select({
        response: subcontractorBidResponses,
        organization: organizations
      })
      .from(subcontractorBidResponses)
      .leftJoin(organizations, eq(subcontractorBidResponses.respondingOrganizationId, organizations.id))
      .where(eq(subcontractorBidResponses.bidRequestId, id));
    
    res.json({
      ...request,
      invitations: invitations.map(i => ({
        ...i.invitation,
        organization: i.organization
      })),
      responses: responses.map(r => ({
        ...r.response,
        organization: r.organization
      }))
    });
  } catch (error) {
    logError("Failed to get bid request", undefined, error as Error);
    res.status(500).json({ error: "Failed to get bid request" });
  }
});

// Create a new bid request
// Restricted to ADMIN, MANAGER, ESTIMATOR
router.post("/requests", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = req.body;
    
    // Check if org can send bid requests
    const [settings] = await db
      .select()
      .from(organizationNetworkSettings)
      .where(eq(organizationNetworkSettings.organizationId, user.organizationId!));
    
    if (settings && !settings.canSendBidRequests) {
      return res.status(403).json({ error: "Your organization has disabled sending bid requests" });
    }
    
    // Convert date strings to Date objects for timestamp fields
    const processedData = { ...data };
    if (processedData.bidDueDate && typeof processedData.bidDueDate === 'string') {
      processedData.bidDueDate = new Date(processedData.bidDueDate);
    }
    
    const [request] = await db
      .insert(subcontractorBidRequests)
      .values({
        ...processedData,
        organizationId: user.organizationId!,
        createdByUserId: user.id,
        status: data.status || "DRAFT"
      })
      .returning();
    
    logInfo("Bid request created", { requestId: request.id, organizationId: user.organizationId || undefined });
    res.status(201).json(request);
  } catch (error) {
    logError("Failed to create bid request", undefined, error as Error);
    res.status(500).json({ error: "Failed to create bid request" });
  }
});

// Update a bid request
// Restricted to ADMIN, MANAGER, ESTIMATOR
router.patch("/requests/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const data = req.body;
    
    // Verify ownership
    const [existing] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, id));
    
    if (!existing || existing.organizationId !== user.organizationId) {
      return res.status(404).json({ error: "Bid request not found" });
    }
    
    if (data.status && data.status !== existing.status) {
      const BID_REQUEST_STATUS_TRANSITIONS: Record<string, string[]> = {
        DRAFT: ["OPEN", "CANCELLED"],
        OPEN: ["CLOSED", "AWARDED", "CANCELLED"],
        CLOSED: ["AWARDED", "CANCELLED"],
        AWARDED: [],
        CANCELLED: [],
      };

      const allowed = BID_REQUEST_STATUS_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        return res.status(422).json({
          error: `Invalid status transition from ${existing.status} to ${data.status}. Allowed transitions: ${allowed.join(", ") || "none (terminal state)"}.`,
        });
      }
    }

    const updates: any = { ...data, updatedAt: new Date() };
    
    if (data.status === "OPEN" && existing.status === "DRAFT") {
      updates.publishedAt = new Date();
    }
    if (data.status === "CLOSED" && existing.status === "OPEN") {
      updates.closedAt = new Date();
    }
    if (data.status === "AWARDED") {
      updates.awardedAt = new Date();
    }
    
    const [updated] = await db
      .update(subcontractorBidRequests)
      .set(updates)
      .where(eq(subcontractorBidRequests.id, id))
      .returning();
    
    logInfo("Bid request updated", { requestId: id, status: updated.status });
    res.json(updated);
  } catch (error) {
    logError("Failed to update bid request", undefined, error as Error);
    res.status(500).json({ error: "Failed to update bid request" });
  }
});

// Delete a bid request (only if DRAFT)
// Restricted to ADMIN, MANAGER only
router.delete("/requests/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    
    const [existing] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, id));
    
    if (!existing || existing.organizationId !== user.organizationId) {
      return res.status(404).json({ error: "Bid request not found" });
    }
    
    if (existing.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only delete draft bid requests" });
    }
    
    await db.delete(subcontractorBidRequests).where(eq(subcontractorBidRequests.id, id));
    
    logInfo("Bid request deleted", { requestId: id });
    res.json({ success: true });
  } catch (error) {
    logError("Failed to delete bid request", undefined, error as Error);
    res.status(500).json({ error: "Failed to delete bid request" });
  }
});

// ============================================
// FIND MATCHING SUBCONTRACTORS
// ============================================

// Find subcontractors matching trade requirements
// Restricted to ADMIN, MANAGER, ESTIMATOR
router.get("/match-subs", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { trades } = req.query;
    
    if (!trades) {
      return res.status(400).json({ error: "trades parameter required" });
    }
    
    const tradeList = (trades as string).split(",");
    
    // Find organizations with matching trade specialties that can receive invites
    const matchingSubs = await db
      .select({
        organization: organizations,
        settings: organizationNetworkSettings
      })
      .from(organizations)
      .leftJoin(organizationNetworkSettings, eq(organizations.id, organizationNetworkSettings.organizationId))
      .where(
        and(
          // Not the requesting org
          ne(organizations.id, user.organizationId!),
          // Network enabled and can receive invites
          or(
            isNull(organizationNetworkSettings.id),
            and(
              eq(organizationNetworkSettings.isNetworkEnabled, true),
              eq(organizationNetworkSettings.canReceiveBidInvites, true)
            )
          )
        )
      );
    
    // Filter by trade match
    const filtered = matchingSubs.filter(sub => {
      // Match by organization's tradeType
      if (tradeList.includes(sub.organization.tradeType)) {
        return true;
      }
      // Match by network settings trade specialties
      if (sub.settings?.tradeSpecialties) {
        return sub.settings.tradeSpecialties.some(t => tradeList.includes(t));
      }
      return false;
    });
    
    res.json(filtered.map(s => ({
      id: s.organization.id,
      name: s.organization.name,
      tradeType: s.organization.tradeType,
      tradeSpecialties: s.settings?.tradeSpecialties || [],
      logoUrl: s.organization.logoUrl,
      companyDescription: s.settings?.companyDescription,
      serviceAreas: s.settings?.serviceAreas || [],
      certifications: s.settings?.certifications || []
    })));
  } catch (error) {
    logError("Failed to find matching subs", undefined, error as Error);
    res.status(500).json({ error: "Failed to find matching subcontractors" });
  }
});

// ============================================
// INVITATIONS (GC Sends)
// ============================================

// Send invitations to subcontractors
// Restricted to ADMIN, MANAGER, ESTIMATOR
router.post("/invitations/send", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { bidRequestId, invitees, personalMessage } = req.body;
    
    // Verify bid request ownership
    const [request] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, bidRequestId));
    
    if (!request || request.organizationId !== user.organizationId) {
      return res.status(404).json({ error: "Bid request not found" });
    }
    
    const createdInvitations = [];
    
    for (const invitee of invitees) {
      // Check if already invited
      if (invitee.organizationId) {
        const [existing] = await db
          .select()
          .from(subcontractorBidInvitations)
          .where(and(
            eq(subcontractorBidInvitations.bidRequestId, bidRequestId),
            eq(subcontractorBidInvitations.invitedOrganizationId, invitee.organizationId)
          ));
        
        if (existing) continue;
      }
      
      const [invitation] = await db
        .insert(subcontractorBidInvitations)
        .values({
          bidRequestId,
          invitedOrganizationId: invitee.organizationId || null,
          externalCompanyName: invitee.externalCompanyName,
          externalContactName: invitee.externalContactName,
          externalContactEmail: invitee.externalContactEmail,
          externalContactPhone: invitee.externalContactPhone,
          invitedTradeType: invitee.tradeType,
          personalMessage,
          invitedByUserId: user.id,
          status: "PENDING"
        })
        .returning();
      
      createdInvitations.push(invitation);
      
      // Send email notification for platform members
      if (invitee.organizationId) {
        // Get GC organization name
        const [gcOrg] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, user.organizationId!));
        
        // Send email notification (fire and forget)
        sendBidInvitationNotification(
          invitee.organizationId,
          {
            id: request.id,
            title: request.title,
            scopeOfWork: request.scopeOfWork,
            bidDueDate: new Date(request.bidDueDate),
            requiredTrades: request.requiredTrades || [],
            projectCity: request.projectCity || undefined,
            projectState: request.projectState || undefined,
            gcOrganizationName: gcOrg?.name || "Unknown GC",
          },
          {
            id: invitation.id,
            personalMessage: personalMessage || undefined,
          }
        ).catch(err => logError("Email notification failed", err));

        createBidNetworkInAppNotification(
          invitee.organizationId,
          "BID_INVITATION_RECEIVED",
          "New Bid Invitation",
          `${gcOrg?.name || "A general contractor"} has invited you to bid on "${request.title}"`,
          invitation.id,
          "bid_invitation"
        ).catch(err => logError("In-app notification failed", err));
        
        logInfo("Bid invitation sent", { 
          invitationId: invitation.id, 
          toOrganization: invitee.organizationId 
        });
      }
    }
    
    // Update invite count on request
    await db
      .update(subcontractorBidRequests)
      .set({ 
        inviteCount: sql`${subcontractorBidRequests.inviteCount} + ${createdInvitations.length}`,
        updatedAt: new Date()
      })
      .where(eq(subcontractorBidRequests.id, bidRequestId));
    
    res.status(201).json(createdInvitations);
  } catch (error) {
    logError("Failed to send invitations", undefined, error as Error);
    res.status(500).json({ error: "Failed to send invitations" });
  }
});

// ============================================
// SUBCONTRACTOR BID INBOX
// ============================================

// List invitations received by subcontractor
// Accessible by ADMIN, MANAGER, ESTIMATOR, VENDOR (roles that handle bid responses)
router.get("/inbox", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "VENDOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { status } = req.query;
    
    let conditions = [eq(subcontractorBidInvitations.invitedOrganizationId, user.organizationId!)];
    
    if (status && status !== "all") {
      conditions.push(eq(subcontractorBidInvitations.status, status as any));
    }
    
    const invitations = await db
      .select({
        invitation: subcontractorBidInvitations,
        request: subcontractorBidRequests,
        gcOrganization: organizations
      })
      .from(subcontractorBidInvitations)
      .innerJoin(subcontractorBidRequests, eq(subcontractorBidInvitations.bidRequestId, subcontractorBidRequests.id))
      .innerJoin(organizations, eq(subcontractorBidRequests.organizationId, organizations.id))
      .where(and(...conditions))
      .orderBy(desc(subcontractorBidInvitations.createdAt));
    
    res.json(invitations.map(i => ({
      ...i.invitation,
      request: {
        ...i.request,
        // Hide internal notes from subs
        internalNotes: undefined,
        // Hide budget if not allowed
        budgetRangeMin: i.request.showBudgetToSubs ? i.request.budgetRangeMin : undefined,
        budgetRangeMax: i.request.showBudgetToSubs ? i.request.budgetRangeMax : undefined
      },
      gcOrganization: {
        id: i.gcOrganization.id,
        name: i.gcOrganization.name,
        logoUrl: i.gcOrganization.logoUrl
      }
    })));
  } catch (error) {
    logError("Failed to list inbox", undefined, error as Error);
    res.status(500).json({ error: "Failed to list bid invitations" });
  }
});

// View invitation details (marks as viewed)
// Accessible by ADMIN, MANAGER, ESTIMATOR, VENDOR
router.get("/inbox/:invitationId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "VENDOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { invitationId } = req.params;
    
    const [invitation] = await db
      .select({
        invitation: subcontractorBidInvitations,
        request: subcontractorBidRequests,
        gcOrganization: organizations
      })
      .from(subcontractorBidInvitations)
      .innerJoin(subcontractorBidRequests, eq(subcontractorBidInvitations.bidRequestId, subcontractorBidRequests.id))
      .innerJoin(organizations, eq(subcontractorBidRequests.organizationId, organizations.id))
      .where(eq(subcontractorBidInvitations.id, invitationId));
    
    if (!invitation || invitation.invitation.invitedOrganizationId !== user.organizationId) {
      return res.status(404).json({ error: "Invitation not found" });
    }
    
    // Mark as viewed if first view
    if (invitation.invitation.status === "PENDING" && !invitation.invitation.viewedAt) {
      await db
        .update(subcontractorBidInvitations)
        .set({ 
          viewedAt: new Date(),
          status: "VIEWED",
          updatedAt: new Date()
        })
        .where(eq(subcontractorBidInvitations.id, invitationId));
      
      // Increment view count on request
      await db
        .update(subcontractorBidRequests)
        .set({ viewCount: sql`${subcontractorBidRequests.viewCount} + 1` })
        .where(eq(subcontractorBidRequests.id, invitation.request.id));
    }
    
    // Get any existing response
    const [response] = await db
      .select()
      .from(subcontractorBidResponses)
      .where(and(
        eq(subcontractorBidResponses.invitationId, invitationId),
        eq(subcontractorBidResponses.respondingOrganizationId, user.organizationId!)
      ));
    
    // Get clarifications
    const clarifications = await db
      .select()
      .from(bidRequestClarifications)
      .where(and(
        eq(bidRequestClarifications.bidRequestId, invitation.request.id),
        or(
          eq(bidRequestClarifications.askedByOrganizationId, user.organizationId!),
          eq(bidRequestClarifications.isPublicToAllInvitees, true)
        )
      ))
      .orderBy(desc(bidRequestClarifications.createdAt));
    
    res.json({
      ...invitation.invitation,
      request: {
        ...invitation.request,
        internalNotes: undefined,
        budgetRangeMin: invitation.request.showBudgetToSubs ? invitation.request.budgetRangeMin : undefined,
        budgetRangeMax: invitation.request.showBudgetToSubs ? invitation.request.budgetRangeMax : undefined
      },
      gcOrganization: {
        id: invitation.gcOrganization.id,
        name: invitation.gcOrganization.name,
        logoUrl: invitation.gcOrganization.logoUrl
      },
      myResponse: response || null,
      clarifications
    });
  } catch (error) {
    logError("Failed to get invitation", undefined, error as Error);
    res.status(500).json({ error: "Failed to get invitation details" });
  }
});

// Decline invitation
// Accessible by ADMIN, MANAGER, ESTIMATOR, VENDOR
router.post("/inbox/:invitationId/decline", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "VENDOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { invitationId } = req.params;
    const { reason } = req.body;
    
    const [invitation] = await db
      .select()
      .from(subcontractorBidInvitations)
      .where(eq(subcontractorBidInvitations.id, invitationId));
    
    if (!invitation || invitation.invitedOrganizationId !== user.organizationId) {
      return res.status(404).json({ error: "Invitation not found" });
    }
    
    await db
      .update(subcontractorBidInvitations)
      .set({
        status: "DECLINED",
        declinedReason: reason,
        respondedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(subcontractorBidInvitations.id, invitationId));
    
    logInfo("Bid invitation declined", { invitationId, organizationId: user.organizationId || undefined });
    res.json({ success: true });
  } catch (error) {
    logError("Failed to decline invitation", undefined, error as Error);
    res.status(500).json({ error: "Failed to decline invitation" });
  }
});

// ============================================
// BID RESPONSES (Sub Submits)
// ============================================

// Create/update response
// Accessible by ADMIN, MANAGER, ESTIMATOR, VENDOR
router.post("/responses", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "VENDOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = req.body;
    
    // Verify invitation exists and belongs to user's org
    const [invitation] = await db
      .select()
      .from(subcontractorBidInvitations)
      .where(eq(subcontractorBidInvitations.id, data.invitationId));
    
    if (!invitation || invitation.invitedOrganizationId !== user.organizationId) {
      return res.status(404).json({ error: "Invitation not found" });
    }
    
    // Check for existing response
    const [existing] = await db
      .select()
      .from(subcontractorBidResponses)
      .where(eq(subcontractorBidResponses.invitationId, data.invitationId));
    
    if (existing) {
      // Update existing
      const [updated] = await db
        .update(subcontractorBidResponses)
        .set({
          ...data,
          updatedAt: new Date(),
          submittedAt: data.status === "SUBMITTED" ? new Date() : existing.submittedAt
        })
        .where(eq(subcontractorBidResponses.id, existing.id))
        .returning();
      
      // Update invitation status
      if (data.status === "SUBMITTED") {
        await db
          .update(subcontractorBidInvitations)
          .set({ status: "RESPONDED", respondedAt: new Date(), updatedAt: new Date() })
          .where(eq(subcontractorBidInvitations.id, data.invitationId));
        
        // Update response count on request
        if (existing.status !== "SUBMITTED") {
          await db
            .update(subcontractorBidRequests)
            .set({ responseCount: sql`${subcontractorBidRequests.responseCount} + 1` })
            .where(eq(subcontractorBidRequests.id, invitation.bidRequestId));
        }

        const [bidRequestForNotify] = await db
          .select()
          .from(subcontractorBidRequests)
          .where(eq(subcontractorBidRequests.id, invitation.bidRequestId));

        if (bidRequestForNotify) {
          const [subOrgForNotify] = await db
            .select({ name: organizations.name })
            .from(organizations)
            .where(eq(organizations.id, user.organizationId!));

          sendBidResponseNotification(
            bidRequestForNotify.organizationId,
            {
              id: bidRequestForNotify.id,
              title: bidRequestForNotify.title,
              scopeOfWork: bidRequestForNotify.scopeOfWork,
              bidDueDate: new Date(bidRequestForNotify.bidDueDate),
              requiredTrades: bidRequestForNotify.requiredTrades || [],
              gcOrganizationName: "",
            },
            {
              id: updated.id,
              totalBidAmount: parseFloat(updated.totalBidAmount || "0"),
              subOrganizationName: subOrgForNotify?.name || "Unknown Sub",
              submittedAt: new Date(),
            }
          ).catch(err => logError("Response notification failed (resubmission)", undefined, err as Error));

          const bidAmountFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(updated.totalBidAmount || "0"));
          createBidNetworkInAppNotification(
            bidRequestForNotify.organizationId,
            "BID_RESPONSE_RECEIVED",
            "Updated Bid Response",
            `${subOrgForNotify?.name || "A subcontractor"} resubmitted a bid of ${bidAmountFmt} for "${bidRequestForNotify.title}"`,
            updated.id,
            "bid_response"
          ).catch(err => logError("In-app notification failed (resubmission)", undefined, err as Error));
        }

        if (bidRequestForNotify?.bidId) {
          try {
            const { bidSubcontractorQuotes } = await import("@shared/schema");
            const [subOrg] = await db
              .select({ name: organizations.name })
              .from(organizations)
              .where(eq(organizations.id, user.organizationId!));

            const [existingQuote] = await db
              .select()
              .from(bidSubcontractorQuotes)
              .where(and(
                eq(bidSubcontractorQuotes.bidId, bidRequestForNotify.bidId),
                like(bidSubcontractorQuotes.notes, `%[bid_network_response:${data.invitationId}]%`)
              ))
              .limit(1);

            if (existingQuote) {
              await db
                .update(bidSubcontractorQuotes)
                .set({
                  quoteAmount: updated.totalBidAmount || "0",
                  subcontractorName: subOrg?.name || existingQuote.subcontractorName,
                  rfqStatus: "responded",
                  updatedAt: new Date()
                })
                .where(eq(bidSubcontractorQuotes.id, existingQuote.id));
            } else {
              await db.insert(bidSubcontractorQuotes).values({
                bidId: bidRequestForNotify.bidId,
                subcontractorName: subOrg?.name || "Unknown Sub",
                scopeOfWork: bidRequestForNotify.scopeOfWork.substring(0, 500),
                quoteAmount: updated.totalBidAmount || "0",
                contactName: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : undefined,
                contactEmail: user.email || undefined,
                rfqStatus: "responded",
                notes: `Auto-imported from Bid Network response [bid_network_response:${data.invitationId}]`,
              });
            }
            logInfo("Auto-synced resubmitted bid response to internal quote", { responseId: updated.id, bidId: bidRequestForNotify.bidId });
          } catch (syncError) {
            logError("Auto-sync to internal quote failed (resubmission)", undefined, syncError as Error);
          }
        }
      }
      
      return res.json(updated);
    } else {
      // Create new
      const [created] = await db
        .insert(subcontractorBidResponses)
        .values({
          ...data,
          bidRequestId: invitation.bidRequestId,
          respondingOrganizationId: user.organizationId!,
          createdByUserId: user.id,
          submittedAt: data.status === "SUBMITTED" ? new Date() : null
        })
        .returning();
      
      // Update invitation status
      if (data.status === "SUBMITTED") {
        await db
          .update(subcontractorBidInvitations)
          .set({ status: "RESPONDED", respondedAt: new Date(), updatedAt: new Date() })
          .where(eq(subcontractorBidInvitations.id, data.invitationId));
        
        await db
          .update(subcontractorBidRequests)
          .set({ responseCount: sql`${subcontractorBidRequests.responseCount} + 1` })
          .where(eq(subcontractorBidRequests.id, invitation.bidRequestId));
      }
      
      // Send email notification to GC when submitted
      if (data.status === "SUBMITTED") {
        // Get request and GC org
        const [bidRequest] = await db
          .select()
          .from(subcontractorBidRequests)
          .where(eq(subcontractorBidRequests.id, invitation.bidRequestId));
        
        const [subOrg] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, user.organizationId!));
        
        if (bidRequest) {
          sendBidResponseNotification(
            bidRequest.organizationId,
            {
              id: bidRequest.id,
              title: bidRequest.title,
              scopeOfWork: bidRequest.scopeOfWork,
              bidDueDate: new Date(bidRequest.bidDueDate),
              requiredTrades: bidRequest.requiredTrades || [],
              gcOrganizationName: "",
            },
            {
              id: created.id,
              totalBidAmount: parseFloat(created.totalBidAmount || "0"),
              subOrganizationName: subOrg?.name || "Unknown Sub",
              submittedAt: new Date(),
            }
          ).catch(err => logError("Response notification failed", undefined, err as Error));

          const bidAmount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(created.totalBidAmount || "0"));
          createBidNetworkInAppNotification(
            bidRequest.organizationId,
            "BID_RESPONSE_RECEIVED",
            "New Bid Response",
            `${subOrg?.name || "A subcontractor"} submitted a bid of ${bidAmount} for "${bidRequest.title}"`,
            created.id,
            "bid_response"
          ).catch(err => logError("In-app notification failed", undefined, err as Error));

          if (bidRequest.bidId) {
            try {
              const { bidSubcontractorQuotes } = await import("@shared/schema");
              const subName = subOrg?.name || "Unknown Sub";
              const [existingQuote] = await db
                .select()
                .from(bidSubcontractorQuotes)
                .where(and(
                  eq(bidSubcontractorQuotes.bidId, bidRequest.bidId),
                  like(bidSubcontractorQuotes.notes, `%[bid_network_response:${data.invitationId}]%`)
                ))
                .limit(1);

              if (existingQuote) {
                await db
                  .update(bidSubcontractorQuotes)
                  .set({
                    quoteAmount: created.totalBidAmount || "0",
                    subcontractorName: subName,
                    rfqStatus: "responded",
                    updatedAt: new Date()
                  })
                  .where(eq(bidSubcontractorQuotes.id, existingQuote.id));
              } else {
                await db.insert(bidSubcontractorQuotes).values({
                  bidId: bidRequest.bidId,
                  subcontractorName: subName,
                  scopeOfWork: bidRequest.scopeOfWork.substring(0, 500),
                  quoteAmount: created.totalBidAmount || "0",
                  contactName: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : undefined,
                  contactEmail: user.email || undefined,
                  rfqStatus: "responded",
                  notes: `Auto-imported from Bid Network response [bid_network_response:${data.invitationId}]`,
                });
              }
              logInfo("Auto-synced bid response to internal quote", { responseId: created.id, bidId: bidRequest.bidId, invitationId: data.invitationId });
            } catch (syncError) {
              logError("Auto-sync to internal quote failed", undefined, syncError as Error);
            }
          }
        }
      }
      
      logInfo("Bid response created", { responseId: created.id, invitationId: data.invitationId });
      return res.status(201).json(created);
    }
  } catch (error) {
    logError("Failed to save response", undefined, error as Error);
    res.status(500).json({ error: "Failed to save response" });
  }
});

// Get response by ID
// Accessible by ADMIN, MANAGER, ESTIMATOR, VENDOR
router.get("/responses/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "VENDOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    
    const [response] = await db
      .select()
      .from(subcontractorBidResponses)
      .where(eq(subcontractorBidResponses.id, id));
    
    if (!response) {
      return res.status(404).json({ error: "Response not found" });
    }
    
    // Get request to check ownership
    const [request] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, response.bidRequestId));
    
    // Security: Either the sub who created it or the GC who owns the request
    const isOwner = response.respondingOrganizationId === user.organizationId;
    const isGC = request?.organizationId === user.organizationId;
    
    if (!isOwner && !isGC && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Hide internal notes based on who's viewing
    const result = { ...response };
    if (!isOwner) {
      result.subInternalNotes = null;
    }
    if (!isGC) {
      result.gcInternalRating = null;
      result.gcInternalNotes = null;
    }
    
    res.json(result);
  } catch (error) {
    logError("Failed to get response", undefined, error as Error);
    res.status(500).json({ error: "Failed to get response" });
  }
});

// GC updates response status (shortlist, award, etc.)
// Restricted to ADMIN, MANAGER only
router.patch("/responses/:id/status", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { status, gcInternalRating, gcInternalNotes } = req.body;
    
    // Get response and verify GC ownership
    const [response] = await db
      .select()
      .from(subcontractorBidResponses)
      .where(eq(subcontractorBidResponses.id, id));
    
    if (!response) {
      return res.status(404).json({ error: "Response not found" });
    }
    
    const [request] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, response.bidRequestId));
    
    if (!request || request.organizationId !== user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const [updated] = await db
      .update(subcontractorBidResponses)
      .set({
        status,
        gcInternalRating,
        gcInternalNotes,
        reviewedAt: new Date(),
        reviewedByUserId: user.id,
        updatedAt: new Date()
      })
      .where(eq(subcontractorBidResponses.id, id))
      .returning();
    
    // If awarding, update the request and notify the subcontractor
    if (status === "AWARDED") {
      await db
        .update(subcontractorBidRequests)
        .set({
          status: "AWARDED",
          awardedAt: new Date(),
          awardedToOrganizationId: response.respondingOrganizationId,
          updatedAt: new Date()
        })
        .where(eq(subcontractorBidRequests.id, response.bidRequestId));

      try {
        const subUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, response.respondingOrganizationId),
              eq(users.isActive, true),
              inArray(users.role, ["ADMIN", "MANAGER", "ESTIMATOR"])
            )
          );

        if (subUsers.length > 0) {
          const notificationValues = subUsers.map((subUser) => ({
            userId: subUser.id,
            type: "BID_AWARDED" as const,
            title: "Bid Awarded",
            message: `Your bid for "${request.title}" has been awarded. Congratulations!`,
            relatedEntityId: request.id,
            relatedEntityType: "bid_request",
            organizationId: response.respondingOrganizationId,
          }));

          await insertNotifications(notificationValues);
        }
      } catch (notifError) {
        logError("Failed to create bid award notifications:", {}, notifError instanceof Error ? notifError : new Error(String(notifError)));
      }
    }
    
    logInfo("Bid response status updated", { responseId: id, status });
    res.json(updated);
  } catch (error) {
    logError("Failed to update response status", undefined, error as Error);
    res.status(500).json({ error: "Failed to update response status" });
  }
});

// ============================================
// CLARIFICATIONS (Q&A)
// ============================================

// Ask a clarification question
// Accessible by ADMIN, MANAGER, ESTIMATOR, VENDOR
router.post("/clarifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "VENDOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { bidRequestId, question } = req.body;
    
    // Verify sub has an invitation
    const [invitation] = await db
      .select()
      .from(subcontractorBidInvitations)
      .where(and(
        eq(subcontractorBidInvitations.bidRequestId, bidRequestId),
        eq(subcontractorBidInvitations.invitedOrganizationId, user.organizationId!)
      ));
    
    if (!invitation) {
      return res.status(403).json({ error: "You must be invited to ask questions" });
    }
    
    const [clarification] = await db
      .insert(bidRequestClarifications)
      .values({
        bidRequestId,
        askedByOrganizationId: user.organizationId!,
        askedByUserId: user.id,
        question,
        isPublicToAllInvitees: false
      })
      .returning();
    
    const [bidReq] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, bidRequestId));

    if (bidReq) {
      sendClarificationNotification(
        bidReq.organizationId,
        {
          id: bidReq.id,
          title: bidReq.title,
          scopeOfWork: bidReq.scopeOfWork,
          bidDueDate: new Date(bidReq.bidDueDate),
          requiredTrades: bidReq.requiredTrades || [],
          gcOrganizationName: "",
        },
        question,
        false
      ).catch(err => logError("Clarification email failed", undefined, err as Error));

      createBidNetworkInAppNotification(
        bidReq.organizationId,
        "BID_CLARIFICATION_NEW",
        "New Clarification Question",
        `A subcontractor asked a question about "${bidReq.title}"`,
        clarification.id,
        "bid_clarification"
      ).catch(err => logError("In-app notification failed", undefined, err as Error));
    }

    logInfo("Clarification question asked", { clarificationId: clarification.id });
    res.status(201).json(clarification);
  } catch (error) {
    logError("Failed to ask clarification", undefined, error as Error);
    res.status(500).json({ error: "Failed to submit question" });
  }
});

// Answer a clarification (GC only)
// Restricted to ADMIN, MANAGER, ESTIMATOR
router.patch("/clarifications/:id/answer", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { answer, isPublicToAllInvitees } = req.body;
    
    // Get clarification and verify GC ownership
    const [clarification] = await db
      .select()
      .from(bidRequestClarifications)
      .where(eq(bidRequestClarifications.id, id));
    
    if (!clarification) {
      return res.status(404).json({ error: "Question not found" });
    }
    
    const [request] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, clarification.bidRequestId));
    
    if (!request || request.organizationId !== user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const [updated] = await db
      .update(bidRequestClarifications)
      .set({
        answer,
        answeredByUserId: user.id,
        answeredAt: new Date(),
        isPublicToAllInvitees: isPublicToAllInvitees ?? clarification.isPublicToAllInvitees,
        updatedAt: new Date()
      })
      .where(eq(bidRequestClarifications.id, id))
      .returning();

    if (clarification.askedByOrganizationId) {
      sendClarificationNotification(
        clarification.askedByOrganizationId,
        {
          id: request.id,
          title: request.title,
          scopeOfWork: request.scopeOfWork,
          bidDueDate: new Date(request.bidDueDate),
          requiredTrades: request.requiredTrades || [],
          gcOrganizationName: "",
        },
        clarification.question,
        true,
        answer
      ).catch(err => logError("Clarification answer email failed", undefined, err as Error));

      createBidNetworkInAppNotification(
        clarification.askedByOrganizationId,
        "BID_CLARIFICATION_NEW",
        "Clarification Answered",
        `Your question about "${request.title}" has been answered`,
        updated.id,
        "bid_clarification"
      ).catch(err => logError("In-app notification failed", undefined, err as Error));
    }
    
    res.json(updated);
  } catch (error) {
    logError("Failed to answer clarification", undefined, error as Error);
    res.status(500).json({ error: "Failed to submit answer" });
  }
});

// Get clarifications for a request (GC view)
// Restricted to ADMIN, MANAGER, ESTIMATOR
router.get("/requests/:requestId/clarifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { requestId } = req.params;
    
    // Verify GC ownership
    const [request] = await db
      .select()
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.id, requestId));
    
    if (!request || request.organizationId !== user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const clarifications = await db
      .select({
        clarification: bidRequestClarifications,
        askedByOrg: organizations
      })
      .from(bidRequestClarifications)
      .leftJoin(organizations, eq(bidRequestClarifications.askedByOrganizationId, organizations.id))
      .where(eq(bidRequestClarifications.bidRequestId, requestId))
      .orderBy(desc(bidRequestClarifications.createdAt));
    
    res.json(clarifications.map(c => ({
      ...c.clarification,
      askedByOrganization: c.askedByOrg ? {
        id: c.askedByOrg.id,
        name: c.askedByOrg.name
      } : null
    })));
  } catch (error) {
    logError("Failed to get clarifications", undefined, error as Error);
    res.status(500).json({ error: "Failed to get clarifications" });
  }
});

// ============================================
// DASHBOARD STATS
// ============================================

// Get bid network stats for organization
// Get bid network statistics
// Restricted to ADMIN, MANAGER, ESTIMATOR
router.get("/stats", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    // Outgoing requests (as GC)
    const outgoingStats = await db
      .select({
        status: subcontractorBidRequests.status,
        count: sql<number>`count(*)::int`
      })
      .from(subcontractorBidRequests)
      .where(eq(subcontractorBidRequests.organizationId, user.organizationId!))
      .groupBy(subcontractorBidRequests.status);
    
    // Incoming invitations (as Sub)
    const incomingStats = await db
      .select({
        status: subcontractorBidInvitations.status,
        count: sql<number>`count(*)::int`
      })
      .from(subcontractorBidInvitations)
      .where(eq(subcontractorBidInvitations.invitedOrganizationId, user.organizationId!))
      .groupBy(subcontractorBidInvitations.status);
    
    res.json({
      outgoing: {
        total: outgoingStats.reduce((acc, s) => acc + s.count, 0),
        byStatus: Object.fromEntries(outgoingStats.map(s => [s.status, s.count]))
      },
      incoming: {
        total: incomingStats.reduce((acc, s) => acc + s.count, 0),
        byStatus: Object.fromEntries(incomingStats.map(s => [s.status, s.count]))
      }
    });
  } catch (error) {
    logError("Failed to get bid network stats", undefined, error as Error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export default router;
