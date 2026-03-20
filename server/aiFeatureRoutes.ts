/**
 * AI Feature Routes for 7 Major AI-Enhanced Features
 * Features A-G: Auto-Takeoff, Scheduling, Jobsite Analysis, Vendor Pricing,
 * Client Portal, Change Order Generator, Mobile/Offline
 */

import { Router } from "express";
import { db } from "./db";
import {
  aiTakeoffAnalyses,
  projectSchedules,
  projectScheduleTasks,
  jobsiteAnalysisBatches,
  jobsiteAnalysisPhotos,
  vendorPricebooks,
  vendorPricebookItems,
  aiCoDrafts,
  organizations,
  projects,
  takeoffSheets,
  changeOrders,
  organizationSowItems,
  projectInspections,
  projectDelays,
  scopeItems,
  media,
} from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { openai, AI_MODEL_GPT4O } from "./ai/openaiClient";
import { governedAiCall } from "./services/aiGovernance";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { z } from "zod";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";

const router = Router();

// Trade-specific configurations for AI features
const TRADE_DETECTION_PROMPTS: Record<string, string> = {
  ROOFING: "Focus on: roof planes, ridges, valleys, penetrations, drip edge, gutters, shingles, underlayment. Measure in squares (SQ), linear feet (LF), and counts (EA).",
  ELECTRICAL: "Focus on: panels, outlets, switches, light fixtures, conduit runs, wire pulls. Measure in counts (EA), linear feet (LF), circuits.",
  PLUMBING: "Focus on: fixtures, pipe runs, drains, water heaters, valves. Measure in counts (EA), linear feet (LF), fixture units (FU).",
  HVAC: "Focus on: ductwork, registers, equipment, returns, diffusers. Measure in square feet (SF), linear feet (LF), tonnage (TON), CFM.",
  CONCRETE: "Focus on: slabs, footings, walls, columns, rebar grids, form work. Measure in cubic yards (CY), square feet (SF), linear feet (LF), tons (TON).",
  CARPENTRY: "Focus on: framing members, sheathing, trim, doors, windows, blocking. Measure in linear feet (LF), board feet (BF), square feet (SF), counts (EA).",
  MASONRY: "Focus on: block/brick walls, lintels, reinforcement, mortar joints. Measure in square feet (SF), counts (EA), linear feet (LF).",
  PAINTING: "Focus on: wall areas, ceiling areas, trim linear, doors, windows. Measure in square feet (SF), linear feet (LF).",
  FLOORING: "Focus on: floor areas, transitions, base linear, underlayment. Measure in square feet (SF), square yards (SY), linear feet (LF).",
  DRYWALL: "Focus on: wall/ceiling areas, corner bead, joint linear, finishing. Measure in square feet (SF), linear feet (LF), counts (EA).",
  GENERAL_CONTRACTOR: "Comprehensive analysis across all trades. Identify work by trade type and measure using appropriate units for each trade.",
};

// ============================================
// FEATURE A: AI AUTO-TAKEOFF ROUTES
// ============================================

const aiTakeoffAnalyzeSchema = z.object({
  projectId: z.string(),
  takeoffSheetId: z.string().optional(),
  tradeType: z.string().optional(),
  analysisMode: z.enum(["QUICK", "DETAILED"]).default("QUICK"),
  focusAreas: z.array(z.string()).optional(),
});

