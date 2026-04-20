import { Router , NextFunction } from "express";
import multer from "multer";
import { db } from "./db";
import { sensitiveLimiter } from "./rateLimiter";
import { projectSchedules, projectScheduleTasks, jobsiteAnalysisBatches, jobsiteAnalysisPhotos, organizations, projects, media, crmContacts, activityLog, users } from "@shared/schema";
import { eq, desc, and, sql, isNotNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logError, logWarn } from "./utils/logger";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { governedAiCall } from "./services/aiGovernance";
import { sendEmail } from "./email";

const ganttPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

const router = Router();


// ============================================
// FEATURE B: AI SCHEDULING ASSISTANT ROUTES
// ============================================

const scheduleGenerateSchema = z.object({
  projectId: z.string(),
  startDate: z.string(),
  workingDays: z.array(z.number()).optional().default([1, 2, 3, 4, 5]),
  crewIds: z.array(z.string()).optional(),
  includeTrades: z.array(z.string()).optional(),
  options: z.object({
    bufferDays: z.number().optional().default(1),
    weatherContingency: z.number().optional().default(10),
    inspectionWaitDays: z.number().optional().default(2),
  }).optional(),
});

// POST /api/ai-features/schedule/generate - Generate AI schedule
router.post("/ai-features/schedule/generate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = scheduleGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, startDate, workingDays, crewIds, options } = parsed.data;

    // Get organization trade type
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    const tradeType = org?.tradeType || "GENERAL_CONTRACTOR";

    // Create schedule
    const [schedule] = await db.insert(projectSchedules).values({
      organizationId,
      projectId,
      name: "AI-Generated Schedule",
      generatedBy: "AI",
      baselineStartDate: startDate,
      workingDays,
      optionsJson: JSON.stringify(options),
      createdByUserId: userId,
    }).returning();

    // Generate trade-specific tasks
    const tasks = await generateTradeScheduleTasks(schedule.id, tradeType, startDate, options);

    res.json({
      success: true,
      scheduleId: schedule.id,
      status: "GENERATED",
      proposedSchedule: {
        startDate,
        endDate: tasks.length > 0 ? tasks[tasks.length - 1].plannedEndDate : startDate,
        totalDays: tasks.reduce((sum, t) => sum + (t.durationDays || 0), 0),
        criticalPathDays: tasks.filter(t => t.isCriticalPath).reduce((sum, t) => sum + (t.durationDays || 0), 0),
        tasks,
      },
      aiNotes: `Generated ${tasks.length} tasks for ${tradeType} project.`,
    });
  } catch (error) {
    next(error);
  }
});

