import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationConnections, integrationSyncState, projects, prevailingWageRates, dolClassificationMappings, wageDecisionRateChanges } from "@shared/schema";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { logInfo, logError, logWarn } from "../../../utils/logger";
import { recordJobMetrics } from "../../../utils/jobMetrics";
import { jobMetricSamples } from "@shared/schema";
import { desc } from "drizzle-orm";
import { safeFetch } from "../../../utils/safeFetch";
import { decryptMetadata } from "../../encryption";
import { insertNotification } from "../../../services/notificationService";
import {
  SYNC_RETRY_BACKOFF_MINUTES,
  MAX_SYNC_RETRIES,
  processIntegrationSyncRetries,
  recordSyncFailure,
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
 * Task #1412 — Reuse saved DOL mappings during scheduled/manual wage syncs.
 *
 * After a wage determination's cached payload is refreshed, look up every
 * project in the org that references this decision number, pull all
 * `dol_classification_mappings` rows for those projects, and upsert the
 * refreshed DOL rates into `prevailing_wage_rates` for each
 * (project, classification) pair. This means a PM only has to map a DOL
 * feed name once via the override dialog — subsequent rate refreshes flow
 * straight through without manual intervention.
 *
 * Implementation notes:
 * - Matches feed-name → mapping case-insensitively, the same convention
 *   `lookupCachedWageRate` uses, so a mapping persisted as
 *   "carpenter (group 1)" still matches a feed payload that capitalizes it.
 * - Inserts use today's date for `effectiveDate`; the conflict-update path
 *   deliberately leaves `effectiveDate` alone so a hand-curated effective
 *   date set by the PM isn't clobbered by an automated refresh.
 * - All numeric fields are pulled straight from the DOL payload — no
 *   smoothing or rounding beyond `.toFixed(2)` so the persisted values
 *   round-trip exactly with what the override dialog would have written.
 */
export async function applySavedMappingsForDecision(
  organizationId: string,
  decisionNumber: string,
  rates: DavisBaconWageRate[],
): Promise<{ projectsUpdated: number; ratesUpserted: number }> {
  if (!organizationId || !decisionNumber || rates.length === 0) {
    return { projectsUpdated: 0, ratesUpserted: 0 };
  }

  const ratesByName = new Map<string, DavisBaconWageRate>();
  for (const r of rates) {
    if (!r || typeof r.classification !== "string") continue;
    ratesByName.set(r.classification.trim().toLowerCase(), r);
  }
  if (ratesByName.size === 0) return { projectsUpdated: 0, ratesUpserted: 0 };

  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.gcOrganizationId, organizationId),
        eq(projects.wageDecision, decisionNumber),
      ),
    );
  if (projectRows.length === 0) return { projectsUpdated: 0, ratesUpserted: 0 };
  const projectIds = projectRows.map((p) => p.id);

  const mappings = await db
    .select()
    .from(dolClassificationMappings)
    .where(
      and(
        eq(dolClassificationMappings.organizationId, organizationId),
        inArray(dolClassificationMappings.projectId, projectIds),
      ),
    );
  if (mappings.length === 0) return { projectsUpdated: 0, ratesUpserted: 0 };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const touchedProjects = new Set<string>();
  let ratesUpserted = 0;

  for (const m of mappings) {
    const rate = ratesByName.get(m.dolFeedName.trim().toLowerCase());
    if (!rate) continue;
    const base = Number.isFinite(rate.baseRate) ? rate.baseRate : 0;
    const fringe = Number.isFinite(rate.fringeRate) ? rate.fringeRate : 0;
    const wageStr = base.toFixed(2);
    const fringeStr = fringe.toFixed(2);
    const totalStr = (base + fringe).toFixed(2);
    const healthStr = (rate.health ?? 0).toFixed(2);
    const pensionStr = (rate.pension ?? 0).toFixed(2);
    const vacationStr = (rate.vacation ?? 0).toFixed(2);
    const trainingStr = (rate.training ?? 0).toFixed(2);

    await db
      .insert(prevailingWageRates)
      .values({
        organizationId,
        projectId: m.projectId,
        classificationId: m.classificationId,
        wageRate: wageStr,
        fringeRate: fringeStr,
        fringeHealthRate: healthStr,
        fringePensionRate: pensionStr,
        fringeVacationRate: vacationStr,
        fringeTrainingRate: trainingStr,
        totalRate: totalStr,
        overtimeMultiplier: "1.5",
        effectiveDate: today,
        wageDecision: decisionNumber,
      })
      .onConflictDoUpdate({
        target: [prevailingWageRates.projectId, prevailingWageRates.classificationId],
        set: {
          wageRate: wageStr,
          fringeRate: fringeStr,
          fringeHealthRate: healthStr,
          fringePensionRate: pensionStr,
          fringeVacationRate: vacationStr,
          fringeTrainingRate: trainingStr,
          totalRate: totalStr,
          wageDecision: decisionNumber,
          updatedAt: now,
        },
      });

    ratesUpserted += 1;
    touchedProjects.add(m.projectId);
  }

  return { projectsUpdated: touchedProjects.size, ratesUpserted };
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

    let mappingApplied: { projectsUpdated: number; ratesUpserted: number } | null = null;
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

      // Task #1412: scheduled/manual wage syncs now honor saved
      // dol_classification_mappings so refreshed DOL rates flow into
      // prevailing_wage_rates automatically — no need for a PM to re-open
      // the override dialog after every wage determination refresh. We
      // run this after the cache write succeeds and isolate its failure
      // so a mapping write hiccup doesn't roll back the cached payload.
      try {
        mappingApplied = await applySavedMappingsForDecision(
          connection.organizationId,
          decisionNumber,
          det.rates,
        );
        if (mappingApplied.ratesUpserted > 0) {
          logInfo("Davis-Bacon mappings applied to prevailing_wage_rates", {
            decisionNumber,
            organizationId: connection.organizationId,
            projectsUpdated: mappingApplied.projectsUpdated,
            ratesUpserted: mappingApplied.ratesUpserted,
          });
        }
      } catch (mapErr) {
        logWarn("Davis-Bacon mapping reuse failed", {
          decisionNumber,
          organizationId: connection.organizationId,
          error: String(mapErr),
        });
      }
    }

    logInfo("Davis-Bacon wage determination imported", { decisionNumber, rates: det.rates.length, dryRun, mappingApplied });
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
 * Task #1385 — A persisted `failureNotification` key on
 * `integration_sync_state.metadata` lives forever once written. The
 * in-memory map self-prunes via `pruneStaleCoalesceEntries`, but the
 * row-side mirror has no such cleanup and accumulates dead JSON for
 * decisions that no longer fail (or are no longer referenced by any
 * project). Once the last notification is older than this threshold
 * AND the row carries no current `lastError`, the suppression window
 * is functionally meaningless and the key is safe to strip.
 */
