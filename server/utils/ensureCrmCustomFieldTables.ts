import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Ensure CRM Custom Field tables exist.
 * Tenant-defined custom fields for CRM contacts/organisations/opportunities.
 * Idempotent.
 */
export async function ensureCrmCustomFieldTables(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "crm_custom_field_entity" AS ENUM ('CONTACT', 'ORGANISATION', 'OPPORTUNITY');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "crm_custom_field_type" AS ENUM (
        'TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE',
        'DROPDOWN', 'MULTI_SELECT', 'CHECKBOX', 'URL', 'EMAIL', 'PHONE'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_custom_field_definitions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "entity_type" "crm_custom_field_entity" NOT NULL,
      "key" text NOT NULL,
      "label" text NOT NULL,
      "field_type" "crm_custom_field_type" NOT NULL,
      "options" jsonb,
      "is_required" boolean NOT NULL DEFAULT false,
      "default_value" jsonb,
      "help_text" text,
      "sort_order" integer NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crm_cfd_org_entity_idx"
      ON "crm_custom_field_definitions" ("organization_id", "entity_type")
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "crm_cfd_org_entity_key_unique"
      ON "crm_custom_field_definitions" ("organization_id", "entity_type", "key")
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_custom_field_values" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "definition_id" varchar NOT NULL REFERENCES "crm_custom_field_definitions"("id") ON DELETE CASCADE,
      "entity_type" "crm_custom_field_entity" NOT NULL,
      "entity_id" varchar NOT NULL,
      "value" jsonb,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crm_cfv_entity_idx"
      ON "crm_custom_field_values" ("entity_type", "entity_id")
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crm_cfv_def_idx"
      ON "crm_custom_field_values" ("definition_id")
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "crm_cfv_def_entity_unique"
      ON "crm_custom_field_values" ("definition_id", "entity_id")
  `);
}
