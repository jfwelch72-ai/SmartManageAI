import { logWarn, logError, logInfo } from "./utils/logger";
import { db } from "./db";
import { dotAgencies, dotSpecBooks, dotPayItems } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

interface AgencyJson {
  code: string;
  name: string;
  fullName: string;
  stateCode: string | null;
  kind: "FEDERAL" | "STATE_DOT" | "TERRITORY_DOT" | "TOLL_AUTHORITY" | "MUNICIPAL" | "AIRPORT_AUTHORITY" | "TRANSIT_AUTHORITY" | "OTHER";
  website: string | null;
  specBookSystem: string | null;
  currentSpecYear: string | null;
  supportsAashtoware: boolean;
}

interface PayItemJson {
  itemNumber: string;
  description: string;
  unit: string;
  specSection?: string;
  category?: string;
}

interface PayItemSet {
  specBook: { edition: string; title: string };
  source?: string;
  items: PayItemJson[];
}

const PAY_ITEMS_DIR = join(process.cwd(), "server/data/dot/pay-items");
const LEGACY_SAMPLE_FILE = join(process.cwd(), "server/data/dot/sample-pay-items.json");
// Larger batch sizes overwhelm Postgres parameter limits; 500 rows × 8 cols
// keeps us well under the 65k bound parameter cap.
const INSERT_BATCH = 500;

// Per-agency expected catalog size thresholds. Each entry is the minimum
// number of items the catalog should contain for the listed spec edition.
// Values come from the agency's published master pay-item list (real data
// for FHWA/NCDOT) or a defensible lower bound matching the agency's spec
// book size (templated data for other agencies). On boot, if a loaded
// catalog falls below the threshold, the seeder logs a warning so coverage
// regressions are visible.
export const AGENCY_MIN_ITEMS: Record<string, number> = {
  FHWA: 3500,     // FP-14 master list publishes ~3,985 items
  NCDOT: 1400,    // 2024 Master Pay Item List publishes ~1,463 items
  TXDOT: 3000,
  CALTRANS: 2400,
  FDOT: 3000,
  NYSDOT: 2500,
  PENNDOT: 2700,
  ODOT: 2700,
  IDOT: 2400,
  GDOT: 2400,
  VDOT: 2400,
  WSDOT: 900,    // Standard Item Table (DOT-RGG101) publishes ~990 items
  CDOT: 4000,    // CDOT Item Code Book (XLSX) publishes ~4,770 items
  INDOT: 4000,   // Current English Pay Items XLSX publishes ~4,520 items
  IADOT: 3500,   // Iowa DOT current_e_pay_items.xlsx publishes ~3,740 items
  MAINEDOT: 4500, // MaineDOT English Item Catalog PDF publishes ~4,850 items
  MODOT: 2200,   // MoDOT Bid Items Listing PDF publishes ~2,360 items
  MDOT_MI: 6500, // MDOT 2020 Pay Item Codes XLSX publishes ~6,718 items (USP rows excluded)
  ODOT_OK: 3000, // Oklahoma DOT AWP Spec Year 19 Item List publishes ~3,207 items
  WISDOT: 2000,  // WisDOT 2025 Standard Specifications Bid Items appendix publishes ~2,089 items
  SDDOT: 1100,   // SDDOT 2024 Bid Item Price Report publishes ~1,189 items used in 2024
};

function loadAgencies(): AgencyJson[] {
  return JSON.parse(readFileSync(join(process.cwd(), "server/data/dot/agencies.json"), "utf8"));
}

/**
 * Loads pay-item sets keyed by agency code. Per-agency files in
 * `server/data/dot/pay-items/<CODE>.json` take precedence; the legacy
 * combined `sample-pay-items.json` is used as a fallback for any agency
 * that doesn't have a dedicated file yet.
 */
function loadPayItemSets(): Record<string, PayItemSet> {
  const sets: Record<string, PayItemSet> = {};
  if (existsSync(LEGACY_SAMPLE_FILE)) {
    try {
      const legacy = JSON.parse(readFileSync(LEGACY_SAMPLE_FILE, "utf8")) as Record<string, PayItemSet>;
      Object.assign(sets, legacy);
    } catch (err) {
      logWarn("[DOTSeed] Failed to parse legacy sample-pay-items.json:", err);
    }
  }
  if (existsSync(PAY_ITEMS_DIR)) {
    for (const file of readdirSync(PAY_ITEMS_DIR)) {
      if (!file.endsWith(".json")) continue;
      const code = file.replace(/\.json$/, "");
      try {
        const data = JSON.parse(readFileSync(join(PAY_ITEMS_DIR, file), "utf8")) as PayItemSet;
        if (data && Array.isArray(data.items) && data.specBook?.edition) {
          sets[code] = data; // per-agency file wins over legacy
        }
      } catch (err) {
        logWarn(`[DOTSeed] Failed to parse ${file}:`, err);
      }
    }
  }
  // Validate per-agency catalog sizes against AGENCY_MIN_ITEMS so coverage
  // regressions (e.g. a fetch script breaking, or a hand-edit deleting items)
  // surface as warnings on every boot.
  for (const [code, expectedMin] of Object.entries(AGENCY_MIN_ITEMS)) {
    const set = sets[code];
    if (!set) {
      logWarn(`[DOTSeed] Missing pay-item catalog for ${code} (expected >=${expectedMin} items).`);
      continue;
    }
    if (set.items.length < expectedMin) {
      logWarn(
        `[DOTSeed] ${code} catalog has only ${set.items.length} items; expected >=${expectedMin}. ` +
        `Investigate the fetcher/generator for this agency.`,
      );
    }
  }
  return sets;
}

