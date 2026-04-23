import express, { Router, type Response } from "express";
import crypto from "node:crypto";
import { db } from "./db";
import {
  dotAgencies,
  dotSpecBooks,
  dotPayItems,
  dotPayItemOverrides,
  dotPayItemMatchHistory,
  organizationDotPreferences,
  projectDbeGoals,
  crmOrganisationCertifications,
  suretyBonds,
  haulTickets,
  dailyInspectorReports,
  swpppInspections,
  SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
  SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS,
  SWPPP_OVERDUE_REMINDER_MAX_CAP,
  SWPPP_OVERDUE_REMINDER_MIN_INTERVAL_HOURS,
  SWPPP_OVERDUE_REMINDER_MAX_INTERVAL_HOURS,
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
  estimateLineItems,
  estimates,
  bids,
  scheduleOfValues,
  sovLineItems,
  payApplications,
  projects,
  changeOrders,
  organizations,
  subcontractorContracts,
  crmOrganisations,
} from "@shared/schema";
import { generateDotProgressEstimatePDF, type DotProgressLineItem } from "./dot-progress-estimate-pdf-service";
import { generateHeavyCivilProjectSummaryPDF, type HeavyCivilProjectSummaryData } from "./dot-project-summary-pdf-service";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
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
import { integrationConnections } from "@shared/schema";
import { verifyCertification as dbeVerifyCertification } from "./integrations/providers/dbe_directory/sync";
import * as connectionService from "./integrations/connectionService";
import { logWarn } from "./utils/logger";
import { validateBody } from "./utils/validation";
import { z } from "zod";
import { logAudit } from "./auditLogger";
import { isFeatureEnabled } from "./services/featureFlagService";
import * as workflowEngine from "./services/workflowEngine";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
import type { FeatureFlagKey } from "@shared/schema";
import { exportLimiter, feedbackLimiter } from "./rateLimiter";

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
  action: "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "REJECT" | "SUBMIT" | "RESOLVE" | "REOPEN",
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
// Auth applies to all /api/dot routes; DOT_PAY_ITEMS gate applies only to the
// pay-item / agency / spec-book / preference / override sub-paths. The new
// progress-estimates and mass-haul routes are gated by their own feature flags
// (DOT_PROGRESS_ESTIMATE / MASS_HAUL_ANALYZER) on the route itself.
router.use("/api/dot", requireAuth);
router.use("/api/dot/agencies", requireOrgFeatureFlag("DOT_PAY_ITEMS"));
router.use("/api/dot/spec-books", requireOrgFeatureFlag("DOT_PAY_ITEMS"));
router.use("/api/dot/pay-items", requireOrgFeatureFlag("DOT_PAY_ITEMS"));
router.use("/api/dot/preferences", requireOrgFeatureFlag("DOT_PAY_ITEMS"));
router.use("/api/dot/overrides", requireOrgFeatureFlag("DOT_PAY_ITEMS"));
router.use("/api/dot/pay-item-overrides", requireOrgFeatureFlag("DOT_PAY_ITEMS"));
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
const csvList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
const payItemSearchQuerySchema = z.object({
  specBookId: z.string().optional(),
  agencyId: z.string().optional(),
  q: z.string().optional(),
  category: z.string().optional(),
  categories: csvList,
  specSections: csvList,
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get(
  "/api/dot/pay-items",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const parsed = payItemSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors });
    const { specBookId, agencyId, q, category, categories, specSections, limit } = parsed.data;
    const catList = categories.length > 0 ? categories : category ? [category] : [];
    const catKey = catList.slice().sort().join("|");
    const sectionKey = specSections.slice().sort().join("|");
    const cacheKey = `dot:pay-items:${specBookId ?? ""}:${agencyId ?? ""}:${catKey}:${sectionKey}:${(q ?? "").toLowerCase()}:${limit}`;
    const rows = await orgScopedCache(null, cacheKey, REFERENCE_TTL_MS, () => {
      const conditions: SQL[] = [eq(dotPayItems.isActive, true)];
      if (specBookId) conditions.push(eq(dotPayItems.specBookId, specBookId));
      if (agencyId) conditions.push(eq(dotPayItems.agencyId, agencyId));
      if (catList.length === 1) conditions.push(eq(dotPayItems.category, catList[0]));
      else if (catList.length > 1) conditions.push(inArray(dotPayItems.category, catList));
      if (specSections.length === 1) conditions.push(eq(dotPayItems.specSection, specSections[0]));
      else if (specSections.length > 1) conditions.push(inArray(dotPayItems.specSection, specSections));
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

// Distinct category and spec-section facets for the DOT Library browser.
// Returns count per value so the UI can render multi-select facets and
// users can drill into a section/category without typing a search term.
const facetsQuerySchema = z.object({
  specBookId: z.string().optional(),
  agencyId: z.string().optional(),
});
router.get(
  "/api/dot/pay-items/facets",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const parsed = facetsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors });
    }
    const { specBookId, agencyId } = parsed.data;
    if (!specBookId && !agencyId) {
      return res.status(400).json({ error: "specBookId or agencyId is required" });
    }
    const cacheKey = `dot:pay-items:facets:${specBookId ?? ""}:${agencyId ?? ""}`;
    const data = await orgScopedCache(null, cacheKey, REFERENCE_TTL_MS, async () => {
      const baseConds: SQL[] = [eq(dotPayItems.isActive, true)];
      if (specBookId) baseConds.push(eq(dotPayItems.specBookId, specBookId));
      if (agencyId) baseConds.push(eq(dotPayItems.agencyId, agencyId));
      const categoriesRows = await db
        .select({
          value: dotPayItems.category,
          count: sql<number>`COUNT(*)::int`.as("count"),
        })
        .from(dotPayItems)
        .where(and(...baseConds))
        .groupBy(dotPayItems.category)
        .orderBy(dotPayItems.category);
      const sectionsRows = await db
        .select({
          value: dotPayItems.specSection,
          count: sql<number>`COUNT(*)::int`.as("count"),
        })
        .from(dotPayItems)
        .where(and(...baseConds))
        .groupBy(dotPayItems.specSection)
        .orderBy(dotPayItems.specSection);
      return {
        categories: categoriesRows
          .filter((r) => r.value && r.value.trim().length > 0)
          .map((r) => ({ value: r.value as string, count: Number(r.count) || 0 })),
        specSections: sectionsRows
          .filter((r) => r.value && r.value.trim().length > 0)
          .map((r) => ({ value: r.value as string, count: Number(r.count) || 0 })),
      };
    });
    res.json(data);
  },
);

