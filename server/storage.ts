import { db } from "./db";
import {
  executiveDigests,
  crmTranscriptBackfillJobs,
  crmTranscriptBackfillNotificationSettings,
  crmTranscriptBackfillNotifications,
  crmTranscriptBackfillTestAlerts,
  crmTranscriptBackfillAlertDeliveries,
  alertFallbackSent,
  crmTranscriptBackfillAlertResendCooldowns,
  notificationChannelPrefs,
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
import { alias } from "drizzle-orm/pg-core";

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
  // Task #1070 — set when a run transitions to CANCELLED so the UI and
  // run-completed notification can show who stopped it and (optionally)
  // why. Stays NULL on COMPLETED/FAILED rows.
  cancelledById: string | null;
  cancellationReason: string | null;
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
  // Task #1070 — joined attributes for the admin who cancelled the run.
  // All NULL when the row's `cancelled_by_id` is NULL (e.g. COMPLETED /
  // FAILED runs, or a CANCELLED row whose canceller's user was deleted).
  cancelledByFirstName: string | null;
  cancelledByLastName: string | null;
  cancelledByEmail: string | null;
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
  /**
   * Task #1090 — exact match on the user id of whoever cancelled the run.
   * Set by the "Cancelled by" quick-pick dropdown so admins can quickly
   * find every run a specific person stopped. Mirrors `startedById`.
   */
  cancelledById?: string;
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

  // Task #1090 — exact-match filter on the canceller. Combined with AND so
  // admins can chain it with status/date/operator pickers.
  if (opts.cancelledById) {
    conditions.push(eq(crmTranscriptBackfillJobs.cancelledById, opts.cancelledById));
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

  // Task #1070 — alias the users table for the canceller join so it can
  // coexist with the existing starter join in the same query without
  // ambiguous column references.
  const cancellerUsers = alias(users, "cancelled_by_users");
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
      cancelledById: crmTranscriptBackfillJobs.cancelledById,
      cancellationReason: crmTranscriptBackfillJobs.cancellationReason,
      startedByFirstName: users.firstName,
      startedByLastName: users.lastName,
      startedByEmail: users.email,
      cancelledByFirstName: cancellerUsers.firstName,
      cancelledByLastName: cancellerUsers.lastName,
      cancelledByEmail: cancellerUsers.email,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
    .leftJoin(cancellerUsers, eq(cancellerUsers.id, crmTranscriptBackfillJobs.cancelledById))
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

// Task #1090 — distinct set of users who have cancelled at least one
// transcript backfill in the given org. Powers the "Cancelled by" quick-pick
// dropdown in the admin history UI so admins can filter by an exact user id
// without having to remember the canceller's spelling. Mirrors the shape and
// behaviour of `listCrmTranscriptBackfillOperators` for the starter side.
export async function listCrmTranscriptBackfillCancellers(
  organizationId: string,
): Promise<CrmTranscriptBackfillOperator[]> {
  const rows = await db
    .select({
      id: crmTranscriptBackfillJobs.cancelledById,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      jobCount: sql<number>`count(*)::int`,
    })
    .from(crmTranscriptBackfillJobs)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.cancelledById))
    .where(
      and(
        eq(crmTranscriptBackfillJobs.organizationId, organizationId),
        sql`${crmTranscriptBackfillJobs.cancelledById} IS NOT NULL`,
      ),
    )
    .groupBy(
      crmTranscriptBackfillJobs.cancelledById,
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

// Task #1052 — paginated history of test-alert audit rows for the admin
// transcript backfill page so admins can scroll back through prior attempts
// (when a channel started failing, who has been hammering the button) without
// dropping into a SQL session. Mirrors the SUPER_ADMIN cross-org behavior of
// the main backfill history endpoint: pass `organizationId` to scope, omit it
// to get a platform-wide view (org-scoped admins are always locked to their
// own org by the route layer).
export type CrmTranscriptBackfillTestAlertWithContext =
  CrmTranscriptBackfillTestAlertWithSender & {
    organizationName: string | null;
    organizationSlug: string | null;
  };

export async function listCrmTranscriptBackfillTestAlerts(opts: {
  organizationId?: string;
  limit?: number;
  offset?: number;
  // Task #1061 — optional filters so admins debugging long-running patterns
  // can narrow the panel by sender (free-text match against the resolved
  // user's name/email/operator snapshot), per-channel result, and a date
  // range. Each filter is independent and combined with AND.
  sender?: string;
  slackOk?: boolean;
  emailOk?: boolean;
  // Convenience filter for "either channel failed" (slackOk=false OR
  // emailOk=false), which can't be expressed by ANDing slackOk/emailOk.
  anyFailed?: boolean;
  sentAfter?: Date;
  sentBefore?: Date;
}): Promise<{
  rows: CrmTranscriptBackfillTestAlertWithContext[];
  total: number;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conditions: SQL[] = [];
  if (opts.organizationId) {
    conditions.push(
      eq(crmTranscriptBackfillTestAlerts.organizationId, opts.organizationId),
    );
  }
  if (opts.sender && opts.sender.trim().length > 0) {
    // Case-insensitive substring match against the joined user's first/last
    // name and email plus the persisted operatorDisplay snapshot (covers
    // historical rows whose user record may have been deleted).
    const pattern = `%${opts.sender.trim().toLowerCase()}%`;
    conditions.push(
      sql`(
        lower(coalesce(${users.firstName}, '')) like ${pattern}
        or lower(coalesce(${users.lastName}, '')) like ${pattern}
        or lower(coalesce(${users.email}, '')) like ${pattern}
        or lower(coalesce(${crmTranscriptBackfillTestAlerts.operatorDisplay}, '')) like ${pattern}
        or lower(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')) like ${pattern}
      )`,
    );
  }
  if (typeof opts.slackOk === "boolean") {
    conditions.push(eq(crmTranscriptBackfillTestAlerts.slackOk, opts.slackOk));
  }
  if (typeof opts.emailOk === "boolean") {
    conditions.push(eq(crmTranscriptBackfillTestAlerts.emailOk, opts.emailOk));
  }
  if (opts.anyFailed === true) {
    conditions.push(
      sql`(${crmTranscriptBackfillTestAlerts.slackOk} = false or ${crmTranscriptBackfillTestAlerts.emailOk} = false)`,
    );
  } else if (opts.anyFailed === false) {
    // "Both channels ok" — useful as a counterpart so admins can audit
    // healthy runs too.
    conditions.push(
      sql`(${crmTranscriptBackfillTestAlerts.slackOk} = true and ${crmTranscriptBackfillTestAlerts.emailOk} = true)`,
    );
  }
  if (opts.sentAfter) {
    conditions.push(gte(crmTranscriptBackfillTestAlerts.sentAt, opts.sentAfter));
  }
  if (opts.sentBefore) {
    conditions.push(lte(crmTranscriptBackfillTestAlerts.sentAt, opts.sentBefore));
  }

  const whereClause =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  const baseRows = db
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
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(crmTranscriptBackfillTestAlerts)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillTestAlerts.sentById))
    .leftJoin(
      organizations,
      eq(organizations.id, crmTranscriptBackfillTestAlerts.organizationId),
    );

  const rows = await (whereClause ? baseRows.where(whereClause) : baseRows)
    .orderBy(
      desc(crmTranscriptBackfillTestAlerts.sentAt),
      desc(crmTranscriptBackfillTestAlerts.id),
    )
    .limit(limit)
    .offset(offset);

  const totalQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmTranscriptBackfillTestAlerts)
    .leftJoin(users, eq(users.id, crmTranscriptBackfillTestAlerts.sentById));
  const [{ count }] = await (whereClause
    ? totalQuery.where(whereClause)
    : totalQuery);

  return {
    rows: rows as CrmTranscriptBackfillTestAlertWithContext[],
    total: Number(count) || 0,
  };
}

