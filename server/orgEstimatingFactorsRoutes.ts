// Task #2576 — Org-level estimating factors settings.
//
// GET  /api/org/estimating-factors      — current values for the org
// PUT  /api/org/estimating-factors      — update; audit-logged
// POST /api/estimates/:id/factors-override — pin per-estimate override
// DELETE /api/estimates/:id/factors-override — clear override

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { estimates, bids, projects } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgFactors, upsertOrgFactors } from "./services/aiEstimator/orgFactors";
import {
  applyOrgFactors,
  normalizeFactors,
  type EstimatingFactors,
} from "./services/aiEstimator/orgFactorsApply";
import { logAudit } from "./auditLogger";
import { logError } from "./utils/logger";

const router = Router();

// Tenant-isolation guard: returns the estimate row only if it
// belongs to the caller's organization (via its parent bid or
// project). Returns null otherwise so the caller can 404.
async function getEstimateForOrg(
  estimateId: string,
  orgId: string,
): Promise<typeof estimates.$inferSelect | null> {
  const [est] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!est) return null;
  if (est.bidId) {
    const [b] = await db
      .select({ orgId: bids.gcOrganizationId })
      .from(bids)
      .where(eq(bids.id, est.bidId))
      .limit(1);
    if (b?.orgId !== orgId) return null;
    return est;
  }
  if (est.projectId) {
    const [p] = await db
      .select({ orgId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, est.projectId))
      .limit(1);
    if (p?.orgId !== orgId) return null;
    return est;
  }
  return null;
}

const factorsSchema = z.object({
  laborBurdenPercent: z.number().min(0).max(1).optional(),
  smallToolsPercent: z.number().min(0).max(1).optional(),
  overheadPercent: z.number().min(0).max(1).optional(),
  profitPercent: z.number().min(0).max(1).optional(),
  bondPercent: z.number().min(0).max(1).optional(),
  escalationPercent: z.number().min(0).max(1).optional(),
  wasteFactorPercent: z.number().min(0).max(1).optional(),
});

function pickFactors(row: Record<string, unknown>): EstimatingFactors {
  return normalizeFactors({
    laborBurdenPercent: row.laborBurdenPercent,
    smallToolsPercent: row.smallToolsPercent,
    overheadPercent: row.overheadPercent,
    profitPercent: row.profitPercent,
    bondPercent: row.bondPercent,
    escalationPercent: row.escalationPercent,
    // `default_waste_factor` is the org-wide default; per-category
    // overrides still live in `wasteFactorsByCategory` and win when
    // present.
    wasteFactorPercent: row.defaultWasteFactor,
  });
}

router.get(
  "/api/org/estimating-factors",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const row = await getOrgFactors(orgId);
      res.json({ ...pickFactors(row as unknown as Record<string, unknown>), updatedAt: row.updatedAt });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/api/org/estimating-factors",
  requireAuth,
  // Org-wide trust settings — restricted to org administrators.
  // ESTIMATOR can author per-estimate overrides (see below) but not
  // mutate the org default that every estimate inherits.
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = factorsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const previous = await getOrgFactors(orgId);
      const oldFactors = pickFactors(previous as unknown as Record<string, unknown>);

      // Translate the public field name → DB column name for the
      // org-wide default waste column.
      const { wasteFactorPercent, ...rest } = parsed.data;
      const dbPatch = {
        ...rest,
        ...(wasteFactorPercent !== undefined ? { defaultWasteFactor: wasteFactorPercent } : {}),
      };
      const updated = await upsertOrgFactors(orgId, dbPatch, req.user!.id);
      const newFactors = pickFactors(updated as unknown as Record<string, unknown>);

      try {
        await logAudit(
          {
            userId: req.user!.id,
            entityType: "org_estimating_factors",
            entityId: orgId,
            action: "UPDATE",
            oldValue: JSON.stringify(oldFactors),
            newValue: JSON.stringify(newFactors),
          },
          req,
        );
      } catch (auditErr) {
        logError("Audit write failed for org_estimating_factors", {}, auditErr instanceof Error ? auditErr : new Error(String(auditErr)));
      }

      res.json({ ...newFactors, updatedAt: updated.updatedAt });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/api/estimates/:id/factors-override",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = factorsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const existing = await getEstimateForOrg(req.params.id, orgId);
      if (!existing) return res.status(404).json({ error: "Estimate not found" });

      const newOverride = normalizeFactors(parsed.data);
      const [updated] = await db
        .update(estimates)
        .set({ estimatingFactorsOverride: newOverride, updatedAt: new Date() })
        .where(eq(estimates.id, req.params.id))
        .returning();

      try {
        await logAudit(
          {
            userId: req.user!.id,
            entityType: "estimate_factors_override",
            entityId: req.params.id,
            action: "UPDATE",
            oldValue: existing.estimatingFactorsOverride
              ? JSON.stringify(existing.estimatingFactorsOverride)
              : null,
            newValue: JSON.stringify(newOverride),
          },
          req,
        );
      } catch (auditErr) {
        logError("Audit write failed for estimate_factors_override", {}, auditErr instanceof Error ? auditErr : new Error(String(auditErr)));
      }

      res.json({ override: updated.estimatingFactorsOverride });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/api/estimates/:id/factors-override",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const existing = await getEstimateForOrg(req.params.id, orgId);
      if (!existing) return res.status(404).json({ error: "Estimate not found" });

      await db
        .update(estimates)
        .set({ estimatingFactorsOverride: null, updatedAt: new Date() })
        .where(eq(estimates.id, req.params.id));

      try {
        await logAudit(
          {
            userId: req.user!.id,
            entityType: "estimate_factors_override",
            entityId: req.params.id,
            action: "DELETE",
            oldValue: existing.estimatingFactorsOverride
              ? JSON.stringify(existing.estimatingFactorsOverride)
              : null,
            newValue: null,
          },
          req,
        );
      } catch {
        /* best-effort audit */
      }

      res.json({ override: null });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/estimates/:id/totals — recompute totals applying the per-
 * estimate override (or the org default) on top of the line-item costs.
 */
router.get(
  "/api/estimates/:id/totals",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const estimate = await getEstimateForOrg(req.params.id, orgId);
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      const { estimateLineItems } = await import("@shared/schema");
      const lines = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, req.params.id));

      const breakdown = lines.reduce(
        (acc, l) => ({
          materialCost: acc.materialCost + Number(l.materialCost),
          laborCost: acc.laborCost + Number(l.laborCost),
          equipmentCost: acc.equipmentCost + Number(l.equipmentCost),
          consumablesCost: acc.consumablesCost + Number(l.consumablesCost),
          subcontractCost: acc.subcontractCost + Number(l.subcontractCost),
        }),
        { materialCost: 0, laborCost: 0, equipmentCost: 0, consumablesCost: 0, subcontractCost: 0 },
      );

      let factorsRaw: unknown = estimate.estimatingFactorsOverride;
      let source: "estimate_override" | "org_default" = "estimate_override";
      if (!factorsRaw) {
        const orgRow = await getOrgFactors(orgId);
        factorsRaw = pickFactors(orgRow as unknown as Record<string, unknown>);
        source = "org_default";
      }
      const totals = applyOrgFactors(
        breakdown,
        factorsRaw as Partial<Record<keyof EstimatingFactors, unknown>>,
      );
      res.json({ totals, source });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
