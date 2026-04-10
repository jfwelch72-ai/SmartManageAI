import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import {
  materialTests, projects, punchListItems, users,
  insertMaterialTestSchema, type MaterialTest,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest, type UserRole } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "MANAGER", "SUPERINTENDENT"];

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
}

async function generateTestNumber(projectCode: string): Promise<string> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int as count FROM material_tests mt
    INNER JOIN projects p ON mt.project_id = p.id
    WHERE p.code = ${projectCode}
  `);
  const count = (result.rows[0]?.count as number) || 0;
  return `MT-${projectCode}-${String(count + 1).padStart(3, "0")}`;
}

router.get(
  "/projects/:code/material-tests",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const tests = await db
        .select()
        .from(materialTests)
        .where(eq(materialTests.projectId, project.id))
        .orderBy(desc(materialTests.createdAt));

      res.json(tests);
    } catch (err) {
      logError("Error fetching material tests:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to fetch material tests" });
    }
  },
);

router.post(
  "/projects/:code/material-tests",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const testNumber = await generateTestNumber(req.params.code);
      const body = {
        ...req.body,
        projectId: project.id,
        testNumber,
        createdById: req.user!.id,
        materialType: sanitizeShortText(req.body.materialType),
        notes: req.body.notes ? sanitizeText(req.body.notes) : null,
        testResults: req.body.testResults ? sanitizeText(req.body.testResults) : null,
        specRequirement: req.body.specRequirement ? sanitizeText(req.body.specRequirement) : null,
      };

      const parsed = insertMaterialTestSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [test] = await db.insert(materialTests).values(parsed.data).returning();

      if (test.status === "FAILED" && !test.punchListItemId) {
        try {
          const countResult = await db.execute(sql`
            SELECT COUNT(*)::int as count FROM punch_list_items WHERE project_id = ${project.id}
          `);
          const count = (countResult.rows[0]?.count as number) || 0;
          const itemNumber = `PLI-${req.params.code}-${String(count + 1).padStart(3, "0")}`;

          const userName = `${req.user!.firstName} ${req.user!.lastName}`.trim() || req.user!.id;
          const punchBody = {
            projectId: project.id,
            itemNumber,
            createdById: req.user!.id,
            title: `Failed Material Test: ${test.materialType} - ${test.testType.replace(/_/g, " ")}`,
            description: `Material test ${test.testNumber} failed. ${test.testResults || ""}`.trim(),
            location: null,
            trade: "GENERAL" as const,
            priority: "HIGH" as const,
            status: "OPEN" as const,
            assignedToName: null,
            assignedToEmail: null,
            assignedToUserId: null,
            dueDate: null,
            attachments: [],
            statusHistory: [{
              status: "OPEN",
              changedBy: userName,
              changedAt: new Date().toISOString(),
              note: `Auto-generated from failed material test ${test.testNumber}`,
            }],
            inspectionId: null,
          };

          const [punchItem] = await db.insert(punchListItems).values(punchBody).returning();

          await db
            .update(materialTests)
            .set({ punchListItemId: punchItem.id, updatedAt: new Date() })
            .where(eq(materialTests.id, test.id));

          test.punchListItemId = punchItem.id;
        } catch (punchErr) {
          logError("Error auto-creating punch list item from failed material test:", {}, punchErr instanceof Error ? punchErr : new Error(String(punchErr)));
        }
      }

      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "materialTest",
        entityId: test.id,
        newValue: JSON.stringify({ testNumber, projectCode: req.params.code }),
      }, req);

      res.status(201).json(test);
    } catch (err) {
      logError("Error creating material test:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to create material test" });
    }
  },
);

router.patch(
  "/projects/:code/material-tests/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const [existing] = await db
        .select()
        .from(materialTests)
        .where(and(eq(materialTests.id, req.params.id), eq(materialTests.projectId, project.id)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "Material test not found" });

      const previousStatus = existing.status;
      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (req.body.materialType !== undefined) updateData.materialType = sanitizeShortText(req.body.materialType);
      if (req.body.testType !== undefined) updateData.testType = req.body.testType;
      if (req.body.customTestType !== undefined) updateData.customTestType = req.body.customTestType;
      if (req.body.sampleId !== undefined) updateData.sampleId = req.body.sampleId;
      if (req.body.testDate !== undefined) updateData.testDate = req.body.testDate;
      if (req.body.labName !== undefined) updateData.labName = req.body.labName;
      if (req.body.testResults !== undefined) updateData.testResults = req.body.testResults ? sanitizeText(req.body.testResults) : null;
      if (req.body.status !== undefined) updateData.status = req.body.status;
      if (req.body.specRequirement !== undefined) updateData.specRequirement = req.body.specRequirement ? sanitizeText(req.body.specRequirement) : null;
      if (req.body.reportFileUrl !== undefined) updateData.reportFileUrl = req.body.reportFileUrl;
      if (req.body.reportFileName !== undefined) updateData.reportFileName = req.body.reportFileName;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes ? sanitizeText(req.body.notes) : null;

      const [updated] = await db
        .update(materialTests)
        .set(updateData)
        .where(eq(materialTests.id, req.params.id))
        .returning();

      if (req.body.status === "FAILED" && previousStatus !== "FAILED" && !existing.punchListItemId) {
        try {
          const countResult = await db.execute(sql`
            SELECT COUNT(*)::int as count FROM punch_list_items WHERE project_id = ${project.id}
          `);
          const count = (countResult.rows[0]?.count as number) || 0;
          const itemNumber = `PLI-${req.params.code}-${String(count + 1).padStart(3, "0")}`;

          const userName = `${req.user!.firstName} ${req.user!.lastName}`.trim() || req.user!.id;
          const punchBody = {
            projectId: project.id,
            itemNumber,
            createdById: req.user!.id,
            title: `Failed Material Test: ${updated.materialType} - ${updated.testType.replace(/_/g, " ")}`,
            description: `Material test ${updated.testNumber} failed. ${updated.testResults || ""}`.trim(),
            location: null,
            trade: "GENERAL" as const,
            priority: "HIGH" as const,
            status: "OPEN" as const,
            assignedToName: null,
            assignedToEmail: null,
            assignedToUserId: null,
            dueDate: null,
            attachments: [],
            statusHistory: [{
              status: "OPEN",
              changedBy: userName,
              changedAt: new Date().toISOString(),
              note: `Auto-generated from failed material test ${updated.testNumber}`,
            }],
            inspectionId: null,
          };

          const [punchItem] = await db.insert(punchListItems).values(punchBody).returning();

          await db
            .update(materialTests)
            .set({ punchListItemId: punchItem.id, updatedAt: new Date() })
            .where(eq(materialTests.id, updated.id));

          updated.punchListItemId = punchItem.id;
        } catch (punchErr) {
          logError("Error auto-creating punch list item from failed material test:", {}, punchErr instanceof Error ? punchErr : new Error(String(punchErr)));
        }
      }

      await logAudit({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "materialTest",
        entityId: updated.id,
        newValue: JSON.stringify(updateData),
      }, req);

      res.json(updated);
    } catch (err) {
      logError("Error updating material test:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to update material test" });
    }
  },
);

router.delete(
  "/projects/:code/material-tests/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const [existing] = await db
        .select()
        .from(materialTests)
        .where(and(eq(materialTests.id, req.params.id), eq(materialTests.projectId, project.id)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "Material test not found" });

      await db.delete(materialTests).where(eq(materialTests.id, req.params.id));

      await logAudit({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "materialTest",
        entityId: req.params.id,
        newValue: JSON.stringify({ testNumber: existing.testNumber, projectCode: req.params.code }),
      }, req);

      res.json({ success: true });
    } catch (err) {
      logError("Error deleting material test:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to delete material test" });
    }
  },
);

router.get(
  "/projects/:code/safety-officer",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess || (orgId && project.gcOrganizationId !== orgId)) return res.status(403).json({ error: "Access denied" });

      if (!project.safetyOfficerId) return res.json({ safetyOfficerId: null, safetyOfficer: null });

      const [officer] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .where(eq(users.id, project.safetyOfficerId))
        .limit(1);

      res.json({ safetyOfficerId: project.safetyOfficerId, safetyOfficer: officer || null });
    } catch (err) {
      logError("Error fetching safety officer:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to fetch safety officer" });
    }
  },
);

router.patch(
  "/projects/:code/safety-officer",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess || (orgId && project.gcOrganizationId !== orgId)) return res.status(403).json({ error: "Access denied" });

      const { safetyOfficerId } = req.body;
      if (safetyOfficerId !== null && safetyOfficerId !== undefined && typeof safetyOfficerId !== "string") {
        return res.status(400).json({ error: "Invalid safetyOfficerId" });
      }

      if (safetyOfficerId) {
        const [officer] = await db.select({ id: users.id, organizationId: users.organizationId })
          .from(users).where(eq(users.id, safetyOfficerId)).limit(1);
        if (!officer) return res.status(400).json({ error: "User not found" });
        if (orgId && officer.organizationId !== orgId) return res.status(403).json({ error: "User does not belong to your organization" });
      }

      await db.update(projects).set({ safetyOfficerId: safetyOfficerId || null }).where(eq(projects.id, project.id));

      await logAudit({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "project",
        entityId: project.id,
        newValue: JSON.stringify({ safetyOfficerId }),
      }, req);

      res.json({ success: true, safetyOfficerId: safetyOfficerId || null });
    } catch (err) {
      logError("Error updating safety officer:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to update safety officer" });
    }
  },
);

export default router;
