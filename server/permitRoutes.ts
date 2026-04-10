import { Router } from "express";
import { db } from "./db";
import { projectPermits, projects } from "@shared/schema";
import { eq, and, sql, lte, gte, desc } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { verifyOrgAccess, getOrgIdForFilter } from "./orgFilter";
import { logAudit } from "./auditLogger";

const router = Router();

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  APPLIED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["APPROVED", "APPLIED"],
  APPROVED: ["ACTIVE"],
  ACTIVE: ["EXPIRED", "RENEWED"],
  EXPIRED: ["RENEWED"],
  RENEWED: ["ACTIVE", "EXPIRED"],
};

const PERMIT_TYPES = [
  "BUILDING", "DEMOLITION", "EXCAVATION", "ELECTRICAL", "PLUMBING",
  "MECHANICAL", "FIRE_SAFETY", "ENVIRONMENTAL", "OCCUPANCY", "CUSTOM",
] as const;

const PERMIT_STATUSES = [
  "APPLIED", "UNDER_REVIEW", "APPROVED", "ACTIVE", "EXPIRED", "RENEWED",
] as const;

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional().nullable();

const createPermitSchema = z.object({
  permitType: z.enum(PERMIT_TYPES),
  customType: z.string().optional().nullable(),
  permitNumber: z.string().optional().nullable(),
  status: z.enum(PERMIT_STATUSES).optional().default("APPLIED"),
  issuingAuthority: z.string().optional().nullable(),
  appliedDate: dateStringSchema,
  issuedDate: dateStringSchema,
  expiryDate: dateStringSchema,
  linkedInspectionIds: z.string().optional().nullable(),
  linkedDocumentIds: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
}).refine(
  (data) => data.permitType !== "CUSTOM" || (data.customType && data.customType.trim().length > 0),
  { message: "Custom type name is required when permit type is CUSTOM", path: ["customType"] }
);

const updatePermitSchema = z.object({
  permitType: z.enum(PERMIT_TYPES).optional(),
  customType: z.string().optional().nullable(),
  permitNumber: z.string().optional().nullable(),
  status: z.enum(PERMIT_STATUSES).optional(),
  issuingAuthority: z.string().optional().nullable(),
  appliedDate: dateStringSchema,
  issuedDate: dateStringSchema,
  expiryDate: dateStringSchema,
  linkedInspectionIds: z.string().optional().nullable(),
  linkedDocumentIds: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/projects/:projectId/permits", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const { projectId } = req.params;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const permits = await db
      .select()
      .from(projectPermits)
      .where(eq(projectPermits.projectId, projectId))
      .orderBy(desc(projectPermits.createdAt));

    res.json(permits);
  } catch (error) {
    next(error);
  }
});

router.get("/projects/:projectId/permits/:permitId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const { projectId, permitId } = req.params;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [permit] = await db
      .select()
      .from(projectPermits)
      .where(and(eq(projectPermits.id, permitId), eq(projectPermits.projectId, projectId)))
      .limit(1);

    if (!permit) {
      res.status(404).json({ error: "Permit not found" });
      return;
    }

    res.json(permit);
  } catch (error) {
    next(error);
  }
});

router.post("/projects/:projectId/permits", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { projectId } = req.params;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const parsed = createPermitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      return;
    }

    const data = parsed.data;

    const [permit] = await db
      .insert(projectPermits)
      .values({
        projectId,
        permitType: data.permitType,
        customType: data.customType || null,
        permitNumber: data.permitNumber || null,
        status: data.status || "APPLIED",
        issuingAuthority: data.issuingAuthority || null,
        appliedDate: data.appliedDate || null,
        issuedDate: data.issuedDate || null,
        expiryDate: data.expiryDate || null,
        linkedInspectionIds: data.linkedInspectionIds || null,
        linkedDocumentIds: data.linkedDocumentIds || null,
        notes: data.notes || null,
        createdById: req.user!.id,
      })
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "projectPermit",
      entityId: permit.id,
      newValue: JSON.stringify({ projectId, ...data }),
    }, req);

    res.status(201).json(permit);
  } catch (error) {
    next(error);
  }
});

