import { db } from "../db";
import { sql } from "drizzle-orm";
import { inferTimezoneFromUSState } from "@shared/timezones";
import { logInfo, logError } from "./logger";

export interface BackfillOptions {
  /**
   * When provided, restrict the backfill to a single tenant
   * (`crm_contacts.organization_id`). When omitted the backfill runs
   * across every organisation — only the startup migration / SUPER_ADMIN
   * triggers should call it without an orgId.
   */
  orgId?: string | null;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  /** Rows updated by inferring from the parent crm_organisation's state. */
  fromOrgState: number;
  /** Rows updated by falling back to a contact-level state/address column
   *  (only present in legacy schemas; detected at runtime). */
  fromContactState: number;
}

/**
 * Detect (once per process) whether legacy contact-level address columns
 * exist on `crm_contacts`. The current Drizzle schema only has org-level
 * address fields, but customers migrated from older builds may still have
 * `state` / `address` columns on the contact row that we should honour as
 * a secondary signal.
 */
let cachedContactAddressColumns:
  | { state: boolean; address: boolean; city: boolean }
  | null = null;

async function detectContactAddressColumns(): Promise<{
  state: boolean;
  address: boolean;
  city: boolean;
}> {
  if (cachedContactAddressColumns) return cachedContactAddressColumns;
  const res = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_contacts'
      AND column_name IN ('state', 'address', 'city')
  `);
  const cols = new Set<string>(
    ((res.rows ?? []) as Array<{ column_name: string }>).map((r) => r.column_name),
  );
  cachedContactAddressColumns = {
    state: cols.has("state"),
    address: cols.has("address"),
    city: cols.has("city"),
  };
  return cachedContactAddressColumns;
}

async function applyUpdates(
  ids: string[],
  tz: string,
): Promise<number> {
  if (!ids.length) return 0;
  let updated = 0;
  const BATCH = 1000;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const res = await db.execute(sql`
      UPDATE crm_contacts
      SET timezone = ${tz}, updated_at = NOW()
      WHERE timezone IS NULL
        AND id = ANY(${slice}::varchar[])
    `);
    updated += res.rowCount ?? 0;
  }
  return updated;
}

/**
 * Backfill `crm_contacts.timezone` for rows where it is NULL.
 *
 * Lookup order:
 *   1. Parent crm_organisation `state` column.
 *   2. Legacy contact-level `state` column (if present in this database).
 *
 * Always idempotent — only NULL timezones are touched. Optionally scoped to
 * a single organization via `options.orgId`.
 */
export async function backfillCrmContactTimezones(
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const orgId = options.orgId ?? null;

  // ---- Pass 1: infer from parent organisation's state ---------------------
  const orgScopedSql = orgId
    ? sql`AND c.organization_id = ${orgId}`
    : sql``;

  const orgRowsRes = await db.execute(sql`
    SELECT c.id AS id, o.state AS state
    FROM crm_contacts c
    JOIN crm_organisations o ON o.id = c.organisation_id
    WHERE c.timezone IS NULL
      AND o.state IS NOT NULL
      AND btrim(o.state) <> ''
      ${orgScopedSql}
  `);
  const orgRows = (orgRowsRes.rows ?? []) as Array<{
    id: string;
    state: string | null;
  }>;
  let scanned = orgRows.length;

  const orgByTz = new Map<string, string[]>();
  for (const row of orgRows) {
    const tz = inferTimezoneFromUSState(row.state);
    if (!tz) continue;
    let bucket = orgByTz.get(tz);
    if (!bucket) {
      bucket = [];
      orgByTz.set(tz, bucket);
    }
    bucket.push(row.id);
  }

  let fromOrgState = 0;
  for (const [tz, ids] of orgByTz) {
    fromOrgState += await applyUpdates(ids, tz);
  }

  // ---- Pass 2: legacy contact-level address fallback ----------------------
  let fromContactState = 0;
  const cols = await detectContactAddressColumns();
  if (cols.state) {
    const contactRowsRes = await db.execute(sql`
      SELECT c.id AS id, c.state AS state
      FROM crm_contacts c
      WHERE c.timezone IS NULL
        AND c.state IS NOT NULL
        AND btrim(c.state) <> ''
        ${orgScopedSql}
    `);
    const contactRows = (contactRowsRes.rows ?? []) as Array<{
      id: string;
      state: string | null;
    }>;
    scanned += contactRows.length;

    const contactByTz = new Map<string, string[]>();
    for (const row of contactRows) {
      const tz = inferTimezoneFromUSState(row.state);
      if (!tz) continue;
      let bucket = contactByTz.get(tz);
      if (!bucket) {
        bucket = [];
        contactByTz.set(tz, bucket);
      }
      bucket.push(row.id);
    }
    for (const [tz, ids] of contactByTz) {
      fromContactState += await applyUpdates(ids, tz);
    }
  }

  const updated = fromOrgState + fromContactState;
  logInfo(
    `[migration] crm_contact_timezone_backfill — scanned ${scanned}, updated ${updated} (org-state ${fromOrgState}, contact-state ${fromContactState})${
      orgId ? ` [org=${orgId}]` : ""
    }`,
  );
  return { scanned, updated, fromOrgState, fromContactState };
}

/**
 * Startup-migration wrapper. Runs the global (cross-tenant) backfill and
 * swallows fatal errors so a slow/large backfill cannot prevent app boot;
 * failures are logged for follow-up.
 */
export async function ensureCrmContactTimezoneBackfill(): Promise<void> {
  try {
    await backfillCrmContactTimezones();
  } catch (err) {
    logError(
      "[migration] crm_contact_timezone_backfill failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
