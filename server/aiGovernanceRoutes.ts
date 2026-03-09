import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getAiAuditLog, getOrgLimitsWithUsage, getCostBreakdownByActionType } from "./services/aiGovernance";
import { getOrgId, parsePagination } from "./utils/routeHelpers";
import { logError } from "./utils/logger";

const router = Router();

function parseDateRange(req: any): { dateFrom?: Date; dateTo?: Date } {
  const range = req.query.dateRange as string | undefined;
  if (!range || range === "all") return {};
  const now = new Date();
  const dateTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let dateFrom: Date;
  switch (range) {
    case "today":
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      break;
    case "week":
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
      break;
    case "month":
      dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 0, 0, 0, 0);
      break;
    default:
      return {};
  }
  return { dateFrom, dateTo };
}

router.get("/audit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { limit, offset } = parsePagination(req);
    const { dateFrom, dateTo } = parseDateRange(req);
    const result = await getAiAuditLog(orgId, limit, offset, dateFrom, dateTo);
    res.json(result);
  } catch (err) {
    logError("Failed to get AI audit log", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI audit log" });
  }
});

router.get("/usage", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const data = await getOrgLimitsWithUsage(orgId);
    res.json(data);
  } catch (err) {
    logError("Failed to get AI usage", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI usage" });
  }
});

router.get("/cost-breakdown", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { dateFrom, dateTo } = parseDateRange(req);
    const breakdown = await getCostBreakdownByActionType(orgId, dateFrom, dateTo);
    res.json(breakdown);
  } catch (err) {
    logError("Failed to get cost breakdown", { error: String(err) });
    res.status(500).json({ error: "Failed to get cost breakdown" });
  }
});

export default router;
