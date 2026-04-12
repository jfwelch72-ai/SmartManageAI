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
import { notificationChannelPrefs, notificationTypePrefs, notificationTypeEnum } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isValidE164 } from "./services/smsService";
import { isValidTeamsWebhookUrl } from "./services/teamsService";
import { isValidSlackWebhookUrl } from "./services/slackService";
import { hasFeature } from "./services/featureAccess";

const router = Router();

const channelPrefsSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  teamsEnabled: z.boolean(),
  slackEnabled: z.boolean(),
});

const typePrefsSchema = z.record(
  z.enum(notificationTypeEnum.enumValues),
  channelPrefsSchema.partial()
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
          },
      typeOverrides: typeRows.map((r) => ({
        notificationType: r.notificationType,
        emailEnabled: r.emailEnabled,
        smsEnabled: r.smsEnabled,
        pushEnabled: r.pushEnabled,
        teamsEnabled: r.teamsEnabled,
        slackEnabled: r.slackEnabled,
      })),
      enterpriseNotificationsEnabled,
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

    if (enterpriseNotifs) {
      await db
        .insert(notificationChannelPrefs)
        .values({
          userId,
          emailEnabled: channel.emailEnabled,
          smsEnabled: channel.smsEnabled,
          pushEnabled: channel.pushEnabled,
          teamsEnabled: channel.teamsEnabled,
          slackEnabled: channel.slackEnabled,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: notificationChannelPrefs.userId,
          set: {
            emailEnabled: channel.emailEnabled,
            smsEnabled: channel.smsEnabled,
            pushEnabled: channel.pushEnabled,
            teamsEnabled: channel.teamsEnabled,
            slackEnabled: channel.slackEnabled,
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
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: notificationChannelPrefs.userId,
          set: {
            emailEnabled: channel.emailEnabled,
            pushEnabled: channel.pushEnabled,
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
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
              set: {
                emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
                pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
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

export default router;
