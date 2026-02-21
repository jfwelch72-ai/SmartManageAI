import { Router } from "express";
import { requireAuth } from "./auth";
import * as healthService from "./services/projectHealthService";
import { logError } from "./utils/logger";

const router = Router();

router.get("/overview", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const overview = await healthService.getOrgHealthOverview(user.organizationId);
    res.json(overview);
  } catch (err) {
    logError("Failed to get health overview", { error: String(err) });
    res.status(500).json({ error: "Failed to get health overview" });
  }
});

router.get("/:projectId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const snapshot = await healthService.getLatestSnapshot(user.organizationId, req.params.projectId);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "Failed to get health score" });
  }
});

router.post("/:projectId/compute", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const breakdown = await healthService.computeProjectHealth(user.organizationId, req.params.projectId);
    const snapshot = await healthService.saveHealthSnapshot(user.organizationId, req.params.projectId, breakdown);
    res.json({ breakdown, snapshot });
  } catch (err) {
    logError("Failed to compute health score", { error: String(err) });
    res.status(500).json({ error: "Failed to compute health score" });
  }
});

router.get("/:projectId/history", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const limit = parseInt(req.query.limit as string) || 30;
    const history = await healthService.getSnapshotHistory(user.organizationId, req.params.projectId, limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Failed to get health history" });
  }
});

export default router;