async function generateTradeScheduleTasks(scheduleId: string, tradeType: string, startDate: string, options?: any) {
  const taskTemplates: Record<string, Array<{name: string; duration: number; isCritical: boolean}>> = {
    ROOFING: [
      { name: "Tear-off Existing Roof", duration: 2, isCritical: true },
      { name: "Deck Inspection & Repair", duration: 1, isCritical: true },
      { name: "Install Underlayment", duration: 1, isCritical: true },
      { name: "Install Shingles/Metal", duration: 3, isCritical: true },
      { name: "Install Flashings", duration: 1, isCritical: false },
      { name: "Install Gutters", duration: 1, isCritical: false },
      { name: "Cleanup & Final Inspection", duration: 1, isCritical: true },
    ],
    ELECTRICAL: [
      { name: "Rough-In Wiring", duration: 3, isCritical: true },
      { name: "Panel Installation", duration: 1, isCritical: true },
      { name: "Rough Inspection", duration: 1, isCritical: true },
      { name: "Trim-Out (Devices & Fixtures)", duration: 2, isCritical: false },
      { name: "Panel Terminations", duration: 1, isCritical: true },
      { name: "Final Inspection", duration: 1, isCritical: true },
    ],
    CONCRETE: [
      { name: "Layout & Excavation", duration: 2, isCritical: true },
      { name: "Form Installation", duration: 2, isCritical: true },
      { name: "Rebar Installation", duration: 2, isCritical: true },
      { name: "Pre-Pour Inspection", duration: 1, isCritical: true },
      { name: "Concrete Pour", duration: 1, isCritical: true },
      { name: "Curing Period", duration: 7, isCritical: true },
      { name: "Form Stripping", duration: 1, isCritical: false },
      { name: "Final Finish", duration: 1, isCritical: false },
    ],
    GENERAL_CONTRACTOR: [
      { name: "Site Preparation", duration: 3, isCritical: true },
      { name: "Foundation", duration: 5, isCritical: true },
      { name: "Framing", duration: 10, isCritical: true },
      { name: "MEP Rough-In", duration: 5, isCritical: true },
      { name: "Insulation & Drywall", duration: 5, isCritical: false },
      { name: "Finish Work", duration: 7, isCritical: false },
      { name: "Final Inspections", duration: 2, isCritical: true },
    ],
  };

  const templates = taskTemplates[tradeType] || taskTemplates.GENERAL_CONTRACTOR;
  let currentDate = new Date(startDate);
  const tasks: any[] = [];
  const dependencies: string[] = [];

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const taskStartDate = new Date(currentDate);
    const taskEndDate = new Date(currentDate);
    taskEndDate.setDate(taskEndDate.getDate() + template.duration - 1);

    const [task] = await db.insert(projectScheduleTasks).values({
      scheduleId,
      name: template.name,
      tradeType: tradeType as any,
      plannedStartDate: taskStartDate.toISOString().split('T')[0],
      plannedEndDate: taskEndDate.toISOString().split('T')[0],
      durationDays: template.duration,
      dependencies: dependencies.length > 0 ? [dependencies[dependencies.length - 1]] : [],
      isCriticalPath: template.isCritical,
      status: "NOT_STARTED",
      sortOrder: i,
    }).returning();

    tasks.push(task);
    dependencies.push(task.id);
    currentDate = new Date(taskEndDate);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Update schedule end date
  if (tasks.length > 0) {
    await db.update(projectSchedules)
      .set({ baselineEndDate: tasks[tasks.length - 1].plannedEndDate })
      .where(eq(projectSchedules.id, scheduleId));
  }

  try {
    const { recalculateSchedule } = await import("./cpmEngine");
    await recalculateSchedule(scheduleId);
  } catch (e) {
    logError("CPM recalculation after generation failed:", {}, e instanceof Error ? e : new Error(String(e)));
  }

  return tasks;
}

// GET /api/ai-features/schedule/:projectId - Get project schedule
router.get("/ai-features/schedule/:projectId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [schedule] = await db.select()
      .from(projectSchedules)
      .where(and(
        eq(projectSchedules.projectId, req.params.projectId),
        eq(projectSchedules.organizationId, organizationId),
        eq(projectSchedules.isActive, true)
      ))
      .orderBy(desc(projectSchedules.createdAt))
      .limit(1);

    if (!schedule) {
      return res.json({ schedule: null, tasks: [] });
    }

    const tasks = await db.select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, schedule.id))
      .orderBy(projectScheduleTasks.sortOrder);

    res.json({ schedule, tasks });
  } catch (error) {
    next(error);
  }
});


// ============================================
// FEATURE C: AI JOBSITE CAMERA ANALYSIS ROUTES
// ============================================

const jobsiteAnalysisSchema = z.object({
  projectId: z.string(),
  date: z.string(),
  analysisTypes: z.array(z.string()).default(["SAFETY", "PROGRESS"]),
  tradeType: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/ai-features/jobsite/analyze - Create jobsite analysis batch
router.post("/ai-features/jobsite/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = jobsiteAnalysisSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, date, analysisTypes, tradeType, notes } = parsed.data;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || project.gcOrganizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied: project does not belong to your organization" });
    }

    // Get organization trade type if not provided
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    // Valid trade types from the enum - "MANUAL" and other custom types should fall back to GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = tradeType || (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    const [batch] = await db.insert(jobsiteAnalysisBatches).values({
      organizationId,
      projectId,
      analysisDate: date,
      tradeType: effectiveTradeType as any,
      status: "PENDING",
      analysisTypes,
      createdByUserId: userId,
    }).returning();

    res.json({
      success: true,
      batchId: batch.id,
      status: "QUEUED",
      estimatedTime: 60,
    });
  } catch (error) {
    next(error);
  }
});

