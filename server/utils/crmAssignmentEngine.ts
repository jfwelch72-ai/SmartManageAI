import { db } from "../db";
import { crmAssignmentRules, type CrmAssignmentRule } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

interface OpportunityFacts {
  source?: string | null;
  projectType?: string | null;
  projectLocation?: string | null;
  dealValue?: number | string | null;
}

interface RuleConditions {
  source?: string;
  projectType?: string;
  locationContains?: string;
  minValue?: number;
  maxValue?: number;
}

function ruleMatches(rule: CrmAssignmentRule, facts: OpportunityFacts): boolean {
  const c = (rule.conditions ?? {}) as RuleConditions;
  if (c.source && facts.source !== c.source) return false;
  if (c.projectType && facts.projectType !== c.projectType) return false;
  if (c.locationContains && (!facts.projectLocation || !facts.projectLocation.toLowerCase().includes(c.locationContains.toLowerCase()))) return false;
  const v = facts.dealValue == null ? null : Number(facts.dealValue);
  if (c.minValue != null && (v == null || v < c.minValue)) return false;
  if (c.maxValue != null && (v == null || v > c.maxValue)) return false;
  return true;
}

/**
 * Evaluate assignment rules for an organization and return the userId to assign,
 * or null if no rule matched. Lower priority value = evaluated first.
 */
export async function evaluateAssignment(
  organizationId: string,
  facts: OpportunityFacts,
): Promise<string | null> {
  const rules = await db
    .select()
    .from(crmAssignmentRules)
    .where(and(eq(crmAssignmentRules.organizationId, organizationId), eq(crmAssignmentRules.isActive, true)))
    .orderBy(crmAssignmentRules.priority);

  for (const rule of rules) {
    if (!ruleMatches(rule, facts)) continue;

    if (rule.assignmentType === "USER" && rule.assignedToId) {
      return rule.assignedToId;
    }

    if (rule.assignmentType === "ROUND_ROBIN") {
      const users = (rule.roundRobinUserIds ?? []) as string[];
      if (users.length === 0) continue;
      const nextIndex = (rule.lastAssignedIndex + 1) % users.length;
      const userId = users[nextIndex];
      await db
        .update(crmAssignmentRules)
        .set({ lastAssignedIndex: nextIndex, updatedAt: new Date() })
        .where(eq(crmAssignmentRules.id, rule.id));
      return userId;
    }
  }
  return null;
}
