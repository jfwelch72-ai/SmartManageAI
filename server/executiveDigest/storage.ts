// Executive digest storage — extracted from server/storage.ts during the
// Task #2672 retirement of the legacy storage monolith. Behavior parity
// with the prior helpers; SQL and signatures unchanged.

import { db } from "../db";
import { executiveDigests } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

export interface ExecutiveDigestInsert {
  organizationId: string;
  period: string;
  executiveSummary: string;
  keyHighlights: string[];
  sections: { title: string; icon: string; summary: string; bullets: string[]; sentiment: string }[];
  actionItems: { priority: string; description: string; dueBy?: string }[];
  kpiSnapshot: { name: string; current: number; previous: number; unit: string; trend: string }[];
  generatedBy: string;
}

export async function createExecutiveDigest(data: ExecutiveDigestInsert) {
  const [saved] = await db
    .insert(executiveDigests)
    .values(data)
    .returning();
  return saved;
}

export async function getLatestExecutiveDigest(organizationId: string, period: string) {
  const [digest] = await db
    .select()
    .from(executiveDigests)
    .where(and(eq(executiveDigests.organizationId, organizationId), eq(executiveDigests.period, period)))
    .orderBy(desc(executiveDigests.generatedAt))
    .limit(1);
  return digest || null;
}
