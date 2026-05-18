import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2922 — Bid AI Analysis: CSI scope document + standalone takeoff scope fields.
 *
 * Adds four columns that the schema-drift detector sees as missing in production:
 *   • ai_bid_document_analysis.scope_document_key  — GCS key for generated Scope of Work markdown
 *   • standalone_takeoffs.scope_document_key       — GCS key for plan-import scope doc
 *   • standalone_takeoffs.scope_items_json         — JSON array of CSI-tagged line items
 *   • standalone_takeoffs.scope_analysis_status    — null | PROCESSING | COMPLETED | FAILED
 */
export async function ensureCsiScopeColumns(): Promise<void> {
  await db.execute(sql`ALTER TABLE ai_bid_document_analysis ADD COLUMN IF NOT EXISTS scope_document_key TEXT`);
  await db.execute(sql`ALTER TABLE standalone_takeoffs ADD COLUMN IF NOT EXISTS scope_document_key TEXT`);
  await db.execute(sql`ALTER TABLE standalone_takeoffs ADD COLUMN IF NOT EXISTS scope_items_json TEXT`);
  await db.execute(sql`ALTER TABLE standalone_takeoffs ADD COLUMN IF NOT EXISTS scope_analysis_status TEXT`);
  logInfo("[migration] csi_scope_columns (ai_bid_document_analysis + standalone_takeoffs) — columns ready");
}
