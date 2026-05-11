import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Task #2780 — In-app demo request form.
 *
 * Idempotent startup helper that mirrors `migrations/0115_demo_requests.sql`:
 * creates the `demo_requests` table used to capture demo enquiries submitted
 * via the landing page form (replaces the previous Calendly external link).
 */
export async function ensureDemoRequestsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS demo_requests (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        company TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        preferred_time TEXT,
        org_source TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS demo_requests_email_idx ON demo_requests(email)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS demo_requests_created_at_idx ON demo_requests(created_at DESC)`);

    logInfo("[migration] demo_requests table ready");
  } catch (err) {
    logError(err, { helper: "ensureDemoRequestsTable" });
    throw err;
  }
}
