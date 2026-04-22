import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql, or } from "drizzle-orm";
import { db } from "./db";
import {
  projectTemplates,
  projectTemplateVersions,
  projects,
} from "@shared/schema";
import {
  requireAuth,
  requireRoleOrFeature,
  type AuthRequest,
} from "./auth";
import { captureProjectTemplate, type ProjectTemplateSnapshot } from "./projectTemplateCapture";
import { instantiateProjectFromTemplate } from "./projectTemplateInstantiate";
import { logError } from "./utils/logger";

const router = Router();

const requireManageTemplates = requireRoleOrFeature(
  ["ADMIN", "MANAGER", "SUPER_ADMIN"],
  "canManageProjectTemplates",
);

const requireCreateProject = requireRoleOrFeature(
  ["ADMIN", "MANAGER", "ESTIMATOR", "SUPER_ADMIN"],
  "canCreateProjects",
);

router.get("/api/project-templates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const rows = await db
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.isActive, true),
          or(eq(projectTemplates.organizationId, orgId), eq(projectTemplates.isSystemSeed, true)),
        ),
      )
      .orderBy(desc(projectTemplates.isSystemSeed), desc(projectTemplates.lastUsedAt), desc(projectTemplates.createdAt));

    res.json({ templates: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/api/project-templates/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const [tpl] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, req.params.id)).limit(1);
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    if (!tpl.isSystemSeed && tpl.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const versions = await db
      .select()
      .from(projectTemplateVersions)
      .where(eq(projectTemplateVersions.templateId, tpl.id))
      .orderBy(desc(projectTemplateVersions.version));

    res.json({ template: tpl, versions });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/api/project-templates/:id/snapshot",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const [tpl] = await db
        .select()
        .from(projectTemplates)
        .where(eq(projectTemplates.id, req.params.id))
        .limit(1);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      if (!tpl.isSystemSeed && tpl.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const versionId = typeof req.query.versionId === "string" ? req.query.versionId : null;
      const versionRow = versionId
        ? (
            await db
              .select()
              .from(projectTemplateVersions)
              .where(
                and(
                  eq(projectTemplateVersions.templateId, tpl.id),
                  eq(projectTemplateVersions.id, versionId),
                ),
              )
              .limit(1)
          )[0]
        : (
            await db
              .select()
              .from(projectTemplateVersions)
              .where(eq(projectTemplateVersions.templateId, tpl.id))
              .orderBy(desc(projectTemplateVersions.version))
              .limit(1)
          )[0];

      if (!versionRow) return res.status(404).json({ error: "Template version not found" });

      const snapshot = versionRow.snapshot as ProjectTemplateSnapshot;
      res.json({
        versionId: versionRow.id,
        version: versionRow.version,
        tasks: snapshot.tasks ?? [],
        dependencies: snapshot.dependencies ?? [],
      });
    } catch (err) {
      next(err);
    }
  },
);

const captureSchema = z.object({
  projectCode: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
});

router.post(
  "/api/project-templates/capture",
  requireAuth,
  requireManageTemplates,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const parsed = captureSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

      const [project] = await db.select().from(projects).where(eq(projects.code, parsed.data.projectCode)).limit(1);
      if (!project) return res.status(404).json({ error: "Source project not found" });
      if (project.gcOrganizationId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Cannot capture template from a project in another organization" });
      }

      const snapshot = await captureProjectTemplate(project.id);

      const [tpl] = await db
        .insert(projectTemplates)
        .values({
          organizationId: orgId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          category: parsed.data.category ?? null,
          sourceProjectId: project.id,
          sourceProjectCode: project.code,
          isSystemSeed: false,
          isActive: true,
          createdById: req.user!.id,
        })
        .returning();

      await db.insert(projectTemplateVersions).values({
        templateId: tpl.id,
        version: 1,
        snapshot: snapshot as unknown as Record<string, unknown>,
        notes: `Captured from project ${project.code}`,
        createdById: req.user!.id,
      });

      res.status(201).json({ template: tpl });
    } catch (err) {
      logError("Failed to capture project template", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
  isActive: z.boolean().optional(),
});

router.patch(
  "/api/project-templates/:id",
  requireAuth,
  requireManageTemplates,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const [tpl] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, req.params.id)).limit(1);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      if (tpl.isSystemSeed && req.user?.role !== "SUPER_ADMIN") {
        return res.status(403).json({ error: "Only platform admins can edit system seed templates" });
      }
      if (!tpl.isSystemSeed && tpl.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const parsed = updateTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

      const [updated] = await db
        .update(projectTemplates)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(projectTemplates.id, tpl.id))
        .returning();

      res.json({ template: updated });
    } catch (err) {
      next(err);
    }
  },
);

