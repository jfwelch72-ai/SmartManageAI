/**
 * Task #1606 — per-project log email schedule API.
 *
 * Mounted under `/api`, exposes:
 *   - GET /api/projects/:projectId/log-email-schedules
 *       Returns the project's RFI + submittal log schedules. Missing
 *       rows are surfaced as default-OFF entries so the client always
 *       gets a complete picture without inferring absence.
 *   - PUT /api/projects/:projectId/log-email-schedules/:logType
 *       Upserts the schedule for one log type (RFI | SUBMITTAL).
 *       Setting `cadence: "OFF"` is the canonical "stop emailing me"
 *       toggle; we still keep the row so the picked weekday/hour are
 *       remembered when the user re-enables it later.
 *   - POST /api/projects/:projectId/log-email-schedules/:logType/send-now
 *       Task #1638 — admin-on-demand retry. Runs the same per-row
 *       send pipeline the cron uses (flatten recipients → build PDF
 *       → email → stamp outcome columns) so admins can fix bad
 *       distribution-list addresses and immediately re-attempt
 *       instead of waiting up to a week for the next WEEKLY tick.
 *       Per-schedule rate-limited to once every 30 seconds.
 *   - POST /api/projects/:projectId/log-email-schedules/:logType/reset-failure-streak
 *       Task #1679 — admin acknowledgement of a stuck failure
 *       streak. Zeros `consecutive_failure_count` and clears
 *       `last_failure_notified_*` so the red streak badge drops
 *       and the next failure (if any) starts a fresh notification
 *       cycle, without firing a real email. Same role gate as PUT.
 */
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  PROJECT_LOG_EMAIL_CADENCES,
  PROJECT_LOG_EMAIL_LOG_TYPES,
  PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
  PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD,
  PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD,
  PROJECT_LOG_EMAIL_FAILURES_DIGEST_CADENCES,
  PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_CADENCE,
  PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_HOUR,
  PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_TIMEZONE,
  PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_WEEKDAY,
  organizations,
  projectEmailDistributionLists,
  projectLogEmailSchedules,
  projectLogEmailScheduleAttempts,
  projects,
  users,
} from "@shared/schema";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { isValidTimezone } from "@shared/timezones";
import {
  executeProjectLogEmailScheduleSend,
  getProjectLogEmailFailureThreshold,
  processProjectLogEmailFailuresDigest,
} from "./jobs/jobRunner";
import { buildProjectLogPdfBuffer } from "./services/projectLogService";
import { sendEmailWithResult } from "./services/emailService";
import { logError, logInfo } from "./utils/logger";
import {
  consumeRateLimit,
  resetRateLimitStore,
} from "./utils/rateLimitStore";

const router = Router();

const logTypeParam = z.enum(PROJECT_LOG_EMAIL_LOG_TYPES);

// Task #1680 — rolling window (in days) used by the GET endpoint to
// compute "X failed sends in the last 30 days" alongside the existing
// `consecutiveFailureCount` streak. The streak resets to zero on any
// successful send, so a schedule that fails three times, recovers,
// then fails three more times looks identical to a brand-new outage —
// this rolling count is what lets admins distinguish a chronically
// flaky pipeline from a one-off transport blip. 30 days fits well
// inside the 90-day retention default for
// `project_log_email_schedule_attempts`
// (see `server/jobs/projectLogEmailScheduleAttemptPrune.ts`); if an
// operator tightens retention below this value the count would
// naturally under-report, which is the operator's explicit choice.
const ROLLING_FAILURE_WINDOW_DAYS = 30;

const upsertSchema = z.object({
  cadence: z.enum(PROJECT_LOG_EMAIL_CADENCES),
  weekday: z.number().int().min(0).max(6).default(1),
  hour: z.number().int().min(0).max(23).default(8),
  timezone: z.string().min(1).max(100).default("UTC"),
});

async function loadProject(projectId: string, organizationId: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      gcOrganizationId: projects.gcOrganizationId,
      // Task #1649 — surface the PM on the schedule GET so the UI can
      // render "Failure alerts go to: <PM>, <last editor>" without
      // having to round-trip to a separate /api/projects/:id query.
      projectManagerId: projects.projectManagerId,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, organizationId)))
    .limit(1);
  return project ?? null;
}

// Task #1649 — shape the GET endpoint returns for each user that
// would receive a failure-notification fanout. Mirrors the dedupe
// done in `maybeNotifyProjectLogEmailFailure` (last editor + PM,
// deduped by user id) so the card surfaces exactly who the worker
// would notify if the next send fails. The shape is intentionally
// narrow — the card only needs a display name + a way to disambiguate
// two people with the same first/last name.
//
// Task #1655 — adds `isActive` so the card can flag deactivated
// recipients. The worker still creates a notification record for
// inactive users (it just goes unread), so admins editing the
// cadence need to see at a glance that a named recipient can no
// longer act on the alert. We mirror `users.is_active` directly
// rather than filter the list server-side: the UI also needs the
// inactive names so it can render the "all-inactive" empty state
// with full context if we ever want to surface who used to be
// notified.
type FailureNotificationRecipient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
};

