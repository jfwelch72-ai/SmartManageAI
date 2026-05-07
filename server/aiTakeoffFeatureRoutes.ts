import { Router , NextFunction } from "express";
import { db } from "./db";
import { sensitiveLimiter } from "./rateLimiter";
import {
  aiTakeoffAnalyses,
  aiTakeoffSuggestions,
  aiTakeoffConfidenceCalibration,
  organizations,
  takeoffSheets,
  AI_TAKEOFF_SUPPRESSION_FLOOR_DEFAULT,
  AI_TAKEOFF_SUPPRESSION_FLOOR_MIN,
  AI_TAKEOFF_SUPPRESSION_FLOOR_MAX,
  AI_TAKEOFF_SUPPRESSION_MIN_SAMPLES,
  WEAKEST_TRADE_MIN_REVIEWED_DEFAULT,
  WEAKEST_TRADE_MIN_REVIEWED_MIN,
  WEAKEST_TRADE_MIN_REVIEWED_MAX,
} from "@shared/schema";
import { eq, desc, and, gte, lte, sql, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logError, logInfo, logWarn } from "./utils/logger";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";
import { governedAiCall } from "./services/aiGovernance";
// Task #2410 — Takeoff family AI calls flow through the provider router so
// they can be routed to Anthropic Claude per-org. The router preserves
// OpenAI-shaped responses, so call sites only swap the function name.
import { routedChatCompletion } from "./ai/providers";
import { isFeatureEnabled } from "./services/featureFlagService";
import {
  VALID_DB_TRADE_TYPES,
  isValidDbTradeType as isValidTradeType,
  type DbTradeType as TradeType,
} from "./ai/tradeTypeValidation";
import { evaluateScaleMismatch, parseDrawingScaleString } from "@shared/scalePresets";
import {
  MAX_RASTER_PIXELS,
  computeRasterScale,
  buildScaleGroundingClause,
  type SheetCalibration,
} from "./aiTakeoffHelpers";
import { computeAiTakeoffAccuracy } from "./aiTakeoffAccuracy";

// Re-export for callers that historically reached for these via the routes
// module (kept stable for tests and any future consumers).
export { MAX_RASTER_PIXELS, computeRasterScale, buildScaleGroundingClause };

const router = Router();


// ============================================
// FEATURE A: AI AUTO-TAKEOFF ROUTES
// ============================================

const aiTakeoffAnalyzeSchema = z.object({
  projectId: z.string().optional(),
  bidId: z.string().optional(),
  // Task #2550 follow-up — standalone takeoff workspace also runs AI auto-takeoff.
  standaloneTakeoffId: z.string().optional(),
  takeoffSheetId: z.string().optional(),
  tradeType: z.string().optional(),
  analysisMode: z.enum(["QUICK", "DETAILED"]).default("QUICK"),
  focusAreas: z.array(z.string()).optional(),
});

// POST /api/ai-features/takeoff/analyze - Trigger AI analysis
router.post("/ai-features/takeoff/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = aiTakeoffAnalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, bidId, standaloneTakeoffId, takeoffSheetId, tradeType, analysisMode, focusAreas } = parsed.data;

    if (!projectId && !bidId && !standaloneTakeoffId) {
      return res.status(400).json({ error: "Either projectId, bidId, or standaloneTakeoffId is required" });
    }

    // Org-scope check for standalone takeoff parent (project/bid paths are
    // already org-scoped downstream when records are loaded for analysis).
    if (standaloneTakeoffId) {
      const { standaloneTakeoffs } = await import("@shared/schema");
      const [st] = await db
        .select({ id: standaloneTakeoffs.id })
        .from(standaloneTakeoffs)
        .where(and(eq(standaloneTakeoffs.id, standaloneTakeoffId), eq(standaloneTakeoffs.organizationId, organizationId)))
        .limit(1);
      if (!st) {
        return res.status(404).json({ error: "Standalone takeoff not found" });
      }
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    const orgTradeType = org?.tradeType;
    const validatedTradeType = tradeType && isValidTradeType(tradeType) ? tradeType : undefined;
    const needsAutoDetection = !validatedTradeType && !isValidTradeType(orgTradeType);
    const effectiveTradeType = validatedTradeType || (isValidTradeType(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    // Create analysis record
    const [analysis] = await db.insert(aiTakeoffAnalyses).values({
      organizationId,
      projectId: projectId || null,
      bidId: bidId || null,
      standaloneTakeoffId: standaloneTakeoffId || null,
      takeoffSheetId: takeoffSheetId || null,
      tradeType: effectiveTradeType as any,
      status: "PENDING",
      analysisMode: analysisMode as any,
      createdByUserId: userId,
    }).returning();

    // Task #2481 — enqueue on the background queue instead of using a
    // request-scoped setTimeout (which lost work on a redeploy and
    // couldn't be retried). The handler lives at
    // `server/jobQueue/handlers/aiTakeoff.ts`.
    const { enqueueJob } = await import("./jobQueue");
    const enqueued = await enqueueJob(
      "ai_takeoff_analyze",
      {
        analysisId: analysis.id,
        tradeType: effectiveTradeType,
        focusAreas,
        needsAutoDetection,
        userId,
      },
      {
        organizationId,
        userId,
        idempotencyKey: `ai_takeoff_analyze:${analysis.id}`,
      },
    );

    res.json({
      success: true,
      analysisId: analysis.id,
      status: "QUEUED",
      jobId: enqueued.jobId,
      deduplicated: enqueued.deduplicated,
      estimatedTime: analysisMode === "QUICK" ? 30 : 120,
    });
  } catch (error) {
    next(error);
  }
});

interface RawDetectedItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  itemType: string;
  confidence: number;
  boundingBox?: { x: number; y: number; w: number; h: number };
  suggestedSowItem?: { code: string; description: string };
  // Task #2323 — when calibration overrides the model-reported value,
  // we keep the raw model confidence here so the UI can show "model
  // said X%, your team historically accepts Y%" tooltips.
  rawConfidence?: number;
  calibrationSamples?: number;
}

function deduplicateDetectedItems(items: RawDetectedItem[]): RawDetectedItem[] {
  if (items.length <= 1) return items;

  const merged: RawDetectedItem[] = [];
  const used = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;

    let current = { ...items[i] };

    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;

      const other = items[j];
      if (current.itemType !== other.itemType) continue;
      if (current.unit !== other.unit) continue;

      if (current.boundingBox && other.boundingBox) {
        const overlap = computeBBoxOverlap(current.boundingBox, other.boundingBox);
        if (overlap > 0.5) {
          current.confidence = Math.max(current.confidence, other.confidence);
          current.quantity = Math.max(current.quantity, other.quantity);
          used.add(j);
        }
      } else {
        const descA = (current.description || "").toLowerCase();
        const descB = (other.description || "").toLowerCase();
        if (descA === descB || (descA.length > 10 && descB.includes(descA.substring(0, 10)))) {
          current.confidence = Math.max(current.confidence, other.confidence);
          current.quantity = Math.max(current.quantity, other.quantity);
          used.add(j);
        }
      }
    }

    merged.push(current);
  }

  return merged.map((item, index) => ({ ...item, id: `item-${index + 1}` }));
}

function computeBBoxOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  if (x2 <= x1 || y2 <= y1) return 0;

  const intersectionArea = (x2 - x1) * (y2 - y1);
  const aArea = a.w * a.h;
  const bArea = b.w * b.h;
  const unionArea = aArea + bArea - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

async function classifyTradeType(imageUrl: string, orgId: string, userId: string | null | undefined): Promise<{ trade: string; confidence: number }> {
  if (!openai) {
    return { trade: "GENERAL_CONTRACTOR", confidence: 0 };
  }

  try {
    const govResult = await governedAiCall({
      orgId,
      userId: userId ?? null,
      actionType: "takeoff_analysis",
      inputRefs: {},
      fn: async () => {
        const completion = await routedChatCompletion({
          orgId,
          featureKey: "takeoff.classify_trade",
          request: {
          // Task #2322 — Trade classifier was running on gpt-4o while every
          // downstream prompt runs on gpt-5.2; a wrong classification cascades
          // into the wrong per-trade prompt and the wrong items, so put the
          // gate on the same model as the heavy passes. When routed to Claude
          // we let the provider pick its own default (claude-sonnet-4-5).
          messages: [
            {
              role: "system",
              content: `You are a construction drawing classifier. Given a blueprint or construction drawing image, identify the PRIMARY trade type it belongs to.

Choose exactly ONE from this list:
${VALID_DB_TRADE_TYPES.join(", ")}

Guidelines:
- ELECTRICAL: drawings with circuit symbols, panel schedules, outlet/switch symbols, conduit runs
- PLUMBING: drawings with pipe runs, fixture schedules, drain/waste/vent symbols
- HVAC: drawings with ductwork, diffusers, mechanical equipment schedules, refrigerant lines
- ROOFING: roof plans with slope indicators, ridge/valley lines, penetration details
- CONCRETE: foundation plans, slab details, footing schedules, rebar callouts
- CARPENTRY: framing plans, door/window schedules, wood member callouts
- MASONRY: CMU wall layouts, brick veneer details, lintel schedules
- DRYWALL: partition plans with wall type callouts, ceiling plans
- PAINTING: finish schedules, color-coded floor plans
- FLOORING: floor finish plans, tile layout drawings
- LANDSCAPING: site plans with planting areas, irrigation layouts
- DEMOLITION: demo plans with removal hatching/symbols
- STEEL_ERECTION: structural steel plans, connection details, steel schedules
- GLAZING: curtain wall details, storefront elevations
- INSULATION: insulation details, thermal envelope drawings
- FIRE_PROTECTION: sprinkler layouts, fire alarm riser diagrams
- LOW_VOLTAGE: data/comm layouts, security system plans
- SOLAR: PV array layouts, inverter schedules
- WATERPROOFING: below-grade waterproofing details, membrane specifications
- EARTHWORK: grading plans, cut/fill diagrams, excavation details
- ASPHALT_PAVING: paving plans, striping layouts
- GENERAL_CONTRACTOR: mixed-trade or unclear drawings
- OTHER: non-construction or unrecognizable drawings

Return JSON: { "trade": "TRADE_TYPE", "confidence": number (0-100), "reasoning": "brief explanation" }`
            },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
                { type: "text", text: "Classify this construction drawing. What trade type does it primarily represent?" }
              ]
            }
          ],
          // Task #2322 — Bumped from 256 alongside the gpt-5.2 switch; the
          // classifier prompt asks for `{ trade, confidence, reasoning }` and
          // 256 occasionally truncated the JSON when the model walked through
          // a longer reasoning string before emitting the closing brace.
          max_completion_tokens: 512,
          response_format: { type: "json_object" },
          },
        });
        return { result: completion.choices[0]?.message?.content, completion };
      },
    });

    if (govResult.blocked || !govResult.result) {
      return { trade: "GENERAL_CONTRACTOR", confidence: 0 };
    }

    const parsed = JSON.parse(govResult.result);
    const detectedTrade = parsed.trade?.toUpperCase();
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    if (isValidTradeType(detectedTrade) && confidence >= 40) {
      return { trade: detectedTrade, confidence };
    }

    return { trade: "GENERAL_CONTRACTOR", confidence: 0 };
  } catch (error) {
    logError("Trade classification error:", {}, error instanceof Error ? error : new Error(String(error)));
    return { trade: "GENERAL_CONTRACTOR", confidence: 0 };
  }
}

