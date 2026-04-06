import { Router , NextFunction } from "express";
import { db, pool } from "./db";
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
import { openai, AI_MODEL_GPT5, AI_MODEL_GPT4O } from "./ai/openaiClient";
import { AI_ASSISTANT_SYSTEM_PROMPT, getPageContext } from "./ai/assistantPrompt";
import { getTotalStepsForRole, generateWalkthroughPrompt } from "./ai/walkthroughContent";
import { analyzeSchedulingModule, analyzeDelaysModule, analyzeCostsModule, analyzeEquipmentModule, analyzeVendorPricingModule, analyzeProjectHealthModule, runComprehensiveAnalysis, saveAnalysisResults } from "./ai/moduleAnalyzers";
import { governedAiCall } from "./services/aiGovernance";

import aiDocumentRoutes from "./aiDocumentRoutes";
import aiSchedulingRoutes from "./aiSchedulingRoutes";
import aiTakeoffFeatureRoutes from "./aiTakeoffFeatureRoutes";
import aiCfoAnalyticsRoutes from "./aiCfoAnalyticsRoutes";

const router = Router();

router.use(aiDocumentRoutes);
router.use(aiSchedulingRoutes);
router.use(aiTakeoffFeatureRoutes);
router.use(aiCfoAnalyticsRoutes);

// ========================================
// Routes from aiRoutes.ts
// ========================================

router.use("/ai-settings", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai-pm", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai-analyze", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai/assistant", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai/ask-database", requireAuth, requireFeaturePermission('canUseAiFeatures'));

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
      } catch (err) {
        logError("Failed to record AI decision log:", {}, err instanceof Error ? err : new Error(String(err)));
      }
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

// ========================================
// Ask Database - Natural Language Data Queries
// ========================================

const DATABASE_SCHEMA_DESCRIPTION = `
You have access to a PostgreSQL database for a construction management platform. Here are the key tables and their columns:

-- Organizations
organizations(id, name, slug, trade_type, trade_name, region, address, city, state, zip_code, phone, email, is_active, created_at)

-- Users (employees)
users(id, organization_id, first_name, last_name, email, phone, role, is_active, cost_rate_regular, cost_rate_overtime, trade_specialization, employment_type, created_at)
-- role values: ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE

-- Projects
projects(id, name, code, client_name, status, location_address, city, state, start_date, end_date, estimated_completion_date, description, budget, contract_amount, budget_amount, gc_organization_id, created_at)
-- status values: PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED

-- Bids
bids(id, name, code, client_name, bid_amount, due_date, location_address, city, state, description, status, gc_organization_id, ai_win_probability, awarded_at, submitted_at, created_at)
-- status values: DRAFT, SUBMITTED, WON, LOST, CANCELLED

-- Time Entries
time_entries(id, user_id, project_id, date, hours_regular, hours_overtime, cost_code, notes, approval_status, created_at)

-- Tasks
tasks(id, project_id, title, description, status, priority, assigned_to_id, due_date, completed_at, created_at)

-- Change Orders
change_orders(id, project_id, title, description, amount, status, created_at)
-- status values: DRAFT, SUBMITTED, APPROVED, REJECTED

-- Invoices
invoices(id, project_id, invoice_number, amount, status, due_date, paid_at, created_at)

-- Procurement Items
procurement_items(id, project_id, description, vendor, quantity, unit, unit_cost, status, po_number, needed_by_date, created_at)

-- Equipment
equipment(id, organization_id, name, type, status, daily_rate, current_project_id, created_at)

-- Daily Reports
daily_reports(id, project_id, report_date, weather, crew_size, work_performed, safety_incidents, created_at)

-- Inspections
project_inspections(id, project_id, type, status, scheduled_date, completed_date, result, inspector_name, notes, created_at)
`;

const ASK_DATABASE_SYSTEM_PROMPT = `You are a SQL query generator for a construction management database. Given a natural language question, generate a safe, read-only PostgreSQL SELECT query.

CRITICAL RULES:
1. ONLY generate SELECT statements. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, or any other modifying statement.
2. Do NOT include any organization filter or WHERE clause for organization_id/gc_organization_id — the system automatically applies organization scoping. Just query the tables directly.
3. LIMIT results to at most 50 rows.
4. Use clear column aliases for readability.
5. Do not access system tables, pg_catalog, information_schema, or any administrative tables.
6. Do not use subqueries that could modify data.
7. Do not use functions like pg_sleep, pg_terminate_backend, or any administrative functions.
8. NEVER use UNION, EXCEPT, INTERSECT, WITH, or OR.
9. Do NOT use any parameter placeholders ($1, $2, etc.). The system handles parameterization.
10. Use AND for all conditions. Use IN(...) instead of OR for multiple value checks.
11. Do NOT use subqueries (nested SELECT statements). Use JOINs instead.
12. Do NOT use schema-qualified table names (e.g., public.users). Just use the table name directly.
13. Use only simple string values in single quotes. Do not use double quotes or backticks for identifiers.

${DATABASE_SCHEMA_DESCRIPTION}

Respond with a JSON object containing:
{
  "sql": "the SELECT query without any organization filter (it is applied automatically)",
  "explanation": "brief explanation of what the query does",
  "needsOrgFilter": true
}

If the question cannot be answered with the available tables, respond with:
{
  "sql": null,
  "explanation": "explanation of why it cannot be answered",
  "needsOrgFilter": false
}`;

