/**
 * Task #2220 — Anonymous, tenant-scoped telemetry on the three takeoff
 * pen/touch interactions whose defaults Section 7 of the Takeoff
 * Interaction Map currently tunes by hand.
 *
 * - POST /api/takeoff/stylus-telemetry/batch
 *     Authenticated insert of up to MAX_BATCH events. Stamps each row
 *     with `req.user.organizationId`; clients never get to choose the
 *     tenant. Failures are swallowed (best-effort) to ensure broken
 *     telemetry never blocks the takeoff workspace.
 *
 * - GET  /api/platform/monitoring/stylus-telemetry?period=7d
 *     SUPER_ADMIN-only. Per-organization counts + P50/P95 of
 *     dwellMs and contactSizePx. Backs the Stylus Tuning tab on the
 *     platform Analytics & Monitoring dashboard.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { sql, gte, eq } from "drizzle-orm";
import { db } from "./db";
import {
  takeoffStylusTelemetryEvents,
  organizations,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logError } from "./utils/logger";

const router = Router();

// Cap the batch size so a noisy/buggy client can't shovel megabytes of
// events at the DB on a single request. Matches the client emitter's
// MAX_BUFFER (kept in sync via the shared MAX_BATCH constant below).
const MAX_BATCH = 50;

const EVENT_TYPES = ["PALM_REJECTED", "LONG_PRESS", "ROTATE_GESTURE"] as const;
const POINTER_TYPES = ["pen", "touch", "mouse"] as const;
const DEVICE_CLASSES = [
  "ios",
  "ipados",
  "android",
  "windows",
  "macos",
  "linux",
  "other",
] as const;

const eventSchema = z.object({
  eventType: z.enum(EVENT_TYPES),
  pointerType: z.enum(POINTER_TYPES).optional().nullable(),
  deviceClass: z.enum(DEVICE_CLASSES).optional().nullable(),
  // Generous-but-finite ranges so a glitched event can't poison the
  // distribution. The user prefs UI clamps long-press to 250–1500 and
  // palm band to 0–96 px; we allow a little headroom either side.
  dwellMs: z.number().int().min(0).max(60_000).optional().nullable(),
  contactSizePx: z.number().min(0).max(2000).optional().nullable(),
  rotationDeltaDeg: z.number().min(-3600).max(3600).optional().nullable(),
  bandPx: z.number().int().min(0).max(2000).optional().nullable(),
  // Configured long-press hold threshold (ms) at the moment the
  // event fired. Same generous range as `dwellMs` since the user
  // pref UI clamps to 250–1500.
  configuredThresholdMs: z.number().int().min(0).max(60_000).optional().nullable(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(MAX_BATCH),
});

router.post(
  "/api/takeoff/stylus-telemetry/batch",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      if (!user.organizationId) {
        // Honor the contract: silently 204 so a tenant-less account
        // (e.g. mid-onboarding) doesn't see telemetry errors in the
        // browser console.
        return res.status(204).end();
      }

      const parsed = batchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid telemetry payload",
          details: parsed.error.flatten(),
        });
      }

      const rows = parsed.data.events.map((e) => ({
        organizationId: user.organizationId!,
        eventType: e.eventType,
        pointerType: e.pointerType ?? null,
        deviceClass: e.deviceClass ?? null,
        dwellMs: e.dwellMs ?? null,
        contactSizePx: e.contactSizePx ?? null,
        rotationDeltaDeg: e.rotationDeltaDeg ?? null,
        bandPx: e.bandPx ?? null,
        configuredThresholdMs: e.configuredThresholdMs ?? null,
      }));

      await db.insert(takeoffStylusTelemetryEvents).values(rows);
      // Clients fire-and-forget — return 204 so sendBeacon is happy.
      return res.status(204).end();
    } catch (err) {
      // Swallow at the app layer too; never let telemetry break the
      // takeoff workspace.
      logError(
        "[telemetry] failed to persist takeoff stylus events",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(204).end();
    }
  },
);

// Per-tenant P50 / P95 distribution of dwellMs and contactSizePx, plus
// raw event counts by type. Used by the Stylus Tuning tab.
router.get(
  "/api/platform/monitoring/stylus-telemetry",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next) => {
    try {
      const period = (req.query.period as string) || "30d";
      const daysMap: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
      const days = daysMap[period] ?? 30;
      const since = new Date();
      since.setDate(since.getDate() - days);

      // One pass over the table per period: percentiles are computed
      // server-side (cheap with the `org_created` index) so the
      // dashboard can render hundreds of orgs without paginating.
      const rows = await db
        .select({
          orgId: takeoffStylusTelemetryEvents.organizationId,
          orgName: organizations.name,
          totalEvents: sql<number>`count(*)::int`,
          palmRejected: sql<number>`count(*) filter (where ${takeoffStylusTelemetryEvents.eventType} = 'PALM_REJECTED')::int`,
          longPress: sql<number>`count(*) filter (where ${takeoffStylusTelemetryEvents.eventType} = 'LONG_PRESS')::int`,
          rotateGesture: sql<number>`count(*) filter (where ${takeoffStylusTelemetryEvents.eventType} = 'ROTATE_GESTURE')::int`,
          dwellP50: sql<number | null>`percentile_cont(0.5) within group (order by ${takeoffStylusTelemetryEvents.dwellMs}) filter (where ${takeoffStylusTelemetryEvents.dwellMs} is not null)`,
          dwellP95: sql<number | null>`percentile_cont(0.95) within group (order by ${takeoffStylusTelemetryEvents.dwellMs}) filter (where ${takeoffStylusTelemetryEvents.dwellMs} is not null)`,
          configuredThresholdP50: sql<number | null>`percentile_cont(0.5) within group (order by ${takeoffStylusTelemetryEvents.configuredThresholdMs}) filter (where ${takeoffStylusTelemetryEvents.configuredThresholdMs} is not null)`,
          configuredThresholdP95: sql<number | null>`percentile_cont(0.95) within group (order by ${takeoffStylusTelemetryEvents.configuredThresholdMs}) filter (where ${takeoffStylusTelemetryEvents.configuredThresholdMs} is not null)`,
          contactP50: sql<number | null>`percentile_cont(0.5) within group (order by ${takeoffStylusTelemetryEvents.contactSizePx}) filter (where ${takeoffStylusTelemetryEvents.contactSizePx} is not null)`,
          contactP95: sql<number | null>`percentile_cont(0.95) within group (order by ${takeoffStylusTelemetryEvents.contactSizePx}) filter (where ${takeoffStylusTelemetryEvents.contactSizePx} is not null)`,
          rotationP95Abs: sql<number | null>`percentile_cont(0.95) within group (order by abs(${takeoffStylusTelemetryEvents.rotationDeltaDeg})) filter (where ${takeoffStylusTelemetryEvents.rotationDeltaDeg} is not null)`,
        })
        .from(takeoffStylusTelemetryEvents)
        .innerJoin(
          organizations,
          eq(takeoffStylusTelemetryEvents.organizationId, organizations.id),
        )
        .where(gte(takeoffStylusTelemetryEvents.createdAt, since))
        .groupBy(
          takeoffStylusTelemetryEvents.organizationId,
          organizations.name,
        );

      const organizationsOut = rows
        .map((r) => ({
          organizationId: r.orgId,
          organizationName: r.orgName,
          totalEvents: Number(r.totalEvents) || 0,
          palmRejected: Number(r.palmRejected) || 0,
          longPress: Number(r.longPress) || 0,
          rotateGesture: Number(r.rotateGesture) || 0,
          dwellMsP50: r.dwellP50 == null ? null : Number(r.dwellP50),
          dwellMsP95: r.dwellP95 == null ? null : Number(r.dwellP95),
          configuredThresholdMsP50:
            r.configuredThresholdP50 == null
              ? null
              : Number(r.configuredThresholdP50),
          configuredThresholdMsP95:
            r.configuredThresholdP95 == null
              ? null
              : Number(r.configuredThresholdP95),
          contactSizePxP50:
            r.contactP50 == null ? null : Number(r.contactP50),
          contactSizePxP95:
            r.contactP95 == null ? null : Number(r.contactP95),
          rotationDegP95Abs:
            r.rotationP95Abs == null ? null : Number(r.rotationP95Abs),
        }))
        .sort((a, b) => b.totalEvents - a.totalEvents);

      res.json({
        period,
        since: since.toISOString(),
        // Section 7 of docs/takeoff-interaction-map.md. Surface them here
        // so the dashboard can show "shipped default vs observed P95" at
        // a glance without the operator opening the doc.
        defaults: {
          palmRejectionBandPx: 24,
          stylusLongPressMs: 500,
        },
        organizations: organizationsOut,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
