import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureWorkflowTables(): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'workflow_templates') AS templates_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'workflow_stages') AS stages_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'workflow_approval_steps') AS approval_steps_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'workflow_notification_rules') AS notification_rules_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'workflow_instances') AS instances_exist
  `);

  const row = result.rows[0] as Record<string, boolean>;
  const allExist = row.templates_exist && row.stages_exist && row.approval_steps_exist && row.notification_rules_exist && row.instances_exist;

  if (allExist) {
    console.log("[migration] workflow tables — already present, skipped");
    return;
  }

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "workflow_entity_type" AS ENUM ('CHANGE_ORDER', 'SOV_PAY_APP', 'TIME_APPROVAL', 'PURCHASE_ORDER', 'PURCHASE_REQUEST', 'VENDOR_BILL', 'TM_TICKET');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "workflow_template_status" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "workflow_instance_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "workflow_notification_channel" AS ENUM ('EMAIL', 'PUSH', 'SMS', 'SLACK', 'TEAMS');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  if (!row.templates_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workflow_templates" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" VARCHAR NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "entity_type" "workflow_entity_type" NOT NULL,
        "status" "workflow_template_status" NOT NULL DEFAULT 'DRAFT',
        "is_default" BOOLEAN NOT NULL DEFAULT false,
        "created_by_id" VARCHAR NOT NULL REFERENCES "users"("id"),
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  if (!row.stages_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workflow_stages" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "template_id" VARCHAR NOT NULL REFERENCES "workflow_templates"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "stage_order" INTEGER NOT NULL,
        "color" TEXT DEFAULT '#6366f1',
        "allowed_transitions" JSON DEFAULT '[]',
        "is_initial" BOOLEAN NOT NULL DEFAULT false,
        "is_final" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  if (!row.approval_steps_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workflow_approval_steps" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "stage_id" VARCHAR NOT NULL REFERENCES "workflow_stages"("id") ON DELETE CASCADE,
        "required_role" TEXT,
        "required_user_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "required_approval_count" INTEGER NOT NULL DEFAULT 1,
        "step_order" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  if (!row.notification_rules_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workflow_notification_rules" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "stage_id" VARCHAR NOT NULL REFERENCES "workflow_stages"("id") ON DELETE CASCADE,
        "trigger_on_enter" BOOLEAN NOT NULL DEFAULT true,
        "trigger_on_exit" BOOLEAN NOT NULL DEFAULT false,
        "channel" "workflow_notification_channel" NOT NULL DEFAULT 'EMAIL',
        "recipient_role" TEXT,
        "recipient_user_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "notify_submitter" BOOLEAN NOT NULL DEFAULT false,
        "message_template" TEXT,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  if (!row.instances_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workflow_instances" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "template_id" VARCHAR NOT NULL REFERENCES "workflow_templates"("id") ON DELETE CASCADE,
        "organization_id" VARCHAR NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "entity_type" "workflow_entity_type" NOT NULL,
        "entity_id" VARCHAR NOT NULL,
        "current_stage_id" VARCHAR REFERENCES "workflow_stages"("id") ON DELETE SET NULL,
        "status" "workflow_instance_status" NOT NULL DEFAULT 'IN_PROGRESS',
        "started_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "completed_at" TIMESTAMP,
        "started_by_user_id" VARCHAR REFERENCES "users"("id"),
        "pending_approvals" JSON DEFAULT '[]',
        "history" JSON DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_templates_org_idx" ON "workflow_templates"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_templates_entity_type_idx" ON "workflow_templates"("entity_type")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_templates_status_idx" ON "workflow_templates"("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_stages_template_idx" ON "workflow_stages"("template_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_stages_order_idx" ON "workflow_stages"("template_id", "stage_order")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_approval_steps_stage_idx" ON "workflow_approval_steps"("stage_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_notification_rules_stage_idx" ON "workflow_notification_rules"("stage_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_instances_template_idx" ON "workflow_instances"("template_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_instances_org_idx" ON "workflow_instances"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_instances_entity_idx" ON "workflow_instances"("entity_type", "entity_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_instances_status_idx" ON "workflow_instances"("status")`);

  console.log("[migration] workflow tables — created successfully");
}
