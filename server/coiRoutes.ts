import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  insuranceCertificates,
  insuranceCertificateCoverages,
  projectInsuranceRequirements,
  coiReminderLog,
  coiComplianceOverrides,
  insertInsuranceCertificateSchema,
  insertProjectInsuranceRequirementSchema,
  insertCoiComplianceOverrideSchema,
  COI_REMINDER_DAY_BUCKETS,
  COI_EXPIRING_WINDOW_DAYS,
  type InsuranceCertificate,
  type InsuranceCertificateCoverage,
  type ProjectInsuranceRequirement,
  projects,
  crmContacts,
  crmOrganisations,
  subcontractors,
  subcontractorContracts,
  purchaseOrders,
  users,
} from "@shared/schema";
import { type AuthRequest, requireAuth, requireFeaturePermission, requireRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { asyncHandler } from "./utils/asyncHandler";
import { sensitiveLimiter } from "./rateLimiter";
import { logAudit, logCreate, logUpdate, logDelete } from "./auditLogger";
import { extractCoiFromDocument } from "./services/coiAiExtractor";
import { isPromptInjectionRefusal } from "./ai/promptInjectionGuard";
import { sendEmail } from "./services/emailService";
import { logError, logInfo } from "./utils/logger";

const router = Router();

// ---------- helpers ----------

function isExpired(d: string | Date): boolean {
  const t = new Date(d).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function daysUntil(d: string | Date): number {
  const t = new Date(d).getTime();
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
}

function deriveCertStatus(c: { expiryDate: string | Date }): "ACTIVE" | "EXPIRING" | "EXPIRED" {
  const days = daysUntil(c.expiryDate);
  if (days < 0) return "EXPIRED";
  if (days <= COI_EXPIRING_WINDOW_DAYS) return "EXPIRING";
  return "ACTIVE";
}

interface PartyComplianceCoverage {
  coverageType: string;
  required: boolean;
  minPerOccurrence: string | null;
  minAggregate: string | null;
  requiresAdditionalInsured: boolean;
  requiresWaiverOfSubrogation: boolean;
  requiresPrimaryNonContributory: boolean;
  certificateId: string | null;
  perOccurrenceLimit: string | null;
  aggregateLimit: string | null;
  expiryDate: string | null;
  status: "COMPLIANT" | "EXPIRING" | "EXPIRED" | "MISSING";
  reasons: string[];
}

interface PartyComplianceResult {
  partyType: string;
  partyId: string;
  partyName: string;
  status: "COMPLIANT" | "EXPIRING" | "EXPIRED" | "MISSING";
  coverages: PartyComplianceCoverage[];
}

const NUM = (v: string | null | undefined) => (v == null ? null : Number(v));

function computePartyCompliance(
  partyType: string,
  partyId: string,
  partyName: string,
  requirements: ProjectInsuranceRequirement[],
  certs: Array<InsuranceCertificate & { coverages: InsuranceCertificateCoverage[] }>,
): PartyComplianceResult {
  const coverages: PartyComplianceCoverage[] = [];

  for (const req of requirements) {
    if (!req.required) continue;

    const candidates = certs
      .filter((c) => c.status !== "REVOKED")
      .filter((c) => c.coverages.some((cov) => cov.coverageType === req.coverageType));

    let bestStatus: PartyComplianceCoverage["status"] = "MISSING";
    let pickedCert: (typeof candidates)[number] | null = null;
    let pickedCov: InsuranceCertificateCoverage | null = null;
    const reasons: string[] = [];

    for (const cert of candidates) {
      const cov = cert.coverages.find((c) => c.coverageType === req.coverageType)!;
      const candidateReasons: string[] = [];
      let candidateStatus: PartyComplianceCoverage["status"] = "COMPLIANT";

      const days = daysUntil(cert.expiryDate);
      if (days < 0) {
        candidateStatus = "EXPIRED";
        candidateReasons.push(`Expired ${Math.abs(days)}d ago`);
      } else if (days <= COI_EXPIRING_WINDOW_DAYS) {
        candidateStatus = "EXPIRING";
        candidateReasons.push(`Expires in ${days}d`);
      }

      if (req.minPerOccurrence != null) {
        const min = Number(req.minPerOccurrence);
        const have = NUM(cov.perOccurrenceLimit);
        if (have == null || have < min) {
          candidateReasons.push(`Per-occurrence ${have ?? 0} < required ${min}`);
          if (candidateStatus === "COMPLIANT") candidateStatus = "MISSING";
        }
      }
      if (req.minAggregate != null) {
        const min = Number(req.minAggregate);
        const have = NUM(cov.aggregateLimit);
        if (have == null || have < min) {
          candidateReasons.push(`Aggregate ${have ?? 0} < required ${min}`);
          if (candidateStatus === "COMPLIANT") candidateStatus = "MISSING";
        }
      }
      if (req.requiresAdditionalInsured && !cert.additionalInsured) {
        candidateReasons.push("Additional insured not endorsed");
        if (candidateStatus === "COMPLIANT") candidateStatus = "MISSING";
      }
      if (req.requiresWaiverOfSubrogation && !cert.waiverOfSubrogation) {
        candidateReasons.push("Waiver of subrogation missing");
        if (candidateStatus === "COMPLIANT") candidateStatus = "MISSING";
      }
      if (req.requiresPrimaryNonContributory && !cert.primaryNonContributory) {
        candidateReasons.push("Primary & non-contributory missing");
        if (candidateStatus === "COMPLIANT") candidateStatus = "MISSING";
      }

      const rank = (s: PartyComplianceCoverage["status"]) =>
        s === "COMPLIANT" ? 0 : s === "EXPIRING" ? 1 : s === "EXPIRED" ? 2 : 3;
      if (rank(candidateStatus) < rank(bestStatus)) {
        bestStatus = candidateStatus;
        pickedCert = cert;
        pickedCov = cov;
        reasons.length = 0;
        reasons.push(...candidateReasons);
      }
    }

    if (!pickedCert) {
      reasons.push("No certificate on file for this coverage");
    }

    coverages.push({
      coverageType: req.coverageType,
      required: req.required,
      minPerOccurrence: req.minPerOccurrence,
      minAggregate: req.minAggregate,
      requiresAdditionalInsured: req.requiresAdditionalInsured,
      requiresWaiverOfSubrogation: req.requiresWaiverOfSubrogation,
      requiresPrimaryNonContributory: req.requiresPrimaryNonContributory,
      certificateId: pickedCert?.id ?? null,
      perOccurrenceLimit: pickedCov?.perOccurrenceLimit ?? null,
      aggregateLimit: pickedCov?.aggregateLimit ?? null,
      expiryDate: pickedCert ? String(pickedCert.expiryDate) : null,
      status: bestStatus,
      reasons,
    });
  }

  const partyStatus = (() => {
    if (coverages.length === 0) return "COMPLIANT" as const;
    if (coverages.some((c) => c.status === "EXPIRED" || c.status === "MISSING")) {
      return coverages.some((c) => c.status === "MISSING") ? "MISSING" : "EXPIRED";
    }
    if (coverages.some((c) => c.status === "EXPIRING")) return "EXPIRING";
    return "COMPLIANT";
  })();

  return { partyType, partyId, partyName, status: partyStatus, coverages };
}

async function loadCertsForParties(
  orgId: string,
  parties: Array<{ partyType: string; partyId: string }>,
): Promise<Map<string, Array<InsuranceCertificate & { coverages: InsuranceCertificateCoverage[] }>>> {
  if (parties.length === 0) return new Map();
  const keys = new Set(parties.map((p) => `${p.partyType}:${p.partyId}`));

  const rows = await db
    .select()
    .from(insuranceCertificates)
    .where(eq(insuranceCertificates.organizationId, orgId));

  const filtered = rows.filter((r) => keys.has(`${r.partyType}:${r.partyId}`));
  const certIds = filtered.map((c) => c.id);
  const cov = certIds.length
    ? await db
        .select()
        .from(insuranceCertificateCoverages)
        .where(inArray(insuranceCertificateCoverages.certificateId, certIds))
    : [];

  const covByCert = new Map<string, InsuranceCertificateCoverage[]>();
  for (const c of cov) {
    const list = covByCert.get(c.certificateId) ?? [];
    list.push(c);
    covByCert.set(c.certificateId, list);
  }

  const out = new Map<string, Array<InsuranceCertificate & { coverages: InsuranceCertificateCoverage[] }>>();
  for (const cert of filtered) {
    const key = `${cert.partyType}:${cert.partyId}`;
    const list = out.get(key) ?? [];
    list.push({ ...cert, coverages: covByCert.get(cert.id) ?? [] });
    out.set(key, list);
  }
  return out;
}

// ---------- Public service (used by gating hooks elsewhere) ----------

export async function getPartyComplianceForProject(
  orgId: string,
  projectId: string,
  partyType: "SUBCONTRACTOR" | "VENDOR" | "CRM_ORG",
  partyId: string,
  partyName: string,
): Promise<PartyComplianceResult> {
  const reqs = await db
    .select()
    .from(projectInsuranceRequirements)
    .where(
      and(
        eq(projectInsuranceRequirements.organizationId, orgId),
        eq(projectInsuranceRequirements.projectId, projectId),
      ),
    );
  const certMap = await loadCertsForParties(orgId, [{ partyType, partyId }]);
  const certs = certMap.get(`${partyType}:${partyId}`) ?? [];
  return computePartyCompliance(partyType, partyId, partyName, reqs, certs);
}

export async function hasActiveOverride(
  orgId: string,
  entityType: "PAY_APPLICATION" | "PURCHASE_ORDER" | "SUBCONTRACTOR_PAYMENT",
  entityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: coiComplianceOverrides.id, expiresAt: coiComplianceOverrides.expiresAt })
    .from(coiComplianceOverrides)
    .where(
      and(
        eq(coiComplianceOverrides.organizationId, orgId),
        eq(coiComplianceOverrides.entityType, entityType),
        eq(coiComplianceOverrides.entityId, entityId),
      ),
    )
    .orderBy(desc(coiComplianceOverrides.createdAt))
    .limit(1);
  if (!row) return false;
  if (!row.expiresAt) return true;
  return new Date(row.expiresAt).getTime() > Date.now();
}

