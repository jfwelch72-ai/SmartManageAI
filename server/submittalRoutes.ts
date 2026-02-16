import { Router, Response } from "express";
import { db } from "./db";
import {
  insertSubmittalSchema,
  insertSubmittalActivitySchema,
  submittals,
  submittalActivity,
  projects,
  users,
  crmOrganisations,
  subcontractorContracts,
  rfis,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

router.get("/submittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { projectId, status, phase, submittalType } = req.query;

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

router.get("/submittals/stats", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

router.get("/submittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

router.post("/submittals", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

    const validationResult = insertSubmittalSchema.safeParse(body);
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

router.patch("/submittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

    const allowedFields = ["subject", "description", "specSection", "category", "phase", "dateRequired", "attachmentsJson"];
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

router.post("/submittals/:id/submit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
      return res.status(400).json({ error: "Only DRAFT submittals can be submitted" });
    }

    const [updated] = await db
      .update(submittals)
      .set({
        status: "SUBMITTED",
        dateSubmitted: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Submitted",
    });

    res.json(updated);
  } catch (error) {
    console.error("Submit submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/review", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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

    if (existing.submittal.status !== "SUBMITTED") {
      return res.status(400).json({ error: "Only SUBMITTED submittals can be reviewed" });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "UNDER_REVIEW",
        reviewerId: user.id,
        reviewerName: `${user.firstName} ${user.lastName}`,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Under Review",
    });

    res.json(updated);
  } catch (error) {
    console.error("Review submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/approve", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Only UNDER_REVIEW submittals can be approved" });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "APPROVED",
        dateReviewed: new Date(),
        stampAction: "APPROVED",
        reviewComments: req.body.reviewComments || null,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Approved",
      comment: req.body.reviewComments || null,
    });

    res.json(updated);
  } catch (error) {
    console.error("Approve submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/approve-as-noted", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!req.body.reviewComments) {
      return res.status(400).json({ error: "Review comments are required" });
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

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Only UNDER_REVIEW submittals can be approved as noted" });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "APPROVED_AS_NOTED",
        dateReviewed: new Date(),
        stampAction: "APPROVED_AS_NOTED",
        reviewComments: req.body.reviewComments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Approved As Noted",
      comment: req.body.reviewComments,
    });

    res.json(updated);
  } catch (error) {
    console.error("Approve as noted submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/reject", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!req.body.reviewComments) {
      return res.status(400).json({ error: "Review comments are required" });
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

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Only UNDER_REVIEW submittals can be rejected" });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "REJECTED",
        dateReviewed: new Date(),
        stampAction: "REJECTED",
        reviewComments: req.body.reviewComments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Rejected",
      comment: req.body.reviewComments,
    });

    res.json(updated);
  } catch (error) {
    console.error("Reject submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/revise", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!req.body.reviewComments) {
      return res.status(400).json({ error: "Review comments are required" });
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

    if (existing.submittal.status !== "UNDER_REVIEW" && existing.submittal.status !== "REJECTED") {
      return res.status(400).json({ error: "Only UNDER_REVIEW or REJECTED submittals can be marked for revision" });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "REVISE_AND_RESUBMIT",
        dateReviewed: new Date(),
        stampAction: "REVISE_AND_RESUBMIT",
        reviewComments: req.body.reviewComments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Revise and Resubmit",
      comment: req.body.reviewComments,
    });

    res.json(updated);
  } catch (error) {
    console.error("Revise submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/resubmit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

    if (existing.submittal.status !== "REJECTED" && existing.submittal.status !== "REVISE_AND_RESUBMIT") {
      return res.status(400).json({ error: "Only REJECTED or REVISE_AND_RESUBMIT submittals can be resubmitted" });
    }

    const user = req.user!;
    const current = existing.submittal;
    const newRevisionNumber = current.revisionNumber + 1;
    const newSubmittalNumber = `${current.submittalNumber}-R${newRevisionNumber}`;

    const [newSubmittal] = await db
      .insert(submittals)
      .values({
        organizationId: current.organizationId,
        projectId: current.projectId,
        contractId: current.contractId,
        submittalNumber: newSubmittalNumber,
        subject: current.subject,
        description: current.description,
        submittalType: current.submittalType,
        phase: current.phase,
        status: "DRAFT",
        specSection: current.specSection,
        category: current.category,
        subcontractorId: current.subcontractorId,
        submittedById: user.id,
        submittedByName: `${user.firstName} ${user.lastName}`,
        dateRequired: current.dateRequired,
        revisionNumber: newRevisionNumber,
        previousSubmittalId: current.id,
      })
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Resubmitted as revision ${newRevisionNumber}`,
    });

    await db.insert(submittalActivity).values({
      submittalId: newSubmittal.id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Created as revision ${newRevisionNumber} of ${current.submittalNumber}`,
    });

    res.status(201).json(newSubmittal);
  } catch (error) {
    console.error("Resubmit submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/link-rfi", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

router.post("/submittals/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

router.get("/submittals/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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

export default router;