// Task #1060 — usage frequency rollup for the test-alert button so admins can
// see at a glance how often the button is being clicked (and therefore spot
// misuse / runaway scripts) without paging through the full audit history.
// Counts are computed in three rolling windows ending at "now"; we issue a
// single SQL statement with FILTER clauses so the three windows always agree
// on the same wall-clock cutoff.
export type CrmTranscriptBackfillTestAlertUsageSummary = {
  last24h: number;
  last7d: number;
  last30d: number;
  windowEndsAt: string;
};

export async function getCrmTranscriptBackfillTestAlertUsageSummary(opts: {
  organizationId?: string;
}): Promise<CrmTranscriptBackfillTestAlertUsageSummary> {
  const now = new Date();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const baseQuery = db
    .select({
      last24h: sql<number>`count(*) filter (where ${crmTranscriptBackfillTestAlerts.sentAt} >= ${cutoff24h})::int`,
      last7d: sql<number>`count(*) filter (where ${crmTranscriptBackfillTestAlerts.sentAt} >= ${cutoff7d})::int`,
      last30d: sql<number>`count(*) filter (where ${crmTranscriptBackfillTestAlerts.sentAt} >= ${cutoff30d})::int`,
    })
    .from(crmTranscriptBackfillTestAlerts);

  const [row] = opts.organizationId
    ? await baseQuery.where(
        eq(crmTranscriptBackfillTestAlerts.organizationId, opts.organizationId),
      )
    : await baseQuery;

  return {
    last24h: Number(row?.last24h) || 0,
    last7d: Number(row?.last7d) || 0,
    last30d: Number(row?.last30d) || 0,
    windowEndsAt: now.toISOString(),
  };
}

