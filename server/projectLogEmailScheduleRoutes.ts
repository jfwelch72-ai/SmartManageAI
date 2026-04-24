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
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
  PROJECT_LOG_EMAIL_CADENCES,
  PROJECT_LOG_EMAIL_LOG_TYPES,
  projectLogEmailSchedules,
  projects,
} from "@shared/schema";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { isValidTimezone } from "@shared/timezones";
import { executeProjectLogEmailScheduleSend } from "./jobs/jobRunner";

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
      gcOrganizationId: projects.gcOrganizationId,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, organizationId)))
    .limit(1);
  return project ?? null;
}

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

      const byType = new Map(rows.map((r) => [r.logType, r]));
      // Always return both log types; missing rows surface as the
      // default-OFF schedule the worker would also infer. Task #1622
      // added per-attempt status fields so the UI can render a "Last
      // send failed" badge — surface them as nulls on the default rows
      // so the client doesn't have to defensively probe for missing
      // properties.
      const schedules = PROJECT_LOG_EMAIL_LOG_TYPES.map((logType) => {
        const existing = byType.get(logType);
        if (existing) return existing;
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
          createdAt: null,
          updatedAt: null,
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

      if (existing) {
        const [updated] = await db
          .update(projectLogEmailSchedules)
          .set({ cadence, weekday, hour, timezone, updatedAt: new Date() })
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

export default router;
