import { Router , NextFunction } from "express";
import { safeJsonParse } from "./responseHelper";
import { db, pool } from "./db";
import { aiSettings, aiRuns, aiTasks, insertAISettingsSchema, users } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { type AuthRequest, requireAuth, requireRole, requireFeaturePermission, requireAnyFeaturePermission } from "./auth";
import { sensitiveLimiter } from "./rateLimiter";
import { logUpdate, logCreate } from "./auditLogger";
import { sanitizeShortText } from "./sanitization";
import { logError, logWarn, logInfo } from "./utils/logger";
import { runAIAnalysis, getLatestAIRun, getAIRunById, getTasksForRole, updateTaskStatus } from "./ai/orchestrator";
import { openai, AI_MODEL_GPT5, AI_MODEL_GPT4O } from "./ai/openaiClient";
import { analyzeSchedulingModule, analyzeDelaysModule, analyzeCostsModule, analyzeEquipmentModule, analyzeVendorPricingModule, analyzeProjectHealthModule, runComprehensiveAnalysis, saveAnalysisResults } from "./ai/moduleAnalyzers";
import { governedAiCall } from "./services/aiGovernance";

import aiDocumentRoutes from "./aiDocumentRoutes";
import aiSchedulingRoutes from "./aiSchedulingRoutes";
import aiTakeoffFeatureRoutes from "./aiTakeoffFeatureRoutes";
import aiCfoAnalyticsRoutes from "./aiCfoAnalyticsRoutes";
import aiHeavyCivilFeatureRoutes from "./aiHeavyCivilFeatureRoutes";
import aiEstimatorRoutes from "./aiEstimatorRoutes";

const router = Router();

router.use(aiDocumentRoutes);
router.use(aiSchedulingRoutes);
router.use(aiTakeoffFeatureRoutes);
router.use(aiCfoAnalyticsRoutes);
router.use(aiHeavyCivilFeatureRoutes);
router.use(aiEstimatorRoutes);

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
      req.user!.id,
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
      req.user!.id,
      'AI_RUN',
      runId,
      { runId, triggeredBy: req.user!.id },
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
      snapshotData: safeJsonParse(run.snapshotData, null),
      profitabilityData: safeJsonParse(run.profitabilityData, null),
      aiResponse: safeJsonParse(run.aiResponse, null),
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
      snapshotData: safeJsonParse(run.snapshotData, null),
      profitabilityData: safeJsonParse(run.profitabilityData, null),
      aiResponse: safeJsonParse(run.aiResponse, null),
    };

    res.json(parsedRun);
  } catch (error) {
  next(error);
  }
});

router.get("/ai-pm/tasks", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { role, status } = req.query;

    const userRole = role ? String(role) : req.user!.role;
    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(userRole, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: safeJsonParse(task.metadata, null),
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
      metadata: safeJsonParse(task.metadata, null),
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

    await updateTaskStatus(req.params.taskId, status, req.user!.id);

    const [updatedTask] = await db
      .select()
      .from(aiTasks)
      .where(eq(aiTasks.id, req.params.taskId))
      .limit(1);

    await logUpdate(
      req.user!.id,
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

const DATA_QUERY_PATTERNS = [
  /how many/i, /what(?:'s| is| are) (?:the |our |my )?(?:total|count|number|sum|average)/i,
  /show (?:me |all |the )?(?:overdue|active|pending|open|completed|recent)/i,
  /list (?:all |the |my |our )?/i,
  /(?:total|sum|count|average|avg) (?:of |for )?(?:projects|bids|tasks|employees|contracts|invoices|equipment|change orders|delays)/i,
  /(?:projects|bids|tasks|employees|contracts|invoices|equipment|change orders|delays)[\s\S]*(?:total|count|value|amount|status|overdue|active|pending)/i,
  /what(?:'s| is| are) (?:the |our |my )?(?:.*?)(?:value|amount|cost|revenue|profit|budget)/i,
  /how much/i,
  /(?:on staff|in the system|in our database)/i,
  /(?:open|active|pending|overdue|completed|cancelled) (?:projects|bids|tasks|contracts|invoices|change orders|delays)/i,
];

function detectDataIntent(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (lower.startsWith("how do i") || lower.startsWith("how can i") || lower.startsWith("what is a ") || lower.startsWith("what are the steps") || lower.startsWith("help me") || lower.startsWith("explain")) {
    return false;
  }
  return DATA_QUERY_PATTERNS.some(pattern => pattern.test(message));
}

async function handleDataQuery(
  question: string,
  conversationHistory: { role: string; content: string }[],
  organizationId: number,
  userId: number,
): Promise<{ answer: string; queryExecuted: boolean }> {
  const sqlGenMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: ASK_DATABASE_SYSTEM_PROMPT },
  ];

  const recentHistory = conversationHistory.slice(-6);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      sqlGenMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }
  }

  sqlGenMessages.push({ role: 'user', content: question });

  let sqlResult!: { sql: string | null; explanation: string; needsOrgFilter: boolean };

  const MAX_RETRIES = 2;
  let lastSafetyReason: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0 && lastSafetyReason) {
      sqlGenMessages.push({
        role: 'user',
        content: `Your previous query was rejected because: ${lastSafetyReason}. Please regenerate a valid query. IMPORTANT FORMATTING RULES:
- Output ONLY the JSON object, no markdown code fences.
- Do NOT use double-quoted identifiers (e.g. "projects") — use bare names: projects
- Do NOT use backtick-quoted identifiers.
- Do NOT use schema-qualified names like public.projects.
- Do NOT use subqueries, CTEs, UNION, parameter placeholders ($1), or semicolons.
- Use only a single SELECT statement with JOINs if needed.

Example of a correct response:
{"sql": "SELECT COUNT(*) AS total FROM projects WHERE status = 'ACTIVE'", "explanation": "Counts active projects", "needsOrgFilter": true}`,
      });
    }

    const governed = await governedAiCall({
      orgId: organizationId,
      userId,
      actionType: "ask_database",
      inputRefs: { question: question.substring(0, 200) },
      fn: async () => {
        const c = await openai.chat.completions.create({
          model: AI_MODEL_GPT4O,
          messages: sqlGenMessages,
          response_format: { type: 'json_object' },
          max_completion_tokens: 1000,
        });
        const content = c.choices[0]?.message?.content;
        if (!content) throw new Error('No response from AI');
        const parsed = JSON.parse(content);
        return { result: parsed, completion: c };
      },
    });

    if (governed.blocked) {
      throw new Error("AI usage limit reached");
    }

    sqlResult = governed.result;

    if (!sqlResult.sql) {
      return {
        answer: sqlResult.explanation || "I'm not able to answer that question with the available data.",
        queryExecuted: false,
      };
    }

    sqlResult.sql = normalizeSqlFromAI(sqlResult.sql);

    const safety = validateSqlSafety(sqlResult.sql);
    if (safety.safe) {
      break;
    }

    lastSafetyReason = safety.reason;

    if (attempt === MAX_RETRIES) {
      return {
        answer: "I wasn't able to generate a safe query for that question. Could you try rephrasing it?",
        queryExecuted: false,
      };
    }
  }

  const tables = extractAllTableReferences(sqlResult.sql);
  const scopedSql = wrapWithOrgScope(sqlResult.sql, tables);
  if (!scopedSql) {
    return {
      answer: "I wasn't able to safely scope that query to your organization. Could you try rephrasing?",
      queryExecuted: false,
    };
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
    throw dbError;
  } finally {
    client.release();
  }

  const answerGoverned = await governedAiCall({
    orgId: organizationId,
    userId,
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
        max_completion_tokens: 1000,
      });
      const r = c.choices[0]?.message?.content;
      return { result: r, completion: c };
    },
  });

  if (answerGoverned.blocked) {
    throw new Error("AI usage limit reached");
  }

  return {
    answer: answerGoverned.result || "I found some results but had trouble formatting them.",
    queryExecuted: true,
  };
}

