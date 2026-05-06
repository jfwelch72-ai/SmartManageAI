import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${name}) AS present
  `);
  return Boolean((result.rows[0] as Record<string, boolean>).present);
}

export async function ensureDotTables(): Promise<void> {
  const required = [
    "dot_agencies",
    "dot_spec_books",
    "dot_pay_items",
    "dot_pay_item_overrides",
    "organization_dot_preferences",
  ];
  const presence: Record<string, boolean> = {};
  for (const t of required) {
    presence[t] = await tableExists(t);
  }
  if (required.every((t) => presence[t])) {
    logInfo("[migration] dot_* tables — already present, skipped");
    return;
  }

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "dot_agency_kind" AS ENUM ('FEDERAL','STATE_DOT','TERRITORY_DOT','TOLL_AUTHORITY','MUNICIPAL','AIRPORT_AUTHORITY','TRANSIT_AUTHORITY','OTHER');
    EXCEPTION WHEN duplicate_object THEN null; END $$
  `);
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "dot_pay_item_type" AS ENUM ('UNIT_PRICE','LUMP_SUM','ALTERNATE','INCENTIVE','FORCE_ACCOUNT');
    EXCEPTION WHEN duplicate_object THEN null; END $$
  `);

  if (!presence.dot_agencies) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "dot_agencies" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(32) NOT NULL UNIQUE,
        "name" text NOT NULL,
        "full_name" text NOT NULL,
        "state_code" varchar(4),
        "kind" "dot_agency_kind" NOT NULL,
        "website" text,
        "spec_book_system" text,
        "current_spec_year" varchar(8),
        "supports_aashtoware" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dot_agencies_kind_idx" ON "dot_agencies" ("kind")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dot_agencies_state_idx" ON "dot_agencies" ("state_code")`);
  }

  if (!presence.dot_spec_books) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "dot_spec_books" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "agency_id" varchar NOT NULL REFERENCES "dot_agencies"("id") ON DELETE CASCADE,
        "edition" varchar(16) NOT NULL,
        "title" text NOT NULL,
        "effective_date" date,
        "is_current" boolean NOT NULL DEFAULT false,
        "item_count" integer NOT NULL DEFAULT 0,
        "notes" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "dot_spec_books_agency_edition_uniq" UNIQUE ("agency_id", "edition")
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dot_spec_books_agency_idx" ON "dot_spec_books" ("agency_id")`);
  }

  if (!presence.dot_pay_items) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "dot_pay_items" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "spec_book_id" varchar NOT NULL REFERENCES "dot_spec_books"("id") ON DELETE CASCADE,
        "agency_id" varchar NOT NULL REFERENCES "dot_agencies"("id") ON DELETE CASCADE,
        "item_number" varchar(64) NOT NULL,
        "description" text NOT NULL,
        "unit" varchar(16) NOT NULL,
        "spec_section" varchar(32),
        "category" text,
        "pay_item_type" "dot_pay_item_type" NOT NULL DEFAULT 'UNIT_PRICE',
        "search_tokens" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "dot_pay_items_spec_book_item_uniq" UNIQUE ("spec_book_id", "item_number")
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dot_pay_items_spec_book_idx" ON "dot_pay_items" ("spec_book_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dot_pay_items_agency_idx" ON "dot_pay_items" ("agency_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dot_pay_items_item_number_idx" ON "dot_pay_items" ("item_number")`);
  }

  if (!presence.dot_pay_item_overrides) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "dot_pay_item_overrides" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "pay_item_id" varchar NOT NULL REFERENCES "dot_pay_items"("id") ON DELETE CASCADE,
        "custom_description" text,
        "custom_unit" varchar(16),
        "internal_alias" text,
        "custom_category" text,
        "notes" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "dot_pay_item_overrides_org_item_uniq" UNIQUE ("organization_id", "pay_item_id")
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dot_pay_item_overrides_org_idx" ON "dot_pay_item_overrides" ("organization_id")`);
  }

  if (!presence.organization_dot_preferences) {
    // Schema (shared/schema/features.ts): id, organization_id, agency_id,
    // is_default, created_at — with unique(org,agency) named "org_dot_preferences_uniq"
    // and index "org_dot_preferences_org_idx".
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "organization_dot_preferences" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "agency_id" varchar NOT NULL REFERENCES "dot_agencies"("id") ON DELETE CASCADE,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "org_dot_preferences_uniq" UNIQUE ("organization_id", "agency_id")
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "org_dot_preferences_org_idx" ON "organization_dot_preferences" ("organization_id")`);
  }

  logInfo("[migration] dot_* tables ensured");
}
