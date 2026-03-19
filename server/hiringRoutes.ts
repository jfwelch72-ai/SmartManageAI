import { Router } from "express";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireRole } from "./auth";
import type { AuthRequest } from "./auth";
import { logCreate, logUpdate, logAudit } from "./auditLogger";
import { insertNotification } from "./services/notificationService";
import { encryptToken, decryptToken } from "./integrations/encryption";
import { getATSProvider, listATSProviders } from "./integrations/ats/registry";
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
  insertHiringInterviewSchema,
  insertHiringTaskSchema,
  type InsertHiringActivityLog,
} from "@shared/schema";

const router = Router();

// ============================================
// GUARD HELPERS
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
// JOBS
// ============================================

// GET /api/hiring/jobs  — list jobs for org
router.get("/jobs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const jobs = await db
      .select()
      .from(hiringJobs)
      .where(eq(hiringJobs.organizationId, org))
      .orderBy(desc(hiringJobs.createdAt));
    res.json(jobs);
  } catch (err) {
    logError("GET /api/hiring/jobs", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// GET /api/hiring/jobs/:id  — single job
router.get("/jobs/:id", requireAuth, async (req: AuthRequest, res) => {
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

// POST /api/hiring/jobs  — create job
router.post(
  "/jobs",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
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

// PATCH /api/hiring/jobs/:id  — update job
router.patch(
  "/jobs/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringJobs)
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Job not found" });

      const updates: Record<string, unknown> = { ...req.body, updatedByUserId: userId(req), updatedAt: new Date() };
      delete updates["id"];
      delete updates["organizationId"];
      delete updates["createdAt"];

      if (updates["status"] === "PUBLISHED" && !existing.publishedAt) {
        updates["publishedAt"] = new Date();
      }
      if (updates["status"] === "ARCHIVED" && !existing.archivedAt) {
        updates["archivedAt"] = new Date();
      }

      const [job] = await db
        .update(hiringJobs)
        .set(updates as Partial<typeof hiringJobs.$inferInsert>)
        .where(and(eq(hiringJobs.id, req.params.id), eq(hiringJobs.organizationId, orgId(req))))
        .returning();

      void logUpdate(userId(req), "hiring_job", job.id, existing, job, req);

      if (updates["status"] === "PUBLISHED") {
        void logActivity(orgId(req), userId(req), userName(req), "JOB_PUBLISHED", "job", job.id, job.title);
      } else if (updates["status"] === "ARCHIVED") {
        void logActivity(orgId(req), userId(req), userName(req), "JOB_ARCHIVED", "job", job.id, job.title);
      }

      res.json(job);
    } catch (err) {
      logError("PATCH /api/hiring/jobs/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to update job" });
    }
  },
);

// DELETE /api/hiring/jobs/:id  — archive (soft delete via status)
router.delete(
  "/jobs/:id",
  requireAuth,
  requireRole("ADMIN", "HR_MANAGER"),
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

router.get("/job-templates", requireAuth, async (req: AuthRequest, res) => {
  try {
    const templates = await db
      .select()
      .from(hiringJobTemplates)
      .where(
        sql`${hiringJobTemplates.isGlobal} = true OR ${hiringJobTemplates.organizationId} = ${orgId(req)}`,
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
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
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

// ============================================
// CANDIDATES
// ============================================

// GET /api/hiring/candidates — list all candidates for org (optionally filtered by jobId)
router.get("/candidates", requireAuth, async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const jobId = req.query.jobId as string | undefined;

    const conditions = [eq(hiringCandidates.organizationId, org)];
    if (jobId) conditions.push(eq(hiringCandidates.jobId, jobId));

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

// GET /api/hiring/candidates/:id — single candidate with notes, docs, interviews, history
router.get("/candidates/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const [candidate] = await db
      .select()
      .from(hiringCandidates)
      .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, org)))
      .limit(1);
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });

    const [notes, documents, interviews, stageHistory, aiReview] = await Promise.all([
      db.select().from(hiringCandidateNotes).where(eq(hiringCandidateNotes.candidateId, req.params.id)).orderBy(desc(hiringCandidateNotes.createdAt)),
      db.select().from(hiringCandidateDocuments).where(eq(hiringCandidateDocuments.candidateId, req.params.id)).orderBy(desc(hiringCandidateDocuments.createdAt)),
      db.select().from(hiringInterviews).where(eq(hiringInterviews.candidateId, req.params.id)).orderBy(desc(hiringInterviews.createdAt)),
      db.select().from(hiringCandidateStageHistory).where(eq(hiringCandidateStageHistory.candidateId, req.params.id)).orderBy(desc(hiringCandidateStageHistory.createdAt)),
      db.select().from(hiringAiReviews).where(eq(hiringAiReviews.candidateId, req.params.id)).orderBy(desc(hiringAiReviews.generatedAt)).limit(1),
    ]);

    res.json({ ...candidate, notes, documents, interviews, stageHistory, latestAiReview: aiReview[0] ?? null });
  } catch (err) {
    logError("GET /api/hiring/candidates/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch candidate" });
  }
});

