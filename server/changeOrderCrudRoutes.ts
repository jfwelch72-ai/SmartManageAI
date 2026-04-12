/**
 * @openapi
 * /api/change-orders/{id}/request-approval:
 *   post:
 *     tags: [Change Orders]
 *     summary: Request approval for a change order (legacy)
 *     description: Legacy endpoint. Submits the change order for approval. Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Approval requested }
 * /api/change-orders/{id}/submit:
 *   post:
 *     tags: [Change Orders]
 *     summary: Submit a change order
 *     description: Transitions change order to SUBMITTED status. Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Change order submitted }
 * /api/change-orders/{id}/approve:
 *   post:
 *     tags: [Change Orders]
 *     summary: Approve a change order
 *     description: Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *     responses:
 *       200: { description: Change order approved }
 * /api/change-orders/{id}/reject:
 *   post:
 *     tags: [Change Orders]
 *     summary: Reject a change order
 *     description: Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Change order rejected }
 * /api/change-orders/{id}/promote-to-review:
 *   post:
 *     tags: [Change Orders]
 *     summary: Promote PCO to review status
 *     description: Requires ADMIN, MANAGER, or ESTIMATOR role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Change order promoted to review }
 * /api/change-orders/{id}/approve-pricing:
 *   post:
 *     tags: [Change Orders]
 *     summary: Approve pricing for a change order
 *     description: Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pricing approved }
 * /api/change-orders/{id}/return-to-pco:
 *   post:
 *     tags: [Change Orders]
 *     summary: Return change order to PCO status
 *     description: Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Returned to PCO status }
 * /api/change-orders/{id}/void:
 *   post:
 *     tags: [Change Orders]
 *     summary: Void a change order
 *     description: Requires ADMIN role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Change order voided }
 * /api/change-orders/{id}/return-to-draft:
 *   post:
 *     tags: [Change Orders]
 *     summary: Return change order to draft status
 *     description: Requires ADMIN or MANAGER role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Returned to draft status }
 * /api/change-orders/{id}/revisions:
 *   get:
 *     tags: [Change Orders]
 *     summary: Get change order revision history
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of revisions }
 */
import { Router, type Request, type Response, NextFunction } from "express";
import { logError, logInfo, logWarn } from "./utils/logger";
import { eventBus } from "./events";
import { db } from "./db";
import { changeOrders, users, projects, changeOrderRevisions, changeOrderApprovals, budgetLineItems, orgCostCodes } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole, requireRoleOrFeature } from "./auth";
import { logAudit } from "./auditLogger";
import { insertNotifications } from "./services/notificationService";
import { sanitizeText } from "./sanitization";
import { createApprovalRequest } from "./services/approvalService";
import { isFeatureEnabled } from "./services/featureFlagService";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
import * as workflowEngine from "./services/workflowEngine";
import { isValidTransition, getChangeOrderById, checkOrgAccess, notifyStatusChange, createRevision } from "./changeOrderHelpers";

const router = Router();

// ====================
// Change Order State Transition Routes
// ====================

/**
 * @deprecated Legacy endpoint - use /submit instead
 * For backward compatibility, this now redirects to SUBMITTED status directly
 * Also handles migrating any existing PENDING_APPROVAL records to SUBMITTED
 */
router.post("/:id/request-approval", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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
      } catch (e) { logError("[changeOrder] approval request failed:", {}, e instanceof Error ? e : new Error(String(e))); }
    }

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

/**
 * Submit a change order to client
 * DRAFT -> SUBMITTED (simplified workflow)
 */
