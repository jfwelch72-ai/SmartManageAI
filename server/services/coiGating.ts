import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  projectInsuranceRequirements,
  insuranceCertificates,
  insuranceCertificateCoverages,
  subcontractorContracts,
  purchaseOrders,
  crmOrganisations,
  type InsuranceCertificate,
  type InsuranceCertificateCoverage,
  type ProjectInsuranceRequirement,
} from "@shared/schema";
import { logError } from "../utils/logger";
import { isFeatureEnabled } from "./featureFlagService";

export type ComplianceStatus = "COMPLIANT" | "EXPIRING" | "EXPIRED" | "MISSING";
export type CoiPartyType = "SUBCONTRACTOR" | "VENDOR" | "CRM_ORG";

export interface PartyCompliance {
  partyType: string;
  partyId: string;
  partyName: string;
  status: ComplianceStatus;
  reasons: string[];
}

const COI_EXPIRING_WINDOW_DAYS = 30;

function daysUntil(d: string | Date): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function evaluatePartyCompliance(
  reqs: ProjectInsuranceRequirement[],
  certs: Array<InsuranceCertificate & { coverages: InsuranceCertificateCoverage[] }>,
  partyName: string,
): { status: ComplianceStatus; reasons: string[] } {
  if (reqs.length === 0) return { status: "COMPLIANT", reasons: [] };

  const allReasons: string[] = [];
  let worst: ComplianceStatus = "COMPLIANT";
  const rank = (s: ComplianceStatus) =>
    s === "COMPLIANT" ? 0 : s === "EXPIRING" ? 1 : s === "EXPIRED" ? 2 : 3;

  for (const req of reqs) {
    if (!req.required) continue;
    const candidates = certs.filter((c) =>
      c.coverages.some((cov) => cov.coverageType === req.coverageType),
    );
    if (candidates.length === 0) {
      allReasons.push(`${partyName}: missing ${req.coverageType}`);
      if (rank("MISSING") > rank(worst)) worst = "MISSING";
      continue;
    }
    let bestForReq: ComplianceStatus = "MISSING";
    const bestReasons: string[] = [];
    for (const cert of candidates) {
      const cov = cert.coverages.find((c) => c.coverageType === req.coverageType)!;
      const reasons: string[] = [];
      let s: ComplianceStatus = "COMPLIANT";
      const days = daysUntil(cert.expiryDate);
      if (days < 0) {
        s = "EXPIRED";
        reasons.push(`${req.coverageType} expired ${Math.abs(days)}d ago`);
      } else if (days <= COI_EXPIRING_WINDOW_DAYS) {
        s = "EXPIRING";
        reasons.push(`${req.coverageType} expires in ${days}d`);
      }
      if (req.minPerOccurrence && Number(cov.perOccurrenceLimit ?? 0) < Number(req.minPerOccurrence)) {
        reasons.push(`${req.coverageType} per-occurrence below required`);
        if (rank("MISSING") > rank(s)) s = "MISSING";
      }
      if (req.minAggregate && Number(cov.aggregateLimit ?? 0) < Number(req.minAggregate)) {
        reasons.push(`${req.coverageType} aggregate below required`);
        if (rank("MISSING") > rank(s)) s = "MISSING";
      }
      if (req.requiresAdditionalInsured && !cert.additionalInsured) {
        reasons.push(`${req.coverageType} additional-insured missing`);
        if (rank("MISSING") > rank(s)) s = "MISSING";
      }
      if (req.requiresWaiverOfSubrogation && !cert.waiverOfSubrogation) {
        reasons.push(`${req.coverageType} waiver-of-subrogation missing`);
        if (rank("MISSING") > rank(s)) s = "MISSING";
      }
      if (req.requiresPrimaryNonContributory && !cert.primaryNonContributory) {
        reasons.push(`${req.coverageType} primary&non-contributory missing`);
        if (rank("MISSING") > rank(s)) s = "MISSING";
      }
      if (rank(s) < rank(bestForReq)) {
        bestForReq = s;
        bestReasons.length = 0;
        bestReasons.push(...reasons);
      }
    }
    if (rank(bestForReq) > rank(worst)) worst = bestForReq;
    for (const r of bestReasons) allReasons.push(`${partyName}: ${r}`);
  }
  return { status: worst, reasons: allReasons };
}

async function loadProjectRequirements(orgId: string, projectId: string): Promise<ProjectInsuranceRequirement[]> {
  return db
    .select()
    .from(projectInsuranceRequirements)
    .where(
      and(
        eq(projectInsuranceRequirements.organizationId, orgId),
        eq(projectInsuranceRequirements.projectId, projectId),
      ),
    );
}

async function loadCertsForParty(orgId: string, partyType: CoiPartyType, partyId: string) {
  const rows = await db
    .select()
    .from(insuranceCertificates)
    .where(
      and(
        eq(insuranceCertificates.organizationId, orgId),
        eq(insuranceCertificates.partyType, partyType),
        eq(insuranceCertificates.partyId, partyId),
      ),
    );
  const ids = rows.map((r) => r.id);
  const cov = ids.length
    ? await db
        .select()
        .from(insuranceCertificateCoverages)
        .where(eq(insuranceCertificateCoverages.certificateId, ids[0]))
    : [];
  // Note: simple per-id fetch; for multiple ids we need inArray:
  if (ids.length > 1) {
    const { inArray } = await import("drizzle-orm");
    const more = await db
      .select()
      .from(insuranceCertificateCoverages)
      .where(inArray(insuranceCertificateCoverages.certificateId, ids));
    cov.length = 0;
    cov.push(...more);
  }
  return rows
    .filter((r) => r.status !== "REVOKED")
    .map((r) => ({ ...r, coverages: cov.filter((c) => c.certificateId === r.id) }));
}

