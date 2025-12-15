import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { 
  delayClaims, dailyReportLocks, photoCustodyRecords,
  projectDelays, projects, changeOrders, users,
  insertDelayClaimSchema, insertDailyReportLockSchema, insertPhotoCustodyRecordSchema,
  type DelayClaim, type DailyReportLock, type PhotoCustodyRecord
} from "@shared/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";
import crypto from "crypto";

const router = Router();

const CLAIM_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CLOSED: "Closed"
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  TIME_EXTENSION: "Time Extension",
  COST_IMPACT: "Cost Impact",
  BOTH: "Time Extension + Cost Impact"
};

const VALID_CLAIM_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["DRAFT", "UNDER_REVIEW"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["CLOSED"],
  REJECTED: ["DRAFT", "CLOSED"],
  CLOSED: []
};

function isValidClaimTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_CLAIM_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

async function generateClaimNumber(projectCode: string): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(delayClaims)
    .innerJoin(projects, eq(delayClaims.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  
  const claimCount = Number(result?.count || 0) + 1;
  return `CLM-${projectCode}-${String(claimCount).padStart(3, "0")}`;
}

// ============================================================================
// DELAY CLAIMS ROUTES
// ============================================================================

// GET /api/delay-claims - List all delay claims for organization
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const projectId = req.query.projectId as string | undefined;
    const status = req.query.status as string | undefined;
    
    let query = db
      .select({
        claim: delayClaims,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(delayClaims)
      .innerJoin(projects, eq(delayClaims.projectId, projects.id))
      .where(eq(delayClaims.organizationId, orgId!))
      .orderBy(desc(delayClaims.createdAt));
    
    const claims = await query;
    
    let filtered = claims;
    if (projectId) {
      filtered = filtered.filter(c => c.claim.projectId === projectId);
    }
    if (status) {
      filtered = filtered.filter(c => c.claim.status === status);
    }
    
    res.json(filtered.map(({ claim, project }) => ({
      ...claim,
      project,
      statusLabel: CLAIM_STATUS_LABELS[claim.status] || claim.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType,
    })));
  } catch (error) {
    console.error("Error fetching delay claims:", error);
    res.status(500).json({ error: "Failed to fetch delay claims" });
  }
});

// GET /api/delay-claims/:id - Get single delay claim
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { id } = req.params;
    
    const [result] = await db
      .select({
        claim: delayClaims,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(delayClaims)
      .innerJoin(projects, eq(delayClaims.projectId, projects.id))
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!result) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    // Fetch linked delays if any
    let linkedDelays: any[] = [];
    if (result.claim.linkedDelayIds && result.claim.linkedDelayIds.length > 0) {
      linkedDelays = await db
        .select()
        .from(projectDelays)
        .where(inArray(projectDelays.id, result.claim.linkedDelayIds));
    }
    
    res.json({
      ...result.claim,
      project: result.project,
      linkedDelays,
      statusLabel: CLAIM_STATUS_LABELS[result.claim.status] || result.claim.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[result.claim.claimType] || result.claim.claimType,
    });
  } catch (error) {
    console.error("Error fetching delay claim:", error);
    res.status(500).json({ error: "Failed to fetch delay claim" });
  }
});

// POST /api/delay-claims - Create new delay claim
router.post("/", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    
    const body = {
      ...req.body,
      organizationId: orgId,
      createdById: userId,
      title: sanitizeShortText(req.body.title),
      description: sanitizeText(req.body.description),
    };
    
    const validated = insertDelayClaimSchema.parse(body);
    
    // Generate claim number
    const [project] = await db
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, validated.projectId))
      .limit(1);
    
    if (!project) {
      return res.status(400).json({ error: "Invalid project ID" });
    }
    
    const claimNumber = await generateClaimNumber(project.code);
    
    const [claim] = await db
      .insert(delayClaims)
      .values({
        ...validated,
        claimNumber,
      })
      .returning();
    
    await logAudit({
      userId,
      action: "CREATE",
      entityType: "delay_claim",
      entityId: claim.id,
      newValue: JSON.stringify(claim),
    }, req);
    
    res.status(201).json({
      ...claim,
      statusLabel: CLAIM_STATUS_LABELS[claim.status] || claim.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType,
    });
  } catch (error) {
    console.error("Error creating delay claim:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Failed to create delay claim" });
  }
});

