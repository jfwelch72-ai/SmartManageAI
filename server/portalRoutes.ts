import { Router, Response } from "express";
import { db } from "./db";
import {
  rfis, submittals, documentTransmittals, transmittalRecipients,
  rfiActivity, submittalActivity,
  subcontractorPortalTokens, portalActivityLog,
  projects, users, crmOrganisations,
  bidDocumentDistributions, notifications
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requirePortalAuth, requirePortalPermission, type PortalRequest } from "./portalAuth";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { generatePortalToken, hashPortalToken } from "./portalAuth";
import { getOrgIdForFilter } from "./orgFilter";
import { sendEmail } from "./email";

const router = Router();

async function logPortalActivity(portalTokenId: string, action: string, entityType: string | null, entityId: string | null, ipAddress: string | undefined) {
  await db.insert(portalActivityLog).values({
    portalTokenId,
    action,
    entityType,
    entityId,
    ipAddress: ipAddress || null,
  });
}

async function notifyGcTeamOfPortalActivity(
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

// ============================================================
// Section 1: Portal API Routes (token-based, no login required)
// ============================================================

router.get("/portal/info", requirePortalAuth, async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;

    const [project] = await db
      .select({ id: projects.id, name: projects.name, code: projects.code })
      .from(projects)
      .where(eq(projects.id, token.projectId))
      .limit(1);

    const [subCompany] = await db
      .select({ id: crmOrganisations.id, name: crmOrganisations.name })
      .from(crmOrganisations)
      .where(eq(crmOrganisations.id, token.crmOrganisationId))
      .limit(1);

    res.json({
      project: project || null,
      subcontractor: subCompany || null,
      permissions: token.permissions,
      contactName: token.contactName,
      contactEmail: token.contactEmail,
    });
  } catch (error) {
    console.error("Portal info error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portal/rfis", requirePortalAuth, requirePortalPermission("view"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;

    const results = await db
      .select({
        rfi: rfis,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(rfis)
      .leftJoin(projects, eq(rfis.projectId, projects.id))
      .where(
        and(
          eq(rfis.projectId, token.projectId),
          eq(rfis.subcontractorId, token.crmOrganisationId)
        )
      )
      .orderBy(desc(rfis.createdAt));

    const mapped = results.map((r) => ({
      ...r.rfi,
      project: r.project,
    }));

    await logPortalActivity(token.id, "viewed_rfis_list", "rfi", null, req.ip);

    res.json(mapped);
  } catch (error) {
    console.error("Portal get RFIs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portal/rfis/:id", requirePortalAuth, requirePortalPermission("view"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { id } = req.params;

    const [result] = await db
      .select({
        rfi: rfis,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(rfis)
      .leftJoin(projects, eq(rfis.projectId, projects.id))
      .where(eq(rfis.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "RFI not found" });
    }

    if (result.rfi.projectId !== token.projectId || result.rfi.subcontractorId !== token.crmOrganisationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const activity = await db
      .select()
      .from(rfiActivity)
      .where(eq(rfiActivity.rfiId, id))
      .orderBy(desc(rfiActivity.createdAt));

    await logPortalActivity(token.id, "viewed_rfi_detail", "rfi", id, req.ip);

    res.json({
      ...result.rfi,
      project: result.project,
      activity,
    });
  } catch (error) {
    console.error("Portal get RFI detail error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/rfis/:id/comment", requirePortalAuth, requirePortalPermission("comment"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const [rfi] = await db
      .select()
      .from(rfis)
      .where(eq(rfis.id, id))
      .limit(1);

    if (!rfi) {
      return res.status(404).json({ error: "RFI not found" });
    }

    if (rfi.projectId !== token.projectId || rfi.subcontractorId !== token.crmOrganisationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const portalUserId = `portal_${token.id}`;
    await db.execute(sql`
      INSERT INTO rfi_activity (id, rfi_id, user_id, user_name, action, comment, created_at)
      VALUES (gen_random_uuid(), ${id}, ${portalUserId}, ${token.contactName}, 'COMMENT', ${comment}, NOW())
    `);

    await logPortalActivity(token.id, "commented_on_rfi", "rfi", id, req.ip);

    notifyGcTeamOfPortalActivity(
      token.organizationId,
      token.projectId,
      token.contactName,
      "Subcontractor Comment on RFI",
      `${token.contactName} posted a comment on RFI #${rfi.rfiNumber || id}`
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Portal RFI comment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portal/submittals", requirePortalAuth, requirePortalPermission("view"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;

    const results = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(
        and(
          eq(submittals.projectId, token.projectId),
          eq(submittals.subcontractorId, token.crmOrganisationId)
        )
      )
      .orderBy(desc(submittals.createdAt));

    const mapped = results.map((r) => ({
      ...r.submittal,
      project: r.project,
    }));

    await logPortalActivity(token.id, "viewed_submittals_list", "submittal", null, req.ip);

    res.json(mapped);
  } catch (error) {
    console.error("Portal get submittals error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portal/submittals/:id", requirePortalAuth, requirePortalPermission("view"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { id } = req.params;

    const [result] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (result.submittal.projectId !== token.projectId || result.submittal.subcontractorId !== token.crmOrganisationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const activity = await db
      .select()
      .from(submittalActivity)
      .where(eq(submittalActivity.submittalId, id))
      .orderBy(desc(submittalActivity.createdAt));

    await logPortalActivity(token.id, "viewed_submittal_detail", "submittal", id, req.ip);

    res.json({
      ...result.submittal,
      project: result.project,
      activity,
    });
  } catch (error) {
    console.error("Portal get submittal detail error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/submittals/:id/comment", requirePortalAuth, requirePortalPermission("comment"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const [submittal] = await db
      .select()
      .from(submittals)
      .where(eq(submittals.id, id))
      .limit(1);

    if (!submittal) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (submittal.projectId !== token.projectId || submittal.subcontractorId !== token.crmOrganisationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const portalUserId = `portal_${token.id}`;
    await db.execute(sql`
      INSERT INTO submittal_activity (id, submittal_id, user_id, user_name, action, comment, created_at)
      VALUES (gen_random_uuid(), ${id}, ${portalUserId}, ${token.contactName}, 'COMMENT', ${comment}, NOW())
    `);

    await logPortalActivity(token.id, "commented_on_submittal", "submittal", id, req.ip);

    notifyGcTeamOfPortalActivity(
      token.organizationId,
      token.projectId,
      token.contactName,
      "Subcontractor Comment on Submittal",
      `${token.contactName} posted a comment on Submittal #${submittal.submittalNumber || id}`
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Portal submittal comment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/submittals/:id/upload", requirePortalAuth, requirePortalPermission("upload"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { id } = req.params;
    const { fileUrl, fileName, fileSize, mimeType, description } = req.body;

    if (!fileUrl || !fileName) {
      return res.status(400).json({ error: "fileUrl and fileName are required" });
    }

    const [submittal] = await db
      .select()
      .from(submittals)
      .where(eq(submittals.id, id))
      .limit(1);

    if (!submittal) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (submittal.projectId !== token.projectId || submittal.subcontractorId !== token.crmOrganisationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const currentAttachments = submittal.attachmentsJson
      ? JSON.parse(submittal.attachmentsJson)
      : [];

    const newAttachment = {
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      fileUrl,
      fileName,
      fileSize: fileSize || 0,
      mimeType: mimeType || "application/octet-stream",
      description: description || "",
      uploadedByPortal: true,
      uploadedByName: token.contactName,
      uploadedAt: new Date().toISOString(),
    };

    const updatedAttachments = [...currentAttachments, newAttachment];

    await db.update(submittals).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(submittals.id, id));

    await logPortalActivity(token.id, "uploaded_submittal_file", "submittal", id, req.ip);

    notifyGcTeamOfPortalActivity(
      token.organizationId,
      token.projectId,
      token.contactName,
      "Subcontractor File Upload",
      `${token.contactName} uploaded a file "${fileName}" to Submittal #${submittal.submittalNumber || id}`
    );

    res.status(201).json(newAttachment);
  } catch (error) {
    console.error("Portal submittal upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portal/transmittals", requirePortalAuth, requirePortalPermission("view"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;

    const recipientRows = await db
      .select({
        recipient: transmittalRecipients,
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(transmittalRecipients)
      .innerJoin(documentTransmittals, eq(transmittalRecipients.transmittalId, documentTransmittals.id))
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(
        and(
          eq(transmittalRecipients.subcontractorId, token.crmOrganisationId),
          eq(documentTransmittals.projectId, token.projectId)
        )
      )
      .orderBy(desc(documentTransmittals.createdAt));

    const mapped = recipientRows.map((r) => ({
      ...r.transmittal,
      project: r.project,
      recipientInfo: {
        acknowledged: r.recipient.acknowledged,
        acknowledgedAt: r.recipient.acknowledgedAt,
      },
    }));

    await logPortalActivity(token.id, "viewed_transmittals_list", "transmittal", null, req.ip);

    res.json(mapped);
  } catch (error) {
    console.error("Portal get transmittals error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portal/transmittals/:id", requirePortalAuth, requirePortalPermission("view"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { id } = req.params;

    const [result] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (result.transmittal.projectId !== token.projectId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [recipient] = await db
      .select()
      .from(transmittalRecipients)
      .where(
        and(
          eq(transmittalRecipients.transmittalId, id),
          eq(transmittalRecipients.subcontractorId, token.crmOrganisationId)
        )
      )
      .limit(1);

    if (!recipient) {
      return res.status(403).json({ error: "Access denied - not a recipient" });
    }

    await logPortalActivity(token.id, "viewed_transmittal_detail", "transmittal", id, req.ip);

    res.json({
      ...result.transmittal,
      project: result.project,
      recipientInfo: {
        acknowledged: recipient.acknowledged,
        acknowledgedAt: recipient.acknowledgedAt,
      },
    });
  } catch (error) {
    console.error("Portal get transmittal detail error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/transmittals/:id/acknowledge", requirePortalAuth, requirePortalPermission("acknowledge"), async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { id } = req.params;

    const [result] = await db
      .select()
      .from(documentTransmittals)
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (result.projectId !== token.projectId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [recipient] = await db
      .select()
      .from(transmittalRecipients)
      .where(
        and(
          eq(transmittalRecipients.transmittalId, id),
          eq(transmittalRecipients.subcontractorId, token.crmOrganisationId)
        )
      )
      .limit(1);

    if (!recipient) {
      return res.status(403).json({ error: "Access denied - not a recipient" });
    }

    const [updated] = await db
      .update(transmittalRecipients)
      .set({
        acknowledged: true,
        acknowledgedAt: new Date(),
      })
      .where(eq(transmittalRecipients.id, recipient.id))
      .returning();

    await logPortalActivity(token.id, "acknowledged_transmittal", "transmittal", id, req.ip);

    notifyGcTeamOfPortalActivity(
      token.organizationId,
      token.projectId,
      token.contactName,
      "Transmittal Acknowledged",
      `${token.contactName} acknowledged Transmittal #${result.transmittalNumber || id}`
    );

    res.json(updated);
  } catch (error) {
    console.error("Portal acknowledge transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Section 2: Portal Management Routes (GC team, JWT auth)
// ============================================================

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

// ============================================================
// Section 3: Bid-Phase Document Distribution Routes
// ============================================================

// POST /bid-docs/send - Send documents to prospective subcontractors during bidding
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

// GET /bid-docs/distributions - List all document distributions for the org
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

// PATCH /bid-docs/distributions/:id/status - Update distribution status (e.g., mark as responded)
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
