import { Router, type Request, type Response } from "express";
import { eventBus } from "./events";
import { db } from "./db";
import { changeOrders, insertChangeOrderSchema, users, notifications, projects, changeOrderRevisions, changeOrderApprovals, changeOrderAttachments, tmTickets, rfis } from "@shared/schema";
import { eq, and, desc, sql, max } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { insertNotifications } from "./services/notificationService";
import { sanitizeText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";
import { createApprovalRequest } from "./services/approvalService";
import { isFeatureEnabled } from "./services/featureFlagService";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";

const router = Router();

// Valid state transitions for change orders
// Full PCO workflow: PCO → PRICING_REVIEW → SUBMITTED → APPROVED/REJECTED
const VALID_TRANSITIONS: Record<string, string[]> = {
  // New PCO workflow
  PCO: ["PRICING_REVIEW"],                        // Issue priced, sent for internal review
  PRICING_REVIEW: ["SUBMITTED", "PCO"],           // Approved to client, or returned for revision
  SUBMITTED: ["APPROVED", "REJECTED"],            // Client approves or rejects
  APPROVED: ["VOIDED"],                           // Re-scope path
  REJECTED: ["PCO"],                              // Returned to re-price
  VOIDED: [],                                     // Terminal state
  // Legacy backward-compatibility entries
  DRAFT: ["SUBMITTED"],
  PENDING_APPROVAL: ["SUBMITTED", "DRAFT"],
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
 */
async function notifyStatusChange(
  order: any,
  newStatus: string,
  message: string,
  notifyRequestedBy: boolean = true,
  orgId?: string
) {
  try {
    const statusTypeMap: Record<string, string> = {
      SUBMITTED: "CHANGE_ORDER_PENDING",
      APPROVED: "CHANGE_ORDER_APPROVED",
      REJECTED: "CHANGE_ORDER_REJECTED",
      DRAFT: "GENERAL",
    };

    const notificationType = statusTypeMap[newStatus] || "GENERAL";

    if (newStatus === "SUBMITTED" && orgId) {
      await notifyApprovers(
        orgId,
        order.requestedById,
        {
          type: "CHANGE_ORDER_PENDING",
          title: "Change Order Submitted",
          message: `Change order ${order.changeOrderNumber} has been submitted to client`,
          relatedEntityId: order.id,
          relatedEntityType: "changeOrder",
        }
      );
    }

    if (notifyRequestedBy && order.requestedById && newStatus !== "SUBMITTED") {
      await notifySubmitter(order.requestedById, {
        type: notificationType,
        title: `Change Order ${newStatus.charAt(0) + newStatus.slice(1).toLowerCase()}`,
        message,
        relatedEntityId: order.id,
        relatedEntityType: "changeOrder",
      });
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
      true,
      project?.gcOrganizationId || undefined
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

    const clientResponseDueDateRaw = req.body.clientResponseDueDate;
    let clientResponseDueDate: Date | undefined;
    if (clientResponseDueDateRaw) {
      const parsed = new Date(clientResponseDueDateRaw);
      if (!isNaN(parsed.getTime())) {
        clientResponseDueDate = parsed;
      }
    }

    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "SUBMITTED",
        submittedAt: now,
        updatedAt: now,
        ...(clientResponseDueDate !== undefined ? { clientResponseDueDate } : {}),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    // Guard: Check if update actually found a row (concurrent deletion protection)
    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    // Auto-bootstrap default approval chain if none has been configured
    try {
      const existingApprovals = await db
        .select({ id: changeOrderApprovals.id })
        .from(changeOrderApprovals)
        .where(eq(changeOrderApprovals.changeOrderId, req.params.id))
        .limit(1);

      if (existingApprovals.length === 0) {
        await db.insert(changeOrderApprovals).values({
          changeOrderId: req.params.id,
          approverRole: "MANAGER",
          status: "PENDING",
          stepOrder: 1,
          approverId: null,
        });
      }
    } catch (approvalErr) {
      console.error("Failed to auto-bootstrap approval chain:", approvalErr);
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
      true,
      project?.gcOrganizationId || undefined
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
          await insertNotifications(coNotifs);
        }
      }
    } catch (notifError) {
      console.error("Failed to create CO approval billing notification:", notifError);
    }

    await eventBus.emit({
      type: "change_order.approved",
      version: 1,
      orgId: project?.gcOrganizationId || req.user!.organizationId || "",
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: {
        changeOrderId: updatedOrder.id,
        projectId: updatedOrder.projectId,
        amount: Number(updatedOrder.amount || 0),
        approvedBy: req.user!.id,
      },
    });

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

    await eventBus.emit({
      type: "change_order.rejected",
      version: 1,
      orgId: project?.gcOrganizationId || req.user!.organizationId || "",
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: {
        changeOrderId: updatedOrder.id,
        projectId: updatedOrder.projectId,
        reason: rejectionReason,
        rejectedBy: req.user!.id,
      },
    });

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Reject change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Promote a PCO to pricing review
 * PCO -> PRICING_REVIEW
 */
router.post("/:id/promote-to-review", requireAuth, requireRole("ADMIN", "MANAGER", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;

    const { allowed, mustDenyAccess } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (!isValidTransition(order.status, "PRICING_REVIEW")) {
      res.status(400).json({ error: `Cannot promote to pricing review from ${order.status} status` });
      return;
    }

    const now = new Date();
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({ status: "PRICING_REVIEW", updatedAt: now })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "PRICING_REVIEW", req.user!.id, "Promoted to pricing review", order.amount);

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "PRICING_REVIEW" }),
    }, req);

    if (project?.gcOrganizationId) {
      try {
        // Notify org ADMINs who should review pricing (excluding the person who promoted it)
        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.organizationId, project.gcOrganizationId), eq(users.role, "ADMIN"), eq(users.isActive, true)));
        const reviewers = admins.filter(u => u.id !== req.user!.id);
        if (reviewers.length > 0) {
          await insertNotifications(reviewers.map(u => ({
            userId: u.id,
            type: "CHANGE_ORDER_PENDING" as const,
            title: "Change Order Awaiting Pricing Review",
            message: `CO ${updatedOrder.changeOrderNumber} has been promoted to pricing review`,
            relatedEntityId: updatedOrder.id,
            relatedEntityType: "changeOrder" as const,
          })));
        }
      } catch (e) { /* non-blocking */ }
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Promote to review error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Approve pricing and submit to client
 * PRICING_REVIEW -> SUBMITTED
 */
