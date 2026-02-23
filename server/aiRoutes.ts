import { Router } from "express";
import { db } from "./db";
import { aiSettings, aiRuns, aiTasks, insertAISettingsSchema, organizations, users, tradeTemplates, organizationCalculators, organizationWorkTypes, tradeTypeEnum, masterSowItems, organizationSowItems, unitsOfMeasure, hustlerOrganizations } from "@shared/schema";
import { logInfo, logError, logWarn } from "./utils/logger";
import { eq, desc, and, sql, asc } from "drizzle-orm";
import { 
  runAIAnalysis, 
  getLatestAIRun, 
  getAIRunById, 
  getTasksForRun,
  getTasksForRole,
  updateTaskStatus 
} from "./ai/orchestrator";
import { sensitiveLimiter } from "./rateLimiter";
import { logUpdate, logCreate } from "./auditLogger";
import { seedScopeStandardizationForTrade } from "./seedTradeExpansion";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { fromZodError } from "zod-validation-error";
import { type AuthRequest } from "./auth";
import { openai, researchCustomTrade, TradeResearchResult } from "./ai/openaiClient";
import { AI_ASSISTANT_SYSTEM_PROMPT, getPageContext } from "./ai/assistantPrompt";
import { z } from "zod";
import { getWalkthroughForRole, getTotalStepsForRole, getWalkthroughStep, generateWalkthroughPrompt, getPersonalizedWalkthrough, personalizeContent } from "./ai/walkthroughContent";

const onboardingCompleteSchema = z.object({
  companyName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(2, "Company name must be at least 2 characters").max(200))
    .transform(s => sanitizeShortText(s)),
  tradeType: z.enum(tradeTypeEnum.enumValues, { 
    errorMap: () => ({ message: "Invalid trade type" }) 
  }),
  tradeName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().max(200))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  crewSize: z.number().int().min(1).max(10000).optional().nullable(),
  region: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().max(200))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  materials: z.array(
    z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(100))
      .transform(s => sanitizeShortText(s))
  ).max(50).optional().nullable(),
  workTypes: z.array(
    z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(100))
      .transform(s => sanitizeShortText(s))
  ).max(50).optional().nullable(),
  websiteUrl: z.string()
    .transform(s => s?.trim() || '')
    .transform(s => {
      // Auto-prepend https:// if user enters URL without protocol
      if (s && s.length > 0 && !s.startsWith('http://') && !s.startsWith('https://')) {
        return `https://${s}`;
      }
      return s;
    })
    .pipe(z.string().url().max(500).or(z.literal('')))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  suggestedCalculators: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
  })).max(20).optional().nullable(),
  // Custom trade fields for OTHER trade type
  customSowItems: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
    unit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    category: z.string().max(100).transform(s => sanitizeShortText(s)).optional(),
  })).max(50).optional().nullable(),
  customWorkTypes: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    unit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    defaultRate: z.number().optional(),
  })).max(30).optional().nullable(),
  customCalculators: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
    outputUnit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    inputs: z.array(z.object({
      name: z.string().max(50),
      unit: z.string().max(20).optional(),
    })).max(10).optional(),
  })).max(20).optional().nullable(),
}).refine(
  // For OTHER trade, require tradeName
  (data) => data.tradeType !== 'OTHER' || (data.tradeName && data.tradeName.length >= 2),
  { message: "Custom trade name is required for specialty trades", path: ["tradeName"] }
);

const onboardingChatSchema = z.object({
  message: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(1, "Message is required").max(2000))
    .transform(s => sanitizeText(s)),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(5000))
      .transform(s => sanitizeText(s)),
  })).max(30).optional().default([]),
  tradeResearch: z.object({
    tradeName: z.string(),
    tradeDescription: z.string().optional(),
    scopeOfWorkItems: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    commonMaterials: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    workTypes: z.array(z.object({
      name: z.string(),
      unit: z.string().optional(),
      typicalProductionRate: z.string().optional(),
      description: z.string().optional(),
    })).optional(),
    calculators: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      outputUnit: z.string().optional(),
      inputs: z.array(z.object({
        name: z.string(),
        unit: z.string().optional(),
      })).optional(),
    })).optional(),
    vendorCategories: z.array(z.string()).optional(),
    industryNotes: z.string().optional(),
  }).optional().nullable(),
});

const tradeResearchSchema = z.object({
  tradeName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(2, "Trade name must be at least 2 characters").max(100))
    .transform(s => sanitizeShortText(s)),
});

const router = Router();

