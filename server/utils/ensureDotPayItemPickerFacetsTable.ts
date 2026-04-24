import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1743 — per-user × per-spec-book picker filter memory for the DOT
 * pay-item picker. Promotes the per-device
 * `dot-pay-item-picker:facets:<uid>:<specBookId>` localStorage key off the
 * device so an estimator's chosen categories + spec sections follow them
 * across machines.
 *
 * Idempotent — safe to run on every cold start.
 */
export async function ensureDotPayItemPickerFacetsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "dot_pay_item_picker_facets" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "spec_book_id" varchar NOT NULL REFERENCES "dot_spec_books"("id") ON DELETE CASCADE,
        "categories" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "spec_sections" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "dot_pay_item_picker_facets_user_spec_book_uniq" UNIQUE ("user_id", "spec_book_id")
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "dot_pay_item_picker_facets_user_idx"
      ON "dot_pay_item_picker_facets" ("user_id")
    `);
  } catch (err) {
    logError(
      "[migration] ensureDotPayItemPickerFacetsTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
