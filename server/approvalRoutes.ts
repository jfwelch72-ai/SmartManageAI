import { Router } from "express";
import { requireAuth, requireOrgUser, type AuthRequest } from "./auth";
import * as approvalService from "./services/approvalService";
import { logInfo, logError } from "./utils/logger";
import { notifySubmitter } from "./services/approvalNotificationService";

const router = Router();

router.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = requireOrgUser(req, res);
    if (!orgId) return;
    const entityType = req.query.entityType as string | undefined;
    const approvals = await approvalService.getPendingApprovals(orgId, entityType);
    res.json(approvals);
  } catch (err) {
    next(err);
  }
});

router.get("/stats", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = requireOrgUser(req, res);
    if (!orgId) return;
    const stats = await approvalService.getApprovalStats(orgId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = requireOrgUser(req, res);
    if (!orgId) return;
    const approval = await approvalService.getApprovalById(req.params.id, orgId);
    if (!approval) return res.status(404).json({ error: "Not found" });
    res.json(approval);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/approve", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = requireOrgUser(req, res);
    if (!orgId) return;
    const result = await approvalService.approveRequest(req.params.id, orgId, user.id, user.role, req.body.notes);
    if (!result) return res.status(404).json({ error: "Approval not found or already decided" });

    if (result.requestedByUserId) {
      const entityLabel = (result.entityType || "Request").replace(/_/g, " ");
      await notifySubmitter(result.requestedByUserId, {
        type: "APPROVAL_REQUEST_APPROVED",
        title: "Approval Request Approved",
        message: `Your ${entityLabel} has been approved${req.body.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityId: result.entityId || req.params.id,
        relatedEntityType: result.entityType || "approval",
      }, orgId);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reject", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = requireOrgUser(req, res);
    if (!orgId) return;
    const result = await approvalService.rejectRequest(req.params.id, orgId, user.id, user.role, req.body.notes);
    if (!result) return res.status(404).json({ error: "Approval not found or already decided" });

    if (result.requestedByUserId) {
      const entityLabel = (result.entityType || "Request").replace(/_/g, " ");
      await notifySubmitter(result.requestedByUserId, {
        type: "APPROVAL_REQUEST_REJECTED",
        title: "Approval Request Rejected",
        message: `Your ${entityLabel} has been rejected${req.body.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityId: result.entityId || req.params.id,
        relatedEntityType: result.entityType || "approval",
      }, orgId);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