router.get("/ai-settings", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Admin access required" });
    }

    let [settings] = await db.select().from(aiSettings).limit(1);

    if (!settings) {
      [settings] = await db.insert(aiSettings).values({}).returning();
    }

    res.json(settings);
  } catch (error: any) {
    console.error("Error fetching AI settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/ai-settings", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Admin access required" });
    }

    // SECURITY: Sanitize text inputs BEFORE Zod validation
    const sanitizedInput = {
      ...req.body,
      dailyRunTime: req.body.dailyRunTime ? sanitizeShortText(req.body.dailyRunTime) : undefined,
      modelName: req.body.modelName ? sanitizeShortText(req.body.modelName) : undefined,
    };

    // Validate with partial Zod schema to support PATCH partial updates
    const validationResult = insertAISettingsSchema.partial().safeParse(sanitizedInput);
    
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid AI settings data", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const [existingSettings] = await db.select().from(aiSettings).limit(1);

    let updated;
    if (existingSettings) {
      [updated] = await db
        .update(aiSettings)
        .set({ ...validationResult.data, updatedAt: new Date() })
        .where(eq(aiSettings.id, existingSettings.id))
        .returning();
    } else {
      [updated] = await db.insert(aiSettings).values(validationResult.data).returning();
    }

    await logUpdate(
      req.user.id,
      'AI_SETTINGS',
      updated.id,
      existingSettings,
      updated,
      req
    );

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating AI settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai-pm/run", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const runId = await runAIAnalysis(req.user.id);

    await logCreate(
      req.user.id,
      'AI_RUN',
      runId,
      { runId, triggeredBy: req.user.id },
      req
    );

    res.json({ runId, status: 'completed' });
  } catch (error: any) {
    console.error("Error running AI analysis:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/latest-run", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const run = await getLatestAIRun();
    
    if (!run) {
      return res.json(null);
    }

    const parsedRun = {
      ...run,
      snapshotData: run.snapshotData ? JSON.parse(run.snapshotData) : null,
      profitabilityData: run.profitabilityData ? JSON.parse(run.profitabilityData) : null,
      aiResponse: run.aiResponse ? JSON.parse(run.aiResponse) : null,
    };

    res.json(parsedRun);
  } catch (error: any) {
    console.error("Error fetching latest AI run:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/runs/:runId", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const run = await getAIRunById(req.params.runId);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const parsedRun = {
      ...run,
      snapshotData: run.snapshotData ? JSON.parse(run.snapshotData) : null,
      profitabilityData: run.profitabilityData ? JSON.parse(run.profitabilityData) : null,
      aiResponse: run.aiResponse ? JSON.parse(run.aiResponse) : null,
    };

    res.json(parsedRun);
  } catch (error: any) {
    console.error("Error fetching AI run:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/tasks", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { role, status } = req.query;

    const userRole = role ? String(role) : req.user.role;
    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(userRole, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/tasks/role/:role", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { role } = req.params;
    const { status } = req.query;

    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(role, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/ai-pm/tasks/:taskId", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { status } = req.body;

    if (!status || !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Get existing task BEFORE update for audit log
    const [existingTask] = await db
      .select()
      .from(aiTasks)
      .where(eq(aiTasks.id, req.params.taskId))
      .limit(1);

    if (!existingTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    await updateTaskStatus(req.params.taskId, status, req.user.id);

    const [updatedTask] = await db
      .select()
      .from(aiTasks)
      .where(eq(aiTasks.id, req.params.taskId))
      .limit(1);

    await logUpdate(
      req.user.id,
      'AI_TASK',
      req.params.taskId,
      existingTask,
      { status },
      req
    );

    res.json(updatedTask);
  } catch (error: any) {
    console.error("Error updating AI task:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/profitability", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const latestRun = await getLatestAIRun();

    if (!latestRun || !latestRun.profitabilityData) {
      return res.json([]);
    }

    const profitabilityData = JSON.parse(latestRun.profitabilityData);
    res.json(profitabilityData);
  } catch (error: any) {
    console.error("Error fetching profitability data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/equipment-metrics", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const latestRun = await getLatestAIRun();

    if (!latestRun || !latestRun.snapshotData) {
      return res.json({
        summary: {
          total_owned_equipment: 0,
          active_rentals: 0,
          total_rental_cost_mtd: 0,
          underutilized_count: 0,
        },
        rental_vs_owned: [],
        frequently_rented: [],
        underutilized: [],
        project_equipment_costs: [],
        last_updated: null,
      });
    }

    const snapshotData = JSON.parse(latestRun.snapshotData);
    const equipment = snapshotData.equipment || {};
    const roiAnalysis = equipment.roi_analysis || {};

    // Calculate summary metrics
    const fleetSize = equipment.fleet?.length || 0;
    const activeRentals = equipment.active_rentals?.length || 0;
    const rentalHistory = equipment.rental_usage_history || [];
    
    // Calculate MTD rental costs (approximated from recent rentals)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdRentals = rentalHistory.filter((r: any) => {
      const startDate = r.actual_start_date ? new Date(r.actual_start_date) : null;
      return startDate && startDate >= monthStart;
    });
    const totalRentalCostMtd = mtdRentals.reduce((sum: number, r: any) => 
      sum + (r.actual_total_cost || r.quoted_total_cost || 0), 0
    );

    // Get underutilized count
    const underutilizedCount = roiAnalysis.underutilized_owned?.length || 0;

    // Build project equipment costs from projects_with_equipment in snapshot
    const projectsWithEquipment = equipment.projects_with_equipment || [];
    const projectCosts = projectsWithEquipment.map((p: any) => {
      const planned = Number(p.planned_cost) || 0;
      const actual = Number(p.actual_cost) || 0;
      // Use actual if available, otherwise use planned
      const total = actual > 0 ? actual : planned;
      return {
        project_code: p.project_code,
        project_name: p.project_name,
        planned_cost: planned,
        actual_cost: actual,
        total_cost: total,
      };
    });

    // Sort project costs by total descending
    projectCosts.sort((a: any, b: any) => b.total_cost - a.total_cost);

    res.json({
      summary: {
        total_owned_equipment: fleetSize,
        active_rentals: activeRentals,
        total_rental_cost_mtd: Math.round(totalRentalCostMtd * 100) / 100,
        underutilized_count: underutilizedCount,
      },
      rental_vs_owned: roiAnalysis.rental_vs_owned_comparison || [],
      frequently_rented: roiAnalysis.frequently_rented_equipment || [],
      underutilized: roiAnalysis.underutilized_owned || [],
      project_equipment_costs: projectCosts.slice(0, 10),
      last_updated: latestRun.createdAt,
    });
  } catch (error: any) {
    console.error("Error fetching equipment metrics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/runs", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const runs = await db
      .select()
      .from(aiRuns)
      .orderBy(desc(aiRuns.createdAt))
      .limit(50);

    res.json(runs);
  } catch (error: any) {
    console.error("Error fetching AI runs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get master SOW items for a trade type (for onboarding suggestions)
router.get("/ai/onboarding/sow-items/:tradeType", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { tradeType } = req.params;
    
    // Validate trade type
    if (!tradeTypeEnum.enumValues.includes(tradeType as any)) {
      return res.status(400).json({ error: "Invalid trade type" });
    }

    // Fetch master SOW items for this trade
    const items = await db
      .select()
      .from(masterSowItems)
      .where(eq(masterSowItems.tradeType, tradeType as any))
      .orderBy(asc(masterSowItems.sortOrder));

    // Group by category for easier consumption
    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      const cat = item.categoryName || 'General';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description,
        defaultUomCode: item.defaultUomCode,
        csiCode: item.csiCode,
      });
    }

    res.json({ 
      tradeType,
      items,
      groupedByCategory: grouped,
      totalCount: items.length 
    });
  } catch (error: any) {
    console.error("Error fetching master SOW items:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all trade templates (for onboarding trade selection)
router.get("/ai/onboarding/trades", async (req: AuthRequest, res) => {
  try {
    const templates = await db
      .select({
        tradeType: tradeTemplates.tradeType,
        displayName: tradeTemplates.displayName,
        description: tradeTemplates.description,
        csiDivision: tradeTemplates.csiDivision,
        iconName: tradeTemplates.iconName,
        colorHex: tradeTemplates.colorHex,
        isGcTrade: tradeTemplates.isGcTrade,
      })
      .from(tradeTemplates)
      .where(eq(tradeTemplates.isActive, true))
      .orderBy(asc(tradeTemplates.displayName));

    res.json(templates);
  } catch (error: any) {
    console.error("Error fetching trade templates:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get units of measure (for dropdowns)
router.get("/ai/onboarding/units", async (req: AuthRequest, res) => {
  try {
    const units = await db
      .select()
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.isActive, true))
      .orderBy(asc(unitsOfMeasure.sortOrder));

    res.json(units);
  } catch (error: any) {
    console.error("Error fetching units:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Helper to get SOW suggestions for a trade from database
async function getSowSuggestionsForTrade(tradeType: string): Promise<string[]> {
  const items = await db
    .select({ name: masterSowItems.name })
    .from(masterSowItems)
    .where(eq(masterSowItems.tradeType, tradeType as any))
    .orderBy(asc(masterSowItems.sortOrder))
    .limit(20);
  
  return items.map(i => i.name);
}

// Dynamic onboarding system prompt builder
async function buildOnboardingSystemPrompt(): Promise<string> {
  // Fetch all trade templates for the prompt
  const templates = await db
    .select({
      tradeType: tradeTemplates.tradeType,
      displayName: tradeTemplates.displayName,
      materialCategories: tradeTemplates.materialCategories,
    })
    .from(tradeTemplates)
    .where(eq(tradeTemplates.isActive, true));

  // Build trade type list
  const tradeTypes = templates.map(t => t.tradeType).join(', ');

  // Build material suggestions by trade
  const materialSuggestions = templates
    .filter(t => t.materialCategories)
    .map(t => `${t.tradeType}: ${t.materialCategories}`)
    .join('\n');

  return `You are an AI assistant helping new contractors set up their construction management platform. Your goal is to have a friendly, in-depth conversation to understand their business so we can configure the system perfectly for their needs, including pre-building their scope of work items and material calculators.

## Your Conversation Flow:

### For Known Trades (22 preset trades):
1. **Welcome & Trade** - Warmly greet them and ask what type of contracting work they specialize in
2. **Crew Size** - Ask about their typical crew size (can be a range like "5-10")
3. **Region** - Ask what geographic area they primarily serve
4. **Work Types/SOW** - Based on their trade, we have pre-built scope of work items. Ask them to confirm which services they offer
5. **Materials** - Based on their trade, suggest material categories they likely use
6. **Website** - Ask if they have a company website - we can match their system's look to their brand (optional)
7. **Wrap Up** - Summarize everything and confirm they're ready to set up

### For Custom/OTHER Trades (specialty not in our list):
If a user's trade doesn't match any of our 22 preset trades, use trade type "OTHER" and follow this extended flow:
1. **Welcome & Trade** - Ask what they specialize in, acknowledge we'll set them up with a custom configuration
2. **Custom Trade Name** - Get a clear description of their specialty (this becomes their tradeName)
3. **Crew Size** - Ask about typical crew size
4. **Region** - Ask what geographic area they serve
5. **Custom Scope of Work** - Since we don't have preset items, ask: "What are the main types of work or services your company performs? Please list 5-10 of your most common job types." Store these as customSowItems
6. **Custom Work Types** - Ask: "For tracking productivity, what units do you typically measure your work in? (e.g., linear feet, square feet, each, hours)" Create customWorkTypes from their answers
7. **Materials** - Ask what types of materials they commonly use and need to track
8. **Custom Calculators** - Ask if there are any calculations they frequently do for estimates (e.g., "material needed per square foot"). Create customCalculators from their answers
9. **Website** - Ask if they have a company website
10. **Wrap Up** - Summarize the custom configuration and confirm they're ready

## Trade Types to Identify:
${tradeTypes}

When the user mentions their trade, map it to the closest matching trade type from the list above. Examples:
- "roofer" or "roofing contractor" → ROOFING
- "electrician" or "electrical contractor" → ELECTRICAL
- "plumber" → PLUMBING
- "HVAC tech" or "heating and cooling" → HVAC
- "concrete contractor" or "flatwork" → CONCRETE
- "framing" or "trim carpenter" → CARPENTRY
- "general contractor" or "GC" or "builder" → GENERAL_CONTRACTOR (Note: GC mode unlocks ALL trade templates for multi-trade coordination)
- "drywall" or "sheetrock" → DRYWALL
- "painter" or "painting contractor" → PAINTING
- "flooring installer" → FLOORING
- "landscaper" → LANDSCAPING
- "excavation" or "site work" → EARTHWORK
- "demo contractor" → DEMOLITION
- "steel erector" or "ironworker" → STEEL_ERECTION
- "glazier" or "glass/windows" → GLAZING
- "insulation contractor" → INSULATION
- "sprinkler" or "fire sprinklers" → FIRE_PROTECTION
- "waterproofing" → WATERPROOFING
- "paving" or "asphalt" → ASPHALT_PAVING
- "low voltage" or "AV/security" → LOW_VOLTAGE
- "solar installer" → SOLAR

**IMPORTANT: If the user's trade does NOT clearly match any of the above 22 trades, use tradeType: "OTHER" and gather custom configuration data. Examples of trades requiring OTHER:**
- Pool/spa contractor
- Chimney sweep
- Elevator technician
- Scaffolding contractor
- Marine/dock builder
- Geotechnical drilling
- Hazmat remediation
- Tree service/arborist
- Pressure washing
- Specialty welding
- Any niche trade not listed above

## Material Categories by Trade:
${materialSuggestions}

## Response Format:
Always respond with valid JSON in this exact format:
{
  "message": "Your conversational response to the user",
  "extractedData": {
    "tradeType": "ROOFING" or "OTHER" or null if not yet determined,
    "tradeName": "Custom trade description - REQUIRED for OTHER trade" or null,
    "crewSize": 5 or null if not yet determined,
    "region": "Dallas, TX area" or null if not yet determined,
    "materials": ["shingles", "underlayment"] or null if not yet determined,
    "workTypes": ["Shingle Tear-off & Replace", "Roof Repairs"] or null,
    "websiteUrl": "https://example.com" or null if not provided,
    "suggestedCalculators": [
      {"name": "Shingle Calculator", "description": "Calculate bundles needed from square footage"}
    ] or null,
    "customSowItems": [
      {"name": "Pool Excavation", "description": "Dig pool shell to specifications", "unit": "EA", "category": "Pool Construction"}
    ] or null (ONLY for OTHER trade),
    "customWorkTypes": [
      {"name": "Pool Installation", "unit": "EA", "defaultRate": 1}
    ] or null (ONLY for OTHER trade),
    "customCalculators": [
      {"name": "Pool Volume Calculator", "description": "Calculate gallons from dimensions", "outputUnit": "gallons", "inputs": [{"name": "length", "unit": "ft"}, {"name": "width", "unit": "ft"}, {"name": "depth", "unit": "ft"}]}
    ] or null (ONLY for OTHER trade)
  },
  "suggestions": {
    "workTypes": null,
    "materials": null
  },
  "isComplete": false,
  "isCustomTrade": false,
  "step": 1
}

## Important Guidelines:

### CONVERSATIONAL PRIORITY - THIS IS CRITICAL:
- **ALWAYS acknowledge what the user said before moving on** - If they ask a question, answer it first. If they share something interesting, comment on it. Don't just extract data and rush to the next question.
- **Be genuinely interested** - React to what they share. "Oh, roofing in Texas? You must stay busy after storm season!" is better than "Got it. What's your crew size?"
- **If the user asks a question or goes off-topic, FULLY address it** before continuing the setup flow. Users hate feeling ignored.
- **Match their energy** - If they're brief, be efficient. If they're chatty, engage with them.
- **Use natural transitions** - Instead of "Next question:", say things like "That helps a lot! By the way..." or "Makes sense. One more thing I'm curious about..."

### Smart Research Triggers:
When the user mentions MATERIALS, SUPPLIES, or asks about what they'll need:
- Proactively suggest specific materials relevant to their trade
- Offer insights like "Most roofing contractors I work with track shingles, underlayment, flashing, and vents. Does that sound about right for you?"

When the user asks about SCOPE OF WORK, JOB TYPES, or SERVICES:
- Share the pre-built scope items we have for their trade
- Ask if there are any specific services they want to add or remove

### General Conversation Rules:
- Be conversational and friendly, not robotic
- Ask ONE question at a time - don't overwhelm them
- When you identify their trade from our preset list, tell them we have pre-built scope of work items for their trade that will be loaded automatically
- **SPECIAL: General Contractor Mode** - If user identifies as a GC/General Contractor/Builder, inform them this unlocks access to ALL 22 trade templates with scope of work items, calculators, and work types for subcontractor coordination across every specialty
- **SPECIAL: Custom Trade (OTHER)** - If user's trade doesn't match our 22 presets:
  - Set tradeType to "OTHER" and isCustomTrade to true
  - Tell them: "I don't have a preset template for your trade, but no problem! I'll help you set up a fully customized system. This actually gives you more flexibility to define exactly how you work."
  - Gather customSowItems (at least 5-10 common job types they perform)
  - Gather customWorkTypes with appropriate units
  - Ask about any calculations they frequently need
  - Be extra thorough since we're building their configuration from scratch
- For materials, suggest based on their trade's material categories (or ask if OTHER)
- For the website, explain it's optional but we can match their system colors to their brand
- Set isComplete to true only when you have gathered: trade type, crew size, region, and confirmed they're ready
- For OTHER trades, also ensure you have: tradeName, customSowItems (at least 3), customWorkTypes (at least 2)

Step progression for preset trades: 1=trade, 2=crew, 3=region, 4=workTypes confirmation, 5=materials, 6=website, 7=confirmation
Step progression for OTHER trades: 1=trade, 2=tradeName, 3=crew, 4=region, 5=customSowItems, 6=customWorkTypes, 7=materials, 8=customCalculators, 9=website, 10=confirmation`;
}

// Complete onboarding and save organization configuration
router.post("/ai/onboarding/complete", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate and sanitize input
    const validationResult = onboardingCompleteSchema.safeParse(req.body);
    if (!validationResult.success) {
      logError(`[Onboarding] Validation failed for user ${req.user.id}: ${fromZodError(validationResult.error).toString()}`);
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { 
      companyName, tradeType, tradeName, crewSize, region, materials, workTypes, websiteUrl, suggestedCalculators,
      customSowItems, customWorkTypes, customCalculators 
    } = validationResult.data;

    // CRITICAL: Explicit trade type validation - NEVER fallback to CONCRETE
    const validTradeTypes = tradeTypeEnum.enumValues;
    if (!validTradeTypes.includes(tradeType as any)) {
      logError(`[Onboarding] INVALID trade type attempted: "${tradeType}" by user ${req.user.id}`);
      return res.status(400).json({ 
        error: "Invalid trade type", 
        message: `Trade type "${tradeType}" is not valid. Valid options: ${validTradeTypes.join(', ')}` 
      });
    }

    // Log the onboarding attempt for debugging
    logInfo(`[Onboarding] Starting for user ${req.user.id} | trade: ${tradeType} | company: ${companyName}`);

    // Check if user is a HUSTLER - they can create multiple organizations
    const isHustler = req.user.role === 'HUSTLER';
    
    // Detect if this is a custom trade (OTHER)
    const isCustomTrade = tradeType === 'OTHER';

    // Ensure companyName is defined (should be guaranteed by Zod schema)
    const orgName = companyName || 'My Company';

    // Materials are already sanitized by Zod schema
    const sanitizedMaterials = materials || [];
    const sanitizedWorkTypes = (workTypes || []).filter((wt): wt is string => typeof wt === 'string' && wt.length > 0);

    let newOrg: typeof organizations.$inferSelect;
    
    // Check if user already has an organization (e.g., from Fresh Admin dev login)
    if (req.user.organizationId && !isHustler) {
      // Check if their existing org is in NOT_STARTED status (needs completion)
      const existingOrg = await db.query.organizations.findFirst({
        where: eq(organizations.id, req.user.organizationId),
      });
      
      if (existingOrg && existingOrg.onboardingStatus === 'NOT_STARTED') {
        // Update the existing organization instead of creating a new one
        logInfo(`[Onboarding] Updating existing org ${existingOrg.id} for user ${req.user.id}`);
        
        const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const slug = `${baseSlug}-${Date.now().toString(36)}`;
        
        const [updatedOrg] = await db.update(organizations)
          .set({
            name: orgName,
            slug,
            tradeType: tradeType as any,
            tradeName: tradeName || null,
            typicalCrewSize: crewSize || null,
            region: region || null,
            websiteUrl: websiteUrl || null,
            onboardingStatus: 'COMPLETED',
            onboardingData: JSON.stringify({ 
              materials: sanitizedMaterials, 
              workTypes: sanitizedWorkTypes,
              suggestedCalculators: suggestedCalculators || [],
              customSowItems: customSowItems || [],
              customWorkTypes: customWorkTypes || [],
              customCalculators: customCalculators || [],
              isCustomTrade,
              completedAt: new Date() 
            }),
          })
          .where(eq(organizations.id, existingOrg.id))
          .returning();
        
        newOrg = updatedOrg;
      } else {
        // Organization already has completed onboarding or other status - reject
        logWarn(`[Onboarding] Non-Hustler user ${req.user.id} already has completed org ${req.user.organizationId}`);
        return res.status(400).json({ error: "You already belong to an organization" });
      }
    } else {
      // Create a new organization
      // Generate a unique slug from sanitized company name
      const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const slug = `${baseSlug}-${Date.now().toString(36)}`;

      // Create the organization with website URL for theme extraction
      const [createdOrg] = await db.insert(organizations).values({
        name: orgName,
        slug,
        tradeType: tradeType as any,
        tradeName: tradeName || null,
        typicalCrewSize: crewSize || null,
        region: region || null,
        websiteUrl: websiteUrl || null,
        onboardingStatus: 'COMPLETED',
        onboardingData: JSON.stringify({ 
          materials: sanitizedMaterials, 
          workTypes: sanitizedWorkTypes,
          suggestedCalculators: suggestedCalculators || [],
          customSowItems: customSowItems || [],
          customWorkTypes: customWorkTypes || [],
          customCalculators: customCalculators || [],
          isCustomTrade,
          completedAt: new Date() 
        }),
      }).returning();
      
      newOrg = createdOrg;
    }

    // Update the user to belong to this organization
    // For Hustlers creating additional orgs, we don't change their primary organizationId
    if (isHustler) {
      // Link Hustler to this new organization via junction table
      await db.insert(hustlerOrganizations).values({
        userId: req.user.id,
        organizationId: newOrg.id,
        roleOverride: 'ADMIN', // Hustler gets ADMIN role in new org
        isActive: true,
      }).onConflictDoNothing();
      
      // If Hustler has no primary org, set this as their primary
      if (!req.user.organizationId) {
        await db.update(users)
          .set({ 
            organizationId: newOrg.id,
            isActive: true 
          })
          .where(eq(users.id, req.user.id));
      }
      
      logInfo(`[Onboarding] Hustler ${req.user.id} linked to new org ${newOrg.id}`);
    } else {
      // Standard user - set as their primary organization
      await db.update(users)
        .set({ 
          organizationId: newOrg.id,
          role: 'ADMIN', // First user becomes admin
          isActive: true 
        })
        .where(eq(users.id, req.user.id));
    }

    // Copy master SOW items from database template to organization
    // GENERAL_CONTRACTOR gets ALL trade items for multi-trade coordination
    // CUSTOM (OTHER) trades get items created from user input
    const isGeneralContractor = tradeType === 'GENERAL_CONTRACTOR';
    
    // LOGGING: Track SOW generation for debugging
    logInfo(`[Onboarding] SOW generation | isGC: ${isGeneralContractor} | isCustom: ${isCustomTrade} | trade: ${tradeType}`);
    
    if (isCustomTrade) {
      // ============================================
      // CUSTOM TRADE (OTHER) - Create from user input
      // ============================================
      const customTradeName = tradeName || 'Custom Trade';
      let sowItemCount = 0;
      
      // Create SOW items from customSowItems provided by AI conversation
      if (customSowItems && customSowItems.length > 0) {
        for (let i = 0; i < customSowItems.length; i++) {
          const item = customSowItems[i];
          if (item && item.name) {
            const code = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
            await db.insert(organizationSowItems).values({
              organizationId: newOrg.id,
              categoryName: item.category || customTradeName,
              name: item.name,
              code: `custom_${code}_${i}`,
              description: item.description || null,
              unit: item.unit || 'EA',
              displayOrder: i,
              isFromTemplate: false,
              isActive: true,
            }).onConflictDoNothing();
            sowItemCount++;
          }
        }
      }
      
      // Also add any workTypes from the basic list if provided
      for (let i = 0; i < sanitizedWorkTypes.length; i++) {
        const wt = sanitizedWorkTypes[i];
        const code = wt.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
        await db.insert(organizationSowItems).values({
          organizationId: newOrg.id,
          categoryName: customTradeName,
          name: wt,
          code: `sow_${code}_${i}`,
          displayOrder: sowItemCount + i,
          isFromTemplate: false,
          isActive: true,
        }).onConflictDoNothing();
        sowItemCount++;
      }
      
      // If no SOW items were created, add essential defaults based on trade name
      if (sowItemCount === 0) {
        const defaultSowItems = [
          { name: `${customTradeName} - Standard Service`, category: customTradeName },
          { name: `${customTradeName} - Repair/Maintenance`, category: customTradeName },
          { name: `${customTradeName} - Installation`, category: customTradeName },
          { name: `${customTradeName} - Consultation`, category: customTradeName },
          { name: `${customTradeName} - Emergency Service`, category: customTradeName },
        ];
        for (let i = 0; i < defaultSowItems.length; i++) {
          const item = defaultSowItems[i];
          const code = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
          await db.insert(organizationSowItems).values({
            organizationId: newOrg.id,
            categoryName: item.category,
            name: item.name,
            code: `default_${code}_${i}`,
            unit: 'EA',
            displayOrder: i,
            isFromTemplate: false,
            isActive: true,
          }).onConflictDoNothing();
        }
      }
      
      // Create work types from customWorkTypes provided by AI conversation
      let workTypeCount = 0;
      if (customWorkTypes && customWorkTypes.length > 0) {
        for (const wt of customWorkTypes) {
          if (wt && wt.name) {
            await db.insert(organizationWorkTypes).values({
              organizationId: newOrg.id,
              name: wt.name,
              category: customTradeName,
              unit: wt.unit || 'EA',
              defaultProductionRate: wt.defaultRate ? String(wt.defaultRate) : null,
            }).onConflictDoNothing();
            workTypeCount++;
          }
        }
      }
      
      // Add default work types if none were provided
      if (workTypeCount === 0) {
        const defaultWorkTypes = [
          { name: 'General Work', unit: 'HR' },
          { name: 'Project Completion', unit: 'EA' },
          { name: 'Service Call', unit: 'EA' },
          { name: 'Material Installation', unit: 'SF' },
        ];
        for (const wt of defaultWorkTypes) {
          await db.insert(organizationWorkTypes).values({
            organizationId: newOrg.id,
            name: wt.name,
            category: customTradeName,
            unit: wt.unit,
          }).onConflictDoNothing();
        }
      }
      
      // Create calculators from customCalculators provided by AI conversation
      if (customCalculators && customCalculators.length > 0) {
        for (const calc of customCalculators) {
          if (calc && calc.name) {
            await db.insert(organizationCalculators).values({
              organizationId: newOrg.id,
              name: calc.name,
              category: customTradeName,
              unit: calc.outputUnit || 'units',
              formulaJson: JSON.stringify({ 
                type: 'custom', 
                description: calc.description || '',
                inputs: calc.inputs || [] 
              }),
              inputFieldsJson: JSON.stringify(calc.inputs || []),
            }).onConflictDoNothing();
          }
        }
      }
      
      // Add a default material calculator if none provided
      if (!customCalculators || customCalculators.length === 0) {
        await db.insert(organizationCalculators).values({
          organizationId: newOrg.id,
          name: 'Material Quantity Calculator',
          category: customTradeName,
          unit: 'units',
          formulaJson: JSON.stringify({ 
            type: 'custom', 
            description: 'Calculate material quantity based on area',
            formula: 'area * coverage_rate'
          }),
          inputFieldsJson: JSON.stringify([
            { name: 'area', label: 'Area (sq ft)', type: 'number' },
            { name: 'coverage_rate', label: 'Coverage Rate', type: 'number' }
          ]),
        }).onConflictDoNothing();
      }
      
    } else {
      // ============================================
      // PRESET TRADE - Copy from master templates
      // ============================================
      let masterItems;
      if (isGeneralContractor) {
        // GC mode: Load ALL ACTIVE master SOW items from all trades
        masterItems = await db
          .select()
          .from(masterSowItems)
          .where(eq(masterSowItems.isActive, true))
          .orderBy(asc(masterSowItems.tradeType), asc(masterSowItems.sortOrder));
      } else {
        // Single trade: Load only ACTIVE items for the selected trade
        masterItems = await db
          .select()
          .from(masterSowItems)
          .where(and(
            eq(masterSowItems.tradeType, tradeType as any),
            eq(masterSowItems.isActive, true)
          ))
          .orderBy(asc(masterSowItems.sortOrder));
      }

      // Insert master SOW items as organization SOW items
      for (const item of masterItems) {
        // For GC, include trade type in category for better organization
        const categoryName = isGeneralContractor 
          ? `${item.tradeType} - ${item.categoryName || 'General'}`
          : (item.categoryName || 'General');
        
        // For GC, namespace code with trade type to avoid collisions
        const itemCode = isGeneralContractor
          ? `${item.tradeType}_${item.code}`
          : item.code;
        
        await db.insert(organizationSowItems).values({
          organizationId: newOrg.id,
          categoryName,
          name: item.name,
          code: itemCode,
          description: item.description,
          unit: item.defaultUomCode || 'EA',
          displayOrder: item.sortOrder || 0,
          requiresDimensions: item.requiresDimensions || false,
          dimensionLabel: item.dimensionLabel,
          isFromTemplate: true,
          isActive: true,
        }).onConflictDoNothing();
      }

      // Also add any custom user-selected work types that aren't in the master list
      const masterItemNames = new Set(masterItems.map(m => m.name.toLowerCase()));
      for (let i = 0; i < sanitizedWorkTypes.length; i++) {
        const wt = sanitizedWorkTypes[i];
        if (!masterItemNames.has(wt.toLowerCase())) {
          const code = wt.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
          await db.insert(organizationSowItems).values({
            organizationId: newOrg.id,
            categoryName: tradeName || tradeType,
            name: wt,
            code: `custom_${code}_${i}`,
            displayOrder: masterItems.length + i,
            isFromTemplate: false,
            isActive: true,
          }).onConflictDoNothing();
        }
      }

      // Copy trade template configurations to organization
      // GENERAL_CONTRACTOR gets work types and calculators from ALL trade templates
      let templates;
      if (isGeneralContractor) {
        // GC: Load all ACTIVE trade templates
        templates = await db.select().from(tradeTemplates).where(eq(tradeTemplates.isActive, true));
      } else {
        const [template] = await db.select().from(tradeTemplates).where(
          and(eq(tradeTemplates.tradeType, tradeType as any), eq(tradeTemplates.isActive, true))
        );
        templates = template ? [template] : [];
      }
      
      for (const template of templates) {
        // Parse and create organization-specific work types from template JSON
        try {
          const templateWorkTypes = JSON.parse(template.workTypesJson || '[]');
          for (let wtIdx = 0; wtIdx < templateWorkTypes.length; wtIdx++) {
            const wt = templateWorkTypes[wtIdx];
            if (wt && wt.name) {
              // For GC, namespace work type names with tradeType code for guaranteed uniqueness
              const workTypeName = isGeneralContractor 
                ? `[${template.tradeType}] ${wt.name}`
                : wt.name;
              const category = template.displayName || template.tradeType;
              
              await db.insert(organizationWorkTypes).values({
                organizationId: newOrg.id,
                name: workTypeName,
                category,
                unit: wt.unit || 'EA',
                defaultProductionRate: wt.rate ? String(wt.rate) : null,
              }).onConflictDoNothing();
            }
          }
        } catch (e) {
          console.error("Error parsing work types:", e);
        }

        // Parse and create organization-specific calculators from template
        try {
          const calculators = JSON.parse(template.calculatorConfigJson || '[]');
          for (let calcIdx = 0; calcIdx < calculators.length; calcIdx++) {
            const calc = calculators[calcIdx];
            if (calc && calc.name) {
              // For GC, namespace calculator names with tradeType code for guaranteed uniqueness
              const calcName = isGeneralContractor 
                ? `[${template.tradeType}] ${calc.name}`
                : calc.name;
              const category = template.displayName || template.tradeType;
              
              await db.insert(organizationCalculators).values({
                organizationId: newOrg.id,
                name: calcName,
                category,
                unit: calc.output || 'units',
                formulaJson: JSON.stringify({ type: calc.type, inputs: calc.inputs, output: calc.output }),
                inputFieldsJson: JSON.stringify(calc.inputs || []),
              }).onConflictDoNothing();
            }
          }
        } catch (e) {
          console.error("Error parsing calculators:", e);
        }
      }
    }

    // Create calculators from AI suggestions if additional ones suggested
    if (suggestedCalculators && suggestedCalculators.length > 0) {
      for (const calc of suggestedCalculators) {
        if (calc && calc.name) {
          await db.insert(organizationCalculators).values({
            organizationId: newOrg.id,
            name: calc.name,
            category: tradeName || tradeType,
            unit: 'units',
            formulaJson: JSON.stringify({ formula: 'quantity * rate', description: calc.description || '' }),
            inputFieldsJson: JSON.stringify([{ name: 'quantity', label: 'Quantity', type: 'number' }]),
          }).onConflictDoNothing();
        }
      }
    }

    // Seed scope standardization data (work types + modifiers) for the org's trade
    try {
      await seedScopeStandardizationForTrade(tradeType);
      logInfo(`[Onboarding] Scope standardization seeded for trade: ${tradeType}`);
    } catch (scopeErr: any) {
      logWarn(`[Onboarding] Scope standardization seeding failed (non-fatal): ${scopeErr.message}`);
    }

    // If website URL provided, trigger background theme extraction (async)
    if (websiteUrl) {
      extractThemeFromWebsite(newOrg.id, websiteUrl).catch(err => {
        console.error("Theme extraction failed:", err.message);
      });
    }

    // Final success logging
    logInfo(`[Onboarding] SUCCESS | org: ${newOrg.id} | trade: ${tradeType} | isHustler: ${isHustler} | company: ${orgName}`);

    res.json({ 
      success: true, 
      organization: newOrg,
      message: "Your account has been configured successfully!",
      isHustler,
    });
  } catch (error: any) {
    logError(`[Onboarding] FAILED: ${error.message || "Unknown error"}`);
    console.error("Onboarding complete error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to complete onboarding. Please try again." });
  }
});

// Helper function to extract theme colors from a website (SSRF protected)
async function extractThemeFromWebsite(organizationId: string, websiteUrl: string): Promise<void> {
  try {
    // SSRF Protection: Validate URL
    const url = new URL(websiteUrl);
    
    // Only allow http/https
    if (!['http:', 'https:'].includes(url.protocol)) {
      console.log("Theme extraction: Invalid protocol");
      return;
    }
    
    // Block private/internal IPs
    const hostname = url.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^0\./,
      /^169\.254\./,
      /\.local$/i,
      /^::1$/,
      /^fc00:/i,
      /^fe80:/i,
    ];
    
    if (blockedPatterns.some(pattern => pattern.test(hostname))) {
      console.log("Theme extraction: Blocked internal IP/hostname");
      return;
    }

    // Fetch with timeout and size limit
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SmartManageAI-Theme-Extractor/1.0',
        'Accept': 'text/html',
      },
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log("Theme extraction: Failed to fetch website");
      return;
    }

    // Limit response size to 1MB
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1000000) {
      console.log("Theme extraction: Response too large");
      return;
    }

    const html = await response.text();
    
    // Simple color extraction from HTML/CSS
    const colorPatterns = [
      // Hex colors
      /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
      // RGB colors
      /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
    ];

    const foundColors: string[] = [];
    for (const pattern of colorPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        foundColors.push(...matches.slice(0, 10)); // Limit to first 10 matches
      }
    }

    // Use AI to analyze colors and pick primary/secondary/accent
    if (foundColors.length > 0) {
      const colorAnalysis = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'You are a design expert. Given a list of colors found on a website, identify the most likely primary brand color, secondary color, and accent color. Return JSON with: {"primaryColor": "#hex", "secondaryColor": "#hex", "accentColor": "#hex"}'
        }, {
          role: 'user',
          content: `Colors found on website: ${foundColors.slice(0, 20).join(', ')}`
        }],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 100,
      });

      const themeColors = JSON.parse(colorAnalysis.choices[0]?.message?.content || '{}');
      
      // Update organization with extracted colors
      if (themeColors.primaryColor || themeColors.secondaryColor || themeColors.accentColor) {
        await db.update(organizations)
          .set({
            primaryColor: themeColors.primaryColor || null,
            secondaryColor: themeColors.secondaryColor || null,
            accentColor: themeColors.accentColor || null,
            themeExtractedAt: new Date(),
          })
          .where(eq(organizations.id, organizationId));
        
        console.log(`Theme extracted for org ${organizationId}:`, themeColors);
      }
    }
  } catch (error: any) {
    console.error("Theme extraction error:", error.message);
  }
}

// Trade Research endpoint - researches an unknown trade using AI
router.post("/ai/onboarding/research-trade", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validationResult = tradeResearchSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { tradeName } = validationResult.data;
    
    if (!tradeName) {
      return res.status(400).json({ error: "Trade name is required" });
    }
    
    console.log(`[Trade Research API] Researching trade: ${tradeName}`);
    const research = await researchCustomTrade(tradeName);
    
    res.json({
      success: true,
      research,
    });
  } catch (error: any) {
    console.error("Trade research error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to research trade. Please try again." });
  }
});

// Helper to build enhanced system prompt with trade research data
function buildTradeResearchContext(research: TradeResearchResult): string {
  const sowItems = research.scopeOfWorkItems
    ?.slice(0, 12)
    .map(item => `- ${item.name} (${item.unit}): ${item.description || ''}`)
    .join('\n') || '';
  
  const materials = research.commonMaterials
    ?.slice(0, 10)
    .map(m => `- ${m.name} (${m.unit}): ${m.description || ''}`)
    .join('\n') || '';
  
  const workTypes = research.workTypes
    ?.slice(0, 6)
    .map(wt => `- ${wt.name} (${wt.unit})${wt.typicalProductionRate ? ` - typical rate: ${wt.typicalProductionRate}` : ''}`)
    .join('\n') || '';
  
  const calculators = research.calculators
    ?.slice(0, 4)
    .map(c => `- ${c.name}: ${c.description || ''}`)
    .join('\n') || '';

  return `
## IMPORTANT: Research Data for "${research.tradeName}"

You have access to RESEARCHED INDUSTRY DATA for this specialty trade. Use this information to make educated suggestions during the conversation.

**Trade Description:** ${research.tradeDescription || ''}

**Common Scope of Work Items (suggest these):**
${sowItems}

**Common Materials:**
${materials}

**Work Types with Typical Units:**
${workTypes}

**Useful Calculators:**
${calculators}

**Vendor Categories:** ${research.vendorCategories?.join(', ') || 'General suppliers'}

**Industry Notes:** ${research.industryNotes || ''}

INSTRUCTIONS:
- Use this research to make informed suggestions
- Present the SOW items as "Based on ${research.tradeName} industry standards, here are common services..."
- Offer the materials list as suggestions they can confirm
- Suggest the work types with appropriate units
- Recommend the calculators that would be helpful
- The user can accept, modify, or add to these suggestions
`;
}

// AI Onboarding Chat endpoint
router.post("/ai/onboarding/chat", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate and sanitize input
    const validationResult = onboardingChatSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { message, conversationHistory, tradeResearch } = validationResult.data;

    // Build dynamic system prompt with trade data from database
    let systemPrompt = await buildOnboardingSystemPrompt();
    
    // If trade research data is available, append it to provide context
    if (tradeResearch && tradeResearch.tradeName) {
      const researchContext = buildTradeResearchContext(tradeResearch as TradeResearchResult);
      systemPrompt += researchContext;
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add sanitized conversation history
    for (const msg of conversationHistory.slice(-20)) {
      if (msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message || '' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 800, // Increased for more detailed responses with research context
      response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(responseText);
    res.json(parsed);
  } catch (error: any) {
    console.error("AI Onboarding error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to get AI response. Please try again." });
  }
});

// Get user walkthrough status
router.get("/ai/walkthrough/status", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Query fresh user data directly from database to handle session timing issues
    // This ensures we get the latest organizationId even if it was just updated
    const [freshUser] = await db.select({
      walkthroughCompleted: users.walkthroughCompleted,
      walkthroughStep: users.walkthroughStep,
      walkthroughStartedAt: users.walkthroughStartedAt,
      role: users.role,
      organizationId: users.organizationId,
      firstName: users.firstName,
    }).from(users).where(eq(users.id, req.user.id));

    if (!freshUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user has an organization (using fresh data)
    if (!freshUser.organizationId) {
      // Users without organizations should complete org onboarding first
      return res.json({
        walkthroughCompleted: true,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
        totalSteps: 0,
        role: freshUser.role,
        walkthrough: null,
      });
    }

    // Use fresh user data for the rest of the logic
    const user = freshUser;

    // Get personalized walkthrough content with user's first name
    const firstName = user.firstName || 'there';
    const walkthrough = getPersonalizedWalkthrough(user.role, firstName);
    const totalSteps = getTotalStepsForRole(user.role);
    
    // Get personalized current step if in walkthrough
    const rawStep = user.walkthroughStep > 0 ? getWalkthroughStep(user.role, user.walkthroughStep) : null;
    const currentStep = rawStep ? {
      ...rawStep,
      description: personalizeContent(rawStep.description, firstName),
      action: personalizeContent(rawStep.action, firstName),
      encouragement: rawStep.encouragement ? personalizeContent(rawStep.encouragement, firstName) : undefined,
    } : null;

    res.json({
      walkthroughCompleted: user.walkthroughCompleted,
      walkthroughStep: user.walkthroughStep,
      walkthroughStartedAt: user.walkthroughStartedAt,
      totalSteps,
      role: user.role,
      firstName,
      walkthrough: walkthrough ? {
        roleName: walkthrough.roleName,
        welcomeMessage: walkthrough.welcomeMessage,
        completionMessage: walkthrough.completionMessage,
        currentStep,
      } : null,
    });
  } catch (error: any) {
    console.error("Walkthrough status error:", error.message);
    res.status(500).json({ error: "Failed to get walkthrough status" });
  }
});

