import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Idempotently creates the 8 heavy-civil / DOT tables that exist in the
 * Drizzle schema (`shared/schema/features.ts` + `shared/schema/core.ts`)
 * but may be missing from the database. All `CREATE TABLE IF NOT EXISTS`
 * — preserves Drizzle column types and the existing `varchar` primary
 * keys exactly. Safe to re-run.
 *
 * Schema-compatible with one intentional addition: `surety_bonds.document_id`,
 * `haul_tickets.ticket_photo_document_id`, and `material_certifications.document_id`
 * are created with explicit `REFERENCES plan_documents(id) ON DELETE SET NULL`
 * FK constraints (Drizzle defines them as plain `varchar`). This matches the
 * heavy-civil document-versioning design from Task #487/#499.
 *
 * Tables (matched 1:1 to Drizzle definitions):
 *   - project_dbe_goals
 *   - crm_organisation_certifications
 *   - surety_bonds
 *   - haul_tickets
 *   - daily_inspector_reports
 *   - swppp_inspections
 *   - material_certifications
 *   - certified_payroll_reports
 */
export async function ensureHeavyCivilTables(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='project_dbe_goals') AS dbe_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='crm_organisation_certifications') AS crm_cert_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='surety_bonds') AS bonds_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='haul_tickets') AS haul_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='daily_inspector_reports') AS idr_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='swppp_inspections') AS swppp_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='material_certifications') AS mat_cert_exist,
        EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='certified_payroll_reports') AS cpr_exist
    `);
    const row = result.rows[0] as Record<string, boolean>;
    const allExist = row.dbe_exist && row.crm_cert_exist && row.bonds_exist && row.haul_exist
      && row.idr_exist && row.swppp_exist && row.mat_cert_exist && row.cpr_exist;
    if (allExist) {
      logInfo("[migration] heavy_civil_tables — all 8 tables already present, skipped");
      return;
    }

    // Create enum types referenced by the tables (idempotent via DO blocks).
    const enumDefs: Array<{ name: string; values: string[] }> = [
      { name: "dbe_certification_type", values: ["DBE","MBE","WBE","SBE","VOSB","SDVOSB","HUBZONE","EIGHTA","ACDBE","OTHER"] },
      { name: "surety_bond_type", values: ["BID","PERFORMANCE","PAYMENT","MAINTENANCE","SUPPLY","WARRANTY","LICENSE","OTHER"] },
      { name: "surety_bond_status", values: ["DRAFT","ACTIVE","EXPIRED","RELEASED","CLAIMED","CANCELED"] },
      { name: "haul_ticket_status", values: ["DRAFT","SUBMITTED","APPROVED","REJECTED","VOIDED"] },
      { name: "swppp_inspection_type", values: ["ROUTINE","POST_RAIN","PRE_STORM","FINAL","OTHER"] },
      { name: "idr_status", values: ["DRAFT","SUBMITTED","APPROVED","REVISED"] },
      { name: "buy_america_status", values: ["PENDING","VERIFIED","WAIVER_REQUESTED","WAIVER_GRANTED","NON_COMPLIANT"] },
      { name: "payroll_form_variant", values: ["WH_347","ODOT_CA_D_9C","CALTRANS_CEM_2502","TXDOT","FDOT","GENERIC"] },
    ];
    for (const e of enumDefs) {
      const valuesSql = e.values.map((v) => `'${v}'`).join(", ");
      await db.execute(sql.raw(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${e.name}') THEN
             BEGIN
               CREATE TYPE "${e.name}" AS ENUM (${valuesSql});
             EXCEPTION WHEN duplicate_object THEN NULL;
             END;
           END IF;
         END $$;`
      ));
    }

    if (!row.dbe_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "project_dbe_goals" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "certification_type" "dbe_certification_type" NOT NULL,
          "goal_percent" numeric(5,2) NOT NULL,
          "goal_dollars" numeric(14,2),
          "notes" text,
          "created_by_id" varchar REFERENCES "users"("id"),
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_dbe_goals_project_idx" ON "project_dbe_goals" ("project_id")`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "project_dbe_goals_uniq" ON "project_dbe_goals" ("project_id","certification_type")`);
    }

    if (!row.crm_cert_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "crm_organisation_certifications" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "crm_organisation_id" varchar NOT NULL REFERENCES "crm_organisations"("id") ON DELETE CASCADE,
          "certification_type" "dbe_certification_type" NOT NULL,
          "certifying_agency" text,
          "certification_number" text,
          "effective_date" date,
          "expiration_date" date,
          "document_url" text,
          "notes" text,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_org_cert_entity_idx" ON "crm_organisation_certifications" ("crm_organisation_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_org_cert_exp_idx" ON "crm_organisation_certifications" ("expiration_date")`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_org_cert_uniq" ON "crm_organisation_certifications" ("crm_organisation_id","certification_type","certifying_agency")`);
    }

    if (!row.bonds_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "surety_bonds" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "project_id" varchar REFERENCES "projects"("id") ON DELETE SET NULL,
          "bid_id" varchar REFERENCES "bids"("id") ON DELETE SET NULL,
          "bond_type" "surety_bond_type" NOT NULL,
          "status" "surety_bond_status" NOT NULL DEFAULT 'DRAFT',
          "bond_number" text NOT NULL,
          "surety_company" text NOT NULL,
          "agent_name" text,
          "agent_phone" text,
          "agent_email" text,
          "bond_amount" numeric(14,2) NOT NULL,
          "premium_amount" numeric(12,2),
          "effective_date" date,
          "expiration_date" date,
          "release_date" date,
          "document_url" text,
          "document_id" varchar REFERENCES "plan_documents"("id") ON DELETE SET NULL,
          "notes" text,
          "verification_status" text,
          "last_verified_at" timestamp,
          "created_by_id" varchar REFERENCES "users"("id"),
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "surety_bonds_org_idx" ON "surety_bonds" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "surety_bonds_project_idx" ON "surety_bonds" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "surety_bonds_bid_idx" ON "surety_bonds" ("bid_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "surety_bonds_exp_idx" ON "surety_bonds" ("expiration_date")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "surety_bonds_status_idx" ON "surety_bonds" ("status")`);
    }

    if (!row.haul_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "haul_tickets" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "ticket_number" text NOT NULL,
          "ticket_date" date NOT NULL,
          "status" "haul_ticket_status" NOT NULL DEFAULT 'SUBMITTED',
          "material_class" text NOT NULL,
          "source" text,
          "destination" text,
          "truck_number" text,
          "driver_name" text,
          "hauler_vendor_id" varchar REFERENCES "crm_organisations"("id") ON DELETE SET NULL,
          "quantity" numeric(12,3) NOT NULL,
          "unit" varchar(16) NOT NULL DEFAULT 'TON',
          "unit_cost" numeric(12,4),
          "total_cost" numeric(14,2),
          "cost_code" varchar(20),
          "pay_item_id" varchar REFERENCES "dot_pay_items"("id") ON DELETE SET NULL,
          "pay_item_number" varchar(64),
          "ticket_photo_url" text,
          "ticket_photo_document_id" varchar REFERENCES "plan_documents"("id") ON DELETE SET NULL,
          "notes" text,
          "recorded_by_id" varchar REFERENCES "users"("id"),
          "approved_by_id" varchar REFERENCES "users"("id"),
          "approved_at" timestamp,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "haul_tickets_org_idx" ON "haul_tickets" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "haul_tickets_project_idx" ON "haul_tickets" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "haul_tickets_date_idx" ON "haul_tickets" ("ticket_date")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "haul_tickets_status_idx" ON "haul_tickets" ("status")`);
    }

    if (!row.idr_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "daily_inspector_reports" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "report_date" date NOT NULL,
          "report_number" text,
          "status" "idr_status" NOT NULL DEFAULT 'DRAFT',
          "inspector_id" varchar REFERENCES "users"("id"),
          "inspector_name" text,
          "weather_conditions" text,
          "temperature_high" integer,
          "temperature_low" integer,
          "precipitation_inches" numeric(5,2),
          "wind_speed_mph" integer,
          "crew_count" integer DEFAULT 0,
          "crew_hours" numeric(8,2) DEFAULT 0,
          "equipment_summary" json,
          "work_performed" text,
          "stations_worked" text,
          "deliveries" text,
          "visitors" text,
          "safety_incidents" text,
          "delays_encountered" text,
          "photo_urls" text[],
          "attachment_urls" text[],
          "photo_document_ids" text[],
          "attachment_document_ids" text[],
          "submitted_at" timestamp,
          "approved_at" timestamp,
          "approved_by_id" varchar REFERENCES "users"("id"),
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idr_org_idx" ON "daily_inspector_reports" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idr_project_idx" ON "daily_inspector_reports" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idr_date_idx" ON "daily_inspector_reports" ("report_date")`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "idr_project_date_uniq" ON "daily_inspector_reports" ("project_id","report_date")`);
    }

    if (!row.swppp_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "swppp_inspections" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "inspection_date" date NOT NULL,
          "inspection_type" "swppp_inspection_type" NOT NULL DEFAULT 'ROUTINE',
          "inspector_id" varchar REFERENCES "users"("id"),
          "inspector_name" text,
          "inspector_cert_number" text,
          "rainfall_trigger_inches" numeric(5,2),
          "rainfall_24hr_inches" numeric(5,2),
          "bmp_checklist" json,
          "deficiencies_found" text,
          "corrective_actions" text,
          "corrective_action_assignee_id" varchar REFERENCES "users"("id"),
          "corrective_action_due_date" date,
          "corrective_action_completed_at" timestamp,
          "photo_urls" text[],
          "notes" text,
          "created_by_id" varchar REFERENCES "users"("id"),
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "swppp_org_idx" ON "swppp_inspections" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "swppp_project_idx" ON "swppp_inspections" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "swppp_date_idx" ON "swppp_inspections" ("inspection_date")`);
    }

    if (!row.mat_cert_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "material_certifications" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "material_description" text NOT NULL,
          "pay_item_id" varchar REFERENCES "dot_pay_items"("id") ON DELETE SET NULL,
          "pay_item_number" varchar(64),
          "manufacturer_name" text,
          "manufacturer_country" text,
          "mill_name" text,
          "mill_country" text,
          "heat_number" text,
          "cert_number" text,
          "buy_america_status" "buy_america_status" NOT NULL DEFAULT 'PENDING',
          "waiver_reason" text,
          "document_url" text,
          "document_id" varchar REFERENCES "plan_documents"("id") ON DELETE SET NULL,
          "received_date" date,
          "expiration_date" date,
          "submitted_by_id" varchar REFERENCES "users"("id"),
          "submitted_at" timestamp,
          "verified_by_id" varchar REFERENCES "users"("id"),
          "verified_at" timestamp,
          "notes" text,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "material_certs_org_idx" ON "material_certifications" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "material_certs_project_idx" ON "material_certifications" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "material_certs_status_idx" ON "material_certifications" ("buy_america_status")`);
    }

    if (!row.cpr_exist) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "certified_payroll_reports" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "pay_run_id" varchar NOT NULL REFERENCES "pay_runs"("id") ON DELETE CASCADE,
          "project_id" varchar REFERENCES "projects"("id") ON DELETE SET NULL,
          "variant" "payroll_form_variant" NOT NULL,
          "object_key" text NOT NULL,
          "file_size" integer NOT NULL DEFAULT 0,
          "generated_by_id" varchar REFERENCES "users"("id"),
          "generated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "certified_payroll_reports_org_idx" ON "certified_payroll_reports" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "certified_payroll_reports_pay_run_idx" ON "certified_payroll_reports" ("pay_run_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "certified_payroll_reports_project_idx" ON "certified_payroll_reports" ("project_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "certified_payroll_reports_generated_at_idx" ON "certified_payroll_reports" ("generated_at")`);
    }

    // Backfill-friendly: allow generated_by_id to be NULL on existing installs so the
    // backfill script can insert rows for legacy PDFs whose original generator is unknown.
    await db.execute(sql`ALTER TABLE "certified_payroll_reports" ALTER COLUMN "generated_by_id" DROP NOT NULL`);

    logInfo("[migration] heavy_civil_tables — created missing heavy-civil tables");
  } catch (err) {
    logError("[migration] Failed to ensure heavy-civil tables", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
