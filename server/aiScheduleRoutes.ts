import { Router, type Response } from "express";
import { db } from "./db";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { 
  projects, scopeItems, estimateLineItems, estimates, changeOrders,
  projectDelays, dailyScopeProgress, projectSchedules, projectScheduleTasks,
  organizationSowItems
} from "@shared/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { openai } from "./ai/openaiClient";

const router = Router();

const VALID_TRADE_TYPES = [
  "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING",
  "ELECTRICAL", "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL",
  "PAINTING", "FLOORING", "LANDSCAPING", "DEMOLITION", "STEEL_ERECTION",
  "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE", "SOLAR",
  "WATERPROOFING", "OTHER", "SITE_DEMOLITION", "MASS_EXCAVATION", "TRENCHING",
  "SHORING", "DEWATERING", "SOIL_STABILIZATION", "ENVIRONMENTAL_REMEDIATION",
  "WELL_PLUGGING", "STORMWATER_SYSTEMS", "SANITARY_SEWER", "WATERLINE",
  "FORCE_MAIN", "ROADWAY_CONSTRUCTION", "CURB_AND_GUTTER", "SIDEWALK",
  "CONCRETE_PAVING", "TRAFFIC_CONTROL", "STRIPING_AND_SIGNAGE", "EROSION_CONTROL",
  "FENCING_AND_GATES", "CAST_IN_PLACE_CONCRETE", "PRECAST_CONCRETE",
  "REBAR_AND_POST_TENSION", "STRUCTURAL_STEEL", "METAL_BUILDINGS",
  "CARPENTRY_FRAMING", "DRYWALL_SYSTEMS", "ACOUSTICAL_CEILINGS",
  "PAINTING_AND_COATINGS", "FLOORING_SYSTEMS", "ROOFING_SYSTEMS",
  "MASONRY_SYSTEMS", "GLAZING_SYSTEMS", "ELECTRICAL_UNDERGROUND",
  "ELECTRICAL_OVERHEAD", "MECHANICAL_PIPING", "HVAC_SYSTEMS", "PLUMBING_SYSTEMS",
  "FIRE_PROTECTION_SYSTEMS", "LOW_VOLTAGE_SYSTEMS", "SECURITY_AND_ACCESS",
  "COMMUNICATIONS_IT", "SOLAR_INSTALLATION", "TEMPORARY_POWER",
  "SURVEY_AND_LAYOUT", "TESTING_AND_INSPECTIONS", "COMMISSIONING",
  "TEMPORARY_FACILITIES", "GENERAL_CONDITIONS"
] as const;

function normalizeTradeType(tradeType: string | undefined | null): string | null {
  if (!tradeType) return null;
  const normalized = tradeType.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (VALID_TRADE_TYPES.includes(normalized as any)) {
    return normalized;
  }
  return null;
}

interface ScheduleTaskData {
  name: string;
  description: string;
  durationDays: number;
  dependencies: string[];
  isCriticalPath: boolean;
  isMilestone: boolean;
  tradeType?: string;
  sowItemIds?: string[];
  sequenceOrder: number;
}

interface AIScheduleResponse {
  schedule_name: string;
  baseline_start_date: string;
  baseline_end_date: string;
  ai_notes: string;
  delay_adjustment_days: number;
  change_order_impact_days: number;
  tasks: ScheduleTaskData[];
}

