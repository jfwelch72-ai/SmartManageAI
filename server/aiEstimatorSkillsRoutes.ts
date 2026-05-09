// prompt-injection-guard: skills routes operate on org-owned methodology rules — no third-party prose in prompt path
/**
 * Task #2703 — AI Estimator Skills System HTTP surface.
 *
 * GET    /api/ai-estimator/skills               — list all skills for org (+ seeded)
 * POST   /api/ai-estimator/skills               — create a new user-authored skill
 * PATCH  /api/ai-estimator/skills/:id           — update name/ruleBody/scope/priority/isActive
 * DELETE /api/ai-estimator/skills/:id           — delete (403 for read-only)
 * POST   /api/ai-estimator/skills/reorder       — bulk priority update
 * POST   /api/ai-estimator/skills/promote-lesson/:lessonId — promote lesson → skill
 * GET    /api/ai-estimator/skills/suggestions   — AI-proposed skill candidates
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logCreate, logDelete, logUpdate } from "./auditLogger";
import {
  listSkillsForOrg,
  createSkill,
  updateSkill,
  deleteSkill,
  reorderSkills,
  promoteLessonToSkill,
  generateSkillSuggestions,
} from "./services/aiEstimator/skills";

const router = Router();

// ── List ────────────────────────────────────────────────────────────────────

router.get(
  "/api/ai-estimator/skills",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const skills = await listSkillsForOrg(orgId);
      res.json({ skills });
    } catch (err) {
      next(err);
    }
  },
);

// ── AI suggestions ───────────────────────────────────────────────────────────

router.get(
  "/api/ai-estimator/skills/suggestions",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const suggestions = await generateSkillSuggestions({
        organizationId: orgId,
        userId: req.user!.id,
      });
      res.json({ suggestions });
    } catch (err) {
      next(err);
    }
  },
);

// ── Create ───────────────────────────────────────────────────────────────────

const createSkillSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).nullish(),
  ruleBody: z.string().min(1).max(2000),
  scope: z.enum(["global", "trade", "csi_division", "project_type"]),
  scopeValue: z.string().max(100).nullish(),
  priority: z.number().int().min(1).max(9999).optional(),
  isActive: z.boolean().optional(),
});

router.post(
  "/api/ai-estimator/skills",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = createSkillSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const skill = await createSkill(orgId, {
        ...parsed.data,
        createdById: req.user!.id,
      });
      await logCreate(req.user!.id, "ai_estimator_skill", skill.id, { name: skill.name, scope: skill.scope });
      res.status(201).json({ skill });
    } catch (err) {
      next(err);
    }
  },
);

// ── Update ───────────────────────────────────────────────────────────────────

const updateSkillSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullish(),
  ruleBody: z.string().min(1).max(2000).optional(),
  scope: z.enum(["global", "trade", "csi_division", "project_type"]).optional(),
  scopeValue: z.string().max(100).nullish(),
  priority: z.number().int().min(1).max(9999).optional(),
  isActive: z.boolean().optional(),
});

router.patch(
  "/api/ai-estimator/skills/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = updateSkillSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const skill = await updateSkill(req.params.id, orgId, parsed.data);
      if (!skill) return res.status(404).json({ error: "Skill not found or read-only" });
      await logUpdate(req.user!.id, "ai_estimator_skill", skill.id, {}, { isActive: skill.isActive });
      res.json({ skill });
    } catch (err) {
      next(err);
    }
  },
);

// ── Delete ───────────────────────────────────────────────────────────────────

router.delete(
  "/api/ai-estimator/skills/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const result = await deleteSkill(req.params.id, orgId);
      if (!result.deleted) return res.status(result.reason === "Read-only skill cannot be deleted" ? 403 : 404).json({ error: result.reason });
      await logDelete(req.user!.id, "ai_estimator_skill", req.params.id, {});
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Reorder ──────────────────────────────────────────────────────────────────

const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string(), priority: z.number().int().min(1).max(9999) })),
});

router.post(
  "/api/ai-estimator/skills/reorder",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = reorderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      await reorderSkills(orgId, parsed.data.items);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Promote lesson ───────────────────────────────────────────────────────────

router.post(
  "/api/ai-estimator/skills/promote-lesson/:lessonId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const skill = await promoteLessonToSkill(orgId, req.params.lessonId, req.user!.id);
      if (!skill) return res.status(404).json({ error: "Lesson not found or already promoted" });
      await logCreate(req.user!.id, "ai_estimator_skill", skill.id, { name: skill.name, sourceType: "promoted_lesson" });
      res.status(201).json({ skill });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
