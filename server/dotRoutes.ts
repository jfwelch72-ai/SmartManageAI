import { Router, type Response } from "express";
import { db } from "./db";
import {
  dotAgencies,
  dotSpecBooks,
  dotPayItems,
  dotPayItemOverrides,
  organizationDotPreferences,
  projectDbeGoals,
  crmOrganisationCertifications,
  suretyBonds,
  haulTickets,
  dailyInspectorReports,
  swpppInspections,
  materialCertifications,
  insertDotAgencySchema,
  insertDotSpecBookSchema,
  insertDotPayItemOverrideSchema,
  insertOrganizationDotPreferenceSchema,
  insertProjectDbeGoalSchema,
  insertCrmOrganisationCertificationSchema,
  insertSuretyBondSchema,
  insertHaulTicketSchema,
  insertDailyInspectorReportSchema,
  insertSwpppInspectionSchema,
  insertMaterialCertificationSchema,
} from "@shared/schema";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  requireAuth,
  requireRole,
  requireFeaturePermission,
  requireAnyFeaturePermission,
  type AuthRequest,
} from "./auth";
import { requireOrgOwnership } from "./orgFilter";
import { orgScopedCache, cacheInvalidate } from "./cache";
import { getEffectivePermissions, type FeaturePermissionKey } from "./auth";

// SUPER_ADMIN view-as: when isSuperAdmin and ?organizationId=... is passed,
// scope the list to that org; otherwise return all-org rows (audited via
// getOrgIdForFilter). Returns the orgId to inject into WHERE, or null for no extra filter.
function superAdminTargetOrgId(req: AuthRequest): string | null {
  if (req.user?.role !== "SUPER_ADMIN") return null;
  const v = (req.query?.organizationId as string | undefined) ?? null;
  return v && v.length > 0 ? v : null;
}

// Strictly honor explicit permission keys. SUPER_ADMIN retains a platform bypass
// (they can act in any org); per-role short-circuits are intentionally removed so
// per-user permission overrides cannot be silently bypassed by role membership.
async function userHasApprovalPermission(
  req: AuthRequest,
  _approvalRoles: string[],
  permKey: FeaturePermissionKey,
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  const role = req.user.effectiveRole || req.user.role;
  const perms = await getEffectivePermissions(req.user.id, req.user.organizationId ?? null, role);
  return Boolean(perms[permKey]);
}

async function userHasManagePermission(
  req: AuthRequest,
  permKey: FeaturePermissionKey,
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  const role = req.user.effectiveRole || req.user.role;
  const perms = await getEffectivePermissions(req.user.id, req.user.organizationId ?? null, role);
  return Boolean(perms[permKey]);
}

// Restrict an incoming PATCH body to a whitelist of fields, fully type-safe.
function pickAllowedFields<T extends object, K extends keyof T>(
  patch: Partial<T>,
  allowed: readonly K[],
): { picked: Pick<Partial<T>, K>; rejected: string[] } {
  const picked = {} as Pick<Partial<T>, K>;
  const rejected: string[] = [];
  const allowedSet = new Set<string>(allowed.map((k) => String(k)));
  for (const key of Object.keys(patch) as Array<keyof T & string>) {
    if (allowedSet.has(key)) {
      picked[key as K] = patch[key as K];
    } else {
      rejected.push(key);
    }
  }
  return { picked, rejected };
}
import { eventBus } from "./events/eventBus";
import { validateBody } from "./utils/validation";
import { z } from "zod";

const router = Router();

// Cache TTLs
const REFERENCE_TTL_MS = 5 * 60_000; // 5 min - global reference data
const ORG_TTL_MS = 60_000; // 1 min - org-scoped lookups

// Cache key helpers
const KEY_AGENCIES = "dot:agencies";
const KEY_SPEC_BOOKS = (agencyId: string) => `dot:spec-books:${agencyId}`;
const KEY_ORG_PREFS = "dot:preferences";
const KEY_ORG_OVERRIDES = "dot:pay-item-overrides";

// =========================
// DOT Agencies (read-only for users; write requires SUPER_ADMIN)
// =========================
router.get(
  "/api/dot/agencies",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (_req: AuthRequest, res: Response) => {
    const rows = await orgScopedCache(null, KEY_AGENCIES, REFERENCE_TTL_MS, () =>
      db.select().from(dotAgencies).where(eq(dotAgencies.isActive, true)).orderBy(dotAgencies.name)
    );
    res.json(rows);
  },
);

