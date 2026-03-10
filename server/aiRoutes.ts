import { Router } from "express";
import { db } from "./db";
import { aiSettings, aiRuns, aiTasks, insertAISettingsSchema, users } from "@shared/schema";
import { logInfo, logError } from "./utils/logger";
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
import { sanitizeShortText } from "./sanitization";
import { fromZodError } from "zod-validation-error";
import { type AuthRequest, requireAuth, requireRole, requireFeaturePermission, requireAnyFeaturePermission } from "./auth";
import { openai } from "./ai/openaiClient";
import { AI_ASSISTANT_SYSTEM_PROMPT, getPageContext } from "./ai/assistantPrompt";
import { z } from "zod";
import { governedAiCall } from "./services/aiGovernance";
import { getTotalStepsForRole, getWalkthroughStep, generateWalkthroughPrompt, getPersonalizedWalkthrough, personalizeContent } from "./ai/walkthroughContent";

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
import { equipment as equipmentTable } from "@shared/schema";

const router = Router();
router.use("/ai-settings", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai-pm", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/cfo", requireAuth, requireAnyFeaturePermission('canUseAiFeatures', 'canAccessFinancials'));
router.use("/ai-analyze", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai/assistant", requireAuth, requireFeaturePermission('canUseAiFeatures'));

router.get("/ai-settings", requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
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

router.patch("/ai-settings", sensitiveLimiter, requireRole("ADMIN"), async (req: AuthRequest, res) => {
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
  } catch (error: any) {
    console.error("Error updating AI settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai-pm/run", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (orgId) {
      const { checkOrgLimits } = await import("./services/aiGovernance");
      const limitCheck = await checkOrgLimits(orgId);
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: "AI rate limit reached", reason: limitCheck.reason });
      }
    }

    const runId = await runAIAnalysis(req.user!.id);

    if (orgId) {
      const { db: dbConn } = await import("./db");
      const { aiActionAudit } = await import("@shared/schema");
      try {
        await dbConn.insert(aiActionAudit).values({
          organizationId: orgId,
          actorUserId: req.user!.id,
          actionType: "ai_pm_analysis",
          model: "gpt-4o",
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
  } catch (error: any) {
    console.error("Error running AI analysis:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/latest-run", requireAuth, async (req: AuthRequest, res) => {
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
  } catch (error: any) {
    console.error("Error fetching latest AI run:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/runs/:runId", requireAuth, async (req: AuthRequest, res) => {
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
  } catch (error: any) {
    console.error("Error fetching AI run:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/tasks", requireAuth, async (req: AuthRequest, res) => {
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
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/tasks/role/:role", requireAuth, async (req: AuthRequest, res) => {
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
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/ai-pm/tasks/:taskId", requireAuth, async (req: AuthRequest, res) => {
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
  } catch (error: any) {
    console.error("Error updating AI task:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/profitability", requireAuth, async (req: AuthRequest, res) => {
  try {
    const latestRun = await getLatestAIRun();

    if (latestRun?.profitabilityData) {
      const profitabilityData = JSON.parse(latestRun.profitabilityData);
      return res.json(profitabilityData);
    }

    const { calculateAllProjectsProfitability } = await import("./ai/profitabilityEngine");
    const liveData = await calculateAllProjectsProfitability();
    res.json(liveData);
  } catch (error: any) {
    console.error("Error fetching profitability data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/equipment-metrics", requireAuth, async (req: AuthRequest, res) => {
  try {
    const latestRun = await getLatestAIRun();

    if (!latestRun || !latestRun.snapshotData) {
      const allEquipment = await db.select().from(equipmentTable).where(eq(equipmentTable.organizationId, req.user.organizationId)).limit(500);
      const totalCount = allEquipment.length;
      const assignedCount = allEquipment.filter((e: any) => e.status === 'ASSIGNED').length;

      return res.json({
        summary: {
          total_owned_equipment: totalCount,
          active_rentals: assignedCount,
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

    const fleetSize = equipment.fleet?.length || 0;
    const activeRentals = equipment.active_rentals?.length || 0;
    const rentalHistory = equipment.rental_usage_history || [];
    
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdRentals = rentalHistory.filter((r: any) => {
      const startDate = r.actual_start_date ? new Date(r.actual_start_date) : null;
      return startDate && startDate >= monthStart;
    });
    const totalRentalCostMtd = mtdRentals.reduce((sum: number, r: any) => 
      sum + (r.actual_total_cost || r.quoted_total_cost || 0), 0
    );

    const underutilizedCount = roiAnalysis.underutilized_owned?.length || 0;

    const projectsWithEquipment = equipment.projects_with_equipment || [];
    const projectCosts = projectsWithEquipment.map((p: any) => {
      const planned = Number(p.planned_cost) || 0;
      const actual = Number(p.actual_cost) || 0;
      const total = actual > 0 ? actual : planned;
      return {
        project_code: p.project_code,
        project_name: p.project_name,
        planned_cost: planned,
        actual_cost: actual,
        total_cost: total,
      };
    });

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

router.get("/ai-pm/runs", requireAuth, async (req: AuthRequest, res) => {
  try {
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

router.post("/ai/assistant/chat", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("AI Assistant chat error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to get AI response. Please try again." });
  }
});

const aiAnalysisSchema = z.object({
  module: z.enum(['SCHEDULING', 'DELAYS', 'COSTS', 'EQUIPMENT', 'VENDOR_PRICING', 'PROJECT_HEALTH', 'ALL']).optional(),
  projectId: z.string().optional(),
  saveResults: z.boolean().optional().default(true),
});

router.post("/ai-analyze", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
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
    console.error("AI analysis error:", error);
    res.status(500).json({ error: "Failed to run AI analysis" });
  }
});

export default router;