// Start walkthrough for user
router.post("/ai/walkthrough/start", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify user has an organization
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const firstName = req.user.firstName || 'there';
    const walkthrough = getPersonalizedWalkthrough(req.user.role, firstName);
    if (!walkthrough) {
      return res.status(400).json({ error: "No walkthrough available for this role" });
    }

    await db.update(users)
      .set({
        walkthroughStep: 1,
        walkthroughStartedAt: new Date(),
        walkthroughCompleted: false,
      })
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    const firstStep = walkthrough.steps[0] || null;

    res.json({
      success: true,
      currentStep: 1,
      totalSteps: walkthrough.steps.length,
      welcomeMessage: walkthrough.welcomeMessage,
      step: firstStep,
      firstName,
    });
  } catch (error: any) {
    console.error("Walkthrough start error:", error.message);
    res.status(500).json({ error: "Failed to start walkthrough" });
  }
});

// Advance walkthrough to next step
router.post("/ai/walkthrough/next", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify user has an organization
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const [user] = await db.select({
      walkthroughStep: users.walkthroughStep,
      role: users.role,
      firstName: users.firstName,
    }).from(users).where(and(
      eq(users.id, req.user.id),
      eq(users.organizationId, req.user.organizationId)
    ));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const firstName = user.firstName || 'there';
    const totalSteps = getTotalStepsForRole(user.role);
    const nextStep = user.walkthroughStep + 1;

    if (nextStep > totalSteps) {
      // Complete the walkthrough
      await db.update(users)
        .set({
          walkthroughCompleted: true,
          walkthroughStep: totalSteps,
        })
        .where(and(
          eq(users.id, req.user.id),
          eq(users.organizationId, req.user.organizationId)
        ));

      const walkthrough = getPersonalizedWalkthrough(user.role, firstName);

      res.json({
        success: true,
        completed: true,
        completionMessage: walkthrough?.completionMessage || `Congratulations, ${firstName}! You've completed the walkthrough!`,
        firstName,
      });
    } else {
      await db.update(users)
        .set({ walkthroughStep: nextStep })
        .where(and(
          eq(users.id, req.user.id),
          eq(users.organizationId, req.user.organizationId)
        ));

      // Get personalized step content
      const rawStep = getWalkthroughStep(user.role, nextStep);
      const stepContent = rawStep ? {
        ...rawStep,
        description: personalizeContent(rawStep.description, firstName),
        action: personalizeContent(rawStep.action, firstName),
        encouragement: rawStep.encouragement ? personalizeContent(rawStep.encouragement, firstName) : undefined,
      } : null;

      res.json({
        success: true,
        completed: false,
        currentStep: nextStep,
        totalSteps,
        step: stepContent,
        firstName,
      });
    }
  } catch (error: any) {
    console.error("Walkthrough next error:", error.message);
    res.status(500).json({ error: "Failed to advance walkthrough" });
  }
});

