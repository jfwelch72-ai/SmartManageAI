import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureMissingDrizzleTables(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bim_extractions') AS bim_extractions_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'equipment_fuel_logs') AS fuel_logs_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'equipment_listings') AS listings_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'equipment_rental_requests') AS rental_requests_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'revenue_recognition') AS rev_rec_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cost_transactions') AS cost_txn_exist
    `);

    const row = result.rows[0] as Record<string, boolean>;
    const allExist = row.bim_extractions_exist && row.fuel_logs_exist && row.listings_exist && row.rental_requests_exist && row.rev_rec_exist && row.cost_txn_exist;

    if (allExist) {
      logInfo("[migration] missing drizzle tables — already present, skipped");
      return;
    }

    if (!row.bim_extractions_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "bim_extractions" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "bid_id" varchar REFERENCES "bids"("id") ON DELETE CASCADE,
          "project_id" varchar REFERENCES "projects"("id") ON DELETE CASCADE,
          "document_id" varchar,
          "document_name" text,
          "extracted_data" text NOT NULL,
          "mappings" text,
          "imported_at" timestamp,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "bim_extractions_bid_idx" ON "bim_extractions" ("bid_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "bim_extractions_project_idx" ON "bim_extractions" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "bim_extractions_document_idx" ON "bim_extractions" ("document_id")`);
    }

    if (!row.fuel_logs_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "equipment_fuel_logs" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "equipment_id" varchar NOT NULL REFERENCES "equipment"("id") ON DELETE CASCADE,
          "project_id" varchar REFERENCES "projects"("id") ON DELETE SET NULL,
          "date" date NOT NULL,
          "gallons" numeric(10, 2) NOT NULL,
          "price_per_gallon" numeric(10, 4) NOT NULL,
          "total_cost" numeric(12, 2) NOT NULL,
          "fuel_type" text NOT NULL DEFAULT 'DIESEL',
          "meter_reading" numeric(10, 1),
          "submitted_by_id" varchar NOT NULL REFERENCES "users"("id"),
          "notes" text,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_fuel_logs_equipment_idx" ON "equipment_fuel_logs" ("equipment_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_fuel_logs_project_idx" ON "equipment_fuel_logs" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_fuel_logs_date_idx" ON "equipment_fuel_logs" ("date")`);
    }

    if (!row.listings_exist) {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "equipment_category" AS ENUM ('Excavation', 'Lifting', 'Concrete', 'Compaction', 'Aerial', 'Power', 'Scaffolding', 'Other');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "equipment_condition" AS ENUM ('Excellent', 'Good', 'Fair');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "equipment_listings" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "name" text NOT NULL,
          "category" equipment_category NOT NULL,
          "make_model" text,
          "year" integer,
          "daily_rate" numeric(10, 2),
          "weekly_rate" numeric(10, 2),
          "monthly_rate" numeric(10, 2),
          "deposit_amount" numeric(10, 2),
          "location" text,
          "delivery_radius" integer,
          "photos" text[],
          "condition" equipment_condition,
          "available_from" date,
          "available_to" date,
          "is_ongoing" boolean NOT NULL DEFAULT false,
          "description" text,
          "is_active" boolean NOT NULL DEFAULT true,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_listings_org_idx" ON "equipment_listings" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_listings_category_idx" ON "equipment_listings" ("category")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_listings_is_active_idx" ON "equipment_listings" ("is_active")`);
    }

    if (!row.rental_requests_exist) {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "rental_request_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "equipment_rental_requests" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "listing_id" varchar NOT NULL REFERENCES "equipment_listings"("id") ON DELETE CASCADE,
          "requester_org_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "start_date" date NOT NULL,
          "end_date" date NOT NULL,
          "delivery_requested" boolean NOT NULL DEFAULT false,
          "message" text,
          "status" rental_request_status NOT NULL DEFAULT 'PENDING',
          "owner_response" text,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_rental_requests_listing_idx" ON "equipment_rental_requests" ("listing_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_rental_requests_requester_idx" ON "equipment_rental_requests" ("requester_org_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "equipment_rental_requests_status_idx" ON "equipment_rental_requests" ("status")`);
    }

    if (!row.rev_rec_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "revenue_recognition" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "period" text NOT NULL,
          "snapshot_date" date NOT NULL,
          "contract_value" numeric(14, 2) NOT NULL DEFAULT '0',
          "change_order_adjustments" numeric(14, 2) NOT NULL DEFAULT '0',
          "adjusted_contract_value" numeric(14, 2) NOT NULL DEFAULT '0',
          "costs_to_date" numeric(14, 2) NOT NULL DEFAULT '0',
          "estimated_total_cost" numeric(14, 2) NOT NULL DEFAULT '0',
          "percent_complete" numeric(7, 4) NOT NULL DEFAULT '0',
          "earned_revenue" numeric(14, 2) NOT NULL DEFAULT '0',
          "billings_to_date" numeric(14, 2) NOT NULL DEFAULT '0',
          "over_under_billing" numeric(14, 2) NOT NULL DEFAULT '0',
          "gross_profit" numeric(14, 2) NOT NULL DEFAULT '0',
          "gross_profit_percent" numeric(7, 4) NOT NULL DEFAULT '0',
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "rev_rec_project_idx" ON "revenue_recognition" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "rev_rec_org_idx" ON "revenue_recognition" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "rev_rec_period_idx" ON "revenue_recognition" ("period")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "rev_rec_snapshot_idx" ON "revenue_recognition" ("snapshot_date")`);
    }

    if (!row.cost_txn_exist) {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "cost_source_category" AS ENUM ('LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACTOR', 'OTHER');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "cost_origin_module" AS ENUM ('ESTIMATE', 'PO', 'PAYROLL', 'TM', 'RECEIPT', 'CHANGE_ORDER', 'EQUIPMENT', 'SUBCONTRACTOR');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "cost_transaction_status" AS ENUM ('ACTIVE', 'VOIDED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "cost_transactions" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "cost_code" text NOT NULL DEFAULT 'UNASSIGNED',
          "source_category" cost_source_category NOT NULL,
          "origin_module" cost_origin_module NOT NULL,
          "amount" numeric(14, 2) NOT NULL,
          "transaction_date" date NOT NULL,
          "reference_id" varchar,
          "description" text,
          "status" cost_transaction_status NOT NULL DEFAULT 'ACTIVE',
          "voided_at" timestamp,
          "voided_by" varchar REFERENCES "users"("id"),
          "void_reason" text,
          "created_by" varchar REFERENCES "users"("id"),
          "created_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "cost_transactions_project_idx" ON "cost_transactions" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "cost_transactions_cost_code_idx" ON "cost_transactions" ("cost_code")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "cost_transactions_source_category_idx" ON "cost_transactions" ("source_category")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "cost_transactions_origin_module_idx" ON "cost_transactions" ("origin_module")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "cost_transactions_status_idx" ON "cost_transactions" ("status")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "cost_transactions_transaction_date_idx" ON "cost_transactions" ("transaction_date")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "cost_transactions_reference_idx" ON "cost_transactions" ("reference_id")`);
    }

    logInfo("[migration] missing drizzle tables — created");
  } catch (err) {
    logError("[migration] Failed to ensure missing drizzle tables:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
