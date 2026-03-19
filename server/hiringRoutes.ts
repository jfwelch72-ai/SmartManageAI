import { Router } from "express";
import { eq, and, desc, sql, count, or, ilike } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireRole } from "./auth";
import type { AuthRequest } from "./auth";
import { logCreate, logUpdate, logAudit } from "./auditLogger";
import { insertNotification } from "./services/notificationService";
import { encryptToken, decryptToken } from "./integrations/encryption";
import { getATSProvider, listATSProviders } from "./integrations/ats/registry";
import { isFeatureEnabled } from "./services/featureFlagService";
import { eventBus } from "./events";
import { logError, logInfo } from "./utils/logger";
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
  hiringActivityLogs,
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
const HIRING_FULL = ["ADMIN", "HUSTLER", "HR_MANAGER"] as const;
/** Candidate-review (read candidates/interviews, approve stage moves) */
const HIRING_REVIEW = ["ADMIN", "HUSTLER", "HR_MANAGER", "MANAGER", "OFFICE_MANAGER"] as const;
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
router.use(requireAuth, async (req: AuthRequest, res, next) => {
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

// ============================================
// INTERVIEWS
// ============================================

router.get("/interviews", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const candidateId = req.query.candidateId as string | undefined;

    const conditions = [eq(hiringInterviews.organizationId, org)];
    if (candidateId) conditions.push(eq(hiringInterviews.candidateId, candidateId));

    const interviews = await db
      .select()
      .from(hiringInterviews)
      .where(and(...conditions))
      .orderBy(desc(hiringInterviews.startAt));

    res.json(interviews);
  } catch (err) {
    logError("GET /api/hiring/interviews", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch interviews" });
  }
});

router.post(
  "/interviews",
  requireAuth,
  requireRole(...HIRING_FULL),
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

router.patch("/interviews/:id", requireAuth, requireRole(...HIRING_FULL), (req, res) => handleInterviewUpdate(req as AuthRequest, res));
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
    const tasks = await db
      .select()
      .from(hiringTasks)
      .where(eq(hiringTasks.organizationId, orgId(req)))
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
// ANALYTICS
// ============================================

router.get("/analytics", requireAuth, requireRole(...HIRING_REVIEW), async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);

    const [jobCounts, candidateStageCounts, interviewStatusCounts, recentActivity] = await Promise.all([
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
    ]);

    const jobsByStatus = Object.fromEntries(jobCounts.map((r) => [r.status, Number(r.count)]));
    const candidatesByStage = Object.fromEntries(candidateStageCounts.map((r) => [r.stage, Number(r.count)]));
    const interviewsByStatus = Object.fromEntries(interviewStatusCounts.map((r) => [r.status, Number(r.count)]));

    res.json({
      jobs: {
        total: jobCounts.reduce((acc, r) => acc + Number(r.count), 0),
        byStatus: jobsByStatus,
      },
      candidates: {
        total: candidateStageCounts.reduce((acc, r) => acc + Number(r.count), 0),
        byStage: candidatesByStage,
        hired: candidatesByStage["HIRED"] ?? 0,
        rejected: candidatesByStage["REJECTED"] ?? 0,
      },
      interviews: {
        total: interviewStatusCounts.reduce((acc, r) => acc + Number(r.count), 0),
        byStatus: interviewsByStatus,
      },
      recentActivity,
    });
  } catch (err) {
    logError("GET /api/hiring/analytics", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
