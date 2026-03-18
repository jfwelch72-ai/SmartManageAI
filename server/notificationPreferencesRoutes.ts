import { Router } from "express";
import { db } from "./db";
import { notificationChannelPrefs, notificationTypePrefs, notificationTypeEnum } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

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
          }
        : {
            emailEnabled: false,
            smsEnabled: false,
            pushEnabled: false,
            teamsEnabled: false,
            slackEnabled: false,
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
    console.error("Get notification preferences error:", error);
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

    // Upsert channel prefs
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
    console.error("Update notification preferences error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