const ANSWER_SYSTEM_PROMPT = `You are a helpful data analyst for a construction management platform. Given a user's question and the query results, provide a clear, concise natural language answer. Format numbers nicely (currency with $, percentages with %). If the results are empty, say so clearly. Keep answers brief but informative. Do not mention SQL queries or technical database details - just answer the question naturally as if you looked up the information.`;

const ALLOWED_TABLES = new Set([
  'organizations', 'users', 'projects', 'bids', 'time_entries', 'tasks',
  'change_orders', 'invoices', 'procurement_items', 'equipment',
  'daily_reports', 'project_inspections',
]);

const ORG_FILTER_COLUMN: Record<string, string> = {
  organizations: 'id',
  users: 'organization_id',
  projects: 'gc_organization_id',
  bids: 'gc_organization_id',
  equipment: 'organization_id',
};

const TABLES_NEEDING_DIRECT_ORG_FILTER = new Set(Object.keys(ORG_FILTER_COLUMN));

const TABLES_ORG_VIA_PROJECT_JOIN = new Set([
  'time_entries', 'tasks', 'change_orders', 'invoices',
  'procurement_items', 'daily_reports', 'project_inspections',
]);

const SENSITIVE_COLUMNS = new Set([
  'password_hash', 'token_version', 'oauth_provider_id', 'failed_login_attempts',
  'locked_until', 'oauth_provider', 'email_verified',
]);

const MAX_RESULT_ROWS = 50;

function extractAllTableReferences(sqlQuery: string): string[] {
  const lower = sqlQuery.toLowerCase();
  const found = new Set<string>();

  const fromJoinMatches = lower.match(/\b(?:from|join)\s+(\w+)/gi) || [];
  for (const m of fromJoinMatches) {
    found.add(m.replace(/^(?:from|join)\s+/i, '').trim());
  }

  const commaFromMatch = lower.match(/\bfrom\s+([\w\s,]+?)(?:\bwhere\b|\bjoin\b|\bgroup\b|\border\b|\blimit\b|\bhaving\b|$)/gi);
  if (commaFromMatch) {
    for (const clause of commaFromMatch) {
      const afterFrom = clause.replace(/^from\s+/i, '').replace(/\b(where|join|group|order|limit|having)\b.*$/i, '');
      const parts = afterFrom.split(',');
      for (const part of parts) {
        const tableName = part.trim().split(/\s+/)[0];
        if (tableName && /^\w+$/.test(tableName)) {
          found.add(tableName);
        }
      }
    }
  }

  for (const table of ALLOWED_TABLES) {
    const tablePattern = new RegExp(`\\b${table}\\b`, 'i');
    if (tablePattern.test(sqlQuery)) {
      found.add(table);
    }
  }

  const selectKeywords = new Set(['select', 'from', 'where', 'join', 'inner', 'left', 'right', 'outer',
    'on', 'and', 'as', 'count', 'sum', 'avg', 'min', 'max', 'group', 'by', 'order', 'asc', 'desc',
    'limit', 'distinct', 'case', 'when', 'then', 'else', 'end', 'not', 'null', 'is', 'in', 'between',
    'like', 'ilike', 'having', 'cast', 'coalesce', 'true', 'false', 'date', 'timestamp', 'interval',
    'extract', 'now', 'current_date', 'current_timestamp', 'lower', 'upper', 'trim', 'length',
    'round', 'floor', 'ceil', 'abs', 'concat', 'substring', 'replace', 'to_char']);

  return Array.from(found).filter(t => !selectKeywords.has(t));
}