router.post("/ai/assistant/chat", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    const organizationId = req.user?.organizationId;
    const isDataQuery = organizationId && detectDataIntent(message);

    if (isDataQuery) {
      try {
        const dataResponse = await handleDataQuery(message, conversationHistory, organizationId, req.user!.id);
        return res.json({
          response: dataResponse.answer,
          responseType: "data",
        });
      } catch (dataError: any) {
        logWarn("Data query routing failed", { error: dataError?.message });
        return res.json({
          response: "I wasn't able to retrieve that data right now. Please try rephrasing your question or try again shortly.",
          responseType: "data",
        });
      }
    }

    res.json({
      response: "I'm designed to help you query your data. Try asking questions like \"How many active projects do we have?\" or \"What's the total value of open bids?\" and I'll look that up for you.",
      responseType: "data",
    });
  } catch (error: any) {
    next(error);
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
    const organizationId = req.user!.organizationId;

    logInfo(`[AI Analysis] User ${req.user!.email} triggered ${module || 'ALL'} analysis`);

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
        req.user!.id
      );
    }

    await logCreate(req.user!.id, 'AI_ANALYSIS', savedInsightIds[0] || 'batch', { module: module || 'ALL', insightCount: result.insights.length, savedInsightIds }, req);

    res.json({
      success: true,
      module: module || 'ALL',
      insights: result.insights,
      ganttRecommendations: result.ganttRecommendations,
      vendorComparisons: result.vendorComparisons,
      savedInsightIds,
    });
  } catch (error: any) {
    next(error);
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
You have access to a PostgreSQL database for a construction management platform.

=== TABLE DIRECTORY (find the right tables by domain) ===
CORE: organizations, users, projects, bids, tasks
MESSAGING & COMMUNICATION: conversations, conversation_participants, messages, message_reactions, message_read_receipts, message_entity_links, video_calls, video_call_participants, call_notes
FINANCE: invoices, estimates, estimate_line_items, change_orders, change_order_items, change_order_revisions, receipts, cost_codes, cost_transactions, budget_alerts, forecast_adjustments
WORKFORCE: time_entries, weekly_payroll_reports, pay_runs, pay_run_line_items, shift_assignments, leave_requests, osha_incidents
CRM: crm_organisations, crm_contacts, crm_opportunities, crm_organisation_notes, crm_opportunity_activities
PROCUREMENT: purchase_requests, purchase_orders, purchase_order_line_items, vendor_invoices, vendor_invoice_line_items
CONTRACTS & BILLING: contracts, contract_line_items, subcontracts, sov_items, pay_applications, pay_application_items, aia_billing_periods, aia_billing_items
EQUIPMENT: equipment, equipment_assignments, equipment_maintenance_records
DOCUMENTS: drawing_sets, document_revisions, transmittals, transmittal_items, rfis, submittals
SCHEDULING: schedule_activities, schedule_dependencies, schedule_baselines
HIRING: job_postings, hiring_candidates, hiring_interviews, hiring_tasks
DAILY REPORTS: daily_reports, daily_scope_progress, project_inspections
SAFETY & QUALITY: safety_observations, safety_trainings, quality_issues, punch_list_items
KPIs: kpi_templates, kpi_assignments, kpi_entries
=== END TABLE DIRECTORY ===

Here are the key tables and their columns:

-- Organizations
organizations(id, name, slug, trade_type, trade_name, region, address, city, state, zip_code, phone, email, is_active, created_at)

-- Users (employees)
users(id, organization_id, first_name, last_name, email, phone, role, is_active, cost_rate_regular, cost_rate_overtime, trade_specialization, employment_type, created_at)
-- role values: ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER, HUSTLER, VENDOR

-- Projects
projects(id, name, code, client_name, status, location_address, city, state, start_date, end_date, estimated_completion_date, description, budget, contract_amount, budget_amount, gc_organization_id, created_at)
-- status values: BID, PLANNING, ACTIVE, COMPLETE, CLOSED

-- Bids
bids(id, name, code, client_name, bid_amount, due_date, location_address, city, state, description, status, gc_organization_id, ai_win_probability, awarded_at, submitted_at, created_at)
-- status values: DRAFT, ACTIVE, SUBMITTED, AWARDED, LOST, CANCELLED

-- Time Entries
time_entries(id, user_id, project_id, date, hours_regular, hours_overtime, cost_code, notes, approval_status, created_at)

-- Tasks
tasks(id, organization_id, project_id, title, description, category, priority, status, source_type, assigned_to_id, due_date, completed_at, created_at)
-- status values: PENDING, IN_PROGRESS, COMPLETED, DISMISSED
-- priority values: LOW, MEDIUM, HIGH, CRITICAL
-- source_type values: MANUAL, AI_GENERATED, EMAIL_DERIVED, SYSTEM

-- Task Subtasks (checklist items within a task)
task_subtasks(id, task_id, title, completed, created_by_id, created_at)

-- Task Comments
task_comments(id, task_id, content, created_by_id, created_at)

-- Task Attachments
task_attachments(id, task_id, file_name, file_url, file_size, mime_type, uploaded_by_id, created_at)

-- Change Orders
change_orders(id, project_id, change_order_number, description, amount, status, requested_by_id, submitted_at, approved_by_id, approved_at, created_at)
-- status values: DRAFT, PENDING_APPROVAL, SUBMITTED, APPROVED, REJECTED, PCO, PRICING_REVIEW, VOIDED

-- Change Order Revisions (audit trail of change order status changes)
change_order_revisions(id, change_order_id, revision_number, previous_status, new_status, amount, description, revised_by_id, created_at)

-- Invoices
invoices(id, project_id, invoice_number, amount, status, due_date, paid_at, created_at)

-- Procurement Items
procurement_items(id, project_id, description, vendor, quantity, unit, unit_cost, status, po_number, needed_by_date, created_at)

-- Equipment (tools, vehicles, heavy equipment)
equipment(id, organization_id, name, equipment_code, type, status, make, model, year, serial_number, current_hours, purchase_date, purchase_price, assigned_to_crew_id, assigned_to_project_id, last_maintenance_date, next_maintenance_date, home_location, current_location, created_at)
-- status values: AVAILABLE, ASSIGNED, IN_REPAIR, OUT_OF_SERVICE, RETIRED
-- type values: HEAVY_EQUIPMENT, VEHICLE, POWER_TOOL, HAND_TOOL, SAFETY_EQUIPMENT, etc.

-- Equipment Assignments (tracks which equipment is assigned to which project)
equipment_assignments(id, equipment_id, project_id, assigned_by_id, assigned_at, expected_return_date, returned_at, returned_by_id, hours_at_assignment, hours_at_return, created_at)

-- Daily Reports
daily_reports(id, project_id, report_date, weather, crew_size, work_performed, safety_incidents, created_at)

-- Inspections
project_inspections(id, project_id, type, status, scheduled_date, completed_date, result, inspector_name, notes, created_at)

-- Estimates
estimates(id, bid_id, project_id, version_number, status, base_bid_amount, notes, created_by_id, created_at)
-- status values: DRAFT, SUBMITTED, WON, LOST, PENDING_APPROVAL, APPROVED, REJECTED

-- Estimate Line Items (individual cost items within an estimate)
estimate_line_items(id, estimate_id, category, description, quantity, unit, material_cost, labor_hours, labor_cost, equipment_hours, equipment_cost, subcontractor_cost, total_cost, created_at)
-- category values: LABOR, MATERIAL, EQUIPMENT, SUBCONTRACTOR, OVERHEAD, OTHER

-- Receipts (expense receipts)
receipts(id, project_id, user_id, date, vendor, amount, category, notes, cost_code, created_at)

-- Scope Items (project scope line items for billing/tracking)
scope_items(id, project_id, description, unit, total_quantity, completed_quantity, billed_quantity, unit_price, billing_status, created_at)
-- billing_status values: NOT_READY, READY, BILLED

-- Daily Scope Progress (tracks daily completion of scope items)
daily_scope_progress(id, scope_item_id, project_id, work_date, quantity_completed, billed_quantity, billing_status, labor_hours, labor_cost, crew_size, material_cost, equipment_hours, equipment_cost, notes, created_by_id, created_at)

-- Weekly Payroll Reports
weekly_payroll_reports(id, organization_id, week_start_date, week_end_date, total_regular_hours, total_overtime_hours, total_employees, generated_at, created_at)

-- Pay Runs
pay_runs(id, organization_id, pay_period_start, pay_period_end, run_number, status, total_regular_hours, total_overtime_hours, total_labor_cost, total_gross_amount, total_deductions, total_net_amount, total_workers, notes, created_at)
-- status values: DRAFT, PENDING_APPROVAL, APPROVED, PROCESSING, COMPLETED, CANCELLED

-- Pay Run Line Items (individual worker pay details per pay run)
pay_run_line_items(id, pay_run_id, user_id, project_id, cost_code, regular_hours, overtime_hours, regular_rate, overtime_rate, total_amount, gross_amount, total_deductions, net_amount, created_at)

-- Purchase Requests
purchase_requests(id, org_id, project_id, requested_by_id, pr_number, title, status, needed_by_date, notes, total_estimated_cost, approved_by_id, approved_at, created_at)
-- status values: DRAFT, PENDING, APPROVED, REJECTED, CANCELLED

-- Purchase Orders
purchase_orders(id, org_id, project_id, pr_id, vendor_id, po_number, status, terms, delivery_address, needed_by_date, notes, total_cost, approved_by_id, approved_at, created_at)
-- status values: DRAFT, PENDING, APPROVED, SENT, PARTIAL, RECEIVED, CANCELLED

-- Vendor Invoices
vendor_invoices(id, org_id, po_id, vendor_id, invoice_number, invoice_date, due_date, total_amount, status, notes, created_at)
-- status values: PENDING, APPROVED, REJECTED, PAID

-- Contracts
contracts(id, organization_id, project_id, bid_id, contract_number, contract_type, status, contract_value, effective_date, expiration_date, payment_terms, retention_percent, scope_summary, created_at)
-- contract_type values: PRIME, SUBCONTRACT, PURCHASE_ORDER, SERVICE_AGREEMENT
-- status values: DRAFT, IN_REVIEW, REDLINED, PENDING_APPROVAL, APPROVED, EXECUTED, AMENDED

-- Project Notes
project_notes(id, project_id, author_id, note_type, text, created_at)
-- note_type values: GENERAL, SAFETY, QUALITY, WEATHER, DELAY, CLIENT

-- OSHA Incidents
osha_incidents(id, organization_id, case_number, project_id, employee_name, date_of_injury, event_description, injury_illness_type, body_part_affected, treatment_type, classification, is_recordable, days_away_from_work, days_of_restricted_duty, created_at)

-- Leave Requests
leave_requests(id, employee_id, organization_id, leave_type_id, start_date, end_date, reason, status, reviewer_id, reviewed_at, created_at)
-- status values: PENDING, APPROVED, REJECTED, CANCELLED

-- CRM Organisations (vendors, subcontractors, suppliers, clients)
crm_organisations(id, organization_id, type, name, address, city, state, zip_code, website, trade_specialty, crm_status, is_active, created_at)
-- type values: SUBCONTRACTOR, SUPPLIER, CLIENT, OWNER_REP, ARCHITECT, ENGINEER, EQUIPMENT_RENTAL, OTHER

-- CRM Contacts
crm_contacts(id, organization_id, organisation_id, first_name, last_name, title, role, email, phone, is_primary, is_active, created_at)
-- role values: OWNER, PROJECT_MANAGER, ESTIMATOR, SUPERINTENDENT, ACCOUNTS_PAYABLE, ACCOUNTS_RECEIVABLE, SAFETY_OFFICER, OTHER

-- CRM Opportunities (sales pipeline / deals)
crm_opportunities(id, organization_id, name, stage, deal_value, probability, crm_organisation_id, assigned_to_id, project_type, expected_close_date, source, created_at)
-- stage values: LEAD, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST

-- CRM Organisation Notes
crm_organisation_notes(id, organization_id, organisation_id, contact_id, note_type, content, created_by_id, created_at)
-- note_type values: GENERAL, CALL, EMAIL, MEETING, SITE_VISIT, ISSUE, FOLLOW_UP, OTHER

-- CRM Opportunity Activities (sales activity log)
crm_opportunity_activities(id, opportunity_id, activity_type, description, scheduled_at, completed_at, created_by_id, created_at)
-- activity_type values: CALL, EMAIL, MEETING, NOTE, TASK, SITE_VISIT, PROPOSAL_SENT, FOLLOW_UP

-- Drawing Sets
drawing_sets(id, project_id, organization_id, name, description, is_primary, created_at)

-- Bid Subcontractor Quotes
bid_subcontractor_quotes(id, bid_id, project_id, subcontractor_name, scope_of_work, quote_amount, lead_time, contact_name, contact_email, contact_phone, is_selected, created_at)

-- Bid Material Quotes
bid_material_quotes(id, bid_id, project_id, material_name, description, specs, cost, lead_time, supplier_name, supplier_contact, is_selected, created_at)

-- Conversations (messaging channels: direct messages, group chats, project channels)
conversations(id, organization_id, type, name, description, is_company_channel, channel_slug, topic, project_id, crew_id, rfi_id, change_order_id, task_id, is_archived, created_by_id, created_at)
-- type values: DIRECT, GROUP, COMPANY
-- Can be linked to a project, crew, RFI, change order, or task

-- Conversation Participants (who is in each conversation)
conversation_participants(id, conversation_id, user_id, joined_at, last_read_at, is_admin)

-- Messages (chat messages within conversations)
messages(id, conversation_id, sender_id, content, attachment_url, attachment_name, attachment_type, attachment_size, voice_url, voice_duration_seconds, is_edited, edited_at, is_deleted, is_field_note, created_at)

-- Message Reactions (emoji reactions on messages)
message_reactions(id, message_id, user_id, emoji, created_at)

-- Message Read Receipts (tracks who read each message)
message_read_receipts(id, message_id, user_id, read_at)

-- Message Entity Links (links messages to tasks, projects, etc.)
message_entity_links(id, message_id, entity_type, entity_id, created_at)

-- Video Calls (video/audio calls within conversations)
video_calls(id, conversation_id, initiator_id, status, started_at, ended_at)
-- status values: RINGING, ACTIVE, ENDED, MISSED

-- Video Call Participants
video_call_participants(id, call_id, user_id, joined_at, left_at)

-- Video Call Notes
video_call_notes(id, call_id, author_id, content, created_at)

-- Crews (work crews / teams)
crews(id, organization_id, name, description, lead_id, is_active, created_at)
-- lead_id references users.id (the crew foreman/lead)

-- Crew Members (junction: users assigned to crews)
crew_members(id, crew_id, user_id, role, added_at)

-- Crew Project Assignments (which crew is assigned to which project)
crew_project_assignments(id, crew_id, project_id, start_date, end_date, assigned_by_id, notes, created_at)

-- Skills (trade skills library)
skills(id, name, category, description, created_at)

-- User Skills (junction: skills assigned to users with proficiency)
user_skills(id, user_id, skill_id, proficiency_level, star_rating, years_experience, verification_status, verified_by_user_id, verified_at, added_at)
-- verification_status values: unverified, pending, verified

-- User Certifications (licenses, certifications, training records)
user_certifications(id, user_id, organization_id, certification_name, issued_date, expiry_date, file_url, file_name, status, created_at)
-- status values: active, expired, revoked

-- User Equipment Competencies (what equipment a user is qualified to operate)
user_equipment_competencies(id, user_id, organization_id, equipment_name, created_at)

-- Subcontractor Contracts (contracts with subcontractors, linked to crm_organisations)
subcontractor_contracts(id, subcontractor_id, project_id, contract_number, scope_of_work, contract_amount, start_date, completion_date, status, payment_terms, retention_percent, cost_code, created_at)
-- status values: PENDING, ACTIVE, COMPLETED, CANCELLED
-- subcontractor_id references crm_organisations.id

-- Subcontractor Payments (payment tracking for subcontractor contracts)
subcontractor_payments(id, organization_id, contract_id, payment_number, amount, retention_held, payment_date, status, approved_by_id, approved_at, payment_method, created_at)
-- status values: PENDING, APPROVED, PAID, REJECTED

-- RFIs (Requests for Information)
rfis(id, organization_id, project_id, contract_id, rfi_number, subject, question, status, priority, category, submitted_by_id, assigned_to_id, date_submitted, date_required, date_answered, answered_by_id, answer, cost_impact, schedule_impact, created_at)
-- status values: DRAFT, OPEN, ANSWERED, CLOSED
-- priority values: LOW, MEDIUM, HIGH, URGENT

-- Punch List Items (deficiency items to resolve before project closeout)
punch_list_items(id, project_id, item_number, title, description, location, trade, priority, status, assigned_to_user_id, assigned_to_name, due_date, inspection_id, resolved_at, verified_at, verified_by_id, created_by_id, created_at)
-- status values: OPEN, IN_PROGRESS, RESOLVED, VERIFIED, CLOSED
-- priority values: LOW, MEDIUM, HIGH, CRITICAL
-- trade values: GENERAL, ELECTRICAL, PLUMBING, HVAC, CONCRETE, CARPENTRY, etc.

-- Calendar Events
calendar_events(id, event_type, title, description, start_date, end_date, all_day, user_id, project_id, crm_organisation_id, created_by_id, created_at)
-- event_type values: MEETING, INSPECTION, DEADLINE, MILESTONE, REMINDER, OTHER

-- Notifications
notifications(id, user_id, organization_id, type, title, message, is_read, related_entity_id, related_entity_type, created_at)

-- Time Clock Shifts (GPS-tracked clock in/out)
time_clock_shifts(id, user_id, project_id, clock_in, clock_out, clock_in_latitude, clock_in_longitude, clock_out_latitude, clock_out_longitude, cost_code, notes, approval_status, approved_by_id, total_hours, created_at)
-- approval_status values: PENDING, APPROVED, REJECTED

-- Overtime Requests
overtime_requests(id, shift_id, user_id, organization_id, requested_hours, approved_hours, superintendent_id, status, notes, rejection_reason, approved_at, created_at)
-- status values: PENDING, APPROVED, REJECTED

-- Budget Line Items (cost code budgets per project)
budget_line_items(id, project_id, cost_code, description, division, labor_budget, material_budget, subcontractor_budget, equipment_budget, other_budget, total_budget, created_at)

-- Warranty Cases (post-completion warranty claims)
warranty_cases(id, project_id, case_number, type, status, priority, title, description, location, reported_by_name, assigned_to_user_id, reported_date, target_resolution_date, resolved_at, estimated_cost, actual_cost, root_cause, resolution, created_by_id, created_at)
-- type values: DEFECT, CALLBACK, MAINTENANCE, DAMAGE
-- status values: OPEN, IN_PROGRESS, ON_HOLD, RESOLVED, CLOSED

-- Warranty Tasks (action items for warranty cases)
warranty_tasks(id, case_id, project_id, title, description, status, assigned_to_user_id, due_date, completed_at, estimated_hours, actual_hours, created_by_id, created_at)
-- status values: PENDING, IN_PROGRESS, COMPLETED, CANCELLED

-- Lien Waivers
lien_waivers(id, organization_id, project_id, waiver_type, status, recipient_name, recipient_company, through_date, amount, notes, document_url, sent_at, received_at, approved_by_id, created_at)
-- waiver_type values: CONDITIONAL_PROGRESS, UNCONDITIONAL_PROGRESS, CONDITIONAL_FINAL, UNCONDITIONAL_FINAL
-- status values: PENDING, SENT, RECEIVED, APPROVED

-- Leave Types (PTO/leave type definitions)
leave_types(id, organization_id, name, annual_allowance, is_active, created_at)

-- T&M Tickets (time & material work tickets)
tm_tickets(id, project_id, ticket_number, work_date, scope_description, status, total_labor_hours, total_labor_cost, total_equipment_cost, total_material_cost, grand_total, billing_status, created_by_id, created_at)
-- status values: DRAFT, SUBMITTED, APPROVED, REJECTED

-- Audit Log (system audit trail)
audit_log(id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)

-- project addenda/amendments
addenda(id, organization_id, project_id, addendum_number, title, description, issued_date, issued_by_id, related_document_id, storage_key, file_url, file_name, status, created_at, updated_at)

-- addendum receipt confirmations
addendum_acknowledgments(id, addendum_id, recipient_type, recipient_id, recipient_name, recipient_email, sent_at, acknowledged_at, created_at)

-- salary category definitions
annual_salary_categories(id, organization_id, name, salary_type, effective_date, description, is_active, created_at, updated_at)

-- approval workflow requests
approval_requests(id, organization_id, entity_type, entity_id, requested_by_user_id, status, approver_user_id, approver_role, notes, decided_at, created_at, updated_at)

-- project closeout handover items
asset_handover_items(id, project_id, category, title, description, status, document_url, document_filename, completed_at, completed_by_id, sort_order, created_by_id, created_at, updated_at)

-- handover sign-off records
asset_handover_signoffs(id, project_id, role, signed_by_user_id, signed_by_name, signed_at, notes)

-- employee attendance records
attendance_logs(id, user_id, organization_id, date, status, notes, recorded_by, created_at)

-- bid document distribution tracking
bid_document_distributions(id, organization_id, bid_id, project_id, crm_organisation_id, contact_email, contact_name, document_type, document_id, document_title, status, sent_at, viewed_at, responded_at, response_notes, attachments_json, message_body, sent_by_id, sent_by_name)

-- documents attached to bids
bid_documents(id, bid_id, type, title, file_name, file_url, object_key, file_size, mime_type, uploaded_by_id, uploaded_at)

-- equipment selections for bids
bid_equipment_selections(id, bid_id, source, equipment_id, rental_catalog_id, rental_vendor_id, equipment_name, equipment_type, planned_days, start_date, end_date, notes, created_by_id, created_at, updated_at)

-- Q&A on subcontractor bid requests
bid_request_clarifications(id, bid_request_id, asked_by_organization_id, asked_by_user_id, question, question_asked_at, answer, answered_by_user_id, answered_at, is_public_to_all_invitees, created_at, updated_at)

-- scope item billing event log
billing_events(id, scope_item_id, description, created_by_id, created_at)

-- project budget threshold alerts
budget_alerts(id, project_id, alert_level, is_dismissed, dismissed_by, dismissed_at, created_at)

-- labor burden rate templates
burden_rates(id, organization_id, name, description, is_active, created_at, updated_at)

-- change order approval steps
change_order_approvals(id, change_order_id, approver_role, approver_id, status, step_order, comments, decided_at, created_at)

-- change order file attachments
change_order_attachments(id, change_order_id, organization_id, file_name, file_size, mime_type, storage_key, uploaded_by_id, uploaded_by_name, description, created_at)

-- change order discussion comments
change_order_comments(id, change_order_id, author_name, author_email, author_type, message, is_internal, created_at)

-- CO equipment line items
change_order_equipment_entries(id, change_order_id, equipment_type, description, quantity)

-- CO labor line items
change_order_labor_entries(id, change_order_id, employee_name, position)

-- CO material line items
change_order_material_entries(id, change_order_id, material_description, category, unit, vendor_pricing_id)

-- daily project notes by staff
company_daily_notes(id, author_id, project_id, text, created_at)

-- contract review/approval decisions
contract_approvals(id, contract_id, reviewer_id, decision, comments, decided_at, created_at)

-- reusable contract clause library
contract_clauses(id, organization_id, title, category, content, is_required, is_default, sort_order, created_by_id, created_at, updated_at)

-- contract redline/markup items
contract_redlines(id, contract_id, requested_by_id, description, section, status, resolution, resolved_by_id, resolved_at, created_at, updated_at)

-- AI contract risk analysis results
contract_risk_analyses(id, contract_id, organization_id, overall_risk_score, risk_level, summary_text, clause_analysis_json, missing_protections_json, recommendations_json, analyzed_by_id, analyzed_at)

-- contract document templates
contract_templates(id, organization_id, name, description, contract_type, clause_ids_json, default_payment_terms, default_insurance_requirements, is_active, created_by_id, created_at, updated_at)

-- contract version history snapshots
contract_versions(id, contract_id, version_number, snapshot_json, attachments_json, changed_by_id, change_note, created_at)

-- payroll cost postings to projects
cost_ledger_postings(id, pay_run_id, project_id, cost_code, posted_at, created_at)

-- unified cost transaction ledger
cost_transactions(id, project_id, cost_code, source_category, origin_module, transaction_date, reference_id, description, status, voided_at, voided_by, void_reason, created_by, created_at)

-- project delay claims
delay_claims(id, organization_id, project_id, claim_number, title, description, claim_type, status, linked_delay_ids, days_requested, days_approved, original_completion_date, requested_completion_date, cost_breakdown_json, supporting_doc_urls, weather_evidence_summary, submitted_at, submitted_by_id, reviewed_at, reviewed_by_id, review_notes, approved_at, approved_by_id, rejected_at, rejected_by_id, rejection_reason, linked_change_order_id, created_by_id, created_at, updated_at)

-- delay notification letters
delay_notifications(id, delay_id, recipient_type, recipient_name, recipient_company, recipient_email, subject, body, status, created_by_id, created_at, updated_at)

-- document version/revision tracking
document_revisions(id, organization_id, document_id, revision_number, source_type, supersedes_revision_id, status, storage_key, checksum, metadata, created_by_user_id, created_at)

-- formal document transmittals
document_transmittals(id, organization_id, project_id, transmittal_number, subject, description, status, sent_by_id, sent_by_name, date_sent, document_type, revision_number, previous_transmittal_id, attachments_json, recipient_subcontractor_ids, notes, created_at, updated_at)

-- individual sheets in drawing sets
drawing_set_items(id, drawing_set_id, sheet_id, revision_id, pinned_at)

-- connected email accounts
email_accounts(id, organization_id, user_id, provider, email_address, display_name, is_active, last_synced_at, last_sync_error, created_at, updated_at)

-- email message attachments
email_attachments(id, organization_id, email_message_id, filename, content_type, size_bytes, storage_key, created_at)

-- synced email messages
email_messages(id, organization_id, email_account_id, thread_id, external_id, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html, snippet, received_at, is_read, is_incoming, has_attachments, classification, ai_metadata, ai_analyzed_at, created_at, updated_at)

-- AI email digest summaries
email_summaries(id, organization_id, user_id, summary_type, period_start, period_end, summary_content, highlights_json, email_count, tasks_created, created_at)

-- tasks extracted from emails
email_tasks(id, organization_id, created_by_user_id, assigned_to_user_id, project_id, bid_id, vendor_id, email_thread_id, email_message_id, title, description, status, priority, due_date, source_type, ai_metadata, completed_at, completed_by_user_id, created_at, updated_at)

-- email conversation threads
email_threads(id, organization_id, email_account_id, subject, external_thread_id, project_id, bid_id, vendor_id, status, message_count, unread_count, last_message_at, ai_summary, primary_classification, ai_metadata, created_at, updated_at)

-- employee-to-classification assignments
employee_classifications(id, organization_id, user_id, classification_id, is_primary, effective_date, end_date, notes, created_at, updated_at)

-- employee cost/burden assignments
employee_cost_assignments(id, organization_id, user_id, salary_category_id, burden_rate_id, working_hours_per_year, effective_date, end_date, notes, created_at, updated_at)

-- employee payroll deduction assignments
employee_deductions(id, organization_id, user_id, deduction_type_id, effective_date, end_date, is_active, created_at, updated_at)

-- employee performance AI profiles
employee_performance_profiles(id, user_id, organization_id, experience_level, productivity_tendencies, past_projects, created_at, updated_at)

-- employee performance ratings
employee_ratings(id, organization_id, employee_id, evaluator_id, project_id, period, comments, created_at, updated_at)

-- equipment fuel usage logs
equipment_fuel_logs(id, equipment_id, project_id, date, fuel_type, submitted_by_id, notes, created_at, updated_at)

-- equipment operating hour logs
equipment_hour_logs(id, equipment_id, assignment_id, project_id, week_start_date, week_end_date, submitted_by_id, submitted_at, notes, created_at, updated_at)

-- equipment hour logging reminders
equipment_hour_reminders(id, equipment_id, assignment_id, project_id, manager_id, week_start_date, reminder_sent_at, is_completed, completed_at, created_at)

-- equipment marketplace listings
equipment_listings(id, organization_id, name, category, make_model, year, location, delivery_radius, photos, condition, available_from, available_to, is_ongoing, description, is_active, created_at, updated_at)

-- equipment maintenance records
equipment_maintenance_history(id, equipment_id, schedule_id, maintenance_type, description, performed_at, performed_by_id, performed_by_vendor, notes, parts_used, created_at)

-- scheduled maintenance plans
equipment_maintenance_schedules(id, equipment_id, maintenance_type, name, description, interval_hours, interval_days, last_performed_at, next_due_at, alert_days_before, alert_hours_before, is_active, created_at, updated_at)

-- equipment billing rate profiles
equipment_rate_profiles(id, equipment_id, includes_operator, effective_date, expiration_date, is_active, notes, created_by_id, created_at, updated_at)

-- equipment rental requests
equipment_rental_requests(id, listing_id, requester_org_id, start_date, end_date, delivery_requested, message, status, owner_response, created_at, updated_at)

-- equipment repair tracking
equipment_repairs(id, equipment_id, repair_number, description, status, problem_reported_at, problem_reported_by_id, problem_description, repair_location, repair_vendor_id, estimated_completion_date, started_at, completed_at, completed_by_id, repair_notes, parts_used, created_at, updated_at)

-- estimate change history snapshots
estimate_history(id, project_id, estimate_id, data, created_at)

-- subcontractor quotes on estimate lines
estimate_line_item_subcontractors(id, line_item_id, subcontractor_quote_id, is_selected, notes, created_at, updated_at)

-- vendor quotes attached to estimates
estimate_vendor_quotes(id, estimate_id, vendor_name, contact_info, scope_description, file_url, file_name, file_size, mime_type, linked_line_item_ids, created_at, updated_at)

-- estimate version snapshots
estimate_versions(id, estimate_id, version_number, snapshot, created_at)

-- budget forecast manual overrides
forecast_adjustments(id, project_id, note, updated_by, created_at, updated_at)

-- bid-to-project handoff information
handoff_packets(id, bid_id, project_id, gc_name, gc_contact_name, gc_phone, gc_email, access_details, scope_of_work_summary, bid_date, award_date, duration, project_start_date, project_completion_date, manpower, alternates, subcontract_executed, insurance_certs, bond_required, permits, payment_terms, schedule_of_values_ready, draw_schedule, prevailing_wage, concrete_supplier, mix_info, rebar_vendor, forming_material_plan, curing_specs, special_items, lead_time_risks, submittal_status, layout_survey_by, benchmark_info, access_zones, work_hours, safety_orientation, inspection_needs, coordination_issues, weather_risks, soil_conditions, estimator_notes, gc_contact_method, project_manager, superintendent, office_admin, safety_contact, created_by_id, created_at, updated_at)

-- candidate uploaded documents
hiring_candidate_documents(id, organization_id, candidate_id, file_name, file_size, mime_type, storage_key, uploaded_by_user_id, created_at)

-- notes on hiring candidates
hiring_candidate_notes(id, organization_id, candidate_id, author_user_id, author_name, body, is_internal, created_at)

-- job applicants/candidates
hiring_candidates(id, organization_id, job_id, external_provider, external_candidate_id, first_name, last_name, full_name, email, phone, city, state, source, current_stage, applied_at, reviewer_user_id, ai_score, ai_recommendation, status, raw_payload_json, resume_storage_key, application_answers_json, created_at, updated_at)

-- scheduled candidate interviews
hiring_interviews(id, organization_id, candidate_id, job_id, interview_type, start_at, end_at, timezone, location, video_link, interviewer_user_ids_json, status, notes, reminder_sent_at, created_by_user_id, updated_by_user_id, created_at, updated_at)

-- open job postings
hiring_jobs(id, organization_id, external_provider, external_job_id, title, department, trade, employment_type, location, compensation_type, description, requirements, preferred_qualifications, certifications_required, screening_questions_json, posting_destinations_json, internal_notes, status, assigned_owner_user_id, created_by_user_id, updated_by_user_id, published_at, archived_at, last_synced_at, created_at, updated_at)

-- hiring-related tasks
hiring_tasks(id, organization_id, candidate_id, job_id, title, description, assigned_user_id, due_date, completed_at, status, created_by_user_id, created_at, updated_at)

-- historical project cost reference data
historical_costs(id, organization_id, project_id, project_name, project_type, cost_code, scope_category, trade, description, unit, completed_date, source, created_at)

-- PO-to-invoice 3-way matching
invoice_matches(id, invoice_id, po_id, receipt_id, match_status, discrepancy_notes, resolved_by_id, resolved_at, created_at)

-- vendor invoice payment records
invoice_payments(id, org_id, invoice_id, payment_date, method, reference_number, notes, recorded_by_id, created_at)

-- field issue/defect captures with photos
issue_captures(id, organization_id, project_id, created_by_id, assigned_to_id, title, description, severity, status, photo_urls, photo_object_keys, location, latitude, longitude, trade_affected, category, resolution_notes, resolved_by_id, resolved_at, ai_analysis, ai_recommendations, created_at, updated_at)

-- trade/labor classification definitions
job_classifications(id, organization_id, name, code, description, is_active, sort_order, created_at, updated_at)

-- AI jobsite photo analysis batches
jobsite_analysis_batches(id, organization_id, project_id, analysis_date, trade_type, status, analysis_types, summary_json, safety_findings_json, progress_findings_json, material_findings_json, crew_findings_json, ai_notes, error_message, processing_time_ms, created_at, updated_at, created_by_user_id)

-- photos analyzed for jobsite conditions
jobsite_analysis_photos(id, batch_id, file_key, file_url, thumbnail_url, original_filename, captured_at, ai_annotations_json, created_at)

-- KPI metric assignments to users
kpi_assignments(id, organization_id, kpi_template_id, user_id, target_value, period_type, start_date, end_date, is_active, assigned_by, created_at, updated_at)

-- KPI metric data entries
kpi_entries(id, organization_id, kpi_assignment_id, actual_value, period_start, period_end, notes, source, recorded_by, created_at)

-- KPI metric template definitions
kpi_templates(id, organization_id, name, description, category, unit, direction, is_active, created_by, created_at, updated_at)

-- project maintenance activity logs
maintenance_logs(id, project_id, date, type, system, title, description, vendor_name, document_url, document_filename, created_by_id, created_at, updated_at)

-- recurring maintenance schedules
maintenance_recurring_schedules(id, project_id, title, system, frequency, description, next_due_date, is_active, created_by_id, created_at, updated_at)

-- organization cost code definitions
org_cost_codes(id, organization_id, is_custom, is_active, deactivated_by_id, deactivated_at, created_at, updated_at)

-- overhead cost change history
overhead_cost_history(id, organization_id, cost_item_id, action, performed_by_id, item_name, previous_data, new_data, created_at)

-- overhead cost item definitions
overhead_cost_items(id, organization_id, name, category, frequency, amortization_months, effective_date, end_date, is_active, notes, created_at, updated_at)

-- overtime calculation rules
overtime_rules(id, organization_id, project_id, consecutive_day_rule, consecutive_day_threshold, is_active, created_at, updated_at)

-- owner pay application (AIA G702/G703)
pay_applications(id, organization_id, project_id, sov_id, application_number, period_to, architect_name, architect_address, owner_name, owner_address, contractor_name, contractor_address, contract_date, contract_for, status, submitted_at, approved_at, approved_by_id, rejection_reason, paid_at, payment_reference, payment_method, created_by_id, created_at, updated_at)

-- individual pay stub deduction lines
pay_stub_deductions(id, pay_run_line_item_id, deduction_type_id, created_at)

-- payroll deduction type definitions
payroll_deduction_types(id, organization_id, name, category, calculation_method, is_pre_tax, is_active, sort_order, created_at, updated_at)

-- payroll approval notifications
payroll_notifications(id, organization_id, period_start, period_end, project_id, approving_manager_id, office_manager_id, status, total_shifts_approved, total_time_entries_approved, sent_to_office_manager_at, processed_at, processed_by_id, created_at, updated_at)

-- formal employee performance reviews
performance_reviews(id, user_id, organization_id, review_date, reviewer_name, overall_rating, productivity_rating, quality_rating, safety_rating, communication_rating, leadership_rating, notes, schedule_adherence, cost_control, subcontractor_coordination, client_inspection_outcomes, recorded_by, created_at)

-- project plan/drawing documents
plan_documents(id, project_id, type, title, file_name, file_url, object_key, file_size, mime_type, uploaded_by_id, uploaded_at)

-- PO receipt individual item lines
po_receipt_items(id, receipt_id, po_item_id, condition, notes)

-- purchase order delivery receipts
po_receipts(id, po_id, received_by_id, received_at, delivery_note, status, notes, created_at)

-- Davis-Bacon prevailing wage rates
prevailing_wage_rates(id, organization_id, project_id, classification_id, effective_date, expiration_date, wage_decision, notes, created_at, updated_at)

-- project-level cost code assignments
project_cost_codes(id, project_id, is_active, assigned_at)

-- tracked project delay events
project_delays(id, project_id, delay_number, reason, reason_notes, start_date_time, end_date_time, estimated_duration, owner_rep_contact_id, gc_rep_contact_id, owner_rep_name, gc_rep_name, proof_file_id, proof_file_name, proof_file_url, financially_responsible, change_order_required, linked_change_order_id, proceed_to_work_date, proceed_to_work_notes, proceed_to_work_file_url, status, created_by_id, submitted_at, acknowledged_by_id, acknowledged_at, resolved_at, created_at, updated_at, weather_evidence_json)

-- project-specific employee rates
project_employee_rates(id, project_id, user_id, classification_id, notes, created_at, updated_at)

-- planned equipment for projects
project_equipment_plans(id, project_id, bid_equipment_selection_id, source, status, equipment_id, assignment_id, rental_catalog_id, rental_vendor_id, rental_confirmation_number, equipment_name, equipment_type, planned_days, planned_start_date, planned_end_date, actual_days, actual_start_date, actual_end_date, notes, cost_code, created_by_id, created_at, updated_at)

-- AI project health score snapshots
project_health_snapshots(id, organization_id, project_id, overall_score, schedule_score, budget_score, rfi_submittal_score, change_order_score, safety_score, cost_score, trend_direction, ai_explanation, breakdown, snapshot_date, created_at)

-- project labor rate overrides
project_labor_rates(id, project_id, notes, created_at, updated_at)

-- project location/zone hierarchy
project_locations(id, project_id, parent_id, name, level, sort_order, description, created_at, updated_at)

-- project material budget tracking
project_material_budgets(id, project_id, scope_item_id, estimate_line_item_id, description, unit, alert_triggered, alert_triggered_at, created_at, updated_at)

-- daily material usage records
project_material_usage(id, project_id, scope_item_id, material_budget_id, daily_scope_progress_id, usage_date, description, unit, vendor_name, receipt_reference, notes, created_by_id, created_at, updated_at)

-- uploaded project plan PDFs
project_plans(id, project_id, document_id, original_pdf_url, file_name, created_at, updated_at)

-- project profitability snapshots
project_profitability_snapshots(id, organization_id, project_id, project_code, status, alert_threshold_fired, created_at)

-- identified project risks
project_risks(id, project_id, organization_id, title, description, category, probability, impact, risk_score, status, mitigation_plan, owner_user_id, schedule_impact_days, linked_cost_code, linked_milestone, linked_change_order_id, created_at, updated_at)

-- individual schedule tasks/activities
project_schedule_tasks(id, schedule_id, parent_task_id, name, description, trade_type, planned_start_date, planned_end_date, actual_start_date, actual_end_date, duration_days, dependencies, percent_complete, is_critical_path, is_milestone, crew_id, sow_item_ids, inspection_id, delay_ids, status, sort_order, early_start, early_finish, late_start, late_finish, total_float, free_float, baseline_start_date, baseline_end_date, crew_ids, created_at, updated_at)

-- project schedule (Gantt) definitions
project_schedules(id, organization_id, project_id, name, generated_by, baseline_start_date, baseline_end_date, actual_start_date, actual_end_date, working_days, options_json, ai_notes, version, is_active, baseline_locked, baseline_locked_at, projected_completion_date, created_at, updated_at, created_by_user_id)

-- uploaded project specification files
project_specs(id, project_id, file_url, original_file_name, created_at, updated_at)

-- purchase order line items
purchase_order_items(id, po_id, pr_item_id, description, unit, cost_code, expected_delivery_date)

-- purchase request line items
purchase_request_items(id, pr_id, description, category, unit, cost_code)

-- QuickBooks account mappings
qbo_account_mappings(id, organization_id, connection_id, cost_code, qbo_account_id, qbo_account_name, mapping_type, created_at, updated_at)

-- QuickBooks sync schedules
qbo_sync_schedules(id, organization_id, connection_id, operation, frequency, is_active, last_run_at, next_run_at, created_at, updated_at)

-- quality issue records
quality_issues(id, user_id, organization_id, date, category, description, resolution, recorded_by, created_at)

-- employee rating criteria definitions
rating_criteria(id, organization_id, name, description, max_score, is_active, sort_order, kpi_template_id, created_at)

-- individual rating criterion scores
rating_scores(id, rating_id, criteria_id, comment)

-- rental vendor equipment catalog
rental_equipment_catalog(id, vendor_id, crm_organisation_id, name, equipment_type, make, model, description, minimum_rental_days, lead_time_days, is_active, created_at, updated_at)

-- active equipment rental usage records
rental_equipment_usages(id, project_equipment_plan_id, project_id, vendor_id, rental_catalog_id, equipment_name, equipment_type, start_date, expected_end_date, actual_end_date, status, vendor_confirmation, po_number, invoice_number, invoice_date, is_paid, paid_date, notes, created_by_id, created_at, updated_at)

-- equipment rental vendor contacts
rental_vendors(id, name, code, organization_id, contact_name, contact_email, contact_phone, address, city, state, account_number, payment_terms, notes, crm_organisation_id, is_active, created_at, updated_at)

-- data retention policy configs
retention_policies(id, organization_id, entity_type, retention_days, action, enabled, last_run_at, created_at, updated_at)

-- project retention release requests
retention_releases(id, organization_id, project_id, sov_id, release_type, status, reason, approved_by_id, approved_at, released_at, requested_by_id, created_at, updated_at)

-- revenue recognition period snapshots
revenue_recognition(id, organization_id, project_id, period, snapshot_date, created_at, updated_at)

-- RFI activity/comment history
rfi_activity(id, rfi_id, user_id, user_name, action, comment, attachments_json, created_at)

-- RFI file attachments
rfi_attachments(id, rfi_id, organization_id, file_name, file_size, mime_type, storage_key, uploaded_by_id, uploaded_by_name, description, is_answer_attachment, created_at)

-- completed safety checklist instances
safety_checklist_instances(id, template_id, organization_id, project_id, completed_by, completed_by_name, status, responses_json, notes, photo_urls, completed_at, created_at)

-- safety checklist template definitions
safety_checklist_templates(id, organization_id, name, category, items_json, is_active, created_by, created_at, updated_at)

-- safety incident records
safety_incidents(id, user_id, organization_id, date, severity, description, action_taken, recorded_by, created_at)

-- safety training assignments
safety_training_assignments(id, training_id, organization_id, employee_id, assigned_by, assigned_at, due_date, status, completed_at, completed_by_name, notes, acknowledgment_signature, created_at)

-- safety training course definitions
safety_trainings(id, organization_id, title, description, category, frequency, duration_minutes, materials, is_active, created_by, created_at, updated_at)

-- schedule forecast point-in-time snapshots
schedule_forecast_snapshots(id, schedule_id, snapshot_date, projected_completion_date, baseline_end_date, current_end_date, critical_path_days_remaining, overall_progress, created_at)

-- schedule of values (SOV) documents
schedule_of_values(id, organization_id, project_id, sov_number, title, description, period_number, period_start, period_end, status, approved_by_id, approved_at, submitted_at, paid_at, pdf_url, pdf_generated_at, created_by_id, created_at, updated_at)

-- skill verification requests
skill_verification_requests(id, user_skill_id, requested_by_user_id, requested_to_user_id, organization_id, status, created_at, resolved_at)

-- SOV individual line items
sov_line_items(id, sov_id, line_number, item_code, description, category, estimate_line_item_id, linked_change_order_id, organization_sow_item_id, notes, created_at, updated_at)

-- SOV payment records
sov_payments(id, organization_id, sov_id, payment_number, payment_date, payment_method, reference_number, notes, recorded_by_id, created_at, updated_at)

-- SOV line item revision history
sov_revision_history(id, sov_line_item_id, contract_id, revision_type, previous_value, new_value, change_order_ref, changed_by_id, created_at)

-- stored materials awaiting installation
stored_materials(id, organization_id, project_id, sov_id, sov_line_item_id, description, storage_location, storage_status, delivery_date, incorporated_date, vendor, invoice_reference, notes, created_by_id, created_at, updated_at)

-- subcontractor pay app line items
sub_pay_app_line_items(id, pay_app_id, sov_line_item_id)

-- subcontractor pay applications
sub_pay_applications(id, contract_id, application_number, period_to, status, submitted_at, reviewed_at, approved_at, approved_by_id, paid_at, rejection_reason, created_by_id, created_at, updated_at)

-- subcontractor performance scores
sub_performance_scores(id, contract_id, period_date, schedule_adherence, work_completion_percent, quality_score, safety_incidents, punch_list_items, notes, scored_by_id, created_at)

-- subcontractor retention releases
sub_retention_releases(id, contract_id, release_type, status, reason, approved_by_id, approved_at, rejected_by_id, rejected_at, rejection_reason, requested_by_id, created_at, updated_at)

-- subcontract file attachments
subcontract_attachments(id, contract_id, file_name, file_url, file_size, file_type, category, uploaded_by_id, created_at)

-- subcontract SOV line items
subcontract_sov_line_items(id, contract_id, item_number, description, change_order_ref, created_at, updated_at)

-- invitations sent to subcontractors
subcontractor_bid_invitations(id, bid_request_id, invited_organization_id, external_company_name, external_contact_name, external_contact_email, external_contact_phone, invited_trade_type, personal_message, status, viewed_at, responded_at, declined_reason, email_sent_at, reminder_sent_at, reminder_count, invited_by_user_id, created_at, updated_at)

-- subcontractor bid request packages
subcontractor_bid_requests(id, organization_id, project_id, bid_id, title, description, scope_of_work, required_trades, bid_due_date, project_start_date, project_end_date, project_address, project_city, project_state, project_zip, show_budget_to_subs, requires_bonding, requires_insurance, special_requirements, attached_file_urls, attached_file_names, status, published_at, closed_at, awarded_at, awarded_to_organization_id, internal_notes, view_count, invite_count, response_count, created_by_user_id, created_at, updated_at)

-- subcontractor bid response submissions
subcontractor_bid_responses(id, invitation_id, bid_request_id, responding_organization_id, line_items_json, proposal_notes, scope_inclusions, scope_exclusions, assumptions, proposed_start_date, proposed_duration, proposed_duration_unit, attached_file_urls, attached_file_names, quote_valid_until, status, submitted_at, reviewed_at, reviewed_by_user_id, gc_internal_rating, gc_internal_notes, sub_internal_notes, created_by_user_id, created_at, updated_at)

-- subcontractor billing milestones
subcontractor_billing_schedule(id, contract_id, milestone_number, description, scheduled_date, completion_percent, status, completed_at, notes, created_at)

-- submittal activity/comment history
submittal_activity(id, submittal_id, user_id, user_name, action, comment, attachments_json, created_at)

-- submittal file attachments
submittal_attachments(id, submittal_id, organization_id, submittal_item_id, submittal_review_id, file_name, file_size, mime_type, storage_key, uploaded_by_id, uploaded_by_name, description, created_at)

-- individual submittal line items
submittal_items(id, submittal_id, organization_id, item_number, description, spec_section, submittal_category, unit, manufacturer, model_number, notes, status, created_at, updated_at)

-- submittal review/approval steps
submittal_reviews(id, submittal_id, organization_id, reviewer_role, reviewer_id, reviewer_name, sequence_order, status, comments, stamp_action, date_assigned, date_reviewed, created_at)

-- project submittals
submittals(id, organization_id, project_id, contract_id, submittal_number, subject, description, submittal_type, phase, status, spec_section, category, submittal_category, subcontractor_id, submitted_by_id, submitted_by_name, date_submitted, date_required, reviewer_id, reviewer_name, date_reviewed, review_comments, revision_number, previous_submittal_id, attachments_json, stamp_action, linked_rfi_id, created_at, updated_at)

-- supervisor notes on employees
supervisor_notes(id, user_id, organization_id, note, created_by, created_by_name, created_at)

-- legacy T&M daily work sheets
tm_daily_sheets(id, project_id, date, tfr_rep_name, client_rep_name, weather, description_of_work, crew_size, labor_summary_json, equipment_used_json, materials_used_json, attachments_json, client_signature_name, client_signature_date, created_by_id, created_at, updated_at)

-- T&M consolidated invoices
tm_invoices(id, organization_id, project_id, invoice_number, invoice_date, due_date, client_name, client_address, client_email, status, sent_at, paid_at, notes, pdf_url, pdf_object_key, created_by_id, created_at, updated_at)

-- T&M ticket equipment line items
tm_ticket_equipment_entries(id, ticket_id, equipment_type, quantity, created_at)

-- T&M ticket labor line items
tm_ticket_labor_entries(id, ticket_id, employee_name, position, crew_member_count, created_at)

-- T&M ticket material line items
tm_ticket_material_entries(id, ticket_id, material_description, unit, created_at)

-- toolbox talk attendance records
toolbox_talk_attendance(id, scheduled_talk_id, employee_id, signed_at, signature, created_at)

-- scheduled toolbox talks
toolbox_talk_scheduled(id, organization_id, topic_id, project_id, scheduled_date, presenter, presenter_id, status, notes, completed_at, created_by, created_at)

-- toolbox talk topic library
toolbox_talk_topics(id, organization_id, title, content, category, attachments, is_active, created_by, created_at, updated_at)

-- transmittal recipient list
transmittal_recipients(id, transmittal_id, subcontractor_id, subcontractor_name, acknowledged, acknowledged_at, acknowledged_by_id, notes, created_at)

-- vendor invoice line items
vendor_invoice_items(id, invoice_id, po_item_id, description)

-- vendor pricebook item entries
vendor_pricebook_items(id, pricebook_id, organization_id, vendor_id, vendor_code, vendor_description, vendor_unit, category, unit, sow_item_id, calculator_key, is_active, effective_date, expiration_date, created_at, updated_at)

-- vendor pricebook definitions
vendor_pricebooks(id, organization_id, vendor_id, file_key, file_name, file_type, effective_date, expiration_date, trade_type, mapping_preset_json, status, item_count, imported_at, error_message, created_at, updated_at, uploaded_by_user_id)

-- vendor performance score records
vendor_scores(id, organization_id, crm_entity_id, project_id, score_date, notes, scored_by_id, created_at, updated_at)

-- warranty case document attachments
warranty_documents(id, case_id, project_id, document_type, title, url, filename, mime_type, file_size, uploaded_by_id, created_at)
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
8. NEVER use UNION, EXCEPT, or INTERSECT.
9. Do NOT use any parameter placeholders ($1, $2, etc.). The system handles parameterization.
10. You may use OR in simple WHERE conditions (e.g., WHERE status = 'active' OR status = 'pending'). However, prefer IN(...) when checking the same column for multiple values. Do NOT use OR for tautologies like OR 1=1 or OR TRUE.
11. Do NOT use subqueries (nested SELECT statements). Use JOINs instead. There must be exactly ONE SELECT keyword in the entire query.
12. Do NOT use schema-qualified table names (e.g., public.users). Just use the table name directly.
13. Do NOT use backticks or any quoted identifiers. Column and table names must be bare/unquoted. Avoid double quotes for identifiers.
14. Do NOT use CTEs (WITH ... AS).
15. Do NOT use semicolons.

EXAMPLES OF VALID QUERIES:
- SELECT COUNT(*) AS active_projects FROM projects WHERE status = 'ACTIVE'
- SELECT p.name AS project_name, SUM(b.bid_amount) AS total_bid_value FROM projects p JOIN bids b ON b.gc_organization_id = p.gc_organization_id GROUP BY p.name ORDER BY total_bid_value DESC LIMIT 10
- SELECT t.title AS task_name, t.due_date FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.due_date < CURRENT_DATE ORDER BY t.due_date LIMIT 50
- SELECT u.first_name, u.last_name, u.role FROM users u WHERE u.is_active = true ORDER BY u.last_name LIMIT 50
- SELECT COALESCE(SUM(bid_amount), 0) AS total_value FROM bids WHERE status = 'SUBMITTED'
- SELECT c.name AS conversation_name, COUNT(m.id) AS message_count FROM conversations c JOIN messages m ON m.conversation_id = c.id GROUP BY c.id, c.name ORDER BY message_count DESC LIMIT 10
- SELECT COUNT(*) AS unread_count FROM messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id WHERE cp.user_id = m.sender_id AND m.created_at > cp.last_read_at

EXAMPLES OF INVALID QUERIES (never generate these):
- SELECT * FROM (SELECT ... FROM projects) sub  -- subqueries are forbidden
- WITH cte AS (SELECT ...) SELECT ...  -- CTEs are forbidden
- SELECT * FROM public.projects  -- schema-qualified names are forbidden
- SELECT * FROM projects; SELECT * FROM bids  -- multiple statements forbidden
- SELECT * FROM projects WHERE id = $1  -- parameter placeholders forbidden
- SELECT * FROM projects UNION SELECT * FROM bids  -- UNION forbidden

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
  'task_subtasks', 'task_comments', 'task_attachments',
  'change_orders', 'invoices', 'procurement_items', 'equipment',
  'equipment_assignments',
  'daily_reports', 'project_inspections',
  'estimates', 'estimate_line_items', 'receipts', 'scope_items', 'daily_scope_progress',
  'weekly_payroll_reports', 'pay_runs', 'pay_run_line_items',
  'purchase_requests', 'purchase_orders', 'vendor_invoices',
  'contracts', 'project_notes', 'osha_incidents',
  'leave_requests', 'crm_organisations', 'crm_contacts', 'crm_opportunities',
  'crm_organisation_notes', 'crm_opportunity_activities',
  'drawing_sets',
  'bid_subcontractor_quotes', 'bid_material_quotes', 'change_order_revisions',
  'conversations', 'conversation_participants', 'messages',
  'message_reactions', 'message_read_receipts', 'message_entity_links',
  'video_calls', 'video_call_participants', 'video_call_notes',
  'crews', 'crew_members', 'crew_project_assignments',
  'skills', 'user_skills', 'user_certifications', 'user_equipment_competencies',
  'subcontractor_contracts', 'subcontractor_payments',
  'rfis', 'punch_list_items',
  'calendar_events', 'notifications',
  'time_clock_shifts', 'overtime_requests',
  'budget_line_items',
  'warranty_cases', 'warranty_tasks',
  'lien_waivers',
  'leave_types', 'tm_tickets', 'audit_log',
  'addenda',
  'addendum_acknowledgments',
  'annual_salary_categories',
  'approval_requests',
  'asset_handover_items',
  'asset_handover_signoffs',
  'attendance_logs',
  'bid_document_distributions',
  'bid_documents',
  'bid_equipment_selections',
  'bid_request_clarifications',
  'billing_events',
  'budget_alerts',
  'burden_rates',
  'change_order_approvals',
  'change_order_attachments',
  'change_order_comments',
  'change_order_equipment_entries',
  'change_order_labor_entries',
  'change_order_material_entries',
  'company_daily_notes',
  'contract_approvals',
  'contract_clauses',
  'contract_redlines',
  'contract_risk_analyses',
  'contract_templates',
  'contract_versions',
  'cost_ledger_postings',
  'cost_transactions',
  'delay_claims',
  'delay_notifications',
  'document_revisions',
  'document_transmittals',
  'drawing_set_items',
  'email_accounts',
  'email_attachments',
  'email_messages',
  'email_summaries',
  'email_tasks',
  'email_threads',
  'employee_classifications',
  'employee_cost_assignments',
  'employee_deductions',
  'employee_performance_profiles',
  'employee_ratings',
  'equipment_fuel_logs',
  'equipment_hour_logs',
  'equipment_hour_reminders',
  'equipment_listings',
  'equipment_maintenance_history',
  'equipment_maintenance_schedules',
  'equipment_rate_profiles',
  'equipment_rental_requests',
  'equipment_repairs',
  'estimate_history',
  'estimate_line_item_subcontractors',
  'estimate_vendor_quotes',
  'estimate_versions',
  'forecast_adjustments',
  'handoff_packets',
  'hiring_candidate_documents',
  'hiring_candidate_notes',
  'hiring_candidates',
  'hiring_interviews',
  'hiring_jobs',
  'hiring_tasks',
  'historical_costs',
  'invoice_matches',
  'invoice_payments',
  'issue_captures',
  'job_classifications',
  'jobsite_analysis_batches',
  'jobsite_analysis_photos',
  'kpi_assignments',
  'kpi_entries',
  'kpi_templates',
  'maintenance_logs',
  'maintenance_recurring_schedules',
  'org_cost_codes',
  'overhead_cost_history',
  'overhead_cost_items',
  'overtime_rules',
  'pay_applications',
  'pay_stub_deductions',
  'payroll_deduction_types',
  'payroll_notifications',
  'performance_reviews',
  'plan_documents',
  'po_receipt_items',
  'po_receipts',
  'prevailing_wage_rates',
  'project_cost_codes',
  'project_delays',
  'project_employee_rates',
  'project_equipment_plans',
  'project_health_snapshots',
  'project_labor_rates',
  'project_locations',
  'project_material_budgets',
  'project_material_usage',
  'project_plans',
  'project_profitability_snapshots',
  'project_risks',
  'project_schedule_tasks',
  'project_schedules',
  'project_specs',
  'purchase_order_items',
  'purchase_request_items',
  'qbo_account_mappings',
  'qbo_sync_schedules',
  'quality_issues',
  'rating_criteria',
  'rating_scores',
  'rental_equipment_catalog',
  'rental_equipment_usages',
  'rental_vendors',
  'retention_policies',
  'retention_releases',
  'revenue_recognition',
  'rfi_activity',
  'rfi_attachments',
  'safety_checklist_instances',
  'safety_checklist_templates',
  'safety_incidents',
  'safety_training_assignments',
  'safety_trainings',
  'schedule_forecast_snapshots',
  'schedule_of_values',
  'skill_verification_requests',
  'sov_line_items',
  'sov_payments',
  'sov_revision_history',
  'stored_materials',
  'sub_pay_app_line_items',
  'sub_pay_applications',
  'sub_performance_scores',
  'sub_retention_releases',
  'subcontract_attachments',
  'subcontract_sov_line_items',
  'subcontractor_bid_invitations',
  'subcontractor_bid_requests',
  'subcontractor_bid_responses',
  'subcontractor_billing_schedule',
  'submittal_activity',
  'submittal_attachments',
  'submittal_items',
  'submittal_reviews',
  'submittals',
  'supervisor_notes',
  'tm_daily_sheets',
  'tm_invoices',
  'tm_ticket_equipment_entries',
  'tm_ticket_labor_entries',
  'tm_ticket_material_entries',
  'toolbox_talk_attendance',
  'toolbox_talk_scheduled',
  'toolbox_talk_topics',
  'transmittal_recipients',
  'vendor_invoice_items',
  'vendor_pricebook_items',
  'vendor_pricebooks',
  'vendor_scores',
  'warranty_documents',
]);

