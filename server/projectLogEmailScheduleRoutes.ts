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
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "./db";
import {
  PROJECT_LOG_EMAIL_CADENCES,
  PROJECT_LOG_EMAIL_LOG_TYPES,
  projectEmailDistributionLists,
  projectLogEmailSchedules,
  projects,
  users,
} from "@shared/schema";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { isValidTimezone } from "@shared/timezones";
import { executeProjectLogEmailScheduleSend } from "./jobs/jobRunner";
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
type FailureNotificationRecipient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
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
      // (their notification record would simply go unread); the UI can
      // decide whether to flag them later.
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
          createdAt: null,
          updatedAt: null,
          // Task #1649 — even on the default OFF row, the PM (if any)
          // would still be notified, so surface that single-name set
          // instead of forcing the empty-state copy when the project
          // has an owner.
          failureNotificationRecipients: recipientsFor(null),
        };
      });

      res.json({ schedules });
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

      const result = await executeProjectLogEmailScheduleSend({
        scheduleId: existing.id,
        organizationId,
        projectId: project.id,
        logType,
        // Task #1651 — pass the pre-attempt streak through so a
        // manual send-now can reset the counter on success or fan
        // out the threshold backstop notification on the crossing
        // failure, exactly the same way the cron does.
        previousConsecutiveFailureCount: existing.consecutiveFailureCount ?? 0,
      });

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

export default router;
