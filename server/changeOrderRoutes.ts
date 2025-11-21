import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { changeOrders, insertChangeOrderSchema, users, notifications } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { sanitizeText } from "./sanitization";

const router = Router();

// Valid state transitions for change orders
// Enforces strict workflow: DRAFT → PENDING_APPROVAL → SUBMITTED → APPROVED/REJECTED
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL"],  // Must request approval first
  PENDING_APPROVAL: ["DRAFT", "SUBMITTED"],  // Can return to draft or submit to client
  SUBMITTED: ["DRAFT", "APPROVED", "REJECTED"],  // Client approves/rejects or return for revision
  APPROVED: [],  // Terminal state - no further transitions
  REJECTED: ["DRAFT"],  // Can be revised and resubmitted
};

/**
 * Validates if a state transition is allowed
 */
function isValidTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

/**
 * Gets a change order by ID with validation
 */
async function getChangeOrderById(id: string) {
  const [order] = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.id, id))
    .limit(1);
  
  return order;
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
  const dbClient = tx || db;
  const notificationsToCreate: any[] = [];

  // Always notify the requester
  if (notifyRequestedBy) {
    notificationsToCreate.push({
      userId: order.requestedById,
      type: "GENERAL" as const,
      title: `Change Order ${newStatus}`,
      message,
      relatedEntityId: order.id,
      relatedEntityType: "changeOrder",
    });
  }

  // Notify admins and managers for pending approvals
  if (newStatus === "PENDING_APPROVAL") {
    const adminsAndManagers = await dbClient
      .select()
      .from(users)
      .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);

    adminsAndManagers.forEach(user => {
      notificationsToCreate.push({
        userId: user.id,
        type: "CHANGE_ORDER_PENDING" as const,
        title: "Change Order Pending Approval",
        message: `Change order ${order.changeOrderNumber} requires approval`,
        relatedEntityId: order.id,
        relatedEntityType: "changeOrder",
      });
    });
  }

  if (notificationsToCreate.length > 0) {
    await dbClient.insert(notifications).values(notificationsToCreate);
  }
}

// ====================
// Change Order State Transition Routes
// ====================

/**
 * Request approval for a change order
 * DRAFT -> PENDING_APPROVAL
 */