const TRADE_DETECTION_PROMPTS: Record<string, string> = {
  ROOFING: "Focus on: roof planes (measure total area in SQ = 100 SF), ridges and hips (LF), valleys (LF), penetrations/boots (EA), drip edge (LF along eaves and rakes), gutters/downspouts (LF and EA), shingle/membrane areas, underlayment (SF), flashing at walls and chimneys (LF), ventilation (ridge vents LF, box vents EA). Look for slope indicators and calculate pitched area. Differentiate between main roof and lower roof sections.",
  ELECTRICAL: "Focus on: main/sub panels (EA, note amperage), duplex/GFCI/special outlets (EA, note voltage), switches - single/3-way/dimmer (EA), light fixtures by type - recessed/surface/pendant (EA), conduit runs (LF, note size), wire pulls by gauge (LF), junction boxes (EA), dedicated circuits for HVAC/appliances. Count symbols on floor plans carefully, check schedules for fixture types.",
  PLUMBING: "Focus on: fixtures by type - lavatories/water closets/urinals/sinks (EA), pipe runs by material and size - PVC/copper/PEX (LF), drain/waste/vent piping (LF, note diameter), water heaters (EA, note capacity), valves by type (EA), cleanouts (EA), floor drains (EA), hose bibs (EA). Reference fixture schedules. Count rough-in points separately from finish fixtures.",
  HVAC: "Focus on: supply/return ductwork by size - rectangular and round (LF), supply registers/diffusers (EA, note CFM and size), return air grilles (EA), RTUs/AHUs/split systems (EA, note tonnage), thermostats (EA), exhaust fans (EA, note CFM), duct insulation (SF), refrigerant piping (LF). Check mechanical schedules for equipment specifications.",
  CONCRETE: "Focus on: slabs on grade by thickness and strength (CY, note PSI), continuous/spread footings (CY, note dimensions), foundation walls (CY), columns/piers (CY), rebar by size and spacing (TON), welded wire mesh (SF), formwork - strip/wall/column (SF of contact area), control/expansion joints (LF), anchor bolts (EA). Calculate volumes from dimensions shown.",
  CARPENTRY: "Focus on: wall framing - studs by size and spacing (LF), top/bottom plates (LF), headers (LF by size), sheathing - OSB/plywood (SF), roof trusses/rafters (EA or LF), floor joists (LF), blocking/fire stops (LF), exterior/interior doors with hardware (EA, note size), windows (EA, note size), base/crown trim (LF), subfloor (SF). Check framing plans and door/window schedules.",
  MASONRY: "Focus on: CMU/brick walls by thickness (SF of face area), lintels - steel/precast (EA or LF), vertical/horizontal reinforcement (LF or TON), mortar joints (included in wall SF), control joints (LF), wall ties (EA), grout-filled cells (LF), stone veneer (SF), caps/coping (LF). Calculate block counts from wall areas.",
  PAINTING: "Focus on: wall areas net of openings (SF, note coats), ceiling areas (SF, note type - flat/textured), door/frame painting (EA, both sides), window trim (EA or LF), base/crown painting (LF), accent walls (SF), primer application (SF), exterior surfaces separately (SF). Deduct window/door openings from wall areas.",
  FLOORING: "Focus on: floor covering by type - tile/carpet/LVP/hardwood (SF), transitions/thresholds between materials (EA or LF), wall base - rubber/wood/tile (LF), underlayment/backer board (SF), floor prep/leveling (SF), stair treads/risers (EA), carpet pad (SY). Check finish schedules for material specifications.",
  DRYWALL: "Focus on: wall/ceiling board by type and thickness - regular/Type X/moisture resistant (SF), metal studs by gauge and spacing (LF), corner bead - paper/metal (LF), joint compound/tape (included in SF), insulation by R-value (SF), acoustic treatment (SF), soffits/bulkheads (LF or SF), access panels (EA). Measure wall heights and lengths to compute areas.",
  LANDSCAPING: "Focus on: sod/seed areas (SF), mulch beds by depth (CY or SF), trees by caliper (EA), shrubs (EA), irrigation zones - drip/spray (EA), hardscape - pavers/stone (SF), retaining walls (SF or LF), fencing (LF), drainage features (LF or EA). Check site plans and planting plans.",
  DEMOLITION: "Focus on: interior selective demo by type (SF), concrete removal by thickness (SF or CY), hazmat abatement (SF), debris hauling (loads EA), sawcutting (LF), structural demo (LS or EA). Note any hazardous material indicators.",
  STEEL_ERECTION: "Focus on: columns by section size (EA, note weight/LF), beams/girders (LF, note section), open web joists (EA, note series), metal deck by gauge (SF), connections/base plates (EA), stair stringers/treads (EA or flights). Reference structural steel schedules.",
  GENERAL_CONTRACTOR: "Comprehensive analysis across all visible trades. Group detected items by trade type (structural, architectural, mechanical, electrical, plumbing, sitework). Measure using appropriate units for each trade. Identify the drawing type (plan, elevation, section, detail) and note any visible dimensions, scales, or specifications.",
};

// Task #2323 — bucket a model-reported confidence into the [60, 70, 80, 90]
// lower-bound buckets used by the calibration table. Anything below 60 falls
// into the 60 bucket so we still apply the org's empirical rate when it has
// enough samples.
function confidenceBucket(c: number): number {
  if (c >= 90) return 90;
  if (c >= 80) return 80;
  if (c >= 70) return 70;
  return 60;
}

// Task #2323 — pulls the per-(org, trade) calibration map. Returns a Map keyed
// by bucket -> { rate, samples } so the per-item override can be applied without
// a query per item.
async function loadCalibrationMap(
  organizationId: string,
  tradeType: string,
): Promise<Map<number, { rate: number; samples: number }>> {
  const rows = await db.select({
    bucket: aiTakeoffConfidenceCalibration.modelConfidenceBucket,
    rate: aiTakeoffConfidenceCalibration.empiricalAcceptanceRate,
    samples: aiTakeoffConfidenceCalibration.sampleCount,
  })
    .from(aiTakeoffConfidenceCalibration)
    .where(and(
      eq(aiTakeoffConfidenceCalibration.organizationId, organizationId),
      eq(aiTakeoffConfidenceCalibration.tradeType, tradeType as TradeType),
    ));
  const map = new Map<number, { rate: number; samples: number }>();
  for (const row of rows) {
    map.set(row.bucket, { rate: Number(row.rate), samples: row.samples });
  }
  return map;
}

const FEW_SHOT_SAMPLE_LIMIT = 5;
const FEW_SHOT_QTY_DELTA_THRESHOLD = 0.1; // 10%

// Task #2323 — fetches up to N recent EDITED suggestions for the (org, trade)
// where the user changed quantity by >10%, and renders them as a compact
// "Recent corrections from your team" block. Capped at ~500 tokens. Returns
// "" when feature flag is off or no usable corrections exist.
async function buildFewShotCorrectionsBlock(
  organizationId: string,
  tradeType: string,
): Promise<string> {
  try {
    const enabled = await isFeatureEnabled(organizationId, "AI_TAKEOFF_FEW_SHOT");
    if (!enabled) return "";

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db.select({
      itemType: aiTakeoffSuggestions.itemType,
      description: aiTakeoffSuggestions.description,
      quantity: aiTakeoffSuggestions.quantity,
      unit: aiTakeoffSuggestions.unit,
      editedQuantity: aiTakeoffSuggestions.editedQuantity,
      editedUnit: aiTakeoffSuggestions.editedUnit,
    })
      .from(aiTakeoffSuggestions)
      .where(and(
        eq(aiTakeoffSuggestions.organizationId, organizationId),
        eq(aiTakeoffSuggestions.tradeType, tradeType as TradeType),
        eq(aiTakeoffSuggestions.status, "EDITED"),
        gte(aiTakeoffSuggestions.reviewedAt, ninetyDaysAgo),
        isNotNull(aiTakeoffSuggestions.editedQuantity),
      ))
      .orderBy(desc(aiTakeoffSuggestions.reviewedAt))
      .limit(50);

    const usable = rows
      .filter((r) => {
        const orig = Number(r.quantity);
        const edited = Number(r.editedQuantity);
        if (!Number.isFinite(orig) || !Number.isFinite(edited) || orig === 0) return false;
        return Math.abs(edited - orig) / Math.abs(orig) > FEW_SHOT_QTY_DELTA_THRESHOLD;
      })
      .slice(0, FEW_SHOT_SAMPLE_LIMIT);

    if (usable.length === 0) return "";

    const lines = usable.map((r) => {
      const unit = r.editedUnit || r.unit;
      const arrow = `${r.quantity} ${r.unit} -> ${r.editedQuantity} ${unit}`;
      const desc = (r.description || r.itemType || "").slice(0, 80);
      return `- "${desc}": ${arrow}`;
    });

    return `\nRecent corrections from your team (apply these patterns):\n${lines.join("\n")}\n`;
  } catch (err) {
    logError(
      "Few-shot corrections lookup failed (non-fatal):",
      { organizationId, tradeType },
      err instanceof Error ? err : new Error(String(err)),
    );
    return "";
  }
}