const STALE_FAILURE_NOTIFICATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sweep stale `metadata.failureNotification` keys off wage-decision rows
 * whose last-notified timestamp is older than
 * `STALE_FAILURE_NOTIFICATION_AGE_MS` and which currently carry no
 * `lastError` (i.e. the decision is healthy or long-orphaned). Returns
 * the number of rows that had the key cleared. Folded into
 * `processFailedWageDecisionRetries` below so the existing wage-decision
 * retry job naturally drives the cleanup without a separate cron entry.
 */
export async function sweepStaleFailureNotifications(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = now.getTime() - STALE_FAILURE_NOTIFICATION_AGE_MS;
  let cleared = 0;
  try {
    const rows = await db
      .select()
      .from(integrationSyncState)
      .where(
        and(
          sql`${integrationSyncState.entityType} LIKE 'wage_determination:%'`,
          sql`${integrationSyncState.lastError} IS NULL`,
        ),
      );
    for (const row of rows) {
      const meta: Record<string, unknown> | null =
        row.metadata && typeof row.metadata === "object"
          ? { ...(row.metadata as Record<string, unknown>) }
          : null;
      if (!meta || !("failureNotification" in meta)) continue;
      const fn = meta.failureNotification as Record<string, unknown> | null | undefined;
      const ts =
        fn && typeof fn === "object" && typeof fn.lastNotifiedAt === "number"
          ? (fn.lastNotifiedAt as number)
          : null;
      // Drop malformed entries (missing timestamp) too — they can't be
      // honoured as a suppression window anyway.
      if (ts !== null && ts > cutoff) continue;
      delete meta.failureNotification;
      await db
        .update(integrationSyncState)
        .set({ metadata: meta, updatedAt: now })
        .where(eq(integrationSyncState.id, row.id));
      const decisionNumber = row.entityType.slice("wage_determination:".length);
      failureCoalesceMap.delete(coalesceKey(row.connectionId, decisionNumber));
      cleared += 1;
    }
    if (cleared > 0) {
      logInfo("Davis-Bacon stale failureNotification keys pruned", { cleared });
    }
  } catch (err) {
    logWarn("Davis-Bacon stale failureNotification sweep failed", {
      error: String(err),
    });
  }
  return cleared;
}