// Most-recent unit price the org used for this DOT pay item, for prefill.
// Joins back to estimates → bids to filter to the requesting org. Returns
// null when no historical price exists.
router.get(
  "/api/dot/pay-items/:id/recent-price",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const payItemId = req.params.id;
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization context required" });
    const [row] = await db
      .select({
        materialCost: estimateLineItems.materialCost,
        laborCost: estimateLineItems.laborCost,
        equipmentCost: estimateLineItems.equipmentCost,
        unit: estimateLineItems.unit,
        updatedAt: estimateLineItems.updatedAt,
      })
      .from(estimateLineItems)
      .innerJoin(estimates, eq(estimates.id, estimateLineItems.estimateId))
      .innerJoin(bids, eq(bids.id, estimates.bidId))
      .where(and(eq(estimateLineItems.dotPayItemId, payItemId), eq(bids.organizationId, orgId)))
      .orderBy(desc(estimateLineItems.updatedAt))
      .limit(1);
    if (!row) return res.json({ unitPrice: null });
    const unit = (Number(row.materialCost) || 0) + (Number(row.laborCost) || 0) + (Number(row.equipmentCost) || 0);
    return res.json({
      unitPrice: unit,
      materialCost: Number(row.materialCost) || 0,
      laborCost: Number(row.laborCost) || 0,
      equipmentCost: Number(row.equipmentCost) || 0,
      unit: row.unit,
      lastUsedAt: row.updatedAt,
    });
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
// DOT Pay Items — auto-match (fuzzy + alias-aware) suggestions
// =========================
const matchSchema = z.object({
  description: z.string().min(1).max(2000),
  unit: z.string().max(32).optional().nullable(),
  category: z.string().max(128).optional().nullable(),
  agencyIds: z.array(z.string()).optional(),
  specBookId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

const MATCH_STOPWORDS = new Set([
  "the","and","for","with","of","a","an","to","in","on","per","or","by","from","at","as","is","be","this","that","each","one","all","any","not","no",
]);

// Task #1164 — canonical form for grouping identical bid-tab descriptions
// across imports (case + whitespace insensitive). Capped so a giant copy/paste
// doesn't blow out the index.
function normalizeDescription(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 1000);
}

function tokenizeForMatch(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !MATCH_STOPWORDS.has(t));
}

router.post(
  "/api/dot/pay-items/match",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(matchSchema, req.body, res);
    if (!data) return;
    const orgId = req.user?.organizationId ?? null;
    const qTokensList = tokenizeForMatch(data.description);
    if (qTokensList.length === 0) return res.json({ matches: [] });
    const qTokens = new Set(qTokensList);

    // Resolve preferred agencies if caller didn't pass one
    let agencyIds = data.agencyIds && data.agencyIds.length > 0 ? data.agencyIds : null;
    if (!agencyIds && orgId) {
      const prefs = await db
        .select({ agencyId: organizationDotPreferences.agencyId })
        .from(organizationDotPreferences)
        .where(eq(organizationDotPreferences.organizationId, orgId));
      if (prefs.length > 0) agencyIds = prefs.map((p) => p.agencyId);
    }

    // Task #1164 — pull this org's accept/reject history for this exact
    // (normalized) description so we can boost items the team has chosen
    // before. Also pull a small org-wide affinity map so frequently-accepted
    // items get a gentle boost across similar-but-not-identical descriptions.
    const descNormalized = normalizeDescription(data.description);
    const sameDescAccepts = new Map<string, number>();
    const sameDescRejects = new Map<string, number>();
    const sameDescAgencyAccepts = new Map<string, Map<string, number>>();
    const orgItemAccepts = new Map<string, number>();
    if (orgId && descNormalized.length > 0) {
      const sameDescRows = await db
        .select({
          payItemId: dotPayItemMatchHistory.payItemId,
          agencyId: dotPayItemMatchHistory.agencyId,
          accepted: dotPayItemMatchHistory.accepted,
        })
        .from(dotPayItemMatchHistory)
        .where(and(
          eq(dotPayItemMatchHistory.organizationId, orgId),
          eq(dotPayItemMatchHistory.descriptionNormalized, descNormalized),
        ));
      for (const r of sameDescRows) {
        if (r.accepted) {
          sameDescAccepts.set(r.payItemId, (sameDescAccepts.get(r.payItemId) ?? 0) + 1);
          if (r.agencyId) {
            const inner = sameDescAgencyAccepts.get(r.payItemId) ?? new Map<string, number>();
            inner.set(r.agencyId, (inner.get(r.agencyId) ?? 0) + 1);
            sameDescAgencyAccepts.set(r.payItemId, inner);
          }
        } else {
          sameDescRejects.set(r.payItemId, (sameDescRejects.get(r.payItemId) ?? 0) + 1);
        }
      }
    }
    if (orgId) {
      const affinityRows = await db
        .select({
          payItemId: dotPayItemMatchHistory.payItemId,
          accepts: sql<number>`count(*)::int`.as("accepts"),
        })
        .from(dotPayItemMatchHistory)
        .where(and(
          eq(dotPayItemMatchHistory.organizationId, orgId),
          eq(dotPayItemMatchHistory.accepted, true),
        ))
        .groupBy(dotPayItemMatchHistory.payItemId);
      for (const r of affinityRows) orgItemAccepts.set(r.payItemId, Number(r.accepts));
    }

    // Org alias overrides — strongest signal
    const aliasMatchByItem = new Map<string, string>();
    if (orgId) {
      const overrides = await db
        .select()
        .from(dotPayItemOverrides)
        .where(eq(dotPayItemOverrides.organizationId, orgId));
      const descLower = data.description.toLowerCase().trim();
      for (const ov of overrides) {
        const alias = (ov.internalAlias ?? "").toLowerCase().trim();
        const custom = (ov.customDescription ?? "").toLowerCase().trim();
        let aliasText: string | null = null;
        if (alias && (descLower.includes(alias) || alias.includes(descLower))) {
          aliasText = ov.internalAlias ?? "";
        } else if (custom && (descLower.includes(custom) || custom.includes(descLower))) {
          aliasText = ov.customDescription ?? "";
        }
        if (aliasText) aliasMatchByItem.set(ov.payItemId, aliasText);
      }
    }

    // Candidate fetch — narrow with ilike on the longest tokens
    const conds: SQL[] = [eq(dotPayItems.isActive, true)];
    if (agencyIds && agencyIds.length > 0) conds.push(inArray(dotPayItems.agencyId, agencyIds));
    if (data.specBookId) conds.push(eq(dotPayItems.specBookId, data.specBookId));
    const topTokens = [...qTokensList].sort((a, b) => b.length - a.length).slice(0, 6);
    const orExpr = or(
      ...topTokens.flatMap((t) => [
        ilike(dotPayItems.description, `%${t}%`),
        ilike(dotPayItems.searchTokens, `%${t}%`),
        ilike(dotPayItems.itemNumber, `%${t}%`),
      ]),
    );
    if (orExpr) conds.push(orExpr);

    const candidates = await db.select().from(dotPayItems).where(and(...conds)).limit(500);

    // Always fold in alias-matched items even if the token filter missed them
    const aliasIds = [...aliasMatchByItem.keys()];
    if (aliasIds.length > 0) {
      const have = new Set(candidates.map((c) => c.id));
      const missing = aliasIds.filter((id) => !have.has(id));
      if (missing.length > 0) {
        const more = await db.select().from(dotPayItems).where(inArray(dotPayItems.id, missing));
        candidates.push(...more);
      }
    }

    // Task #1164 — also fold in items the org has previously *accepted* for
    // this exact description, so a learned match always shows up even when
    // the fuzzy token filter would have dropped it.
    const learnedIds = [...sameDescAccepts.keys()];
    if (learnedIds.length > 0) {
      const have = new Set(candidates.map((c) => c.id));
      const missing = learnedIds.filter((id) => !have.has(id));
      if (missing.length > 0) {
        const more = await db.select().from(dotPayItems).where(inArray(dotPayItems.id, missing));
        candidates.push(...more);
      }
    }

    const unitLower = (data.unit ?? "").toLowerCase().trim();
    const categoryLower = (data.category ?? "").toLowerCase().trim();
    const descLower = data.description.toLowerCase();

    const scored = candidates
      .map((p) => {
        const text = `${p.itemNumber} ${p.description} ${p.searchTokens ?? ""} ${p.category ?? ""}`;
        const pTokens = new Set(tokenizeForMatch(text));
        let inter = 0;
        for (const t of qTokens) if (pTokens.has(t)) inter++;
        const overlap = inter / qTokens.size;
        let score = overlap;
        if (unitLower && p.unit && p.unit.toLowerCase() === unitLower) score += 0.15;
        if (categoryLower && p.category && p.category.toLowerCase().includes(categoryLower)) score += 0.1;
        if (p.itemNumber && descLower.includes(p.itemNumber.toLowerCase())) score += 0.25;
        const aliasText = aliasMatchByItem.get(p.id);
        if (aliasText) score += 1.0;

        // Task #1164 — history boosts. Same-description accept/rejects are
        // the strongest signal; per-agency same-description accepts add a
        // smaller bump; org-wide affinity adds a tiny bump that survives
        // description variations.
        const sda = sameDescAccepts.get(p.id) ?? 0;
        const sdr = sameDescRejects.get(p.id) ?? 0;
        let learned = false;
        if (sda > 0 || sdr > 0) {
          const net = sda - sdr;
          // tanh-shaped boost in [-0.6, +0.8] so a single accept is meaningful
          // but additional accepts saturate (avoid drowning out genuinely
          // better fuzzy candidates forever).
          const sign = Math.sign(net);
          const mag = Math.tanh(Math.abs(net) / 2);
          score += sign * (sign > 0 ? 0.8 : 0.6) * mag;
          if (sign > 0) learned = true;
        }
        const agencyAcceptsMap = sameDescAgencyAccepts.get(p.id);
        const agencyAccepts = agencyAcceptsMap?.get(p.agencyId) ?? 0;
        if (agencyAccepts > 0) {
          score += 0.15;
        }
        const affinity = orgItemAccepts.get(p.id) ?? 0;
        if (affinity > 0) score += Math.min(0.1, affinity * 0.02);

        const matchReason: "alias" | "history" | "fuzzy" = aliasText
          ? "alias"
          : learned
            ? "history"
            : "fuzzy";
        return {
          payItem: p,
          score,
          matchReason,
          aliasText: aliasText ?? null,
          matchedTokens: [...qTokens].filter((t) => pTokens.has(t)),
          historyAccepts: sda,
          historyRejects: sdr,
          agencyAccepts,
          orgAffinityAccepts: affinity,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, data.limit);

    if (scored.length === 0) return res.json({ matches: [] });

    const aIds = [...new Set(scored.map((s) => s.payItem.agencyId))];
    const sbIds = [...new Set(scored.map((s) => s.payItem.specBookId))];
    const [ags, sbs, ovs] = await Promise.all([
      aIds.length ? db.select().from(dotAgencies).where(inArray(dotAgencies.id, aIds)) : Promise.resolve([] as (typeof dotAgencies.$inferSelect)[]),
      sbIds.length ? db.select().from(dotSpecBooks).where(inArray(dotSpecBooks.id, sbIds)) : Promise.resolve([] as (typeof dotSpecBooks.$inferSelect)[]),
      orgId
        ? db.select().from(dotPayItemOverrides).where(and(
            eq(dotPayItemOverrides.organizationId, orgId),
            inArray(dotPayItemOverrides.payItemId, scored.map((s) => s.payItem.id)),
          ))
        : Promise.resolve([] as (typeof dotPayItemOverrides.$inferSelect)[]),
    ]);
    const agencyById = Object.fromEntries(ags.map((a) => [a.id, a]));
    const specBookById = Object.fromEntries(sbs.map((s) => [s.id, s]));
    const overrideById = new Map(ovs.map((o) => [o.payItemId, o]));

    const matches = scored
      .map((s) => {
        const ov = overrideById.get(s.payItem.id);
        const agency = agencyById[s.payItem.agencyId];
        const specBook = specBookById[s.payItem.specBookId];
        if (!agency || !specBook) return null;
        return {
          payItem: {
            ...s.payItem,
            description: ov?.customDescription ?? s.payItem.description,
            unit: ov?.customUnit ?? s.payItem.unit,
            category: ov?.customCategory ?? s.payItem.category,
          },
          agency,
          specBook,
          score: Math.round(s.score * 100) / 100,
          matchReason: s.matchReason,
          aliasText: s.aliasText,
          matchedTokens: s.matchedTokens,
          historyAccepts: s.historyAccepts,
          historyRejects: s.historyRejects,
          agencyAccepts: s.agencyAccepts,
          orgAffinityAccepts: s.orgAffinityAccepts,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return res.json({ matches });
  },
);

// =========================
// Task #1164 — match-history feedback + top auto-matched items
// =========================
const matchFeedbackSchema = z.object({
  decisions: z
    .array(
      z.object({
        description: z.string().min(1).max(2000),
        payItemId: z.string().min(1),
        agencyId: z.string().min(1).optional().nullable(),
        accepted: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
});

// Task #1278 — server-side daily ceiling on rows added to
// dot_pay_item_match_history per organization. Acts as a backstop to the
// per-user express-rate-limit so a single org can't quietly inflate the
// history-aware ranking signal across many users/sessions. Tunable via env
// for ops; default is generous enough for normal bid-tab import workflows.
const FEEDBACK_DAILY_ORG_CAP_DEFAULT = 5000;
function feedbackDailyOrgCap(): number {
  const raw = Number(process.env.DOT_FEEDBACK_DAILY_ORG_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : FEEDBACK_DAILY_ORG_CAP_DEFAULT;
}

router.post(
  "/api/dot/pay-items/match/feedback",
  requireAuth,
  feedbackLimiter,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(matchFeedbackSchema, req.body, res);
    if (!data) return;
    const orgId = req.user?.organizationId ?? null;
    if (!orgId) return res.status(400).json({ error: "An organization context is required to record match feedback" });

    // Task #1278 — per-org daily cap. Counts rows recorded in the last 24h
    // and rejects with 429 if accepting this batch would push the org over.
    const cap = feedbackDailyOrgCap();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ used }] = await db
      .select({ used: sql<number>`count(*)::int` })
      .from(dotPayItemMatchHistory)
      .where(and(
        eq(dotPayItemMatchHistory.organizationId, orgId),
        gte(dotPayItemMatchHistory.createdAt, since),
      ));
    const usedCount = Number(used) || 0;
    if (usedCount + data.decisions.length > cap) {
      const remaining = Math.max(0, cap - usedCount);
      return res.status(429).json({
        error: "Daily match-feedback cap reached for this organization. Please try again tomorrow.",
        cap,
        used: usedCount,
        remaining,
      });
    }

    // Resolve agency for any decision that didn't pass one — keeps the
    // per-agency boost working even when callers (e.g. the bulk import dialog)
    // only know the pay-item ID.
    const missingAgency = data.decisions.filter((d) => !d.agencyId).map((d) => d.payItemId);
    const agencyByItem = new Map<string, string>();
    if (missingAgency.length > 0) {
      const rows = await db
        .select({ id: dotPayItems.id, agencyId: dotPayItems.agencyId })
        .from(dotPayItems)
        .where(inArray(dotPayItems.id, [...new Set(missingAgency)]));
      for (const r of rows) agencyByItem.set(r.id, r.agencyId);
    }

    const userId = req.user?.id ?? null;
    const valuesToInsert = data.decisions.map((d) => ({
      organizationId: orgId,
      agencyId: d.agencyId ?? agencyByItem.get(d.payItemId) ?? null,
      payItemId: d.payItemId,
      descriptionNormalized: normalizeDescription(d.description),
      descriptionRaw: d.description.slice(0, 2000),
      accepted: d.accepted,
      userId,
    }));

    if (valuesToInsert.length === 0) return res.json({ recorded: 0, batchId: null, ids: [] });

    // Task #1247 — tag every row from this POST with a shared batch_id so
    // the client can offer a one-click "undo" toast right after import.
    const batchId = crypto.randomUUID();
    const inserted = await db
      .insert(dotPayItemMatchHistory)
      .values(valuesToInsert.map((v) => ({ ...v, batchId })))
      .returning({ id: dotPayItemMatchHistory.id });
    await dotAudit(req, "CREATE", "dot_pay_item_match_history_batch", orgId, null, {
      batchId,
      count: inserted.length,
      accepted: valuesToInsert.filter((v) => v.accepted).length,
      rejected: valuesToInsert.filter((v) => !v.accepted).length,
    });
    return res.json({
      recorded: inserted.length,
      batchId,
      ids: inserted.map((r) => r.id),
    });
  },
);

// Task #1247 — undo a whole bid-tab feedback batch (org-scoped). Used by the
// "Remembered N pay-item choices — Undo" toast in the bid-tab import dialog.
router.delete(
  "/api/dot/pay-items/match/feedback/batch/:batchId",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    // Mirror the recent-decisions GET: super-admins must pass
    // ?organizationId=... to scope deletes to a target org. Normal users
    // are pinned to their own org. This keeps cross-tenant safety intact
    // while still letting super-admins manage another org's recent
    // decisions from the "view as" flow.
    let targetOrgId: string | null = ctx.orgId;
    if (ctx.isSuperAdmin) {
      targetOrgId = superAdminTargetOrgId(req);
      if (!targetOrgId) return res.status(400).json({ error: "Provide ?organizationId=... when deleting as super admin" });
    }
    if (!targetOrgId) return res.status(400).json({ error: "An organization context is required" });

    const batchId = String(req.params.batchId ?? "").trim();
    if (!batchId) return res.status(400).json({ error: "batchId is required" });

    const deleted = await db
      .delete(dotPayItemMatchHistory)
      .where(and(
        eq(dotPayItemMatchHistory.organizationId, targetOrgId),
        eq(dotPayItemMatchHistory.batchId, batchId),
      ))
      .returning({ id: dotPayItemMatchHistory.id });
    if (deleted.length > 0) {
      await dotAudit(req, "DELETE", "dot_pay_item_match_history_batch", batchId, { count: deleted.length }, null);
    }
    return res.json({ deleted: deleted.length });
  },
);

// Task #1247 — delete a single feedback row (used by the "Recent decisions"
// list on the DOT library page so users can scrub a one-off mis-match).
router.delete(
  "/api/dot/pay-items/match-history/:id",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    let targetOrgId: string | null = ctx.orgId;
    if (ctx.isSuperAdmin) {
      targetOrgId = superAdminTargetOrgId(req);
      if (!targetOrgId) return res.status(400).json({ error: "Provide ?organizationId=... when deleting as super admin" });
    }
    if (!targetOrgId) return res.status(400).json({ error: "An organization context is required" });

    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });

    const deleted = await db
      .delete(dotPayItemMatchHistory)
      .where(and(
        eq(dotPayItemMatchHistory.organizationId, targetOrgId),
        eq(dotPayItemMatchHistory.id, id),
      ))
      .returning({ id: dotPayItemMatchHistory.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Decision not found" });
    await dotAudit(req, "DELETE", "dot_pay_item_match_history", id, null, null);
    return res.json({ deleted: deleted.length });
  },
);

// Task #1247 — recent feedback rows for the org (most recent ~50). Powers the
// "Recent decisions" panel on the DOT library page so users can scrub a
// specific row that the matcher remembered incorrectly.
router.get(
  "/api/dot/pay-items/match-history/recent",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "50"), 10) || 50));

    let targetOrgId: string | null = ctx.orgId;
    if (ctx.isSuperAdmin) {
      targetOrgId = superAdminTargetOrgId(req);
      if (!targetOrgId) return res.json({ items: [] });
    }
    if (!targetOrgId) return res.json({ items: [] });

    const rows = await db
      .select({
        id: dotPayItemMatchHistory.id,
        payItemId: dotPayItemMatchHistory.payItemId,
        descriptionRaw: dotPayItemMatchHistory.descriptionRaw,
        accepted: dotPayItemMatchHistory.accepted,
        batchId: dotPayItemMatchHistory.batchId,
        createdAt: dotPayItemMatchHistory.createdAt,
      })
      .from(dotPayItemMatchHistory)
      .where(eq(dotPayItemMatchHistory.organizationId, targetOrgId))
      .orderBy(desc(dotPayItemMatchHistory.createdAt))
      .limit(limit);

    if (rows.length === 0) return res.json({ items: [] });

    const itemIds = [...new Set(rows.map((r) => r.payItemId))];
    const [items, overrides] = await Promise.all([
      db.select().from(dotPayItems).where(inArray(dotPayItems.id, itemIds)),
      db
        .select()
        .from(dotPayItemOverrides)
        .where(and(
          eq(dotPayItemOverrides.organizationId, targetOrgId),
          inArray(dotPayItemOverrides.payItemId, itemIds),
        )),
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const overrideByItem = new Map(overrides.map((o) => [o.payItemId, o]));
    const aIds = [...new Set(items.map((i) => i.agencyId))];
    const ags = aIds.length
      ? await db.select().from(dotAgencies).where(inArray(dotAgencies.id, aIds))
      : [];
    const agencyById = new Map(ags.map((a) => [a.id, a]));

    const out = rows
      .map((r) => {
        const item = itemById.get(r.payItemId);
        if (!item) return null;
        const ov = overrideByItem.get(r.payItemId);
        return {
          id: r.id,
          batchId: r.batchId,
          accepted: r.accepted,
          descriptionRaw: r.descriptionRaw,
          createdAt: r.createdAt,
          payItem: {
            id: item.id,
            itemNumber: item.itemNumber,
            description: ov?.customDescription ?? item.description,
            unit: ov?.customUnit ?? item.unit,
          },
          agency: agencyById.get(item.agencyId) ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return res.json({ items: out });
  },
);

// Lightweight admin/report view: top auto-matched pay items (by accept count)
// for the caller's org. Powers the "Top auto-matches" tab on the DOT Library
// page so admins can promote noisy descriptions into formal aliases.
router.get(
  "/api/dot/pay-items/match-history/top",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "20"), 10) || 20));

    let targetOrgId: string | null = ctx.orgId;
    if (ctx.isSuperAdmin) {
      targetOrgId = superAdminTargetOrgId(req);
      if (!targetOrgId) return res.json({ items: [] });
    }
    if (!targetOrgId) return res.json({ items: [] });

    const rows = await db
      .select({
        payItemId: dotPayItemMatchHistory.payItemId,
        accepts: sql<number>`sum(case when ${dotPayItemMatchHistory.accepted} then 1 else 0 end)::int`.as("accepts"),
        rejects: sql<number>`sum(case when ${dotPayItemMatchHistory.accepted} then 0 else 1 end)::int`.as("rejects"),
        lastAcceptedAt: sql<Date | null>`max(case when ${dotPayItemMatchHistory.accepted} then ${dotPayItemMatchHistory.createdAt} end)`.as("last_accepted_at"),
      })
      .from(dotPayItemMatchHistory)
      .where(eq(dotPayItemMatchHistory.organizationId, targetOrgId))
      .groupBy(dotPayItemMatchHistory.payItemId)
      .orderBy(sql`accepts desc, rejects asc`)
      .limit(limit);

    if (rows.length === 0) return res.json({ items: [] });

    const itemIds = rows.map((r) => r.payItemId);
    const [items, sampleRows, overrides] = await Promise.all([
      db.select().from(dotPayItems).where(inArray(dotPayItems.id, itemIds)),
      db
        .select({
          payItemId: dotPayItemMatchHistory.payItemId,
          descriptionRaw: dotPayItemMatchHistory.descriptionRaw,
          createdAt: dotPayItemMatchHistory.createdAt,
        })
        .from(dotPayItemMatchHistory)
        .where(and(
          eq(dotPayItemMatchHistory.organizationId, targetOrgId),
          eq(dotPayItemMatchHistory.accepted, true),
          inArray(dotPayItemMatchHistory.payItemId, itemIds),
        ))
        .orderBy(desc(dotPayItemMatchHistory.createdAt)),
      db
        .select()
        .from(dotPayItemOverrides)
        .where(and(
          eq(dotPayItemOverrides.organizationId, targetOrgId),
          inArray(dotPayItemOverrides.payItemId, itemIds),
        )),
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const overrideByItem = new Map(overrides.map((o) => [o.payItemId, o]));
    const aIds = [...new Set(items.map((i) => i.agencyId))];
    const sbIds = [...new Set(items.map((i) => i.specBookId))];
    const [ags, sbs] = await Promise.all([
      aIds.length ? db.select().from(dotAgencies).where(inArray(dotAgencies.id, aIds)) : Promise.resolve([] as (typeof dotAgencies.$inferSelect)[]),
      sbIds.length ? db.select().from(dotSpecBooks).where(inArray(dotSpecBooks.id, sbIds)) : Promise.resolve([] as (typeof dotSpecBooks.$inferSelect)[]),
    ]);
    const agencyById = new Map(ags.map((a) => [a.id, a]));
    const specBookById = new Map(sbs.map((s) => [s.id, s]));

    // Distinct sample descriptions, capped at 3 most-recent per item so the
    // UI can show "we matched these strings to this item".
    const samplesByItem = new Map<string, string[]>();
    for (const r of sampleRows) {
      const list = samplesByItem.get(r.payItemId) ?? [];
      const trimmed = (r.descriptionRaw ?? "").trim();
      if (trimmed && !list.some((s) => s.toLowerCase() === trimmed.toLowerCase()) && list.length < 3) {
        list.push(trimmed);
        samplesByItem.set(r.payItemId, list);
      }
    }

    const out = rows
      .map((r) => {
        const item = itemById.get(r.payItemId);
        if (!item) return null;
        const ov = overrideByItem.get(r.payItemId);
        return {
          payItem: {
            id: item.id,
            itemNumber: item.itemNumber,
            description: ov?.customDescription ?? item.description,
            unit: ov?.customUnit ?? item.unit,
            specSection: item.specSection,
            category: ov?.customCategory ?? item.category,
          },
          agency: agencyById.get(item.agencyId) ?? null,
          specBook: specBookById.get(item.specBookId) ?? null,
          acceptCount: Number(r.accepts ?? 0),
          rejectCount: Number(r.rejects ?? 0),
          lastAcceptedAt: r.lastAcceptedAt,
          sampleDescriptions: samplesByItem.get(r.payItemId) ?? [],
          hasAlias: !!(ov?.internalAlias && ov.internalAlias.trim().length > 0),
          internalAlias: ov?.internalAlias?.trim() ? ov.internalAlias.trim() : null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return res.json({ items: out });
  },
);

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
// Enrich override rows with the underlying pay item / agency / spec book so the
// DOT Library settings page can show "alias → pay item" without N round-trips.
async function enrichOverrides(
  rows: (typeof dotPayItemOverrides.$inferSelect)[],
): Promise<Array<typeof dotPayItemOverrides.$inferSelect & {
  payItem: typeof dotPayItems.$inferSelect | null;
  agency: typeof dotAgencies.$inferSelect | null;
  specBook: typeof dotSpecBooks.$inferSelect | null;
}>> {
  if (rows.length === 0) return [];
  const itemIds = [...new Set(rows.map((r) => r.payItemId))];
  const items = await db.select().from(dotPayItems).where(inArray(dotPayItems.id, itemIds));
  const aIds = [...new Set(items.map((i) => i.agencyId))];
  const sbIds = [...new Set(items.map((i) => i.specBookId))];
  const [ags, sbs] = await Promise.all([
    aIds.length ? db.select().from(dotAgencies).where(inArray(dotAgencies.id, aIds)) : Promise.resolve([] as (typeof dotAgencies.$inferSelect)[]),
    sbIds.length ? db.select().from(dotSpecBooks).where(inArray(dotSpecBooks.id, sbIds)) : Promise.resolve([] as (typeof dotSpecBooks.$inferSelect)[]),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const agencyById = new Map(ags.map((a) => [a.id, a]));
  const specBookById = new Map(sbs.map((s) => [s.id, s]));
  return rows.map((r) => {
    const pi = itemById.get(r.payItemId) ?? null;
    return {
      ...r,
      payItem: pi,
      agency: pi ? agencyById.get(pi.agencyId) ?? null : null,
      specBook: pi ? specBookById.get(pi.specBookId) ?? null : null,
    };
  });
}

router.get(
  "/api/dot/pay-item-overrides",
  requireAuth,
  requireAnyFeaturePermission("canViewDotLibrary", "canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const wantEnriched = req.query.include === "payItem";
    if (ctx.isSuperAdmin) {
      const targetOrg = superAdminTargetOrgId(req);
      const rows = targetOrg
        ? await db.select().from(dotPayItemOverrides).where(eq(dotPayItemOverrides.organizationId, targetOrg))
        : await db.select().from(dotPayItemOverrides);
      return res.json(wantEnriched ? await enrichOverrides(rows) : rows);
    }
    const rows = await orgScopedCache(ctx.orgId!, KEY_ORG_OVERRIDES, ORG_TTL_MS, () =>
      db.select().from(dotPayItemOverrides).where(eq(dotPayItemOverrides.organizationId, ctx.orgId!))
    );
    res.json(wantEnriched ? await enrichOverrides(rows) : rows);
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
    // Upsert on (organizationId, payItemId): saving an alias for a pay item
    // that already has an override (e.g. customDescription) merges the alias
    // into the existing row instead of failing the unique constraint.
    const [existing] = await db
      .select()
      .from(dotPayItemOverrides)
      .where(and(
        eq(dotPayItemOverrides.organizationId, ctx.orgId!),
        eq(dotPayItemOverrides.payItemId, data.payItemId),
      ))
      .limit(1);
    const updateSet: Partial<typeof dotPayItemOverrides.$inferInsert> = { updatedAt: new Date() };
    if (Object.prototype.hasOwnProperty.call(req.body, "internalAlias")) updateSet.internalAlias = data.internalAlias ?? null;
    if (Object.prototype.hasOwnProperty.call(req.body, "customDescription")) updateSet.customDescription = data.customDescription ?? null;
    if (Object.prototype.hasOwnProperty.call(req.body, "customUnit")) updateSet.customUnit = data.customUnit ?? null;
    if (Object.prototype.hasOwnProperty.call(req.body, "customCategory")) updateSet.customCategory = data.customCategory ?? null;
    if (Object.prototype.hasOwnProperty.call(req.body, "notes")) updateSet.notes = data.notes ?? null;
    const [row] = await db
      .insert(dotPayItemOverrides)
      .values(data)
      .onConflictDoUpdate({
        target: [dotPayItemOverrides.organizationId, dotPayItemOverrides.payItemId],
        set: updateSet,
      })
      .returning();
    cacheInvalidate(ctx.orgId!, KEY_ORG_OVERRIDES);
    await dotAudit(req, existing ? "UPDATE" : "CREATE", "dot_pay_item_override", row.id, existing ?? null, row);
    res.status(existing ? 200 : 201).json(row);
  },
);

// PATCH lets the UI clear/edit individual override fields (e.g. clear only the
// internalAlias) without destroying sibling fields like customDescription. Body
// is whitelisted to the per-org override columns.
const overridePatchSchema = z.object({
  internalAlias: z.string().nullable().optional(),
  customDescription: z.string().nullable().optional(),
  customUnit: z.string().max(16).nullable().optional(),
  customCategory: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
router.patch(
  "/api/dot/pay-item-overrides/:id",
  requireAuth,
  requireFeaturePermission("canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const data = validateBody(overridePatchSchema, req.body, res);
    if (!data) return;
    const conditions: SQL[] = [eq(dotPayItemOverrides.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dotPayItemOverrides.organizationId, ctx.orgId!));
    const [existing] = await db.select().from(dotPayItemOverrides).where(and(...conditions)).limit(1);
    if (!existing) return res.status(404).json({ error: "Override not found" });
    const updates: Partial<typeof dotPayItemOverrides.$inferInsert> = { updatedAt: new Date() };
    for (const key of ["internalAlias", "customDescription", "customUnit", "customCategory", "notes"] as const) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        (updates as Record<string, unknown>)[key] = data[key] ?? null;
      }
    }
    // If the patch leaves the row with no override data at all, drop the row
    // so empty shells don't accumulate. Otherwise update in place.
    const merged = { ...existing, ...updates };
    const isEmpty =
      !merged.internalAlias && !merged.customDescription && !merged.customUnit &&
      !merged.customCategory && !merged.notes;
    if (isEmpty) {
      await db.delete(dotPayItemOverrides).where(eq(dotPayItemOverrides.id, existing.id));
      if (!ctx.isSuperAdmin) cacheInvalidate(ctx.orgId!, KEY_ORG_OVERRIDES);
      await dotAudit(req, "DELETE", "dot_pay_item_override", existing.id, existing, null);
      return res.status(204).end();
    }
    const [row] = await db
      .update(dotPayItemOverrides)
      .set(updates)
      .where(eq(dotPayItemOverrides.id, existing.id))
      .returning();
    if (!ctx.isSuperAdmin) cacheInvalidate(ctx.orgId!, KEY_ORG_OVERRIDES);
    await dotAudit(req, "UPDATE", "dot_pay_item_override", row.id, existing, row);
    res.json(row);
  },
);

router.delete(
  "/api/dot/pay-item-overrides/:id",
  requireAuth,
  requireFeaturePermission("canManageDotLibrary"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dotPayItemOverrides.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dotPayItemOverrides.organizationId, ctx.orgId!));
    const [deleted] = await db.delete(dotPayItemOverrides).where(and(...conditions)).returning();
    if (!deleted) return res.status(404).json({ error: "Override not found" });
    if (!ctx.isSuperAdmin) cacheInvalidate(ctx.orgId!, KEY_ORG_OVERRIDES);
    await dotAudit(req, "DELETE", "dot_pay_item_override", deleted.id, deleted, null);
    res.status(204).end();
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

    // Fire-and-forget DBE auto-verify against the directory if a connection
    // is configured. Discrepancies are logged for follow-up nightly batch.
    void (async () => {
      try {
        const [connRow] = await db
          .select({ id: integrationConnections.id })
          .from(integrationConnections)
          .where(
            and(
              eq(integrationConnections.organizationId, ctx.orgId!),
              eq(integrationConnections.provider, "dbe_directory"),
              eq(integrationConnections.status, "active"),
            )
          )
          .limit(1);
        if (!connRow) return;
        // Connection metadata (directory URL, API key) is encrypted at rest;
        // fetch via the connection service so the verify call has decrypted
        // credentials.
        const conn = await connectionService.getDecryptedConnection(connRow.id, ctx.orgId!);
        if (!conn) return;
        const result = await dbeVerifyCertification(conn, row.id);
        if (result?.discrepancy) {
          logWarn("DBE certification discrepancy", {
            certificationId: row.id,
            crmOrganisationId: row.crmOrganisationId,
            discrepancy: result.discrepancy,
          });
        }
      } catch (err) {
        logWarn("DBE auto-verify hook failed", { certificationId: row.id, error: String(err) });
      }
    })();

    res.status(201).json(row);
  },
);

// Task #491 — PATCH allows attaching/detaching the planDocuments parent
// (and editing scalar fields) without losing revision history. The
// document itself owns the file uploads + revisions, so swapping the FK
// is the only mutation needed at the cert level.
router.patch(
  "/api/crm/organisations/:crmOrgId/certifications/:id",
  requireAuth,
  requireFeaturePermission("canCreateCRMContacts"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { id: _id, organizationId: _o, crmOrganisationId: _c, createdAt: _ca, updatedAt: _u, ...patch } = req.body || {};
    const conditions: SQL[] = [eq(crmOrganisationCertifications.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(crmOrganisationCertifications.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(crmOrganisationCertifications).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    const [row] = await db.update(crmOrganisationCertifications)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await dotAudit(req, "UPDATE", "crm_organisation_certification", row.id, prev, row);
    res.json(row);
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
    } else if (canSubmit && prev.inspectorId === req.user!.id && (prev.status === "DRAFT" || prev.status === "REVISED")) {
      // Inspectors may edit their own report while in DRAFT or after a
      // reviewer rejected it back to REVISED, so they can correct findings
      // before re-submitting via /submit.
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
    const {
      id: _id, organizationId: _o, createdAt: _c, createdById: _cb,
      status: _st, resolvedAt: _ra, resolvedById: _rb, resolutionNotes: _rn,
      // Task #1173 + #1259: lastOverdueNotifiedAt and overdueReminderCount
      // are server-managed by the overdue notification sweep; clients
      // must not be able to suppress, back-date, or reset them via the
      // patch endpoint.
      lastOverdueNotifiedAt: _lon,
      overdueReminderCount: _orc,
      ...patch
    } = req.body || {};
    const conditions: SQL[] = [eq(swpppInspections.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(swpppInspections.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(swpppInspections).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    // Task #1173: if the corrective action due date is being changed, the
    // previous "overdue" fanout no longer applies — clear the dedupe
    // marker so a fresh overdue cycle can fire if the new date also
    // lapses without resolution.
    const updatePayload: Record<string, unknown> = { ...patch, updatedAt: new Date() };
    if (Object.prototype.hasOwnProperty.call(patch, "correctiveActionDueDate") &&
        String(patch.correctiveActionDueDate ?? "") !== String(prev.correctiveActionDueDate ?? "")) {
      updatePayload.lastOverdueNotifiedAt = null;
      // Task #1259: also reset the daily reminder counter so the new
      // due date starts a fresh overdue cycle from zero rather than
      // resuming under the previous cap.
      updatePayload.overdueReminderCount = 0;
    }
    const [row] = await db.update(swpppInspections).set(updatePayload)
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await dotAudit(req, "UPDATE", "swppp_inspection", row.id, prev, row);
    res.json(row);
  },
);

router.post(
  "/api/swppp-inspections/:id/resolve",
  requireAuth,
  requireFeaturePermission("canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(swpppInspections.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(swpppInspections.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(swpppInspections).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (prev.status === "RESOLVED") return res.json(prev);
    const now = new Date();
    const resolutionNotes = typeof req.body?.resolutionNotes === "string" ? req.body.resolutionNotes : null;
    const [row] = await db.update(swpppInspections)
      .set({
        status: "RESOLVED",
        resolvedAt: now,
        resolvedById: req.user!.id,
        resolutionNotes,
        correctiveActionCompletedAt: now,
        updatedAt: now,
      })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await dotAudit(req, "RESOLVE", "swppp_inspection", row.id, prev, row);
    res.json(row);
  },
);

router.post(
  "/api/swppp-inspections/:id/reopen",
  requireAuth,
  requireFeaturePermission("canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(swpppInspections.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(swpppInspections.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(swpppInspections).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (prev.status !== "RESOLVED") return res.json(prev);
    const [row] = await db.update(swpppInspections)
      .set({
        status: "OPEN",
        resolvedAt: null,
        resolvedById: null,
        resolutionNotes: null,
        correctiveActionCompletedAt: null,
        // Task #1173: re-arm the overdue notification cycle so that if the
        // re-opened inspection is past its due date again it will be
        // re-fanned-out by the nightly sweep.
        // Task #1259: also reset the daily reminder counter so a
        // re-opened inspection gets a fresh batch of reminders rather
        // than picking up a previously-exhausted cap.
        lastOverdueNotifiedAt: null,
        overdueReminderCount: 0,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await dotAudit(req, "REOPEN", "swppp_inspection", row.id, prev, row);
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
// SWPPP Overdue Reminder Settings (Task #1286)
// =========================
// Per-org escalation policy for the nightly SWPPP overdue corrective
// action sweep (`processSwpppOverdueCorrectiveActions` in jobRunner).
// Admins can choose how many follow-up reminders are sent per overdue
// cycle (`maxCount`) and the minimum gap in hours between consecutive
// fanouts (`intervalHours`). Defaults match the legacy hard-coded
// constants (5 reminders, 22h cadence) so unconfigured orgs see no
// behavior change.
router.get(
  "/api/swppp/settings",
  requireAuth,
  requireAnyFeaturePermission("canViewSwppp", "canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const targetOrg = ctx.isSuperAdmin ? superAdminTargetOrgId(req) : ctx.orgId;
    if (!targetOrg) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const [row] = await db
      .select({
        organizationId: organizations.id,
        overdueReminderMaxCount: organizations.swpppOverdueReminderMaxCount,
        overdueReminderIntervalHours: organizations.swpppOverdueReminderIntervalHours,
      })
      .from(organizations)
      .where(eq(organizations.id, targetOrg))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Organization not found" });
    res.json({
      organizationId: row.organizationId,
      overdueReminderMaxCount: row.overdueReminderMaxCount ?? SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
      overdueReminderIntervalHours: row.overdueReminderIntervalHours ?? SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS,
      defaults: {
        overdueReminderMaxCount: SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
        overdueReminderIntervalHours: SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS,
      },
      bounds: {
        maxCount: { min: 1, max: SWPPP_OVERDUE_REMINDER_MAX_CAP },
        intervalHours: { min: SWPPP_OVERDUE_REMINDER_MIN_INTERVAL_HOURS, max: SWPPP_OVERDUE_REMINDER_MAX_INTERVAL_HOURS },
      },
    });
  },
);

router.put(
  "/api/swppp/settings",
  requireAuth,
  requireFeaturePermission("canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const targetOrg = ctx.isSuperAdmin ? superAdminTargetOrgId(req) : ctx.orgId;
    if (!targetOrg) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const updateSchema = z.object({
      overdueReminderMaxCount: z.number().int().min(1).max(SWPPP_OVERDUE_REMINDER_MAX_CAP),
      overdueReminderIntervalHours: z.number().int()
        .min(SWPPP_OVERDUE_REMINDER_MIN_INTERVAL_HOURS)
        .max(SWPPP_OVERDUE_REMINDER_MAX_INTERVAL_HOURS),
    });
    const data = validateBody(updateSchema, req.body, res);
    if (!data) return;

    const [before] = await db
      .select({
        overdueReminderMaxCount: organizations.swpppOverdueReminderMaxCount,
        overdueReminderIntervalHours: organizations.swpppOverdueReminderIntervalHours,
      })
      .from(organizations)
      .where(eq(organizations.id, targetOrg))
      .limit(1);
    if (!before) return res.status(404).json({ error: "Organization not found" });

    const [updated] = await db
      .update(organizations)
      .set({
        swpppOverdueReminderMaxCount: data.overdueReminderMaxCount,
        swpppOverdueReminderIntervalHours: data.overdueReminderIntervalHours,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, targetOrg))
      .returning({
        organizationId: organizations.id,
        overdueReminderMaxCount: organizations.swpppOverdueReminderMaxCount,
        overdueReminderIntervalHours: organizations.swpppOverdueReminderIntervalHours,
      });
    await dotAudit(req, "UPDATE", "swppp_overdue_reminder_settings", targetOrg, before, updated);
    res.json({
      organizationId: updated.organizationId,
      overdueReminderMaxCount: updated.overdueReminderMaxCount,
      overdueReminderIntervalHours: updated.overdueReminderIntervalHours,
    });
  },
);

// Task #1317: Read-only summary of recent SWPPP overdue-reminder activity
// so admins on the Company Notifications tab can see how many escalations
// the nightly job has actually sent before tweaking the cap/cadence above.
// We aggregate from `swpppInspections.lastOverdueNotifiedAt` and
// `swpppInspections.overdueReminderCount` directly — no separate audit
// log of send events exists, so "fanouts in the last 7 days" means
// "inspections whose most recent overdue fanout was within the last 7
// days" (one cycle per inspection).
router.get(
  "/api/swppp/overdue-reminders/activity",
  requireAuth,
  requireAnyFeaturePermission("canViewSwppp", "canManageSwppp"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const targetOrg = ctx.isSuperAdmin ? superAdminTargetOrgId(req) : ctx.orgId;
    if (!targetOrg) {
      return res.status(400).json({ error: "Organization context required" });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const orgFilter = eq(swpppInspections.organizationId, targetOrg);

    // Recent activity: inspections whose most recent fanout (initial
    // or follow-up) landed in the last 7 days. Each fanout event
    // overwrites `lastOverdueNotifiedAt`, so this counts inspections
    // touched by the sweep in the window — not raw send events. We
    // intentionally do NOT sum `overdueReminderCount` here because
    // that column is a cumulative lifetime counter for the current
    // cycle; summing it across "recently notified" rows would
    // materially overcount weekly volume.
    const [recentAgg] = await db
      .select({
        recentFanoutInspections: sql<number>`COUNT(*)::int`,
      })
      .from(swpppInspections)
      .where(and(orgFilter, gte(swpppInspections.lastOverdueNotifiedAt, sevenDaysAgo)));

    // Snapshot of cycles still mid-escalation right now: OPEN
    // inspections that have already received at least one follow-up
    // reminder in their current cycle. Distinct from the 7-day window
    // above because a long-running cycle started 30 days ago is still
    // worth surfacing.
    const [escalatingAgg] = await db
      .select({
        activeEscalatingInspections: sql<number>`COUNT(*)::int`,
      })
      .from(swpppInspections)
      .where(and(
        orgFilter,
        eq(swpppInspections.status, "OPEN"),
        sql`${swpppInspections.overdueReminderCount} > 0`,
      ));

    // Currently mid-escalation: OPEN inspections that have already
    // received at least one follow-up reminder. Surface the top 5 by
    // reminder count so admins can spot items pinned at the cap.
    const topEscalating = await db
      .select({
        id: swpppInspections.id,
        projectId: swpppInspections.projectId,
        projectName: projects.name,
        projectCode: projects.code,
        inspectionDate: swpppInspections.inspectionDate,
        correctiveActionDueDate: swpppInspections.correctiveActionDueDate,
        overdueReminderCount: swpppInspections.overdueReminderCount,
        lastOverdueNotifiedAt: swpppInspections.lastOverdueNotifiedAt,
        status: swpppInspections.status,
      })
      .from(swpppInspections)
      .leftJoin(projects, eq(projects.id, swpppInspections.projectId))
      .where(and(
        orgFilter,
        eq(swpppInspections.status, "OPEN"),
        sql`${swpppInspections.overdueReminderCount} > 0`,
      ))
      .orderBy(desc(swpppInspections.overdueReminderCount), desc(swpppInspections.lastOverdueNotifiedAt))
      .limit(5);

    res.json({
      windowDays: 7,
      generatedAt: new Date().toISOString(),
      recentFanoutInspections: recentAgg?.recentFanoutInspections ?? 0,
      activeEscalatingInspections: escalatingAgg?.activeEscalatingInspections ?? 0,
      topEscalating,
    });
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

// Lifecycle transition matrix. The workflow engine handles delegation when a
// template is configured, but the fallback (direct) path must still refuse
// invalid current states (e.g. approving a DRAFT haul ticket, or re-submitting
// an APPROVED IDR). Applies BEFORE the delegation call so behavior is
// consistent whether or not a workflow template exists.
type StatusGuard = { from: ReadonlyArray<string>; nextLabel: string };
const HAUL_GUARDS: Record<string, StatusGuard> = {
  SUBMITTED: { from: ["DRAFT"], nextLabel: "submit" },
  APPROVED: { from: ["SUBMITTED"], nextLabel: "approve" },
  REJECTED: { from: ["SUBMITTED"], nextLabel: "reject" },
  VOIDED: { from: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"], nextLabel: "void" },
};
const IDR_GUARDS: Record<string, StatusGuard> = {
  SUBMITTED: { from: ["DRAFT", "REVISED"], nextLabel: "submit" },
  APPROVED: { from: ["SUBMITTED"], nextLabel: "approve" },
  REVISED: { from: ["SUBMITTED"], nextLabel: "reject" },
  DRAFT: { from: ["APPROVED", "SUBMITTED"], nextLabel: "request-revision" },
};
const SURETY_GUARDS: Record<string, StatusGuard> = {
  ACTIVE: { from: ["DRAFT"], nextLabel: "activate" },
  RELEASED: { from: ["ACTIVE"], nextLabel: "release" },
  EXPIRED: { from: ["ACTIVE"], nextLabel: "expire" },
  CANCELED: { from: ["DRAFT", "ACTIVE"], nextLabel: "cancel" },
};
// Material certs: gate verify/reject by current buyAmericaStatus.
const MC_TERMINAL_BUYAM: ReadonlyArray<string> = ["VERIFIED", "WAIVER_GRANTED", "NON_COMPLIANT"];

function enforceLifecycle(
  res: Response,
  guards: Record<string, StatusGuard>,
  currentStatus: string,
  targetStatus: string,
): boolean {
  const guard = guards[targetStatus];
  if (!guard) return false;
  if (!guard.from.includes(currentStatus)) {
    res.status(409).json({
      error: `Cannot ${guard.nextLabel} from status ${currentStatus}`,
      currentStatus,
      allowedFrom: guard.from,
    });
    return true;
  }
  return false;
}

function handleDelegationGate(res: Response, delegation: DelegationResult, prev: Record<string, unknown>): boolean {
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
  // Submission requires record-keeping (manage) right; approvers only review.
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (enforceLifecycle(res, HAUL_GUARDS, prev.status, "SUBMITTED")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "HAUL_TICKET", prev.id, req.user!.id, role, "SUBMITTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(haulTickets)
      .set({ status: "SUBMITTED", updatedAt: new Date() })
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
  requireAnyFeaturePermission("canApproveHaulTickets", "canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (enforceLifecycle(res, HAUL_GUARDS, prev.status, "APPROVED")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "HAUL_TICKET", prev.id, req.user!.id, role, "APPROVED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(haulTickets)
      .set({ status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
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
  requireAnyFeaturePermission("canApproveHaulTickets", "canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (enforceLifecycle(res, HAUL_GUARDS, prev.status, "REJECTED")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "HAUL_TICKET", prev.id, req.user!.id, role, "REJECTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(haulTickets)
      .set({ status: "REJECTED", updatedAt: new Date() })
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
  requireAnyFeaturePermission("canSubmitInspectorReports", "canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    // Managers/super-admin may submit any IDR; inspectors with canSubmit may
    // only submit their own report (mirrors the PATCH ownership gate).
    const canManage = await userHasManagePermission(req, "canManageInspectorReports");
    if (!ctx.isSuperAdmin && !canManage && prev.inspectorId !== req.user!.id) {
      return res.status(403).json({ error: "Only the assigned inspector may submit this report" });
    }
    if (enforceLifecycle(res, IDR_GUARDS, prev.status, "SUBMITTED")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "INSPECTOR_REPORT", prev.id, req.user!.id, role, "SUBMITTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(dailyInspectorReports)
      .set({ status: "SUBMITTED", submittedAt: new Date(), updatedAt: new Date() })
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
  requireAnyFeaturePermission("canApproveInspectorReports", "canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (enforceLifecycle(res, IDR_GUARDS, prev.status, "APPROVED")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "INSPECTOR_REPORT", prev.id, req.user!.id, role, "APPROVED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(dailyInspectorReports)
      .set({ status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
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
  requireAnyFeaturePermission("canApproveInspectorReports", "canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    // /reject sends an IDR back as REVISED (idr_status enum has no REJECTED)
    if (enforceLifecycle(res, IDR_GUARDS, prev.status, "REVISED")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "INSPECTOR_REPORT", prev.id, req.user!.id, role, "REJECTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(dailyInspectorReports)
      // idr_status enum lacks REJECTED — semantically a rejection sends the
      // report back to the inspector for revision, modeled as REVISED.
      .set({ status: "REVISED", updatedAt: new Date() })
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
  requireAnyFeaturePermission("canApproveInspectorReports", "canManageInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(dailyInspectorReports.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(dailyInspectorReports.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(dailyInspectorReports).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (enforceLifecycle(res, IDR_GUARDS, prev.status, "DRAFT")) return;
    const orgId = prev.organizationId;
    const [row] = await db.update(dailyInspectorReports)
      .set({ status: "DRAFT", submittedAt: null, updatedAt: new Date() })
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
    if (MC_TERMINAL_BUYAM.includes(prev.buyAmericaStatus ?? "PENDING")) {
      return res.status(409).json({
        error: `Cannot submit certification in buyAmericaStatus ${prev.buyAmericaStatus}`,
        currentStatus: prev.buyAmericaStatus,
      });
    }
    if (prev.submittedAt) {
      return res.status(409).json({
        error: "Certification already submitted",
        submittedAt: prev.submittedAt.toISOString(),
      });
    }
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "MATERIAL_CERT", prev.id, req.user!.id, role, "SUBMITTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(materialCertifications)
      .set({ submittedById: req.user!.id, submittedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await notifyApprovers(orgId, req.user!.id, {
      type: "MATERIAL_CERT_SUBMITTED",
      title: "Material Certification Submitted",
      message: `${row.materialDescription} submitted for verification`,
      relatedEntityType: "MATERIAL_CERT", relatedEntityId: row.id,
    });
    await dotAudit(req, "SUBMIT", "material_certification", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
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
    if (MC_TERMINAL_BUYAM.includes(prev.buyAmericaStatus ?? "PENDING")) {
      // Already verified, waived, or non-compliant — must reset/re-submit first.
      // (WAIVER_REQUESTED is non-terminal and falls through.)
      return res.status(409).json({
        error: `Cannot verify certification in buyAmericaStatus ${prev.buyAmericaStatus}`,
        currentStatus: prev.buyAmericaStatus,
      });
    }
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    type BuyAmericaTransition = "VERIFIED" | "NON_COMPLIANT" | "WAIVER_GRANTED";
    const buyAmericaStatus: BuyAmericaTransition =
      (req.body?.buyAmericaStatus as BuyAmericaTransition | undefined) ?? "VERIFIED";
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "MATERIAL_CERT", prev.id, req.user!.id, role, "VERIFIED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(materialCertifications)
      .set({
        verifiedById: req.user!.id, verifiedAt: new Date(),
        buyAmericaStatus, updatedAt: new Date(),
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
    if (prev.submittedById && prev.submittedById !== req.user!.id) {
      await notifySubmitter(prev.submittedById, {
        type: "MATERIAL_CERT_VERIFIED",
        title: "Material Certification Verified",
        message: `Your certification "${row.materialDescription}" was verified (${buyAmericaStatus}).`,
        relatedEntityType: "MATERIAL_CERT", relatedEntityId: row.id,
      }, orgId);
    }
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
    if ((prev.buyAmericaStatus ?? "PENDING") === "NON_COMPLIANT") {
      return res.status(409).json({
        error: "Certification is already marked NON_COMPLIANT",
        currentStatus: prev.buyAmericaStatus,
      });
    }
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "MATERIAL_CERT", prev.id, req.user!.id, role, "REJECTED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(materialCertifications)
      .set({ buyAmericaStatus: "NON_COMPLIANT", updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await notifyApprovers(orgId, req.user!.id, {
      type: "MATERIAL_CERT_REJECTED",
      title: "Material Certification Rejected",
      message: `${row.materialDescription} rejected${req.body?.notes ? `: ${req.body.notes}` : ""}`,
      relatedEntityType: "MATERIAL_CERT", relatedEntityId: row.id,
    });
    if (prev.submittedById && prev.submittedById !== req.user!.id) {
      await notifySubmitter(prev.submittedById, {
        type: "MATERIAL_CERT_REJECTED",
        title: "Material Certification Rejected",
        message: `Your certification "${row.materialDescription}" was rejected${req.body?.notes ? `: ${req.body.notes}` : ""}.`,
        relatedEntityType: "MATERIAL_CERT", relatedEntityId: row.id,
      }, orgId);
    }
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
    if (enforceLifecycle(res, SURETY_GUARDS, prev.status, "ACTIVE")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "SURETY_BOND", prev.id, req.user!.id, role, "ACTIVE", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(suretyBonds)
      .set({ status: "ACTIVE", updatedAt: new Date() })
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
    // audit_action enum has no ACTIVATE; record as UPDATE with diff payload
    await dotAudit(req, "UPDATE", "surety_bond", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

// Surety bond lifecycle: release / expire / cancel. Each transition is
// guarded by SURETY_GUARDS and runs through the workflow engine so any
// org-configured surety bond approval template is honored.
function makeSuretyTransition(
  path: string,
  target: "RELEASED" | "EXPIRED" | "CANCELED",
  eventType: string,
  notifyTitle: string,
) {
  router.post(
    path,
    requireAuth,
    requireFeaturePermission("canManageSuretyBonds"),
    async (req: AuthRequest, res: Response) => {
      const ctx = requireOrgOwnership(req, res);
      if (!ctx) return;
      const conditions: SQL[] = [eq(suretyBonds.id, req.params.id)];
      if (!ctx.isSuperAdmin) conditions.push(eq(suretyBonds.organizationId, ctx.orgId!));
      const [prev] = await db.select().from(suretyBonds).where(and(...conditions)).limit(1);
      if (!prev) return res.status(404).json({ error: "Not found" });
      if (enforceLifecycle(res, SURETY_GUARDS, prev.status, target)) return;
      const orgId = prev.organizationId;
      const role = req.user!.effectiveRole || req.user!.role;
      const delegation = await workflowEngine.delegateEntityTransition(
        orgId, "SURETY_BOND", prev.id, req.user!.id, role, target, req.body?.notes,
      );
      if (handleDelegationGate(res, delegation, prev)) return;
      const [row] = await db.update(suretyBonds)
        .set({ status: target, updatedAt: new Date() })
        .where(and(...conditions)).returning();
      await eventBus.emit({
        version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
        type: eventType,
        payload: { bondId: row.id, projectId: row.projectId ?? null, bondNumber: row.bondNumber },
      });
      await notifyApprovers(orgId, req.user!.id, {
        type: `SURETY_BOND_${target}`,
        title: notifyTitle,
        message: `Bond ${row.bondNumber} (${row.bondType}) ${target.toLowerCase()}`,
        relatedEntityType: "SURETY_BOND", relatedEntityId: row.id,
      });
      await dotAudit(req, "UPDATE", "surety_bond", row.id, prev, row);
      res.json({ ...row, workflow: delegation });
    },
  );
}
makeSuretyTransition("/api/surety-bonds/:id/release", "RELEASED", "surety_bond.released", "Surety Bond Released");
makeSuretyTransition("/api/surety-bonds/:id/expire", "EXPIRED", "surety_bond.expired", "Surety Bond Expired");
makeSuretyTransition("/api/surety-bonds/:id/cancel", "CANCELED", "surety_bond.canceled", "Surety Bond Canceled");

// Haul ticket void: terminal transition usable from any prior status by
// users with manage permission. Workflow-aware so org-configured haul
// approval templates can intercept (e.g. require supervisor sign-off).
router.post(
  "/api/haul-tickets/:id/void",
  requireAuth,
  requireFeaturePermission("canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const conditions: SQL[] = [eq(haulTickets.id, req.params.id)];
    if (!ctx.isSuperAdmin) conditions.push(eq(haulTickets.organizationId, ctx.orgId!));
    const [prev] = await db.select().from(haulTickets).where(and(...conditions)).limit(1);
    if (!prev) return res.status(404).json({ error: "Not found" });
    if (enforceLifecycle(res, HAUL_GUARDS, prev.status, "VOIDED")) return;
    const orgId = prev.organizationId;
    const role = req.user!.effectiveRole || req.user!.role;
    const delegation = await workflowEngine.delegateEntityTransition(
      orgId, "HAUL_TICKET", prev.id, req.user!.id, role, "VOIDED", req.body?.notes,
    );
    if (handleDelegationGate(res, delegation, prev)) return;
    const [row] = await db.update(haulTickets)
      .set({ status: "VOIDED", updatedAt: new Date() })
      .where(and(...conditions)).returning();
    await eventBus.emit({
      version: 1, orgId, actorId: req.user!.id, timestamp: new Date(),
      type: "haul_ticket.voided",
      payload: { haulTicketId: row.id, projectId: row.projectId, ticketNumber: row.ticketNumber, reason: req.body?.notes ?? null },
    });
    if (prev.recordedById) {
      await notifySubmitter(prev.recordedById, {
        type: "HAUL_TICKET_VOIDED",
        title: "Haul Ticket Voided",
        message: `Haul ticket ${row.ticketNumber} was voided${req.body?.notes ? `: ${req.body.notes}` : ""}`,
        relatedEntityType: "HAUL_TICKET", relatedEntityId: row.id,
      }, orgId);
    }
    await dotAudit(req, "UPDATE", "haul_ticket", row.id, prev, row);
    res.json({ ...row, workflow: delegation });
  },
);

// =====================================================================
// DOT PROGRESS ESTIMATE PDF
// State-DOT-style monthly progress estimate, grouped by spec section.
// Distinct from AIA G702/G703; gated by DOT_PROGRESS_ESTIMATE.
// =====================================================================
router.get(
  "/api/dot/progress-estimates/:payApplicationId/pdf",
  requireOrgFeatureFlag("DOT_PROGRESS_ESTIMATE"),
  requireFeaturePermission("canViewFinancials"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { payApplicationId } = req.params;
      const userOrgId = req.user?.organizationId ?? null;
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";

      const [app] = await db
        .select()
        .from(payApplications)
        .where(eq(payApplications.id, payApplicationId))
        .limit(1);
      if (!app) { res.status(404).json({ error: "Pay application not found" }); return; }
      if (!isSuperAdmin && app.organizationId !== userOrgId) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, app.projectId))
        .limit(1);

      // Derive periodFrom = prior pay-app's periodTo (next-day) or project start date.
      const [priorApp] = await db
        .select({ periodTo: payApplications.periodTo })
        .from(payApplications)
        .where(and(
          eq(payApplications.projectId, app.projectId),
          lt(payApplications.applicationNumber, app.applicationNumber),
        ))
        .orderBy(desc(payApplications.applicationNumber))
        .limit(1);
      let periodFrom = '';
      if (priorApp?.periodTo) {
        const d = new Date(priorApp.periodTo);
        if (!isNaN(d.getTime())) {
          d.setDate(d.getDate() + 1);
          periodFrom = d.toISOString().slice(0, 10);
        }
      } else if (project?.startDate) {
        const d = new Date(project.startDate);
        if (!isNaN(d.getTime())) periodFrom = d.toISOString().slice(0, 10);
      }

      const [org] = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, app.organizationId))
        .limit(1);

      // Pull SOV lines joined with the org's preferred DOT agency for header context
      const lineRows = await db
        .select({
          li: sovLineItems,
          payItem: dotPayItems,
        })
        .from(sovLineItems)
        .leftJoin(dotPayItems, eq(sovLineItems.dotPayItemId, dotPayItems.id))
        .where(eq(sovLineItems.sovId, app.sovId))
        .orderBy(sovLineItems.lineNumber);

      // Try to infer agency from any pay-item present, fall back to org preference
      let agencyName: string | null = null;
      let agencyCode: string | null = null;
      const firstPayItemAgency = lineRows.find(r => r.payItem?.agencyId)?.payItem?.agencyId;
      if (firstPayItemAgency) {
        const [agency] = await db
          .select({ name: dotAgencies.name, code: dotAgencies.code })
          .from(dotAgencies)
          .where(eq(dotAgencies.id, firstPayItemAgency))
          .limit(1);
        if (agency) {
          agencyName = agency.name;
          agencyCode = agency.code;
        }
      }

      const lineItems: DotProgressLineItem[] = lineRows.map(({ li, payItem }) => {
        const scheduled = parseFloat(li.scheduledValue || "0");
        const prior = parseFloat(li.previouslyCompleted || "0");
        const thisPeriod = parseFloat(li.thisPeriodCompleted || "0");
        const total = parseFloat(li.totalCompletedAndStored || "0") || (prior + thisPeriod);

        // Treat scheduledValue as the lump-sum contract amount; quantities are
        // expressed as a percent of the total scheduled value (1.0 = 100%).
        // For unit-priced lines, contract qty/unit price would ideally come from
        // the linked estimate line — until estimate quantity is denormalized
        // onto sov_line_items, we report dollars-as-quantities for clarity.
        const unitPrice = scheduled > 0 ? 1 : 0; // each "unit" == $1 of scheduled value
        const contractQty = scheduled;
        const priorQty = prior;
        const thisPeriodQty = thisPeriod;
        const totalQty = total;
        const percent = scheduled > 0 ? (total / scheduled) * 100 : 0;

        return {
          lineNumber: li.lineNumber,
          payItemNumber: li.payItemNumber || payItem?.itemNumber || null,
          itemCode: li.itemCode,
          description: li.description,
          unit: payItem?.unit || "LS",
          specSection: li.specSection || payItem?.specSection || null,
          contractQty,
          priorQty,
          thisPeriodQty,
          totalQty,
          percentComplete: percent,
          unitPrice,
          priorAmount: prior,
          thisPeriodAmount: thisPeriod,
          totalAmount: total,
        };
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="DOT-Progress-Estimate-${app.applicationNumber}.pdf"`);

      const stream = generateDotProgressEstimatePDF({
        applicationNumber: app.applicationNumber,
        periodFrom,
        periodTo: app.periodTo || '',
        projectName: project?.name || '',
        projectCode: project?.code || null,
        projectLocation: [project?.locationAddress, project?.city, project?.state].filter(Boolean).join(', '),
        contractorName: app.contractorName || '',
        ownerName: app.ownerName || org?.name || '',
        agencyName,
        agencyCode,
        contractNumber: app.contractFor || null,
        originalContractSum: parseFloat(app.originalContractSum || "0"),
        netChangeOrders: parseFloat(app.netChangeByChangeOrders || "0"),
        contractSumToDate: parseFloat(app.contractSumToDate || "0"),
        totalCompletedToDate: parseFloat(app.totalCompletedAndStored || "0"),
        retainagePercent: parseFloat(app.retainagePercent || "0"),
        totalRetained: parseFloat(app.totalRetained || "0"),
        lessPreviousCertificates: parseFloat(app.lessPreviousCertificates || "0"),
        currentPaymentDue: parseFloat(app.currentPaymentDue || "0"),
        balanceToFinish: parseFloat(app.balanceToFinish || "0"),
        lineItems,
      });

      stream.pipe(res);
    } catch (error) {
      logWarn("[DOT progress estimate PDF] generation failed", {
        payApplicationId: req.params.payApplicationId,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate DOT progress estimate PDF" });
      }
    }
  },
);

// Aggregated mass-haul movement series for diagram rendering.
// Returns one row per (source, destination, materialClass) plus parsed station
// hints when source/destination strings contain "STA <num>+<offset>" tokens.
router.get(
  "/api/dot/mass-haul/:projectId/series",
  requireOrgFeatureFlag("MASS_HAUL_ANALYZER"),
  requireFeaturePermission("canViewHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const userOrgId = req.user?.organizationId ?? null;
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";

      // Verify project access
      const [project] = await db
        .select({ id: projects.id, organizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!isSuperAdmin && project.organizationId !== userOrgId) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const movements = await db
        .select({
          source: haulTickets.source,
          destination: haulTickets.destination,
          materialClass: haulTickets.materialClass,
          unit: haulTickets.unit,
          totalQty: sql<number>`COALESCE(SUM(${haulTickets.quantity}::numeric), 0)`.as("totalQty"),
          totalCost: sql<number>`COALESCE(SUM(${haulTickets.totalCost}::numeric), 0)`.as("totalCost"),
          tickets: sql<number>`COUNT(*)`.as("tickets"),
        })
        .from(haulTickets)
        .where(and(
          eq(haulTickets.projectId, projectId),
          eq(haulTickets.organizationId, project.organizationId),
          sql`${haulTickets.status} IN ('SUBMITTED', 'APPROVED')`,
        ))
        .groupBy(haulTickets.source, haulTickets.destination, haulTickets.materialClass, haulTickets.unit);

      // Parse "STA 12+34" or "12+34" tokens into linear feet.
      // 1 station = 100 ft; "STA 12+34" => 12*100 + 34 = 1234 ft.
      const parseStation = (s: string | null | undefined): number | null => {
        if (!s) return null;
        const m = s.match(/(?:STA\s*)?(\d{1,4})\s*\+\s*(\d{1,3})/i);
        if (!m) return null;
        return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
      };

      const enriched = movements.map(m => {
        const fromSta = parseStation(m.source);
        const toSta = parseStation(m.destination);
        const haulDistance = (fromSta != null && toSta != null) ? Math.abs(toSta - fromSta) : null;
        const isCut = /CUT|EXCAVAT/i.test(m.materialClass);
        const isFill = /FILL|EMBANK|BORROW/i.test(m.materialClass);
        return {
          source: m.source,
          destination: m.destination,
          fromStation: fromSta,
          toStation: toSta,
          haulDistanceFt: haulDistance,
          materialClass: m.materialClass,
          materialKind: isCut ? "CUT" : isFill ? "FILL" : "OTHER",
          unit: m.unit,
          totalQty: Number(m.totalQty) || 0,
          totalCost: Number(m.totalCost) || 0,
          tickets: Number(m.tickets) || 0,
        };
      });

      // Build cumulative cut/fill curve when stations are present.
      // Each cut at station X contributes +qty, each fill at station X contributes -qty.
      // Sort by station, accumulate.
      type StationPoint = { station: number; cut: number; fill: number; cumulative: number };
      const stationDeltas = new Map<number, { cut: number; fill: number }>();
      for (const m of enriched) {
        if (m.materialKind === "CUT" && m.fromStation != null) {
          const cur = stationDeltas.get(m.fromStation) || { cut: 0, fill: 0 };
          cur.cut += m.totalQty;
          stationDeltas.set(m.fromStation, cur);
        }
        if (m.materialKind === "FILL" && m.toStation != null) {
          const cur = stationDeltas.get(m.toStation) || { cut: 0, fill: 0 };
          cur.fill += m.totalQty;
          stationDeltas.set(m.toStation, cur);
        }
      }
      const stationsSorted = Array.from(stationDeltas.keys()).sort((a, b) => a - b);
      let cumulative = 0;
      const massHaulCurve: StationPoint[] = stationsSorted.map(st => {
        const d = stationDeltas.get(st)!;
        cumulative += d.cut - d.fill;
        return { station: st, cut: d.cut, fill: -d.fill, cumulative };
      });

      const totalCut = enriched.filter(m => m.materialKind === "CUT").reduce((a, b) => a + b.totalQty, 0);
      const totalFill = enriched.filter(m => m.materialKind === "FILL").reduce((a, b) => a + b.totalQty, 0);

      res.json({
        movements: enriched,
        massHaulCurve,
        totals: {
          cut: totalCut,
          fill: totalFill,
          balance: totalCut - totalFill,
        },
        hasStationData: massHaulCurve.length > 0,
      });
    } catch (error) {
      logWarn("[mass-haul series] aggregation failed", { projectId: req.params.projectId });
      res.status(500).json({ error: "Failed to load mass-haul series" });
    }
  },
);

// ============================================
// HEAVY-CIVIL DASHBOARD AGGREGATORS
// Thin, pre-aggregated endpoints for the 5 heavy-civil dashboard widgets.
// Each is gated by its corresponding feature flag + permission key.
// ============================================

router.get(
  "/api/dashboard/heavy-civil/dbe-progress",
  requireAuth,
  requireOrgFeatureFlag("DBE_TRACKING"),
  requireAnyFeaturePermission("canViewDbeGoals", "canManageDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    try {
      const conds: SQL[] = [];
      if (!ctx.isSuperAdmin) conds.push(eq(projectDbeGoals.organizationId, ctx.orgId!));
      const rows = await db.select({
        certificationType: projectDbeGoals.certificationType,
        goalPercent: projectDbeGoals.goalPercent,
        goalDollars: projectDbeGoals.goalDollars,
        projectId: projectDbeGoals.projectId,
      }).from(projectDbeGoals)
        .where(conds.length ? and(...conds) : undefined);

      const projectIds = Array.from(new Set(rows.map(r => r.projectId)));
      const byType = new Map<string, { goalPercentSum: number; goalDollarsSum: number; count: number }>();
      let totalGoalPercent = 0;
      let totalGoalDollars = 0;
      for (const r of rows) {
        const gp = Number(r.goalPercent) || 0;
        const gd = Number(r.goalDollars) || 0;
        totalGoalPercent += gp;
        totalGoalDollars += gd;
        const cur = byType.get(r.certificationType) || { goalPercentSum: 0, goalDollarsSum: 0, count: 0 };
        cur.goalPercentSum += gp;
        cur.goalDollarsSum += gd;
        cur.count += 1;
        byType.set(r.certificationType, cur);
      }

      // Compute actual awarded dollars per cert type by joining
      // subcontractor contracts -> crm org certifications. Excludes
      // TERMINATED contracts (they aren't actually awarded), filters
      // certifications to those currently in effect, and de-duplicates
      // (contract, cert type) pairs so multiple cert rows for the same
      // org+type (e.g. different certifying agencies) don't double-count.
      const paidByType = new Map<string, number>();
      let totalPaidDollars = 0;
      if (projectIds.length > 0) {
        // Validity is checked at contract award time (start_date, falling back
        // to created_at) rather than "today" so historical awards with certs
        // that have since expired are still credited correctly.
        const awardDateExpr = sql`COALESCE(${subcontractorContracts.startDate}, ${subcontractorContracts.createdAt})`;
        const certConds: SQL[] = [
          inArray(subcontractorContracts.projectId, projectIds),
          sql`${subcontractorContracts.status} <> 'TERMINATED'`,
          sql`(${crmOrganisationCertifications.effectiveDate} IS NULL OR ${crmOrganisationCertifications.effectiveDate} <= ${awardDateExpr})`,
          sql`(${crmOrganisationCertifications.expirationDate} IS NULL OR ${crmOrganisationCertifications.expirationDate} >= ${awardDateExpr})`,
        ];
        if (!ctx.isSuperAdmin) certConds.push(eq(crmOrganisationCertifications.organizationId, ctx.orgId!));
        const paidRows = await db.selectDistinct({
          contractId: subcontractorContracts.id,
          certificationType: crmOrganisationCertifications.certificationType,
          contractAmount: subcontractorContracts.contractAmount,
        }).from(subcontractorContracts)
          .innerJoin(crmOrganisationCertifications, eq(crmOrganisationCertifications.crmOrganisationId, subcontractorContracts.subcontractorId))
          .where(and(...certConds));
        for (const r of paidRows) {
          const amt = Number(r.contractAmount) || 0;
          paidByType.set(r.certificationType, (paidByType.get(r.certificationType) || 0) + amt);
          totalPaidDollars += amt;
        }
      }

      const breakdown = Array.from(byType.entries()).map(([certificationType, v]) => {
        const paid = paidByType.get(certificationType) || 0;
        const actualPercent = v.goalDollarsSum > 0 ? (paid / v.goalDollarsSum) * 100 : 0;
        return {
          certificationType,
          avgGoalPercent: v.count > 0 ? v.goalPercentSum / v.count : 0,
          totalGoalDollars: v.goalDollarsSum,
          actualPaidDollars: paid,
          actualVsGoalPercent: actualPercent,
          projectCount: v.count,
        };
      }).sort((a, b) => b.totalGoalDollars - a.totalGoalDollars);

      res.json({
        projectsWithGoals: projectIds.length,
        totalGoals: rows.length,
        avgGoalPercent: rows.length > 0 ? totalGoalPercent / rows.length : 0,
        totalGoalDollars,
        totalActualPaidDollars: totalPaidDollars,
        totalActualVsGoalPercent: totalGoalDollars > 0 ? (totalPaidDollars / totalGoalDollars) * 100 : 0,
        breakdown,
      });
    } catch (e) {
      logWarn("[heavy-civil/dbe-progress] failed");
      res.status(500).json({ error: "Failed to load DBE progress" });
    }
  },
);

router.get(
  "/api/dashboard/heavy-civil/open-haul-tickets",
  requireAuth,
  requireOrgFeatureFlag("HAUL_TICKETS"),
  requireAnyFeaturePermission("canViewHaulTickets", "canManageHaulTickets"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    try {
      const conds: SQL[] = [];
      if (!ctx.isSuperAdmin) conds.push(eq(haulTickets.organizationId, ctx.orgId!));
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 6);
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);
      const [agg] = await db.select({
        total: sql<number>`COUNT(*)::int`,
        submitted: sql<number>`SUM(CASE WHEN ${haulTickets.status} = 'SUBMITTED' THEN 1 ELSE 0 END)::int`,
        approved: sql<number>`SUM(CASE WHEN ${haulTickets.status} = 'APPROVED' THEN 1 ELSE 0 END)::int`,
        rejected: sql<number>`SUM(CASE WHEN ${haulTickets.status} = 'REJECTED' THEN 1 ELSE 0 END)::int`,
        totalQuantity: sql<number>`COALESCE(SUM(${haulTickets.quantity}), 0)::float`,
        totalCost: sql<number>`COALESCE(SUM(${haulTickets.totalCost}), 0)::float`,
        todayCount: sql<number>`SUM(CASE WHEN ${haulTickets.ticketDate} = ${todayStr} THEN 1 ELSE 0 END)::int`,
        todayQuantity: sql<number>`COALESCE(SUM(CASE WHEN ${haulTickets.ticketDate} = ${todayStr} THEN ${haulTickets.quantity} ELSE 0 END), 0)::float`,
        weekCount: sql<number>`SUM(CASE WHEN ${haulTickets.ticketDate} >= ${weekAgoStr} THEN 1 ELSE 0 END)::int`,
        weekQuantity: sql<number>`COALESCE(SUM(CASE WHEN ${haulTickets.ticketDate} >= ${weekAgoStr} THEN ${haulTickets.quantity} ELSE 0 END), 0)::float`,
        oldestPendingDays: sql<number>`COALESCE((MAX(EXTRACT(DAY FROM NOW() - ${haulTickets.createdAt})) FILTER (WHERE ${haulTickets.status} = 'SUBMITTED'))::int, 0)`,
      }).from(haulTickets).where(conds.length ? and(...conds) : undefined);

      const recent = await db.select({
        id: haulTickets.id,
        ticketNumber: haulTickets.ticketNumber,
        ticketDate: haulTickets.ticketDate,
        materialClass: haulTickets.materialClass,
        quantity: haulTickets.quantity,
        unit: haulTickets.unit,
        status: haulTickets.status,
        projectId: haulTickets.projectId,
      }).from(haulTickets)
        .where(and(...conds, eq(haulTickets.status, "SUBMITTED")))
        .orderBy(desc(haulTickets.ticketDate))
        .limit(5);

      res.json({
        total: agg?.total ?? 0,
        pendingApproval: agg?.submitted ?? 0,
        approved: agg?.approved ?? 0,
        rejected: agg?.rejected ?? 0,
        totalQuantity: Number(agg?.totalQuantity ?? 0),
        totalCost: Number(agg?.totalCost ?? 0),
        todayCount: agg?.todayCount ?? 0,
        todayQuantity: Number(agg?.todayQuantity ?? 0),
        weekCount: agg?.weekCount ?? 0,
        weekQuantity: Number(agg?.weekQuantity ?? 0),
        oldestPendingDays: Number(agg?.oldestPendingDays ?? 0),
        recentPending: recent.map(r => ({ ...r, quantity: Number(r.quantity) })),
      });
    } catch (e) {
      logWarn("[heavy-civil/open-haul-tickets] failed");
      res.status(500).json({ error: "Failed to load haul tickets" });
    }
  },
);

router.get(
  "/api/dashboard/heavy-civil/idr-streak",
  requireAuth,
  requireOrgFeatureFlag("DAILY_INSPECTOR_REPORTS"),
  requireAnyFeaturePermission("canViewInspectorReports", "canManageInspectorReports", "canApproveInspectorReports"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    try {
      const orgId = ctx.orgId;
      if (!orgId) {
        return res.json({
          totalReports: 0, last30Days: 0, last30DaysExpected: 0, complianceRate: 0,
          streakDays: 0, lastSubmittedDate: null, activeProjects: 0, projectStreaks: [],
        });
      }

      // Active projects for this org are the denominator + per-project streak set.
      const activeProjectsList = await db.select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.gcOrganizationId, orgId), eq(projects.status, "ACTIVE")));
      const activeCount = activeProjectsList.length;

      const thirty = new Date();
      thirty.setDate(thirty.getDate() - 30);
      const thirtyStr = thirty.toISOString().slice(0, 10);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 120);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      let totalReports = 0;
      let last30Days = 0;
      let lastSubmittedDate: string | null = null;
      let projectStreaks: Array<{
        projectId: string;
        projectName: string;
        streakDays: number;
        lastSubmittedDate: string | null;
      }> = [];
      let aggregateStreak = 0;

      if (activeCount > 0) {
        const activeIds = activeProjectsList.map(p => p.id);

        const [totalAgg] = await db.select({
          total: sql<number>`COUNT(*)::int`,
          last30: sql<number>`SUM(CASE WHEN ${dailyInspectorReports.reportDate} >= ${thirtyStr} THEN 1 ELSE 0 END)::int`,
          lastSubmitted: sql<string | null>`MAX(${dailyInspectorReports.reportDate})`,
        }).from(dailyInspectorReports)
          .where(and(
            eq(dailyInspectorReports.organizationId, orgId),
            inArray(dailyInspectorReports.projectId, activeIds),
          ));
        totalReports = totalAgg?.total ?? 0;
        last30Days = totalAgg?.last30 ?? 0;
        lastSubmittedDate = totalAgg?.lastSubmitted ?? null;

        // Per-project distinct submission dates within streak window.
        const dateRows = await db.selectDistinct({
          projectId: dailyInspectorReports.projectId,
          reportDate: dailyInspectorReports.reportDate,
        }).from(dailyInspectorReports)
          .where(and(
            eq(dailyInspectorReports.organizationId, orgId),
            inArray(dailyInspectorReports.projectId, activeIds),
            gte(dailyInspectorReports.reportDate, cutoffStr),
          ));
        const dateSetByProject = new Map<string, Set<string>>();
        for (const p of activeProjectsList) dateSetByProject.set(p.id, new Set());
        for (const r of dateRows) {
          const s = dateSetByProject.get(r.projectId);
          if (s) s.add(String(r.reportDate));
        }

        // Streak counts only WORKING days (Mon-Fri). Weekends are skipped
        // (cursor advances) but do not break the streak — a Friday with an
        // IDR followed by Mon with an IDR keeps the streak alive across
        // Sat/Sun. Holiday calendar is not yet wired in.
        const isWorkingDay = (dt: Date) => {
          const dow = dt.getDay();
          return dow !== 0 && dow !== 6; // skip Sun(0), Sat(6)
        };
        const computeStreak = (dateSet: Set<string>): number => {
          let s = 0;
          const cursor = new Date();
          // If today is a working day but not yet submitted, start from the
          // previous working day so missed-today before EOD doesn't reset.
          if (isWorkingDay(cursor) && !dateSet.has(cursor.toISOString().slice(0, 10))) {
            cursor.setDate(cursor.getDate() - 1);
          }
          // Hard cap to prevent runaway loops if data is sparse.
          for (let i = 0; i < 365; i++) {
            if (!isWorkingDay(cursor)) {
              cursor.setDate(cursor.getDate() - 1);
              continue;
            }
            if (dateSet.has(cursor.toISOString().slice(0, 10))) {
              s += 1;
              cursor.setDate(cursor.getDate() - 1);
            } else {
              break;
            }
          }
          return s;
        };

        projectStreaks = activeProjectsList.map(p => {
          const set = dateSetByProject.get(p.id) ?? new Set<string>();
          const sorted = [...set].sort();
          return {
            projectId: p.id,
            projectName: p.name,
            streakDays: computeStreak(set),
            lastSubmittedDate: sorted.length > 0 ? sorted[sorted.length - 1] : null,
          };
        });
        // Org-wide aggregate streak = consecutive days where EVERY active
        // project submitted = min of per-project streaks.
        aggregateStreak = projectStreaks.length > 0
          ? Math.min(...projectStreaks.map(p => p.streakDays))
          : 0;
      }

      const expectedLast30 = activeCount * 30;
      res.json({
        totalReports,
        last30Days,
        last30DaysExpected: expectedLast30,
        complianceRate: expectedLast30 > 0 ? Math.min(100, (last30Days / expectedLast30) * 100) : 0,
        streakDays: aggregateStreak,
        lastSubmittedDate,
        activeProjects: activeCount,
        projectStreaks,
      });
    } catch (e) {
      logWarn("[heavy-civil/idr-streak] failed");
      res.status(500).json({ error: "Failed to load IDR streak" });
    }
  },
);

router.get(
  "/api/dashboard/heavy-civil/buy-america",
  requireAuth,
  requireOrgFeatureFlag("BUY_AMERICA"),
  requireAnyFeaturePermission("canViewMaterialCertifications", "canManageMaterialCertifications"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    try {
      const conds: SQL[] = [];
      if (!ctx.isSuperAdmin) conds.push(eq(materialCertifications.organizationId, ctx.orgId!));
      const rows = await db.select({
        status: materialCertifications.buyAmericaStatus,
        count: sql<number>`COUNT(*)::int`,
      }).from(materialCertifications)
        .where(conds.length ? and(...conds) : undefined)
        .groupBy(materialCertifications.buyAmericaStatus);

      const summary = { compliant: 0, waiver: 0, pending: 0, nonCompliant: 0, total: 0 };
      for (const r of rows) {
        const c = Number(r.count) || 0;
        summary.total += c;
        if (r.status === "VERIFIED") summary.compliant = c;
        else if (r.status === "WAIVER_GRANTED" || r.status === "WAIVER_REQUESTED") summary.waiver += c;
        else if (r.status === "PENDING") summary.pending = c;
        else if (r.status === "NON_COMPLIANT") summary.nonCompliant = c;
      }
      const compliancePercent = summary.total > 0 ? (summary.compliant / summary.total) * 100 : 0;
      res.json({ ...summary, compliancePercent });
    } catch (e) {
      logWarn("[heavy-civil/buy-america] failed");
      res.status(500).json({ error: "Failed to load Buy America status" });
    }
  },
);

router.get(
  "/api/dashboard/heavy-civil/expirations",
  requireAuth,
  requireAnyFeaturePermission("canViewSuretyBonds", "canManageSuretyBonds", "canViewDbeGoals", "canManageDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    try {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const ninety = new Date();
      ninety.setDate(ninety.getDate() + 90);
      const ninetyStr = ninety.toISOString().slice(0, 10);

      // Per-dataset gating: must have BOTH the relevant flag AND the matching
      // permission to receive that dataset. This prevents a user with only DBE
      // permission from receiving bond data, and vice versa.
      const effectiveRole = req.user!.effectiveRole || req.user!.role;
      const perms = await getEffectivePermissions(req.user!.id, ctx.orgId, effectiveRole);
      const canBondsPerm = !!(perms.canViewSuretyBonds || perms.canManageSuretyBonds) || ctx.isSuperAdmin;
      const canDbePerm = !!(perms.canViewDbeGoals || perms.canManageDbeGoals) || ctx.isSuperAdmin;

      const [bondsFlagOn, dbeFlagOn] = await Promise.all([
        ctx.isSuperAdmin ? Promise.resolve(true) : isFeatureEnabled(ctx.orgId!, "SURETY_BONDS"),
        ctx.isSuperAdmin ? Promise.resolve(true) : isFeatureEnabled(ctx.orgId!, "DBE_TRACKING"),
      ]);
      const bondsFlag = bondsFlagOn && canBondsPerm;
      const dbeFlag = dbeFlagOn && canDbePerm;

      let bonds: Array<{ id: string; bondNumber: string; bondType: string; suretyCompany: string; expirationDate: string; bondAmount: number; daysUntilExpiry: number }> = [];
      if (bondsFlag) {
        const bondConds: SQL[] = [
          gte(suretyBonds.expirationDate, todayStr),
          lte(suretyBonds.expirationDate, ninetyStr),
          eq(suretyBonds.status, "ACTIVE"),
        ];
        if (!ctx.isSuperAdmin) bondConds.push(eq(suretyBonds.organizationId, ctx.orgId!));
        const bondRows = await db.select({
          id: suretyBonds.id,
          bondNumber: suretyBonds.bondNumber,
          bondType: suretyBonds.bondType,
          suretyCompany: suretyBonds.suretyCompany,
          expirationDate: suretyBonds.expirationDate,
          bondAmount: suretyBonds.bondAmount,
        }).from(suretyBonds).where(and(...bondConds)).orderBy(suretyBonds.expirationDate).limit(20);
        bonds = bondRows.map(b => ({
          id: b.id,
          bondNumber: b.bondNumber,
          bondType: b.bondType,
          suretyCompany: b.suretyCompany,
          expirationDate: String(b.expirationDate),
          bondAmount: Number(b.bondAmount) || 0,
          daysUntilExpiry: Math.ceil((new Date(String(b.expirationDate)).getTime() - today.getTime()) / 86400000),
        }));
      }

      let certifications: Array<{ id: string; organisationName: string; certificationType: string; certifyingAgency: string | null; expirationDate: string; daysUntilExpiry: number }> = [];
      if (dbeFlag) {
        const certConds: SQL[] = [
          gte(crmOrganisationCertifications.expirationDate, todayStr),
          lte(crmOrganisationCertifications.expirationDate, ninetyStr),
        ];
        if (!ctx.isSuperAdmin) certConds.push(eq(crmOrganisationCertifications.organizationId, ctx.orgId!));
        const certRows = await db.select({
          id: crmOrganisationCertifications.id,
          organisationName: crmOrganisations.name,
          certificationType: crmOrganisationCertifications.certificationType,
          certifyingAgency: crmOrganisationCertifications.certifyingAgency,
          expirationDate: crmOrganisationCertifications.expirationDate,
        }).from(crmOrganisationCertifications)
          .innerJoin(crmOrganisations, eq(crmOrganisations.id, crmOrganisationCertifications.crmOrganisationId))
          .where(and(...certConds))
          .orderBy(crmOrganisationCertifications.expirationDate)
          .limit(20);
        certifications = certRows.map(c => ({
          id: c.id,
          organisationName: c.organisationName,
          certificationType: c.certificationType,
          certifyingAgency: c.certifyingAgency,
          expirationDate: String(c.expirationDate),
          daysUntilExpiry: Math.ceil((new Date(String(c.expirationDate)).getTime() - today.getTime()) / 86400000),
        }));
      }

      res.json({
        bondsEnabled: bondsFlag,
        dbeEnabled: dbeFlag,
        bonds,
        certifications,
        totals: {
          bondsExpiringSoon: bonds.length,
          certsExpiringSoon: certifications.length,
        },
      });
    } catch (e) {
      logWarn("[heavy-civil/expirations] failed");
      res.status(500).json({ error: "Failed to load expirations" });
    }
  },
);

// ============================================
// HEAVY-CIVIL PROJECT SUMMARY PDF (per project)
// Streams a printable summary of DBE, haul, IDR, Buy America, and bonds.
// Does not require any single feature flag — sections degrade individually
// based on per-flag enablement so a partial heavy-civil setup still works.
// ============================================

router.get(
  "/api/projects/:projectId/heavy-civil-summary/pdf",
  requireAuth,
  exportLimiter,
  requireAnyFeaturePermission(
    "canViewProjects",
    "canManageProjects",
    "canViewDbeGoals",
    "canManageDbeGoals",
    "canViewHaulTickets",
    "canManageHaulTickets",
    "canApproveHaulTickets",
    "canViewInspectorReports",
    "canManageInspectorReports",
    "canApproveInspectorReports",
    "canViewMaterialCertifications",
    "canManageMaterialCertifications",
    "canViewSuretyBonds",
    "canManageSuretyBonds",
  ),
  async (req: AuthRequest, res: Response) => {
    const ctx = requireOrgOwnership(req, res);
    if (!ctx) return;
    const { projectId } = req.params;

    try {
      const projConds: SQL[] = [eq(projects.id, projectId)];
      if (!ctx.isSuperAdmin) projConds.push(eq(projects.gcOrganizationId, ctx.orgId!));
      const [project] = await db.select().from(projects).where(and(...projConds)).limit(1);
      if (!project) return res.status(404).json({ error: "Project not found" });

      // Optional date range. Defaults to project lifetime (no filter applied).
      // Format: YYYY-MM-DD. If only one bound is provided, the other is left open.
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const startDateRaw = typeof req.query.startDate === "string" ? req.query.startDate : null;
      const endDateRaw = typeof req.query.endDate === "string" ? req.query.endDate : null;
      const startDate = startDateRaw && dateRe.test(startDateRaw) ? startDateRaw : null;
      const endDate = endDateRaw && dateRe.test(endDateRaw) ? endDateRaw : null;

      const orgId = project.gcOrganizationId;
      if (!orgId) return res.status(404).json({ error: "Project not found" });
      const [dbeFlag, haulFlag, idrFlag, baFlag, bondFlag] = await Promise.all([
        isFeatureEnabled(orgId, "DBE_TRACKING"),
        isFeatureEnabled(orgId, "HAUL_TICKETS"),
        isFeatureEnabled(orgId, "DAILY_INSPECTOR_REPORTS"),
        isFeatureEnabled(orgId, "BUY_AMERICA"),
        isFeatureEnabled(orgId, "SURETY_BONDS"),
      ]);

      // Per-section permission gating: each section requires BOTH the
      // org-level feature flag AND the user's matching feature permission.
      // Super admins bypass per-section permission checks but still respect
      // the org's feature flags (so disabled modules stay empty).
      const effectiveRole = ((req.user!.effectiveRole || req.user!.role) || "").toUpperCase();
      const perms = await getEffectivePermissions(req.user!.id, orgId, effectiveRole);
      const isSuper = ctx.isSuperAdmin;
      const can = (...keys: FeaturePermissionKey[]) =>
        isSuper || keys.some(k => perms[k] === true);
      const dbeOn = dbeFlag && can("canViewDbeGoals", "canManageDbeGoals");
      const haulOn = haulFlag && can("canViewHaulTickets", "canManageHaulTickets", "canApproveHaulTickets");
      const idrOn = idrFlag && can("canViewInspectorReports", "canManageInspectorReports", "canApproveInspectorReports");
      const baOn = baFlag && can("canViewMaterialCertifications", "canManageMaterialCertifications");
      const bondOn = bondFlag && can("canViewSuretyBonds", "canManageSuretyBonds");

      // Financial rollup from SOV/pay applications when present.
      const [sovAgg] = await db.select({
        scheduled: sql<number>`COALESCE(SUM(${sovLineItems.scheduledValue}), 0)::float`,
        completed: sql<number>`COALESCE(SUM(${sovLineItems.totalCompletedAndStored}), 0)::float`,
      }).from(sovLineItems)
        .innerJoin(scheduleOfValues, eq(scheduleOfValues.id, sovLineItems.sovId))
        .where(eq(scheduleOfValues.projectId, projectId));

      const budget = project.budget ? Number(project.budget) : null;
      const contractSumToDate = sovAgg?.scheduled ? Number(sovAgg.scheduled) : null;
      const totalCompletedToDate = sovAgg?.completed ? Number(sovAgg.completed) : null;
      const percentComplete = contractSumToDate && contractSumToDate > 0 && totalCompletedToDate != null
        ? (totalCompletedToDate / contractSumToDate) * 100
        : 0;

      // DBE
      let dbeSection: HeavyCivilProjectSummaryData["dbe"] = {
        enabled: dbeOn, goals: [], totalGoalPercent: 0, totalAwardedPercent: 0,
      };
      if (dbeOn) {
        const goals = await db.select().from(projectDbeGoals).where(eq(projectDbeGoals.projectId, projectId));

        // Compute actual awarded dollars per cert type for THIS project, by
        // joining subcontractorContracts -> crmOrganisationCertifications.
        // Apply the same date range to subcontractor contracts so the awarded
        // dollars in the DBE section match the report period. Filters by
        // contract start date if set, otherwise falls back to createdAt.
        const dbeDateExpr = sql`COALESCE(${subcontractorContracts.startDate}, ${subcontractorContracts.createdAt})`;
        // Validity is checked at contract award time (start_date, falling back
        // to created_at) rather than "today" so historical awards remain
        // credited even if the cert has since expired.
        const dbeConds: SQL[] = [
          eq(subcontractorContracts.projectId, projectId),
          sql`${subcontractorContracts.status} <> 'TERMINATED'`,
          sql`(${crmOrganisationCertifications.effectiveDate} IS NULL OR ${crmOrganisationCertifications.effectiveDate} <= ${dbeDateExpr})`,
          sql`(${crmOrganisationCertifications.expirationDate} IS NULL OR ${crmOrganisationCertifications.expirationDate} >= ${dbeDateExpr})`,
          eq(crmOrganisationCertifications.organizationId, orgId),
        ];
        if (startDate) dbeConds.push(sql`${dbeDateExpr} >= ${startDate}::timestamptz`);
        if (endDate) dbeConds.push(sql`${dbeDateExpr} <= (${endDate}::date + INTERVAL '1 day')::timestamptz`);
        const paidRows = await db.selectDistinct({
          contractId: subcontractorContracts.id,
          certificationType: crmOrganisationCertifications.certificationType,
          contractAmount: subcontractorContracts.contractAmount,
        }).from(subcontractorContracts)
          .innerJoin(crmOrganisationCertifications, eq(crmOrganisationCertifications.crmOrganisationId, subcontractorContracts.subcontractorId))
          .where(and(...dbeConds));
        const paidByType = new Map<string, number>();
        let totalAwarded = 0;
        for (const r of paidRows) {
          const amt = Number(r.contractAmount) || 0;
          paidByType.set(r.certificationType, (paidByType.get(r.certificationType) || 0) + amt);
          totalAwarded += amt;
        }

        let totalGP = 0;
        let totalGoalDollars = 0;
        dbeSection.goals = goals.map(g => {
          const gp = Number(g.goalPercent) || 0;
          const gd = Number(g.goalDollars) || 0;
          totalGP += gp;
          totalGoalDollars += gd;
          const awarded = paidByType.get(g.certificationType) || 0;
          return {
            certificationType: g.certificationType,
            goalPercent: gp,
            awardedDollars: awarded,
            awardedPercent: gd > 0 ? (awarded / gd) * 100 : 0,
          };
        });
        dbeSection.totalGoalPercent = totalGP;
        dbeSection.totalAwardedPercent = totalGoalDollars > 0 ? (totalAwarded / totalGoalDollars) * 100 : 0;
      }

      // Haul
      let haulSection: HeavyCivilProjectSummaryData["haul"] = {
        enabled: haulOn, totalTickets: 0, pendingApproval: 0, totalQuantity: 0, totalCost: 0, byMaterial: [],
      };
      if (haulOn) {
        const haulConds: SQL[] = [eq(haulTickets.projectId, projectId)];
        if (startDate) haulConds.push(gte(haulTickets.ticketDate, startDate));
        if (endDate) haulConds.push(lte(haulTickets.ticketDate, endDate));
        const [agg] = await db.select({
          total: sql<number>`COUNT(*)::int`,
          pending: sql<number>`SUM(CASE WHEN ${haulTickets.status} = 'SUBMITTED' THEN 1 ELSE 0 END)::int`,
          qty: sql<number>`COALESCE(SUM(${haulTickets.quantity}), 0)::float`,
          cost: sql<number>`COALESCE(SUM(${haulTickets.totalCost}), 0)::float`,
        }).from(haulTickets).where(and(...haulConds));
        const byMaterial = await db.select({
          material: haulTickets.materialClass,
          unit: haulTickets.unit,
          quantity: sql<number>`COALESCE(SUM(${haulTickets.quantity}), 0)::float`,
          cost: sql<number>`COALESCE(SUM(${haulTickets.totalCost}), 0)::float`,
        }).from(haulTickets)
          .where(and(...haulConds))
          .groupBy(haulTickets.materialClass, haulTickets.unit)
          .orderBy(desc(sql`SUM(${haulTickets.totalCost})`))
          .limit(8);
        haulSection = {
          enabled: true,
          totalTickets: agg?.total ?? 0,
          pendingApproval: agg?.pending ?? 0,
          totalQuantity: Number(agg?.qty ?? 0),
          totalCost: Number(agg?.cost ?? 0),
          byMaterial: byMaterial.map(m => ({
            material: m.material,
            unit: m.unit,
            quantity: Number(m.quantity),
            cost: Number(m.cost),
          })),
        };
      }

      // IDR
      let idrSection: HeavyCivilProjectSummaryData["idr"] = {
        enabled: idrOn, totalReports: 0, last30Days: 0, last30DaysExpected: 30, streakDays: 0, lastSubmittedDate: null,
      };
      if (idrOn) {
        const thirty = new Date();
        thirty.setDate(thirty.getDate() - 30);
        const thirtyStr = thirty.toISOString().slice(0, 10);
        const idrConds: SQL[] = [eq(dailyInspectorReports.projectId, projectId)];
        if (startDate) idrConds.push(gte(dailyInspectorReports.reportDate, startDate));
        if (endDate) idrConds.push(lte(dailyInspectorReports.reportDate, endDate));
        const [agg] = await db.select({
          total: sql<number>`COUNT(*)::int`,
          last30: sql<number>`SUM(CASE WHEN ${dailyInspectorReports.reportDate} >= ${thirtyStr} THEN 1 ELSE 0 END)::int`,
          last: sql<string | null>`MAX(${dailyInspectorReports.reportDate})`,
        }).from(dailyInspectorReports).where(and(...idrConds));

        const dateRows = await db.selectDistinct({ d: dailyInspectorReports.reportDate })
          .from(dailyInspectorReports)
          .where(and(...idrConds))
          .orderBy(desc(dailyInspectorReports.reportDate))
          .limit(120);
        const dateSet = new Set<string>(dateRows.map(r => String(r.d)));
        let streak = 0;
        const cursor = new Date();
        const isWorkingDay = (dt: Date) => { const d = dt.getDay(); return d !== 0 && d !== 6; };
        if (isWorkingDay(cursor) && !dateSet.has(cursor.toISOString().slice(0, 10))) {
          cursor.setDate(cursor.getDate() - 1);
        }
        for (let i = 0; i < 365; i++) {
          if (!isWorkingDay(cursor)) { cursor.setDate(cursor.getDate() - 1); continue; }
          if (dateSet.has(cursor.toISOString().slice(0, 10))) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
          } else { break; }
        }
        idrSection = {
          enabled: true,
          totalReports: agg?.total ?? 0,
          last30Days: agg?.last30 ?? 0,
          last30DaysExpected: 30,
          streakDays: streak,
          lastSubmittedDate: agg?.last ?? null,
        };
      }

      // Buy America
      let baSection: HeavyCivilProjectSummaryData["buyAmerica"] = {
        enabled: baOn, total: 0, compliant: 0, waiver: 0, pending: 0, nonCompliant: 0,
      };
      if (baOn) {
        const baConds: SQL[] = [eq(materialCertifications.projectId, projectId)];
        if (startDate) baConds.push(gte(materialCertifications.receivedDate, startDate));
        if (endDate) baConds.push(lte(materialCertifications.receivedDate, endDate));
        const rows = await db.select({
          status: materialCertifications.buyAmericaStatus,
          count: sql<number>`COUNT(*)::int`,
        }).from(materialCertifications)
          .where(and(...baConds))
          .groupBy(materialCertifications.buyAmericaStatus);
        for (const r of rows) {
          const c = Number(r.count) || 0;
          baSection.total += c;
          if (r.status === "VERIFIED") baSection.compliant = c;
          else if (r.status === "WAIVER_GRANTED" || r.status === "WAIVER_REQUESTED") baSection.waiver += c;
          else if (r.status === "PENDING") baSection.pending = c;
          else if (r.status === "NON_COMPLIANT") baSection.nonCompliant = c;
        }
      }

      // Bonds
      let bondSection: HeavyCivilProjectSummaryData["bonds"] = {
        enabled: bondOn, active: 0, totalAmount: 0, expiringSoon: [],
      };
      if (bondOn) {
        const bondConds: SQL[] = [eq(suretyBonds.projectId, projectId), eq(suretyBonds.status, "ACTIVE")];
        const [agg] = await db.select({
          active: sql<number>`COUNT(*)::int`,
          total: sql<number>`COALESCE(SUM(${suretyBonds.bondAmount}), 0)::float`,
        }).from(suretyBonds).where(and(...bondConds));
        const today = new Date();
        const ninety = new Date();
        ninety.setDate(ninety.getDate() + 90);
        const expiring = await db.select().from(suretyBonds).where(and(
          eq(suretyBonds.projectId, projectId),
          eq(suretyBonds.status, "ACTIVE"),
          gte(suretyBonds.expirationDate, today.toISOString().slice(0, 10)),
          lte(suretyBonds.expirationDate, ninety.toISOString().slice(0, 10)),
        )).orderBy(suretyBonds.expirationDate).limit(8);
        bondSection = {
          enabled: true,
          active: agg?.active ?? 0,
          totalAmount: Number(agg?.total ?? 0),
          expiringSoon: expiring.map(b => ({
            bondNumber: b.bondNumber,
            bondType: b.bondType,
            suretyCompany: b.suretyCompany,
            expirationDate: String(b.expirationDate),
            bondAmount: Number(b.bondAmount) || 0,
          })),
        };
      }

      const data: HeavyCivilProjectSummaryData = {
        projectName: project.name,
        projectCode: project.code ?? null,
        clientName: project.clientName ?? null,
        location: project.locationAddress ?? null,
        status: project.status,
        startDate: project.startDate ? new Date(project.startDate).toISOString() : null,
        endDate: project.endDate ? new Date(project.endDate).toISOString() : null,
        budget,
        contractSumToDate,
        totalCompletedToDate,
        percentComplete,
        dbe: dbeSection,
        haul: haulSection,
        idr: idrSection,
        buyAmerica: baSection,
        bonds: bondSection,
        certifications: [],
      };

      const stream = generateHeavyCivilProjectSummaryPDF(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="heavy-civil-summary-${projectId}.pdf"`);
      stream.pipe(res);
    } catch (e) {
      logWarn("[heavy-civil-summary/pdf] failed", { projectId });
      res.status(500).json({ error: "Failed to generate Heavy-Civil summary PDF" });
    }
  },
);

export default router;
