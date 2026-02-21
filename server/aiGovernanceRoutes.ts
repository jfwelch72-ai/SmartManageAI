import { Router } from "express";
import { requireAuth } from "./auth";
import { getAiAuditLog, getOrgAiUsageToday } from "./services/aiGovernance";
import { logError } from "./utils/logger";

const router = Router();

router.get("/audit", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const log = await getAiAuditLog(user.organizationId, limit, offset);
    res.json(log);
  } catch (err) {
    logError("Failed to get AI audit log", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI audit log" });
  }
});

router.get("/usage", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const usage = await getOrgAiUsageToday(user.organizationId);
    res.json(usage);
  } catch (err) {
    logError("Failed to get AI usage", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI usage" });
  }
});

export default router;
