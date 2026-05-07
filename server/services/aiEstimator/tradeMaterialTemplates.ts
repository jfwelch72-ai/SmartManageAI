/**
 * Task #2577 Phase B (Step 1) — Trade material templates.
 *
 * A trade template bundles a primary calculator (framing studs, drywall
 * sheets, roofing squares, electrical conduit) with the *accessory*
 * items every estimator forgets — fasteners, sealants, fittings,
 * devices — into a single named recipe selectable from a measurement
 * or assembly. Each template emits labeled line items with category +
 * accessory flag so the UI can group "Primary materials" vs "Accessory
 * fasteners / sealants / fittings".
 *
 * Cost lookup (vendor quote → learned rate → published index → AI
 * fallback) is the responsibility of the caller; templates only emit
 * quantities + units.
 */

import {
  calculateStudCount,
  calculateBoardFeet,
  calculateDrywallSheets,
  calculateJointCompoundGallons,
  calculateTapeLF,
  calculateRoofingSquares,
  calculateConduitLF,
  calculateDeviceBoxes,
  calculateWirePullLF,
  ceilWithEpsilon,
} from "../../tradeCalculators";

export type TradeTemplateMeasurementType = "AREA" | "LINEAR" | "COUNT";

export interface TradeTemplateLineItem {
  /** Stable code so callers can dedupe across multiple template applications. */
  code: string;
  /** Human-readable label rendered in the estimate row. */
  label: string;
  category: "PRIMARY" | "ACCESSORY";
  /** True when the item is a fastener, sealant, fitting, or other accessory. */
  isAccessory: boolean;
  quantity: number;
  unit: string;
  /** Free-text describing the formula / source so the estimator can audit. */
  notes?: string;
}

export interface TradeTemplate {
  id: string;
  label: string;
  trade: "FRAMING" | "DRYWALL" | "ROOFING" | "ELECTRICAL";
  description: string;
  /** The takeoff measurement type that drives the template. */
  drivingMeasurementType: TradeTemplateMeasurementType;
  /** The unit the driving quantity is measured in. */
  drivingUnit: string;
  /** Optional knobs surfaced to the UI; values are merged with defaults. */
  options: Array<{
    key: string;
    label: string;
    type: "number" | "select" | "boolean";
    default: number | string | boolean;
    choices?: string[];
    min?: number;
    max?: number;
  }>;
  compute(input: TradeTemplateInput): TradeTemplateLineItem[];
}

export interface TradeTemplateInput {
  /** The driving quantity (LF for framing/electrical, SF for drywall/roofing, EA for outlets). */
  quantity: number;
  /** Caller-supplied option values keyed by option.key. */
  options?: Record<string, number | string | boolean | undefined | null>;
}

function opt<T extends number | string | boolean>(
  options: TradeTemplateInput["options"],
  key: string,
  fallback: T,
): T {
  const v = options?.[key];
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof fallback === "number") {
    const n = typeof v === "number" ? v : Number(v);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  if (typeof fallback === "boolean") {
    return (typeof v === "boolean" ? v : v === "true") as T;
  }
  return v as T;
}