// Task #2323 — Persist per-item suggestion rows for the closed-loop dashboard.
// Adjusts each item's `confidence` to the org's empirical acceptance rate when
// the bucket has >=30 samples, and exposes both the original + adjusted values
// in metadata so the UI can show a tooltip explaining which one is in effect.
async function persistSuggestionsAndApplyCalibration(
  analysis: { id: string; organizationId: string },
  tradeType: string,
  detectedItems: RawDetectedItem[],
): Promise<{ items: RawDetectedItem[]; calibrationApplied: boolean }> {
  if (detectedItems.length === 0) {
    return { items: detectedItems, calibrationApplied: false };
  }
  const calibration = await loadCalibrationMap(analysis.organizationId, tradeType);

  let calibrationApplied = false;
  const adjusted: RawDetectedItem[] = detectedItems.map((item) => {
    const bucket = confidenceBucket(item.confidence);
    const entry = calibration.get(bucket);
    if (entry && entry.samples >= 30) {
      calibrationApplied = true;
      const displayed = Math.round(entry.rate * 100);
      return {
        ...item,
        confidence: displayed,
        rawConfidence: item.confidence,
        calibrationSamples: entry.samples,
      };
    }
    return item;
  });

  // Insert suggestion rows in a single batch.
  // Task #2343 — `ON CONFLICT (analysis_id, item_key) DO NOTHING` against the
  // `ai_takeoff_sug_analysis_item_key_uq` unique index makes this insert
  // crash-safe and idempotent under retries (e.g. a partial failure or a
  // manual re-run of `processAiTakeoff`), and also no-ops when a payload
  // happens to repeat positional `item-1` ids within itself or when the
  // boot-time backfill / standalone backfill script already populated the
  // row for this analysis.
  try {
    await db.insert(aiTakeoffSuggestions).values(
      adjusted.map((item) => ({
        analysisId: analysis.id,
        organizationId: analysis.organizationId,
        tradeType: tradeType as TradeType,
        itemKey: item.id,
        itemType: item.itemType,
        description: item.description,
        // Persist the model-reported confidence so calibration math stays
        // honest — `rawConfidence` falls back to `confidence` when no
        // override was applied.
        quantity: item.quantity,
        unit: item.unit,
        confidence: (item as any).rawConfidence ?? item.confidence,
        boundingBoxJson: item.boundingBox ? JSON.stringify(item.boundingBox) : null,
        status: "PENDING" as const,
      })),
    ).onConflictDoNothing({
      target: [aiTakeoffSuggestions.analysisId, aiTakeoffSuggestions.itemKey],
    });
  } catch (err) {
    logError(
      "Failed to persist ai_takeoff_suggestions rows:",
      { analysisId: analysis.id, count: adjusted.length },
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  return { items: adjusted, calibrationApplied };
}

export type AiTakeoffProgressFn = (
  pct: number,
  message: string,
  meta?: Record<string, unknown>,
) => void | Promise<void>;

export async function processAiTakeoff(
  analysisId: string,
  tradeType: string,
  focusAreas?: string[],
  needsAutoDetection?: boolean,
  userId?: string | null,
  onProgress?: AiTakeoffProgressFn,
) {
  const startTime = Date.now();
  const reportProgress = async (
    pct: number,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    if (!onProgress) return;
    try {
      await onProgress(pct, message, meta);
    } catch {
      // Progress reporting must never break the analysis pipeline.
    }
  };

  await db.update(aiTakeoffAnalyses)
    .set({ status: "PROCESSING" })
    .where(eq(aiTakeoffAnalyses.id, analysisId));
  await reportProgress(10, "Loading takeoff sheet");

  try {
    // Get the analysis record to find associated takeoff sheet
    const [analysis] = await db.select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, analysisId));

    let imageUrl: string | null = null;
    let sheetIndex = 0;
    // Task #2322 — Capture the user's verified calibration so the model can be
    // grounded in it instead of re-inferring scale from the title block on
    // every analysis. `db.select()` already pulls every column on the row, so
    // we just hold a reference to the loaded record.
    let sheetCalibration: SheetCalibration | null = null;
    // Task #2336 — Track which raster scale was actually applied to the page
    // and whether the 30 MP cap engaged, so we can surface the trade-off in
    // the takeoff result panel. Both stay null when no PDF was rendered (e.g.
    // the source was already an image, the file was too large to render, or
    // we fell through to demo/fallback mode).
    let rasterScaleUsed: number | null = null;
    let rasterCapped = false;

    // Try to get image from takeoff sheet if provided
    if (analysis?.takeoffSheetId) {
      const [sheet] = await db.select()
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, analysis.takeoffSheetId));
      if (sheet?.imageUrl) {
        imageUrl = sheet.imageUrl;
      }
      if (sheet) {
        sheetIndex = sheet.sheetIndex || 0;
        sheetCalibration = {
          scalePxPerFoot: sheet.scalePxPerFoot,
          scaleLabel: sheet.scaleLabel,
          units: sheet.units,
        };
      }
    }

    if (imageUrl) {
      await reportProgress(20, "Fetching plan PDF");
      try {
        const { openPdfFromGcs, PDF_BUFFERED_PARSE_MAX_BYTES } = await import("./utils/pdfPageCount");
        let gcsFile: import("@google-cloud/storage").File | null = null;

        if (imageUrl.startsWith("https://storage.googleapis.com/")) {
          const url = new URL(imageUrl);
          const pathParts = url.pathname.slice(1).split("/");
          const bucketName = pathParts[0];
          const objectName = pathParts.slice(1).join("/");
          gcsFile = objectStorageClient.bucket(bucketName).file(objectName);
        } else if (imageUrl.startsWith("/objects/")) {
          const objectStorageService = new ObjectStorageService();
          gcsFile = await objectStorageService.getObjectEntityFile(imageUrl);
        }

        if (gcsFile) {
          let fileSize = 0;
          let contentType = "";
          try {
            const [metadata] = await gcsFile.getMetadata();
            fileSize = parseInt(metadata.size as string) || 0;
            contentType = ((metadata.contentType as string) || "").toLowerCase();
          } catch (metaError) {
            logError(
              "Failed to read object metadata for AI takeoff:",
              { imageUrl },
              metaError instanceof Error ? metaError : new Error(String(metaError)),
            );
          }

          let looksLikePdf =
            contentType.includes("pdf") || imageUrl.toLowerCase().endsWith(".pdf");
          const inconclusive =
            !contentType && !imageUrl.toLowerCase().match(/\.(pdf|png|jpe?g|gif|webp|tiff?|bmp)$/);
          if (inconclusive) {
            try {
              const [magic] = await gcsFile.download({ start: 0, end: 7 });
              if (magic && magic.length >= 4) {
                looksLikePdf = magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46;
              }
            } catch (magicError) {
              logError(
                "Failed to read PDF magic bytes for AI takeoff:",
                { imageUrl },
                magicError instanceof Error ? magicError : new Error(String(magicError)),
              );
            }
          }

          let rendered = false;

          if (looksLikePdf && sheetIndex >= 0) {
            const opened = await openPdfFromGcs(gcsFile, {
              fileSize,
              fileName: imageUrl,
              loggerContext: { route: "ai-takeoff/render-page", analysisId },
            });
            if (opened) {
              try {
                const pageNum = Math.min(sheetIndex + 1, opened.numPages);
                const page = await opened.pdfDoc.getPage(pageNum);

                // Task #2322 — Adaptive rasterization. Use the source page
                // size to pick a higher raster scale on large civil sheets so
                // fine symbols survive, capped by `MAX_RASTER_PIXELS`.
                // Task #2336 — Capture the resolved scale + cap flag so the
                // UI can show estimators what raster scale the AI saw.
                const baseViewport = page.getViewport({ scale: 1 });
                const rasterResult = computeRasterScale(baseViewport.width, baseViewport.height);
                const scale = rasterResult.scale;
                rasterScaleUsed = scale;
                rasterCapped = rasterResult.capped;
                const viewport = page.getViewport({ scale });

                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => any };
                const canvas = createCanvas(viewport.width, viewport.height);
                const context = canvas.getContext('2d');

                await page.render({ canvasContext: context, viewport, canvas } as any).promise;

                const pngBuffer = canvas.toBuffer('image/png') as Buffer;
                const base64Data = pngBuffer.toString("base64");
                imageUrl = `data:image/png;base64,${base64Data}`;
                rendered = true;
              } catch (pdfRenderError) {
                logError(
                  "PDF page render failed for AI takeoff:",
                  { analysisId, imageUrl, fileSize },
                  pdfRenderError instanceof Error ? pdfRenderError : new Error(String(pdfRenderError)),
                );
              } finally {
                await opened.close();
              }
            }
          }

          if (!rendered) {
            if (looksLikePdf) {
              if (fileSize > 0 && fileSize <= PDF_BUFFERED_PARSE_MAX_BYTES) {
                const [buffer] = await gcsFile.download();
                const base64Data = buffer.toString("base64");
                imageUrl = `data:application/pdf;base64,${base64Data}`;
              } else {
                logError(
                  "Skipping inline PDF for AI takeoff (file too large or unknown size):",
                  { analysisId, imageUrl, fileSize },
                );
                imageUrl = null;
              }
            } else {
              if (fileSize > 0 && fileSize <= PDF_BUFFERED_PARSE_MAX_BYTES) {
                const [buffer] = await gcsFile.download();
                const base64Data = buffer.toString("base64");
                imageUrl = `data:image/png;base64,${base64Data}`;
              } else if (fileSize === 0) {
                const [buffer] = await gcsFile.download();
                const base64Data = buffer.toString("base64");
                imageUrl = `data:image/png;base64,${base64Data}`;
              } else {
                logError(
                  "Skipping inline image for AI takeoff (file too large):",
                  { analysisId, imageUrl, fileSize },
                );
                imageUrl = null;
              }
            }
          }
        }
      } catch (downloadError) {
        logError("Failed to download image for AI takeoff:", {}, downloadError instanceof Error ? downloadError : new Error(String(downloadError)));
        imageUrl = null;
      }
    }

    let detectedItems: RawDetectedItem[];
    let metadata: Record<string, unknown>;
    let aiNotes: string;
    let tradeAutoDetected = false;
    let tradeDetectionConfidence = 0;
    // Task #2335 — Set inside the OpenAI branch when both calibration and a
    // model-emitted drawingScale are present. Drives the new persisted
    // columns on `ai_takeoff_analyses`; demo / mock branches leave it null
    // so those rows record as "not applicable" rather than false-positive
    // mismatches in the dashboard.
    let scaleMismatchEval: ReturnType<typeof evaluateScaleMismatch> = null;

    if (needsAutoDetection && imageUrl) {
      await reportProgress(35, "Detecting trade type from drawing");
      const classification = await classifyTradeType(imageUrl, analysis.organizationId, userId);
      if (classification.confidence >= 40) {
        tradeType = classification.trade;
        tradeAutoDetected = true;
        tradeDetectionConfidence = classification.confidence;

        await db.update(aiTakeoffAnalyses)
          .set({ tradeType: tradeType as TradeType })
          .where(eq(aiTakeoffAnalyses.id, analysisId));
      }
    }

    const analysisMode = analysis?.analysisMode || "QUICK";

    if (imageUrl && openai) {
      await reportProgress(50, "Calling AI vision model");
      try {
        const tradePrompt = TRADE_DETECTION_PROMPTS[tradeType] || TRADE_DETECTION_PROMPTS.GENERAL_CONTRACTOR;
        const focusAreaPrompt = focusAreas?.length ? `Focus especially on: ${focusAreas.join(", ")}. ` : "";
        // Task #2322 — Ground the model in the user's verified scale. When the
        // sheet is uncalibrated, the clause tells the model to flag low
        // confidence on dimension-derived units (LF, SF, CY).
        const scaleGroundingClause = buildScaleGroundingClause(sheetCalibration);
        // Task #2323 — closed-loop few-shot. Empty string when feature
        // flag is off or no usable corrections exist.
        const fewShotBlock = await buildFewShotCorrectionsBlock(
          analysis.organizationId,
          tradeType,
        );

        const govResult = await governedAiCall({
          orgId: analysis.organizationId,
          userId: analysis.createdByUserId,
          actionType: "takeoff_analysis",
          inputRefs: { projectId: analysis.projectId },
          fn: async () => {
            const completion = await routedChatCompletion({
              orgId: analysis.organizationId,
              featureKey: "takeoff.analyze",
              request: {
              messages: [
                {
                  role: "system",
                  content: `You are a construction takeoff specialist analyzing blueprints and construction drawings.
${tradePrompt}
${focusAreaPrompt}
${scaleGroundingClause}
${fewShotBlock}
Analyze the image and extract all measurable quantities for a construction estimate.

IMPORTANT: For each detected item, provide a bounding box indicating where on the drawing it was found.
The bounding box should be expressed as percentage coordinates relative to the full image dimensions:
- x: left edge as percentage (0-100) of image width
- y: top edge as percentage (0-100) of image height
- w: width as percentage (0-100) of image width
- h: height as percentage (0-100) of image height

CONFIDENCE SCORING GUIDELINES:
- 90-100: Item is clearly visible and unambiguous (labeled symbols, clear dimensions)
- 75-89: Item is likely present based on standard drawing conventions
- 60-74: Item is inferred from context or partially visible
- Below 60: Uncertain detection, may need manual verification

Return your analysis as JSON with this exact structure:
{
  "detectedItems": [
    {
      "itemType": "string (e.g., roof_plane, outlet, slab)",
      "description": "string (detailed description including specifications if visible)",
      "quantity": number,
      "unit": "string (SQ, SF, LF, EA, CY, etc.)",
      "confidence": number (0-100),
      "boundingBox": { "x": number, "y": number, "w": number, "h": number },
      "notes": "string (optional additional notes, dimensions, or specifications)"
    }
  ],
  "metadata": {
    "drawingScale": "string or null (e.g., 1/4 inch = 1 foot)",
    "pageSize": "string or null (e.g., 24x36, ARCH D)",
    "titleBlock": "string or null (project name, drawing number)",
    "drawingType": "string (plan, elevation, section, detail, schedule)"
  },
  "summary": "string (brief summary of what was detected)"
}`
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: { url: imageUrl, detail: "high" }
                    },
                    {
                      type: "text",
                      // Task #2322 — Repeat the scale-grounding clause in the
                      // per-call user message so it can't be lost behind the
                      // long system prompt; this is what actually anchors the
                      // model's quantity arithmetic.
                      text: `Analyze page ${sheetIndex + 1} of this construction document for ${tradeType} trade takeoff. ${scaleGroundingClause} Extract all measurable quantities with their locations on the drawing. Provide bounding box coordinates (as percentage of image dimensions) for each detected item.`
                    }
                  ]
                }
              ],
              max_completion_tokens: 8192,
              response_format: { type: "json_object" },
              },
            });
            return { result: completion.choices[0]?.message?.content, completion };
          },
        });

        if (govResult.blocked) {
          throw new Error(govResult.reason || "AI usage limit reached");
        }

        const responseContent = govResult.result || "";
        
        // Parse the JSON response
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          interface AiResponseItem {
            itemType: string;
            description: string;
            quantity: number;
            unit: string;
            confidence?: number;
            boundingBox?: { x: number; y: number; w: number; h: number };
            notes?: string;
            suggestedSowItem?: { code: string; description: string };
          }
          detectedItems = ((parsed.detectedItems || []) as AiResponseItem[]).map((item, index) => ({
            id: `item-${index + 1}`,
            itemType: item.itemType,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            confidence: item.confidence || 75,
            boundingBox: item.boundingBox ? {
              x: Math.max(0, Math.min(100, Number(item.boundingBox.x) || 0)),
              y: Math.max(0, Math.min(100, Number(item.boundingBox.y) || 0)),
              w: Math.max(0, Math.min(100, Number(item.boundingBox.w) || 10)),
              h: Math.max(0, Math.min(100, Number(item.boundingBox.h) || 10)),
            } : undefined,
            suggestedSowItem: item.suggestedSowItem,
          }));
          // Task #2322 — When the model still volunteers a `drawingScale`
          // (despite the grounding clause) and it disagrees with the user's
          // calibrated scale by >5%, surface a warning to the UI. We only
          // warn — quantities are not modified.
          // Task #2335 — Capture the structured evaluation (detected /
          // calibrated / delta) so it can also be persisted to columns on
          // `ai_takeoff_analyses` for the dashboard rollup.
          scaleMismatchEval = evaluateScaleMismatch(
            parsed.metadata?.drawingScale,
            sheetCalibration?.scalePxPerFoot ?? null,
            sheetCalibration?.scaleLabel ?? null,
          );
          // Task #2355 — When the title block explicitly disclaims a
          // paper-space scale ("NTS" / "AS SHOWN"), the mismatch warning
          // above is intentionally suppressed (no numeric scale to compare).
          // Surface that fact to the estimator instead so they can see the
          // AI noticed the NTS callout and is trusting their calibration.
          const parsedDrawingScale = parseDrawingScaleString(parsed.metadata?.drawingScale);
          const scaleNotToScale = parsedDrawingScale?.source === "not-to-scale"
            ? { label: parsedDrawingScale.label }
            : null;
          metadata = {
            drawingScale: parsed.metadata?.drawingScale,
            pageSize: parsed.metadata?.pageSize,
            titleBlock: parsed.metadata?.titleBlock,
            drawingType: parsed.metadata?.drawingType,
            tradeType,
            tradeAutoDetected,
            tradeDetectionConfidence: tradeAutoDetected ? tradeDetectionConfidence : undefined,
            analysisMethod: analysisMode === "DETAILED" ? "OpenAI Vision (Multi-Pass)" : "OpenAI Vision",
            analysisSource: "openai_vision",
            // Task #2335 — `scaleMismatchEval.message` is the structured
            // evaluation built once and reused for both the legacy banner
            // string and the persisted dashboard columns; it replaces the
            // earlier ad-hoc `scaleMismatchWarning` local.
            ...(scaleMismatchEval?.message ? { scaleMismatchWarning: scaleMismatchEval.message } : {}),
            // Task #2355 — When the title block explicitly disclaims a
            // paper-space scale ("NTS" / "AS SHOWN"), `evaluateScaleMismatch`
            // returns null (no numeric scale to compare). Surface that fact
            // to the estimator instead so they see the AI noticed and is
            // trusting their calibration. Mutually exclusive with the
            // mismatch warning above.
            ...(scaleNotToScale && !scaleMismatchEval?.message ? { scaleNotToScale } : {}),
            // Task #2336 — Surface the resolved raster scale + cap flag so
            // the panel can show "Rendered at 2.14×, capped at 30 MP" and
            // hint that splitting the sheet would let the AI see more detail.
            ...(rasterScaleUsed !== null ? { rasterScale: rasterScaleUsed } : {}),
            ...(rasterScaleUsed !== null ? { rasterCapped } : {}),
            ...(rasterScaleUsed !== null ? { rasterMaxPixels: MAX_RASTER_PIXELS } : {}),
          };

          if (analysisMode === "DETAILED" && detectedItems.length > 0) {
            await reportProgress(75, "Running quality verification pass");
            const verifyResult = await governedAiCall({
              orgId: analysis.organizationId,
              userId: analysis.createdByUserId,
              actionType: "takeoff_analysis",
              inputRefs: { projectId: analysis.projectId },
              fn: async () => {
                const verifyCompletion = await routedChatCompletion({
                  orgId: analysis.organizationId,
                  featureKey: "takeoff.verify_detailed",
                  request: {
                  messages: [
                    {
                      role: "system",
                      content: `You are a construction takeoff quality reviewer. A first-pass AI analysis detected the following items. Your job is to:
1. Verify quantities are reasonable for the drawing
2. Identify any MISSED items that should have been detected
3. Flag any DUPLICATE detections (overlapping items counted twice)
4. Adjust confidence scores based on your review

${scaleGroundingClause}

Return JSON with:
{
  "verifiedItems": [ same structure as input items, with adjusted quantities/confidence ],
  "newItems": [ any additional items missed in first pass ],
  "duplicateIds": [ ids of items that appear to be duplicates ],
  "reviewNotes": "string summary of changes made"
}`
                    },
                    {
                      role: "user",
                      content: [
                        { type: "image_url", image_url: { url: imageUrl!, detail: "high" } },
                        { type: "text", text: `Review these ${tradeType} trade detections from a first-pass analysis:\n${JSON.stringify(detectedItems, null, 2)}\n\nVerify quantities, find missed items, and flag duplicates.` }
                      ]
                    }
                  ],
                  max_completion_tokens: 8192,
                  response_format: { type: "json_object" },
                  },
                });
                return { result: verifyCompletion.choices[0]?.message?.content, completion: verifyCompletion };
              },
            });

            if (!verifyResult.blocked && verifyResult.result) {
              try {
                const verifyParsed = JSON.parse(verifyResult.result);
                if (verifyParsed.verifiedItems?.length > 0) {
                  detectedItems = (verifyParsed.verifiedItems as AiResponseItem[]).map((item, index) => ({
                    id: `item-${index + 1}`,
                    itemType: item.itemType,
                    description: item.description,
                    quantity: item.quantity,
                    unit: item.unit,
                    confidence: item.confidence || 75,
                    boundingBox: item.boundingBox ? {
                      x: Math.max(0, Math.min(100, Number(item.boundingBox.x) || 0)),
                      y: Math.max(0, Math.min(100, Number(item.boundingBox.y) || 0)),
                      w: Math.max(0, Math.min(100, Number(item.boundingBox.w) || 10)),
                      h: Math.max(0, Math.min(100, Number(item.boundingBox.h) || 10)),
                    } : undefined,
                    suggestedSowItem: item.suggestedSowItem,
                  }));
                }
                if (verifyParsed.newItems?.length > 0) {
                  const startIdx = detectedItems.length;
                  const newMapped = (verifyParsed.newItems as AiResponseItem[]).map((item, index) => ({
                    id: `item-${startIdx + index + 1}`,
                    itemType: item.itemType,
                    description: item.description,
                    quantity: item.quantity,
                    unit: item.unit,
                    confidence: item.confidence || 60,
                    boundingBox: item.boundingBox ? {
                      x: Math.max(0, Math.min(100, Number(item.boundingBox.x) || 0)),
                      y: Math.max(0, Math.min(100, Number(item.boundingBox.y) || 0)),
                      w: Math.max(0, Math.min(100, Number(item.boundingBox.w) || 10)),
                      h: Math.max(0, Math.min(100, Number(item.boundingBox.h) || 10)),
                    } : undefined,
                    suggestedSowItem: item.suggestedSowItem,
                  }));
                  detectedItems = [...detectedItems, ...newMapped];
                }
                if (verifyParsed.duplicateIds?.length > 0) {
                  const dupSet = new Set<string>(verifyParsed.duplicateIds);
                  detectedItems = detectedItems.filter((item) => !dupSet.has(item.id));
                }
                if (verifyParsed.reviewNotes) {
                  metadata.multiPassNotes = verifyParsed.reviewNotes;
                }
              } catch (verifyParseErr) {
                logWarn("Failed to parse multi-pass verification result:", verifyParseErr);
              }
            }
          }

          detectedItems = deduplicateDetectedItems(detectedItems);

          aiNotes = parsed.summary || `AI Vision detected ${detectedItems.length} items for ${tradeType} trade.`;
        } else {
          throw new Error("Could not parse AI response");
        }
      } catch (visionError) {
        logError("OpenAI Vision error, falling back to mock data:", {}, visionError instanceof Error ? visionError : new Error(String(visionError)));
        const tradeItems = generateTradeSpecificItems(tradeType);
        detectedItems = tradeItems.map((item, index) => ({
          id: `item-${index + 1}`,
          itemType: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          confidence: 70 + Math.floor(Math.random() * 25),
          boundingBox: item.boundingBox,
          suggestedSowItem: item.sowItem,
        }));
        metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, tradeAutoDetected, tradeDetectionConfidence: tradeAutoDetected ? tradeDetectionConfidence : undefined, analysisMethod: "Fallback (mock)", analysisSource: "demo_fallback" };
        aiNotes = `Fallback: Generated ${detectedItems.length} sample items for ${tradeType} trade.`;
      }
    } else {
      const tradeItems = generateTradeSpecificItems(tradeType);
      detectedItems = tradeItems.map((item, index) => ({
        id: `item-${index + 1}`,
        itemType: item.type,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        confidence: 70 + Math.floor(Math.random() * 25),
        boundingBox: item.boundingBox,
        suggestedSowItem: item.sowItem,
      }));
      metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, tradeAutoDetected: false, analysisMethod: "Demo (no image)", analysisSource: "demo_no_image" };
      aiNotes = `Demo mode: Generated ${detectedItems.length} sample items for ${tradeType} trade.`;
    }

    await reportProgress(85, "Persisting AI suggestions");
    // Task #2323 — apply per-org confidence calibration overrides AND
    // persist one PENDING suggestion row per detected item so the
    // accept/reject/edit-and-accept flow has something to update.
    const { items: calibratedItems, calibrationApplied } =
      await persistSuggestionsAndApplyCalibration(
        { id: analysisId, organizationId: analysis.organizationId },
        tradeType,
        detectedItems,
      );
    detectedItems = calibratedItems;
    if (calibrationApplied) {
      (metadata as Record<string, unknown>).calibrationApplied = true;
    }

    await db.update(aiTakeoffAnalyses)
      .set({
        status: "COMPLETE",
        detectedItemsJson: JSON.stringify(detectedItems),
        metadataJson: JSON.stringify(metadata),
        aiNotes,
        processingTimeMs: Date.now() - startTime,
        // Task #2335 — Mirror the in-memory mismatch evaluation onto the
        // queryable columns so the AI takeoff dashboard / report can
        // aggregate without re-parsing `metadata_json` for every row.
        scaleMismatchDetected: scaleMismatchEval?.mismatch ?? false,
        detectedScaleLabel: scaleMismatchEval?.detectedLabel ?? null,
        calibratedScaleLabel: scaleMismatchEval?.calibratedLabel ?? null,
        scaleDeltaPercent: scaleMismatchEval?.deltaPercent ?? null,
        updatedAt: new Date(),
      })
      .where(eq(aiTakeoffAnalyses.id, analysisId));
  } catch (error: unknown) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    logError("AI Takeoff processing error:", {}, errObj);
    await db.update(aiTakeoffAnalyses)
      .set({
        status: "FAILED",
        errorMessage: errObj.message || "Processing failed",
        processingTimeMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(aiTakeoffAnalyses.id, analysisId));
  }
}

