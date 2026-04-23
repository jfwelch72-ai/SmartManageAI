import { Router } from "express";
import { db } from "./db";
import {
  crmOrganisationCertifications,
  crmOrganisations,
  suretyBonds,
  projectPermits,
  projects,
} from "@shared/schema";
import { and, eq, sql, isNotNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type AuthRequest, requireAuth, requireFeaturePermission } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

export type ComplianceItemType =
  | "DBE_CERT"
  | "SURETY_BOND"
  | "INSURANCE"
  | "WC_INSURANCE"
  | "LICENSE"
  | "PERMIT";

export type CompliancePartyType = "CRM_ORG" | "PROJECT";

export type ComplianceStatus = "ACTIVE" | "EXPIRING" | "EXPIRED";

export interface ComplianceItem {
  id: string;
  type: ComplianceItemType;
  typeLabel: string;
  partyType: CompliancePartyType;
  partyId: string;
  partyName: string;
  identifier: string | null;
  agency: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  daysUntilExpiry: number | null;
  status: ComplianceStatus;
  sourceUrl: string;
}

const TYPE_LABELS: Record<ComplianceItemType, string> = {
  DBE_CERT: "DBE / Certification",
  SURETY_BOND: "Surety Bond",
  INSURANCE: "General Insurance",
  WC_INSURANCE: "Workers Comp",
  LICENSE: "Business License",
  PERMIT: "Permit",
};

function toDateOnly(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.length >= 10 ? v.slice(0, 10) : v;
  return v.toISOString().slice(0, 10);
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(target.getTime())) return null;
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function deriveStatus(days: number | null): ComplianceStatus {
  if (days === null) return "ACTIVE";
  if (days < 0) return "EXPIRED";
  if (days <= 45) return "EXPIRING";
  return "ACTIVE";
}

function buildItem(args: {
  id: string;
  type: ComplianceItemType;
  partyType: CompliancePartyType;
  partyId: string;
  partyName: string;
  identifier: string | null;
  agency: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  sourceUrl: string;
}): ComplianceItem {
  const days = daysUntil(args.expirationDate);
  return {
    id: args.id,
    type: args.type,
    typeLabel: TYPE_LABELS[args.type],
    partyType: args.partyType,
    partyId: args.partyId,
    partyName: args.partyName,
    identifier: args.identifier,
    agency: args.agency,
    effectiveDate: args.effectiveDate,
    expirationDate: args.expirationDate,
    daysUntilExpiry: days,
    status: deriveStatus(days),
    sourceUrl: args.sourceUrl,
  };
}

/**
 * GET /api/compliance/expirations
 *
 * Returns a unified list of expiring/expired compliance items aggregated from:
 *  - crm_organisation_certifications (DBE/MBE/WBE/etc.)
 *  - surety_bonds (Bid/Performance/Payment/Maintenance)
 *  - crm_organisations (general insurance, workers comp, business license)
 *  - project_permits
 *
 * Each item is shaped per ComplianceItem above. Filtering and grouping happen
 * client-side; this endpoint always returns the full org-scoped set so the UI
 * can compute summary counts and apply filters without re-fetching.
 */
