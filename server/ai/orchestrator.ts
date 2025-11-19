import { randomUUID } from "crypto";
import { db } from "../db";
import { aiSettings, aiRuns, aiTasks } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { buildDataSnapshot } from "./snapshotBuilder";
import { calculateAllProjectsProfitability } from "./profitabilityEngine";
import { callOpenAIForAnalysis, AIAnalysisResponse } from "./openaiClient";
import { AI_PM_SYSTEM_PROMPT } from "./systemPrompt";

export async function runAIAnalysis(triggeredById: string | null = null): Promise<string> {
  console.log('🤖 Starting AI PM + CFO analysis run...');

  const runId = randomUUID();
  
  try {
    // Create initial run record
    await db.insert(aiRuns).values({
      id: runId,
      runType: triggeredById ? 'manual' : 'daily',
      status: 'in_progress',
      triggeredById: triggeredById,
    });

    // Step 1: Build data snapshot
    console.log('📊 Building data snapshot...');
    const snapshot = await buildDataSnapshot();

    // Step 2: Calculate profitability for all projects
    console.log('💰 Calculating project profitability...');
    const profitability = await calculateAllProjectsProfitability();

    // Step 3: Get AI settings
    const [settings] = await db
      .select()
      .from(aiSettings)
      .limit(1);

    if (!settings) {
      throw new Error('AI settings not found. Please initialize settings first.');
    }

    // Step 4: Build user prompt
    const userPrompt = buildUserPrompt(snapshot, profitability, settings);

    // Step 5: Call OpenAI
    console.log('🧠 Calling OpenAI for analysis...');
    const aiResponse = await callOpenAIForAnalysis(
      AI_PM_SYSTEM_PROMPT,
      userPrompt,
      settings.modelName
    );

    // Step 6: Persist AI response and create tasks
    await db
      .update(aiRuns)
      .set({
        snapshotData: JSON.stringify(snapshot),
        profitabilityData: JSON.stringify(profitability),
        aiResponse: JSON.stringify(aiResponse),
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, runId));

    // Step 7: Create tasks from AI response
    console.log('📝 Creating AI-generated tasks...');
    await createTasksFromAIResponse(runId, aiResponse);

    console.log(`✅ AI analysis completed successfully. Run ID: ${runId}`);
    return runId;

  } catch (error: any) {
    console.error('❌ AI analysis failed:', error);

    // Update run with error
    await db
      .update(aiRuns)
      .set({
        status: 'failed',
        errorMessage: error.message || 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, runId));

    throw error;
  }
}

function buildUserPrompt(snapshot: any, profitability: any[], settings: any): string {
  const enabledFeatures = [];
  if (settings.roleTasksEnabled) enabledFeatures.push('role-based tasks');
  if (settings.billingAlertsEnabled) enabledFeatures.push('billing alerts');
  if (settings.profitabilityWarningsEnabled) enabledFeatures.push('profitability warnings');
  if (settings.crewSchedulingEnabled) enabledFeatures.push('crew scheduling');
  if (settings.bidRemindersEnabled) enabledFeatures.push('bid reminders');
  if (settings.materialOrderingEnabled) enabledFeatures.push('material ordering');

  return `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

**Enabled Features**: ${enabledFeatures.join(', ')}

**COMPLETE DATA SNAPSHOT**:
${JSON.stringify(snapshot, null, 2)}

**PROJECT PROFITABILITY ANALYSIS**:
${JSON.stringify(profitability, null, 2)}

Based on this comprehensive data, generate your daily analysis with role-specific tasks, profitability insights, crew scheduling recommendations, material ordering alerts, bid reminders, and billing insights.

Remember:
- Be specific and actionable
- Reference actual project codes, amounts, and deadlines
- Prioritize based on financial impact and urgency
- Generate 10-30 tasks across all roles
- Flag issues proactively
- Include context from the data

Respond with valid JSON matching the required structure.`;
}

async function createTasksFromAIResponse(runId: string, aiResponse: AIAnalysisResponse): Promise<void> {
  const tasksToInsert = aiResponse.tasks.map(task => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (task.due_date_offset_days || 0));

    return {
      runId: runId,
      taskType: task.task_type,
      role: task.role,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: 'PENDING' as const,
      dueDate: dueDate,
      projectCode: task.project_code,
      metadata: JSON.stringify(task.metadata),
    };
  });

  if (tasksToInsert.length > 0) {
    await db.insert(aiTasks).values(tasksToInsert);
    console.log(`✅ Created ${tasksToInsert.length} AI-generated tasks`);
  }
}

export async function getLatestAIRun() {
  const [latestRun] = await db
    .select()
    .from(aiRuns)
    .where(eq(aiRuns.status, 'completed'))
    .orderBy(desc(aiRuns.createdAt))
    .limit(1);

  return latestRun;
}

export async function getAIRunById(runId: string) {
  const [run] = await db
    .select()
    .from(aiRuns)
    .where(eq(aiRuns.id, runId))
    .limit(1);

  return run;
}

export async function getTasksForRun(runId: string) {
  return db
    .select()
    .from(aiTasks)
    .where(eq(aiTasks.runId, runId))
    .orderBy(desc(aiTasks.createdAt));
}

export async function getTasksForRole(role: string, status?: string) {
  let query = db
    .select()
    .from(aiTasks)
    .where(eq(aiTasks.role, role as any));

  if (status) {
    query = query.where(eq(aiTasks.status, status as any)) as any;
  }

  return query.orderBy(desc(aiTasks.priority), desc(aiTasks.createdAt)).limit(100);
}

export async function updateTaskStatus(taskId: string, status: string, userId?: string) {
  const updates: any = {
    status: status as any,
  };

  if (status === 'COMPLETED') {
    updates.completedAt = new Date();
  }

  if (status === 'IN_PROGRESS' && userId) {
    updates.assignedToId = userId;
  }

  await db
    .update(aiTasks)
    .set(updates)
    .where(eq(aiTasks.id, taskId));
}