router.post("/api/dot/agencies", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertDotAgencySchema, req.body, res);
  if (!data) return;
  const [row] = await db.insert(dotAgencies).values(data).returning();
  cacheInvalidate("__global__", KEY_AGENCIES);
  res.status(201).json(row);
});

// =========================
// DOT Spec Books
// =========================
router.get(
  "/api/dot/agencies/:agencyId/spec-books",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const { agencyId } = req.params;
    const rows = await orgScopedCache(null, KEY_SPEC_BOOKS(agencyId), REFERENCE_TTL_MS, () =>
      db.select().from(dotSpecBooks).where(eq(dotSpecBooks.agencyId, agencyId)).orderBy(desc(dotSpecBooks.edition))
    );
    res.json(rows);
  },
);

router.post("/api/dot/spec-books", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertDotSpecBookSchema, req.body, res);
  if (!data) return;
  const [row] = await db.insert(dotSpecBooks).values(data).returning();
  cacheInvalidate("__global__", KEY_SPEC_BOOKS(row.agencyId));
  res.status(201).json(row);
});

// =========================
// DOT Pay Items — search + browse + admin upload
// =========================
const payItemSearchQuerySchema = z.object({
  specBookId: z.string().optional(),
  agencyId: z.string().optional(),
  q: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get(
  "/api/dot/pay-items",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const parsed = payItemSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors });
    const { specBookId, agencyId, q, category, limit } = parsed.data;
    const cacheKey = `dot:pay-items:${specBookId ?? ""}:${agencyId ?? ""}:${category ?? ""}:${(q ?? "").toLowerCase()}:${limit}`;
    const rows = await orgScopedCache(null, cacheKey, REFERENCE_TTL_MS, () => {
      const conditions: SQL[] = [eq(dotPayItems.isActive, true)];
      if (specBookId) conditions.push(eq(dotPayItems.specBookId, specBookId));
      if (agencyId) conditions.push(eq(dotPayItems.agencyId, agencyId));
      if (category) conditions.push(eq(dotPayItems.category, category));
      if (q && q.trim()) {
        const term = `%${q.trim().toLowerCase()}%`;
        const orExpr = or(
          ilike(dotPayItems.itemNumber, term),
          ilike(dotPayItems.description, term),
          ilike(dotPayItems.searchTokens, term),
        );
        if (orExpr) conditions.push(orExpr);
      }
      return db.select().from(dotPayItems).where(and(...conditions)).orderBy(dotPayItems.itemNumber).limit(limit);
    });
    res.json(rows);
  },
);

const bulkUploadSchema = z.object({
  specBookId: z.string(),
  items: z.array(z.object({
    itemNumber: z.string().min(1),
    description: z.string().min(1),
    unit: z.string().min(1),
    specSection: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
  })).min(1),
});
router.post("/api/dot/pay-items/bulk-upload", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const data = validateBody(bulkUploadSchema, req.body, res);
  if (!data) return;
  const sb = await db.select().from(dotSpecBooks).where(eq(dotSpecBooks.id, data.specBookId)).limit(1);
  if (sb.length === 0) return res.status(404).json({ error: "Spec book not found" });

  let inserted = 0;
  let skipped = 0;
  for (const item of data.items) {
    const existing = await db.select().from(dotPayItems)
      .where(and(eq(dotPayItems.specBookId, data.specBookId), eq(dotPayItems.itemNumber, item.itemNumber)))
      .limit(1);
    if (existing.length > 0) { skipped++; continue; }
    await db.insert(dotPayItems).values({
      specBookId: data.specBookId,
      agencyId: sb[0].agencyId,
      itemNumber: item.itemNumber,
      description: item.description,
      unit: item.unit,
      specSection: item.specSection ?? null,
      category: item.category ?? null,
      searchTokens: `${item.itemNumber} ${item.description}`.toLowerCase(),
    });
    inserted++;
  }
  await db.update(dotSpecBooks).set({
    itemCount: sql`(SELECT COUNT(*) FROM dot_pay_items WHERE spec_book_id = ${data.specBookId})`,
  }).where(eq(dotSpecBooks.id, data.specBookId));
  cacheInvalidate("__global__", KEY_SPEC_BOOKS(sb[0].agencyId));
  res.json({ inserted, skipped, total: data.items.length });
});

