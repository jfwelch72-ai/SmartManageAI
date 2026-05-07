/**
 * Task #2578 — Built-in cost-book provider (RSMeans-equivalent seed).
 *
 * Ships a small canonical seed catalog so the feature works out of the
 * box without an external API key. Real RSMeans/Compass adapters can
 * register via registerCostBookAdapter().
 */

import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import {
  costBookEntries,
  costBookGeoFactors,
  type CostBookEntry,
  type CostBookProvider,
} from "@shared/schema";
import type { CostBookProviderAdapter, CostBookLookupResult } from "./provider";
import { applyGeoFactor } from "./provider";

interface SeedEntry {
  sourceCode: string;
  csiDivision: string;
  description: string;
  unit: string;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  laborHours?: number;
  crewCode?: string;
}

const SEED_AS_OF = "2025-01-01";

const SEED_ENTRIES: SeedEntry[] = [
  { sourceCode: "033053500250", csiDivision: "03 30 53", description: "Concrete, ready-mix, 4000 PSI, slab", unit: "CY", materialCost: 165.0, laborCost: 35.0, equipmentCost: 8.0, laborHours: 0.95, crewCode: "C-14C" },
  { sourceCode: "033053500300", csiDivision: "03 30 53", description: "Concrete, ready-mix, 5000 PSI, slab", unit: "CY", materialCost: 185.0, laborCost: 35.0, equipmentCost: 8.0, laborHours: 0.95, crewCode: "C-14C" },
  { sourceCode: "033010600100", csiDivision: "03 30 10", description: "Reinforcing steel, in slabs, #4 to #7", unit: "TON", materialCost: 1450.0, laborCost: 720.0, equipmentCost: 30.0, laborHours: 16, crewCode: "C-4" },
  { sourceCode: "031113200120", csiDivision: "03 11 13", description: "Forms, slab on grade, edge form, 4 use", unit: "LF", materialCost: 0.55, laborCost: 2.95, equipmentCost: 0, laborHours: 0.07, crewCode: "C-1" },
  { sourceCode: "312316130200", csiDivision: "31 23 16", description: "Excavation, bulk, common earth, 1 CY bucket", unit: "CY", materialCost: 0, laborCost: 1.55, equipmentCost: 4.05, laborHours: 0.04, crewCode: "B-12C" },
  { sourceCode: "321216130100", csiDivision: "32 12 16", description: "Asphalt paving, 1.5\" overlay, 25 ton truck", unit: "SY", materialCost: 6.85, laborCost: 1.10, equipmentCost: 0.85, laborHours: 0.025, crewCode: "B-25" },
  { sourceCode: "321713230100", csiDivision: "32 17 13", description: "Pavement marking, 4\" line, latex paint", unit: "LF", materialCost: 0.06, laborCost: 0.18, equipmentCost: 0.03, laborHours: 0.005, crewCode: "B-78" },
  { sourceCode: "260519100020", csiDivision: "26 05 19", description: "Wire, copper, THHN, #12, in conduit", unit: "LF", materialCost: 0.42, laborCost: 0.75, equipmentCost: 0, laborHours: 0.018, crewCode: "1-ELEC" },
  { sourceCode: "092900100100", csiDivision: "09 29 00", description: "Drywall, 5/8\" Type X, hung, taped, finished", unit: "SF", materialCost: 0.55, laborCost: 1.35, equipmentCost: 0, laborHours: 0.030, crewCode: "2-CARP" },
  { sourceCode: "081113200200", csiDivision: "08 11 13", description: "Steel door, hollow metal, 3'-0\" x 7'-0\", primed", unit: "EA", materialCost: 285.0, laborCost: 95.0, equipmentCost: 0, laborHours: 1.6, crewCode: "1-CARP" },
];

interface SeedGeo {
  regionCode: string;
  regionName: string;
  city?: string;
  state?: string;
  materialFactor: number;
  laborFactor: number;
  equipmentFactor: number;
  totalFactor: number;
}

const SEED_GEO: SeedGeo[] = [
  { regionCode: "US-NAT", regionName: "National Average", materialFactor: 1.000, laborFactor: 1.000, equipmentFactor: 1.000, totalFactor: 1.000 },
  { regionCode: "US-NYC", regionName: "New York, NY", city: "New York", state: "NY", materialFactor: 1.045, laborFactor: 1.380, equipmentFactor: 1.060, totalFactor: 1.245 },
  { regionCode: "US-LA", regionName: "Los Angeles, CA", city: "Los Angeles", state: "CA", materialFactor: 1.020, laborFactor: 1.250, equipmentFactor: 1.040, totalFactor: 1.150 },
  { regionCode: "US-CHI", regionName: "Chicago, IL", city: "Chicago", state: "IL", materialFactor: 1.010, laborFactor: 1.200, equipmentFactor: 1.030, totalFactor: 1.115 },
  { regionCode: "US-HOU", regionName: "Houston, TX", city: "Houston", state: "TX", materialFactor: 0.985, laborFactor: 0.870, equipmentFactor: 0.990, totalFactor: 0.925 },
  { regionCode: "US-MIA", regionName: "Miami, FL", city: "Miami", state: "FL", materialFactor: 0.995, laborFactor: 0.840, equipmentFactor: 0.985, totalFactor: 0.910 },
  { regionCode: "US-DEN", regionName: "Denver, CO", city: "Denver", state: "CO", materialFactor: 0.990, laborFactor: 0.950, equipmentFactor: 1.000, totalFactor: 0.965 },
  { regionCode: "US-SEA", regionName: "Seattle, WA", city: "Seattle", state: "WA", materialFactor: 1.025, laborFactor: 1.120, equipmentFactor: 1.045, totalFactor: 1.075 },
];

