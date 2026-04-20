import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Ensure CRM Enhancement Tables: quotes/proposals, tasks/reminders, auto-assignment rules.
 * Idempotent — safe to run on every cold start.
 */
export async function ensureCrmEnhancementTables(): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'crm_quotes') AS quotes_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'crm_quote_line_items') AS quote_items_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'crm_tasks') AS tasks_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'crm_assignment_rules') AS rules_exist
  `);

  const row = result.rows[0] as Record<string, boolean>;
  if (row.quotes_exist && row.quote_items_exist && row.tasks_exist && row.rules_exist) {
    console.log("[migration] crm_enhancement_tables — all 4 tables already present, skipped");
    return;
  }

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

  console.log("[migration] crm_enhancement_tables — created (4 tables: quotes, line_items, tasks, assignment_rules)");
}