// POST /api/hiring/candidates — create candidate
router.post(
  "/candidates",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
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

      const [candidate] = await db.insert(hiringCandidates).values(parsed.data).returning();

      // Record initial stage
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

      res.status(201).json(candidate);
    } catch (err) {
      logError("POST /api/hiring/candidates", { error: String(err) });
      res.status(500).json({ error: "Failed to create candidate" });
    }
  },
);

// PATCH /api/hiring/candidates/:id — update candidate fields
router.patch(
  "/candidates/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringCandidates)
        .where(and(eq(hiringCandidates.id, req.params.id), eq(hiringCandidates.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Candidate not found" });

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
      logError("PATCH /api/hiring/candidates/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to update candidate" });
    }
  },
);

// POST /api/hiring/candidates/:id/stage — move candidate to new stage
router.post(
  "/candidates/:id/stage",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
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
        fromStage: fromStage || null,
        toStage: stage,
        changedByUserId: userId(req),
        changedByName: userName(req),
        reason: reason || null,
      });

      const activityType = stage === "HIRED" ? "CANDIDATE_HIRED" : stage === "REJECTED" ? "CANDIDATE_REJECTED" : "CANDIDATE_STAGE_CHANGED";
      void logActivity(orgId(req), userId(req), userName(req), activityType, "candidate", req.params.id, existing.fullName, { fromStage, toStage: stage });

      if (stage === "HIRED" || stage === "REJECTED") {
        // Notify the reviewing manager
        if (existing.reviewerUserId) {
          void insertNotification({
            userId: existing.reviewerUserId,
            organizationId: orgId(req),
            type: "GENERAL",
            title: stage === "HIRED" ? "Candidate Hired" : "Candidate Rejected",
            message: `${existing.fullName} has been marked as ${stage.toLowerCase()}.`,
            relatedEntityId: existing.id,
            relatedEntityType: "hiring_candidate",
          });
        }
      }

      res.json(candidate);
    } catch (err) {
      logError("POST /api/hiring/candidates/:id/stage", { error: String(err) });
      res.status(500).json({ error: "Failed to update candidate stage" });
    }
  },
);

// ============================================
// CANDIDATE NOTES
// ============================================

router.post(
  "/candidates/:id/notes",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
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
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
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

router.get("/interviews", requireAuth, async (req: AuthRequest, res) => {
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
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
  async (req: AuthRequest, res) => {
    try {
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

      // Notify candidate's reviewer if set
      const [candidate] = await db
        .select({ reviewerUserId: hiringCandidates.reviewerUserId, fullName: hiringCandidates.fullName })
        .from(hiringCandidates)
        .where(eq(hiringCandidates.id, parsed.data.candidateId || ""))
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

      void logCreate(userId(req), "hiring_interview", interview.id, interview, req);
      void logActivity(orgId(req), userId(req), userName(req), "INTERVIEW_SCHEDULED", "interview", interview.id, `Interview for candidate`);

      res.status(201).json(interview);
    } catch (err) {
      logError("POST /api/hiring/interviews", { error: String(err) });
      res.status(500).json({ error: "Failed to schedule interview" });
    }
  },
);

router.patch(
  "/interviews/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
  async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(hiringInterviews)
        .where(and(eq(hiringInterviews.id, req.params.id), eq(hiringInterviews.organizationId, orgId(req))))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Interview not found" });

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
      logError("PATCH /api/hiring/interviews/:id", { error: String(err) });
      res.status(500).json({ error: "Failed to update interview" });
    }
  },
);