// =========================
// Org-scoped DOT preferences
// =========================
router.get(
  "/api/dot/preferences",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    if (ctx.isSuperAdmin) {
      const targetOrg = superAdminTargetOrgId(req);
      const rows = targetOrg
        ? await db.select().from(organizationDotPreferences).where(eq(organizationDotPreferences.organizationId, targetOrg))
        : await db.select().from(organizationDotPreferences);
      return res.json(rows);
    }
    const rows = await orgScopedCache(ctx.orgId!, KEY_ORG_PREFS, ORG_TTL_MS, () =>
      db.select().from(organizationDotPreferences).where(eq(organizationDotPreferences.organizationId, ctx.orgId!))
    );
    res.json(rows);
  },
);

router.post(
  "/api/dot/preferences",
  requireAuth,
  requireFeaturePermission("canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertOrganizationDotPreferenceSchema, { ...req.body, organizationId: ctx.orgId }, res);
    if (!data) return;
    try {
      const [row] = await db.insert(organizationDotPreferences).values(data).returning();
      cacheInvalidate(ctx.orgId!, KEY_ORG_PREFS);
      res.status(201).json(row);
    } catch {
      res.status(409).json({ error: "Already a preferred agency" });
    }
  },
);

router.delete(
  "/api/dot/preferences/:id",
  requireAuth,
  requireFeaturePermission("canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(organizationDotPreferences.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(organizationDotPreferences.organizationId, ctx.orgId!));
    await db.delete(organizationDotPreferences).where(and(...conditions));
    if (!ctx.isSuperAdmin) cacheInvalidate(ctx.orgId!, KEY_ORG_PREFS);
    res.status(204).end();
  },
);

// =========================
// Pay item overrides (per-org)
// =========================
router.get(
  "/api/dot/pay-item-overrides",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    if (ctx.isSuperAdmin) {
      const targetOrg = superAdminTargetOrgId(req);
      const rows = targetOrg
        ? await db.select().from(dotPayItemOverrides).where(eq(dotPayItemOverrides.organizationId, targetOrg))
        : await db.select().from(dotPayItemOverrides);
      return res.json(rows);
    }
    const rows = await orgScopedCache(ctx.orgId!, KEY_ORG_OVERRIDES, ORG_TTL_MS, () =>
      db.select().from(dotPayItemOverrides).where(eq(dotPayItemOverrides.organizationId, ctx.orgId!))
    );
    res.json(rows);
  },
);

router.post(
  "/api/dot/pay-item-overrides",
  requireAuth,
  requireFeaturePermission("canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertDotPayItemOverrideSchema, { ...req.body, organizationId: ctx.orgId }, res);
    if (!data) return;
    const [row] = await db.insert(dotPayItemOverrides).values(data).returning();
    cacheInvalidate(ctx.orgId!, KEY_ORG_OVERRIDES);
    res.status(201).json(row);
  },
);

// =========================
// DBE Goals (per project)
// =========================
const KEY_DBE_GOALS = (projectId: string) => `dot:dbe-goals:${projectId}`;

router.get(
  "/api/projects/:projectId/dbe-goals",
  requireAuth,
  requireAnyFeaturePermission("canViewDbeGoals", "canManageDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const projectId = req.params.projectId;
    const targetOrg = superAdminTargetOrgId(req);
    const fetchRows = async () => {
      const conditions: SQL[] = [eq(projectDbeGoals.projectId, projectId)];
      if (!ctx.isSuperAdmin) conditions.push(eq(projectDbeGoals.organizationId, ctx.orgId!));
      else if (targetOrg) conditions.push(eq(projectDbeGoals.organizationId, targetOrg));
      return db.select().from(projectDbeGoals).where(and(...conditions));
    };
    const rows = ctx.isSuperAdmin
      ? await fetchRows()
      : await orgScopedCache(ctx.orgId!, KEY_DBE_GOALS(projectId), 60_000, fetchRows);
    res.json(rows);
  },
);

