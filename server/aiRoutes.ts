import { Router } from "express";
import { db } from "./db";
import { aiSettings, aiRuns, aiTasks, insertAISettingsSchema, organizations, users, tradeTemplates, organizationCalculators, organizationWorkTypes, tradeTypeEnum } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
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
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { fromZodError } from "zod-validation-error";
import { type AuthRequest } from "./auth";
import { openai } from "./ai/openaiClient";
import { AI_ASSISTANT_SYSTEM_PROMPT, getPageContext } from "./ai/assistantPrompt";
import { z } from "zod";
import { getWalkthroughForRole, getTotalStepsForRole, getWalkthroughStep, generateWalkthroughPrompt } from "./ai/walkthroughContent";

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
    .pipe(z.string().url().max(500).or(z.literal('')))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  suggestedCalculators: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
  })).max(20).optional().nullable(),
});

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

// AI Onboarding System Prompt - Enhanced with SOW suggestions and theme extraction
const ONBOARDING_SYSTEM_PROMPT = `You are an AI assistant helping new contractors set up their construction management platform. Your goal is to have a friendly, in-depth conversation to understand their business so we can configure the system perfectly for their needs, including pre-building their work type dropdowns and material calculators.

## Your Conversation Flow:
1. **Welcome & Trade** - Warmly greet them and ask what type of contracting work they specialize in
2. **Crew Size** - Ask about their typical crew size
3. **Region** - Ask what geographic area they primarily serve
4. **Work Types/SOW** - Based on their trade, suggest specific work types (scope of work items) they might perform. Present 5-8 common ones for their trade and ask them to confirm which they do, plus add any others
5. **Materials** - Based on their work types, suggest materials they likely use and ask them to confirm/add
6. **Website** - Ask if they have a company website - we can match their system's look to their brand
7. **Wrap Up** - Summarize everything and confirm they're ready to set up

## Work Type Suggestions by Trade:
When they identify their trade, suggest these common work types:

ROOFING: ["Shingle Tear-off & Replace", "New Construction Roofing", "Commercial Flat Roof", "Metal Roofing", "Roof Repairs", "Gutter Installation", "Skylight Installation", "Roof Inspection"]

ELECTRICAL: ["Residential Rough-in", "Commercial Wiring", "Panel Upgrade", "EV Charger Installation", "Lighting Installation", "Generator Installation", "Low Voltage/Data", "Service Upgrade"]

PLUMBING: ["New Construction Rough-in", "Fixture Installation", "Water Heater Install", "Drain Cleaning", "Repiping", "Gas Line Work", "Sewer Line Repair", "Backflow Testing"]

HVAC: ["AC Installation", "Furnace Installation", "Duct Installation", "HVAC Repair", "Mini-Split Installation", "Commercial HVAC", "Refrigeration", "Ventilation Systems"]

CONCRETE: ["Sidewalk - 4 inch", "Driveway - 6 inch", "Foundation Pour", "Stamped Concrete", "Curb & Gutter", "Retaining Walls", "Concrete Repairs", "Commercial Flatwork"]

CARPENTRY: ["Framing - Walls", "Framing - Roof", "Finish Carpentry", "Cabinet Installation", "Deck Building", "Door/Window Installation", "Trim Work", "Custom Millwork"]

GENERAL_CONTRACTOR: ["Project Management", "General Construction", "Renovation", "Tenant Improvement", "New Build Coordination", "Site Supervision"]

## Material Calculator Suggestions:
For each work type they select, suggest relevant calculators:
- Roofing: Square footage to shingle bundles, underlayment rolls, nails
- Concrete: Volume calculator (L×W×D), bags per cubic yard, rebar spacing
- Electrical: Wire length by run, outlets per circuit, panel sizing
- Plumbing: Pipe length, fitting counts, fixture rough-in materials
- HVAC: Duct sizing, refrigerant amounts, BTU calculations

## Trade Types to Identify:
ROOFING, ELECTRICAL, PLUMBING, HVAC, CARPENTRY, CONCRETE, MASONRY, DRYWALL, PAINTING, FLOORING, LANDSCAPING, EXCAVATION, DEMOLITION, STEEL_ERECTION, GLAZING, INSULATION, FIRE_PROTECTION, WATERPROOFING, GENERAL_CONTRACTOR, OTHER

## Response Format:
Always respond with valid JSON in this exact format:
{
  "message": "Your conversational response to the user",
  "extractedData": {
    "tradeType": "ROOFING" or null if not yet determined,
    "tradeName": "Custom trade description" or null,
    "crewSize": 5 or null if not yet determined,
    "region": "Dallas, TX area" or null if not yet determined,
    "materials": ["shingles", "underlayment"] or null if not yet determined,
    "workTypes": ["Shingle Tear-off & Replace", "Roof Repairs"] or null,
    "websiteUrl": "https://example.com" or null if not provided,
    "suggestedCalculators": [
      {"name": "Shingle Calculator", "description": "Calculate bundles needed from square footage"}
    ] or null
  },
  "suggestions": {
    "workTypes": ["Shingle Tear-off & Replace", "New Construction Roofing"] or null,
    "materials": ["Shingles", "Underlayment", "Nails"] or null
  },
  "isComplete": false,
  "step": 1
}

## Important Guidelines:
- Be conversational and friendly, not robotic
- Ask ONE question at a time - don't overwhelm them
- When suggesting work types, present them as options they can select from
- Let them know they can also add custom work types not in your list
- For the website, explain we'll use it to match their system colors to their brand
- Set isComplete to true only when you have gathered all key information

Step progression: 1=trade, 2=crew, 3=region, 4=workTypes, 5=materials, 6=website, 7=confirmation`;

