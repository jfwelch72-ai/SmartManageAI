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
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { isValidE164, isTwilioConfigured } from "./services/smsService";
import { isValidTeamsWebhookUrl } from "./services/teamsService";
import { isValidSlackWebhookUrl } from "./services/slackService";
import { hasFeature } from "./services/featureAccess";
import { buildDigestCsv } from "./utils/jobMetricAlerts";
import { verifySwpppMuteToken } from "./utils/swpppMuteToken";
import { verifyDavisBaconMuteToken } from "./utils/davisBaconMuteToken";
import { verifyWageDecisionRatesChangedMuteToken } from "./utils/wageDecisionRatesChangedMuteToken";
import { verifyLogEmailFailuresDigestMuteToken } from "./utils/logEmailFailuresDigestMuteToken";
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
              // Task #1747 — An explicit choice through the standard
              // settings page always wins over a stale snooze the user
              // may have set via the failures dashboard, so clear
              // `mutedUntil` on every write here.
              mutedUntil: null,
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
                mutedUntil: null,
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
              mutedUntil: null,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
              set: {
                emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
                pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
                inAppEnabled: inAppVal,
                mutedUntil: null,
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

/**
 * Task #1361 — One-click "mute Davis-Bacon auto-sync failure alerts"
 * link rendered in the footer of DAVIS_BACON_AUTO_SYNC_FAILED emails.
 * Mirrors the SWPPP overdue mute endpoint above: signed JWT bound to
 * the recipient's userId, upserts both email + in-app to disabled,
 * then redirects back to the settings page anchored to the toggle.
 */
router.get("/api/notifications/mute/davis-bacon-auto-sync-failed", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = token ? verifyDavisBaconMuteToken(token) : null;
    const settingsAnchor = "#section-davis-bacon-auto-sync-failed-prefs";

    if (!payload) {
      return res.redirect(`/settings/notifications?mute=invalid${settingsAnchor}`);
    }

    const now = new Date();
    await db
      .insert(notificationTypePrefs)
      .values({
        userId: payload.userId,
        notificationType: "DAVIS_BACON_AUTO_SYNC_FAILED",
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

    logInfo("Davis-Bacon auto-sync failure alerts muted via email link", {
      userId: payload.userId,
      source: "email_one_click",
    });

    return res.redirect(`/settings/notifications?muted=davis_bacon_auto_sync_failed${settingsAnchor}`);
  } catch (error) {
    logError("Failed to mute Davis-Bacon auto-sync failure alerts via email link", { error: String(error) });
    next(error);
  }
});

/**
 * Task #1731 — Discoverability shim for the daily failures digest mute
 * setting. Admins can already toggle delivery from the standard
 * notification preferences page (it's a per-user `notification_type_prefs`
 * row for `PROJECT_LOG_EMAIL_FAILURES_DIGEST`), but the failures
 * dashboard at `/admin/log-email-failures` is the natural place an admin
 * thinks "stop nagging me about this". These endpoints back a small
 * subscription card on that dashboard so the admin can mute / unmute
 * either channel inline without leaving the page — and without
 * accidentally disabling the more important per-failure ping
 * (`PROJECT_LOG_EMAIL_FAILED`) on the standard prefs page.
 *
 * Auth: ADMIN / SUPER_ADMIN only — those are the only roles the digest
 * job (`processProjectLogEmailFailuresDigest` in `server/jobs/jobRunner.ts`)
 * actually delivers to. MANAGER / SUPERINTENDENT can view the dashboard
 * but never receive the digest, so giving them a toggle would write a
 * pref row that does nothing.
 *
 * Storage: writes the same `notification_type_prefs` row the existing
 * settings page upserts via `PUT /api/notifications/preferences`, so
 * the channel resolver in `notificationDelivery.ts` (and the in-app
 * feed filter in `notificationService.ts`) honor the mute identically.
 *
 * Email default = channel `emailEnabled` when no override row exists;
 * in-app default = `true` (NULL on the override row means "not
 * configured", which the feed filter passes through). Both match the
 * semantics of the existing settings page.
 */
const FAILURES_DIGEST_TYPE = "PROJECT_LOG_EMAIL_FAILURES_DIGEST" as const;

// Task #1747 — Snooze ceilings prevent a typo (or a malicious script)
// from setting a mute that effectively never auto-clears. 365 days is
// already an order of magnitude larger than the longest snooze the UI
// surfaces (30 days), so it's a generous-but-finite cap.
const MAX_SNOOZE_DAYS = 365;

const failuresDigestSubscriptionBodySchema = z
  .object({
    emailEnabled: z.boolean().optional(),
    inAppEnabled: z.boolean().optional(),
    // Task #1747 — Optional snooze duration for either channel mute.
    // `null` (or omitted) keeps the historical "indefinite" semantics.
    // Only honored when the request is actually muting at least one
    // channel — re-enabling clears `mutedUntil` regardless.
    mutedUntilDays: z
      .number()
      .int()
      .positive()
      .max(MAX_SNOOZE_DAYS)
      .nullable()
      .optional(),
  })
  .refine(
    (v) => v.emailEnabled !== undefined || v.inAppEnabled !== undefined,
    { message: "At least one of emailEnabled or inAppEnabled must be provided" },
  );

router.get(
  "/api/notifications/preferences/log-email-failures-digest",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const [channelRow] = await db
        .select()
        .from(notificationChannelPrefs)
        .where(eq(notificationChannelPrefs.userId, userId))
        .limit(1);

      const [typeRow] = await db
        .select()
        .from(notificationTypePrefs)
        .where(
          and(
            eq(notificationTypePrefs.userId, userId),
            eq(notificationTypePrefs.notificationType, FAILURES_DIGEST_TYPE),
          ),
        )
        .limit(1);

      // Channel email is OFF by default until the user opts in via the
      // standard settings page — same behavior as `loadEffectivePrefs`
      // in `notificationDelivery.ts`.
      const channelEmailEnabled = channelRow?.emailEnabled ?? false;

      // Task #1747 — Treat an expired snooze as "no override" so the
      // dashboard reflects the auto-cleared state immediately. The
      // delivery / feed-filter paths apply the same rule, so the row
      // is effectively defunct until the user mutes again.
      const mutedUntil = typeRow?.mutedUntil ? new Date(typeRow.mutedUntil) : null;
      const snoozeExpired = mutedUntil !== null && mutedUntil.getTime() <= Date.now();
      const effectiveTypeRow = snoozeExpired ? null : typeRow;

      // Effective email = override (if set) ELSE channel email. The
      // override row's `emailEnabled` is a non-nullable column so we
      // can read it directly when the row exists.
      const emailEnabled = effectiveTypeRow ? effectiveTypeRow.emailEnabled : channelEmailEnabled;

      // Effective in-app: NULL means "not configured" → defaults to
      // delivered (Task #1260). Only an explicit `false` mutes the row.
      const inAppEnabled = effectiveTypeRow?.inAppEnabled === false ? false : true;

      res.json({
        notificationType: FAILURES_DIGEST_TYPE,
        emailEnabled,
        inAppEnabled,
        channelEmailEnabled,
        // Surface the raw stored values so the UI can distinguish
        // "muted because channel email is off" from "muted because the
        // user explicitly disabled this type".
        emailOverride: effectiveTypeRow ? effectiveTypeRow.emailEnabled : null,
        inAppOverride: effectiveTypeRow ? effectiveTypeRow.inAppEnabled : null,
        // Task #1747 — Surface mute timing so the dashboard card can
        // render "muted N days ago" + the auto-clear deadline. We
        // return `mutedAt` only when an override is in effect (i.e.
        // not expired); for an expired snooze the row is logically
        // gone, so reporting its old timestamp would be misleading.
        // `mutedUntil` is always the raw stored value when present —
        // a UI can use a past timestamp to label the row "expired".
        mutedAt: effectiveTypeRow?.updatedAt
          ? new Date(effectiveTypeRow.updatedAt).toISOString()
          : null,
        mutedUntil: typeRow?.mutedUntil
          ? new Date(typeRow.mutedUntil).toISOString()
          : null,
        snoozeExpired,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/api/notifications/preferences/log-email-failures-digest",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const parsed = failuresDigestSubscriptionBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid digest subscription payload",
          details: parsed.error.flatten(),
        });
      }

      const { emailEnabled, inAppEnabled, mutedUntilDays } = parsed.data;
      const now = new Date();

      // Seed the insert row from the user's channel-level settings so
      // the unspecified channels (sms / push / teams / slack) keep
      // matching their channel defaults — same first-insert behavior
      // as the standard `PUT /api/notifications/preferences` endpoint.
      // The digest itself only delivers via email and in-app, so these
      // values don't change the digest's reach today, but they keep
      // the override row a faithful snapshot of "user wanted everything
      // else to follow the channel default".
      const [channelRow] = await db
        .select()
        .from(notificationChannelPrefs)
        .where(eq(notificationChannelPrefs.userId, userId))
        .limit(1);

      const insertEmail = emailEnabled ?? channelRow?.emailEnabled ?? false;
      const insertInApp = inAppEnabled ?? null;

      // Task #1747 — Resolve the snooze deadline against the *merged*
      // post-update state (existing override row + this patch), not
      // just the patch. Otherwise a partial-unmute (e.g. flipping
      // email back on while in-app stays muted) would clear
      // `muted_until` and silently promote the surviving channel mute
      // to an indefinite one. We want the snooze to keep ticking on
      // the surviving channel.
      //
      // - When the caller provides `mutedUntilDays` and is muting at
      //   least one channel in this patch, that's the new deadline.
      // - When the caller doesn't provide `mutedUntilDays` but the
      //   merged state still has at least one channel muted AND a
      //   future snooze deadline already exists, preserve it.
      // - Otherwise (no surviving mute, or an unmute that flips
      //   everything back on) clear `muted_until`.
      const [existingTypeRow] = await db
        .select()
        .from(notificationTypePrefs)
        .where(
          and(
            eq(notificationTypePrefs.userId, userId),
            eq(notificationTypePrefs.notificationType, FAILURES_DIGEST_TYPE),
          ),
        )
        .limit(1);

      // Merge: explicit patch fields win, otherwise fall back to the
      // existing row, then the channel default. NULL inAppEnabled means
      // "follow channel default" — for the purpose of "is anything
      // muted", we treat it as not-muted (matches the GET handler's
      // effective-pref logic).
      const mergedEmailMuted =
        (emailEnabled ?? existingTypeRow?.emailEnabled ?? channelRow?.emailEnabled ?? true) === false;
      const mergedInAppMuted =
        (inAppEnabled ?? existingTypeRow?.inAppEnabled ?? null) === false;
      const stillMutedAfterUpdate = mergedEmailMuted || mergedInAppMuted;

      let mutedUntil: Date | null;
      if (stillMutedAfterUpdate && typeof mutedUntilDays === "number") {
        // New snooze on a (still) muted channel — start the clock now.
        mutedUntil = new Date(now.getTime() + mutedUntilDays * 24 * 60 * 60 * 1000);
      } else if (
        stillMutedAfterUpdate &&
        mutedUntilDays === undefined &&
        existingTypeRow?.mutedUntil &&
        existingTypeRow.mutedUntil.getTime() > now.getTime()
      ) {
        // Caller didn't touch the snooze and at least one channel is
        // still muted — preserve the existing future deadline so the
        // surviving mute keeps auto-clearing on schedule.
        mutedUntil = existingTypeRow.mutedUntil;
      } else {
        // Either nothing is muted anymore (full unmute), or the caller
        // explicitly passed `mutedUntilDays: null` (indefinite), or no
        // active snooze existed to preserve. Clear it.
        mutedUntil = null;
      }

      // Build the ON CONFLICT update set lazily so we only touch the
      // columns the caller explicitly toggled — that way a user who
      // mutes just the email channel here doesn't accidentally clobber
      // a previously-configured `inAppEnabled` value (and vice versa).
      const updateSet: Record<string, unknown> = { updatedAt: now };
      if (emailEnabled !== undefined) updateSet.emailEnabled = emailEnabled;
      if (inAppEnabled !== undefined) updateSet.inAppEnabled = inAppEnabled;
      // Always rewrite `mutedUntil` (resolved above) so the row remains
      // a faithful snapshot of the snooze state.
      updateSet.mutedUntil = mutedUntil;

      await db
        .insert(notificationTypePrefs)
        .values({
          userId,
          notificationType: FAILURES_DIGEST_TYPE,
          emailEnabled: insertEmail,
          smsEnabled: channelRow?.smsEnabled ?? false,
          pushEnabled: channelRow?.pushEnabled ?? false,
          teamsEnabled: channelRow?.teamsEnabled ?? false,
          slackEnabled: channelRow?.slackEnabled ?? false,
          inAppEnabled: insertInApp,
          mutedUntil,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
          set: updateSet,
        });

      logInfo("Project log email failures digest subscription updated", {
        userId,
        emailEnabled: emailEnabled ?? null,
        inAppEnabled: inAppEnabled ?? null,
        mutedUntilDays: mutedUntilDays ?? null,
        mutedUntil: mutedUntil ? mutedUntil.toISOString() : null,
        source: "failures_dashboard",
      });

      res.json({ success: true });
    } catch (error) {
      logError("Failed to update project log email failures digest subscription", {
        error: String(error),
      });
      next(error);
    }
  },
);

