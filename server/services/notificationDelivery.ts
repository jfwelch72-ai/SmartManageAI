import { db } from "../db";
import { users, notificationChannelPrefs, notificationTypePrefs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotificationEmail } from "./emailService";
import { logError, logInfo } from "../utils/logger";

type NotificationType = NonNullable<(typeof import("@shared/schema").notifications.$inferInsert)["type"]>;

interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType | null;
  title: string;
  message: string;
  relatedEntityId?: string | null;
  relatedEntityType?: string | null;
}

interface ChannelPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  teamsEnabled: boolean;
  slackEnabled: boolean;
}

const DEFAULT_PREFS: ChannelPrefs = {
  emailEnabled: true,
  smsEnabled: false,
  pushEnabled: false,
  teamsEnabled: false,
  slackEnabled: false,
};

async function loadEffectivePrefs(userId: string, notifType: NotificationType | null): Promise<ChannelPrefs> {
  const [channelRow] = await db
    .select()
    .from(notificationChannelPrefs)
    .where(eq(notificationChannelPrefs.userId, userId))
    .limit(1);

  const base: ChannelPrefs = channelRow
    ? {
        emailEnabled: channelRow.emailEnabled,
        smsEnabled: channelRow.smsEnabled,
        pushEnabled: channelRow.pushEnabled,
        teamsEnabled: channelRow.teamsEnabled,
        slackEnabled: channelRow.slackEnabled,
      }
    : { ...DEFAULT_PREFS };

  if (!notifType) return base;

  const [typeRow] = await db
    .select()
    .from(notificationTypePrefs)
    .where(
      and(
        eq(notificationTypePrefs.userId, userId),
        eq(notificationTypePrefs.notificationType, notifType)
      )
    )
    .limit(1);

  if (!typeRow) return base;

  return {
    emailEnabled: typeRow.emailEnabled,
    smsEnabled: typeRow.smsEnabled,
    pushEnabled: typeRow.pushEnabled,
    teamsEnabled: typeRow.teamsEnabled,
    slackEnabled: typeRow.slackEnabled,
  };
}

async function deliverEmail(userEmail: string, notification: NotificationRecord): Promise<void> {
  try {
    await sendNotificationEmail(
      userEmail,
      notification.title,
      notification.message
    );
  } catch (err) {
    logError("notificationDelivery: email send failed", {
      userId: notification.userId,
      error: String(err),
    });
  }
}

function deliverSms(_userPhone: string | null, _notification: NotificationRecord): void {
  // SMS delivery — stub, implemented in Task #51
}

function deliverPush(_userId: string, _notification: NotificationRecord): void {
  // Web Push delivery — implemented in Task #50
}

function deliverTeams(_userId: string, _notification: NotificationRecord): void {
  // Microsoft Teams delivery — stub, implemented in Task #51
}

function deliverSlack(_userId: string, _notification: NotificationRecord): void {
  // Slack delivery — stub, implemented in Task #51
}

export async function deliverNotification(notification: NotificationRecord): Promise<void> {
  try {
    const [userRow] = await db
      .select({ email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, notification.userId))
      .limit(1);

    if (!userRow) return;

    const prefs = await loadEffectivePrefs(notification.userId, notification.type);

    const tasks: Promise<void>[] = [];

    if (prefs.emailEnabled) {
      tasks.push(deliverEmail(userRow.email, notification));
    }
    if (prefs.smsEnabled) {
      deliverSms(userRow.phone ?? null, notification);
    }
    if (prefs.pushEnabled) {
      deliverPush(notification.userId, notification);
    }
    if (prefs.teamsEnabled) {
      deliverTeams(notification.userId, notification);
    }
    if (prefs.slackEnabled) {
      deliverSlack(notification.userId, notification);
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  } catch (err) {
    logError("notificationDelivery: deliverNotification failed", {
      notificationId: notification.id,
      userId: notification.userId,
      error: String(err),
    });
  }
}

export async function deliverNotifications(notifications: NotificationRecord[]): Promise<void> {
  await Promise.allSettled(notifications.map(deliverNotification));
}