// Task #1093 — per-day usage buckets for the test-alert button so the admin
// transcript backfill page can render a small sparkline next to the
// 24h/7d/30d rollup. Returns one row per day (UTC) over the trailing
// `days` window, including days with zero alerts so the chart x-axis is
// continuous. Implemented with generate_series + a left join so we don't
// have to fill gaps in JS (and so SUPER_ADMINs get cross-org totals when
// no organizationId is passed). Days are returned oldest-first.
export type CrmTranscriptBackfillTestAlertUsageBucket = {
  day: string; // YYYY-MM-DD (UTC)
  count: number;
};

export async function getCrmTranscriptBackfillTestAlertUsageBuckets(opts: {
  organizationId?: string;
  days: number;
}): Promise<{
  buckets: CrmTranscriptBackfillTestAlertUsageBucket[];
  windowEndsAt: string;
  days: number;
}> {
  const days = Math.min(Math.max(Math.floor(opts.days) || 30, 1), 90);
  const now = new Date();

  const orgFilter = opts.organizationId
    ? sql`AND a.organization_id = ${opts.organizationId}`
    : sql``;

  const result = await db.execute(sql`
    WITH days AS (
      SELECT (date_trunc('day', now() AT TIME ZONE 'UTC')
              - ((${days - 1} - g) || ' days')::interval)::date AS day
      FROM generate_series(0, ${days - 1}) AS g
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      COUNT(a.id)::int AS count
    FROM days d
    LEFT JOIN crm_transcript_backfill_test_alerts a
      ON (a.sent_at AT TIME ZONE 'UTC')::date = d.day
      ${orgFilter}
    GROUP BY d.day
    ORDER BY d.day ASC
  `);

  const rows = (result as unknown as { rows: Array<{ day: string; count: number }> }).rows
    ?? (result as unknown as Array<{ day: string; count: number }>);

  const buckets: CrmTranscriptBackfillTestAlertUsageBucket[] = (rows as Array<{ day: string; count: number | string }>)
    .map((r) => ({ day: String(r.day), count: Number(r.count) || 0 }));

  return {
    buckets,
    windowEndsAt: now.toISOString(),
    days,
  };
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
      // Task #1090 — keep the locate page count in sync with the listing
      // when the "Cancelled by" quick-pick is active.
      if (filters.cancelledById) {
        conds.push(eq(crmTranscriptBackfillJobs.cancelledById, filters.cancelledById));
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
    !!filters.cancelledById ||
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
    if (filters.cancelledById) {
      matchConds.push(eq(crmTranscriptBackfillJobs.cancelledById, filters.cancelledById));
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
}

// ---------------------------------------------------------------------------
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
  // Task #1069 — provenance of this row. Defaults preserve the prior
  // behavior (every dispatcher write is treated as automatic with no
  // acting admin), so existing call sites don't need to pass these.
  source?: "automatic" | "resend";
  triggeredById?: string | null;
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
      source: data.source ?? "automatic",
      triggeredById: data.triggeredById ?? null,
    })
    .returning();
  return row;
}