const newVersionSchema = z.object({
  snapshot: z.record(z.unknown()).optional(),
  recaptureFromSource: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

router.post(
  "/api/project-templates/:id/versions",
  requireAuth,
  requireManageTemplates,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const [tpl] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, req.params.id)).limit(1);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      if (tpl.isSystemSeed && req.user?.role !== "SUPER_ADMIN") {
        return res.status(403).json({ error: "Only platform admins can edit system seed templates" });
      }
      if (!tpl.isSystemSeed && tpl.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const parsed = newVersionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

      let snapshot: Record<string, unknown> | undefined = parsed.data.snapshot;
      if (!snapshot && parsed.data.recaptureFromSource) {
        if (!tpl.sourceProjectId) {
          return res.status(400).json({ error: "Template has no source project to recapture from" });
        }
        const captured = await captureProjectTemplate(tpl.sourceProjectId);
        snapshot = captured as unknown as Record<string, unknown>;
      }
      if (!snapshot) {
        return res.status(400).json({ error: "Provide a snapshot or set recaptureFromSource:true" });
      }

      const nextVersion = (tpl.currentVersion ?? 1) + 1;
      const [version] = await db
        .insert(projectTemplateVersions)
        .values({
          templateId: tpl.id,
          version: nextVersion,
          snapshot,
          notes: parsed.data.notes,
          createdById: req.user!.id,
        })
        .returning();

      const [updated] = await db
        .update(projectTemplates)
        .set({ currentVersion: nextVersion, updatedAt: new Date() })
        .where(eq(projectTemplates.id, tpl.id))
        .returning();

      res.status(201).json({ template: updated, version });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/api/project-templates/:id",
  requireAuth,
  requireManageTemplates,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const [tpl] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, req.params.id)).limit(1);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      if (tpl.isSystemSeed && req.user?.role !== "SUPER_ADMIN") {
        return res.status(403).json({ error: "Cannot delete system seed templates" });
      }
      if (!tpl.isSystemSeed && tpl.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await db
        .update(projectTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(projectTemplates.id, tpl.id));

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const instantiateSchema = z.object({
  templateId: z.string().min(1),
  versionId: z.string().min(1).optional(),
  projectStartDate: z.string().min(1),
  project: z.object({
    name: z.string().min(1).max(200),
    clientName: z.string().min(1).max(200),
    description: z.string().max(2000).optional().nullable(),
    locationAddress: z.string().max(500).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    state: z.string().max(120).optional().nullable(),
    contractAmount: z.string().max(40).optional().nullable(),
    budget: z.string().max(40).optional().nullable(),
    ownerRepOrganizationId: z.string().optional().nullable(),
  }),
  roleAssignments: z
    .object({
      projectManagerId: z.string().optional().nullable(),
      superintendentId: z.string().optional().nullable(),
      estimatorId: z.string().optional().nullable(),
      safetyOfficerId: z.string().optional().nullable(),
    })
    .optional(),
  excludedRefIds: z.array(z.string().min(1)).max(5000).optional(),
  taskOverrides: z
    .array(
      z.object({
        refId: z.string().min(1),
        name: z.string().min(1).max(500).optional(),
        durationDays: z.number().int().min(0).max(10000).nullable().optional(),
      }),
    )
    .max(5000)
    .optional(),
  addedTasks: z
    .array(
      z.object({
        tempId: z.string().min(1),
        parentRefId: z.string().min(1).nullable(),
        name: z.string().min(1).max(500),
        durationDays: z.number().int().min(0).max(10000).nullable().optional(),
      }),
    )
    .max(2000)
    .optional(),
});

router.post(
  "/api/project-templates/instantiate",
  requireAuth,
  requireCreateProject,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const parsed = instantiateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

      const [tpl] = await db
        .select()
        .from(projectTemplates)
        .where(eq(projectTemplates.id, parsed.data.templateId))
        .limit(1);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      if (!tpl.isSystemSeed && tpl.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const versionRow = parsed.data.versionId
        ? (await db
            .select()
            .from(projectTemplateVersions)
            .where(
              and(
                eq(projectTemplateVersions.templateId, tpl.id),
                eq(projectTemplateVersions.id, parsed.data.versionId),
              ),
            )
            .limit(1))[0]
        : (await db
            .select()
            .from(projectTemplateVersions)
            .where(eq(projectTemplateVersions.templateId, tpl.id))
            .orderBy(desc(projectTemplateVersions.version))
            .limit(1))[0];

      if (!versionRow) return res.status(404).json({ error: "Template version not found" });

      const startDate = new Date(parsed.data.projectStartDate);
      if (Number.isNaN(startDate.getTime())) {
        return res.status(400).json({ error: "Invalid projectStartDate" });
      }

      // SECURITY: never trust gcOrganizationId from the client; bind to caller's org.
      const projectInput = {
        ...parsed.data.project,
        gcOrganizationId: orgId,
      };

      const result = await instantiateProjectFromTemplate({
        template: { id: tpl.id, sourceProjectCode: tpl.sourceProjectCode },
        snapshot: versionRow.snapshot as ProjectTemplateSnapshot,
        organizationId: orgId,
        createdByUserId: req.user!.id,
        projectStartDate: startDate,
        projectInput,
        roleAssignments: parsed.data.roleAssignments,
        excludedRefIds: parsed.data.excludedRefIds,
        taskOverrides: parsed.data.taskOverrides,
        addedTasks: parsed.data.addedTasks,
      });

      await db
        .update(projectTemplates)
        .set({
          usageCount: sql`${projectTemplates.usageCount} + 1`,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectTemplates.id, tpl.id));

      res.status(201).json(result);
    } catch (err) {
      logError("Failed to instantiate project from template", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

export default router;
