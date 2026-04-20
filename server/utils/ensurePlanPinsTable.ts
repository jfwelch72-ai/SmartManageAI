import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #576: plan_pins — pins for RFI/Punch/Submittal anchored to a plan sheet
 * at normalized 0-1 (x,y) coordinates per page.
 */
export async function ensurePlanPinsTable(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_pin_pin_type') THEN
          CREATE TYPE "plan_pin_pin_type" AS ENUM ('RFI', 'PUNCH', 'SUBMITTAL');
        END IF;
      END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "plan_pins" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "project_code" text NOT NULL,
        "plan_document_id" varchar NOT NULL REFERENCES "plan_documents"("id") ON DELETE CASCADE,
        "page_number" integer NOT NULL DEFAULT 1,
        "x" double precision NOT NULL,
        "y" double precision NOT NULL,
        "pin_type" "plan_pin_pin_type" NOT NULL,
        "ref_table" text NOT NULL,
        "ref_id" varchar NOT NULL,
        "created_by_id" varchar NOT NULL REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS "plan_pins_doc_page_idx" ON "plan_pins"("plan_document_id","page_number")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "plan_pins_project_code_idx" ON "plan_pins"("project_code")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "plan_pins_org_idx" ON "plan_pins"("organization_id")`);

    console.log("[migration] plan_pins table ready");
  } catch (err) {
    logError(
      "[migration] ensurePlanPinsTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
