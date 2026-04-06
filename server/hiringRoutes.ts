import { Router } from "express";
import { eq, and, desc, sql, count, or, ilike, gte, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireRole, requireFeaturePermission } from "./auth";
import type { AuthRequest } from "./auth";
import { logCreate, logUpdate, logAudit } from "./auditLogger";
import { insertNotification } from "./services/notificationService";
import { encryptToken, decryptToken } from "./integrations/encryption";
import { getATSProvider, listATSProviders } from "./integrations/ats/registry";
import { isFeatureEnabled } from "./services/featureFlagService";
import { eventBus } from "./events";
import {logError, logInfo, logWarn } from "./utils/logger";
import { governedAiCall } from "./services/aiGovernance";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import {
  hiringJobs,
  hiringJobTemplates,
  hiringCandidates,
  hiringCandidateDocuments,
  hiringCandidateNotes,
  hiringCandidateStageHistory,
  hiringInterviews,
  hiringTasks,
  hiringIntegrations,
  hiringSyncLogs,
  hiringAiReviews,
  hiringPipelineConfigs,
  hiringPipelineStages,
  hiringActivityLogs,
  organizations,
  tasks,
  insertHiringJobSchema,
  insertHiringJobTemplateSchema,
  insertHiringCandidateSchema,
  insertHiringCandidateNoteSchema,
  insertHiringCandidateDocumentSchema,
  insertHiringInterviewSchema,
  insertHiringTaskSchema,
  type InsertHiringActivityLog,
} from "@shared/schema";

const router = Router();

// ============================================
// RBAC ROLE SETS
// ============================================

/** Full read + write hiring access */
const HIRING_FULL = ["ADMIN", "HUSTLER"] as const;
/** Candidate-review (read candidates/interviews, approve stage moves) */
const HIRING_REVIEW = ["ADMIN", "HUSTLER", "MANAGER"] as const;
/** Manager-level hiring: can schedule interviews, run AI review, update stage */
const HIRING_MANAGER_LEVEL = ["ADMIN", "HUSTLER", "MANAGER"] as const;
/** Advanced hiring views (Interviews list + Analytics pages): ADMIN/HUSTLER/MANAGER only */
const HIRING_ADVANCED = ["ADMIN", "HUSTLER", "MANAGER"] as const;
/** Integration management restricted to ADMIN only (ATS credentials are sensitive) */
const HIRING_INTEGRATION = ["ADMIN"] as const;

type UserRole = (typeof HIRING_FULL)[number] | (typeof HIRING_REVIEW)[number];

// ============================================
// HELPERS
// ============================================

function orgId(req: AuthRequest): string {
  return req.user!.organizationId!;
}

function userId(req: AuthRequest): string {
  return req.user!.id;
}

function userName(req: AuthRequest): string {
  return `${req.user!.firstName} ${req.user!.lastName}`.trim();
}

function emitEvent(event: Parameters<typeof eventBus.emit>[0]): void {
  setImmediate(() => {
    eventBus.emit(event).catch((err: unknown) => {
      logError("hiringRoutes: eventBus.emit failed", { error: String(err), eventType: event.type });
    });
  });
}

type HiringActivityType = InsertHiringActivityLog["activityType"];

async function logActivity(
  organizationId: string,
  actorUserId: string,
  actorName: string,
  activityType: HiringActivityType,
  entityType: string,
  entityId: string,
  entityLabel: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(hiringActivityLogs).values({
      organizationId,
      actorUserId,
      actorName,
      activityType,
      entityType,
      entityId,
      entityLabel,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (err) {
    logError("hiringActivityLogs: insert failed", { error: String(err) });
  }
}

// ============================================
// FEATURE-FLAG MIDDLEWARE
// ============================================
router.use(requireAuth, requireFeaturePermission('canManageHiring'), async (req: AuthRequest, res, next) => {
  const org = req.user?.organizationId;
  if (!org) return res.status(403).json({ error: "Organization context required" });
  if (req.user?.role === "SUPER_ADMIN") return next();
  const enabled = await isFeatureEnabled(org, "HIRING_MODULE");
  if (!enabled) return res.status(403).json({ error: "Hiring Module is not enabled for this organization" });
  return next();
});

// ============================================
// JOBS
// ============================================

// /jobs/templates must be registered BEFORE /jobs/:id to prevent route shadowing
router.get("/jobs/templates", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const templates = await db
      .select()
      .from(hiringJobTemplates)
      .where(or(eq(hiringJobTemplates.isGlobal, true), eq(hiringJobTemplates.organizationId, orgId(req))))
      .orderBy(desc(hiringJobTemplates.createdAt));
    res.json(templates);
  } catch (err) {
    logError("GET /api/hiring/jobs/templates", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

router.post("/jobs/templates", requireAuth, requireRole(...HIRING_FULL), async (req: AuthRequest, res) => {
  try {
    const parsed = insertHiringJobTemplateSchema.safeParse({
      ...req.body,
      organizationId: orgId(req),
      isGlobal: false,
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const [tpl] = await db.insert(hiringJobTemplates).values(parsed.data).returning();
    res.status(201).json(tpl);
  } catch (err) {
    logError("POST /api/hiring/jobs/templates", { error: String(err) });
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.get("/jobs", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const jobs = await db
      .select()
      .from(hiringJobs)
      .where(eq(hiringJobs.organizationId, orgId(req)))
      .orderBy(desc(hiringJobs.createdAt));
    res.json(jobs);
  } catch (err) {
    logError("GET /api/hiring/jobs", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

router.get("/jobs/:id", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const [job] = await db
      .select()
      .from(hiringJobs)
      .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
      .limit(1);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    logError("GET /api/hiring/jobs/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

router.post(
  "/jobs",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const parsed = insertHiringJobSchema.safeParse({
        ...req.body,
        organizationId: orgId(req),
        createdByUserId: userId(req),
        updatedByUserId: userId(req),
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const [job] = await db.insert(hiringJobs).values(parsed.data).returning();

      void logCreate(userId(req), "hiring_job", job.id, job, req);
      void logActivity(orgId(req), userId(req), userName(req), "JOB_CREATED", "job", job.id, job.title);

      res.status(201).json(job);
    } catch (err) {
      logError("POST /api/hiring/jobs", { error: String(err) });
      res.status(500).json({ error: "Failed to create job" });
    }
  },
);

async function handleJobUpdate(req: AuthRequest, res: Parameters<Parameters<typeof router.patch>[1]>[1]): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(hiringJobs)
      .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Job not found" }); return; }

    const updates: Record<string, unknown> = { ...req.body, updatedByUserId: userId(req), updatedAt: new Date() };
    delete updates["id"];
    delete updates["organizationId"];
    delete updates["createdAt"];

    const [job] = await db
      .update(hiringJobs)
      .set(updates as Partial<typeof hiringJobs.$inferInsert>)
      .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
      .returning();

    void logUpdate(userId(req), "hiring_job", job.id, existing, job, req);
    res.json(job);
  } catch (err) {
    logError("PATCH/PUT /api/hiring/jobs/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to update job" });
  }
}

router.patch("/jobs/:id", requireAuth, requireRole(...HIRING_FULL), (req, res) => handleJobUpdate(req as AuthRequest, res));
router.put("/jobs/:id", requireAuth, requireRole(...HIRING_FULL), (req, res) => handleJobUpdate(req as AuthRequest, res));

router.post(
  "/jobs/:id/publish",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringJobs)
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Job not found" });

      const [job] = await db
        .update(hiringJobs)
        .set({ status: "PUBLISHED", publishedAt: existing.publishedAt ?? new Date(), updatedAt: new Date(), updatedByUserId: userId(req) })
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
        .returning();

      void logUpdate(userId(req), "hiring_job", job.id, existing, job, req);
      void logActivity(orgId(req), userId(req), userName(req), "JOB_PUBLISHED", "job", job.id, job.title);

      emitEvent({
        type: "hiring.job_published",
        version: 1,
        orgId: orgId(req),
        actorId: userId(req),
        timestamp: new Date(),
        payload: { jobId: job.id, title: job.title, employmentType: job.employmentType ?? null },
      });

      res.json(job);
    } catch (err) {
      logError("POST /api/hiring/jobs/:id/publish", { error: String(err) });
      res.status(500).json({ error: "Failed to publish job" });
    }
  },
);

router.post(
  "/jobs/:id/archive",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringJobs)
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Job not found" });

      const [job] = await db
        .update(hiringJobs)
        .set({ status: "ARCHIVED", archivedAt: existing.archivedAt ?? new Date(), updatedAt: new Date(), updatedByUserId: userId(req) })
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
        .returning();

      void logUpdate(userId(req), "hiring_job", job.id, existing, job, req);
      void logActivity(orgId(req), userId(req), userName(req), "JOB_ARCHIVED", "job", job.id, job.title);

      res.json(job);
    } catch (err) {
      logError("POST /api/hiring/jobs/:id/archive", { error: String(err) });
      res.status(500).json({ error: "Failed to archive job" });
    }
  },
);

router.delete(
  "/jobs/:id",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringJobs)
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Job not found" });

      await db
        .update(hiringJobs)
        .set({ status: "ARCHIVED", archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))));

      void logAudit({ userId: userId(req), entityType: "hiring_job", entityId: req.params.id, action: "DELETE", oldValue: JSON.stringify({ status: existing.status }), newValue: JSON.stringify({ status: "ARCHIVED" }) }, req);
      void logActivity(orgId(req), userId(req), userName(req), "JOB_ARCHIVED", "job", req.params.id, existing.title);

      res.json({ success: true });
    } catch (err) {
      logError("DELETE /api/hiring/jobs/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to archive job" });
    }
  },
);

