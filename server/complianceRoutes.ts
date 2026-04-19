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

export default router;