// Skip/complete walkthrough
router.post("/ai/walkthrough/complete", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify user has an organization
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const totalSteps = getTotalStepsForRole(req.user.role);

    await db.update(users)
      .set({
        walkthroughCompleted: true,
        walkthroughStep: totalSteps,
      })
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    res.json({
      success: true,
      message: "Walkthrough completed",
    });
  } catch (error: any) {
    console.error("Walkthrough complete error:", error.message);
    res.status(500).json({ error: "Failed to complete walkthrough" });
  }
});

// Reset walkthrough (for testing or retaking)
router.post("/ai/walkthrough/reset", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify user has an organization
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    await db.update(users)
      .set({
        walkthroughCompleted: false,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
      })
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    res.json({
      success: true,
      message: "Walkthrough reset",
    });
  } catch (error: any) {
    console.error("Walkthrough reset error:", error.message);
    res.status(500).json({ error: "Failed to reset walkthrough" });
  }
});

// Update walkthrough step progress (for tour system persistence)
router.patch("/ai/walkthrough/step", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const { step, completed } = req.body;

    if (typeof step !== 'number' || step < 0) {
      return res.status(400).json({ error: "Valid step number is required" });
    }

    const updateData: Record<string, any> = {
      walkthroughStep: step,
    };

    if (typeof completed === 'boolean') {
      updateData.walkthroughCompleted = completed;
    }

    if (step === 1 && !completed) {
      updateData.walkthroughStartedAt = new Date();
    }

    await db.update(users)
      .set(updateData)
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    res.json({
      success: true,
      step,
      completed: updateData.walkthroughCompleted ?? false,
    });
  } catch (error: any) {
    console.error("Walkthrough step update error:", error.message);
    res.status(500).json({ error: "Failed to update walkthrough step" });
  }
});

