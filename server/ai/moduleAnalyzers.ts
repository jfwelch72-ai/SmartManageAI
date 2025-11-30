import { db } from "../db";
import { 
  projects, 
  projectDelays,
  equipment,
  equipmentAssignments,
  projectEquipmentPlans,
  vendorPricingCatalogs,
  crmOrganisations,
  tasks,
  changeOrders,
  bids,
  timeEntries,
  users,
  aiInsights,
  aiGanttRecommendations,
  aiVendorComparisons,
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte, isNull } from "drizzle-orm";
import { openai, AI_MODEL_GPT4O } from "./openaiClient";

export interface ModuleAnalysisResult {
  insights: {
    module: string;
    severity: "INFO" | "SUGGESTION" | "WARNING" | "CRITICAL";
    title: string;
    summary: string;
    details?: string;
    recommendations: string[];
    metrics?: Record<string, any>;
    affectedEntities?: string[];
    estimatedImpact?: string;
    actionItems?: string[];
  }[];
  ganttRecommendations?: {
    recommendationType: string;
    title: string;
    description: string;
    suggestedTasks?: any[];
    suggestedDependencies?: any[];
    estimatedDaysImprovement?: number;
    estimatedCostSavings?: number;
  }[];
  vendorComparisons?: {
    materialCategory: string;
    analysisData: any;
    recommendedVendorId?: string;
    recommendedVendorName?: string;
    potentialSavings?: number;
    priceConfidence?: number;
  }[];
}

const AI_MODULE_SYSTEM_PROMPT = `You are an expert construction project analyst AI assistant. Your role is to analyze construction project data and provide actionable insights to optimize operations, reduce costs, and improve scheduling.

You provide analysis in these key areas:
1. SCHEDULING - Analyze task timelines, dependencies, and suggest optimal scheduling
2. DELAYS - Identify delay patterns, calculate financial impacts, suggest preventive measures
3. COSTS - Analyze equipment, labor, material costs and find optimization opportunities
4. EQUIPMENT - Track utilization, maintenance, rental vs purchase decisions
5. VENDOR_PRICING - Compare vendor prices, identify best deals, track pricing trends
6. PROJECT_HEALTH - Overall project health scoring based on multiple factors
7. GANTT_CHART - Generate Gantt chart recommendations with task ordering and dependencies
8. LABOR - Analyze labor utilization, overtime patterns, crew efficiency
9. BIDS - Analyze bid win rates, pricing strategies, follow-up requirements
10. CHANGE_ORDERS - Track change order patterns, approval bottlenecks, financial impacts

Always provide:
- Specific, actionable recommendations
- Quantified impacts (cost savings, time savings, risk reduction)
- Priority ratings for each insight
- Clear next steps

Respond with valid JSON matching the required structure.`;