router.post(
  "/api/projects/:projectId/dbe-goals",
  requireAuth,
  requireFeaturePermission("canManageDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertProjectDbeGoalSchema, {
      ...req.body,
      projectId: req.params.projectId,
      organizationId: ctx.orgId,
      createdById: req.user!.id,
    }, res);
    if (!data) return;
    const [row] = await db.insert(projectDbeGoals).values(data).returning();
    cacheInvalidate(ctx.orgId!, KEY_DBE_GOALS(row.projectId));
    await eventBus.emit({
      version: 1,
      orgId: ctx.orgId!,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "dbe_goal.changed",
      payload: {
        goalId: row.id,
        projectId: row.projectId,
        certificationType: row.certificationType ?? null,
        goalPercent: row.goalPercent !== null && row.goalPercent !== undefined ? String(row.goalPercent) : null,
        actualPercent: row.actualPercent !== null && row.actualPercent !== undefined ? String(row.actualPercent) : null,
      },
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/api/projects/:projectId/dbe-goals/:id",
  requireAuth,
  requireFeaturePermission("canManageDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { id: _id, projectId: _pid, organizationId: _oid, createdById: _cb, createdAt: _ca, ...candidate } = req.body ?? {};
    const data = validateBody(insertProjectDbeGoalSchema.partial(), candidate, res);
    if (!data) return;
    const conditions: SQL[] = [
      eq(projectDbeGoals.id, req.params.id),
      eq(projectDbeGoals.projectId, req.params.projectId),
    ];
    if (!ctx.isSuperAdmin) conditions.push(eq(projectDbeGoals.organizationId, ctx.orgId!));
    const [row] = await db.update(projectDbeGoals).set(data).where(and(...conditions)).returning();
    if (!row) return res.status(404).json({ error: "DBE goal not found" });
    cacheInvalidate(row.organizationId, KEY_DBE_GOALS(row.projectId));
    await eventBus.emit({
      version: 1,
      orgId: row.organizationId,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "dbe_goal.changed",
      payload: {
        goalId: row.id,
        projectId: row.projectId,
        certificationType: row.certificationType ?? null,
        goalPercent: row.goalPercent !== null && row.goalPercent !== undefined ? String(row.goalPercent) : null,
        actualPercent: row.actualPercent !== null && row.actualPercent !== undefined ? String(row.actualPercent) : null,
      },
    });
    res.json(row);
  },
);

router.delete(
  "/api/projects/:projectId/dbe-goals/:id",
  requireAuth,
  requireFeaturePermission("canManageDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(projectDbeGoals.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(projectDbeGoals.organizationId, ctx.orgId!));
    const [deleted] = await db.delete(projectDbeGoals).where(and(...conditions)).returning();
    if (deleted) cacheInvalidate(deleted.organizationId, KEY_DBE_GOALS(deleted.projectId));
    res.status(204).end();
  },
);

// =========================
// CRM org certifications
// =========================
router.get("/api/crm/organisations/:crmOrgId/certifications", requireAuth, async (req: AuthRequest, res: Response) => {
  const ctx = requireOrgOwnership(req, res);
  if (!ctx) return;
  const targetOrg = superAdminTargetOrgId(req);
  const conditions: SQL[] = [eq(crmOrganisationCertifications.crmOrganisationId, req.params.crmOrgId)];
  if (!ctx.isSuperAdmin) conditions.push(eq(crmOrganisationCertifications.organizationId, ctx.orgId!));
  else if (targetOrg) conditions.push(eq(crmOrganisationCertifications.organizationId, targetOrg));
  const rows = await db.select().from(crmOrganisationCertifications).where(and(...conditions));
  res.json(rows);
});

router.post(
  "/api/crm/organisations/:crmOrgId/certifications",
  requireAuth,
  requireFeaturePermission("canCreateCRMContacts"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertCrmOrganisationCertificationSchema, {
      ...req.body,
      crmOrganisationId: req.params.crmOrgId,
      organizationId: ctx.orgId,
    }, res);
    if (!data) return;
    const [row] = await db.insert(crmOrganisationCertifications).values(data).returning();
    await eventBus.emit({
      version: 1,
      orgId: ctx.orgId!,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "crm_certification.created",
      payload: {
        certificationId: row.id,
        crmOrganisationId: row.crmOrganisationId,
        certificationType: row.certificationType,
        expirationDate: row.expirationDate ? String(row.expirationDate) : null,
      },
    });
    res.status(201).json(row);
  },
);

router.delete(
  "/api/crm/organisations/:crmOrgId/certifications/:id",
  requireAuth,
  requireFeaturePermission("canCreateCRMContacts"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(crmOrganisationCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(crmOrganisationCertifications.organizationId, ctx.orgId!));
    const [deleted] = await db.delete(crmOrganisationCertifications).where(and(...conditions)).returning();
    if (deleted) {
      await eventBus.emit({
        version: 1,
        orgId: deleted.organizationId,
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "crm_certification.deleted",
        payload: {
          certificationId: deleted.id,
          crmOrganisationId: deleted.crmOrganisationId,
          deletedBy: req.user!.id,
        },
      });
    }
    res.status(204).end();
  },
);

