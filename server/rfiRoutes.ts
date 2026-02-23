import { Router, Response } from "express";
import { db } from "./db";
import {
  insertRfiSchema,
  insertRfiActivitySchema,
  rfis,
  rfiActivity,
  projects,
  users,
  crmOrganisations,
  subcontractorContracts,
  changeOrders,
  tmTickets,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

async function getRfiWithOrgCheck(rfiId: string, req: AuthRequest) {
  const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);

  if (mustDenyAccess) {
    return { rfi: null, project: null, denied: true };
  }

  const [result] = await db
    .select({
      rfi: rfis,
      project: {
        id: projects.id,
        name: projects.name,
        code: projects.code,
        gcOrganizationId: projects.gcOrganizationId,
      },
    })
    .from(rfis)
    .leftJoin(projects, eq(rfis.projectId, projects.id))
    .where(eq(rfis.id, rfiId))
    .limit(1);

  if (!result?.rfi) {
    return { rfi: null, project: null, denied: false };
  }

  if (shouldFilter && orgId && result.project?.gcOrganizationId !== orgId) {
    return { rfi: null, project: null, denied: true };
  }

  return { rfi: result.rfi, project: result.project, denied: false };
}

async function createActivityEntry(rfiId: string, userId: string, userName: string, action: string, comment?: string | null, attachmentsJson?: string | null) {
  await db.insert(rfiActivity).values({
    rfiId,
    userId,
    userName,
    action,
    comment: comment || null,
    attachmentsJson: attachmentsJson || null,
  });
}

