import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  estimatingCrewTemplates,
  estimatingCrewTemplateWorkers,
  estimatingCrewTemplateEquipment,
  insertEstimatingCrewTemplateSchema,
  insertEstimatingCrewWorkerSchema,
  insertEstimatingCrewEquipmentSchema,
  type EstimatingCrewTemplate,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

function isManagement(role: string): boolean {
  return ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"].includes(role);
}

async function loadTemplateForOrg(id: string, orgId: string): Promise<EstimatingCrewTemplate | null> {
  const [row] = await db
    .select()
    .from(estimatingCrewTemplates)
    .where(and(eq(estimatingCrewTemplates.id, id), eq(estimatingCrewTemplates.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * Compute a crew template's cost-per-day and roll-ups for a given # of days.
 * Used both by the API and by line-item attachment to populate
 * laborCost / equipmentCost when a template is bound.
 */
export function computeCrewDailyCost(
  workers: Array<{ count: number; hourlyRate: string | number; burdenPercent: string | number }>,
  equipment: Array<{ count: number; dailyRate: string | number; fuelCostPerDay: string | number }>,
  hoursPerDay: number,
) {
  let laborPerDay = 0;
  for (const w of workers) {
    const rate = Number(w.hourlyRate ?? 0);
    const burden = Number(w.burdenPercent ?? 0) / 100;
    laborPerDay += w.count * rate * hoursPerDay * (1 + burden);
  }
  let equipmentPerDay = 0;
  for (const e of equipment) {
    equipmentPerDay += e.count * (Number(e.dailyRate ?? 0) + Number(e.fuelCostPerDay ?? 0));
  }
  return {
    laborCostPerDay: laborPerDay,
    equipmentCostPerDay: equipmentPerDay,
    totalCostPerDay: laborPerDay + equipmentPerDay,
  };
}

router.get("/api/estimating-crew-templates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.json([]);
    const rows = await db
      .select()
      .from(estimatingCrewTemplates)
      .where(eq(estimatingCrewTemplates.organizationId, orgId))
      .orderBy(asc(estimatingCrewTemplates.code));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/api/estimating-crew-templates/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const template = await loadTemplateForOrg(req.params.id, orgId);
    if (!template) return res.status(404).json({ error: "Crew template not found" });
    const workers = await db
      .select()
      .from(estimatingCrewTemplateWorkers)
      .where(eq(estimatingCrewTemplateWorkers.crewTemplateId, template.id));
    const equipment = await db
      .select()
      .from(estimatingCrewTemplateEquipment)
      .where(eq(estimatingCrewTemplateEquipment.crewTemplateId, template.id));
    const cost = computeCrewDailyCost(workers, equipment, Number(template.defaultHoursPerDay ?? 8));
    res.json({ template, workers, equipment, cost });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  template: insertEstimatingCrewTemplateSchema.omit({ organizationId: true }),
  workers: z.array(insertEstimatingCrewWorkerSchema.omit({ crewTemplateId: true })).default([]),
  equipment: z.array(insertEstimatingCrewEquipmentSchema.omit({ crewTemplateId: true })).default([]),
});

router.post("/api/estimating-crew-templates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

    const [created] = await db.insert(estimatingCrewTemplates).values({
      ...parsed.data.template,
      organizationId: orgId,
      createdByUserId: req.user!.id,
    }).returning();

    if (parsed.data.workers.length > 0) {
      await db.insert(estimatingCrewTemplateWorkers).values(
        parsed.data.workers.map((w) => ({ ...w, crewTemplateId: created.id })),
      );
    }
    if (parsed.data.equipment.length > 0) {
      await db.insert(estimatingCrewTemplateEquipment).values(
        parsed.data.equipment.map((e) => ({ ...e, crewTemplateId: created.id })),
      );
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  template: insertEstimatingCrewTemplateSchema.partial().omit({ organizationId: true }).optional(),
  workers: z.array(insertEstimatingCrewWorkerSchema.omit({ crewTemplateId: true })).optional(),
  equipment: z.array(insertEstimatingCrewEquipmentSchema.omit({ crewTemplateId: true })).optional(),
});

router.patch("/api/estimating-crew-templates/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const template = await loadTemplateForOrg(req.params.id, orgId);
    if (!template) return res.status(404).json({ error: "Crew template not found" });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

    if (parsed.data.template) {
      await db
        .update(estimatingCrewTemplates)
        .set({ ...parsed.data.template, updatedAt: new Date() })
        .where(eq(estimatingCrewTemplates.id, template.id));
    }
    if (parsed.data.workers) {
      await db.delete(estimatingCrewTemplateWorkers).where(eq(estimatingCrewTemplateWorkers.crewTemplateId, template.id));
      if (parsed.data.workers.length > 0) {
        await db.insert(estimatingCrewTemplateWorkers).values(
          parsed.data.workers.map((w) => ({ ...w, crewTemplateId: template.id })),
        );
      }
    }
    if (parsed.data.equipment) {
      await db.delete(estimatingCrewTemplateEquipment).where(eq(estimatingCrewTemplateEquipment.crewTemplateId, template.id));
      if (parsed.data.equipment.length > 0) {
        await db.insert(estimatingCrewTemplateEquipment).values(
          parsed.data.equipment.map((e) => ({ ...e, crewTemplateId: template.id })),
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/api/estimating-crew-templates/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const template = await loadTemplateForOrg(req.params.id, orgId);
    if (!template) return res.status(404).json({ error: "Crew template not found" });
    await db.delete(estimatingCrewTemplates).where(eq(estimatingCrewTemplates.id, template.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
