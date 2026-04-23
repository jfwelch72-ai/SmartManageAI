// Canonical project email distribution-list endpoints.
// Mounted under `/api`, exposing:
//   - GET    /api/projects/:projectId/distribution-lists
//   - POST   /api/projects/:projectId/distribution-lists
//   - DELETE /api/projects/:projectId/distribution-lists/:listId
// The legacy `/api/ai-features/schedule/:projectId/distribution-lists`
// routes were retired; this is the single source of truth for
// project-scoped distribution lists.
import { Router } from "express";
import { db } from "./db";
import {
  projectEmailDistributionLists,
  projects,
  users,
} from "@shared/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";

const router = Router();

const distributionListPayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactEmails: z.array(z.string().email()).max(100).default([]),
  extraEmails: z.array(z.string().email()).max(100).default([]),
  scope: z.enum(["PROJECT", "ORGANIZATION"]).default("PROJECT"),
});

async function assertProjectAccess(projectId: string, organizationId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, organizationId)))
    .limit(1);
  return project || null;
}

const normalizeEmails = (arr: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const e = raw.trim();
    const key = e.toLowerCase();
    if (!e || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
};

router.get(
  "/projects/:projectId/distribution-lists",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const project = await assertProjectAccess(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      // Returns both project-scoped lists for this project and any
      // organization-wide (project_id IS NULL) lists in the same org.
      const rows = await db
        .select({
          id: projectEmailDistributionLists.id,
          organizationId: projectEmailDistributionLists.organizationId,
          projectId: projectEmailDistributionLists.projectId,
          name: projectEmailDistributionLists.name,
          contactEmails: projectEmailDistributionLists.contactEmails,
          extraEmails: projectEmailDistributionLists.extraEmails,
          createdById: projectEmailDistributionLists.createdById,
          createdAt: projectEmailDistributionLists.createdAt,
          updatedAt: projectEmailDistributionLists.updatedAt,
          createdByFirstName: users.firstName,
          createdByLastName: users.lastName,
          createdByEmail: users.email,
        })
        .from(projectEmailDistributionLists)
        .leftJoin(users, eq(users.id, projectEmailDistributionLists.createdById))
        .where(
          and(
            eq(projectEmailDistributionLists.organizationId, organizationId),
            or(
              eq(projectEmailDistributionLists.projectId, req.params.projectId),
              isNull(projectEmailDistributionLists.projectId),
            ),
          ),
        )
        .orderBy(desc(projectEmailDistributionLists.updatedAt));

      const lists = rows.map(({ createdByFirstName, createdByLastName, createdByEmail, ...rest }) => ({
        ...rest,
        createdByName: createdByFirstName || createdByLastName
          ? `${createdByFirstName ?? ""} ${createdByLastName ?? ""}`.trim()
          : null,
        createdByEmail: createdByEmail ?? null,
      }));

      res.json({ lists });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/projects/:projectId/distribution-lists",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const organizationId = req.user?.organizationId;
      if (!userId || !organizationId) return res.status(401).json({ error: "Unauthorized" });

      const parsed = distributionListPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid request", details: parsed.error.errors });
      }

      const project = await assertProjectAccess(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const contactEmails = normalizeEmails(parsed.data.contactEmails);
      const extraEmails = normalizeEmails(parsed.data.extraEmails);

      if (contactEmails.length === 0 && extraEmails.length === 0) {
        return res.status(400).json({ error: "List must include at least one email" });
      }

      const name = parsed.data.name.trim();
      const isOrgScope = parsed.data.scope === "ORGANIZATION";

      if (
        isOrgScope &&
        req.user?.role !== "ADMIN" &&
        req.user?.role !== "MANAGER"
      ) {
        return res
          .status(403)
          .json({ error: "Only admins and managers can create organization-wide lists" });
      }

      const [saved] = await db
        .insert(projectEmailDistributionLists)
        .values({
          organizationId,
          projectId: isOrgScope ? null : req.params.projectId,
          name,
          contactEmails,
          extraEmails,
          createdById: userId,
        })
        .onConflictDoUpdate({
          target: isOrgScope
            ? [
                projectEmailDistributionLists.organizationId,
                projectEmailDistributionLists.name,
              ]
            : [
                projectEmailDistributionLists.projectId,
                projectEmailDistributionLists.name,
              ],
          targetWhere: isOrgScope
            ? sql`${projectEmailDistributionLists.projectId} IS NULL`
            : undefined,
          set: {
            contactEmails,
            extraEmails,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json({ list: saved });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/projects/:projectId/distribution-lists/:listId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const project = await assertProjectAccess(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const [existing] = await db
        .select({
          id: projectEmailDistributionLists.id,
          projectId: projectEmailDistributionLists.projectId,
        })
        .from(projectEmailDistributionLists)
        .where(
          and(
            eq(projectEmailDistributionLists.id, req.params.listId),
            eq(projectEmailDistributionLists.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Distribution list not found" });
      }

      const isOrgScope = existing.projectId === null;
      if (
        isOrgScope &&
        req.user?.role !== "ADMIN" &&
        req.user?.role !== "MANAGER"
      ) {
        return res
          .status(403)
          .json({ error: "Only admins and managers can delete organization-wide lists" });
      }
      if (!isOrgScope && existing.projectId !== req.params.projectId) {
        return res.status(404).json({ error: "Distribution list not found" });
      }

      const result = await db
        .delete(projectEmailDistributionLists)
        .where(
          and(
            eq(projectEmailDistributionLists.id, req.params.listId),
            eq(projectEmailDistributionLists.organizationId, organizationId),
          ),
        )
        .returning({ id: projectEmailDistributionLists.id });

      if (result.length === 0) {
        return res.status(404).json({ error: "Distribution list not found" });
      }

      res.json({ success: true, id: result[0].id });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