router.get(
  "/projects/:projectId/log-email-schedules",
  requireAuth,
  // Match the PUT endpoint's role gate so the schedule is only visible
  // to roles that could actually edit it. Lower-privilege users have no
  // need to see who's getting scheduled emails for a project.
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
      const project = await loadProject(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const rows = await db
        .select()
        .from(projectLogEmailSchedules)
        .where(and(
          eq(projectLogEmailSchedules.organizationId, organizationId),
          eq(projectLogEmailSchedules.projectId, project.id),
        ));

      // Task #1649 — resolve display names for the failure-notification
      // recipients (PM + each row's last editor) in a single batched
      // lookup so the card can render "Failure alerts go to: <names>"
      // without N+1 round-trips. We only pull users from the same
      // organization to defend against any cross-tenant pointer drift —
      // surfacing a user from a different org would be both confusing
      // and a privacy leak. Inactive users are intentionally still
      // included since the worker would still attempt to notify them
      // (their notification record would simply go unread); Task #1655
      // surfaces `isActive` so the card can flag them inline.
      const userIdsToResolve = new Set<string>();
      if (project.projectManagerId) userIdsToResolve.add(project.projectManagerId);
      for (const r of rows) {
        if (r.lastEditedById) userIdsToResolve.add(r.lastEditedById);
      }
      const userById = new Map<string, FailureNotificationRecipient>();
      if (userIdsToResolve.size > 0) {
        const userRows = await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            isActive: users.isActive,
          })
          .from(users)
          .where(and(
            inArray(users.id, Array.from(userIdsToResolve)),
            eq(users.organizationId, organizationId),
          ));
        for (const u of userRows) userById.set(u.id, u);
      }

      function recipientsFor(lastEditedById: string | null): FailureNotificationRecipient[] {
        // Mirrors `maybeNotifyProjectLogEmailFailure`'s dedupe: PM and
        // last editor, in that order, deduped by user id. PM appears
        // first because it represents the project's owning role; the
        // last editor is the secondary "you touched this most recently"
        // signal that the task brief calls out as surprising.
        const ordered: FailureNotificationRecipient[] = [];
        const seen = new Set<string>();
        const candidates = [project.projectManagerId, lastEditedById];
        for (const id of candidates) {
          if (!id || seen.has(id)) continue;
          const user = userById.get(id);
          if (!user) continue;
          seen.add(id);
          ordered.push(user);
        }
        return ordered;
      }

      // Task #1680 — rolling 30-day failure tally per schedule. The
      // existing `consecutiveFailureCount` column resets to 0 on every
      // SUCCESS, which makes a chronically-flaky pipeline (fails 3,
      // recovers, fails 3 more) look identical to a brand-new outage.
      // Aggregating against the immutable `project_log_email_schedule_attempts`
      // history (Task #1652) gives admins "12 failed sends in the last
      // 30 days" alongside the streak so they can prioritise repeat
      // offenders over one-off transport blips.
      //
      // We do this server-side in a single GROUP BY query (rather than
      // per-row) so adding the surface here costs one extra round-trip
      // per page load no matter how many schedule rows the project has.
      // The schedule_id × created_at index already exists for the
      // history endpoint, so this aggregation reuses that.
      const persistedScheduleIds = rows
        .map((r) => r.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const rollingFailureBySchedule = new Map<string, number>();
      if (persistedScheduleIds.length > 0) {
        const windowStart = new Date(
          Date.now() - ROLLING_FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );
        const failureRows = await db
          .select({
            scheduleId: projectLogEmailScheduleAttempts.scheduleId,
            count: sql<number>`count(*)::int`,
          })
          .from(projectLogEmailScheduleAttempts)
          .where(and(
            // Defense-in-depth tenant scope so a stale or cross-tenant
            // schedule id pointer can never sum into another org's
            // counts. The schedule list above is already org-scoped,
            // so this only matters if a future caller widens the rows
            // selection without also widening this clause.
            eq(projectLogEmailScheduleAttempts.organizationId, organizationId),
            inArray(projectLogEmailScheduleAttempts.scheduleId, persistedScheduleIds),
            inArray(projectLogEmailScheduleAttempts.status, ["FAILURE", "NO_RECIPIENTS"]),
            gte(projectLogEmailScheduleAttempts.createdAt, windowStart),
          ))
          .groupBy(projectLogEmailScheduleAttempts.scheduleId);
        for (const f of failureRows) {
          // count() is bigint over the wire; the ::int cast keeps it
          // a JS number, but coerce defensively in case the driver
          // ever surfaces a string.
          const n = typeof f.count === "number" ? f.count : Number(f.count);
          if (Number.isFinite(n) && n > 0) {
            rollingFailureBySchedule.set(f.scheduleId, n);
          }
        }
      }

      const byType = new Map(rows.map((r) => [r.logType, r]));
      // Always return both log types; missing rows surface as the
      // default-OFF schedule the worker would also infer. Task #1622
      // added per-attempt status fields so the UI can render a "Last
      // send failed" badge — surface them as nulls on the default rows
      // so the client doesn't have to defensively probe for missing
      // properties.
      const schedules = PROJECT_LOG_EMAIL_LOG_TYPES.map((logType) => {
        const existing = byType.get(logType);
        if (existing) {
          return {
            ...existing,
            // Task #1649 — decorate each existing row with the resolved
            // recipient set so the card can render the dedupe message
            // without re-implementing the join client-side.
            failureNotificationRecipients: recipientsFor(existing.lastEditedById),
            // Task #1680 — rolling 30-day failure count, aggregated from
            // the per-attempt history so the card can render
            // "X failed sends in the last 30 days" alongside the
            // existing consecutive-failure streak. 0 when no failures
            // happened in the window (or when retention pruned the
            // history).
            rollingFailureCount30d: rollingFailureBySchedule.get(existing.id) ?? 0,
            rollingFailureWindowDays: ROLLING_FAILURE_WINDOW_DAYS,
          };
        }
        return {
          id: null,
          organizationId,
          projectId: project.id,
          logType,
          cadence: "OFF" as const,
          weekday: 1,
          hour: 8,
          timezone: "UTC",
          lastSentAt: null,
          lastAttemptAt: null,
          lastAttemptStatus: null,
          lastAttemptError: null,
          lastAttemptRecipientCount: null,
          // Task #1637 — surface the failure-notification dedupe
          // fields as nulls on the default OFF row so the client
          // doesn't have to defensively probe.
          lastEditedById: null,
          lastFailureNotifiedAt: null,
          lastFailureNotifiedStatus: null,
          // Task #1667 — default-OFF rows have never been attempted,
          // so the failure streak is 0. Surface it explicitly so the
          // client doesn't have to defensively probe for the field.
          consecutiveFailureCount: 0,
          // Task #1680 — default-OFF rows have no schedule id and so
          // no attempt history to aggregate against. Surface the
          // rolling count as 0 (matching the streak's contract) so the
          // client can render with the same code path it uses for
          // persisted rows that simply haven't failed recently.
          rollingFailureCount30d: 0,
          rollingFailureWindowDays: ROLLING_FAILURE_WINDOW_DAYS,
          createdAt: null,
          updatedAt: null,
          // Task #1649 — even on the default OFF row, the PM (if any)
          // would still be notified, so surface that single-name set
          // instead of forcing the empty-state copy when the project
          // has an owner.
          failureNotificationRecipients: recipientsFor(null),
        };
      });

      // Task #1667 — surface the env-driven repeated-failure
      // threshold so the client can color the streak badge
      // (amber below the threshold, red at/above it) without
      // having to hardcode a magic number that could drift away
      // from the worker's `getProjectLogEmailFailureThreshold`.
      const failureThreshold = getProjectLogEmailFailureThreshold();
      res.json({ schedules, failureThreshold });
    } catch (err) {
      next(err);
    }
  },
);