// AI Assistant Chat endpoint - with walkthrough mode support
router.post("/ai/assistant/chat", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { message, currentPath, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    // Check if user is in walkthrough mode
    const [userStatus] = await db.select({
      walkthroughCompleted: users.walkthroughCompleted,
      walkthroughStep: users.walkthroughStep,
      role: users.role,
      firstName: users.firstName,
    }).from(users).where(eq(users.id, req.user.id));

    const isInWalkthrough = userStatus && !userStatus.walkthroughCompleted && userStatus.walkthroughStep > 0;

    // Build context based on current page
    const pageContext = getPageContext(currentPath || '/dashboard');
    const userRole = req.user.role;
    const userName = `${req.user.firstName} ${req.user.lastName}`;
    const userFirstName = userStatus?.firstName || req.user.firstName || 'there';

    let systemPrompt: string;

    if (isInWalkthrough) {
      // Use walkthrough-specific prompt with personalization
      const walkthroughPrompt = generateWalkthroughPrompt(userStatus.role, userStatus.walkthroughStep, userFirstName);
      const totalSteps = getTotalStepsForRole(userStatus.role);
      
      systemPrompt = `${walkthroughPrompt}

## Current Context
- User: ${userName} (call them "${userFirstName}")
- Role: ${userRole}
- ${pageContext}
- Walkthrough Progress: Step ${userStatus.walkthroughStep} of ${totalSteps}

When ${userFirstName} says they've completed the current step or wants to continue, congratulate them with enthusiasm and remind them to click "Next Step" to proceed. Use their first name naturally to keep it personal. Be supportive and encouraging throughout their learning journey!`;
    } else {
      // Normal help mode
      systemPrompt = `${AI_ASSISTANT_SYSTEM_PROMPT}

## Current Context
- User: ${userName}
- Role: ${userRole}
- ${pageContext}

Tailor your responses to the user's role and current location in the app.`;
    }

    // Build messages array with conversation history
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history (limit to last 10 messages for context window)
    const recentHistory = conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 1000,
    });

    const response = completion.choices[0]?.message?.content;

    if (!response) {
      throw new Error('No response from AI');
    }
    res.json({ 
      response,
      isWalkthroughMode: isInWalkthrough,
      walkthroughStep: isInWalkthrough ? userStatus.walkthroughStep : null,
      usage: {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
      }
    });
  } catch (error: any) {
    console.error("AI Assistant chat error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to get AI response. Please try again." });
  }
});

