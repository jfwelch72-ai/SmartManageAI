/**
 * Task #1557 — Extract the alert *event* endpoints (acknowledge / snooze /
 * unsnooze / digests / events.csv / digests/test / run) out of the giant
 * `registerRoutes` function in `server/routes.ts` so they live alongside
 * the rule routes already moved in Task #1540. Behavior is unchanged:
 * same auth, same audit log entries, same response shapes.
 */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { parseOrRespond } from "./utils/validation";
import * as jobMetricAlerts from "./utils/jobMetricAlerts";

const router = Router();

// Task #729 — acknowledge / snooze noisy alert events
router.post(
  "/admin/metrics/jobs/alerts/events/:id/acknowledge",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const updated = await jobMetricAlerts.acknowledgeJobMetricAlertEvent(
        req.params.id,
        req.user!.id,
      );
      if (!updated) {
        res.status(404).json({ error: "Alert event not found" });
        return;
      }
      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "job_metric_alert_event",
          entityId: updated.id,
          newValue: `Acknowledged alert ${updated.job}/${updated.counter ?? "_"}/${updated.kind}`,
        },
        req,
      );
      res.json(updated);
    } catch (err: any) {
      next(err);
    }
  },
);

const snoozeSchema = z.object({ hours: z.number().positive().max(7 * 24) });

router.post(
  "/admin/metrics/jobs/alerts/events/:id/snooze",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const snoozeParsed = parseOrRespond(snoozeSchema, req.body, res);
      if (!snoozeParsed) return;
      const { hours } = snoozeParsed;
      const updated = await jobMetricAlerts.snoozeJobMetricAlertEvent(
        req.params.id,
        req.user!.id,
        hours,
      );
      if (!updated) {
        res.status(404).json({ error: "Alert event not found" });
        return;
      }
      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "job_metric_alert_event",
          entityId: updated.id,
          newValue: `Snoozed ${updated.job}/${updated.counter ?? "_"}/${updated.kind} for ${hours}h until ${updated.snoozedUntil ? new Date(updated.snoozedUntil).toISOString() : "n/a"}`,
        },
        req,
      );
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid snooze request", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// Task #2023 — Surface the active snoozes (keyed by `(job, counter, kind)`)
// so the in-app notification feed can render a persistent
// "Snoozed until X by Y" banner on the matching `job_metric_alert`
// bell row instead of just flashing a toast at snooze time. The
// response also carries the underlying `eventId` so the bell row's
// "Unsnooze" button can hit the existing `:id/unsnooze` endpoint.
router.get(
  "/admin/metrics/jobs/alerts/active-snoozes",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const snoozes = await jobMetricAlerts.listActiveJobMetricAlertSnoozes();
      res.json({ snoozes });
    } catch (err: any) {
      next(err);
    }
  },
);

// Task #2010 — Snooze the most recent matching `(job, counter, kind)`
// alert event without requiring the caller to know its row id. Powers
// the in-app notification action buttons that page Super Admins from
// `pool_health` starvation events: the bell row only carries the
// dedupe key (e.g. `pool_health:waitingSaturated:spike` in
// `relatedEntityId`), so this endpoint lets the operator act on the
// alert without first navigating to the dashboard. Behavior, dedupe
// key, and audit log entry mirror the `:id/snooze` route exactly.
const snoozeByKeySchema = z.object({
  job: z.string().min(1).max(128),
  counter: z.string().min(1).max(128).nullable().optional(),
  kind: z.enum(["spike", "stall"]),
  hours: z.number().positive().max(7 * 24),
});

