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

router.get("/api/notifications/preferences", requireAuth, async (req: AuthRequest, res) => {
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
    });
  } catch (error) {
    logError("Get notification preferences error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/notifications/preferences", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const parsed = preferencesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid preferences data", details: parsed.error.flatten() });
    }

    const { channel, typeOverrides } = parsed.data;
    const now = new Date();

    // Upsert channel prefs (preserve existing webhook URLs)
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

    // Upsert per-type overrides if provided
    if (typeOverrides) {
      for (const [notifType, prefs] of Object.entries(typeOverrides)) {
        const typedNotifType = notifType as (typeof notificationTypeEnum.enumValues)[number];
        await db
          .insert(notificationTypePrefs)
          .values({
            userId,
            notificationType: typedNotifType,
            emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
            smsEnabled: prefs.smsEnabled ?? channel.smsEnabled,
            pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
            teamsEnabled: prefs.teamsEnabled ?? channel.teamsEnabled,
            slackEnabled: prefs.slackEnabled ?? channel.slackEnabled,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
            set: {
              emailEnabled: prefs.emailEnabled ?? channel.emailEnabled,
              smsEnabled: prefs.smsEnabled ?? channel.smsEnabled,
              pushEnabled: prefs.pushEnabled ?? channel.pushEnabled,
              teamsEnabled: prefs.teamsEnabled ?? channel.teamsEnabled,
              slackEnabled: prefs.slackEnabled ?? channel.slackEnabled,
              updatedAt: now,
            },
          });
      }
    }

    res.json({ success: true });
  } catch (error) {
    logError("Update notification preferences error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/notifications/preferences/webhooks", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const parsed = webhooksBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid webhook data", details: parsed.error.flatten() });
    }

    const { smsPhoneNumber, teamsWebhookUrl, slackWebhookUrl } = parsed.data;

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
    logError("Update webhook preferences error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