/**
 * Task #1392 — Default retention window for orphaned wage-decision rows.
 * A `wage_determination:*` row in `integration_sync_state` becomes
 * "orphaned" once no project in the same org references the decision via
 * `projects.wageDecision`. Once the row is also long-untouched (most
 * recent of `lastSyncAt`/`lastAttemptAt` older than this threshold) it
 * is safe to delete — any future project that brings the decision back
 * in will trigger a fresh `queueWageDecisionSync` and recreate the row
 * from scratch.
 */
const ORPHAN_WAGE_DECISION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Sweep orphaned `wage_determination:*` rows out of
 * `integration_sync_state`. A row is dropped only when both:
 *   - No project (in any org, scoped per-row by organizationId) currently
 *     carries the decision number in `projects.wageDecision`, AND
 *   - The most recent of `lastSyncAt` / `lastAttemptAt` is older than
 *     `ORPHAN_WAGE_DECISION_RETENTION_MS` (default 90 days).
 *
 * Rows that have never been synced or attempted (both timestamps null)
 * are left alone — they were just created and a concurrent flow may
 * still own them. Returns the number of rows removed. Folded into
 * `processFailedWageDecisionRetries` so the existing wage-decision retry
 * job naturally drives the cleanup without a separate cron entry.
 */
export async function sweepOrphanedWageDecisionRows(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_WAGE_DECISION_RETENTION_MS);
  const sweepStartedAt = Date.now();
  let candidates = 0;
  let deleted = 0;
  try {
    // Pull only candidate rows whose *most recent* touch (the greater of
    // lastSyncAt and lastAttemptAt) is older than the retention cutoff.
    // GREATEST + a sentinel '-infinity' lets us treat each null as
    // "infinitely old" so a row with one populated timestamp is judged
    // purely on that timestamp. When both are null the GREATEST is
    // '-infinity', which is < cutoff — but that case should never reach
    // the deletion branch in practice (rows are stamped with
    // lastAttemptAt on insert by upsertWageDecisionSyncState). The JS-side
    // double check below also re-validates the per-row touch timestamps
    // before the actual delete, so a brand-new row with both timestamps
    // null is left alone.
    const candidateRows = await db
      .select()
      .from(integrationSyncState)
      .where(
        and(
          sql`${integrationSyncState.entityType} LIKE 'wage_determination:%'`,
          sql`GREATEST(COALESCE(${integrationSyncState.lastSyncAt}, '-infinity'::timestamp), COALESCE(${integrationSyncState.lastAttemptAt}, '-infinity'::timestamp)) < ${cutoff}`,
        ),
      );
    candidates = candidateRows.length;
    if (candidateRows.length === 0) {
      // Fall through to the recordOrphanSweepSample call below so the
      // dashboard sees every tick (including the common "no candidates"
      // case) instead of silently dropping empty runs.
    } else {

    // Build a per-org set of referenced decision numbers. Scoping by org
    // matches how `integration_sync_state` rows are partitioned and means
    // org A deleting its last referencing project doesn't accidentally
    // wipe org B's row for the same decision number.
    const referencedRows = await db
      .select({
        organizationId: projects.gcOrganizationId,
        wageDecision: projects.wageDecision,
      })
      .from(projects)
      .where(isNotNull(projects.wageDecision));
    const referenced = new Set<string>();
    for (const r of referencedRows) {
      const decision = (r.wageDecision ?? "").trim();
      if (!decision || !r.organizationId) continue;
      referenced.add(`${r.organizationId}::${decision}`);
    }

    const cutoffMs = cutoff.getTime();
    for (const row of candidateRows) {
      const decisionNumber = row.entityType.slice("wage_determination:".length).trim();
      if (!decisionNumber) continue;
      if (referenced.has(`${row.organizationId}::${decisionNumber}`)) continue;
      // Defensive re-check: skip rows whose newest touch isn't actually
      // older than the cutoff (e.g. a brand-new row with both timestamps
      // null, or a row whose lastAttemptAt is recent even though
      // lastSyncAt is ancient — the SQL GREATEST should already exclude
      // these but we re-validate in JS to be safe).
      const newestTouch = Math.max(
        row.lastSyncAt?.getTime() ?? -Infinity,
        row.lastAttemptAt?.getTime() ?? -Infinity,
      );
      if (!Number.isFinite(newestTouch) || newestTouch >= cutoffMs) continue;
      await db
        .delete(integrationSyncState)
        .where(eq(integrationSyncState.id, row.id));
      // Also evict any in-memory coalesce entry for this (connection, decision)
      // pair so a future re-add doesn't inherit a stale suppression window.
      failureCoalesceMap.delete(coalesceKey(row.connectionId, decisionNumber));
      deleted += 1;
    }
    if (deleted > 0) {
      logInfo("Davis-Bacon orphaned wage decision rows pruned", { deleted });
    }
    }
  } catch (err) {
    logWarn("Davis-Bacon orphaned wage decision sweep failed", {
      error: String(err),
    });
  }
  // Task #1429 — surface the per-run cleanup counts on the admin Jobs
  // dashboard so a misconfigured retention window or a sudden spike in
  // deletions doesn't go unnoticed. Persisted via the standard
  // `recordJobMetrics` path so the history survives restarts. We always
  // record (even on the early-return path) so dashboard consumers see
  // every tick, including the common "no candidates" case.
  recordOrphanSweepSample({
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - sweepStartedAt,
    result: {
      candidates,
      deleted,
      retentionDays: Math.round(ORPHAN_WAGE_DECISION_RETENTION_MS / (24 * 60 * 60 * 1000)),
    },
  });
  return deleted;
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