router.post("/:id/approve-pricing", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
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

    if (!isValidTransition(order.status, "SUBMITTED")) {
      res.status(400).json({ error: `Cannot approve pricing from ${order.status} status` });
      return;
    }

    const clientResponseDueDate = req.body.clientResponseDueDate ? new Date(req.body.clientResponseDueDate) : undefined;

    const now = new Date();
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "SUBMITTED",
        submittedAt: now,
        updatedAt: now,
        ...(clientResponseDueDate ? { clientResponseDueDate } : {}),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "SUBMITTED", req.user!.id, "Pricing approved, submitted to client", order.amount);

    await logAudit({
      userId: req.user!.id,
      action: "SUBMIT",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "SUBMITTED" }),
    }, req);

    // Notify the requester that pricing was approved and CO was submitted to client
    if (updatedOrder.requestedById && updatedOrder.requestedById !== req.user!.id) {
      try {
        await notifySubmitter(updatedOrder.requestedById, {
          type: "CHANGE_ORDER_PENDING",
          title: "Change Order Submitted to Client",
          message: `Change order ${updatedOrder.changeOrderNumber} pricing was approved and has been submitted to the client`,
          relatedEntityId: updatedOrder.id,
          relatedEntityType: "changeOrder",
        });
      } catch (e) { /* non-blocking */ }
    }

    // Also notify approvers (admins/managers in org)
    if (project?.gcOrganizationId) {
      await notifyApprovers(
        project.gcOrganizationId,
        updatedOrder.requestedById,
        {
          type: "CHANGE_ORDER_PENDING",
          title: "Change Order Submitted to Client",
          message: `Change order ${updatedOrder.changeOrderNumber} has been submitted to client`,
          relatedEntityId: updatedOrder.id,
          relatedEntityType: "changeOrder",
        }
      );
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Approve pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Return a change order from pricing review back to PCO
 * PRICING_REVIEW -> PCO
 */
router.post("/:id/return-to-pco", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const reason = req.body.reason ? sanitizeText(req.body.reason) : undefined;

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

    if (!isValidTransition(order.status, "PCO")) {
      res.status(400).json({ error: `Cannot return to PCO from ${order.status} status` });
      return;
    }

    const now = new Date();
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({ status: "PCO", submittedAt: null, updatedAt: now })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "PCO", req.user!.id, reason ? `Returned to PCO: ${reason}` : "Returned to PCO for revision", order.amount, reason ? { reason } : undefined);

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "PCO", reason }),
    }, req);

    await notifyStatusChange(updatedOrder, "PCO", `Change order ${updatedOrder.changeOrderNumber} has been returned to PCO for revision${reason ? `: ${reason}` : ""}`, true);

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Return to PCO error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Void an approved change order
 * APPROVED -> VOIDED
 */