// Complete onboarding and save organization configuration
router.post("/ai/onboarding/complete", sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate and sanitize input
    const validationResult = onboardingCompleteSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { companyName, tradeType, tradeName, crewSize, region, materials, workTypes, websiteUrl, suggestedCalculators } = validationResult.data;

    // Prevent users who already have an organization from creating another
    if (req.user.organizationId) {
      return res.status(400).json({ error: "You already belong to an organization" });
    }

    // Generate a unique slug from sanitized company name
    const baseSlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    // Materials are already sanitized by Zod schema
    const sanitizedMaterials = materials || [];
    const sanitizedWorkTypes = workTypes || [];

    // Create the organization with website URL for theme extraction
    const [newOrg] = await db.insert(organizations).values({
      name: companyName,
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
        completedAt: new Date() 
      }),
    }).returning();

    // Update the user to belong to this organization
    await db.update(users)
      .set({ 
        organizationId: newOrg.id,
        role: 'ADMIN', // First user becomes admin
        isActive: true 
      })
      .where(eq(users.id, req.user.id));

    // Import organizationSowItems for saving work types
    const { organizationSowItems } = await import("@shared/schema");

    // Save user-selected work types as organization SOW items
    if (sanitizedWorkTypes.length > 0) {
      for (let i = 0; i < sanitizedWorkTypes.length; i++) {
        const wt = sanitizedWorkTypes[i];
        const code = wt.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
        await db.insert(organizationSowItems).values({
          organizationId: newOrg.id,
          categoryName: tradeName || tradeType,
          name: wt,
          code: `${code}_${i}`,
          displayOrder: i,
          isFromTemplate: false,
        }).onConflictDoNothing();
      }
    }

    // Copy trade template configurations to organization
    const [template] = await db.select().from(tradeTemplates).where(eq(tradeTemplates.tradeType, tradeType as any));
    
    if (template) {
      // Parse and create organization-specific work types from template
      try {
        const templateWorkTypes = JSON.parse(template.workTypesJson);
        for (const wt of templateWorkTypes) {
          // Only add if not already selected by user
          if (!sanitizedWorkTypes.some(sw => sw.toLowerCase() === wt.name.toLowerCase())) {
            await db.insert(organizationWorkTypes).values({
              organizationId: newOrg.id,
              name: wt.name,
              category: template.displayName,
              unit: wt.unit,
              defaultProductionRate: wt.rate ? String(wt.rate) : null,
            });
          }
        }
      } catch (e) {
        console.error("Error parsing work types:", e);
      }

      // Parse and create organization-specific calculators from template
      try {
        const calculators = JSON.parse(template.calculatorConfigJson);
        for (const calc of calculators) {
          await db.insert(organizationCalculators).values({
            organizationId: newOrg.id,
            name: calc.name,
            category: template.displayName,
            unit: calc.unit,
            formulaJson: JSON.stringify({ formula: calc.formula, inputs: calc.inputs }),
            inputFieldsJson: JSON.stringify(calc.inputs),
          });
        }
      } catch (e) {
        console.error("Error parsing calculators:", e);
      }
    }

    // Create calculators from AI suggestions if no template or additional ones suggested
    if (suggestedCalculators && suggestedCalculators.length > 0) {
      for (const calc of suggestedCalculators) {
        await db.insert(organizationCalculators).values({
          organizationId: newOrg.id,
          name: calc.name,
          category: tradeName || tradeType,
          unit: 'units',
          formulaJson: JSON.stringify({ formula: 'quantity * rate', description: calc.description }),
          inputFieldsJson: JSON.stringify([{ name: 'quantity', label: 'Quantity', type: 'number' }]),
        });
      }
    }

    // If website URL provided, trigger background theme extraction (async)
    if (websiteUrl) {
      extractThemeFromWebsite(newOrg.id, websiteUrl).catch(err => {
        console.error("Theme extraction failed:", err.message);
      });
    }

    res.json({ 
      success: true, 
      organization: newOrg,
      message: "Your account has been configured successfully!" 
    });
  } catch (error: any) {
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
        'User-Agent': 'TFR-Construction-Theme-Extractor/1.0',
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

    const { message, conversationHistory } = validationResult.data;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: ONBOARDING_SYSTEM_PROMPT }
    ];

    // Add sanitized conversation history
    for (const msg of conversationHistory.slice(-20)) {
      messages.push({ role: msg.role, content: msg.content });
    }

    messages.push({ role: 'user', content: message });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 500,
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

    // Verify user has an organization (defense-in-depth for multi-tenant isolation)
    if (!req.user.organizationId) {
      // Users without organizations should complete org onboarding first
      return res.json({
        walkthroughCompleted: true,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
        totalSteps: 0,
        role: req.user.role,
        walkthrough: null,
      });
    }

    const [user] = await db.select({
      walkthroughCompleted: users.walkthroughCompleted,
      walkthroughStep: users.walkthroughStep,
      walkthroughStartedAt: users.walkthroughStartedAt,
      role: users.role,
      organizationId: users.organizationId,
    }).from(users).where(and(
      eq(users.id, req.user.id),
      eq(users.organizationId, req.user.organizationId)
    ));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const walkthrough = getWalkthroughForRole(user.role);
    const totalSteps = getTotalStepsForRole(user.role);

    res.json({
      walkthroughCompleted: user.walkthroughCompleted,
      walkthroughStep: user.walkthroughStep,
      walkthroughStartedAt: user.walkthroughStartedAt,
      totalSteps,
      role: user.role,
      walkthrough: walkthrough ? {
        roleName: walkthrough.roleName,
        welcomeMessage: walkthrough.welcomeMessage,
        completionMessage: walkthrough.completionMessage,
        currentStep: user.walkthroughStep > 0 ? getWalkthroughStep(user.role, user.walkthroughStep) : null,
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

    const walkthrough = getWalkthroughForRole(req.user.role);
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

    const firstStep = getWalkthroughStep(req.user.role, 1);

    res.json({
      success: true,
      currentStep: 1,
      totalSteps: walkthrough.steps.length,
      welcomeMessage: walkthrough.welcomeMessage,
      step: firstStep,
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
    }).from(users).where(and(
      eq(users.id, req.user.id),
      eq(users.organizationId, req.user.organizationId)
    ));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

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

      const walkthrough = getWalkthroughForRole(user.role);

      res.json({
        success: true,
        completed: true,
        completionMessage: walkthrough?.completionMessage || "Congratulations! You've completed the walkthrough!",
      });
    } else {
      await db.update(users)
        .set({ walkthroughStep: nextStep })
        .where(and(
          eq(users.id, req.user.id),
          eq(users.organizationId, req.user.organizationId)
        ));

      const stepContent = getWalkthroughStep(user.role, nextStep);

      res.json({
        success: true,
        completed: false,
        currentStep: nextStep,
        totalSteps,
        step: stepContent,
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
    }).from(users).where(eq(users.id, req.user.id));

    const isInWalkthrough = userStatus && !userStatus.walkthroughCompleted && userStatus.walkthroughStep > 0;

    // Build context based on current page
    const pageContext = getPageContext(currentPath || '/dashboard');
    const userRole = req.user.role;
    const userName = `${req.user.firstName} ${req.user.lastName}`;

    let systemPrompt: string;

    if (isInWalkthrough) {
      // Use walkthrough-specific prompt
      const walkthroughPrompt = generateWalkthroughPrompt(userStatus.role, userStatus.walkthroughStep);
      const walkthrough = getWalkthroughForRole(userStatus.role);
      const totalSteps = getTotalStepsForRole(userStatus.role);
      
      systemPrompt = `${walkthroughPrompt}

## Current Context
- User: ${userName}
- Role: ${userRole}
- ${pageContext}
- Walkthrough Progress: Step ${userStatus.walkthroughStep} of ${totalSteps}

When the user says they've completed the current step or wants to continue, respond with enthusiasm and remind them to click "Next Step" to proceed. Be supportive and encouraging throughout their learning journey.`;
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

export default router;
