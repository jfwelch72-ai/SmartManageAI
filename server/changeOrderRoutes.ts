import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { changeOrders, insertChangeOrderSchema, users, notifications, projects } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

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

  // Notify admins and managers when a change order is submitted
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