// ---------------------------------------------------------------------
// FRAMING — interior wall, studs at 16" o.c., top/bottom plates,
// fasteners, anchor bolts (per LF of wall).
// ---------------------------------------------------------------------
const FRAMING_INTERIOR_WALL: TradeTemplate = {
  id: "FRAMING_INTERIOR_WALL",
  label: "Interior Wood Stud Wall (2x4 / 2x6)",
  trade: "FRAMING",
  description:
    "Studs at 16\" o.c. with single bottom + double top plates, fasteners, and anchor bolts. Quantity is wall length in LF.",
  drivingMeasurementType: "LINEAR",
  drivingUnit: "LF",
  options: [
    { key: "wallHeightFeet", label: "Wall height (ft)", type: "number", default: 8 },
    { key: "studSpacingInches", label: "Stud spacing (in)", type: "number", default: 16 },
    { key: "studSize", label: "Stud size", type: "select", default: "2x4", choices: ["2x4", "2x6"] },
    { key: "wasteFactor", label: "Waste %", type: "number", default: 10 },
  ],
  compute(input) {
    const length = Math.max(1, input.quantity);
    const wallHeight = opt(input.options, "wallHeightFeet", 8);
    const spacing = opt(input.options, "studSpacingInches", 16);
    const studSizeRaw = opt<string>(input.options, "studSize", "2x4");
    const studSize: "2x4" | "2x6" = studSizeRaw === "2x6" ? "2x6" : "2x4";
    const wastePct = opt(input.options, "wasteFactor", 10);
    const waste = Math.max(0, wastePct / 100);

    const studs = calculateStudCount({ lengthFeet: length, heightFeet: wallHeight, studSpacingInches: spacing });
    // Plates: single bottom + double top → 3x wall length, plus waste cuts.
    const plateLF = ceilWithEpsilon(length * 3 * (1 + waste));
    const plateThickness = 2;
    const plateWidth: number = studSize === "2x6" ? 6 : 4;
    const plateBoardFeet = calculateBoardFeet(plateThickness, plateWidth, plateLF, 1);

    // Accessories
    const nails16dLb = ceilWithEpsilon(studs * 0.07); // ~0.07 lb of 16d sinkers per stud
    const screwsBoxes = ceilWithEpsilon(length / 50); // 1 box (1 lb) per ~50 LF
    const anchorBolts = ceilWithEpsilon(length / 6 + 1); // ½" anchor bolt every 6 ft + endpoint
    const sillSeal = ceilWithEpsilon(length * (1 + waste));

    return [
      { code: `STUD_${studSize}`, label: `${studSize} stud (8' precut)`, category: "PRIMARY", isAccessory: false, quantity: studs, unit: "EA", notes: `${spacing}" o.c. on ${length} LF wall` },
      { code: "PLATE_BF", label: `${studSize} top/bottom plate stock`, category: "PRIMARY", isAccessory: false, quantity: plateBoardFeet, unit: "BF", notes: `Single bottom + double top across ${plateLF} LF` },
      { code: "NAIL_16D", label: "16d sinker nails", category: "ACCESSORY", isAccessory: true, quantity: nails16dLb, unit: "LB" },
      { code: "SCREW_3IN", label: "3\" framing screws (1 lb box)", category: "ACCESSORY", isAccessory: true, quantity: screwsBoxes, unit: "BOX" },
      { code: "ANCHOR_BOLT", label: "½\" x 10\" anchor bolt with washer", category: "ACCESSORY", isAccessory: true, quantity: anchorBolts, unit: "EA", notes: "6 ft o.c. + endpoint" },
      { code: "SILL_SEAL", label: "Sill seal foam (LF)", category: "ACCESSORY", isAccessory: true, quantity: sillSeal, unit: "LF" },
    ];
  },
};

// ---------------------------------------------------------------------
// DRYWALL — interior gypsum 1/2" with mud, tape, screws, corner bead.
// ---------------------------------------------------------------------
const DRYWALL_INTERIOR: TradeTemplate = {
  id: "DRYWALL_INTERIOR",
  label: "Interior Drywall — 1/2\" gypsum + finish accessories",
  trade: "DRYWALL",
  description:
    "Drywall sheets, joint compound, tape, screws, and corner bead. Quantity is wall surface area in SF.",
  drivingMeasurementType: "AREA",
  drivingUnit: "SF",
  options: [
    { key: "sheetSizeSF", label: "Sheet coverage (SF)", type: "number", default: 32 },
    { key: "cornerLF", label: "Corner LF (per 100 SF wall)", type: "number", default: 8 },
  ],
  compute(input) {
    const area = Math.max(0, input.quantity);
    const sheetSize = opt(input.options, "sheetSizeSF", 32);
    const cornerPer100 = opt(input.options, "cornerLF", 8);

    const sheets = calculateDrywallSheets(area, sheetSize);
    const mudGallons = calculateJointCompoundGallons(sheets);
    const tapeLF = calculateTapeLF(sheets);
    // Drywall screws: ~1 lb per 1000 SF when fastened 12" o.c. on field.
    const screwsLb = ceilWithEpsilon((area / 1000) * 1.1);
    const cornerBead = ceilWithEpsilon((area / 100) * cornerPer100);

    return [
      { code: "DRYWALL_HALF", label: "1/2\" gypsum board", category: "PRIMARY", isAccessory: false, quantity: sheets, unit: "EA", notes: `${sheetSize} SF/sheet, ${area.toFixed(0)} SF total` },
      { code: "JOINT_COMPOUND", label: "All-purpose joint compound", category: "PRIMARY", isAccessory: false, quantity: mudGallons, unit: "GAL" },
      { code: "DRYWALL_TAPE", label: "Paper joint tape", category: "ACCESSORY", isAccessory: true, quantity: tapeLF, unit: "LF" },
      { code: "DRYWALL_SCREW", label: "1-1/4\" drywall screws", category: "ACCESSORY", isAccessory: true, quantity: screwsLb, unit: "LB" },
      { code: "CORNER_BEAD", label: "Metal corner bead", category: "ACCESSORY", isAccessory: true, quantity: cornerBead, unit: "LF" },
    ];
  },
};

