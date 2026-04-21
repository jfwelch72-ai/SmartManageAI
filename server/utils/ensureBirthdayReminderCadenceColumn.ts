import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #698: per-user CRM contact birthday reminder cadence.
 * Adds the `birthday_reminder_cadence` enum + column on
 * `notification_channel_prefs`. Idempotent.
 */
export async function ensureBirthdayReminderCadenceColumn(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE birthday_reminder_cadence AS ENUM ('OFF', 'DAILY_TODAY', 'DAILY_LOOKAHEAD', 'WEEKLY');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await db.execute(sql`
    ALTER TABLE "notification_channel_prefs"
    ADD COLUMN IF NOT EXISTS "birthday_reminder_cadence" birthday_reminder_cadence NOT NULL DEFAULT 'DAILY_LOOKAHEAD'
  `);
}
