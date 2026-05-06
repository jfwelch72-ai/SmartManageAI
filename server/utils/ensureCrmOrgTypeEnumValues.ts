import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

const REQUIRED_VALUES = ["SERVICE_VENDOR"];

export async function ensureCrmOrgTypeEnumValues(): Promise<void> {
  try {
    const existing = await db.execute(sql`SELECT unnest(enum_range(NULL::crm_organisation_type))::text AS val`);
    const existingValues = new Set(existing.rows.map((r: any) => r.val));
    let added = 0;

    for (const val of REQUIRED_VALUES) {
      if (!existingValues.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE crm_organisation_type ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      logInfo(`[migration] crm_organisation_type enum — ${added} value(s) added`);
    } else {
      logInfo("[migration] crm_organisation_type enum — all values present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure crm_organisation_type enum values:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