router.get(
  "/expirations",
  requireAuth,
  requireFeaturePermission("canViewComplianceDashboard"),
  async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        res.json([]);
        return;
      }

      // --- 1) DBE / CRM org certifications ---------------------------------
      const certWhere = shouldFilter && orgId
        ? eq(crmOrganisationCertifications.organizationId, orgId)
        : sql`1=1`;
      const certRows = await db
        .select({
          id: crmOrganisationCertifications.id,
          crmOrganisationId: crmOrganisationCertifications.crmOrganisationId,
          certificationType: crmOrganisationCertifications.certificationType,
          certifyingAgency: crmOrganisationCertifications.certifyingAgency,
          certificationNumber: crmOrganisationCertifications.certificationNumber,
          effectiveDate: crmOrganisationCertifications.effectiveDate,
          expirationDate: crmOrganisationCertifications.expirationDate,
          partyName: crmOrganisations.name,
        })
        .from(crmOrganisationCertifications)
        .innerJoin(
          crmOrganisations,
          eq(crmOrganisations.id, crmOrganisationCertifications.crmOrganisationId),
        )
        .where(certWhere);

      // --- 2) Surety bonds --------------------------------------------------
      const bondWhere = shouldFilter && orgId
        ? eq(suretyBonds.organizationId, orgId)
        : sql`1=1`;
      const bondRows = await db
        .select({
          id: suretyBonds.id,
          projectId: suretyBonds.projectId,
          organizationId: suretyBonds.organizationId,
          bondType: suretyBonds.bondType,
          status: suretyBonds.status,
          bondNumber: suretyBonds.bondNumber,
          suretyCompany: suretyBonds.suretyCompany,
          effectiveDate: suretyBonds.effectiveDate,
          expirationDate: suretyBonds.expirationDate,
          projectName: projects.name,
          projectCode: projects.code,
        })
        .from(suretyBonds)
        .leftJoin(projects, eq(projects.id, suretyBonds.projectId))
        .where(and(bondWhere, isNotNull(suretyBonds.expirationDate)));

      // --- 3) CRM org insurance / WC / license -----------------------------
      const orgWhere = shouldFilter && orgId
        ? eq(crmOrganisations.organizationId, orgId)
        : sql`1=1`;
      const orgRows = await db
        .select({
          id: crmOrganisations.id,
          name: crmOrganisations.name,
          insuranceCarrier: crmOrganisations.insuranceCarrier,
          insurancePolicyNumber: crmOrganisations.insurancePolicyNumber,
          insuranceExpiration: crmOrganisations.insuranceExpiration,
          wcInsuranceCarrier: crmOrganisations.wcInsuranceCarrier,
          wcInsuranceExpiration: crmOrganisations.wcInsuranceExpiration,
          licenseNumber: crmOrganisations.licenseNumber,
          licenseExpiration: crmOrganisations.licenseExpiration,
        })
        .from(crmOrganisations)
        .where(orgWhere);

      // --- 4) Project permits ----------------------------------------------
      const permitWhere = shouldFilter && orgId
        ? eq(projects.gcOrganizationId, orgId)
        : sql`1=1`;
      const permitRows = await db
        .select({
          id: projectPermits.id,
          projectId: projectPermits.projectId,
          permitType: projectPermits.permitType,
          customType: projectPermits.customType,
          permitNumber: projectPermits.permitNumber,
          status: projectPermits.status,
          issuingAuthority: projectPermits.issuingAuthority,
          issuedDate: projectPermits.issuedDate,
          expiryDate: projectPermits.expiryDate,
          projectName: projects.name,
          projectCode: projects.code,
        })
        .from(projectPermits)
        .innerJoin(projects, eq(projects.id, projectPermits.projectId))
        .where(and(permitWhere, isNotNull(projectPermits.expiryDate)));

      const items: ComplianceItem[] = [];

      for (const r of certRows) {
        items.push(buildItem({
          id: `cert:${r.id}`,
          type: "DBE_CERT",
          partyType: "CRM_ORG",
          partyId: r.crmOrganisationId,
          partyName: r.partyName,
          identifier: r.certificationNumber
            ? `${r.certificationType} #${r.certificationNumber}`
            : r.certificationType,
          agency: r.certifyingAgency,
          effectiveDate: toDateOnly(r.effectiveDate),
          expirationDate: toDateOnly(r.expirationDate),
          sourceUrl: `/crm?tab=organisations&org=${r.crmOrganisationId}`,
        }));
      }

      for (const b of bondRows) {
        if (b.status === "RELEASED" || b.status === "CANCELED") continue;
        const isProject = !!b.projectId;
        items.push(buildItem({
          id: `bond:${b.id}`,
          type: "SURETY_BOND",
          partyType: isProject ? "PROJECT" : "CRM_ORG",
          partyId: isProject ? b.projectId! : b.organizationId,
          partyName: isProject
            ? (b.projectCode ? `${b.projectCode} — ${b.projectName ?? ""}`.trim() : (b.projectName ?? "Project"))
            : "Organization-wide bond",
          identifier: `${b.bondType} #${b.bondNumber}`,
          agency: b.suretyCompany,
          effectiveDate: toDateOnly(b.effectiveDate),
          expirationDate: toDateOnly(b.expirationDate),
          sourceUrl: isProject
            ? `/projects/${b.projectId}?tab=bonds`
            : `/surety-bonds`,
        }));
      }

      for (const o of orgRows) {
        const orgUrl = `/crm?tab=organisations&org=${o.id}`;
        if (o.insuranceExpiration) {
          items.push(buildItem({
            id: `ins:${o.id}`,
            type: "INSURANCE",
            partyType: "CRM_ORG",
            partyId: o.id,
            partyName: o.name,
            identifier: o.insurancePolicyNumber
              ? `Policy #${o.insurancePolicyNumber}`
              : "General Liability",
            agency: o.insuranceCarrier,
            effectiveDate: null,
            expirationDate: toDateOnly(o.insuranceExpiration),
            sourceUrl: orgUrl,
          }));
        }
        if (o.wcInsuranceExpiration) {
          items.push(buildItem({
            id: `wc:${o.id}`,
            type: "WC_INSURANCE",
            partyType: "CRM_ORG",
            partyId: o.id,
            partyName: o.name,
            identifier: "Workers Comp",
            agency: o.wcInsuranceCarrier,
            effectiveDate: null,
            expirationDate: toDateOnly(o.wcInsuranceExpiration),
            sourceUrl: orgUrl,
          }));
        }
        if (o.licenseExpiration) {
          items.push(buildItem({
            id: `lic:${o.id}`,
            type: "LICENSE",
            partyType: "CRM_ORG",
            partyId: o.id,
            partyName: o.name,
            identifier: o.licenseNumber
              ? `License #${o.licenseNumber}`
              : "Business License",
            agency: null,
            effectiveDate: null,
            expirationDate: toDateOnly(o.licenseExpiration),
            sourceUrl: orgUrl,
          }));
        }
      }

      for (const p of permitRows) {
        if (p.status === "RENEWED" || p.status === "CANCELLED" || p.status === "CANCELED") continue;
        items.push(buildItem({
          id: `permit:${p.id}`,
          type: "PERMIT",
          partyType: "PROJECT",
          partyId: p.projectId,
          partyName: p.projectCode
            ? `${p.projectCode} — ${p.projectName ?? ""}`.trim()
            : (p.projectName ?? "Project"),
          identifier: p.permitNumber
            ? `${p.customType ?? p.permitType} #${p.permitNumber}`
            : (p.customType ?? p.permitType),
          agency: p.issuingAuthority,
          effectiveDate: toDateOnly(p.issuedDate),
          expirationDate: toDateOnly(p.expiryDate),
          sourceUrl: `/permits?projectId=${p.projectId}`,
        }));
      }

      // Sort: expired first (most overdue), then soonest-expiring, no-date last.
      items.sort((a, b) => {
        if (a.daysUntilExpiry === null && b.daysUntilExpiry === null) return 0;
        if (a.daysUntilExpiry === null) return 1;
        if (b.daysUntilExpiry === null) return -1;
        return a.daysUntilExpiry - b.daysUntilExpiry;
      });

      res.json(items);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/compliance/summary
 *
 * Task #1362: lightweight aggregate that powers the Safety Hub
 * "Compliance & COIs" tile badge. Returns the count of expired and
 * expiring-soon (≤ 30 days) compliance items across the same four
 * sources as /expirations (DBE certs, surety bonds, CRM org
 * insurance / WC / license, and project permits) plus
 * `maxDaysExpired` — the largest days-past-expiration in the set.
 *
 * Bonds with status RELEASED/CANCELED and permits with status
 * RENEWED/CANCELLED are excluded so the counts match the page.
 */
