import { db } from "./db";
import {
  executiveDigests,
  crmTranscriptBackfillJobs,
  users,
  type CrmTranscriptBackfillJob,
  type InsertCrmTranscriptBackfillJob,
} from "@shared/schema";
import { eq, and, desc, sql, ilike, or, gte, lte, inArray, type SQL } from "drizzle-orm";

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

// ---------------------------------------------------------------------------
// CRM transcript backfill jobs (Task #969). Persists progress so admins can
// still see the last-known state after a server restart.
// ---------------------------------------------------------------------------
export type CrmTranscriptBackfillJobUpdate = Partial<{
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ recordingId: string; error: string }>;
  completedAt: Date | null;
  heartbeatAt: Date;
}>;

export async function createCrmTranscriptBackfillJob(
  data: InsertCrmTranscriptBackfillJob,
): Promise<CrmTranscriptBackfillJob> {
  const [row] = await db.insert(crmTranscriptBackfillJobs).values(data).returning();
  return row;
}

export async function updateCrmTranscriptBackfillJob(
  id: string,
  patch: CrmTranscriptBackfillJobUpdate,
): Promise<CrmTranscriptBackfillJob | null> {
  const [row] = await db
    .update(crmTranscriptBackfillJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(crmTranscriptBackfillJobs.id, id))
    .returning();
  return row || null;
}

export async function getCrmTranscriptBackfillJob(
  id: string,
  organizationId: string,
): Promise<CrmTranscriptBackfillJob | null> {
  const [row] = await db
    .select()
    .from(crmTranscriptBackfillJobs)
    .where(
      and(
        eq(crmTranscriptBackfillJobs.id, id),
        eq(crmTranscriptBackfillJobs.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row || null;
}

export type CrmTranscriptBackfillJobWithOperator = CrmTranscriptBackfillJob & {
  startedByFirstName: string | null;
  startedByLastName: string | null;
  startedByEmail: string | null;
};

export type ListCrmTranscriptBackfillJobsFilters = {
  limit?: number;
  offset?: number;
  /** Filter to one or more job statuses (RUNNING/COMPLETED/FAILED). */
  statuses?: string[];
  /** Substring match on the operator's first name, last name, or email. */
  operator?: string;
  /** Inclusive lower bound on `started_at`. */
  startedAfter?: Date;
  /** Inclusive upper bound on `started_at`. */
  startedBefore?: Date;
};

export async function listCrmTranscriptBackfillJobs(
  organizationId: string,
  opts: ListCrmTranscriptBackfillJobsFilters = {},
): Promise<{ rows: CrmTranscriptBackfillJobWithOperator[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conditions: SQL[] = [eq(crmTranscriptBackfillJobs.organizationId, organizationId)];

  if (opts.statuses && opts.statuses.length > 0) {
    conditions.push(inArray(crmTranscriptBackfillJobs.status, opts.statuses));
  }

  if (opts.operator && opts.operator.trim().length > 0) {
    const pattern = `%${opts.operator.trim()}%`;
    const operatorClause = or(
      ilike(users.firstName, pattern),
      ilike(users.lastName, pattern),
      ilike(users.email, pattern),
      // Match against the concatenated full name so "Jane Doe" matches even
      // though firstName/lastName individually do not contain the space.
      sql`(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')) ILIKE ${pattern}`,
    );
    if (operatorClause) conditions.push(operatorClause);
  }

  if (opts.startedAfter) {
    conditions.push(gte(crmTranscriptBackfillJobs.startedAt, opts.startedAfter));
  }
  if (opts.startedBefore) {
    conditions.push(lte(crmTranscriptBackfillJobs.startedAt, opts.startedBefore));
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select({
      id: crmTranscriptBackfillJobs.id,
      organizationId: crmTranscriptBackfillJobs.organizationId,
      status: crmTranscriptBackfillJobs.status,
      total: crmTranscriptBackfillJobs.total,
      processed: crmTranscriptBackfillJobs.processed,
      succeeded: crmTranscriptBackfillJobs.succeeded,
      failed: crmTranscriptBackfillJobs.failed,
      errors: crmTranscriptBackfillJobs.errors,
      startedById: crmTranscriptBackfillJobs.startedById,
      parentJobId: crmTranscriptBackfillJobs.parentJobId,
      startedAt: crmTranscriptBackfillJobs.startedAt,
      completedAt: crmTranscriptBackfillJobs.completedAt,
      heartbeatAt: crmTranscriptBackfillJobs.heartbeatAt,
      updatedAt: crmTranscriptBackfillJobs.updatedAt,
      startedByFirstName: users.firstName,
      startedByLastName: users.lastName,
      startedByEmail: users.email,
    })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .where(whereClause)
    .orderBy(desc(crmTranscriptBackfillJobs.startedAt))
    .limit(limit)
    .offset(offset);

  const [{ count: totalRaw }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .where(whereClause);
  const total = Number(totalRaw) || 0;

  return { rows: rows as CrmTranscriptBackfillJobWithOperator[], total };
}

export async function getRunningCrmTranscriptBackfillJob(
  organizationId: string,
): Promise<CrmTranscriptBackfillJob | null> {
  const [row] = await db
    .select()
    .from(crmTranscriptBackfillJobs)
    .where(
      and(
        eq(crmTranscriptBackfillJobs.organizationId, organizationId),
        eq(crmTranscriptBackfillJobs.status, "RUNNING"),
      ),
    )
    .orderBy(desc(crmTranscriptBackfillJobs.startedAt))
    .limit(1);
  return row || null;
}

// Returns the most recent RUNNING backfill job per organization across all
// orgs. Used on server boot to find jobs that may need to be resumed (or
// reaped) after a process restart. Because the POST endpoint guards against
// concurrent runs per org, in practice each org should appear at most once.
export async function listMostRecentRunningCrmTranscriptBackfillJobsPerOrg(): Promise<
  CrmTranscriptBackfillJob[]
> {
  const rows = await db
    .select()
    .from(crmTranscriptBackfillJobs)
    .where(eq(crmTranscriptBackfillJobs.status, "RUNNING"))
    .orderBy(desc(crmTranscriptBackfillJobs.startedAt));
  const seen = new Set<string>();
  const result: CrmTranscriptBackfillJob[] = [];
  for (const row of rows) {
    if (seen.has(row.organizationId)) continue;
    seen.add(row.organizationId);
    result.push(row);
  }
  return result;
}

export const storage = {};
