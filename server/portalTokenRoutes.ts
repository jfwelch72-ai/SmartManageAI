import { Router, Response } from "express";
import { db } from "./db";
import {
  subcontractorPortalTokens, portalActivityLog,
  projects, users, crmOrganisations,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { generatePortalToken, hashPortalToken } from "./portalAuth";
import { getOrgIdForFilter } from "./orgFilter";
import { sendEmail } from "./email";

const router = Router();

router.get("/portal/manage/tokens", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin: isSA } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const projectIdFilter = req.query.projectId as string | undefined;

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(subcontractorPortalTokens.organizationId, orgId));
    }
    if (projectIdFilter) {
      conditions.push(eq(subcontractorPortalTokens.projectId, projectIdFilter));
    }

    const results = await db
      .select({
        token: subcontractorPortalTokens,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
        subcontractor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
        },
      })
      .from(subcontractorPortalTokens)
      .leftJoin(projects, eq(subcontractorPortalTokens.projectId, projects.id))
      .leftJoin(crmOrganisations, eq(subcontractorPortalTokens.crmOrganisationId, crmOrganisations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(subcontractorPortalTokens.createdAt));

    const mapped = results.map((r) => ({
      id: r.token.id,
      organizationId: r.token.organizationId,
      projectId: r.token.projectId,
      crmOrganisationId: r.token.crmOrganisationId,
      contactEmail: r.token.contactEmail,
      contactName: r.token.contactName,
      permissions: r.token.permissions,
      status: r.token.status,
      expiresAt: r.token.expiresAt,
      lastAccessedAt: r.token.lastAccessedAt,
      invitedByName: r.token.invitedByName,
      createdAt: r.token.createdAt,
      revokedAt: r.token.revokedAt,
      project: r.project,
      subcontractor: r.subcontractor,
    }));

    res.json(mapped);
  } catch (error) {
    console.error("Get portal tokens error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/manage/invite", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = user.organizationId || req.body.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "No organization assigned. Please specify an organizationId." });
    }

    const { projectId, crmOrganisationId, contactEmail, contactName, permissions, expiresInDays } = req.body;

    if (!projectId || !crmOrganisationId || !contactEmail || !contactName) {
      return res.status(400).json({ error: "projectId, crmOrganisationId, contactEmail, and contactName are required" });
    }

    const rawToken = generatePortalToken();
    const tokenHash = await hashPortalToken(rawToken);

    const days = expiresInDays || 90;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const defaultPermissions = permissions || ["view", "comment", "upload", "acknowledge"];

    const [created] = await db.insert(subcontractorPortalTokens).values({
      organizationId: organizationId || req.body.organizationId,
      projectId,
      crmOrganisationId,
      contactEmail,
      contactName,
      tokenHash,
      permissions: defaultPermissions,
      status: "active",
      expiresAt,
      invitedById: user.id,
      invitedByName: `${user.firstName} ${user.lastName}`,
    }).returning();

    const baseUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS}`
      : process.env.APP_URL || "http://localhost:5000";
    const portalLink = `${baseUrl}/sub-portal?token=${rawToken}`;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const projectName = project?.name || "your project";

    try {
      await sendEmail({
        to: contactEmail,
        subject: `Portal Access Invitation - ${projectName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a2e;">Subcontractor Portal Access</h2>
            <p>Hello ${contactName},</p>
            <p>You have been invited to access the subcontractor portal for <strong>${projectName}</strong> by ${created.invitedByName}.</p>
            <p>Through this portal, you can:</p>
            <ul>
              <li>View and respond to RFIs assigned to your company</li>
              <li>Review and comment on submittals</li>
              <li>Acknowledge receipt of transmittals</li>
              <li>Upload documents and files</li>
            </ul>
            <p style="margin: 24px 0;">
              <a href="${portalLink}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Access Portal</a>
            </p>
            <p style="color: #666; font-size: 13px;">This link expires in ${days} days. If you need a new link, please contact your general contractor.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px;">Powered by SmartManageAI</p>
          </div>
        `,
        text: `Hello ${contactName}, you have been invited to access the subcontractor portal for ${projectName}. Access it here: ${portalLink}`,
      });
    } catch (emailError) {
      console.error("Failed to send portal invite email:", emailError);
    }

    res.status(201).json({
      ...created,
      rawToken,
      portalLink,
    });
  } catch (error) {
    console.error("Create portal invite error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/manage/revoke/:tokenId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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

    const [updated] = await db
      .update(subcontractorPortalTokens)
      .set({
        status: "revoked",
        revokedAt: new Date(),
      })
      .where(eq(subcontractorPortalTokens.id, tokenId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Revoke portal token error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/manage/resend/:tokenId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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

    const rawToken = generatePortalToken();
    const tokenHash = await hashPortalToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const [updated] = await db
      .update(subcontractorPortalTokens)
      .set({
        tokenHash,
        status: "active",
        expiresAt,
        revokedAt: null,
      })
      .where(eq(subcontractorPortalTokens.id, tokenId))
      .returning();

    res.json({
      ...updated,
      rawToken,
    });
  } catch (error) {
    console.error("Resend portal token error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