async function processJobsiteBatch(batchId: string, user: { id?: string; organizationId?: string; role?: string }) {
  const [batch] = await db.select()
    .from(jobsiteAnalysisBatches)
    .where(eq(jobsiteAnalysisBatches.id, batchId));

  if (!batch) throw new Error("Batch not found");

  try {
  await db.update(jobsiteAnalysisBatches)
    .set({ status: "PROCESSING" })
    .where(eq(jobsiteAnalysisBatches.id, batchId));

  const photos = await db.select()
    .from(jobsiteAnalysisPhotos)
    .where(eq(jobsiteAnalysisPhotos.batchId, batchId));

  let safetyFindings: any[];
  let progressFindings: any[];
  let summary: any;
  let crewFindings: any;
  let aiNotes: string;

  if (photos.length > 0 && openai) {
    try {
      const tradeType = batch.tradeType || "GENERAL_CONTRACTOR";
      const analysisTypes = batch.analysisTypes || ["SAFETY", "PROGRESS"];
      
      const safetyPrompt = analysisTypes.includes("SAFETY") 
        ? `SAFETY: Identify any safety hazards, PPE compliance issues, fall hazards, housekeeping problems. Rate severity as CRITICAL, HIGH, MEDIUM, or LOW.` 
        : "";
      const progressPrompt = analysisTypes.includes("PROGRESS")
        ? `PROGRESS: Estimate work completion percentage, identify active work areas, note quality of workmanship.`
        : "";
      const crewPrompt = `CREW: Estimate number of workers visible, assess PPE compliance percentage.`;
      
      const tradeContext = TRADE_DETECTION_PROMPTS[tradeType] || TRADE_DETECTION_PROMPTS.GENERAL_CONTRACTOR;
      const imageUrl = photos[0].fileUrl;
      
      const govResult = await governedAiCall({
        orgId: batch.organizationId,
        userId: user?.id || null,
        actionType: "jobsite_analysis",
        inputRefs: { projectId: batch.projectId },
        fn: async () => {
          const completion = await openai!.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages: [
              {
                role: "system",
                content: `You are a construction site safety and progress inspector for ${tradeType} trade work.
${tradeContext}

Analyze the jobsite photo and provide a comprehensive assessment.

${safetyPrompt}
${progressPrompt}
${crewPrompt}

Return your analysis as JSON with this exact structure:
{
  "summary": {
    "overallSafetyScore": number (0-100),
    "estimatedCompletion": number (0-100 percentage),
    "crewCountEstimate": number,
    "weatherConditions": "string",
    "primaryConcerns": ["array of concerns"]
  },
  "safetyFindings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "PPE|FALL_HAZARD|HOUSEKEEPING|ELECTRICAL|FIRE|OTHER",
      "description": "detailed description",
      "recommendation": "corrective action"
    }
  ],
  "progressFindings": [
    {
      "workArea": "area name",
      "tradeType": "${tradeType}",
      "estimatedComplete": number (0-100),
      "observations": "quality and progress notes"
    }
  ],
  "crewFindings": {
    "estimatedCount": number,
    "ppeCompliance": number (0-100),
    "activeWorkAreas": ["array of areas"]
  },
  "notes": "overall summary of findings"
}`
              },
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: imageUrl, detail: "high" }
                  },
                  {
                    type: "text",
                    text: `Analyze this construction jobsite photo for ${tradeType} trade work. Focus on safety hazards, work progress, and crew activity.`
                  }
                ]
              }
            ],
            max_completion_tokens: 4096,
          });
          return { result: completion.choices[0]?.message?.content, completion };
        },
      });

      if (govResult.blocked) {
        await db.update(jobsiteAnalysisBatches)
          .set({ status: "FAILED", errorMessage: govResult.reason || "AI rate limited", updatedAt: new Date() })
          .where(eq(jobsiteAnalysisBatches.id, batchId));
        return;
      }

      const responseContent = govResult.result || "";
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        summary = parsed.summary || {
          overallSafetyScore: 80, estimatedCompletion: 50, crewCountEstimate: 5,
          weatherConditions: "Unknown", primaryConcerns: [],
        };
        safetyFindings = (parsed.safetyFindings || []).map((f: any, i: number) => ({
          id: `sf-${i + 1}`, severity: f.severity || "MEDIUM", category: f.category || "OTHER",
          description: f.description, recommendation: f.recommendation, photoId: photos[0].id,
        }));
        progressFindings = (parsed.progressFindings || []).map((f: any, i: number) => ({
          id: `pf-${i + 1}`, workArea: f.workArea || "General Area", tradeType: f.tradeType || tradeType,
          estimatedComplete: f.estimatedComplete || 0, observations: f.observations, photoId: photos[0].id,
        }));
        crewFindings = parsed.crewFindings || { estimatedCount: 0, ppeCompliance: 100, activeWorkAreas: [] };
        aiNotes = parsed.notes || "AI Vision analysis complete.";
      } else {
        throw new Error("Could not parse AI response");
      }
    } catch (visionError) {
      logError("OpenAI Vision error for jobsite analysis, falling back to mock:", {}, visionError instanceof Error ? visionError : new Error(String(visionError)));
      safetyFindings = generateSafetyFindings(batch.tradeType || "GENERAL_CONTRACTOR");
      progressFindings = generateProgressFindings(batch.tradeType || "GENERAL_CONTRACTOR");
      summary = {
        overallSafetyScore: 85, estimatedCompletion: 45, crewCountEstimate: 6,
        weatherConditions: "Clear, 72°F",
        primaryConcerns: safetyFindings.filter((f: any) => f.severity === "HIGH").map((f: any) => f.description),
        analysisMethod: "Fallback (mock)",
      };
      crewFindings = { estimatedCount: 6, ppeCompliance: 90, activeWorkAreas: ["Main building", "North side"] };
      aiNotes = "Fallback: Generated sample analysis data.";
    }
  } else {
    safetyFindings = generateSafetyFindings(batch.tradeType || "GENERAL_CONTRACTOR");
    progressFindings = generateProgressFindings(batch.tradeType || "GENERAL_CONTRACTOR");
    summary = {
      overallSafetyScore: 85, estimatedCompletion: 45, crewCountEstimate: 6,
      weatherConditions: "Clear, 72°F",
      primaryConcerns: safetyFindings.filter((f: any) => f.severity === "HIGH").map((f: any) => f.description),
      analysisMethod: "Demo (no photos)",
    };
    crewFindings = { estimatedCount: 6, ppeCompliance: 90, activeWorkAreas: ["Main building", "North side"] };
    aiNotes = "Demo mode: Generated sample analysis data.";
  }

  await db.update(jobsiteAnalysisBatches)
    .set({
      status: "COMPLETE",
      summaryJson: JSON.stringify(summary),
      safetyFindingsJson: JSON.stringify(safetyFindings),
      progressFindingsJson: JSON.stringify(progressFindings),
      crewFindingsJson: JSON.stringify(crewFindings),
      aiNotes,
      updatedAt: new Date(),
    })
    .where(eq(jobsiteAnalysisBatches.id, batchId));
  } catch (processingError) {
    logError(`processJobsiteBatch uncaught error for batch ${batchId}:`, {}, processingError instanceof Error ? processingError : new Error(String(processingError)));
    await db.update(jobsiteAnalysisBatches)
      .set({
        status: "FAILED",
        errorMessage: processingError instanceof Error ? processingError.message : "Unexpected processing error",
        updatedAt: new Date(),
      })
      .where(eq(jobsiteAnalysisBatches.id, batchId));
  }
}