function generateTradeSpecificItems(tradeType: string) {
  interface MockSowItem { name: string; code: string }
  const itemsByTrade: Record<string, Array<{type: string; description: string; quantity: number; unit: string; sowItem?: MockSowItem; boundingBox?: { x: number; y: number; w: number; h: number }}>> = {
    ROOFING: [
      { type: "roof_plane", description: "Main Roof Plane - Architectural Shingles", quantity: 28.5, unit: "SQ", sowItem: { name: "Architectural Shingles", code: "ROOF-SHNG-01" }, boundingBox: { x: 10, y: 15, w: 60, h: 50 } },
      { type: "ridge", description: "Ridge Cap", quantity: 45, unit: "LF", sowItem: { name: "Ridge Cap", code: "ROOF-RDG-01" }, boundingBox: { x: 15, y: 25, w: 55, h: 5 } },
      { type: "drip_edge", description: "Drip Edge - Aluminum", quantity: 180, unit: "LF", sowItem: { name: "Drip Edge", code: "ROOF-DRP-01" }, boundingBox: { x: 5, y: 10, w: 70, h: 65 } },
      { type: "penetration", description: "Pipe Boots", quantity: 4, unit: "EA", sowItem: { name: "Pipe Boot Flashing", code: "ROOF-PEN-01" }, boundingBox: { x: 35, y: 30, w: 8, h: 8 } },
    ],
    ELECTRICAL: [
      { type: "outlet", description: "Duplex Receptacles - 120V", quantity: 24, unit: "EA", sowItem: { name: "Duplex Receptacle", code: "ELEC-RCP-01" }, boundingBox: { x: 20, y: 20, w: 60, h: 60 } },
      { type: "switch", description: "Single Pole Switches", quantity: 12, unit: "EA", sowItem: { name: "Single Pole Switch", code: "ELEC-SW-01" }, boundingBox: { x: 25, y: 25, w: 50, h: 50 } },
      { type: "panel", description: "Main Panel - 200A", quantity: 1, unit: "EA", sowItem: { name: "Main Panel 200A", code: "ELEC-PNL-01" }, boundingBox: { x: 70, y: 40, w: 12, h: 18 } },
      { type: "wire_run", description: "12/2 Romex", quantity: 850, unit: "LF", sowItem: { name: "12/2 NM-B Wire", code: "ELEC-WR-01" }, boundingBox: { x: 10, y: 10, w: 80, h: 80 } },
    ],
    CONCRETE: [
      { type: "slab", description: "Slab on Grade - 4\" thick", quantity: 125, unit: "CY", sowItem: { name: "Concrete Slab", code: "CONC-SLB-01" }, boundingBox: { x: 10, y: 20, w: 65, h: 55 } },
      { type: "footing", description: "Continuous Footing", quantity: 18, unit: "CY", sowItem: { name: "Foundation Footing", code: "CONC-FTG-01" }, boundingBox: { x: 5, y: 60, w: 70, h: 15 } },
      { type: "rebar", description: "#4 Rebar Grid", quantity: 2.5, unit: "TON", sowItem: { name: "Rebar #4", code: "CONC-RBR-01" }, boundingBox: { x: 15, y: 25, w: 55, h: 45 } },
      { type: "formwork", description: "Foundation Forms", quantity: 320, unit: "SF", sowItem: { name: "Formwork", code: "CONC-FRM-01" }, boundingBox: { x: 5, y: 55, w: 72, h: 20 } },
    ],
    PLUMBING: [
      { type: "fixture", description: "Lavatory Sink", quantity: 8, unit: "EA", sowItem: { name: "Lavatory Sink", code: "PLMB-FIX-01" } },
      { type: "pipe_run", description: "2\" PVC Drain Line", quantity: 120, unit: "LF", sowItem: { name: "PVC Drain Pipe 2\"", code: "PLMB-DRN-01" } },
      { type: "fixture", description: "Water Closet", quantity: 6, unit: "EA", sowItem: { name: "Water Closet", code: "PLMB-FIX-02" } },
      { type: "valve", description: "Ball Valve 3/4\"", quantity: 12, unit: "EA", sowItem: { name: "Ball Valve", code: "PLMB-VLV-01" } },
    ],
    HVAC: [
      { type: "ductwork", description: "Supply Ductwork - Rectangular", quantity: 450, unit: "LF", sowItem: { name: "Supply Duct", code: "HVAC-DCT-01" } },
      { type: "register", description: "Supply Register 12x6", quantity: 18, unit: "EA", sowItem: { name: "Supply Register", code: "HVAC-REG-01" } },
      { type: "equipment", description: "RTU 5-Ton", quantity: 1, unit: "EA", sowItem: { name: "Rooftop Unit", code: "HVAC-EQP-01" } },
      { type: "return", description: "Return Air Grille", quantity: 6, unit: "EA", sowItem: { name: "Return Grille", code: "HVAC-RET-01" } },
    ],
    CARPENTRY: [
      { type: "framing", description: "2x4 Wall Studs 16\" OC", quantity: 2800, unit: "LF", sowItem: { name: "Wall Framing 2x4", code: "CARP-FRM-01" } },
      { type: "sheathing", description: "7/16\" OSB Sheathing", quantity: 3200, unit: "SF", sowItem: { name: "OSB Wall Sheathing", code: "CARP-SHT-01" } },
      { type: "door", description: "Interior Door - 3/0 x 6/8", quantity: 14, unit: "EA", sowItem: { name: "Interior Door", code: "CARP-DR-01" } },
      { type: "trim", description: "Base Trim - MDF", quantity: 480, unit: "LF", sowItem: { name: "Base Trim", code: "CARP-TRM-01" } },
    ],
    MASONRY: [
      { type: "wall", description: "8\" CMU Block Wall", quantity: 1800, unit: "SF", sowItem: { name: "CMU Block Wall", code: "MASN-BLK-01" } },
      { type: "mortar", description: "Type S Mortar", quantity: 45, unit: "CF", sowItem: { name: "Type S Mortar", code: "MASN-MRT-01" } },
      { type: "rebar", description: "Vertical #5 Rebar", quantity: 0.8, unit: "TON", sowItem: { name: "Vertical Rebar", code: "MASN-RBR-01" } },
      { type: "lintel", description: "Steel Lintel", quantity: 12, unit: "EA", sowItem: { name: "Steel Lintel", code: "MASN-LNT-01" } },
    ],
    DRYWALL: [
      { type: "board", description: "5/8\" Type X Drywall", quantity: 4200, unit: "SF", sowItem: { name: "Drywall 5/8\" Type X", code: "DW-BRD-01" } },
      { type: "framing", description: "Metal Studs 3-5/8\" 20ga", quantity: 1600, unit: "LF", sowItem: { name: "Metal Studs", code: "DW-FRM-01" } },
      { type: "finishing", description: "Level 4 Finish", quantity: 4200, unit: "SF", sowItem: { name: "Level 4 Finish", code: "DW-FIN-01" } },
      { type: "insulation", description: "R-13 Batt Insulation", quantity: 2400, unit: "SF", sowItem: { name: "Batt Insulation R-13", code: "DW-INS-01" } },
    ],
    PAINTING: [
      { type: "wall_paint", description: "Interior Latex Paint - Walls", quantity: 4800, unit: "SF", sowItem: { name: "Interior Wall Paint", code: "PAINT-WL-01" } },
      { type: "ceiling_paint", description: "Ceiling Paint - Flat", quantity: 2200, unit: "SF", sowItem: { name: "Ceiling Paint", code: "PAINT-CL-01" } },
      { type: "trim_paint", description: "Trim Paint - Semi-Gloss", quantity: 600, unit: "LF", sowItem: { name: "Trim Paint", code: "PAINT-TR-01" } },
      { type: "primer", description: "Primer - PVA", quantity: 7000, unit: "SF", sowItem: { name: "PVA Primer", code: "PAINT-PR-01" } },
    ],
    FLOORING: [
      { type: "tile", description: "Porcelain Tile 12x24", quantity: 1200, unit: "SF", sowItem: { name: "Porcelain Floor Tile", code: "FLR-TIL-01" } },
      { type: "carpet", description: "Commercial Carpet Tile", quantity: 800, unit: "SF", sowItem: { name: "Carpet Tile", code: "FLR-CPT-01" } },
      { type: "lvp", description: "Luxury Vinyl Plank", quantity: 1500, unit: "SF", sowItem: { name: "LVP Flooring", code: "FLR-LVP-01" } },
      { type: "base", description: "Rubber Wall Base", quantity: 450, unit: "LF", sowItem: { name: "Rubber Wall Base", code: "FLR-BAS-01" } },
    ],
    LANDSCAPING: [
      { type: "sod", description: "Bermuda Sod", quantity: 5000, unit: "SF", sowItem: { name: "Bermuda Sod", code: "LAND-SOD-01" } },
      { type: "mulch", description: "Hardwood Mulch 3\" Deep", quantity: 25, unit: "CY", sowItem: { name: "Hardwood Mulch", code: "LAND-MLC-01" } },
      { type: "tree", description: "Shade Trees - 2\" Cal", quantity: 8, unit: "EA", sowItem: { name: "Shade Tree 2\" Cal", code: "LAND-TRE-01" } },
      { type: "irrigation", description: "Drip Irrigation Zone", quantity: 4, unit: "EA", sowItem: { name: "Drip Irrigation Zone", code: "LAND-IRR-01" } },
    ],
    DEMOLITION: [
      { type: "interior_demo", description: "Interior Selective Demo", quantity: 3500, unit: "SF", sowItem: { name: "Interior Demo", code: "DEMO-INT-01" } },
      { type: "concrete_demo", description: "Concrete Slab Removal 4\"", quantity: 800, unit: "SF", sowItem: { name: "Concrete Slab Demo", code: "DEMO-CON-01" } },
      { type: "hauling", description: "Debris Hauling", quantity: 12, unit: "EA", sowItem: { name: "Debris Hauling Load", code: "DEMO-HAL-01" } },
      { type: "abatement", description: "Asbestos Abatement", quantity: 200, unit: "SF", sowItem: { name: "Asbestos Abatement", code: "DEMO-ABT-01" } },
    ],
    STEEL_ERECTION: [
      { type: "column", description: "W10x49 Steel Column", quantity: 12, unit: "EA", sowItem: { name: "Steel Column W10", code: "STL-COL-01" } },
      { type: "beam", description: "W18x35 Steel Beam", quantity: 680, unit: "LF", sowItem: { name: "Steel Beam W18", code: "STL-BM-01" } },
      { type: "joist", description: "Open Web Steel Joist 24K", quantity: 42, unit: "EA", sowItem: { name: "Steel Joist 24K", code: "STL-JST-01" } },
      { type: "decking", description: "1.5\" Metal Deck", quantity: 4800, unit: "SF", sowItem: { name: "Metal Deck 1.5\"", code: "STL-DCK-01" } },
    ],
    GLAZING: [
      { type: "storefront", description: "Aluminum Storefront System", quantity: 320, unit: "SF", sowItem: { name: "Storefront System", code: "GLZ-STR-01" } },
      { type: "window", description: "Fixed Window 4x5", quantity: 16, unit: "EA", sowItem: { name: "Fixed Window", code: "GLZ-WIN-01" } },
      { type: "curtainwall", description: "Curtain Wall System", quantity: 800, unit: "SF", sowItem: { name: "Curtain Wall", code: "GLZ-CW-01" } },
      { type: "door", description: "Aluminum Glass Door", quantity: 4, unit: "EA", sowItem: { name: "Glass Door", code: "GLZ-DR-01" } },
    ],
    INSULATION: [
      { type: "batt", description: "R-19 Fiberglass Batt", quantity: 3200, unit: "SF", sowItem: { name: "R-19 Batt", code: "INS-BAT-01" } },
      { type: "rigid", description: "2\" XPS Rigid Board", quantity: 1800, unit: "SF", sowItem: { name: "XPS Rigid 2\"", code: "INS-RGD-01" } },
      { type: "spray_foam", description: "Closed Cell Spray Foam 2\"", quantity: 2400, unit: "SF", sowItem: { name: "Spray Foam 2\"", code: "INS-SPF-01" } },
      { type: "vapor_barrier", description: "6 mil Poly Vapor Barrier", quantity: 3200, unit: "SF", sowItem: { name: "Vapor Barrier", code: "INS-VB-01" } },
    ],
    FIRE_PROTECTION: [
      { type: "sprinkler_head", description: "Pendant Sprinkler Head", quantity: 48, unit: "EA", sowItem: { name: "Pendant Sprinkler", code: "FP-SPR-01" } },
      { type: "pipe", description: "1\" Black Steel Pipe", quantity: 850, unit: "LF", sowItem: { name: "Fire Sprinkler Pipe", code: "FP-PIP-01" } },
      { type: "riser", description: "Fire Sprinkler Riser", quantity: 2, unit: "EA", sowItem: { name: "Sprinkler Riser", code: "FP-RSR-01" } },
      { type: "alarm", description: "Fire Alarm Pull Station", quantity: 8, unit: "EA", sowItem: { name: "Pull Station", code: "FP-ALM-01" } },
    ],
    LOW_VOLTAGE: [
      { type: "data_drop", description: "Cat6A Data Drop", quantity: 36, unit: "EA", sowItem: { name: "Cat6A Data Drop", code: "LV-DAT-01" } },
      { type: "cable", description: "Cat6A Plenum Cable", quantity: 3600, unit: "LF", sowItem: { name: "Cat6A Cable", code: "LV-CBL-01" } },
      { type: "camera", description: "IP Security Camera", quantity: 12, unit: "EA", sowItem: { name: "IP Camera", code: "LV-CAM-01" } },
      { type: "rack", description: "Network Rack 42U", quantity: 1, unit: "EA", sowItem: { name: "Network Rack", code: "LV-RCK-01" } },
    ],
    SOLAR: [
      { type: "panel", description: "400W Solar Panel", quantity: 48, unit: "EA", sowItem: { name: "Solar Panel 400W", code: "SOL-PNL-01" } },
      { type: "inverter", description: "String Inverter 10kW", quantity: 2, unit: "EA", sowItem: { name: "String Inverter", code: "SOL-INV-01" } },
      { type: "racking", description: "Roof Mount Racking", quantity: 960, unit: "SF", sowItem: { name: "Solar Racking", code: "SOL-RCK-01" } },
      { type: "conduit", description: "PV Conduit Run", quantity: 200, unit: "LF", sowItem: { name: "PV Conduit", code: "SOL-CND-01" } },
    ],
    WATERPROOFING: [
      { type: "membrane", description: "Modified Bitumen Membrane", quantity: 2400, unit: "SF", sowItem: { name: "Bitumen Membrane", code: "WP-MEM-01" } },
      { type: "coating", description: "Elastomeric Coating", quantity: 1800, unit: "SF", sowItem: { name: "Elastomeric Coating", code: "WP-COT-01" } },
      { type: "flashing", description: "Sheet Metal Flashing", quantity: 240, unit: "LF", sowItem: { name: "Metal Flashing", code: "WP-FLS-01" } },
      { type: "drain", description: "Interior Floor Drain", quantity: 6, unit: "EA", sowItem: { name: "Floor Drain", code: "WP-DRN-01" } },
    ],
    EARTHWORK: [
      { type: "excavation", description: "Mass Excavation", quantity: 1200, unit: "CY", sowItem: { name: "Mass Excavation", code: "ERTH-EXC-01" } },
      { type: "backfill", description: "Structural Backfill", quantity: 600, unit: "CY", sowItem: { name: "Structural Backfill", code: "ERTH-BKF-01" } },
      { type: "grading", description: "Fine Grading", quantity: 8000, unit: "SF", sowItem: { name: "Fine Grading", code: "ERTH-GRD-01" } },
      { type: "compaction", description: "Soil Compaction Testing", quantity: 20, unit: "EA", sowItem: { name: "Compaction Test", code: "ERTH-CMP-01" } },
    ],
    ASPHALT_PAVING: [
      { type: "paving", description: "2\" HMA Surface Course", quantity: 12000, unit: "SF", sowItem: { name: "HMA Surface Course", code: "ASP-PAV-01" } },
      { type: "base", description: "6\" Aggregate Base", quantity: 12000, unit: "SF", sowItem: { name: "Aggregate Base", code: "ASP-BAS-01" } },
      { type: "striping", description: "Parking Lot Striping", quantity: 2400, unit: "LF", sowItem: { name: "Lot Striping", code: "ASP-STR-01" } },
      { type: "curb", description: "Concrete Curb & Gutter", quantity: 480, unit: "LF", sowItem: { name: "Curb and Gutter", code: "ASP-CRB-01" } },
    ],
    GENERAL_CONTRACTOR: [
      { type: "roof_plane", description: "Main Roof - Shingles", quantity: 28.5, unit: "SQ" },
      { type: "framing", description: "Wall Framing - 2x4 Studs", quantity: 2400, unit: "LF" },
      { type: "slab", description: "Concrete Slab", quantity: 125, unit: "CY" },
      { type: "electrical", description: "Electrical Rough-In", quantity: 1, unit: "LS" },
    ],
  };

  return itemsByTrade[tradeType] || itemsByTrade.GENERAL_CONTRACTOR;
}

