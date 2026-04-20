import { db } from "../db";
import { projects } from "@shared/schema";
import { and, asc, eq, isNull, isNotNull, or, sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  process.env.GEOCODER_USER_AGENT ||
  "SmartManageAI/1.0 (geocoder; contact: support@smartmanageai.com)";
const REQUEST_DELAY_MS = 1100;
const DEFAULT_BATCH_LIMIT = 50;

// Task #590: backoff windows for projects whose previous geocode attempt
// failed or returned no result. The schedule itself lives in SQL inside
// `eligibleByBackoffSql` (below) so the database can filter eligible
// candidates without us pulling every failed row into memory. The bands are:
//   FAILED:    1h, 6h, 1d, 3d, 7d, then 30d cap (transient errors retry hard)
//   NOT_FOUND: 1d, 3d, 7d,        then 30d cap (treated as a likely-bad address)

export type GeocodeStatus = "OK" | "NOT_FOUND" | "FAILED";

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
}

function buildAddress(parts: {
  locationAddress?: string | null;
  city?: string | null;
  state?: string | null;
}): string | null {
  const segments = [parts.locationAddress, parts.city, parts.state]
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  return segments.join(", ");
}

// SQL expression that evaluates to TRUE when a project is eligible for a
// fresh geocode attempt: either it has never been tried, the previous
// outcome wasn't a recordable failure, or enough time has passed since the
// last failure for the relevant backoff window. Keeping this in SQL ensures
// failed/deferred projects can't crowd out eligible ones in a fixed-size
// candidate window. The CASE bands mirror the JS schedules above.
const eligibleByBackoffSql = sql`(
  ${projects.lastGeocodeAttemptAt} IS NULL
  OR ${projects.lastGeocodeStatus} IS NULL
  OR ${projects.lastGeocodeStatus} NOT IN ('NOT_FOUND', 'FAILED')
  OR ${projects.lastGeocodeAttemptAt} < NOW() - (
    CASE ${projects.lastGeocodeStatus}
      WHEN 'NOT_FOUND' THEN
        CASE
          WHEN ${projects.geocodeAttemptCount} <= 1 THEN INTERVAL '1 day'
          WHEN ${projects.geocodeAttemptCount} = 2 THEN INTERVAL '3 days'
          WHEN ${projects.geocodeAttemptCount} = 3 THEN INTERVAL '7 days'
          ELSE INTERVAL '30 days'
        END
      WHEN 'FAILED' THEN
        CASE
          WHEN ${projects.geocodeAttemptCount} <= 1 THEN INTERVAL '1 hour'
          WHEN ${projects.geocodeAttemptCount} = 2 THEN INTERVAL '6 hours'
          WHEN ${projects.geocodeAttemptCount} = 3 THEN INTERVAL '1 day'
          WHEN ${projects.geocodeAttemptCount} = 4 THEN INTERVAL '3 days'
          WHEN ${projects.geocodeAttemptCount} = 5 THEN INTERVAL '7 days'
          ELSE INTERVAL '30 days'
        END
      ELSE INTERVAL '0'
    END
  )
)`;

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM_URL}?format=json&limit=1&addressdetails=0&q=${encodeURIComponent(address)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Geocoder responded with ${response.status}`);
  }
  const data = (await response.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  const lat = parseFloat(top.lat);
  const lng = parseFloat(top.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: top.display_name };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GeocodeRunOptions {
  organizationId?: string;
  limit?: number;
  // When true, ignore the per-project backoff window and retry every project
  // with a missing coordinate. Useful for an explicit admin "retry all" action.
  force?: boolean;
}

export interface GeocodeRunResult {
  scanned: number;
  geocoded: number;
  failed: number;
  notFound: number;
  skipped: number;
  // Number of candidates that had a prior failure but are still inside the
  // backoff window and were therefore not contacted this run.
  backoffDeferred: number;
}

/**
 * Scan projects with addresses but missing site coordinates and try to geocode them.
 * Uses Nominatim (free, no API key) with 1 req/sec rate limiting per their usage policy.
 * Failures are logged per-project and never block subsequent projects.
 *
 * Task #590: each attempt records its outcome on the project so future runs
 * can back off projects whose addresses repeatedly fail to resolve, instead
 * of hammering Nominatim every night for the same unmappable addresses.
 */
export async function geocodePendingProjects(options: GeocodeRunOptions = {}): Promise<GeocodeRunResult> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_BATCH_LIMIT, 200));

  const baseConditions = [
    or(isNull(projects.siteLatitude), isNull(projects.siteLongitude))!,
    or(
      and(isNotNull(projects.locationAddress), sql`length(trim(${projects.locationAddress})) > 0`),
      and(isNotNull(projects.city), sql`length(trim(${projects.city})) > 0`),
    )!,
  ];
  if (options.organizationId) {
    baseConditions.push(eq(projects.gcOrganizationId, options.organizationId));
  }

  const eligibleConditions = options.force
    ? baseConditions
    : [...baseConditions, eligibleByBackoffSql];

  // Order by oldest attempt first (NULLs first so brand-new projects always
  // get picked up) so selection is deterministic and we don't keep retrying
  // the same handful of projects while others wait indefinitely.
  const eligible = await db
    .select({
      id: projects.id,
      code: projects.code,
      locationAddress: projects.locationAddress,
      city: projects.city,
      state: projects.state,
      lastGeocodeAttemptAt: projects.lastGeocodeAttemptAt,
      lastGeocodeStatus: projects.lastGeocodeStatus,
      geocodeAttemptCount: projects.geocodeAttemptCount,
    })
    .from(projects)
    .where(and(...eligibleConditions))
    .orderBy(sql`${projects.lastGeocodeAttemptAt} ASC NULLS FIRST`, asc(projects.updatedAt))
    .limit(limit);

  // Separately count rows we're deferring purely for backoff so the run
  // result can surface "we have N projects waiting, just not yet" instead of
  // silently returning an empty result.
  let backoffDeferred = 0;
  if (!options.force) {
    const deferredRow = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(...baseConditions, sql`NOT (${eligibleByBackoffSql})`));
    backoffDeferred = Number(deferredRow[0]?.cnt ?? 0);
  }

  const result: GeocodeRunResult = {
    scanned: eligible.length,
    geocoded: 0,
    failed: 0,
    notFound: 0,
    skipped: 0,
    backoffDeferred,
  };

  if (eligible.length === 0) {
    if (result.backoffDeferred > 0) {
      logInfo("Geocoding run skipped all candidates due to backoff", result);
    }
    return result;
  }

  logInfo("Geocoding pending projects", {
    count: eligible.length,
    deferred: result.backoffDeferred,
    organizationId: options.organizationId || "all",
  });

  for (let i = 0; i < eligible.length; i++) {
    const project = eligible[i];
    const address = buildAddress(project);
    if (!address) {
      result.skipped += 1;
      continue;
    }

    const attemptedAt = new Date();
    let status: GeocodeStatus;
    let coords: GeocodeResult | null = null;
    try {
      coords = await geocodeAddress(address);
      if (!coords) {
        status = "NOT_FOUND";
        result.notFound += 1;
        logWarn("Geocoder returned no result for project", {
          projectId: project.id,
          code: project.code,
          address,
        });
      } else {
        status = "OK";
      }
    } catch (err) {
      status = "FAILED";
      result.failed += 1;
      logError("Geocoding failed for project", {
        projectId: project.id,
        code: project.code,
        address,
        error: String(err),
      });
    }

    try {
      if (status === "OK" && coords) {
        await db
          .update(projects)
          .set({
            siteLatitude: coords.lat,
            siteLongitude: coords.lng,
            lastGeocodeAttemptAt: attemptedAt,
            lastGeocodeStatus: "OK",
            geocodeAttemptCount: 0,
            updatedAt: attemptedAt,
          })
          .where(eq(projects.id, project.id));
        result.geocoded += 1;
        logInfo("Geocoded project", {
          projectId: project.id,
          code: project.code,
          lat: coords.lat,
          lng: coords.lng,
        });
      } else {
        await db
          .update(projects)
          .set({
            lastGeocodeAttemptAt: attemptedAt,
            lastGeocodeStatus: status,
            geocodeAttemptCount: (project.geocodeAttemptCount ?? 0) + 1,
          })
          .where(eq(projects.id, project.id));
      }
    } catch (persistErr) {
      logError("Failed to persist geocode attempt outcome", {
        projectId: project.id,
        code: project.code,
        status,
        error: String(persistErr),
      });
    }

    if (i < eligible.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  logInfo("Geocoding run finished", result);
  return result;
}
