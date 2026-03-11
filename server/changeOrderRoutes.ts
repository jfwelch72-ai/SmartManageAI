import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { changeOrders, insertChangeOrderSchema, users, notifications, projects, changeOrderRevisions, changeOrderApprovals } from "@shared/schema";
import { eq, and, desc, sql, max } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";
import { createApprovalRequest } from "./services/approvalService";
import { isFeatureEnabled } from "./services/featureFlagService";

const router = Router();

// Valid state transitions for change orders
// Simplified workflow: DRAFT → SUBMITTED → APPROVED/REJECTED
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],  // Submit directly to client
  SUBMITTED: ["DRAFT", "APPROVED", "REJECTED"],  // Client approves/rejects or return for revision
  APPROVED: [],  // Terminal state - no further transitions
  REJECTED: ["DRAFT"],  // Can be revised and resubmitted
  PENDING_APPROVAL: ["SUBMITTED", "DRAFT"],  // Legacy support: allow transition from old status
};

/**
 * Validates if a state transition is allowed
 */
function isValidTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

/**
 * Gets a change order by ID with validation and project org info
 */
async function getChangeOrderById(id: string) {
  const [result] = await db
    .select({
      order: changeOrders,
      project: {
        id: projects.id,
        gcOrganizationId: projects.gcOrganizationId,
      },
    })
    .from(changeOrders)
    .leftJoin(projects, eq(changeOrders.projectId, projects.id))
    .where(eq(changeOrders.id, id))
    .limit(1);
  
  return result;
}

/**
 * Checks if user has organization access to a change order
 */
function checkOrgAccess(
  req: AuthRequest,
  projectOrgId: string | null | undefined
): { allowed: boolean; mustDenyAccess: boolean } {
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  
  if (mustDenyAccess) {
    return { allowed: false, mustDenyAccess: true };
  }
  
  if (shouldFilter && orgId && projectOrgId !== orgId) {
    return { allowed: false, mustDenyAccess: false };
  }
  
  return { allowed: true, mustDenyAccess: false };
}

/**
 * Notifies relevant users about a change order status change
 * Transaction-aware to support atomic operations
 */
async function notifyStatusChange(
  order: any,
  newStatus: string,
  message: string,
  notifyRequestedBy: boolean = true,
  tx?: DbTransaction
) {
  try {
    const dbClient = tx || db;
    const notificationsToCreate: any[] = [];

    const statusTypeMap: Record<string, string> = {
      SUBMITTED: "CHANGE_ORDER_PENDING",
      APPROVED: "CHANGE_ORDER_APPROVED",
      REJECTED: "CHANGE_ORDER_REJECTED",
      DRAFT: "GENERAL",
    };

    if (notifyRequestedBy) {
      notificationsToCreate.push({
        userId: order.requestedById,
        type: (statusTypeMap[newStatus] || "GENERAL") as any,
        title: `Change Order ${newStatus}`,
        message,
        relatedEntityId: order.id,
        relatedEntityType: "changeOrder",
      });
    }

    if (newStatus === "SUBMITTED") {
      const adminsAndManagers = await dbClient
        .select()
        .from(users)
        .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);

      adminsAndManagers.forEach((user: any) => {
        notificationsToCreate.push({
          userId: user.id,
          type: "CHANGE_ORDER_PENDING" as const,
          title: "Change Order Submitted",
          message: `Change order ${order.changeOrderNumber} has been submitted to client`,
          relatedEntityId: order.id,
          relatedEntityType: "changeOrder",
        });
      });
    }

    if (notificationsToCreate.length > 0) {
      await dbClient.insert(notifications).values(notificationsToCreate);
    }
  } catch (error) {
    console.error("Failed to create change order notifications:", error);
  }
}

/**
 * Creates a revision record for a change order status change
 */