router.get(
  "/summary",
  requireAuth,
  requireFeaturePermission("canViewComplianceDashboard"),
  async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.json({ expiredCount: 0, expiringSoonCount: 0, maxDaysExpired: 0 });
      }

      // Task #1366: cast every column to ::date so the same helpers work
      // for both `date` columns (cert/bond/permit expirations) and
      // `timestamp` columns (CRM org insurance/WC/license). Without the
      // cast, `CURRENT_DATE - <timestamp>` returns an `interval`, which
      // PG then refuses to COALESCE with the integer literal `0`
      // ("COALESCE types interval and integer cannot be matched").
      const expiredExpr = (col: AnyPgColumn) =>
        sql`(${col} IS NOT NULL AND ${col}::date < CURRENT_DATE)`;
      const expiringExpr = (col: AnyPgColumn) =>
        sql`(${col} IS NOT NULL AND ${col}::date >= CURRENT_DATE AND ${col}::date <= CURRENT_DATE + INTERVAL '30 days')`;
      const daysExpr = (col: AnyPgColumn) =>
        sql`COALESCE(MAX(CASE WHEN ${col} IS NOT NULL AND ${col}::date < CURRENT_DATE THEN (CURRENT_DATE - ${col}::date) ELSE NULL END), 0)::int`;

      // DBE / CRM org certifications
      const certWhere = shouldFilter && orgId
        ? eq(crmOrganisationCertifications.organizationId, orgId)
        : sql`1=1`;
      const certCol = crmOrganisationCertifications.expirationDate;
      const [certAgg] = await db
        .select({
          expired: sql<number>`COUNT(*) FILTER (WHERE ${expiredExpr(certCol)})::int`,
          expiring: sql<number>`COUNT(*) FILTER (WHERE ${expiringExpr(certCol)})::int`,
          maxDays: daysExpr(certCol),
        })
        .from(crmOrganisationCertifications)
        .where(certWhere);

      // Surety bonds (active only)
      const bondWhere = shouldFilter && orgId
        ? eq(suretyBonds.organizationId, orgId)
        : sql`1=1`;
      const bondActive = sql`${suretyBonds.status} NOT IN ('RELEASED','CANCELED')`;
      const bondCol = suretyBonds.expirationDate;
      const [bondAgg] = await db
        .select({
          expired: sql<number>`COUNT(*) FILTER (WHERE ${bondActive} AND ${expiredExpr(bondCol)})::int`,
          expiring: sql<number>`COUNT(*) FILTER (WHERE ${bondActive} AND ${expiringExpr(bondCol)})::int`,
          maxDays: sql<number>`COALESCE(MAX(CASE WHEN ${bondActive} AND ${bondCol} IS NOT NULL AND ${bondCol} < CURRENT_DATE THEN (CURRENT_DATE - ${bondCol}) ELSE NULL END), 0)::int`,
        })
        .from(suretyBonds)
        .where(bondWhere);

      // CRM org insurance / WC / license
      const orgWhere = shouldFilter && orgId
        ? eq(crmOrganisations.organizationId, orgId)
        : sql`1=1`;
      const insCol = crmOrganisations.insuranceExpiration;
      const wcCol = crmOrganisations.wcInsuranceExpiration;
      const licCol = crmOrganisations.licenseExpiration;
      const [orgAgg] = await db
        .select({
          expired: sql<number>`(
            COUNT(*) FILTER (WHERE ${expiredExpr(insCol)})
            + COUNT(*) FILTER (WHERE ${expiredExpr(wcCol)})
            + COUNT(*) FILTER (WHERE ${expiredExpr(licCol)})
          )::int`,
          expiring: sql<number>`(
            COUNT(*) FILTER (WHERE ${expiringExpr(insCol)})
            + COUNT(*) FILTER (WHERE ${expiringExpr(wcCol)})
            + COUNT(*) FILTER (WHERE ${expiringExpr(licCol)})
          )::int`,
          maxDays: sql<number>`GREATEST(${daysExpr(insCol)}, ${daysExpr(wcCol)}, ${daysExpr(licCol)})::int`,
        })
        .from(crmOrganisations)
        .where(orgWhere);

      // Project permits (active only)
      const permitWhere = shouldFilter && orgId
        ? eq(projects.gcOrganizationId, orgId)
        : sql`1=1`;
      // Task #1366: cast `status` to text first so this NOT IN list can
      // tolerate values that aren't members of the `permit_status` enum
      // (CANCELLED/CANCELED are kept defensively in case the enum is
      // extended later — without the cast PG rejects the entire query
      // with `invalid input value for enum permit_status`).
      const permitActive = sql`${projectPermits.status}::text NOT IN ('RENEWED','CANCELLED','CANCELED')`;
      const permitCol = projectPermits.expiryDate;
      const [permitAgg] = await db
        .select({
          expired: sql<number>`COUNT(*) FILTER (WHERE ${permitActive} AND ${expiredExpr(permitCol)})::int`,
          expiring: sql<number>`COUNT(*) FILTER (WHERE ${permitActive} AND ${expiringExpr(permitCol)})::int`,
          maxDays: sql<number>`COALESCE(MAX(CASE WHEN ${permitActive} AND ${permitCol} IS NOT NULL AND ${permitCol} < CURRENT_DATE THEN (CURRENT_DATE - ${permitCol}) ELSE NULL END), 0)::int`,
        })
        .from(projectPermits)
        .innerJoin(projects, eq(projects.id, projectPermits.projectId))
        .where(permitWhere);

      const expiredCount =
        (certAgg?.expired ?? 0) + (bondAgg?.expired ?? 0) + (orgAgg?.expired ?? 0) + (permitAgg?.expired ?? 0);
      const expiringSoonCount =
        (certAgg?.expiring ?? 0) + (bondAgg?.expiring ?? 0) + (orgAgg?.expiring ?? 0) + (permitAgg?.expiring ?? 0);
      const maxDaysExpired = Math.max(
        certAgg?.maxDays ?? 0,
        bondAgg?.maxDays ?? 0,
        orgAgg?.maxDays ?? 0,
        permitAgg?.maxDays ?? 0,
      );

      res.json({ expiredCount, expiringSoonCount, maxDaysExpired });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