// INTENTIONALLY EXCLUDED TABLES (159 tables) - These are internal/system tables
// that are not user-queryable business data:
// - Auth/sessions: active_sessions, user_sessions, user_totp_secrets, passkey_credentials,
//   password_reset_tokens, email_verification_tokens, user_api_keys
// - AI internals: ai_action_audit, ai_bid_document_analysis, ai_co_drafts,
//   ai_contract_document_analysis, ai_data_quality, ai_gantt_recommendations,
//   ai_insights, ai_note_insights, ai_runs, ai_settings, ai_takeoff_analyses,
//   ai_tasks, ai_vendor_comparisons, executive_digests
// - Integration plumbing: domain_events, integration_connections, integration_events_outbox,
//   integration_sync_state, integration_webhook_subscriptions, zapier_webhooks
// - Mobile/sync: mobile_devices, mobile_pending_uploads, mobile_sync_log, offline_sync_queue
// - File system: upload_intents, object_acl_policies, file_permissions, media
// - UI preferences: user_settings, user_color_palettes, org_color_palettes,
//   user_dashboard_layouts, user_dashboard_permissions, user_photos,
//   notification_channel_prefs, notification_type_prefs
// - Platform/billing: organization_addons, organization_usage, organization_subscriptions,
//   subscription_events, sso_configurations, push_subscriptions
// - Hustler platform: hustler_delegates, hustler_link_requests, hustler_organizations
// - Announcements: announcement_dismissals, platform_announcements
// - Social media: social_accounts, social_media_posts, social_post_analytics,
//   social_post_history, organization_social_links
// - Website builder: website_*, organization_websites, organization_website_pages,
//   page_versions, page_preview_links
// - Portal internals: client_portal_access, client_portal_activity, portal_activity_log,
//   portal_chat_messages, portal_chat_threads, subcontractor_portal_tokens
// - Vendor portal: vendor_enrollments, vendor_users, vendor_pricing_catalogs, vendor_price_history
// - Library/takeoff internals: library_*, takeoff_*, saved_takeoffs, custom_libraries
// - Master data/config: master_*, scope_modifier_*, scope_work_type_*, modifiers,
//   quantity_categories, units_of_measure, material_calculator_presets, material_price_index
// - Org config: organization_calculators, organization_sow_items, organization_work_types,
//   organization_network_settings, organization_payroll_settings, organization_documents
// - Workflow engine: global_workflow_templates, workflow_*, workflow_stages
// - Gamification: reward_assignments, reward_types, crew_marketplace, marketplace_reviews
// - Internal logs: worker_logs, voice_logs, activity_log, sow_audit_log, daily_report_locks
// - Hiring internals: hiring_sync_logs, hiring_integrations, hiring_ai_reviews,
//   hiring_activity_logs, hiring_pipeline_configs, hiring_pipeline_stages,
//   hiring_job_templates, hiring_candidate_stage_history
// - GDPR: data_processing_records, data_subject_requests
// - Misc internal: photo_custody_records, signature_requests, talent_profiles,
//   time_clock_events, bid_modifier_selections, bim_extractions, bim_storey_associations,
//   estimate_crews, estimate_settings, subcontractors, pricebook_import_jobs,
//   trade_features, trade_templates