// ---------- Routes ----------

// List certificates (with optional party filter)
router.get(
  "/certificates",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Forbidden" });

    const partyType = (req.query.partyType as string) || undefined;
    const partyId = (req.query.partyId as string) || undefined;

    const conds = [];
    if (!isSuperAdmin && orgId) conds.push(eq(insuranceCertificates.organizationId, orgId));
    if (partyType && (partyType === "SUBCONTRACTOR" || partyType === "VENDOR" || partyType === "CRM_ORG")) {
      conds.push(eq(insuranceCertificates.partyType, partyType));
    }
    if (partyId) conds.push(eq(insuranceCertificates.partyId, partyId));

    const certs = await db
      .select()
      .from(insuranceCertificates)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(insuranceCertificates.expiryDate));

    const ids = certs.map((c) => c.id);
    const covs = ids.length
      ? await db
          .select()
          .from(insuranceCertificateCoverages)
          .where(inArray(insuranceCertificateCoverages.certificateId, ids))
      : [];

    const byCert = new Map<string, InsuranceCertificateCoverage[]>();
    for (const c of covs) {
      const list = byCert.get(c.certificateId) ?? [];
      list.push(c);
      byCert.set(c.certificateId, list);
    }

    res.json(
      certs.map((c) => ({
        ...c,
        derivedStatus: deriveCertStatus(c),
        daysUntilExpiry: daysUntil(c.expiryDate),
        coverages: byCert.get(c.id) ?? [],
      })),
    );
  }),
);