async function createRevision(
  changeOrderId: string,
  previousStatus: string,
  newStatus: string,
  revisedById: string,
  description?: string,
  amount?: string | null,
  changedFields?: Record<string, any>
) {
  const [maxRev] = await db
    .select({ maxNum: sql<number>`COALESCE(MAX(${changeOrderRevisions.revisionNumber}), 0)` })
    .from(changeOrderRevisions)
    .where(eq(changeOrderRevisions.changeOrderId, changeOrderId));

  const nextRevision = (maxRev?.maxNum || 0) + 1;

  await db.insert(changeOrderRevisions).values({
    changeOrderId,
    revisionNumber: nextRevision,
    previousStatus,
    newStatus,
    amount: amount || null,
    description: description || `Status changed from ${previousStatus} to ${newStatus}`,
    changedFields: changedFields ? JSON.stringify(changedFields) : null,
    revisedById,
  });
}

// ====================
// Change Order State Transition Routes
// ====================

/**
 * @deprecated Legacy endpoint - use /submit instead
 * For backward compatibility, this now redirects to SUBMITTED status directly
 * Also handles migrating any existing PENDING_APPROVAL records to SUBMITTED
 */
router.post("/:id/request-approval", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;

    // Check organization access
    const { allowed, mustDenyAccess } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(mustDenyAccess ? 403 : 403).json({ error: "Access denied" });
      return;
    }

    // For simplified workflow: treat as submit to client
    // Handles both DRAFT and legacy PENDING_APPROVAL statuses
    if (order.status !== "DRAFT" && order.status !== "PENDING_APPROVAL") {
      res.status(400).json({ 
        error: `Cannot submit from ${order.status} status. Change order must be in DRAFT status.` 
      });
      return;
    }

    // Submit directly to client (simplified workflow)
    const now = new Date();
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "SUBMITTED",
        submittedAt: now,
        updatedAt: now,
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "SUBMITTED", req.user!.id, "Submitted to client", order.amount);

    await logAudit({
      userId: req.user!.id,
      action: "SUBMIT",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "SUBMITTED" }),
    }, req);

    await notifyStatusChange(
      updatedOrder,
      "SUBMITTED",
      `Change order ${updatedOrder.changeOrderNumber} has been submitted to client`,
      true
    );

    if (project?.gcOrganizationId) {
      try {
        const approvalsEnabled = await isFeatureEnabled(project.gcOrganizationId, "APPROVALS_FRAMEWORK");
        if (approvalsEnabled) {
          await createApprovalRequest(
            project.gcOrganizationId,
            "CHANGE_ORDER",
            order.id,
            req.user!.id,
            `Change order ${updatedOrder.changeOrderNumber} submitted for approval`
          );
        }
      } catch (e) { /* non-blocking */ }
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Request approval error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Submit a change order to client
 * DRAFT -> SUBMITTED (simplified workflow)
 */
router.post("/:id/submit", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;

    // Check organization access
    const { allowed, mustDenyAccess } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (!isValidTransition(order.status, "SUBMITTED")) {
      res.status(400).json({ 
        error: `Cannot transition from ${order.status} to SUBMITTED` 
      });
      return;
    }

    // Update change order status with submittedAt timestamp
    const now = new Date();
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "SUBMITTED",
        submittedAt: now,
        updatedAt: now,
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    // Guard: Check if update actually found a row (concurrent deletion protection)
    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "SUBMITTED", req.user!.id, "Submitted to client", order.amount);

    // Audit log
    await logAudit({
      userId: req.user!.id,
      action: "SUBMIT",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "SUBMITTED" }),
    }, req);

    // Notify requester
    await notifyStatusChange(
      updatedOrder,
      "SUBMITTED",
      `Change order ${updatedOrder.changeOrderNumber} has been submitted to client`,
      true
    );

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Submit change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Approve a change order
 * SUBMITTED -> APPROVED (simplified workflow)
 */
