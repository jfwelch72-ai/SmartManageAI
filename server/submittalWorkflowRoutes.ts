import { Router, Response } from "express";
import { db } from "./db";
import {
  submittals,
  submittalActivity,
  submittalReviews,
  projects,
} from "@shared/schema";
import { eq, asc, and } from "drizzle-orm";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { notifyDocumentEvent } from "./services/documentNotificationService";
import { notifyApprovers, notifySubmitter, notifyUsers } from "./services/approvalNotificationService";
import { z } from "zod";

const router = Router();

// ==================== Chain Advancement Service ====================

async function advanceChain(submittalId: string, actorUserId: string): Promise<void> {
  const [submittal] = await db
    .select()
    .from(submittals)
    .where(eq(submittals.id, submittalId))
    .limit(1);
  if (!submittal) return;

  const chain = await db
    .select()
    .from(submittalReviews)
    .where(eq(submittalReviews.submittalId, submittalId))
    .orderBy(asc(submittalReviews.sequenceOrder));

  if (chain.length === 0) return;

  const stampedRows = chain.filter(r =>
    r.status === "APPROVED" || r.status === "APPROVED_AS_NOTED" ||
    r.status === "REJECTED" || r.status === "REVISE_AND_RESUBMIT"
  );

  const lastStamped = stampedRows.reduce<typeof chain[0] | null>((latest, r) => {
    if (!latest) return r;
    return (r.dateReviewed && latest.dateReviewed && r.dateReviewed > latest.dateReviewed) ? r : latest;
  }, null);

  if (!lastStamped) return;

  const stoppingAction = lastStamped.status === "REJECTED" || lastStamped.status === "REVISE_AND_RESUBMIT";

  if (stoppingAction) {
    const stopStatus = lastStamped.status as "REJECTED" | "REVISE_AND_RESUBMIT";
    await db
      .update(submittals)
      .set({
        status: stopStatus,
        dateReviewed: lastStamped.dateReviewed,
        stampAction: lastStamped.stampAction,
        reviewComments: lastStamped.comments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, submittalId));

    await db.insert(submittalActivity).values({
      submittalId,
      userId: actorUserId,
      userName: lastStamped.reviewerName,
      action: `Review chain stopped: ${lastStamped.reviewerName} (${lastStamped.reviewerRole}) — ${lastStamped.status}`,
      comment: lastStamped.comments || null,
    });

    if (submittal.submittedById) {
      await notifySubmitter(submittal.submittedById, {
        type: "SUBMITTAL_REJECTED",
        title: `Submittal ${lastStamped.status === "REJECTED" ? "Rejected" : "Requires Revision"}`,
        message: `Submittal ${submittal.submittalNumber} "${submittal.subject}" was ${lastStamped.status === "REJECTED" ? "rejected" : "marked for revision"} by ${lastStamped.reviewerName}`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      });
    }
    return;
  }

  const allStamped = chain.every(r =>
    r.status === "APPROVED" || r.status === "APPROVED_AS_NOTED" ||
    r.status === "REJECTED" || r.status === "REVISE_AND_RESUBMIT"
  );

  if (allStamped) {
    const hasApprovedAsNoted = chain.some(r => r.status === "APPROVED_AS_NOTED");
    const finalStatus = hasApprovedAsNoted ? "APPROVED_AS_NOTED" : "APPROVED";

    await db
      .update(submittals)
      .set({
        status: finalStatus,
        dateReviewed: new Date(),
        stampAction: finalStatus,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, submittalId));

    await db.insert(submittalActivity).values({
      submittalId,
      userId: actorUserId,
      userName: "System",
      action: `All reviews complete — submittal ${finalStatus === "APPROVED_AS_NOTED" ? "approved as noted" : "approved"}`,
    });

    if (submittal.submittedById) {
      await notifySubmitter(submittal.submittedById, {
        type: "SUBMITTAL_APPROVED",
        title: `Submittal ${finalStatus === "APPROVED_AS_NOTED" ? "Approved As Noted" : "Approved"}`,
        message: `Submittal ${submittal.submittalNumber} "${submittal.subject}" has been fully approved`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      });
    }
    return;
  }

  const nextPending = chain.find(r => r.status === "PENDING");
  if (nextPending) {
    await db
      .update(submittalReviews)
      .set({
        status: "IN_REVIEW",
        dateAssigned: new Date(),
      })
      .where(eq(submittalReviews.id, nextPending.id));

    await db.insert(submittalActivity).values({
      submittalId,
      userId: actorUserId,
      userName: "System",
      action: `Review advanced to ${nextPending.reviewerName} (${nextPending.reviewerRole})`,
    });

    if (nextPending.reviewerId) {
      await notifyUsers([nextPending.reviewerId], {
        type: "GENERAL",
        title: "Your Review Is Required",
        message: `Submittal ${submittal.submittalNumber} "${submittal.subject}" is awaiting your review`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      });
    }

    if (submittal.submittedById) {
      await notifySubmitter(submittal.submittedById, {
        type: "GENERAL",
        title: "Review Chain Advanced",
        message: `${lastStamped.reviewerName} reviewed — now awaiting ${nextPending.reviewerName} (${nextPending.reviewerRole})`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      });
    }
  }
}

