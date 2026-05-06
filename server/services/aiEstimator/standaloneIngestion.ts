/**
 * Task #2443 — Standalone takeoff ingestion hooks.
 *
 * Phase 2 of the AI Estimator pipeline calls for standalone takeoffs
 * (the "Takeoff anywhere, no bid required" workspace) to feed the same
 * knowledge index + learned-rates store that bids/estimates do, so the
 * Estimator chat / draft generator can surface prior speculative work.
 *
 * Two entry points, both designed to be called best-effort from the
 * standalone-takeoff routes (any failure is logged but never fails the
 * user-facing request):
 *
 *   - indexStandaloneTakeoff: upserts a knowledge row for the takeoff
 *     itself (sourceType `'standalone_takeoff'`) plus one row per
 *     measurement (sourceType `'takeoff_measurement'`, scoped via the
 *     measurement id which is unique).
 *
 *   - emitLibraryAssignmentSamplesForTakeoff: fired when a standalone
 *     takeoff is tagged to a bid/project. Walks the takeoff's
 *     measurements and pushes any costed ones into the org's
 *     learned-rates store with sourceType `'library_assignment'` so
 *     subsequent suggestions weight the (formerly orphan) takeoff
 *     library alongside committed estimate history.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  standaloneTakeoffs,
  takeoffSheets,
  takeoffMeasurements,
  type StandaloneTakeoff,
} from "@shared/schema";
import { upsertKnowledgeRow } from "./retrieval";
import { bulkRecordRateSamples, type RateUpdate } from "./learnedRates";
import { logWarn } from "../../utils/logger";

/** Best-effort unit derivation from a measurement type. Mirrors the
 *  conventions used elsewhere in the takeoff workspace. */
function unitForMeasurementType(type: string): string | null {
  switch (type) {
    case "LINEAR":
    case "LINEAR_WITH_DROP":
    case "PITCHED_LINEAR":
    case "SEGMENT":
      return "LF";
    case "AREA":
    case "PITCHED_AREA":
    case "SURFACE_AREA":
      return "SF";
    case "VOLUME":
      return "CY";
    case "COUNT":
      return "EA";
    default:
      return null;
  }
}

function quantityForMeasurement(m: typeof takeoffMeasurements.$inferSelect): number {
  return Number(
    m.computedLengthFt ??
      m.computedAreaFt2 ??
      m.computedVolumeCy ??
      m.count ??
      0,
  );
}

/**
 * Upsert knowledge-index rows for a standalone takeoff and its
 * measurements. Idempotent: re-running over the same takeoff produces
 * the same final state thanks to upsertKnowledgeRow's content-hash
 * shortcut.
 */
export async function indexStandaloneTakeoff(takeoffId: string): Promise<void> {
  const [takeoff] = await db
    .select()
    .from(standaloneTakeoffs)
    .where(eq(standaloneTakeoffs.id, takeoffId))
    .limit(1);
  if (!takeoff) return;
  await indexStandaloneTakeoffRow(takeoff);

  const sheets = await db
    .select({ id: takeoffSheets.id })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.standaloneTakeoffId, takeoff.id));
  for (const sheet of sheets) {
    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, sheet.id));
    for (const m of measurements.slice(0, 200)) {
      const v = quantityForMeasurement(m);
      await upsertKnowledgeRow({
        organizationId: takeoff.organizationId,
        sourceType: "takeoff_measurement",
        sourceId: m.id,
        bidId: null,
        projectId: null,
        costCode: m.costCodeId ?? null,
        tradeType: takeoff.tradeType ?? null,
        title: `Takeoff: ${m.label}`,
        contentSnippet: `${m.type} value=${v}${m.unitCost ? ` • $${m.unitCost}/${unitForMeasurementType(m.type) ?? "unit"}` : ""} (standalone takeoff "${takeoff.title}")`,
        tags: [m.type, "standalone_takeoff"],
        numericFacets: { value: v, unitCost: m.unitCost ?? null },
        contentHash: null,
      });
    }
  }
}

async function indexStandaloneTakeoffRow(takeoff: StandaloneTakeoff): Promise<void> {
  await upsertKnowledgeRow({
    organizationId: takeoff.organizationId,
    sourceType: "standalone_takeoff",
    sourceId: takeoff.id,
    bidId: null,
    projectId: null,
    costCode: null,
    tradeType: takeoff.tradeType ?? null,
    title: `Standalone takeoff: ${takeoff.title}`,
    contentSnippet: [
      takeoff.title,
      takeoff.tradeType ? `Trade: ${takeoff.tradeType}` : null,
      takeoff.clientName ? `Client: ${takeoff.clientName}` : null,
      takeoff.locationAddress ? `Location: ${takeoff.locationAddress}` : null,
      takeoff.notes ?? null,
    ]
      .filter(Boolean)
      .join("\n"),
    tags: [takeoff.tradeType, "standalone_takeoff"].filter(
      (v): v is string => !!v,
    ),
    numericFacets: null,
    contentHash: null,
  });
}

/**
 * Emit `library_assignment` rate samples for every costed measurement
 * on the standalone takeoff that was just tagged to a bid/project.
 * Treats the unitCost the user captured during the speculative takeoff
 * as one observation in that (costCode, metric, unit) bucket so future
 * suggestions reflect prior library work. No-ops silently if the
 * takeoff has no costed measurements.
 */
export async function emitLibraryAssignmentSamplesForTakeoff(
  takeoffId: string,
  destination: { bidId?: string | null; projectId?: string | null },
): Promise<number> {
  const [takeoff] = await db
    .select()
    .from(standaloneTakeoffs)
    .where(eq(standaloneTakeoffs.id, takeoffId))
    .limit(1);
  if (!takeoff) return 0;

  const sheets = await db
    .select({ id: takeoffSheets.id })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.standaloneTakeoffId, takeoff.id));
  if (sheets.length === 0) return 0;

  const updates: RateUpdate[] = [];
  for (const sheet of sheets) {
    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, sheet.id));
    for (const m of measurements) {
      const code = m.costCodeId ?? null;
      const unit = unitForMeasurementType(m.type);
      const unitCost = Number(m.unitCost ?? 0);
      if (!code || !unit || !Number.isFinite(unitCost) || unitCost <= 0) continue;
      updates.push({
        costCode: code,
        metric: "unit_cost",
        unit,
        value: unitCost,
        sourceType: "library_assignment",
        sourceRowId: m.id,
        projectId: destination.projectId ?? null,
        bidId: destination.bidId ?? null,
      });
    }
  }
  if (updates.length === 0) return 0;
  return bulkRecordRateSamples(takeoff.organizationId, updates);
}

/** Fire-and-forget wrapper used by the route handlers — never throws. */
export function indexStandaloneTakeoffSafe(takeoffId: string): void {
  indexStandaloneTakeoff(takeoffId).catch((err) => {
    logWarn("standalone takeoff indexing failed", {
      takeoffId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Fire-and-forget wrapper used by the tag handler — never throws. */
export function emitLibraryAssignmentSamplesSafe(
  takeoffId: string,
  destination: { bidId?: string | null; projectId?: string | null },
): void {
  emitLibraryAssignmentSamplesForTakeoff(takeoffId, destination).catch((err) => {
    logWarn("standalone takeoff library_assignment samples failed", {
      takeoffId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