// Task #1675 — per-user view of "where am I currently a failure-alert
// recipient?". The `Failure alerts go to:` panel on the project's
// Scheduled Log Emails card already surfaces who would be paged for a
// given project — but a project manager (or recent editor) who lives
// in 30+ projects has no way to know, from their own settings page,
// which routing currently lands on them. This endpoint mirrors the
// recipient computation in `maybeNotifyProjectLogEmailFailure`
// (`server/jobs/jobRunner.ts`) and the GET above:
//   - PM = `projects.project_manager_id`
//   - Last editor = `project_log_email_schedules.last_edited_by_id`
// scoped to the caller's org.
//
// We deliberately *only* surface schedules with `cadence != OFF`:
// the worker only fans out failure notifications when an active
// cadence actually attempts a send, so an OFF row would be a phantom
// listing here. The card on the project page intentionally surfaces
// PMs even on default-OFF rows ("if a future schedule failed…"),
// but for the user-side opt-out story we want the list to match the
// real fan-out set so a "hand-off" action is meaningful.
//
// The response shape groups multiple log types into one row per
// project so the client can render `Bridge 7 — RFI, SUBMITTAL` in a
// single line. Each entry carries enough metadata for a deep-link
// to `/projects/<code>` (the project detail route uses the human
// project code, not the uuid id) without a second round-trip.
router.get(
  "/me/failure-alert-routes",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const organizationId = req.user?.organizationId;
      if (!userId || !organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const rows = await db
        .select({
          projectId: projects.id,
          projectCode: projects.code,
          projectName: projects.name,
          logType: projectLogEmailSchedules.logType,
          cadence: projectLogEmailSchedules.cadence,
          projectManagerId: projects.projectManagerId,
          lastEditedById: projectLogEmailSchedules.lastEditedById,
        })
        .from(projectLogEmailSchedules)
        .innerJoin(projects, eq(projects.id, projectLogEmailSchedules.projectId))
        .where(
          and(
            // Cross-tenant safety: scope by both the schedule row's
            // organization (defense-in-depth in case a stray cross-org
            // pointer exists) and the project's GC org (the canonical
            // tenant boundary the rest of the routes use).
            eq(projectLogEmailSchedules.organizationId, organizationId),
            eq(projects.gcOrganizationId, organizationId),
            // OFF schedules don't fan out failure alerts (see
            // `runProjectLogEmailScheduleSweep` — the worker filters
            // these out before even attempting a send), so they have
            // no business showing up in a "you receive failure alerts
            // for" list.
            ne(projectLogEmailSchedules.cadence, "OFF"),
            // The caller is a recipient if they're the project's PM
            // OR the schedule row's last editor. Mirrors the dedupe
            // in `maybeNotifyProjectLogEmailFailure`.
            or(
              eq(projects.projectManagerId, userId),
              eq(projectLogEmailSchedules.lastEditedById, userId),
            ),
          ),
        );

      // Group by project so the UI can render one row per project
      // with a comma-separated list of log types instead of
      // duplicating the project name across two list items.
      type RouteEntry = {
        projectId: string;
        projectCode: string;
        projectName: string;
        logTypes: Array<{
          logType: "RFI" | "SUBMITTAL";
          cadence: string;
          asPm: boolean;
          asLastEditor: boolean;
        }>;
      };
      const byProject = new Map<string, RouteEntry>();
      for (const r of rows) {
        // Defense-in-depth: the SQL `ne(cadence, "OFF")` clause should
        // already exclude these, but if a future caller refactors the
        // query and accidentally drops the predicate we don't want to
        // start surfacing phantom routes the worker would never page.
        if (String(r.cadence) === "OFF") continue;
        const key = String(r.projectId);
        let entry = byProject.get(key);
        if (!entry) {
          entry = {
            projectId: String(r.projectId),
            projectCode: String(r.projectCode),
            projectName: String(r.projectName),
            logTypes: [],
          };
          byProject.set(key, entry);
        }
        entry.logTypes.push({
          logType: r.logType === "SUBMITTAL" ? "SUBMITTAL" : "RFI",
          cadence: String(r.cadence),
          asPm: r.projectManagerId === userId,
          asLastEditor: r.lastEditedById === userId,
        });
      }

      // Stable, name-sorted output so the panel doesn't reshuffle
      // between renders when the underlying query order changes.
      const routes = Array.from(byProject.values())
        .map((entry) => ({
          ...entry,
          logTypes: entry.logTypes.slice().sort((a, b) => a.logType.localeCompare(b.logType)),
        }))
        .sort((a, b) => a.projectName.localeCompare(b.projectName));

      res.json({ routes });
    } catch (err) {
      next(err);
    }
  },
);

// Task #1638 — per-schedule debounce so the "Send now" button can't be
// hammered (whether by a frantic admin clicking 30 times, a flaky
// network retrying the POST, or a script). Keyed by the schedule row
// id (prefixed below to share a global rate-limit table without
// colliding with other limiters). 30s is the same window the
// front-end disables the button for after a click — this is the
// server-side defense for anyone who skips the UI.
//
// Task #1831 — the timestamp now lives in `rate_limit_state` (Postgres)
// instead of a module-level `Map`. Per-process Maps silently broke
// the moment the deployment ran more than one replica: each pod had
// its own Map, so a click that round-robined to a different pod saw
// an empty bucket and was allowed through. The `consumeRateLimit`
// helper performs the decision in a single `INSERT ... ON CONFLICT
// DO UPDATE ... WHERE` statement so two replicas racing on the same
// schedule still produce exactly one allowed claim and one 429.
const SEND_NOW_DEBOUNCE_MS = 30_000;
const SEND_NOW_RATE_LIMIT_PREFIX = "send-now:";

// Task #1750 — admin "Send test digest now" debounce. Mirrors the
// per-project send-now rate limiter above so a frantic click (or a
// retrying script) can't spam every admin's inbox with duplicate
// digest rows. Keyed by org id since that's the unit of fan-out the
// digest operates on; an org with two SUPER_ADMINs each clicking the
// button would still only fan out once per 30 seconds. The matching
// front-end disables the button for the same window so the typical
// flow doesn't even reach the server.
//
// Task #1831 — also moved into `rate_limit_state` for the same
// multi-replica reason as the send-now debounce.
const TEST_DIGEST_DEBOUNCE_MS = 30_000;
const TEST_DIGEST_RATE_LIMIT_PREFIX = "test-digest:";

// Test-only escape hatches so route-level unit tests can reset the
// shared rate-limit store between cases. Both names are kept (instead
// of being collapsed into a single `__resetRateLimitStoreForTests`)
// because the existing test suites already import them by name and
// because they document, at the call site, *which* limiter the test
// is exercising. Both clear the same backing store, which is
// intentional — tests want a clean slate per case.
export function __resetSendNowDebounceForTests() {
  return resetRateLimitStore();
}

export function __resetTestDigestDebounceForTests() {
  return resetRateLimitStore();
}

