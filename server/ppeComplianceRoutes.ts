import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import {
  ppeComplianceLogs, projects, users,
  insertPpeComplianceLogSchema, type PpeComplianceLog,
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

router.get(
  "/projects/:code/ppe-compliance",
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

      const logs = await db
        .select()
        .from(ppeComplianceLogs)
        .where(eq(ppeComplianceLogs.projectId, project.id))
        .orderBy(desc(ppeComplianceLogs.createdAt));

      res.json(logs);
    } catch (err) {
      logError("Error fetching PPE compliance logs:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to fetch PPE compliance logs" });
    }
  },
);

router.post(
  "/projects/:code/ppe-compliance",
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

      const body = {
        ...req.body,
        projectId: project.id,
        checkedById: req.user!.id,
        workerName: sanitizeShortText(req.body.workerName),
        notes: req.body.notes ? sanitizeText(req.body.notes) : null,
      };

      const parsed = insertPpeComplianceLogSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [log] = await db.insert(ppeComplianceLogs).values(parsed.data).returning();

      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "ppeComplianceLog",
        entityId: log.id,
        newValue: JSON.stringify({ projectCode: req.params.code, ppeType: log.ppeType, status: log.complianceStatus }),
      }, req);

      res.status(201).json(log);
    } catch (err) {
      logError("Error creating PPE compliance log:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to create PPE compliance log" });
    }
  },
);

router.post(
  "/projects/:code/ppe-compliance/batch",
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

      const { entries } = req.body;
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: "entries array is required" });
      }

      const createdLogs: PpeComplianceLog[] = [];
      for (const entry of entries) {
        const body = {
          ...entry,
          projectId: project.id,
          checkedById: req.user!.id,
          workerName: sanitizeShortText(entry.workerName),
          notes: entry.notes ? sanitizeText(entry.notes) : null,
        };

        const parsed = insertPpeComplianceLogSchema.safeParse(body);
        if (!parsed.success) continue;

        const [log] = await db.insert(ppeComplianceLogs).values(parsed.data).returning();
        createdLogs.push(log);
      }

      res.status(201).json(createdLogs);
    } catch (err) {
      logError("Error batch creating PPE compliance logs:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to create PPE compliance logs" });
    }
  },
);

router.patch(
  "/projects/:code/ppe-compliance/:id",
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
        .from(ppeComplianceLogs)
        .where(and(eq(ppeComplianceLogs.id, req.params.id), eq(ppeComplianceLogs.projectId, project.id)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "PPE compliance log not found" });

      const updateData: Record<string, unknown> = {};
      if (req.body.checkDate !== undefined) updateData.checkDate = req.body.checkDate;
      if (req.body.workerName !== undefined) updateData.workerName = sanitizeShortText(req.body.workerName);
      if (req.body.workerUserId !== undefined) updateData.workerUserId = req.body.workerUserId || null;
      if (req.body.ppeType !== undefined) updateData.ppeType = req.body.ppeType;
      if (req.body.complianceStatus !== undefined) updateData.complianceStatus = req.body.complianceStatus;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes ? sanitizeText(req.body.notes) : null;

      const [updated] = await db
        .update(ppeComplianceLogs)
        .set(updateData)
        .where(eq(ppeComplianceLogs.id, req.params.id))
        .returning();

      await logAudit({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "ppeComplianceLog",
        entityId: updated.id,
        newValue: JSON.stringify(updateData),
      }, req);

      res.json(updated);
    } catch (err) {
      logError("Error updating PPE compliance log:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to update PPE compliance log" });
    }
  },
);

router.delete(
  "/projects/:code/ppe-compliance/:id",
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
        .from(ppeComplianceLogs)
        .where(and(eq(ppeComplianceLogs.id, req.params.id), eq(ppeComplianceLogs.projectId, project.id)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "PPE compliance log not found" });

      await db.delete(ppeComplianceLogs).where(eq(ppeComplianceLogs.id, req.params.id));

      await logAudit({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "ppeComplianceLog",
        entityId: req.params.id,
        newValue: JSON.stringify({ projectCode: req.params.code }),
      }, req);

      res.json({ success: true });
    } catch (err) {
      logError("Error deleting PPE compliance log:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to delete PPE compliance log" });
    }
  },
);

export default router;
