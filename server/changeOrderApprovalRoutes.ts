/**
 * @openapi
 * /api/change-orders/{id}/approvals:
 *   get:
 *     tags: [Change Orders]
 *     summary: Get approval chain for a change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Approval chain with step statuses }
 * /api/change-orders/{id}/approve-step:
 *   post:
 *     tags: [Change Orders]
 *     summary: Approve current step in change order workflow
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
 *       200: { description: Step approved }
 * /api/change-orders/{id}/reject-step:
 *   post:
 *     tags: [Change Orders]
 *     summary: Reject current step in change order workflow
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
 *       200: { description: Step rejected }
 * /api/change-orders/{id}/setup-approval-chain:
 *   post:
 *     tags: [Change Orders]
 *     summary: Set up approval chain for a change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [steps]
 *             properties:
 *               steps: { type: array, items: { type: object } }
 *     responses:
 *       200: { description: Approval chain created }
 * /api/change-orders/{id}/link-tm:
 *   post:
 *     tags: [Change Orders]
 *     summary: Link T&M ticket to change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: T&M ticket linked }
 * /api/change-orders/{id}/link-rfi:
 *   post:
 *     tags: [Change Orders]
 *     summary: Link RFI to change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI linked }
 * /api/change-orders/{id}/link-contract:
 *   post:
 *     tags: [Change Orders]
 *     summary: Link contract to change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Contract linked }
 * /api/change-orders/{id}/files:
 *   get:
 *     tags: [Change Orders]
 *     summary: List files attached to a change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of attached files }
 *   post:
 *     tags: [Change Orders]
 *     summary: Upload a file to a change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201: { description: File uploaded }
 * /api/change-orders/{id}/files/{fileId}:
 *   delete:
 *     tags: [Change Orders]
 *     summary: Delete a file from a change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: fileId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: File deleted }
 */
import { Router, type Response , NextFunction } from "express";
import { logError } from "./utils/logger";
import { db } from "./db";
import { changeOrders, users, projects, changeOrderApprovals, changeOrderAttachments, tmTickets, rfis } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { notifySubmitter } from "./services/approvalNotificationService";
import { isValidTransition, getChangeOrderById, checkOrgAccess, notifyStatusChange, createRevision } from "./changeOrderHelpers";

const router = Router();

// ====================
// Change Order Approval Chain
// ====================

router.get("/:id/approvals", requireAuth, async (req: AuthRequest, res: Response, next) => {
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
  } catch (error) {
  next(error);
  }
});

router.post("/:id/approve-step", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
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

      try {
        const { syncApprovedCOToSOV } = await import("./aiaBillingRoutes");
        await syncApprovedCOToSOV((updatedOrder || order).id);
      } catch (syncErr) {
        logError("Auto-sync CO to SOV after step-approval:", {}, syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
      }

      res.json({ approval: updatedApproval, order: updatedOrder, allApproved: true });
    } else {
      res.json({ approval: updatedApproval, allApproved: false, remainingSteps: remainingPending.length });
    }
  } catch (error) {
  next(error);
  }
});

router.post("/:id/reject-step", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
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

    const revertStatus = isValidTransition(order.status, "PCO") ? "PCO" : "DRAFT";

    const [updatedOrder] = await db
      .update(changeOrders)
      .set({
        status: revertStatus,
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
      order.id, order.status, revertStatus, req.user!.id,
      `Rejected at step ${currentStep.stepOrder} (${currentStep.approverRole}): ${rejectionReason}`,
      order.amount, { rejectionReason, rejectedStep: currentStep.stepOrder }
    );

    await logAudit({
      userId: req.user!.id,
      action: "REJECT",
      entityType: "changeOrder",
      entityId: order.id,
      oldValue: JSON.stringify({ status: order.status }),
      newValue: JSON.stringify({ status: revertStatus, rejectionReason }),
    }, req);

    await notifyStatusChange(
      updatedOrder || order,
      revertStatus,
      `Change order ${order.changeOrderNumber} rejected at approval step: ${rejectionReason}`,
      true
    );

    res.json({ order: updatedOrder, rejectedStep: currentStep.stepOrder });
  } catch (error) {
  next(error);
  }
});

router.post("/:id/setup-approval-chain", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
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
  } catch (error) {
  next(error);
  }
});

// ====================
// Change Order Link Routes
// ====================

router.post("/:id/link-tm", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
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
        }, req.user?.organizationId);
      } catch (e) {
        logError("Failed to notify TM ticket submitter:", {}, e instanceof Error ? e : new Error(String(e)));
      }
    }

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

router.post("/:id/link-rfi", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
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
        }, req.user?.organizationId);
      } catch (e) {
        logError("Failed to notify RFI submitter", {}, e instanceof Error ? e : new Error(String(e)));
      }
    }

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

router.post("/:id/link-contract", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
  try {
    const { contractId } = req.body;
    if (!contractId || typeof contractId !== "string") {
      res.status(400).json({ error: "contractId is required" });
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

    const { contracts: contractsTable } = await import("@shared/schema");
    const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId)).limit(1);
    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    if (contract.projectId !== order.projectId) {
      res.status(400).json({ error: "Contract does not belong to the same project as this change order" });
      return;
    }

    const [updatedOrder] = await db
      .update(changeOrders)
      .set({ contractId, updatedAt: new Date() })
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    await createRevision(
      order.id,
      order.status,
      order.status,
      req.user!.id,
      `Linked to contract ${contract.contractNumber}`,
      order.amount,
      { contractId }
    );

    res.json(updatedOrder);
  } catch (error) {
  next(error);
  }
});

// ====================
// Change Order File Attachments (GCS-sidecar-backed normalized table)
// ====================

router.post("/:id/files", requireAuth, async (req: AuthRequest, res: Response, next) => {
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
    if (!["ADMIN", "MANAGER"].includes(user.role)) {
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
        logError(`GCS sidecar upload failed (${response.status}): ${errBody}`);
        res.status(502).json({ error: "File storage upload failed" });
        return;
      }
      const data = await response.json() as { storageKey?: string };
      storageKey = data.storageKey || objectPath;
    } catch (sidecarErr) {
      logError("GCS sidecar unreachable", {}, sidecarErr instanceof Error ? sidecarErr : new Error(String(sidecarErr)));
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
  } catch (error) {
  next(error);
  }
});

router.get("/:id/files", requireAuth, async (req: AuthRequest, res: Response, next) => {
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
    if (!["ADMIN", "MANAGER"].includes(viewUser.role)) {
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
          logError(`Failed to get signed URL for attachment ${att.id}`, {}, e instanceof Error ? e : new Error(String(e)));
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
  } catch (error) {
  next(error);
  }
});

router.delete("/:id/files/:fileId", requireAuth, async (req: AuthRequest, res: Response, next) => {
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
    if (!["ADMIN", "MANAGER"].includes(deleteUser.role)) {
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
    if (attachment.uploadedById !== user.id && !["ADMIN", "MANAGER"].includes(user.role)) {
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
          logError(`GCS sidecar delete failed (${delResponse.status}): ${errBody}`);
          res.status(502).json({ error: "File storage deletion failed; attachment record not removed" });
          return;
        }
      } catch (sidecarErr) {
        logError("GCS sidecar unreachable during delete", {}, sidecarErr instanceof Error ? sidecarErr : new Error(String(sidecarErr)));
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
  } catch (error) {
  next(error);
  }
});

// Add approved CO as a new SOV line item on the project's latest DRAFT SOV

export default router;