// Task #1050 — single-row lookup so the "Resend" admin action can verify
// the failed delivery still exists and belongs to the caller's org before
// re-dispatching the same job/channel.
export async function getCrmTranscriptBackfillAlertDelivery(
  id: string,
  organizationId: string,
): Promise<CrmTranscriptBackfillAlertDelivery | null> {
  const [row] = await db
    .select()
    .from(crmTranscriptBackfillAlertDeliveries)
    .where(
      and(
        eq(crmTranscriptBackfillAlertDeliveries.id, id),
        eq(crmTranscriptBackfillAlertDeliveries.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row || null;
}

// Task #1069 — when a row was written by an admin clicking Resend we want
// the history list to render "Resent by Jane" without the client making a
// second round-trip per row. The list query LEFT JOINs `users` so the
// triggering admin's name (or email fallback) is available alongside the
// delivery row. Automatic dispatches keep `triggeredBy = null` and render
// exactly as they did before.
export type CrmTranscriptBackfillAlertDeliveryHistoryItem =
  CrmTranscriptBackfillAlertDelivery & {
    triggeredBy: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null;
  };

export async function listCrmTranscriptBackfillAlertDeliveries(
  organizationId: string,
  limit = 10,
): Promise<CrmTranscriptBackfillAlertDeliveryHistoryItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const rows = await db
    .select({
      delivery: crmTranscriptBackfillAlertDeliveries,
      triggeredById: users.id,
      triggeredByFirstName: users.firstName,
      triggeredByLastName: users.lastName,
      triggeredByEmail: users.email,
    })
    .from(crmTranscriptBackfillAlertDeliveries)
    .leftJoin(
      users,
      eq(users.id, crmTranscriptBackfillAlertDeliveries.triggeredById),
    )
    .where(
      eq(crmTranscriptBackfillAlertDeliveries.organizationId, organizationId),
    )
    .orderBy(desc(crmTranscriptBackfillAlertDeliveries.attemptedAt))
    .limit(safeLimit);
  return rows.map((r) => ({
    ...r.delivery,
    triggeredBy: r.triggeredById
      ? {
          id: r.triggeredById,
          firstName: r.triggeredByFirstName,
          lastName: r.triggeredByLastName,
          email: r.triggeredByEmail ?? "",
        }
      : null,
  }));
}

// Task #1051 — fallback email when alert delivery fails. Looks up active org
// admins eligible to receive the fallback notice. We respect the same per-user
// preferences the existing run-completion summary respects (Task #1021): an
// admin who set their `crmBackfillSummaryChannel` to "none" is treated as
// having opted out of these alerts entirely, and one whose
// `notification_channel_prefs.email_enabled` is explicitly `false` is treated
// as a legacy global email opt-out (matching the routing in
// `crmCallsRoutes.notifyBackfillCompletionToOrgAdmins`). Users without a
// notification_channel_prefs row still receive the fallback so freshly-
// onboarded orgs aren't silent.
//
// Task #1066 — additional per-admin mute knobs scoped just to the fallback
// fan-out (without having to give up the run-completion summary):
//   - `crmAlertFailureFallbackEnabled = false` mutes ALL failure fallbacks.
//   - `crmAlertFailureFallbackMutedChannels` lists specific failing
//     channels (e.g. ["slack"]) to suppress; other channels still alert.
//     Callers pass the failing `channel` so the muted-channel filter can
//     run; omitting it preserves the legacy "any channel" behavior.
//
// Task #1076 — admins can additionally pick which of the two streams of
// alert-failure emails they want via `users.alert_failure_email_mode`:
// real-time only, daily digest only, both (legacy default), or neither.
// Callers pass the stream they're dispatching for (`"realtime"` from the
// per-failure fan-out in `notifyOrgAdminsOfAlertDeliveryFailure`, `"digest"`
// from `runAlertFailureDigest`) and recipients who opted out of that stream
// are filtered out here. Omitting the stream preserves the legacy behavior
// (no extra filter) for any internal/test callers. Both filters compose:
// the admin must pass the Task #1066 mute checks AND opt into the requested
// stream to receive the email.
export type OrgAdminFailureFallbackRecipient = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export type AlertFailureEmailStream = "realtime" | "digest";

function alertFailureEmailModeAllows(
  mode: string | null | undefined,
  stream: AlertFailureEmailStream | undefined,
): boolean {
  if (!stream) return true; // No stream filter requested.
  // Treat unknown / null modes as the legacy "both" so we never silently
  // drop a recipient because of an unmigrated row.
  const m = mode ?? "both";
  if (m === "none") return false;
  if (m === "both") return true;
  return m === stream;
}

export async function listOrgAdminsForAlertFailureFallback(
  organizationId: string,
  channel?: "slack" | "email",
  stream?: AlertFailureEmailStream,
): Promise<OrgAdminFailureFallbackRecipient[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      emailEnabled: notificationChannelPrefs.emailEnabled,
      backfillChannel: users.crmBackfillSummaryChannel,
      fallbackEnabled: users.crmAlertFailureFallbackEnabled,
      fallbackMutedChannels: users.crmAlertFailureFallbackMutedChannels,
      alertFailureEmailMode: users.alertFailureEmailMode,
    })
    .from(users)
    .leftJoin(
      notificationChannelPrefs,
      eq(notificationChannelPrefs.userId, users.id),
    )
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
      ),
    );

  const seen = new Set<string>();
  const out: OrgAdminFailureFallbackRecipient[] = [];
  for (const r of rows) {
    if (r.backfillChannel === "none") continue;
    if (r.emailEnabled === false) continue; // legacy global opt-out
    // Task #1066: scoped fallback opt-outs.
    if (r.fallbackEnabled === false) continue;
    if (channel) {
      const muted = Array.isArray(r.fallbackMutedChannels)
        ? r.fallbackMutedChannels
        : [];
      if (muted.includes(channel)) continue;
    }
    // Task #1076: per-stream opt-in (orthogonal to the Task #1066 mute knobs).
    if (!alertFailureEmailModeAllows(r.alertFailureEmailMode, stream)) continue;
    const email = (r.email ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: r.id,
      email,
      firstName: r.firstName ?? null,
      lastName: r.lastName ?? null,
    });
  }
  return out;
}

