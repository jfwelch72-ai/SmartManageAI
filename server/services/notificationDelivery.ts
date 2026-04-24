import { db } from "../db";
import { users, notificationChannelPrefs, notificationTypePrefs, notificationTypeEnum, integrationSyncState, integrationConnections } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotificationEmail } from "../email";
import { sendEmail } from "./emailService";
import { sendPushToUser } from "./pushService";
import { sendNativePushToUser } from "./nativePushService";
import { sendSms, isTwilioConfigured } from "./smsService";
import { sendTeamsMessage } from "./teamsService";
import { sendSlackMessage } from "./slackService";
import { logError } from "../utils/logger";
import { hasFeature } from "./featureAccess";
import { isFeatureEnabled } from "./featureFlagService";
import { buildSwpppMuteUrl } from "../utils/swpppMuteToken";
import { buildDavisBaconMuteUrl } from "../utils/davisBaconMuteToken";
import { buildWageDecisionRatesChangedMuteUrl } from "../utils/wageDecisionRatesChangedMuteToken";
import { buildIntegrationSyncMuteUrl } from "../utils/integrationSyncMuteToken";

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
  smsPhoneNumber: string | null;
  teamsWebhookUrl: string | null;
  slackWebhookUrl: string | null;
}

// All channels off by default — users must explicitly enable them
const DEFAULT_PREFS: ChannelPrefs = {
  emailEnabled: false,
  smsEnabled: false,
  pushEnabled: false,
  teamsEnabled: false,
  slackEnabled: false,
  smsPhoneNumber: null,
  teamsWebhookUrl: null,
  slackWebhookUrl: null,
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
        smsPhoneNumber: channelRow.smsPhoneNumber ?? null,
        teamsWebhookUrl: channelRow.teamsWebhookUrl ?? null,
        slackWebhookUrl: channelRow.slackWebhookUrl ?? null,
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
  // Webhook URLs and phone numbers are channel-level settings — always carry base values.
  return {
    emailEnabled: typeRow.emailEnabled ?? base.emailEnabled,
    smsEnabled: typeRow.smsEnabled ?? base.smsEnabled,
    pushEnabled: typeRow.pushEnabled ?? base.pushEnabled,
    teamsEnabled: typeRow.teamsEnabled ?? base.teamsEnabled,
    slackEnabled: typeRow.slackEnabled ?? base.slackEnabled,
    smsPhoneNumber: base.smsPhoneNumber,
    teamsWebhookUrl: base.teamsWebhookUrl,
    slackWebhookUrl: base.slackWebhookUrl,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Extra context an async caller can feed the composer. Required for the
 * INTEGRATION_SYNC_RETRIES_EXHAUSTED one-click mute link because the
 * notification row only stores the sync-state PK — we need the
 * connectionId + entityType to sign the token. SMS/push callers skip
 * this (their templates don't render the mute footer).
 */
export interface ComposeEmailExtras {
  integrationSyncContext?: {
    connectionId: string;
    entityType: string;
    integrationLabel: string;
  };
}

export function composeEmailContent(
  notification: NotificationRecord,
  extras: ComposeEmailExtras = {},
): {
  subject: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
  html?: string;
} {
  const baseUrl = process.env.APP_BASE_URL || "";
  const type = notification.type;

  // Task #688: rich HTML email for the weekly CRM contact birthday digest.
  if (notification.relatedEntityType === "CRM_CONTACT_BIRTHDAY") {
    const lines = notification.message.split("\n").filter(Boolean);
    // First line is the header ("Upcoming contact birthdays this week:")
    const [header, ...itemLines] = lines.length > 1 ? lines : ["Upcoming contact birthdays this week:", ...lines];
    const actionUrl = `${baseUrl}/crm`;
    const subject = `${notification.title} — SmartManageAI`;
    const items = itemLines.length > 0 ? itemLines : [notification.message];
    const listHtml = items
      .map((line) => `<li style="padding: 6px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${escapeHtml(line)}</li>`)
      .join("");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; margin-bottom: 8px;">${escapeHtml(notification.title)}</h2>
        <p style="color: #666; line-height: 1.6; margin-top: 0;">${escapeHtml(header)}</p>
        <ul style="list-style: none; padding: 0; margin: 16px 0; background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 8px 16px;">
          ${listHtml}
        </ul>
        <p style="margin-top: 20px;">
          <a href="${actionUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Open CRM
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">You are receiving this weekly digest because reminder emails are enabled in your SmartManageAI notification preferences.</p>
      </div>
    `;
    return {
      subject,
      body: notification.message,
      actionUrl,
      actionText: "Open CRM",
      html,
    };
  }

  // Task #1116: rich HTML email for the weekly certified payroll digest.
  // The job stores the date range in `relatedEntityId` as
  // `"YYYY-MM-DD|YYYY-MM-DD"` and seeds the message body with a header
  // line followed by `Project — Variant: count` lines.
  if (notification.relatedEntityType === "CERTIFIED_PAYROLL_DIGEST") {
    const range = (notification.relatedEntityId ?? "").split("|");
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(range[0] ?? "") ? range[0] : "";
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(range[1] ?? "") ? range[1] : "";
    const qs = new URLSearchParams();
    if (startDate) qs.set("startDate", startDate);
    if (endDate) qs.set("endDate", endDate);
    const actionUrl = `${baseUrl}/payroll/certified-history${qs.toString() ? `?${qs.toString()}` : ""}`;
    const subject = `${notification.title} — SmartManageAI`;

    const lines = notification.message.split("\n");
    const header = lines[0] ?? notification.message;
    const breakdown = lines.slice(1).filter((l) => l.trim().length > 0);

    const rowsHtml = breakdown.map((line) => {
      const sepIdx = line.lastIndexOf(": ");
      const left = sepIdx >= 0 ? line.slice(0, sepIdx) : line;
      const count = sepIdx >= 0 ? line.slice(sepIdx + 2) : "";
      const dashIdx = left.lastIndexOf(" — ");
      const project = dashIdx >= 0 ? left.slice(0, dashIdx) : left;
      const variant = dashIdx >= 0 ? left.slice(dashIdx + 3) : "";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#333;">${escapeHtml(project)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555;">${escapeHtml(variant)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#111;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(count)}</td>
      </tr>`;
    }).join("");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2 style="color: #333; margin-bottom: 8px;">${escapeHtml(notification.title)}</h2>
        <p style="color: #666; line-height: 1.6; margin-top: 0;">${escapeHtml(header)}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #eee;border-radius:6px;overflow:hidden;">
          <thead>
            <tr style="background:#fafafa;">
              <th style="padding:8px 12px;text-align:left;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Project</th>
              <th style="padding:8px 12px;text-align:left;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Form Variant</th>
              <th style="padding:8px 12px;text-align:right;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Reports</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="margin-top: 20px;">
          <a href="${actionUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Open Certified Payroll History
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">You are receiving this weekly digest because you can manage payroll for this organization. Adjust delivery in your SmartManageAI notification preferences.</p>
      </div>
    `;
    return {
      subject,
      body: notification.message,
      actionUrl,
      actionText: "Open Certified Payroll History",
      html,
    };
  }

  // Task #1173: SWPPP corrective action overdue reminder. Deep-links to
  // the SWPPP inspection list so the assignee/PM can mark it resolved or
  // adjust the due date in one click.
  if (notification.relatedEntityType === "SWPPP_OVERDUE_CORRECTIVE_ACTION") {
    const actionUrl = `${baseUrl}/swppp-inspections${notification.relatedEntityId ? `?inspectionId=${encodeURIComponent(notification.relatedEntityId)}` : ""}`;
    const subject = `SWPPP Corrective Action Overdue — SmartManageAI`;
    const actionText = "Open SWPPP Inspection";

    // Task #1287 — One-click mute footer link. The signed token is
    // bound to the recipient's userId so the endpoint can only mute
    // *their* SWPPP overdue preferences (no cross-tenant abuse). A
    // plain settings deep-link is included as a transparent fallback.
    const muteUrl = baseUrl ? buildSwpppMuteUrl(baseUrl, notification.userId) : "";
    const settingsUrl = `${baseUrl}/settings/notifications#section-swppp-overdue-prefs`;

    const messageHtml = escapeHtml(notification.message).replace(/\n/g, "<br>");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">${escapeHtml(subject)}</h2>
        <p style="color: #666; line-height: 1.6;">${messageHtml}</p>
        <p style="margin-top: 20px;">
          <a href="${actionUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            ${escapeHtml(actionText)}
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; line-height: 1.6;">
          You are receiving this because SWPPP overdue alerts are enabled in your SmartManageAI notification preferences.
          ${muteUrl ? `<br><a href="${muteUrl}" style="color: #0070f3; text-decoration: underline;" data-testid="link-mute-swppp-overdue">Mute SWPPP overdue alerts in your preferences</a> &middot; ` : ""}<a href="${settingsUrl}" style="color: #999; text-decoration: underline;">Manage notification settings</a>
        </p>
      </div>
    `;

    return {
      subject,
      body: notification.message,
      actionUrl,
      actionText,
      html,
    };
  }

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

  if (type === "HAUL_TICKET_SUBMITTED" || type === "HAUL_TICKET_APPROVED" || type === "HAUL_TICKET_REJECTED" || type === "HAUL_TICKET_VOIDED") {
    const status = type === "HAUL_TICKET_APPROVED" ? "Approved"
      : type === "HAUL_TICKET_REJECTED" ? "Rejected"
      : type === "HAUL_TICKET_VOIDED" ? "Voided"
      : "Submitted";
    return {
      subject: `Haul Ticket ${status} — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/haul-tickets`,
      actionText: "View Haul Tickets",
    };
  }

  if (type === "INSPECTOR_REPORT_SUBMITTED" || type === "INSPECTOR_REPORT_APPROVED" || type === "INSPECTOR_REPORT_REVISION_REQUESTED") {
    const status = type === "INSPECTOR_REPORT_APPROVED" ? "Approved" : type === "INSPECTOR_REPORT_REVISION_REQUESTED" ? "Revision Requested" : "Submitted";
    return {
      subject: `Daily Inspector Report ${status} — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/daily-inspector-reports`,
      actionText: "View Inspector Reports",
    };
  }

  if (type === "MATERIAL_CERT_SUBMITTED" || type === "MATERIAL_CERT_VERIFIED" || type === "MATERIAL_CERT_REJECTED") {
    const status = type === "MATERIAL_CERT_VERIFIED" ? "Verified" : type === "MATERIAL_CERT_REJECTED" ? "Rejected" : "Submitted";
    return {
      subject: `Material Certification ${status} — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/material-certifications`,
      actionText: "View Material Certifications",
    };
  }

  if (type === "SURETY_BOND_ACTIVATED" || type === "SURETY_BOND_RELEASED" || type === "SURETY_BOND_EXPIRED" || type === "SURETY_BOND_CANCELED") {
    const status = type === "SURETY_BOND_ACTIVATED" ? "Activated"
      : type === "SURETY_BOND_RELEASED" ? "Released"
      : type === "SURETY_BOND_CANCELED" ? "Canceled"
      : "Expired";
    return {
      subject: `Surety Bond ${status} — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/surety-bonds`,
      actionText: "View Surety Bonds",
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

  if (type === "PROCUREMENT_PR_SUBMITTED" || type === "PROCUREMENT_PR_APPROVED" || type === "PROCUREMENT_PR_REJECTED") {
    const prParam = notification.relatedEntityId ? `?prId=${notification.relatedEntityId}` : "";
    return {
      subject: `Procurement Update — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/procurement${prParam}`,
      actionText: "View Purchase Request",
    };
  }

  if (type === "PROCUREMENT_PO_SUBMITTED" || type === "PROCUREMENT_PO_APPROVED" || type === "PROCUREMENT_PO_REJECTED") {
    const poParam = notification.relatedEntityId ? `?poId=${notification.relatedEntityId}` : "";
    return {
      subject: `Procurement Update — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/procurement${poParam}`,
      actionText: "View Purchase Order",
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

  if (type === "CRM_CONTACT_REASSIGNED") {
    return {
      subject: `${notification.title} — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/crm?tab=contacts&ownerFilter=me`,
      actionText: "View in CRM",
    };
  }

  // Task #723: surface deep links for the new opportunity / project owner
  // reassignment notifications so the email "View" button takes the new
  // owner straight to the record (or the filtered list when the immediate
  // first-in-window notification is itself a coalesced summary).
  if (type === "CRM_OPPORTUNITY_REASSIGNED") {
    return {
      subject: `${notification.title} — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/crm?tab=opportunities&opportunityId=${notification.relatedEntityId}`
        : `${baseUrl}/crm?tab=opportunities&assignedFilter=me`,
      actionText: "View Opportunity",
    };
  }

  if (type === "PROJECT_REASSIGNED") {
    return {
      subject: `${notification.title} — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/projects/${notification.relatedEntityId}`
        : `${baseUrl}/projects`,
      actionText: "View Project",
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

  if (type === "DOCUMENT_REVISION_CREATED") {
    let actionUrl = `${baseUrl}/projects`;
    if (notification.relatedEntityType === "drawingRevision" && notification.relatedEntityId) {
      const parts = notification.relatedEntityId.split(":");
      if (parts.length === 2) {
        actionUrl = `${baseUrl}/projects/${parts[0]}?tab=plans&documentId=${parts[1]}`;
      } else {
        actionUrl = `${baseUrl}/projects/${notification.relatedEntityId}`;
      }
    }
    return {
      subject: `New Drawing Revision — SmartManageAI`,
      body: notification.message,
      actionUrl,
      actionText: "View in Plans",
    };
  }

  if (type === "BID_SUBMITTED") {
    return {
      subject: `Bid Submitted — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/bids/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Bid",
    };
  }

  if (type === "BID_STATUS_CHANGED") {
    return {
      subject: `Bid Status Changed — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/bids/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Bid",
    };
  }

  if (type === "BID_ASSIGNED") {
    return {
      subject: `Bid Assignment — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/bids/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Bid",
    };
  }

  if (type === "BID_DUE_DATE_APPROACHING") {
    return {
      subject: `Bid Due Date Approaching — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/bids/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Bid",
    };
  }

  if (type === "BUDGET_ALERT") {
    return {
      subject: `Budget Alert — SmartManageAI`,
      body: notification.message,
      actionUrl: notification.relatedEntityId
        ? `${baseUrl}/projects/${notification.relatedEntityId}`
        : undefined,
      actionText: "View Project Budget",
    };
  }

  // Task #1353: Davis-Bacon auto-sync failure email. Owners that aren't
  // actively in the app may miss the in-app banner from Task #1332 for
  // hours, so we surface the failure via the standard email delivery
  // pipeline as well. Deep-links to the integrations page so the owner can
  // re-check credentials or trigger a manual retry.
  if (type === "DAVIS_BACON_AUTO_SYNC_FAILED") {
    const actionUrl = `${baseUrl}/integrations?provider=dol_davis_bacon`;
    const subject = `Davis-Bacon auto-sync failed — SmartManageAI`;
    const actionText = "Open Integrations";
    const messageHtml = escapeHtml(notification.message).replace(/\n/g, "<br>");

    // Task #1361 — One-click mute footer link, modeled after the SWPPP
    // overdue mute (Task #1287). The signed token is bound to the
    // recipient's userId so the endpoint can only mute *their* Davis-Bacon
    // failure preferences (no cross-tenant abuse). A plain settings deep
    // link is included as a transparent fallback.
    const muteUrl = baseUrl ? buildDavisBaconMuteUrl(baseUrl, notification.userId) : "";
    const settingsUrl = `${baseUrl}/settings/notifications#section-davis-bacon-auto-sync-failed-prefs`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #b91c1c;">${escapeHtml(notification.title)}</h2>
        <p style="color: #444; line-height: 1.6;">${messageHtml}</p>
        <p style="margin-top: 20px;">
          <a href="${actionUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            ${escapeHtml(actionText)}
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; line-height: 1.6;">
          You are receiving this because you own the Davis-Bacon integration connection for your organization.
          ${muteUrl ? `<br><a href="${muteUrl}" style="color: #0070f3; text-decoration: underline;" data-testid="link-mute-davis-bacon-auto-sync-failed">Mute Davis-Bacon auto-sync failure alerts (email + in-app)</a> &middot; ` : ""}<a href="${settingsUrl}" style="color: #999; text-decoration: underline;">Manage notification settings</a>
        </p>
      </div>
    `;
    return {
      subject,
      body: notification.message,
      actionUrl,
      actionText,
      html,
    };
  }

  // Task #1404: admin heads-up the first time an integration sync row
  // exhausts MAX_SYNC_RETRIES. Renders a "mute alerts for this
  // integration" footer link (signed JWT bound to the recipient's
  // userId + connectionId + entityType) so an admin can silence the
  // noise for a chronically broken connection while they investigate,
  // instead of every distinct entity exhaustion paging the whole admin
  // group.
  if (type === "INTEGRATION_SYNC_RETRIES_EXHAUSTED") {
    // Task #1414 — Deep-link directly to the affected row in the
    // "Integration sync retries" panel using the syncStateId stored on
    // the notification's relatedEntityId. The panel renders a stable
    // anchor `id="sync-retry-<id>"` per row that scrolls into view +
    // briefly highlights on hash navigation. Falls back to the panel
    // section anchor when no relatedEntityId is present (defensive).
    const rowAnchor =
      notification.relatedEntityType === "INTEGRATION_SYNC_STATE" && notification.relatedEntityId
        ? `sync-retry-${notification.relatedEntityId}`
        : "section-sync-retries";
    const actionUrl = `${baseUrl}/integrations#${rowAnchor}`;
    const subject = `Integration sync gave up — SmartManageAI`;
    const actionText = "Open Integration Sync Retry";
    const messageHtml = escapeHtml(notification.message).replace(/\n/g, "<br>");

    const ctx = extras.integrationSyncContext;
    const entityMuteUrl =
      baseUrl && ctx
        ? buildIntegrationSyncMuteUrl(baseUrl, notification.userId, ctx.connectionId, ctx.entityType)
        : "";
    const connectionMuteUrl =
      baseUrl && ctx
        ? buildIntegrationSyncMuteUrl(baseUrl, notification.userId, ctx.connectionId, null)
        : "";
    const settingsUrl = `${baseUrl}/integrations#section-sync-retries`;
    // Task #1414 — deep link to the per-admin opt-out toggle for this
    // email channel, so the recipient can silence just the email
    // without disabling the in-app bell.
    const emailPrefsUrl = `${baseUrl}/settings/notifications#section-integration-sync-exhausted-email-prefs`;
    const labelHtml = ctx ? escapeHtml(ctx.integrationLabel) : "this integration";
    const entityHtml = ctx ? escapeHtml(ctx.entityType) : "";

    const muteFooterHtml = ctx
      ? `<br>
          <a href="${entityMuteUrl}" style="color: #0070f3; text-decoration: underline;" data-testid="link-mute-integration-sync-entity">
            Mute alerts for ${labelHtml}${entityHtml ? ` (${entityHtml})` : ""}
          </a>
          &middot;
          <a href="${connectionMuteUrl}" style="color: #0070f3; text-decoration: underline;" data-testid="link-mute-integration-sync-connection">
            Mute all alerts for ${labelHtml}
          </a> &middot; `
      : "";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #b91c1c;">${escapeHtml(notification.title)}</h2>
        <p style="color: #444; line-height: 1.6;">${messageHtml}</p>
        <p style="margin-top: 20px;">
          <a href="${actionUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            ${escapeHtml(actionText)}
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; line-height: 1.6;">
          You are receiving this because you are an administrator for your organization.${muteFooterHtml}<a href="${settingsUrl}" style="color: #999; text-decoration: underline;">Review sync retries</a> &middot; <a href="${emailPrefsUrl}" style="color: #999; text-decoration: underline;" data-testid="link-integration-sync-exhausted-email-prefs">Manage email preferences</a>
        </p>
      </div>
    `;
    return {
      subject,
      body: notification.message,
      actionUrl,
      actionText,
      html,
    };
  }

  // Task #1344: daily reminder when a project's Davis-Bacon wage decision
  // has been missing for >24h. Deep links to /integrations (so admins can
  // verify the connection / re-run the import) and /payroll (so they can
  // pick the project and retry the per-decision sync inline).
  if (type === "WAGE_DECISION_MISSING_REMINDER") {
    const integrationsUrl = `${baseUrl}/integrations?provider=dol_davis_bacon`;
    const payrollUrl = `${baseUrl}/payroll`;
    const subject = `Wage decision still missing — SmartManageAI`;
    const messageHtml = escapeHtml(notification.message).replace(/\n/g, "<br>");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #b91c1c;">${escapeHtml(notification.title)}</h2>
        <p style="color: #444; line-height: 1.6;">${messageHtml}</p>
        <p style="margin-top: 20px;">
          <a href="${integrationsUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-right: 8px;" data-testid="link-wage-decision-reminder-integrations">
            Open Integrations
          </a>
          <a href="${payrollUrl}" style="background-color: #ffffff; color: #0070f3; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; border: 1px solid #0070f3;" data-testid="link-wage-decision-reminder-payroll">
            Open Payroll
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; line-height: 1.6;">
          You are receiving this because you are an administrator for your organization.
          You will receive at most one reminder per project per week until the wage
          decision is imported.
        </p>
      </div>
    `;
    return {
      subject,
      body: notification.message,
      actionUrl: integrationsUrl,
      actionText: "Open Integrations",
      html,
    };
  }

  // Task #1400 — when the daily stale-refresh sweep replaces a cached
  // wage determination with one whose rates have changed, PMs and org
  // admins receive this email per affected project. Deep-links to the
  // project's prevailing wage panel (the project detail page already
  // surfaces the Davis-Bacon classification table for the project's
  // wage decision) so they can review and reissue certified payrolls.
  if (type === "WAGE_DECISION_RATES_CHANGED") {
    const projectUrl = notification.relatedEntityId
      ? `${baseUrl}/projects/${notification.relatedEntityId}`
      : `${baseUrl}/payroll`;
    const subject = `Davis-Bacon wage rates changed — SmartManageAI`;
    const messageHtml = escapeHtml(notification.message).replace(/\n/g, "<br>");

    // Task #1408 — One-click mute footer link, modeled after the Davis-
    // Bacon auto-sync failure mute (Task #1361). The signed token is
    // bound to the recipient's userId so the endpoint can only mute
    // *their* WAGE_DECISION_RATES_CHANGED preferences (no cross-tenant
    // abuse). A plain settings deep link is included as a transparent
    // fallback.
    const muteUrl = baseUrl
      ? buildWageDecisionRatesChangedMuteUrl(baseUrl, notification.userId)
      : "";
    const settingsUrl = `${baseUrl}/settings/notifications#section-wage-decision-rates-changed-prefs`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #b91c1c;">${escapeHtml(notification.title)}</h2>
        <p style="color: #444; line-height: 1.6;">${messageHtml}</p>
        <p style="margin-top: 20px;">
          <a href="${projectUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;" data-testid="link-wage-rate-change-project">
            Open Prevailing Wage Panel
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; line-height: 1.6;">
          You are receiving this because you are listed as the project manager,
          or as an administrator for your organization. Review certified payrolls
          and pay items affected by the rate change before your next submission.
          ${muteUrl ? `<br><a href="${muteUrl}" style="color: #0070f3; text-decoration: underline;" data-testid="link-mute-wage-decision-rates-changed">Mute wage rate change alerts (email + in-app)</a> &middot; ` : ""}<a href="${settingsUrl}" style="color: #999; text-decoration: underline;">Manage notification settings</a>
        </p>
      </div>
    `;
    return {
      subject,
      body: notification.message,
      actionUrl: projectUrl,
      actionText: "Open Prevailing Wage Panel",
      html,
    };
  }

  // Task #1449 — PM-targeted email triggered when persistRateChangeRecords
  // writes new panel-flag records. Deep-links straight to the project's
  // payroll tab so the PM can review certified payrolls and re-issue
  // submissions affected by the rate change.
  if (type === "WAGE_DECISION_RATES_CHANGED_FOR_PM") {
    const payrollUrl = notification.relatedEntityId
      ? `${baseUrl}/projects/${notification.relatedEntityId}?tab=payroll`
      : `${baseUrl}/payroll`;
    const subject = `Davis-Bacon wage rates changed — review project payroll — SmartManageAI`;
    const messageHtml = escapeHtml(notification.message).replace(/\n/g, "<br>");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #b91c1c;">${escapeHtml(notification.title)}</h2>
        <p style="color: #444; line-height: 1.6;">${messageHtml}</p>
        <p style="margin-top: 20px;">
          <a href="${payrollUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;" data-testid="link-pm-rate-change-payroll">
            Open Project Payroll Tab
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; line-height: 1.6;">
          You are receiving this because you are listed as the project manager
          for a project whose Davis-Bacon wage decision just changed. Review
          certified payrolls and pay items affected by the rate change before
          your next submission.
        </p>
      </div>
    `;
    return {
      subject,
      body: notification.message,
      actionUrl: payrollUrl,
      actionText: "Open Project Payroll Tab",
      html,
    };
  }

  if (type === "CRM_TRANSCRIPT_BACKFILL_REAPED") {
    return {
      subject: `CRM transcript backfill was reaped — SmartManageAI`,
      body: notification.message,
      actionUrl: `${baseUrl}/admin/transcript-backfill`,
      actionText: "Start a new backfill",
    };
  }

  if (type === "DEADLINE_WARNING" || type === "REMINDER") {
    return {
      subject: `${notification.title} — SmartManageAI`,
      body: notification.message,
    };
  }

  if (notification.relatedEntityType && notification.relatedEntityId) {
    const entityUrlMap: Record<string, (id: string) => string> = {
      changeOrder: (id) => `${baseUrl}/change-orders/${id}`,
      CHANGE_ORDER: (id) => `${baseUrl}/change-orders/${id}`,
      PURCHASE_ORDER: (id) => `${baseUrl}/procurement?poId=${id}`,
      PURCHASE_REQUEST: (id) => `${baseUrl}/procurement?prId=${id}`,
      TM_TICKET: (id) => `${baseUrl}/tm-tickets/${id}`,
      SOV_PAY_APP: (id) => `${baseUrl}/pay-apps/${id}`,
      VENDOR_BILL: (id) => `${baseUrl}/payables/${id}`,
      HAUL_TICKET: () => `${baseUrl}/haul-tickets`,
      INSPECTOR_REPORT: () => `${baseUrl}/daily-inspector-reports`,
      MATERIAL_CERT: () => `${baseUrl}/material-certifications`,
      SURETY_BOND: () => `${baseUrl}/surety-bonds`,
      CRM_CONTACT: () => `${baseUrl}/crm?tab=contacts&ownerFilter=me`,
      bid: (id) => `${baseUrl}/bids/${id}`,
      project: (id) => `${baseUrl}/projects/${id}`,
      inspection: (id) => `${baseUrl}/inspections/${id}`,
      // Task #1637 — failure notifications for per-project scheduled
      // log emails. relatedEntityId is the project's human-readable
      // `code` so the deep-link matches the GET /api/projects/:code
      // route the project detail page already uses.
      PROJECT_LOG_EMAIL_SCHEDULE: (id) => `${baseUrl}/projects/${id}`,
      // Task #1715 — daily digest of failing scheduled log emails.
      // The digest summarises every schedule on the org's failures
      // dashboard so the deep-link points back to the dashboard
      // itself rather than any one project. relatedEntityId is the
      // digest's date string ("YYYY-MM-DD") and is unused in the URL.
      PROJECT_LOG_EMAIL_FAILURES_DIGEST: () => `${baseUrl}/admin/log-email-failures`,
    };

    const urlBuilder = entityUrlMap[notification.relatedEntityType];
    if (urlBuilder) {
      return {
        subject: `${notification.title} — SmartManageAI`,
        body: notification.message,
        actionUrl: urlBuilder(notification.relatedEntityId),
        actionText: `View ${notification.relatedEntityType.replace(/_/g, " ")}`,
      };
    }
  }

  // Generic fallback
  return {
    subject: `${notification.title} — SmartManageAI`,
    body: notification.message,
  };
}

/**
 * Task #1404 — for INTEGRATION_SYNC_RETRIES_EXHAUSTED emails we need
 * connectionId + entityType + integration label to sign the one-click
 * mute token. The notification row only stores the sync-state PK
 * (relatedEntityId), so look the rest up here. Failures are non-fatal —
 * the email still ships, just without the mute footer.
 */
async function loadIntegrationSyncContext(
  notification: NotificationRecord,
): Promise<ComposeEmailExtras["integrationSyncContext"] | undefined> {
  if (notification.type !== "INTEGRATION_SYNC_RETRIES_EXHAUSTED") return undefined;
  if (notification.relatedEntityType !== "INTEGRATION_SYNC_STATE") return undefined;
  const syncStateId = notification.relatedEntityId;
  if (!syncStateId) return undefined;
  try {
    const [row] = await db
      .select({
        connectionId: integrationSyncState.connectionId,
        entityType: integrationSyncState.entityType,
        provider: integrationConnections.provider,
        displayName: integrationConnections.displayName,
      })
      .from(integrationSyncState)
      .innerJoin(integrationConnections, eq(integrationConnections.id, integrationSyncState.connectionId))
      .where(eq(integrationSyncState.id, syncStateId))
      .limit(1);
    if (!row) return undefined;
    const integrationLabel = row.displayName?.trim() || row.provider || "integration";
    return { connectionId: row.connectionId, entityType: row.entityType, integrationLabel };
  } catch (err) {
    logError("notificationDelivery: failed to load integration sync context for mute link", {
      userId: notification.userId,
      syncStateId,
      error: String(err),
    });
    return undefined;
  }
}

async function deliverEmail(userEmail: string, notification: NotificationRecord): Promise<void> {
  try {
    const integrationSyncContext = await loadIntegrationSyncContext(notification);
    const { subject, body, actionUrl, actionText, html } = composeEmailContent(
      notification,
      integrationSyncContext ? { integrationSyncContext } : {},
    );
    if (html) {
      await sendEmail({ to: userEmail, subject, html, text: body });
    } else {
      await sendNotificationEmail(userEmail, subject, body, actionUrl, actionText);
    }
  } catch (err) {
    logError("notificationDelivery: email send failed", {
      userId: notification.userId,
      error: String(err),
    });
  }
}

function deliverSms(phone: string | null, notification: NotificationRecord): void {
  if (!phone) return;
  const baseUrl = process.env.APP_BASE_URL || "";
  const { actionUrl } = composeEmailContent(notification);
  const url = actionUrl || baseUrl || "";
  const body = url
    ? `${notification.title}: ${notification.message} ${url}`
    : `${notification.title}: ${notification.message}`;
  setImmediate(() => {
    sendSms(phone, body).catch((err) =>
      logError("notificationDelivery: SMS failed", { userId: notification.userId, error: String(err) })
    );
  });
}

async function deliverPush(userId: string, notification: NotificationRecord): Promise<void> {
  const baseUrl = process.env.APP_BASE_URL || "";
  const { actionUrl } = composeEmailContent(notification);
  const url = actionUrl || baseUrl || "/";
  await Promise.allSettled([
    sendPushToUser(userId, {
      title: notification.title,
      message: notification.message,
      url,
    }),
    sendNativePushToUser(userId, {
      title: notification.title,
      message: notification.message,
      url,
      data: {
        notificationId: notification.id,
        type: notification.type,
        relatedEntityId: notification.relatedEntityId ?? null,
        relatedEntityType: notification.relatedEntityType ?? null,
      },
    }),
  ]);
}

function deliverTeams(webhookUrl: string | null, notification: NotificationRecord): void {
  if (!webhookUrl) return;
  const baseUrl = process.env.APP_BASE_URL || "";
  const { actionUrl } = composeEmailContent(notification);
  const url = actionUrl || baseUrl || undefined;
  setImmediate(() => {
    sendTeamsMessage(webhookUrl, notification.title, notification.message, url).catch((err) =>
      logError("notificationDelivery: Teams failed", { userId: notification.userId, error: String(err) })
    );
  });
}

function deliverSlack(webhookUrl: string | null, notification: NotificationRecord): void {
  if (!webhookUrl) return;
  const baseUrl = process.env.APP_BASE_URL || "";
  const { actionUrl } = composeEmailContent(notification);
  const url = actionUrl || baseUrl || undefined;
  setImmediate(() => {
    sendSlackMessage(webhookUrl, notification.title, notification.message, url).catch((err) =>
      logError("notificationDelivery: Slack failed", { userId: notification.userId, error: String(err) })
    );
  });
}

export async function deliverNotification(notification: NotificationRecord): Promise<void> {
  try {
    const [userRow] = await db
      .select({
        email: users.email,
        phone: users.phone,
        organizationId: users.organizationId,
        // Task #1414 — per-admin opt-out for the "sync gave up" email.
        integrationSyncExhaustedEmailOptOut: users.integrationSyncExhaustedEmailOptOut,
      })
      .from(users)
      .where(eq(users.id, notification.userId))
      .limit(1);

    if (!userRow) return;

    const prefs = await loadEffectivePrefs(notification.userId, notification.type);

    let enterpriseNotifications = false;
    if (userRow.organizationId && (prefs.smsEnabled || prefs.teamsEnabled || prefs.slackEnabled)) {
      enterpriseNotifications = await hasFeature(userRow.organizationId, "ENTERPRISE_NOTIFICATIONS");
    }

    // Task #1414 — INTEGRATION_SYNC_RETRIES_EXHAUSTED is a "sync gave up"
    // admin alert that admins might miss for days. Email delivery defaults
    // ON regardless of `notificationDelivery` channel preferences (most
    // admins haven't tuned them) — admins opt out via
    // users.integration_sync_exhausted_email_opt_out. The in-app
    // notification ships through the regular path either way.
    const forceEmailForExhaustedSync =
      notification.type === "INTEGRATION_SYNC_RETRIES_EXHAUSTED" &&
      !userRow.integrationSyncExhaustedEmailOptOut &&
      !!userRow.email;

    const tasks: Promise<void>[] = [];

    if (prefs.emailEnabled || forceEmailForExhaustedSync) {
      tasks.push(deliverEmail(userRow.email, notification));
    }
    if (prefs.smsEnabled && enterpriseNotifications && isTwilioConfigured()) {
      let smsFeatureEnabled = true;
      if (userRow.organizationId) {
        smsFeatureEnabled = await isFeatureEnabled(userRow.organizationId, "SMS_NOTIFICATIONS");
      }
      if (smsFeatureEnabled) {
        const smsPhone = prefs.smsPhoneNumber || userRow.phone || null;
        deliverSms(smsPhone, notification);
      }
    }
    if (prefs.pushEnabled) {
      tasks.push(deliverPush(notification.userId, notification));
    }
    if (prefs.teamsEnabled && enterpriseNotifications) {
      deliverTeams(prefs.teamsWebhookUrl, notification);
    }
    if (prefs.slackEnabled && enterpriseNotifications) {
      deliverSlack(prefs.slackWebhookUrl, notification);
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
