/**
 * Task #1540 — Extract the wage refresh editor's POST/DELETE alert rule
 * routes (originally inlined in `server/routes.ts`) into a small typed
 * router so the route's Zod schema can be imported by tests instead of
 * being copy/pasted.
 */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import {
  upsertJobMetricAlertRule,
  deleteJobMetricAlertRule,
} from "./utils/jobMetricAlerts";

export const upsertJobMetricAlertRuleSchema = z.object({
  id: z.string().optional().nullable(),
  job: z.string().min(1).max(120),
  counter: z.string().min(1).max(120).optional().nullable(),
  kind: z.enum(["spike", "stall"]),
  threshold: z.number().positive().max(100000),
  minAbsolute: z.number().int().min(0).max(1_000_000).optional(),
  dedupeMinutes: z.number().int().min(1).max(24 * 60).optional(),
  enabled: z.boolean().optional(),
  emailWhenAbove: z.number().positive().max(100000).nullable().optional(),
});

export type UpsertJobMetricAlertRuleInput = z.infer<
  typeof upsertJobMetricAlertRuleSchema
>;

const router = Router();

router.post(
  "/admin/metrics/jobs/alerts/rules",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = upsertJobMetricAlertRuleSchema.parse(req.body);
      const rule = await upsertJobMetricAlertRule(parsed);
      await logAudit(
        {
          userId: req.user!.id,
          action: parsed.id ? "UPDATE" : "CREATE",
          entityType: "job_metric_alert_rule",
          entityId: rule.id,
          newValue: JSON.stringify(parsed),
        },
        req,
      );
      res.json(rule);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid rule", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

router.delete(
  "/admin/metrics/jobs/alerts/rules/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ok = await deleteJobMetricAlertRule(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      await logAudit(
        {
          userId: req.user!.id,
          action: "DELETE",
          entityType: "job_metric_alert_rule",
          entityId: req.params.id,
        },
        req,
      );
      res.json({ deleted: req.params.id });
    } catch (err: any) {
      next(err);
    }
  },
);

export default router;