/**
 * Task #1408 — One-click "mute Davis-Bacon wage rate change alerts" link
 * rendered in the footer of WAGE_DECISION_RATES_CHANGED emails. Mirrors
 * the Davis-Bacon auto-sync failure mute endpoint above: signed JWT
 * bound to the recipient's userId so it can ONLY mute the recipient's
 * own preferences (no cross-tenant abuse), upserts both email + in-app
 * to disabled, then redirects back to the settings page anchored to
 * the matching toggle.
 */
router.get("/api/notifications/mute/wage-decision-rates-changed", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = token ? verifyWageDecisionRatesChangedMuteToken(token) : null;
    const settingsAnchor = "#section-wage-decision-rates-changed-prefs";

    if (!payload) {
      return res.redirect(`/settings/notifications?mute=invalid${settingsAnchor}`);
    }

    const now = new Date();
    await db
      .insert(notificationTypePrefs)
      .values({
        userId: payload.userId,
        notificationType: "WAGE_DECISION_RATES_CHANGED",
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

    logInfo("Wage-decision rate change alerts muted via email link", {
      userId: payload.userId,
      source: "email_one_click",
    });

    return res.redirect(`/settings/notifications?muted=wage_decision_rates_changed${settingsAnchor}`);
  } catch (error) {
    logError("Failed to mute wage-decision rate change alerts via email link", { error: String(error) });
    next(error);
  }
});