const ORG_FILTER_COLUMN: Record<string, string> = {
  organizations: 'id',
  users: 'organization_id',
  projects: 'gc_organization_id',
  bids: 'gc_organization_id',
  equipment: 'organization_id',
  tasks: 'organization_id',
  weekly_payroll_reports: 'organization_id',
  pay_runs: 'organization_id',
  purchase_requests: 'org_id',
  purchase_orders: 'org_id',
  vendor_invoices: 'org_id',
  contracts: 'organization_id',
  osha_incidents: 'organization_id',
  leave_requests: 'organization_id',
  crm_organisations: 'organization_id',
  crm_contacts: 'organization_id',
  crm_opportunities: 'organization_id',
  drawing_sets: 'organization_id',
  conversations: 'organization_id',
  crews: 'organization_id',
  notifications: 'organization_id',
  subcontractor_payments: 'organization_id',
  rfis: 'organization_id',
  lien_waivers: 'organization_id',
  user_certifications: 'organization_id',
  user_equipment_competencies: 'organization_id',
  overtime_requests: 'organization_id',
  crm_organisation_notes: 'organization_id',
  leave_types: 'organization_id',
  addenda: 'organization_id',
  annual_salary_categories: 'organization_id',
  approval_requests: 'organization_id',
  attendance_logs: 'organization_id',
  bid_document_distributions: 'organization_id',
  burden_rates: 'organization_id',
  change_order_attachments: 'organization_id',
  contract_clauses: 'organization_id',
  contract_risk_analyses: 'organization_id',
  contract_templates: 'organization_id',
  delay_claims: 'organization_id',
  document_revisions: 'organization_id',
  document_transmittals: 'organization_id',
  email_accounts: 'organization_id',
  email_attachments: 'organization_id',
  email_messages: 'organization_id',
  email_summaries: 'organization_id',
  email_tasks: 'organization_id',
  email_threads: 'organization_id',
  employee_classifications: 'organization_id',
  employee_cost_assignments: 'organization_id',
  employee_deductions: 'organization_id',
  employee_performance_profiles: 'organization_id',
  employee_ratings: 'organization_id',
  equipment_listings: 'organization_id',
  hiring_candidate_documents: 'organization_id',
  hiring_candidate_notes: 'organization_id',
  hiring_candidates: 'organization_id',
  hiring_interviews: 'organization_id',
  hiring_jobs: 'organization_id',
  hiring_tasks: 'organization_id',
  historical_costs: 'organization_id',
  invoice_payments: 'org_id',
  issue_captures: 'organization_id',
  job_classifications: 'organization_id',
  jobsite_analysis_batches: 'organization_id',
  kpi_assignments: 'organization_id',
  kpi_entries: 'organization_id',
  kpi_templates: 'organization_id',
  org_cost_codes: 'organization_id',
  overhead_cost_history: 'organization_id',
  overhead_cost_items: 'organization_id',
  overtime_rules: 'organization_id',
  pay_applications: 'organization_id',
  payroll_deduction_types: 'organization_id',
  payroll_notifications: 'organization_id',
  performance_reviews: 'organization_id',
  prevailing_wage_rates: 'organization_id',
  project_health_snapshots: 'organization_id',
  project_profitability_snapshots: 'organization_id',
  project_risks: 'organization_id',
  project_schedules: 'organization_id',
  qbo_account_mappings: 'organization_id',
  qbo_sync_schedules: 'organization_id',
  quality_issues: 'organization_id',
  rating_criteria: 'organization_id',
  rental_vendors: 'organization_id',
  retention_policies: 'organization_id',
  retention_releases: 'organization_id',
  revenue_recognition: 'organization_id',
  rfi_attachments: 'organization_id',
  safety_checklist_instances: 'organization_id',
  safety_checklist_templates: 'organization_id',
  safety_incidents: 'organization_id',
  safety_training_assignments: 'organization_id',
  safety_trainings: 'organization_id',
  schedule_of_values: 'organization_id',
  skill_verification_requests: 'organization_id',
  sov_payments: 'organization_id',
  stored_materials: 'organization_id',
  subcontractor_bid_requests: 'organization_id',
  submittal_attachments: 'organization_id',
  submittal_items: 'organization_id',
  submittal_reviews: 'organization_id',
  submittals: 'organization_id',
  supervisor_notes: 'organization_id',
  tm_invoices: 'organization_id',
  toolbox_talk_scheduled: 'organization_id',
  toolbox_talk_topics: 'organization_id',
  vendor_pricebook_items: 'organization_id',
  vendor_pricebooks: 'organization_id',
  vendor_scores: 'organization_id',
};