export interface SuppressedFailureEntry {
  connectionId: string;
  decisionNumber: string;
  suppressedCount: number;
  suppressedSince: number | null;
  lastNotifiedAt: number;
}

/**
 * Task #1384 — Surface the persisted `metadata.failureNotification`
 * counts to the integrations UI so admins watching an active SAM.gov
 * outage can see, in real time, how many auto-sync failures are being
 * absorbed by the coalescing window before the next email is delivered.
 *
 * Returns one entry per (connection, decision) row with a non-zero
 * `suppressedCount`. A successful sync overwrites the row's metadata
 * wholesale (see `markRowSuccess` in `importWageDetermination`), so the
 * suppressed count for a healthy decision naturally returns to zero
 * without any explicit cleanup here.
 */
/**
 * Task #1403 — Force-clear the suppression window for a given
 * (connection, decision). Wipes the persisted
 * `metadata.failureNotification` key off the integration_sync_state row
 * and drops the in-memory `failureCoalesceMap` entry, so the next
 * failure for this decision goes out as a fresh notification (with
 * the absorbed-count suffix reset to zero).
 *
 * Returns true if a persisted suppression entry was actually cleared,
 * false otherwise (no row, no persisted key, or row metadata is shaped
 * unexpectedly). The in-memory map entry is always removed regardless.
 */
export async function resetSuppressedFailureNotification(
  connection: IntegrationConnection,
  decisionNumber: string,
): Promise<boolean> {
  const decision = (decisionNumber || "").trim();
  if (!decision) return false;
  // Always drop the in-memory cache entry, even if the persisted side
  // is already empty — otherwise a hot worker could keep enforcing the
  // window after a manual reset.
  failureCoalesceMap.delete(coalesceKey(connection.id, decision));

  let cleared = false;
  try {
    const existing = await getWageDecisionRow(connection.id, decision);
    if (!existing) return false;
    const meta =
      existing.metadata && typeof existing.metadata === "object"
        ? { ...(existing.metadata as Record<string, unknown>) }
        : null;
    if (!meta || !("failureNotification" in meta)) return false;
    delete meta.failureNotification;
    await db
      .update(integrationSyncState)
      .set({ metadata: meta as any, updatedAt: new Date() })
      .where(eq(integrationSyncState.id, existing.id));
    cleared = true;
  } catch (err) {
    logWarn("Davis-Bacon suppression reset failed", {
      connectionId: connection.id,
      decisionNumber: decision,
      error: String(err),
    });
  }
  return cleared;
}