router.put(
  "/projects/:projectId/log-email-schedules/:logType",
  requireAuth,
  // Same role gate as the manual "Download log (PDF)" endpoint —
  // anyone who can pull the log on demand can decide to schedule it.
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
      const project = await loadProject(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const logTypeParse = logTypeParam.safeParse(req.params.logType);
      if (!logTypeParse.success) return res.status(400).json({ error: "Invalid logType" });
      const logType = logTypeParse.data;

      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const { cadence, weekday, hour } = parsed.data;
      const timezone = isValidTimezone(parsed.data.timezone) ? parsed.data.timezone : "UTC";

      const [existing] = await db
        .select()
        .from(projectLogEmailSchedules)
        .where(and(
          eq(projectLogEmailSchedules.projectId, project.id),
          eq(projectLogEmailSchedules.logType, logType),
        ))
        .limit(1);

      // Task #1637 — stamp the editing user on every upsert so the
      // worker can fan a failure notification to whoever most
      // recently touched the cadence (alongside the project manager).
      // requireAuth has already populated req.user; fall back to null
      // defensively so the route can never crash on a missing user
      // even if the auth middleware shape changes.
      const lastEditedById = req.user?.id ?? null;

      if (existing) {
        const [updated] = await db
          .update(projectLogEmailSchedules)
          .set({ cadence, weekday, hour, timezone, lastEditedById, updatedAt: new Date() })
          .where(eq(projectLogEmailSchedules.id, existing.id))
          .returning();
        return res.json({ schedule: updated });
      }

      const [inserted] = await db
        .insert(projectLogEmailSchedules)
        .values({
          organizationId,
          projectId: project.id,
          logType,
          cadence,
          weekday,
          hour,
          timezone,
          lastEditedById,
        })
        .returning();
      return res.status(201).json({ schedule: inserted });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/projects/:projectId/log-email-schedules/:logType/send-now",
  requireAuth,
  // Same role gate as the PUT — anyone who can edit the cadence can
  // also trigger a manual send. Lower-privilege users shouldn't be
  // able to fan out a project-wide email on demand.
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const project = await loadProject(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const logTypeParse = logTypeParam.safeParse(req.params.logType);
      if (!logTypeParse.success) return res.status(400).json({ error: "Invalid logType" });
      const logType = logTypeParse.data;

      const [existing] = await db
        .select()
        .from(projectLogEmailSchedules)
        .where(and(
          eq(projectLogEmailSchedules.projectId, project.id),
          eq(projectLogEmailSchedules.logType, logType),
        ))
        .limit(1);

      if (!existing) {
        // No row at all means the schedule has never been configured;
        // there's nothing for the cron to send either, so nothing to
        // re-attempt. Surface a clear 400 instead of silently sending.
        return res.status(400).json({
          error: "No schedule configured for this log type. Pick a cadence and save before triggering a send.",
        });
      }

      if (existing.cadence === "OFF") {
        // The UI hides the button when cadence is OFF, but defend
        // against direct callers — re-sending while the schedule is
        // disabled would be confusing (the cron would never have
        // sent it either).
        return res.status(400).json({
          error: "Schedule is OFF. Set a cadence (Daily/Weekly/Biweekly) before triggering a send.",
        });
      }

      const debounce = await consumeRateLimit(
        `${SEND_NOW_RATE_LIMIT_PREFIX}${existing.id}`,
        SEND_NOW_DEBOUNCE_MS,
        Date.now(),
      );
      if (!debounce.allowed) {
        res.setHeader("Retry-After", String(debounce.retryAfterSeconds));
        return res.status(429).json({
          error: `Please wait ${debounce.retryAfterSeconds} second${debounce.retryAfterSeconds === 1 ? "" : "s"} before triggering another send.`,
          retryAfterSeconds: debounce.retryAfterSeconds,
        });
      }

      const result = await executeProjectLogEmailScheduleSend(
        {
          scheduleId: existing.id,
          organizationId,
          projectId: project.id,
          logType,
          // Task #1651 — pass the pre-attempt streak through so a
          // manual send-now can reset the counter on success or fan
          // out the threshold backstop notification on the crossing
          // failure, exactly the same way the cron does.
          previousConsecutiveFailureCount: existing.consecutiveFailureCount ?? 0,
        },
        // Task #1652 — tag the per-attempt history row as a manual
        // retry triggered by this user so the audit trail shows
        // who clicked "Send now".
        { triggeredBy: { kind: "MANUAL", userId: req.user?.id ?? null } },
      );

      // Re-read the schedule row so the client gets the same shape
      // the GET endpoint returns (lastAttemptAt/Status/Error/etc.
      // already stamped by the helper).
      const [refreshed] = await db
        .select()
        .from(projectLogEmailSchedules)
        .where(eq(projectLogEmailSchedules.id, existing.id))
        .limit(1);

      // Always 200: the HTTP layer succeeded even when the email
      // pipeline reported NO_RECIPIENTS / FAILURE — those are
      // reported in the response body so the client can surface the
      // exact reason inline alongside the now-stamped badge.
      return res.status(200).json({
        result: {
          status: result.status,
          error: result.error,
          recipientCount: result.recipientCount,
        },
        schedule: refreshed ?? existing,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Task #1679 — admin "Reset streak" button on the project settings
// card. Once a schedule's `consecutive_failure_count` has crossed the
// configured threshold the worker fans a backstop notification, and
// the card paints a red "Failed N times in a row" badge. After the
// admin fixes the underlying distribution list the streak only resets
// on the next *successful* attempt — which can be days away if the
// cadence is WEEKLY/BIWEEKLY, and which the admin can't even verify
// without firing a real email at recipients. This endpoint is the
// "I fixed it — silence the badge" escape hatch: it zeroes the
// streak and clears the per-row dedupe marker so the *next* failure
// (if any) starts a fresh notification cycle, all without sending
// any email or touching `last_attempt_*` (which would lie about
// whether a send actually went out).
//
// Same role gate as the PUT — anyone who can edit the cadence can
// also acknowledge a stuck streak. We deliberately do NOT debounce
// this the way we debounce send-now: the operation is idempotent
// (resetting a 0 streak to 0 is a no-op) and doesn't fan out any
// real-world side effect, so a hammered button is harmless.
router.post(
  "/projects/:projectId/log-email-schedules/:logType/reset-failure-streak",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const project = await loadProject(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const logTypeParse = logTypeParam.safeParse(req.params.logType);
      if (!logTypeParse.success) return res.status(400).json({ error: "Invalid logType" });
      const logType = logTypeParse.data;

      const [existing] = await db
        .select()
        .from(projectLogEmailSchedules)
        .where(and(
          eq(projectLogEmailSchedules.projectId, project.id),
          eq(projectLogEmailSchedules.logType, logType),
        ))
        .limit(1);

      if (!existing) {
        // No persisted row means the schedule has never been
        // configured — there's no streak to reset. Mirror the
        // send-now endpoint's 400 so direct callers get a clear
        // signal instead of a silent 200 that pretended to do
        // something.
        return res.status(400).json({
          error: "No schedule configured for this log type. There is no failure streak to reset.",
        });
      }

      const [updated] = await db
        .update(projectLogEmailSchedules)
        .set({
          consecutiveFailureCount: 0,
          lastFailureNotifiedAt: null,
          lastFailureNotifiedStatus: null,
          updatedAt: new Date(),
        })
        .where(eq(projectLogEmailSchedules.id, existing.id))
        .returning();

      logInfo("Project log email schedule failure streak reset", {
        scheduleId: existing.id,
        organizationId,
        projectId: project.id,
        logType,
        actorId: req.user?.id ?? null,
        previousStreak: existing.consecutiveFailureCount ?? 0,
      });

      return res.json({ schedule: updated ?? existing });
    } catch (err) {
      next(err);
    }
  },
);

// Task #1628 — "Send test now" button. Renders the same PDF the cron
// would and emails it to the project's distribution recipients right
// now so admins can verify the pipeline end-to-end without waiting for
// the next scheduled firing. Deliberately does NOT touch
// `lastSentAt` / `lastAttemptAt` on the schedule row so a manual test
// can't move the cadence dedupe window or overwrite the real cron's
// telemetry. Reuses the same role gate as the existing PUT — anyone
// who can configure the cadence can also fire a test send.
router.post(
  "/projects/:projectId/log-email-schedules/:logType/test",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
      const project = await loadProject(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const logTypeParse = logTypeParam.safeParse(req.params.logType);
      if (!logTypeParse.success) return res.status(400).json({ error: "Invalid logType" });
      const logType = logTypeParse.data;

      // Mirror the cron's recipient resolution: project-scoped list +
      // org-level fallback. Keeps the test send aligned with what the
      // scheduled run would actually do.
      const lists = await db
        .select({
          contactEmails: projectEmailDistributionLists.contactEmails,
          extraEmails: projectEmailDistributionLists.extraEmails,
        })
        .from(projectEmailDistributionLists)
        .where(and(
          eq(projectEmailDistributionLists.organizationId, organizationId),
          or(
            eq(projectEmailDistributionLists.projectId, project.id),
            isNull(projectEmailDistributionLists.projectId),
          ),
        ));

      const recipientSet = new Set<string>();
      for (const l of lists) {
        for (const e of l.contactEmails ?? []) {
          if (e && e.includes("@")) recipientSet.add(e.trim().toLowerCase());
        }
        for (const e of l.extraEmails ?? []) {
          if (e && e.includes("@")) recipientSet.add(e.trim().toLowerCase());
        }
      }

      if (recipientSet.size === 0) {
        return res.status(400).json({
          error:
            "No recipients resolved from the project's distribution lists. Add recipients before sending a test.",
          recipientCount: 0,
        });
      }

      const pdfBuffer = await buildProjectLogPdfBuffer(logType, {
        id: project.id,
        name: project.name,
        gcOrganizationId: project.gcOrganizationId,
      });

      const logLabel = logType === "RFI" ? "RFI" : "Submittal";
      const safeName = project.name.replace(/[^a-z0-9]+/gi, "_");
      const filename = `${logType.toLowerCase()}-log-${safeName}.pdf`;
      // Subject line is prefixed with [TEST] so recipients can tell
      // this is an on-demand verification send rather than the regular
      // scheduled digest.
      const subject = `[TEST] ${logLabel} log — ${project.name}`;
      const text = `This is a test send of the ${logLabel} log for project "${project.name}". The attached PDF matches what the scheduled email would deliver.`;
      const html = `<p>This is a <strong>test send</strong> of the ${logLabel} log for project <strong>${project.name}</strong>.</p><p>The attached PDF matches what the scheduled email would deliver.</p>`;

      const recipients = Array.from(recipientSet);
      const result = await sendEmailWithResult({
        to: recipients,
        subject,
        text,
        html,
        attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
      });

      if (!result.ok) {
        logError("Project log email test send failed", {
          projectId: project.id,
          organizationId,
          logType,
          error: result.error,
          recipients: recipients.length,
        });
        return res.status(502).json({
          error: result.error ?? "Unknown email send error",
          recipientCount: recipients.length,
        });
      }

      logInfo("Project log email test send succeeded", {
        projectId: project.id,
        organizationId,
        logType,
        recipients: recipients.length,
      });

      return res.json({ ok: true, recipientCount: recipients.length });
    } catch (err) {
      next(err);
    }
  },
);

// Task #1652 — per-schedule send history. The cron + manual "Send now"
// button each write an immutable row into
// `project_log_email_schedule_attempts` for every attempt; this
// endpoint surfaces the most recent N attempts so admins can audit
// "this failed 5 times this week, then succeeded once after I edited
// the list" without grepping server logs. Capped at 50 to keep the
// payload bounded; the UI defaults to showing the last 10.
const ATTEMPTS_DEFAULT_LIMIT = 10;
const ATTEMPTS_MAX_LIMIT = 50;
router.get(
  "/projects/:projectId/log-email-schedules/:logType/attempts",
  requireAuth,
  // Same role gate as the GET schedules endpoint above — anyone who
  // can see the cadence editor can audit its history.
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
      const project = await loadProject(req.params.projectId, organizationId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const logTypeParse = logTypeParam.safeParse(req.params.logType);
      if (!logTypeParse.success) return res.status(400).json({ error: "Invalid logType" });
      const logType = logTypeParse.data;

      const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, ATTEMPTS_MAX_LIMIT)
        : ATTEMPTS_DEFAULT_LIMIT;

      // Resolve the schedule row id first so the org-scoped where
      // clause on the attempts query is safe even if the table is
      // queried by id-only elsewhere later.
      const [schedule] = await db
        .select({ id: projectLogEmailSchedules.id })
        .from(projectLogEmailSchedules)
        .where(and(
          eq(projectLogEmailSchedules.projectId, project.id),
          eq(projectLogEmailSchedules.logType, logType),
        ))
        .limit(1);

      if (!schedule) {
        // No row means no history yet — return an empty list
        // (consistent with the GET /log-email-schedules endpoint
        // that materialises a default-OFF row for missing schedules).
        return res.json({ attempts: [] });
      }

      // Left-join users so the audit trail can show the actor's
      // display name on MANUAL rows. CRON rows resolve to a null
      // user and the UI renders "Scheduled run" for them.
      const rows = await db
        .select({
          id: projectLogEmailScheduleAttempts.id,
          status: projectLogEmailScheduleAttempts.status,
          error: projectLogEmailScheduleAttempts.error,
          recipientCount: projectLogEmailScheduleAttempts.recipientCount,
          triggerType: projectLogEmailScheduleAttempts.triggerType,
          triggeredById: projectLogEmailScheduleAttempts.triggeredById,
          createdAt: projectLogEmailScheduleAttempts.createdAt,
          triggeredByFirstName: users.firstName,
          triggeredByLastName: users.lastName,
          triggeredByEmail: users.email,
        })
        .from(projectLogEmailScheduleAttempts)
        .leftJoin(users, eq(users.id, projectLogEmailScheduleAttempts.triggeredById))
        .where(and(
          eq(projectLogEmailScheduleAttempts.scheduleId, schedule.id),
          // Defense-in-depth tenant scope so a schedule id leak from
          // another org couldn't pull cross-tenant history.
          eq(projectLogEmailScheduleAttempts.organizationId, organizationId),
        ))
        .orderBy(desc(projectLogEmailScheduleAttempts.createdAt))
        .limit(limit);

      const attempts = rows.map((r) => {
        const name = [r.triggeredByFirstName, r.triggeredByLastName].filter(Boolean).join(" ").trim();
        const triggeredByLabel = r.triggerType === "CRON"
          ? "Scheduled run"
          : (name || r.triggeredByEmail || "Unknown user");
        return {
          id: r.id,
          status: r.status,
          error: r.error,
          recipientCount: r.recipientCount,
          triggerType: r.triggerType,
          triggeredById: r.triggeredById,
          triggeredByLabel,
          createdAt: r.createdAt,
        };
      });

      res.json({ attempts });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// Task #1666 — org-wide scheduled email failures dashboard
// ============================================================
//
// Per-project send history (Task #1652) lives inside the project
// settings card, so admins triaging failures across many projects
// have to open each one to audit attempts. This endpoint surfaces
// every failing schedule across the caller's org in a single call so
// the new "scheduled email failures" dashboard can list them and
// expose a per-row "View history" popover that hits the existing
// `GET .../attempts` endpoint.
//
// "Failing" means the most recent attempt status is FAILURE or
// NO_RECIPIENTS — i.e. the same conditions that drive the per-project
// "Last send failed" badge (Task #1622). SUCCESS rows and never-sent
// rows are intentionally excluded; the dashboard is for triage, not
// inventory.
//
// Capped at 200 rows so a misconfigured org with hundreds of stale
// schedules can't blow the response. The UI defaults to 50.
const ORG_FAILURES_DEFAULT_LIMIT = 50;
const ORG_FAILURES_MAX_LIMIT = 200;

// Task #1785 — sort modes for the org-wide failing-schedules dashboard.
// Default is "rolling" so chronically flaky pipelines surface above
// schedules that just happen to be currently broken. "streak" surfaces
// the longest consecutive-failure streaks first (the historical
// pre-#1785 behavior weighted current pain), and "recent" surfaces the
// most recently failed schedules first (the original pre-rolling
// behavior). Tie-breakers always cascade through the other two
// dimensions so equal-priority rows still have a deterministic order.
const ORG_FAILURES_SORT_MODES = ["rolling", "streak", "recent"] as const;
type OrgFailuresSortMode = (typeof ORG_FAILURES_SORT_MODES)[number];
const ORG_FAILURES_DEFAULT_SORT: OrgFailuresSortMode = "rolling";

router.get(
  "/log-email-schedule-failures",
  requireAuth,
  // Same role gate as the per-project schedule endpoints — anyone who
  // can edit the cadence on a project can see the org-wide failures
  // dashboard.
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, ORG_FAILURES_MAX_LIMIT)
        : ORG_FAILURES_DEFAULT_LIMIT;

      // Task #1785 — admin-selectable sort. Unknown values silently
      // fall back to the default so a typo'd query string surfaces
      // the most useful ordering rather than a 400.
      const sortRaw = String(req.query.sort ?? "").toLowerCase();
      const sort: OrgFailuresSortMode = (ORG_FAILURES_SORT_MODES as readonly string[])
        .includes(sortRaw)
        ? (sortRaw as OrgFailuresSortMode)
        : ORG_FAILURES_DEFAULT_SORT;

      // Inner-join projects so we can render "Project name (code)" on
      // each row without a second round-trip. Tenant-scoping on both
      // sides of the join is defense-in-depth: an attacker who somehow
      // controlled `organization_id` on a schedule row still couldn't
      // surface a project from a different tenant.
      //
      // Task #1785 — we always pull up to MAX_LIMIT here ordered by
      // recency (a stable, cheap predicate the SQL planner already has
      // an index for). The rolling-count aggregate below is then
      // computed for those rows and the final sort + per-request
      // `limit` slice is applied in memory, so a sort change doesn't
      // require a second SQL round-trip per request.
      const rows = await db
        .select({
          scheduleId: projectLogEmailSchedules.id,
          projectId: projectLogEmailSchedules.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          logType: projectLogEmailSchedules.logType,
          cadence: projectLogEmailSchedules.cadence,
          lastAttemptAt: projectLogEmailSchedules.lastAttemptAt,
          lastAttemptStatus: projectLogEmailSchedules.lastAttemptStatus,
          lastAttemptError: projectLogEmailSchedules.lastAttemptError,
          lastAttemptRecipientCount: projectLogEmailSchedules.lastAttemptRecipientCount,
          consecutiveFailureCount: projectLogEmailSchedules.consecutiveFailureCount,
        })
        .from(projectLogEmailSchedules)
        .innerJoin(projects, and(
          eq(projects.id, projectLogEmailSchedules.projectId),
          eq(projects.gcOrganizationId, organizationId),
        ))
        .where(and(
          eq(projectLogEmailSchedules.organizationId, organizationId),
          inArray(projectLogEmailSchedules.lastAttemptStatus, ["FAILURE", "NO_RECIPIENTS"]),
        ))
        .orderBy(desc(projectLogEmailSchedules.lastAttemptAt))
        .limit(ORG_FAILURES_MAX_LIMIT);

      // Task #1785 — rolling 30-day failure count per schedule. Mirrors
      // the per-project aggregate in the GET above so admins can
      // triage chronic offenders org-wide without having to open
      // each project's settings card. We GROUP BY scheduleId in a
      // single round-trip across every failing row in the page, so
      // the cost is one extra query per dashboard load no matter how
      // many failing schedules the org has.
      const persistedScheduleIds = rows
        .map((r) => r.scheduleId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const rollingFailureBySchedule = new Map<string, number>();
      if (persistedScheduleIds.length > 0) {
        const windowStart = new Date(
          Date.now() - ROLLING_FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );
        const failureRows = await db
          .select({
            scheduleId: projectLogEmailScheduleAttempts.scheduleId,
            count: sql<number>`count(*)::int`,
          })
          .from(projectLogEmailScheduleAttempts)
          .where(and(
            // Defense-in-depth tenant scope: even though scheduleId
            // came from an org-scoped query above, pinning the
            // attempts query to the same org keeps this safe if a
            // future caller widens the row selection.
            eq(projectLogEmailScheduleAttempts.organizationId, organizationId),
            inArray(projectLogEmailScheduleAttempts.scheduleId, persistedScheduleIds),
            inArray(projectLogEmailScheduleAttempts.status, ["FAILURE", "NO_RECIPIENTS"]),
            gte(projectLogEmailScheduleAttempts.createdAt, windowStart),
          ))
          .groupBy(projectLogEmailScheduleAttempts.scheduleId);
        for (const f of failureRows) {
          // count() is bigint over the wire; ::int keeps it a JS
          // number, but coerce defensively in case the driver ever
          // surfaces a string.
          const n = typeof f.count === "number" ? f.count : Number(f.count);
          if (Number.isFinite(n) && n > 0) {
            rollingFailureBySchedule.set(f.scheduleId, n);
          }
        }
      }

      // Decorate each row with the rolling count + window so the
      // client can render the new column without re-deriving the
      // window length client-side.
      const decorated = rows.map((r) => ({
        ...r,
        rollingFailureCount30d: rollingFailureBySchedule.get(r.scheduleId) ?? 0,
        rollingFailureWindowDays: ROLLING_FAILURE_WINDOW_DAYS,
      }));

      // Task #1785 — apply the chosen sort. The tie-breakers always
      // cascade through the other two dimensions so equal-priority
      // rows have a deterministic order across reloads.
      const lastAttemptMs = (v: Date | string | null | undefined): number => {
        if (!v) return 0;
        const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
        return Number.isFinite(ms) ? ms : 0;
      };
      decorated.sort((a, b) => {
        const aRolling = a.rollingFailureCount30d ?? 0;
        const bRolling = b.rollingFailureCount30d ?? 0;
        const aStreak = a.consecutiveFailureCount ?? 0;
        const bStreak = b.consecutiveFailureCount ?? 0;
        const aRecent = lastAttemptMs(a.lastAttemptAt as Date | string | null);
        const bRecent = lastAttemptMs(b.lastAttemptAt as Date | string | null);
        if (sort === "rolling") {
          if (bRolling !== aRolling) return bRolling - aRolling;
          if (bStreak !== aStreak) return bStreak - aStreak;
          return bRecent - aRecent;
        }
        if (sort === "streak") {
          if (bStreak !== aStreak) return bStreak - aStreak;
          if (bRolling !== aRolling) return bRolling - aRolling;
          return bRecent - aRecent;
        }
        // "recent"
        if (bRecent !== aRecent) return bRecent - aRecent;
        if (bRolling !== aRolling) return bRolling - aRolling;
        return bStreak - aStreak;
      });

      const failures = decorated.slice(0, limit);

      res.json({
        failures,
        sort,
        rollingFailureWindowDays: ROLLING_FAILURE_WINDOW_DAYS,
      });
    } catch (err) {
      next(err);
    }
  },
);

// =========================
// Project Log Email — per-org failure threshold (Task #1668)
// =========================
//
// The repeated-failure backstop notification (Task #1651) fires once a
// schedule's `consecutive_failure_count` crosses a configurable
// threshold, broadcasting an in-app notification to every
// ADMIN/MANAGER/SUPER_ADMIN in the org. The threshold default is 3 and
// could only be overridden via the env var
// PROJECT_LOG_EMAIL_FAILURE_THRESHOLD — fine for the platform default
// but useless for a tenant that wants to be alerted on the very first
// failure (or wait longer than the platform default).
//
// These two endpoints expose a per-org override on
// `organizations.project_log_email_failure_threshold`. NULL means
// "use the global default" (env var when set, otherwise the
// hard-coded fallback of 3); a positive integer in [MIN..MAX]
// overrides it for that org's schedules only. The Company
// Notifications tab reads / writes this value.

// Same role gate as the per-project schedule editor — the per-org
// threshold is also a notification-policy knob, so anyone who can
// edit the cadences can edit the threshold too. Lower-privilege
// users can read the value (so the project-settings card can render
// "current threshold: N") but can't change it.
const FAILURE_THRESHOLD_READ_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"] as const;
const FAILURE_THRESHOLD_WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

const failureThresholdUpsertSchema = z.object({
  // Nullable AND optional. Passing `null` is the canonical "clear
  // my override, use the global default" gesture so admins can
  // revert without having to remember what the platform default
  // was. Omitting the key entirely (undefined) means "leave the
  // threshold alone" — required so digest-only API clients (Task
  // #1732) don't have to round-trip the existing threshold value
  // just to tweak the cadence/hour/timezone.
  threshold: z.number()
    .int()
    .min(PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD)
    .max(PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD)
    .nullable()
    .optional(),
  // Task #1732 — per-org schedule for the failures-digest fan-out.
  // The four fields ride on the same PUT as the threshold so the
  // settings card can save everything in one round-trip. Optional
  // so a client that only edits the threshold (or vice-versa) does
  // not have to re-send the other half — when omitted the
  // corresponding column is left untouched.
  failuresDigestCadence: z.enum(PROJECT_LOG_EMAIL_FAILURES_DIGEST_CADENCES).optional(),
  failuresDigestWeekday: z.number().int().min(0).max(6).optional(),
  failuresDigestHour: z.number().int().min(0).max(23).optional(),
  failuresDigestTimezone: z
    .string()
    .min(1)
    .max(100)
    .refine((tz) => isValidTimezone(tz), { message: "Invalid IANA timezone" })
    .optional(),
});

router.get(
  "/organizations/project-log-email-settings",
  requireAuth,
  requireRole(...FAILURE_THRESHOLD_READ_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const [row] = await db
        .select({
          id: organizations.id,
          failureThreshold: organizations.projectLogEmailFailureThreshold,
          // Task #1732 — per-org schedule for the failures-digest fan-out.
          failuresDigestCadence: organizations.projectLogEmailFailuresDigestCadence,
          failuresDigestWeekday: organizations.projectLogEmailFailuresDigestWeekday,
          failuresDigestHour: organizations.projectLogEmailFailuresDigestHour,
          failuresDigestTimezone: organizations.projectLogEmailFailuresDigestTimezone,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Organization not found" });

      // Surface the env / global default alongside the org override so
      // the UI can render "Effective threshold: N" (= override ?? env
      // default ?? hard-coded default) without the client having to
      // re-implement the resolution logic. Mirrors the
      // `getProjectLogEmailFailureThreshold` precedence in jobRunner.
      const envRaw = process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD?.trim();
      let envThreshold: number | null = null;
      if (envRaw) {
        const parsed = Number(envRaw);
        if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) {
          envThreshold = parsed;
        }
      }
      const globalDefault = envThreshold ?? PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD;
      // Mirror the runtime validation in
      // `getProjectLogEmailFailureThreshold` (jobRunner.ts): a stale or
      // manually-corrupted DB value (non-positive, non-integer) silently
      // falls through to the global default at send-time, so the UI's
      // "effective threshold" must agree to avoid misleading admins.
      const orgValue = row.failureThreshold;
      const orgValueIsValid =
        typeof orgValue === "number"
        && Number.isFinite(orgValue)
        && Number.isInteger(orgValue)
        && orgValue >= 1;
      const effectiveThreshold = orgValueIsValid ? orgValue : globalDefault;

      // Task #1688 — surface schedules currently in a streaking-failure
      // state so admins can tune the threshold with real data instead of
      // guessing. We include any schedule whose
      // `consecutive_failure_count` is at or one shy of the effective
      // threshold (clamped to >=1), so the card shows BOTH "already
      // crossed and was alerted" and "approaching the threshold" rows
      // — exactly the context an admin needs to decide whether to
      // tighten or loosen the cap. Capped at 25 rows to keep the
      // payload bounded for orgs with many broken distribution lists.
      const streakCutoff = Math.max(1, effectiveThreshold - 1);
      const STREAKING_LIMIT = 25;
      const streakingRows = await db
        .select({
          scheduleId: projectLogEmailSchedules.id,
          projectId: projectLogEmailSchedules.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          logType: projectLogEmailSchedules.logType,
          consecutiveFailureCount: projectLogEmailSchedules.consecutiveFailureCount,
          lastFailureNotifiedAt: projectLogEmailSchedules.lastFailureNotifiedAt,
          lastFailureNotifiedStatus: projectLogEmailSchedules.lastFailureNotifiedStatus,
          lastAttemptAt: projectLogEmailSchedules.lastAttemptAt,
          lastAttemptStatus: projectLogEmailSchedules.lastAttemptStatus,
        })
        .from(projectLogEmailSchedules)
        // Inner-join projects with a tenant-scoped predicate as
        // defense-in-depth, mirroring the org-failures dashboard
        // (`/log-email-schedule-failures`) above.
        .innerJoin(projects, and(
          eq(projects.id, projectLogEmailSchedules.projectId),
          eq(projects.gcOrganizationId, organizationId),
        ))
        .where(and(
          eq(projectLogEmailSchedules.organizationId, organizationId),
          gte(projectLogEmailSchedules.consecutiveFailureCount, streakCutoff),
        ))
        // Highest streaks first so the most-painful cases bubble to
        // the top; tie-break on the most recent attempt so admins
        // see freshly-broken schedules above stale ones.
        .orderBy(
          desc(projectLogEmailSchedules.consecutiveFailureCount),
          desc(projectLogEmailSchedules.lastAttemptAt),
        )
        .limit(STREAKING_LIMIT);

      res.json({
        organizationId: row.id,
        failureThreshold: row.failureThreshold,
        effectiveThreshold,
        defaults: {
          // What "clear my override" would result in, in priority order.
          envThreshold,
          hardcodedDefault: PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
          globalDefault,
        },
        bounds: {
          min: PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD,
          max: PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD,
        },
        streakingSchedules: streakingRows,
        streakingCutoff: streakCutoff,
        // Task #1732 — per-org schedule for the failures-digest fan-out.
        // The shipped default (DAILY @ 08:00 UTC) preserves the original
        // hard-coded behavior and is also what the form falls back to
        // when an admin opens the card without ever having saved.
        failuresDigest: {
          cadence: row.failuresDigestCadence ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_CADENCE,
          weekday: row.failuresDigestWeekday ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_WEEKDAY,
          hour: row.failuresDigestHour ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_HOUR,
          timezone: row.failuresDigestTimezone ?? PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_TIMEZONE,
          allowedCadences: PROJECT_LOG_EMAIL_FAILURES_DIGEST_CADENCES,
          defaults: {
            cadence: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_CADENCE,
            weekday: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_WEEKDAY,
            hour: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_HOUR,
            timezone: PROJECT_LOG_EMAIL_FAILURES_DIGEST_DEFAULT_TIMEZONE,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/organizations/project-log-email-settings",
  requireAuth,
  requireRole(...FAILURE_THRESHOLD_WRITE_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      const parsed = failureThresholdUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.flatten(),
        });
      }

      // Task #1732 — only assign columns the client actually sent,
      // so a partial PUT (e.g. just the threshold, or just the
      // digest schedule) leaves the unrelated fields untouched.
      // `threshold` is intentionally optional (undefined skips the
      // column entirely); passing `null` clears the override.
      const updateSet: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (parsed.data.threshold !== undefined) {
        updateSet.projectLogEmailFailureThreshold = parsed.data.threshold;
      }
      if (parsed.data.failuresDigestCadence !== undefined) {
        updateSet.projectLogEmailFailuresDigestCadence = parsed.data.failuresDigestCadence;
      }
      if (parsed.data.failuresDigestWeekday !== undefined) {
        updateSet.projectLogEmailFailuresDigestWeekday = parsed.data.failuresDigestWeekday;
      }
      if (parsed.data.failuresDigestHour !== undefined) {
        updateSet.projectLogEmailFailuresDigestHour = parsed.data.failuresDigestHour;
      }
      if (parsed.data.failuresDigestTimezone !== undefined) {
        updateSet.projectLogEmailFailuresDigestTimezone = parsed.data.failuresDigestTimezone;
      }

      const [updated] = await db
        .update(organizations)
        .set(updateSet)
        .where(eq(organizations.id, organizationId))
        .returning({
          id: organizations.id,
          failureThreshold: organizations.projectLogEmailFailureThreshold,
          failuresDigestCadence: organizations.projectLogEmailFailuresDigestCadence,
          failuresDigestWeekday: organizations.projectLogEmailFailuresDigestWeekday,
          failuresDigestHour: organizations.projectLogEmailFailuresDigestHour,
          failuresDigestTimezone: organizations.projectLogEmailFailuresDigestTimezone,
        });

      if (!updated) return res.status(404).json({ error: "Organization not found" });

      logInfo("Project log email org settings updated", {
        organizationId,
        actorId: req.user?.id ?? null,
        threshold: parsed.data.threshold ?? null,
        failuresDigestCadence: parsed.data.failuresDigestCadence ?? null,
        failuresDigestWeekday: parsed.data.failuresDigestWeekday ?? null,
        failuresDigestHour: parsed.data.failuresDigestHour ?? null,
        failuresDigestTimezone: parsed.data.failuresDigestTimezone ?? null,
      });

      res.json({
        organizationId: updated.id,
        failureThreshold: updated.failureThreshold,
        failuresDigest: {
          cadence: updated.failuresDigestCadence,
          weekday: updated.failuresDigestWeekday,
          hour: updated.failuresDigestHour,
          timezone: updated.failuresDigestTimezone,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// Task #1750 — admin "Send test digest now" endpoint.
//
// After tweaking the cadence / hour / weekday / timezone on the
// failures-digest schedule card, an admin previously had to wait until
// the configured tick to confirm the digest actually lands in the
// right inboxes. This endpoint short-circuits that loop by running the
// existing `processProjectLogEmailFailuresDigest` worker against just
// the caller's org with two opt-in escape hatches:
//
//   - `bypassScheduleGate: true` so the cadence / hour / weekday gate
//     does not skip the send. This *also* bypasses `cadence === "OFF"`:
//     an admin verifying the digest plumbing on a paused org should
//     still be able to fire a one-off without first re-enabling the
//     schedule.
//   - A unique `dedupeKeyOverride` so the test record never collides
//     with (and thereby suppresses) the same day's real digest, and
//     so multiple test clicks within the same minute each produce a
//     fresh notification row the admin can inspect.
//
// Role gate is ADMIN / SUPER_ADMIN only — same audience the digest
// itself fans out to. MANAGER / SUPERINTENDENT can already view the
// failures dashboard but the digest is org-admin-only, so letting
// them trigger it would route a notification to people they aren't
// even on the recipient list for.
//
// Per-org 30s rate limit (in-memory, mirrors the per-schedule send-now
// debounce above) prevents a frantic click loop from spamming every
// admin's inbox with duplicate digest rows.
router.post(
  "/organizations/project-log-email-settings/test-digest",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

      // Per-org rate limit. Two admins clicking within 30s of each
      // other on the same org both bounce off the same window so the
      // org's admins don't get hit with two test digests in quick
      // succession.
      //
      // Task #1831 — backed by `rate_limit_state` so the window holds
      // across all replicas. The previous module-level `Map` only
      // protected one Node process; under a multi-pod deployment two
      // admins clicking against different pods each got through.
      const nowMs = Date.now();
      const debounce = await consumeRateLimit(
        `${TEST_DIGEST_RATE_LIMIT_PREFIX}${organizationId}`,
        TEST_DIGEST_DEBOUNCE_MS,
        nowMs,
      );
      if (!debounce.allowed) {
        res.set("Retry-After", String(debounce.retryAfterSeconds));
        return res.status(429).json({
          error: "Test digest was sent recently. Please wait before retrying.",
          retryAfterSeconds: debounce.retryAfterSeconds,
        });
      }

      // Per-click unique dedupe key so the test row is distinguishable
      // in the admin's notifications list and never collides with the
      // same day's real digest. Including the actor id keeps two
      // admins clicking in the same millisecond (or a clock that
      // doesn't advance between calls) on separate rows.
      const dedupeKey = `test-${new Date(nowMs).toISOString()}-${req.user?.id ?? "anon"}`;

      const summary = await processProjectLogEmailFailuresDigest({
        organizationIds: [organizationId],
        bypassScheduleGate: true,
        dedupeKeyOverride: dedupeKey,
      });

      // The function always populates a per-org entry for filtered
      // orgs (success or skipped), so a missing entry is unexpected
      // and points at a regression.
      const orgSummary = summary.perOrg.get(organizationId);
      if (!orgSummary) {
        logError("Test digest produced no per-org summary entry", {
          organizationId,
          actorId: req.user?.id ?? null,
        });
        return res.status(500).json({ error: "Test digest failed unexpectedly" });
      }

      if (orgSummary.skipped) {
        // Each skip reason maps to a distinct admin-facing message so
        // the toast can tell the admin exactly why nothing landed.
        // Note: CADENCE_OFF cannot occur here because we pass
        // `bypassScheduleGate: true`, which short-circuits the OFF
        // check in the worker.
        if (orgSummary.reason === "NO_FAILURES") {
          // Not an error — the digest is healthy because there's
          // nothing to roll up. Surface this as a 200 with a clear
          // message so the toast can be celebratory rather than red.
          return res.json({
            recipientCount: 0,
            failingScheduleCount: 0,
            skipped: true,
            reason: "NO_FAILURES",
            message: "No scheduled log emails are currently failing, so the digest had nothing to send. Your distribution lists look healthy.",
          });
        }
        if (orgSummary.reason === "NO_ADMINS") {
          return res.status(409).json({
            error: "No active admins are configured to receive the digest. Promote at least one ADMIN or SUPER_ADMIN before testing.",
            reason: "NO_ADMINS",
            recipientCount: 0,
            failingScheduleCount: orgSummary.failingScheduleCount,
          });
        }
        // ITERATION_FAILED bubbles up as a 500 because it means the
        // worker logged an internal error mid-loop; we already logged
        // there but echo it here so the client sees a proper failure.
        if (orgSummary.reason === "ITERATION_FAILED") {
          return res.status(500).json({
            error: "Test digest failed while building the message. Check server logs for details.",
            reason: orgSummary.reason,
          });
        }
        // HOUR_GATE / WEEKDAY_GATE shouldn't happen because we set
        // `bypassScheduleGate: true`; surface them as 500s so a
        // future regression in the worker becomes visible.
        return res.status(500).json({
          error: "Test digest was unexpectedly skipped",
          reason: orgSummary.reason,
        });
      }

      logInfo("Project log email failures digest test send", {
        organizationId,
        actorId: req.user?.id ?? null,
        recipientCount: orgSummary.notificationCount,
        failingScheduleCount: orgSummary.failingScheduleCount,
        dedupeKey,
      });

      res.json({
        recipientCount: orgSummary.notificationCount,
        failingScheduleCount: orgSummary.failingScheduleCount,
        skipped: false,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
