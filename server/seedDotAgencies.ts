import { db } from "./db";
import { dotAgencies, dotSpecBooks, dotPayItems } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { readFileSync } from "fs";
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

interface SamplePayItemSet {
  specBook: { edition: string; title: string };
  items: PayItemJson[];
}

export async function seedDotAgenciesAndSpecBooks(): Promise<{ agenciesInserted: number; specBooksInserted: number; payItemsInserted: number }> {
  let agenciesInserted = 0;
  let specBooksInserted = 0;
  let payItemsInserted = 0;

  let agenciesData: AgencyJson[];
  let sampleData: Record<string, SamplePayItemSet>;
  try {
    agenciesData = JSON.parse(readFileSync(join(process.cwd(), "server/data/dot/agencies.json"), "utf8"));
    sampleData = JSON.parse(readFileSync(join(process.cwd(), "server/data/dot/sample-pay-items.json"), "utf8"));
  } catch (err) {
    console.error("[DOTSeed] Failed to read agency seed files:", err);
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

  // Seed sample pay items for agencies that have items in sample-pay-items.json
  for (const [agencyCode, set] of Object.entries(sampleData)) {
    const agency = await db.select().from(dotAgencies).where(eq(dotAgencies.code, agencyCode)).limit(1);
    if (agency.length === 0) continue;
    const sb = await db.select().from(dotSpecBooks)
      .where(and(eq(dotSpecBooks.agencyId, agency[0].id), eq(dotSpecBooks.edition, set.specBook.edition)))
      .limit(1);
    if (sb.length === 0) continue;
    const specBookId = sb[0].id;

    for (const item of set.items) {
      const existing = await db.select().from(dotPayItems)
        .where(and(eq(dotPayItems.specBookId, specBookId), eq(dotPayItems.itemNumber, item.itemNumber)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(dotPayItems).values({
          specBookId,
          agencyId: agency[0].id,
          itemNumber: item.itemNumber,
          description: item.description,
          unit: item.unit,
          specSection: item.specSection ?? null,
          category: item.category ?? null,
          searchTokens: `${item.itemNumber} ${item.description}`.toLowerCase(),
        });
        payItemsInserted++;
      }
    }
    // Update count
    await db.update(dotSpecBooks).set({
      itemCount: sql`(SELECT COUNT(*) FROM dot_pay_items WHERE spec_book_id = ${specBookId})`,
    }).where(eq(dotSpecBooks.id, specBookId));
  }

  console.log(`[DOTSeed] Agencies: ${agenciesInserted} inserted | Spec Books: ${specBooksInserted} inserted | Pay Items: ${payItemsInserted} inserted`);
  return { agenciesInserted, specBooksInserted, payItemsInserted };
}