// ============================================
// JOB TEMPLATES
// ============================================

router.get("/job-templates", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const templates = await db
      .select()
      .from(hiringJobTemplates)
      .where(
        or(
          eq(hiringJobTemplates.isGlobal, true),
          eq(hiringJobTemplates.organizationId, orgId(req)),
        ),
      )
      .orderBy(desc(hiringJobTemplates.createdAt));
    res.json(templates);
  } catch (err) {
    logError("GET /api/hiring/job-templates", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

router.post(
  "/job-templates",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const parsed = insertHiringJobTemplateSchema.safeParse({
        ...req.body,
        organizationId: orgId(req),
        isGlobal: false,
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const [tpl] = await db.insert(hiringJobTemplates).values(parsed.data).returning();
      res.status(201).json(tpl);
    } catch (err) {
      logError("POST /api/hiring/job-templates", { error: String(err) });
      res.status(500).json({ error: "Failed to create template" });
    }
  },
);

/**
 * POST /job-templates/seed — Seeds trade-specific job templates for this organization.
 * Idempotent: skips templates that already exist (matched by title + org).
 */
router.post(
  "/job-templates/seed",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    const { trade } = req.body;
    const org = orgId(req);

    const CONTRACTOR_TEMPLATES: Array<{ title: string; trade: string; employmentType: string; description: string; requirements: string }> = [
      {
        title: "General Laborer",
        trade: trade || "GENERAL",
        employmentType: "FULL_TIME",
        description: "Assist with site preparation, material handling, and general construction tasks under supervisor direction.",
        requirements: "Physical fitness required. Construction experience preferred. Valid driver license a plus.",
      },
      {
        title: "Journeyman Carpenter",
        trade: trade || "CARPENTRY",
        employmentType: "FULL_TIME",
        description: "Frame walls, install doors/windows, and complete finish carpentry on commercial and residential projects.",
        requirements: "Journeyman card or equivalent 4+ years experience. OSHA 10 required. Must supply own hand tools.",
      },
      {
        title: "Foreman",
        trade: trade || "GENERAL",
        employmentType: "FULL_TIME",
        description: "Lead a crew of 4-10 field workers, coordinate daily tasks, enforce safety standards, and report to superintendent.",
        requirements: "5+ years construction experience, 2+ years leadership. OSHA 30 preferred. Strong communication skills.",
      },
      {
        title: "Apprentice Electrician",
        trade: trade || "ELECTRICAL",
        employmentType: "FULL_TIME",
        description: "Assist journeyman electricians with conduit installation, wire pulling, and device installation on new construction.",
        requirements: "Enrolled in or completed IBEW apprenticeship. Basic math skills. Valid driver license.",
      },
      {
        title: "Project Superintendent",
        trade: trade || "GENERAL",
        employmentType: "FULL_TIME",
        description: "Manage day-to-day operations on large-scale construction projects, coordinate subcontractors, and ensure schedule adherence.",
        requirements: "10+ years construction experience. Proficient with project scheduling software. OSHA 30 required.",
      },
    ].filter((t) => !trade || t.trade === trade || t.trade === "GENERAL");

    try {
      const seeded: string[] = [];
      const skipped: string[] = [];

      for (const template of CONTRACTOR_TEMPLATES) {
        const [existing] = await db
          .select({ id: hiringJobTemplates.id })
          .from(hiringJobTemplates)
          .where(and(eq(hiringJobTemplates.organizationId, org), eq(hiringJobTemplates.title, template.title)))
          .limit(1);

        if (existing) {
          skipped.push(template.title);
          continue;
        }

        await db.insert(hiringJobTemplates).values({
          organizationId: org,
          title: template.title,
          trade: template.trade,
          employmentType: template.employmentType as typeof hiringJobs.$inferInsert.employmentType,
          description: template.description,
          requirements: template.requirements,
          isGlobal: false,
        });
        seeded.push(template.title);
      }

      res.json({ seeded, skipped, total: CONTRACTOR_TEMPLATES.length });
    } catch (err) {
      logError("POST /api/hiring/job-templates/seed", { error: String(err) });
      res.status(500).json({ error: "Failed to seed job templates" });
    }
  },
);

router.delete(
  "/job-templates/:id",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [tpl] = await db
        .select({ id: hiringJobTemplates.id, isGlobal: hiringJobTemplates.isGlobal })
        .from(hiringJobTemplates)
        .where(and(eq(hiringJobTemplates.id, req.params.id), eq(hiringJobTemplates.organizationId, orgId(req))))
        .limit(1);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      if (tpl.isGlobal) return res.status(403).json({ error: "Cannot delete a global template" });
      await db.delete(hiringJobTemplates).where(eq(hiringJobTemplates.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      logError("DELETE /api/hiring/job-templates/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to delete template" });
    }
  },
);

// ============================================
// CANDIDATES
// ============================================

router.get("/candidates", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const jobId = req.query.jobId as string | undefined;
    const stage = req.query.stage as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions = [eq(hiringCandidates.organizationId, org)];
    if (jobId) conditions.push(eq(hiringCandidates.jobId, jobId));
    if (stage) conditions.push(eq(hiringCandidates.currentStage, stage as Parameters<typeof eq>[1]));

    if (search) {
      const candidates = await db
        .select()
        .from(hiringCandidates)
        .where(
          and(
            ...conditions,
            or(
              ilike(hiringCandidates.fullName, `%${search}%`),
              ilike(hiringCandidates.email, `%${search}%`),
            ),
          ),
        )
        .orderBy(desc(hiringCandidates.appliedAt));
      return res.json(candidates);
    }

    const candidates = await db
      .select()
      .from(hiringCandidates)
      .where(and(...conditions))
      .orderBy(desc(hiringCandidates.appliedAt));

    res.json(candidates);
  } catch (err) {
    logError("GET /api/hiring/candidates", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch candidates" });
  }
});

router.get("/candidates/:id", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const [candidate] = await db
      .select()
      .from(hiringCandidates)
      .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, org)))
      .limit(1);
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });

    const [notes, documents, interviews, stageHistory, aiReviews] = await Promise.all([
      db.select().from(hiringCandidateNotes).where(eq(hiringCandidateNotes.candidateId, req.params.id)).orderBy(desc(hiringCandidateNotes.createdAt)),
      db.select().from(hiringCandidateDocuments).where(eq(hiringCandidateDocuments.candidateId, req.params.id)).orderBy(desc(hiringCandidateDocuments.createdAt)),
      db.select().from(hiringInterviews).where(and(eq(hiringInterviews.candidateId, req.params.id), eq(hiringInterviews.organizationId, org))).orderBy(desc(hiringInterviews.createdAt)),
      db.select().from(hiringCandidateStageHistory).where(eq(hiringCandidateStageHistory.candidateId, req.params.id)).orderBy(desc(hiringCandidateStageHistory.createdAt)),
      db.select().from(hiringAiReviews).where(eq(hiringAiReviews.candidateId, req.params.id)).orderBy(desc(hiringAiReviews.generatedAt)).limit(1),
    ]);

    res.json({ ...candidate, notes, documents, interviews, stageHistory, latestAiReview: aiReviews[0] ?? null });
  } catch (err) {
    logError("GET /api/hiring/candidates/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch candidate" });
  }
});

router.post(
  "/candidates",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const body = req.body;
      const fullName = `${body.firstName || ""} ${body.lastName || ""}`.trim() || "Unknown";
      const parsed = insertHiringCandidateSchema.safeParse({
        ...body,
        fullName,
        organizationId: orgId(req),
        appliedAt: body.appliedAt ? new Date(body.appliedAt) : new Date(),
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      if (parsed.data.jobId) {
        const [job] = await db
          .select({ id: hiringJobs.id })
          .from(hiringJobs)
          .where(and(eq(hiringJobs.id, parsed.data.jobId), eq(hiringJobs.organizationId, orgId(req))))
          .limit(1);
        if (!job) return res.status(400).json({ error: "Invalid jobId — job does not belong to your organization" });
      }

      const [candidate] = await db.insert(hiringCandidates).values(parsed.data).returning();

      await db.insert(hiringCandidateStageHistory).values({
        organizationId: orgId(req),
        candidateId: candidate.id,
        fromStage: null,
        toStage: candidate.currentStage || "APPLIED",
        changedByUserId: userId(req),
        changedByName: userName(req),
        reason: "Initial application",
      });

      void logCreate(userId(req), "hiring_candidate", candidate.id, candidate, req);
      void logActivity(orgId(req), userId(req), userName(req), "CANDIDATE_APPLIED", "candidate", candidate.id, candidate.fullName);

      emitEvent({
        type: "hiring.candidate_applied",
        version: 1,
        orgId: orgId(req),
        actorId: userId(req),
        timestamp: new Date(),
        payload: { candidateId: candidate.id, jobId: candidate.jobId ?? null, fullName: candidate.fullName },
      });

      res.status(201).json(candidate);
    } catch (err) {
      logError("POST /api/hiring/candidates", { error: String(err) });
      res.status(500).json({ error: "Failed to create candidate" });
    }
  },
);

async function handleCandidateUpdate(req: AuthRequest, res: Parameters<Parameters<typeof router.patch>[1]>[1]): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(hiringCandidates)
      .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Candidate not found" }); return; }

    const updates: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
    delete updates["id"];
    delete updates["organizationId"];
    delete updates["createdAt"];
    delete updates["currentStage"];

    const [candidate] = await db
      .update(hiringCandidates)
      .set(updates as Partial<typeof hiringCandidates.$inferInsert>)
      .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
      .returning();

    void logUpdate(userId(req), "hiring_candidate", candidate.id, existing, candidate, req);
    res.json(candidate);
  } catch (err) {
    logError("PATCH/PUT /api/hiring/candidates/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to update candidate" });
  }
}