// POST /api/ai-features/jobsite/:batchId/process - Process uploaded photos with AI Vision
router.post("/ai-features/jobsite/:batchId/process", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    const userRole = req.user?.role;
    
    if (userRole !== "SUPER_ADMIN" && !organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const batchId = req.params.batchId;

    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(eq(jobsiteAnalysisBatches.id, batchId));

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    if (userRole !== "SUPER_ADMIN" && batch.organizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await processJobsiteBatch(batchId, req.user!);

    res.json({ success: true, status: "COMPLETE" });
  } catch (error) {
    next(error);
  }
});

function generateSafetyFindings(tradeType: string) {
  const findings = [
    { id: "sf-1", severity: "MEDIUM", category: "PPE", description: "Worker without hard hat observed in photo 3", recommendation: "Ensure all workers wear hard hats on site" },
    { id: "sf-2", severity: "LOW", category: "HOUSEKEEPING", description: "Material storage could be better organized", recommendation: "Organize materials to clear walkways" },
  ];
  
  if (tradeType === "ROOFING") {
    findings.push({ id: "sf-3", severity: "HIGH", category: "FALL_HAZARD", description: "Ladder not properly secured at roof access", recommendation: "Secure ladder with proper tie-offs" });
  }
  
  return findings;
}

function generateProgressFindings(tradeType: string) {
  const findings = [
    { id: "pf-1", workArea: "Main Building", tradeType, estimatedComplete: 45, observations: "Work progressing on schedule" },
    { id: "pf-2", workArea: "North Section", tradeType, estimatedComplete: 60, observations: "Ahead of schedule in this area" },
  ];
  return findings;
}