// ==================== Submit ====================

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

    await notifyApprovers(
      existing.submittal.organizationId,
      user.id,
      {
        type: "SUBMITTAL_SUBMITTED",
        title: "Submittal Submitted",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been submitted for review`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      }
    );

    res.json(updated);
  } catch (error) {
    console.error("Submit submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Review (legacy — start review without chain) ====================

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

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the review chain start route instead." });
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

// ==================== Review Chain — Start ====================

router.post("/submittals/:id/reviews/:reviewId/start", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id, reviewId } = req.params;
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

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    if (existing.submittal.status !== "SUBMITTED") {
      return res.status(400).json({ error: "Only SUBMITTED submittals can start a review chain" });
    }

    const chain = await db
      .select()
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .orderBy(asc(submittalReviews.sequenceOrder));

    if (chain.length === 0) {
      return res.status(400).json({ error: "No review chain configured" });
    }

    const targetReview = chain.find(r => r.id === reviewId);
    if (!targetReview) return res.status(404).json({ error: "Review not found" });

    const lowestPending = chain.find(r => r.status === "PENDING");
    if (!lowestPending || lowestPending.id !== reviewId) {
      return res.status(400).json({ error: "Can only start the lowest-sequence PENDING review" });
    }

    const [updatedReview] = await db
      .update(submittalReviews)
      .set({ status: "IN_REVIEW", dateAssigned: new Date() })
      .where(eq(submittalReviews.id, reviewId))
      .returning();

    await db
      .update(submittals)
      .set({ status: "UNDER_REVIEW", updatedAt: new Date() })
      .where(eq(submittals.id, id));

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Review started — ${targetReview.reviewerName} (${targetReview.reviewerRole})`,
    });

    if (targetReview.reviewerId) {
      await notifyUsers([targetReview.reviewerId], {
        type: "GENERAL",
        title: "Your Review Is Required",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" is awaiting your review`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      });
    }

    res.json(updatedReview);
  } catch (error) {
    console.error("Start review error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Review Chain — Stamp ====================

const stampBodySchema = z.object({
  action: z.enum(["APPROVED", "APPROVED_AS_NOTED", "REJECTED", "REVISE_AND_RESUBMIT"]),
  comments: z.string().optional(),
});

router.post("/submittals/:id/reviews/:reviewId/stamp", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id, reviewId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = stampBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { action, comments } = parsed.data;

    if ((action === "APPROVED_AS_NOTED" || action === "REJECTED" || action === "REVISE_AND_RESUBMIT") && !comments?.trim()) {
      return res.status(400).json({ error: "Comments are required for this stamp action" });
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

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Submittal must be UNDER_REVIEW to stamp a review" });
    }

    const [review] = await db
      .select()
      .from(submittalReviews)
      .where(and(eq(submittalReviews.id, reviewId), eq(submittalReviews.submittalId, id)))
      .limit(1);

    if (!review) return res.status(404).json({ error: "Review not found" });

    if (review.status !== "IN_REVIEW") {
      return res.status(400).json({ error: "Only IN_REVIEW rows can be stamped" });
    }

    const user = req.user!;
    const isAdminOrManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role);
    const isAssignedReviewer = !!review.reviewerId && review.reviewerId === user.id;

    if (!isAssignedReviewer && !isAdminOrManager) {
      return res.status(403).json({ error: "Only the assigned reviewer or an admin/manager can stamp this review" });
    }

    const [updatedReview] = await db
      .update(submittalReviews)
      .set({
        status: action,
        stampAction: action,
        comments: comments || null,
        dateReviewed: new Date(),
      })
      .where(eq(submittalReviews.id, reviewId))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `${review.reviewerName} (${review.reviewerRole}) stamped: ${action}`,
      comment: comments || null,
    });

    await advanceChain(id, user.id);

    res.json(updatedReview);
  } catch (error) {
    console.error("Stamp review error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Approve (legacy) ====================

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

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
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

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_APPROVED",
        title: "Submittal Approved",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been approved`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Approve submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Approve As Noted (legacy) ====================

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

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
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

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_APPROVED",
        title: "Submittal Approved As Noted",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been approved as noted`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Approve as noted submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Reject (legacy) ====================

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

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
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

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_REJECTED",
        title: "Submittal Rejected",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been rejected`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Reject submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Revise (legacy) ====================

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

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
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

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_REVISION_REQUESTED",
        title: "Submittal Revision Requested",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" requires revision`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Revise submittal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Resubmit ====================

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