router.patch("/permits/:permitId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { permitId } = req.params;

    const [existing] = await db
      .select()
      .from(projectPermits)
      .where(eq(projectPermits.id, permitId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Permit not found" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const parsed = updatePermitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      return;
    }

    const data = parsed.data;

    if (data.status && data.status !== existing.status) {
      const allowed = VALID_STATUS_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        res.status(422).json({
          error: `Invalid status transition from ${existing.status} to ${data.status}. Allowed: ${allowed.join(", ") || "none"}`,
        });
        return;
      }
    }

    const updateData: Partial<typeof projectPermits.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (data.permitType !== undefined) updateData.permitType = data.permitType;
    if (data.customType !== undefined) updateData.customType = data.customType;
    if (data.permitNumber !== undefined) updateData.permitNumber = data.permitNumber;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.issuingAuthority !== undefined) updateData.issuingAuthority = data.issuingAuthority;
    if (data.appliedDate !== undefined) updateData.appliedDate = data.appliedDate;
    if (data.issuedDate !== undefined) updateData.issuedDate = data.issuedDate;
    if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate;
    if (data.linkedInspectionIds !== undefined) updateData.linkedInspectionIds = data.linkedInspectionIds;
    if (data.linkedDocumentIds !== undefined) updateData.linkedDocumentIds = data.linkedDocumentIds;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const [updated] = await db
      .update(projectPermits)
      .set(updateData)
      .where(eq(projectPermits.id, permitId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "projectPermit",
      entityId: permitId,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/permits/:permitId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { permitId } = req.params;

    const [existing] = await db
      .select()
      .from(projectPermits)
      .where(eq(projectPermits.id, permitId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Permit not found" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    await db.delete(projectPermits).where(eq(projectPermits.id, permitId));

    await logAudit({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "projectPermit",
      entityId: permitId,
      oldValue: JSON.stringify(existing),
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/permits/:permitId/status", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { permitId } = req.params;
    const { status } = req.body;

    if (!status || !PERMIT_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const [existing] = await db
      .select()
      .from(projectPermits)
      .where(eq(projectPermits.id, permitId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Permit not found" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const allowed = VALID_STATUS_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      res.status(422).json({
        error: `Invalid status transition from ${existing.status} to ${status}. Allowed: ${allowed.join(", ") || "none"}`,
      });
      return;
    }

    const [updated] = await db
      .update(projectPermits)
      .set({ status, updatedAt: new Date() })
      .where(eq(projectPermits.id, permitId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "projectPermit",
      entityId: permitId,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status }),
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get("/permits/expiring", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      res.json([]);
      return;
    }

    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const nowStr = now.toISOString().split("T")[0];
    const futureStr = thirtyDaysFromNow.toISOString().split("T")[0];

    let query;
    if (shouldFilter && orgId) {
      query = db
        .select({
          permit: projectPermits,
          projectName: projects.name,
          projectCode: projects.code,
        })
        .from(projectPermits)
        .innerJoin(projects, eq(projectPermits.projectId, projects.id))
        .where(
          and(
            eq(projects.gcOrganizationId, orgId),
            lte(projectPermits.expiryDate, futureStr),
            gte(projectPermits.expiryDate, nowStr),
            sql`${projectPermits.status} NOT IN ('EXPIRED', 'RENEWED')`
          )
        )
        .orderBy(projectPermits.expiryDate);
    } else {
      query = db
        .select({
          permit: projectPermits,
          projectName: projects.name,
          projectCode: projects.code,
        })
        .from(projectPermits)
        .innerJoin(projects, eq(projectPermits.projectId, projects.id))
        .where(
          and(
            lte(projectPermits.expiryDate, futureStr),
            gte(projectPermits.expiryDate, nowStr),
            sql`${projectPermits.status} NOT IN ('EXPIRED', 'RENEWED')`
          )
        )
        .orderBy(projectPermits.expiryDate);
    }

    const results = await query;

    const mapped = results.map((r) => ({
      ...r.permit,
      projectName: r.projectName,
      projectCode: r.projectCode,
    }));

    res.json(mapped);
  } catch (error) {
    next(error);
  }
});

export default router;
