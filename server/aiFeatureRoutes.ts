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
  vendorPriceHistory,
  clientPortalAccess,
  clientPortalActivity,
  aiCoDrafts,
  mobileDevices,
  mobileSyncLog,
  mobilePendingUploads,
  organizations,
  projects,
  takeoffSheets,
  crews,
  changeOrders,
  crmOrganisations,
  organizationSowItems,
  projectInspections,
  projectDelays,
  timeClockShifts,
  timeClockEvents,
  scopeItems,
  media,
  users,
  type AiTakeoffAnalysis,
  type ProjectSchedule,
  type ProjectScheduleTask,
  type JobsiteAnalysisBatch,
  type VendorPricebook,
  type ClientPortalAccess,
  type AiCoDraft,
  type MobileDevice,
} from "@shared/schema";
import { eq, sql, and, desc, gte, lte, inArray } from "drizzle-orm";
import { openai, AI_MODEL_GPT4O } from "./ai/openaiClient";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { z } from "zod";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import crypto from "crypto";
import { sendEmail } from "./email";

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
    
    // Try to get image from takeoff sheet if provided
    if (analysis?.takeoffSheetId) {
      const [sheet] = await db.select()
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, analysis.takeoffSheetId));
      if (sheet?.imageUrl) {
        imageUrl = sheet.imageUrl;
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
        
        const visionResponse = await openai.chat.completions.create({
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
                  text: `Analyze this construction drawing for ${tradeType} trade takeoff. Extract all measurable quantities.`
                }
              ]
            }
          ],
          max_tokens: 4096,
          temperature: 0.3,
        });

        const responseContent = visionResponse.choices[0]?.message?.content || "";
        
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
          };
          aiNotes = parsed.summary || `AI Vision detected ${detectedItems.length} items for ${tradeType} trade.`;
        } else {
          throw new Error("Could not parse AI response");
        }
      } catch (visionError) {
        console.error("OpenAI Vision error, falling back to mock data:", visionError);
        // Fall back to mock data if Vision fails
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
        metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, analysisMethod: "Fallback (mock)" };
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
      metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, analysisMethod: "Demo (no image)" };
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
        
        const visionResponse = await openai.chat.completions.create({
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

        const responseContent = visionResponse.choices[0]?.message?.content || "";
        
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
// FEATURE E: CLIENT PORTAL ROUTES
// ============================================

const portalAccessSchema = z.object({
  projectId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
});

// POST /api/ai-features/portal/access/create - Create portal access
router.post("/portal/access/create", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = portalAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, email, name } = parsed.data;

    // Generate access token
    const accessToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const [access] = await db.insert(clientPortalAccess).values({
      organizationId,
      projectId,
      email,
      name,
      accessTokenHash: tokenHash,
      tokenExpiresAt: expiresAt,
      createdByUserId: userId,
    }).returning();

    res.json({
      success: true,
      accessId: access.id,
      accessToken, // In production, this would be sent via email
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Create portal access error:", error);
    res.status(500).json({ error: "Failed to create access" });
  }
});

// GET /api/ai-features/portal/access/:projectId - List portal access for project
router.get("/portal/access/:projectId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessList = await db.select()
      .from(clientPortalAccess)
      .where(and(
        eq(clientPortalAccess.projectId, req.params.projectId),
        eq(clientPortalAccess.organizationId, organizationId)
      ))
      .orderBy(desc(clientPortalAccess.createdAt));

    res.json({ accessList });
  } catch (error) {
    console.error("Get portal access error:", error);
    res.status(500).json({ error: "Failed to get access list" });
  }
});

