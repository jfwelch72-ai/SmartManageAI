import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Ensure CRM Enhancement Tables — quotes/proposals, tasks/reminders, auto-assignment rules,
 * catalog items, quote templates, quote acceptance tokens, lead scoring rules,
 * plus additive columns on crm_opportunities (lostCategory, leadScore, wonAt, lostAt).
 * Idempotent — safe to run on every cold start.
 */
export async function ensureCrmEnhancementTables(): Promise<void> {
  // --- New enums ---
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_lost_category" AS ENUM ('PRICE','TIMING','COMPETITOR','SCOPE','RELATIONSHIP','NO_DECISION','NO_RESPONSE','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_quote_acceptance_status" AS ENUM ('PENDING','VIEWED','ACCEPTED','DECLINED','EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_lead_scoring_operator" AS ENUM ('EQUALS','NOT_EQUALS','CONTAINS','GTE','LTE','IS_SET','IS_NOT_SET'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // --- crm_quotes (initial release) ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_quotes" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
      "crm_organisation_id" varchar REFERENCES "crm_organisations"("id") ON DELETE SET NULL,
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
      "quote_number" text NOT NULL,
      "title" text NOT NULL,
      "status" text NOT NULL DEFAULT 'DRAFT',
      "valid_until" date,
      "subtotal" decimal(14,2) NOT NULL DEFAULT 0,
      "tax_rate" decimal(5,2) NOT NULL DEFAULT 0,
      "tax_amount" decimal(14,2) NOT NULL DEFAULT 0,
      "discount_amount" decimal(14,2) NOT NULL DEFAULT 0,
      "total_amount" decimal(14,2) NOT NULL DEFAULT 0,
      "notes" text,
      "terms" text,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "sent_at" timestamp,
      "accepted_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quotes_org_idx" ON "crm_quotes"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quotes_opp_idx" ON "crm_quotes"("opportunity_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quotes_status_idx" ON "crm_quotes"("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quotes_number_idx" ON "crm_quotes"("organization_id","quote_number")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_quote_line_items" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "quote_id" varchar NOT NULL REFERENCES "crm_quotes"("id") ON DELETE CASCADE,
      "sort_order" integer NOT NULL DEFAULT 0,
      "description" text NOT NULL,
      "quantity" decimal(14,4) NOT NULL DEFAULT 1,
      "unit" text,
      "unit_price" decimal(14,4) NOT NULL DEFAULT 0,
      "line_total" decimal(14,2) NOT NULL DEFAULT 0,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quote_line_items_quote_idx" ON "crm_quote_line_items"("quote_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_tasks" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "title" text NOT NULL,
      "description" text,
      "due_date" timestamp NOT NULL,
      "status" text NOT NULL DEFAULT 'PENDING',
      "priority" text NOT NULL DEFAULT 'NORMAL',
      "assigned_to_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE CASCADE,
      "crm_organisation_id" varchar REFERENCES "crm_organisations"("id") ON DELETE SET NULL,
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
      "reminder_sent_at" timestamp,
      "completed_at" timestamp,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_tasks_org_idx" ON "crm_tasks"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_tasks_assigned_idx" ON "crm_tasks"("assigned_to_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_tasks_due_date_idx" ON "crm_tasks"("due_date")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_tasks_status_idx" ON "crm_tasks"("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_tasks_opportunity_idx" ON "crm_tasks"("opportunity_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_assignment_rules" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "priority" integer NOT NULL DEFAULT 100,
      "is_active" boolean NOT NULL DEFAULT true,
      "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "assignment_type" text NOT NULL DEFAULT 'USER',
      "assigned_to_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "round_robin_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "last_assigned_index" integer NOT NULL DEFAULT -1,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_assignment_rules_org_idx" ON "crm_assignment_rules"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_assignment_rules_active_idx" ON "crm_assignment_rules"("organization_id","is_active","priority")`);

  // --- Phase 2: catalog, templates, acceptance tokens, lead scoring ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_catalog_items" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "category" text,
      "unit" text,
      "unit_price" decimal(14,4) NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_catalog_items_org_idx" ON "crm_catalog_items"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_catalog_items_active_idx" ON "crm_catalog_items"("organization_id","is_active")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_quote_templates" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "default_terms" text,
      "default_notes" text,
      "default_tax_rate" decimal(5,2) NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quote_templates_org_idx" ON "crm_quote_templates"("organization_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_quote_template_items" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "template_id" varchar NOT NULL REFERENCES "crm_quote_templates"("id") ON DELETE CASCADE,
      "sort_order" integer NOT NULL DEFAULT 0,
      "description" text NOT NULL,
      "quantity" decimal(14,4) NOT NULL DEFAULT 1,
      "unit" text,
      "unit_price" decimal(14,4) NOT NULL DEFAULT 0,
      "catalog_item_id" varchar REFERENCES "crm_catalog_items"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quote_template_items_tmpl_idx" ON "crm_quote_template_items"("template_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_quote_acceptance_tokens" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "quote_id" varchar NOT NULL REFERENCES "crm_quotes"("id") ON DELETE CASCADE,
      "token_hash" varchar NOT NULL UNIQUE,
      "status" "crm_quote_acceptance_status" NOT NULL DEFAULT 'PENDING',
      "expires_at" timestamp NOT NULL,
      "viewed_at" timestamp,
      "decided_at" timestamp,
      "signed_name" text,
      "signed_email" text,
      "decline_reason" text,
      "ip_address" varchar,
      "user_agent" text,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quote_acc_tok_org_idx" ON "crm_quote_acceptance_tokens"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_quote_acc_tok_quote_idx" ON "crm_quote_acceptance_tokens"("quote_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_lead_scoring_rules" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "field" text NOT NULL,
      "operator" "crm_lead_scoring_operator" NOT NULL,
      "value" text,
      "points" integer NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_lead_scoring_rules_org_idx" ON "crm_lead_scoring_rules"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_lead_scoring_rules_active_idx" ON "crm_lead_scoring_rules"("organization_id","is_active")`);

  // --- Additive columns on crm_opportunities ---
  await db.execute(sql`ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "lost_category" "crm_lost_category"`);
  await db.execute(sql`ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "lead_score" integer DEFAULT 0`);
  await db.execute(sql`ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "won_at" timestamp`);
  await db.execute(sql`ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "lost_at" timestamp`);

  logInfo("[migration] crm_enhancement_tables — ensured (quotes, line_items, tasks, assignment_rules, catalog_items, quote_templates, template_items, acceptance_tokens, lead_scoring_rules + opp columns)");
}