export async function seedDotAgenciesAndSpecBooks(): Promise<{ agenciesInserted: number; specBooksInserted: number; payItemsInserted: number }> {
  let agenciesInserted = 0;
  let specBooksInserted = 0;
  let payItemsInserted = 0;

  let agenciesData: AgencyJson[];
  let payItemSets: Record<string, PayItemSet>;
  try {
    agenciesData = loadAgencies();
    payItemSets = loadPayItemSets();
  } catch (err) {
    logError("[DOTSeed] Failed to read agency seed files:", err);
    return { agenciesInserted, specBooksInserted, payItemsInserted };
  }

  for (const a of agenciesData) {
    const existing = await db.select().from(dotAgencies).where(eq(dotAgencies.code, a.code)).limit(1);
    let agencyId: string;
    if (existing.length === 0) {
      const [inserted] = await db.insert(dotAgencies).values({
        code: a.code,
        name: a.name,
        fullName: a.fullName,
        stateCode: a.stateCode,
        kind: a.kind,
        website: a.website,
        specBookSystem: a.specBookSystem,
        currentSpecYear: a.currentSpecYear,
        supportsAashtoware: a.supportsAashtoware,
      }).returning();
      agencyId = inserted.id;
      agenciesInserted++;
    } else {
      agencyId = existing[0].id;
    }

    // Always ensure the current spec book row exists for the listed currentSpecYear.
    if (a.currentSpecYear) {
      const sbExists = await db.select().from(dotSpecBooks)
        .where(and(eq(dotSpecBooks.agencyId, agencyId), eq(dotSpecBooks.edition, a.currentSpecYear)))
        .limit(1);
      if (sbExists.length === 0) {
        await db.insert(dotSpecBooks).values({
          agencyId,
          edition: a.currentSpecYear,
          title: `${a.name} ${a.specBookSystem ?? "Standard Specifications"} (${a.currentSpecYear})`,
          isCurrent: true,
        });
        specBooksInserted++;
      }
    }
  }

  // Seed pay items for every agency that has a catalog file (per-agency file
  // or legacy sample). Uses batched inserts with onConflictDoNothing to stay
  // idempotent across boots and fast on first boot for large catalogs.
  for (const [agencyCode, set] of Object.entries(payItemSets)) {
    const agency = await db.select().from(dotAgencies).where(eq(dotAgencies.code, agencyCode)).limit(1);
    if (agency.length === 0) continue;
    let sb = await db.select().from(dotSpecBooks)
      .where(and(eq(dotSpecBooks.agencyId, agency[0].id), eq(dotSpecBooks.edition, set.specBook.edition)))
      .limit(1);
    if (sb.length === 0) {
      const [created] = await db.insert(dotSpecBooks).values({
        agencyId: agency[0].id,
        edition: set.specBook.edition,
        title: set.specBook.title,
        isCurrent: true,
        notes: set.source ? `Source: ${set.source}` : null,
      }).returning();
      sb = [created];
      specBooksInserted++;
    } else if (set.source) {
      const desiredNote = `Source: ${set.source}`;
      if (sb[0].notes !== desiredNote) {
        await db.update(dotSpecBooks)
          .set({ notes: desiredNote })
          .where(eq(dotSpecBooks.id, sb[0].id));
      }
    }
    const specBookId = sb[0].id;

    // Skip the work if the catalog is already fully loaded (idempotency
    // fast-path: avoids re-batching every boot once seeded).
    const [{ count: existingCount }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(dotPayItems)
      .where(eq(dotPayItems.specBookId, specBookId));
    if (Number(existingCount) >= set.items.length) continue;

    const rows = set.items.map((item) => ({
      specBookId,
      agencyId: agency[0].id,
      itemNumber: item.itemNumber,
      description: item.description,
      unit: item.unit,
      specSection: item.specSection ?? null,
      category: item.category ?? null,
      searchTokens: `${item.itemNumber} ${item.description}`.toLowerCase(),
    }));
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const slice = rows.slice(i, i + INSERT_BATCH);
      const result = await db
        .insert(dotPayItems)
        .values(slice)
        .onConflictDoNothing({ target: [dotPayItems.specBookId, dotPayItems.itemNumber] })
        .returning({ id: dotPayItems.id });
      payItemsInserted += result.length;
    }
    // Update count
    await db.update(dotSpecBooks).set({
      itemCount: sql`(SELECT COUNT(*) FROM dot_pay_items WHERE spec_book_id = ${specBookId})`,
    }).where(eq(dotSpecBooks.id, specBookId));
  }

  logInfo(`[DOTSeed] Agencies: ${agenciesInserted} inserted | Spec Books: ${specBooksInserted} inserted | Pay Items: ${payItemsInserted} inserted`);
  return { agenciesInserted, specBooksInserted, payItemsInserted };
}
