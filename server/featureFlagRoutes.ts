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
    const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const kind =
      kindParam === "apply" || kindParam === "reset_drift" ? kindParam : undefined;
    const tradeTypeParam = typeof req.query.tradeType === "string" ? req.query.tradeType.trim() : "";
    const tradeType = tradeTypeParam && (tradeTypeEnum.enumValues as readonly string[]).includes(tradeTypeParam)
      ? tradeTypeParam
      : undefined;
    const appliedByIdParam = typeof req.query.appliedById === "string" ? req.query.appliedById.trim() : "";
    const appliedById = appliedByIdParam || undefined;
    const history = await flagService.listPresetApplications(
      req.params.orgId,
      page,
      pageSize,
      kind,
      tradeType,
      appliedById,
    );
    res.json(history);
  } catch (err) {
    next(err);
  }
});

router.get("/:orgId/preset-history-filters", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN" && (user.role !== "ADMIN" || user.organizationId !== req.params.orgId)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const options = await flagService.getPresetHistoryFilterOptions(req.params.orgId);
    res.json(options);
  } catch (err) {
    next(err);
  }
});

router.get("/:orgId/manual-flag-changes", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN" && (user.role !== "ADMIN" || user.organizationId !== req.params.orgId)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
    const history = await flagService.listManualFlagChanges(req.params.orgId, page, pageSize);
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
      const updated = await flagService.setFeatureFlag(req.params.orgId, flag as FeatureFlagKey, enabled, user.id);
      return res.json({ flags: updated });
    }

    if (req.body.flags && typeof req.body.flags === "object") {
      const incoming = req.body.flags as Record<string, unknown>;
      const cleaned: Partial<Record<FeatureFlagKey, boolean>> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (!FEATURE_FLAG_KEYS.includes(k as FeatureFlagKey)) {
          return res.status(400).json({ error: `Invalid flag: ${k}` });
        }
        if (typeof v !== "boolean") {
          return res.status(400).json({ error: `Flag ${k} must be a boolean` });
        }
        cleaned[k as FeatureFlagKey] = v;
      }
      const updated = await flagService.setAllFeatureFlags(req.params.orgId, cleaned);
      return res.json({ flags: updated });
    }

    res.status(400).json({ error: "Provide { flag, enabled } or { flags: {...} }" });
  } catch (err) {
    next(err);
  }
});

router.post("/:orgId/reset-drift", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (
      user.role !== "SUPER_ADMIN" &&
      (user.role !== "ADMIN" || user.organizationId !== req.params.orgId)
    ) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const last = await flagService.getLastPresetApplication(req.params.orgId);
    if (!last) {
      return res
        .status(400)
        .json({ error: "No preset has been applied to this organization yet" });
    }
    if (!last.diff || last.diff.length === 0) {
      return res.json({ flags: await flagService.getFeatureFlags(req.params.orgId), reset: [] });
    }

    const drifted: Record<string, { current: boolean; preset: boolean }> = {};
    for (const d of last.diff) drifted[d.key] = { current: d.current, preset: d.preset };

    const body = (req.body ?? {}) as { keys?: unknown; all?: unknown };
    let targetKeys: FeatureFlagKey[];

    if (body.all === true) {
      targetKeys = Array.from(new Set(last.diff.map((d) => d.key))).sort() as FeatureFlagKey[];
    } else if (Array.isArray(body.keys)) {
      const requested = body.keys;
      const cleaned: FeatureFlagKey[] = [];
      for (const k of requested) {
        if (typeof k !== "string") {
          return res.status(400).json({ error: "keys must be strings" });
        }
        if (!FEATURE_FLAG_KEYS.includes(k as FeatureFlagKey)) {
          return res.status(400).json({ error: `Invalid flag: ${k}` });
        }
        if (!(k in drifted)) {
          return res
            .status(400)
            .json({ error: `Flag ${k} is not currently drifted from the preset` });
        }
        cleaned.push(k as FeatureFlagKey);
      }
      // Dedupe + sort so duplicate-key payloads don't bloat the audit row's
      // flag_keys array with repeats (per code review on Task #1314).
      targetKeys = Array.from(new Set(cleaned)).sort() as FeatureFlagKey[];
    } else {
      return res
        .status(400)
        .json({ error: "Provide { keys: [...] } or { all: true }" });
    }

    if (targetKeys.length === 0) {
      return res.json({ flags: await flagService.getFeatureFlags(req.params.orgId), reset: [] });
    }

    const patch: Partial<Record<FeatureFlagKey, boolean>> = {};
    for (const k of targetKeys) patch[k] = drifted[k].preset;

    const updated = await flagService.setAllFeatureFlags(req.params.orgId, patch);

    // Task #1314 — record a drift-reset audit row so admins can see
    // "who reset which flags to the preset" inline with full preset
    // applications in the Preset history card. The trade of the preset the
    // org was reset toward is the trade recorded on the most recent
    // "apply" audit row (carried on `last`).
    await flagService.recordPresetDriftReset(
      req.params.orgId,
      last.tradeType,
      targetKeys,
      user.id,
    );

    res.json({ flags: updated, reset: targetKeys });
  } catch (err) {
    next(err);
  }
});

export default router;