export async function listSuppressedFailureNotifications(
  organizationId: string,
): Promise<SuppressedFailureEntry[]> {
  try {
    const rows = await db
      .select()
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.organizationId, organizationId),
          sql`${integrationSyncState.entityType} LIKE 'wage_determination:%'`,
        ),
      );
    const out: SuppressedFailureEntry[] = [];
    for (const row of rows) {
      const meta = (row.metadata as Record<string, unknown> | null) ?? null;
      if (!meta || typeof meta !== "object") continue;
      const fn = (meta as Record<string, unknown>).failureNotification as
        | Record<string, unknown>
        | undefined
        | null;
      if (!fn || typeof fn !== "object") continue;
      const suppressedCount =
        typeof fn.suppressedCount === "number" ? fn.suppressedCount : 0;
      if (suppressedCount <= 0) continue;
      const lastNotifiedAt =
        typeof fn.lastNotifiedAt === "number" ? fn.lastNotifiedAt : 0;
      const suppressedSince =
        typeof fn.suppressedSince === "number" && fn.suppressedSince > 0
          ? fn.suppressedSince
          : null;
      out.push({
        connectionId: row.connectionId,
        decisionNumber: row.entityType.slice("wage_determination:".length),
        suppressedCount,
        suppressedSince,
        lastNotifiedAt,
      });
    }
    return out;
  } catch (err) {
    logWarn("Davis-Bacon listSuppressedFailureNotifications failed", {
      organizationId,
      error: String(err),
    });
    return [];
  }
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
  // Task #1385: piggy-back on the wage-decision retry job to garbage-collect
  // long-orphaned `failureNotification` keys persisted on the row's metadata.
  // Done before the retry sweep so a stale key on a row that's about to be
  // resync'd doesn't leak past this run.
  await sweepStaleFailureNotifications(now);
  // Task #1392: also drop entire `wage_determination:*` rows that no project
  // in the org references anymore and whose last touch is older than the
  // retention window. Keeps the integration_sync_state table from growing
  // unbounded as projects come and go.
  await sweepOrphanedWageDecisionRows(now);
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

export const DEFAULT_WAGE_DECISION_STALE_AFTER_DAYS = 30;

/**
 * Task #1339 surfaced a configurable "stale" threshold for cached wage
 * determinations; the project payroll panel renders a "Stale" badge once
 * `lastSyncAt` crosses that threshold (default 30 days). Re-reads the
 * env var on every call so operators can tune it without a deploy.
 */