// =========================
// Surety Bonds
// =========================
router.get(
  "/api/surety-bonds",
  requireAuth,
  requireAnyFeaturePermission("canViewSuretyBonds", "canManageSuretyBonds"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const projectId = (req.query.projectId as string) || null;
    const targetOrg = superAdminTargetOrgId(req);
    const conditions: SQL[] = [];
    if (!ctx.isSuperAdmin) conditions.push(eq(suretyBonds.organizationId, ctx.orgId!));
    else if (targetOrg) conditions.push(eq(suretyBonds.organizationId, targetOrg));
    if (projectId) conditions.push(eq(suretyBonds.projectId, projectId));
    const rows = await db.select().from(suretyBonds)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(suretyBonds.createdAt));
    res.json(rows);
  },
);

router.post(
  "/api/surety-bonds",
  requireAuth,
  requireFeaturePermission("canManageSuretyBonds"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertSuretyBondSchema, {
      ...req.body,
      organizationId: ctx.orgId,
      createdById: req.user!.id,
    }, res);
    if (!data) return;
    const [row] = await db.insert(suretyBonds).values(data).returning();
    await eventBus.emit({
      version: 1,
      orgId: ctx.orgId!,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "surety_bond.created",
      payload: {
        bondId: row.id,
        projectId: row.projectId ?? null,
        bondType: row.bondType ?? null,
        bondAmount: row.bondAmount !== null && row.bondAmount !== undefined ? String(row.bondAmount) : null,
      },
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/api/surety-bonds/:id",
  requireAuth,
  requireFeaturePermission("canManageSuretyBonds"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { id: _id, organizationId: _o, createdAt: _c, createdById: _cb, ...patch } = req.body || {};
    const conditions: SQL[] = [eq(suretyBonds.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(suretyBonds.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(suretyBonds).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const [row] = await db.update(suretyBonds).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    if (patch.status && patch.status !== prev.status) {
      if (patch.status === "EXPIRED") {
        await eventBus.emit({
          version: 1,
          orgId: row.organizationId,
          actorId: req.user!.id,
          timestamp: new Date(),
          type: "surety_bond.expired",
          payload: {
            bondId: row.id,
            projectId: row.projectId ?? null,
            expirationDate: row.expirationDate ? String(row.expirationDate) : null,
          },
        });
      } else if (patch.status === "RELEASED") {
        await eventBus.emit({
          version: 1,
          orgId: row.organizationId,
          actorId: req.user!.id,
          timestamp: new Date(),
          type: "surety_bond.released",
          payload: {
            bondId: row.id,
            projectId: row.projectId ?? null,
            releasedBy: req.user!.id,
          },
        });
      }
    }
    res.json(row);
  },
);

router.delete(
  "/api/surety-bonds/:id",
  requireAuth,
  requireFeaturePermission("canManageSuretyBonds"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(suretyBonds.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(suretyBonds.organizationId, ctx.orgId!));
    await db.delete(suretyBonds).where(and(...conditions));
    res.status(204).end();
  },
);

// =========================
// Haul Tickets
// =========================
router.get(
  "/api/haul-tickets",
  requireAuth,
  requireAnyFeaturePermission("canViewHaulTickets", "canManageHaulTickets", "canApproveHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const projectId = (req.query.projectId as string) || null;
    const targetOrg = superAdminTargetOrgId(req);
    const conditions: SQL[] = [];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    else if (targetOrg) conditions.push(eq(haulTickets.organizationId, targetOrg));
    if (projectId) conditions.push(eq(haulTickets.projectId, projectId));
    const rows = await db.select().from(haulTickets)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(haulTickets.ticketDate))
      .limit(500);
    res.json(rows);
  },
);

router.post(
  "/api/haul-tickets",
  requireAuth,
  requireFeaturePermission("canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertHaulTicketSchema, {
      ...req.body,
      organizationId: ctx.orgId,
      recordedById: req.user!.id,
    }, res);
    if (!data) return;
    const [row] = await db.insert(haulTickets).values(data).returning();
    await eventBus.emit({
      version: 1,
      orgId: ctx.orgId!,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "haul_ticket.created",
      payload: {
        ticketId: row.id,
        projectId: row.projectId ?? null,
        materialClass: row.materialClass ?? null,
        quantity: row.quantity !== null && row.quantity !== undefined ? String(row.quantity) : null,
        unit: row.unit ?? null,
      },
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/api/haul-tickets/:id",
  requireAuth,
  requireAnyFeaturePermission("canManageHaulTickets", "canApproveHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { id: _id, organizationId: _o, createdAt: _c, recordedById: _r, ...rawPatch } = req.body || {};
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));

    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });

    // Field-level authz: approve-only users (no manage) may change status/notes only.
    const canManage = await userHasManagePermission(req, "canManageHaulTickets");
    const patch = canManage
      ? rawPatch
      : pickAllowedFields(rawPatch, ["status", "notes"] as const).picked;
    if (!canManage && Object.keys(patch).length === 0) {
      return res.status(403).json({ error: "Approval-only role may modify status/notes only" });
    }

    if (patch.status === "APPROVED" && prev.status !== "APPROVED") {
      const approver = await userHasApprovalPermission(req, ["ADMIN", "MANAGER"], "canApproveHaulTickets");
      if (!approver) return res.status(403).json({ error: "Approval permission required" });
    }

    const [row] = await db.update(haulTickets).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    if (patch.status && patch.status !== prev.status) {
      if (patch.status === "APPROVED") {
        await eventBus.emit({
          version: 1,
          orgId: row.organizationId,
          actorId: req.user!.id,
          timestamp: new Date(),
          type: "haul_ticket.approved",
          payload: {
            ticketId: row.id,
            projectId: row.projectId ?? null,
            approvedBy: req.user!.id,
            totalCost: row.totalCost !== null && row.totalCost !== undefined ? String(row.totalCost) : null,
          },
        });
      } else if (patch.status === "VOIDED") {
        await eventBus.emit({
          version: 1,
          orgId: row.organizationId,
          actorId: req.user!.id,
          timestamp: new Date(),
          type: "haul_ticket.voided",
          payload: {
            ticketId: row.id,
            projectId: row.projectId ?? null,
            voidedBy: req.user!.id,
            reason: typeof patch.notes === "string" ? patch.notes : null,
          },
        });
      } else if (patch.status === "REJECTED") {
        await eventBus.emit({
          version: 1,
          orgId: row.organizationId,
          actorId: req.user!.id,
          timestamp: new Date(),
          type: "haul_ticket.rejected",
          payload: {
            ticketId: row.id,
            projectId: row.projectId ?? null,
            rejectedBy: req.user!.id,
            reason: typeof patch.notes === "string" ? patch.notes : null,
          },
        });
      }
    }
    res.json(row);
  },
);

router.delete(
  "/api/haul-tickets/:id",
  requireAuth,
  requireFeaturePermission("canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    await db.delete(haulTickets).where(and(...conditions));
    res.status(204).end();
  },
);

// Aggregate haul reconciliation: planned vs actual by material class
router.get(
  "/api/projects/:projectId/haul-reconciliation",
  requireAuth,
  requireAnyFeaturePermission("canViewHaulTickets", "canManageHaulTickets", "canApproveHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const targetOrg = superAdminTargetOrgId(req);
    const orgFilter = ctx.isSuperAdmin
      ? (targetOrg ? sql`organization_id = ${targetOrg}` : sql`TRUE`)
      : sql`organization_id = ${ctx.orgId}`;
    const rows = await db.execute(sql`
      SELECT material_class, SUM(quantity) AS total_quantity, SUM(total_cost) AS total_cost, unit
      FROM haul_tickets
      WHERE project_id = ${req.params.projectId} AND ${orgFilter}
      GROUP BY material_class, unit
      ORDER BY material_class
    `);
    res.json(rows.rows);
  },
);

// =========================
// Daily Inspector Reports
// =========================
router.get(
  "/api/daily-inspector-reports",
  requireAuth,
  requireAnyFeaturePermission(
    "canViewInspectorReports", "canSubmitInspectorReports",
    "canManageInspectorReports", "canApproveInspectorReports",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const projectId = (req.query.projectId as string) || null;
    const targetOrg = superAdminTargetOrgId(req);
    const conditions: SQL[] = [];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    else if (targetOrg) conditions.push(eq(dailyInspectorReports.organizationId, targetOrg));
    if (projectId) conditions.push(eq(dailyInspectorReports.projectId, projectId));
    const rows = await db.select().from(dailyInspectorReports)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(dailyInspectorReports.reportDate))
      .limit(200);
    res.json(rows);
  },
);