router.post("/:id/void", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const voidReason = req.body.voidReason ? sanitizeText(req.body.voidReason) : undefined;

    if (!voidReason || voidReason.trim().length === 0) {
      res.status(400).json({ error: "Void reason is required" });
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

    if (!isValidTransition(order.status, "VOIDED")) {
      res.status(400).json({ error: `Cannot void from ${order.status} status. Only APPROVED change orders can be voided.` });
      return;
    }

    const now = new Date();
    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: "VOIDED",
        voidReason,
        voidedAt: now,
        voidedById: req.user!.id,
        updatedAt: now,
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, "VOIDED", req.user!.id, `Voided: ${voidReason}`, order.amount, { voidReason, voidedById: req.user!.id });

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: "VOIDED", voidReason }),
    }, req);

    await notifyStatusChange(updatedOrder, "VOIDED", `Change order ${updatedOrder.changeOrderNumber} has been voided: ${voidReason}`, true);

    if (order.approvedById && order.approvedById !== req.user!.id) {
      try {
        await insertNotifications([{
          userId: order.approvedById,
          type: "GENERAL" as const,
          title: "Change Order Voided",
          message: `CO ${updatedOrder.changeOrderNumber} that you approved has been voided: ${voidReason}`,
          relatedEntityId: updatedOrder.id,
          relatedEntityType: "changeOrder" as const,
        }]);
      } catch (e) { /* non-blocking */ }
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Void change order error:", error);
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
      updatedAt: new Date(),
    }).where(eq(changeOrders.id, req.params.id));

    res.json({ message: "Approval chain configured", steps: approvalEntries.length });
  } catch (error: any) {
    console.error("Setup approval chain error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Order Link Routes
// ====================

router.post("/:id/link-tm", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { tmTicketId } = req.body;
    if (!tmTicketId || typeof tmTicketId !== "string") {
      res.status(400).json({ error: "tmTicketId is required" });
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

    const [ticket] = await db.select().from(tmTickets).where(eq(tmTickets.id, tmTicketId)).limit(1);
    if (!ticket) {
      res.status(404).json({ error: "T&M ticket not found" });
      return;
    }

    if (ticket.projectId !== order.projectId) {
      res.status(400).json({ error: "T&M ticket does not belong to the same project as this change order" });
      return;
    }

    const [updatedOrder] = await db
      .update(changeOrders)
      .set({ linkedTmTicketId: tmTicketId, updatedAt: new Date() })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    await createRevision(
      order.id,
      order.status,
      order.status,
      req.user!.id,
      `Linked to T&M ticket ${ticket.ticketNumber}`,
      order.amount,
      { linkedTmTicketId: tmTicketId }
    );

    if (ticket.submittedById) {
      try {
        const { notifySubmitter } = await import("./services/approvalNotificationService");
        await notifySubmitter(ticket.submittedById, {
          type: "GENERAL",
          title: "T&M Ticket Linked to Change Order",
          message: `T&M ticket ${ticket.ticketNumber} has been linked to change order ${order.changeOrderNumber}`,
          relatedEntityId: order.id,
          relatedEntityType: "changeOrder",
        });
      } catch (e) {
        console.error("Failed to notify TM ticket submitter:", e);
      }
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Link TM ticket error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/link-rfi", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { rfiId } = req.body;
    if (!rfiId || typeof rfiId !== "string") {
      res.status(400).json({ error: "rfiId is required" });
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

    const [rfi] = await db.select().from(rfis).where(eq(rfis.id, rfiId)).limit(1);
    if (!rfi) {
      res.status(404).json({ error: "RFI not found" });
      return;
    }

    if (rfi.projectId !== order.projectId) {
      res.status(400).json({ error: "RFI does not belong to the same project as this change order" });
      return;
    }

    const [updatedOrder] = await db
      .update(changeOrders)
      .set({ linkedRfiId: rfiId, updatedAt: new Date() })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    await createRevision(
      order.id,
      order.status,
      order.status,
      req.user!.id,
      `Linked to RFI ${rfi.rfiNumber}`,
      order.amount,
      { linkedRfiId: rfiId }
    );

    if (rfi.submittedById) {
      try {
        const { notifySubmitter } = await import("./services/approvalNotificationService");
        await notifySubmitter(rfi.submittedById, {
          type: "GENERAL",
          title: "RFI Linked to Change Order",
          message: `RFI ${rfi.rfiNumber} has been linked to change order ${order.changeOrderNumber}`,
          relatedEntityId: order.id,
          relatedEntityType: "changeOrder",
        });
      } catch (e) {
        console.error("Failed to notify RFI submitter:", e);
      }
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Link RFI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Order File Attachments (GCS-sidecar-backed normalized table)
// ====================

router.post("/:id/files", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project: orderProject } = result;

    const { allowed } = checkOrgAccess(req, orderProject?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const user = req.user!;
    const userId = user.id;
    const organizationId = user.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "User must belong to an organization" });
      return;
    }

    // Project-level permission: non-privileged roles may only upload if they are
    // the project superintendent, estimator, or the change order requester
    if (!["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(user.role)) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, order.projectId)).limit(1);
      if (!proj) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (proj.superintendentId !== userId && proj.estimatorId !== userId && order.requestedById !== userId) {
        res.status(403).json({ error: "You don't have permission to upload files to this change order" });
        return;
      }
    }

    const uploadSchema = z.object({
      fileName: z.string(),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      fileUrl: z.string(),
      description: z.string().optional(),
    });

    const parseResult = uploadSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten() });
      return;
    }

    const { fileName, fileSize, mimeType, fileUrl, description } = parseResult.data;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fileUrl);
    } catch {
      res.status(400).json({ error: "Invalid fileUrl" });
      return;
    }
    if (parsedUrl.protocol !== "https:") {
      res.status(400).json({ error: "fileUrl must use https" });
      return;
    }
    const blockedHosts = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|0\.0\.0\.0|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i;
    if (blockedHosts.test(parsedUrl.hostname)) {
      res.status(400).json({ error: "fileUrl must not point to an internal/private address" });
      return;
    }

    const objectUUID = randomUUID();
    const objectPath = `${organizationId}/change-orders/${req.params.id}/${objectUUID}/${fileName}`;

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
        res.status(502).json({ error: "File storage upload failed" });
        return;
      }
      const data = await response.json() as { storageKey?: string };
      storageKey = data.storageKey || objectPath;
    } catch (sidecarErr) {
      console.error("GCS sidecar unreachable:", sidecarErr);
      res.status(502).json({ error: "File storage service unavailable" });
      return;
    }

    const [dbUser] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const uploadedByName = dbUser ? `${dbUser.firstName} ${dbUser.lastName}` : user.id;

    const [newAttachment] = await db.insert(changeOrderAttachments).values({
      changeOrderId: req.params.id,
      organizationId,
      fileName,
      fileSize: fileSize ?? null,
      mimeType: mimeType ?? null,
      storageKey,
      uploadedById: user.id,
      uploadedByName,
      description: description ?? null,
    }).returning();

    await logAudit({
      userId: user.id,
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

router.get("/:id/files", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order: orderForFiles, project: orderProject } = result;

    const { allowed } = checkOrgAccess(req, orderProject?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Project-level permission: non-privileged roles may only view if they are
    // the project superintendent, estimator, or the change order requester
    const viewUser = req.user!;
    const viewUserId = viewUser.id;
    if (!["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(viewUser.role)) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, orderForFiles.projectId)).limit(1);
      if (!proj) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (proj.superintendentId !== viewUserId && proj.estimatorId !== viewUserId && orderForFiles.requestedById !== viewUserId) {
        res.status(403).json({ error: "You don't have permission to view files for this change order" });
        return;
      }
    }

    const attachments = await db
      .select()
      .from(changeOrderAttachments)
      .where(eq(changeOrderAttachments.changeOrderId, req.params.id))
      .orderBy(changeOrderAttachments.createdAt);

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();

    const result2 = await Promise.all(
      attachments.map(async (att) => {
        let fileUrl: string | null = null;
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(att.storageKey);
          const [signedUrl] = await objectFile.getSignedUrl({
            version: "v4" as const,
            action: "read" as const,
            expires: Date.now() + 60 * 60 * 1000,
          });
          fileUrl = signedUrl;
        } catch (e) {
          console.error(`Failed to get signed URL for attachment ${att.id}:`, e);
        }
        return {
          id: att.id,
          fileUrl,
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          description: att.description,
          uploadedById: att.uploadedById,
          uploadedByName: att.uploadedByName,
          uploadedAt: att.createdAt,
          storageKey: att.storageKey,
          organizationId: att.organizationId,
          changeOrderId: att.changeOrderId,
        };
      })
    );

    res.json(result2);
  } catch (error: any) {
    console.error("Get change order files error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id/files/:fileId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getChangeOrderById(req.params.id);

    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order: deleteOrder, project: orderProject } = result;

    const { allowed } = checkOrgAccess(req, orderProject?.gcOrganizationId);
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Project-level permission: non-privileged roles may only access if they are
    // the project superintendent, estimator, or the change order requester
    const deleteUser = req.user!;
    const deleteUserId = deleteUser.id;
    if (!["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(deleteUser.role)) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, deleteOrder.projectId)).limit(1);
      if (!proj) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (proj.superintendentId !== deleteUserId && proj.estimatorId !== deleteUserId && deleteOrder.requestedById !== deleteUserId) {
        res.status(403).json({ error: "You don't have permission to delete files for this change order" });
        return;
      }
    }

    const [attachment] = await db
      .select()
      .from(changeOrderAttachments)
      .where(and(
        eq(changeOrderAttachments.id, req.params.fileId),
        eq(changeOrderAttachments.changeOrderId, req.params.id)
      ))
      .limit(1);

    if (!attachment) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const user = req.user!;
    if (attachment.uploadedById !== user.id && !["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(user.role)) {
      res.status(403).json({ error: "You don't have permission to delete this file" });
      return;
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
          res.status(502).json({ error: "File storage deletion failed; attachment record not removed" });
          return;
        }
      } catch (sidecarErr) {
        console.error("GCS sidecar unreachable during delete:", sidecarErr);
        res.status(502).json({ error: "File storage service unavailable; attachment record not removed" });
        return;
      }
    }

    await db.delete(changeOrderAttachments).where(eq(changeOrderAttachments.id, req.params.fileId));

    await logAudit({
      userId: user.id,
      action: "DELETE",
      entityType: "changeOrder",
      entityId: deleteOrder.id,
      oldValue: JSON.stringify({ fileName: attachment.fileName }),
      newValue: null,
    }, req);

    res.status(204).send();
  } catch (error: any) {
    console.error("Delete change order file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