// ============================
// AI MODULE ANALYSIS ENDPOINTS
// ============================

import { 
  analyzeSchedulingModule,
  analyzeDelaysModule,
  analyzeCostsModule,
  analyzeEquipmentModule,
  analyzeVendorPricingModule,
  analyzeProjectHealthModule,
  runComprehensiveAnalysis,
  saveAnalysisResults,
} from "./ai/moduleAnalyzers";
import { aiInsights, aiGanttRecommendations, aiVendorComparisons } from "@shared/schema";

const aiAnalysisSchema = z.object({
  module: z.enum(['SCHEDULING', 'DELAYS', 'COSTS', 'EQUIPMENT', 'VENDOR_PRICING', 'PROJECT_HEALTH', 'ALL']).optional(),
  projectId: z.string().optional(),
  saveResults: z.boolean().optional().default(true),
});

router.post("/ai-analyze", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const validationResult = aiAnalysisSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid request", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { module, projectId, saveResults } = validationResult.data;
    const organizationId = req.user.organizationId;

    console.log(`🔬 [AI Analysis] User ${req.user.email} triggered ${module || 'ALL'} analysis`);

    let result;
    
    if (module === 'ALL' || !module) {
      result = await runComprehensiveAnalysis(organizationId || undefined, projectId);
    } else {
      switch (module) {
        case 'SCHEDULING':
          result = await analyzeSchedulingModule(projectId, organizationId || undefined);
          break;
        case 'DELAYS':
          result = await analyzeDelaysModule(projectId, organizationId || undefined);
          break;
        case 'COSTS':
          result = await analyzeCostsModule(projectId, organizationId || undefined);
          break;
        case 'EQUIPMENT':
          result = await analyzeEquipmentModule(organizationId || undefined);
          break;
        case 'VENDOR_PRICING':
          result = await analyzeVendorPricingModule(organizationId || undefined);
          break;
        case 'PROJECT_HEALTH':
          if (!projectId) {
            return res.status(400).json({ error: "Project ID required for project health analysis" });
          }
          result = await analyzeProjectHealthModule(projectId);
          break;
        default:
          return res.status(400).json({ error: "Invalid module" });
      }
    }

    let savedInsightIds: string[] = [];
    if (saveResults && result.insights.length > 0) {
      savedInsightIds = await saveAnalysisResults(
        result,
        organizationId || undefined,
        projectId,
        req.user.id
      );
    }

    await logCreate(req.user.id, 'AI_ANALYSIS', savedInsightIds[0] || 'batch', { module: module || 'ALL', insightCount: result.insights.length, savedInsightIds }, req);

    res.json({
      success: true,
      module: module || 'ALL',
      insights: result.insights,
      ganttRecommendations: result.ganttRecommendations,
      vendorComparisons: result.vendorComparisons,
      savedInsightIds,
    });
  } catch (error: any) {
    console.error("AI analysis error:", error);
    res.status(500).json({ error: "Failed to run AI analysis" });
  }
});

