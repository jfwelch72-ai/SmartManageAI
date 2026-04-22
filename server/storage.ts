import { db } from "./db";
import {
  executiveDigests,
  crmTranscriptBackfillJobs,
  crmTranscriptBackfillNotificationSettings,
  organizations,
  users,
  type CrmTranscriptBackfillJob,
  type CrmTranscriptBackfillNotificationSettings,
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
  failedRecordingIds: string[];
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
  organizationName: string | null;
  organizationSlug: string | null;
};

export type ListCrmTranscriptBackfillJobsFilters = {
  limit?: number;
  offset?: number;
  /**
   * Restrict to a single organization. When omitted (undefined), the listing is
   * unscoped — used by SUPER_ADMIN to view backfill history across every org.
   * Org-scoped admins always pass their own organizationId.
   */
  organizationId?: string;
  /** Filter to one or more job statuses (RUNNING/COMPLETED/FAILED). */
  statuses?: string[];
  /** Substring match on the operator's first name, last name, or email. */
  operator?: string;
  /** Exact match on the operator's user id (set by the quick-pick dropdown). */
  startedById?: string;
  /** Inclusive lower bound on `started_at`. */
  startedAfter?: Date;
  /** Inclusive upper bound on `started_at`. */
  startedBefore?: Date;
};