// Task #1079 — surface "fallback suppressed (channel muted by N admins)"
// on the admin transcript-backfill page. The per-failure row UI needs to
// know, for each delivery channel, (a) how many active org admins muted
// that channel via the new per-channel mute switch and (b) how many
// admins would still receive the realtime fan-out. When the effective
// recipient count drops to zero AND at least one admin muted the channel,
// the row is rendered with a badge so admins reviewing failures don't
// mistakenly assume the rest of the team also got notified.
//
// We mirror the same exclusion rules as `listOrgAdminsForAlertFailureFallback`
// (legacy email opt-out, summary-channel "none", fallbackEnabled=false,
// per-channel mute, alert-failure-email mode) so the surfaced count and
// the actual fan-out stay in sync. The mute count is a strict subset of
// "admins who would otherwise have been eligible" — i.e. it doesn't
// include admins already excluded by the summary-channel or
// fallback-disabled toggles, because those admins didn't actively pick
// a per-channel mute.
export type AlertFailureFallbackChannelSummary = {
  mutedAdminCount: number;
  effectiveRecipientCount: number;
};

export type AlertFailureFallbackMuteSummary = {
  slack: AlertFailureFallbackChannelSummary;
  email: AlertFailureFallbackChannelSummary;
};

export async function summarizeOrgAdminAlertFailureFallbackMutes(
  organizationId: string,
): Promise<AlertFailureFallbackMuteSummary> {
  const rows = await db
    .select({
      emailEnabled: notificationChannelPrefs.emailEnabled,
      backfillChannel: users.crmBackfillSummaryChannel,
      fallbackEnabled: users.crmAlertFailureFallbackEnabled,
      fallbackMutedChannels: users.crmAlertFailureFallbackMutedChannels,
      alertFailureEmailMode: users.alertFailureEmailMode,
      email: users.email,
    })
    .from(users)
    .leftJoin(
      notificationChannelPrefs,
      eq(notificationChannelPrefs.userId, users.id),
    )
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
      ),
    );

  const summary: AlertFailureFallbackMuteSummary = {
    slack: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
    email: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
  };
  const seen = new Set<string>();
  for (const r of rows) {
    const email = (r.email ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // The "muted by N admins" count we surface is intentionally limited
    // to admins who *would otherwise* have been on the realtime fan-out;
    // admins already excluded (summary-channel none, legacy email
    // opt-out, fallback fully disabled, or wrong stream mode) didn't
    // actively pick a per-channel mute and shouldn't inflate the badge.
    if (r.backfillChannel === "none") continue;
    if (r.emailEnabled === false) continue;
    if (r.fallbackEnabled === false) continue;
    if (!alertFailureEmailModeAllows(r.alertFailureEmailMode, "realtime")) {
      continue;
    }
    const muted = Array.isArray(r.fallbackMutedChannels)
      ? r.fallbackMutedChannels
      : [];
    for (const ch of ["slack", "email"] as const) {
      if (muted.includes(ch)) summary[ch].mutedAdminCount += 1;
      else summary[ch].effectiveRecipientCount += 1;
    }
  }
  return summary;
}

