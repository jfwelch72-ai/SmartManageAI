import { Router , NextFunction } from "express";
import { db } from "./db";
import { aiTakeoffAnalyses, organizations, takeoffSheets } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logError } from "./utils/logger";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";
import { governedAiCall } from "./services/aiGovernance";

const router = Router();


// ============================================
// FEATURE A: AI AUTO-TAKEOFF ROUTES
// ============================================

const aiTakeoffAnalyzeSchema = z.object({
  projectId: z.string().optional(),
  bidId: z.string().optional(),
  takeoffSheetId: z.string().optional(),
  tradeType: z.string().optional(),
  analysisMode: z.enum(["QUICK", "DETAILED"]).default("QUICK"),
  focusAreas: z.array(z.string()).optional(),
});

// POST /api/ai-features/takeoff/analyze - Trigger AI analysis
router.post("/ai-features/takeoff/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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

    const { projectId, bidId, takeoffSheetId, tradeType, analysisMode, focusAreas } = parsed.data;

    if (!projectId && !bidId) {
      return res.status(400).json({ error: "Either projectId or bidId is required" });
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
      takeoffSheetId: takeoffSheetId || null,
      tradeType: effectiveTradeType as any,
      status: "PENDING",
      analysisMode: analysisMode as any,
      createdByUserId: userId,
    }).returning();

    setTimeout(async () => {
      try {
        await processAiTakeoff(analysis.id, effectiveTradeType, focusAreas, needsAutoDetection, userId);
      } catch (error) {
        logError("AI Takeoff processing error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db.update(aiTakeoffAnalyses)
          .set({ status: "FAILED", errorMessage: "Processing failed" })
          .where(eq(aiTakeoffAnalyses.id, analysis.id));
      }
    }, 100);

    res.json({
      success: true,
      analysisId: analysis.id,
      status: "QUEUED",
      estimatedTime: analysisMode === "QUICK" ? 30 : 120,
    });
  } catch (error) {
    logError("AI Takeoff analyze error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to start analysis" });
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

const VALID_TRADE_TYPES = [
  "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
  "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
  "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
  "SOLAR", "WATERPROOFING", "OTHER"
] as const;

type ValidTradeType = typeof VALID_TRADE_TYPES[number];
const VALID_TRADE_TYPE_SET: Set<string> = new Set(VALID_TRADE_TYPES);

function isValidTradeType(value: string | null | undefined): value is ValidTradeType {
  return typeof value === "string" && VALID_TRADE_TYPE_SET.has(value);
}

