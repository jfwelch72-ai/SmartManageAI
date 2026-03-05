import { Router, Response } from "express";
import { db } from "./db";
import {
  submittals,
  submittalActivity,
  projects,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { notifyDocumentEvent } from "./services/documentNotificationService";

const router = Router();

router.post("/submittals/:id/submit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
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

    const submitRecipients: string[] = [];
    if (existing.submittal.reviewerId) submitRecipients.push(existing.submittal.reviewerId);
    if (submitRecipients.length > 0) {
      notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, submitRecipients, `Submittal Submitted: ${existing.submittal.subject}`, existing.submittal.submittalNumber);
    }

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

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Approved: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

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

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Approved As Noted: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

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

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Rejected: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

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

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Requires Revision: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

    res.json(updated);
  } catch (error) {
    console.error("Revise submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submittals/:id/resubmit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
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

export default router;
