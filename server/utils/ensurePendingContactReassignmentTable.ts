import { logInfo } from "./logger";
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
        kind VARCHAR NOT NULL DEFAULT 'contact',
        recipient_user_id VARCHAR NOT NULL,
        organization_id VARCHAR,
        additional_count INTEGER NOT NULL DEFAULT 0,
        reassigner_names TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        first_additional_contact_id VARCHAR,
        window_started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        flush_at TIMESTAMP NOT NULL,
        PRIMARY KEY (kind, recipient_user_id)
      );
    `);
    // Task #723: extend the existing single-PK table to a composite (kind,
    // recipient_user_id) PK so opportunity/project owner reassignments share
    // the same persistence layer. Idempotent — a fresh install gets the new
    // shape via CREATE TABLE; an existing deployment is upgraded here.
    await pool.query(`
      ALTER TABLE pending_contact_reassignment_notifications
      ADD COLUMN IF NOT EXISTS kind VARCHAR NOT NULL DEFAULT 'contact';
    `);
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'pending_contact_reassignment_notifications'
            AND c.contype = 'p'
            AND (
              SELECT array_agg(a.attname::text ORDER BY a.attnum)
              FROM unnest(c.conkey) AS k(attnum)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            ) = ARRAY['recipient_user_id']::text[]
        ) THEN
          ALTER TABLE pending_contact_reassignment_notifications
            DROP CONSTRAINT pending_contact_reassignment_notifications_pkey;
          ALTER TABLE pending_contact_reassignment_notifications
            ADD PRIMARY KEY (kind, recipient_user_id);
        END IF;
      END
      $$;
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS pending_contact_reassignment_flush_at_idx
      ON pending_contact_reassignment_notifications (flush_at);
    `);
    logInfo(alreadyExists
      ? "[migration] pending_contact_reassignment_notifications table — already present, ensured kind/PK shape"
      : "[migration] pending_contact_reassignment_notifications table — created");
  } catch (err) {
    logError(
      "[migration] Failed to ensure pending_contact_reassignment_notifications table:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