// GET /api/ai-features/takeoff/results/:analysisId - Get analysis results
router.get("/ai-features/takeoff/results/:analysisId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [analysis] = await db.select()
      .from(aiTakeoffAnalyses)
      .where(and(
        eq(aiTakeoffAnalyses.id, req.params.analysisId),
        eq(aiTakeoffAnalyses.organizationId, organizationId)
      ));

    if (!analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const detectedItems = analysis.detectedItemsJson ? JSON.parse(analysis.detectedItemsJson) : [];
    const metadata = analysis.metadataJson ? JSON.parse(analysis.metadataJson) : {};

    res.json({
      analysisId: analysis.id,
      status: analysis.status,
      tradeType: analysis.tradeType,
      detectedItems,
      metadata,
      aiNotes: analysis.aiNotes,
      processingTimeMs: analysis.processingTimeMs,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/ai-features/takeoff/history/:contextId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const contextId = req.params.contextId;
    const contextType = req.query.type as string || "project";

    const conditions = [
      eq(aiTakeoffAnalyses.organizationId, organizationId),
    ];

    if (contextType === "bid") {
      conditions.push(eq(aiTakeoffAnalyses.bidId, contextId));
    } else {
      conditions.push(eq(aiTakeoffAnalyses.projectId, contextId));
    }

    const analyses = await db.select()
      .from(aiTakeoffAnalyses)
      .where(and(...conditions))
      .orderBy(desc(aiTakeoffAnalyses.createdAt))
      .limit(20);

    res.json({ analyses });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// Task #2323 — Closed-loop AI takeoff feedback endpoints
// ===========================================================================

const REJECT_REASONS = [
  "WRONG_TRADE",
  "DUPLICATE",
  "NOT_PRESENT",
  "WRONG_QUANTITY",
  "WRONG_LOCATION",
  "OTHER",
] as const;

// Routes are gated to roles that legitimately review takeoff output. Field
// workers don't review AI suggestions, so they're excluded.
const TAKEOFF_REVIEWER_ROLES = ["ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;

const rejectBodySchema = z.object({
  reason: z.enum(REJECT_REASONS),
  note: z.string().max(2000).optional(),
});

const acceptBodySchema = z.object({
  // Optional — when present, links the suggestion to the resulting
  // takeoff measurement so we can later trace back from a measurement.
  measurementId: z.string().optional(),
});

const editAndAcceptBodySchema = z.object({
  measurementId: z.string().optional(),
  editedQuantity: z.number().optional(),
  editedUnit: z.string().max(32).optional(),
  editedItemType: z.string().max(128).optional(),
});

const bulkAcceptBodySchema = z.object({
  analysisId: z.string(),
  // Each entry maps suggestion id -> resulting measurement id (optional)
  // and optional edits when the user changed the row before importing.
  acceptances: z.array(z.object({
    suggestionId: z.string(),
    measurementId: z.string().optional(),
    editedQuantity: z.number().optional(),
    editedUnit: z.string().max(32).optional(),
    editedItemType: z.string().max(128).optional(),
  })).default([]),
  rejections: z.array(z.object({
    suggestionId: z.string(),
    reason: z.enum(REJECT_REASONS).default("NOT_PRESENT"),
    note: z.string().max(2000).optional(),
  })).default([]),
});

// Resolve suggestion + ensure org match. Returns null on miss.
async function loadSuggestionForOrg(suggestionId: string, organizationId: string) {
  const [row] = await db.select()
    .from(aiTakeoffSuggestions)
    .where(and(
      eq(aiTakeoffSuggestions.id, suggestionId),
      eq(aiTakeoffSuggestions.organizationId, organizationId),
    ));
  return row ?? null;
}

// POST /api/ai-features/takeoff/suggestions/:id/accept
router.post(
  "/ai-features/takeoff/suggestions/:id/accept",
  sensitiveLimiter,
  requireAuth,
  requireRole(...TAKEOFF_REVIEWER_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.id;
      if (!organizationId || !userId) return res.status(401).json({ error: "Unauthorized" });

      const parsed = acceptBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }

      const sug = await loadSuggestionForOrg(req.params.id, organizationId);
      if (!sug) return res.status(404).json({ error: "Suggestion not found" });

      const [updated] = await db.update(aiTakeoffSuggestions)
        .set({
          status: "ACCEPTED",
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          acceptedMeasurementId: parsed.data.measurementId ?? sug.acceptedMeasurementId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(aiTakeoffSuggestions.id, sug.id))
        .returning();

      res.json({ suggestion: updated });
    } catch (error) { next(error); }
  },
);

// POST /api/ai-features/takeoff/suggestions/:id/reject
router.post(
  "/ai-features/takeoff/suggestions/:id/reject",
  sensitiveLimiter,
  requireAuth,
  requireRole(...TAKEOFF_REVIEWER_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.id;
      if (!organizationId || !userId) return res.status(401).json({ error: "Unauthorized" });

      const parsed = rejectBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }

      const sug = await loadSuggestionForOrg(req.params.id, organizationId);
      if (!sug) return res.status(404).json({ error: "Suggestion not found" });

      const [updated] = await db.update(aiTakeoffSuggestions)
        .set({
          status: "REJECTED",
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          rejectReason: parsed.data.reason,
          rejectNote: parsed.data.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(aiTakeoffSuggestions.id, sug.id))
        .returning();

      res.json({ suggestion: updated });
    } catch (error) { next(error); }
  },
);

// POST /api/ai-features/takeoff/suggestions/:id/edit-and-accept
router.post(
  "/ai-features/takeoff/suggestions/:id/edit-and-accept",
  sensitiveLimiter,
  requireAuth,
  requireRole(...TAKEOFF_REVIEWER_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.id;
      if (!organizationId || !userId) return res.status(401).json({ error: "Unauthorized" });

      const parsed = editAndAcceptBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }

      const sug = await loadSuggestionForOrg(req.params.id, organizationId);
      if (!sug) return res.status(404).json({ error: "Suggestion not found" });

      const data = parsed.data;
      // Detect whether anything actually changed vs the suggestion. If
      // not, treat as a plain accept so the EDITED bucket stays clean
      // for the few-shot lookup.
      const qtyChanged = data.editedQuantity !== undefined && data.editedQuantity !== sug.quantity;
      const unitChanged = data.editedUnit !== undefined && data.editedUnit !== sug.unit;
      const typeChanged = data.editedItemType !== undefined && data.editedItemType !== sug.itemType;
      const hasEdits = qtyChanged || unitChanged || typeChanged;

      const [updated] = await db.update(aiTakeoffSuggestions)
        .set({
          status: hasEdits ? "EDITED" : "ACCEPTED",
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          acceptedMeasurementId: data.measurementId ?? sug.acceptedMeasurementId ?? null,
          editedQuantity: data.editedQuantity ?? null,
          editedUnit: data.editedUnit ?? null,
          editedItemType: data.editedItemType ?? null,
          updatedAt: new Date(),
        })
        .where(eq(aiTakeoffSuggestions.id, sug.id))
        .returning();

      res.json({ suggestion: updated });
    } catch (error) { next(error); }
  },
);

// POST /api/ai-features/takeoff/suggestions/bulk-accept
// Used by `TakeoffWorkspace`'s import-detected-items loop to commit a
// whole panel's worth of decisions in one round-trip.
router.post(
  "/ai-features/takeoff/suggestions/bulk-accept",
  sensitiveLimiter,
  requireAuth,
  requireRole(...TAKEOFF_REVIEWER_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.id;
      if (!organizationId || !userId) return res.status(401).json({ error: "Unauthorized" });

      const parsed = bulkAcceptBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const { analysisId, acceptances, rejections } = parsed.data;

      // Org-scope guard: confirm the analysis belongs to this org so we
      // can't bulk-touch suggestion rows belonging to another tenant.
      const [analysis] = await db.select({ id: aiTakeoffAnalyses.id })
        .from(aiTakeoffAnalyses)
        .where(and(
          eq(aiTakeoffAnalyses.id, analysisId),
          eq(aiTakeoffAnalyses.organizationId, organizationId),
        ));
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });

      const now = new Date();
      let acceptedCount = 0;
      let editedCount = 0;
      let rejectedCount = 0;

      for (const acc of acceptances) {
        const [sug] = await db.select()
          .from(aiTakeoffSuggestions)
          .where(and(
            eq(aiTakeoffSuggestions.id, acc.suggestionId),
            eq(aiTakeoffSuggestions.analysisId, analysisId),
            eq(aiTakeoffSuggestions.organizationId, organizationId),
          ));
        if (!sug) continue;

        const qtyChanged = acc.editedQuantity !== undefined && acc.editedQuantity !== sug.quantity;
        const unitChanged = acc.editedUnit !== undefined && acc.editedUnit !== sug.unit;
        const typeChanged = acc.editedItemType !== undefined && acc.editedItemType !== sug.itemType;
        const hasEdits = qtyChanged || unitChanged || typeChanged;
        const status = hasEdits ? "EDITED" : "ACCEPTED";

        await db.update(aiTakeoffSuggestions)
          .set({
            status,
            reviewedByUserId: userId,
            reviewedAt: now,
            acceptedMeasurementId: acc.measurementId ?? sug.acceptedMeasurementId ?? null,
            editedQuantity: acc.editedQuantity ?? null,
            editedUnit: acc.editedUnit ?? null,
            editedItemType: acc.editedItemType ?? null,
            updatedAt: now,
          })
          .where(eq(aiTakeoffSuggestions.id, sug.id));

        if (hasEdits) editedCount++;
        else acceptedCount++;
      }

      if (rejections.length > 0) {
        const rejectIds = rejections.map((r) => r.suggestionId);
        // Pull existing rows once so we can apply per-id reason/note
        // without N+1 selects.
        const existing = await db.select()
          .from(aiTakeoffSuggestions)
          .where(and(
            inArray(aiTakeoffSuggestions.id, rejectIds),
            eq(aiTakeoffSuggestions.analysisId, analysisId),
            eq(aiTakeoffSuggestions.organizationId, organizationId),
          ));
        const existingIds = new Set(existing.map((e) => e.id));
        for (const r of rejections) {
          if (!existingIds.has(r.suggestionId)) continue;
          await db.update(aiTakeoffSuggestions)
            .set({
              status: "REJECTED",
              reviewedByUserId: userId,
              reviewedAt: now,
              rejectReason: r.reason,
              rejectNote: r.note ?? null,
              updatedAt: now,
            })
            .where(eq(aiTakeoffSuggestions.id, r.suggestionId));
          rejectedCount++;
        }
      }

      res.json({
        analysisId,
        accepted: acceptedCount,
        edited: editedCount,
        rejected: rejectedCount,
      });
    } catch (error) { next(error); }
  },
);