// Task #1085 — surface each active org admin's `alertFailureEmailMode`
// (real-time / digest / both / none) on the admin transcript-backfill page
// so ops leads can see at a glance which admins fall into which bucket
// without having to open every admin profile. The visual flag on the
// front-end fires when no admin has a mode that includes the realtime
// stream, since a misconfigured webhook would then only be noticed via
// the next day's digest.
//
// We deliberately do NOT apply the Task #1066 mute / Task #1051 fallback
// disable filters here: an admin who fully opted out via those switches
// is still useful to surface ("everybody muted us") and the per-row mode
// badge stays meaningful regardless. Callers that want the actual fan-out
// recipient list should keep using `listOrgAdminsForAlertFailureFallback`.
export type OrgAdminAlertFailureMode = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  alertFailureEmailMode: "both" | "realtime" | "digest" | "none";
};

export async function listOrgAdminAlertFailureModes(
  organizationId: string,
): Promise<OrgAdminAlertFailureMode[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      alertFailureEmailMode: users.alertFailureEmailMode,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
      ),
    );

  const seen = new Set<string>();
  const out: OrgAdminAlertFailureMode[] = [];
  for (const r of rows) {
    const email = (r.email ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Treat unknown / null modes as the legacy "both" so existing rows that
    // predate the Task #1076 column rollout don't render as "none".
    const raw = r.alertFailureEmailMode ?? "both";
    const mode: OrgAdminAlertFailureMode["alertFailureEmailMode"] =
      raw === "realtime" || raw === "digest" || raw === "none" ? raw : "both";
    out.push({
      id: r.id,
      email,
      firstName: r.firstName ?? null,
      lastName: r.lastName ?? null,
      alertFailureEmailMode: mode,
    });
  }
  // Stable, predictable ordering for the admin UI: "missing realtime"
  // buckets bubble to the top so ops leads spot the at-risk admins first,
  // then alphabetical by email within each bucket.
  const rank: Record<OrgAdminAlertFailureMode["alertFailureEmailMode"], number> = {
    none: 0,
    digest: 1,
    realtime: 2,
    both: 3,
  };
  out.sort((a, b) => {
    const r = rank[a.alertFailureEmailMode] - rank[b.alertFailureEmailMode];
    if (r !== 0) return r;
    return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
  });
  return out;
}

// Task #1065 — daily digest of recent alert delivery failures.
//
// Aggregates the last N hours of `crm_transcript_backfill_alert_deliveries`
// rows where status='failure', grouped by organization. Returns one entry
// per org that had at least one failure, with per-channel counts plus a
// short list of recent failure rows for the email body. Orgs with zero
// failures in the window are omitted so the digest scheduler can simply
// iterate the result without filtering. The internal "recent failures"
// cap keeps the email body bounded for orgs with hundreds of failures.
export type CrmTranscriptBackfillAlertFailureDigestRow = {
  jobId: string | null;
  channel: "slack" | "email";
  recipientSummary: string;
  errorMessage: string | null;
  attemptedAt: Date;
};

export type CrmTranscriptBackfillAlertFailureDigestEntry = {
  organizationId: string;
  total: number;
  slackCount: number;
  emailCount: number;
  recentFailures: CrmTranscriptBackfillAlertFailureDigestRow[];
};