// PATCH /api/delay-claims/:id - Update delay claim
router.patch("/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    const updates: Partial<DelayClaim> = {
      updatedAt: new Date(),
    };
    
    if (req.body.title) updates.title = sanitizeShortText(req.body.title);
    if (req.body.description !== undefined) updates.description = sanitizeText(req.body.description);
    if (req.body.claimType) updates.claimType = req.body.claimType;
    if (req.body.linkedDelayIds) updates.linkedDelayIds = req.body.linkedDelayIds;
    if (req.body.daysRequested !== undefined) updates.daysRequested = req.body.daysRequested;
    if (req.body.costRequested !== undefined) updates.costRequested = req.body.costRequested;
    if (req.body.costBreakdownJson !== undefined) updates.costBreakdownJson = req.body.costBreakdownJson;
    if (req.body.supportingDocUrls) updates.supportingDocUrls = req.body.supportingDocUrls;
    if (req.body.weatherEvidenceSummary !== undefined) updates.weatherEvidenceSummary = sanitizeText(req.body.weatherEvidenceSummary);
    if (req.body.originalCompletionDate) updates.originalCompletionDate = new Date(req.body.originalCompletionDate);
    if (req.body.requestedCompletionDate) updates.requestedCompletionDate = new Date(req.body.requestedCompletionDate);
    
    const [updated] = await db
      .update(delayClaims)
      .set(updates)
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json({
      ...updated,
      statusLabel: CLAIM_STATUS_LABELS[updated.status] || updated.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[updated.claimType] || updated.claimType,
    });
  } catch (error) {
    console.error("Error updating delay claim:", error);
    res.status(500).json({ error: "Failed to update delay claim" });
  }
});

// POST /api/delay-claims/:id/submit - Submit claim for review
router.post("/:id/submit", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "SUBMITTED")) {
      return res.status(400).json({ error: `Cannot submit claim from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "SUBMITTED",
        submittedAt: new Date(),
        submittedById: userId,
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "SUBMIT",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json(updated);
  } catch (error) {
    console.error("Error submitting delay claim:", error);
    res.status(500).json({ error: "Failed to submit delay claim" });
  }
});

// POST /api/delay-claims/:id/review - Start review of claim
router.post("/:id/review", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { reviewNotes } = req.body;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "UNDER_REVIEW")) {
      return res.status(400).json({ error: `Cannot start review from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "UNDER_REVIEW",
        reviewedAt: new Date(),
        reviewedById: userId,
        reviewNotes: sanitizeText(reviewNotes),
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    res.json(updated);
  } catch (error) {
    console.error("Error starting review:", error);
    res.status(500).json({ error: "Failed to start review" });
  }
});

// POST /api/delay-claims/:id/approve - Approve claim
router.post("/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { daysApproved, costApproved, reviewNotes } = req.body;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "APPROVED")) {
      return res.status(400).json({ error: `Cannot approve claim from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: userId,
        daysApproved: daysApproved ?? existing.daysRequested,
        costApproved: costApproved ?? existing.costRequested,
        reviewNotes: reviewNotes ? sanitizeText(reviewNotes) : existing.reviewNotes,
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "APPROVE",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json(updated);
  } catch (error) {
    console.error("Error approving delay claim:", error);
    res.status(500).json({ error: "Failed to approve delay claim" });
  }
});

// POST /api/delay-claims/:id/reject - Reject claim
router.post("/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { rejectionReason } = req.body;
    
    if (!rejectionReason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "REJECTED")) {
      return res.status(400).json({ error: `Cannot reject claim from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: userId,
        rejectionReason: sanitizeText(rejectionReason),
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "REJECT",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json(updated);
  } catch (error) {
    console.error("Error rejecting delay claim:", error);
    res.status(500).json({ error: "Failed to reject delay claim" });
  }
});