// GET /api/ai-features/takeoff/accuracy?days=30
// Returns per-org accuracy stats for the admin dashboard. Aggregates
// (status counts, accuracy %, accuracy-by-trade, accuracy-by-confidence-bucket,
// 7-day trendline) over the last `days` days (default 30, max 180).
//
// Task #2341 — the SQL/aggregation here lives in `aiTakeoffAccuracy.ts` so the
// per-user "My AI accuracy" panel can call the same code with a
// `reviewedByUserId` filter.
router.get(
  "/ai-features/takeoff/accuracy",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 180);
      const result = await computeAiTakeoffAccuracy({ organizationId, days });
      res.json(result);
    } catch (error) { next(error); }
  },
);

// GET /api/ai-features/takeoff/accuracy/me?days=30
// Task #2341 — Personal accuracy panel for estimators. Same shape as the
// admin endpoint above, but scoped to suggestions reviewed by the calling
// user. Available to any signed-in user (no admin gate) so estimators get a
// direct feedback loop on their own accept/edit/reject behavior.
router.get(
  "/ai-features/takeoff/accuracy/me",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.id;
      if (!organizationId || !userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 180);
      const result = await computeAiTakeoffAccuracy({
        organizationId,
        days,
        reviewedByUserId: userId,
      });
      res.json(result);
    } catch (error) { next(error); }
  },
);