router.post(
  "/admin/metrics/jobs/alerts/snooze-by-key",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const snoozeKeyParsed = parseOrRespond(snoozeByKeySchema, req.body, res);
      if (!snoozeKeyParsed) return;
      const { job, counter, kind, hours } = snoozeKeyParsed;
      const updated = await jobMetricAlerts.snoozeJobMetricAlertByKey(
        req.user!.id,
        job,
        counter ?? null,
        kind,
        hours,
      );
      if (!updated) {
        res
          .status(404)
          .json({ error: "No matching alert event in the last 24h" });
        return;
      }
      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "job_metric_alert_event",
          entityId: updated.id,
          newValue: `Snoozed ${updated.job}/${updated.counter ?? "_"}/${updated.kind} for ${hours}h until ${updated.snoozedUntil ? new Date(updated.snoozedUntil).toISOString() : "n/a"} (via notification action)`,
        },
        req,
      );
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid snooze request", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// Task #734 — clear an active snooze early
router.post(
  "/admin/metrics/jobs/alerts/events/:id/unsnooze",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const updated = await jobMetricAlerts.unsnoozeJobMetricAlertEvent(
        req.params.id,
      );
      if (!updated) {
        res.status(404).json({ error: "Alert event not found" });
        return;
      }
      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "job_metric_alert_event",
          entityId: updated.id,
          newValue: `Cleared snooze on ${updated.job}/${updated.counter ?? "_"}/${updated.kind}`,
        },
        req,
      );
      res.json(updated);
    } catch (err: any) {
      next(err);
    }
  },
);

// Task #760 — Quiet-hours digest visibility
router.get(
  "/admin/metrics/jobs/alerts/digests",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sends = await jobMetricAlerts.listRecentQuietHoursDigestSends(50);
      res.json({ sends });
    } catch (err: any) {
      next(err);
    }
  },
);

router.get(
  "/admin/metrics/jobs/alerts/digests/:id/events",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await jobMetricAlerts.listEventsForQuietHoursDigestSend(
        req.params.id,
      );
      if (!result) {
        res.status(404).json({ error: "Digest send not found" });
        return;
      }
      res.json(result);
    } catch (err: any) {
      next(err);
    }
  },
);

// Task #770 — Download a CSV of alert events for an arbitrary range so
// recipients can re-pull a past quiet-hours digest export without
// hunting through their inbox. Columns mirror `buildDigestCsv` exactly.
router.get(
  "/admin/metrics/jobs/alerts/events.csv",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await jobMetricAlerts.buildAlertEventsCsvResponse({
        query: {
          from: typeof req.query.from === "string" ? req.query.from : undefined,
          to: typeof req.query.to === "string" ? req.query.to : undefined,
          range:
            typeof req.query.range === "string" ? req.query.range : undefined,
          job: typeof req.query.job === "string" ? req.query.job : undefined,
          counter:
            typeof req.query.counter === "string"
              ? req.query.counter
              : undefined,
        },
      });
      if (!result.ok) {
        const body: Record<string, unknown> = { error: result.error };
        if (result.details !== undefined) body.details = result.details;
        res.status(result.status).json(body);
        return;
      }
      res.setHeader("Content-Type", result.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      );
      res.send(result.csv);
    } catch (err: any) {
      next(err);
    }
  },
);

router.post(
  "/admin/metrics/jobs/alerts/digests/test",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const summary = await jobMetricAlerts.sendTestQuietHoursDigestToUser(
        req.user!.id,
      );
      await logAudit(
        {
          userId: req.user!.id,
          action: "EXECUTE",
          entityType: "job_metric_alert_quiet_hours_digest",
          entityId: req.user!.id,
          newValue: `Test digest: sent=${summary.digestsSent}, noEvents=${summary.digestsSkippedNoEvents}, disabled=${summary.digestsSkippedDisabled}`,
        },
        req,
      );
      res.json(summary);
    } catch (err: any) {
      next(err);
    }
  },
);

router.post(
  "/admin/metrics/jobs/alerts/run",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await jobMetricAlerts.evaluateJobMetricAlerts();
      await logAudit(
        {
          userId: req.user!.id,
          action: "EXECUTE",
          entityType: "background_job",
          entityId: "job_metric_alerts",
          newValue: `Manual evaluation: ${result.alertsFired.length} fired, ${result.alertsSuppressed} suppressed`,
        },
        req,
      );
      res.json(result);
    } catch (err: any) {
      next(err);
    }
  },
);

export default router;