export function getWageDecisionStaleAfterDays(): number {
  const parsed = Number.parseInt(
    process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WAGE_DECISION_STALE_AFTER_DAYS;
}

export interface StaleWageDecisionSweepResult {
  candidates: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedNoConnection: number;
  skippedNoCredentials: number;
  staleAfterDays: number;
}

/**
 * Task #1401 — Surface the most recent `wage_decision_stale_refresh`
 * sweep result on the admin Jobs dashboard.
 *
 * Task #1410 — The sweep summary is now persisted to the
 * `job_metric_samples` table (via `recordJobMetrics`) so the "last run"
 * record survives server restarts and redeploys. The dashboard reads
 * directly from the table on demand, which means a freshly-deployed
 * instance still shows the previous night's sweep instead of the
 * misleading "No sweep recorded yet" placeholder it used to render
 * until the next 06:00 UTC tick. We also expose a short rolling
 * history so operators can spot trends (e.g. a stuck DOL endpoint
 * piling up `failed`) without grepping logs.
 */
export const WAGE_DECISION_STALE_REFRESH_JOB = "wage_decision_stale_refresh";

export interface StaleWageDecisionSweepRecord {
  ranAt: string;
  durationMs: number;
  result: StaleWageDecisionSweepResult;
}

function rowToSweepRecord(row: {
  recordedAt: Date | string;
  counters: unknown;
}): StaleWageDecisionSweepRecord {
  const c = (row.counters ?? {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = c[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    ranAt: new Date(row.recordedAt).toISOString(),
    durationMs: num("durationMs"),
    result: {
      candidates: num("candidates"),
      attempted: num("attempted"),
      succeeded: num("succeeded"),
      failed: num("failed"),
      skippedNoConnection: num("skippedNoConnection"),
      skippedNoCredentials: num("skippedNoCredentials"),
      staleAfterDays: num("staleAfterDays"),
    },
  };
}

export async function getLastStaleWageDecisionSweep(): Promise<StaleWageDecisionSweepRecord | null> {
  try {
    const [row] = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, WAGE_DECISION_STALE_REFRESH_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(1);
    return row ? rowToSweepRecord(row) : null;
  } catch (err) {
    logError("Failed to load last wage decision stale sweep", { error: String(err) });
    return null;
  }
}

export async function getRecentStaleWageDecisionSweeps(
  limit = 10,
): Promise<StaleWageDecisionSweepRecord[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const rows = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, WAGE_DECISION_STALE_REFRESH_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(safeLimit);
    return rows.map(rowToSweepRecord);
  } catch (err) {
    logError("Failed to load recent wage decision stale sweeps", { error: String(err) });
    return [];
  }
}

/**
 * Test helper kept for backward compatibility with Task #1401 callers.
 * Wipes any persisted sweep rows so each test starts clean.
 */
export async function __resetLastStaleWageDecisionSweepForTests(): Promise<void> {
  try {
    await db
      .delete(jobMetricSamples)
      .where(eq(jobMetricSamples.job, WAGE_DECISION_STALE_REFRESH_JOB));
  } catch {
    // Best-effort — tests that don't care about persistence shouldn't fail.
  }
}

/**
 * Task #1429 — `wage_decision_orphan_sweep` job alias for the
 * `recordJobMetrics` history. The orphan cleanup runs as part of the
 * wage-decision retry sweep but its counters are tracked under their
 * own job name so the admin Jobs dashboard can render them in a
 * dedicated card alongside the stale-refresh metrics.
 */
export const WAGE_DECISION_ORPHAN_SWEEP_JOB = "wage_decision_orphan_sweep";

export interface OrphanWageDecisionSweepResult {
  candidates: number;
  deleted: number;
  retentionDays: number;
}

export interface OrphanWageDecisionSweepRecord {
  ranAt: string;
  durationMs: number;
  result: OrphanWageDecisionSweepResult;
}

function rowToOrphanSweepRecord(row: {
  recordedAt: Date | string;
  counters: unknown;
}): OrphanWageDecisionSweepRecord {
  const c = (row.counters ?? {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = c[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    ranAt: new Date(row.recordedAt).toISOString(),
    durationMs: num("durationMs"),
    result: {
      candidates: num("candidates"),
      deleted: num("deleted"),
      retentionDays: num("retentionDays"),
    },
  };
}

function recordOrphanSweepSample(record: OrphanWageDecisionSweepRecord): void {
  recordJobMetrics(WAGE_DECISION_ORPHAN_SWEEP_JOB, {
    candidates: record.result.candidates,
    deleted: record.result.deleted,
    retentionDays: record.result.retentionDays,
    durationMs: record.durationMs,
  });
}

export async function getLastOrphanedWageDecisionSweep(): Promise<OrphanWageDecisionSweepRecord | null> {
  try {
    const [row] = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, WAGE_DECISION_ORPHAN_SWEEP_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(1);
    return row ? rowToOrphanSweepRecord(row) : null;
  } catch (err) {
    logError("Failed to load last wage decision orphan sweep", { error: String(err) });
    return null;
  }
}

export async function getRecentOrphanedWageDecisionSweeps(
  limit = 10,
): Promise<OrphanWageDecisionSweepRecord[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const rows = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, WAGE_DECISION_ORPHAN_SWEEP_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(safeLimit);
    return rows.map(rowToOrphanSweepRecord);
  } catch (err) {
    logError("Failed to load recent wage decision orphan sweeps", { error: String(err) });
    return [];
  }
}

function recordSweepSample(record: StaleWageDecisionSweepRecord): void {
  recordJobMetrics(WAGE_DECISION_STALE_REFRESH_JOB, {
    candidates: record.result.candidates,
    attempted: record.result.attempted,
    succeeded: record.result.succeeded,
    failed: record.result.failed,
    skippedNoConnection: record.result.skippedNoConnection,
    skippedNoCredentials: record.result.skippedNoCredentials,
    staleAfterDays: record.result.staleAfterDays,
    durationMs: record.durationMs,
  });
}

/**
 * Task #1380 — Background sweep that re-syncs every cached wage
 * determination whose `lastSyncAt` has crossed the configured staleness
 * threshold (default 30 days, controlled by DOL_DAVIS_BACON_STALE_AFTER_DAYS).
 *
 * The sweep deliberately avoids stepping on the failure-backoff retry
 * sweep (`processIntegrationSyncRetries`):
 *   - It only considers rows with `lastError IS NULL` and
 *     `nextRetryAt IS NULL`. A row currently in the retry chain is owned
 *     by that sweep, so we don't double-fire against DOL.
 *   - On failure, `importWageDetermination` records a `lastError` plus a
 *     `nextRetryAt` via the standard backoff path, which means a flaky
 *     DOL endpoint won't be hammered on the next staleness sweep — the
 *     row is now in the retry sweep's lane until it recovers or exhausts.
 *
 * Successful re-syncs stamp a fresh `lastSyncAt`, which the project
 * payroll summary endpoint (`getWageDecisionSyncStatus` →
 * `wageDecisionStaleAfterDays` comparison in the frontend) reads on the
 * next page load to clear the "Stale" badge automatically.
 */
export async function processStaleWageDecisions(
  now: Date = new Date(),
  opts: { staleAfterDays?: number } = {},
): Promise<StaleWageDecisionSweepResult> {
  const staleAfterDays = opts.staleAfterDays ?? getWageDecisionStaleAfterDays();
  const cutoff = new Date(now.getTime() - staleAfterDays * 24 * 60 * 60 * 1000);
  const sweepStartedAt = Date.now();

  const result: StaleWageDecisionSweepResult = {
    candidates: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedNoConnection: 0,
    skippedNoCredentials: 0,
    staleAfterDays,
  };

  // Pull every wage_determination row whose successful import is older
  // than the threshold AND that isn't currently sitting in the failure
  // backoff lane. Drizzle predicates compose into a single SQL query so
  // the per-org filtering stays in the DB.
  const rows = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        sql`${integrationSyncState.entityType} LIKE 'wage_determination:%'`,
        isNull(integrationSyncState.lastError),
        isNull(integrationSyncState.nextRetryAt),
        lt(integrationSyncState.lastSyncAt, cutoff),
      ),
    );

  result.candidates = rows.length;
  if (rows.length === 0) {
    recordSweepSample({
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - sweepStartedAt,
      result: { ...result },
    });
    return result;
  }

  const connectionCache = new Map<string, IntegrationConnection | null>();
  async function getConnection(connectionId: string): Promise<IntegrationConnection | null> {
    if (connectionCache.has(connectionId)) return connectionCache.get(connectionId)!;
    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.status, "active" as any),
        ),
      )
      .limit(1);
    if (!conn) {
      connectionCache.set(connectionId, null);
      return null;
    }
    const meta = (conn.metadata as Record<string, unknown>) || {};
    const decrypted: IntegrationConnection = {
      ...conn,
      metadata: decryptMetadata(meta),
    } as IntegrationConnection;
    connectionCache.set(connectionId, decrypted);
    return decrypted;
  }

  for (const row of rows) {
    const decisionNumber = row.entityType.slice("wage_determination:".length).trim();
    if (!decisionNumber) continue;

    const connection = await getConnection(row.connectionId);
    if (!connection) {
      result.skippedNoConnection += 1;
      continue;
    }
    const meta = (connection.metadata as Record<string, any>) || {};
    if (!meta.apiKey && !meta.accessToken) {
      result.skippedNoCredentials += 1;
      continue;
    }

    // Task #1400: capture the previous payload before the import so we can
    // diff classification rates after a successful refresh and notify
    // project managers when DOL has actually changed something.
    const prevMeta = row.metadata as WageDetermination | undefined;
    const prevRates: DavisBaconWageRate[] = Array.isArray(prevMeta?.rates) ? prevMeta!.rates : [];

    result.attempted += 1;
    try {
      const out = await importWageDetermination(connection, decisionNumber, false);
      if (out.success) {
        result.succeeded += 1;
        logInfo("Davis-Bacon stale wage decision auto-refreshed", {
          decisionNumber,
          organizationId: row.organizationId,
          previousSyncAt: row.lastSyncAt?.toISOString() ?? null,
          staleAfterDays,
        });
        // Task #1400: load the freshly-imported rates and notify PMs of
        // affected projects only when the new payload differs. Dynamic
        // import keeps the davisBaconAdminNotifications module out of the
        // sync.ts dependency chain (it imports back into this file).
        try {
          const refreshed = await getWageDecisionRow(connection.id, decisionNumber);
          const newMeta = refreshed?.metadata as WageDetermination | undefined;
          const newRates: DavisBaconWageRate[] = Array.isArray(newMeta?.rates)
            ? newMeta!.rates
            : [];
          const { diffWageRates, notifyProjectManagersOfWageRateChange } =
            await import("../../../services/davisBaconAdminNotifications");
          const { persistRateChangeRecords } = await import("./rateChangeFlags");
          const diff = diffWageRates(prevRates, newRates);
          if (diff) {
            logInfo("Davis-Bacon stale refresh changed cached rates", {
              decisionNumber,
              organizationId: row.organizationId,
              changedClassifications: diff.changes.length,
            });
            await notifyProjectManagersOfWageRateChange({
              organizationId: row.organizationId,
              decisionNumber,
              diff,
            });
            // Task #1409: persist the per-classification diff so the
            // project prevailing wage panel can flag rows whose rate
            // just shifted. We replace any prior unacknowledged record
            // for the same (org, decision, classification) so a PM
            // always sees the *latest* refresh's delta and the
            // detection timestamp re-arms (acknowledged_at clears).
            try {
              await persistRateChangeRecords(
                row.organizationId,
                decisionNumber,
                diff.changes,
              );
            } catch (persistErr) {
              logWarn("Davis-Bacon rate-change panel-flag persistence failed", {
                decisionNumber,
                organizationId: row.organizationId,
                error: String(persistErr),
              });
            }
          } else {
            // Task #1409: a successful refresh that produced no diff
            // means the previously-flagged classifications are now
            // back in sync (or never were affected). Clear any
            // outstanding panel flags for this (org, decision) so the
            // badge auto-clears without requiring a PM acknowledgement.
            try {
              await db
                .delete(wageDecisionRateChanges)
                .where(
                  and(
                    eq(wageDecisionRateChanges.organizationId, row.organizationId),
                    eq(wageDecisionRateChanges.decisionNumber, decisionNumber),
                  ),
                );
            } catch (clearErr) {
              logWarn("Davis-Bacon rate-change panel-flag auto-clear failed", {
                decisionNumber,
                organizationId: row.organizationId,
                error: String(clearErr),
              });
            }
          }
        } catch (notifyErr) {
          logWarn("Davis-Bacon rate-change notification fan-out failed", {
            decisionNumber,
            organizationId: row.organizationId,
            error: String(notifyErr),
          });
        }
      } else {
        result.failed += 1;
        // importWageDetermination has already persisted lastError +
        // nextRetryAt via the backoff path, so the standard retry sweep
        // will take it from here and the next staleness sweep will skip
        // it (lastError is no longer null).
      }
    } catch (err) {
      // Defensive — importWageDetermination normalizes most errors into
      // a SyncResult with success=false and already persists lastError
      // + nextRetryAt via the standard backoff path. This catch is for
      // the rare case where the DB persistence itself throws (e.g.
      // connection pool exhausted). Record the failure on our counter
      // and persist a backoff entry so the next staleness sweep skips
      // this row instead of immediately re-attempting it.
      result.failed += 1;
      logError("Davis-Bacon stale wage decision auto-refresh threw", {
        decisionNumber,
        organizationId: row.organizationId,
        error: String(err),
      });
      try {
        await recordSyncFailure(connection, row.entityType, err);
      } catch (recErr) {
        logWarn("Davis-Bacon stale-refresh failure persistence failed", {
          decisionNumber,
          organizationId: row.organizationId,
          error: String(recErr),
        });
      }
    }
  }

  recordSweepSample({
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - sweepStartedAt,
    result: { ...result },
  });
  return result;
}
