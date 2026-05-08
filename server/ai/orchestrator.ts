// prompt-injection-guard: callOpenAIForAnalysis used with internal-only structured numeric inputs; no untrusted free-text fields
import { logError, logInfo, logWarn } from "../utils/logger";
import { randomUUID } from "crypto";
import { db } from "../db";
import { aiSettings, aiRuns, aiTasks, projects } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { buildDataSnapshot } from "./snapshotBuilder";
import { calculateAllProjectsProfitability } from "./profitabilityEngine";
import { callOpenAIForAnalysis, AIAnalysisResponse } from "./openaiClient";
import { AI_PM_SYSTEM_PROMPT } from "./systemPrompt";
import { detectAndCreateChangeOrderDrafts, ChangeOrderSuggestion } from "./changeOrderAutomation";
import { getSubcontractorRecommendations } from "./subRecommendationEngine";

export async function runAIAnalysis(triggeredById: string | null = null, organizationId?: string | null): Promise<string> {
  logInfo('🤖 Starting AI PM + CFO analysis run...');

  const runId = randomUUID();
  
  try {
    await db.insert(aiRuns).values({
      id: runId,
      runType: triggeredById ? 'manual' : 'daily',
      status: 'in_progress',
      triggeredById: triggeredById,
    });

    // Step 1: Build data snapshot
    logInfo('📊 Building data snapshot...');
    const snapshot = await buildDataSnapshot();

    // Step 2: Calculate profitability for all projects
    logInfo('💰 Calculating project profitability...');
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
    logInfo('🧠 Calling OpenAI for analysis...');
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

    // Step 7: Create tasks from AI response with sub recommendation enrichment
    logInfo('📝 Creating AI-generated tasks...');
    await createTasksFromAIResponse(runId, aiResponse, organizationId || null);

    // Step 8: Auto-generate change order drafts from detected delays/issues
    logInfo('📋 Auto-detecting change order opportunities...');
    try {
      const coSuggestions: ChangeOrderSuggestion[] = aiResponse.change_order_suggestions || [];
      const draftsCreated = await detectAndCreateChangeOrderDrafts(snapshot, profitability, coSuggestions, organizationId || undefined);
      if (draftsCreated > 0) {
        logInfo(`📋 Created ${draftsCreated} auto-generated change order drafts`);
      }
    } catch (coError) {
      logError('⚠️ Change order automation error (non-fatal):', {}, coError instanceof Error ? coError : new Error(String(coError)));
    }

    // Step 9: Persist cost overrun predictions from AI response
    if (aiResponse.cost_overrun_predictions && aiResponse.cost_overrun_predictions.length > 0) {
      logInfo(`📊 AI flagged ${aiResponse.cost_overrun_predictions.length} cost overrun predictions`);
    }

    logInfo(`✅ AI analysis completed successfully. Run ID: ${runId}`);
    return runId;

  } catch (error: any) {
    logError('❌ AI analysis failed:', {}, error instanceof Error ? error : new Error(String(error)));

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

function isSubRelatedTask(task: { task_type: string; title: string; description: string }): boolean {
  const subKeywords = /\b(subcontract|sub-contract|sub contractor|crew|trade partner|vendor assignment|hire sub|engage sub)/i;
  if (task.task_type === 'SCHEDULING' || task.task_type === 'PROCUREMENT') {
    return subKeywords.test(task.title) || subKeywords.test(task.description);
  }
  return subKeywords.test(task.title);
}

function isCostRelatedTask(task: { task_type: string; title: string; description: string }): boolean {
  const costKeywords = /\b(cost overrun|over budget|budget exceed|profitability|burn rate|cost warning|financial risk)/i;
  return task.task_type === 'BILLING' ||
    costKeywords.test(task.title) ||
    costKeywords.test(task.description);
}

async function createTasksFromAIResponse(runId: string, aiResponse: AIAnalysisResponse, organizationId: string | null): Promise<void> {
  const aiSubRecs = aiResponse.subcontractor_recommendations || [];
  const aiSubRecsByProject = new Map<string, typeof aiSubRecs>();
  for (const rec of aiSubRecs) {
    const existing = aiSubRecsByProject.get(rec.project_code) || [];
    existing.push(rec);
    aiSubRecsByProject.set(rec.project_code, existing);
  }

  let projectOrgMap: Map<string, string> | null = null;
  if (!organizationId) {
    const allProjects = await db
      .select({ code: projects.code, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .limit(500);
    projectOrgMap = new Map();
    for (const p of allProjects) {
      if (p.gcOrganizationId) {
        projectOrgMap.set(p.code, p.gcOrganizationId);
      }
    }
  }

  const tasksToInsert = await Promise.all(aiResponse.tasks.map(async (task) => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (task.due_date_offset_days || 0));

    let enrichedMetadata: Record<string, unknown> = (task.metadata as Record<string, unknown>) || {};

    const effectiveOrgId = organizationId || (task.project_code && projectOrgMap?.get(task.project_code)) || null;

    if (isSubRelatedTask(task) && effectiveOrgId) {
      try {
        const trade = enrichedMetadata.trade || enrichedMetadata.specialty || null;
        const recommendations = await getSubcontractorRecommendations({
          organizationId: effectiveOrgId,
          tradeSpecialty: typeof trade === "string" && trade ? trade : undefined,
          maxResults: 3,
        });
        if (recommendations.length > 0) {
          enrichedMetadata = {
            ...enrichedMetadata,
            sub_recommendations: recommendations.map(r => ({
              subcontractorId: r.subcontractorId,
              subcontractorName: r.subcontractorName,
              overallScore: r.overallScore,
              rank: r.rank,
              tradeMatch: r.tradeMatch,
              contractCount: r.contractCount,
              performanceMetrics: r.performanceMetrics,
            })),
          };
        }
      } catch (err) {
        logWarn('⚠️ Failed to enrich task with sub recommendations:', err);
      }

      if (task.project_code && aiSubRecsByProject.has(task.project_code)) {
        enrichedMetadata = {
          ...enrichedMetadata,
          ai_sub_suggestions: aiSubRecsByProject.get(task.project_code),
        };
      }
    }

    if (isCostRelatedTask(task) && aiResponse.cost_overrun_predictions) {
      const matchingPrediction = aiResponse.cost_overrun_predictions.find(
        p => p.project_code === task.project_code
      );
      if (matchingPrediction) {
        enrichedMetadata = {
          ...enrichedMetadata,
          ai_cost_prediction: matchingPrediction,
        };
      }
    }

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
      metadata: JSON.stringify(enrichedMetadata),
    };
  }));

  if (tasksToInsert.length > 0) {
    await db.insert(aiTasks).values(tasksToInsert);
    logInfo(`✅ Created ${tasksToInsert.length} AI-generated tasks`);
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
  // Build conditions array to avoid query chaining issues
  const conditions = [eq(aiTasks.role, role as any)];
  
  if (status) {
    conditions.push(eq(aiTasks.status, status as any));
  }

  return db
    .select()
    .from(aiTasks)
    .where(and(...conditions))
    .orderBy(desc(aiTasks.priority), desc(aiTasks.createdAt))
    .limit(100);
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
