import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationConnections, integrationSyncState } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { logInfo, logError, logWarn } from "../../../utils/logger";
import { safeFetch } from "../../../utils/safeFetch";
import { decryptMetadata } from "../../encryption";
import { insertNotification } from "../../../services/notificationService";
import {
  SYNC_RETRY_BACKOFF_MINUTES,
  MAX_SYNC_RETRIES,
  processIntegrationSyncRetries,
  registerSyncRetryHandler,
  type SyncRetrySweepResult,
} from "../../syncRetry";

const SAM_BASE = "https://api.sam.gov/prod";

/**
 * Task #1354: scheduled retry backoff for failed Davis-Bacon wage decision
 * syncs. Task #1368 generalised the backoff schedule for every
 * integration; the Davis-Bacon constants now alias the shared helpers in
 * `server/integrations/syncRetry.ts` so we keep one source of truth and
 * the existing Davis-Bacon imports stay valid.
 */
export const WAGE_DECISION_RETRY_BACKOFF_MINUTES = SYNC_RETRY_BACKOFF_MINUTES;
export const MAX_WAGE_DECISION_RETRIES = MAX_SYNC_RETRIES;

function computeNextRetryAt(failureNumber: number, now: Date = new Date()): Date | null {
  // Thin wrapper over the shared helper so existing call sites keep their
  // behaviour. See `computeNextSyncRetryAt` in `server/integrations/syncRetry.ts`.
  const idx = failureNumber - 1;
  if (idx < 0 || idx >= WAGE_DECISION_RETRY_BACKOFF_MINUTES.length) return null;
  return new Date(now.getTime() + WAGE_DECISION_RETRY_BACKOFF_MINUTES[idx] * 60_000);
}

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
      // Task #1354: also reset the scheduled-retry bookkeeping so the
      // background retry job stops chasing this decision.
      // Task #1370: replacing metadata wholesale here naturally drops any
      // persisted failure-notification coalescing state — required so the
      // suppression window doesn't outlive the failure that caused it.
      await upsertWageDecisionSyncState(connection, decisionNumber, {
        metadata: payload,
        lastSyncAt: new Date(),
        lastError: null,
        retryCount: 0,
        nextRetryAt: null,
      });
      // Task #1370: drop the in-memory coalesce entry too, otherwise a new
      // failure shortly after this success would still be considered
      // "inside the suppression window" by the in-memory check.
      failureCoalesceMap.delete(coalesceKey(connection.id, decisionNumber));
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
      // Task #1354: increment retryCount and schedule the next backoff
      // window so the wage-decision retry job picks this up automatically.
      // After MAX_WAGE_DECISION_RETRIES failures we leave nextRetryAt null
      // so the row stops auto-retrying and waits for human action.
      try {
        const existing = await getWageDecisionRow(connection.id, decisionNumber);
        const nextCount = (existing?.retryCount ?? 0) + 1;
        const nextAt = computeNextRetryAt(nextCount);
        if (nextAt === null) {
          logWarn("Davis-Bacon auto-retry exhausted; manual intervention required", {
            decisionNumber,
            connectionId: connection.id,
            attempts: nextCount,
          });
        }
        await upsertWageDecisionSyncState(connection, decisionNumber, {
          lastError: String(err).slice(0, 1000),
          retryCount: nextCount,
          nextRetryAt: nextAt,
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
  patch: {
    metadata?: unknown;
    lastSyncAt?: Date;
    lastError?: string | null;
    retryCount?: number;
    nextRetryAt?: Date | null;
  },
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
    if (patch.retryCount !== undefined) update.retryCount = patch.retryCount;
    if (patch.nextRetryAt !== undefined) update.nextRetryAt = patch.nextRetryAt;
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
      retryCount: patch.retryCount ?? 0,
      nextRetryAt: patch.nextRetryAt ?? null,
    });
  }
}