export interface CoiGatingDecision {
  status: ComplianceStatus;
  parties: PartyCompliance[];
  reasons: string[];
  /** when true, caller should refuse to release money */
  block: boolean;
}

/**
 * Discover all parties on a project and evaluate their COI compliance.
 * - Subcontractors are sourced from `subcontractor_contracts` for the project
 *   (so a sub with NO certificates on file is still surfaced as MISSING).
 * - Vendors are sourced from approved `purchase_orders` for the project.
 * - When `extraParty` is provided (e.g. the immediate party for a PO action),
 *   it is force-included even if no contract row exists yet.
 *
 * Errors (DB / network) propagate so callers can fail-closed.
 */
export async function evaluateProjectCoiCompliance(
  orgId: string,
  projectId: string,
  extraParty?: { partyType: CoiPartyType; partyId: string; partyName: string },
): Promise<CoiGatingDecision> {
  const reqs = await loadProjectRequirements(orgId, projectId);

  const partyMap = new Map<string, { partyType: CoiPartyType; partyId: string; partyName: string }>();

  // Subcontractors via subcontractor_contracts → CRM_ORG
  const contractRows = await db
    .select({
      subcontractorId: subcontractorContracts.subcontractorId,
      name: crmOrganisations.name,
    })
    .from(subcontractorContracts)
    .leftJoin(crmOrganisations, eq(crmOrganisations.id, subcontractorContracts.subcontractorId))
    .where(eq(subcontractorContracts.projectId, projectId));
  for (const c of contractRows) {
    const key = `CRM_ORG:${c.subcontractorId}`;
    if (!partyMap.has(key)) {
      partyMap.set(key, { partyType: "CRM_ORG", partyId: c.subcontractorId, partyName: c.name || "Subcontractor" });
    }
  }

  // Vendors via purchase_orders → CRM_ORG
  const poRows = await db
    .select({ vendorId: purchaseOrders.vendorId, name: crmOrganisations.name })
    .from(purchaseOrders)
    .leftJoin(crmOrganisations, eq(crmOrganisations.id, purchaseOrders.vendorId))
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.orgId, orgId)));
  for (const p of poRows) {
    if (!p.vendorId) continue;
    const key = `CRM_ORG:${p.vendorId}`;
    if (!partyMap.has(key)) {
      partyMap.set(key, { partyType: "CRM_ORG", partyId: p.vendorId, partyName: p.name || "Vendor" });
    }
  }

  if (extraParty) {
    const key = `${extraParty.partyType}:${extraParty.partyId}`;
    if (!partyMap.has(key)) partyMap.set(key, extraParty);
  }

  const parties: PartyCompliance[] = [];
  let overall: ComplianceStatus = "COMPLIANT";
  const rank = (s: ComplianceStatus) =>
    s === "COMPLIANT" ? 0 : s === "EXPIRING" ? 1 : s === "EXPIRED" ? 2 : 3;
  const allReasons: string[] = [];

  for (const p of Array.from(partyMap.values())) {
    // Tenants store the same legal entity under any of SUBCONTRACTOR /
    // VENDOR / CRM_ORG. Project-side normalization gives us CRM_ORG via
    // the contracts/POs join, but a confirmed cert may have been filed
    // under the legacy SUBCONTRACTOR or VENDOR party_type. Look up all
    // three so a valid cert under any representation satisfies the
    // requirement instead of being treated as MISSING.
    const otherTypes: CoiPartyType[] = (
      p.partyType === "SUBCONTRACTOR"
        ? ["CRM_ORG", "VENDOR"]
        : p.partyType === "VENDOR"
          ? ["CRM_ORG", "SUBCONTRACTOR"]
          : ["VENDOR", "SUBCONTRACTOR"]
    );
    const certsPrimary = await loadCertsForParty(orgId, p.partyType, p.partyId);
    const altCerts = await Promise.all(otherTypes.map((t) => loadCertsForParty(orgId, t, p.partyId)));
    const certs = [...certsPrimary, ...altCerts.flat()];
    const ev = evaluatePartyCompliance(reqs, certs, p.partyName);
    parties.push({ ...p, status: ev.status, reasons: ev.reasons });
    if (rank(ev.status) > rank(overall)) overall = ev.status;
    allReasons.push(...ev.reasons);
  }

  return {
    status: overall,
    parties,
    reasons: allReasons,
    block: overall === "EXPIRED" || overall === "MISSING",
  };
}

/**
 * Wrapper that consults the per-org `COI_COMPLIANCE_HOLD` feature flag
 * to decide whether to actually block. When the flag is OFF, the
 * decision is returned for surfacing in the UI / response payload but
 * `block` is forced to false so legacy tenants aren't broken.
 *
 * When the flag is ON, evaluation is FAIL-CLOSED: a thrown error
 * surfaces as MISSING with `block=true` so callers refuse the release.
 */
export async function isReleaseBlocked(
  orgId: string,
  projectId: string,
  extraParty?: Parameters<typeof evaluateProjectCoiCompliance>[2],
): Promise<CoiGatingDecision> {
  let enforce = false;
  try {
    enforce = await isFeatureEnabled(orgId, "COI_COMPLIANCE_HOLD");
  } catch (err) {
    logError(
      "COI feature-flag check failed (treating as OFF)",
      { orgId },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
  try {
    const decision = await evaluateProjectCoiCompliance(orgId, projectId, extraParty);
    return enforce ? decision : { ...decision, block: false };
  } catch (err) {
    logError(
      "COI gating evaluation failed",
      { orgId, projectId, enforce },
      err instanceof Error ? err : new Error(String(err)),
    );
    return {
      status: "MISSING",
      parties: [],
      reasons: ["Compliance evaluation failed"],
      block: enforce,
    };
  }
}
