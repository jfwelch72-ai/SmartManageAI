import express, { Router, type Response } from "express";
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
import { logAudit } from "./auditLogger";
import { isFeatureEnabled } from "./services/featureFlagService";
import * as workflowEngine from "./services/workflowEngine";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
import type { FeatureFlagKey } from "@shared/schema";
import { exportLimiter } from "./rateLimiter";

// Org-scoped feature-flag gate. SUPER_ADMIN bypasses (platform support); orgs
// with the flag disabled get a clean 403 server-side regardless of UI gating.
function requireOrgFeatureFlag(flag: FeatureFlagKey) {
  return async (req: AuthRequest, res: Response, next: () => void): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: "Authentication required" }); return; }
    if (req.user.role === "SUPER_ADMIN") { next(); return; }
    if (!req.user.organizationId) { res.status(403).json({ error: "Organization required" }); return; }
    const enabled = await isFeatureEnabled(req.user.organizationId, flag);
    if (!enabled) {
      res.status(403).json({ error: `Feature disabled: ${flag}`, featureFlag: flag, upgradeRequired: true });
      return;
    }
    next();
  };
}

async function dotAudit(
  req: AuthRequest,
  action: "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "REJECT" | "SUBMIT" | "ACTIVATE",
  entityType: string,
  entityId: string,
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  if (!req.user) return;
  await logAudit({
    userId: req.user.id,
    entityType,
    entityId,
    action,
    oldValue: oldValue ? JSON.stringify(oldValue) : null,
    newValue: newValue ? JSON.stringify(newValue) : null,
  }, req);
}

const router = Router();

// =========================
// Feature-flag gates (org-scoped). SUPER_ADMIN bypasses for support.
// All DOT/heavy-civil routes require their corresponding feature flag to be
// enabled on the organization or return 403 with a clear "Feature disabled" error.
// =========================
router.use("/api/dot", requireAuth, requireOrgFeatureFlag("DOT_PAY_ITEMS"));
router.use("/api/projects/:projectId/dbe-goals", requireAuth, requireOrgFeatureFlag("DBE_TRACKING"));
router.use("/api/crm/organisations/:crmOrgId/certifications", requireAuth, requireOrgFeatureFlag("DBE_TRACKING"));
router.use("/api/surety-bonds", requireAuth, requireOrgFeatureFlag("SURETY_BONDS"));
router.use("/api/haul-tickets", requireAuth, requireOrgFeatureFlag("HAUL_TICKETS"));
router.use("/api/projects/:projectId/haul-reconciliation", requireAuth, requireOrgFeatureFlag("HAUL_TICKETS"));
router.use("/api/daily-inspector-reports", requireAuth, requireOrgFeatureFlag("DAILY_INSPECTOR_REPORTS"));
router.use("/api/swppp-inspections", requireAuth, requireOrgFeatureFlag("SWPPP_INSPECTIONS"));
router.use("/api/material-certifications", requireAuth, requireOrgFeatureFlag("BUY_AMERICA"));

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
  await dotAudit(req, "CREATE", "dot_agency", row.id, null, row);
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
  await dotAudit(req, "CREATE", "dot_spec_book", row.id, null, row);
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