router.patch("/candidates/:id", requireAuth, requireRole(...HIRING_FULL), (req, res) => handleCandidateUpdate(req as AuthRequest, res));
router.put("/candidates/:id", requireAuth, requireRole(...HIRING_FULL), (req, res) => handleCandidateUpdate(req as AuthRequest, res));

// PUT /candidates/:id/stage — stage transition (spec requires PUT)
router.put(
  "/candidates/:id/stage",
  requireAuth,
  requireRole(...HIRING_REVIEW),
  async (req: AuthRequest, res) => {
    try {
      const { stage, reason } = req.body;
      if (!stage) return res.status(400).json({ error: "stage is required" });

      const [existing] = await db
        .select()
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Candidate not found" });

      const fromStage = existing.currentStage;

      const [candidate] = await db
        .update(hiringCandidates)
        .set({ currentStage: stage, updatedAt: new Date() })
        .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
        .returning();

      await db.insert(hiringCandidateStageHistory).values({
        organizationId: orgId(req),
        candidateId: req.params.id,
        fromStage: fromStage ?? null,
        toStage: stage,
        changedByUserId: userId(req),
        changedByName: userName(req),
        reason: reason ?? null,
      });

      const activityType: HiringActivityType = stage === "HIRED" ? "CANDIDATE_HIRED" : stage === "REJECTED" ? "CANDIDATE_REJECTED" : "CANDIDATE_STAGE_CHANGED";
      void logActivity(orgId(req), userId(req), userName(req), activityType, "candidate", req.params.id, existing.fullName, { fromStage, toStage: stage });

      // Always emit stage-changed so all stage subscribers receive every transition
      emitEvent({
        type: "hiring.candidate_stage_changed",
        version: 1,
        orgId: orgId(req),
        actorId: userId(req),
        timestamp: new Date(),
        payload: { candidateId: existing.id, fullName: existing.fullName, fromStage: fromStage ?? null, toStage: stage },
      });

      if (stage === "HIRED") {
        // Additionally emit hired event for higher-signal subscribers
        emitEvent({
          type: "hiring.candidate_hired",
          version: 1,
          orgId: orgId(req),
          actorId: userId(req),
          timestamp: new Date(),
          payload: { candidateId: existing.id, fullName: existing.fullName, jobId: existing.jobId ?? null },
        });
        if (existing.reviewerUserId) {
          void insertNotification({
            userId: existing.reviewerUserId,
            organizationId: orgId(req),
            type: "GENERAL",
            title: "Candidate Hired",
            message: `${existing.fullName} has been marked as hired.`,
            relatedEntityId: existing.id,
            relatedEntityType: "hiring_candidate",
          });
        }
      } else if (existing.reviewerUserId && existing.reviewerUserId !== userId(req)) {
        // Notify reviewer of any other stage change so they stay informed
        void insertNotification({
          userId: existing.reviewerUserId,
          organizationId: orgId(req),
          type: "GENERAL",
          title: "Candidate Stage Updated",
          message: `${existing.fullName} has moved from ${fromStage} to ${stage}.`,
          relatedEntityId: existing.id,
          relatedEntityType: "hiring_candidate",
        });
      }

      // Auto-create a follow-up task in the unified tasks table when hiringAutoTasksEnabled org setting is on
      const [orgSettings] = await db
        .select({ hiringAutoTasksEnabled: organizations.hiringAutoTasksEnabled })
        .from(organizations)
        .where(eq(organizations.id, orgId(req)));
      if (orgSettings?.hiringAutoTasksEnabled) {
        const STAGE_TASK_MAP: Record<string, string> = {
          SCREENING: `Review application for ${existing.fullName}`,
          PHONE_INTERVIEW: `Schedule phone interview with ${existing.fullName}`,
          IN_PERSON_INTERVIEW: `Schedule in-person interview with ${existing.fullName}`,
          SKILLS_ASSESSMENT: `Send skills assessment to ${existing.fullName}`,
          BACKGROUND_CHECK: `Initiate background check for ${existing.fullName}`,
          REFERENCE_CHECK: `Complete reference checks for ${existing.fullName}`,
          OFFER_EXTENDED: `Follow up on offer status with ${existing.fullName}`,
        };
        const taskTitle = STAGE_TASK_MAP[stage];
        if (taskTitle) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 3);
          void db.insert(tasks).values({
            organizationId: orgId(req),
            context: "HIRING",
            hiringCandidateId: existing.id,
            title: taskTitle,
            status: "PENDING",
            priority: "MEDIUM",
            sourceType: "SYSTEM",
            assignedToId: existing.reviewerUserId ?? userId(req),
            dueDate,
            createdById: userId(req),
          });
        }
      }

      res.json(candidate);
    } catch (err) {
      logError("PUT /api/hiring/candidates/:id/stage", { error: String(err) });
      res.status(500).json({ error: "Failed to update candidate stage" });
    }
  },
);

// POST /candidates/:id/documents — register a document (storage_key from GCS upload)
router.post(
  "/candidates/:id/documents",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [candidate] = await db
        .select({ id: hiringCandidates.id })
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
        .limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });

      const parsed = insertHiringCandidateDocumentSchema.safeParse({
        ...req.body,
        organizationId: orgId(req),
        candidateId: req.params.id,
        uploadedByUserId: userId(req),
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const [doc] = await db.insert(hiringCandidateDocuments).values(parsed.data).returning();
      res.status(201).json(doc);
    } catch (err) {
      logError("POST /api/hiring/candidates/:id/documents", { error: String(err) });
      res.status(500).json({ error: "Failed to register candidate document" });
    }
  },
);

router.delete(
  "/candidates/:candidateId/documents/:docId",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [doc] = await db
        .select()
        .from(hiringCandidateDocuments)
        .where(and(eq(hiringCandidateDocuments.id, req.params.docId), eq(hiringCandidateDocuments.organizationId, orgId(req))))
        .limit(1);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      await db.delete(hiringCandidateDocuments).where(eq(hiringCandidateDocuments.id, req.params.docId));
      res.json({ success: true });
    } catch (err) {
      logError("DELETE /api/hiring/candidates/:candidateId/documents/:docId", { error: String(err) });
      res.status(500).json({ error: "Failed to delete document" });
    }
  },
);

// ============================================
// CANDIDATE NOTES
// ============================================

router.get(
  "/candidates/:id/notes",
  requireAuth,
  requireRole(...HIRING_REVIEW),
  async (req: AuthRequest, res) => {
    try {
      const [candidate] = await db
        .select({ id: hiringCandidates.id })
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
        .limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });

      const notes = await db
        .select()
        .from(hiringCandidateNotes)
        .where(and(eq(hiringCandidateNotes.candidateId, req.params.id), eq(hiringCandidateNotes.organizationId, orgId(req))))
        .orderBy(desc(hiringCandidateNotes.createdAt));
      res.json(notes);
    } catch (err) {
      logError("GET /api/hiring/candidates/:id/notes", { error: String(err) });
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  },
);

router.post(
  "/candidates/:id/notes",
  requireAuth,
  requireRole(...HIRING_REVIEW),
  async (req: AuthRequest, res) => {
    try {
      const [candidate] = await db
        .select({ id: hiringCandidates.id })
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
        .limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });

      const parsed = insertHiringCandidateNoteSchema.safeParse({
        ...req.body,
        organizationId: orgId(req),
        candidateId: req.params.id,
        authorUserId: userId(req),
        authorName: userName(req),
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const [note] = await db.insert(hiringCandidateNotes).values(parsed.data).returning();
      void logActivity(orgId(req), userId(req), userName(req), "NOTE_ADDED", "candidate_note", note.id, `Note on candidate ${req.params.id}`);

      res.status(201).json(note);
    } catch (err) {
      logError("POST /api/hiring/candidates/:id/notes", { error: String(err) });
      res.status(500).json({ error: "Failed to add note" });
    }
  },
);

router.delete(
  "/candidates/:candidateId/notes/:noteId",
  requireAuth,
  requireRole(...HIRING_REVIEW),
  async (req: AuthRequest, res) => {
    try {
      const [note] = await db
        .select()
        .from(hiringCandidateNotes)
        .where(and(eq(hiringCandidateNotes.id, req.params.noteId), eq(hiringCandidateNotes.organizationId, orgId(req))))
        .limit(1);
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (note.authorUserId !== userId(req) && req.user!.role !== "ADMIN") {
        return res.status(403).json({ error: "Cannot delete another user's note" });
      }
      await db.delete(hiringCandidateNotes).where(eq(hiringCandidateNotes.id, req.params.noteId));
      res.json({ success: true });
    } catch (err) {
      logError("DELETE /api/hiring/candidates/:candidateId/notes/:noteId", { error: String(err) });
      res.status(500).json({ error: "Failed to delete note" });
    }
  },
);

// GET /candidates/:id/activity — per-candidate activity log
router.get(
  "/candidates/:id/activity",
  requireAuth,
  requireRole(...HIRING_REVIEW),
  async (req: AuthRequest, res) => {
    try {
      const org = orgId(req);
      const logs = await db
        .select()
        .from(hiringActivityLogs)
        .where(and(
          eq(hiringActivityLogs.organizationId, org),
          eq(hiringActivityLogs.entityId, req.params.id),
        ))
        .orderBy(desc(hiringActivityLogs.createdAt))
        .limit(50);
      res.json(logs);
    } catch (err) {
      logError("GET /api/hiring/candidates/:id/activity", { error: String(err) });
      res.status(500).json({ error: "Failed to fetch activity" });
    }
  },
);

// ============================================
// INTERVIEWS
// ============================================