// Create certificate (with coverages)
const createCertSchema = insertInsuranceCertificateSchema.extend({
  coverages: z
    .array(
      z.object({
        coverageType: z.enum([
          "GENERAL_LIABILITY",
          "AUTO_LIABILITY",
          "WORKERS_COMP",
          "UMBRELLA",
          "PROFESSIONAL",
          "POLLUTION",
          "BUILDERS_RISK",
          "CYBER",
          "OTHER",
        ]),
        perOccurrenceLimit: z.string().nullable().optional(),
        aggregateLimit: z.string().nullable().optional(),
        deductible: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

router.post(
  "/certificates",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });

    const parsed = createCertSchema.safeParse({
      ...req.body,
      organizationId: orgId,
      uploadedById: req.user!.id,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const { coverages, ...certInput } = parsed.data;
    const status = deriveCertStatus({ expiryDate: String(certInput.expiryDate) });

    const [cert] = await db
      .insert(insuranceCertificates)
      .values({ ...certInput, status, confirmedAt: new Date(), confirmedById: req.user!.id })
      .returning();
    if (coverages.length) {
      await db.insert(insuranceCertificateCoverages).values(
        coverages.map((c) => ({
          certificateId: cert.id,
          ...c,
        })),
      );
    }
    await logCreate(req.user!.id, "insurance_certificate", cert.id, cert, req);
    res.status(201).json({ ...cert, coverages });
  }),
);

// Update certificate
router.patch(
  "/certificates/:id",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Forbidden" });

    const where = isSuperAdmin
      ? eq(insuranceCertificates.id, req.params.id)
      : and(
          eq(insuranceCertificates.id, req.params.id),
          eq(insuranceCertificates.organizationId, orgId!),
        );

    const [existing] = await db.select().from(insuranceCertificates).where(where);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const allowed = [
      "carrier",
      "policyNumber",
      "effectiveDate",
      "expiryDate",
      "additionalInsured",
      "waiverOfSubrogation",
      "primaryNonContributory",
      "notes",
      "status",
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    if (patch.expiryDate) {
      patch.status = deriveCertStatus({ expiryDate: String(patch.expiryDate) });
    }
    patch.updatedAt = new Date();

    const [updated] = await db
      .update(insuranceCertificates)
      .set(patch)
      .where(where)
      .returning();

    await logUpdate(req.user!.id, "insurance_certificate", updated.id, existing, updated, req);
    res.json(updated);
  }),
);

// Delete certificate
router.delete(
  "/certificates/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Forbidden" });

    const where = isSuperAdmin
      ? eq(insuranceCertificates.id, req.params.id)
      : and(
          eq(insuranceCertificates.id, req.params.id),
          eq(insuranceCertificates.organizationId, orgId!),
        );

    const [existing] = await db.select().from(insuranceCertificates).where(where);
    if (!existing) return res.status(404).json({ error: "Not found" });

    await db.delete(insuranceCertificates).where(where);
    await logDelete(req.user!.id, "insurance_certificate", existing.id, existing, req);
    res.json({ success: true });
  }),
);

