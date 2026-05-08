/**
 * Task #2627 — Per-org region factor CRUD.
 *
 * Region factors are named multipliers (1.0 = national avg) applied
 * to learned-rate values when surfaced to estimators on a project
 * tagged to that region. Archived rows (`isActive=false`) are kept
 * for historical reference but are hidden from active selection.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorRegionFactors,
  bids,
  projects,
  type AiEstimatorRegionFactor,
  type InsertAiEstimatorRegionFactor,
} from "@shared/schema";

export async function listRegionFactors(
  organizationId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<AiEstimatorRegionFactor[]> {
  const rows = await db
    .select()
    .from(aiEstimatorRegionFactors)
    .where(eq(aiEstimatorRegionFactors.organizationId, organizationId))
    .orderBy(aiEstimatorRegionFactors.name);
  if (opts.includeArchived) return rows;
  return rows.filter((r) => r.isActive);
}

export async function getRegionFactor(
  organizationId: string,
  id: string,
): Promise<AiEstimatorRegionFactor | null> {
  const [row] = await db
    .select()
    .from(aiEstimatorRegionFactors)
    .where(
      and(
        eq(aiEstimatorRegionFactors.organizationId, organizationId),
        eq(aiEstimatorRegionFactors.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createRegionFactor(
  values: InsertAiEstimatorRegionFactor,
): Promise<AiEstimatorRegionFactor> {
  const [row] = await db
    .insert(aiEstimatorRegionFactors)
    .values(values)
    .returning();
  return row;
}

export async function updateRegionFactor(
  organizationId: string,
  id: string,
  patch: Partial<Omit<InsertAiEstimatorRegionFactor, "organizationId">>,
  updatedById?: string,
): Promise<AiEstimatorRegionFactor | null> {
  const [row] = await db
    .update(aiEstimatorRegionFactors)
    .set({
      ...patch,
      updatedById: updatedById ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiEstimatorRegionFactors.organizationId, organizationId),
        eq(aiEstimatorRegionFactors.id, id),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteRegionFactor(
  organizationId: string,
  id: string,
): Promise<void> {
  await db
    .delete(aiEstimatorRegionFactors)
    .where(
      and(
        eq(aiEstimatorRegionFactors.organizationId, organizationId),
        eq(aiEstimatorRegionFactors.id, id),
      ),
    );
}

/**
 * Apply a region multiplier to a numeric rate value. Returns the
 * input untouched when the multiplier is missing or invalid (defensive
 * — callers should never see a NaN). Production-rate metric is also
 * adjusted because a higher cost-of-living region typically reflects
 * tighter labor markets and slower output, and unit_cost / labor_hours
 * naturally scale with the regional cost index.
 */
export function applyRegionMultiplier(
  value: number | null,
  multiplier: number | null | undefined,
): number | null {
  if (value == null) return null;
  const m = typeof multiplier === "number" ? multiplier : Number(multiplier);
  if (!Number.isFinite(m) || m <= 0) return value;
  return value * m;
}

/**
 * Resolve the active region multiplier + region row for a given bid.
 * Walks bid → project → region_factor row, returning `{ multiplier:
 * 1, region: null }` when the project has no region tagged or the
 * referenced region row was archived/deleted.
 */
export async function resolveRegionForBid(
  organizationId: string,
  bidId: string | null | undefined,
): Promise<{ multiplier: number; region: AiEstimatorRegionFactor | null }> {
  if (!bidId) return { multiplier: 1, region: null };
  const [row] = await db
    .select({
      regionFactorId: projects.regionFactorId,
    })
    .from(bids)
    .innerJoin(projects, eq(projects.id, bids.convertedToProjectId))
    .where(and(eq(bids.id, bidId), eq(bids.gcOrganizationId, organizationId)))
    .limit(1);
  if (!row?.regionFactorId) return { multiplier: 1, region: null };
  const region = await getRegionFactor(organizationId, row.regionFactorId);
  if (!region || !region.isActive) return { multiplier: 1, region: null };
  return { multiplier: region.multiplier, region };
}