router.get("/interviews", requireAuth, requireRole(...HIRING_ADVANCED), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const candidateId = req.query.candidateId as string | undefined;

    const conditions = [eq(hiringInterviews.organizationId, org)];
    if (candidateId) conditions.push(eq(hiringInterviews.candidateId, candidateId));

    const rows = await db
      .select({
        id: hiringInterviews.id,
        organizationId: hiringInterviews.organizationId,
        candidateId: hiringInterviews.candidateId,
        jobId: hiringInterviews.jobId,
        interviewType: hiringInterviews.interviewType,
        startAt: hiringInterviews.startAt,
        endAt: hiringInterviews.endAt,
        timezone: hiringInterviews.timezone,
        location: hiringInterviews.location,
        videoLink: hiringInterviews.videoLink,
        interviewerUserIdsJson: hiringInterviews.interviewerUserIdsJson,
        status: hiringInterviews.status,
        notes: hiringInterviews.notes,
        reminderSentAt: hiringInterviews.reminderSentAt,
        createdByUserId: hiringInterviews.createdByUserId,
        updatedByUserId: hiringInterviews.updatedByUserId,
        createdAt: hiringInterviews.createdAt,
        updatedAt: hiringInterviews.updatedAt,
        candidateName: hiringCandidates.fullName,
        jobTitle: hiringJobs.title,
      })
      .from(hiringInterviews)
      .leftJoin(hiringCandidates, eq(hiringInterviews.candidateId, hiringCandidates.id))
      .leftJoin(hiringJobs, eq(hiringInterviews.jobId, hiringJobs.id))
      .where(and(...conditions))
      .orderBy(desc(hiringInterviews.startAt));

    res.json(rows);
  } catch (err) {
    logError("GET /api/hiring/interviews", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch interviews" });
  }
});

router.post(
  "/interviews",
  requireAuth,
  requireRole(...HIRING_MANAGER_LEVEL),
  async (req: AuthRequest, res) => {
    try {
      if (req.body.candidateId) {
        const [ownerCheck] = await db
          .select({ id: hiringCandidates.id })
          .from(hiringCandidates)
          .where(and(eq(hiringCandidates.id, req.body.candidateId), eq(hiringCandidates.organizationId, orgId(req))))
          .limit(1);
        if (!ownerCheck) return res.status(400).json({ error: "Invalid candidateId — candidate does not belong to your organization" });
      }

      if (req.body.jobId) {
        const [jobCheck] = await db
          .select({ id: hiringJobs.id })
          .from(hiringJobs)
          .where(and(eq(hiringJobs.id, req.body.jobId), eq(hiringJobs.organizationId, orgId(req))))
          .limit(1);
        if (!jobCheck) return res.status(400).json({ error: "Invalid jobId — job does not belong to your organization" });
      }

      const parsed = insertHiringInterviewSchema.safeParse({
        ...req.body,
        organizationId: orgId(req),
        createdByUserId: userId(req),
        updatedByUserId: userId(req),
        startAt: req.body.startAt ? new Date(req.body.startAt) : null,
        endAt: req.body.endAt ? new Date(req.body.endAt) : null,
        interviewerUserIdsJson: req.body.interviewerUserIds?.length
          ? JSON.stringify(req.body.interviewerUserIds)
          : req.body.interviewerUserIdsJson ?? null,
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const [interview] = await db.insert(hiringInterviews).values(parsed.data).returning();

      if (parsed.data.candidateId) {
        const [candidate] = await db
          .select({ reviewerUserId: hiringCandidates.reviewerUserId, fullName: hiringCandidates.fullName })
          .from(hiringCandidates)
          .where(eq(hiringCandidates.id, parsed.data.candidateId))
          .limit(1);

        if (candidate?.reviewerUserId) {
          void insertNotification({
            userId: candidate.reviewerUserId,
            organizationId: orgId(req),
            type: "GENERAL",
            title: "Interview Scheduled",
            message: `An interview has been scheduled for ${candidate.fullName}.`,
            relatedEntityId: interview.id,
            relatedEntityType: "hiring_interview",
          });
        }
      }

      void logCreate(userId(req), "hiring_interview", interview.id, interview, req);
      void logActivity(orgId(req), userId(req), userName(req), "INTERVIEW_SCHEDULED", "interview", interview.id, "Interview scheduled");

      emitEvent({
        type: "hiring.interview_scheduled",
        version: 1,
        orgId: orgId(req),
        actorId: userId(req),
        timestamp: new Date(),
        payload: {
          interviewId: interview.id,
          candidateId: interview.candidateId ?? null,
          jobId: interview.jobId ?? null,
          scheduledAt: interview.startAt ? interview.startAt.toISOString() : null,
          interviewType: interview.interviewType ?? null,
        },
      });

      res.status(201).json(interview);
    } catch (err) {
      logError("POST /api/hiring/interviews", { error: String(err) });
      res.status(500).json({ error: "Failed to schedule interview" });
    }
  },
);

async function handleInterviewUpdate(req: AuthRequest, res: Parameters<Parameters<typeof router.patch>[1]>[1]): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(hiringInterviews)
      .where(and(eq(hiringInterviews.id, req.params.id), eq(hiringInterviews.organizationId, orgId(req))))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Interview not found" }); return; }

    const updates: Record<string, unknown> = { ...req.body, updatedByUserId: userId(req), updatedAt: new Date() };
    delete updates["id"];
    delete updates["organizationId"];
    delete updates["createdAt"];
    if (updates["startAt"]) updates["startAt"] = new Date(updates["startAt"] as string);
    if (updates["endAt"]) updates["endAt"] = new Date(updates["endAt"] as string);

    const [interview] = await db
      .update(hiringInterviews)
      .set(updates as Partial<typeof hiringInterviews.$inferInsert>)
      .where(and(eq(hiringInterviews.id, req.params.id), eq(hiringInterviews.organizationId, orgId(req))))
      .returning();

    void logUpdate(userId(req), "hiring_interview", interview.id, existing, interview, req);
    res.json(interview);
  } catch (err) {
    logError("PATCH/PUT /api/hiring/interviews/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to update interview" });
  }
}

router.patch("/interviews/:id", requireAuth, requireRole(...HIRING_MANAGER_LEVEL), (req, res) => handleInterviewUpdate(req as AuthRequest, res));
router.put("/interviews/:id", requireAuth, requireRole(...HIRING_FULL), (req, res) => handleInterviewUpdate(req as AuthRequest, res));

router.delete(
  "/interviews/:id",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringInterviews)
        .where(and(eq(hiringInterviews.id, req.params.id), eq(hiringInterviews.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Interview not found" });

      await db
        .update(hiringInterviews)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(and(eq(hiringInterviews.id, req.params.id), eq(hiringInterviews.organizationId, orgId(req))));

      res.json({ success: true });
    } catch (err) {
      logError("DELETE /api/hiring/interviews/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to cancel interview" });
    }
  },
);

// ============================================
// HIRING TASKS
// ============================================

router.get("/tasks", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const candidateId = req.query.candidateId as string | undefined;
    const conditions = [eq(hiringTasks.organizationId, orgId(req))];
    if (candidateId) conditions.push(eq(hiringTasks.candidateId, candidateId));

    const tasks = await db
      .select()
      .from(hiringTasks)
      .where(and(...conditions))
      .orderBy(desc(hiringTasks.createdAt));
    res.json(tasks);
  } catch (err) {
    logError("GET /api/hiring/tasks", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch hiring tasks" });
  }
});

router.post(
  "/tasks",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      if (req.body.candidateId) {
        const [cand] = await db
          .select({ id: hiringCandidates.id })
          .from(hiringCandidates)
          .where(and(eq(hiringCandidates.id, req.body.candidateId), eq(hiringCandidates.organizationId, orgId(req))))
          .limit(1);
        if (!cand) return res.status(400).json({ error: "Invalid candidateId" });
      }

      const parsed = insertHiringTaskSchema.safeParse({
        ...req.body,
        organizationId: orgId(req),
        createdByUserId: userId(req),
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const [task] = await db.insert(hiringTasks).values(parsed.data).returning();

      if (parsed.data.assignedUserId && parsed.data.assignedUserId !== userId(req)) {
        void insertNotification({
          userId: parsed.data.assignedUserId,
          organizationId: orgId(req),
          type: "GENERAL",
          title: "Hiring Task Assigned",
          message: `You have been assigned a hiring task: ${task.title}`,
          relatedEntityId: task.id,
          relatedEntityType: "hiring_task",
        });
      }

      res.status(201).json(task);
    } catch (err) {
      logError("POST /api/hiring/tasks", { error: String(err) });
      res.status(500).json({ error: "Failed to create hiring task" });
    }
  },
);

router.patch(
  "/tasks/:id",
  requireAuth,
  requireRole(...HIRING_FULL),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringTasks)
        .where(and(eq(hiringTasks.id, req.params.id), eq(hiringTasks.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Task not found" });

      const updates: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
      delete updates["id"];
      delete updates["organizationId"];
      delete updates["createdAt"];
      if (updates["dueDate"]) updates["dueDate"] = new Date(updates["dueDate"] as string);
      if (updates["status"] === "completed" && !existing.completedAt) {
        updates["completedAt"] = new Date();
      }

      const [task] = await db
        .update(hiringTasks)
        .set(updates as Partial<typeof hiringTasks.$inferInsert>)
        .where(and(eq(hiringTasks.id, req.params.id), eq(hiringTasks.organizationId, orgId(req))))
        .returning();

      res.json(task);
    } catch (err) {
      logError("PATCH /api/hiring/tasks/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to update task" });
    }
  },
);

// ============================================
// ATS INTEGRATIONS
// ============================================

