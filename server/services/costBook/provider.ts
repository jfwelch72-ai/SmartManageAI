/**
 * Task #2578 Phase C — External cost-book provider abstraction.
 *
 * Pluggable interface so per-org configuration can pick RSMeans-equivalent,
 * Craftsman-equivalent, or a custom internal book without changing route
 * code. Each provider is responsible for fetching unit costs, geo factors,
 * and crew compositions; the seam is intentionally narrow so a real
 * RSMeans/Compass adapter can drop in by swapping the resolver.
 */

import type { CostBookEntry, CostBookGeoFactor, CostBookProvider } from "@shared/schema";
import { builtInProvider } from "./builtInProvider";

export interface CostBookLookupResult {
  entry: CostBookEntry;
  geoFactor: CostBookGeoFactor | null;
  /** Adjusted unit costs after geo factors are applied. */
  adjusted: {
    materialCost: number;
    laborCost: number;
    equipmentCost: number;
    totalCost: number;
    geoFactorTotal: number;
  };
}

export interface CostBookProviderAdapter {
  kind: string;
  /** Sync entries for this org. Returns the # of entries upserted. */
  syncEntries(provider: CostBookProvider): Promise<{ entries: number; geoFactors: number }>;
  /** Resolve a single entry by source code. */
  lookupBySourceCode(
    provider: CostBookProvider,
    sourceCode: string,
    regionCode?: string | null,
  ): Promise<CostBookLookupResult | null>;
  /** Search entries (description / csi / code) for picker UIs. */
  search(
    provider: CostBookProvider,
    query: string,
    limit?: number,
  ): Promise<CostBookEntry[]>;
}

const adapters: Record<string, CostBookProviderAdapter> = {
  BUILTIN: builtInProvider,
};

export function registerCostBookAdapter(kind: string, adapter: CostBookProviderAdapter): void {
  adapters[kind] = adapter;
}

export function getCostBookAdapter(provider: CostBookProvider): CostBookProviderAdapter {
  return adapters[provider.providerKind] ?? builtInProvider;
}

/**
 * Apply geo factors to a base cost-book entry. Returns the adjusted
 * material/labor/equipment/total split. When no geo factor is provided
 * the base costs are returned untouched (factor=1.0).
 */
export function applyGeoFactor(
  entry: CostBookEntry,
  geo: CostBookGeoFactor | null,
): CostBookLookupResult["adjusted"] {
  const mat = Number(entry.materialCost ?? 0);
  const lab = Number(entry.laborCost ?? 0);
  const eq = Number(entry.equipmentCost ?? 0);
  const matFactor = geo ? Number(geo.materialFactor ?? 1) : 1;
  const labFactor = geo ? Number(geo.laborFactor ?? 1) : 1;
  const eqFactor = geo ? Number(geo.equipmentFactor ?? 1) : 1;
  const totalFactor = geo ? Number(geo.totalFactor ?? 1) : 1;
  const adjMat = mat * matFactor;
  const adjLab = lab * labFactor;
  const adjEq = eq * eqFactor;
  const adjTotal = adjMat + adjLab + adjEq;
  return {
    materialCost: adjMat,
    laborCost: adjLab,
    equipmentCost: adjEq,
    totalCost: adjTotal,
    geoFactorTotal: totalFactor,
  };
}