// DELETE /api/ai-features/portal/access/:accessId - Revoke access
router.delete("/portal/access/:accessId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await db.update(clientPortalAccess)
      .set({ isActive: false })
      .where(and(
        eq(clientPortalAccess.id, req.params.accessId),
        eq(clientPortalAccess.organizationId, organizationId)
      ));

    res.json({ success: true });
  } catch (error) {
    console.error("Revoke portal access error:", error);
    res.status(500).json({ error: "Failed to revoke access" });
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
    // Valid trade types from the enum - "MANUAL" and other custom types should fall back to GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = tradeType || (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

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

// ============================================
// FEATURE G: MOBILE/OFFLINE SYNC ROUTES
// ============================================

const deviceRegisterSchema = z.object({
  deviceId: z.string(),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  appVersion: z.string().optional(),
  deviceModel: z.string().optional(),
  pushToken: z.string().optional(),
});

// POST /api/ai-features/mobile/register - Register mobile device
router.post("/mobile/register", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = deviceRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { deviceId, platform, appVersion, deviceModel, pushToken } = parsed.data;
    const syncToken = crypto.randomBytes(16).toString("hex");

    // Upsert device
    const existing = await db.select()
      .from(mobileDevices)
      .where(eq(mobileDevices.deviceId, deviceId))
      .limit(1);

    let device;
    if (existing.length > 0) {
      [device] = await db.update(mobileDevices)
        .set({
          platform: platform as any,
          appVersion,
          deviceModel,
          pushToken,
          syncToken,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(mobileDevices.deviceId, deviceId))
        .returning();
    } else {
      [device] = await db.insert(mobileDevices).values({
        organizationId,
        userId,
        deviceId,
        platform: platform as any,
        appVersion,
        deviceModel,
        pushToken,
        syncToken,
      }).returning();
    }

    res.json({
      success: true,
      registrationId: device.id,
      syncToken,
      syncEndpoint: "/api/ai-features/mobile/sync",
    });
  } catch (error) {
    console.error("Device register error:", error);
    res.status(500).json({ error: "Failed to register device" });
  }
});

// GET /api/ai-features/mobile/sync - Get changes since last sync
router.get("/mobile/sync", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { lastSyncAt, deviceId } = req.query;
    const syncTime = lastSyncAt ? new Date(lastSyncAt as string) : new Date(0);
    const nextSyncToken = crypto.randomBytes(8).toString("hex");

    // Get projects updated since last sync (projects linked to this org via gcOrganizationId)
    const projectChanges = await db.select()
      .from(projects)
      .where(and(
        eq(projects.gcOrganizationId, organizationId),
        gte(projects.updatedAt, syncTime)
      ))
      .limit(50);

    // Get time clock shifts for the user
    const shiftChanges = await db.select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.userId, userId),
        gte(timeClockShifts.updatedAt, syncTime)
      ))
      .limit(100);

    // Update device last sync time
    if (deviceId) {
      await db.update(mobileDevices)
        .set({ lastSyncAt: new Date(), syncToken: nextSyncToken })
        .where(eq(mobileDevices.deviceId, deviceId as string));
    }

    res.json({
      syncedAt: new Date().toISOString(),
      nextSyncToken,
      changes: {
        projects: {
          created: projectChanges.filter(p => p.createdAt >= syncTime),
          updated: projectChanges.filter(p => p.createdAt < syncTime),
          deleted: [],
        },
        timeClock: {
          shifts: shiftChanges,
          events: [],
        },
      },
    });
  } catch (error) {
    console.error("Mobile sync error:", error);
    res.status(500).json({ error: "Failed to sync" });
  }
});

// POST /api/ai-features/mobile/sync - Upload local changes
router.post("/mobile/sync", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { deviceId, changes } = req.body;
    const processed: any = { timeClockEvents: [], dailyLogs: [], photos: [] };

    // Process time clock events
    if (changes?.timeClockEvents) {
      for (const event of changes.timeClockEvents) {
        // Store as pending upload for processing
        await db.insert(mobilePendingUploads).values({
          deviceId,
          localId: event.localId,
          recordType: "TIME_CLOCK_EVENT",
          recordDataJson: JSON.stringify(event),
          status: "PENDING",
        });
        processed.timeClockEvents.push({
          localId: event.localId,
          status: "QUEUED",
        });
      }
    }

    res.json({
      success: true,
      processed,
      conflicts: [],
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Mobile upload sync error:", error);
    res.status(500).json({ error: "Failed to upload changes" });
  }
});

// GET /api/ai-features/mobile/devices - List user's devices
router.get("/mobile/devices", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const devices = await db.select()
      .from(mobileDevices)
      .where(and(
        eq(mobileDevices.userId, userId),
        eq(mobileDevices.isActive, true)
      ))
      .orderBy(desc(mobileDevices.lastSyncAt));

    res.json({ devices });
  } catch (error) {
    console.error("Get devices error:", error);
    res.status(500).json({ error: "Failed to get devices" });
  }
});

// ============================================================================
// FEATURE E: CLIENT PORTAL
// ============================================================================