router.get("/integrations", requireAuth, requireRole(...HIRING_INTEGRATION), async (req: AuthRequest, res) => {
  try {
    const integrations = await db
      .select({
        id: hiringIntegrations.id,
        organizationId: hiringIntegrations.organizationId,
        providerName: hiringIntegrations.providerName,
        status: hiringIntegrations.status,
        lastSyncAt: hiringIntegrations.lastSyncAt,
        lastTestAt: hiringIntegrations.lastTestAt,
        defaultConfigJson: hiringIntegrations.defaultConfigJson,
        createdAt: hiringIntegrations.createdAt,
        updatedAt: hiringIntegrations.updatedAt,
      })
      .from(hiringIntegrations)
      .where(eq(hiringIntegrations.organizationId, orgId(req)));

    res.json({ integrations, availableProviders: listATSProviders() });
  } catch (err) {
    logError("GET /api/hiring/integrations", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch integrations" });
  }
});

router.post(
  "/integrations",
  requireAuth,
  requireRole(...HIRING_INTEGRATION),
  async (req: AuthRequest, res) => {
    try {
      const { providerName, credentials, defaultConfig } = req.body;
      if (!providerName || typeof credentials !== "object") {
        return res.status(400).json({ error: "providerName and credentials are required" });
      }

      const provider = getATSProvider(providerName);
      if (!provider) return res.status(400).json({ error: `Unknown ATS provider: ${providerName}` });

      const ok = await provider.testConnection(credentials);
      if (!ok) return res.status(400).json({ error: "ATS connection test failed — check your credentials" });

      const encryptedCredentials = encryptToken(JSON.stringify(credentials));

      const [existing] = await db
        .select({ id: hiringIntegrations.id })
        .from(hiringIntegrations)
        .where(and(eq(hiringIntegrations.organizationId, orgId(req)), eq(hiringIntegrations.providerName, providerName)))
        .limit(1);

      let integration;
      if (existing) {
        const [updated] = await db
          .update(hiringIntegrations)
          .set({
            encryptedCredentialsJson: encryptedCredentials,
            status: "connected",
            lastTestAt: new Date(),
            defaultConfigJson: defaultConfig ? JSON.stringify(defaultConfig) : null,
            updatedAt: new Date(),
          })
          .where(eq(hiringIntegrations.id, existing.id))
          .returning();
        integration = updated;
      } else {
        const [created] = await db.insert(hiringIntegrations).values({
          organizationId: orgId(req),
          providerName: providerName,
          encryptedCredentialsJson: encryptedCredentials,
          status: "connected",
          lastTestAt: new Date(),
          defaultConfigJson: defaultConfig ? JSON.stringify(defaultConfig) : null,
        }).returning();
        integration = created;
      }

      void logCreate(userId(req), "hiring_integration", integration.id, { provider: providerName }, req);
      void logActivity(orgId(req), userId(req), userName(req), "INTEGRATION_CONNECTED", "integration", integration.id, providerName);

      emitEvent({
        type: "hiring.integration_connected",
        version: 1,
        orgId: orgId(req),
        actorId: userId(req),
        timestamp: new Date(),
        payload: { integrationId: integration.id, providerName },
      });

      const { encryptedCredentialsJson: _, ...safeIntegration } = integration as typeof integration & { encryptedCredentialsJson?: string };
      res.status(existing ? 200 : 201).json(safeIntegration);
    } catch (err) {
      logError("POST /api/hiring/integrations", { error: String(err) });
      res.status(500).json({ error: "Failed to connect ATS integration" });
    }
  },
);

router.post(
  "/integrations/:id/test",
  requireAuth,
  requireRole(...HIRING_INTEGRATION),
  async (req: AuthRequest, res) => {
    try {
      const [integration] = await db
        .select()
        .from(hiringIntegrations)
        .where(and(eq(hiringIntegrations.id, req.params.id), eq(hiringIntegrations.organizationId, orgId(req))))
        .limit(1);
      if (!integration) return res.status(404).json({ error: "Integration not found" });
      if (!integration.encryptedCredentialsJson) return res.status(400).json({ error: "No credentials stored" });

      const provider = getATSProvider(integration.providerName);
      if (!provider) return res.status(500).json({ error: "Provider implementation not found" });

      const credentials = JSON.parse(decryptToken(integration.encryptedCredentialsJson)) as Record<string, string>;
      const ok = await provider.testConnection(credentials);

      await db.update(hiringIntegrations)
        .set({ lastTestAt: new Date(), status: ok ? "connected" : "error", updatedAt: new Date() })
        .where(eq(hiringIntegrations.id, req.params.id));

      res.json({ connected: ok, testedAt: new Date() });
    } catch (err) {
      logError("POST /api/hiring/integrations/:id/test", { error: String(err) });
      res.status(500).json({ error: "Failed to test integration" });
    }
  },
);

router.delete(
  "/integrations/:id",
  requireAuth,
  requireRole(...HIRING_INTEGRATION),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringIntegrations)
        .where(and(eq(hiringIntegrations.id, req.params.id), eq(hiringIntegrations.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Integration not found" });

      await db
        .update(hiringIntegrations)
        .set({ status: "disconnected", encryptedCredentialsJson: null, updatedAt: new Date() })
        .where(eq(hiringIntegrations.id, req.params.id));

      res.json({ success: true });
    } catch (err) {
      logError("DELETE /api/hiring/integrations/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to disconnect integration" });
    }
  },
);

router.post(
  "/integrations/:id/sync",
  requireAuth,
  requireRole(...HIRING_INTEGRATION),
  async (req: AuthRequest, res) => {
    try {
      const [integration] = await db
        .select()
        .from(hiringIntegrations)
        .where(and(eq(hiringIntegrations.id, req.params.id), eq(hiringIntegrations.organizationId, orgId(req))))
        .limit(1);

      if (!integration) return res.status(404).json({ error: "Integration not found" });
      if (integration.status !== "connected") return res.status(400).json({ error: "Integration is not connected" });
      if (!integration.encryptedCredentialsJson) return res.status(400).json({ error: "No credentials stored" });

      const provider = getATSProvider(integration.providerName);
      if (!provider) return res.status(500).json({ error: "Provider not found" });

      const [syncLog] = await db.insert(hiringSyncLogs).values({
        organizationId: orgId(req),
        integrationId: integration.id,
        provider: integration.providerName,
        status: "RUNNING",
        entityType: "all",
        startedAt: new Date(),
      }).returning();

      const capturedOrgId = orgId(req);
      const capturedIntegrationId = integration.id;
      const capturedProviderName = integration.providerName;
      const capturedEncrypted = integration.encryptedCredentialsJson;

      setImmediate(async () => {
        try {
          const credentials = JSON.parse(decryptToken(capturedEncrypted)) as Record<string, string>;
          const [atsJobs, atsCandidates] = await Promise.all([
            provider.listJobs(credentials),
            provider.listCandidates(credentials),
          ]);

          for (const atsJob of atsJobs) {
            const [existing] = await db
              .select({ id: hiringJobs.id })
              .from(hiringJobs)
              .where(and(eq(hiringJobs.organizationId, capturedOrgId), eq(hiringJobs.externalJobId, atsJob.externalId)))
              .limit(1);

            if (!existing) {
              await db.insert(hiringJobs).values({
                organizationId: capturedOrgId,
                externalProvider: capturedProviderName,
                externalJobId: atsJob.externalId,
                title: atsJob.title,
                status: "PUBLISHED",
                department: atsJob.department ?? null,
                location: atsJob.location ?? null,
                description: atsJob.description ?? null,
                lastSyncedAt: new Date(),
              });
            } else {
              await db.update(hiringJobs).set({ lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(hiringJobs.id, existing.id));
            }
          }

          for (const atsCand of atsCandidates) {
            const [existing] = await db
              .select({ id: hiringCandidates.id })
              .from(hiringCandidates)
              .where(and(eq(hiringCandidates.organizationId, capturedOrgId), eq(hiringCandidates.externalCandidateId, atsCand.externalId)))
              .limit(1);

            if (!existing) {
              await db.insert(hiringCandidates).values({
                organizationId: capturedOrgId,
                externalProvider: capturedProviderName,
                externalCandidateId: atsCand.externalId,
                firstName: atsCand.firstName,
                lastName: atsCand.lastName,
                fullName: `${atsCand.firstName} ${atsCand.lastName}`.trim(),
                email: atsCand.email ?? null,
                phone: atsCand.phone ?? null,
                source: capturedProviderName,
                currentStage: "APPLIED",
                appliedAt: atsCand.appliedAt ? new Date(atsCand.appliedAt) : new Date(),
                rawPayloadJson: atsCand.rawPayload ? JSON.stringify(atsCand.rawPayload) : null,
              });
            }
          }

          await db.update(hiringSyncLogs)
            .set({ status: "COMPLETED", recordsProcessed: atsJobs.length + atsCandidates.length, completedAt: new Date() })
            .where(eq(hiringSyncLogs.id, syncLog.id));

          await db.update(hiringIntegrations)
            .set({ lastSyncAt: new Date(), updatedAt: new Date() })
            .where(eq(hiringIntegrations.id, capturedIntegrationId));

          logInfo(`ATS sync completed for integration ${capturedIntegrationId}`, { jobs: atsJobs.length, candidates: atsCandidates.length });
        } catch (syncErr) {
          await db.update(hiringSyncLogs)
            .set({ status: "FAILED", errorSummary: String(syncErr), completedAt: new Date() })
            .where(eq(hiringSyncLogs.id, syncLog.id));
          logError(`ATS sync failed for integration ${capturedIntegrationId}`, { error: String(syncErr) });
        }
      });

      res.json({ message: "Sync started", syncLogId: syncLog.id });
    } catch (err) {
      logError("POST /api/hiring/integrations/:id/sync", { error: String(err) });
      res.status(500).json({ error: "Failed to start sync" });
    }
  },
);

router.get("/sync-logs", requireAuth, requireRole(...HIRING_INTEGRATION), async (req: AuthRequest, res) => {
  try {
    const logs = await db
      .select()
      .from(hiringSyncLogs)
      .where(eq(hiringSyncLogs.organizationId, orgId(req)))
      .orderBy(desc(hiringSyncLogs.startedAt))
      .limit(50);
    res.json(logs);
  } catch (err) {
    logError("GET /api/hiring/sync-logs", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch sync logs" });
  }
});

// ============================================
// PIPELINE CONFIG
// ============================================

router.get("/pipeline-config", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const [config] = await db
      .select()
      .from(hiringPipelineConfigs)
      .where(eq(hiringPipelineConfigs.organizationId, orgId(req)))
      .limit(1);
    res.json(config ?? null);
  } catch (err) {
    logError("GET /api/hiring/pipeline-config", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch pipeline config" });
  }
});

router.put(
  "/pipeline-config",
  requireAuth,
  requireRole(...HIRING_INTEGRATION),
  async (req: AuthRequest, res) => {
    try {
      const { stages } = req.body;
      if (!Array.isArray(stages)) return res.status(400).json({ error: "stages must be an array" });

      const [existing] = await db
        .select({ id: hiringPipelineConfigs.id })
        .from(hiringPipelineConfigs)
        .where(eq(hiringPipelineConfigs.organizationId, orgId(req)))
        .limit(1);

      if (existing) {
        const [config] = await db
          .update(hiringPipelineConfigs)
          .set({ stagesJson: JSON.stringify(stages), updatedAt: new Date() })
          .where(eq(hiringPipelineConfigs.id, existing.id))
          .returning();
        return res.json(config);
      }

      const [config] = await db
        .insert(hiringPipelineConfigs)
        .values({ organizationId: orgId(req), stagesJson: JSON.stringify(stages) })
        .returning();

      res.status(201).json(config);
    } catch (err) {
      logError("PUT /api/hiring/pipeline-config", { error: String(err) });
      res.status(500).json({ error: "Failed to update pipeline config" });
    }
  },
);

// ============================================
// ACTIVITY LOG
// ============================================

router.get("/activity", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const logs = await db
      .select()
      .from(hiringActivityLogs)
      .where(eq(hiringActivityLogs.organizationId, orgId(req)))
      .orderBy(desc(hiringActivityLogs.createdAt))
      .limit(limit);
    res.json(logs);
  } catch (err) {
    logError("GET /api/hiring/activity", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch activity log" });
  }
});