// GET /api/ai-features/jobsite/results/:batchId - Get analysis results
router.get("/ai-features/jobsite/results/:batchId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(and(
        eq(jobsiteAnalysisBatches.id, req.params.batchId),
        eq(jobsiteAnalysisBatches.organizationId, organizationId)
      ));

    if (!batch) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const photos = await db.select()
      .from(jobsiteAnalysisPhotos)
      .where(eq(jobsiteAnalysisPhotos.batchId, batch.id));

    res.json({
      batchId: batch.id,
      status: batch.status,
      projectId: batch.projectId,
      date: batch.analysisDate,
      tradeType: batch.tradeType,
      summary: batch.summaryJson ? JSON.parse(batch.summaryJson) : null,
      safetyFindings: batch.safetyFindingsJson ? JSON.parse(batch.safetyFindingsJson) : [],
      progressFindings: batch.progressFindingsJson ? JSON.parse(batch.progressFindingsJson) : [],
      crewFindings: batch.crewFindingsJson ? JSON.parse(batch.crewFindingsJson) : null,
      photos,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/ai-features/jobsite/history/:projectId - Get analysis history
router.get("/ai-features/jobsite/history/:projectId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const batches = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(and(
        eq(jobsiteAnalysisBatches.projectId, req.params.projectId),
        eq(jobsiteAnalysisBatches.organizationId, organizationId)
      ))
      .orderBy(desc(jobsiteAnalysisBatches.analysisDate))
      .limit(30);

    const batchIds = batches.map(b => b.id);
    let photoCountMap: Record<string, number> = {};
    if (batchIds.length > 0) {
      const photoCounts = await db.select({
        batchId: jobsiteAnalysisPhotos.batchId,
        count: sql<number>`count(*)::int`,
      })
        .from(jobsiteAnalysisPhotos)
        .where(sql`${jobsiteAnalysisPhotos.batchId} IN (${sql.join(batchIds.map(id => sql`${id}`), sql`, `)})`)
        .groupBy(jobsiteAnalysisPhotos.batchId);
      for (const pc of photoCounts) {
        photoCountMap[pc.batchId] = pc.count;
      }
    }

    const batchesWithCounts = batches.map(b => {
      let safetyScore: number | undefined;
      let safetyFindings: any[] = [];
      let summary: any = undefined;
      try {
        if (b.summaryJson) summary = JSON.parse(b.summaryJson);
        if (summary) safetyScore = summary.overallSafetyScore;
      } catch { logWarn("Non-critical operation failed"); }
      try {
        if (b.safetyFindingsJson) safetyFindings = JSON.parse(b.safetyFindingsJson);
      } catch { logWarn("Non-critical operation failed"); }
      return {
        ...b,
        photoCount: photoCountMap[b.id] || 0,
        safetyScore,
        safetyFindings,
        summary,
      };
    });

    res.json({ batches: batchesWithCounts });
  } catch (error) {
    next(error);
  }
});