router.get("/rfi", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { projectId, status } = req.query;

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(rfis.projectId, projectId));
    }
    if (status && typeof status === "string") {
      conditions.push(eq(rfis.status, status as any));
    }

    const results = await db
      .select({
        rfi: rfis,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
        submittedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(rfis)
      .leftJoin(projects, eq(rfis.projectId, projects.id))
      .leftJoin(users, eq(rfis.submittedById, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(rfis.createdAt));

    const mapped = results.map((r) => ({
      ...r.rfi,
      project: r.project,
      submittedBy: r.submittedBy,
    }));

    res.json(mapped);
  } catch (error) {
    console.error("Get RFIs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/rfi/stats", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    const { projectId } = req.query;
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(rfis.projectId, projectId));
    }

    const allRfis = await db
      .select({ status: rfis.status })
      .from(rfis)
      .leftJoin(projects, eq(rfis.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = allRfis.length;
    const open = allRfis.filter((r) => ["DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(r.status)).length;
    const answered = allRfis.filter((r) => r.status === "ANSWERED").length;
    const closed = allRfis.filter((r) => r.status === "CLOSED").length;

    res.json({ total, open, answered, closed });
  } catch (error) {
    console.error("Get RFI stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/rfi/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, project, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const activity = await db
      .select()
      .from(rfiActivity)
      .where(eq(rfiActivity.rfiId, rfi.id))
      .orderBy(desc(rfiActivity.createdAt));

    let subcontractor = null;
    if (rfi.subcontractorId) {
      const [sub] = await db
        .select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, rfi.subcontractorId))
        .limit(1);
      subcontractor = sub || null;
    }

    let linkedChangeOrder = null;
    if (rfi.linkedChangeOrderId) {
      const [co] = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.id, rfi.linkedChangeOrderId))
        .limit(1);
      linkedChangeOrder = co || null;
    }

    let linkedTmTicket = null;
    if (rfi.linkedTmTicketId) {
      const [tm] = await db
        .select()
        .from(tmTickets)
        .where(eq(tmTickets.id, rfi.linkedTmTicketId))
        .limit(1);
      linkedTmTicket = tm || null;
    }

    res.json({
      ...rfi,
      project,
      subcontractor,
      linkedChangeOrder,
      linkedTmTicket,
      activity,
    });
  } catch (error) {
    console.error("Get RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = user.organizationId;
    if (!organizationId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "No organization assigned" });
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rfis)
      .where(eq(rfis.projectId, req.body.projectId));

    const rfiNumber = `RFI-${String(countResult.count + 1).padStart(3, "0")}`;

    const rfiData = {
      ...req.body,
      organizationId: organizationId || req.body.organizationId,
      rfiNumber,
      submittedById: user.id,
      submittedByName: `${user.firstName} ${user.lastName}`,
      status: req.body.status || "DRAFT",
    };

    if (rfiData.dateRequired && typeof rfiData.dateRequired === 'string') {
      rfiData.dateRequired = new Date(rfiData.dateRequired);
    }

    const validated = insertRfiSchema.parse(rfiData);

    const [newRfi] = await db.insert(rfis).values(validated).returning();

    await createActivityEntry(
      newRfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "RFI Created"
    );

    res.status(201).json(newRfi);
  } catch (error) {
    console.error("Create RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/rfi/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const allowedFields = [
      "subject", "question", "priority", "assignedToId", "dateRequired",
      "drawingReference", "specReference", "impactDescription", "costImpact", "scheduleImpact",
    ];

    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === "dateRequired" && req.body[field]) {
          updates[field] = new Date(req.body[field]);
        } else {
          updates[field] = req.body[field];
        }
      }
    }

    const [updated] = await db
      .update(rfis)
      .set(updates)
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(
      rfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "RFI Updated"
    );

    res.json(updated);
  } catch (error) {
    console.error("Update RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/submit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "DRAFT") {
      return res.status(400).json({ error: `Cannot submit from ${rfi.status} status` });
    }

    const [updated] = await db
      .update(rfis)
      .set({ status: "SUBMITTED", dateSubmitted: new Date(), updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Submitted");

    res.json(updated);
  } catch (error) {
    console.error("Submit RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/review", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "SUBMITTED") {
      return res.status(400).json({ error: `Cannot move to review from ${rfi.status} status` });
    }

    const [updated] = await db
      .update(rfis)
      .set({ status: "UNDER_REVIEW", updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Under Review");

    res.json(updated);
  } catch (error) {
    console.error("Review RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/answer", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "UNDER_REVIEW" && rfi.status !== "SUBMITTED") {
      return res.status(400).json({ error: `Cannot answer from ${rfi.status} status` });
    }

    const { answer, answerAttachmentsJson } = req.body;
    if (!answer || typeof answer !== "string" || answer.trim().length === 0) {
      return res.status(400).json({ error: "Answer is required" });
    }

    const user = req.user!;
    const [updated] = await db
      .update(rfis)
      .set({
        status: "ANSWERED",
        answer,
        answerAttachmentsJson: answerAttachmentsJson || null,
        dateAnswered: new Date(),
        answeredById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(rfis.id, req.params.id))
      .returning();

    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Answered", answer);

    res.json(updated);
  } catch (error) {
    console.error("Answer RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/close", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const user = req.user!;
    const [updated] = await db
      .update(rfis)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        closedById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(rfis.id, req.params.id))
      .returning();

    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Closed");

    res.json(updated);
  } catch (error) {
    console.error("Close RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/reopen", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "CLOSED" && rfi.status !== "ANSWERED") {
      return res.status(400).json({ error: `Cannot reopen from ${rfi.status} status` });
    }

    const [updated] = await db
      .update(rfis)
      .set({
        status: "UNDER_REVIEW",
        closedAt: null,
        closedById: null,
        updatedAt: new Date(),
      })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Reopened");

    res.json(updated);
  } catch (error) {
    console.error("Reopen RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/link-co", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const { changeOrderId } = req.body;
    if (!changeOrderId) {
      return res.status(400).json({ error: "changeOrderId is required" });
    }

    const [co] = await db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.id, changeOrderId))
      .limit(1);

    if (!co) {
      return res.status(404).json({ error: "Change order not found" });
    }

    const [updated] = await db
      .update(rfis)
      .set({ linkedChangeOrderId: changeOrderId, updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(
      rfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "Linked Change Order",
      `Linked to change order ${co.changeOrderNumber || changeOrderId}`
    );

    res.json(updated);
  } catch (error) {
    console.error("Link CO error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/link-tm", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const { tmTicketId } = req.body;
    if (!tmTicketId) {
      return res.status(400).json({ error: "tmTicketId is required" });
    }

    const [tm] = await db
      .select()
      .from(tmTickets)
      .where(eq(tmTickets.id, tmTicketId))
      .limit(1);

    if (!tm) {
      return res.status(404).json({ error: "T&M ticket not found" });
    }

    const [updated] = await db
      .update(rfis)
      .set({ linkedTmTicketId: tmTicketId, updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(
      rfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "Linked T&M Ticket",
      `Linked to T&M ticket ${tm.ticketNumber || tmTicketId}`
    );

    res.json(updated);
  } catch (error) {
    console.error("Link TM error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const { comment, attachmentsJson } = req.body;
    if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const user = req.user!;
    const [entry] = await db
      .insert(rfiActivity)
      .values({
        rfiId: rfi.id,
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        action: "Comment",
        comment,
        attachmentsJson: attachmentsJson || null,
      })
      .returning();

    res.status(201).json(entry);
  } catch (error) {
    console.error("Add RFI activity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/rfi/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const activity = await db
      .select()
      .from(rfiActivity)
      .where(eq(rfiActivity.rfiId, rfi.id))
      .orderBy(desc(rfiActivity.createdAt));

    res.json(activity);
  } catch (error) {
    console.error("Get RFI activity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/rfi/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT RFIs can be deleted" });
    }

    await db.delete(rfiActivity).where(eq(rfiActivity.rfiId, rfi.id));
    await db.delete(rfis).where(eq(rfis.id, rfi.id));

    res.status(204).send();
  } catch (error) {
    console.error("Delete RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rfi/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

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

    const currentAttachments = rfi.attachmentsJson
      ? JSON.parse(rfi.attachmentsJson)
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

    await db.update(rfis).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(rfis.id, req.params.id));

    res.status(201).json(newAttachment);
  } catch (error) {
    console.error("Upload RFI file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/rfi/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const attachments = rfi.attachmentsJson
      ? JSON.parse(rfi.attachmentsJson)
      : [];

    res.json(attachments);
  } catch (error) {
    console.error("Get RFI files error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/rfi/:id/files/:fileId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const currentAttachments = rfi.attachmentsJson
      ? JSON.parse(rfi.attachmentsJson)
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

    await db.update(rfis).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(rfis.id, req.params.id));

    res.status(204).send();
  } catch (error) {
    console.error("Delete RFI file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