async function classifyTradeType(imageUrl: string, orgId: string, userId: string | null | undefined): Promise<{ trade: string; confidence: number }> {
  if (!openai) {
    return { trade: "GENERAL_CONTRACTOR", confidence: 0 };
  }

  try {
    const govResult = await governedAiCall({
      orgId,
      userId,
      actionType: "takeoff_analysis",
      inputRefs: {},
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT4O,
          messages: [
            {
              role: "system",
              content: `You are a construction drawing classifier. Given a blueprint or construction drawing image, identify the PRIMARY trade type it belongs to.

Choose exactly ONE from this list:
${VALID_TRADE_TYPES.join(", ")}

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
          max_completion_tokens: 256,
          temperature: 0.1,
          response_format: { type: "json_object" },
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

async function processAiTakeoff(analysisId: string, tradeType: string, focusAreas?: string[], needsAutoDetection?: boolean, userId?: string | null) {
  const startTime = Date.now();
  
  await db.update(aiTakeoffAnalyses)
    .set({ status: "PROCESSING" })
    .where(eq(aiTakeoffAnalyses.id, analysisId));

  try {
    // Get the analysis record to find associated takeoff sheet
    const [analysis] = await db.select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, analysisId));

    let imageUrl: string | null = null;
    let sheetIndex = 0;
    
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
      }
    }

    if (imageUrl) {
      try {
        let buffer: Buffer | null = null;

        if (imageUrl.startsWith("https://storage.googleapis.com/")) {
          const url = new URL(imageUrl);
          const pathParts = url.pathname.slice(1).split("/");
          const bucketName = pathParts[0];
          const objectName = pathParts.slice(1).join("/");
          const bucket = objectStorageClient.bucket(bucketName);
          const file = bucket.file(objectName);
          [buffer] = await file.download();
        } else if (imageUrl.startsWith("/objects/")) {
          const objectStorageService = new ObjectStorageService();
          const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
          [buffer] = await objectFile.download();
        }

        if (buffer) {
          const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50; // %P (PDF magic bytes)
          
          if (isPdf && sheetIndex >= 0) {
            try {
              const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
              const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
              const pdfDoc = await loadingTask.promise;
              const pageNum = Math.min(sheetIndex + 1, pdfDoc.numPages);
              const page = await pdfDoc.getPage(pageNum);
              
              const scale = 2.0;
              const viewport = page.getViewport({ scale });
              
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => any };
              const canvas = createCanvas(viewport.width, viewport.height);
              const context = canvas.getContext('2d');
              
              await page.render({ canvasContext: context, viewport, canvas } as any).promise;
              
              const pngBuffer = canvas.toBuffer('image/png') as Buffer;
              const base64Data = pngBuffer.toString("base64");
              imageUrl = `data:image/png;base64,${base64Data}`;
              
              pdfDoc.destroy();
            } catch (pdfRenderError) {
              logError("PDF page render failed, sending full PDF:", {}, pdfRenderError instanceof Error ? pdfRenderError : new Error(String(pdfRenderError)));
              const base64Data = buffer.toString("base64");
              imageUrl = `data:application/pdf;base64,${base64Data}`;
            }
          } else if (isPdf) {
            const base64Data = buffer.toString("base64");
            imageUrl = `data:application/pdf;base64,${base64Data}`;
          } else {
            const base64Data = buffer.toString("base64");
            imageUrl = `data:image/png;base64,${base64Data}`;
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

    if (needsAutoDetection && imageUrl) {
      const classification = await classifyTradeType(imageUrl, analysis.organizationId, userId);
      if (classification.confidence >= 40) {
        tradeType = classification.trade;
        tradeAutoDetected = true;
        tradeDetectionConfidence = classification.confidence;

        await db.update(aiTakeoffAnalyses)
          .set({ tradeType: tradeType as ValidTradeType })
          .where(eq(aiTakeoffAnalyses.id, analysisId));
      }
    }

    const analysisMode = analysis?.analysisMode || "QUICK";

    if (imageUrl && openai) {
      try {
        const tradePrompt = TRADE_DETECTION_PROMPTS[tradeType] || TRADE_DETECTION_PROMPTS.GENERAL_CONTRACTOR;
        const focusAreaPrompt = focusAreas?.length ? `Focus especially on: ${focusAreas.join(", ")}. ` : "";
        
        const govResult = await governedAiCall({
          orgId: analysis.organizationId,
          userId: analysis.createdByUserId,
          actionType: "takeoff_analysis",
          inputRefs: { projectId: analysis.projectId },
          fn: async () => {
            const completion = await openai.chat.completions.create({
              model: AI_MODEL_GPT5,
              messages: [
                {
                  role: "system",
                  content: `You are a construction takeoff specialist analyzing blueprints and construction drawings.
${tradePrompt}
${focusAreaPrompt}
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
                      text: `Analyze page ${sheetIndex + 1} of this construction document for ${tradeType} trade takeoff. Extract all measurable quantities with their locations on the drawing. Provide bounding box coordinates (as percentage of image dimensions) for each detected item.`
                    }
                  ]
                }
              ],
              max_completion_tokens: 8192,
              temperature: 0.2,
              response_format: { type: "json_object" },
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
          };

          if (analysisMode === "DETAILED" && detectedItems.length > 0) {
            const verifyResult = await governedAiCall({
              orgId: analysis.organizationId,
              userId: analysis.createdByUserId,
              actionType: "takeoff_analysis",
              inputRefs: { projectId: analysis.projectId },
              fn: async () => {
                const verifyCompletion = await openai.chat.completions.create({
                  model: AI_MODEL_GPT5,
                  messages: [
                    {
                      role: "system",
                      content: `You are a construction takeoff quality reviewer. A first-pass AI analysis detected the following items. Your job is to:
1. Verify quantities are reasonable for the drawing
2. Identify any MISSED items that should have been detected
3. Flag any DUPLICATE detections (overlapping items counted twice)
4. Adjust confidence scores based on your review

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
                  temperature: 0.1,
                  response_format: { type: "json_object" },
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
                console.warn("Failed to parse multi-pass verification result:", verifyParseErr);
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

    await db.update(aiTakeoffAnalyses)
      .set({
        status: "COMPLETE",
        detectedItemsJson: JSON.stringify(detectedItems),
        metadataJson: JSON.stringify(metadata),
        aiNotes,
        processingTimeMs: Date.now() - startTime,
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
    logError("Get takeoff results error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to get results" });
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
    logError("Get takeoff history error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to get history" });
  }
});

export default router;