// GET /api/ai-features/takeoff/suggestions/by-analysis/:analysisId
// Lightweight helper used by the takeoff panel + import flow to map
// detected-item keys to suggestion ids without re-running the analysis.
//
// Task #2342 — also pre-joins the org's confidence calibration map for the
// analysis's trade type and returns the per-org suppression floor so the
// panel can hide low-acceptance buckets without running its own queries.
router.get(
  "/ai-features/takeoff/suggestions/by-analysis/:analysisId",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const [analysis] = await db.select({
        id: aiTakeoffAnalyses.id,
        tradeType: aiTakeoffAnalyses.tradeType,
      })
        .from(aiTakeoffAnalyses)
        .where(and(
          eq(aiTakeoffAnalyses.id, req.params.analysisId),
          eq(aiTakeoffAnalyses.organizationId, organizationId),
        ));
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });

      const [rows, calibrationRows, [orgRow]] = await Promise.all([
        db.select().from(aiTakeoffSuggestions)
          .where(eq(aiTakeoffSuggestions.analysisId, req.params.analysisId)),
        db.select({
          bucket: aiTakeoffConfidenceCalibration.modelConfidenceBucket,
          rate: aiTakeoffConfidenceCalibration.empiricalAcceptanceRate,
          samples: aiTakeoffConfidenceCalibration.sampleCount,
        }).from(aiTakeoffConfidenceCalibration)
          .where(and(
            eq(aiTakeoffConfidenceCalibration.organizationId, organizationId),
            eq(aiTakeoffConfidenceCalibration.tradeType, analysis.tradeType as TradeType),
          )),
        db.select({ floor: organizations.aiTakeoffSuppressionFloor })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1),
      ]);

      const calibration = calibrationRows.map((c) => ({
        bucket: c.bucket,
        empiricalAcceptanceRate: Number(c.rate),
        sampleCount: c.samples,
      }));
      const floorRaw = orgRow?.floor;
      const suppressionFloor =
        floorRaw == null || floorRaw === "" ? null : Number(floorRaw);

      res.json({
        suggestions: rows,
        calibration,
        suppressionFloor,
        suppressionMinSamples: AI_TAKEOFF_SUPPRESSION_MIN_SAMPLES,
      });
    } catch (error) { next(error); }
  },
);

// ===========================================================================
// Task #2342 — per-org AI takeoff settings (currently just the suppression
// floor, but a natural home for any future org-level AI takeoff knobs that
// don't belong on the global `ai_settings` row).
// ===========================================================================

const aiTakeoffOrgSettingsUpsertSchema = z.object({
  // Decimal 0..0.5 — null means "feature off, show every suggestion".
  suppressionFloor: z
    .number()
    .min(AI_TAKEOFF_SUPPRESSION_FLOOR_MIN)
    .max(AI_TAKEOFF_SUPPRESSION_FLOOR_MAX)
    .nullable(),
  // Task #2464 — per-org minimum reviewed-suggestion count for the
  // /profile "weakest trade" callout. Optional on update so existing
  // clients (and the takeoff-suppression-only AI settings PUT) keep
  // working unchanged.
  weakestTradeMinReviewed: z
    .number()
    .int()
    .min(WEAKEST_TRADE_MIN_REVIEWED_MIN)
    .max(WEAKEST_TRADE_MIN_REVIEWED_MAX)
    .optional(),
});

router.get(
  "/ai-features/takeoff/org-settings",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const [row] = await db
        .select({
          floor: organizations.aiTakeoffSuppressionFloor,
          weakestTradeMinReviewed: organizations.weakestTradeMinReviewed,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Organization not found" });

      const raw = row.floor;
      const suppressionFloor =
        raw == null || raw === "" ? null : Number(raw);

      res.json({
        suppressionFloor,
        weakestTradeMinReviewed:
          row.weakestTradeMinReviewed ?? WEAKEST_TRADE_MIN_REVIEWED_DEFAULT,
        defaults: {
          recommended: AI_TAKEOFF_SUPPRESSION_FLOOR_DEFAULT,
          minSamples: AI_TAKEOFF_SUPPRESSION_MIN_SAMPLES,
          weakestTradeMinReviewed: WEAKEST_TRADE_MIN_REVIEWED_DEFAULT,
        },
        bounds: {
          min: AI_TAKEOFF_SUPPRESSION_FLOOR_MIN,
          max: AI_TAKEOFF_SUPPRESSION_FLOOR_MAX,
          weakestTradeMinReviewedMin: WEAKEST_TRADE_MIN_REVIEWED_MIN,
          weakestTradeMinReviewedMax: WEAKEST_TRADE_MIN_REVIEWED_MAX,
        },
      });
    } catch (error) { next(error); }
  },
);