function validateSqlSafety(sqlQuery: string): { safe: boolean; reason?: string } {
  const normalized = sqlQuery.toUpperCase().replace(/\s+/g, ' ').trim();

  const dangerousPatterns = [
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|EXEC)\b/,
    /\b(INTO)\s+\w/,
    /\bPG_SLEEP\b/,
    /\bPG_TERMINATE\b/,
    /\bPG_CATALOG\b/,
    /\bINFORMATION_SCHEMA\b/,
    /\bCOPY\b/,
    /\bSET\s+(ROLE|SESSION)/,
    /\bPG_READ_FILE\b/,
    /\bLO_IMPORT\b/,
    /\bDBLINK\b/,
    /\bUNION\b/,
    /\bEXCEPT\b/,
    /\bINTERSECT\b/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(normalized)) {
      return { safe: false, reason: `Query contains forbidden pattern` };
    }
  }

  if (!normalized.startsWith('SELECT')) {
    return { safe: false, reason: 'Query must start with SELECT' };
  }

  if (sqlQuery.includes(';')) {
    return { safe: false, reason: 'Multiple statements not allowed' };
  }

  if (/\bOR\b/i.test(sqlQuery)) {
    return { safe: false, reason: 'OR clauses are not allowed' };
  }

  if (/\bWITH\b/i.test(sqlQuery)) {
    return { safe: false, reason: 'CTEs (WITH) are not allowed in inner queries' };
  }

  const selectCount = (normalized.match(/\bSELECT\b/g) || []).length;
  if (selectCount > 1) {
    return { safe: false, reason: 'Subqueries are not allowed' };
  }

  if (/\bpublic\./i.test(sqlQuery)) {
    return { safe: false, reason: 'Schema-qualified table names are not allowed' };
  }

  if (/["'`]/.test(sqlQuery.replace(/'[^']*'/g, ''))) {
    return { safe: false, reason: 'Quoted identifiers are not allowed' };
  }

  for (const col of SENSITIVE_COLUMNS) {
    if (sqlQuery.toLowerCase().includes(col)) {
      return { safe: false, reason: 'Query references sensitive columns' };
    }
  }

  if (sqlQuery.includes('$')) {
    return { safe: false, reason: 'Parameter placeholders are not allowed (org filter is applied automatically)' };
  }

  const tables = extractAllTableReferences(sqlQuery);
  if (tables.length === 0) {
    return { safe: false, reason: 'No tables referenced' };
  }

  for (const table of tables) {
    if (!ALLOWED_TABLES.has(table)) {
      return { safe: false, reason: `Table '${table}' is not accessible` };
    }
  }

  for (const table of tables) {
    if (!TABLES_NEEDING_DIRECT_ORG_FILTER.has(table) && !TABLES_ORG_VIA_PROJECT_JOIN.has(table)) {
      return { safe: false, reason: `Table '${table}' cannot be org-scoped` };
    }
  }

  return { safe: true };
}

function wrapWithOrgScope(sqlQuery: string, tables: string[]): string | null {
  const uniqueTables = Array.from(new Set(tables));
  const cteParts: string[] = [];

  for (const table of uniqueTables) {
    if (TABLES_NEEDING_DIRECT_ORG_FILTER.has(table)) {
      const col = ORG_FILTER_COLUMN[table];
      cteParts.push(`${table} AS (SELECT * FROM public.${table} WHERE ${col} = $1)`);
    } else if (TABLES_ORG_VIA_PROJECT_JOIN.has(table)) {
      cteParts.push(`${table} AS (SELECT t.* FROM public.${table} t INNER JOIN public.projects p ON t.project_id = p.id WHERE p.gc_organization_id = $1)`);
    }
  }

  if (cteParts.length === 0) {
    return null;
  }

  return `WITH ${cteParts.join(', ')} ${sqlQuery}`;
}

function enforceLimit(sqlQuery: string): string {
  const normalized = sqlQuery.toUpperCase().replace(/\s+/g, ' ').trim();
  if (normalized.includes('LIMIT')) {
    return sqlQuery.replace(/LIMIT\s+(\d+)/i, (_, n) => {
      const parsed = parseInt(n, 10);
      return `LIMIT ${Math.min(parsed, MAX_RESULT_ROWS)}`;
    });
  }
  return `${sqlQuery.replace(/;?\s*$/, '')} LIMIT ${MAX_RESULT_ROWS}`;
}

function stripSensitiveColumns(rows: Record<string, any>[]): Record<string, any>[] {
  return rows.map(row => {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!SENSITIVE_COLUMNS.has(key)) {
        clean[key] = value;
      }
    }
    return clean;
  });
}