router.post(
  "/api/daily-inspector-reports",
  requireAuth,
  requireAnyFeaturePermission(
    "canSubmitInspectorReports",
    "canManageInspectorReports",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertDailyInspectorReportSchema, {
      ...req.body,
      organizationId: ctx.orgId,
      inspectorId: req.body?.inspectorId ?? req.user!.id,
    }, res);
    if (!data) return;
    const [row] = await db.insert(dailyInspectorReports).values(data).returning();
    await eventBus.emit({
      version: 1,
      orgId: ctx.orgId!,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "daily_inspector_report.submitted",
      payload: {
        reportId: row.id,
        projectId: row.projectId,
        reportDate: String(row.reportDate),
        inspectorId: row.inspectorId,
      },
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/api/daily-inspector-reports/:id",
  requireAuth,
  requireAnyFeaturePermission(
    "canManageInspectorReports",
    "canApproveInspectorReports",
    "canSubmitInspectorReports",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { id: _id, organizationId: _o, createdAt: _c, ...rawPatch } = req.body || {};
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));

    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });

    // Field-level authz:
    //  - manage: full edit
    //  - submit: may edit own DRAFT report fields, never status->APPROVED
    //  - approve-only: may change status/approval notes only
    const canManage = await userHasManagePermission(req, "canManageInspectorReports");
    const canSubmit = await userHasManagePermission(req, "canSubmitInspectorReports");
    type IdrPatch = Partial<typeof dailyInspectorReports.$inferInsert>;
    let patch: IdrPatch;
    if (canManage) {
      patch = rawPatch as IdrPatch;
    } else if (canSubmit && prev.inspectorId === req.user!.id && prev.status !== "APPROVED") {
      const { status: _s, approvedById: _ab, approvedAt: _aa, ...rest } = rawPatch as IdrPatch & Record<string, unknown>;
      patch = rest as IdrPatch;
    } else {
      patch = pickAllowedFields(rawPatch as Record<string, unknown>, ["status", "notes"] as const).picked as IdrPatch;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(403).json({ error: "No fields permitted for your role" });
    }

    if (patch.status === "APPROVED" && prev.status !== "APPROVED") {
      const approver = await userHasApprovalPermission(req, ["ADMIN", "MANAGER"], "canApproveInspectorReports");
      if (!approver) return res.status(403).json({ error: "Approval permission required" });
    }

    const [row] = await db.update(dailyInspectorReports).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    if (patch.status === "APPROVED" && prev.status !== "APPROVED") {
      await eventBus.emit({
        version: 1,
        orgId: row.organizationId,
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "daily_inspector_report.approved",
        payload: {
          reportId: row.id,
          projectId: row.projectId,
          approvedBy: req.user!.id,
        },
      });
    }
    res.json(row);
  },
);