router.post("/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;

    // Check organization access
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (!isValidTransition(order.status, "APPROVED")) {
      res.status(400).json({ 
        error: `Cannot approve from ${order.status} status. Change order must be SUBMITTED first.` 
      });
      return;
    }

    // Approve change order (sequential operations - Neon HTTP driver doesn't support transactions)
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "APPROVED",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    // Guard: Check if update actually found a row (concurrent deletion protection)
    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "APPROVED", req.user!.id, "Change order approved", order.amount);

    // Audit log
    await logAudit({
      userId: req.user!.id,
      action: "APPROVE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "APPROVED", approvedById: req.user!.id }),
    }, req);

    // Notify requester
    await notifyStatusChange(
      updatedOrder,
      "APPROVED",
      `Change order ${updatedOrder.changeOrderNumber} has been approved`,
      true
    );

    // Notify Office Manager about approved change order affecting billing
    try {
      if (project?.gcOrganizationId) {
        const officeManagers = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, project.gcOrganizationId),
              eq(users.role, "OFFICE_MANAGER"),
              eq(users.isActive, true)
            )
          );

        if (officeManagers.length > 0) {
          const amount = Number(updatedOrder.amount || 0);
          const formattedAmount = amount >= 0
            ? `+$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
            : `-$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

          const coNotifs = officeManagers.map((mgr) => ({
            userId: mgr.id,
            type: "CHANGE_ORDER_APPROVED" as const,
            title: "Change Order Approved - Billing Impact",
            message: `CO #${updatedOrder.changeOrderNumber} approved (${formattedAmount}): "${updatedOrder.description}"`,
            relatedEntityId: updatedOrder.projectId,
            relatedEntityType: "project" as const,
          }));
          await db.insert(notifications).values(coNotifs);
        }
      }
    } catch (notifError) {
      console.error("Failed to create CO approval billing notification:", notifError);
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Approve change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Reject a change order
 * Any non-terminal state -> REJECTED
 */
router.post("/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    // SECURITY: Sanitize text inputs for data integrity
    const rejectionReason = req.body.rejectionReason ? sanitizeText(req.body.rejectionReason) : undefined;

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      res.status(400).json({ error: "Rejection reason is required" });
      return;
    }

    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;

    // Check organization access
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (!isValidTransition(order.status, "REJECTED")) {
      res.status(400).json({ 
        error: `Cannot reject from ${order.status} status` 
      });
      return;
    }

    // Reject change order (sequential operations - Neon HTTP driver doesn't support transactions)
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "REJECTED",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        rejectionReason,
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    // Guard: Check if update actually found a row (concurrent deletion protection)
    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "REJECTED", req.user!.id, `Rejected: ${rejectionReason}`, order.amount, { rejectionReason });

    // Audit log
    await logAudit({
      userId: req.user!.id,
      action: "REJECT",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ 
        status: "REJECTED", 
        rejectionReason,
        approvedById: req.user!.id 
      }),
    }, req);

    // Notify requester
    await notifyStatusChange(
      updatedOrder,
      "REJECTED",
      `Change order ${updatedOrder.changeOrderNumber} has been rejected: ${rejectionReason}`,
      true
    );

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Reject change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Return a change order to draft for revision
 * PENDING_APPROVAL -> DRAFT or SUBMITTED -> DRAFT or REJECTED -> DRAFT
 */
router.post("/:id/return-to-draft", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    // SECURITY: Sanitize text inputs for data integrity
    const reason = req.body.reason ? sanitizeText(req.body.reason) : undefined;

    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;

    // Check organization access
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (!isValidTransition(order.status, "DRAFT")) {
      res.status(400).json({ 
        error: `Cannot return to draft from ${order.status} status` 
      });
      return;
    }

    // Return to draft - clear submittedAt so weekly alerts use fresh date on re-submission
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "DRAFT",
        submittedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    // Guard: Check if update actually found a row (concurrent deletion protection)
    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "DRAFT", req.user!.id, reason ? `Returned to draft: ${reason}` : "Returned to draft for revision", order.amount, reason ? { reason } : undefined);

    // Audit log
    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "DRAFT", reason }),
    }, req);

    // Notify requester
    await notifyStatusChange(
      updatedOrder,
      "DRAFT",
      `Change order ${updatedOrder.changeOrderNumber} has been returned to draft${reason ? `: ${reason}` : ""}`,
      true
    );

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Return to draft error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Order Revision History
// ====================

