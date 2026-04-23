/**
 * @openapi
 * /api/notifications/preferences:
 *   get:
 *     tags: [Notifications]
 *     summary: Get notification preferences
 *     description: Returns the user's notification channel and type preferences.
 *     responses:
 *       200: { description: Notification preferences }
 *   put:
 *     tags: [Notifications]
 *     summary: Update notification preferences
 *     description: Updates channel preferences (email, push, SMS, Slack, Teams).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emailEnabled: { type: boolean }
 *               pushEnabled: { type: boolean }
 *               smsEnabled: { type: boolean }
 *               slackEnabled: { type: boolean }
 *               teamsEnabled: { type: boolean }
 *               phoneNumber: { type: string }
 *     responses:
 *       200: { description: Preferences updated }
 * /api/notifications/preferences/webhooks:
 *   put:
 *     tags: [Notifications]
 *     summary: Update webhook notification preferences
 *     description: Configure Slack or Teams webhook URLs for notifications.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               slackWebhookUrl: { type: string }
 *               teamsWebhookUrl: { type: string }
 *     responses:
 *       200: { description: Webhook preferences updated }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { notificationChannelPrefs, notificationTypePrefs, notificationTypeEnum, jobMetricAlertEvents } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { isValidE164, isTwilioConfigured } from "./services/smsService";
import { isValidTeamsWebhookUrl } from "./services/teamsService";
import { isValidSlackWebhookUrl } from "./services/slackService";
import { hasFeature } from "./services/featureAccess";
import { buildDigestCsv } from "./utils/jobMetricAlerts";
import { verifySwpppMuteToken } from "./utils/swpppMuteToken";
import { logInfo } from "./utils/logger";

const router = Router();

const BIRTHDAY_REMINDER_CADENCES = ["OFF", "DAILY_TODAY", "DAILY_LOOKAHEAD", "WEEKLY"] as const;
type BirthdayReminderCadence = typeof BIRTHDAY_REMINDER_CADENCES[number];

const channelPrefsSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  teamsEnabled: z.boolean(),
  slackEnabled: z.boolean(),
  birthdayReminderCadence: z.enum(BIRTHDAY_REMINDER_CADENCES).optional(),
});

// Task #1260 — `inAppEnabled` is per-type only (the in-app feed has no
// channel-level master switch — the notifications row IS the in-app feed).
// Stored as a tri-state boolean | null so a NULL means "use the default".
const typeOverrideSchema = channelPrefsSchema.partial().extend({
  inAppEnabled: z.boolean().nullable().optional(),
});

const typePrefsSchema = z.record(
  z.enum(notificationTypeEnum.enumValues),
  typeOverrideSchema
);

const preferencesBodySchema = z.object({
  channel: channelPrefsSchema,
  typeOverrides: typePrefsSchema.optional(),
});

const webhooksBodySchema = z.object({
  smsPhoneNumber: z.string().nullable().optional(),
  teamsWebhookUrl: z.string().nullable().optional(),
  slackWebhookUrl: z.string().nullable().optional(),
});

router.get("/api/notifications/preferences", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    const [channelRow] = await db
      .select()
      .from(notificationChannelPrefs)
      .where(eq(notificationChannelPrefs.userId, userId))
      .limit(1);

    const typeRows = await db
      .select()
      .from(notificationTypePrefs)
      .where(eq(notificationTypePrefs.userId, userId));

    const orgId = req.user!.organizationId;
    const enterpriseNotificationsEnabled = orgId ? await hasFeature(orgId, "ENTERPRISE_NOTIFICATIONS") : false;
    const twilioConfigured = isTwilioConfigured();

    res.json({
      channel: channelRow
        ? {
            emailEnabled: channelRow.emailEnabled,
            smsEnabled: channelRow.smsEnabled,
            pushEnabled: channelRow.pushEnabled,
            teamsEnabled: channelRow.teamsEnabled,
            slackEnabled: channelRow.slackEnabled,
            smsPhoneNumber: channelRow.smsPhoneNumber ?? null,
            teamsWebhookUrl: channelRow.teamsWebhookUrl ?? null,
            slackWebhookUrl: channelRow.slackWebhookUrl ?? null,
            birthdayReminderCadence: channelRow.birthdayReminderCadence ?? "DAILY_LOOKAHEAD",
          }
        : {
            emailEnabled: false,
            smsEnabled: false,
            pushEnabled: false,
            teamsEnabled: false,
            slackEnabled: false,
            smsPhoneNumber: null,
            teamsWebhookUrl: null,
            slackWebhookUrl: null,
            birthdayReminderCadence: "DAILY_LOOKAHEAD" as BirthdayReminderCadence,
          },
      typeOverrides: typeRows.map((r) => ({
        notificationType: r.notificationType,
        emailEnabled: r.emailEnabled,
        smsEnabled: r.smsEnabled,
        pushEnabled: r.pushEnabled,
        teamsEnabled: r.teamsEnabled,
        slackEnabled: r.slackEnabled,
        // Task #1260 — surface the per-type in-app suppression so the
        // settings UI can render an "in-app" switch alongside email.
        inAppEnabled: r.inAppEnabled,
      })),
      enterpriseNotificationsEnabled,
      twilioConfigured,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/api/notifications/preferences", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    const parsed = preferencesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid preferences data", details: parsed.error.flatten() });
    }

    const { channel, typeOverrides } = parsed.data;
    const now = new Date();

    const orgId = req.user!.organizationId;
    const enterpriseNotifs = orgId ? await hasFeature(orgId, "ENTERPRISE_NOTIFICATIONS") : false;
    const twilioReady = isTwilioConfigured();
    const effectiveSmsEnabled = channel.smsEnabled && twilioReady;

    if (channel.smsEnabled && !twilioReady) {
      return res.status(200).json({
        success: true,
        warning: "SMS notifications cannot be enabled because Twilio is not configured. Contact your administrator to set up TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.",
        smsForced: false,
      });
    }

    const cadence = (channel.birthdayReminderCadence ?? "DAILY_LOOKAHEAD") as BirthdayReminderCadence;

    if (enterpriseNotifs) {
      await db
        .insert(notificationChannelPrefs)
        .values({
          userId,
          emailEnabled: channel.emailEnabled,
          smsEnabled: effectiveSmsEnabled,
          pushEnabled: channel.pushEnabled,
          teamsEnabled: channel.teamsEnabled,
          slackEnabled: channel.slackEnabled,
          birthdayReminderCadence: cadence,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: notificationChannelPrefs.userId,
          set: {
            emailEnabled: channel.emailEnabled,
            smsEnabled: effectiveSmsEnabled,
            pushEnabled: channel.pushEnabled,
            teamsEnabled: channel.teamsEnabled,
            slackEnabled: channel.slackEnabled,
            birthdayReminderCadence: cadence,
            updatedAt: now,
          },
        });
    } else {
      await db
        .insert(notificationChannelPrefs)
        .values({
          userId,
          emailEnabled: channel.emailEnabled,
          smsEnabled: false,
          pushEnabled: channel.pushEnabled,
          teamsEnabled: false,
          slackEnabled: false,
          birthdayReminderCadence: cadence,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: notificationChannelPrefs.userId,
          set: {
            emailEnabled: channel.emailEnabled,
            pushEnabled: channel.pushEnabled,
            birthdayReminderCadence: cadence,
            updatedAt: now,
          },
        });
    }

    // Upsert per-type overrides if provided
    if (typeOverrides) {
      for (const [notifType, prefs] of Object.entries(typeOverrides)) {
        const typedNotifType = notifType as (typeof notificationTypeEnum.enumValues)[number];
        const smsVal = enterpriseNotifs ? (prefs.smsEnabled ?? channel.smsEnabled) : false;
        const teamsVal = enterpriseNotifs ? (prefs.teamsEnabled ?? channel.teamsEnabled) : false;
        const slackVal = enterpriseNotifs ? (prefs.slackEnabled ?? channel.slackEnabled) : false;

        // Task #1260 — Per-type in-app opt-out. Defaults to NULL when the
        // client hasn't sent a value, which preserves the historical
        // "in-app always on" behavior for legacy and unconfigured rows.
        const inAppVal = prefs.inAppEnabled ?? null;

        if (enterpriseNotifs) {
          await db
            .insert(notificationTypePrefs)
            .values({
              userId,
              notificationType: typedNotifType,
              emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
              smsEnabled: smsVal,
              pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
              teamsEnabled: teamsVal,
              slackEnabled: slackVal,
              inAppEnabled: inAppVal,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
              set: {
                emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
                smsEnabled: smsVal,
                pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
                teamsEnabled: teamsVal,
                slackEnabled: slackVal,
                inAppEnabled: inAppVal,
                updatedAt: now,
              },
            });
        } else {
          await db
            .insert(notificationTypePrefs)
            .values({
              userId,
              notificationType: typedNotifType,
              emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
              smsEnabled: false,
              pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
              teamsEnabled: false,
              slackEnabled: false,
              inAppEnabled: inAppVal,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
              set: {
                emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
                pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
                inAppEnabled: inAppVal,
                updatedAt: now,
              },
            });
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.put("/api/notifications/preferences/webhooks", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    const parsed = webhooksBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid webhook data", details: parsed.error.flatten() });
    }

    const { smsPhoneNumber, teamsWebhookUrl, slackWebhookUrl } = parsed.data;

    const orgId = req.user!.organizationId;
    const enterpriseNotifs = orgId ? await hasFeature(orgId, "ENTERPRISE_NOTIFICATIONS") : false;
    if (!enterpriseNotifs && (smsPhoneNumber || teamsWebhookUrl || slackWebhookUrl)) {
      return res.status(403).json({ error: "SMS, Teams, and Slack integrations require an enterprise plan." });
    }

    if (smsPhoneNumber && !isValidE164(smsPhoneNumber)) {
      return res.status(400).json({ error: "Phone number must be in E.164 format (e.g. +15551234567)" });
    }
    if (teamsWebhookUrl && !isValidTeamsWebhookUrl(teamsWebhookUrl)) {
      return res.status(400).json({ error: "Teams webhook URL must start with https://hooks.teams.microsoft.com/ or https://*.webhook.office.com/" });
    }
    if (slackWebhookUrl && !isValidSlackWebhookUrl(slackWebhookUrl)) {
      return res.status(400).json({ error: "Slack webhook URL must start with https://hooks.slack.com/" });
    }

    const now = new Date();

    await db
      .insert(notificationChannelPrefs)
      .values({
        userId,
        emailEnabled: false,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
        smsPhoneNumber: smsPhoneNumber ?? null,
        teamsWebhookUrl: teamsWebhookUrl ?? null,
        slackWebhookUrl: slackWebhookUrl ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: notificationChannelPrefs.userId,
        set: {
          smsPhoneNumber: smsPhoneNumber ?? null,
          teamsWebhookUrl: teamsWebhookUrl ?? null,
          slackWebhookUrl: slackWebhookUrl ?? null,
          updatedAt: now,
        },
      });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Task #772 — Stream a real CSV sample of past digest alerts so Super
 * Admins can validate it opens cleanly in their spreadsheet tool before
 * opting into the digest CSV attachment. Pulls up to 50 of the most
 * recent `jobMetricAlertEvents` from the last 30 days; if there are
 * none, falls back to a deterministic synthetic set so the file is
 * never empty (admins still need a representative sample to test with).
 *
 * Auth-gated to SUPER_ADMIN — same role that owns the digest toggle.
 */