export async function aggregateRecentCrmTranscriptBackfillAlertFailures(
  since: Date,
  options: { recentSampleLimit?: number } = {},
): Promise<CrmTranscriptBackfillAlertFailureDigestEntry[]> {
  const sampleLimit = Math.max(1, Math.min(options.recentSampleLimit ?? 10, 50));
  const rows = await db
    .select({
      organizationId: crmTranscriptBackfillAlertDeliveries.organizationId,
      jobId: crmTranscriptBackfillAlertDeliveries.jobId,
      channel: crmTranscriptBackfillAlertDeliveries.channel,
      recipientSummary: crmTranscriptBackfillAlertDeliveries.recipientSummary,
      errorMessage: crmTranscriptBackfillAlertDeliveries.errorMessage,
      attemptedAt: crmTranscriptBackfillAlertDeliveries.attemptedAt,
    })
    .from(crmTranscriptBackfillAlertDeliveries)
    .where(
      and(
        eq(crmTranscriptBackfillAlertDeliveries.status, "failure"),
        gte(crmTranscriptBackfillAlertDeliveries.attemptedAt, since),
      ),
    )
    .orderBy(desc(crmTranscriptBackfillAlertDeliveries.attemptedAt));

  const byOrg = new Map<string, CrmTranscriptBackfillAlertFailureDigestEntry>();
  for (const r of rows) {
    let entry = byOrg.get(r.organizationId);
    if (!entry) {
      entry = {
        organizationId: r.organizationId,
        total: 0,
        slackCount: 0,
        emailCount: 0,
        recentFailures: [],
      };
      byOrg.set(r.organizationId, entry);
    }
    entry.total += 1;
    const channel: "slack" | "email" =
      r.channel === "slack" ? "slack" : "email";
    if (channel === "slack") entry.slackCount += 1;
    else entry.emailCount += 1;
    if (entry.recentFailures.length < sampleLimit) {
      entry.recentFailures.push({
        jobId: r.jobId,
        channel,
        recipientSummary: r.recipientSummary,
        errorMessage: r.errorMessage,
        attemptedAt: r.attemptedAt,
      });
    }
  }
  return Array.from(byOrg.values());
}

// ---------------------------------------------------------------------------
// Task #1067 — persisted dedupe ledger for alert-failure fan-out emails.
//
// `notifyOrgAdminsOfAlertDeliveryFailure` previously kept its 1-hour dedupe
// window in an in-memory Map per process. A deploy/restart wiped the map,
// so a continuously-broken webhook could produce one extra fan-out email
// per process per deploy. These helpers persist the "last sent" timestamp
// keyed by (org, channel, recipient summary, error hash) so every process
// (across deploys/pods) consults the same ledger before fanning out.
// ---------------------------------------------------------------------------
export type AlertFallbackSentKey = {
  orgId: string;
  channel: string;
  recipientSummary: string;
  errorHash: string;
};

export async function wasAlertFallbackSentSince(
  key: AlertFallbackSentKey,
  since: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ sentAt: alertFallbackSent.sentAt })
    .from(alertFallbackSent)
    .where(
      and(
        eq(alertFallbackSent.orgId, key.orgId),
        eq(alertFallbackSent.channel, key.channel),
        eq(alertFallbackSent.errorHash, key.errorHash),
        eq(alertFallbackSent.recipientSummary, key.recipientSummary),
        gte(alertFallbackSent.sentAt, since),
      ),
    )
    .orderBy(desc(alertFallbackSent.sentAt))
    .limit(1);
  return !!row;
}

export async function recordAlertFallbackSent(
  key: AlertFallbackSentKey,
): Promise<void> {
  await db.insert(alertFallbackSent).values({
    orgId: key.orgId,
    channel: key.channel,
    recipientSummary: key.recipientSummary,
    errorHash: key.errorHash,
  });
}

/**
 * Best-effort housekeeping so the ledger doesn't grow unbounded. Callers can
 * invoke this opportunistically (e.g. inside the dispatcher after a real send)
 * without blocking on the result. Keeps the table to recent history only.
 */
export async function pruneAlertFallbackSentBefore(cutoff: Date): Promise<void> {
  await db.delete(alertFallbackSent).where(lte(alertFallbackSent.sentAt, cutoff));
}