export async function analyzeSchedulingModule(projectId?: string, organizationId?: string): Promise<ModuleAnalysisResult> {
  console.log(`🗓️ [AI Scheduling] Starting analysis...`);
  
  if (!organizationId) {
    console.log('[AI Scheduling] Skipping - organization context required for security');
    return { insights: [] };
  }
  
  const conditions: any[] = [eq(projects.gcOrganizationId, organizationId)];
  if (projectId) {
    conditions.push(eq(projects.id, projectId));
  }
  
  const projectData = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      status: projects.status,
      startDate: projects.startDate,
      estimatedCompletionDate: projects.estimatedCompletionDate,
      actualCompletionDate: projects.actualCompletionDate,
      budget: projects.budget,
      contractAmount: projects.contractAmount,
    })
    .from(projects)
    .where(and(...conditions))
    .limit(50);

  if (projectData.length === 0) {
    return { insights: [] };
  }

  const projectIds = projectData.map(p => p.id);
  const taskData = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      category: tasks.category,
    })
    .from(tasks)
    .where(sql`${tasks.projectId} IN ${projectIds}`)
    .limit(200);

  const userPrompt = `Analyze the following scheduling data and provide insights:

**PROJECTS:**
${JSON.stringify(projectData, null, 2)}

**TASKS:**
${JSON.stringify(taskData, null, 2)}

Provide scheduling insights including:
1. Projects at risk of missing deadlines
2. Task bottlenecks and dependencies that could cause delays
3. Recommended task prioritization and reordering
4. Gantt chart recommendations for optimal scheduling
5. Resource allocation suggestions

Respond with JSON in this format:
{
  "insights": [
    {
      "severity": "WARNING|CRITICAL|SUGGESTION|INFO",
      "title": "Brief insight title",
      "summary": "One sentence summary",
      "details": "Detailed explanation",
      "recommendations": ["Action 1", "Action 2"],
      "estimatedImpact": "e.g., 'Could save 5 days on timeline'",
      "actionItems": ["Specific action 1", "Specific action 2"]
    }
  ],
  "ganttRecommendations": [
    {
      "recommendationType": "TASK_ORDER|RESOURCE_ALLOCATION|CRITICAL_PATH|PARALLEL_WORK",
      "title": "Recommendation title",
      "description": "What to change",
      "suggestedTasks": [{"name": "Task name", "duration": 5, "dependencies": ["task1"]}],
      "estimatedDaysImprovement": 3,
      "estimatedCostSavings": 5000
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: AI_MODULE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return {
      insights: (parsed.insights || []).map((i: any) => ({
        ...i,
        module: "SCHEDULING",
      })),
      ganttRecommendations: parsed.ganttRecommendations || [],
    };
  } catch (error) {
    console.error('[AI Scheduling] Error:', error);
    return {
      insights: [{
        module: "SCHEDULING",
        severity: "INFO",
        title: "Scheduling Analysis Unavailable",
        summary: "Unable to complete scheduling analysis at this time.",
        recommendations: ["Try again later or check AI service status"],
      }],
    };
  }
}

export async function analyzeDelaysModule(projectId?: string, organizationId?: string): Promise<ModuleAnalysisResult> {
  console.log(`⏰ [AI Delays] Starting analysis...`);
  
  if (!organizationId) {
    console.log('[AI Delays] Skipping - organization context required for security');
    return { insights: [] };
  }

  const orgProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(projectId 
      ? and(eq(projects.gcOrganizationId, organizationId), eq(projects.id, projectId))
      : eq(projects.gcOrganizationId, organizationId))
    .limit(500);
  const orgProjectIds = orgProjects.map(p => p.id);
  
  if (orgProjectIds.length === 0) {
    return { insights: [] };
  }
  
  const conditions: any[] = [sql`${projectDelays.projectId} IN ${orgProjectIds}`];
  
  const delayData = await db
    .select({
      id: projectDelays.id,
      projectId: projectDelays.projectId,
      delayReason: projectDelays.delayReason,
      delayDays: projectDelays.delayDays,
      delayHours: projectDelays.delayHours,
      description: projectDelays.description,
      status: projectDelays.status,
      financialResponsibility: projectDelays.financialResponsibility,
      estimatedCostImpact: projectDelays.estimatedCostImpact,
      occurrenceDate: projectDelays.occurrenceDate,
    })
    .from(projectDelays)
    .where(conditions.length > 0 ? and(...conditions) : sql`0=1`)
    .orderBy(desc(projectDelays.occurrenceDate))
    .limit(100);

  const projectData = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
    })
    .from(projects)
    .where(sql`${projects.id} IN ${orgProjectIds}`)
    .limit(100);

  const projectMap = new Map(projectData.map(p => [p.id, p]));

  const enrichedDelays = delayData.map(d => ({
    ...d,
    projectCode: projectMap.get(d.projectId)?.code || 'Unknown',
    projectName: projectMap.get(d.projectId)?.name || 'Unknown',
  }));

  const userPrompt = `Analyze the following project delay data and provide insights:

**DELAYS:**
${JSON.stringify(enrichedDelays, null, 2)}

