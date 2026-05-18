/**
 * Task #2948 — Startup helper for the org_ai_keys table.
 * Creates the table + unique constraint + index if not already present.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

export async function ensureOrgAiKeys(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS org_ai_keys (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic')),
        encrypted_key TEXT NOT NULL,
        key_hint VARCHAR(4) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (organization_id, provider)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS org_ai_keys_org_idx ON org_ai_keys (organization_id)
    `);
    logInfo("[ensureOrgAiKeys] org_ai_keys table ready");
  } catch (err) {
    logError(
      "[ensureOrgAiKeys] Failed to create org_ai_keys table",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