// POST /api/ai-features/takeoff/analyze - Trigger AI analysis
router.post("/takeoff/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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

    const { projectId, takeoffSheetId, tradeType, analysisMode, focusAreas } = parsed.data;

    // Get organization trade type if not provided
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    // Valid trade types from the enum - "MANUAL" and other custom types should fall back to GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = tradeType || (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    // Create analysis record
    const [analysis] = await db.insert(aiTakeoffAnalyses).values({
      organizationId,
      projectId,
      takeoffSheetId: takeoffSheetId || null,
      tradeType: effectiveTradeType as any,
      status: "PENDING",
      analysisMode: analysisMode as any,
      createdByUserId: userId,
    }).returning();

    // In a production environment, this would queue a background job
    // For now, we'll process synchronously with a mock response
    setTimeout(async () => {
      try {
        await processAiTakeoff(analysis.id, effectiveTradeType, focusAreas);
      } catch (error) {
        console.error("AI Takeoff processing error:", error);
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
    console.error("AI Takeoff analyze error:", error);
    res.status(500).json({ error: "Failed to start analysis" });
  }
});

// Helper function to process AI takeoff with OpenAI Vision
async function processAiTakeoff(analysisId: string, tradeType: string, focusAreas?: string[]) {
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
              console.error("PDF page render failed, sending full PDF:", pdfRenderError);
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
        console.error("Failed to download image for AI takeoff:", downloadError);
        imageUrl = null;
      }
    }

    let detectedItems: any[];
    let metadata: any;
    let aiNotes: string;

    // Use OpenAI Vision if we have an image, otherwise fall back to mock data
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
              model: AI_MODEL_GPT4O,
              messages: [
                {
                  role: "system",
                  content: `You are a construction takeoff specialist analyzing blueprints and construction drawings. 
${tradePrompt}
${focusAreaPrompt}
Analyze the image and extract all measurable quantities for a construction estimate.

Return your analysis as JSON with this exact structure:
{
  "detectedItems": [
    {
      "itemType": "string (e.g., roof_plane, outlet, slab)",
      "description": "string (detailed description)",
      "quantity": number,
      "unit": "string (SQ, SF, LF, EA, CY, etc.)",
      "confidence": number (0-100),
      "notes": "string (optional additional notes)"
    }
  ],
  "metadata": {
    "drawingScale": "string or null",
    "pageSize": "string or null",
    "titleBlock": "string or null",
    "drawingType": "string (plan, elevation, section, detail)"
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
                      text: `Analyze page ${sheetIndex + 1} of this construction document for ${tradeType} trade takeoff. Extract all measurable quantities.`
                    }
                  ]
                }
              ],
              max_tokens: 4096,
              temperature: 0.3,
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
          detectedItems = (parsed.detectedItems || []).map((item: any, index: number) => ({
            id: `item-${index + 1}`,
            itemType: item.itemType,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            confidence: item.confidence || 75,
            notes: item.notes,
          }));
          metadata = {
            drawingScale: parsed.metadata?.drawingScale,
            pageSize: parsed.metadata?.pageSize,
            titleBlock: parsed.metadata?.titleBlock,
            drawingType: parsed.metadata?.drawingType,
            tradeType,
            analysisMethod: "OpenAI Vision",
            analysisSource: "openai_vision",
          };
          aiNotes = parsed.summary || `AI Vision detected ${detectedItems.length} items for ${tradeType} trade.`;
        } else {
          throw new Error("Could not parse AI response");
        }
      } catch (visionError) {
        console.error("OpenAI Vision error, falling back to mock data:", visionError);
        const tradeItems = generateTradeSpecificItems(tradeType);
        detectedItems = tradeItems.map((item, index) => ({
          id: `item-${index + 1}`,
          itemType: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          confidence: 70 + Math.floor(Math.random() * 25),
          suggestedSowItem: item.sowItem,
        }));
        metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, analysisMethod: "Fallback (mock)", analysisSource: "demo_fallback" };
        aiNotes = `Fallback: Generated ${detectedItems.length} sample items for ${tradeType} trade.`;
      }
    } else {
      // No image available, use mock data
      const tradeItems = generateTradeSpecificItems(tradeType);
      detectedItems = tradeItems.map((item, index) => ({
        id: `item-${index + 1}`,
        itemType: item.type,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        confidence: 70 + Math.floor(Math.random() * 25),
        suggestedSowItem: item.sowItem,
      }));
      metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, analysisMethod: "Demo (no image)", analysisSource: "demo_no_image" };
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
  } catch (error: any) {
    console.error("AI Takeoff processing error:", error);
    await db.update(aiTakeoffAnalyses)
      .set({
        status: "FAILED",
        errorMessage: error.message || "Processing failed",
        processingTimeMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(aiTakeoffAnalyses.id, analysisId));
  }
}

function generateTradeSpecificItems(tradeType: string) {
  const itemsByTrade: Record<string, Array<{type: string; description: string; quantity: number; unit: string; sowItem?: any}>> = {
    ROOFING: [
      { type: "roof_plane", description: "Main Roof Plane - Architectural Shingles", quantity: 28.5, unit: "SQ", sowItem: { name: "Architectural Shingles", code: "ROOF-SHNG-01" } },
      { type: "ridge", description: "Ridge Cap", quantity: 45, unit: "LF", sowItem: { name: "Ridge Cap", code: "ROOF-RDG-01" } },
      { type: "drip_edge", description: "Drip Edge - Aluminum", quantity: 180, unit: "LF", sowItem: { name: "Drip Edge", code: "ROOF-DRP-01" } },
      { type: "penetration", description: "Pipe Boots", quantity: 4, unit: "EA", sowItem: { name: "Pipe Boot Flashing", code: "ROOF-PEN-01" } },
    ],
    ELECTRICAL: [
      { type: "outlet", description: "Duplex Receptacles - 120V", quantity: 24, unit: "EA", sowItem: { name: "Duplex Receptacle", code: "ELEC-RCP-01" } },
      { type: "switch", description: "Single Pole Switches", quantity: 12, unit: "EA", sowItem: { name: "Single Pole Switch", code: "ELEC-SW-01" } },
      { type: "panel", description: "Main Panel - 200A", quantity: 1, unit: "EA", sowItem: { name: "Main Panel 200A", code: "ELEC-PNL-01" } },
      { type: "wire_run", description: "12/2 Romex", quantity: 850, unit: "LF", sowItem: { name: "12/2 NM-B Wire", code: "ELEC-WR-01" } },
    ],
    CONCRETE: [
      { type: "slab", description: "Slab on Grade - 4\" thick", quantity: 125, unit: "CY", sowItem: { name: "Concrete Slab", code: "CONC-SLB-01" } },
      { type: "footing", description: "Continuous Footing", quantity: 18, unit: "CY", sowItem: { name: "Foundation Footing", code: "CONC-FTG-01" } },
      { type: "rebar", description: "#4 Rebar Grid", quantity: 2.5, unit: "TON", sowItem: { name: "Rebar #4", code: "CONC-RBR-01" } },
      { type: "formwork", description: "Foundation Forms", quantity: 320, unit: "SF", sowItem: { name: "Formwork", code: "CONC-FRM-01" } },
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
router.get("/takeoff/results/:analysisId", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Get takeoff results error:", error);
    res.status(500).json({ error: "Failed to get results" });
  }
});

// GET /api/ai-features/takeoff/history/:projectId - Get analysis history for project
router.get("/takeoff/history/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const analyses = await db.select()
      .from(aiTakeoffAnalyses)
      .where(and(
        eq(aiTakeoffAnalyses.projectId, req.params.projectId),
        eq(aiTakeoffAnalyses.organizationId, organizationId)
      ))
      .orderBy(desc(aiTakeoffAnalyses.createdAt))
      .limit(20);

    res.json({ analyses });
  } catch (error) {
    console.error("Get takeoff history error:", error);
    res.status(500).json({ error: "Failed to get history" });
  }
});

// ============================================
// FEATURE B: AI SCHEDULING ASSISTANT ROUTES
// ============================================

const scheduleGenerateSchema = z.object({
  projectId: z.string(),
  startDate: z.string(),
  workingDays: z.array(z.number()).optional().default([1, 2, 3, 4, 5]),
  crewIds: z.array(z.string()).optional(),
  includeTrades: z.array(z.string()).optional(),
  options: z.object({
    bufferDays: z.number().optional().default(1),
    weatherContingency: z.number().optional().default(10),
    inspectionWaitDays: z.number().optional().default(2),
  }).optional(),
});

// POST /api/ai-features/schedule/generate - Generate AI schedule
router.post("/schedule/generate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = scheduleGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, startDate, workingDays, crewIds, options } = parsed.data;

    // Get organization trade type
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    const tradeType = org?.tradeType || "GENERAL_CONTRACTOR";

    // Create schedule
    const [schedule] = await db.insert(projectSchedules).values({
      organizationId,
      projectId,
      name: "AI-Generated Schedule",
      generatedBy: "AI",
      baselineStartDate: startDate,
      workingDays,
      optionsJson: JSON.stringify(options),
      createdByUserId: userId,
    }).returning();

    // Generate trade-specific tasks
    const tasks = await generateTradeScheduleTasks(schedule.id, tradeType, startDate, options);

    res.json({
      success: true,
      scheduleId: schedule.id,
      status: "GENERATED",
      proposedSchedule: {
        startDate,
        endDate: tasks.length > 0 ? tasks[tasks.length - 1].plannedEndDate : startDate,
        totalDays: tasks.reduce((sum, t) => sum + (t.durationDays || 0), 0),
        criticalPathDays: tasks.filter(t => t.isCriticalPath).reduce((sum, t) => sum + (t.durationDays || 0), 0),
        tasks,
      },
      aiNotes: `Generated ${tasks.length} tasks for ${tradeType} project.`,
    });
  } catch (error) {
    console.error("Schedule generate error:", error);
    res.status(500).json({ error: "Failed to generate schedule" });
  }
});

async function generateTradeScheduleTasks(scheduleId: string, tradeType: string, startDate: string, options?: any) {
  const taskTemplates: Record<string, Array<{name: string; duration: number; isCritical: boolean}>> = {
    ROOFING: [
      { name: "Tear-off Existing Roof", duration: 2, isCritical: true },
      { name: "Deck Inspection & Repair", duration: 1, isCritical: true },
      { name: "Install Underlayment", duration: 1, isCritical: true },
      { name: "Install Shingles/Metal", duration: 3, isCritical: true },
      { name: "Install Flashings", duration: 1, isCritical: false },
      { name: "Install Gutters", duration: 1, isCritical: false },
      { name: "Cleanup & Final Inspection", duration: 1, isCritical: true },
    ],
    ELECTRICAL: [
      { name: "Rough-In Wiring", duration: 3, isCritical: true },
      { name: "Panel Installation", duration: 1, isCritical: true },
      { name: "Rough Inspection", duration: 1, isCritical: true },
      { name: "Trim-Out (Devices & Fixtures)", duration: 2, isCritical: false },
      { name: "Panel Terminations", duration: 1, isCritical: true },
      { name: "Final Inspection", duration: 1, isCritical: true },
    ],
    CONCRETE: [
      { name: "Layout & Excavation", duration: 2, isCritical: true },
      { name: "Form Installation", duration: 2, isCritical: true },
      { name: "Rebar Installation", duration: 2, isCritical: true },
      { name: "Pre-Pour Inspection", duration: 1, isCritical: true },
      { name: "Concrete Pour", duration: 1, isCritical: true },
      { name: "Curing Period", duration: 7, isCritical: true },
      { name: "Form Stripping", duration: 1, isCritical: false },
      { name: "Final Finish", duration: 1, isCritical: false },
    ],
    GENERAL_CONTRACTOR: [
      { name: "Site Preparation", duration: 3, isCritical: true },
      { name: "Foundation", duration: 5, isCritical: true },
      { name: "Framing", duration: 10, isCritical: true },
      { name: "MEP Rough-In", duration: 5, isCritical: true },
      { name: "Insulation & Drywall", duration: 5, isCritical: false },
      { name: "Finish Work", duration: 7, isCritical: false },
      { name: "Final Inspections", duration: 2, isCritical: true },
    ],
  };

  const templates = taskTemplates[tradeType] || taskTemplates.GENERAL_CONTRACTOR;
  let currentDate = new Date(startDate);
  const tasks: any[] = [];
  const dependencies: string[] = [];

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const taskStartDate = new Date(currentDate);
    const taskEndDate = new Date(currentDate);
    taskEndDate.setDate(taskEndDate.getDate() + template.duration - 1);

    const [task] = await db.insert(projectScheduleTasks).values({
      scheduleId,
      name: template.name,
      tradeType: tradeType as any,
      plannedStartDate: taskStartDate.toISOString().split('T')[0],
      plannedEndDate: taskEndDate.toISOString().split('T')[0],
      durationDays: template.duration,
      dependencies: dependencies.length > 0 ? [dependencies[dependencies.length - 1]] : [],
      isCriticalPath: template.isCritical,
      status: "NOT_STARTED",
      sortOrder: i,
    }).returning();

    tasks.push(task);
    dependencies.push(task.id);
    currentDate = new Date(taskEndDate);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Update schedule end date
  if (tasks.length > 0) {
    await db.update(projectSchedules)
      .set({ baselineEndDate: tasks[tasks.length - 1].plannedEndDate })
      .where(eq(projectSchedules.id, scheduleId));
  }

  return tasks;
}

// GET /api/ai-features/schedule/:projectId - Get project schedule
router.get("/schedule/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [schedule] = await db.select()
      .from(projectSchedules)
      .where(and(
        eq(projectSchedules.projectId, req.params.projectId),
        eq(projectSchedules.organizationId, organizationId),
        eq(projectSchedules.isActive, true)
      ))
      .orderBy(desc(projectSchedules.createdAt))
      .limit(1);

    if (!schedule) {
      return res.json({ schedule: null, tasks: [] });
    }

    const tasks = await db.select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, schedule.id))
      .orderBy(projectScheduleTasks.sortOrder);

    res.json({ schedule, tasks });
  } catch (error) {
    console.error("Get schedule error:", error);
    res.status(500).json({ error: "Failed to get schedule" });
  }
});

// PATCH /api/ai-features/schedule/tasks/:taskId - Update task
router.patch("/schedule/tasks/:taskId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const updates = req.body;
    
    const [task] = await db.update(projectScheduleTasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projectScheduleTasks.id, req.params.taskId))
      .returning();

    res.json({ task });
  } catch (error) {
    console.error("Update task error:", error);
    res.status(500).json({ error: "Failed to update task" });
  }
});

// ============================================
// FEATURE C: AI JOBSITE CAMERA ANALYSIS ROUTES
// ============================================

const jobsiteAnalysisSchema = z.object({
  projectId: z.string(),
  date: z.string(),
  analysisTypes: z.array(z.string()).default(["SAFETY", "PROGRESS"]),
  tradeType: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/ai-features/jobsite/analyze - Create jobsite analysis batch
router.post("/jobsite/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = jobsiteAnalysisSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, date, analysisTypes, tradeType, notes } = parsed.data;

    // Get organization trade type if not provided
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    // Valid trade types from the enum - "MANUAL" and other custom types should fall back to GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = tradeType || (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    const [batch] = await db.insert(jobsiteAnalysisBatches).values({
      organizationId,
      projectId,
      analysisDate: date,
      tradeType: effectiveTradeType as any,
      status: "PENDING",
      analysisTypes,
      createdByUserId: userId,
    }).returning();

    res.json({
      success: true,
      batchId: batch.id,
      status: "QUEUED",
      estimatedTime: 60,
    });
  } catch (error) {
    console.error("Jobsite analysis error:", error);
    res.status(500).json({ error: "Failed to create analysis" });
  }
});

// POST /api/ai-features/jobsite/:batchId/process - Process uploaded photos with AI Vision
router.post("/jobsite/:batchId/process", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    const userRole = req.user?.role;
    
    // SECURITY: Non-SUPER_ADMIN users must have an organization
    if (userRole !== "SUPER_ADMIN" && !organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const batchId = req.params.batchId;

    // SECURITY: Verify batch exists and belongs to user's organization BEFORE any mutations
    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(eq(jobsiteAnalysisBatches.id, batchId));

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // SECURITY: Verify organization ownership (skip for SUPER_ADMIN)
    if (userRole !== "SUPER_ADMIN" && batch.organizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Now safe to update status to processing
    await db.update(jobsiteAnalysisBatches)
      .set({ status: "PROCESSING" })
      .where(eq(jobsiteAnalysisBatches.id, batchId));

    // Get photos associated with this batch
    const photos = await db.select()
      .from(jobsiteAnalysisPhotos)
      .where(eq(jobsiteAnalysisPhotos.batchId, batchId));

    let safetyFindings: any[];
    let progressFindings: any[];
    let summary: any;
    let crewFindings: any;
    let aiNotes: string;

    // Use OpenAI Vision if we have photos, otherwise use mock data
    if (photos.length > 0 && openai) {
      try {
        const tradeType = batch.tradeType || "GENERAL_CONTRACTOR";
        const analysisTypes = batch.analysisTypes || ["SAFETY", "PROGRESS"];
        
        // Build prompt based on analysis types
        const safetyPrompt = analysisTypes.includes("SAFETY") 
          ? `SAFETY: Identify any safety hazards, PPE compliance issues, fall hazards, housekeeping problems. Rate severity as CRITICAL, HIGH, MEDIUM, or LOW.` 
          : "";
        const progressPrompt = analysisTypes.includes("PROGRESS")
          ? `PROGRESS: Estimate work completion percentage, identify active work areas, note quality of workmanship.`
          : "";
        const crewPrompt = `CREW: Estimate number of workers visible, assess PPE compliance percentage.`;
        
        const tradeContext = TRADE_DETECTION_PROMPTS[tradeType] || TRADE_DETECTION_PROMPTS.GENERAL_CONTRACTOR;
        
        // Analyze first photo (can extend to multiple)
        const imageUrl = photos[0].fileUrl;
        
        const govResult = await governedAiCall({
          orgId: batch.organizationId,
          userId: req.user?.id || null,
          actionType: "jobsite_analysis",
          inputRefs: { projectId: batch.projectId },
          fn: async () => {
            const completion = await openai.chat.completions.create({
              model: AI_MODEL_GPT4O,
              messages: [
                {
                  role: "system",
                  content: `You are a construction site safety and progress inspector for ${tradeType} trade work.
${tradeContext}

Analyze the jobsite photo and provide a comprehensive assessment.

${safetyPrompt}
${progressPrompt}
${crewPrompt}

Return your analysis as JSON with this exact structure:
{
  "summary": {
    "overallSafetyScore": number (0-100),
    "estimatedCompletion": number (0-100 percentage),
    "crewCountEstimate": number,
    "weatherConditions": "string",
    "primaryConcerns": ["array of concerns"]
  },
  "safetyFindings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "PPE|FALL_HAZARD|HOUSEKEEPING|ELECTRICAL|FIRE|OTHER",
      "description": "detailed description",
      "recommendation": "corrective action"
    }
  ],
  "progressFindings": [
    {
      "workArea": "area name",
      "tradeType": "${tradeType}",
      "estimatedComplete": number (0-100),
      "observations": "quality and progress notes"
    }
  ],
  "crewFindings": {
    "estimatedCount": number,
    "ppeCompliance": number (0-100),
    "activeWorkAreas": ["array of areas"]
  },
  "notes": "overall summary of findings"
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
                      text: `Analyze this construction jobsite photo for ${tradeType} trade work. Focus on safety hazards, work progress, and crew activity.`
                    }
                  ]
                }
              ],
              max_tokens: 4096,
              temperature: 0.3,
            });
            return { result: completion.choices[0]?.message?.content, completion };
          },
        });

        if (govResult.blocked) {
          return res.status(429).json({ error: govResult.reason });
        }

        const responseContent = govResult.result || "";
        
        // Parse the JSON response
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          summary = parsed.summary || {
            overallSafetyScore: 80,
            estimatedCompletion: 50,
            crewCountEstimate: 5,
            weatherConditions: "Unknown",
            primaryConcerns: [],
          };
          safetyFindings = (parsed.safetyFindings || []).map((f: any, i: number) => ({
            id: `sf-${i + 1}`,
            severity: f.severity || "MEDIUM",
            category: f.category || "OTHER",
            description: f.description,
            recommendation: f.recommendation,
            photoId: photos[0].id,
          }));
          progressFindings = (parsed.progressFindings || []).map((f: any, i: number) => ({
            id: `pf-${i + 1}`,
            workArea: f.workArea || "General Area",
            tradeType: f.tradeType || tradeType,
            estimatedComplete: f.estimatedComplete || 0,
            observations: f.observations,
            photoId: photos[0].id,
          }));
          crewFindings = parsed.crewFindings || {
            estimatedCount: 0,
            ppeCompliance: 100,
            activeWorkAreas: [],
          };
          aiNotes = parsed.notes || "AI Vision analysis complete.";
        } else {
          throw new Error("Could not parse AI response");
        }
      } catch (visionError) {
        console.error("OpenAI Vision error for jobsite analysis, falling back to mock:", visionError);
        safetyFindings = generateSafetyFindings(batch.tradeType || "GENERAL_CONTRACTOR");
        progressFindings = generateProgressFindings(batch.tradeType || "GENERAL_CONTRACTOR");
        summary = {
          overallSafetyScore: 85,
          estimatedCompletion: 45,
          crewCountEstimate: 6,
          weatherConditions: "Clear, 72°F",
          primaryConcerns: safetyFindings.filter((f: any) => f.severity === "HIGH").map((f: any) => f.description),
          analysisMethod: "Fallback (mock)",
        };
        crewFindings = { estimatedCount: 6, ppeCompliance: 90, activeWorkAreas: ["Main building", "North side"] };
        aiNotes = "Fallback: Generated sample analysis data.";
      }
    } else {
      // No photos available, use mock data
      safetyFindings = generateSafetyFindings(batch.tradeType || "GENERAL_CONTRACTOR");
      progressFindings = generateProgressFindings(batch.tradeType || "GENERAL_CONTRACTOR");
      summary = {
        overallSafetyScore: 85,
        estimatedCompletion: 45,
        crewCountEstimate: 6,
        weatherConditions: "Clear, 72°F",
        primaryConcerns: safetyFindings.filter((f: any) => f.severity === "HIGH").map((f: any) => f.description),
        analysisMethod: "Demo (no photos)",
      };
      crewFindings = { estimatedCount: 6, ppeCompliance: 90, activeWorkAreas: ["Main building", "North side"] };
      aiNotes = "Demo mode: Generated sample analysis data.";
    }

    await db.update(jobsiteAnalysisBatches)
      .set({
        status: "COMPLETE",
        summaryJson: JSON.stringify(summary),
        safetyFindingsJson: JSON.stringify(safetyFindings),
        progressFindingsJson: JSON.stringify(progressFindings),
        crewFindingsJson: JSON.stringify(crewFindings),
        aiNotes,
        updatedAt: new Date(),
      })
      .where(eq(jobsiteAnalysisBatches.id, batchId));

    res.json({ success: true, status: "COMPLETE" });
  } catch (error) {
    console.error("Process jobsite analysis error:", error);
    res.status(500).json({ error: "Failed to process analysis" });
  }
});