router.put(
  "/ai-features/takeoff/org-settings",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const parsed = aiTakeoffOrgSettingsUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.flatten(),
        });
      }

      // Decimal columns are stored as strings; persist `null` literally so
      // "feature off" round-trips cleanly through `db:push` and the GET
      // handler above.
      const persistValue =
        parsed.data.suppressionFloor == null
          ? null
          : String(parsed.data.suppressionFloor);

      // Task #2464 — only overwrite the callout threshold when the
      // client actually supplied one, so the existing suppression-floor
      // editor in AI settings doesn't accidentally clobber it back to
      // the default. Built as a strongly-typed partial update so we
      // don't have to escape Drizzle's typing.
      const updates: Partial<typeof organizations.$inferInsert> = {
        aiTakeoffSuppressionFloor: persistValue,
        updatedAt: new Date(),
      };
      if (parsed.data.weakestTradeMinReviewed !== undefined) {
        updates.weakestTradeMinReviewed = parsed.data.weakestTradeMinReviewed;
      }

      await db
        .update(organizations)
        .set(updates)
        .where(eq(organizations.id, organizationId));

      // Re-read so the response always reflects the persisted value
      // (including the threshold the caller may not have touched).
      const [row] = await db
        .select({
          weakestTradeMinReviewed: organizations.weakestTradeMinReviewed,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      res.json({
        suppressionFloor: parsed.data.suppressionFloor,
        weakestTradeMinReviewed:
          row?.weakestTradeMinReviewed ?? WEAKEST_TRADE_MIN_REVIEWED_DEFAULT,
        defaults: {
          recommended: AI_TAKEOFF_SUPPRESSION_FLOOR_DEFAULT,
          minSamples: AI_TAKEOFF_SUPPRESSION_MIN_SAMPLES,
          weakestTradeMinReviewed: WEAKEST_TRADE_MIN_REVIEWED_DEFAULT,
        },
        bounds: {
          min: AI_TAKEOFF_SUPPRESSION_FLOOR_MIN,
          max: AI_TAKEOFF_SUPPRESSION_FLOOR_MAX,
          weakestTradeMinReviewedMin: WEAKEST_TRADE_MIN_REVIEWED_MIN,
          weakestTradeMinReviewedMax: WEAKEST_TRADE_MIN_REVIEWED_MAX,
        },
      });
    } catch (error) { next(error); }
  },
);

// ===========================================================================
// Task #2323 — Calibration job (exported so the cron runner can call it).
// ===========================================================================

const CALIBRATION_MIN_SAMPLES = 30;

export interface AiTakeoffCalibrationBucketSummary {
  tradeType: string;
  bucket: number;
  samples: number;
  acceptanceRate: number;
  upserted: boolean;
}

export interface AiTakeoffCalibrationOrgSummary {
  organizationId: string;
  bucketsUpserted: number;
  bucketsBelowThreshold: number;
  buckets: AiTakeoffCalibrationBucketSummary[];
}

export interface AiTakeoffCalibrationResult {
  rowsUpserted: number;
  perOrg: Map<string, AiTakeoffCalibrationOrgSummary>;
}

export interface RunAiTakeoffCalibrationJobOptions {
  /**
   * When supplied, restrict the recompute to these organizations only.
   * Used by the post-backfill recalibration helper so the operator can see
   * the value of `scripts/backfill-ai-takeoff-suggestions.ts` the same day,
   * instead of waiting for the 03:30 UTC nightly tick. When omitted, the
   * job runs across every org with reviewed suggestions in the last 90
   * days (the nightly cron behavior).
   */
  organizationIds?: readonly string[];
}

/**
 * Recomputes the per-(organization, trade, bucket) empirical acceptance rate
 * from the last 90 days of reviewed suggestions and upserts it into
 * `ai_takeoff_confidence_calibration`. Intended to run nightly via node-cron;
 * also reusable from `scripts/backfill-ai-takeoff-suggestions.ts` (with
 * `--also-recalibrate`) so backfilled orgs can refresh their calibration
 * immediately rather than waiting for the next nightly tick.
 *
 * Definition: acceptance_rate = (ACCEPTED + EDITED) / (ACCEPTED + EDITED + REJECTED).
 * Edits count toward acceptance because the model's identification was
 * directionally correct — only the quantity/unit/type was tweaked.
 *
 * Buckets below the `CALIBRATION_MIN_SAMPLES` threshold are intentionally
 * skipped (not deleted) so an existing calibrated value isn't silently
 * blown away by a temporary dip in review volume.
 */
export async function runAiTakeoffCalibrationJob(
  opts: RunAiTakeoffCalibrationJobOptions = {},
): Promise<AiTakeoffCalibrationResult> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const orgFilter = opts.organizationIds
    ? Array.from(new Set(opts.organizationIds.filter((id) => typeof id === "string" && id.length > 0)))
    : null;

  // When the caller passed an explicit-but-empty set of orgs (e.g. the
  // backfill touched zero orgs), short-circuit so we don't accidentally
  // recompute the whole world.
  if (orgFilter !== null && orgFilter.length === 0) {
    return { rowsUpserted: 0, perOrg: new Map() };
  }

  const rows = await db.execute(sql`
    SELECT organization_id,
           trade_type,
           CASE
             WHEN confidence >= 90 THEN 90
             WHEN confidence >= 80 THEN 80
             WHEN confidence >= 70 THEN 70
             ELSE 60
           END AS bucket,
           sum(CASE WHEN status IN ('ACCEPTED', 'EDITED') THEN 1 ELSE 0 END)::int AS accepted,
           sum(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected
      FROM ai_takeoff_suggestions
     WHERE reviewed_at IS NOT NULL
       AND reviewed_at >= ${since}
       ${orgFilter
         ? sql`AND organization_id = ANY(ARRAY[${sql.join(
             orgFilter.map((id) => sql`${id}`),
             sql`, `,
           )}]::varchar[])`
         : sql``}
     GROUP BY organization_id, trade_type, bucket
  `);

  const perOrg = new Map<string, AiTakeoffCalibrationOrgSummary>();
  const ensureOrg = (orgId: string): AiTakeoffCalibrationOrgSummary => {
    let cur = perOrg.get(orgId);
    if (!cur) {
      cur = {
        organizationId: orgId,
        bucketsUpserted: 0,
        bucketsBelowThreshold: 0,
        buckets: [],
      };
      perOrg.set(orgId, cur);
    }
    return cur;
  };

  // Seed an entry for every org the caller asked about so the per-org log
  // lines surface "no qualifying buckets" instead of silently dropping the
  // org from the report.
  if (orgFilter) {
    for (const id of orgFilter) ensureOrg(id);
  }

  let rowsUpserted = 0;
  for (const r of (rows.rows as Array<{
    organization_id: string;
    trade_type: string;
    bucket: number;
    accepted: number;
    rejected: number;
  }>)) {
    const samples = Number(r.accepted) + Number(r.rejected);
    const rate = samples > 0 ? Number(r.accepted) / samples : 0;
    const orgSummary = ensureOrg(r.organization_id);
    if (samples < CALIBRATION_MIN_SAMPLES) {
      orgSummary.bucketsBelowThreshold += 1;
      orgSummary.buckets.push({
        tradeType: r.trade_type,
        bucket: Number(r.bucket),
        samples,
        acceptanceRate: rate,
        upserted: false,
      });
      continue;
    }
    await db.execute(sql`
      INSERT INTO ai_takeoff_confidence_calibration
        (organization_id, trade_type, model_confidence_bucket,
         empirical_acceptance_rate, sample_count, updated_at)
      VALUES
        (${r.organization_id}, ${r.trade_type}::trade_type, ${r.bucket},
         ${rate}, ${samples}, now())
      ON CONFLICT (organization_id, trade_type, model_confidence_bucket)
      DO UPDATE SET empirical_acceptance_rate = EXCLUDED.empirical_acceptance_rate,
                    sample_count = EXCLUDED.sample_count,
                    updated_at = EXCLUDED.updated_at
    `);
    rowsUpserted++;
    orgSummary.bucketsUpserted += 1;
    orgSummary.buckets.push({
      tradeType: r.trade_type,
      bucket: Number(r.bucket),
      samples,
      acceptanceRate: rate,
      upserted: true,
    });
  }

  const scope = orgFilter
    ? `org-scoped (${orgFilter.length} org${orgFilter.length === 1 ? "" : "s"})`
    : "global";
  logInfo(
    `[ai-takeoff-calibration] upserted ${rowsUpserted} rows from ${scope} suggestions reviewed since ${since.toISOString()}`,
  );
  return { rowsUpserted, perOrg };
}

// GET /api/ai-features/takeoff/scale-mismatches — Task #2335
//
// Dashboard rollup: counts the number of analyses with persisted scale
// mismatches in a window and returns the offending sheets so leads can
// triage which sheets to recalibrate. The "rate" is mismatch_count /
// total_count over the same window so an org running 30 sheets a week
// can see calibration drift as a percentage, not just a raw count.
//
// Query params:
//   sinceDays — lookback window in days (default 7, max 90).
//   projectId / bidId — optional scoping filter.
//
// Org isolation is enforced by the WHERE clause (every condition
// pins on `req.user!.organizationId`); the route uses `requireAuth`
// because the data is informational, not destructive.
router.get(
  "/ai-features/takeoff/scale-mismatches",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const sinceDaysRaw = parseInt(String(req.query.sinceDays ?? "7"), 10);
      const sinceDays = Number.isFinite(sinceDaysRaw)
        ? Math.max(1, Math.min(90, sinceDaysRaw))
        : 7;
      const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
      const bidId = typeof req.query.bidId === "string" ? req.query.bidId : null;

      const baseConditions = [
        eq(aiTakeoffAnalyses.organizationId, organizationId),
        gte(aiTakeoffAnalyses.createdAt, sinceDate),
      ];
      if (projectId) baseConditions.push(eq(aiTakeoffAnalyses.projectId, projectId));
      if (bidId) baseConditions.push(eq(aiTakeoffAnalyses.bidId, bidId));

      // Aggregate counts in a single round-trip. We count COMPLETE
      // analyses only — PENDING/PROCESSING rows haven't run the scale
      // check yet, and FAILED rows skipped it, so including them would
      // dilute the rate downward.
      const [agg] = await db
        .select({
          totalAnalyses: sql<number>`count(*)::int`,
          mismatchCount: sql<number>`count(*) FILTER (WHERE ${aiTakeoffAnalyses.scaleMismatchDetected} = true)::int`,
        })
        .from(aiTakeoffAnalyses)
        .where(and(
          ...baseConditions,
          eq(aiTakeoffAnalyses.status, "COMPLETE"),
        ));

      const totalAnalyses = Number(agg?.totalAnalyses ?? 0);
      const mismatchCount = Number(agg?.mismatchCount ?? 0);
      const mismatchRate = totalAnalyses > 0 ? mismatchCount / totalAnalyses : 0;

      // Pull the affected sheets for the dashboard table (capped so the
      // payload stays small on busy orgs — the count tile already shows
      // the global figure, the table is just the riskiest few).
      const sheets = await db
        .select({
          id: aiTakeoffAnalyses.id,
          takeoffSheetId: aiTakeoffAnalyses.takeoffSheetId,
          fileName: aiTakeoffAnalyses.fileName,
          tradeType: aiTakeoffAnalyses.tradeType,
          projectId: aiTakeoffAnalyses.projectId,
          bidId: aiTakeoffAnalyses.bidId,
          detectedScaleLabel: aiTakeoffAnalyses.detectedScaleLabel,
          calibratedScaleLabel: aiTakeoffAnalyses.calibratedScaleLabel,
          scaleDeltaPercent: aiTakeoffAnalyses.scaleDeltaPercent,
          createdAt: aiTakeoffAnalyses.createdAt,
        })
        .from(aiTakeoffAnalyses)
        .where(and(
          ...baseConditions,
          eq(aiTakeoffAnalyses.scaleMismatchDetected, true),
        ))
        // Ordering by absolute delta desc puts the most-misaligned
        // sheets first; ties broken by recency so a fresh, smaller
        // mismatch still appears before a stale one of the same delta.
        .orderBy(desc(aiTakeoffAnalyses.scaleDeltaPercent), desc(aiTakeoffAnalyses.createdAt))
        .limit(50);

      res.json({
        sinceDays,
        totalAnalyses,
        mismatchCount,
        mismatchRate,
        sheets,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
