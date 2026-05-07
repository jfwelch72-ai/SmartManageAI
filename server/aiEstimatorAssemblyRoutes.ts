// Task #2576 — AI Estimator assemblies catalog HTTP surface +
// "explode into estimate line items" endpoint.
//
// The legacy `assemblyRoutes.ts` covers the older `takeoffAssemblies`
// catalog used by the takeoff workspace. This module exposes the
// newer `ai_estimator_assemblies` catalog used by the AI draft
// generator, plus the manual `POST /api/estimates/:id/explode-assembly`
// endpoint that the bid-estimate UI calls when a user picks an
// assembly off the catalog.

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { estimates, takeoffMeasurements, takeoffSheets, bids, projects } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import {
  listAssemblies,
  getAssembly,
  findAssemblyForMeasurement,
} from "./services/aiEstimator/assemblies";
import { persistExplodedLines } from "./services/aiEstimator/explodeAssembly";
import { logAudit } from "./auditLogger";
import { logError } from "./utils/logger";

const router = Router();

router.get(
  "/api/ai-estimator/assemblies",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const assemblies = await listAssemblies(orgId, { search });
      res.json({ assemblies });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/api/ai-estimator/assemblies/:id",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const assembly = await getAssembly(orgId, req.params.id);
      if (!assembly) return res.status(404).json({ error: "Assembly not found" });
      res.json(assembly);
    } catch (err) {
      next(err);
    }
  },
);

const explodeSchema = z.object({
  measurementId: z.string().min(1),
  assemblyId: z.string().min(1),
});

interface OwnedContext {
  orgId: string;
  bidId: string | null;
  projectId: string | null;
}

async function resolveEstimateContext(estimateId: string): Promise<OwnedContext | null> {
  const [estimate] = await db
    .select({ bidId: estimates.bidId, projectId: estimates.projectId })
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!estimate) return null;
  if (estimate.bidId) {
    const [b] = await db
      .select({ orgId: bids.gcOrganizationId })
      .from(bids)
      .where(eq(bids.id, estimate.bidId))
      .limit(1);
    if (!b?.orgId) return null;
    return { orgId: b.orgId, bidId: estimate.bidId, projectId: estimate.projectId ?? null };
  }
  if (estimate.projectId) {
    const [p] = await db
      .select({ orgId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, estimate.projectId))
      .limit(1);
    if (!p?.orgId) return null;
    return { orgId: p.orgId, bidId: null, projectId: estimate.projectId };
  }
  return null;
}

async function resolveMeasurementContext(measurementId: string): Promise<OwnedContext | null> {
  const [m] = await db
    .select({ sheetId: takeoffMeasurements.sheetId })
    .from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.id, measurementId))
    .limit(1);
  if (!m) return null;
  const [s] = await db
    .select({ bidId: takeoffSheets.bidId, projectId: takeoffSheets.projectId })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.id, m.sheetId))
    .limit(1);
  if (!s) return null;
  if (s.bidId) {
    const [b] = await db.select({ orgId: bids.gcOrganizationId }).from(bids).where(eq(bids.id, s.bidId)).limit(1);
    if (!b?.orgId) return null;
    return { orgId: b.orgId, bidId: s.bidId, projectId: s.projectId ?? null };
  }
  if (s.projectId) {
    const [p] = await db.select({ orgId: projects.gcOrganizationId }).from(projects).where(eq(projects.id, s.projectId)).limit(1);
    if (!p?.orgId) return null;
    return { orgId: p.orgId, bidId: null, projectId: s.projectId };
  }
  return null;
}

router.post(
  "/api/estimates/:id/explode-assembly",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = explodeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const [estCtx, mCtx] = await Promise.all([
        resolveEstimateContext(req.params.id),
        resolveMeasurementContext(parsed.data.measurementId),
      ]);
      if (!estCtx || estCtx.orgId !== orgId) {
        return res.status(404).json({ error: "Estimate not found" });
      }
      if (!mCtx || mCtx.orgId !== orgId) {
        return res.status(404).json({ error: "Measurement not found" });
      }
      // Same-tenant is necessary but not sufficient — the measurement
      // must also belong to the SAME bid (or, for project-scoped
      // estimates, the same project) as the estimate. Otherwise an
      // estimator could explode a measurement from bid A into the
      // estimate for bid B inside the same org.
      const sameBid = estCtx.bidId !== null && estCtx.bidId === mCtx.bidId;
      const sameProject =
        estCtx.bidId === null && estCtx.projectId !== null && estCtx.projectId === mCtx.projectId;
      if (!sameBid && !sameProject) {
        return res.status(400).json({
          error: "Measurement does not belong to this estimate's bid or project",
        });
      }

      const assembly = await getAssembly(orgId, parsed.data.assemblyId);
      if (!assembly) return res.status(404).json({ error: "Assembly not found" });

      const result = await persistExplodedLines({
        estimateId: req.params.id,
        measurementId: parsed.data.measurementId,
        assembly,
        components: assembly.components,
      });

      try {
        await logAudit(
          {
            userId: req.user!.id,
            entityType: "estimate_assembly_explode",
            entityId: req.params.id,
            action: "CREATE",
            oldValue: null,
            newValue: JSON.stringify({
              assemblyId: assembly.id,
              measurementId: parsed.data.measurementId,
              insertedCount: result.insertedCount,
              totalCost: result.totalCost,
            }),
          },
          req,
        );
      } catch (auditErr) {
        logError(
          "Audit write failed for estimate_assembly_explode",
          {},
          auditErr instanceof Error ? auditErr : new Error(String(auditErr)),
        );
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/api/ai-estimator/assemblies/find-for-measurement",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const schema = z.object({
        costCode: z.string().nullable().optional(),
        drivingMeasurementType: z.string(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const a = await findAssemblyForMeasurement({
        organizationId: orgId,
        costCode: parsed.data.costCode ?? null,
        drivingMeasurementType: parsed.data.drivingMeasurementType,
      });
      res.json({ assembly: a });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
