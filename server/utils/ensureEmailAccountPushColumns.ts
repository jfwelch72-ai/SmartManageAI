import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #524: Add columns to email_accounts that track Gmail watch +
 * Outlook Graph subscription state for real-time push notifications.
 */
export async function ensureEmailAccountPushColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE email_accounts
        ADD COLUMN IF NOT EXISTS gmail_watch_expiration TIMESTAMP,
        ADD COLUMN IF NOT EXISTS gmail_watch_history_id TEXT,
        ADD COLUMN IF NOT EXISTS outlook_subscription_id TEXT,
        ADD COLUMN IF NOT EXISTS outlook_subscription_expiration TIMESTAMP,
        ADD COLUMN IF NOT EXISTS outlook_subscription_client_state TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS email_accounts_outlook_sub_idx
        ON email_accounts (outlook_subscription_id)
    `);
    logInfo("[migration] email_accounts push subscription columns ready");
  } catch (err) {
    logError(
      "[migration] ensureEmailAccountPushColumns failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