router.post("/:id/submit", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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
      logError("Failed to auto-bootstrap approval chain:", {}, approvalErr instanceof Error ? approvalErr : new Error(String(approvalErr)));
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

    if (project?.gcOrganizationId) {
      try {
        await workflowEngine.startWorkflow(
          project.gcOrganizationId,
          "CHANGE_ORDER",
          order.id,
          req.user!.id
        );
      } catch (e) { logError("[changeOrder] workflow start failed:", {}, e instanceof Error ? e : new Error(String(e))); }
    }

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

/**
 * Approve a change order
 * SUBMITTED -> APPROVED (simplified workflow)
 */
router.post("/:id/approve", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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

    if (project?.gcOrganizationId) {
      const delegation = await workflowEngine.delegateEntityTransition(
        project.gcOrganizationId,
        "CHANGE_ORDER",
        order.id,
        req.user!.id,
        req.user!.role || "WORKER",
        "APPROVED",
        "Approved via change order action"
      );
      if (delegation.delegated) {
        if (delegation.needsMoreApprovals) {
          res.status(202).json({ message: delegation.error, needsMoreApprovals: true });
          return;
        }
        if (!delegation.success) {
          res.status(400).json({ error: delegation.error || "Workflow transition failed" });
          return;
        }
      }
    }

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

    if (updatedOrder.costCodeId && project) {
      try {
        const [costCode] = await db.select().from(orgCostCodes)
          .where(and(eq(orgCostCodes.id, updatedOrder.costCodeId), eq(orgCostCodes.organizationId, project.gcOrganizationId)))
          .limit(1);
        if (costCode) {
          const coAmount = Number(updatedOrder.amount || 0);
          const [existing] = await db.select().from(budgetLineItems)
            .where(and(
              eq(budgetLineItems.projectId, project.id),
              eq(budgetLineItems.costCode, costCode.code)
            ))
            .limit(1);
          if (existing) {
            const newOther = Number(existing.otherBudget) + coAmount;
            const newTotal = Number(existing.laborBudget) + Number(existing.materialBudget) + Number(existing.subcontractorBudget) + Number(existing.equipmentBudget) + newOther;
            await db.update(budgetLineItems)
              .set({ otherBudget: String(newOther), totalBudget: String(newTotal), updatedAt: new Date() })
              .where(eq(budgetLineItems.id, existing.id));
          } else {
            await db.insert(budgetLineItems).values({
              projectId: project.id,
              costCode: costCode.code,
              description: `${costCode.description} (CO: ${updatedOrder.changeOrderNumber})`,
              division: costCode.division,
              otherBudget: String(coAmount),
              totalBudget: String(coAmount),
            });
          }
        }
      } catch (ledgerError) {
        logError("Failed to update cost ledger for approved CO:", {}, ledgerError instanceof Error ? ledgerError : new Error(String(ledgerError)));
      }
    }

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
              inArray(users.role, ["ADMIN", "MANAGER"]),
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
      logError("Failed to create CO approval billing notification:", {}, notifError instanceof Error ? notifError : new Error(String(notifError)));
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

    if (updatedOrder.contractId) {
      const { contracts: contractsTable, contractVersions: contractVersionsTable } = await import("@shared/schema");
      const [linkedContract] = await db.select().from(contractsTable).where(eq(contractsTable.id, updatedOrder.contractId));
      if (linkedContract && ["EXECUTED", "APPROVED", "AMENDED"].includes(linkedContract.status)) {
        const currentValue = Number(linkedContract.contractValue || 0);
        const coAmount = Number(updatedOrder.amount || 0);
        const newValue = (currentValue + coAmount).toFixed(2);

        const [updatedContract] = await db.update(contractsTable)
          .set({ contractValue: newValue, status: "AMENDED" as const, updatedAt: new Date() })
          .where(eq(contractsTable.id, updatedOrder.contractId))
          .returning();

        if (updatedContract) {
          await db.update(projects)
            .set({ contractAmount: newValue, updatedAt: new Date() })
            .where(eq(projects.id, updatedOrder.projectId));

          const newVersion = (updatedContract.currentVersion || 0) + 1;
          await db.update(contractsTable)
            .set({ currentVersion: newVersion })
            .where(eq(contractsTable.id, updatedOrder.contractId));
          await db.insert(contractVersionsTable).values({
            contractId: updatedOrder.contractId,
            versionNumber: newVersion,
            snapshotJson: JSON.stringify({ ...updatedContract, currentVersion: newVersion }),
            changedById: req.user!.id,
            changeNote: `Contract amended via approved CO #${updatedOrder.changeOrderNumber}: value ${currentValue} → ${newValue}`,
          });

          logInfo(`[CO Finalized] Updated contract ${linkedContract.contractNumber} and project value: ${currentValue} + ${coAmount} = ${newValue}`);
        } else {
          logWarn(`[CO Finalized] Contract update returned no rows for ${updatedOrder.contractId}`);
        }
      }
    }

    try {
      const { syncApprovedCOToSOV } = await import("./aiaBillingRoutes");
      await syncApprovedCOToSOV(updatedOrder.id);
    } catch (syncErr) {
      logError("Auto-sync CO to SOV after approval:", {}, syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
    }

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

/**
 * Reject a change order
 * Any non-terminal state -> REJECTED
 */
router.post("/:id/reject", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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

    if (project?.gcOrganizationId) {
      const delegation = await workflowEngine.delegateEntityTransition(
        project.gcOrganizationId,
        "CHANGE_ORDER",
        order.id,
        req.user!.id,
        req.user!.role || "WORKER",
        "REJECTED",
        rejectionReason
      );
      if (delegation.delegated) {
        if (delegation.needsMoreApprovals) {
          res.status(202).json({ message: delegation.error, needsMoreApprovals: true });
          return;
        }
        if (!delegation.success) {
          res.status(400).json({ error: delegation.error || "Workflow transition failed" });
          return;
        }
      }
    }

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
  } catch (error) {
  next(error);
  }
});

/**
 * Promote a PCO to pricing review
 * PCO -> PRICING_REVIEW
 */
router.post("/:id/promote-to-review", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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
      } catch (e) { logError("[changeOrder] pricing review notification failed:", {}, e instanceof Error ? e : new Error(String(e))); }
    }

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