Provide delay analysis including:
1. Total financial impact of all delays
2. Most common delay reasons and patterns
3. Projects most affected by delays
4. Preventive measures to reduce future delays
5. Delays that need immediate attention (unresolved, high-cost)

Respond with JSON in this format:
{
  "insights": [
    {
      "severity": "WARNING|CRITICAL|SUGGESTION|INFO",
      "title": "Brief insight title",
      "summary": "One sentence summary",
      "details": "Detailed explanation with specific numbers",
      "recommendations": ["Action 1", "Action 2"],
      "metrics": {"totalDelayDays": 45, "totalCostImpact": 125000},
      "estimatedImpact": "e.g., 'Addressing weather delays could save $50,000 annually'",
      "actionItems": ["Specific action 1", "Specific action 2"]
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: AI_MODULE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return {
      insights: (parsed.insights || []).map((i: any) => ({
        ...i,
        module: "DELAYS",
      })),
    };
  } catch (error) {
    console.error('[AI Delays] Error:', error);
    return {
      insights: [{
        module: "DELAYS",
        severity: "INFO",
        title: "Delay Analysis Unavailable",
        summary: "Unable to complete delay analysis at this time.",
        recommendations: ["Try again later or check AI service status"],
      }],
    };
  }
}

export async function analyzeCostsModule(projectId?: string, organizationId?: string): Promise<ModuleAnalysisResult> {
  console.log(`💰 [AI Costs] Starting analysis...`);
  
  if (!organizationId) {
    console.log('[AI Costs] Skipping - organization context required for security');
    return { insights: [] };
  }

  const orgProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(projectId 
      ? and(eq(projects.gcOrganizationId, organizationId), eq(projects.id, projectId))
      : eq(projects.gcOrganizationId, organizationId))
    .limit(500);
  const orgProjectIds = orgProjects.map(p => p.id);
  
  if (orgProjectIds.length === 0) {
    return { insights: [] };
  }
  
  const projectFilterCondition = sql`${projectEquipmentPlans.projectId} IN ${orgProjectIds}`;
  
  const equipmentPlans = await db
    .select({
      projectId: projectEquipmentPlans.projectId,
      equipmentName: projectEquipmentPlans.equipmentName,
      source: projectEquipmentPlans.source,
      plannedCost: projectEquipmentPlans.plannedCost,
      actualCost: projectEquipmentPlans.actualCost,
      status: projectEquipmentPlans.status,
    })
    .from(projectEquipmentPlans)
    .where(projectFilterCondition)
    .limit(200);

  const delayData = await db
    .select({
      projectId: projectDelays.projectId,
      estimatedCostImpact: projectDelays.estimatedCostImpact,
      financialResponsibility: projectDelays.financialResponsibility,
    })
    .from(projectDelays)
    .where(sql`${projectDelays.projectId} IN ${orgProjectIds}`)
    .limit(200);
  
  const laborData = await db
    .select({
      projectId: timeEntries.projectId,
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
    })
    .from(timeEntries)
    .where(sql`${timeEntries.projectId} IN ${orgProjectIds}`)
    .limit(500);
  
  const projectData = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      budget: projects.budget,
      contractAmount: projects.contractAmount,
    })
    .from(projects)
    .where(sql`${projects.id} IN ${orgProjectIds}`)
    .limit(50);

  const userPrompt = `Analyze the following cost data and provide optimization insights:

**EQUIPMENT COSTS:**
${JSON.stringify(equipmentPlans, null, 2)}

**DELAY COSTS:**
${JSON.stringify(delayData, null, 2)}

**LABOR DATA:**
${JSON.stringify(laborData, null, 2)}

**PROJECTS:**
${JSON.stringify(projectData, null, 2)}

Provide cost analysis including:
1. Equipment cost variances (planned vs actual)
2. Total delay cost impact
3. Labor cost optimization opportunities
4. Rental vs ownership recommendations
5. Projects at risk of going over budget
6. Overall cost optimization recommendations

Respond with JSON in this format:
{
  "insights": [
    {
      "severity": "WARNING|CRITICAL|SUGGESTION|INFO",
      "title": "Brief insight title",
      "summary": "One sentence summary",
      "details": "Detailed explanation with specific amounts",
      "recommendations": ["Action 1", "Action 2"],
      "metrics": {"equipmentVariance": 15000, "delayCosts": 45000, "potentialSavings": 20000},
      "estimatedImpact": "e.g., 'Switching to weekly rentals could save $3,000/month'",
      "actionItems": ["Specific action 1", "Specific action 2"]
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: AI_MODULE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return {
      insights: (parsed.insights || []).map((i: any) => ({
        ...i,
        module: "COSTS",
      })),
    };
  } catch (error) {
    console.error('[AI Costs] Error:', error);
    return {
      insights: [{
        module: "COSTS",
        severity: "INFO",
        title: "Cost Analysis Unavailable",
        summary: "Unable to complete cost analysis at this time.",
        recommendations: ["Try again later or check AI service status"],
      }],
    };
  }
}

export async function analyzeEquipmentModule(organizationId?: string): Promise<ModuleAnalysisResult> {
  console.log(`🚜 [AI Equipment] Starting analysis...`);
  
  if (!organizationId) {
    console.log('[AI Equipment] Skipping - no organization context');
    return { insights: [] };
  }
  
  const equipmentData = await db
    .select({
      id: equipment.id,
      name: equipment.name,
      equipmentType: equipment.equipmentType,
      status: equipment.status,
      purchasePrice: equipment.purchasePrice,
      currentHours: equipment.currentHours,
      lastMaintenanceDate: equipment.lastMaintenanceDate,
      nextMaintenanceDate: equipment.nextMaintenanceDate,
    })
    .from(equipment)
    .where(eq(equipment.organizationId, organizationId))
    .limit(100);

  if (equipmentData.length === 0) {
    return { insights: [] };
  }

  const equipmentIds = equipmentData.map(e => e.id);
  const assignments = await db
    .select({
      equipmentId: equipmentAssignments.equipmentId,
      projectId: equipmentAssignments.projectId,
      assignedAt: equipmentAssignments.assignedAt,
      returnedAt: equipmentAssignments.returnedAt,
    })
    .from(equipmentAssignments)
    .where(sql`${equipmentAssignments.equipmentId} IN ${equipmentIds}`)
    .limit(200);

  const orgProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.gcOrganizationId, organizationId))
    .limit(500);
  const orgProjectIds = orgProjects.map(p => p.id);
  
  const plans = orgProjectIds.length > 0 ? await db
    .select({
      projectId: projectEquipmentPlans.projectId,
      equipmentName: projectEquipmentPlans.equipmentName,
      source: projectEquipmentPlans.source,
      plannedCost: projectEquipmentPlans.plannedCost,
      actualCost: projectEquipmentPlans.actualCost,
    })
    .from(projectEquipmentPlans)
    .where(sql`${projectEquipmentPlans.projectId} IN ${orgProjectIds}`)
    .limit(200)
  : [];

  const userPrompt = `Analyze the following equipment data and provide optimization insights:

