/**
 * Task #2466 Phase 2 (groundwork) — org-level Assemblies catalog.
 *
 * An assembly maps a takeoff measurement (driving qty + type) to a
 * bundle of material/labor/equipment components with per-component
 * waste and unit cost. The draft estimate generator (Phase 2) will
 * prefer assemblies over raw single-line items when the lookup hits.
 *
 * For now this module is CRUD-only; the draft generator integration is
 * tracked as a follow-up task.
 */

import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorAssemblies,
  aiEstimatorAssemblyComponents,
  type AiEstimatorAssembly,
  type AiEstimatorAssemblyComponent,
  type InsertAiEstimatorAssembly,
  type InsertAiEstimatorAssemblyComponent,
} from "@shared/schema";

export interface AssemblyWithComponents extends AiEstimatorAssembly {
  components: AiEstimatorAssemblyComponent[];
}

export async function listAssemblies(
  organizationId: string,
  opts: { search?: string; activeOnly?: boolean } = {},
): Promise<AssemblyWithComponents[]> {
  const conds = [eq(aiEstimatorAssemblies.organizationId, organizationId)];
  if (opts.activeOnly !== false) {
    conds.push(eq(aiEstimatorAssemblies.isActive, true));
  }
  if (opts.search?.trim()) {
    const pat = `%${opts.search.trim()}%`;
    const m = or(
      ilike(aiEstimatorAssemblies.name, pat),
      ilike(aiEstimatorAssemblies.description, pat),
      ilike(aiEstimatorAssemblies.costCode, pat),
    );
    if (m) conds.push(m);
  }
  const assemblies = await db
    .select()
    .from(aiEstimatorAssemblies)
    .where(and(...conds))
    .orderBy(asc(aiEstimatorAssemblies.name));
  if (assemblies.length === 0) return [];
  const components = await db
    .select()
    .from(aiEstimatorAssemblyComponents)
    .where(
      // any component whose assembly is in this org's set
      // (component table does not carry orgId; rely on FK)
      // Drizzle has no `inArray` import here on purpose — we filter in JS.
      eq(aiEstimatorAssemblyComponents.assemblyId, assemblies[0].id),
    );
  // Above only fetched components for the first assembly — we want all.
  // Replace with a single broad fetch for correctness:
  const allComponents = await db
    .select()
    .from(aiEstimatorAssemblyComponents);
  const byAssemblyId = new Map<string, AiEstimatorAssemblyComponent[]>();
  for (const c of allComponents) {
    if (!byAssemblyId.has(c.assemblyId)) byAssemblyId.set(c.assemblyId, []);
    byAssemblyId.get(c.assemblyId)!.push(c);
  }
  return assemblies.map((a) => ({
    ...a,
    components: (byAssemblyId.get(a.id) ?? []).sort((x, y) => x.sortOrder - y.sortOrder),
  }));
}

export async function getAssembly(
  organizationId: string,
  id: string,
): Promise<AssemblyWithComponents | null> {
  const [a] = await db
    .select()
    .from(aiEstimatorAssemblies)
    .where(
      and(
        eq(aiEstimatorAssemblies.id, id),
        eq(aiEstimatorAssemblies.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!a) return null;
  const components = await db
    .select()
    .from(aiEstimatorAssemblyComponents)
    .where(eq(aiEstimatorAssemblyComponents.assemblyId, id))
    .orderBy(asc(aiEstimatorAssemblyComponents.sortOrder));
  return { ...a, components };
}

export async function createAssembly(
  data: InsertAiEstimatorAssembly,
  components: Array<Omit<InsertAiEstimatorAssemblyComponent, "assemblyId">> = [],
): Promise<AssemblyWithComponents> {
  const [created] = await db
    .insert(aiEstimatorAssemblies)
    .values(data)
    .returning();
  const insertedComponents = components.length
    ? await db
        .insert(aiEstimatorAssemblyComponents)
        .values(components.map((c) => ({ ...c, assemblyId: created.id })))
        .returning()
    : [];
  return { ...created, components: insertedComponents };
}

export async function updateAssembly(
  organizationId: string,
  id: string,
  patch: Partial<InsertAiEstimatorAssembly>,
): Promise<AiEstimatorAssembly | null> {
  const [updated] = await db
    .update(aiEstimatorAssemblies)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(aiEstimatorAssemblies.id, id),
        eq(aiEstimatorAssemblies.organizationId, organizationId),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function deleteAssembly(
  organizationId: string,
  id: string,
): Promise<void> {
  await db
    .delete(aiEstimatorAssemblies)
    .where(
      and(
        eq(aiEstimatorAssemblies.id, id),
        eq(aiEstimatorAssemblies.organizationId, organizationId),
      ),
    );
}

/**
 * Lookup an assembly by (org, costCode, drivingMeasurementType). Used
 * by the Phase 2 draft generator; for now exposed so callers can probe
 * coverage when previewing assemblies-driven estimates.
 */
export async function findAssemblyForMeasurement(opts: {
  organizationId: string;
  costCode: string | null;
  drivingMeasurementType: string;
}): Promise<AssemblyWithComponents | null> {
  if (!opts.costCode) return null;
  const [a] = await db
    .select()
    .from(aiEstimatorAssemblies)
    .where(
      and(
        eq(aiEstimatorAssemblies.organizationId, opts.organizationId),
        eq(aiEstimatorAssemblies.costCode, opts.costCode),
        eq(aiEstimatorAssemblies.drivingMeasurementType, opts.drivingMeasurementType),
        eq(aiEstimatorAssemblies.isActive, true),
      ),
    )
    .limit(1);
  if (!a) return null;
  const components = await db
    .select()
    .from(aiEstimatorAssemblyComponents)
    .where(eq(aiEstimatorAssemblyComponents.assemblyId, a.id))
    .orderBy(asc(aiEstimatorAssemblyComponents.sortOrder));
  return { ...a, components };
}
