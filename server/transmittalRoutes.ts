import { Router, Response } from "express";
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
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

router.get("/transmittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const projectIdFilter = req.query.projectId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    const allTransmittals = await db
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
      .orderBy(desc(documentTransmittals.createdAt));

    let filtered = allTransmittals;

    if (shouldFilter && orgId && !isSuperAdmin) {
      filtered = filtered.filter(t => t.project?.gcOrganizationId === orgId);
    }

    if (projectIdFilter) {
      filtered = filtered.filter(t => t.transmittal.projectId === projectIdFilter);
    }

    if (statusFilter) {
      filtered = filtered.filter(t => t.transmittal.status === statusFilter);
    }

    const result = filtered.map(t => ({
      ...t.transmittal,
      project: t.project,
    }));

    res.json(result);
  } catch (error) {
    console.error("Get transmittals error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/transmittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Get transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transmittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

    const validation = insertDocumentTransmittalSchema.safeParse(body);
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
    console.error("Create transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/transmittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Update transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transmittals/:id/send", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

    res.json(updated);
  } catch (error) {
    console.error("Send transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transmittals/:id/supersede", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Supersede transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transmittals/:id/acknowledge", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Acknowledge transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/transmittals/:id/recipients", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Get transmittal recipients error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transmittals/:id/recipients", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Add transmittal recipients error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/transmittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
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
    console.error("Delete transmittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