async function getWageDecisionRow(
  connectionId: string,
  decisionNumber: string,
): Promise<typeof integrationSyncState.$inferSelect | undefined> {
  const entityType = `wage_determination:${decisionNumber}`;
  const [row] = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.connectionId, connectionId),
        eq(integrationSyncState.entityType, entityType),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Returns the persisted last-attempt status for an org's wage decision.
 * Used by the project payroll summary endpoint so the UI can show the
 * most recent auto-sync timestamp and any error per decision number.
 */
export async function getWageDecisionSyncStatus(
  organizationId: string,
  decisionNumber: string,
): Promise<{
  lastSyncAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  retryCount: number;
  nextRetryAt: Date | null;
  retryExhausted: boolean;
  maxRetries: number;
  ratesCached: number;
} | null> {
  const entityType = `wage_determination:${decisionNumber}`;
  const [row] = await db
    .select({
      lastSyncAt: integrationSyncState.lastSyncAt,
      lastAttemptAt: integrationSyncState.lastAttemptAt,
      lastError: integrationSyncState.lastError,
      retryCount: integrationSyncState.retryCount,
      nextRetryAt: integrationSyncState.nextRetryAt,
      metadata: integrationSyncState.metadata,
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
  const retryCount = row.retryCount ?? 0;
  const nextRetryAt = row.nextRetryAt ?? null;
  // Task #1367: a row is "exhausted" when its last attempt failed
  // (lastError set) and there is no scheduled next retry — either because
  // we hit MAX_WAGE_DECISION_RETRIES, or because the failure path otherwise
  // gave up scheduling (nextRetryAt = null).
  const retryExhausted =
    !!row.lastError && nextRetryAt === null && retryCount >= MAX_WAGE_DECISION_RETRIES;
  const meta = row.metadata as WageDetermination | undefined;
  const ratesCached = meta && Array.isArray(meta.rates) ? meta.rates.length : 0;
  return {
    lastSyncAt: row.lastSyncAt ?? null,
    lastAttemptAt: row.lastAttemptAt ?? null,
    lastError: row.lastError ?? null,
    retryCount,
    nextRetryAt,
    retryExhausted,
    maxRetries: MAX_WAGE_DECISION_RETRIES,
    ratesCached,
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
    .select({
      lastSyncAt: integrationSyncState.lastSyncAt,
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
  // A row exists for every attempt (including failures), so existence alone
  // is not enough. Treat the determination as cached only when a successful
  // import has stamped `lastSyncAt` and no `lastError` is currently recorded —
  // otherwise a prior failure would permanently short-circuit retries.
  if (!row) return false;
  if (row.lastError) return false;
  if (!row.lastSyncAt) return false;
  return true;
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
  opts: { awaitResult?: boolean; manualRetry?: boolean } = {},
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

  // Task #1354: when the user explicitly clicks "Retry sync"/"Import now",
  // re-arm the auto-retry chain by clearing any prior retryCount so a
  // subsequent failure starts the backoff schedule from scratch (otherwise
  // a row that already exhausted MAX_WAGE_DECISION_RETRIES would never be
  // picked up by the background retry job again).
  if (opts.manualRetry) {
    try {
      const existing = await getWageDecisionRow(connection.id, decision);
      if (existing && (existing.retryCount > 0 || existing.nextRetryAt)) {
        await upsertWageDecisionSyncState(connection, decision, {
          retryCount: 0,
          nextRetryAt: null,
        });
      }
    } catch (err) {
      logWarn("Davis-Bacon manual-retry reset failed", { decision, error: String(err) });
    }
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
  // Task #1344: also fan an in-app + email notification out to every
  // active org admin (excluding the connection owner who already gets
  // the existing tailored notification via notifyDavisBaconAutoSyncFailure).
  // Uses a dynamic import to avoid a circular dependency
  // (davisBaconAdminNotifications imports isWageDeterminationCached
  // from this module).
  const fanoutToAdmins = async (errMsg: string) => {
    try {
      const { notifyOrgAdminsOfWageDecisionSyncFailure } = await import(
        "../../../services/davisBaconAdminNotifications"
      );
      await notifyOrgAdminsOfWageDecisionSyncFailure({
        organizationId,
        decisionNumber: decision,
        errorMessage: errMsg,
        source: "background_sync",
        excludeUserId: connection.createdByUserId ?? null,
      });
    } catch (err) {
      logWarn("Davis-Bacon admin failure fanout failed", {
        decision,
        organizationId,
        error: String(err),
      });
    }
  };

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
        await fanoutToAdmins(errMsg);
      } else {
        logInfo("Davis-Bacon background sync completed", { decision, organizationId });
      }
    })
    .catch(async (err) => {
      logError("Davis-Bacon background sync threw", { decision, organizationId, error: String(err) });
      await notifyDavisBaconAutoSyncFailure(connection, decision, String(err));
      await fanoutToAdmins(String(err));
    });

  return { status: "queued" };
}

/**
 * Task #1361 — Coalesce repeated Davis-Bacon auto-sync failure
 * notifications per (connection, decision number) so an extended SAM.gov
 * outage or a bad credential can't flood the connection owner with one
 * email per attempt. The first failure goes through immediately; any
 * subsequent failure within the window is suppressed and only counted.
 * When the window expires, the next failure is delivered with a hint at
 * how many attempts were absorbed during the quiet window.
 *
 * Task #1370 — The state is mirrored onto the per-decision row in
 * `integration_sync_state` (under `metadata.failureNotification`) so the
 * suppression window survives server restarts. The in-memory map is kept
 * as a hot cache to avoid a DB round-trip on every failure; on a cold
 * worker we lazily seed it from the persisted value before deciding
 * whether to suppress. A successful sync overwrites the row's metadata
 * wholesale, naturally dropping the persisted notification timestamp.
 */
const COALESCE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface CoalesceState {
  lastNotifiedAt: number;
  suppressedSince: number;
  suppressedCount: number;
}

const failureCoalesceMap = new Map<string, CoalesceState>();

function coalesceKey(connectionId: string, decisionNumber: string): string {
  return `${connectionId}::${decisionNumber}`;
}

/**
 * Task #1370 — Read the persisted coalescing state for a (connection,
 * decision) from the integration_sync_state row's metadata. Returns null
 * when no row exists or no failureNotification key has been written yet.
 */
async function loadPersistedCoalesceState(
  connectionId: string,
  decisionNumber: string,
): Promise<CoalesceState | null> {
  try {
    const row = await getWageDecisionRow(connectionId, decisionNumber);
    const meta = (row?.metadata as Record<string, unknown> | null) ?? null;
    const persisted = meta && typeof meta === "object" ? (meta as Record<string, unknown>).failureNotification : null;
    if (!persisted || typeof persisted !== "object") return null;
    const p = persisted as Record<string, unknown>;
    if (typeof p.lastNotifiedAt !== "number") return null;
    return {
      lastNotifiedAt: p.lastNotifiedAt,
      suppressedSince: typeof p.suppressedSince === "number" ? p.suppressedSince : 0,
      suppressedCount: typeof p.suppressedCount === "number" ? p.suppressedCount : 0,
    };
  } catch (err) {
    logWarn("Davis-Bacon coalesce state load failed", { connectionId, decisionNumber, error: String(err) });
    return null;
  }
}

/**
 * Task #1370 — Persist the coalescing state onto the per-decision row's
 * metadata, merging with any existing wage-determination payload so we
 * don't clobber the cached rates. If the row doesn't exist yet (failure
 * before any successful import), we create a stub row carrying just the
 * failureNotification key.
 */
async function persistCoalesceState(
  connection: IntegrationConnection,
  decisionNumber: string,
  state: CoalesceState,
): Promise<void> {
  const entityType = `wage_determination:${decisionNumber}`;
  try {
    const existing = await getWageDecisionRow(connection.id, decisionNumber);
    const now = new Date();
    if (existing) {
      const baseMeta =
        existing.metadata && typeof existing.metadata === "object"
          ? { ...(existing.metadata as Record<string, unknown>) }
          : {};
      baseMeta.failureNotification = state;
      await db
        .update(integrationSyncState)
        .set({ metadata: baseMeta as any, updatedAt: now })
        .where(eq(integrationSyncState.id, existing.id));
    } else {
      await db.insert(integrationSyncState).values({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        entityType,
        metadata: { failureNotification: state } as any,
        lastAttemptAt: now,
      });
    }
  } catch (err) {
    logWarn("Davis-Bacon coalesce state persist failed", {
      connectionId: connection.id,
      decisionNumber,
      error: String(err),
    });
  }
}

/**
 * Drop coalesce entries that are older than 2x the coalesce window so
 * a long-running worker can't accumulate unbounded keys for connections
 * or decisions that no longer fail. Cheap O(n) sweep — n is bounded
 * by the number of distinct (connection, decision) pairs that have
 * failed recently per worker.
 */
function pruneStaleCoalesceEntries(now: number): void {
  const cutoff = now - 2 * COALESCE_WINDOW_MS;
  for (const [key, state] of failureCoalesceMap) {
    if (state.lastNotifiedAt < cutoff) failureCoalesceMap.delete(key);
  }
}

/**
 * Test/utility hook — wipes the in-memory coalescing map. Exported so
 * unit tests can ensure a deterministic starting state without having
 * to reach into module internals.
 */
export function __resetDavisBaconFailureCoalesceForTests(): void {
  failureCoalesceMap.clear();
}

/**
 * Task #1332: in-app notification to the integration owner when an
 * automatic Davis-Bacon sync queued during project create/update fails.
 * Routed to `integration_connections.created_by_user_id` so the admin who
 * connected SAM.gov hears about it; if the connection has no owner on
 * file we fall back to logging only since there is no per-org "integration
 * admin" group to fan out to.
 *
 * Task #1361 — Repeated failures within `COALESCE_WINDOW_MS` for the same
 * (connection, decision) are coalesced into a single notification so
 * owners can't be flooded by an upstream outage.
 */
export async function notifyDavisBaconAutoSyncFailure(
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

  const key = coalesceKey(connection.id, decisionNumber);
  const now = Date.now();
  pruneStaleCoalesceEntries(now);
  // Task #1370: seed the in-memory cache from the persisted row on a cold
  // worker so a server restart in the middle of an outage doesn't reset
  // the suppression window.
  let state = failureCoalesceMap.get(key);
  if (!state) {
    const persisted = await loadPersistedCoalesceState(connection.id, decisionNumber);
    if (persisted) {
      state = persisted;
      failureCoalesceMap.set(key, persisted);
    }
  }
  if (state && now - state.lastNotifiedAt < COALESCE_WINDOW_MS) {
    state.suppressedCount += 1;
    if (state.suppressedSince === 0) state.suppressedSince = now;
    logInfo("Davis-Bacon auto-sync failure suppressed by coalescing window", {
      decisionNumber,
      connectionId: connection.id,
      suppressedCount: state.suppressedCount,
      windowRemainingMs: COALESCE_WINDOW_MS - (now - state.lastNotifiedAt),
    });
    // Task #1370: persist the bumped suppressedCount so a restart in the
    // middle of a streak still surfaces the right count when the window
    // eventually expires and we deliver the next email.
    await persistCoalesceState(connection, decisionNumber, state);
    return;
  }

  // Either first failure for this (connection, decision) or the previous
  // coalescing window has expired. If we absorbed failures during the
  // last quiet window, surface that count so the owner knows the email
  // they're getting represents a streak.
  const suppressedCount = state?.suppressedCount ?? 0;
  const coalescedSuffix =
    suppressedCount > 0
      ? ` (${suppressedCount + 1} failures in the last hour — additional alerts were suppressed)`
      : "";

  try {
    await insertNotification({
      userId: ownerUserId,
      organizationId: connection.organizationId,
      type: "DAVIS_BACON_AUTO_SYNC_FAILED" as any,
      title: "Davis-Bacon auto-sync failed",
      message:
        `Automatic sync for wage decision ${decisionNumber} failed: ` +
        `${errorMessage.slice(0, 300)}. Open the project's payroll tab to retry.` +
        coalescedSuffix,
      relatedEntityId: connection.id,
      relatedEntityType: "INTEGRATION_CONNECTION",
    });
    const fresh: CoalesceState = {
      lastNotifiedAt: now,
      suppressedSince: 0,
      suppressedCount: 0,
    };
    failureCoalesceMap.set(key, fresh);
    // Task #1370: persist the new lastNotifiedAt so the suppression window
    // survives a server restart that happens during an extended outage.
    await persistCoalesceState(connection, decisionNumber, fresh);
  } catch (err) {
    logError(
      "Failed to deliver Davis-Bacon auto-sync failure notification",
      { decisionNumber, connectionId: connection.id },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

export interface WageDecisionRetryRunResult {
  candidates: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedNoConnection: number;
  exhausted: number;
}

/**
 * Davis-Bacon-specific retry handler. Wired into the generic sync-retry
 * sweep (`processIntegrationSyncRetries`) at module load via
 * `registerSyncRetryHandler` below — meaning Task #1368's generic cron
 * task picks up Davis-Bacon retries alongside QBO and any other provider
 * that opts in.
 *
 * `importWageDetermination` already persists success/failure state on the
 * `integration_sync_state` row, so we return `selfRecorded: true` to
 * prevent the generic sweep from double-writing the bookkeeping columns.
 */
registerSyncRetryHandler({
  provider: "dol_davis_bacon",
  entityTypePrefix: "wage_determination:",
  handler: async (connection, row) => {
    const meta = (connection.metadata as Record<string, any>) || {};
    if (!meta.apiKey && !meta.accessToken) {
      // Let the generic sweep advance retry bookkeeping — these
      // early-return failures still consume a retry slot so the row
      // doesn't sit due-now forever once a credential is removed.
      return { success: false, error: "Missing SAM.gov API key" };
    }
    const decisionNumber = row.entityType.slice("wage_determination:".length).trim();
    if (!decisionNumber) {
      return { success: false, error: "Invalid wage determination entity type" };
    }
    const out = await importWageDetermination(connection, decisionNumber, false);
    if (out.success) {
      logInfo("Davis-Bacon scheduled retry succeeded", {
        decisionNumber,
        organizationId: row.organizationId,
        previousAttempts: row.retryCount,
      });
    }
    return {
      success: out.success,
      error: out.errors.map((e) => e.message).join("; ") || undefined,
      selfRecorded: true,
    };
  },
});

/**
 * Task #1354 + #1368: scheduled retry sweep for Davis-Bacon wage decisions.
 * Now a thin wrapper over the generic sync-retry sweep filtered to
 * `wage_determination:%` entity types — see `processIntegrationSyncRetries`
 * in `server/integrations/syncRetry.ts`. Kept for the existing
 * `wage_decision_retry` job alias and the unit tests in
 * `davis-bacon-wage-decision-retry.test.ts`.
 */
export async function processFailedWageDecisionRetries(
  now: Date = new Date(),
): Promise<WageDecisionRetryRunResult> {
  const out: SyncRetrySweepResult = await processIntegrationSyncRetries(now, {
    entityTypePattern: "wage_determination:%",
  });
  return {
    candidates: out.candidates,
    attempted: out.attempted,
    succeeded: out.succeeded,
    failed: out.failed,
    // Davis-Bacon callers historically lump "no usable connection" and
    // "no credentials on the connection" together under skippedNoConnection.
    skippedNoConnection: out.skippedNoConnection,
    exhausted: out.exhausted,
  };
}