router.post("/ai/ask-database", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { question, conversationHistory = [] } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: "Question is required", errorType: "validation_error" });
    }

    if (question.length > 500) {
      return res.status(400).json({ error: "Question is too long (max 500 characters)", errorType: "validation_error" });
    }

    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization context required", errorType: "validation_error" });
    }

    const sqlGenMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: ASK_DATABASE_SYSTEM_PROMPT },
    ];

    const recentHistory = conversationHistory.slice(-6);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        sqlGenMessages.push({ role: msg.role, content: msg.content });
      }
    }

    sqlGenMessages.push({ role: 'user', content: question });

    let sqlResult: { sql: string | null; explanation: string; needsOrgFilter: boolean };

    const governed = await governedAiCall({
      orgId: organizationId,
      userId: req.user!.id,
      actionType: "ask_database",
      inputRefs: { question: question.substring(0, 200) },
      fn: async () => {
        const c = await openai.chat.completions.create({
          model: AI_MODEL_GPT4O,
          messages: sqlGenMessages,
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 1000,
        });
        const content = c.choices[0]?.message?.content;
        if (!content) throw new Error('No response from AI');
        const parsed = JSON.parse(content);
        return { result: parsed, completion: c };
      },
    });

    if (governed.blocked) {
      return res.status(429).json({ error: governed.reason || "AI usage limit reached", errorType: "rate_limit" });
    }

    sqlResult = governed.result;

    if (!sqlResult.sql) {
      return res.json({
        answer: sqlResult.explanation || "I'm not able to answer that question with the available data.",
        queryExecuted: false,
      });
    }

    const safety = validateSqlSafety(sqlResult.sql);
    if (!safety.safe) {
      logError("Unsafe SQL blocked", { reason: safety.reason });
      return res.json({
        answer: "I wasn't able to generate a safe query for that question. Could you try rephrasing it?",
        queryExecuted: false,
      });
    }

    const tables = extractAllTableReferences(sqlResult.sql);
    const scopedSql = wrapWithOrgScope(sqlResult.sql, tables);
    if (!scopedSql) {
      return res.json({
        answer: "I wasn't able to safely scope that query to your organization. Could you try rephrasing?",
        queryExecuted: false,
      });
    }
    const limitedSql = enforceLimit(scopedSql);

    let queryResults: any[];
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query('SET LOCAL statement_timeout = 5000');
      const result = await client.query(limitedSql, [organizationId]);
      await client.query('COMMIT');
      queryResults = stripSensitiveColumns(result.rows || []);
    } catch (dbError: any) {
      await client.query('ROLLBACK').catch(() => {});
      logError("Ask database query execution error", {
        code: dbError?.code,
        message: dbError?.message,
        routine: dbError?.routine,
        question: question.substring(0, 200),
      });
      return res.status(400).json({
        error: "The query couldn't be run against your data. Try rephrasing your question or asking about different data.",
        errorType: "db_query_error",
      });
    } finally {
      client.release();
    }

    const answerGoverned = await governedAiCall({
      orgId: organizationId,
      userId: req.user!.id,
      actionType: "ask_database_answer",
      fn: async () => {
        const c = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: ANSWER_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Question: ${question}\n\nQuery results (${queryResults.length} rows):\n${JSON.stringify(queryResults.slice(0, MAX_RESULT_ROWS), null, 2)}`
            },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        });
        const r = c.choices[0]?.message?.content;
        return { result: r, completion: c };
      },
    });

    if (answerGoverned.blocked) {
      return res.status(429).json({ error: answerGoverned.reason || "AI usage limit reached", errorType: "rate_limit" });
    }

    res.json({
      answer: answerGoverned.result || "I found some results but had trouble formatting them.",
      queryExecuted: true,
      rowCount: queryResults.length,
    });
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logError("Ask database error", { type: err.name, message: err.message }, err);

    const lowerMsg = (err.message || "").toLowerCase();
    if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out") || lowerMsg.includes("etimedout")) {
      return res.status(503).json({ error: "The AI service timed out. Please try again in a moment.", errorType: "ai_timeout" });
    }
    if (lowerMsg.includes("rate limit") || lowerMsg.includes("rate_limit") || error?.status === 429) {
      return res.status(429).json({ error: "AI usage limit reached. Please try again later.", errorType: "rate_limit" });
    }
    if (err instanceof SyntaxError || lowerMsg.includes("json")) {
      return res.status(502).json({ error: "The AI returned an unexpected response. Please try rephrasing your question.", errorType: "parse_error" });
    }
    if (error?.status === 503 || error?.status === 502 || lowerMsg.includes("overloaded") || lowerMsg.includes("unavailable")) {
      return res.status(503).json({ error: "The AI service is temporarily unavailable. Please try again shortly.", errorType: "ai_unavailable" });
    }

    res.status(500).json({ error: "Something went wrong processing your question. Please try again.", errorType: "server_error" });
  }
});

export default router;