// ============================================
// HIRING TASKS
// ============================================

router.get("/tasks", requireAuth, async (req: AuthRequest, res) => {
  try {
    const org = orgId(req);
    const tasks = await db
      .select()
      .from(hiringTasks)
      .where(eq(hiringTasks.organizationId, org))
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
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
  async (req: AuthRequest, res) => {
    try {
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
  requireRole("ADMIN", "MANAGER", "HR_MANAGER"),
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

// GET /api/hiring/integrations — list ATS integrations for org
router.get("/integrations", requireAuth, requireRole("ADMIN", "HR_MANAGER"), async (req: AuthRequest, res) => {
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

// POST /api/hiring/integrations — connect an ATS
router.post(
  "/integrations",
  requireAuth,
  requireRole("ADMIN", "HR_MANAGER"),
  async (req: AuthRequest, res) => {
    try {
      const { providerName, credentials, defaultConfig } = req.body;
      if (!providerName || typeof credentials !== "object") {
        return res.status(400).json({ error: "providerName and credentials are required" });
      }

      const provider = getATSProvider(providerName);
      if (!provider) return res.status(400).json({ error: `Unknown ATS provider: ${providerName}` });

      // Test connection before saving
      const ok = await provider.testConnection(credentials);
      if (!ok) return res.status(400).json({ error: "ATS connection test failed — check your credentials" });

      const encryptedCredentials = encryptToken(JSON.stringify(credentials));

      const [existing] = await db
        .select({ id: hiringIntegrations.id })
        .from(hiringIntegrations)
        .where(and(eq(hiringIntegrations.organizationId, orgId(req)), eq(hiringIntegrations.providerName, providerName)))
        .limit(1);

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
        return res.json(updated);
      }

      const [integration] = await db.insert(hiringIntegrations).values({
        organizationId: orgId(req),
        providerName: providerName,
        encryptedCredentialsJson: encryptedCredentials,
        status: "connected",
        lastTestAt: new Date(),
        defaultConfigJson: defaultConfig ? JSON.stringify(defaultConfig) : null,
      }).returning();

      void logCreate(userId(req), "hiring_integration", integration.id, { provider: providerName }, req);
      void logActivity(orgId(req), userId(req), userName(req), "INTEGRATION_CONNECTED", "integration", integration.id, providerName);

      res.status(201).json({ ...integration, encryptedCredentialsJson: undefined });
    } catch (err) {
      logError("POST /api/hiring/integrations", { error: String(err) });
      res.status(500).json({ error: "Failed to connect ATS integration" });
    }
  },
);

// DELETE /api/hiring/integrations/:id — disconnect
router.delete(
  "/integrations/:id",
  requireAuth,
  requireRole("ADMIN", "HR_MANAGER"),
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

// POST /api/hiring/integrations/:id/sync — trigger full sync
router.post(
  "/integrations/:id/sync",
  requireAuth,
  requireRole("ADMIN", "HR_MANAGER"),
  async (req: AuthRequest, res) => {
    try {
      const [integration] = await db
        .select()
        .from(hiringIntegrations)
        .where(and(eq(hiringIntegrations.id, req.params.id), eq(hiringIntegrations.organizationId, orgId(req))))
        .limit(1);

      if (!integration) return res.status(404).json({ error: "Integration not found" });
      if (integration.status !== "connected") {
        return res.status(400).json({ error: "Integration is not connected" });
      }
      if (!integration.encryptedCredentialsJson) {
        return res.status(400).json({ error: "No credentials stored for this integration" });
      }

      const provider = getATSProvider(integration.providerName);
      if (!provider) return res.status(500).json({ error: "Provider not found" });

      // Insert a sync log row
      const [syncLog] = await db.insert(hiringSyncLogs).values({
        organizationId: orgId(req),
        integrationId: integration.id,
        provider: integration.providerName,
        status: "RUNNING",
        entityType: "all",
        startedAt: new Date(),
      }).returning();

      // Fire-and-forget sync
      setImmediate(async () => {
        try {
          const credentials = JSON.parse(decryptToken(integration.encryptedCredentialsJson!)) as Record<string, string>;
          const result = await provider.syncAll(credentials);

          // Upsert synced jobs
          for (const atsJob of await provider.listJobs(credentials)) {
            const [existing] = await db
              .select({ id: hiringJobs.id })
              .from(hiringJobs)
              .where(and(eq(hiringJobs.organizationId, orgId(req)), eq(hiringJobs.externalJobId, atsJob.externalId)))
              .limit(1);

            if (!existing) {
              await db.insert(hiringJobs).values({
                organizationId: orgId(req),
                externalProvider: integration.providerName,
                externalJobId: atsJob.externalId,
                title: atsJob.title,
                status: "PUBLISHED",
                department: atsJob.department || null,
                location: atsJob.location || null,
                description: atsJob.description || null,
                lastSyncedAt: new Date(),
              });
            } else {
              await db.update(hiringJobs).set({ lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(hiringJobs.id, existing.id));
            }
          }

          // Upsert synced candidates
          for (const atsCand of await provider.listCandidates(credentials)) {
            const [existingCand] = await db
              .select({ id: hiringCandidates.id })
              .from(hiringCandidates)
              .where(and(eq(hiringCandidates.organizationId, orgId(req)), eq(hiringCandidates.externalCandidateId, atsCand.externalId)))
              .limit(1);

            if (!existingCand) {
              await db.insert(hiringCandidates).values({
                organizationId: orgId(req),
                externalProvider: integration.providerName,
                externalCandidateId: atsCand.externalId,
                firstName: atsCand.firstName,
                lastName: atsCand.lastName,
                fullName: `${atsCand.firstName} ${atsCand.lastName}`.trim(),
                email: atsCand.email || null,
                phone: atsCand.phone || null,
                source: integration.providerName,
                currentStage: "APPLIED",
                appliedAt: atsCand.appliedAt ? new Date(atsCand.appliedAt) : new Date(),
                rawPayloadJson: atsCand.rawPayload ? JSON.stringify(atsCand.rawPayload) : null,
              });
            }
          }

          await db.update(hiringSyncLogs)
            .set({
              status: "COMPLETED",
              recordsProcessed: result.jobsSynced + result.candidatesSynced,
              completedAt: new Date(),
              errorSummary: result.errors.length ? result.errors.join("; ") : null,
            })
            .where(eq(hiringSyncLogs.id, syncLog.id));

          await db.update(hiringIntegrations).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(hiringIntegrations.id, integration.id));

          logInfo(`ATS sync completed for integration ${integration.id}`, result);
        } catch (syncErr) {
          await db.update(hiringSyncLogs)
            .set({ status: "FAILED", errorSummary: String(syncErr), completedAt: new Date() })
            .where(eq(hiringSyncLogs.id, syncLog.id));
          logError(`ATS sync failed for integration ${integration.id}`, { error: String(syncErr) });
        }
      });

      res.json({ message: "Sync started", syncLogId: syncLog.id });
    } catch (err) {
      logError("POST /api/hiring/integrations/:id/sync", { error: String(err) });
      res.status(500).json({ error: "Failed to start sync" });
    }
  },
);

// GET /api/hiring/sync-logs — fetch sync history
router.get("/sync-logs", requireAuth, requireRole("ADMIN", "HR_MANAGER"), async (req: AuthRequest, res) => {
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

router.get("/pipeline-config", requireAuth, async (req: AuthRequest, res) => {
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
  requireRole("ADMIN", "HR_MANAGER"),
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

router.get("/activity", requireAuth, async (req: AuthRequest, res) => {
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
// ANALYTICS / DASHBOARD
// ============================================

router.get("/analytics", requireAuth, requireRole("ADMIN", "MANAGER", "HR_MANAGER"), async (req: AuthRequest, res) => {
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
