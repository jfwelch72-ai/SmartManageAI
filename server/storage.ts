import { db } from "./db";
import {
  executiveDigests,
  crmTranscriptBackfillJobs,
  crmTranscriptBackfillNotificationSettings,
  crmTranscriptBackfillNotifications,
  crmTranscriptBackfillTestAlerts,
  crmTranscriptBackfillAlertDeliveries,
  organizations,
  users,
  type CrmTranscriptBackfillJob,
  type CrmTranscriptBackfillNotificationSettings,
  type CrmTranscriptBackfillNotification,
  type CrmTranscriptBackfillAlertDelivery,
  type InsertCrmTranscriptBackfillJob,
  type CrmTranscriptBackfillTestAlert,
  type InsertCrmTranscriptBackfillTestAlert,
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

// Task #1036 — super-admin lookup for cross-tenant cancellation. Unlike
// `getCrmTranscriptBackfillJob`, this does NOT filter by organizationId so
// platform support can address a runaway job in any tenant. Callers MUST
// gate this on isSuperAdmin(req.user) before invoking.
export async function getCrmTranscriptBackfillJobByIdAcrossOrgs(
  id: string,
): Promise<CrmTranscriptBackfillJob | null> {
  const [row] = await db
    .select()
    .from(crmTranscriptBackfillJobs)
    .where(eq(crmTranscriptBackfillJobs.id, id))
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
    // The id tiebreaker keeps pagination deterministic when two jobs share a
    // started_at timestamp — without it the locate-by-job-id helper below
    // could return an offset that points at the wrong row.
    .orderBy(desc(crmTranscriptBackfillJobs.startedAt), desc(crmTranscriptBackfillJobs.id))
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

// Task #1033 — record an audit row each time an admin clicks "Send test
// alert" on the transcript backfill page, including per-channel result so
// the UI can render "Last test alert sent by Jane at 3:14pm — Slack ok,
// email failed" without grepping logs.
export type CrmTranscriptBackfillTestAlertWithSender =
  CrmTranscriptBackfillTestAlert & {
    sentByFirstName: string | null;
    sentByLastName: string | null;
    sentByEmail: string | null;
  };

export async function createCrmTranscriptBackfillTestAlert(
  data: InsertCrmTranscriptBackfillTestAlert,
): Promise<CrmTranscriptBackfillTestAlert> {
  const [row] = await db
    .insert(crmTranscriptBackfillTestAlerts)
    .values(data)
    .returning();
  return row;
}

export async function getLatestCrmTranscriptBackfillTestAlert(
  organizationId: string,
): Promise<CrmTranscriptBackfillTestAlertWithSender | null> {
  const [row] = await db
    .select({
      id: crmTranscriptBackfillTestAlerts.id,
      organizationId: crmTranscriptBackfillTestAlerts.organizationId,
      sentById: crmTranscriptBackfillTestAlerts.sentById,
      sentAt: crmTranscriptBackfillTestAlerts.sentAt,
      operatorDisplay: crmTranscriptBackfillTestAlerts.operatorDisplay,
      slackConfigured: crmTranscriptBackfillTestAlerts.slackConfigured,
      slackOk: crmTranscriptBackfillTestAlerts.slackOk,
      slackError: crmTranscriptBackfillTestAlerts.slackError,
      emailConfigured: crmTranscriptBackfillTestAlerts.emailConfigured,
      emailOk: crmTranscriptBackfillTestAlerts.emailOk,
      emailError: crmTranscriptBackfillTestAlerts.emailError,
      emailRecipients: crmTranscriptBackfillTestAlerts.emailRecipients,
      sentByFirstName: users.firstName,
      sentByLastName: users.lastName,
      sentByEmail: users.email,
    })
    .from(crmTranscriptBackfillTestAlerts)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillTestAlerts.sentById))
    .where(eq(crmTranscriptBackfillTestAlerts.organizationId, organizationId))
    .orderBy(desc(crmTranscriptBackfillTestAlerts.sentAt))
    .limit(1);
  return (row as CrmTranscriptBackfillTestAlertWithSender) || null;
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

// Task #1015 — given a job id, return the 0-based row index it occupies in the
// history listing under the supplied filters. Used so the admin UI can jump
// directly to the page that contains a related backfill run when the user
// clicks an off-page lineage chip.
//
// The org scoping mirrors the history endpoint:
//   - Org-scoped admins must pass their own org id; targets in other orgs are
//     reported as not-found.
//   - SUPER_ADMINs may pass `scopedOrgId: undefined` to look across all orgs.
//
// When the target row does not match the supplied filters, the helper retries
// without those filters (still respecting the org scope) and reports
// `filteredOut: true` so the UI can clear the offending filters before it
// navigates the user. The offset is computed against the same ordering as
// `listCrmTranscriptBackfillJobs` (started_at DESC, id DESC) so it lines up
// with `Math.floor(offset / pageSize)`.
export type LocateCrmTranscriptBackfillJobResult = {
  found: boolean;
  /** 0-based row index in the listing, or null when not found. */
  offset: number | null;
  /** The org the target run belongs to. Useful for SUPER_ADMIN cross-org navigation. */
  organizationId: string | null;
  /** True when the target exists but did not satisfy the supplied non-org filters. */
  filteredOut: boolean;
};

export type LocateCrmTranscriptBackfillJobFilters = Omit<
  ListCrmTranscriptBackfillJobsFilters,
  "limit" | "offset"
>;

export async function locateCrmTranscriptBackfillJobPage(
  jobId: string,
  filters: LocateCrmTranscriptBackfillJobFilters = {},
): Promise<LocateCrmTranscriptBackfillJobResult> {
  // 1. Look up the target row (org-scoped if the caller is restricted).
  const targetWhere: SQL[] = [eq(crmTranscriptBackfillJobs.id, jobId)];
  if (filters.organizationId) {
    targetWhere.push(eq(crmTranscriptBackfillJobs.organizationId, filters.organizationId));
  }
  const [target] = await db
    .select({
      id: crmTranscriptBackfillJobs.id,
      organizationId: crmTranscriptBackfillJobs.organizationId,
      startedAt: crmTranscriptBackfillJobs.startedAt,
    })
    .from(crmTranscriptBackfillJobs)
    .where(targetWhere.length === 1 ? targetWhere[0] : and(...targetWhere))
    .limit(1);

  if (!target) {
    return { found: false, offset: null, organizationId: null, filteredOut: false };
  }

  // 2. Build the count-of-newer query under the same WHERE clause used by the
  //    history listing, plus the strict-newer-row predicate. The result is
  //    the 0-based index of the target row in that ordering.
  const newerPredicate = or(
    sql`${crmTranscriptBackfillJobs.startedAt} > ${target.startedAt}`,
    and(
      eq(crmTranscriptBackfillJobs.startedAt, target.startedAt),
      sql`${crmTranscriptBackfillJobs.id} > ${target.id}`,
    ),
  )!;

  const buildWhere = (includeNonOrgFilters: boolean): SQL => {
    const conds: SQL[] = [newerPredicate];
    if (filters.organizationId) {
      conds.push(eq(crmTranscriptBackfillJobs.organizationId, filters.organizationId));
    }
    if (includeNonOrgFilters) {
      if (filters.statuses && filters.statuses.length > 0) {
        conds.push(inArray(crmTranscriptBackfillJobs.status, filters.statuses));
      }
      if (filters.startedById) {
        conds.push(eq(crmTranscriptBackfillJobs.startedById, filters.startedById));
      }
      if (filters.operator && filters.operator.trim().length > 0) {
        const pattern = `%${filters.operator.trim()}%`;
        const operatorClause = or(
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern),
          ilike(users.email, pattern),
          sql`(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')) ILIKE ${pattern}`,
        );
        if (operatorClause) conds.push(operatorClause);
      }
      if (filters.startedAfter) {
        conds.push(gte(crmTranscriptBackfillJobs.startedAt, filters.startedAfter));
      }
      if (filters.startedBefore) {
        conds.push(lte(crmTranscriptBackfillJobs.startedAt, filters.startedBefore));
      }
    }
    return conds.length === 1 ? conds[0] : and(...conds)!;
  };

  // 3. Does the target itself satisfy the non-org filters? If not, the row
  //    won't appear on any page under those filters and we have to fall back
  //    to the unfiltered (org-scoped) listing.
  const hasNonOrgFilters =
    (filters.statuses && filters.statuses.length > 0) ||
    !!filters.startedById ||
    !!filters.startedAfter ||
    !!filters.startedBefore ||
    !!(filters.operator && filters.operator.trim().length > 0);

  let targetMatchesFilters = true;
  if (hasNonOrgFilters) {
    const matchConds: SQL[] = [eq(crmTranscriptBackfillJobs.id, jobId)];
    if (filters.organizationId) {
      matchConds.push(eq(crmTranscriptBackfillJobs.organizationId, filters.organizationId));
    }
    if (filters.statuses && filters.statuses.length > 0) {
      matchConds.push(inArray(crmTranscriptBackfillJobs.status, filters.statuses));
    }
    if (filters.startedById) {
      matchConds.push(eq(crmTranscriptBackfillJobs.startedById, filters.startedById));
    }
    if (filters.startedAfter) {
      matchConds.push(gte(crmTranscriptBackfillJobs.startedAt, filters.startedAfter));
    }
    if (filters.startedBefore) {
      matchConds.push(lte(crmTranscriptBackfillJobs.startedAt, filters.startedBefore));
    }
    if (filters.operator && filters.operator.trim().length > 0) {
      const pattern = `%${filters.operator.trim()}%`;
      const operatorClause = or(
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
        ilike(users.email, pattern),
        sql`(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')) ILIKE ${pattern}`,
      );
      if (operatorClause) matchConds.push(operatorClause);
    }
    const matched = await db
      .select({ id: crmTranscriptBackfillJobs.id })
      .from(crmTranscriptBackfillJobs)
      .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
      .where(matchConds.length === 1 ? matchConds[0] : and(...matchConds))
      .limit(1);
    targetMatchesFilters = matched.length > 0;
  }

  const useFilters = targetMatchesFilters;
  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .where(buildWhere(useFilters));
  const [{ count: rawCount }] = await countQuery;
  const offset = Number(rawCount) || 0;

  return {
    found: true,
    offset,
    organizationId: target.organizationId,
    filteredOut: !targetMatchesFilters,
  };
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

// Task #1019 — same as `listMostRecentRunningCrmTranscriptBackfillJobsPerOrg`,
// but joins the organization name/slug so the platform-admin pending banner
// can identify which tenant each running job belongs to without a second
// round-trip.
export async function listRunningCrmTranscriptBackfillJobsWithOrg(): Promise<
  CrmTranscriptBackfillJobWithOperator[]
> {
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
      failedRecordingIds: crmTranscriptBackfillJobs.failedRecordingIds,
      startedById: crmTranscriptBackfillJobs.startedById,
      parentJobId: crmTranscriptBackfillJobs.parentJobId,
      startedAt: crmTranscriptBackfillJobs.startedAt,
      completedAt: crmTranscriptBackfillJobs.completedAt,
      heartbeatAt: crmTranscriptBackfillJobs.heartbeatAt,
      updatedAt: crmTranscriptBackfillJobs.updatedAt,
      startedByFirstName: users.firstName,
      startedByLastName: users.lastName,
      startedByEmail: users.email,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .leftJoin(organizations, eq(organizations.id, crmTranscriptBackfillJobs.organizationId))
    .where(eq(crmTranscriptBackfillJobs.status, "RUNNING"))
    .orderBy(desc(crmTranscriptBackfillJobs.startedAt));

  const seen = new Set<string>();
  const result: CrmTranscriptBackfillJobWithOperator[] = [];
  for (const row of rows) {
    if (seen.has(row.organizationId)) continue;
    seen.add(row.organizationId);
    result.push(row as CrmTranscriptBackfillJobWithOperator);
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

// Task #1045 — persist the most recent test-alert outcome so the settings
// card can render last-known health without re-firing the test. Stored on
// the same per-org row as the destinations so it follows the same tenant
// isolation rules. We upsert (instead of update-only) so a test fired before
// the admin has saved any settings still records its result.
export type CrmTranscriptBackfillTestResult = NonNullable<
  CrmTranscriptBackfillNotificationSettings["lastTestResult"]
>;

export async function recordCrmTranscriptBackfillTestResult(
  organizationId: string,
  result: CrmTranscriptBackfillTestResult,
  testedAt: Date = new Date(),
): Promise<CrmTranscriptBackfillNotificationSettings> {
  const [row] = await db
    .insert(crmTranscriptBackfillNotificationSettings)
    .values({
      organizationId,
      slackWebhookUrl: null,
      emailRecipients: [],
      updatedById: null,
      updatedAt: new Date(),
      lastTestAt: testedAt,
      lastTestResult: result,
    })
    .onConflictDoUpdate({
      target: crmTranscriptBackfillNotificationSettings.organizationId,
      set: {
        lastTestAt: testedAt,
        lastTestResult: result,
      },
    })
    .returning();
  return row;
}

export async function clearCrmTranscriptBackfillTestResult(
  organizationId: string,
): Promise<void> {
  await db
    .update(crmTranscriptBackfillNotificationSettings)
    .set({ lastTestAt: null, lastTestResult: null })
    .where(eq(crmTranscriptBackfillNotificationSettings.organizationId, organizationId));
}

// ---------------------------------------------------------------------------
// Task #1022 — audit trail of admins notified for each backfill run.
// Recipient emails are snapshotted (not joined) so the list survives admin
// role changes after the run.
// ---------------------------------------------------------------------------
export type CrmTranscriptBackfillNotificationSummary = {
  id: string;
  jobId: string;
  channel: string;
  recipientEmails: string[];
  recipientCount: number;
  notifiedAt: Date;
};

export async function recordCrmTranscriptBackfillNotification(opts: {
  jobId: string;
  recipientEmails: string[];
  channel?: string;
}): Promise<CrmTranscriptBackfillNotification | null> {
  const channel = opts.channel ?? "EMAIL";
  // De-dupe defensively so the audit row matches what was actually sent.
  const recipients = Array.from(
    new Set(
      (opts.recipientEmails ?? [])
        .map((e) => (typeof e === "string" ? e.trim() : ""))
        .filter((e) => e.length > 0),
    ),
  );
  const [row] = await db
    .insert(crmTranscriptBackfillNotifications)
    .values({
      jobId: opts.jobId,
      channel,
      recipientEmails: recipients,
      recipientCount: recipients.length,
    })
    .returning();
  return row || null;
}

export async function listCrmTranscriptBackfillNotificationsForJobs(
  jobIds: string[],
): Promise<Map<string, CrmTranscriptBackfillNotificationSummary>> {
  const result = new Map<string, CrmTranscriptBackfillNotificationSummary>();
  if (jobIds.length === 0) return result;
  const rows = await db
    .select()
    .from(crmTranscriptBackfillNotifications)
    .where(inArray(crmTranscriptBackfillNotifications.jobId, jobIds))
    .orderBy(desc(crmTranscriptBackfillNotifications.notifiedAt));
  // First (most recent) wins per job — we only emit one notification per
  // run today, but ordering keeps the contract stable if we ever retry.
  for (const row of rows) {
    if (result.has(row.jobId)) continue;
    result.set(row.jobId, {
      id: row.id,
      jobId: row.jobId,
      channel: row.channel,
      recipientEmails: (row.recipientEmails as string[] | null) ?? [],
      recipientCount: row.recipientCount,
      notifiedAt: row.notifiedAt,
    });
  }
  return result;
// Task #1031 — alert delivery history. Each per-channel dispatch attempt is
// recorded so admins can confirm in-app whether the most recent backfill
// alerts actually reached the configured Slack/email destinations.
// ---------------------------------------------------------------------------
export type CrmTranscriptBackfillAlertDeliveryInsert = {
  organizationId: string;
  jobId: string | null;
  channel: "slack" | "email";
  status: "success" | "failure";
  recipientSummary: string;
  errorMessage?: string | null;
};

export async function recordCrmTranscriptBackfillAlertDelivery(
  data: CrmTranscriptBackfillAlertDeliveryInsert,
): Promise<CrmTranscriptBackfillAlertDelivery> {
  const [row] = await db
    .insert(crmTranscriptBackfillAlertDeliveries)
    .values({
      organizationId: data.organizationId,
      jobId: data.jobId,
      channel: data.channel,
      status: data.status,
      recipientSummary: data.recipientSummary.slice(0, 500),
      errorMessage: data.errorMessage ? data.errorMessage.slice(0, 1000) : null,
    })
    .returning();
  return row;
}

export async function listCrmTranscriptBackfillAlertDeliveries(
  organizationId: string,
  limit = 10,
): Promise<CrmTranscriptBackfillAlertDelivery[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const rows = await db
    .select()
    .from(crmTranscriptBackfillAlertDeliveries)
    .where(
      eq(crmTranscriptBackfillAlertDeliveries.organizationId, organizationId),
    )
    .orderBy(desc(crmTranscriptBackfillAlertDeliveries.attemptedAt))
    .limit(safeLimit);
  return rows;
}

export const storage = {};