function generateSafetyFindings(tradeType: string) {
  const findings = [
    { id: "sf-1", severity: "MEDIUM", category: "PPE", description: "Worker without hard hat observed in photo 3", recommendation: "Ensure all workers wear hard hats on site" },
    { id: "sf-2", severity: "LOW", category: "HOUSEKEEPING", description: "Material storage could be better organized", recommendation: "Organize materials to clear walkways" },
  ];
  
  if (tradeType === "ROOFING") {
    findings.push({ id: "sf-3", severity: "HIGH", category: "FALL_HAZARD", description: "Ladder not properly secured at roof access", recommendation: "Secure ladder with proper tie-offs" });
  }
  
  return findings;
}

function generateProgressFindings(tradeType: string) {
  const findings = [
    { id: "pf-1", workArea: "Main Building", tradeType, estimatedComplete: 45, observations: "Work progressing on schedule" },
    { id: "pf-2", workArea: "North Section", tradeType, estimatedComplete: 60, observations: "Ahead of schedule in this area" },
  ];
  return findings;
}

// GET /api/ai-features/jobsite/results/:batchId - Get analysis results
router.get("/jobsite/results/:batchId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(and(
        eq(jobsiteAnalysisBatches.id, req.params.batchId),
        eq(jobsiteAnalysisBatches.organizationId, organizationId)
      ));

    if (!batch) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const photos = await db.select()
      .from(jobsiteAnalysisPhotos)
      .where(eq(jobsiteAnalysisPhotos.batchId, batch.id));

    res.json({
      batchId: batch.id,
      status: batch.status,
      projectId: batch.projectId,
      date: batch.analysisDate,
      tradeType: batch.tradeType,
      summary: batch.summaryJson ? JSON.parse(batch.summaryJson) : null,
      safetyFindings: batch.safetyFindingsJson ? JSON.parse(batch.safetyFindingsJson) : [],
      progressFindings: batch.progressFindingsJson ? JSON.parse(batch.progressFindingsJson) : [],
      crewFindings: batch.crewFindingsJson ? JSON.parse(batch.crewFindingsJson) : null,
      photos,
    });
  } catch (error) {
    console.error("Get jobsite results error:", error);
    res.status(500).json({ error: "Failed to get results" });
  }
});

