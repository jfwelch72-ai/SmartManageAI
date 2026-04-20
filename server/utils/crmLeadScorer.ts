import { db } from "../db";
import { crmLeadScoringRules, crmOpportunities } from "@shared/schema";
import { and, eq } from "drizzle-orm";

type Op = "EQUALS" | "NOT_EQUALS" | "CONTAINS" | "GTE" | "LTE" | "IS_SET" | "IS_NOT_SET";

function evalRule(actual: unknown, op: Op, expected: string | null): boolean {
  if (op === "IS_SET") return actual !== null && actual !== undefined && String(actual).trim() !== "";
  if (op === "IS_NOT_SET") return actual === null || actual === undefined || String(actual).trim() === "";
  if (actual === null || actual === undefined) return false;
  const a = String(actual).trim().toLowerCase();
  const e = (expected ?? "").trim().toLowerCase();
  switch (op) {
    case "EQUALS": return a === e;
    case "NOT_EQUALS": return a !== e;
    case "CONTAINS": return a.includes(e);
    case "GTE": return Number(a) >= Number(e);
    case "LTE": return Number(a) <= Number(e);
    default: return false;
  }
}

export interface ScorableOpportunity {
  source?: string | null;
  projectType?: string | null;
  projectLocation?: string | null;
  dealValue?: string | number | null;
  contactId?: string | null;
  crmOrganisationId?: string | null;
  notes?: string | null;
  name?: string | null;
}

const FIELD_GETTERS: Record<string, (o: ScorableOpportunity) => unknown> = {
  source: (o) => o.source,
  projectType: (o) => o.projectType,
  projectLocation: (o) => o.projectLocation,
  dealValue: (o) => (o.dealValue == null ? null : Number(o.dealValue)),
  contactId: (o) => o.contactId,
  crmOrganisationId: (o) => o.crmOrganisationId,
  notes: (o) => o.notes,
  name: (o) => o.name,
};

export async function scoreOpportunity(orgId: string, opp: ScorableOpportunity): Promise<number> {
  const rules = await db.select().from(crmLeadScoringRules).where(and(eq(crmLeadScoringRules.organizationId, orgId), eq(crmLeadScoringRules.isActive, true)));
  let total = 0;
  for (const rule of rules) {
    const getter = FIELD_GETTERS[rule.field];
    if (!getter) continue;
    if (evalRule(getter(opp), rule.operator as Op, rule.value)) {
      total += rule.points;
    }
  }
  return Math.max(0, Math.min(100, total));
}

export async function rescoreOrgOpportunities(orgId: string): Promise<number> {
  const opps = await db.select().from(crmOpportunities).where(eq(crmOpportunities.organizationId, orgId));
  let updated = 0;
  for (const opp of opps) {
    const score = await scoreOpportunity(orgId, opp);
    if (score !== (opp.leadScore ?? 0)) {
      await db.update(crmOpportunities).set({ leadScore: score, updatedAt: new Date() }).where(eq(crmOpportunities.id, opp.id));
      updated++;
    }
  }
  return updated;
}

export const SCORABLE_FIELDS = Object.keys(FIELD_GETTERS);