// ---------------------------------------------------------------------
// ROOFING — asphalt shingle, with underlayment, drip edge, ridge cap,
// fasteners, sealants. Quantity is roof surface area in SF.
// ---------------------------------------------------------------------
const ROOFING_ASPHALT_SHINGLES: TradeTemplate = {
  id: "ROOFING_ASPHALT_SHINGLES",
  label: "Asphalt Shingle Roof",
  trade: "ROOFING",
  description:
    "Architectural shingles, synthetic underlayment, drip edge, ridge cap, fasteners, and sealant. Quantity is roof area in SF (already pitch-adjusted).",
  drivingMeasurementType: "AREA",
  drivingUnit: "SF",
  options: [
    { key: "pitchRatio", label: "Roof pitch (rise:12)", type: "number", default: 6 },
    { key: "wasteFactor", label: "Waste %", type: "number", default: 12 },
    { key: "ridgeLF", label: "Ridge length (LF)", type: "number", default: 0 },
    { key: "eaveLF", label: "Eave + rake length (LF)", type: "number", default: 0 },
  ],
  compute(input) {
    const area = Math.max(0, input.quantity);
    const pitch = opt(input.options, "pitchRatio", 6);
    const wastePct = opt(input.options, "wasteFactor", 12);
    const ridgeLF = opt(input.options, "ridgeLF", 0);
    const eaveLF = opt(input.options, "eaveLF", 0);

    const baseSquares = calculateRoofingSquares({ footprintSF: Math.max(1, area), pitchRise: pitch });
    const squares = ceilWithEpsilon(baseSquares * (1 + wastePct / 100));
    const underlaymentSquares = ceilWithEpsilon(squares * 1.05);
    const dripEdge = ceilWithEpsilon(eaveLF * 1.05);
    const ridgeCapBundles = ceilWithEpsilon(ridgeLF / 20); // ~20 LF per bundle
    const roofingNailsLb = ceilWithEpsilon(squares * 2.5); // ~2.5 lb per square at 4 nails per shingle
    const sealantTubes = ceilWithEpsilon(squares / 3);

    return [
      { code: "SHINGLE_BUNDLE", label: "Architectural shingle (3 bundles/SQ)", category: "PRIMARY", isAccessory: false, quantity: ceilWithEpsilon(squares * 3), unit: "BDL", notes: `${squares} SQ pitch-adjusted` },
      { code: "UNDERLAYMENT", label: "Synthetic underlayment", category: "PRIMARY", isAccessory: false, quantity: underlaymentSquares, unit: "SQ" },
      { code: "DRIP_EDGE", label: "Aluminum drip edge", category: "ACCESSORY", isAccessory: true, quantity: dripEdge, unit: "LF", notes: `Eave + rake = ${eaveLF} LF` },
      { code: "RIDGE_CAP", label: "Ridge cap shingle bundles", category: "ACCESSORY", isAccessory: true, quantity: ridgeCapBundles, unit: "BDL", notes: `${ridgeLF} LF of ridge` },
      { code: "ROOFING_NAILS", label: "1-1/4\" galvanized roofing nails", category: "ACCESSORY", isAccessory: true, quantity: roofingNailsLb, unit: "LB" },
      { code: "ROOF_SEALANT", label: "Asphalt sealant tubes", category: "ACCESSORY", isAccessory: true, quantity: sealantTubes, unit: "EA" },
    ];
  },
};