router.get("/ai-insights/dashboard-summary", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const organizationId = req.user.organizationId;

    const conditions: any[] = [
      eq(aiInsights.isAcknowledged, false),
      sql`(${aiInsights.expiresAt} IS NULL OR ${aiInsights.expiresAt} > NOW())`,
    ];

    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(
        sql`(${aiInsights.organizationId} = ${organizationId} OR ${aiInsights.organizationId} IS NULL)`
      );
    }

    const recentInsights = await db
      .select({
        id: aiInsights.id,
        module: aiInsights.module,
        severity: aiInsights.severity,
        title: aiInsights.title,
        summary: aiInsights.summary,
        estimatedImpact: aiInsights.estimatedImpact,
        isAcknowledged: aiInsights.isAcknowledged,
        createdAt: aiInsights.createdAt,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .orderBy(desc(aiInsights.createdAt))
      .limit(10);

    const countBySeverity = await db
      .select({
        severity: aiInsights.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .groupBy(aiInsights.severity);

    const countByModule = await db
      .select({
        module: aiInsights.module,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .groupBy(aiInsights.module);

    res.json({
      recentInsights,
      countBySeverity: Object.fromEntries(countBySeverity.map(c => [c.severity, c.count])),
      countByModule: Object.fromEntries(countByModule.map(c => [c.module, c.count])),
      totalUnacknowledged: countBySeverity.reduce((sum, c) => sum + c.count, 0),
    });
  } catch (error: any) {
    console.error("Error fetching AI dashboard summary:", error);
    res.status(500).json({ error: "Failed to fetch AI dashboard summary" });
  }
});

router.get("/ai-insights", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { module, projectId, severity, acknowledged } = req.query;
    const organizationId = req.user.organizationId;

    const conditions: any[] = [];
    
    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(
        sql`(${aiInsights.organizationId} = ${organizationId} OR ${aiInsights.organizationId} IS NULL)`
      );
    }

    if (module) {
      conditions.push(eq(aiInsights.module, module as any));
    }

    if (projectId) {
      conditions.push(eq(aiInsights.projectId, projectId as string));
    }

    if (severity) {
      conditions.push(eq(aiInsights.severity, severity as any));
    }

    if (acknowledged !== undefined) {
      conditions.push(eq(aiInsights.isAcknowledged, acknowledged === 'true'));
    }

    conditions.push(
      sql`(${aiInsights.expiresAt} IS NULL OR ${aiInsights.expiresAt} > NOW())`
    );

    const insights = await db
      .select()
      .from(aiInsights)
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(aiInsights.createdAt))
      .limit(100);

    const parsedInsights = insights.map(insight => ({
      ...insight,
      metrics: insight.metrics ? JSON.parse(insight.metrics) : null,
      affectedEntities: insight.affectedEntities ? JSON.parse(insight.affectedEntities) : null,
      actionItems: insight.actionItems ? JSON.parse(insight.actionItems) : null,
    }));

    res.json(parsedInsights);
  } catch (error: any) {
    console.error("Error fetching AI insights:", error);
    res.status(500).json({ error: "Failed to fetch AI insights" });
  }
});

