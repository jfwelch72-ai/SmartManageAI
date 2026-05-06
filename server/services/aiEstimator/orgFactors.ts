/**
 * Task #2466 Phase 2 (groundwork) — org-level estimating factors.
 *
 * Stores the configurable inputs the Phase 2 draft generator will
 * automatically apply: waste % per material category, productivity
 * overrides per cost code, city cost index, and a default prevailing-
 * wage flag. Single row per organization; auto-created on first read.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorOrgFactors,
  type AiEstimatorOrgFactors,
  type InsertAiEstimatorOrgFactors,
} from "@shared/schema";

export type WasteFactorsByCategory = Record<string, number>;
export type ProductivityOverrides = Record<
  string,
  { unit: string; perHour: number }
>;

export async function getOrgFactors(
  organizationId: string,
): Promise<AiEstimatorOrgFactors> {
  const [row] = await db
    .select()
    .from(aiEstimatorOrgFactors)
    .where(eq(aiEstimatorOrgFactors.organizationId, organizationId))
    .limit(1);
  if (row) return row;
  const [created] = await db
    .insert(aiEstimatorOrgFactors)
    .values({ organizationId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Conflict (concurrent insert) — re-read.
  const [rePicked] = await db
    .select()
    .from(aiEstimatorOrgFactors)
    .where(eq(aiEstimatorOrgFactors.organizationId, organizationId))
    .limit(1);
  return rePicked!;
}

export async function upsertOrgFactors(
  organizationId: string,
  patch: Partial<Omit<InsertAiEstimatorOrgFactors, "organizationId">>,
  changedById?: string,
): Promise<AiEstimatorOrgFactors> {
  const existing = await getOrgFactors(organizationId);
  const [updated] = await db
    .update(aiEstimatorOrgFactors)
    .set({
      ...patch,
      updatedById: changedById ?? existing.updatedById,
      updatedAt: new Date(),
    })
    .where(eq(aiEstimatorOrgFactors.id, existing.id))
    .returning();
  return updated;
}
