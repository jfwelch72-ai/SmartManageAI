import { logError } from "../utils/logger";
import { db } from "../db";
import {
  aiCoDrafts,
  delayClaims,
  projectDelays,
  projectInspections,
  projects,
  organizations,
} from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";

export interface ChangeOrderSuggestion {
  project_code: string;
  source_type: "DELAY" | "INSPECTION" | "SCOPE_CHANGE";
  source_id: string;
  title: string;
  description: string;
  justification: string;
  estimated_amount: number;
  confidence: number;
  line_items: {
    labor: { description: string; hours: number; rate: number; amount: number }[];
    materials: { description: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
    equipment: { description: string; days: number; dailyRate: number; amount: number }[];
  };
}

export async function detectAndCreateChangeOrderDrafts(
  snapshot: any,
  profitability: any[],
  aiSuggestions?: ChangeOrderSuggestion[],
  organizationId?: string
): Promise<number> {
  let draftsCreated = 0;

  const delayDrafts = await createDraftsFromDelays(snapshot, organizationId);
  draftsCreated += delayDrafts;

  const inspectionDrafts = await createDraftsFromInspections(snapshot, organizationId);
  draftsCreated += inspectionDrafts;

  if (aiSuggestions && aiSuggestions.length > 0) {
    const aiDrafts = await createDraftsFromAISuggestions(aiSuggestions, organizationId);
    draftsCreated += aiDrafts;
  }

  return draftsCreated;
}

async function createDraftsFromDelays(snapshot: any, organizationId?: string): Promise<number> {
  let created = 0;

  const recentClaims = snapshot?.delay_claims?.recent_claims || [];
  const actionableClaims = recentClaims.filter(
    (c: any) => {
      const status = (c.status || '').toUpperCase();
      return (status === "DRAFT" || status === "UNDER_REVIEW" || status === "APPROVED") && Number(c.claimed_amount || 0) > 0;
    }
  );

  if (actionableClaims.length === 0) return 0;

  const projectQuery = db
    .select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId })
    .from(projects);
  const orgProjects = organizationId
    ? await projectQuery.where(eq(projects.gcOrganizationId, organizationId)).limit(500)
    : await projectQuery.limit(500);

  const projectMap = new Map<string, { id: string; code: string; orgId: string | null }>();
  orgProjects.forEach(p => {
    projectMap.set(p.id, { id: p.id, code: p.code, orgId: p.gcOrganizationId });
    projectMap.set(p.code, { id: p.id, code: p.code, orgId: p.gcOrganizationId });
  });

  for (const claim of actionableClaims) {
    const proj = projectMap.get(claim.project_id);
    if (!proj || !proj.orgId) continue;

    const claimSourceId = claim.id || claim.claim_id;
    if (!claimSourceId) continue;
    const dedupeKey = `DELAY:${claimSourceId}`;

    const existing = await db
      .select({ id: aiCoDrafts.id })
      .from(aiCoDrafts)
      .where(
        and(
          eq(aiCoDrafts.projectId, proj.id),
          eq(aiCoDrafts.organizationId, proj.orgId),
          sql`${aiCoDrafts.linkedItemsJson}::text LIKE ${'%' + dedupeKey + '%'}`,
          sql`${aiCoDrafts.status} IN ('DRAFT')`
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const claimedAmount = Number(claim.claimed_amount || 0);
    const claimedDays = Number(claim.claimed_days || 0);

    const laborCost = Math.round(claimedDays * 8 * 75);
    const materialCost = Math.round(claimedAmount * 0.3);
    const equipmentCost = Math.round(claimedDays * 150);
    const subtotal = laborCost + materialCost + equipmentCost;
    const overhead = Math.round(subtotal * 0.1);
    const profit = Math.round(subtotal * 0.1);
    const total = subtotal + overhead + profit;

    const draftContent = {
      title: `Delay Claim CO - ${claim.claim_type} (${claimedDays} days)`,
      description: `Change order for ${claim.claim_type} delay claim impacting project schedule by ${claimedDays} days. Claimed amount: $${claimedAmount.toLocaleString()}.`,
      justification: `Project experienced a ${claim.claim_type} delay of ${claimedDays} days. This delay resulted in additional costs for extended labor, equipment standby, and related overhead. The delay was documented and ${(claim.status || '').toUpperCase() === 'APPROVED' ? 'has been approved' : 'is under review'}.`,
      scopeOfWork: `Extended labor and equipment mobilization for ${claimedDays} additional days due to ${claim.claim_type} delay. Includes standby costs, remobilization, and schedule recovery efforts.`,
      exclusions: "Does not include liquidated damages, consequential damages, or work outside the delay period.",
      terms: "Payment due upon approval. Schedule impact to be evaluated separately.",
      lineItems: {
        labor: [
          { description: `Extended Labor - ${claim.claim_type} Delay`, hours: claimedDays * 8, rate: 75, amount: laborCost },
        ],
        materials: [
          { description: "Additional/Wasted Materials", quantity: 1, unit: "LS", unitPrice: materialCost, amount: materialCost },
        ],
        equipment: [
          { description: `Equipment Standby (${claimedDays} days)`, days: claimedDays, dailyRate: 150, amount: equipmentCost },
        ],
      },
      subtotals: { labor: laborCost, materials: materialCost, equipment: equipmentCost, subtotal, overhead, profit, total },
    };

    try {
      await db.insert(aiCoDrafts).values({
        organizationId: proj.orgId,
        projectId: proj.id,
        linkedItemsJson: JSON.stringify({ delayIds: [claimSourceId], source: "AI_AUTO", claimType: claim.claim_type, dedupeKey }),
        draftContentJson: JSON.stringify(draftContent),
        pricingJson: JSON.stringify(draftContent.lineItems),
        aiConfidence: (claim.status || '').toUpperCase() === "APPROVED" ? 90 : 75,
        aiNotes: `Auto-generated from ${claim.claim_type} delay claim (${claimedDays} days, $${claimedAmount.toLocaleString()})`,
        status: "DRAFT",
      });
      created++;
    } catch (err) {
      logError(`Failed to create CO draft from delay claim:`, {}, err instanceof Error ? err : new Error(String(err)));
    }
  }

  return created;
}

async function createDraftsFromInspections(snapshot: any, organizationId?: string): Promise<number> {
  let created = 0;

  const recentIssues = snapshot?.field_productivity?.recent_issues || [];
  const actionableIssues = recentIssues.filter(
    (i: any) => (i.severity === "HIGH" || i.severity === "CRITICAL") && i.status !== "RESOLVED"
  );

  if (actionableIssues.length === 0) return 0;

  const projectQuery = db
    .select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId })
    .from(projects);
  const orgProjects = organizationId
    ? await projectQuery.where(eq(projects.gcOrganizationId, organizationId)).limit(500)
    : await projectQuery.limit(500);

  const projectMap = new Map<string, { id: string; code: string; orgId: string | null }>();
  orgProjects.forEach(p => {
    projectMap.set(p.id, { id: p.id, code: p.code, orgId: p.gcOrganizationId });
  });

  for (const issue of actionableIssues) {
    const proj = projectMap.get(issue.project_id);
    if (!proj || !proj.orgId) continue;

    const issueSourceId = issue.id || issue.issue_id || `${issue.project_id}_${issue.category}`;
    const dedupeKey = `INSPECTION:${issueSourceId}`;

    const existing = await db
      .select({ id: aiCoDrafts.id })
      .from(aiCoDrafts)
      .where(
        and(
          eq(aiCoDrafts.projectId, proj.id),
          eq(aiCoDrafts.organizationId, proj.orgId),
          sql`${aiCoDrafts.linkedItemsJson}::text LIKE ${'%' + dedupeKey + '%'}`,
          sql`${aiCoDrafts.status} IN ('DRAFT')`
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const baseCost = issue.severity === "CRITICAL" ? 5000 : 2500;
    const laborCost = Math.round(baseCost * 0.5);
    const materialCost = Math.round(baseCost * 0.35);
    const equipmentCost = Math.round(baseCost * 0.15);
    const subtotal = laborCost + materialCost + equipmentCost;
    const overhead = Math.round(subtotal * 0.1);
    const profit = Math.round(subtotal * 0.1);
    const total = subtotal + overhead + profit;

    const draftContent = {
      title: `${issue.severity} Issue - ${issue.category} Remediation`,
      description: `Change order to address ${issue.severity.toLowerCase()} ${issue.category} issue identified during field inspection.`,
      justification: `A ${issue.severity.toLowerCase()} severity ${issue.category} issue was identified requiring immediate remediation. This work is outside the original scope and requires additional resources.`,
      scopeOfWork: `Remediation of ${issue.category} issue. Includes assessment, corrective work, and verification.`,
      exclusions: "Does not include consequential repairs outside the immediate issue scope.",
      terms: "Work to commence upon approval. Payment upon completion and verification.",
      lineItems: {
        labor: [{ description: `${issue.category} Remediation Labor`, hours: Math.round(laborCost / 75), rate: 75, amount: laborCost }],
        materials: [{ description: "Remediation Materials", quantity: 1, unit: "LS", unitPrice: materialCost, amount: materialCost }],
        equipment: [{ description: "Specialized Equipment", days: 1, dailyRate: equipmentCost, amount: equipmentCost }],
      },
      subtotals: { labor: laborCost, materials: materialCost, equipment: equipmentCost, subtotal, overhead, profit, total },
    };

    try {
      await db.insert(aiCoDrafts).values({
        organizationId: proj.orgId,
        projectId: proj.id,
        linkedItemsJson: JSON.stringify({ inspectionIds: [issueSourceId], source: "AI_AUTO", category: issue.category, severity: issue.severity, dedupeKey }),
        draftContentJson: JSON.stringify(draftContent),
        pricingJson: JSON.stringify(draftContent.lineItems),
        aiConfidence: issue.severity === "CRITICAL" ? 85 : 70,
        aiNotes: `Auto-generated from ${issue.severity} ${issue.category} field issue`,
        status: "DRAFT",
      });
      created++;
    } catch (err) {
      logError(`Failed to create CO draft from inspection:`, {}, err instanceof Error ? err : new Error(String(err)));
    }
  }

  return created;
}

async function createDraftsFromAISuggestions(suggestions: ChangeOrderSuggestion[], organizationId?: string): Promise<number> {
  let created = 0;

  const projectQuery = db
    .select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId })
    .from(projects);
  const orgProjects = organizationId
    ? await projectQuery.where(eq(projects.gcOrganizationId, organizationId)).limit(500)
    : await projectQuery.limit(500);

  const projectByCode = new Map<string, { id: string; code: string; orgId: string | null }>();
  orgProjects.forEach(p => {
    projectByCode.set(p.code, { id: p.id, code: p.code, orgId: p.gcOrganizationId });
  });

  for (const suggestion of suggestions) {
    const proj = projectByCode.get(suggestion.project_code);
    if (!proj || !proj.orgId) continue;

    const dedupeKey = `AI_SUGGEST:${suggestion.source_type}:${suggestion.source_id}`;

    const existing = await db
      .select({ id: aiCoDrafts.id })
      .from(aiCoDrafts)
      .where(
        and(
          eq(aiCoDrafts.projectId, proj.id),
          eq(aiCoDrafts.organizationId, proj.orgId),
          sql`${aiCoDrafts.linkedItemsJson}::text LIKE ${'%' + dedupeKey + '%'}`,
          sql`${aiCoDrafts.status} IN ('DRAFT')`
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const subtotal = suggestion.estimated_amount;
    const overhead = Math.round(subtotal * 0.1);
    const profit = Math.round(subtotal * 0.1);
    const total = subtotal + overhead + profit;

    const draftContent = {
      title: suggestion.title,
      description: suggestion.description,
      justification: suggestion.justification,
      scopeOfWork: suggestion.description,
      exclusions: "Per AI analysis — review and modify as needed.",
      terms: "Payment due upon completion and acceptance.",
      lineItems: suggestion.line_items,
      subtotals: {
        labor: suggestion.line_items.labor.reduce((s, l) => s + l.amount, 0),
        materials: suggestion.line_items.materials.reduce((s, m) => s + m.amount, 0),
        equipment: suggestion.line_items.equipment.reduce((s, e) => s + e.amount, 0),
        subtotal,
        overhead,
        profit,
        total,
      },
    };

    try {
      await db.insert(aiCoDrafts).values({
        organizationId: proj.orgId,
        projectId: proj.id,
        linkedItemsJson: JSON.stringify({
          source: "AI_AUTO",
          sourceType: suggestion.source_type,
          sourceId: suggestion.source_id,
          dedupeKey,
        }),
        draftContentJson: JSON.stringify(draftContent),
        pricingJson: JSON.stringify(draftContent.lineItems),
        aiConfidence: suggestion.confidence,
        aiNotes: `AI-suggested change order: ${suggestion.title}`,
        status: "DRAFT",
      });
      created++;
    } catch (err) {
      logError(`Failed to create CO draft from AI suggestion:`, {}, err instanceof Error ? err : new Error(String(err)));
    }
  }

  return created;
}
