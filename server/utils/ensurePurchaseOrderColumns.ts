import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensurePurchaseOrderColumns(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_order_items' AND column_name = 'expected_delivery_date'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    if (!colAlreadyExists) {
      await db.execute(sql`ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "expected_delivery_date" timestamp`);
      console.log("[migration] purchase_order_items expected_delivery_date — applied");
    } else {
      console.log("[migration] purchase_order_items expected_delivery_date — already present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure purchase_order_items columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