// ============================================
// AI REVIEW (structured persist to hiring_ai_reviews)
// ============================================

const AI_REVIEW_PROMPT_VERSION = "v1.0";

/**
 * Strips protected-class indicators from candidate text before sending to AI.
 * Removes explicit references to race, religion, national origin, sex, age, disability.
 */
function scrubProtectedCharacteristics(text: string): string {
  return text
    .replace(/\b(male|female|man|woman|gender|sex)\b/gi, "[REDACTED]")
    .replace(/\b(age|born in|year of birth|years old|dob|date of birth)\b/gi, "[REDACTED]")
    .replace(/\b(race|ethnicity|color|nationality|national origin|hispanic|latino|asian|black|white|caucasian|african american)\b/gi, "[REDACTED]")
    .replace(/\b(religion|christian|muslim|jewish|catholic|protestant|hindu|buddhist|atheist|church|mosque|synagogue)\b/gi, "[REDACTED]")
    .replace(/\b(disability|disabled|wheelchair|handicap|impairment)\b/gi, "[REDACTED]")
    .replace(/\b(pregnant|pregnancy|maternity|paternity)\b/gi, "[REDACTED]");
}

router.post(
  "/candidates/:id/ai-review",
  requireAuth,
  requireRole("ADMIN", "HUSTLER", "MANAGER"),
  async (req: AuthRequest, res) => {
    try {
      const aiEnabled = await isFeatureEnabled(orgId(req), "HIRING_AI_SCORING");
      if (!aiEnabled) {
        return res.status(403).json({ error: "HIRING_AI_SCORING feature is not enabled for this organization" });
      }

      const [[candidate], [orgRecord]] = await Promise.all([
        db
          .select()
          .from(hiringCandidates)
          .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
          .limit(1),
        db
          .select({ tradeType: organizations.tradeType })
          .from(organizations)
          .where(eq(organizations.id, orgId(req)))
          .limit(1),
      ]);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });

      const orgTradeType = orgRecord?.tradeType ?? "GENERAL_CONTRACTOR";

      let jobContext = "";
      let jobTitle = "construction trade position";
      if (candidate.jobId) {
        const [job] = await db
          .select({ title: hiringJobs.title, description: hiringJobs.description, requirements: hiringJobs.requirements, certificationsRequired: hiringJobs.certificationsRequired })
          .from(hiringJobs)
          .where(eq(hiringJobs.id, candidate.jobId))
          .limit(1);
        if (job) {
          jobTitle = job.title;
          jobContext = `Job Title: ${job.title}\nRequirements: ${job.requirements ?? "N/A"}\nCertifications Required: ${job.certificationsRequired ?? "N/A"}\nDescription: ${job.description ?? "N/A"}`;
        }
      }

      const rawAnswers = candidate.applicationAnswersJson
        ? (() => { try { return JSON.stringify(JSON.parse(candidate.applicationAnswersJson!), null, 2); } catch { return candidate.applicationAnswersJson ?? ""; } })()
        : "None provided";

      const screeningAnswers = scrubProtectedCharacteristics(rawAnswers);

      // Attempt to extract resume text for inclusion in the prompt
      let resumeContent = "";
      const hasResume = !!candidate.resumeStorageKey;
      if (hasResume && candidate.resumeStorageKey) {
        try {
          const { ObjectStorageService } = await import("./objectStorage");
          const objectStorageService = new ObjectStorageService();
          const objectFile = await objectStorageService.getObjectEntityFile(candidate.resumeStorageKey);
          const [contents] = await objectFile.download();
          const ext = candidate.resumeStorageKey.split(".").pop()?.toLowerCase() ?? "";
          if (["txt", "md", "csv"].includes(ext)) {
            const text = contents.toString("utf8").slice(0, 4000);
            resumeContent = scrubProtectedCharacteristics(text);
          } else if (["pdf", "doc", "docx"].includes(ext)) {
            resumeContent = `[${ext.toUpperCase()} resume file on record — content not extractable in this context. Evaluate based on application answers and inferred skills.]`;
          }
        } catch {
          logWarn("Non-critical operation failed");
          resumeContent = "[Resume file on record but could not be read. Evaluate based on application answers.]";
        }
      }
      const resumeSection = hasResume
        ? `--- RESUME ---\n${resumeContent || "[Resume file on record]"}\n\n`
        : "Note: No resume on file. Evaluate based on application answers only; assign a lower confidenceScore accordingly.\n\n";

      const systemPrompt = `You are an expert construction HR analyst evaluating candidates for skilled trade roles in a ${orgTradeType.replace(/_/g, " ").toLowerCase()} company. Your evaluation must be based solely on job-relevant skills, certifications, experience, and answers. Do NOT consider or reference any protected characteristics such as race, gender, religion, age, nationality, disability, or any other characteristic protected by employment law. Return a JSON object with these exact keys:
- "score": integer 0-100 overall fit score
- "tradeFitScore": integer 0-100 score for trade/technical skill fit in the ${orgTradeType.replace(/_/g, " ")} sector
- "roleFitScore": integer 0-100 score for this specific role's requirements
- "confidenceScore": integer 0-100 how confident you are in this evaluation (lower if little data)
- "recommendation": "YES" | "MAYBE" | "NO"
- "summary": string, 2-4 sentences summarizing the candidate's fit
- "strengths": array of strings (job-relevant strengths only)
- "concerns": array of strings (job-relevant concerns or gaps only)
- "redFlags": array of strings (serious disqualifying issues, empty if none)
- "extractedSkills": array of strings (skills mentioned or implied from answers)
- "extractedCerts": array of strings (certifications/licenses mentioned)
- "extractedEquipment": array of strings (equipment or tools mentioned)
- "interviewRecommendation": string, 1-2 sentences about what to probe in the interview`;

      const userPrompt = `Evaluate this candidate for the role of ${jobTitle} at a ${orgTradeType.replace(/_/g, " ").toLowerCase()} firm.\n\nSource: ${candidate.source ?? "Unknown"}\nCurrent Stage: ${candidate.currentStage}\n\n${jobContext ? `--- JOB DETAILS ---\n${jobContext}\n\n` : ""}${resumeSection}--- APPLICATION ANSWERS ---\n${screeningAnswers}\n\nIMPORTANT: Base your evaluation on job-relevant skills, experience, and role requirements only. Do not reference or consider any protected characteristics.`;

      const scored = await governedAiCall({
        orgId: orgId(req),
        userId: userId(req),
        actionType: "HIRING_AI_SCORE",
        inputRefs: { candidateId: candidate.id, jobId: candidate.jobId },
        fn: async () => {
          const completion = await openai.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 1200,
          });
          const content = completion.choices[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(content) as {
            score: number;
            tradeFitScore: number;
            roleFitScore: number;
            confidenceScore: number;
            recommendation: string;
            summary: string;
            strengths: string[];
            concerns: string[];
            redFlags: string[];
            extractedSkills: string[];
            extractedCerts: string[];
            extractedEquipment: string[];
            interviewRecommendation: string;
          };
          return { result: parsed, completion };
        },
      });

      if (scored.blocked) {
        return res.status(429).json({ error: scored.reason ?? "AI usage limit reached" });
      }

      const r = scored.result;

      // Post-process: strip any protected-class content from AI-generated text fields
      const sanitizeText = (text: string | undefined | null): string | null => {
        if (!text) return null;
        return scrubProtectedCharacteristics(text);
      };
      const sanitizeArray = (arr: string[] | undefined | null): string[] => {
        if (!arr) return [];
        return arr.map((item) => scrubProtectedCharacteristics(item)).filter(Boolean);
      };

      const score = Math.max(0, Math.min(100, Number(r.score) || 0));
      const tradeFitScore = Math.max(0, Math.min(100, Number(r.tradeFitScore) || 0));
      const roleFitScore = Math.max(0, Math.min(100, Number(r.roleFitScore) || 0));
      const confidenceScore = Math.max(0, Math.min(100, Number(r.confidenceScore) || 0));
      const recommendation = ["YES", "MAYBE", "NO"].includes(r.recommendation) ? r.recommendation : "MAYBE";

      const [aiReview] = await db
        .insert(hiringAiReviews)
        .values({
          organizationId: orgId(req),
          candidateId: candidate.id,
          modelName: AI_MODEL_GPT5,
          score,
          tradeFitScore,
          roleFitScore,
          confidenceScore,
          recommendation,
          summary: sanitizeText(r.summary),
          strengthsJson: JSON.stringify(sanitizeArray(r.strengths)),
          concernsJson: JSON.stringify(sanitizeArray(r.concerns)),
          redFlagsJson: JSON.stringify(sanitizeArray(r.redFlags)),
          extractedSkillsJson: JSON.stringify(sanitizeArray(r.extractedSkills)),
          extractedCertsJson: JSON.stringify(sanitizeArray(r.extractedCerts)),
          extractedEquipmentJson: JSON.stringify(sanitizeArray(r.extractedEquipment)),
          interviewRecommendation: sanitizeText(r.interviewRecommendation),
          promptVersion: AI_REVIEW_PROMPT_VERSION,
        })
        .returning();

      await db
        .update(hiringCandidates)
        .set({ aiScore: score, aiRecommendation: r.summary ?? recommendation, updatedAt: new Date() })
        .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))));

      void logActivity(orgId(req), userId(req), userName(req), "AI_REVIEW_COMPLETED", "candidate", candidate.id, candidate.fullName, { score, model: AI_MODEL_GPT5, promptVersion: AI_REVIEW_PROMPT_VERSION });

      res.json({
        score,
        tradeFitScore,
        roleFitScore,
        confidenceScore,
        recommendation,
        summary: sanitizeText(r.summary) ?? "",
        strengths: sanitizeArray(r.strengths),
        concerns: sanitizeArray(r.concerns),
        redFlags: sanitizeArray(r.redFlags),
        extractedSkills: sanitizeArray(r.extractedSkills),
        extractedCerts: sanitizeArray(r.extractedCerts),
        extractedEquipment: sanitizeArray(r.extractedEquipment),
        interviewRecommendation: sanitizeText(r.interviewRecommendation) ?? "",
        promptVersion: AI_REVIEW_PROMPT_VERSION,
        aiReviewId: aiReview.id,
        disclaimer: "This AI evaluation is one data point and must be reviewed by a human before any hiring decision is made. All final decisions must comply with applicable employment law.",
      });
    } catch (err) {
      logError("POST /api/hiring/candidates/:id/ai-review", { error: String(err) });
      res.status(500).json({ error: "Failed to generate AI review" });
    }
  },
);