**OWNED EQUIPMENT:**
${JSON.stringify(equipmentData, null, 2)}

**EQUIPMENT ASSIGNMENTS:**
${JSON.stringify(assignments, null, 2)}

**EQUIPMENT PLANS:**
${JSON.stringify(plans, null, 2)}

Provide equipment analysis including:
1. Equipment utilization rates and underutilized assets
2. Maintenance overdue or upcoming
3. Rental vs purchase recommendations
4. Equipment that should be sold or retired
5. Cost efficiency analysis
6. Fleet optimization suggestions

Respond with JSON in this format:
{
  "insights": [
    {
      "severity": "WARNING|CRITICAL|SUGGESTION|INFO",
      "title": "Brief insight title",
      "summary": "One sentence summary",
      "details": "Detailed explanation",
      "recommendations": ["Action 1", "Action 2"],
      "metrics": {"utilizationRate": 65, "maintenanceOverdue": 3},
      "estimatedImpact": "e.g., 'Selling underutilized excavator could free up $45,000'",
      "actionItems": ["Specific action 1", "Specific action 2"]
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: AI_MODULE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return {
      insights: (parsed.insights || []).map((i: any) => ({
        ...i,
        module: "EQUIPMENT",
      })),
    };
  } catch (error) {
    console.error('[AI Equipment] Error:', error);
    return {
      insights: [{
        module: "EQUIPMENT",
        severity: "INFO",
        title: "Equipment Analysis Unavailable",
        summary: "Unable to complete equipment analysis at this time.",
        recommendations: ["Try again later or check AI service status"],
      }],
    };
  }
}

export async function analyzeVendorPricingModule(organizationId?: string): Promise<ModuleAnalysisResult> {
  console.log(`💲 [AI Vendor Pricing] Starting analysis...`);
  
  if (!organizationId) {
    console.log('[AI Vendor Pricing] Skipping - no organization context');
    return { insights: [] };
  }
  
  const pricingData = await db
    .select({
      id: vendorPricingCatalogs.id,
      crmEntityId: vendorPricingCatalogs.crmEntityId,
      itemName: vendorPricingCatalogs.itemName,
      itemCategory: vendorPricingCatalogs.itemCategory,
      unitPrice: vendorPricingCatalogs.unitPrice,
      unit: vendorPricingCatalogs.unit,
      effectiveDate: vendorPricingCatalogs.effectiveDate,
      expirationDate: vendorPricingCatalogs.expirationDate,
    })
    .from(vendorPricingCatalogs)
    .where(eq(vendorPricingCatalogs.organizationId, organizationId))
    .limit(500);

  const vendorData = await db
    .select({
      id: crmOrganisations.id,
      name: crmOrganisations.name,
      type: crmOrganisations.type,
    })
    .from(crmOrganisations)
    .where(
      and(
        eq(crmOrganisations.organizationId, organizationId),
        sql`${crmOrganisations.type} IN ('SUPPLIER', 'VENDOR')`
      )
    )
    .limit(100);

  if (pricingData.length === 0) {
    return { insights: [] };
  }

  const vendorMap = new Map(vendorData.map(v => [v.id, v.name]));

  const enrichedPricing = pricingData.map(p => ({
    ...p,
    vendorName: vendorMap.get(p.crmEntityId) || 'Unknown Vendor',
  }));

  const categorizedPricing: Record<string, any[]> = {};
  enrichedPricing.forEach(p => {
    const cat = p.itemCategory || 'Uncategorized';
    if (!categorizedPricing[cat]) categorizedPricing[cat] = [];
    categorizedPricing[cat].push(p);
  });

  const userPrompt = `Analyze the following vendor pricing data and provide best deal recommendations:

**VENDOR PRICING BY CATEGORY:**
${JSON.stringify(categorizedPricing, null, 2)}

**VENDORS:**
${JSON.stringify(vendorData, null, 2)}

Provide vendor pricing analysis including:
1. Best-priced vendor for each material category
2. Price comparison across vendors for same items
3. Vendors with expired or expiring pricing
4. Potential savings by switching vendors
5. Pricing trends and anomalies
6. Recommended preferred vendors by category

Respond with JSON in this format:
{
  "insights": [
    {
      "severity": "WARNING|CRITICAL|SUGGESTION|INFO",
      "title": "Brief insight title",
      "summary": "One sentence summary",
      "details": "Detailed explanation with specific prices",
      "recommendations": ["Action 1", "Action 2"],
      "metrics": {"potentialSavings": 15000, "vendorsCompared": 5},
      "estimatedImpact": "e.g., 'Switching concrete supplier could save 12% on materials'",
      "actionItems": ["Contact Vendor X for bulk pricing", "Update pricebook with new rates"]
    }
  ],
  "vendorComparisons": [
    {
      "materialCategory": "Concrete",
      "analysisData": {"vendors": [{"name": "ABC Supply", "avgPrice": 125}, {"name": "XYZ Materials", "avgPrice": 115}]},
      "recommendedVendorName": "XYZ Materials",
      "potentialSavings": 5000,
      "priceConfidence": 85
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: AI_MODULE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return {
      insights: (parsed.insights || []).map((i: any) => ({
        ...i,
        module: "VENDOR_PRICING",
      })),
      vendorComparisons: parsed.vendorComparisons || [],
    };
  } catch (error) {
    console.error('[AI Vendor Pricing] Error:', error);
    return {
      insights: [{
        module: "VENDOR_PRICING",
        severity: "INFO",
        title: "Vendor Pricing Analysis Unavailable",
        summary: "Unable to complete vendor pricing analysis at this time.",
        recommendations: ["Try again later or check AI service status"],
      }],
    };
  }
}

export async function analyzeProjectHealthModule(projectId: string): Promise<ModuleAnalysisResult> {
  console.log(`❤️ [AI Project Health] Starting analysis for project ${projectId}...`);
  
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return {
      insights: [{
        module: "PROJECT_HEALTH",
        severity: "WARNING",
        title: "Project Not Found",
        summary: "Unable to find the specified project.",
        recommendations: ["Verify project ID and try again"],
      }],
    };
  }

  const projectTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .limit(100);

  const projectDelaysData = await db
    .select()
    .from(projectDelays)
    .where(eq(projectDelays.projectId, projectId))
    .limit(50);

  const projectChangeOrders = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.projectId, projectId))
    .limit(50);

  const projectEquipment = await db
    .select()
    .from(projectEquipmentPlans)
    .where(eq(projectEquipmentPlans.projectId, projectId))
    .limit(50);

  const userPrompt = `Analyze the following project and provide a comprehensive health assessment:

**PROJECT:**
${JSON.stringify(project, null, 2)}

**TASKS:**
${JSON.stringify(projectTasks, null, 2)}

**DELAYS:**
${JSON.stringify(projectDelaysData, null, 2)}

**CHANGE ORDERS:**
${JSON.stringify(projectChangeOrders, null, 2)}

**EQUIPMENT:**
${JSON.stringify(projectEquipment, null, 2)}

Provide a comprehensive project health analysis including:
1. Overall health score (0-100)
2. Schedule health (on track, at risk, behind)
3. Budget health (under, on, over budget)
4. Risk assessment
5. Key issues that need attention
6. Recommendations for improvement
7. Predicted completion status

Respond with JSON in this format:
{
  "insights": [
    {
      "severity": "WARNING|CRITICAL|SUGGESTION|INFO",
      "title": "Project Health Score: 75/100",
      "summary": "Project is performing well but has minor schedule concerns",
      "details": "Detailed breakdown of health factors",
      "recommendations": ["Action 1", "Action 2"],
      "metrics": {
        "overallScore": 75,
        "scheduleScore": 70,
        "budgetScore": 85,
        "riskScore": 65,
        "delayDays": 5,
        "changeOrderValue": 25000
      },
      "estimatedImpact": "If current issues are addressed, project can finish on time",
      "actionItems": ["Review task dependencies", "Approve pending change orders"]
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: AI_MODULE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return {
      insights: (parsed.insights || []).map((i: any) => ({
        ...i,
        module: "PROJECT_HEALTH",
      })),
    };
  } catch (error) {
    console.error('[AI Project Health] Error:', error);
    return {
      insights: [{
        module: "PROJECT_HEALTH",
        severity: "INFO",
        title: "Project Health Analysis Unavailable",
        summary: "Unable to complete project health analysis at this time.",
        recommendations: ["Try again later or check AI service status"],
      }],
    };
  }
}

export async function runComprehensiveAnalysis(
  organizationId?: string,
  projectId?: string,
  modules?: string[]
): Promise<ModuleAnalysisResult> {
  console.log(`🔬 [AI Comprehensive] Running analysis for modules: ${modules?.join(', ') || 'ALL'}`);
  
  const allModules = modules || ['SCHEDULING', 'DELAYS', 'COSTS', 'EQUIPMENT', 'VENDOR_PRICING'];
  const results: ModuleAnalysisResult = {
    insights: [],
    ganttRecommendations: [],
    vendorComparisons: [],
  };

  for (const module of allModules) {
    try {
      let moduleResult: ModuleAnalysisResult;
      
      switch (module) {
        case 'SCHEDULING':
          moduleResult = await analyzeSchedulingModule(projectId, organizationId);
          break;
        case 'DELAYS':
          moduleResult = await analyzeDelaysModule(projectId, organizationId);
          break;
        case 'COSTS':
          moduleResult = await analyzeCostsModule(projectId, organizationId);
          break;
        case 'EQUIPMENT':
          moduleResult = await analyzeEquipmentModule(organizationId);
          break;
        case 'VENDOR_PRICING':
          moduleResult = await analyzeVendorPricingModule(organizationId);
          break;
        case 'PROJECT_HEALTH':
          if (projectId) {
            moduleResult = await analyzeProjectHealthModule(projectId);
          } else {
            moduleResult = { insights: [] };
          }
          break;
        default:
          moduleResult = { insights: [] };
      }

      results.insights.push(...moduleResult.insights);
      if (moduleResult.ganttRecommendations) {
        results.ganttRecommendations!.push(...moduleResult.ganttRecommendations);
      }
      if (moduleResult.vendorComparisons) {
        results.vendorComparisons!.push(...moduleResult.vendorComparisons);
      }
    } catch (error) {
      console.error(`[AI Comprehensive] Error in module ${module}:`, error);
    }
  }

  return results;
}

export async function saveAnalysisResults(
  results: ModuleAnalysisResult,
  organizationId?: string,
  projectId?: string,
  triggeredById?: string
): Promise<string[]> {
  const savedInsightIds: string[] = [];

  for (const insight of results.insights) {
    try {
      const [saved] = await db.insert(aiInsights).values({
        organizationId,
        projectId,
        module: insight.module as any,
        severity: insight.severity as any,
        title: insight.title,
        summary: insight.summary,
        details: insight.details,
        recommendations: insight.recommendations,
        metrics: insight.metrics ? JSON.stringify(insight.metrics) : null,
        affectedEntities: insight.affectedEntities ? JSON.stringify(insight.affectedEntities) : null,
        estimatedImpact: insight.estimatedImpact,
        actionItems: insight.actionItems ? JSON.stringify(insight.actionItems) : null,
        triggeredById,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).returning();

      savedInsightIds.push(saved.id);

      if (insight.module === 'SCHEDULING' && results.ganttRecommendations) {
        for (const gantt of results.ganttRecommendations) {
          await db.insert(aiGanttRecommendations).values({
            projectId: projectId!,
            insightId: saved.id,
            recommendationType: gantt.recommendationType,
            title: gantt.title,
            description: gantt.description,
            suggestedTasks: gantt.suggestedTasks ? JSON.stringify(gantt.suggestedTasks) : null,
            suggestedDependencies: gantt.suggestedDependencies ? JSON.stringify(gantt.suggestedDependencies) : null,
            estimatedDaysImprovement: gantt.estimatedDaysImprovement,
            estimatedCostSavings: gantt.estimatedCostSavings?.toString(),
          });
        }
      }

      if (insight.module === 'VENDOR_PRICING' && results.vendorComparisons && organizationId) {
        for (const comparison of results.vendorComparisons) {
          await db.insert(aiVendorComparisons).values({
            organizationId,
            insightId: saved.id,
            materialCategory: comparison.materialCategory,
            analysisData: JSON.stringify(comparison.analysisData),
            recommendedVendorId: comparison.recommendedVendorId,
            recommendedVendorName: comparison.recommendedVendorName,
            potentialSavings: comparison.potentialSavings?.toString(),
            priceConfidence: comparison.priceConfidence,
          });
        }
      }
    } catch (error) {
      console.error('[AI Save] Error saving insight:', error);
    }
  }

  return savedInsightIds;
}
