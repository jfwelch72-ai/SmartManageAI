import { db } from "../db";
import { projects } from "@shared/schema";
import { and, eq, isNull, isNotNull, or, sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  process.env.GEOCODER_USER_AGENT ||
  "SmartManageAI/1.0 (geocoder; contact: support@smartmanageai.com)";
const REQUEST_DELAY_MS = 1100;
const DEFAULT_BATCH_LIMIT = 50;

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
}

export interface GeocodeRunResult {
  scanned: number;
  geocoded: number;
  failed: number;
  notFound: number;
  skipped: number;
}

/**
 * Scan projects with addresses but missing site coordinates and try to geocode them.
 * Uses Nominatim (free, no API key) with 1 req/sec rate limiting per their usage policy.
 * Failures are logged per-project and never block subsequent projects.
 */
export async function geocodePendingProjects(options: GeocodeRunOptions = {}): Promise<GeocodeRunResult> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_BATCH_LIMIT, 200));

  const conditions = [
    or(isNull(projects.siteLatitude), isNull(projects.siteLongitude))!,
    or(
      and(isNotNull(projects.locationAddress), sql`length(trim(${projects.locationAddress})) > 0`),
      and(isNotNull(projects.city), sql`length(trim(${projects.city})) > 0`),
    )!,
  ];
  if (options.organizationId) {
    conditions.push(eq(projects.gcOrganizationId, options.organizationId));
  }

  const candidates = await db
    .select({
      id: projects.id,
      code: projects.code,
      locationAddress: projects.locationAddress,
      city: projects.city,
      state: projects.state,
    })
    .from(projects)
    .where(and(...conditions))
    .limit(limit);

  const result: GeocodeRunResult = {
    scanned: candidates.length,
    geocoded: 0,
    failed: 0,
    notFound: 0,
    skipped: 0,
  };

  if (candidates.length === 0) {
    return result;
  }

  logInfo("Geocoding pending projects", {
    count: candidates.length,
    organizationId: options.organizationId || "all",
  });

  for (let i = 0; i < candidates.length; i++) {
    const project = candidates[i];
    const address = buildAddress(project);
    if (!address) {
      result.skipped += 1;
      continue;
    }

    try {
      const coords = await geocodeAddress(address);
      if (!coords) {
        result.notFound += 1;
        logWarn("Geocoder returned no result for project", {
          projectId: project.id,
          code: project.code,
          address,
        });
      } else {
        await db
          .update(projects)
          .set({
            siteLatitude: coords.lat,
            siteLongitude: coords.lng,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, project.id));
        result.geocoded += 1;
        logInfo("Geocoded project", {
          projectId: project.id,
          code: project.code,
          lat: coords.lat,
          lng: coords.lng,
        });
      }
    } catch (err) {
      result.failed += 1;
      logError("Geocoding failed for project", {
        projectId: project.id,
        code: project.code,
        address,
        error: String(err),
      });
    }

    if (i < candidates.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  logInfo("Geocoding run finished", result);
  return result;
}