// ---------------------------------------------------------------------
// ELECTRICAL — branch circuit rough-in: conduit + wire pull + boxes
// + devices + fittings.
// ---------------------------------------------------------------------
const ELECTRICAL_ROUGH_BRANCH: TradeTemplate = {
  id: "ELECTRICAL_ROUGH_BRANCH",
  label: "Electrical Rough — Branch Circuit",
  trade: "ELECTRICAL",
  description:
    "EMT conduit, THHN wire pull (3 conductors), device boxes, devices, fittings, and straps for a branch-circuit run. Quantity is conduit route length in LF.",
  drivingMeasurementType: "LINEAR",
  drivingUnit: "LF",
  options: [
    { key: "outletCount", label: "Outlets / devices on run", type: "number", default: 6 },
    { key: "conductorCount", label: "Conductors", type: "number", default: 3 },
    { key: "deviceMix", label: "Device mix", type: "select", default: "RECEPTACLE", choices: ["RECEPTACLE", "SWITCH", "MIXED"] },
  ],
  compute(input) {
    const routeLF = Math.max(1, input.quantity);
    const outletCount = Math.max(1, opt(input.options, "outletCount", 6));
    const conductors = Math.max(1, opt(input.options, "conductorCount", 3));
    const deviceMixRaw = opt<string>(input.options, "deviceMix", "RECEPTACLE");
    const deviceMix: "RECEPTACLE" | "SWITCH" | "MIXED" =
      deviceMixRaw === "SWITCH" ? "SWITCH" : deviceMixRaw === "MIXED" ? "MIXED" : "RECEPTACLE";

    const conduitLF = calculateConduitLF(routeLF);
    const wirePullLF = calculateWirePullLF({ conduitLengthLF: conduitLF, pullBoxCount: outletCount, wiresPerRun: conductors });
    const deviceBoxes = calculateDeviceBoxes(outletCount);

    // Accessories
    const couplings = ceilWithEpsilon(conduitLF / 10); // 1 coupling per 10 ft stick
    const straps = ceilWithEpsilon(conduitLF / 5); // strap every 5 ft
    const connectors = ceilWithEpsilon(deviceBoxes * 2); // 2 connectors per box
    const wireNutsBag = ceilWithEpsilon(deviceBoxes / 25 + 1);

    const devices: TradeTemplateLineItem[] =
      deviceMix === "SWITCH"
        ? [{ code: "SWITCH_SP", label: "Single-pole switch", category: "PRIMARY", isAccessory: false, quantity: outletCount, unit: "EA" }]
        : deviceMix === "MIXED"
          ? [
              { code: "RECEPTACLE", label: "Receptacle (15A/20A)", category: "PRIMARY", isAccessory: false, quantity: ceilWithEpsilon(outletCount * 0.7), unit: "EA" },
              { code: "SWITCH_SP", label: "Single-pole switch", category: "PRIMARY", isAccessory: false, quantity: ceilWithEpsilon(outletCount * 0.3), unit: "EA" },
            ]
          : [{ code: "RECEPTACLE", label: "Receptacle (15A/20A)", category: "PRIMARY", isAccessory: false, quantity: outletCount, unit: "EA" }];

    return [
      { code: "EMT_CONDUIT", label: "1/2\" EMT conduit", category: "PRIMARY", isAccessory: false, quantity: conduitLF, unit: "LF", notes: `${routeLF} LF route + 5% waste` },
      { code: "WIRE_THHN", label: `#12 THHN copper wire (${conductors} conductor pull)`, category: "PRIMARY", isAccessory: false, quantity: wirePullLF, unit: "LF" },
      { code: "DEVICE_BOX", label: "Single-gang device box", category: "PRIMARY", isAccessory: false, quantity: deviceBoxes, unit: "EA" },
      ...devices,
      { code: "EMT_COUPLING", label: "EMT coupling", category: "ACCESSORY", isAccessory: true, quantity: couplings, unit: "EA" },
      { code: "EMT_STRAP", label: "EMT one-hole strap", category: "ACCESSORY", isAccessory: true, quantity: straps, unit: "EA" },
      { code: "EMT_CONNECTOR", label: "EMT box connector", category: "ACCESSORY", isAccessory: true, quantity: connectors, unit: "EA" },
      { code: "WIRE_NUTS", label: "Wire nuts (bag of 100)", category: "ACCESSORY", isAccessory: true, quantity: wireNutsBag, unit: "BAG" },
    ];
  },
};

const TEMPLATES: Record<string, TradeTemplate> = {
  [FRAMING_INTERIOR_WALL.id]: FRAMING_INTERIOR_WALL,
  [DRYWALL_INTERIOR.id]: DRYWALL_INTERIOR,
  [ROOFING_ASPHALT_SHINGLES.id]: ROOFING_ASPHALT_SHINGLES,
  [ELECTRICAL_ROUGH_BRANCH.id]: ELECTRICAL_ROUGH_BRANCH,
};