// DELETE /api/delay-claims/:id - Delete claim (draft only)
router.delete("/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (existing.status !== "DRAFT") {
      return res.status(400).json({ error: "Only draft claims can be deleted" });
    }
    
    await db.delete(delayClaims).where(eq(delayClaims.id, id));
    
    await logAudit({
      userId,
      action: "DELETE",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
    }, req);
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting delay claim:", error);
    res.status(500).json({ error: "Failed to delete delay claim" });
  }
});

// ============================================================================
// DAILY REPORT LOCKS ROUTES
// ============================================================================

// GET /api/daily-report-locks - List locks for a project
router.get("/locks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const projectId = req.query.projectId as string | undefined;
    
    let conditions = [eq(dailyReportLocks.organizationId, orgId!)];
    if (projectId) {
      conditions.push(eq(dailyReportLocks.projectId, projectId));
    }
    
    const locks = await db
      .select({
        lock: dailyReportLocks,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(dailyReportLocks)
      .innerJoin(projects, eq(dailyReportLocks.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(dailyReportLocks.reportDate));
    
    res.json(locks.map(({ lock, project }) => ({
      ...lock,
      project,
    })));
  } catch (error) {
    console.error("Error fetching daily report locks:", error);
    res.status(500).json({ error: "Failed to fetch daily report locks" });
  }
});

// GET /api/daily-report-locks/:projectId/:date - Get lock status for specific date
router.get("/locks/:projectId/:date", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { projectId, date } = req.params;
    
    const [lock] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(
        eq(dailyReportLocks.organizationId, orgId!),
        eq(dailyReportLocks.projectId, projectId),
        eq(dailyReportLocks.reportDate, date)
      ))
      .limit(1);
    
    res.json(lock || { status: "UNLOCKED", projectId, reportDate: date });
  } catch (error) {
    console.error("Error fetching lock status:", error);
    res.status(500).json({ error: "Failed to fetch lock status" });
  }
});

// POST /api/daily-report-locks - Lock a daily report
router.post("/locks", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { projectId, reportDate, lockReason, contentHash } = req.body;
    
    if (!projectId || !reportDate) {
      return res.status(400).json({ error: "Project ID and report date are required" });
    }
    
    // Check for existing lock
    const [existing] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(
        eq(dailyReportLocks.projectId, projectId),
        eq(dailyReportLocks.reportDate, reportDate)
      ))
      .limit(1);
    
    if (existing && existing.status !== "UNLOCKED") {
      return res.status(400).json({ error: "Report is already locked" });
    }
    
    let lock;
    if (existing) {
      [lock] = await db
        .update(dailyReportLocks)
        .set({
          status: "LOCKED",
          lockedAt: new Date(),
          lockedById: userId,
          lockReason: sanitizeText(lockReason),
          contentHash,
          updatedAt: new Date(),
        })
        .where(eq(dailyReportLocks.id, existing.id))
        .returning();
    } else {
      [lock] = await db
        .insert(dailyReportLocks)
        .values({
          organizationId: orgId,
          projectId,
          reportDate,
          status: "LOCKED",
          lockedAt: new Date(),
          lockedById: userId,
          lockReason: sanitizeText(lockReason),
          contentHash,
        })
        .returning();
    }
    
    await logAudit({
      userId,
      action: "CREATE",
      entityType: "daily_report_lock",
      entityId: lock.id,
      newValue: JSON.stringify(lock),
    }, req);
    
    res.status(201).json(lock);
  } catch (error) {
    console.error("Error locking daily report:", error);
    res.status(500).json({ error: "Failed to lock daily report" });
  }
});

// POST /api/daily-report-locks/:id/supervisor-lock - Supervisor-level lock
router.post("/locks/:id/supervisor-lock", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { supervisorLockNotes } = req.body;
    
    const [existing] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(eq(dailyReportLocks.id, id), eq(dailyReportLocks.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Lock record not found" });
    }
    
    const [updated] = await db
      .update(dailyReportLocks)
      .set({
        status: "SUPERVISOR_LOCKED",
        supervisorLockedAt: new Date(),
        supervisorLockedById: userId,
        supervisorLockNotes: sanitizeText(supervisorLockNotes),
        updatedAt: new Date(),
      })
      .where(eq(dailyReportLocks.id, id))
      .returning();
    
    res.json(updated);
  } catch (error) {
    console.error("Error applying supervisor lock:", error);
    res.status(500).json({ error: "Failed to apply supervisor lock" });
  }
});