// GET /api/ai-features/jobsite/history/:projectId - Get analysis history
router.get("/jobsite/history/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const batches = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(and(
        eq(jobsiteAnalysisBatches.projectId, req.params.projectId),
        eq(jobsiteAnalysisBatches.organizationId, organizationId)
      ))
      .orderBy(desc(jobsiteAnalysisBatches.analysisDate))
      .limit(30);

    res.json({ batches });
  } catch (error) {
    console.error("Get jobsite history error:", error);
    res.status(500).json({ error: "Failed to get history" });
  }
});

// ============================================
// FEATURE D: VENDOR PRICING SYNC ROUTES
// ============================================

const pricebookUploadSchema = z.object({
  vendorId: z.string(),
  fileKey: z.string(),
  fileName: z.string().optional(),
  fileType: z.enum(["CSV", "XLSX"]),
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  tradeType: z.string().optional(),
});

// POST /api/ai-features/vendors/pricebook/upload - Upload pricebook
router.post("/vendors/pricebook/upload", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = pricebookUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { vendorId, fileKey, fileName, fileType, effectiveDate, expirationDate, tradeType } = parsed.data;

    const [pricebook] = await db.insert(vendorPricebooks).values({
      organizationId,
      vendorId,
      fileKey,
      fileName,
      fileType,
      effectiveDate: effectiveDate || null,
      expirationDate: expirationDate || null,
      tradeType: tradeType as any || null,
      status: "PENDING",
      uploadedByUserId: userId,
    }).returning();

    res.json({
      success: true,
      pricebookId: pricebook.id,
      status: "PROCESSING",
    });
  } catch (error) {
    console.error("Pricebook upload error:", error);
    res.status(500).json({ error: "Failed to upload pricebook" });
  }
});

