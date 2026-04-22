import { pool } from "../db";

// Task #798 — Mobile SSO handoff. Exchange codes are short-lived
// single-use tokens that the system browser hands back to the native app
// via the smartmanageai:// deep link. The app then redeems the code for a
// JWT. Storing them in Postgres (vs. process memory) ensures redemption
// works across multi-instance deployments and survives restarts within
// the brief 60-second TTL window.
export async function ensureMobileExchangeCodes(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS mobile_exchange_codes (
        code TEXT PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_version INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS mobile_exchange_codes_expires_idx
        ON mobile_exchange_codes (expires_at);
    `);
  } finally {
    client.release();
  }
}