// GET /api/ai-features/jobsite/project-photos/:projectId - Get unanalyzed project photos
router.get("/ai-features/jobsite/project-photos/:projectId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const projectId = req.params.projectId;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || project.gcOrganizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const allPhotos = await db.select()
      .from(media)
      .where(and(
        eq(media.projectId, projectId),
        eq(media.type, "IMAGE")
      ))
      .orderBy(desc(media.uploadedAt));

    const alreadyUsed = await db.select({ fileUrl: jobsiteAnalysisPhotos.fileUrl })
      .from(jobsiteAnalysisPhotos)
      .innerJoin(jobsiteAnalysisBatches, eq(jobsiteAnalysisPhotos.batchId, jobsiteAnalysisBatches.id))
      .where(eq(jobsiteAnalysisBatches.projectId, projectId));

    const usedUrls = new Set(alreadyUsed.map(p => p.fileUrl));
    const unanalyzed = allPhotos.filter(p => !usedUrls.has(p.fileUrl));

    res.json({ photos: unanalyzed, total: allPhotos.length, unanalyzedCount: unanalyzed.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai-features/jobsite/:batchId/attach-photos - Attach photos and trigger processing
const attachPhotosSchema = z.object({
  photos: z.array(z.object({
    fileUrl: z.string().min(1),
    fileKey: z.string().optional(),
    originalFilename: z.string().optional(),
  })).min(1, "At least one photo is required"),
});

router.post("/ai-features/jobsite/:batchId/attach-photos", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    if (!organizationId || !userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = attachPhotosSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { photos } = parsed.data;
    const batchId = req.params.batchId;

    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(eq(jobsiteAnalysisBatches.id, batchId));

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    if (batch.organizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, batch.projectId)).limit(1);
    if (!project || project.gcOrganizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const projectMedia = await db.select({ fileUrl: media.fileUrl })
      .from(media)
      .where(and(eq(media.projectId, batch.projectId), eq(media.type, "IMAGE")));
    const validMediaUrls = new Set(projectMedia.map(m => m.fileUrl));

    const { uploadIntents } = await import("@shared/schema");
    const orgIntents = await db.select({ objectKey: uploadIntents.objectKey })
      .from(uploadIntents)
      .where(and(
        eq(uploadIntents.organizationId, organizationId),
        isNotNull(uploadIntents.confirmedAt),
      ));
    const validObjectKeys = new Set(orgIntents.map(i => i.objectKey));

    const validatedPhotos = photos.filter(p => {
      if (validMediaUrls.has(p.fileUrl)) return true;
      if (p.fileKey && validObjectKeys.has(p.fileKey)) return true;
      const normalizedPath = p.fileUrl.replace(/^\//, "");
      if (validObjectKeys.has(normalizedPath)) return true;
      return false;
    });

    if (validatedPhotos.length === 0) {
      return res.status(400).json({ error: "No valid photos to attach" });
    }

    const photoRecords = validatedPhotos.map(p => ({
      batchId,
      fileKey: p.fileKey || p.fileUrl,
      fileUrl: p.fileUrl,
      originalFilename: p.originalFilename || null,
    }));

    await db.insert(jobsiteAnalysisPhotos).values(photoRecords);

    res.json({ success: true, photosAttached: validatedPhotos.length, batchId });

    processJobsiteBatch(batchId, req.user!).catch(err => {
      logError("Background batch processing error:", {}, err instanceof Error ? err : new Error(String(err)));
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// EMAIL GANTT EXPORT TO PROJECT CONTACTS
// ============================================

// GET /api/ai-features/schedule/:projectId/email-recipients
// Returns the project's owner/GC contacts (for the "Send to..." picker on the schedule tab)
router.get("/ai-features/schedule/:projectId/email-recipients", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [project] = await db.select()
      .from(projects)
      .where(and(
        eq(projects.id, req.params.projectId),
        eq(projects.organizationId, organizationId),
      ))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const recipients: Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      source: "PROJECT_CLIENT" | "GC_CONTACT" | "OWNER_REP_CONTACT";
    }> = [];

    if (project.clientContactEmail) {
      recipients.push({
        id: `project:${project.id}:client`,
        name: project.clientContactName || project.clientName || "Owner contact",
        email: project.clientContactEmail,
        role: "Owner / Client",
        source: "PROJECT_CLIENT",
      });
    }

    const orgIdsToLoad: string[] = [];
    if (project.gcOrganizationId) orgIdsToLoad.push(project.gcOrganizationId);
    if (project.ownerRepOrganizationId) orgIdsToLoad.push(project.ownerRepOrganizationId);

    if (orgIdsToLoad.length > 0) {
      const contacts = await db.select()
        .from(crmContacts)
        .where(and(
          eq(crmContacts.organizationId, organizationId),
          inArray(crmContacts.organisationId, orgIdsToLoad),
          eq(crmContacts.isActive, true),
        ));

      for (const c of contacts) {
        if (!c.email) continue;
        const isGc = c.organisationId === project.gcOrganizationId;
        const fullName = `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.email;
        recipients.push({
          id: c.id,
          name: fullName,
          email: c.email,
          role: c.title || (isGc ? "General Contractor" : "Owner Rep"),
          source: isGc ? "GC_CONTACT" : "OWNER_REP_CONTACT",
        });
      }
    }

    // Deduplicate by email (case-insensitive), keeping the first occurrence
    const seen = new Set<string>();
    const deduped = recipients.filter(r => {
      const key = r.email.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ recipients: deduped });
  } catch (error) {
    next(error);
  }
});

// GET /api/ai-features/schedule/:projectId/email-history
// Returns recent GANTT_EMAILED activity log entries for this project.
router.get("/ai-features/schedule/:projectId/email-history", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [project] = await db.select({ id: projects.id })
      .from(projects)
      .where(and(
        eq(projects.id, req.params.projectId),
        eq(projects.organizationId, organizationId),
      ))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Filter by org + action, then narrow to entries that mention this project id.
    // The details payload is a JSON string containing `"projectId":"<id>"`.
    const projectIdFragment = `%"projectId":"${project.id}"%`;
    const rows = await db.select({
      id: activityLog.id,
      createdAt: activityLog.createdAt,
      details: activityLog.details,
      userId: activityLog.userId,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.userId))
      .where(and(
        eq(activityLog.organizationId, organizationId),
        eq(activityLog.action, "GANTT_EMAILED"),
        sql`${activityLog.details} LIKE ${projectIdFragment}`,
      ))
      .orderBy(desc(activityLog.createdAt))
      .limit(25);

    const ganttEmailedRecipientSchema = z.object({
      email: z.string().default(""),
      name: z.string().optional().default(""),
      success: z.boolean().optional().default(false),
    });

    const ganttEmailedDetailsSchema = z.object({
      projectId: z.string(),
      subject: z.string().optional().default(""),
      filename: z.string().optional().default(""),
      recipients: z.array(ganttEmailedRecipientSchema).optional().default([]),
      successCount: z.number().int().nonnegative().optional(),
      failureCount: z.number().int().nonnegative().optional(),
    });

    interface ScheduleEmailHistoryEntry {
      id: string;
      createdAt: Date;
      senderName: string;
      senderEmail: string | null;
      subject: string;
      filename: string;
      recipients: Array<{ email: string; name: string; success: boolean }>;
      successCount: number;
      failureCount: number;
    }

    const history: ScheduleEmailHistoryEntry[] = [];
    for (const row of rows) {
      if (!row.details) continue;
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(row.details);
      } catch {
        continue;
      }
      const parsed = ganttEmailedDetailsSchema.safeParse(rawJson);
      if (!parsed.success) continue;
      // Defensive: skip rows that matched the LIKE but aren't actually for this project.
      if (parsed.data.projectId !== project.id) continue;

      const recipients = parsed.data.recipients.map((r) => ({
        email: r.email,
        name: r.name,
        success: r.success,
      }));
      const successCount = parsed.data.successCount ?? recipients.filter((r) => r.success).length;
      const failureCount = parsed.data.failureCount ?? recipients.filter((r) => !r.success).length;

      const senderName = `${row.userFirstName ?? ""} ${row.userLastName ?? ""}`.trim()
        || row.userEmail
        || "Unknown sender";

      history.push({
        id: row.id,
        createdAt: row.createdAt,
        senderName,
        senderEmail: row.userEmail ?? null,
        subject: parsed.data.subject,
        filename: parsed.data.filename,
        recipients,
        successCount,
        failureCount,
      });
    }

    res.json({ history });
  } catch (error) {
    next(error);
  }
});

const emailRecipientSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

const emailGanttPayloadSchema = z.object({
  recipients: z.array(emailRecipientSchema).min(1).max(25),
  subject: z.string().trim().min(1).max(300),
  message: z.string().max(5000).optional().default(""),
  filename: z.string().trim().min(1).max(200).optional(),
});

// POST /api/ai-features/schedule/:projectId/email
// Body: multipart with `pdf` file and `payload` JSON string
router.post(
  "/ai-features/schedule/:projectId/email",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  sensitiveLimiter,
  ganttPdfUpload.single("pdf"),
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const organizationId = req.user?.organizationId;
      if (!userId || !organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({ error: "Gantt PDF attachment is required" });
      }

      let payloadRaw: any;
      try {
        payloadRaw = JSON.parse(typeof req.body?.payload === "string" ? req.body.payload : "{}");
      } catch {
        return res.status(400).json({ error: "Invalid payload JSON" });
      }

      const parsed = emailGanttPayloadSchema.safeParse(payloadRaw);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { recipients, subject, message, filename } = parsed.data;

      const [project] = await db.select()
        .from(projects)
        .where(and(
          eq(projects.id, req.params.projectId),
          eq(projects.organizationId, organizationId),
        ))
        .limit(1);

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const safeFilename = (filename || `${project.code || "project"}-schedule.pdf`)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

      const escapeHtml = (s: string) => s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

      const noteHtml = message
        ? `<p style="white-space:pre-wrap;">${escapeHtml(message)}</p>`
        : `<p>Attached is the latest Gantt schedule for <strong>${escapeHtml(project.name)}</strong> (${escapeHtml(project.code)}).</p>`;

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;color:#111;">
          <h2 style="margin:0 0 12px 0;">${escapeHtml(project.name)} — Schedule update</h2>
          <p style="color:#555;margin:0 0 16px 0;">Project ${escapeHtml(project.code)}</p>
          ${noteHtml}
          <p style="color:#555;font-size:12px;margin-top:24px;">The latest Gantt PDF is attached.</p>
        </div>
      `;
      const text = `${project.name} (${project.code}) — Schedule update\n\n${message || "Attached is the latest Gantt schedule."}\n`;

      const sendResults = await Promise.all(
        recipients.map(async (r) => {
          const ok = await sendEmail({
            to: r.email,
            subject,
            html,
            text,
            attachments: [
              {
                filename: safeFilename,
                content: req.file!.buffer,
                contentType: "application/pdf",
              },
            ],
          });
          return { email: r.email, name: r.name, success: ok };
        })
      );

      const successCount = sendResults.filter(r => r.success).length;
      const failureCount = sendResults.length - successCount;

      try {
        await db.insert(activityLog).values({
          userId,
          organizationId,
          action: "GANTT_EMAILED",
          details: JSON.stringify({
            projectId: project.id,
            projectCode: project.code,
            projectName: project.name,
            subject,
            filename: safeFilename,
            recipients: sendResults,
            successCount,
            failureCount,
          }),
          ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
          userAgent: (req.headers["user-agent"] as string) || null,
        });
      } catch (logErr) {
        logWarn("Failed to write Gantt email activity log", {
          projectId: project.id,
          error: logErr instanceof Error ? logErr.message : String(logErr),
        });
      }

      if (successCount === 0) {
        return res.status(502).json({
          error: "Failed to send Gantt email to any recipient",
          results: sendResults,
        });
      }

      res.json({
        success: true,
        successCount,
        failureCount,
        results: sendResults,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
