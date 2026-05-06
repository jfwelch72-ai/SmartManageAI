import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

const REQUIRED_CATEGORIES = [
  "METALS",
  "FINISHES",
  "PLUMBING",
  "HVAC",
  "ROOFING",
  "STRUCTURAL_STEEL",
  "MASONRY",
  "DRYWALL",
  "PAINTING",
  "FLOORING",
  "FIRE_PROTECTION",
  "DEMOLITION",
  "CARPENTRY",
  "INSULATION",
  "WINDOWS_DOORS",
  "ELEVATOR",
  "GRADING",
  "PAVING",
  "SITEWORK",
  "WATERPROOFING",
  "MECHANICAL",
  "FRAMING",
  "STRIPING",
  "SIGNAGE",
  "LANDSCAPING",
  "ELECTRICAL",
  "OTHER",
];

export async function ensureEstimateCategoryEnumValues(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::estimate_item_category))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    let added = 0;
    for (const val of REQUIRED_CATEGORIES) {
      if (!existing.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE estimate_item_category ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      logInfo(`[migration] estimate_item_category enum — added ${added} missing value(s)`);
    } else {
      logInfo("[migration] estimate_item_category enum — all values present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure estimate_item_category enum values:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
