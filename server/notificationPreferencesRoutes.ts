import { Router } from "express";
import { db } from "./db";
import { notificationChannelPrefs, notificationTypePrefs, notificationTypeEnum } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, and } from "drizzle-orm";

const router = Router();

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
      channel: channelRow ?? {
        userId,
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
      },
      typeOverrides: typeRows,
    });
  } catch (error) {
    console.error("Get notification preferences error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/notifications/preferences/channel", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { emailEnabled, smsEnabled, pushEnabled, teamsEnabled, slackEnabled } = req.body;

    const values = {
      userId,
      emailEnabled: emailEnabled !== undefined ? Boolean(emailEnabled) : true,
      smsEnabled: Boolean(smsEnabled),
      pushEnabled: Boolean(pushEnabled),
      teamsEnabled: Boolean(teamsEnabled),
      slackEnabled: Boolean(slackEnabled),
      updatedAt: new Date(),
    };

    const [upserted] = await db
      .insert(notificationChannelPrefs)
      .values(values)
      .onConflictDoUpdate({
        target: notificationChannelPrefs.userId,
        set: {
          emailEnabled: values.emailEnabled,
          smsEnabled: values.smsEnabled,
          pushEnabled: values.pushEnabled,
          teamsEnabled: values.teamsEnabled,
          slackEnabled: values.slackEnabled,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    res.json(upserted);
  } catch (error) {
    console.error("Update channel preferences error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/notifications/preferences/type/:notificationType", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { notificationType } = req.params;
    const { emailEnabled, smsEnabled, pushEnabled, teamsEnabled, slackEnabled } = req.body;

    const validTypes = notificationTypeEnum.enumValues as string[];
    if (!validTypes.includes(notificationType)) {
      return res.status(400).json({ error: "Invalid notification type" });
    }

    const notifType = notificationType as (typeof notificationTypeEnum.enumValues)[number];

    const values = {
      userId,
      notificationType: notifType,
      emailEnabled: emailEnabled !== undefined ? Boolean(emailEnabled) : true,
      smsEnabled: Boolean(smsEnabled),
      pushEnabled: Boolean(pushEnabled),
      teamsEnabled: Boolean(teamsEnabled),
      slackEnabled: Boolean(slackEnabled),
      updatedAt: new Date(),
    };

    const [upserted] = await db
      .insert(notificationTypePrefs)
      .values(values)
      .onConflictDoUpdate({
        target: [notificationTypePrefs.userId, notificationTypePrefs.notificationType],
        set: {
          emailEnabled: values.emailEnabled,
          smsEnabled: values.smsEnabled,
          pushEnabled: values.pushEnabled,
          teamsEnabled: values.teamsEnabled,
          slackEnabled: values.slackEnabled,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    res.json(upserted);
  } catch (error) {
    console.error("Update type preferences error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
