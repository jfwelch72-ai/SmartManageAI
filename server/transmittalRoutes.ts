import { logError } from "./utils/logger";
import { safeJsonParse } from "./responseHelper";
import { Router, Response, NextFunction } from "express";
import { db } from "./db";
import {
  insertDocumentTransmittalSchema,
  insertTransmittalRecipientSchema,
  documentTransmittals,
  transmittalRecipients,
  projects,
  users,
  crmOrganisations,
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { notifyDocumentEvent } from "./services/documentNotificationService";

const router = Router();

router.get("/transmittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const projectIdFilter = req.query.projectId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    const conditions: any[] = [];
    if (shouldFilter && orgId && !isSuperAdmin) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    if (projectIdFilter) {
      conditions.push(eq(documentTransmittals.projectId, projectIdFilter));
    }
    if (statusFilter) {
      conditions.push(eq(documentTransmittals.status, statusFilter));
    }

    const filtered = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(documentTransmittals.createdAt));

    const result = filtered.map(t => ({
      ...t.transmittal,
      project: t.project,
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/transmittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [result] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && result.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const recipients = await db
      .select()
      .from(transmittalRecipients)
      .where(eq(transmittalRecipients.transmittalId, id));

    res.json({
      ...result.transmittal,
      project: result.project,
      recipients,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/transmittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = user.organizationId;

    if (!organizationId && !isSuperAdmin) {
      return res.status(400).json({ error: "User must belong to an organization" });
    }

    const body = {
      ...req.body,
      sentById: user.id,
      sentByName: `${user.firstName} ${user.lastName}`,
      organizationId: organizationId || req.body.organizationId,
    };

    const createTransmittalSchema = insertDocumentTransmittalSchema.omit({ transmittalNumber: true });
    const validation = createTransmittalSchema.safeParse(body);
    if (!validation.success) {
      return res.status(400).json({ error: "Validation failed", details: validation.error.flatten() });
    }

    const data = validation.data;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, data.projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentTransmittals)
      .where(eq(documentTransmittals.projectId, data.projectId));

    const transmittalNumber = `TX-${String(countResult.count + 1).padStart(3, "0")}`;

    const [newTransmittal] = await db
      .insert(documentTransmittals)
      .values({
        ...data,
        transmittalNumber,
      })
      .returning();

    const recipientIds = req.body.recipientSubcontractorIds as string[] | undefined;
    if (recipientIds && recipientIds.length > 0) {
      const subs = await db
        .select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(inArray(crmOrganisations.id, recipientIds));

      const subMap = new Map(subs.map(s => [s.id, s.name]));

      const recipientValues = recipientIds.map(subId => ({
        transmittalId: newTransmittal.id,
        subcontractorId: subId,
        subcontractorName: subMap.get(subId) || null,
      }));

      await db.insert(transmittalRecipients).values(recipientValues);
    }

    res.status(201).json(newTransmittal);
  } catch (error) {
    next(error);
  }
});

router.patch("/transmittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.transmittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT transmittals can be updated" });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    const { subject, description, documentType, revisionNumber, attachmentsJson, notes } = req.body;

    if (subject !== undefined) updates.subject = subject;
    if (description !== undefined) updates.description = description;
    if (documentType !== undefined) updates.documentType = documentType;
    if (revisionNumber !== undefined) updates.revisionNumber = revisionNumber;
    if (attachmentsJson !== undefined) updates.attachmentsJson = attachmentsJson;
    if (notes !== undefined) updates.notes = notes;

    const [updated] = await db
      .update(documentTransmittals)
      .set(updates)
      .where(eq(documentTransmittals.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/transmittals/:id/send", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.transmittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT transmittals can be sent" });
    }

    const [updated] = await db
      .update(documentTransmittals)
      .set({
        status: "SENT",
        dateSent: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documentTransmittals.id, id))
      .returning();

    const recipients = await db
      .select()
      .from(transmittalRecipients)
      .where(eq(transmittalRecipients.transmittalId, id));

    const recipientUserIds = recipients
      .map(r => r.acknowledgedById)
      .filter((rid): rid is string => !!rid);

    if (recipientUserIds.length > 0) {
      notifyDocumentEvent("TRANSMITTAL", id, existing.transmittal.organizationId, existing.transmittal.projectId, req.user!.id, recipientUserIds, `Transmittal Sent: ${existing.transmittal.subject}`, existing.transmittal.transmittalNumber);
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/transmittals/:id/supersede", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const updates: Record<string, any> = {
      status: "SUPERSEDED",
      updatedAt: new Date(),
    };

    if (req.body.newTransmittalId) {
      updates.previousTransmittalId = req.body.newTransmittalId;
    }

    const [updated] = await db
      .update(documentTransmittals)
      .set(updates)
      .where(eq(documentTransmittals.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/transmittals/:id/acknowledge", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { subcontractorId } = req.body;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!subcontractorId) {
      return res.status(400).json({ error: "subcontractorId is required" });
    }

    const [existing] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [recipient] = await db
      .select()
      .from(transmittalRecipients)
      .where(
        and(
          eq(transmittalRecipients.transmittalId, id),
          eq(transmittalRecipients.subcontractorId, subcontractorId)
        )
      )
      .limit(1);

    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found for this transmittal" });
    }

    const [updated] = await db
      .update(transmittalRecipients)
      .set({
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedById: req.user!.id,
      })
      .where(eq(transmittalRecipients.id, recipient.id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get("/transmittals/:id/recipients", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const recipients = await db
      .select()
      .from(transmittalRecipients)
      .where(eq(transmittalRecipients.transmittalId, id));

    res.json(recipients);
  } catch (error) {
    next(error);
  }
});