/**
 * Approve pricing and submit to client
 * PRICING_REVIEW -> SUBMITTED
 */
router.post("/:id/approve-pricing", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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
        }, orgId);
      } catch (e) { logError("[changeOrder] submitter notification failed:", {}, e instanceof Error ? e : new Error(String(e))); }
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
  } catch (error) {
  next(error);
  }
});

/**
 * Return a change order from pricing review back to PCO
 * PRICING_REVIEW -> PCO
 */
router.post("/:id/return-to-pco", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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
  } catch (error) {
  next(error);
  }
});

/**
 * Void an approved change order
 * APPROVED -> VOIDED
 */
router.post("/:id/void", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response, next) => {
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
          organizationId: orgId,
          type: "GENERAL" as const,
          title: "Change Order Voided",
          message: `CO ${updatedOrder.changeOrderNumber} that you approved has been voided: ${voidReason}`,
          relatedEntityId: updatedOrder.id,
          relatedEntityType: "changeOrder" as const,
        }]);
      } catch (e) { logError("[changeOrder] void notification failed:", {}, e instanceof Error ? e : new Error(String(e))); }
    }

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

/**
 * Return a change order to draft for revision
 * PENDING_APPROVAL -> DRAFT or SUBMITTED -> DRAFT or REJECTED -> DRAFT
 */
router.post("/:id/return-to-draft", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res: Response, next) => {
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

    if (order.status !== "SUBMITTED") {
      res.status(400).json({ 
        error: `Cannot return to draft from ${order.status} status. Only SUBMITTED change orders can be returned.` 
      });
      return;
    }

    if (order.approvedAt) {
      res.status(400).json({ 
        error: "Cannot return to draft after client has responded." 
      });
      return;
    }

    const targetStatus = isValidTransition(order.status, "PCO") ? "PCO" : 
                         isValidTransition(order.status, "DRAFT") ? "DRAFT" : null;
    if (!targetStatus) {
      res.status(400).json({ 
        error: `Cannot return to draft from ${order.status} status` 
      });
      return;
    }

    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: targetStatus as "DRAFT" | "PCO" | "PRICING_REVIEW" | "SUBMITTED" | "APPROVED" | "REJECTED" | "VOIDED",
        submittedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    await createRevision(order.id, order.status, targetStatus, req.user!.id, reason ? `Returned to draft: ${reason}` : "Returned to draft for revision", order.amount, reason ? { reason } : undefined);

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: targetStatus, reason }),
    }, req);

    await notifyStatusChange(
      updatedOrder,
      targetStatus,
      `Change order ${updatedOrder.changeOrderNumber} has been returned to draft${reason ? `: ${reason}` : ""}`,
      true
    );

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

// ====================
// Change Order Revision History
// ====================

router.get("/:id/revisions", requireAuth, async (req: AuthRequest, res: Response, next) => {
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
  } catch (error) {
  next(error);
  }
});


export default router;