// AI extract from uploaded document
router.post(
  "/extract",
  requireAuth,
  sensitiveLimiter,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });
    const { documentUrl, documentName } = req.body as { documentUrl?: string; documentName?: string };
    if (!documentUrl || !documentName) {
      return res.status(400).json({ error: "documentUrl and documentName required" });
    }
    try {
      const extracted = await extractCoiFromDocument(documentUrl, documentName, {
        orgId,
        userId: req.user!.id,
      });
      res.json(extracted);
    } catch (err) {
      if (isPromptInjectionRefusal(err)) {
        return res.status(422).json({ error: "Document refused: prompt-injection content detected" });
      }
      logError("COI extract failed", { documentName }, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Extraction failed" });
    }
  }),
);

// Project insurance requirements
router.get(
  "/projects/:projectId/requirements",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Forbidden" });
    const conds = [eq(projectInsuranceRequirements.projectId, req.params.projectId)];
    if (!isSuperAdmin && orgId) conds.push(eq(projectInsuranceRequirements.organizationId, orgId));
    const reqs = await db
      .select()
      .from(projectInsuranceRequirements)
      .where(and(...conds));
    res.json(reqs);
  }),
);

router.put(
  "/projects/:projectId/requirements",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, req.params.projectId), eq(projects.gcOrganizationId, orgId)));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const items = z.array(insertProjectInsuranceRequirementSchema.partial({ organizationId: true, projectId: true })).safeParse(
      req.body?.requirements,
    );
    if (!items.success) {
      return res.status(400).json({ error: "Invalid payload", details: items.error.flatten() });
    }

    await db
      .delete(projectInsuranceRequirements)
      .where(
        and(
          eq(projectInsuranceRequirements.organizationId, orgId),
          eq(projectInsuranceRequirements.projectId, req.params.projectId),
        ),
      );
    if (items.data.length) {
      const rows = items.data.map((it) => ({
        ...it,
        organizationId: orgId,
        projectId: req.params.projectId,
        coverageType: it.coverageType!,
      }));
      await db.insert(projectInsuranceRequirements).values(rows);
    }
    await logUpdate(
      req.user!.id,
      "project_insurance_requirements",
      req.params.projectId,
      null,
      items.data,
      req,
    );
    const updated = await db
      .select()
      .from(projectInsuranceRequirements)
      .where(
        and(
          eq(projectInsuranceRequirements.organizationId, orgId),
          eq(projectInsuranceRequirements.projectId, req.params.projectId),
        ),
      );
    res.json(updated);
  }),
);