// GET /api/ai-features/client-portal/:projectId - List portal access for a project
router.get("/client-portal/:projectId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const projectId = req.params.projectId;

    const accessList = await db
      .select({
        access: clientPortalAccess,
        projectName: projects.name,
      })
      .from(clientPortalAccess)
      .leftJoin(projects, eq(clientPortalAccess.projectId, projects.id))
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.organizationId, orgId)
        )
      )
      .orderBy(desc(clientPortalAccess.createdAt));

    const formatted = accessList.map((row) => {
      let permissions = {
        viewProgress: true,
        viewPhotos: true,
        viewSchedule: true,
        viewDocuments: false,
        viewInvoices: false,
        submitRequests: false,
      };
      try {
        if (row.access.permissionsJson) {
          permissions = JSON.parse(row.access.permissionsJson);
        }
      } catch {}

      return {
        id: row.access.id,
        projectId: row.access.projectId,
        projectName: row.projectName || "Unknown Project",
        email: row.access.email,
        name: row.access.name || "",
        accessType: row.access.accessType || "STAKEHOLDER",
        permissions,
        isActive: row.access.isActive,
        lastAccessedAt: row.access.lastAccessedAt?.toISOString(),
        expiresAt: row.access.tokenExpiresAt?.toISOString(),
        createdAt: row.access.createdAt.toISOString(),
      };
    });

    const activeCount = formatted.filter((a) => a.isActive).length;
    const lastActivity = formatted.reduce((latest: string | null, a) => {
      if (!a.lastAccessedAt) return latest;
      if (!latest) return a.lastAccessedAt;
      return a.lastAccessedAt > latest ? a.lastAccessedAt : latest;
    }, null);

    const host = req.get("host") || "";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const portalUrl = `${protocol}://${host}/portal/${projectId}`;

    res.json({
      accessList: formatted,
      stats: {
        totalAccess: formatted.length,
        activeUsers: activeCount,
        lastActivity,
      },
      portalUrl,
    });
  } catch (error) {
    console.error("Error fetching client portal access:", error);
    res.status(500).json({ error: "Failed to fetch portal access" });
  }
});