async function syncEntries(provider: CostBookProvider) {
  let entryCount = 0;
  for (const seed of SEED_ENTRIES) {
    const total = seed.materialCost + seed.laborCost + seed.equipmentCost;
    const existing = await db
      .select({ id: costBookEntries.id })
      .from(costBookEntries)
      .where(and(
        eq(costBookEntries.providerId, provider.id),
        eq(costBookEntries.sourceCode, seed.sourceCode),
      ))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(costBookEntries)
        .set({
          description: seed.description,
          csiDivision: seed.csiDivision,
          unit: seed.unit,
          materialCost: String(seed.materialCost),
          laborCost: String(seed.laborCost),
          equipmentCost: String(seed.equipmentCost),
          totalCost: String(total),
          laborHours: seed.laborHours != null ? String(seed.laborHours) : null,
          crewCode: seed.crewCode ?? null,
          asOfDate: SEED_AS_OF,
          updatedAt: new Date(),
        })
        .where(eq(costBookEntries.id, existing[0].id));
    } else {
      await db.insert(costBookEntries).values({
        providerId: provider.id,
        organizationId: provider.organizationId,
        sourceCode: seed.sourceCode,
        csiDivision: seed.csiDivision,
        description: seed.description,
        unit: seed.unit,
        baseRegion: "National Average",
        materialCost: String(seed.materialCost),
        laborCost: String(seed.laborCost),
        equipmentCost: String(seed.equipmentCost),
        totalCost: String(total),
        laborHours: seed.laborHours != null ? String(seed.laborHours) : null,
        crewCode: seed.crewCode ?? null,
        asOfDate: SEED_AS_OF,
      });
    }
    entryCount += 1;
  }

  let geoCount = 0;
  for (const geo of SEED_GEO) {
    const existing = await db
      .select({ id: costBookGeoFactors.id })
      .from(costBookGeoFactors)
      .where(and(
        eq(costBookGeoFactors.providerId, provider.id),
        eq(costBookGeoFactors.regionCode, geo.regionCode),
      ))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(costBookGeoFactors)
        .set({
          regionName: geo.regionName,
          city: geo.city ?? null,
          state: geo.state ?? null,
          materialFactor: String(geo.materialFactor),
          laborFactor: String(geo.laborFactor),
          equipmentFactor: String(geo.equipmentFactor),
          totalFactor: String(geo.totalFactor),
          asOfDate: SEED_AS_OF,
          updatedAt: new Date(),
        })
        .where(eq(costBookGeoFactors.id, existing[0].id));
    } else {
      await db.insert(costBookGeoFactors).values({
        providerId: provider.id,
        organizationId: provider.organizationId,
        regionCode: geo.regionCode,
        regionName: geo.regionName,
        city: geo.city ?? null,
        state: geo.state ?? null,
        materialFactor: String(geo.materialFactor),
        laborFactor: String(geo.laborFactor),
        equipmentFactor: String(geo.equipmentFactor),
        totalFactor: String(geo.totalFactor),
        asOfDate: SEED_AS_OF,
      });
    }
    geoCount += 1;
  }

  return { entries: entryCount, geoFactors: geoCount };
}

async function lookupBySourceCode(
  provider: CostBookProvider,
  sourceCode: string,
  regionCode?: string | null,
): Promise<CostBookLookupResult | null> {
  const [entry] = await db
    .select()
    .from(costBookEntries)
    .where(and(
      eq(costBookEntries.providerId, provider.id),
      eq(costBookEntries.sourceCode, sourceCode),
    ))
    .limit(1);
  if (!entry) return null;

  const geo = regionCode ? await loadGeo(provider.id, regionCode) : null;
  const adjusted = applyGeoFactor(entry, geo);
  return { entry, geoFactor: geo, adjusted };
}

async function loadGeo(providerId: string, regionCode: string) {
  const [geo] = await db
    .select()
    .from(costBookGeoFactors)
    .where(and(
      eq(costBookGeoFactors.providerId, providerId),
      eq(costBookGeoFactors.regionCode, regionCode),
    ))
    .limit(1);
  return geo ?? null;
}

async function search(provider: CostBookProvider, query: string, limit = 50): Promise<CostBookEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return db
      .select()
      .from(costBookEntries)
      .where(eq(costBookEntries.providerId, provider.id))
      .orderBy(desc(costBookEntries.updatedAt))
      .limit(limit);
  }
  const like = `%${trimmed}%`;
  return db
    .select()
    .from(costBookEntries)
    .where(and(
      eq(costBookEntries.providerId, provider.id),
      or(
        ilike(costBookEntries.description, like),
        ilike(costBookEntries.sourceCode, like),
        ilike(costBookEntries.csiDivision, like),
      ),
    ))
    .orderBy(costBookEntries.csiDivision, costBookEntries.sourceCode)
    .limit(limit);
}

export const builtInProvider: CostBookProviderAdapter = {
  kind: "BUILTIN",
  syncEntries,
  lookupBySourceCode,
  search,
};