router.get("/:id/revisions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { project } = result;
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const revisions = await db
      .select({
        revision: changeOrderRevisions,
        revisedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(changeOrderRevisions)
      .leftJoin(users, eq(changeOrderRevisions.revisedById, users.id))
      .where(eq(changeOrderRevisions.changeOrderId, req.params.id))
      .orderBy(desc(changeOrderRevisions.revisionNumber));

    res.json(revisions);
  } catch (error: any) {
    console.error("Get revisions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Order Approval Chain
// ====================

router.get("/:id/approvals", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { project } = result;
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const approvals = await db
      .select({
        approval: changeOrderApprovals,
        approver: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(changeOrderApprovals)
      .leftJoin(users, eq(changeOrderApprovals.approverId, users.id))
      .where(eq(changeOrderApprovals.changeOrderId, req.params.id))
      .orderBy(changeOrderApprovals.stepOrder);

    res.json(approvals);
  } catch (error: any) {
    console.error("Get approvals error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/approve-step", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { comments } = req.body;
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (order.status !== "SUBMITTED") {
      res.status(400).json({ error: "Change order must be SUBMITTED to approve steps" });
      return;
    }

    const pendingApprovals = await db
      .select()
      .from(changeOrderApprovals)
      .where(and(
        eq(changeOrderApprovals.changeOrderId, req.params.id),
        eq(changeOrderApprovals.status, "PENDING")
      ))
      .orderBy(changeOrderApprovals.stepOrder);

    if (pendingApprovals.length === 0) {
      res.status(400).json({ error: "No pending approval steps" });
      return;
    }

    const currentStep = pendingApprovals[0];

    const [updatedApproval] = await db
      .update(changeOrderApprovals)
      .set({
        status: "APPROVED",
        approverId: req.user!.id,
        comments: comments ? sanitizeText(comments) : null,
        decidedAt: new Date(),
      })
      .where(eq(changeOrderApprovals.id, currentStep.id))
      .returning();

    await createRevision(
      order.id,
      order.status,
      order.status,
      req.user!.id,
      `Approval step ${currentStep.stepOrder} approved by ${currentStep.approverRole}`,
      order.amount,
      { approvalStep: currentStep.stepOrder, approverRole: currentStep.approverRole }
    );

    const remainingPending = await db
      .select()
      .from(changeOrderApprovals)
      .where(and(
        eq(changeOrderApprovals.changeOrderId, req.params.id),
        eq(changeOrderApprovals.status, "PENDING")
      ));

    if (remainingPending.length === 0) {
      const [updatedOrder] = await db
        .update(changeOrders)
        .set({
          status: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      await createRevision(order.id, "SUBMITTED", "APPROVED", req.user!.id, "All approval steps completed — change order approved", order.amount);

      await logAudit({
        userId: req.user!.id,
        action: "APPROVE",
        entityType: "changeOrder",
        entityId: order.id,
        oldValue: JSON.stringify({ status: "SUBMITTED" }),
        newValue: JSON.stringify({ status: "APPROVED" }),
      }, req);

      await notifyStatusChange(
        updatedOrder || order,
        "APPROVED",
        `Change order ${order.changeOrderNumber} has been fully approved`,
        true
      );

      res.json({ approval: updatedApproval, order: updatedOrder, allApproved: true });
    } else {
      res.json({ approval: updatedApproval, allApproved: false, remainingSteps: remainingPending.length });
    }
  } catch (error: any) {
    console.error("Approve step error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/reject-step", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const rejectionReason = req.body.rejectionReason ? sanitizeText(req.body.rejectionReason) : undefined;

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      res.status(400).json({ error: "Rejection reason is required" });
      return;
    }

    const result = await getChangeOrderById(req.params.id);
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (order.status !== "SUBMITTED") {
      res.status(400).json({ error: "Change order must be SUBMITTED to reject steps" });
      return;
    }

    const pendingApprovals = await db
      .select()
      .from(changeOrderApprovals)
      .where(and(
        eq(changeOrderApprovals.changeOrderId, req.params.id),
        eq(changeOrderApprovals.status, "PENDING")
      ))
      .orderBy(changeOrderApprovals.stepOrder);

    if (pendingApprovals.length === 0) {
      res.status(400).json({ error: "No pending approval steps" });
      return;
    }

    const currentStep = pendingApprovals[0];

    await db
      .update(changeOrderApprovals)
      .set({
        status: "REJECTED",
        approverId: req.user!.id,
        comments: rejectionReason,
        decidedAt: new Date(),
      })
      .where(eq(changeOrderApprovals.id, currentStep.id));

    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "DRAFT",
        rejectionReason,
        submittedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    await db
      .update(changeOrderApprovals)
      .set({ status: "PENDING", approverId: null, comments: null, decidedAt: null })
      .where(and(
        eq(changeOrderApprovals.changeOrderId, req.params.id),
        eq(changeOrderApprovals.status, "PENDING")
      ));

    await createRevision(
      order.id, order.status, "DRAFT", req.user!.id,
      `Rejected at step ${currentStep.stepOrder} (${currentStep.approverRole}): ${rejectionReason}`,
      order.amount, { rejectionReason, rejectedStep: currentStep.stepOrder }
    );

    await logAudit({
      userId: req.user!.id,
      action: "REJECT",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "DRAFT", rejectionReason }),
    }, req);

    await notifyStatusChange(
      updatedOrder || order,
      "DRAFT",
      `Change order ${order.changeOrderNumber} rejected at approval step: ${rejectionReason}`,
      true
    );

    res.json({ order: updatedOrder, rejectedStep: currentStep.stepOrder });
  } catch (error: any) {
    console.error("Reject step error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/setup-approval-chain", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const chainSchema = z.object({
      steps: z.array(z.object({
        approverRole: z.string(),
        approverId: z.string().optional(),
      })).min(1),
    });

    const validation = chainSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: "Invalid approval chain", details: validation.error.errors });
      return;
    }

    const result = await getChangeOrderById(req.params.id);
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;
    const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await db.delete(changeOrderApprovals).where(eq(changeOrderApprovals.changeOrderId, req.params.id));

    const approvalEntries = validation.data.steps.map((step, idx) => ({
      changeOrderId: req.params.id,
      approverRole: step.approverRole,
      approverId: step.approverId || null,
      status: "PENDING" as const,
      stepOrder: idx + 1,
    }));

    await db.insert(changeOrderApprovals).values(approvalEntries);

    await db.update(changeOrders).set({
      approvalChainJson: JSON.stringify(validation.data.steps),
      updatedAt: new Date(),
    }).where(eq(changeOrders.id, req.params.id));

    res.json({ message: "Approval chain configured", steps: approvalEntries.length });
  } catch (error: any) {
    console.error("Setup approval chain error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Order File Attachments
// ====================

/**
 * Upload and attach a file to a change order
 * Note: File should already be uploaded to object storage via /api/objects/upload
 * This endpoint saves the file metadata to the change order's attachmentsJson field
 * RBAC: Only admins, managers, and users associated with the project can upload files
 */
router.post("/:id/files", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project: orderProject } = result;

    // Check organization access first
    const { allowed } = checkOrgAccess(req, orderProject?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // SECURITY: Verify user has permission to attach files to this change order
    // Only admins, managers, office managers, and users associated with the project can upload
    const userRole = req.user!.role;
    const userId = req.user!.id;
    
    if (!["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(userRole)) {
      // Get full project to verify user is superintendent or associated with project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, order.projectId))
        .limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      
      // Verify user is the project superintendent, estimator, or the change order requester
      if (project.superintendentId !== userId && 
          project.estimatorId !== userId && 
          order.requestedById !== userId) {
        res.status(403).json({ error: "You don't have permission to upload files to this change order" });
        return;
      }
    }

    // Validate file metadata
    const fileSchema = z.object({
      fileUrl: z.string(),
      fileName: z.string(),
      fileSize: z.number(),
      mimeType: z.string(),
      description: z.string().optional(),
    });

    const validationResult = fileSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid file metadata", details: validationResult.error.errors });
      return;
    }

    const { fileUrl, fileName, fileSize, mimeType, description } = validationResult.data;

    // Set object ACL policy for the file
    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    
    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
      fileUrl,
      {
        owner: req.user!.id,
        organizationId: req.user!.organizationId!,
        visibility: "private", // Change order files are private
      }
    );

    // Get current attachments or initialize empty array
    const currentAttachments = order.attachmentsJson 
      ? JSON.parse(order.attachmentsJson) 
      : [];

    // Add new file to attachments
    const newAttachment = {
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      description: description || "",
      uploadedById: req.user!.id,
      uploadedAt: new Date().toISOString(),
      objectKey,
    };

    const updatedAttachments = [...currentAttachments, newAttachment];

    // Update change order with new attachments
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        attachmentsJson: JSON.stringify(updatedAttachments),
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    // Audit log
    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: null,
      newValue: JSON.stringify({ fileName, fileSize }),
    }, req);

    res.status(201).json(newAttachment);
  } catch (error: any) {
    console.error("Upload change order file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Get all files attached to a change order
 * RBAC: Only admins, managers, and users associated with the project can view files
 */
router.get("/:id/files", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project: orderProject } = result;

    // Check organization access first
    const { allowed } = checkOrgAccess(req, orderProject?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // SECURITY: Verify user has permission to view files for this change order
    const userRole = req.user!.role;
    const userId = req.user!.id;
    
    if (!["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(userRole)) {
      // Get full project to verify user is superintendent or associated with project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, order.projectId))
        .limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      
      // Verify user is the project superintendent, estimator, or the change order requester
      if (project.superintendentId !== userId && 
          project.estimatorId !== userId && 
          order.requestedById !== userId) {
        res.status(403).json({ error: "You don't have permission to view files for this change order" });
        return;
      }
    }

    const attachments = order.attachmentsJson 
      ? JSON.parse(order.attachmentsJson) 
      : [];

    res.json(attachments);
  } catch (error: any) {
    console.error("Get change order files error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Delete a file from a change order
 * RBAC: Only the uploader, admins, and managers can delete files
 */
router.delete("/:id/files/:fileId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project: orderProject } = result;

    // Check organization access first
    const { allowed } = checkOrgAccess(req, orderProject?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // SECURITY: First verify user has basic access to view this change order
    const userRole = req.user!.role;
    const userId = req.user!.id;
    
    if (!["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(userRole)) {
      // Get full project to verify user is superintendent or associated with project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, order.projectId))
        .limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      
      // Verify user is the project superintendent, estimator, or the change order requester
      if (project.superintendentId !== userId && 
          project.estimatorId !== userId && 
          order.requestedById !== userId) {
        res.status(403).json({ error: "You don't have permission to access this change order" });
        return;
      }
    }

    const attachments = order.attachmentsJson 
      ? JSON.parse(order.attachmentsJson) 
      : [];

    const fileToDelete = attachments.find((f: any) => f.id === req.params.fileId);
    
    if (!fileToDelete) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    // Check permissions: uploader, admin, manager, or office manager can delete
    const isUploader = fileToDelete.uploadedById === req.user!.id;
    const isAuthorized = ["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(req.user!.role);

    if (!isUploader && !isAuthorized) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    // Remove file from attachments
    const updatedAttachments = attachments.filter((f: any) => f.id !== req.params.fileId);

    // Update change order
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        attachmentsJson: JSON.stringify(updatedAttachments),
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    // Audit log
    await logAudit({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ fileName: fileToDelete.fileName }),
      newValue: null,
    }, req);

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete change order file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