// ---------------------------------------------------------------------------
// Task #1098 — persisted, fleet-wide cooldown for the "resend alert
// delivery" admin button. Task #1068 originally held this in an in-process
// Map, which meant the window reset every deploy/restart and was not shared
// across replicas. Two admins clicking on different pods (or one admin who
// timed a deploy) could still bypass the cooldown.
//
// `tryReserveBackfillAlertResendCooldown` performs an atomic upsert against
// the persisted ledger — the conditional `setWhere` clause makes the
// reservation succeed only when no row exists OR the existing row is
// already older than the cooldown, so two concurrent reservers (in the
// same process or on different replicas) cannot both win. The helper
// returns `{ ok: true }` on a successful reservation and
// `{ ok: false, retryAfterSeconds }` when the cooldown is still active.
//
// `releaseBackfillAlertResendCooldown` rolls back a reservation only if
// the row still has the timestamp the caller stamped, so a later, valid
// reservation is never accidentally cleared.
// ---------------------------------------------------------------------------
export type BackfillAlertResendCooldownKey = {
  orgId: string;
  jobId: string;
  channel: string;
};

export type BackfillAlertResendReservationResult =
  | { ok: true; reservedAt: Date }
  | { ok: false; retryAfterSeconds: number };

export async function tryReserveBackfillAlertResendCooldown(
  key: BackfillAlertResendCooldownKey,
  cooldownMs: number,
  now: Date = new Date(),
): Promise<BackfillAlertResendReservationResult> {
  const cutoff = new Date(now.getTime() - cooldownMs);
  // Atomic upsert: insert when no row exists, or update only when the
  // existing reservation is older than the cooldown window. If neither
  // branch fires, RETURNING comes back empty and we know the cooldown is
  // still in effect.
  const reserved = await db
    .insert(crmTranscriptBackfillAlertResendCooldowns)
    .values({
      orgId: key.orgId,
      jobId: key.jobId,
      channel: key.channel,
      lastResendAt: now,
    })
    .onConflictDoUpdate({
      target: [
        crmTranscriptBackfillAlertResendCooldowns.orgId,
        crmTranscriptBackfillAlertResendCooldowns.jobId,
        crmTranscriptBackfillAlertResendCooldowns.channel,
      ],
      set: { lastResendAt: now },
      setWhere: lte(
        crmTranscriptBackfillAlertResendCooldowns.lastResendAt,
        cutoff,
      ),
    })
    .returning({
      lastResendAt: crmTranscriptBackfillAlertResendCooldowns.lastResendAt,
    });
  if (reserved.length > 0) {
    return { ok: true, reservedAt: reserved[0].lastResendAt };
  }
  // The upsert was a no-op because the existing reservation is still within
  // the cooldown window. Read it back to compute Retry-After. If the row
  // somehow vanished between the upsert and this read (e.g. a TTL prune),
  // treat the slot as available so the next dispatch can proceed.
  const [existing] = await db
    .select({
      lastResendAt: crmTranscriptBackfillAlertResendCooldowns.lastResendAt,
    })
    .from(crmTranscriptBackfillAlertResendCooldowns)
    .where(
      and(
        eq(crmTranscriptBackfillAlertResendCooldowns.orgId, key.orgId),
        eq(crmTranscriptBackfillAlertResendCooldowns.jobId, key.jobId),
        eq(crmTranscriptBackfillAlertResendCooldowns.channel, key.channel),
      ),
    )
    .limit(1);
  if (!existing) {
    return { ok: true, reservedAt: now };
  }
  const elapsedMs = Math.max(0, now.getTime() - existing.lastResendAt.getTime());
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((cooldownMs - elapsedMs) / 1000),
  );
  return { ok: false, retryAfterSeconds };
}

export async function releaseBackfillAlertResendCooldown(
  key: BackfillAlertResendCooldownKey,
  expectedReservedAt: Date,
): Promise<void> {
  await db
    .delete(crmTranscriptBackfillAlertResendCooldowns)
    .where(
      and(
        eq(crmTranscriptBackfillAlertResendCooldowns.orgId, key.orgId),
        eq(crmTranscriptBackfillAlertResendCooldowns.jobId, key.jobId),
        eq(crmTranscriptBackfillAlertResendCooldowns.channel, key.channel),
        eq(
          crmTranscriptBackfillAlertResendCooldowns.lastResendAt,
          expectedReservedAt,
        ),
      ),
    );
}

export const storage = {};