// POST /api/ai-features/client-portal/invite - Send portal invitation
router.post("/client-portal/invite", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { projectId, email, name, accessType, permissions } = req.body;

    if (!projectId || !email || !name) {
      return res.status(400).json({ error: "Project ID, email, and name are required" });
    }

    const validAccessTypes = ["OWNER_REP", "GC_REP", "STAKEHOLDER", "VIEWER"];
    const resolvedAccessType = validAccessTypes.includes(accessType) ? accessType : "STAKEHOLDER";

    const [existingProject] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)))
      .limit(1);

    if (!existingProject) {
      return res.status(404).json({ error: "Project not found" });
    }

    const [existing] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.organizationId, orgId),
          eq(clientPortalAccess.email, email.trim().toLowerCase())
        )
      )
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "This email already has portal access for this project" });
    }

    const permissionsJson = permissions
      ? JSON.stringify(permissions)
      : JSON.stringify({
          viewProgress: true,
          viewPhotos: true,
          viewSchedule: true,
          viewDocuments: false,
          viewInvoices: false,
          submitRequests: false,
        });

    const [newAccess] = await db
      .insert(clientPortalAccess)
      .values({
        organizationId: orgId,
        projectId,
        email: email.trim().toLowerCase(),
        name: name.trim(),
        accessType: resolvedAccessType,
        permissionsJson,
        isActive: true,
        createdByUserId: userId,
      })
      .returning();

    let parsedPermissions;
    try {
      parsedPermissions = JSON.parse(newAccess.permissionsJson || "{}");
    } catch {
      parsedPermissions = {};
    }

    const host = req.get("host") || "";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const portalLink = `${protocol}://${host}/portal/${projectId}`;

    const [invitingUser] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const inviterName = invitingUser
      ? `${invitingUser.firstName || ""} ${invitingUser.lastName || ""}`.trim()
      : "Your project team";
    const orgName = org?.name || "your contractor";

    const accessTypeLabels: Record<string, string> = {
      OWNER_REP: "Owner Representative",
      GC_REP: "GC Representative",
      STAKEHOLDER: "Stakeholder",
      VIEWER: "Viewer",
    };
    const accessLabel = accessTypeLabels[resolvedAccessType] || "Stakeholder";

    const permissionsList = [];
    if (parsedPermissions.viewProgress) permissionsList.push("Progress Updates");
    if (parsedPermissions.viewPhotos) permissionsList.push("Photos & Media");
    if (parsedPermissions.viewSchedule) permissionsList.push("Schedule");
    if (parsedPermissions.viewDocuments) permissionsList.push("Documents");
    if (parsedPermissions.viewInvoices) permissionsList.push("Invoices");
    if (parsedPermissions.submitRequests) permissionsList.push("Submit Requests");

    const permissionsHtml = permissionsList.length > 0
      ? `<ul style="margin: 8px 0; padding-left: 20px; color: #333333;">${permissionsList.map(p => `<li style="margin: 4px 0;">${p}</li>`).join("")}</ul>`
      : `<p style="color: #666666;">View access to project information</p>`;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Portal Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: #1a365d; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Client Portal Invitation</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hi ${name.trim()},
      </p>
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        ${inviterName} from <strong>${orgName}</strong> has invited you to access the client portal for project <strong>${existingProject.name}</strong>.
      </p>
      <div style="background-color: #f8f9fa; border-radius: 6px; padding: 16px; margin: 16px 0;">
        <p style="color: #333333; font-size: 14px; margin: 0 0 8px;"><strong>Access Level:</strong> ${accessLabel}</p>
        <p style="color: #333333; font-size: 14px; margin: 0 0 4px;"><strong>You can view:</strong></p>
        ${permissionsHtml}
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${portalLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
          View Project Portal
        </a>
      </div>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        If you have questions, please reach out to your project team directly.
      </p>
    </div>
    <div style="background-color: #f8f9fa; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #999999; font-size: 12px; margin: 0;">
        Sent via SmartManageAI Construction Management Platform
      </p>
    </div>
  </div>
</body>
</html>`;

    try {
      await sendEmail({
        to: email.trim().toLowerCase(),
        subject: `Client Portal Invitation - ${existingProject.name}`,
        html: emailHtml,
        text: `Hi ${name.trim()}, ${inviterName} from ${orgName} has invited you to access the client portal for project "${existingProject.name}". Your access level: ${accessLabel}. Visit: ${portalLink}`,
      });
    } catch (emailErr) {
      console.error("Failed to send portal invitation email:", emailErr);
    }

    res.status(201).json({
      id: newAccess.id,
      projectId: newAccess.projectId,
      projectName: existingProject.name,
      email: newAccess.email,
      name: newAccess.name,
      accessType: newAccess.accessType,
      permissions: parsedPermissions,
      isActive: newAccess.isActive,
      createdAt: newAccess.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Error creating portal invitation:", error);
    res.status(500).json({ error: "Failed to send invitation" });
  }
});

// PATCH /api/ai-features/client-portal/access/:id - Update portal access
router.patch("/client-portal/access/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessId = req.params.id;

    const [existing] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.id, accessId),
          eq(clientPortalAccess.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Portal access not found" });
    }

    const updates: Record<string, any> = {};
    if (req.body.accessType) updates.accessType = req.body.accessType;
    if (req.body.permissions) updates.permissionsJson = JSON.stringify(req.body.permissions);
    if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;
    if (req.body.name) updates.name = req.body.name;

    const [updated] = await db
      .update(clientPortalAccess)
      .set(updates)
      .where(eq(clientPortalAccess.id, accessId))
      .returning();

    res.json({
      id: updated.id,
      accessType: updated.accessType,
      isActive: updated.isActive,
      name: updated.name,
    });
  } catch (error) {
    console.error("Error updating portal access:", error);
    res.status(500).json({ error: "Failed to update portal access" });
  }
});

// DELETE /api/ai-features/client-portal/access/:id - Revoke portal access
router.delete("/client-portal/access/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessId = req.params.id;

    const [existing] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.id, accessId),
          eq(clientPortalAccess.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Portal access not found" });
    }

    await db
      .delete(clientPortalAccess)
      .where(eq(clientPortalAccess.id, accessId));

    res.json({ success: true, message: "Portal access revoked" });
  } catch (error) {
    console.error("Error revoking portal access:", error);
    res.status(500).json({ error: "Failed to revoke portal access" });
  }
});

// ============================================================================
// PUBLIC CLIENT PORTAL (no auth required - for invited external users)
// ============================================================================

// POST /api/ai-features/client-portal/public/verify - Verify email access
router.post("/client-portal/public/verify", async (req, res) => {
  try {
    const { projectId, email } = req.body;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Project ID and email are required" });
    }

    const [access] = await db
      .select({
        access: clientPortalAccess,
        projectName: projects.name,
        projectStatus: projects.status,
        orgName: organizations.name,
      })
      .from(clientPortalAccess)
      .leftJoin(projects, eq(clientPortalAccess.projectId, projects.id))
      .leftJoin(organizations, eq(clientPortalAccess.organizationId, organizations.id))
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.email, email.trim().toLowerCase()),
          eq(clientPortalAccess.isActive, true)
        )
      )
      .limit(1);

    if (!access) {
      return res.status(403).json({ error: "No portal access found for this email" });
    }

    let permissions = {
      viewProgress: true,
      viewPhotos: true,
      viewSchedule: true,
      viewDocuments: false,
      viewInvoices: false,
      submitRequests: false,
    };
    try {
      if (access.access.permissionsJson) {
        permissions = JSON.parse(access.access.permissionsJson);
      }
    } catch {}

    await db
      .update(clientPortalAccess)
      .set({ lastAccessedAt: new Date() })
      .where(eq(clientPortalAccess.id, access.access.id));

    res.json({
      verified: true,
      accessId: access.access.id,
      projectName: access.projectName || "Unknown Project",
      projectStatus: access.projectStatus || "ACTIVE",
      organizationName: access.orgName || "",
      accessType: access.access.accessType || "STAKEHOLDER",
      name: access.access.name || "",
      permissions,
    });
  } catch (error) {
    console.error("Error verifying portal access:", error);
    res.status(500).json({ error: "Failed to verify portal access" });
  }
});

// POST /api/ai-features/client-portal/public/data - Get portal data after verification
router.post("/client-portal/public/data", async (req, res) => {
  try {
    const { projectId, email } = req.body;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Project ID and email are required" });
    }

    const [access] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.email, email.trim().toLowerCase()),
          eq(clientPortalAccess.isActive, true)
        )
      )
      .limit(1);

    if (!access) {
      return res.status(403).json({ error: "No portal access" });
    }

    let permissions = {
      viewProgress: true,
      viewPhotos: true,
      viewSchedule: true,
      viewDocuments: false,
      viewInvoices: false,
      submitRequests: false,
    };
    try {
      if (access.permissionsJson) {
        permissions = JSON.parse(access.permissionsJson);
      }
    } catch {}

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result: Record<string, any> = {
      project: {
        name: project.name,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        address: project.locationAddress,
        city: project.city,
        state: project.state,
      },
    };

    if (permissions.viewProgress) {
      const progressItems = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.projectId, projectId))
        .orderBy(desc(scopeItems.updatedAt));

      result.progress = progressItems.map((item) => ({
        description: item.description,
        status: item.billingStatus || "NOT_STARTED",
        completionPercentage: item.completedQuantity && item.totalQuantity
          ? Math.round((parseFloat(item.completedQuantity) / parseFloat(item.totalQuantity)) * 100)
          : 0,
        updatedAt: item.updatedAt,
      }));
    }

    if (permissions.viewPhotos) {
      const photos = await db
        .select()
        .from(media)
        .where(eq(media.projectId, projectId))
        .orderBy(desc(media.uploadedAt))
        .limit(50);

      result.photos = photos.map((p) => ({
        id: p.id,
        fileName: p.fileName,
        fileUrl: p.fileUrl,
        fileType: p.mimeType,
        description: p.caption,
        createdAt: p.uploadedAt,
      }));
    }

    if (permissions.viewSchedule) {
      const schedules = await db
        .select()
        .from(projectSchedules)
        .where(eq(projectSchedules.projectId, projectId))
        .limit(1);

      if (schedules.length > 0) {
        const tasks = await db
          .select()
          .from(projectScheduleTasks)
          .where(eq(projectScheduleTasks.scheduleId, schedules[0].id))
          .orderBy(projectScheduleTasks.plannedStartDate);

        result.schedule = tasks.map((t) => ({
          name: t.name,
          startDate: t.plannedStartDate,
          endDate: t.plannedEndDate,
          status: t.status,
          progress: t.percentComplete,
        }));
      }
    }

    res.json(result);
  } catch (error) {
    console.error("Error fetching portal data:", error);
    res.status(500).json({ error: "Failed to fetch portal data" });
  }
});

export default router;
