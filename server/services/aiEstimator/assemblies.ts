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

import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
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
  // Task #2624 — Org-scoped fetch via inArray on the assembly id set
  // we already filtered by orgId above. Avoids the prior broad
  // unscoped select.
  const allComponents = await db
    .select()
    .from(aiEstimatorAssemblyComponents)
    .where(inArray(aiEstimatorAssemblyComponents.assemblyId, assemblies.map((a) => a.id)));
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

// =====================================================================
// Task #2624 — Fuzzy matcher used by the auto-takeoff drafters.
//
// AI-emitted measurements rarely include a clean cost code, so the
// strict (org, costCode, drivingMeasurementType) lookup used by the
// estimate drafter doesn't fire often enough. This matcher scores
// every active org assembly against an AI line by:
//   - drivingMeasurementType matches the line type           (required)
//   - drivingUnit matches the line unit (case-insensitive)   (required)
//   - tradeType matches when both sides supply one           (+3)
//   - costCode equals when both sides supply one             (+5)
//   - name / description token overlap with the line label   (+1 per token)
//
// Returns the best assembly above the score threshold or null.
// Pure-data version (`scoreAssemblyAgainstLine`) is exported for unit
// tests so the matcher can be exercised without a DB.
// =====================================================================

const STOPWORDS = new Set([
  "the","a","an","and","or","of","to","for","with","in","on","at","by",
  "is","are","be","this","that","these","those","from","into","per",
]);

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export interface AssemblyMatchLine {
  label: string;
  type: "AREA" | "LINEAR" | "COUNT" | "VOLUME" | string;
  unit: string;
  costCode?: string | null;
  tradeType?: string | null;
}

export interface AssemblyMatchScore {
  assemblyId: string;
  score: number;
  reasons: string[];
}

const MATCH_SCORE_THRESHOLD = 2;

export function scoreAssemblyAgainstLine(
  assembly: Pick<
    AiEstimatorAssembly,
    "id" | "name" | "description" | "costCode" | "tradeType" | "drivingMeasurementType" | "drivingUnit"
  >,
  line: AssemblyMatchLine,
): AssemblyMatchScore | null {
  if (
    String(assembly.drivingMeasurementType ?? "").toUpperCase() !==
    String(line.type ?? "").toUpperCase()
  ) {
    return null;
  }
  if (
    String(assembly.drivingUnit ?? "").trim().toUpperCase() !==
    String(line.unit ?? "").trim().toUpperCase()
  ) {
    return null;
  }
  let score = 0;
  const reasons: string[] = ["unit+type"];
  if (
    assembly.costCode &&
    line.costCode &&
    assembly.costCode.trim().toLowerCase() === line.costCode.trim().toLowerCase()
  ) {
    score += 5;
    reasons.push("costCode");
  }
  if (
    assembly.tradeType &&
    line.tradeType &&
    assembly.tradeType.trim().toUpperCase() === line.tradeType.trim().toUpperCase()
  ) {
    score += 3;
    reasons.push("tradeType");
  }
  const lineTokens = new Set(tokenize(line.label));
  const haystack = new Set([
    ...tokenize(assembly.name),
    ...tokenize(assembly.description),
  ]);
  let overlap = 0;
  for (const t of haystack) {
    if (lineTokens.has(t)) overlap += 1;
  }
  if (overlap > 0) {
    score += overlap;
    reasons.push(`tokens:${overlap}`);
  }
  if (score < MATCH_SCORE_THRESHOLD) return null;
  return { assemblyId: assembly.id, score, reasons };
}

export async function matchAssemblyForLine(opts: {
  organizationId: string;
  line: AssemblyMatchLine;
}): Promise<AssemblyWithComponents | null> {
  const candidates = await listAssemblies(opts.organizationId, { activeOnly: true });
  if (candidates.length === 0) return null;
  let best: { score: AssemblyMatchScore; assembly: AssemblyWithComponents } | null = null;
  for (const a of candidates) {
    const sc = scoreAssemblyAgainstLine(a, opts.line);
    if (!sc) continue;
    if (!best || sc.score > best.score.score) {
      best = { score: sc, assembly: a };
    }
  }
  return best?.assembly ?? null;
}