const BULK_UPLOAD_MAX_ITEMS = 5000;
const BULK_UPLOAD_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const bulkUploadSchema = z.object({
  specBookId: z.string(),
  items: z.array(z.object({
    itemNumber: z.string().min(1).max(64),
    description: z.string().min(1).max(2000),
    unit: z.string().min(1).max(32),
    specSection: z.string().max(64).optional().nullable(),
    category: z.string().max(128).optional().nullable(),
  })).min(1).max(BULK_UPLOAD_MAX_ITEMS),
});
function bulkUploadBodySize(req: AuthRequest, res: Response, next: () => void): void {
  const raw = req.headers["content-length"];
  if (raw === undefined || raw === "") {
    res.status(411).json({ error: "Content-Length header required for bulk upload" });
    return;
  }
  const len = Number(raw);
  if (!Number.isFinite(len) || len < 0) {
    res.status(400).json({ error: "Invalid Content-Length header" });
    return;
  }
  if (len > BULK_UPLOAD_MAX_BYTES) {
    res.status(413).json({ error: `Bulk upload exceeds ${BULK_UPLOAD_MAX_BYTES} bytes` });
    return;
  }
  next();
}
// Per-route JSON parser with explicit byte limit; runs after the Content-Length
// check so chunked/missing-length requests can't bypass the cap.
const bulkUploadJsonParser = express.json({ limit: BULK_UPLOAD_MAX_BYTES });
router.post("/api/dot/pay-items/bulk-upload", requireAuth, requireRole("SUPER_ADMIN"), exportLimiter, bulkUploadBodySize, bulkUploadJsonParser, async (req: AuthRequest, res: Response) => {
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
  await dotAudit(req, "CREATE", "dot_pay_items_bulk_upload", data.specBookId, null, { specBookId: data.specBookId, inserted, skipped, total: data.items.length });
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
      await dotAudit(req, "CREATE", "organization_dot_preference", row.id, null, row);
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
    const [deleted] = await db.delete(organizationDotPreferences).where(and(...conditions)).returning();
    if (!ctx.isSuperAdmin) cacheInvalidate(ctx.orgId!, KEY_ORG_PREFS);
    if (deleted) await dotAudit(req, "DELETE", "organization_dot_preference", deleted.id, deleted, null);
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
    await dotAudit(req, "CREATE", "dot_pay_item_override", row.id, null, row);
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
    await dotAudit(req, "CREATE", "project_dbe_goal", row.id, null, row);
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
    const [existing] = await db.select().from(projectDbeGoals).where(and(...conditions));
    const [row] = await db.update(projectDbeGoals).set(data).where(and(...conditions)).returning();
    if (!row) return res.status(404).json({ error: "DBE goal not found" });
    cacheInvalidate(row.organizationId, KEY_DBE_GOALS(row.projectId));
    await dotAudit(req, "UPDATE", "project_dbe_goal", row.id, existing ?? null, row);
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
    if (deleted) {
      cacheInvalidate(deleted.organizationId, KEY_DBE_GOALS(deleted.projectId));
      await dotAudit(req, "DELETE", "project_dbe_goal", deleted.id, deleted, null);
    }
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
    await dotAudit(req, "CREATE", "crm_organisation_certification", row.id, null, row);
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
      await dotAudit(req, "DELETE", "crm_organisation_certification", deleted.id, deleted, null);
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
    await dotAudit(req, "CREATE", "surety_bond", row.id, null, row);
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
    const { id: _id, organizationId: _o, createdAt: _c, createdById: _cb, ...rawPatch } = req.body || {};
    // Lifecycle status transitions must go through the workflow-aware
    // /activate (and future /release, /claim) endpoints to honor any
    // configured workflow template. Strip status here to prevent bypass.
    const { status: _status, ...patch } = rawPatch;
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
    await dotAudit(req, "UPDATE", "surety_bond", row.id, prev, row);
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
    const [deleted] = await db.delete(suretyBonds).where(and(...conditions)).returning();
    if (deleted) await dotAudit(req, "DELETE", "surety_bond", deleted.id, deleted, null);
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
    await dotAudit(req, "CREATE", "haul_ticket", row.id, null, row);
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
    const { id: _id, organizationId: _o, createdAt: _c, recordedById: _r, status: _status, ...rawPatch } = req.body || {};
    // Lifecycle status transitions (SUBMITTED/APPROVED/REJECTED) must go
    // through workflow-aware /submit, /approve, /reject endpoints to honor
    // approval templates. Status is stripped above to prevent bypass.
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));

    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });

    // Field-level authz: approve-only users (no manage) may change notes only here;
    // they must use the dedicated /approve or /reject endpoints for status changes.
    const canManage = await userHasManagePermission(req, "canManageHaulTickets");
    const patch = canManage
      ? rawPatch
      : pickAllowedFields(rawPatch, ["notes"] as const).picked;
    if (!canManage && Object.keys(patch).length === 0) {
      return res.status(403).json({ error: "Approval-only role must use /approve or /reject endpoints for status changes" });
    }

    const [row] = await db.update(haulTickets).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    await dotAudit(req, "UPDATE", "haul_ticket", row.id, prev, row);
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
    const [deleted] = await db.delete(haulTickets).where(and(...conditions)).returning();
    if (deleted) await dotAudit(req, "DELETE", "haul_ticket", deleted.id, deleted, null);
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
    await dotAudit(req, "CREATE", "daily_inspector_report", row.id, null, row);
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
    const { id: _id, organizationId: _o, createdAt: _c, status: _status, approvedById: _ab, approvedAt: _aa, submittedAt: _sa, ...rawPatch } = req.body || {};
    // Lifecycle status transitions (SUBMITTED/APPROVED/REJECTED) and
    // submission/approval timestamps must go through workflow-aware
    // /submit, /approve, /reject, /request-revision endpoints.
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));

    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });

    // Field-level authz: submit role may edit own DRAFT report content;
    // manage role may edit all content. Approve-only role has no content edit.
    const canManage = await userHasManagePermission(req, "canManageInspectorReports");
    const canSubmit = await userHasManagePermission(req, "canSubmitInspectorReports");
    type IdrPatch = Partial<typeof dailyInspectorReports.$inferInsert>;
    let patch: IdrPatch;
    if (canManage) {
      patch = rawPatch as IdrPatch;
    } else if (canSubmit && prev.inspectorId === req.user!.id && prev.status === "DRAFT") {
      patch = rawPatch as IdrPatch;
    } else {
      return res.status(403).json({ error: "Use /submit, /approve, /reject, or /request-revision endpoints for status changes" });
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const [row] = await db.update(dailyInspectorReports).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    await dotAudit(req, "UPDATE", "daily_inspector_report", row.id, prev, row);
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
    const [deleted] = await db.delete(dailyInspectorReports).where(and(...conditions)).returning();
    if (deleted) await dotAudit(req, "DELETE", "daily_inspector_report", deleted.id, deleted, null);
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
    await dotAudit(req, "CREATE", "swppp_inspection", row.id, null, row);
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
    const [prev] = await db.select().from(swpppInspections).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const [row] = await db.update(swpppInspections).set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await dotAudit(req, "UPDATE", "swppp_inspection", row.id, prev, row);
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
    const [deleted] = await db.delete(swpppInspections).where(and(...conditions)).returning();
    if (deleted) await dotAudit(req, "DELETE", "swppp_inspection", deleted.id, deleted, null);
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
    await dotAudit(req, "CREATE", "material_certification", row.id, null, row);
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
    const {
      id: _id, organizationId: _o, createdAt: _c,
      verifiedAt: _va, verifiedById: _vb, buyAmericaStatus: _ba,
      ...rawPatch
    } = req.body || {};
    // Verification lifecycle (verifiedAt/verifiedById/buyAmericaStatus) must
    // go through workflow-aware /submit, /verify (alias /approve), /reject
    // endpoints to honor approval templates.
    const conditions: SQL[] = [eq(materialCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(materialCertifications.organizationId, ctx.orgId!));

    const [prev] = await db.select().from(materialCertifications).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });

    // Field-level authz: only manage role may edit content here.
    const canManage = await userHasManagePermission(req, "canManageMaterialCertifications");
    if (!canManage) {
      return res.status(403).json({ error: "Use /submit, /verify (or /approve), or /reject endpoints for verification changes" });
    }
    if (Object.keys(rawPatch).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const [row] = await db.update(materialCertifications).set({ ...rawPatch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    await dotAudit(req, "UPDATE", "material_certification", row.id, prev, row);
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
    const [deleted] = await db.delete(materialCertifications).where(and(...conditions)).returning();
    if (deleted) await dotAudit(req, "DELETE", "material_certification", deleted.id, deleted, null);
    res.status(204).end();
  },
);

// =========================
// Heavy-civil approval transition endpoints (workflow-aware)
// Pattern: call workflowEngine.delegateEntityTransition. If delegated:
//   - needsMoreApprovals → return without status update (workflow gates the rest)
//   - success === false  → return error (workflow rejected)
//   - success === true   → fall through to direct update + notify (terminal stage)
// If not delegated → fall through to direct update + notify (no workflow configured).
// Always emits a domain event + audits.
// =========================

type DelegationResult = Awaited<ReturnType<typeof workflowEngine.delegateEntityTransition>>;

function handleDelegationGate(res: Response, delegation: DelegationResult, prev: any): boolean {
  if (!delegation.delegated) return false;
  if (delegation.needsMoreApprovals) {
    res.json({ ...prev, workflow: delegation, message: "Approval recorded; more approvals required" });
    return true;
  }
  if (delegation.success === false) {
    res.status(400).json({
      error: delegation.error || "Workflow rejected the transition",
      workflow: delegation,
    });
    return true;
  }
  return false;
}

// ---- Haul Tickets ----
router.post(
  "/api/haul-tickets/:id/submit",
  requireAuth,
  requireFeaturePermission("canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "HAUL_TICKET", prev.id, req.user!.id, role, "SUBMITTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(haulTickets)
      .set({ status: "SUBMITTED" as any, updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "haul_ticket.submitted",
      payload: { haulTicketId: row.id, projectId: row.projectId, ticketNumber: row.ticketNumber },
    });
    if (!delegation.delegated) {
      await notifyApprovers(orgId, req.user!.id, {
        type: "HAUL_TICKET_SUBMITTED",
        title: "Haul Ticket Submitted",
        message: `Haul ticket ${row.ticketNumber} submitted for approval`,
        relatedEntityType: "HAUL_TICKET", relatedEntityId: row.id,
      });
    }
    await dotAudit(req, "SUBMIT", "haul_ticket", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

router.post(
  "/api/haul-tickets/:id/approve",
  requireAuth,
  requireFeaturePermission("canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "HAUL_TICKET", prev.id, req.user!.id, role, "APPROVED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(haulTickets)
      .set({ status: "APPROVED" as any, approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "haul_ticket.approved",
      payload: { haulTicketId: row.id, projectId: row.projectId, ticketNumber: row.ticketNumber },
    });
    if (prev.recordedById) {
      await notifySubmitter(prev.recordedById, {
        type: "HAUL_TICKET_APPROVED",
        title: "Haul Ticket Approved",
        message: `Haul ticket ${row.ticketNumber} was approved`,
        relatedEntityType: "HAUL_TICKET", relatedEntityId: row.id,
      }, orgId);
    }
    await dotAudit(req, "APPROVE", "haul_ticket", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

router.post(
  "/api/haul-tickets/:id/reject",
  requireAuth,
  requireFeaturePermission("canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "HAUL_TICKET", prev.id, req.user!.id, role, "REJECTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(haulTickets)
      .set({ status: "REJECTED" as any, updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "haul_ticket.rejected",
      payload: { haulTicketId: row.id, projectId: row.projectId, ticketNumber: row.ticketNumber, reason: req.body?.notes ?? null },
    });
    if (prev.recordedById) {
      await notifySubmitter(prev.recordedById, {
        type: "HAUL_TICKET_REJECTED",
        title: "Haul Ticket Rejected",
        message: `Haul ticket ${row.ticketNumber} was rejected${req.body?.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityType: "HAUL_TICKET", relatedEntityId: row.id,
      }, orgId);
    }
    await dotAudit(req, "REJECT", "haul_ticket", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

// ---- Daily Inspector Reports ----
router.post(
  "/api/daily-inspector-reports/:id/submit",
  requireAuth,
  requireFeaturePermission("canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "INSPECTOR_REPORT", prev.id, req.user!.id, role, "SUBMITTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(dailyInspectorReports)
      .set({ status: "SUBMITTED" as any, submittedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "inspector_report.submitted",
      payload: { reportId: row.id, projectId: row.projectId, reportDate: String(row.reportDate) },
    });
    if (!delegation.delegated) {
      await notifyApprovers(orgId, req.user!.id, {
        type: "INSPECTOR_REPORT_SUBMITTED",
        title: "Daily Inspector Report Submitted",
        message: `IDR for ${row.reportDate} submitted for approval`,
        relatedEntityType: "INSPECTOR_REPORT", relatedEntityId: row.id,
      });
    }
    await dotAudit(req, "SUBMIT", "daily_inspector_report", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

router.post(
  "/api/daily-inspector-reports/:id/approve",
  requireAuth,
  requireFeaturePermission("canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "INSPECTOR_REPORT", prev.id, req.user!.id, role, "APPROVED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(dailyInspectorReports)
      .set({ status: "APPROVED" as any, approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "inspector_report.approved",
      payload: { reportId: row.id, projectId: row.projectId, reportDate: String(row.reportDate) },
    });
    if (prev.inspectorId) {
      await notifySubmitter(prev.inspectorId, {
        type: "INSPECTOR_REPORT_APPROVED",
        title: "Daily Inspector Report Approved",
        message: `Your IDR for ${row.reportDate} was approved`,
        relatedEntityType: "INSPECTOR_REPORT", relatedEntityId: row.id,
      }, orgId);
    }
    await dotAudit(req, "APPROVE", "daily_inspector_report", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

router.post(
  "/api/daily-inspector-reports/:id/reject",
  requireAuth,
  requireFeaturePermission("canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "INSPECTOR_REPORT", prev.id, req.user!.id, role, "REJECTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(dailyInspectorReports)
      .set({ status: "REJECTED" as any, updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "inspector_report.rejected",
      payload: { reportId: row.id, projectId: row.projectId, reportDate: String(row.reportDate), reason: req.body?.notes ?? null },
    });
    if (prev.inspectorId) {
      await notifySubmitter(prev.inspectorId, {
        type: "INSPECTOR_REPORT_REVISION_REQUESTED",
        title: "Daily Inspector Report Rejected",
        message: `Your IDR for ${row.reportDate} was rejected${req.body?.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityType: "INSPECTOR_REPORT", relatedEntityId: row.id,
      }, orgId);
    }
    await dotAudit(req, "REJECT", "daily_inspector_report", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

router.post(
  "/api/daily-inspector-reports/:id/request-revision",
  requireAuth,
  requireFeaturePermission("canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const [row] = await db.update(dailyInspectorReports)
      .set({ status: "DRAFT" as any, submittedAt: null, updatedAt: new Date() })
      .where(and(...conditions)).returning();
    if (prev.inspectorId) {
      await notifySubmitter(prev.inspectorId, {
        type: "INSPECTOR_REPORT_REVISION_REQUESTED",
        title: "Daily Inspector Report Revision Requested",
        message: `Revisions requested on IDR for ${row.reportDate}${req.body?.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityType: "INSPECTOR_REPORT", relatedEntityId: row.id,
      }, orgId);
    }
    await dotAudit(req, "UPDATE", "daily_inspector_report", row.id, prev, row);
    res.json(row);
  },
);

// ---- Material Certifications ----
router.post(
  "/api/material-certifications/:id/submit",
  requireAuth,
  requireFeaturePermission("canManageMaterialCertifications"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(materialCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(materialCertifications.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(materialCertifications).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "MATERIAL_CERT", prev.id, req.user!.id, role, "SUBMITTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    await notifyApprovers(orgId, req.user!.id, {
      type: "MATERIAL_CERT_SUBMITTED",
      title: "Material Certification Submitted",
      message: `${prev.materialDescription} submitted for verification`,
      relatedEntityType: "MATERIAL_CERT", relatedEntityId: prev.id,
    });
    await dotAudit(req, "SUBMIT", "material_certification", prev.id, prev, prev);
    res.json({ ...prev, workflow: delegation });
  },
);

router.post(
  ["/api/material-certifications/:id/verify", "/api/material-certifications/:id/approve"],
  requireAuth,
  requireAnyFeaturePermission(
    "canManageMaterialCertifications",
    "canVerifyMaterialCertifications",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const verifier = await userHasApprovalPermission(req, ["ADMIN", "MANAGER"], "canVerifyMaterialCertifications");
    if (!verifier) return res.status(403).json({ error: "Verification permission required" });
    const conditions: SQL[] = [eq(materialCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(materialCertifications.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(materialCertifications).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const buyAmericaStatus = (req.body?.buyAmericaStatus as "VERIFIED" | "NON_COMPLIANT" | "WAIVER_GRANTED") ?? "VERIFIED";
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "MATERIAL_CERT", prev.id, req.user!.id, role, "VERIFIED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(materialCertifications)
      .set({
        verifiedById: req.user!.id, verifiedAt: new Date(),
        buyAmericaStatus: buyAmericaStatus as any, updatedAt: new Date(),
      })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "material_certification.verified",
      payload: {
        certificationId: row.id, projectId: row.projectId ?? null,
        verifiedBy: req.user!.id,
        isCompliant: buyAmericaStatus === "VERIFIED" ? true : buyAmericaStatus === "NON_COMPLIANT" ? false : null,
      },
    });
    await notifyApprovers(orgId, req.user!.id, {
      type: "MATERIAL_CERT_VERIFIED",
      title: "Material Certification Verified",
      message: `${row.materialDescription} verified (${buyAmericaStatus})`,
      relatedEntityType: "MATERIAL_CERT", relatedEntityId: row.id,
    });
    await dotAudit(req, "APPROVE", "material_certification", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

router.post(
  "/api/material-certifications/:id/reject",
  requireAuth,
  requireAnyFeaturePermission(
    "canManageMaterialCertifications",
    "canVerifyMaterialCertifications",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(materialCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(materialCertifications.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(materialCertifications).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "MATERIAL_CERT", prev.id, req.user!.id, role, "REJECTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(materialCertifications)
      .set({ buyAmericaStatus: "NON_COMPLIANT" as any, updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await notifyApprovers(orgId, req.user!.id, {
      type: "MATERIAL_CERT_REJECTED",
      title: "Material Certification Rejected",
      message: `${row.materialDescription} rejected${req.body?.notes ? `: ${req.body.notes}` : ""}`,
      relatedEntityType: "MATERIAL_CERT", relatedEntityId: row.id,
    });
    await dotAudit(req, "REJECT", "material_certification", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

// ---- Surety Bonds (workflow-aware activation) ----
router.post(
  "/api/surety-bonds/:id/activate",
  requireAuth,
  requireFeaturePermission("canManageSuretyBonds"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(suretyBonds.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(suretyBonds.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(suretyBonds).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (prev.status !== "DRAFT") {
      return res.status(400).json({ error: `Cannot activate bond in status ${prev.status}` });
    }
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "SURETY_BOND", prev.id, req.user!.id, role, "ACTIVE", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(suretyBonds)
      .set({ status: "ACTIVE" as any, updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "surety_bond.activated",
      payload: { bondId: row.id, projectId: row.projectId ?? null, bondNumber: row.bondNumber },
    });
    await notifyApprovers(orgId, req.user!.id, {
      type: "SURETY_BOND_ACTIVATED",
      title: "Surety Bond Activated",
      message: `Bond ${row.bondNumber} (${row.bondType}) is now active`,
      relatedEntityType: "SURETY_BOND", relatedEntityId: row.id,
    });
    await dotAudit(req, "ACTIVATE", "surety_bond", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

export default router;
