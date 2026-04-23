import { Router } from "express";
import { requireAuth, requireRole } from "./auth";
import { FEATURE_FLAG_KEYS, tradeTypeEnum, type FeatureFlagKey } from "@shared/schema";
import * as flagService from "./services/featureFlagService";
import { logError } from "./utils/logger";

const router = Router();

router.get("/", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "HUSTLER"), async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }
    const flags = await flagService.getFeatureFlags(user.organizationId);
    res.json({ flags, keys: FEATURE_FLAG_KEYS });
  } catch (err) {
    next(err);
  }
});

router.get("/:orgId", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "SUPER_ADMIN access required" });
    }
    const flags = await flagService.getFeatureFlags(req.params.orgId);
    res.json({ flags, keys: FEATURE_FLAG_KEYS });
  } catch (err) {
    next(err);
  }
});

router.post("/:orgId/apply-preset", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN" && (user.role !== "ADMIN" || user.organizationId !== req.params.orgId)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { tradeType } = req.body || {};
    if (!tradeType || typeof tradeType !== "string") {
      return res.status(400).json({ error: "tradeType is required" });
    }
    if (!(tradeTypeEnum.enumValues as readonly string[]).includes(tradeType)) {
      return res.status(400).json({ error: `Invalid tradeType: ${tradeType}` });
    }
    const updated = await flagService.applyTradePreset(req.params.orgId, tradeType, user.id);
    res.json({ flags: updated });
  } catch (err) {
    next(err);
  }
});

router.get("/:orgId/last-preset", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN" && (user.role !== "ADMIN" || user.organizationId !== req.params.orgId)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const last = await flagService.getLastPresetApplication(req.params.orgId);
    res.json({ lastApplied: last });
  } catch (err) {
    next(err);
  }
});

router.get("/:orgId/preset-history", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN" && (user.role !== "ADMIN" || user.organizationId !== req.params.orgId)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
    const history = await flagService.listPresetApplications(req.params.orgId, page, pageSize);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

router.patch("/:orgId", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "SUPER_ADMIN access required" });
    }

    const { flag, enabled } = req.body;

    if (flag && typeof enabled === "boolean") {
      if (!FEATURE_FLAG_KEYS.includes(flag as FeatureFlagKey)) {
        return res.status(400).json({ error: `Invalid flag: ${flag}` });
      }
      const updated = await flagService.setFeatureFlag(req.params.orgId, flag as FeatureFlagKey, enabled);
      return res.json({ flags: updated });
    }

    if (req.body.flags && typeof req.body.flags === "object") {
      const updated = await flagService.setAllFeatureFlags(req.params.orgId, req.body.flags);
      return res.json({ flags: updated });
    }

    res.status(400).json({ error: "Provide { flag, enabled } or { flags: {...} }" });
  } catch (err) {
    next(err);
  }
});

export default router;
