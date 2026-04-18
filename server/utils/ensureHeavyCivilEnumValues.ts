import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

const REQUIRED_WORKFLOW_ENTITY_TYPES = ["HAUL_TICKET", "INSPECTOR_REPORT", "MATERIAL_CERT", "SURETY_BOND"];
const REQUIRED_OFFLINE_ENTITY_TYPES = ["HAUL_TICKET", "INSPECTOR_REPORT", "SWPPP_INSPECTION"];

async function backfillEnum(enumName: string, required: string[]): Promise<number> {
  const result = await db.execute(sql.raw(
    `SELECT unnest(enum_range(NULL::${enumName}))::text AS val`
  ));
  const existing = new Set((result.rows as { val: string }[]).map(r => r.val));
  let added = 0;
  for (const val of required) {
    if (!existing.has(val)) {
      await db.execute(sql.raw(`ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS '${val}'`));
      added++;
    }
  }
  return added;
}

export async function ensureHeavyCivilEnumValues(): Promise<void> {
  try {
    const wfAdded = await backfillEnum("workflow_entity_type", REQUIRED_WORKFLOW_ENTITY_TYPES);
    const offAdded = await backfillEnum("offline_entity_type", REQUIRED_OFFLINE_ENTITY_TYPES);
    const total = wfAdded + offAdded;
    if (total > 0) {
      console.log(`[migration] heavy-civil enums — added ${wfAdded} workflow_entity_type and ${offAdded} offline_entity_type value(s)`);
    } else {
      console.log("[migration] heavy-civil enums — all values present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure heavy-civil enum values:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
