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
 */
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "./db";
import {
  PROJECT_LOG_EMAIL_CADENCES,
  PROJECT_LOG_EMAIL_LOG_TYPES,
  PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
  PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD,
  PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD,
  organizations,
  projectEmailDistributionLists,
  projectLogEmailSchedules,
  projectLogEmailScheduleAttempts,
  projects,
  users,
} from "@shared/schema";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { isValidTimezone } from "@shared/timezones";
import { executeProjectLogEmailScheduleSend, getProjectLogEmailFailureThreshold } from "./jobs/jobRunner";
import { buildProjectLogPdfBuffer } from "./services/projectLogService";
import { sendEmailWithResult } from "./services/emailService";
import { logError, logInfo } from "./utils/logger";

const router = Router();

const logTypeParam = z.enum(PROJECT_LOG_EMAIL_LOG_TYPES);

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

// Task #1638 — in-memory per-schedule debounce so the "Send now" button
// can't be hammered (whether by a frantic admin clicking 30 times, a
// flaky network retrying the POST, or a script). Keyed by the schedule
// row id (or by `<projectId>:<logType>` when the schedule row hasn't
// been persisted yet, which shouldn't actually happen because the UI
// only shows the button when cadence != OFF). 30s is the same window
// the front-end disables the button for after a click — this is the
// server-side defense for anyone who skips the UI.
const SEND_NOW_DEBOUNCE_MS = 30_000;
const sendNowLastInvocation = new Map<string, number>();

function consumeSendNowDebounce(key: string, now: number): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const last = sendNowLastInvocation.get(key);
  if (last !== undefined && now - last < SEND_NOW_DEBOUNCE_MS) {
    const retryAfterMs = SEND_NOW_DEBOUNCE_MS - (now - last);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  sendNowLastInvocation.set(key, now);
  // Best-effort cleanup so the map can't grow unboundedly under heavy
  // multi-tenant load. We sweep entries older than 5x the debounce
  // window, which is plenty since they no longer affect rate limiting.
  if (sendNowLastInvocation.size > 1000) {
    const cutoff = now - SEND_NOW_DEBOUNCE_MS * 5;
    for (const [k, ts] of sendNowLastInvocation) {
      if (ts < cutoff) sendNowLastInvocation.delete(k);
    }
  }
  return { allowed: true };
}

// Test-only escape hatch so unit tests can reset the in-memory rate
// limiter between cases without resorting to module re-imports.
export function __resetSendNowDebounceForTests() {
  sendNowLastInvocation.clear();
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

      const debounce = consumeSendNowDebounce(existing.id, Date.now());
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

      // Inner-join projects so we can render "Project name (code)" on
      // each row without a second round-trip. Tenant-scoping on both
      // sides of the join is defense-in-depth: an attacker who somehow
      // controlled `organization_id` on a schedule row still couldn't
      // surface a project from a different tenant.
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
        .limit(limit);

      res.json({ failures: rows });
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
  // Nullable — passing `null` (or omitting) is the canonical
  // "clear my override, use the global default" gesture so admins
  // can revert without having to remember what the platform default
  // was.
  threshold: z.number()
    .int()
    .min(PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD)
    .max(PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD)
    .nullable(),
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

      const [updated] = await db
        .update(organizations)
        .set({
          projectLogEmailFailureThreshold: parsed.data.threshold,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId))
        .returning({
          id: organizations.id,
          failureThreshold: organizations.projectLogEmailFailureThreshold,
        });

      if (!updated) return res.status(404).json({ error: "Organization not found" });

      logInfo("Project log email failure threshold updated", {
        organizationId,
        actorId: req.user?.id ?? null,
        threshold: parsed.data.threshold,
      });

      res.json({
        organizationId: updated.id,
        failureThreshold: updated.failureThreshold,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