router.delete(
  "/api/daily-inspector-reports/:id",
  requireAuth,
  requireFeaturePermission("canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    await db.delete(dailyInspectorReports).where(and(...conditions));
    res.status(204).end();
  },
);

// =========================
// SWPPP Inspections
// =========================
router.get(
  "/api/swppp-inspections",
  requireAuth,
  requireAnyFeaturePermission("canViewSwppp", "canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
  const ctx = requireOrgOwnership(req, res);
  if (!ctx) return;
  const projectId = (req.query.projectId as string) || null;
  const targetOrg = superAdminTargetOrgId(req);
  const conditions: SQL[] = [];
  if (!ctx.isSuperAdmin) conditions.push(eq(swpppInspections.organizationId, ctx.orgId!));
  else if (targetOrg) conditions.push(eq(swpppInspections.organizationId, targetOrg));
  if (projectId) conditions.push(eq(swpppInspections.projectId, projectId));
  const rows = await db.select().from(swpppInspections)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(swpppInspections.inspectionDate))
    .limit(200);
  res.json(rows);
  },
);

router.post(
  "/api/swppp-inspections",
  requireAuth,
  requireFeaturePermission("canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertSwpppInspectionSchema, {
      ...req.body,
      organizationId: ctx.orgId,
      createdById: req.user!.id,
    }, res);
    if (!data) return;
    const [row] = await db.insert(swpppInspections).values(data).returning();
    await eventBus.emit({
      version: 1,
      orgId: ctx.orgId!,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "swppp_inspection.submitted",
      payload: {
        inspectionId: row.id,
        projectId: row.projectId,
        inspectionDate: String(row.inspectionDate),
        deficienciesFound: Boolean(row.deficienciesFound && row.deficienciesFound.trim().length > 0),
      },
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/api/swppp-inspections/:id",
  requireAuth,
  requireFeaturePermission("canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { id: _id, organizationId: _o, createdAt: _c, createdById: _cb, ...patch } = req.body || {};
    const conditions: SQL[] = [eq(swpppInspections.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(swpppInspections.organizationId, ctx.orgId!));
    const [row] = await db.update(swpppInspections).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  },
);

router.delete(
  "/api/swppp-inspections/:id",
  requireAuth,
  requireFeaturePermission("canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(swpppInspections.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(swpppInspections.organizationId, ctx.orgId!));
    await db.delete(swpppInspections).where(and(...conditions));
    res.status(204).end();
  },
);

// =========================
// Material Certifications (Buy America)
// =========================
router.get(
  "/api/material-certifications",
  requireAuth,
  requireAnyFeaturePermission(
    "canViewMaterialCertifications",
    "canManageMaterialCertifications",
    "canVerifyMaterialCertifications",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const projectId = (req.query.projectId as string) || null;
    const targetOrg = superAdminTargetOrgId(req);
    const conditions: SQL[] = [];
    if (!ctx.isSuperAdmin) conditions.push(eq(materialCertifications.organizationId, ctx.orgId!));
    else if (targetOrg) conditions.push(eq(materialCertifications.organizationId, targetOrg));
    if (projectId) conditions.push(eq(materialCertifications.projectId, projectId));
    const rows = await db.select().from(materialCertifications)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(materialCertifications.createdAt))
      .limit(500);
    res.json(rows);
  },
);

router.post(
  "/api/material-certifications",
  requireAuth,
  requireFeaturePermission("canManageMaterialCertifications"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx || ctx.isSuperAdmin) {
      if (ctx?.isSuperAdmin) return res.status(400).json({ error: "Provide an organization context" });
      return;
    }
    const data = validateBody(insertMaterialCertificationSchema, {
      ...req.body,
      organizationId: ctx.orgId,
    }, res);
    if (!data) return;
    const [row] = await db.insert(materialCertifications).values(data).returning();
    await eventBus.emit({
      version: 1,
      orgId: ctx.orgId!,
      actorId: req.user!.id,
      timestamp: new Date(),
      type: "material_certification.uploaded",
      payload: {
        certificationId: row.id,
        projectId: row.projectId ?? null,
        materialType: row.materialDescription ?? null,
        isBuyAmericaCompliant: row.buyAmericaStatus === "COMPLIANT" ? true : row.buyAmericaStatus === "NON_COMPLIANT" ? false : null,
      },
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/api/material-certifications/:id",
  requireAuth,
  requireAnyFeaturePermission(
    "canManageMaterialCertifications",
    "canVerifyMaterialCertifications",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { id: _id, organizationId: _o, createdAt: _c, ...rawPatch } = req.body || {};
    const conditions: SQL[] = [eq(materialCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(materialCertifications.organizationId, ctx.orgId!));

    const [prev] = await db.select().from(materialCertifications).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });

    // Field-level authz: verify-only users may only set verification fields and Buy America status.
    const canManage = await userHasManagePermission(req, "canManageMaterialCertifications");
    const patch = canManage
      ? rawPatch
      : pickAllowedFields(rawPatch, ["verifiedAt", "verifiedById", "buyAmericaStatus", "verificationNotes"] as const).picked;
    if (!canManage && Object.keys(patch).length === 0) {
      return res.status(403).json({ error: "Verify-only role may modify verification fields only" });
    }

    const wasVerified = Boolean(prev.verifiedAt || prev.verifiedById);
    const willBeVerified = Boolean(
      (patch.verifiedAt ?? prev.verifiedAt) || (patch.verifiedById ?? prev.verifiedById),
    );
    if (!wasVerified && willBeVerified) {
      const verifier = await userHasApprovalPermission(req, ["ADMIN", "MANAGER"], "canVerifyMaterialCertifications");
      if (!verifier) return res.status(403).json({ error: "Verification permission required" });
    }

    const [row] = await db.update(materialCertifications).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    const isVerifiedNow = Boolean(row.verifiedAt || row.verifiedById);
    if (!wasVerified && isVerifiedNow) {
      const baStatus = row.buyAmericaStatus;
      const isCompliant = baStatus === "COMPLIANT" ? true : baStatus === "NON_COMPLIANT" ? false : null;
      await eventBus.emit({
        version: 1,
        orgId: row.organizationId,
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "material_certification.verified",
        payload: {
          certificationId: row.id,
          projectId: row.projectId ?? null,
          verifiedBy: req.user!.id,
          isCompliant,
        },
      });
    }
    res.json(row);
  },
);

router.delete(
  "/api/material-certifications/:id",
  requireAuth,
  requireFeaturePermission("canManageMaterialCertifications"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(materialCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(materialCertifications.organizationId, ctx.orgId!));
    await db.delete(materialCertifications).where(and(...conditions));
    res.status(204).end();
  },
);

export default router;