// GET /api/ai-features/vendors/pricebook/items - Get pricebook items
router.get("/vendors/pricebook/items", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { vendorId, category, search } = req.query;

    let query = db.select()
      .from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.organizationId, organizationId),
        eq(vendorPricebookItems.isActive, true)
      ));

    const items = await query.limit(100);

    res.json({ items, totalCount: items.length });
  } catch (error) {
    console.error("Get pricebook items error:", error);
    res.status(500).json({ error: "Failed to get items" });
  }
});

// GET /api/ai-features/vendors/pricebooks - List vendor pricebooks
router.get("/vendors/pricebooks", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const pricebooks = await db.select()
      .from(vendorPricebooks)
      .where(eq(vendorPricebooks.organizationId, organizationId))
      .orderBy(desc(vendorPricebooks.createdAt));

    res.json({ pricebooks });
  } catch (error) {
    console.error("Get pricebooks error:", error);
    res.status(500).json({ error: "Failed to get pricebooks" });
  }
});

// ============================================
// FEATURE F: AI CHANGE ORDER GENERATOR ROUTES
// ============================================

const coGenerateSchema = z.object({
  projectId: z.string(),
  tradeType: z.string().optional(),
  linkedItems: z.object({
    delayIds: z.array(z.string()).optional(),
    inspectionIds: z.array(z.string()).optional(),
    sowItemIds: z.array(z.string()).optional(),
    photoIds: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }),
  pricingSource: z.enum(["MANUAL", "CALCULATOR", "VENDOR_PRICING"]).default("MANUAL"),
  includeBreakdown: z.boolean().default(true),
});

