import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getAiAuditLog, getOrgAiUsageToday } from "./services/aiGovernance";
import { getOrgId, parsePagination } from "./utils/routeHelpers";
import { logError } from "./utils/logger";

const router = Router();

router.get("/audit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { limit, offset } = parsePagination(req);
    const log = await getAiAuditLog(orgId, limit, offset);
    res.json(log);
  } catch (err) {
    logError("Failed to get AI audit log", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI audit log" });
  }
});

router.get("/usage", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const usage = await getOrgAiUsageToday(orgId);
    res.json(usage);
  } catch (err) {
    logError("Failed to get AI usage", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI usage" });
  }
});

export default router;