export async function listCrmTranscriptBackfillJobs(
  opts: ListCrmTranscriptBackfillJobsFilters = {},
): Promise<{ rows: CrmTranscriptBackfillJobWithOperator[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conditions: SQL[] = [];
  if (opts.organizationId) {
    conditions.push(eq(crmTranscriptBackfillJobs.organizationId, opts.organizationId));
  }

  if (opts.statuses && opts.statuses.length > 0) {
    conditions.push(inArray(crmTranscriptBackfillJobs.status, opts.statuses));
  }

  if (opts.startedById) {
    conditions.push(eq(crmTranscriptBackfillJobs.startedById, opts.startedById));
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

  const whereClause =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  const baseRows = db
    .select({
      id: crmTranscriptBackfillJobs.id,
      organizationId: crmTranscriptBackfillJobs.organizationId,
      status: crmTranscriptBackfillJobs.status,
      total: crmTranscriptBackfillJobs.total,
      processed: crmTranscriptBackfillJobs.processed,
      succeeded: crmTranscriptBackfillJobs.succeeded,
      failed: crmTranscriptBackfillJobs.failed,
      errors: crmTranscriptBackfillJobs.errors,
      failedRecordingIds: crmTranscriptBackfillJobs.failedRecordingIds,
      startedById: crmTranscriptBackfillJobs.startedById,
      parentJobId: crmTranscriptBackfillJobs.parentJobId,
      startedAt: crmTranscriptBackfillJobs.startedAt,
      completedAt: crmTranscriptBackfillJobs.completedAt,
      heartbeatAt: crmTranscriptBackfillJobs.heartbeatAt,
      updatedAt: crmTranscriptBackfillJobs.updatedAt,
      concurrency: crmTranscriptBackfillJobs.concurrency,
      maxRecords: crmTranscriptBackfillJobs.maxRecords,
      startedByFirstName: users.firstName,
      startedByLastName: users.lastName,
      startedByEmail: users.email,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .leftJoin(organizations, eq(organizations.id, crmTranscriptBackfillJobs.organizationId));

  const rows = await (whereClause ? baseRows.where(whereClause) : baseRows)
    .orderBy(desc(crmTranscriptBackfillJobs.startedAt))
    .limit(limit)
    .offset(offset);

  const baseCount = db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .leftJoin(organizations, eq(organizations.id, crmTranscriptBackfillJobs.organizationId));

  const [{ count: totalRaw }] = await (whereClause ? baseCount.where(whereClause) : baseCount);
  const total = Number(totalRaw) || 0;

  return { rows: rows as CrmTranscriptBackfillJobWithOperator[], total };
}

// Returns the distinct set of operators (users) who have started at least one
// transcript backfill in the given org. Used by the admin history UI to
// populate a quick-pick dropdown so admins can filter by an exact user id
// without having to remember the operator's spelling.
export type CrmTranscriptBackfillOperator = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobCount: number;
};

export async function listCrmTranscriptBackfillOperators(
  organizationId: string,
): Promise<CrmTranscriptBackfillOperator[]> {
  const rows = await db
    .select({
      id: crmTranscriptBackfillJobs.startedById,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      jobCount: sql<number>`count(*)::int`,
    })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .where(
      and(
        eq(crmTranscriptBackfillJobs.organizationId, organizationId),
        sql`${crmTranscriptBackfillJobs.startedById} IS NOT NULL`,
      ),
    )
    .groupBy(
      crmTranscriptBackfillJobs.startedById,
      users.firstName,
      users.lastName,
      users.email,
    )
    .orderBy(users.firstName, users.lastName, users.email);

  return rows
    .filter((r): r is CrmTranscriptBackfillOperator & { id: string } => !!r.id)
    .map((r) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      jobCount: Number(r.jobCount) || 0,
    }));
}

// Task #1008 — fetch the operator (display name + email) who started a
// transcript backfill job, so the run-completed Slack/email notifications
// can name the responsible admin. Returns `null` when the user record has
// been deleted; the notification formatter uses that to render a graceful
// "Unknown operator (deleted user)" fallback.
export type CrmTranscriptBackfillOperatorContact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

export async function getCrmTranscriptBackfillOperatorContact(
  userId: string,
): Promise<CrmTranscriptBackfillOperatorContact | null> {
  const [row] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row || null;
}

// Task #1004 — given a set of backfill job ids, return the full retry lineage
// each one belongs to (the root job + every descendant retry, in chronological
// order). Implemented as a single recursive CTE so we can render the chain
// inline on every history row without N+1 lookups against `parent_job_id`.
//
// Each lineage is keyed by the root job id; the caller maps every page row to
// its root via the `jobToRoot` map so siblings/children sharing a root reuse
// the same lineage array.
export type BackfillLineageEntry = {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  parentJobId: string | null;
};

export async function getCrmTranscriptBackfillLineages(
  organizationId: string | undefined,
  jobIds: string[],
): Promise<{
  jobToRoot: Map<string, string>;
  lineagesByRoot: Map<string, BackfillLineageEntry[]>;
}> {
  const jobToRoot = new Map<string, string>();
  const lineagesByRoot = new Map<string, BackfillLineageEntry[]>();
  if (jobIds.length === 0) return { jobToRoot, lineagesByRoot };

  // Recursive CTE: (1) climb from the page's job ids up to their roots, then
  // (2) descend from those roots back down through every retry. The final
  // SELECT joins back to the table for status/timestamps. Org id is enforced
  // both on the seed rows and on the final select so a malicious id from
  // another tenant cannot leak data through the climb.
  //
  // Task #1007 / #1020: when organizationId is undefined the caller is a
  // SUPER_ADMIN viewing the cross-org history (no single tenant to scope
  // to). In that mode the climb/descend run unfiltered. Org-scoped admins
  // always pass their own organizationId so tenant isolation is preserved.
  const orgFilter = organizationId
    ? sql`AND organization_id = ${organizationId}`
    : sql``;
  const orgFilterAliased = (alias: string) =>
    organizationId
      ? sql.raw(`AND ${alias}.organization_id = `).append(sql`${organizationId}`)
      : sql``;

  const result = await db.execute(sql`
    WITH RECURSIVE
      climb AS (
        SELECT id, parent_job_id
        FROM crm_transcript_backfill_jobs
        WHERE id IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})
          ${orgFilter}
        UNION
        SELECT j.id, j.parent_job_id
        FROM crm_transcript_backfill_jobs j
        JOIN climb c ON c.parent_job_id = j.id
        WHERE 1=1 ${orgFilterAliased("j")}
      ),
      roots AS (
        SELECT DISTINCT id AS root_id
        FROM climb
        WHERE parent_job_id IS NULL
      ),
      descend AS (
        SELECT root_id, root_id AS id
        FROM roots
        UNION
        SELECT d.root_id, j.id
        FROM crm_transcript_backfill_jobs j
        JOIN descend d ON j.parent_job_id = d.id
        WHERE 1=1 ${orgFilterAliased("j")}
      )
    SELECT d.root_id, j.id, j.parent_job_id, j.status,
           j.started_at, j.completed_at
    FROM descend d
    JOIN crm_transcript_backfill_jobs j ON j.id = d.id
    WHERE 1=1 ${orgFilterAliased("j")}
    ORDER BY d.root_id, j.started_at ASC, j.id ASC
  `);

  const rows = ((result as any).rows ?? result) as Array<{
    root_id: string;
    id: string;
    parent_job_id: string | null;
    status: string;
    started_at: Date | string;
    completed_at: Date | string | null;
  }>;

  for (const r of rows) {
    const rootId = r.root_id;
    let lineage = lineagesByRoot.get(rootId);
    if (!lineage) {
      lineage = [];
      lineagesByRoot.set(rootId, lineage);
    }
    lineage.push({
      id: r.id,
      status: r.status,
      parentJobId: r.parent_job_id,
      startedAt: r.started_at instanceof Date ? r.started_at : new Date(r.started_at),
      completedAt: r.completed_at == null
        ? null
        : (r.completed_at instanceof Date ? r.completed_at : new Date(r.completed_at)),
    });
    jobToRoot.set(r.id, rootId);
  }

  return { jobToRoot, lineagesByRoot };
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

// ---------------------------------------------------------------------------
// Task #1017 — per-organization Slack/email destinations for transcript
// backfill alerts. Replaces the env-var fallback as the primary source so
// admins can self-serve from the in-app settings page.
// ---------------------------------------------------------------------------
export type CrmTranscriptBackfillNotificationSettingsUpsert = {
  slackWebhookUrl: string | null;
  emailRecipients: string[];
  updatedById: string | null;
};

export async function getCrmTranscriptBackfillNotificationSettings(
  organizationId: string,
): Promise<CrmTranscriptBackfillNotificationSettings | null> {
  const [row] = await db
    .select()
    .from(crmTranscriptBackfillNotificationSettings)
    .where(eq(crmTranscriptBackfillNotificationSettings.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

export async function upsertCrmTranscriptBackfillNotificationSettings(
  organizationId: string,
  data: CrmTranscriptBackfillNotificationSettingsUpsert,
): Promise<CrmTranscriptBackfillNotificationSettings> {
  const [row] = await db
    .insert(crmTranscriptBackfillNotificationSettings)
    .values({
      organizationId,
      slackWebhookUrl: data.slackWebhookUrl,
      emailRecipients: data.emailRecipients,
      updatedById: data.updatedById,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: crmTranscriptBackfillNotificationSettings.organizationId,
      set: {
        slackWebhookUrl: data.slackWebhookUrl,
        emailRecipients: data.emailRecipients,
        updatedById: data.updatedById,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export const storage = {};