/**
 * Task #1746 — One-click "mute the daily failures digest" link rendered
 * in the footer of PROJECT_LOG_EMAIL_FAILURES_DIGEST emails. Mirrors
 * the SWPPP overdue (Task #1287), Davis-Bacon auto-sync failure (Task
 * #1361), and Davis-Bacon wage-rate change (Task #1408) mute endpoints
 * above: signed JWT bound to the recipient's userId so the endpoint
 * can ONLY mute the recipient's own preferences (no cross-tenant
 * abuse), upserts both email + in-app to disabled, then redirects back
 * to the failures dashboard (which already hosts the inline mute card
 * from Task #1731) with a confirmation banner.
 */
router.get("/api/notifications/mute/log-email-failures-digest", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = token ? verifyLogEmailFailuresDigestMuteToken(token) : null;

    if (!payload) {
      // Invalid / expired tokens land back on the same dashboard so
      // the admin can use the inline DigestSubscriptionCard instead;
      // a banner explains why the click didn't take effect.
      return res.redirect(`/admin/log-email-failures?mute=invalid`);
    }

    const now = new Date();
    await db
      .insert(notificationTypePrefs)
      .values({
        userId: payload.userId,
        notificationType: "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
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

    logInfo("Project log email failures digest muted via email link", {
      userId: payload.userId,
      source: "email_one_click",
    });

    return res.redirect(`/admin/log-email-failures?muted=log_email_failures_digest`);
  } catch (error) {
    logError("Failed to mute project log email failures digest via email link", {
      error: String(error),
    });
    next(error);
  }
});

export default router;
