import { Router, Response } from "express";
import { db } from "./db";
import {
  subcontractorPortalTokens, portalActivityLog,
  projects, users, crmOrganisations,
  bidDocumentDistributions, notifications,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { generatePortalToken, hashPortalToken } from "./portalAuth";
import { getOrgIdForFilter } from "./orgFilter";
import { sendEmail } from "./email";

const router = Router();

export async function logPortalActivity(portalTokenId: string, action: string, entityType: string | null, entityId: string | null, ipAddress: string | undefined) {
  await db.insert(portalActivityLog).values({
    portalTokenId,
    action,
    entityType,
    entityId,
    ipAddress: ipAddress || null,
  });
}

export async function notifyGcTeamOfPortalActivity(
  organizationId: string,
  projectId: string,
  contactName: string,
  title: string,
  message: string
) {
  try {
    const gcTeamMembers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          inArray(users.role, ["ADMIN", "MANAGER"]),
          eq(users.isActive, true)
        )
      );

    if (gcTeamMembers.length === 0) return;

    const notificationValues = gcTeamMembers.map((member) => ({
      userId: member.id,
      type: "PORTAL_ACTIVITY" as const,
      title,
      message,
      relatedEntityId: projectId,
      relatedEntityType: "project",
    }));

    await db.insert(notifications).values(notificationValues);
  } catch (error) {
    console.error("Failed to create portal activity notifications:", error);
  }
}

router.get("/portal/manage/activity/:tokenId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { tokenId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select()
      .from(subcontractorPortalTokens)
      .where(eq(subcontractorPortalTokens.id, tokenId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Token not found" });
    }

    if (shouldFilter && orgId && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const activity = await db
      .select()
      .from(portalActivityLog)
      .where(eq(portalActivityLog.portalTokenId, tokenId))
      .orderBy(desc(portalActivityLog.createdAt));

    res.json(activity);
  } catch (error) {
    console.error("Get portal activity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bid-docs/send", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = user.organizationId || req.body.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "No organization assigned. Please specify an organizationId." });
    }

    const { 
      bidId, projectId, crmOrganisationId, contactEmail, contactName,
      documentType, documentId, documentTitle, messageBody,
      createPortalAccess, expiresInDays 
    } = req.body;

    if (!crmOrganisationId || !contactEmail || !contactName || !documentType || !documentTitle) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let portalTokenId = null;
    let portalLink = null;

    if (createPortalAccess && projectId) {
      const rawToken = generatePortalToken();
      const tokenHash = await hashPortalToken(rawToken);
      const days = expiresInDays || 90;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);

      const [portalToken] = await db.insert(subcontractorPortalTokens).values({
        organizationId,
        projectId,
        crmOrganisationId,
        contactEmail,
        contactName,
        tokenHash,
        permissions: ["view", "comment"],
        status: "active",
        expiresAt,
        invitedById: user.id,
        invitedByName: `${user.firstName} ${user.lastName}`,
      }).returning();

      portalTokenId = portalToken.id;
      
      const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS}`
        : process.env.APP_URL || "http://localhost:5000";
      portalLink = `${baseUrl}/sub-portal?token=${rawToken}`;
    }

    const [distribution] = await db.insert(bidDocumentDistributions).values({
      organizationId,
      bidId: bidId || null,
      projectId: projectId || null,
      crmOrganisationId,
      contactEmail,
      contactName,
      documentType,
      documentId: documentId || null,
      documentTitle,
      portalTokenId,
      status: "sent",
      messageBody: messageBody || null,
      sentById: user.id,
      sentByName: `${user.firstName} ${user.lastName}`,
    }).returning();

    try {
      let emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a2e;">Document Distribution</h2>
          <p>Hello ${contactName},</p>
          <p>${messageBody || `You have been sent a document for your review.`}</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">${documentTitle}</p>
            <p style="margin: 4px 0 0; color: #666; font-size: 14px;">Type: ${documentType}</p>
          </div>
      `;
      if (portalLink) {
        emailBody += `
          <p>You can access and respond to this document through our secure portal:</p>
          <p style="margin: 24px 0;">
            <a href="${portalLink}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Document</a>
          </p>
        `;
      }
      emailBody += `
          <p style="color: #666; font-size: 13px;">If you have questions, please contact your general contractor directly.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">Sent by ${user.firstName} ${user.lastName} via SmartManageAI</p>
        </div>
      `;
      
      await sendEmail({
        to: contactEmail,
        subject: `Document: ${documentTitle}`,
        html: emailBody,
        text: `Hello ${contactName}, you have been sent a document: ${documentTitle}. ${portalLink ? `View it here: ${portalLink}` : ''}`,
      });
    } catch (emailError) {
      console.error("Failed to send bid doc distribution email:", emailError);
    }

    res.status(201).json({ ...distribution, portalLink });
  } catch (error) {
    console.error("Send bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bid-docs/distributions", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(bidDocumentDistributions.organizationId, orgId));
    }
    if (req.query.bidId) {
      conditions.push(eq(bidDocumentDistributions.bidId, req.query.bidId as string));
    }
    if (req.query.projectId) {
      conditions.push(eq(bidDocumentDistributions.projectId, req.query.projectId as string));
    }

    const distributions = await db
      .select()
      .from(bidDocumentDistributions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(bidDocumentDistributions.sentAt));

    res.json(distributions);
  } catch (error) {
    console.error("List bid doc distributions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/bid-docs/distributions/:id/status", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select()
      .from(bidDocumentDistributions)
      .where(eq(bidDocumentDistributions.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Distribution not found" });
    }

    if (shouldFilter && orgId && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { status, responseNotes } = req.body;

    if (!["sent", "viewed", "responded", "expired"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const updates: any = { status };
    if (status === "viewed") updates.viewedAt = new Date();
    if (status === "responded") {
      updates.respondedAt = new Date();
      if (responseNotes) updates.responseNotes = responseNotes;
    }

    const [updated] = await db
      .update(bidDocumentDistributions)
      .set(updates)
      .where(eq(bidDocumentDistributions.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update distribution status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