router.post("/transmittals/:id/recipients", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { subcontractorIds } = req.body;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!subcontractorIds || !Array.isArray(subcontractorIds) || subcontractorIds.length === 0) {
      return res.status(400).json({ error: "subcontractorIds array is required" });
    }

    const [existing] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const subs = await db
      .select({ id: crmOrganisations.id, name: crmOrganisations.name })
      .from(crmOrganisations)
      .where(inArray(crmOrganisations.id, subcontractorIds));

    const subMap = new Map(subs.map(s => [s.id, s.name]));

    const recipientValues = subcontractorIds.map((subId: string) => ({
      transmittalId: id,
      subcontractorId: subId,
      subcontractorName: subMap.get(subId) || null,
    }));

    const newRecipients = await db
      .insert(transmittalRecipients)
      .values(recipientValues)
      .returning();

    res.status(201).json(newRecipients);
  } catch (error) {
    next(error);
  }
});

router.delete("/transmittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.transmittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT transmittals can be deleted" });
    }

    await db
      .delete(transmittalRecipients)
      .where(eq(transmittalRecipients.transmittalId, id));

    await db
      .delete(documentTransmittals)
      .where(eq(documentTransmittals.id, id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/transmittals/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [result] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && result.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const fileSchema = z.object({
      fileUrl: z.string(),
      fileName: z.string(),
      fileSize: z.number(),
      mimeType: z.string(),
      description: z.string().optional(),
    });

    const validationResult = fileSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid file metadata", details: validationResult.error.errors });
    }

    const { fileUrl, fileName, fileSize, mimeType, description } = validationResult.data;

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(fileUrl, {
      owner: req.user!.id,
      organizationId: req.user!.organizationId!,
      visibility: "private",
    });

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);

    const currentAttachments = result.transmittal.attachmentsJson
      ? safeJsonParse(result.transmittal.attachmentsJson, [])
      : [];

    const newAttachment = {
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      description: description || "",
      uploadedById: req.user!.id,
      uploadedByName: `${user.firstName} ${user.lastName}`,
      uploadedAt: new Date().toISOString(),
      objectKey,
    };

    const updatedAttachments = [...currentAttachments, newAttachment];

    await db.update(documentTransmittals).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(documentTransmittals.id, id));

    res.status(201).json(newAttachment);
  } catch (error) {
    next(error);
  }
});

router.get("/transmittals/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [result] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && result.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const attachments = result.transmittal.attachmentsJson
      ? safeJsonParse(result.transmittal.attachmentsJson, [])
      : [];

    res.json(attachments);
  } catch (error) {
    next(error);
  }
});

router.delete("/transmittals/:id/files/:fileId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [result] = await db
      .select({
        transmittal: documentTransmittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(documentTransmittals)
      .leftJoin(projects, eq(documentTransmittals.projectId, projects.id))
      .where(eq(documentTransmittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Transmittal not found" });
    }

    if (shouldFilter && orgId && !isSuperAdmin && result.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const currentAttachments = result.transmittal.attachmentsJson
      ? safeJsonParse(result.transmittal.attachmentsJson, [])
      : [];

    const fileIndex = currentAttachments.findIndex((f: any) => f.id === req.params.fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ error: "File not found" });
    }

    const file = currentAttachments[fileIndex];
    const userRole = req.user!.role;
    if (file.uploadedById !== req.user!.id && !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(userRole)) {
      return res.status(403).json({ error: "You don't have permission to delete this file" });
    }

    const updatedAttachments = currentAttachments.filter((_: any, i: number) => i !== fileIndex);

    await db.update(documentTransmittals).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(documentTransmittals.id, id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