router.post("/:id/request-approval", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const order = await getChangeOrderById(req.params.id);

    if (!order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    // Only requester, admins, or managers can request approval
    if (req.user!.id !== order.requestedById && 
        req.user!.role !== "ADMIN" && 
        req.user!.role !== "MANAGER") {
      res.status(403).json({ error: "You don't have permission to modify this change order" });
      return;
    }

    if (!isValidTransition(order.status, "PENDING_APPROVAL")) {
      res.status(400).json({ 
        error: `Cannot transition from ${order.status} to PENDING_APPROVAL` 
      });
      return;
    }

    // Use transaction to ensure atomic status update + audit + notification
    const updatedOrder = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(changeOrders)
        .set({
          status: "PENDING_APPROVAL",
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      // Audit log within transaction - pass tx for atomicity
      await logAudit({
        userId: req.user!.id,
        action: "SUBMIT",
        entityType: "changeOrder",
        entityId: order.id,
        oldValue: JSON.stringify({ status: order.status }),
        newValue: JSON.stringify({ status: "PENDING_APPROVAL" }),
      }, req, tx);

      // Notify relevant users within transaction - pass tx for atomicity
      await notifyStatusChange(
        updated,
        "PENDING_APPROVAL",
        `Change order ${updated.changeOrderNumber} is now pending approval`,
        false,  // Don't notify requester as they initiated it
        tx
      );

      return updated;
    });

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Request approval error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Submit a change order to client
 * PENDING_APPROVAL -> SUBMITTED or DRAFT -> SUBMITTED
 */
router.post("/:id/submit", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const order = await getChangeOrderById(req.params.id);

    if (!order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    if (!isValidTransition(order.status, "SUBMITTED")) {
      res.status(400).json({ 
        error: `Cannot transition from ${order.status} to SUBMITTED` 
      });
      return;
    }

    // Use transaction to ensure atomic status update + audit + notification
    const updatedOrder = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(changeOrders)
        .set({
          status: "SUBMITTED",
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      // Audit log within transaction - pass tx for atomicity
      await logAudit({
        userId: req.user!.id,
        action: "SUBMIT",
        entityType: "changeOrder",
        entityId: order.id,
        oldValue: JSON.stringify({ status: order.status }),
        newValue: JSON.stringify({ status: "SUBMITTED" }),
      }, req, tx);

      // Notify requester within transaction - pass tx for atomicity
      await notifyStatusChange(
        updated,
        "SUBMITTED",
        `Change order ${updated.changeOrderNumber} has been submitted to client`,
        true,
        tx
      );

      return updated;
    });

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Submit change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Approve a change order
 * SUBMITTED -> APPROVED or PENDING_APPROVAL -> APPROVED
 */
router.post("/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const order = await getChangeOrderById(req.params.id);

    if (!order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    if (!isValidTransition(order.status, "APPROVED")) {
      res.status(400).json({ 
        error: `Cannot approve from ${order.status} status. Change order must be SUBMITTED first.` 
      });
      return;
    }

    // Use transaction to ensure atomic approval + audit + notification
    const updatedOrder = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(changeOrders)
        .set({
          status: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      // Audit log within transaction - pass tx for atomicity
      await logAudit({
        userId: req.user!.id,
        action: "APPROVE",
        entityType: "changeOrder",
        entityId: order.id,
        oldValue: JSON.stringify({ status: order.status }),
        newValue: JSON.stringify({ status: "APPROVED", approvedById: req.user!.id }),
      }, req, tx);

      // Notify requester within transaction - pass tx for atomicity
      await notifyStatusChange(
        updated,
        "APPROVED",
        `Change order ${updated.changeOrderNumber} has been approved`,
        true,
        tx
      );

      return updated;
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

    const order = await getChangeOrderById(req.params.id);

    if (!order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    if (!isValidTransition(order.status, "REJECTED")) {
      res.status(400).json({ 
        error: `Cannot reject from ${order.status} status` 
      });
      return;
    }

    // Use transaction to ensure atomic rejection + audit + notification
    const updatedOrder = await db.transaction(async (tx) => {
      const [updated] = await tx
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

      // Audit log within transaction - pass tx for atomicity
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
      }, req, tx);

      // Notify requester within transaction - pass tx for atomicity
      await notifyStatusChange(
        updated,
        "REJECTED",
        `Change order ${updated.changeOrderNumber} has been rejected: ${rejectionReason}`,
        true,
        tx
      );

      return updated;
    });

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

    const order = await getChangeOrderById(req.params.id);

    if (!order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    if (!isValidTransition(order.status, "DRAFT")) {
      res.status(400).json({ 
        error: `Cannot return to draft from ${order.status} status` 
      });
      return;
    }

    // Use transaction to ensure atomic status update + audit + notification
    const updatedOrder = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(changeOrders)
        .set({
          status: "DRAFT",
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      // Audit log within transaction - pass tx for atomicity
      await logAudit({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "changeOrder",
        entityId: order.id,
        oldValue: JSON.stringify({ status: order.status }),
        newValue: JSON.stringify({ status: "DRAFT", reason }),
      }, req, tx);

      // Notify requester within transaction - note: tx is the 5th parameter, notifyRequestedBy=true is 4th
      await notifyStatusChange(
        updated,
        "DRAFT",
        `Change order ${updated.changeOrderNumber} has been returned to draft${reason ? `: ${reason}` : ""}`,
        true, // notifyRequestedBy
        tx // transaction parameter
      );

      return updated;
    });

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Return to draft error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