router.post("/api/projects/:code/ai-schedule", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.params;
    const { startDate: rawStartDate } = req.body;
    const orgId = req.user?.organizationId;

    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const startDate = rawStartDate || new Date().toISOString().split('T')[0];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
      res.status(400).json({ error: "Invalid start date format. Use YYYY-MM-DD." });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.code, code));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.gcOrganizationId !== orgId && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const projectScopeItems = await db
      .select({
        id: scopeItems.id,
        description: scopeItems.description,
        unit: scopeItems.unit,
        totalQuantity: scopeItems.totalQuantity,
        completedQuantity: scopeItems.completedQuantity,
        organizationSowItemId: scopeItems.organizationSowItemId,
      })
      .from(scopeItems)
      .where(eq(scopeItems.projectId, project.id));

    const projectEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, project.id))
      .orderBy(desc(estimates.createdAt))
      .limit(1);

    let lineItems: any[] = [];
    if (projectEstimates.length > 0) {
      lineItems = await db
        .select({
          id: estimateLineItems.id,
          description: estimateLineItems.description,
          quantity: estimateLineItems.quantity,
          unit: estimateLineItems.unit,
          laborHours: estimateLineItems.laborHours,
          category: estimateLineItems.category,
          workTypeCode: estimateLineItems.workTypeCode,
        })
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, projectEstimates[0].id));
    }

    const projectChangeOrders = await db
      .select({
        id: changeOrders.id,
        changeOrderNumber: changeOrders.changeOrderNumber,
        description: changeOrders.description,
        amount: changeOrders.amount,
        status: changeOrders.status,
        workTypeCode: changeOrders.workTypeCode,
      })
      .from(changeOrders)
      .where(and(
        eq(changeOrders.projectId, project.id),
        eq(changeOrders.status, "APPROVED")
      ));

    const delays = await db
      .select({
        id: projectDelays.id,
        delayNumber: projectDelays.delayNumber,
        reason: projectDelays.reason,
        reasonNotes: projectDelays.reasonNotes,
        startDateTime: projectDelays.startDateTime,
        endDateTime: projectDelays.endDateTime,
        estimatedDuration: projectDelays.estimatedDuration,
        status: projectDelays.status,
      })
      .from(projectDelays)
      .where(eq(projectDelays.projectId, project.id));

    let productionRates: any[] = [];
    const sowItemIds = projectScopeItems
      .map(s => s.organizationSowItemId)
      .filter((id): id is string => id !== null);
    
    if (sowItemIds.length > 0) {
      const progressData = await db
        .select({
          organizationSowItemId: dailyScopeProgress.organizationSowItemId,
          quantityCompleted: dailyScopeProgress.quantityCompleted,
          laborHours: dailyScopeProgress.laborHours,
          crewSize: dailyScopeProgress.crewSize,
        })
        .from(dailyScopeProgress)
        .where(and(
          inArray(dailyScopeProgress.organizationSowItemId, sowItemIds),
          eq(dailyScopeProgress.projectId, project.id)
        ));

      const ratesBySowItem = new Map<string, { totalQty: number; totalHours: number; count: number }>();
      for (const p of progressData) {
        if (p.organizationSowItemId && p.quantityCompleted && p.laborHours) {
          const existing = ratesBySowItem.get(p.organizationSowItemId) || { totalQty: 0, totalHours: 0, count: 0 };
          existing.totalQty += parseFloat(p.quantityCompleted);
          existing.totalHours += parseFloat(p.laborHours);
          existing.count++;
          ratesBySowItem.set(p.organizationSowItemId, existing);
        }
      }
      
      productionRates = Array.from(ratesBySowItem.entries()).map(([sowItemId, data]) => ({
        sowItemId,
        avgQuantityPerHour: data.totalHours > 0 ? data.totalQty / data.totalHours : 0,
        dataPoints: data.count,
      }));
    }

    const systemPrompt = `You are an expert construction project scheduler with deep knowledge of construction sequencing, dependencies, and realistic duration estimation.
You analyze scope of work, estimate line items, change orders, historical delays, and production rates to generate accurate construction schedules.
Consider:
1. Logical sequencing of construction activities (site prep → foundation → structure → MEP → finishes)
2. Weather and seasonal impacts based on delay history
3. Resource constraints and crew productivity from production rates
4. Change order scope additions that extend timelines
5. Critical path identification

Respond in valid JSON with this structure:
{
  "schedule_name": "AI Generated Master Schedule",
  "baseline_start_date": "YYYY-MM-DD",
  "baseline_end_date": "YYYY-MM-DD",
  "ai_notes": "Summary of schedule assumptions and key risks",
  "delay_adjustment_days": 0,
  "change_order_impact_days": 0,
  "tasks": [
    {
      "name": "Task Name",
      "description": "Detailed task description",
      "durationDays": 5,
      "dependencies": [],
      "isCriticalPath": true,
      "isMilestone": false,
      "tradeType": "CONCRETE",
      "sowItemIds": ["scope-item-id"],
      "sequenceOrder": 1
    }
  ]
}`;

    const userPrompt = `Generate a comprehensive construction schedule for this project:

PROJECT: ${project.name} (Code: ${project.code})
Requested Start Date: ${startDate || 'ASAP - use today'}

SCOPE ITEMS (${projectScopeItems.length} items):
${projectScopeItems.map(s => `- ${s.description}: ${s.totalQuantity} ${s.unit} (${s.completedQuantity || 0} completed)`).join('\n')}

ESTIMATE LINE ITEMS (${lineItems.length} items):
${lineItems.map(l => `- ${l.description}: ${l.quantity} ${l.unit}, ${l.laborHours}hrs labor, Category: ${l.category}`).join('\n')}

APPROVED CHANGE ORDERS (${projectChangeOrders.length}):
${projectChangeOrders.map(c => `- CO#${c.changeOrderNumber}: ${c.description} (+$${c.amount})`).join('\n') || 'None'}