const TABLES_NEEDING_DIRECT_ORG_FILTER = new Set(Object.keys(ORG_FILTER_COLUMN));

const TABLES_ORG_VIA_PROJECT_JOIN = new Set([
  'time_entries', 'change_orders', 'invoices',
  'procurement_items', 'daily_reports', 'project_inspections',
  'receipts', 'scope_items', 'project_notes',
  'equipment_assignments', 'daily_scope_progress',
  'punch_list_items', 'warranty_cases', 'warranty_tasks',
  'budget_line_items', 'tm_tickets',
  'asset_handover_items', 'asset_handover_signoffs', 'budget_alerts', 'company_daily_notes', 'cost_ledger_postings', 'cost_transactions', 'equipment_fuel_logs', 'equipment_hour_logs', 'equipment_hour_reminders', 'estimate_history', 'forecast_adjustments', 'handoff_packets', 'maintenance_logs', 'maintenance_recurring_schedules', 'plan_documents', 'project_cost_codes', 'project_delays', 'project_employee_rates', 'project_equipment_plans', 'project_labor_rates', 'project_locations', 'project_material_budgets', 'project_material_usage', 'project_plans', 'project_specs', 'rental_equipment_usages', 'tm_daily_sheets',
]);

const TABLES_CUSTOM_ORG_CTE: Record<string, string> = {
  estimates: `estimates AS (SELECT t.* FROM public.estimates t LEFT JOIN public.projects p ON t.project_id = p.id LEFT JOIN public.bids b ON t.bid_id = b.id WHERE p.gc_organization_id = $1 OR b.gc_organization_id = $1)`,
  estimate_line_items: `estimate_line_items AS (SELECT t.* FROM public.estimate_line_items t INNER JOIN public.estimates e ON t.estimate_id = e.id LEFT JOIN public.projects p ON e.project_id = p.id LEFT JOIN public.bids b ON e.bid_id = b.id WHERE p.gc_organization_id = $1 OR b.gc_organization_id = $1)`,
  bid_subcontractor_quotes: `bid_subcontractor_quotes AS (SELECT t.* FROM public.bid_subcontractor_quotes t LEFT JOIN public.projects p ON t.project_id = p.id LEFT JOIN public.bids b ON t.bid_id = b.id WHERE p.gc_organization_id = $1 OR b.gc_organization_id = $1)`,
  bid_material_quotes: `bid_material_quotes AS (SELECT t.* FROM public.bid_material_quotes t LEFT JOIN public.projects p ON t.project_id = p.id LEFT JOIN public.bids b ON t.bid_id = b.id WHERE p.gc_organization_id = $1 OR b.gc_organization_id = $1)`,
  pay_run_line_items: `pay_run_line_items AS (SELECT t.* FROM public.pay_run_line_items t INNER JOIN public.pay_runs pr ON t.pay_run_id = pr.id WHERE pr.organization_id = $1)`,
  change_order_revisions: `change_order_revisions AS (SELECT t.* FROM public.change_order_revisions t INNER JOIN public.change_orders co ON t.change_order_id = co.id INNER JOIN public.projects p ON co.project_id = p.id WHERE p.gc_organization_id = $1)`,
  conversation_participants: `conversation_participants AS (SELECT t.* FROM public.conversation_participants t INNER JOIN public.conversations c ON t.conversation_id = c.id WHERE c.organization_id = $1)`,
  messages: `messages AS (SELECT t.* FROM public.messages t INNER JOIN public.conversations c ON t.conversation_id = c.id WHERE c.organization_id = $1)`,
  message_reactions: `message_reactions AS (SELECT t.* FROM public.message_reactions t INNER JOIN public.messages m ON t.message_id = m.id INNER JOIN public.conversations c ON m.conversation_id = c.id WHERE c.organization_id = $1)`,
  message_read_receipts: `message_read_receipts AS (SELECT t.* FROM public.message_read_receipts t INNER JOIN public.messages m ON t.message_id = m.id INNER JOIN public.conversations c ON m.conversation_id = c.id WHERE c.organization_id = $1)`,
  message_entity_links: `message_entity_links AS (SELECT t.* FROM public.message_entity_links t INNER JOIN public.messages m ON t.message_id = m.id INNER JOIN public.conversations c ON m.conversation_id = c.id WHERE c.organization_id = $1)`,
  video_calls: `video_calls AS (SELECT t.* FROM public.video_calls t INNER JOIN public.conversations c ON t.conversation_id = c.id WHERE c.organization_id = $1)`,
  video_call_participants: `video_call_participants AS (SELECT t.* FROM public.video_call_participants t INNER JOIN public.video_calls vc ON t.call_id = vc.id INNER JOIN public.conversations c ON vc.conversation_id = c.id WHERE c.organization_id = $1)`,
  video_call_notes: `video_call_notes AS (SELECT t.* FROM public.video_call_notes t INNER JOIN public.video_calls vc ON t.call_id = vc.id INNER JOIN public.conversations c ON vc.conversation_id = c.id WHERE c.organization_id = $1)`,
  crew_members: `crew_members AS (SELECT t.* FROM public.crew_members t INNER JOIN public.crews cr ON t.crew_id = cr.id WHERE cr.organization_id = $1)`,
  crew_project_assignments: `crew_project_assignments AS (SELECT t.* FROM public.crew_project_assignments t INNER JOIN public.crews cr ON t.crew_id = cr.id WHERE cr.organization_id = $1)`,
  skills: `skills AS (SELECT * FROM public.skills)`,
  user_skills: `user_skills AS (SELECT t.* FROM public.user_skills t INNER JOIN public.users u ON t.user_id = u.id WHERE u.organization_id = $1)`,
  task_subtasks: `task_subtasks AS (SELECT t.* FROM public.task_subtasks t INNER JOIN public.tasks tk ON t.task_id = tk.id WHERE tk.organization_id = $1)`,
  task_comments: `task_comments AS (SELECT t.* FROM public.task_comments t INNER JOIN public.tasks tk ON t.task_id = tk.id WHERE tk.organization_id = $1)`,
  task_attachments: `task_attachments AS (SELECT t.* FROM public.task_attachments t INNER JOIN public.tasks tk ON t.task_id = tk.id WHERE tk.organization_id = $1)`,
  subcontractor_contracts: `subcontractor_contracts AS (SELECT t.* FROM public.subcontractor_contracts t INNER JOIN public.crm_organisations co ON t.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  crm_opportunity_activities: `crm_opportunity_activities AS (SELECT t.* FROM public.crm_opportunity_activities t INNER JOIN public.crm_opportunities co ON t.opportunity_id = co.id WHERE co.organization_id = $1)`,
  calendar_events: `calendar_events AS (SELECT t.* FROM public.calendar_events t INNER JOIN public.users u ON t.created_by_id = u.id WHERE u.organization_id = $1)`,
  time_clock_shifts: `time_clock_shifts AS (SELECT t.* FROM public.time_clock_shifts t INNER JOIN public.users u ON t.user_id = u.id WHERE u.organization_id = $1)`,
  addendum_acknowledgments: `addendum_acknowledgments AS (SELECT t.* FROM public.addendum_acknowledgments t INNER JOIN public.addenda p ON t.addendum_id = p.id WHERE p.organization_id = $1)`,
  bid_documents: `bid_documents AS (SELECT t.* FROM public.bid_documents t INNER JOIN public.bids p ON t.bid_id = p.id WHERE p.gc_organization_id = $1)`,
  bid_equipment_selections: `bid_equipment_selections AS (SELECT t.* FROM public.bid_equipment_selections t INNER JOIN public.bids p ON t.bid_id = p.id WHERE p.gc_organization_id = $1)`,
  bid_request_clarifications: `bid_request_clarifications AS (SELECT t.* FROM public.bid_request_clarifications t INNER JOIN public.subcontractor_bid_requests p ON t.bid_request_id = p.id WHERE p.organization_id = $1)`,
  billing_events: `billing_events AS (SELECT t.* FROM public.billing_events t INNER JOIN public.scope_items si ON t.scope_item_id = si.id INNER JOIN public.projects p ON si.project_id = p.id WHERE p.gc_organization_id = $1)`,
  change_order_approvals: `change_order_approvals AS (SELECT t.* FROM public.change_order_approvals t INNER JOIN public.change_orders co ON t.change_order_id = co.id INNER JOIN public.projects p ON co.project_id = p.id WHERE p.gc_organization_id = $1)`,
  change_order_comments: `change_order_comments AS (SELECT t.* FROM public.change_order_comments t INNER JOIN public.change_orders co ON t.change_order_id = co.id INNER JOIN public.projects p ON co.project_id = p.id WHERE p.gc_organization_id = $1)`,
  change_order_equipment_entries: `change_order_equipment_entries AS (SELECT t.* FROM public.change_order_equipment_entries t INNER JOIN public.change_orders co ON t.change_order_id = co.id INNER JOIN public.projects p ON co.project_id = p.id WHERE p.gc_organization_id = $1)`,
  change_order_labor_entries: `change_order_labor_entries AS (SELECT t.* FROM public.change_order_labor_entries t INNER JOIN public.change_orders co ON t.change_order_id = co.id INNER JOIN public.projects p ON co.project_id = p.id WHERE p.gc_organization_id = $1)`,
  change_order_material_entries: `change_order_material_entries AS (SELECT t.* FROM public.change_order_material_entries t INNER JOIN public.change_orders co ON t.change_order_id = co.id INNER JOIN public.projects p ON co.project_id = p.id WHERE p.gc_organization_id = $1)`,
  contract_approvals: `contract_approvals AS (SELECT t.* FROM public.contract_approvals t INNER JOIN public.contracts p ON t.contract_id = p.id WHERE p.organization_id = $1)`,
  contract_redlines: `contract_redlines AS (SELECT t.* FROM public.contract_redlines t INNER JOIN public.contracts p ON t.contract_id = p.id WHERE p.organization_id = $1)`,
  contract_versions: `contract_versions AS (SELECT t.* FROM public.contract_versions t INNER JOIN public.contracts p ON t.contract_id = p.id WHERE p.organization_id = $1)`,
  delay_notifications: `delay_notifications AS (SELECT t.* FROM public.delay_notifications t INNER JOIN public.project_delays pd ON t.delay_id = pd.id INNER JOIN public.projects p ON pd.project_id = p.id WHERE p.gc_organization_id = $1)`,
  drawing_set_items: `drawing_set_items AS (SELECT t.* FROM public.drawing_set_items t INNER JOIN public.drawing_sets p ON t.drawing_set_id = p.id WHERE p.organization_id = $1)`,
  equipment_maintenance_history: `equipment_maintenance_history AS (SELECT t.* FROM public.equipment_maintenance_history t INNER JOIN public.equipment p ON t.equipment_id = p.id WHERE p.organization_id = $1)`,
  equipment_maintenance_schedules: `equipment_maintenance_schedules AS (SELECT t.* FROM public.equipment_maintenance_schedules t INNER JOIN public.equipment p ON t.equipment_id = p.id WHERE p.organization_id = $1)`,
  equipment_rate_profiles: `equipment_rate_profiles AS (SELECT t.* FROM public.equipment_rate_profiles t INNER JOIN public.equipment p ON t.equipment_id = p.id WHERE p.organization_id = $1)`,
  equipment_rental_requests: `equipment_rental_requests AS (SELECT t.* FROM public.equipment_rental_requests t INNER JOIN public.equipment_listings p ON t.listing_id = p.id WHERE p.organization_id = $1)`,
  equipment_repairs: `equipment_repairs AS (SELECT t.* FROM public.equipment_repairs t INNER JOIN public.equipment p ON t.equipment_id = p.id WHERE p.organization_id = $1)`,
  estimate_line_item_subcontractors: `estimate_line_item_subcontractors AS (SELECT t.* FROM public.estimate_line_item_subcontractors t INNER JOIN public.estimate_line_items eli ON t.line_item_id = eli.id INNER JOIN public.estimates e ON eli.estimate_id = e.id LEFT JOIN public.projects p ON e.project_id = p.id LEFT JOIN public.bids b ON e.bid_id = b.id WHERE p.gc_organization_id = $1 OR b.gc_organization_id = $1)`,
  estimate_vendor_quotes: `estimate_vendor_quotes AS (SELECT t.* FROM public.estimate_vendor_quotes t INNER JOIN public.estimates e ON t.estimate_id = e.id LEFT JOIN public.projects p ON e.project_id = p.id LEFT JOIN public.bids b ON e.bid_id = b.id WHERE p.gc_organization_id = $1 OR b.gc_organization_id = $1)`,
  estimate_versions: `estimate_versions AS (SELECT t.* FROM public.estimate_versions t INNER JOIN public.estimates e ON t.estimate_id = e.id LEFT JOIN public.projects p ON e.project_id = p.id LEFT JOIN public.bids b ON e.bid_id = b.id WHERE p.gc_organization_id = $1 OR b.gc_organization_id = $1)`,
  invoice_matches: `invoice_matches AS (SELECT t.* FROM public.invoice_matches t INNER JOIN public.vendor_invoices p ON t.invoice_id = p.id WHERE p.org_id = $1)`,
  jobsite_analysis_photos: `jobsite_analysis_photos AS (SELECT t.* FROM public.jobsite_analysis_photos t INNER JOIN public.jobsite_analysis_batches p ON t.batch_id = p.id WHERE p.organization_id = $1)`,
  pay_stub_deductions: `pay_stub_deductions AS (SELECT t.* FROM public.pay_stub_deductions t INNER JOIN public.pay_run_line_items prli ON t.pay_run_line_item_id = prli.id INNER JOIN public.pay_runs pr ON prli.pay_run_id = pr.id WHERE pr.organization_id = $1)`,
  po_receipt_items: `po_receipt_items AS (SELECT t.* FROM public.po_receipt_items t INNER JOIN public.po_receipts r ON t.receipt_id = r.id INNER JOIN public.purchase_orders po ON r.po_id = po.id WHERE po.org_id = $1)`,
  po_receipts: `po_receipts AS (SELECT t.* FROM public.po_receipts t INNER JOIN public.purchase_orders p ON t.po_id = p.id WHERE p.org_id = $1)`,
  project_schedule_tasks: `project_schedule_tasks AS (SELECT t.* FROM public.project_schedule_tasks t INNER JOIN public.project_schedules p ON t.schedule_id = p.id WHERE p.organization_id = $1)`,
  purchase_order_items: `purchase_order_items AS (SELECT t.* FROM public.purchase_order_items t INNER JOIN public.purchase_orders p ON t.po_id = p.id WHERE p.org_id = $1)`,
  purchase_request_items: `purchase_request_items AS (SELECT t.* FROM public.purchase_request_items t INNER JOIN public.purchase_requests p ON t.pr_id = p.id WHERE p.org_id = $1)`,
  rating_scores: `rating_scores AS (SELECT t.* FROM public.rating_scores t INNER JOIN public.employee_ratings p ON t.rating_id = p.id WHERE p.organization_id = $1)`,
  rental_equipment_catalog: `rental_equipment_catalog AS (SELECT t.* FROM public.rental_equipment_catalog t INNER JOIN public.rental_vendors p ON t.vendor_id = p.id WHERE p.organization_id = $1)`,
  rfi_activity: `rfi_activity AS (SELECT t.* FROM public.rfi_activity t INNER JOIN public.rfis p ON t.rfi_id = p.id WHERE p.organization_id = $1)`,
  schedule_forecast_snapshots: `schedule_forecast_snapshots AS (SELECT t.* FROM public.schedule_forecast_snapshots t INNER JOIN public.project_schedules p ON t.schedule_id = p.id WHERE p.organization_id = $1)`,
  sov_line_items: `sov_line_items AS (SELECT t.* FROM public.sov_line_items t INNER JOIN public.schedule_of_values p ON t.sov_id = p.id WHERE p.organization_id = $1)`,
  sov_revision_history: `sov_revision_history AS (SELECT t.* FROM public.sov_revision_history t INNER JOIN public.sov_line_items sli ON t.sov_line_item_id = sli.id INNER JOIN public.schedule_of_values sov ON sli.sov_id = sov.id WHERE sov.organization_id = $1)`,
  sub_pay_app_line_items: `sub_pay_app_line_items AS (SELECT t.* FROM public.sub_pay_app_line_items t INNER JOIN public.sub_pay_applications spa ON t.pay_app_id = spa.id INNER JOIN public.subcontractor_contracts sc ON spa.contract_id = sc.id INNER JOIN public.crm_organisations co ON sc.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  sub_pay_applications: `sub_pay_applications AS (SELECT t.* FROM public.sub_pay_applications t INNER JOIN public.subcontractor_contracts sc ON t.contract_id = sc.id INNER JOIN public.crm_organisations co ON sc.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  sub_performance_scores: `sub_performance_scores AS (SELECT t.* FROM public.sub_performance_scores t INNER JOIN public.subcontractor_contracts sc ON t.contract_id = sc.id INNER JOIN public.crm_organisations co ON sc.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  sub_retention_releases: `sub_retention_releases AS (SELECT t.* FROM public.sub_retention_releases t INNER JOIN public.subcontractor_contracts sc ON t.contract_id = sc.id INNER JOIN public.crm_organisations co ON sc.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  subcontract_attachments: `subcontract_attachments AS (SELECT t.* FROM public.subcontract_attachments t INNER JOIN public.subcontractor_contracts sc ON t.contract_id = sc.id INNER JOIN public.crm_organisations co ON sc.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  subcontract_sov_line_items: `subcontract_sov_line_items AS (SELECT t.* FROM public.subcontract_sov_line_items t INNER JOIN public.subcontractor_contracts sc ON t.contract_id = sc.id INNER JOIN public.crm_organisations co ON sc.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  subcontractor_bid_invitations: `subcontractor_bid_invitations AS (SELECT t.* FROM public.subcontractor_bid_invitations t INNER JOIN public.subcontractor_bid_requests p ON t.bid_request_id = p.id WHERE p.organization_id = $1)`,
  subcontractor_bid_responses: `subcontractor_bid_responses AS (SELECT t.* FROM public.subcontractor_bid_responses t INNER JOIN public.subcontractor_bid_requests p ON t.bid_request_id = p.id WHERE p.organization_id = $1)`,
  subcontractor_billing_schedule: `subcontractor_billing_schedule AS (SELECT t.* FROM public.subcontractor_billing_schedule t INNER JOIN public.subcontractor_contracts sc ON t.contract_id = sc.id INNER JOIN public.crm_organisations co ON sc.subcontractor_id = co.id WHERE co.organization_id = $1)`,
  submittal_activity: `submittal_activity AS (SELECT t.* FROM public.submittal_activity t INNER JOIN public.submittals p ON t.submittal_id = p.id WHERE p.organization_id = $1)`,
  tm_ticket_equipment_entries: `tm_ticket_equipment_entries AS (SELECT t.* FROM public.tm_ticket_equipment_entries t INNER JOIN public.tm_tickets tk ON t.ticket_id = tk.id INNER JOIN public.projects p ON tk.project_id = p.id WHERE p.gc_organization_id = $1)`,
  tm_ticket_labor_entries: `tm_ticket_labor_entries AS (SELECT t.* FROM public.tm_ticket_labor_entries t INNER JOIN public.tm_tickets tk ON t.ticket_id = tk.id INNER JOIN public.projects p ON tk.project_id = p.id WHERE p.gc_organization_id = $1)`,
  tm_ticket_material_entries: `tm_ticket_material_entries AS (SELECT t.* FROM public.tm_ticket_material_entries t INNER JOIN public.tm_tickets tk ON t.ticket_id = tk.id INNER JOIN public.projects p ON tk.project_id = p.id WHERE p.gc_organization_id = $1)`,
  toolbox_talk_attendance: `toolbox_talk_attendance AS (SELECT t.* FROM public.toolbox_talk_attendance t INNER JOIN public.toolbox_talk_scheduled p ON t.scheduled_talk_id = p.id WHERE p.organization_id = $1)`,
  transmittal_recipients: `transmittal_recipients AS (SELECT t.* FROM public.transmittal_recipients t INNER JOIN public.document_transmittals p ON t.transmittal_id = p.id WHERE p.organization_id = $1)`,
  vendor_invoice_items: `vendor_invoice_items AS (SELECT t.* FROM public.vendor_invoice_items t INNER JOIN public.vendor_invoices p ON t.invoice_id = p.id WHERE p.org_id = $1)`,
  warranty_documents: `warranty_documents AS (SELECT t.* FROM public.warranty_documents t INNER JOIN public.warranty_cases wc ON t.case_id = wc.id INNER JOIN public.projects p ON wc.project_id = p.id WHERE p.gc_organization_id = $1)`,
  audit_log: `audit_log AS (SELECT t.* FROM public.audit_log t INNER JOIN public.users u ON t.user_id = u.id WHERE u.organization_id = $1)`,
};

const SENSITIVE_COLUMNS = new Set([
  'password_hash', 'token_version', 'oauth_provider_id', 'failed_login_attempts',
  'locked_until', 'oauth_provider', 'email_verified',
  'access_token', 'access_token_encrypted', 'access_token_hash',
  'refresh_token', 'refresh_token_encrypted',
  'imap_password', 'imap_username', 'smtp_host', 'smtp_port', 'smtp_secure',
  'imap_host', 'imap_port', 'imap_secure',
  'secret', 'secret_hash', 'secret_key',
  'api_key', 'private_key', 'client_secret',
  'encrypted_credentials_json', 'credential_id',
  'invite_token', 'invite_token_hash',
  'push_token', 'staging_token', 'rfq_response_token',
  'portal_token_id', 'sender_portal_token_id',
  'signoff_signature', 'client_signoff_signature',
  'acknowledgment_signature',
]);

const MAX_RESULT_ROWS = 50;

function normalizeSqlFromAI(rawSql: string): string {
  let sql = rawSql.trim();

  sql = sql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '');

  sql = sql.replace(/"(\w+)"/g, '$1');

  sql = sql.replace(/;+\s*$/, '');

  sql = sql.replace(/\s+/g, ' ').trim();

  return sql;
}

function extractAllTableReferences(sqlQuery: string): string[] {
  const stripped = sqlQuery.replace(/["`]/g, '');
  const lower = stripped.toLowerCase();
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
    if (tablePattern.test(stripped)) {
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
    /\b(?:INSERT|SELECT)\s+INTO\b/,
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

  const sqlWithoutLiterals = normalized.replace(/'[^']*'/g, "'_LITERAL_'");
  const orInjectionPatterns = [
    /\bOR\s+\d+\s*=\s*\d+\b/,
    /\bOR\s+'_LITERAL_'\s*=\s*'_LITERAL_'/,
    /\bOR\s+TRUE\b/,
    /\bOR\s+FALSE\s+IS\s+FALSE\b/,
    /\bOR\s+NOT\s+FALSE\b/,
    /\bOR\s+NULL\s+IS\s+NULL\b/,
    /\bOR\s+CAST\s*\(/,
    /\bOR\s+\(\s*SELECT\b/,
  ];
  for (const pattern of orInjectionPatterns) {
    if (pattern.test(sqlWithoutLiterals)) {
      return { safe: false, reason: 'OR clause contains a potentially unsafe pattern' };
    }
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

  if (/[`]/.test(sqlQuery.replace(/'[^']*'/g, ''))) {
    return { safe: false, reason: 'Backtick-quoted identifiers are not allowed' };
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
    if (!TABLES_NEEDING_DIRECT_ORG_FILTER.has(table) && !TABLES_ORG_VIA_PROJECT_JOIN.has(table) && !(table in TABLES_CUSTOM_ORG_CTE)) {
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
    } else if (table in TABLES_CUSTOM_ORG_CTE) {
      cteParts.push(TABLES_CUSTOM_ORG_CTE[table]);
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

router.post("/ai/ask-database", requireAuth, requireFeaturePermission('canUseAiFeatures'), async (req: AuthRequest, res, next) => {
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

    let sqlResult!: { sql: string | null; explanation: string; needsOrgFilter: boolean };

    const MAX_RETRIES = 2;
    let lastSafetyReason: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0 && lastSafetyReason) {
        sqlGenMessages.push({
          role: 'user',
          content: `Your previous query was rejected because: ${lastSafetyReason}. Please regenerate a valid query. IMPORTANT FORMATTING RULES:
- Output ONLY the JSON object, no markdown code fences.
- Do NOT use double-quoted identifiers (e.g. "projects") — use bare names: projects
- Do NOT use backtick-quoted identifiers.
- Do NOT use schema-qualified names like public.projects.
- Do NOT use subqueries, CTEs, UNION, parameter placeholders ($1), or semicolons.
- Use only a single SELECT statement with JOINs if needed.

Example of a correct response:
{"sql": "SELECT COUNT(*) AS total FROM projects WHERE status = 'ACTIVE'", "explanation": "Counts active projects", "needsOrgFilter": true}`,
        });
      }

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
            max_completion_tokens: 1000,
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

      const rawSql = sqlResult.sql;
      sqlResult.sql = normalizeSqlFromAI(sqlResult.sql);

      const safety = validateSqlSafety(sqlResult.sql);
      if (safety.safe) {
        break;
      }

      lastSafetyReason = safety.reason;
      logWarn("Ask-database SQL failed validation", {
        attempt: attempt + 1,
        reason: safety.reason || 'unknown',
        question: question.substring(0, 200),
        rawAiSql: rawSql,
        normalizedSql: sqlResult.sql.substring(0, 500),
        aiResponse: JSON.stringify(governed.result),
      });

      if (attempt === MAX_RETRIES) {
        return res.json({
          answer: "I wasn't able to generate a safe query for that question. Could you try rephrasing it?",
          queryExecuted: false,
        });
      }
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
          max_completion_tokens: 1000,
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

    next(error);
  }
});

export default router;
