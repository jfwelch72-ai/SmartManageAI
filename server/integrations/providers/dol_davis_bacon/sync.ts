import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationConnections, integrationSyncState } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { logInfo, logError, logWarn } from "../../../utils/logger";
import { safeFetch } from "../../../utils/safeFetch";
import { decryptMetadata } from "../../encryption";
import { insertNotification } from "../../../services/notificationService";

const SAM_BASE = "https://api.sam.gov/prod";

export interface DavisBaconWageRate {
  classification: string;
  baseRate: number;
  fringeRate: number;
  totalRate: number;
  health?: number;
  pension?: number;
  vacation?: number;
  training?: number;
}

export interface WageDetermination {
  decisionNumber: string;
  state?: string;
  county?: string;
  constructionType?: string;
  effectiveDate?: string;
  rates: DavisBaconWageRate[];
}

interface SamWageRow {
  classification?: string;
  baseRate?: number | string;
  fringeRate?: number | string;
  health?: number | string;
  pension?: number | string;
  vacation?: number | string;
  training?: number | string;
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) ? n : 0;
}

async function samFetch(url: string, apiKey: string): Promise<unknown> {
  const u = new URL(url);
  u.searchParams.set("api_key", apiKey);
  const resp = await safeFetch(u.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`SAM.gov API error ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

/**
 * Fetch a wage determination by decision number (e.g. "CA20240001"). For orgs
 * without a SAM.gov key configured we throw a clear error so callers can
 * surface the missing-credential state.
 */
export async function fetchWageDetermination(
  connection: IntegrationConnection,
  decisionNumber: string
): Promise<WageDetermination> {
  const meta = (connection.metadata as Record<string, any>) || {};
  const apiKey = meta.apiKey || meta.accessToken;
  if (!apiKey) throw new Error("SAM.gov API key not configured on connection");

  const data = await samFetch(`${SAM_BASE}/wagedeterminations/v1/details/${encodeURIComponent(decisionNumber)}`, apiKey) as { wageDetermination?: { rates?: unknown }; rates?: unknown };
  const det = data?.wageDetermination ?? data ?? {};
  const rows: SamWageRow[] = Array.isArray((det as { rates?: unknown }).rates) ? ((det as { rates: SamWageRow[] }).rates) : [];

  const rates: DavisBaconWageRate[] = rows.map((r) => {
    const base = num(r.baseRate);
    const health = num(r.health);
    const pension = num(r.pension);
    const vacation = num(r.vacation);
    const training = num(r.training);
    const fringe = num(r.fringeRate) || health + pension + vacation + training;
    return {
      classification: String(r.classification ?? "Unspecified"),
      baseRate: base,
      fringeRate: fringe,
      totalRate: base + fringe,
      health,
      pension,
      vacation,
      training,
    };
  });

  return {
    decisionNumber,
    state: det.state ?? undefined,
    county: det.county ?? undefined,
    constructionType: det.constructionType ?? undefined,
    effectiveDate: det.effectiveDate ?? undefined,
    rates,
  };
}

/**
 * Cache a wage determination in integration_sync_state so subsequent payroll
 * runs can resolve prevailing rates without hitting SAM.gov again.
 */
export async function importWageDetermination(
  connection: IntegrationConnection,
  decisionNumber: string,
  dryRun = false
): Promise<SyncResult> {
  const errors: SyncError[] = [];
  try {
    const det = await fetchWageDetermination(connection, decisionNumber);

    if (!dryRun) {
      const payload = { ...det, importedAt: new Date().toISOString() };
      // Task #1332: clear any prior failure state so a successful import
      // implicitly resolves the "auto-sync failed" notification/banner.
      await upsertWageDecisionSyncState(connection, decisionNumber, {
        metadata: payload,
        lastSyncAt: new Date(),
        lastError: null,
      });
    }

    logInfo("Davis-Bacon wage determination imported", { decisionNumber, rates: det.rates.length, dryRun });
    return {
      success: true,
      entityType: "wage_determination",
      direction: "import",
      created: det.rates.length,
      updated: 0,
      skipped: 0,
      errors,
    };
  } catch (err) {
    logError("Davis-Bacon import failed", { error: String(err), decisionNumber });
    errors.push({ message: String(err) });
    if (!dryRun) {
      // Task #1332: persist the failure so the project payroll banner can
      // surface it and a follow-up retry / successful sync naturally clears
      // it via the success branch above.
      try {
        await upsertWageDecisionSyncState(connection, decisionNumber, {
          lastError: String(err).slice(0, 1000),
        });
      } catch (recordErr) {
        logWarn("Davis-Bacon failed-attempt persistence failed", {
          decisionNumber,
          error: String(recordErr),
        });
      }
    }
    return { success: false, entityType: "wage_determination", direction: "import", created: 0, updated: 0, skipped: 0, errors };
  }
}

/**
 * Upsert the per-decision row in `integration_sync_state` and stamp the
 * "last attempt" tracking columns added in Task #1332. Always bumps
 * `lastAttemptAt` so the UI can show "last tried X minutes ago" even if
 * neither metadata nor lastError changed. Caller passes `lastError: null`
 * on success to clear any prior failure, or a string on failure.
 */
async function upsertWageDecisionSyncState(
  connection: IntegrationConnection,
  decisionNumber: string,
  patch: { metadata?: unknown; lastSyncAt?: Date; lastError?: string | null },
): Promise<void> {
  const entityType = `wage_determination:${decisionNumber}`;
  const [existing] = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, entityType),
      ),
    );
  const now = new Date();
  if (existing) {
    const update: Record<string, unknown> = {
      lastAttemptAt: now,
      updatedAt: now,
    };
    if (patch.metadata !== undefined) update.metadata = patch.metadata;
    if (patch.lastSyncAt !== undefined) update.lastSyncAt = patch.lastSyncAt;
    if (patch.lastError !== undefined) update.lastError = patch.lastError;
    await db
      .update(integrationSyncState)
      .set(update as any)
      .where(eq(integrationSyncState.id, existing.id));
  } else {
    await db.insert(integrationSyncState).values({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      entityType,
      metadata: (patch.metadata ?? null) as any,
      lastSyncAt: patch.lastSyncAt ?? null,
      lastAttemptAt: now,
      lastError: patch.lastError ?? null,
    });
  }
}

/**
 * Returns the persisted last-attempt status for an org's wage decision.
 * Used by the project payroll summary endpoint so the UI can show the
 * most recent auto-sync timestamp and any error per decision number.
 */
export async function getWageDecisionSyncStatus(
  organizationId: string,
  decisionNumber: string,
): Promise<{ lastSyncAt: Date | null; lastAttemptAt: Date | null; lastError: string | null } | null> {
  const entityType = `wage_determination:${decisionNumber}`;
  const [row] = await db
    .select({
      lastSyncAt: integrationSyncState.lastSyncAt,
      lastAttemptAt: integrationSyncState.lastAttemptAt,
      lastError: integrationSyncState.lastError,
    })
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.organizationId, organizationId),
        eq(integrationSyncState.entityType, entityType),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    lastSyncAt: row.lastSyncAt ?? null,
    lastAttemptAt: row.lastAttemptAt ?? null,
    lastError: row.lastError ?? null,
  };
}

/**
 * Look up a cached wage rate for a classification under a given decision.
 * Used by the WH-347 generator as a fallback when no per-project
 * `prevailingWageRates` row is present. Returns null if not connected,
 * not cached, or classification not found.
 */
/**
 * Locale-based lookup. Used by WH-347 generation when the project has no
 * explicit wageDecision row but is bound to a state/county. Scans every
 * cached wage determination for the org, picks the most recent one matching
 * the locale, and returns the rate for the given classification.
 */
export async function lookupCachedRateByLocale(
  organizationId: string,
  state: string | null | undefined,
  county: string | null | undefined,
  classification: string,
): Promise<DavisBaconWageRate | null> {
  if (!state && !county) return null;
  const rows = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.organizationId, organizationId),
        sql`${integrationSyncState.entityType} LIKE 'wage_determination:%'`,
      ),
    );
  const norm = classification.trim().toLowerCase();
  const stateKey = (state ?? "").trim().toUpperCase();
  const countyKey = (county ?? "").trim().toLowerCase();
  // Sort newest first by lastSyncAt
  rows.sort((a, b) => (b.lastSyncAt?.getTime() ?? 0) - (a.lastSyncAt?.getTime() ?? 0));
  for (const row of rows) {
    const meta = row.metadata as WageDetermination | undefined;
    if (!meta || !Array.isArray(meta.rates)) continue;
    const rState = (meta.state ?? "").trim().toUpperCase();
    const rCounty = (meta.county ?? "").trim().toLowerCase();
    const stateMatch = !stateKey || !rState || rState === stateKey;
    const countyMatch = !countyKey || !rCounty || rCounty === countyKey;
    if (!stateMatch || !countyMatch) continue;
    const hit = meta.rates.find((r) => r.classification.trim().toLowerCase() === norm);
    if (hit) return hit;
  }
  return null;
}

/**
 * Returns true if a wage determination with the given decision number has
 * been imported and cached for the org. The WH-347 flow uses this to surface
 * a UI warning when a project references a wage decision that has not yet
 * been pulled from the DOL/SAM.gov feed.
 */
export async function isWageDeterminationCached(
  organizationId: string,
  decisionNumber: string,
): Promise<boolean> {
  const entityType = `wage_determination:${decisionNumber}`;
  const [row] = await db
    .select({ id: integrationSyncState.id })
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.organizationId, organizationId),
        eq(integrationSyncState.entityType, entityType),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Return every classification carried by a cached wage determination, or
 * null if the determination has not been imported for the org. Used by the
 * project prevailing-wage panel to surface the full Davis-Bacon table on
 * brand-new projects that have a wage decision set but no time entries
 * logged yet (so the per-employee DOL_FEED resolution path has nothing
 * to anchor on).
 */
export async function listCachedDecisionClassifications(
  organizationId: string,
  decisionNumber: string,
): Promise<DavisBaconWageRate[] | null> {
  const entityType = `wage_determination:${decisionNumber}`;
  const [state] = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.organizationId, organizationId),
        eq(integrationSyncState.entityType, entityType),
      ),
    )
    .limit(1);
  const meta = state?.metadata as WageDetermination | undefined;
  if (!meta || !Array.isArray(meta.rates)) return null;
  return meta.rates;
}

export async function lookupCachedWageRate(
  organizationId: string,
  decisionNumber: string,
  classification: string
): Promise<DavisBaconWageRate | null> {
  const entityType = `wage_determination:${decisionNumber}`;
  const [state] = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.organizationId, organizationId),
        eq(integrationSyncState.entityType, entityType)
      )
    )
    .limit(1);
  const meta = state?.metadata as WageDetermination | undefined;
  if (!meta || !Array.isArray(meta.rates)) return null;
  const norm = classification.trim().toLowerCase();
  return (
    meta.rates.find((r) => r.classification.trim().toLowerCase() === norm) ?? null
  );
}

/**
 * Find the org's active Davis-Bacon integration connection. Returns null if
 * the org has no connected (or active) connection. Caller should treat null
 * as "cannot auto-sync" and surface the unimported state instead.
 */
async function getActiveDavisBaconConnection(
  organizationId: string,
): Promise<IntegrationConnection | null> {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.provider, "dol_davis_bacon" as any),
        eq(integrationConnections.status, "active" as any),
      ),
    )
    .limit(1);
  if (!row) return null;
  const meta = (row.metadata as Record<string, any>) || {};
  return { ...row, metadata: decryptMetadata(meta) } as IntegrationConnection;
}

export type WageDecisionSyncQueueResult =
  | { status: "cached" }
  | { status: "no_connection" }
  | { status: "no_credentials" }
  | { status: "queued" }
  | { status: "completed"; result: SyncResult }
  | { status: "failed"; error: string };

/**
 * Auto-trigger a Davis-Bacon sync for `decisionNumber`. Used when a project
 * is created/edited and references a decision that hasn't been imported yet,
 * and by the certified-payroll "Import now" inline action.
 *
 * - Returns `cached` if the determination is already in the local cache.
 * - Returns `no_connection`/`no_credentials` if the org cannot reach SAM.gov.
 * - When `awaitResult` is true, runs the import inline and returns the
 *   SyncResult so the caller can show success/failure feedback (used by the
 *   inline button). Otherwise schedules it as a fire-and-forget background
 *   task and returns `queued` (used by the project create/update path so the
 *   request isn't blocked on a slow SAM.gov fetch).
 */
export async function queueWageDecisionSync(
  organizationId: string,
  decisionNumber: string,
  opts: { awaitResult?: boolean } = {},
): Promise<WageDecisionSyncQueueResult> {
  const decision = (decisionNumber || "").trim();
  if (!decision) return { status: "no_credentials" };

  if (await isWageDeterminationCached(organizationId, decision)) {
    return { status: "cached" };
  }

  const connection = await getActiveDavisBaconConnection(organizationId);
  if (!connection) {
    logInfo("Skipping Davis-Bacon auto-sync: no active connection", { organizationId, decision });
    return { status: "no_connection" };
  }
  const meta = (connection.metadata as Record<string, any>) || {};
  if (!meta.apiKey && !meta.accessToken) {
    logInfo("Skipping Davis-Bacon auto-sync: missing API key", { organizationId, decision });
    return { status: "no_credentials" };
  }

  if (opts.awaitResult) {
    try {
      const result = await importWageDetermination(connection, decision, false);
      return { status: "completed", result };
    } catch (err) {
      logError("Davis-Bacon auto-sync failed", { decision, organizationId, error: String(err) });
      return { status: "failed", error: String(err) };
    }
  }

  // Fire-and-forget: kick off the import without blocking the caller.
  // importWageDetermination persists success/failure state on the
  // integration_sync_state row (Task #1332) so the project payroll banner
  // and the failure-notification path below can surface what happened.
  void importWageDetermination(connection, decision, false)
    .then(async (result) => {
      if (!result.success) {
        logWarn("Davis-Bacon background sync returned errors", {
          decision,
          organizationId,
          errors: result.errors,
        });
        const errMsg = result.errors.map((e) => e.message).join("; ") || "Sync failed";
        await notifyDavisBaconAutoSyncFailure(connection, decision, errMsg);
      } else {
        logInfo("Davis-Bacon background sync completed", { decision, organizationId });
      }
    })
    .catch(async (err) => {
      logError("Davis-Bacon background sync threw", { decision, organizationId, error: String(err) });
      await notifyDavisBaconAutoSyncFailure(connection, decision, String(err));
    });

  return { status: "queued" };
}

/**
 * Task #1332: in-app notification to the integration owner when an
 * automatic Davis-Bacon sync queued during project create/update fails.
 * Routed to `integration_connections.created_by_user_id` so the admin who
 * connected SAM.gov hears about it; if the connection has no owner on
 * file we fall back to logging only since there is no per-org "integration
 * admin" group to fan out to.
 */
async function notifyDavisBaconAutoSyncFailure(
  connection: IntegrationConnection,
  decisionNumber: string,
  errorMessage: string,
): Promise<void> {
  const ownerUserId = connection.createdByUserId;
  if (!ownerUserId) {
    logWarn("Davis-Bacon auto-sync failed but connection has no owner to notify", {
      decisionNumber,
      connectionId: connection.id,
    });
    return;
  }
  try {
    await insertNotification({
      userId: ownerUserId,
      organizationId: connection.organizationId,
      type: "DAVIS_BACON_AUTO_SYNC_FAILED" as any,
      title: "Davis-Bacon auto-sync failed",
      message:
        `Automatic sync for wage decision ${decisionNumber} failed: ` +
        `${errorMessage.slice(0, 300)}. Open the project's payroll tab to retry.`,
      relatedEntityId: connection.id,
      relatedEntityType: "INTEGRATION_CONNECTION",
    });
  } catch (err) {
    logError(
      "Failed to deliver Davis-Bacon auto-sync failure notification",
      { decisionNumber, connectionId: connection.id },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
