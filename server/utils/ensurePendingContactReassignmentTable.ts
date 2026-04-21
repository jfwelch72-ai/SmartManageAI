import { logError } from "./logger";
import { pool } from "../db";

export async function ensurePendingContactReassignmentTable(): Promise<void> {
  try {
    const { rows } = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'pending_contact_reassignment_notifications'
      ) AS exists
    `);
    const alreadyExists = rows[0]?.exists === true;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_contact_reassignment_notifications (
        recipient_user_id VARCHAR PRIMARY KEY,
        organization_id VARCHAR,
        additional_count INTEGER NOT NULL DEFAULT 0,
        reassigner_names TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        first_additional_contact_id VARCHAR,
        window_started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        flush_at TIMESTAMP NOT NULL
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS pending_contact_reassignment_flush_at_idx
      ON pending_contact_reassignment_notifications (flush_at);
    `);
    console.log(alreadyExists
      ? "[migration] pending_contact_reassignment_notifications table — already present, skipped"
      : "[migration] pending_contact_reassignment_notifications table — created");
  } catch (err) {
    logError(
      "[migration] Failed to ensure pending_contact_reassignment_notifications table:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
