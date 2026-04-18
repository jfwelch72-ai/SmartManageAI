import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationSyncState } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logInfo, logError } from "../../../utils/logger";
import { safeFetch } from "../../../utils/safeFetch";

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
      const entityType = `wage_determination:${decisionNumber}`;
      const [existing] = await db
        .select()
        .from(integrationSyncState)
        .where(
          and(
            eq(integrationSyncState.connectionId, connection.id),
            eq(integrationSyncState.entityType, entityType)
          )
        );
      const payload = { ...det, importedAt: new Date().toISOString() };
      if (existing) {
        await db
          .update(integrationSyncState)
          .set({ metadata: payload, lastSyncAt: new Date(), updatedAt: new Date() })
          .where(eq(integrationSyncState.id, existing.id));
      } else {
        await db.insert(integrationSyncState).values({
          organizationId: connection.organizationId,
          connectionId: connection.id,
          entityType,
          metadata: payload,
          lastSyncAt: new Date(),
        });
      }
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
    return { success: false, entityType: "wage_determination", direction: "import", created: 0, updated: 0, skipped: 0, errors };
  }
}

/**
 * Look up a cached wage rate for a classification under a given decision.
 * Used by the WH-347 generator as a fallback when no per-project
 * `prevailingWageRates` row is present. Returns null if not connected,
 * not cached, or classification not found.
 */
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