export function listTradeTemplates(): Array<Omit<TradeTemplate, "compute">> {
  return Object.values(TEMPLATES).map(({ compute: _compute, ...rest }) => rest);
}

export function getTradeTemplate(id: string): TradeTemplate | null {
  return TEMPLATES[id] ?? null;
}

export interface ApplyTemplateResult {
  templateId: string;
  templateLabel: string;
  trade: TradeTemplate["trade"];
  drivingQuantity: number;
  drivingUnit: string;
  lineItems: TradeTemplateLineItem[];
}

export function applyTradeTemplate(
  templateId: string,
  input: TradeTemplateInput,
): ApplyTemplateResult | null {
  const tpl = TEMPLATES[templateId];
  if (!tpl) return null;
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error(`Invalid quantity ${input.quantity} for template ${templateId}`);
  }
  return {
    templateId: tpl.id,
    templateLabel: tpl.label,
    trade: tpl.trade,
    drivingQuantity: input.quantity,
    drivingUnit: tpl.drivingUnit,
    lineItems: tpl.compute(input),
  };
}

/**
 * Task #2577 Phase B Step 1 — write the line items emitted by
 * `applyTradeTemplate` onto an estimator's bid as DRAFT measurements
 * so the templates are operable from the takeoff workspace, not just
 * a standalone API.
 *
 * Strategy:
 *   - Resolve a target sheet (caller-supplied `sheetId` if it belongs
 *     to the bid; else the lowest-`sheetIndex` sheet for the bid).
 *   - Insert one COUNT measurement per emitted line item (we use COUNT
 *     because templates emit *quantities*, not geometry — the estimator
 *     can re-classify any specific row later).
 *   - Tag with `source = "AI"`, `status = "DRAFT"`, `needsReview = true`
 *     and stamp the template id + line code into `note` so the
 *     provenance is auditable.
 */
export async function applyTradeTemplateToBid(opts: {
  organizationId: string;
  bidId: string;
  templateId: string;
  quantity: number;
  options?: TradeTemplateInput["options"];
  sheetId?: string;
}): Promise<{
  result: ApplyTemplateResult;
  sheetId: string;
  insertedMeasurementIds: string[];
}> {
  const { db } = await import("../../db");
  const { takeoffSheets, takeoffMeasurements } = await import("@shared/schema");
  const { and, eq, asc } = await import("drizzle-orm");
  const { assertBidInOrg } = await import("./access");

  await assertBidInOrg(opts.bidId, opts.organizationId);

  const result = applyTradeTemplate(opts.templateId, {
    quantity: opts.quantity,
    options: opts.options,
  });
  if (!result) throw new Error(`Trade template not found: ${opts.templateId}`);

  let targetSheetId: string | undefined;
  if (opts.sheetId) {
    const [row] = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(and(eq(takeoffSheets.id, opts.sheetId), eq(takeoffSheets.bidId, opts.bidId)))
      .limit(1);
    if (row) targetSheetId = row.id;
  }
  if (!targetSheetId) {
    const [row] = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, opts.bidId))
      .orderBy(asc(takeoffSheets.sheetIndex))
      .limit(1);
    if (!row) throw new Error("Bid has no takeoff sheets to attach template line items to");
    targetSheetId = row.id;
  }

  const insertedMeasurementIds: string[] = [];
  for (const item of result.lineItems) {
    const note =
      `[trade-template:${result.templateId}:${item.code}] ` +
      `${item.category === "ACCESSORY" ? "Accessory" : "Primary"} — ` +
      `${item.quantity} ${item.unit}` +
      (item.notes ? ` (${item.notes})` : "");
    const [inserted] = await db
      .insert(takeoffMeasurements)
      .values({
        sheetId: targetSheetId,
        type: "COUNT",
        label: item.label,
        points: "[]",
        count: item.quantity,
        source: "AI",
        status: "DRAFT",
        note,
        needsReview: true,
        calibrationSource: "AI_DETECTED",
      })
      .returning({ id: takeoffMeasurements.id });
    if (inserted) insertedMeasurementIds.push(inserted.id);
  }

  return { result, sheetId: targetSheetId, insertedMeasurementIds };
}