router.get("/ai-insights/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const [insight] = await db
      .select()
      .from(aiInsights)
      .where(eq(aiInsights.id, id))
      .limit(1);

    if (!insight) {
      return res.status(404).json({ error: "Insight not found" });
    }

    if (req.user.role !== 'SUPER_ADMIN' && 
        insight.organizationId && 
        insight.organizationId !== req.user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const parsedInsight = {
      ...insight,
      metrics: insight.metrics ? JSON.parse(insight.metrics) : null,
      affectedEntities: insight.affectedEntities ? JSON.parse(insight.affectedEntities) : null,
      actionItems: insight.actionItems ? JSON.parse(insight.actionItems) : null,
    };

    res.json(parsedInsight);
  } catch (error: any) {
    console.error("Error fetching AI insight:", error);
    res.status(500).json({ error: "Failed to fetch AI insight" });
  }
});

router.patch("/ai-insights/:id/acknowledge", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const [insight] = await db
      .select()
      .from(aiInsights)
      .where(eq(aiInsights.id, id))
      .limit(1);

    if (!insight) {
      return res.status(404).json({ error: "Insight not found" });
    }

    if (req.user.role !== 'SUPER_ADMIN' && 
        insight.organizationId && 
        insight.organizationId !== req.user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [updated] = await db
      .update(aiInsights)
      .set({
        isAcknowledged: true,
        acknowledgedById: req.user.id,
        acknowledgedAt: new Date(),
      })
      .where(eq(aiInsights.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error("Error acknowledging AI insight:", error);
    res.status(500).json({ error: "Failed to acknowledge insight" });
  }
});

router.get("/ai-gantt-recommendations/:projectId", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { projectId } = req.params;

    const recommendations = await db
      .select()
      .from(aiGanttRecommendations)
      .where(eq(aiGanttRecommendations.projectId, projectId))
      .orderBy(desc(aiGanttRecommendations.createdAt))
      .limit(20);

    const parsedRecommendations = recommendations.map(rec => ({
      ...rec,
      suggestedTasks: rec.suggestedTasks ? JSON.parse(rec.suggestedTasks) : null,
      suggestedDependencies: rec.suggestedDependencies ? JSON.parse(rec.suggestedDependencies) : null,
    }));

    res.json(parsedRecommendations);
  } catch (error: any) {
    console.error("Error fetching Gantt recommendations:", error);
    res.status(500).json({ error: "Failed to fetch Gantt recommendations" });
  }
});

router.get("/ai-vendor-comparisons", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const organizationId = req.user.organizationId;
    const { category } = req.query;

    const conditions: any[] = [];
    
    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(eq(aiVendorComparisons.organizationId, organizationId));
    }

    if (category) {
      conditions.push(eq(aiVendorComparisons.materialCategory, category as string));
    }

    const comparisons = await db
      .select()
      .from(aiVendorComparisons)
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(aiVendorComparisons.createdAt))
      .limit(50);

    const parsedComparisons = comparisons.map(comp => ({
      ...comp,
      analysisData: comp.analysisData ? JSON.parse(comp.analysisData) : null,
    }));

    res.json(parsedComparisons);
  } catch (error: any) {
    console.error("Error fetching vendor comparisons:", error);
    res.status(500).json({ error: "Failed to fetch vendor comparisons" });
  }
});

// ==========================================
// TRADE DISCOVERY & SCOPE PREDICTION ROUTES
// ==========================================

import { 
  discoverTradesFromDescription, 
  suggestTradesForBidDocument,
  getTradesWithSowCounts,
  getTradeModifierCategories,
  TRADE_CATEGORIES,
  ALL_TRADES
} from "./ai/tradeDiscoveryService";

import {
  predictRelevantScopeItems,
  searchScopeItems,
  getScopeItemsForTrade,
  suggestScopeFromBidDocument,
  getModifiersForScopeItem
} from "./ai/scopePredictionEngine";

// Get all available trades with their SOW item counts
router.get("/ai/trades", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const tradesWithCounts = await getTradesWithSowCounts();
    
    res.json({
      trades: tradesWithCounts,
      categories: TRADE_CATEGORIES,
      allTrades: ALL_TRADES,
    });
  } catch (error: any) {
    logError(`[AI Trades] Error fetching trades: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

// AI-powered trade discovery from project description
router.post("/ai/trades/discover", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { projectName, projectDescription, projectType, existingScope, bidDocumentExtracts } = req.body;

    if (!projectDescription && !bidDocumentExtracts?.length) {
      return res.status(400).json({ error: "Project description or bid document extracts required" });
    }

    const result = await discoverTradesFromDescription({
      projectName,
      projectDescription,
      projectType,
      existingScope,
      bidDocumentExtracts,
    });

    logInfo(`[AI Trades] Trade discovery completed for user ${req.user.id} | primaryTrade: ${result.primaryTrade} | relatedTrades: ${result.relatedTrades.length}`);

    res.json(result);
  } catch (error: any) {
    logError(`[AI Trades] Trade discovery error: ${error.message}`);
    res.status(500).json({ error: "Failed to discover trades" });
  }
});

// AI-powered scope prediction
router.post("/ai/scope/predict", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { tradeType, projectDescription, projectType, estimatedValue, existingScopeItems, relatedTrades, limit } = req.body;

    if (!tradeType) {
      return res.status(400).json({ error: "Trade type is required" });
    }

    const result = await predictRelevantScopeItems({
      tradeType,
      projectDescription,
      projectType,
      estimatedValue,
      existingScopeItems,
      relatedTrades,
    }, limit || 20);

    logInfo(`[AI Scope] Scope prediction completed for user ${req.user.id} | trade: ${tradeType} | items: ${result.predictedItems.length} | completeness: ${result.completenessScore}`);

    res.json(result);
  } catch (error: any) {
    logError(`[AI Scope] Scope prediction error: ${error.message}`);
    res.status(500).json({ error: "Failed to predict scope items" });
  }
});

// Search scope items across master and organization items
router.get("/ai/scope/search", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { q, trades, limit } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: "Search query is required" });
    }

    const tradeTypes = trades ? (trades as string).split(',') : undefined;
    const searchLimit = limit ? parseInt(limit as string, 10) : 50;

    const result = await searchScopeItems(
      q,
      tradeTypes,
      req.user.organizationId || undefined,
      searchLimit
    );

    res.json(result);
  } catch (error: any) {
    logError(`[AI Scope] Scope search error: ${error.message}`);
    res.status(500).json({ error: "Failed to search scope items" });
  }
});

// Get scope items for a specific trade
router.get("/ai/scope/trade/:tradeType", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { tradeType } = req.params;

    const items = await getScopeItemsForTrade(
      tradeType,
      req.user.organizationId || undefined
    );

    res.json({ items, count: items.length });
  } catch (error: any) {
    logError(`[AI Scope] Error fetching trade scope items: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch scope items for trade" });
  }
});

// Get modifiers for a trade
router.get("/ai/scope/modifiers/:tradeType", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { tradeType } = req.params;
    const { categoryId } = req.query;

    const modifiers = await getModifiersForScopeItem(
      tradeType,
      categoryId as string | undefined
    );

    res.json({ modifiers });
  } catch (error: any) {
    logError(`[AI Scope] Error fetching modifiers: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch modifiers" });
  }
});

// Get modifier categories for multiple trades
router.post("/ai/trades/modifiers", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { tradeTypes } = req.body;

    if (!tradeTypes || !Array.isArray(tradeTypes)) {
      return res.status(400).json({ error: "Trade types array is required" });
    }

    const result = await getTradeModifierCategories(tradeTypes);

    res.json(result);
  } catch (error: any) {
    logError(`[AI Scope] Error fetching trade modifiers: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch trade modifiers" });
  }
});

// AI-powered scope suggestion from bid document
router.post("/ai/scope/from-document", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { documentText, tradeType, limit } = req.body;

    if (!documentText || !tradeType) {
      return res.status(400).json({ error: "Document text and trade type are required" });
    }

    const result = await suggestScopeFromBidDocument(
      documentText,
      tradeType,
      limit || 30
    );

    logInfo(`[AI Scope] Scope from document completed for user ${req.user.id} | trade: ${tradeType} | items: ${result.predictedItems.length}`);

    res.json(result);
  } catch (error: any) {
    logError(`[AI Scope] Scope from document error: ${error.message}`);
    res.status(500).json({ error: "Failed to suggest scope from document" });
  }
});

export default router;