// Per-project compliance per party. Sources party list from project
// assignments (subcontractor_contracts + purchase_orders) so parties
// with NO certificates on file are still surfaced as MISSING.
router.get(
  "/projects/:projectId/compliance",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });

    const reqs = await db
      .select()
      .from(projectInsuranceRequirements)
      .where(
        and(
          eq(projectInsuranceRequirements.organizationId, orgId),
          eq(projectInsuranceRequirements.projectId, req.params.projectId),
        ),
      );

    const { evaluateProjectCoiCompliance } = await import("./services/coiGating");
    let extra: { partyType: "SUBCONTRACTOR" | "VENDOR" | "CRM_ORG"; partyId: string; partyName: string } | undefined;
    const qPartyType = String(req.query.partyType ?? "");
    if ((qPartyType === "SUBCONTRACTOR" || qPartyType === "VENDOR" || qPartyType === "CRM_ORG") && req.query.partyId) {
      extra = {
        partyType: qPartyType,
        partyId: String(req.query.partyId),
        partyName: String(req.query.partyName || "(scoped)"),
      };
    }
    const decision = await evaluateProjectCoiCompliance(orgId, req.params.projectId, extra);
    res.json({ requirements: reqs, status: decision.status, parties: decision.parties });
  }),
);

// Org-wide compliance dashboard
// Org-wide compliance dashboard. Project-party compliance centric:
// the summary counts each (project, party) pair in its computed
// status bucket, and the `parties` payload lists every non-compliant
// (project, party) so the UI can show "Missing" entries for parties
// that have no certificate on file at all.
router.get(
  "/dashboard",
  requireAuth,
  requireFeaturePermission("canViewComplianceDashboard"),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });

    const { evaluateProjectCoiCompliance } = await import("./services/coiGating");
    const { isFeatureEnabled } = await import("./services/featureFlagService");
    const enforce = await isFeatureEnabled(orgId, "COI_COMPLIANCE_HOLD").catch(() => false);

    const projRows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.gcOrganizationId, orgId));

    const summary = { compliant: 0, expiring: 0, expired: 0, missing: 0, projectsEvaluated: projRows.length };
    const partyRows: Array<{
      projectId: string;
      projectName: string;
      partyType: string;
      partyId: string;
      partyName: string;
      status: "COMPLIANT" | "EXPIRING" | "EXPIRED" | "MISSING";
      reasons: string[];
    }> = [];

    for (const proj of projRows) {
      const decision = await evaluateProjectCoiCompliance(orgId, proj.id);
      for (const p of decision.parties) {
        if (p.status === "COMPLIANT") summary.compliant++;
        else if (p.status === "EXPIRING") summary.expiring++;
        else if (p.status === "EXPIRED") summary.expired++;
        else summary.missing++;
        partyRows.push({
          projectId: proj.id,
          projectName: proj.name,
          partyType: p.partyType,
          partyId: p.partyId,
          partyName: p.partyName,
          status: p.status,
          reasons: p.reasons,
        });
      }
    }

    // Also include the raw certificate list for the bulk-reminder UX.
    const certs = await db
      .select()
      .from(insuranceCertificates)
      .where(eq(insuranceCertificates.organizationId, orgId))
      .orderBy(insuranceCertificates.expiryDate);
    const certificates = certs.map((c) => ({
      id: c.id,
      partyType: c.partyType,
      partyId: c.partyId,
      partyName: c.partyName,
      carrier: c.carrier,
      policyNumber: c.policyNumber,
      expiryDate: c.expiryDate,
      daysUntilExpiry: daysUntil(c.expiryDate),
      status: deriveCertStatus(c),
      additionalInsured: c.additionalInsured,
      waiverOfSubrogation: c.waiverOfSubrogation,
    }));

    res.json({ summary, parties: partyRows, certificates, enforcementEnabled: enforce });
  }),
);

