import { Router } from "express";
import { requireAuth } from "./auth";
import * as approvalService from "./services/approvalService";
import { logInfo, logError } from "./utils/logger";
import { notifySubmitter } from "./services/approvalNotificationService";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const entityType = req.query.entityType as string | undefined;
    const approvals = await approvalService.getPendingApprovals(user.organizationId, entityType);
    res.json(approvals);
  } catch (err) {
    logError("Failed to list approvals", { error: String(err) });
    res.status(500).json({ error: "Failed to list approvals" });
  }
});

router.get("/stats", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const stats = await approvalService.getApprovalStats(user.organizationId);
    res.json(stats);
  } catch (err) {
    logError("Failed to get approval stats", { error: String(err) });
    res.status(500).json({ error: "Failed to get approval stats" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const approval = await approvalService.getApprovalById(req.params.id, user.organizationId);
    if (!approval) return res.status(404).json({ error: "Not found" });
    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: "Failed to get approval" });
  }
});

router.post("/:id/approve", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const result = await approvalService.approveRequest(req.params.id, user.organizationId, user.id, user.role, req.body.notes);
    if (!result) return res.status(404).json({ error: "Approval not found or already decided" });

    if (result.requestedByUserId) {
      const entityLabel = (result.entityType || "Request").replace(/_/g, " ");
      await notifySubmitter(result.requestedByUserId, {
        type: "APPROVAL_REQUEST_APPROVED",
        title: "Approval Request Approved",
        message: `Your ${entityLabel} has been approved${req.body.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityId: result.entityId || req.params.id,
        relatedEntityType: result.entityType || "approval",
      });
    }

    res.json(result);
  } catch (err) {
    logError("Failed to approve", { error: String(err) });
    res.status(500).json({ error: "Failed to approve" });
  }
});

router.post("/:id/reject", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const result = await approvalService.rejectRequest(req.params.id, user.organizationId, user.id, user.role, req.body.notes);
    if (!result) return res.status(404).json({ error: "Approval not found or already decided" });

    if (result.requestedByUserId) {
      const entityLabel = (result.entityType || "Request").replace(/_/g, " ");
      await notifySubmitter(result.requestedByUserId, {
        type: "APPROVAL_REQUEST_REJECTED",
        title: "Approval Request Rejected",
        message: `Your ${entityLabel} has been rejected${req.body.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityId: result.entityId || req.params.id,
        relatedEntityType: result.entityType || "approval",
      });
    }

    res.json(result);
  } catch (err) {
    logError("Failed to reject", { error: String(err) });
    res.status(500).json({ error: "Failed to reject" });
  }
});

export default router;
