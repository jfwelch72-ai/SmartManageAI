import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Ensure CRM Sequences/Cadences tables, enums, and indexes exist.
 * Idempotent — safe to run on every cold start.
 */
export async function ensureSequenceTables(): Promise<void> {
  // Enum definitions MUST match shared/schema/enums.ts exactly.
  const enums: Record<string, string[]> = {
    crm_sequence_status: ["DRAFT", "ACTIVE", "ARCHIVED"],
    crm_sequence_step_type: ["AUTOMATED_EMAIL", "MANUAL_EMAIL", "CALL_TASK", "LINKEDIN_TASK", "TODO"],
    crm_sequence_enrollment_status: ["ACTIVE", "PAUSED", "REPLIED", "BOUNCED", "FINISHED", "REMOVED"],
    crm_sequence_execution_status: ["PENDING", "SENT", "COMPLETED", "SKIPPED", "FAILED", "BOUNCED"],
    crm_sequence_email_event_type: ["OPEN", "CLICK", "REPLY", "BOUNCE"],
    crm_sequence_exit_reason: ["REPLIED", "OPPORTUNITY_WON", "OPPORTUNITY_LOST", "MANUAL_REMOVE", "BOUNCED", "COMPLETED"],
  };
  for (const [name, values] of Object.entries(enums)) {
    const valuesSql = values.map((v) => `'${v}'`).join(",");
    await db.execute(
      sql.raw(
        `DO $$ BEGIN CREATE TYPE "${name}" AS ENUM (${valuesSql}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      ),
    );
    // For pre-existing enums missing newer values (e.g. environments created
    // by an earlier rev of this migration), add each value idempotently.
    for (const v of values) {
      await db.execute(sql.raw(`ALTER TYPE "${name}" ADD VALUE IF NOT EXISTS '${v}';`));
    }
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_sequences" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "status" "crm_sequence_status" NOT NULL DEFAULT 'DRAFT',
      "owner_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "business_hours_only" boolean NOT NULL DEFAULT true,
      "weekdays_only" boolean NOT NULL DEFAULT true,
      "daily_send_cap" integer NOT NULL DEFAULT 200,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_sequences_org_idx" ON "crm_sequences"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_sequences_status_idx" ON "crm_sequences"("status")`);
  // Task #656 — per-sequence "best-time" send window for send-time optimization.
  await db.execute(sql`ALTER TABLE "crm_sequences" ADD COLUMN IF NOT EXISTS "optimized_send_window_start_hour" integer NOT NULL DEFAULT 9`);
  await db.execute(sql`ALTER TABLE "crm_sequences" ADD COLUMN IF NOT EXISTS "optimized_send_window_end_hour" integer NOT NULL DEFAULT 11`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_sequence_steps" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "sequence_id" varchar NOT NULL REFERENCES "crm_sequences"("id") ON DELETE CASCADE,
      "step_order" integer NOT NULL,
      "step_type" "crm_sequence_step_type" NOT NULL,
      "delay_days" integer NOT NULL DEFAULT 0,
      "send_hour_local" integer NOT NULL DEFAULT 9,
      "subject" text,
      "body" text,
      "instructions" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_sequence_steps_seq_idx" ON "crm_sequence_steps"("sequence_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_sequence_steps_order_idx" ON "crm_sequence_steps"("sequence_id","step_order")`);
  // A/B variants, winner promotion, and per-step send-time optimization opt-in.
  await db.execute(sql`ALTER TABLE "crm_sequence_steps" ADD COLUMN IF NOT EXISTS "variant_group" text`);
  await db.execute(sql`ALTER TABLE "crm_sequence_steps" ADD COLUMN IF NOT EXISTS "is_winner" boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE "crm_sequence_steps" ADD COLUMN IF NOT EXISTS "send_time_optimized" boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE "crm_sequence_steps" ADD COLUMN IF NOT EXISTS "winning_metric" text`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_sequence_steps_variant_idx" ON "crm_sequence_steps"("sequence_id","variant_group")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_sequence_enrollments" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "sequence_id" varchar NOT NULL REFERENCES "crm_sequences"("id") ON DELETE CASCADE,
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE CASCADE,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
      "sender_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "status" "crm_sequence_enrollment_status" NOT NULL DEFAULT 'ACTIVE',
      "current_step_index" integer NOT NULL DEFAULT 0,
      "start_at" timestamp NOT NULL DEFAULT now(),
      "exit_reason" "crm_sequence_exit_reason",
      "exited_at" timestamp,
      "last_activity_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_enroll_org_idx" ON "crm_sequence_enrollments"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_enroll_seq_idx" ON "crm_sequence_enrollments"("sequence_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_enroll_contact_idx" ON "crm_sequence_enrollments"("contact_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_enroll_opp_idx" ON "crm_sequence_enrollments"("opportunity_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_enroll_sender_idx" ON "crm_sequence_enrollments"("sender_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_enroll_status_idx" ON "crm_sequence_enrollments"("status")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_seq_enroll_unique_contact" ON "crm_sequence_enrollments"("sequence_id","contact_id")`);
  // Task #560 — link bounced enrollments to the inbound DSN email so the UI
  // can let users open the underlying bounce notification.
  await db.execute(sql`ALTER TABLE "crm_sequence_enrollments" ADD COLUMN IF NOT EXISTS "bounce_email_message_id" varchar`);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "crm_sequence_enrollments"
        ADD CONSTRAINT "crm_seq_enroll_bounce_email_fk"
        FOREIGN KEY ("bounce_email_message_id") REFERENCES "email_messages"("id") ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_sequence_step_executions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "enrollment_id" varchar NOT NULL REFERENCES "crm_sequence_enrollments"("id") ON DELETE CASCADE,
      "step_id" varchar NOT NULL REFERENCES "crm_sequence_steps"("id") ON DELETE CASCADE,
      "step_order" integer NOT NULL,
      "scheduled_at" timestamp NOT NULL,
      "sent_at" timestamp,
      "completed_at" timestamp,
      "task_id" varchar,
      "status" "crm_sequence_execution_status" NOT NULL DEFAULT 'PENDING',
      "error_message" text,
      "open_count" integer NOT NULL DEFAULT 0,
      "click_count" integer NOT NULL DEFAULT 0,
      "replied_at" timestamp,
      "bounced_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  // Add task_id FK if missing (separate to avoid circular create order issues)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "crm_sequence_step_executions"
        ADD CONSTRAINT "crm_seq_exec_task_fk"
        FOREIGN KEY ("task_id") REFERENCES "crm_tasks"("id") ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_exec_org_idx" ON "crm_sequence_step_executions"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_exec_enroll_idx" ON "crm_sequence_step_executions"("enrollment_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_exec_step_idx" ON "crm_sequence_step_executions"("step_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_exec_scheduled_idx" ON "crm_sequence_step_executions"("scheduled_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_exec_status_idx" ON "crm_sequence_step_executions"("status")`);

  // Retry/backoff: track attempt count for failed automated email steps.
  await db.execute(sql`ALTER TABLE "crm_sequence_step_executions" ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE "crm_sequence_step_executions" ADD COLUMN IF NOT EXISTS "outbound_message_id" text`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_exec_outbound_msgid_idx" ON "crm_sequence_step_executions"("outbound_message_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_sequence_email_events" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "execution_id" varchar NOT NULL REFERENCES "crm_sequence_step_executions"("id") ON DELETE CASCADE,
      "event_type" "crm_sequence_email_event_type" NOT NULL,
      "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "occurred_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_email_events_exec_idx" ON "crm_sequence_email_events"("execution_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_seq_email_events_type_idx" ON "crm_sequence_email_events"("event_type")`);

  logInfo("[migration] crm_sequence_tables ready");
}