// CSV export
router.get(
  "/dashboard.csv",
  requireAuth,
  requireFeaturePermission("canViewComplianceDashboard"),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });
    const certs = await db
      .select()
      .from(insuranceCertificates)
      .where(eq(insuranceCertificates.organizationId, orgId))
      .orderBy(insuranceCertificates.expiryDate);

    const header = [
      "id",
      "party_type",
      "party_name",
      "carrier",
      "policy_number",
      "effective_date",
      "expiry_date",
      "days_until_expiry",
      "status",
      "additional_insured",
      "waiver_of_subrogation",
    ];
    const rows = certs.map((c) =>
      [
        c.id,
        c.partyType,
        c.partyName,
        c.carrier,
        c.policyNumber,
        c.effectiveDate,
        c.expiryDate,
        daysUntil(c.expiryDate),
        deriveCertStatus(c),
        c.additionalInsured,
        c.waiverOfSubrogation,
      ]
        .map((v) => {
          const s = String(v ?? "");
          return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="coi-compliance-${Date.now()}.csv"`);
    res.send([header.join(","), ...rows].join("\n"));
  }),
);

// Bulk reminder send
const bulkReminderSchema = z.object({
  certificateIds: z.array(z.string()).min(1).max(500),
  recipients: z.array(z.string().email()).min(1).max(50).optional(),
  message: z.string().max(2000).optional(),
});

router.post(
  "/reminders/bulk",
  requireAuth,
  requireFeaturePermission("canViewComplianceDashboard"),
  sensitiveLimiter,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });
    const parsed = bulkReminderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

    const certs = await db
      .select()
      .from(insuranceCertificates)
      .where(
        and(
          eq(insuranceCertificates.organizationId, orgId),
          inArray(insuranceCertificates.id, parsed.data.certificateIds),
        ),
      );

    let sent = 0;
    let failed = 0;
    for (const cert of certs) {
      const recips =
        parsed.data.recipients && parsed.data.recipients.length > 0
          ? parsed.data.recipients
          : await resolvePartyRecipients(orgId, cert.partyType, cert.partyId);
      if (recips.length === 0) continue;
      try {
        await sendEmail({
          to: recips,
          subject: `Insurance certificate reminder: ${cert.carrier} ${cert.policyNumber}`,
          html: renderReminderEmail(cert, parsed.data.message),
        });
        for (const r of recips) {
          await db
            .insert(coiReminderLog)
            .values({ certificateId: cert.id, daysBeforeExpiry: -1, recipient: r, ok: true })
            .onConflictDoNothing();
        }
        sent++;
      } catch (err) {
        failed++;
        logError(
          "Bulk COI reminder send failed",
          { certificateId: cert.id },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
    await logAudit(
      {
        userId: req.user!.id,
        entityType: "coi_reminders_bulk",
        entityId: orgId,
        action: "CREATE",
        oldValue: null,
        newValue: JSON.stringify({ requested: parsed.data.certificateIds.length, sent, failed }),
      },
      req,
    );
    res.json({ sent, failed, total: certs.length });
  }),
);

// Compliance hold override (audit-logged)
router.post(
  "/overrides",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });
    const parsed = insertCoiComplianceOverrideSchema
      .extend({ reason: z.string().min(10) })
      .safeParse({ ...req.body, organizationId: orgId, createdById: req.user!.id });
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    const [row] = await db.insert(coiComplianceOverrides).values(parsed.data).returning();
    await logAudit(
      {
        userId: req.user!.id,
        entityType: parsed.data.entityType.toLowerCase(),
        entityId: parsed.data.entityId,
        action: "OVERRIDE_COMPLIANCE_HOLD",
        oldValue: null,
        newValue: JSON.stringify({
          reason: parsed.data.reason,
          partyType: parsed.data.partyType,
          partyId: parsed.data.partyId,
          expiresAt: parsed.data.expiresAt,
          overrideId: row.id,
        }),
      },
      req,
    );
    res.status(201).json(row);
  }),
);

router.get(
  "/overrides",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Forbidden" });
    const conds = [eq(coiComplianceOverrides.organizationId, orgId)];
    const qEntityType = String(req.query.entityType ?? "");
    if (qEntityType === "PAY_APPLICATION" || qEntityType === "PURCHASE_ORDER" || qEntityType === "SUBCONTRACTOR_PAYMENT") {
      conds.push(eq(coiComplianceOverrides.entityType, qEntityType));
    }
    if (req.query.entityId) {
      conds.push(eq(coiComplianceOverrides.entityId, req.query.entityId as string));
    }
    const rows = await db
      .select()
      .from(coiComplianceOverrides)
      .where(and(...conds))
      .orderBy(desc(coiComplianceOverrides.createdAt));
    res.json(rows);
  }),
);

/**
 * Resolve recipient emails for a party. The same legal entity may be
 * filed under SUBCONTRACTOR, VENDOR, or CRM_ORG, so we look in every
 * canonical contact source. Sources tried (in order):
 *   1. `subcontractors.email` keyed by the same id (covers SUB rows
 *      and the common case where CRM_ORG / VENDOR ids match).
 *   2. `crm_contacts` rows linked to the matching CRM organisation
 *      (`isPrimary` first, then any contact with an email). This is
 *      the canonical contact source for CRM_ORG / VENDOR.
 */
async function resolvePartyRecipients(orgId: string, partyType: string, partyId: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const [sub] = await db
      .select({ email: subcontractors.email })
      .from(subcontractors)
      .where(eq(subcontractors.id, partyId));
    if (sub?.email) out.add(sub.email.trim().toLowerCase());

    if (partyType === "CRM_ORG" || partyType === "VENDOR" || partyType === "SUBCONTRACTOR") {
      const contactRows = await db
        .select({ email: crmContacts.email, isPrimary: crmContacts.isPrimary })
        .from(crmContacts)
        .where(
          and(
            eq(crmContacts.organizationId, orgId),
            eq(crmContacts.organisationId, partyId),
            isNotNull(crmContacts.email),
          ),
        )
        .orderBy(desc(crmContacts.isPrimary));
      for (const row of contactRows) {
        if (row.email) out.add(row.email.trim().toLowerCase());
      }
    }
  } catch (err) {
    logError("resolvePartyRecipients failed", { partyType, partyId }, err instanceof Error ? err : new Error(String(err)));
  }
  return Array.from(out);
}

/**
 * Resolve the project-level compliance contacts (project manager email)
 * for every project the given party is currently engaged on. This is
 * the project owner's view: the GC's PM should be reminded, not just
 * the sub.
 */
async function resolveProjectComplianceContacts(
  orgId: string,
  partyType: string,
  partyId: string,
): Promise<string[]> {
  try {
    const projectIds = new Set<string>();
    if (partyType === "CRM_ORG" || partyType === "SUBCONTRACTOR") {
      // subcontractor_contracts has no organization_id column; join
      // projects to enforce tenant scoping via projects.gcOrganizationId
      // so a partyId collision across tenants cannot leak recipients.
      const subRows = await db
        .select({ projectId: subcontractorContracts.projectId })
        .from(subcontractorContracts)
        .innerJoin(projects, eq(projects.id, subcontractorContracts.projectId))
        .where(
          and(
            eq(subcontractorContracts.subcontractorId, partyId),
            eq(projects.gcOrganizationId, orgId),
          ),
        );
      for (const r of subRows) projectIds.add(r.projectId);
    }
    if (partyType === "CRM_ORG" || partyType === "VENDOR") {
      const poRows = await db
        .select({ projectId: purchaseOrders.projectId })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.vendorId, partyId), eq(purchaseOrders.orgId, orgId)));
      for (const r of poRows) projectIds.add(r.projectId);
    }
    if (projectIds.size === 0) return [];
    // Also defensively scope the project lookup to the same org.
    const pmRows = await db
      .select({ email: users.email })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.projectManagerId))
      .where(
        and(
          inArray(projects.id, Array.from(projectIds)),
          eq(projects.gcOrganizationId, orgId),
        ),
      );
    return pmRows.map((r) => r.email).filter((e): e is string => !!e);
  } catch (err) {
    logError(
      "resolveProjectComplianceContacts failed",
      { partyType, partyId },
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

function renderReminderEmail(
  cert: InsuranceCertificate,
  customMessage?: string,
): string {
  const days = daysUntil(cert.expiryDate);
  const status = days < 0 ? `EXPIRED ${Math.abs(days)} days ago` : `expires in ${days} days`;
  return `
    <p>Hello,</p>
    <p>Your certificate of insurance on file with us is <strong>${status}</strong>.</p>
    <ul>
      <li>Carrier: ${escapeHtml(cert.carrier)}</li>
      <li>Policy #: ${escapeHtml(cert.policyNumber)}</li>
      <li>Expiry date: ${escapeHtml(String(cert.expiryDate))}</li>
    </ul>
    ${customMessage ? `<p>${escapeHtml(customMessage)}</p>` : ""}
    <p>Please upload an updated certificate at your earliest convenience.</p>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------- Reminder cron (exported, called by jobRunner) ----------

export async function runCoiReminderCycle(): Promise<{ checked: number; sent: number; failed: number }> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 31 * 86400000);
  const certs = await db
    .select()
    .from(insuranceCertificates)
    .where(
      and(
        lte(insuranceCertificates.expiryDate, horizon.toISOString().slice(0, 10)),
        sql`${insuranceCertificates.status} <> 'REVOKED'`,
      ),
    );
  let sent = 0;
  let failed = 0;
  for (const cert of certs) {
    const days = daysUntil(cert.expiryDate);
    const bucket = COI_REMINDER_DAY_BUCKETS.find((b) => Math.abs(days - b) < 0.5);
    if (bucket === undefined) continue;
    const partyRecips = await resolvePartyRecipients(cert.organizationId, cert.partyType, cert.partyId);
    const pmRecips = await resolveProjectComplianceContacts(cert.organizationId, cert.partyType, cert.partyId);
    const recips = Array.from(new Set([...partyRecips, ...pmRecips]));
    if (recips.length === 0) continue;
    for (const r of recips) {
      // Claim the (cert, bucket, recipient) slot first so concurrent
      // pods/runs don't duplicate. We insert ok=false initially; only
      // promote to ok=true after the email actually leaves. On send
      // failure we delete the claim so the next cycle can retry —
      // otherwise the unique constraint would permanently suppress
      // retries (the bug flagged in code review).
      let claimed = false;
      try {
        const inserted = await db
          .insert(coiReminderLog)
          .values({ certificateId: cert.id, daysBeforeExpiry: bucket, recipient: r, ok: false })
          .onConflictDoNothing()
          .returning({ id: coiReminderLog.id });
        if (inserted.length === 0) continue;
        claimed = true;
        await sendEmail({
          to: r,
          subject: `Insurance certificate reminder: ${cert.carrier} ${cert.policyNumber}`,
          html: renderReminderEmail(cert),
        });
        await db
          .update(coiReminderLog)
          .set({ ok: true })
          .where(eq(coiReminderLog.id, inserted[0]!.id));
        sent++;
      } catch (err) {
        failed++;
        if (claimed) {
          // Best-effort: release the claim so a retry can run.
          await db
            .delete(coiReminderLog)
            .where(
              and(
                eq(coiReminderLog.certificateId, cert.id),
                eq(coiReminderLog.daysBeforeExpiry, bucket),
                eq(coiReminderLog.recipient, r),
                eq(coiReminderLog.ok, false),
              ),
            )
            .catch(() => undefined);
        }
        logError(
          "COI reminder send failed",
          { certificateId: cert.id, recipient: r },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }
  logInfo("COI reminder cycle complete", { checked: certs.length, sent, failed });
  return { checked: certs.length, sent, failed };
}

// Refresh derived statuses for certificates (called nightly)
export async function refreshCertificateStatuses(): Promise<{ updated: number }> {
  const all = await db
    .select({ id: insuranceCertificates.id, expiryDate: insuranceCertificates.expiryDate, status: insuranceCertificates.status })
    .from(insuranceCertificates)
    .where(sql`${insuranceCertificates.status} <> 'REVOKED'`);
  let updated = 0;
  for (const c of all) {
    const next = deriveCertStatus(c);
    if (next !== c.status) {
      await db
        .update(insuranceCertificates)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(insuranceCertificates.id, c.id));
      updated++;
    }
  }
  return { updated };
}

export default router;