const SAMPLE_LIMIT = 50;
const SAMPLE_LOOKBACK_DAYS = 30;

function buildSyntheticDigestSample(): Array<{
  job: string;
  counter: string | null;
  kind: string;
  message: string;
  triggeredAt: Date;
  emailed: boolean;
}> {
  const base = Date.UTC(2026, 3, 21, 2, 14, 0);
  const HOUR = 60 * 60 * 1000;
  return [
    {
      job: "JOB-104",
      counter: "labor_hours",
      kind: "spike",
      message: "Labor hours 112% of budget",
      triggeredAt: new Date(base),
      emailed: true,
    },
    {
      job: "JOB-217",
      counter: "material_cost",
      kind: "spike",
      message: 'Forecast exceeds budget by $4,820 — vendor "Acme, Inc." flagged',
      triggeredAt: new Date(base + HOUR),
      emailed: true,
    },
    {
      job: "JOB-309",
      counter: "schedule_variance",
      kind: "stall",
      message: "Critical path slipped 3 days\n(rain delay reported by foreman)",
      triggeredAt: new Date(base + 3 * HOUR),
      emailed: false,
    },
  ];
}

router.get(
  "/api/notifications/digest-csv-sample",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res, next) => {
    try {
      const since = new Date(Date.now() - SAMPLE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          job: jobMetricAlertEvents.job,
          counter: jobMetricAlertEvents.counter,
          kind: jobMetricAlertEvents.kind,
          message: jobMetricAlertEvents.message,
          triggeredAt: jobMetricAlertEvents.triggeredAt,
          emailed: jobMetricAlertEvents.emailed,
        })
        .from(jobMetricAlertEvents)
        .where(gte(jobMetricAlertEvents.triggeredAt, since))
        .orderBy(desc(jobMetricAlertEvents.triggeredAt))
        .limit(SAMPLE_LIMIT);

      const events =
        rows.length > 0
          ? rows
              .map((r) => ({
                job: r.job,
                counter: r.counter,
                kind: r.kind,
                message: r.message,
                triggeredAt: new Date(r.triggeredAt),
                emailed: r.emailed,
              }))
              .reverse() // oldest first to match digest output ordering
          : buildSyntheticDigestSample();

      const csv = buildDigestCsv(events);
      const filename = `digest-csv-sample_${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Digest-Csv-Sample-Source", rows.length > 0 ? "live" : "synthetic");
      res.send(csv);
    } catch (error) {
      logError("Failed to build digest CSV sample", { error: String(error) });
      next(error);
    }
  },
);

/**
 * Task #1287 — One-click "mute SWPPP overdue alerts" link rendered in
 * the footer of SWPPP overdue emails. Authentication is via a signed
 * JWT bound to the recipient's userId, so the endpoint can ONLY mute
 * the recipient's own preferences (no cross-tenant abuse).
 *
 * Hitting the link upserts the user's per-type override row to disable
 * both email and in-app delivery for SWPPP_OVERDUE_CORRECTIVE_ACTION,
 * then redirects to the notification preferences page anchored to the
 * SWPPP toggle so the user can re-enable or fine-tune the choice.
 */
router.get("/api/notifications/mute/swppp-overdue", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = token ? verifySwpppMuteToken(token) : null;
    // Query string MUST come before the fragment per RFC 3986; otherwise
    // the browser treats the `?...` as part of the fragment, breaking
    // both the anchor scroll and any client-side query parsing.
    const settingsAnchor = "#section-swppp-overdue-prefs";

    if (!payload) {
      return res.redirect(`/settings/notifications?mute=invalid${settingsAnchor}`);
    }

    const now = new Date();
    await db
      .insert(notificationTypePrefs)
      .values({
        userId: payload.userId,
        notificationType: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
        emailEnabled: false,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
        inAppEnabled: false,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
        set: {
          emailEnabled: false,
          inAppEnabled: false,
          updatedAt: now,
        },
      });

    logInfo("SWPPP overdue alerts muted via email link", {
      userId: payload.userId,
      source: "email_one_click",
    });

    return res.redirect(`/settings/notifications?muted=swppp_overdue${settingsAnchor}`);
  } catch (error) {
    logError("Failed to mute SWPPP overdue alerts via email link", { error: String(error) });
    next(error);
  }
});

export default router;
