import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

// Mobile field app queues additional record kinds (RFI, INSPECTION,
// DAILY_REPORT, PUNCH_ITEM, DRAWING_MARKUP) onto offline_sync_queue
// for server-backed conflict detection. The original enum was authored
// before those types existed, so add them at startup with IF NOT EXISTS
// to keep older databases compatible.
const NEW_VALUES = ["RFI", "INSPECTION", "DAILY_REPORT", "PUNCH_ITEM", "DRAWING_MARKUP"] as const;

export async function ensureMobileOfflineEnumValues(): Promise<void> {
  try {
    for (const v of NEW_VALUES) {
      await db.execute(sql.raw(`ALTER TYPE offline_entity_type ADD VALUE IF NOT EXISTS '${v}'`));
    }
  } catch (err) {
    logError(
      "[migration] Failed to ensure offline_entity_type enum values:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
