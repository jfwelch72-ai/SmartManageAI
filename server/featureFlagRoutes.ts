import { Router } from "express";
import { requireAuth, requireRole } from "./auth";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "@shared/schema";
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