// POST /api/delay-claims/locks/:id/unlock - Unlock a locked report
router.post("/locks/:id/unlock", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { unlockReason } = req.body;
    
    const [existing] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(eq(dailyReportLocks.id, id), eq(dailyReportLocks.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Lock record not found" });
    }
    
    if (existing.status === "SUPERVISOR_LOCKED") {
      return res.status(400).json({ error: "Supervisor locked reports cannot be unlocked" });
    }
    
    if (existing.status === "UNLOCKED") {
      return res.status(400).json({ error: "Report is already unlocked" });
    }
    
    const [updated] = await db
      .update(dailyReportLocks)
      .set({
        status: "UNLOCKED",
        updatedAt: new Date(),
      })
      .where(eq(dailyReportLocks.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "daily_report_lock",
      entityId: id,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status: "UNLOCKED", unlockReason }),
    }, req);
    
    res.json(updated);
  } catch (error) {
    console.error("Error unlocking daily report:", error);
    res.status(500).json({ error: "Failed to unlock daily report" });
  }
});

// ============================================================================
// PHOTO CUSTODY RECORDS ROUTES
// ============================================================================

// GET /api/photo-custody - List photo custody records
router.get("/photo-custody", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const projectId = req.query.projectId as string | undefined;
    const claimId = req.query.claimId as string | undefined;
    const photoUrl = req.query.photoUrl as string | undefined;
    
    let conditions = [eq(photoCustodyRecords.organizationId, orgId!)];
    if (projectId) {
      conditions.push(eq(photoCustodyRecords.projectId, projectId));
    }
    if (claimId) {
      conditions.push(eq(photoCustodyRecords.linkedClaimId, claimId));
    }
    if (photoUrl) {
      conditions.push(eq(photoCustodyRecords.photoUrl, photoUrl));
    }
    
    const records = await db
      .select({
        record: photoCustodyRecords,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(photoCustodyRecords)
      .innerJoin(users, eq(photoCustodyRecords.actionById, users.id))
      .where(and(...conditions))
      .orderBy(desc(photoCustodyRecords.actionAt));
    
    res.json(records.map(({ record, user }) => ({
      ...record,
      actionByUser: user,
    })));
  } catch (error) {
    console.error("Error fetching photo custody records:", error);
    res.status(500).json({ error: "Failed to fetch photo custody records" });
  }
});

// POST /api/photo-custody - Record a custody action
router.post("/photo-custody", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    
    const body = {
      ...req.body,
      organizationId: orgId,
      actionById: userId,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
    
    const validated = insertPhotoCustodyRecordSchema.parse(body);
    
    const [record] = await db
      .insert(photoCustodyRecords)
      .values(validated)
      .returning();
    
    res.status(201).json(record);
  } catch (error) {
    console.error("Error creating photo custody record:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Failed to create photo custody record" });
  }
});

// GET /api/photo-custody/chain/:photoUrl - Get full chain of custody for a photo
router.get("/photo-custody/chain/:photoUrl", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const photoUrl = decodeURIComponent(req.params.photoUrl);
    
    const records = await db
      .select({
        record: photoCustodyRecords,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(photoCustodyRecords)
      .innerJoin(users, eq(photoCustodyRecords.actionById, users.id))
      .where(and(
        eq(photoCustodyRecords.organizationId, orgId!),
        eq(photoCustodyRecords.photoUrl, photoUrl)
      ))
      .orderBy(photoCustodyRecords.actionAt);
    
    res.json({
      photoUrl,
      chainOfCustody: records.map(({ record, user }) => ({
        action: record.action,
        actionAt: record.actionAt,
        actionBy: `${user.firstName} ${user.lastName}`,
        actionNotes: record.actionNotes,
        ipAddress: record.ipAddress,
      })),
      totalActions: records.length,
    });
  } catch (error) {
    console.error("Error fetching chain of custody:", error);
    res.status(500).json({ error: "Failed to fetch chain of custody" });
  }
});

export default router;