// ============================================
// ANALYTICS
// ============================================

router.get("/analytics/dashboard", requireAuth, requireRole(...HIRING_ADVANCED), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [jobCounts, candidateStageCounts, interviewCounts, newCandidates] = await Promise.all([
      db.select({ status: hiringJobs.status, count: count() })
        .from(hiringJobs)
        .where(eq(hiringJobs.organizationId, org))
        .groupBy(hiringJobs.status),
      db.select({ stage: hiringCandidates.currentStage, count: count() })
        .from(hiringCandidates)
        .where(eq(hiringCandidates.organizationId, org))
        .groupBy(hiringCandidates.currentStage),
      db.select({ count: count() })
        .from(hiringInterviews)
        .where(and(eq(hiringInterviews.organizationId, org), eq(hiringInterviews.status, "SCHEDULED"))),
      db.select({ count: count() })
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.organizationId, org), gte(hiringCandidates.appliedAt, sevenDaysAgo))),
    ]);

    const jobsByStatus = Object.fromEntries(jobCounts.map((r) => [r.status, Number(r.count)]));
    const candidatesByStage = Object.fromEntries(candidateStageCounts.map((r) => [r.stage, Number(r.count)]));

    res.json({
      openRoles: (jobsByStatus["PUBLISHED"] ?? 0) + (jobsByStatus["DRAFT"] ?? 0),
      draftRoles: jobsByStatus["DRAFT"] ?? 0,
      publishedRoles: jobsByStatus["PUBLISHED"] ?? 0,
      totalApplicants: candidateStageCounts.reduce((acc, r) => acc + Number(r.count), 0),
      newInLast7Days: Number(newCandidates[0]?.count ?? 0),
      scheduledInterviews: Number(interviewCounts[0]?.count ?? 0),
      offerReady: candidatesByStage["OFFER_EXTENDED"] ?? 0,
      overdueHiringTasks: 0,
    });
  } catch (err) {
    logError("GET /api/hiring/analytics/dashboard", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

router.get("/analytics", requireAuth, requireRole(...HIRING_ADVANCED), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    const [
      jobCounts,
      candidateStageCounts,
      interviewStatusCounts,
      recentActivity,
      candidatesPerRole,
      sourceCounts,
      aiScoreRows,
      monthlyApplicants,
      rejectionReasonRows,
      hiredCandidatesForDays,
      monthlyTimeToHireRows,
    ] = await Promise.all([
      db
        .select({ status: hiringJobs.status, count: count() })
        .from(hiringJobs)
        .where(eq(hiringJobs.organizationId, org))
        .groupBy(hiringJobs.status),
      db
        .select({ stage: hiringCandidates.currentStage, count: count() })
        .from(hiringCandidates)
        .where(eq(hiringCandidates.organizationId, org))
        .groupBy(hiringCandidates.currentStage),
      db
        .select({ status: hiringInterviews.status, count: count() })
        .from(hiringInterviews)
        .where(eq(hiringInterviews.organizationId, org))
        .groupBy(hiringInterviews.status),
      db
        .select()
        .from(hiringActivityLogs)
        .where(eq(hiringActivityLogs.organizationId, org))
        .orderBy(desc(hiringActivityLogs.createdAt))
        .limit(10),
      // applicants per role (last 30 days)
      db
        .select({
          jobId: hiringCandidates.jobId,
          jobTitle: hiringJobs.title,
          count: count(),
        })
        .from(hiringCandidates)
        .leftJoin(hiringJobs, eq(hiringCandidates.jobId, hiringJobs.id))
        .where(and(eq(hiringCandidates.organizationId, org), gte(hiringCandidates.appliedAt, thirtyDaysAgo)))
        .groupBy(hiringCandidates.jobId, hiringJobs.title)
        .orderBy(desc(count()))
        .limit(10),
      // source quality breakdown
      db
        .select({ source: hiringCandidates.source, count: count() })
        .from(hiringCandidates)
        .where(eq(hiringCandidates.organizationId, org))
        .groupBy(hiringCandidates.source),
      // ai score distribution (raw scores for histogram)
      db
        .select({ score: hiringCandidates.aiScore })
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.organizationId, org), isNotNull(hiringCandidates.aiScore))),
      // monthly applicant trend (last 6 months)
      db
        .select({
          month: sql<string>`to_char(applied_at, 'YYYY-MM')`,
          count: count(),
        })
        .from(hiringCandidates)
        .where(and(
          eq(hiringCandidates.organizationId, org),
          gte(hiringCandidates.appliedAt, sixMonthsAgo),
        ))
        .groupBy(sql`to_char(applied_at, 'YYYY-MM')`)
        .orderBy(sql`to_char(applied_at, 'YYYY-MM')`),
      // rejection reasons from stage history
      db
        .select({ reason: hiringCandidateStageHistory.reason, count: count() })
        .from(hiringCandidateStageHistory)
        .where(and(
          eq(hiringCandidateStageHistory.organizationId, org),
          eq(hiringCandidateStageHistory.toStage, "REJECTED"),
          isNotNull(hiringCandidateStageHistory.reason),
        ))
        .groupBy(hiringCandidateStageHistory.reason)
        .orderBy(desc(count()))
        .limit(10),
      // hired candidates with appliedAt for avg days-to-hire calculation
      db
        .select({
          appliedAt: hiringCandidates.appliedAt,
          updatedAt: hiringCandidates.updatedAt,
        })
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.organizationId, org), eq(hiringCandidates.currentStage, "HIRED"))),
      // monthly time-to-hire trend (avg days from applied to hired, by month, last 6 months)
      db
        .select({
          month: sql<string>`to_char(updated_at, 'YYYY-MM')`,
          avgDays: sql<number>`round(avg(extract(epoch from (updated_at - applied_at)) / 86400))`,
        })
        .from(hiringCandidates)
        .where(and(
          eq(hiringCandidates.organizationId, org),
          eq(hiringCandidates.currentStage, "HIRED"),
          isNotNull(hiringCandidates.appliedAt),
          gte(hiringCandidates.updatedAt, sixMonthsAgo),
        ))
        .groupBy(sql`to_char(updated_at, 'YYYY-MM')`)
        .orderBy(sql`to_char(updated_at, 'YYYY-MM')`),
    ]);

    const jobsByStatus = Object.fromEntries(jobCounts.map((r) => [r.status, Number(r.count)]));
    const candidatesByStage = Object.fromEntries(candidateStageCounts.map((r) => [r.stage, Number(r.count)]));
    const interviewsByStatus = Object.fromEntries(interviewStatusCounts.map((r) => [r.status, Number(r.count)]));

    // Build AI score histogram buckets: 0-20, 21-40, 41-60, 61-80, 81-100
    const scoreBuckets = [
      { range: "0-20", min: 0, max: 20, count: 0 },
      { range: "21-40", min: 21, max: 40, count: 0 },
      { range: "41-60", min: 41, max: 60, count: 0 },
      { range: "61-80", min: 61, max: 80, count: 0 },
      { range: "81-100", min: 81, max: 100, count: 0 },
    ];
    for (const row of aiScoreRows) {
      if (row.score == null) continue;
      const bucket = scoreBuckets.find((b) => row.score! >= b.min && row.score! <= b.max);
      if (bucket) bucket.count++;
    }

    // Source quality: normalize null source to "Unknown"
    const sourceBreakdown = sourceCounts.map((r) => ({
      source: r.source ?? "Unknown",
      count: Number(r.count),
    })).sort((a, b) => b.count - a.count);

    // Pipeline funnel (canonical stage order for conversion metrics)
    const STAGE_ORDER = [
      "APPLIED", "SCREENING", "PHONE_INTERVIEW", "IN_PERSON_INTERVIEW",
      "SKILLS_ASSESSMENT", "BACKGROUND_CHECK", "REFERENCE_CHECK", "OFFER_EXTENDED",
      "HIRED", "REJECTED",
    ];
    const funnelStages = STAGE_ORDER.filter((s) => candidatesByStage[s] ?? 0 > 0);
    const totalApplicants = candidateStageCounts.reduce((acc, r) => acc + Number(r.count), 0);
    const funnelConversion = funnelStages.map((stage) => ({
      stage,
      count: candidatesByStage[stage] ?? 0,
      conversionRate: totalApplicants > 0
        ? Math.round(((candidatesByStage[stage] ?? 0) / totalApplicants) * 100)
        : 0,
    }));

    // Avg days to hire
    const hiredCount = hiredCandidatesForDays.length;
    let avgDaysToHire: number | null = null;
    if (hiredCount > 0) {
      const totalDays = hiredCandidatesForDays.reduce((acc, c) => {
        if (!c.appliedAt) return acc;
        const applied = new Date(c.appliedAt).getTime();
        const hired = new Date(c.updatedAt).getTime();
        return acc + Math.max(0, Math.round((hired - applied) / (1000 * 60 * 60 * 24)));
      }, 0);
      avgDaysToHire = Math.round(totalDays / hiredCount);
    }

    // Fill rate (hired / published roles) as a percentage
    const publishedRoles = jobsByStatus["PUBLISHED"] ?? 0;
    const hired = candidatesByStage["HIRED"] ?? 0;
    const fillRate = publishedRoles > 0 ? Math.round((hired / publishedRoles) * 100) : null;

    // Offer acceptance rate: hired / (hired + offer_extended) * 100
    const offerExtended = candidatesByStage["OFFER_EXTENDED"] ?? 0;
    const offerAcceptanceRate = (hired + offerExtended) > 0
      ? Math.round((hired / (hired + offerExtended)) * 100)
      : null;

    // Applicants this month
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const applicantsThisMonth = monthlyApplicants.find((r) => r.month === thisMonthKey);

    res.json({
      jobs: {
        total: jobCounts.reduce((acc, r) => acc + Number(r.count), 0),
        byStatus: jobsByStatus,
      },
      candidates: {
        total: totalApplicants,
        byStage: candidatesByStage,
        hired,
        rejected: candidatesByStage["REJECTED"] ?? 0,
        perRole: candidatesPerRole.map((r) => ({
          jobId: r.jobId,
          jobTitle: r.jobTitle ?? "No Job",
          count: Number(r.count),
        })),
        bySource: sourceBreakdown,
        aiScoreHistogram: scoreBuckets.map(({ range, count: c }) => ({ range, count: c })),
        funnelConversion,
        rejectionReasons: rejectionReasonRows.length > 0
          ? rejectionReasonRows.map((r) => ({
            reason: r.reason ?? "No reason provided",
            count: Number(r.count),
          }))
          : [],
      },
      interviews: {
        total: interviewStatusCounts.reduce((acc, r) => acc + Number(r.count), 0),
        byStatus: interviewsByStatus,
      },
      monthlyTrend: monthlyApplicants.map((r) => ({
        month: r.month,
        count: Number(r.count),
      })),
      monthlyTimeToHire: monthlyTimeToHireRows.map((r) => ({
        month: r.month,
        avgDays: Number(r.avgDays),
      })),
      summaryStats: {
        avgDaysToHire,
        fillRate,
        offerAcceptanceRate,
        applicantsThisMonth: Number(applicantsThisMonth?.count ?? 0),
        publishedRoles,
        hired,
      },
      recentActivity,
    });
  } catch (err) {
    logError("GET /api/hiring/analytics", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ============================================
// PIPELINE STAGES (Custom per-organization)
// ============================================

const DEFAULT_PIPELINE_STAGES = [
  { key: "APPLIED", name: "Applied", color: "#3b82f6", displayOrder: 0, isDefault: true, isTerminal: false },
  { key: "SCREENED", name: "Screened", color: "#eab308", displayOrder: 1, isDefault: true, isTerminal: false },
  { key: "REVIEW", name: "Review", color: "#f97316", displayOrder: 2, isDefault: true, isTerminal: false },
  { key: "PHONE_SCREEN", name: "Phone Screen", color: "#a855f7", displayOrder: 3, isDefault: true, isTerminal: false },
  { key: "INTERVIEW", name: "Interview", color: "#ec4899", displayOrder: 4, isDefault: true, isTerminal: false },
  { key: "FINAL_REVIEW", name: "Final Review", color: "#6366f1", displayOrder: 5, isDefault: true, isTerminal: false },
  { key: "OFFER", name: "Offer", color: "#10b981", displayOrder: 6, isDefault: true, isTerminal: false },
  { key: "HIRED", name: "Hired", color: "#22c55e", displayOrder: 7, isDefault: true, isTerminal: true },
  { key: "REJECTED", name: "Rejected", color: "#ef4444", displayOrder: 8, isDefault: true, isTerminal: true },
  { key: "ARCHIVED", name: "Archived", color: "#6b7280", displayOrder: 9, isDefault: true, isTerminal: true },
];

router.get("/pipeline-stages", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const stages = await db
      .select()
      .from(hiringPipelineStages)
      .where(eq(hiringPipelineStages.organizationId, org))
      .orderBy(hiringPipelineStages.displayOrder);

    if (stages.length === 0) {
      const values = DEFAULT_PIPELINE_STAGES.map((s) => ({
        organizationId: org,
        ...s,
      }));
      const seeded = await db.insert(hiringPipelineStages).values(values).returning();
      return res.json(seeded);
    }

    res.json(stages);
  } catch (err) {
    logError("GET /api/hiring/pipeline-stages", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch pipeline stages" });
  }
});

router.put("/pipeline-stages", requireAuth, requireRole(...HIRING_FULL), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const { stages } = req.body;

    if (!Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: "stages array is required" });
    }

    const newKeys = new Set(stages.map((s: any) => s.key || s.name.toUpperCase().replace(/\s+/g, "_")));
    const candidateStageCounts = await db
      .select({ stage: hiringCandidates.currentStage, count: sql<number>`count(*)` })
      .from(hiringCandidates)
      .where(eq(hiringCandidates.organizationId, org))
      .groupBy(hiringCandidates.currentStage);

    const orphanedStages = candidateStageCounts
      .filter((r) => !newKeys.has(r.stage))
      .map((r) => r.stage);

    if (orphanedStages.length > 0) {
      return res.status(400).json({
        error: `Cannot remove stages that have active candidates: ${orphanedStages.join(", ")}. Move candidates first.`,
        orphanedStages,
      });
    }

    await db.delete(hiringPipelineStages).where(eq(hiringPipelineStages.organizationId, org));

    const values = stages.map((s: any, i: number) => ({
      organizationId: org,
      name: s.name,
      key: s.key || s.name.toUpperCase().replace(/\s+/g, "_"),
      color: s.color || "#6b7280",
      displayOrder: i,
      isDefault: s.isDefault ?? false,
      isTerminal: s.isTerminal ?? false,
    }));

    const inserted = await db.insert(hiringPipelineStages).values(values).returning();

    void logActivity(org, userId(req), userName(req), "JOB_CREATED", "pipeline_stages", org, "Pipeline stages updated");

    res.json(inserted);
  } catch (err) {
    logError("PUT /api/hiring/pipeline-stages", { error: String(err) });
    res.status(500).json({ error: "Failed to update pipeline stages" });
  }
});

router.post("/pipeline-stages/seed-defaults", requireAuth, requireRole(...HIRING_FULL), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);

    const existing = await db
      .select({ id: hiringPipelineStages.id })
      .from(hiringPipelineStages)
      .where(eq(hiringPipelineStages.organizationId, org))
      .limit(1);

    if (existing.length > 0) {
      return res.json({ message: "Stages already exist", seeded: false });
    }

    const values = DEFAULT_PIPELINE_STAGES.map((s) => ({
      organizationId: org,
      ...s,
    }));

    const inserted = await db.insert(hiringPipelineStages).values(values).returning();
    res.json({ message: "Default stages seeded", seeded: true, stages: inserted });
  } catch (err) {
    logError("POST /api/hiring/pipeline-stages/seed-defaults", { error: String(err) });
    res.status(500).json({ error: "Failed to seed default stages" });
  }
});

export default router;
