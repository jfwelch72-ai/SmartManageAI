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

export default router;
