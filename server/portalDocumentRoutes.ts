import { Router, Response } from "express";
import { db } from "./db";
import {
  rfis, submittals, documentTransmittals, transmittalRecipients,
  rfiActivity, submittalActivity,
  projects, crmOrganisations,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requirePortalAuth, requirePortalPermission, type PortalRequest } from "./portalAuth";
import { logPortalActivity, notifyGcTeamOfPortalActivity } from "./portalActivityRoutes";

const router = Router();

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

export default router;
