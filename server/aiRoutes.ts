import { Router } from "express";
import { db } from "./db";
import { aiSettings, aiRuns, aiTasks, insertAISettingsSchema } from "@shared/schema";
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

// AI Assistant Chat endpoint
router.post("/ai/assistant/chat", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { message, currentPath, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    // Build context based on current page
    const pageContext = getPageContext(currentPath || '/dashboard');
    const userRole = req.user.role;
    const userName = `${req.user.firstName} ${req.user.lastName}`;

    // Build messages array with conversation history
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { 
        role: 'system', 
        content: `${AI_ASSISTANT_SYSTEM_PROMPT}

## Current Context
- User: ${userName}
- Role: ${userRole}
- ${pageContext}

Tailor your responses to the user's role and current location in the app.`
      }
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
