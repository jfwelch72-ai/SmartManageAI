import { Router , NextFunction } from "express";
import { db } from "./db";
import { aiSettings, aiRuns, aiTasks, insertAISettingsSchema, users } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { type AuthRequest, requireAuth, requireRole, requireFeaturePermission, requireAnyFeaturePermission } from "./auth";
import { sensitiveLimiter } from "./rateLimiter";
import { logUpdate, logCreate } from "./auditLogger";
import { sanitizeShortText } from "./sanitization";
import { logError } from "./utils/logger";
import { runAIAnalysis, getLatestAIRun, getAIRunById, getTasksForRole, updateTaskStatus } from "./ai/orchestrator";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { AI_ASSISTANT_SYSTEM_PROMPT, getPageContext } from "./ai/assistantPrompt";
import { getTotalStepsForRole, generateWalkthroughPrompt } from "./ai/walkthroughContent";
import { analyzeSchedulingModule, analyzeDelaysModule, analyzeCostsModule, analyzeEquipmentModule, analyzeVendorPricingModule, analyzeProjectHealthModule, runComprehensiveAnalysis, saveAnalysisResults } from "./ai/moduleAnalyzers";
import { governedAiCall } from "./services/aiGovernance";

const router = Router();

// ========================================
// Routes from aiRoutes.ts
// ========================================

router.use("/ai-settings", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai-pm", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai-analyze", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai/assistant", requireAuth, requireFeaturePermission('canUseAiFeatures'));

router.get("/ai-settings", requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    let [settings] = await db.select().from(aiSettings).limit(1);

    if (!settings) {
      [settings] = await db.insert(aiSettings).values({}).returning();
    }

    res.json(settings);
  } catch (error) {
  next(error);
  }
});

router.patch("/ai-settings", sensitiveLimiter, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const sanitizedInput = {
      ...req.body,
      dailyRunTime: req.body.dailyRunTime ? sanitizeShortText(req.body.dailyRunTime) : undefined,
      modelName: req.body.modelName ? sanitizeShortText(req.body.modelName) : undefined,
    };

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
  } catch (error) {
  next(error);
  }
});

router.post("/ai-pm/run", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (orgId) {
      const { checkOrgLimits } = await import("./services/aiGovernance");
      const limitCheck = await checkOrgLimits(orgId);
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: "AI rate limit reached", reason: limitCheck.reason });
      }
    }

    const runId = await runAIAnalysis(req.user!.id, orgId);

    if (orgId) {
      const { db: dbConn } = await import("./db");
      const { aiActionAudit } = await import("@shared/schema");
      try {
        await dbConn.insert(aiActionAudit).values({
          organizationId: orgId,
          actorUserId: req.user!.id,
          actionType: "ai_pm_analysis",
          model: AI_MODEL_GPT5,
          tokensIn: 0,
          tokensOut: 0,
          costEstimate: "0",
          inputRefs: { runId, triggeredBy: req.user!.id },
          outputRefs: { runId },
          rationale: null,
          approvalRequired: false,
          approvalStatus: null,
          durationMs: 0,
        });
      } catch (_) {}
    }

    await logCreate(
      req.user.id,
      'AI_RUN',
      runId,
      { runId, triggeredBy: req.user.id },
      req
    );

    res.json({ runId, status: 'completed' });
  } catch (error) {
  next(error);
  }
});

router.get("/ai-pm/latest-run", requireAuth, async (req: AuthRequest, res, next) => {
  try {
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
  } catch (error) {
  next(error);
  }
});

router.get("/ai-pm/runs/:runId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
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
  } catch (error) {
  next(error);
  }
});

router.get("/ai-pm/tasks", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { role, status } = req.query;

    const userRole = role ? String(role) : req.user.role;
    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(userRole, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error) {
  next(error);
  }
});

router.get("/ai-pm/tasks/role/:role", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { role } = req.params;
    const { status } = req.query;

    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(role, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error) {
  next(error);
  }
});

router.patch("/ai-pm/tasks/:taskId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

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
  } catch (error) {
  next(error);
  }
});


router.get("/ai-pm/runs", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const runs = await db
      .select()
      .from(aiRuns)
      .orderBy(desc(aiRuns.createdAt))
      .limit(50);

    res.json(runs);
  } catch (error) {
  next(error);
  }
});

router.post("/ai/assistant/chat", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { message, currentPath, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    const [userStatus] = await db.select({
      walkthroughCompleted: users.walkthroughCompleted,
      walkthroughStep: users.walkthroughStep,
      role: users.role,
      firstName: users.firstName,
    }).from(users).where(eq(users.id, req.user.id));

    const isInWalkthrough = userStatus && !userStatus.walkthroughCompleted && userStatus.walkthroughStep > 0;

    const pageContext = getPageContext(currentPath || '/dashboard');
    const userRole = req.user.role;
    const userName = `${req.user.firstName} ${req.user.lastName}`;
    const userFirstName = userStatus?.firstName || req.user.firstName || 'there';

    let systemPrompt: string;

    if (isInWalkthrough) {
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
      systemPrompt = `${AI_ASSISTANT_SYSTEM_PROMPT}

## Current Context
- User: ${userName}
- Role: ${userRole}
- ${pageContext}

Tailor your responses to the user's role and current location in the app.`;
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    const recentHistory = conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    let completion: any;
    let response: string | null | undefined;

    if (req.user.organizationId) {
      let capturedCompletion: any;
      const governed = await governedAiCall({
        orgId: req.user.organizationId,
        userId: req.user.id,
        actionType: "assistant_chat",
        fn: async () => {
          const c = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.7,
            max_tokens: 1000,
          });
          capturedCompletion = c;
          const r = c.choices[0]?.message?.content;
          return { result: r, completion: c };
        },
      });

      if (governed.blocked) {
        return res.status(429).json({ error: governed.reason || "AI usage limit reached" });
      }

      response = governed.result;
      completion = capturedCompletion;
    } else {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      });
      response = completion.choices[0]?.message?.content;
    }

    if (!response) {
      throw new Error('No response from AI');
    }
    res.json({ 
      response,
      isWalkthroughMode: isInWalkthrough,
      walkthroughStep: isInWalkthrough ? userStatus.walkthroughStep : null,
      usage: {
        promptTokens: completion?.usage?.prompt_tokens,
        completionTokens: completion?.usage?.completion_tokens,
      }
    });
  } catch (error: any) {
    logError("AI Assistant chat error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to get AI response. Please try again." });
  }
});

const aiAnalysisSchema = z.object({
  module: z.enum(['SCHEDULING', 'DELAYS', 'COSTS', 'EQUIPMENT', 'VENDOR_PRICING', 'PROJECT_HEALTH', 'ALL']).optional(),
  projectId: z.string().optional(),
  saveResults: z.boolean().optional().default(true),
});

router.post("/ai-analyze", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const validationResult = aiAnalysisSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid request", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { module, projectId, saveResults } = validationResult.data;
    const organizationId = req.user.organizationId;

    console.log(`[AI Analysis] User ${req.user.email} triggered ${module || 'ALL'} analysis`);

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
    logError("AI analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to run AI analysis" });
  }
});

// ========================================
// Routes from aiFeatureRoutes.ts
// ========================================

/**
 * AI Feature Routes for 7 Major AI-Enhanced Features
 * Features A-G: Auto-Takeoff, Scheduling, Jobsite Analysis, Vendor Pricing,
 * Client Portal, Change Order Generator, Mobile/Offline
 */

// Trade-specific configurations for AI features
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

export default router;
