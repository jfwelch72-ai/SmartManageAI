import { Router } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  costBookProviders,
  costBookEntries,
  costBookGeoFactors,
  insertCostBookProviderSchema,
  insertCostBookGeoFactorSchema,
  type CostBookProvider,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { getCostBookAdapter, applyGeoFactor } from "./services/costBook/provider";
import { logError } from "./utils/logger";

const router = Router();

function isManagement(role: string): boolean {
  return ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"].includes(role);
}

async function loadProviderForOrg(
  providerId: string,
  orgId: string,
): Promise<CostBookProvider | null> {
  const [row] = await db
    .select()
    .from(costBookProviders)
    .where(and(eq(costBookProviders.id, providerId), eq(costBookProviders.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

router.get("/api/cost-book/providers", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.json([]);
    const rows = await db
      .select()
      .from(costBookProviders)
      .where(eq(costBookProviders.organizationId, orgId))
      .orderBy(desc(costBookProviders.isActive), asc(costBookProviders.name));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/api/cost-book/providers", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }
    const parsed = insertCostBookProviderSchema.safeParse({ ...req.body, organizationId: orgId });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors });
    }
    const [created] = await db.insert(costBookProviders).values(parsed.data).returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/cost-book/providers/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }
    const provider = await loadProviderForOrg(req.params.id, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    const updateSchema = insertCostBookProviderSchema.partial().omit({ organizationId: true });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors });
    }
    const [updated] = await db
      .update(costBookProviders)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(costBookProviders.id, provider.id))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/api/cost-book/providers/:id/sync", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }
    const provider = await loadProviderForOrg(req.params.id, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    const adapter = getCostBookAdapter(provider);
    const result = await adapter.syncEntries(provider);
    await db
      .update(costBookProviders)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(costBookProviders.id, provider.id));
    res.json({ ok: true, ...result });
  } catch (err) {
    logError("cost-book sync failed", undefined, err as Error);
    next(err);
  }
});

router.get("/api/cost-book/providers/:id/entries", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.json([]);
    const provider = await loadProviderForOrg(req.params.id, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const q = String(req.query.q ?? "");
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const adapter = getCostBookAdapter(provider);
    const rows = await adapter.search(provider, q, limit);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/api/cost-book/providers/:id/geo-factors", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.json([]);
    const provider = await loadProviderForOrg(req.params.id, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const rows = await db
      .select()
      .from(costBookGeoFactors)
      .where(eq(costBookGeoFactors.providerId, provider.id))
      .orderBy(asc(costBookGeoFactors.regionName));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const geoFactorBodySchema = insertCostBookGeoFactorSchema
  .omit({ providerId: true, organizationId: true })
  .extend({
    asOfDate: z.union([z.string(), z.date()]).transform((v) =>
      typeof v === "string" ? v : v.toISOString().slice(0, 10),
    ),
    materialFactor: z.coerce.number().positive().transform((n) => n.toString()),
    laborFactor: z.coerce.number().positive().transform((n) => n.toString()),
    equipmentFactor: z.coerce.number().positive().transform((n) => n.toString()),
    totalFactor: z.coerce.number().positive().transform((n) => n.toString()),
  });

router.post("/api/cost-book/providers/:id/geo-factors", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }
    const provider = await loadProviderForOrg(req.params.id, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const parsed = geoFactorBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
    const [created] = await db
      .insert(costBookGeoFactors)
      .values({
        ...parsed.data,
        providerId: provider.id,
        organizationId: orgId,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/cost-book/providers/:id/geo-factors/:factorId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }
    const provider = await loadProviderForOrg(req.params.id, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const parsed = geoFactorBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
    const [updated] = await db
      .update(costBookGeoFactors)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(costBookGeoFactors.id, req.params.factorId),
          eq(costBookGeoFactors.providerId, provider.id),
          eq(costBookGeoFactors.organizationId, orgId),
        ),
      )
      .returning();
    if (!updated) return res.status(404).json({ error: "Geo factor not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/api/cost-book/providers/:id/geo-factors/:factorId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }
    const provider = await loadProviderForOrg(req.params.id, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const [deleted] = await db
      .delete(costBookGeoFactors)
      .where(
        and(
          eq(costBookGeoFactors.id, req.params.factorId),
          eq(costBookGeoFactors.providerId, provider.id),
          eq(costBookGeoFactors.organizationId, orgId),
        ),
      )
      .returning();
    if (!deleted) return res.status(404).json({ error: "Geo factor not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const lookupSchema = z.object({
  providerId: z.string().min(1),
  sourceCode: z.string().min(1),
  regionCode: z.string().nullish(),
  quantity: z.coerce.number().nonnegative().default(1),
});

router.get("/api/cost-book/lookup", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }
    const parsed = lookupSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
    const provider = await loadProviderForOrg(parsed.data.providerId, orgId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const adapter = getCostBookAdapter(provider);
    const result = await adapter.lookupBySourceCode(provider, parsed.data.sourceCode, parsed.data.regionCode ?? undefined);
    if (!result) return res.status(404).json({ error: "Cost-book entry not found" });
    const qty = parsed.data.quantity;
    res.json({
      provider: { id: provider.id, name: provider.name, kind: provider.providerKind },
      entry: result.entry,
      geoFactor: result.geoFactor,
      adjustedUnit: result.adjusted,
      extended: {
        materialCost: result.adjusted.materialCost * qty,
        laborCost: result.adjusted.laborCost * qty,
        equipmentCost: result.adjusted.equipmentCost * qty,
        totalCost: result.adjusted.totalCost * qty,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
export { applyGeoFactor };