// POST /api/ai-features/change-orders/generate - Generate AI change order draft
router.post("/change-orders/generate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = coGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, tradeType, linkedItems, pricingSource, includeBreakdown } = parsed.data;

    // Get organization trade type if not provided
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    // Valid trade types from the enum - "MANUAL", "SCOPE_CHANGE", "DELAY", "INSPECTION" and other
    // non-trade values should fall back to org trade type or GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = (tradeType && validTradeTypes.includes(tradeType))
      ? tradeType
      : (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    // Generate AI draft content
    const draftContent = await generateCoDraft(effectiveTradeType, linkedItems);

    const [draft] = await db.insert(aiCoDrafts).values({
      organizationId,
      projectId,
      tradeType: effectiveTradeType as any,
      linkedItemsJson: JSON.stringify(linkedItems),
      draftContentJson: JSON.stringify(draftContent),
      pricingJson: JSON.stringify(draftContent.lineItems),
      aiConfidence: 82,
      aiNotes: `Generated change order draft for ${effectiveTradeType} project.`,
      status: "DRAFT",
      createdByUserId: userId,
    }).returning();

    res.json({
      success: true,
      draftId: draft.id,
      draft: draftContent,
      aiConfidence: 82,
      aiNotes: `Generated change order draft based on ${Object.keys(linkedItems).filter(k => linkedItems[k as keyof typeof linkedItems]?.length).length} linked item types.`,
    });
  } catch (error) {
    console.error("Generate CO error:", error);
    res.status(500).json({ error: "Failed to generate change order" });
  }
});

