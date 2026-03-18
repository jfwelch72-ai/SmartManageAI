import { db } from "../db";
import { users, notificationChannelPrefs, notificationTypePrefs, notificationTypeEnum } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotificationEmail } from "./emailService";
import { logError } from "../utils/logger";

type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

export interface NotificationRecord {
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

// All channels off by default — users must explicitly enable them
const DEFAULT_PREFS: ChannelPrefs = {
  emailEnabled: false,
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

  // Merge type-level overrides onto base channel prefs field-by-field.
  // This ensures a per-type row only overrides the channels explicitly stored in it,
  // and future partial-row scenarios are handled gracefully.
  return {
    emailEnabled: typeRow.emailEnabled ?? base.emailEnabled,
    smsEnabled: typeRow.smsEnabled ?? base.smsEnabled,
    pushEnabled: typeRow.pushEnabled ?? base.pushEnabled,
    teamsEnabled: typeRow.teamsEnabled ?? base.teamsEnabled,
    slackEnabled: typeRow.slackEnabled ?? base.slackEnabled,
  };
}

function composeEmailContent(notification: NotificationRecord): {
  subject: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
} {
  const baseUrl = process.env.APP_BASE_URL || "";
  const type = notification.type;

  // Type-aware composition
  if (type === "CHANGE_ORDER_APPROVED" || type === "CHANGE_ORDER_REJECTED") {
    const status = type === "CHANGE_ORDER_APPROVED" ? "Approved" : "Rejected";
    return {
      subject: `Change Order ${status} — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/change-orders/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Change Order",
    };
  }

  if (type === "SUBMITTAL_SUBMITTED" || type === "SUBMITTAL_APPROVED" || type === "SUBMITTAL_REJECTED" || type === "SUBMITTAL_REVISION_REQUESTED") {
    return {
      subject: `Submittal Update — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/submittals/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Submittal",
    };
  }

  if (type === "TM_TICKET_SUBMITTED" || type === "TM_TICKET_APPROVED" || type === "TM_TICKET_REJECTED") {
    return {
      subject: `T&M Ticket Update — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/tm-tickets/${notification.relatedEntityId}`
        : undefined,
      actionText: "View T&M Ticket",
    };
  }

  if (type === "OVERTIME_REQUESTED" || type === "OVERTIME_APPROVED" || type === "OVERTIME_REJECTED") {
    return {
      subject: `Overtime Request Update — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/overtime-requests`,
      actionText: "View Overtime Requests",
    };
  }

  if (type === "BILLING_READY") {
    return {
      subject: `Payroll Ready — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/payroll`,
      actionText: "View Payroll",
    };
  }

  if (type === "PROJECT_ASSIGNMENT" || type === "BID_AWARDED") {
    return {
      subject: `${notification.title} — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/projects/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Project",
    };
  }

  if (type === "APPROVAL_REQUEST_NEW" || type === "APPROVAL_REQUEST_APPROVED" || type === "APPROVAL_REQUEST_REJECTED") {
    return {
      subject: `Approval Update — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/approvals`,
      actionText: "View Approvals",
    };
  }

  if (type === "PROCUREMENT_PR_SUBMITTED" || type === "PROCUREMENT_PR_APPROVED" || type === "PROCUREMENT_PR_REJECTED" ||
      type === "PROCUREMENT_PO_SUBMITTED" || type === "PROCUREMENT_PO_APPROVED" || type === "PROCUREMENT_PO_REJECTED") {
    return {
      subject: `Procurement Update — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/procurement`,
      actionText: "View Procurement",
    };
  }

  if (type === "CRM_STAGE_CHANGE" || type === "CRM_IDLE_OPPORTUNITY") {
    return {
      subject: `CRM Update — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/crm`,
      actionText: "View CRM",
    };
  }

  if (type === "TASK_MENTIONED") {
    return {
      subject: `You were mentioned — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/projects?taskId=${notification.relatedEntityId}`
        : undefined,
      actionText: "View Task",
    };
  }

  if (type === "DEADLINE_WARNING" || type === "REMINDER") {
    return {
      subject: `${notification.title} — SmartManageAI`,
      body: notification.message,
    };
  }

  // Generic fallback
  return {
    subject: `${notification.title} — SmartManageAI`,
    body: notification.message,
  };
}

async function deliverEmail(userEmail: string, notification: NotificationRecord): Promise<void> {
  try {
    const { subject, body, actionUrl, actionText } = composeEmailContent(notification);
    await sendNotificationEmail(userEmail, subject, body, actionUrl, actionText);
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
