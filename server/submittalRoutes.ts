import { Router, Response } from "express";
import { db } from "./db";
import {
  insertSubmittalSchema,
  insertSubmittalItemSchema,
  insertSubmittalReviewSchema,
  submittals,
  submittalActivity,
  submittalItems,
  submittalReviews,
  submittalAttachments,
  projects,
  users,
  crmOrganisations,
  rfis,
} from "@shared/schema";
import { eq, and, desc, sql, asc, max } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

router.get("/submittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { projectId, status, phase, submittalType, category } = req.query;

    const allSubmittals = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .orderBy(desc(submittals.createdAt));

    let filtered = allSubmittals;

    if (shouldFilter && orgId) {
      filtered = filtered.filter(s => s.project?.gcOrganizationId === orgId);
    }

    if (projectId) {
      filtered = filtered.filter(s => s.submittal.projectId === projectId);
    }
    if (status) {
      filtered = filtered.filter(s => s.submittal.status === status);
    }
    if (phase) {
      filtered = filtered.filter(s => s.submittal.phase === phase);
    }
    if (submittalType) {
      filtered = filtered.filter(s => s.submittal.submittalType === submittalType);
    }
    if (category) {
      filtered = filtered.filter(s => s.submittal.submittalCategory === category);
    }

    const result = filtered.map(s => ({
      ...s.submittal,
      project: s.project,
    }));

    res.json(result);
  } catch (error) {
    console.error("Get submittals error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/submittals/stats", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    const { projectId } = req.query;
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(submittals.projectId, projectId));
    }

    const allSubmittals = await db
      .select({
        status: submittals.status,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const filtered = allSubmittals;

    const stats = {
      total: filtered.length,
      submitted: filtered.filter(s => s.status === "SUBMITTED").length,
      under_review: filtered.filter(s => s.status === "UNDER_REVIEW").length,
      approved: filtered.filter(s => s.status === "APPROVED" || s.status === "APPROVED_AS_NOTED").length,
      rejected: filtered.filter(s => s.status === "REJECTED").length,
      revise: filtered.filter(s => s.status === "REVISE_AND_RESUBMIT").length,
      pendingReview: filtered.filter(s => s.status === "SUBMITTED" || s.status === "UNDER_REVIEW").length,
      needsAction: filtered.filter(s => s.status === "REJECTED" || s.status === "REVISE_AND_RESUBMIT").length,
    };

    res.json(stats);
  } catch (error) {
    console.error("Get submittal stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/submittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [result] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && result.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    let subcontractor = null;
    if (result.submittal.subcontractorId) {
      const [sub] = await db
        .select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, result.submittal.subcontractorId))
        .limit(1);
      subcontractor = sub || null;
    }

    let reviewer = null;
    if (result.submittal.reviewerId) {
      const [rev] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, result.submittal.reviewerId))
        .limit(1);
      reviewer = rev || null;
    }

    let linkedRfi = null;
    if (result.submittal.linkedRfiId) {
      const [rfi] = await db
        .select()
        .from(rfis)
        .where(eq(rfis.id, result.submittal.linkedRfiId))
        .limit(1);
      linkedRfi = rfi || null;
    }

    const activityLog = await db
      .select()
      .from(submittalActivity)
      .where(eq(submittalActivity.submittalId, id))
      .orderBy(desc(submittalActivity.createdAt));

    res.json({
      ...result.submittal,
      project: result.project,
      subcontractor,
      reviewer,
      linkedRfi,
      activity: activityLog,
    });
  } catch (error) {
    console.error("Get submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = user.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "User must belong to an organization" });
    }

    const body = {
      ...req.body,
      organizationId,
      submittedById: user.id,
      submittedByName: `${user.firstName} ${user.lastName}`,
    };

    if (body.dateRequired && typeof body.dateRequired === 'string') {
      body.dateRequired = new Date(body.dateRequired);
    }

    const createSubmittalSchema = insertSubmittalSchema.omit({ submittalNumber: true });
    const validationResult = createSubmittalSchema.safeParse(body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }

    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, body.projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(submittals)
      .where(eq(submittals.projectId, body.projectId));

    const submittalNumber = `SUB-${String(countResult.count + 1).padStart(3, "0")}`;

    const [newSubmittal] = await db
      .insert(submittals)
      .values({
        ...validationResult.data,
        submittalNumber,
        status: "DRAFT",
      })
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: newSubmittal.id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Created",
    });

    res.status(201).json(newSubmittal);
  } catch (error) {
    console.error("Create submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/submittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT submittals can be updated" });
    }

    const allowedFields = ["subject", "description", "specSection", "category", "submittalCategory", "phase", "dateRequired", "attachmentsJson"];
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
      .update(submittals)
      .set(updates)
      .where(eq(submittals.id, id))
      .returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Updated",
    });

    res.json(updated);
  } catch (error) {
    console.error("Update submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/link-rfi", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { rfiId } = req.body;
    if (!rfiId) {
      return res.status(400).json({ error: "rfiId is required" });
    }

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [rfi] = await db
      .select()
      .from(rfis)
      .where(eq(rfis.id, rfiId))
      .limit(1);

    if (!rfi) {
      return res.status(404).json({ error: "RFI not found" });
    }

    const [updated] = await db
      .update(submittals)
      .set({
        linkedRfiId: rfiId,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Linked to RFI ${rfi.rfiNumber}`,
    });

    res.json(updated);
  } catch (error) {
    console.error("Link RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const user = req.user!;
    const { comment, attachmentsJson } = req.body;

    if (!comment) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const [entry] = await db
      .insert(submittalActivity)
      .values({
        submittalId: id,
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        action: "Comment",
        comment,
        attachmentsJson: attachmentsJson || null,
      })
      .returning();

    res.status(201).json(entry);
  } catch (error) {
    console.error("Add submittal activity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/submittals/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const activityLog = await db
      .select()
      .from(submittalActivity)
      .where(eq(submittalActivity.submittalId, id))
      .orderBy(desc(submittalActivity.createdAt));

    res.json(activityLog);
  } catch (error) {
    console.error("Get submittal activity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/submittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT submittals can be deleted" });
    }

    await db
      .delete(submittalActivity)
      .where(eq(submittalActivity.submittalId, id));

    await db
      .delete(submittals)
      .where(eq(submittals.id, id));

    res.status(204).send();
  } catch (error) {
    console.error("Delete submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.project?.gcOrganizationId !== orgId) {
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

    const currentAttachments = existing.submittal.attachmentsJson
      ? JSON.parse(existing.submittal.attachmentsJson)
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

    await db.update(submittals).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(submittals.id, id));

    res.status(201).json(newAttachment);
  } catch (error) {
    console.error("Upload submittal file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/submittals/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const attachments = existing.submittal.attachmentsJson
      ? JSON.parse(existing.submittal.attachmentsJson)
      : [];

    res.json(attachments);
  } catch (error) {
    console.error("Get submittal files error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/submittals/:id/files/:fileId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const currentAttachments = existing.submittal.attachmentsJson
      ? JSON.parse(existing.submittal.attachmentsJson)
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

    await db.update(submittals).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(submittals.id, id));

    res.status(204).send();
  } catch (error) {
    console.error("Delete submittal file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Submittal Items ====================

router.get("/submittals/:id/items", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const items = await db
      .select()
      .from(submittalItems)
      .where(eq(submittalItems.submittalId, id))
      .orderBy(asc(submittalItems.itemNumber));

    res.json(items);
  } catch (error) {
    console.error("Get submittal items error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/items", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Can only add items to DRAFT submittals" });

    const user = req.user!;
    const organizationId = existing.submittal.organizationId;

    const [maxResult] = await db
      .select({ maxNum: max(submittalItems.itemNumber) })
      .from(submittalItems)
      .where(eq(submittalItems.submittalId, id));

    const itemNumber = (maxResult?.maxNum ?? 0) + 1;

    const body = { ...req.body, submittalId: id, organizationId, itemNumber };
    const validation = insertSubmittalItemSchema.safeParse(body);
    if (!validation.success) return res.status(400).json({ error: "Validation failed", details: validation.error.flatten() });

    const [newItem] = await db.insert(submittalItems).values(validation.data).returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Item ${itemNumber} added`,
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Create submittal item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/submittals/:id/items/:itemId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id, itemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Can only edit items on DRAFT submittals" });

    const [item] = await db.select().from(submittalItems).where(and(eq(submittalItems.id, itemId), eq(submittalItems.submittalId, id))).limit(1);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const patchSchema = z.object({
      description: z.string().optional(),
      specSection: z.string().nullable().optional(),
      submittalCategory: z.enum(["SHOP_DRAWING", "PRODUCT_DATA", "MATERIAL_APPROVAL", "ENGINEERING_APPROVAL", "SAMPLE", "OPERATION_AND_MAINTENANCE", "OTHER"]).nullable().optional(),
      quantity: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
      manufacturer: z.string().nullable().optional(),
      modelNumber: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      status: z.string().optional(),
    });

    const patchResult = patchSchema.safeParse(req.body);
    if (!patchResult.success) return res.status(400).json({ error: "Validation failed", details: patchResult.error.flatten() });

    const patchData = patchResult.data;
    const updates: Partial<typeof submittalItems.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (patchData.description !== undefined) updates.description = patchData.description;
    if (patchData.specSection !== undefined) updates.specSection = patchData.specSection;
    if (patchData.submittalCategory !== undefined) updates.submittalCategory = patchData.submittalCategory;
    if (patchData.quantity !== undefined) updates.quantity = patchData.quantity;
    if (patchData.unit !== undefined) updates.unit = patchData.unit;
    if (patchData.manufacturer !== undefined) updates.manufacturer = patchData.manufacturer;
    if (patchData.modelNumber !== undefined) updates.modelNumber = patchData.modelNumber;
    if (patchData.notes !== undefined) updates.notes = patchData.notes;
    if (patchData.status !== undefined) updates.status = patchData.status;

    const [updated] = await db.update(submittalItems).set(updates).where(eq(submittalItems.id, itemId)).returning();
    res.json(updated);
  } catch (error) {
    console.error("Update submittal item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/submittals/:id/items/:itemId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id, itemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Items can only be deleted from DRAFT submittals" });

    const [item] = await db.select().from(submittalItems).where(and(eq(submittalItems.id, itemId), eq(submittalItems.submittalId, id))).limit(1);
    if (!item) return res.status(404).json({ error: "Item not found" });

    await db.delete(submittalItems).where(eq(submittalItems.id, itemId));
    res.status(204).send();
  } catch (error) {
    console.error("Delete submittal item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Submittal Reviews ====================

router.get("/submittals/:id/reviews", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const reviews = await db
      .select()
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .orderBy(asc(submittalReviews.sequenceOrder));

    res.json(reviews);
  } catch (error) {
    console.error("Get submittal reviews error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/reviews", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const organizationId = existing.submittal.organizationId;
    const body = { ...req.body, submittalId: id, organizationId };
    const validation = insertSubmittalReviewSchema.safeParse(body);
    if (!validation.success) return res.status(400).json({ error: "Validation failed", details: validation.error.flatten() });

    const [newReview] = await db.insert(submittalReviews).values(validation.data).returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Reviewer added: ${newReview.reviewerName} (${newReview.reviewerRole})`,
    });

    res.status(201).json(newReview);
  } catch (error) {
    console.error("Create submittal review error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/submittals/:id/reviews/:reviewId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id, reviewId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Reviewers can only be removed from DRAFT submittals" });

    const [review] = await db.select().from(submittalReviews).where(and(eq(submittalReviews.id, reviewId), eq(submittalReviews.submittalId, id))).limit(1);
    if (!review) return res.status(404).json({ error: "Review not found" });

    await db.delete(submittalReviews).where(eq(submittalReviews.id, reviewId));
    res.status(204).send();
  } catch (error) {
    console.error("Delete submittal review error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Submittal Attachments ====================


router.get("/submittals/:id/attachments", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const attachments = await db
      .select()
      .from(submittalAttachments)
      .where(eq(submittalAttachments.submittalId, id))
      .orderBy(desc(submittalAttachments.createdAt));

    res.json(attachments);
  } catch (error) {
    console.error("Get submittal attachments error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/submittals/:id/attachments/:attachmentId/download", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id, attachmentId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const [attachment] = await db
      .select()
      .from(submittalAttachments)
      .where(and(eq(submittalAttachments.id, attachmentId), eq(submittalAttachments.submittalId, id)))
      .limit(1);

    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    if (!attachment.storageKey) return res.status(404).json({ error: "No file stored for this attachment" });

    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(attachment.storageKey);
      const [signedUrl] = await objectFile.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });
      res.json({ url: signedUrl });
    } catch {
      res.status(500).json({ error: "Failed to generate download URL" });
    }
  } catch (error) {
    console.error("Get submittal attachment download URL error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/attachments", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = existing.submittal.organizationId;

    const uploadSchema = z.object({
      fileName: z.string(),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      fileUrl: z.string(),
      submittalItemId: z.string().optional(),
      submittalReviewId: z.string().optional(),
      description: z.string().optional(),
    });

    const parseResult = uploadSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten() });

    const { fileName, fileSize, mimeType, fileUrl, submittalItemId, submittalReviewId, description } = parseResult.data;

    // Validate fileUrl scheme to prevent SSRF — enforce HTTPS only
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fileUrl);
    } catch {
      return res.status(400).json({ error: "Invalid fileUrl" });
    }
    if (parsedUrl.protocol !== "https:") {
      return res.status(400).json({ error: "fileUrl must use https" });
    }
    // Block private/internal/link-local/cloud-metadata hostnames to prevent SSRF
    const blockedHosts = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|0\.0\.0\.0|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i;
    if (blockedHosts.test(parsedUrl.hostname)) {
      return res.status(400).json({ error: "fileUrl must not point to an internal/private address" });
    }

    // Validate cross-tenant FK references
    if (submittalItemId) {
      const [itemRef] = await db
        .select({ id: submittalItems.id })
        .from(submittalItems)
        .where(and(eq(submittalItems.id, submittalItemId), eq(submittalItems.submittalId, id), eq(submittalItems.organizationId, organizationId)))
        .limit(1);
      if (!itemRef) return res.status(400).json({ error: "submittalItemId does not belong to this submittal" });
    }

    if (submittalReviewId) {
      const [reviewRef] = await db
        .select({ id: submittalReviews.id })
        .from(submittalReviews)
        .where(and(eq(submittalReviews.id, submittalReviewId), eq(submittalReviews.submittalId, id), eq(submittalReviews.organizationId, organizationId)))
        .limit(1);
      if (!reviewRef) return res.status(400).json({ error: "submittalReviewId does not belong to this submittal" });
    }

    // Generate a unique UUID-based object path to avoid collisions
    const objectUUID = randomUUID();
    const objectPath = `${organizationId}/submittals/${id}/${objectUUID}/${fileName}`;

    // Upload via GCS sidecar — fail fast if sidecar is unavailable or returns error
    let storageKey: string;
    try {
      const response = await fetch(`http://127.0.0.1:1106/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl, objectPath }),
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.error(`GCS sidecar upload failed (${response.status}): ${errBody}`);
        return res.status(502).json({ error: "File storage upload failed" });
      }
      const data = await response.json() as { storageKey?: string };
      storageKey = data.storageKey || objectPath;
    } catch (sidecarErr) {
      console.error("GCS sidecar unreachable:", sidecarErr);
      return res.status(502).json({ error: "File storage service unavailable" });
    }

    const [dbUser] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const uploadedByName = dbUser ? `${dbUser.firstName} ${dbUser.lastName}` : user.id;

    const [newAttachment] = await db.insert(submittalAttachments).values({
      submittalId: id,
      organizationId,
      submittalItemId: submittalItemId ?? null,
      submittalReviewId: submittalReviewId ?? null,
      fileName,
      fileSize: fileSize ?? null,
      mimeType: mimeType ?? null,
      storageKey,
      uploadedById: user.id,
      uploadedByName,
      description: description ?? null,
    }).returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: uploadedByName,
      action: `Attachment uploaded: ${fileName}`,
    });


    res.status(201).json(newAttachment);
  } catch (error) {
    console.error("Upload submittal attachment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/submittals/:id/attachments/:attachmentId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id, attachmentId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const [attachment] = await db
      .select()
      .from(submittalAttachments)
      .where(and(eq(submittalAttachments.id, attachmentId), eq(submittalAttachments.submittalId, id)))
      .limit(1);

    if (!attachment) return res.status(404).json({ error: "Attachment not found" });

    const user = req.user!;
    if (attachment.uploadedById !== user.id && !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "You don't have permission to delete this attachment" });
    }

    if (attachment.storageKey) {
      try {
        const delResponse = await fetch(`http://127.0.0.1:1106/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageKey: attachment.storageKey }),
        });
        if (!delResponse.ok) {
          const errBody = await delResponse.text().catch(() => "");
          console.error(`GCS sidecar delete failed (${delResponse.status}): ${errBody}`);
          return res.status(502).json({ error: "File storage deletion failed; attachment record not removed" });
        }
      } catch (sidecarErr) {
        console.error("GCS sidecar unreachable during delete:", sidecarErr);
        return res.status(502).json({ error: "File storage service unavailable; attachment record not removed" });
      }
    }

    await db.delete(submittalAttachments).where(eq(submittalAttachments.id, attachmentId));
    res.status(204).send();
  } catch (error) {
    console.error("Delete submittal attachment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