async function generateCoDraft(tradeType: string, linkedItems: any) {
  const tradeTerms: Record<string, string> = {
    ROOFING: "hidden deck damage discovered during tear-off operations",
    ELECTRICAL: "additional circuits required per updated code requirements",
    CONCRETE: "unforeseen soil conditions requiring additional excavation",
    GENERAL_CONTRACTOR: "scope modifications per field conditions",
  };

  const reason = tradeTerms[tradeType] || tradeTerms.GENERAL_CONTRACTOR;
  
  return {
    title: `Change Order - ${new Date().toLocaleDateString()}`,
    description: `This change order addresses ${reason}. Work includes additional labor and materials as detailed below.`,
    justification: linkedItems.notes || `Additional work required due to ${reason}. This was not foreseeable at time of original bid.`,
    scopeOfWork: `Furnish all labor, materials, and equipment necessary to complete the additional work as described. Work to be performed in accordance with project specifications and industry standards.`,
    exclusions: "This change order does not include: work outside the described scope, permits unless noted, or changes to project schedule beyond completion of this work.",
    terms: "Payment due upon completion and acceptance. Work to commence within 5 business days of approval.",
    lineItems: {
      labor: [
        { description: "Skilled Labor", hours: 16, rate: 75, amount: 1200 },
        { description: "General Labor", hours: 8, rate: 45, amount: 360 },
      ],
      materials: [
        { description: "Additional Materials", quantity: 1, unit: "LS", unitPrice: 850, amount: 850 },
      ],
      equipment: [
        { description: "Equipment Usage", days: 1, dailyRate: 150, amount: 150 },
      ],
    },
    subtotals: {
      labor: 1560,
      materials: 850,
      equipment: 150,
      subtotal: 2560,
      overhead: 256,
      profit: 256,
      total: 3072,
    },
  };
}

