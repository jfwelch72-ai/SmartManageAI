import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2689 — GCS-first atomic closeout export.
 *
 * Adds the `checksum` (sha256 hex) and `completed_at` (transition-to-READY
 * timestamp) columns on `closeout_packages`. Both nullable because BUILDING
 * and FAILED rows do not carry them; READY rows MUST carry both.
 */
export async function ensureCloseoutPackagesAtomicColumns(): Promise<void> {
  await db.execute(sql`ALTER TABLE closeout_packages ADD COLUMN IF NOT EXISTS checksum TEXT`);
  await db.execute(sql`ALTER TABLE closeout_packages ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
  logInfo("[migration] closeout_packages.checksum/completed_at — table ready");
}