HISTORICAL DELAYS (${delays.length}):
${delays.map(d => {
  const duration = d.endDateTime && d.startDateTime 
    ? Math.ceil((new Date(d.endDateTime).getTime() - new Date(d.startDateTime).getTime()) / (1000 * 60 * 60 * 24))
    : d.estimatedDuration || 'Ongoing';
  return `- ${d.reason}: ${duration} days - ${d.reasonNotes || 'No notes'}`;
}).join('\n') || 'None'}

PRODUCTION RATES (historical data):
${productionRates.map(r => `- SOW Item ${r.sowItemId}: ${r.avgQuantityPerHour.toFixed(2)} units/hr (${r.dataPoints} data points)`).join('\n') || 'No historical data - use industry standards'}

Generate a realistic schedule that:
1. Sequences tasks logically for construction workflow
2. Accounts for delay patterns (add buffer for ${delays.filter(d => d.reason === 'WEATHER').length} weather delays)
3. Includes change order scope in timeline
4. Uses production rates where available, industry standards otherwise
5. Identifies critical path tasks
6. Includes key milestones`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000,
    });

    const responseContent = completion.choices[0]?.message?.content;
    if (!responseContent) {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    let aiResponse: AIScheduleResponse;
    try {
      aiResponse = JSON.parse(responseContent);
    } catch (parseError) {
      console.error("Failed to parse AI response:", responseContent);
      res.status(500).json({ error: "Failed to parse AI schedule response" });
      return;
    }

    const existingSchedules = await db
      .select()
      .from(projectSchedules)
      .where(and(
        eq(projectSchedules.projectId, project.id),
        eq(projectSchedules.isActive, true)
      ));
    
    if (existingSchedules.length > 0) {
      await db
        .update(projectSchedules)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(projectSchedules.id, existingSchedules.map(s => s.id)));
    }

    const [newSchedule] = await db
      .insert(projectSchedules)
      .values({
        organizationId: orgId,
        projectId: project.id,
        name: aiResponse.schedule_name || "AI Generated Schedule",
        generatedBy: "AI",
        baselineStartDate: aiResponse.baseline_start_date,
        baselineEndDate: aiResponse.baseline_end_date,
        aiNotes: aiResponse.ai_notes,
        optionsJson: JSON.stringify({
          delayAdjustmentDays: aiResponse.delay_adjustment_days,
          changeOrderImpactDays: aiResponse.change_order_impact_days,
          generatedAt: new Date().toISOString(),
        }),
        isActive: true,
      })
      .returning();

    const taskInserts = aiResponse.tasks.map((task, index) => ({
      scheduleId: newSchedule.id,
      name: task.name,
      description: task.description,
      durationDays: task.durationDays,
      dependencies: task.dependencies || [],
      isCriticalPath: task.isCriticalPath || false,
      isMilestone: task.isMilestone || false,
      tradeType: normalizeTradeType(task.tradeType) as any,
      sowItemIds: task.sowItemIds || [],
      percentComplete: 0,
      plannedStartDate: calculateTaskStartDate(aiResponse.baseline_start_date, aiResponse.tasks, index),
      plannedEndDate: calculateTaskEndDate(aiResponse.baseline_start_date, aiResponse.tasks, index),
    }));

    if (taskInserts.length > 0) {
      await db.insert(projectScheduleTasks).values(taskInserts);
    }

    const createdTasks = await db
      .select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, newSchedule.id));

    res.json({
      schedule: newSchedule,
      tasks: createdTasks,
      summary: {
        totalTasks: createdTasks.length,
        criticalPathTasks: createdTasks.filter(t => t.isCriticalPath).length,
        milestones: createdTasks.filter(t => t.isMilestone).length,
        delayAdjustmentDays: aiResponse.delay_adjustment_days,
        changeOrderImpactDays: aiResponse.change_order_impact_days,
      }
    });

  } catch (error) {
    console.error("AI Schedule generation error:", error);
    res.status(500).json({ error: "Failed to generate schedule. Please try again." });
  }
});

function calculateTaskStartDate(baselineStart: string, tasks: ScheduleTaskData[], currentIndex: number): string {
  let startDate = new Date(baselineStart);
  
  for (let i = 0; i < currentIndex; i++) {
    const prevTask = tasks[i];
    const currentTask = tasks[currentIndex];
    
    if (currentTask.dependencies?.includes(prevTask.name) || 
        (currentTask.dependencies?.length === 0 && i === currentIndex - 1)) {
      startDate.setDate(startDate.getDate() + prevTask.durationDays);
    }
  }
  
  return startDate.toISOString().split('T')[0];
}

function calculateTaskEndDate(baselineStart: string, tasks: ScheduleTaskData[], currentIndex: number): string {
  const startDateStr = calculateTaskStartDate(baselineStart, tasks, currentIndex);
  const startDate = new Date(startDateStr);
  const task = tasks[currentIndex];
  
  startDate.setDate(startDate.getDate() + task.durationDays);
  return startDate.toISOString().split('T')[0];
}

router.patch("/api/projects/:code/schedule/tasks/:taskId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { code, taskId } = req.params;
    const orgId = req.user?.organizationId;

    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.code, code));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.gcOrganizationId !== orgId && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const taskWithSchedule = await db
      .select({
        task: projectScheduleTasks,
        scheduleProjectId: projectSchedules.projectId,
      })
      .from(projectScheduleTasks)
      .innerJoin(projectSchedules, eq(projectScheduleTasks.scheduleId, projectSchedules.id))
      .where(eq(projectScheduleTasks.id, taskId))
      .limit(1);
    
    if (taskWithSchedule.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (taskWithSchedule[0].scheduleProjectId !== project.id) {
      res.status(403).json({ error: "Task does not belong to this project" });
      return;
    }

    const { name, description, plannedStartDate, plannedEndDate, actualStartDate, actualEndDate, percentComplete, isCriticalPath } = req.body;

    if (percentComplete !== undefined && (percentComplete < 0 || percentComplete > 100)) {
      res.status(400).json({ error: "percentComplete must be between 0 and 100" });
      return;
    }

    const [updatedTask] = await db
      .update(projectScheduleTasks)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(plannedStartDate !== undefined && { plannedStartDate }),
        ...(plannedEndDate !== undefined && { plannedEndDate }),
        ...(actualStartDate !== undefined && { actualStartDate }),
        ...(actualEndDate !== undefined && { actualEndDate }),
        ...(percentComplete !== undefined && { percentComplete }),
        ...(isCriticalPath !== undefined && { isCriticalPath }),
        updatedAt: new Date(),
      })
      .where(eq(projectScheduleTasks.id, taskId))
      .returning();

    res.json(updatedTask);
  } catch (error) {
    console.error("Update schedule task error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/schedule", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.params;
    const orgId = req.user?.organizationId;

    const [project] = await db.select().from(projects).where(eq(projects.code, code));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.gcOrganizationId !== orgId && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [schedule] = await db
      .select()
      .from(projectSchedules)
      .where(and(
        eq(projectSchedules.projectId, project.id),
        eq(projectSchedules.isActive, true)
      ))
      .orderBy(desc(projectSchedules.createdAt))
      .limit(1);

    if (!schedule) {
      res.json({ schedule: null, tasks: [] });
      return;
    }

    const tasks = await db
      .select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, schedule.id));

    res.json({ schedule, tasks });

  } catch (error) {
    console.error("Get schedule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