// GET /api/ai-features/change-orders/drafts/:projectId - Get drafts for project
router.get("/change-orders/drafts/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const drafts = await db.select()
      .from(aiCoDrafts)
      .where(and(
        eq(aiCoDrafts.projectId, req.params.projectId),
        eq(aiCoDrafts.organizationId, organizationId),
        eq(aiCoDrafts.status, "DRAFT")
      ))
      .orderBy(desc(aiCoDrafts.createdAt));

    res.json({ drafts });
  } catch (error) {
    console.error("Get CO drafts error:", error);
    res.status(500).json({ error: "Failed to get drafts" });
  }
});

// POST /api/ai-features/change-orders/drafts/:draftId/convert - Convert draft to real CO
router.post("/change-orders/drafts/:draftId/convert", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [draft] = await db.select()
      .from(aiCoDrafts)
      .where(and(
        eq(aiCoDrafts.id, req.params.draftId),
        eq(aiCoDrafts.organizationId, organizationId)
      ));

    if (!draft) {
      return res.status(404).json({ error: "Draft not found" });
    }

    const draftContent = draft.draftContentJson ? JSON.parse(draft.draftContentJson) : {};

    // Generate next change order number
    const existingCOs = await db.select()
      .from(changeOrders)
      .where(eq(changeOrders.projectId, draft.projectId));
    const nextNumber = `CO-${String(existingCOs.length + 1).padStart(3, '0')}`;

    // Create actual change order
    const [co] = await db.insert(changeOrders).values({
      projectId: draft.projectId,
      changeOrderNumber: nextNumber,
      description: draftContent.description || "AI Generated Change Order",
      amount: String(draftContent.subtotals?.total || 0),
      status: "DRAFT",
      requestedById: req.user!.id,
    }).returning();

    // Update draft status
    await db.update(aiCoDrafts)
      .set({ status: "CONVERTED", convertedToCoId: co.id, updatedAt: new Date() })
      .where(eq(aiCoDrafts.id, draft.id));

    res.json({
      success: true,
      changeOrderId: co.id,
    });
  } catch (error) {
    console.error("Convert CO draft error:", error);
    res.status(500).json({ error: "Failed to convert draft" });
  }
});

export default router;
