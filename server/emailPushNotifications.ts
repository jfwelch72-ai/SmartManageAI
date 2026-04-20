/**
 * Real-time email push notifications (Task #524)
 *
 * Manages provider-side subscriptions that let Gmail and Outlook deliver
 * mailbox change events to our webhook endpoints. These eliminate the
 * up-to-2-minute polling latency from Task #522 — incoming mail triggers an
 * immediate incremental sync. Background polling continues at a slower
 * cadence as a safety net for missed pushes and unsubscribed accounts.
 *
 * Configuration (env vars):
 *   GMAIL_PUBSUB_TOPIC           e.g. projects/your-project/topics/gmail-watch
 *   EMAIL_WEBHOOK_SECRET         shared secret added to Pub/Sub push URL and
 *                                Outlook subscription notificationUrl
 *   APP_BASE_URL                 public https origin used to build webhook URLs
 *   GMAIL_PUBSUB_AUDIENCE        OIDC audience configured on the Pub/Sub push
 *                                subscription. When set, the Gmail webhook
 *                                additionally verifies Google's signed JWT in
 *                                the Authorization header (see
 *                                ./gmailPubsubAuth.ts).
 *   GMAIL_PUBSUB_SERVICE_ACCOUNT optional service-account email the JWT must
 *                                be issued by (defence in depth).
 *
 * If Gmail Pub/Sub or the public webhook URL is not configured, the ensure
 * helpers no-op and the system gracefully falls back to polling alone.
 */

import crypto from "crypto";
import { db } from "./db";
import { emailAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { gmailApiFetch, outlookApiFetch } from "./emailRoutes";
import { logInfo, logWarn, logError } from "./utils/logger";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";

type EmailAccountRow = typeof emailAccounts.$inferSelect;

// Renew the Gmail watch when fewer than 24 hours remain. Watches expire
// after at most 7 days; our cron runs every 15 minutes so this leaves
// plenty of headroom.
const GMAIL_RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000;

// Outlook subscriptions for mail messages can live up to 4230 minutes
// (~70 hours). We renew when fewer than 12 hours remain.
const OUTLOOK_MAX_EXPIRATION_MINUTES = 4230;
const OUTLOOK_RENEWAL_BUFFER_MS = 12 * 60 * 60 * 1000;

export function getEmailWebhookSecret(): string {
  return process.env.EMAIL_WEBHOOK_SECRET || "";
}

export function isGmailPushConfigured(): boolean {
  return !!process.env.GMAIL_PUBSUB_TOPIC && !!getEmailWebhookSecret();
}

export function isOutlookPushConfigured(): boolean {
  if (!getEmailWebhookSecret()) return false;
  const baseUrl = getCanonicalBaseUrl();
  return /^https:\/\//i.test(baseUrl);
}

function buildOutlookNotificationUrl(): string {
  const baseUrl = getCanonicalBaseUrl().replace(/\/+$/, "");
  return `${baseUrl}/api/webhooks/email/outlook?token=${encodeURIComponent(getEmailWebhookSecret())}`;
}

/**
 * Register or renew a Gmail watch for the account. The watch tells Gmail
 * to publish history change events to our Pub/Sub topic, which Pub/Sub
 * forwards to /api/webhooks/email/gmail.
 */
export async function ensureGmailWatch(account: EmailAccountRow): Promise<void> {
  if (!isGmailPushConfigured()) return;
  if (account.provider !== "GMAIL" || !account.isActive) return;
  if (account.syncStatus === "NEEDS_RECONNECT") return;

  if (
    account.gmailWatchExpiration &&
    account.gmailWatchExpiration.getTime() - Date.now() > GMAIL_RENEWAL_BUFFER_MS
  ) {
    return;
  }

  try {
    const response = await gmailApiFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      account,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicName: process.env.GMAIL_PUBSUB_TOPIC,
          labelIds: ["INBOX", "SENT"],
          labelFilterBehavior: "INCLUDE",
        }),
      },
    );
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gmail watch failed: ${response.status} ${errText.slice(0, 300)}`);
    }
    const data = (await response.json()) as { historyId: string; expiration: string };
    await db
      .update(emailAccounts)
      .set({
        gmailWatchExpiration: new Date(Number(data.expiration)),
        gmailWatchHistoryId: data.historyId,
        // Seed the incremental cursor so the first push notification has a
        // valid baseline to diff from.
        gmailHistoryId: account.gmailHistoryId ?? data.historyId,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, account.id));
    logInfo("Gmail watch registered", {
      account: account.emailAddress,
      expiration: new Date(Number(data.expiration)).toISOString(),
    });
  } catch (err) {
    logError(
      "Failed to register Gmail watch",
      { account: account.emailAddress },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

export async function stopGmailWatch(account: EmailAccountRow): Promise<void> {
  if (account.provider !== "GMAIL") return;
  if (!account.gmailWatchExpiration && !account.gmailWatchHistoryId) return;
  try {
    const response = await gmailApiFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/stop",
      account,
      { method: "POST" },
    );
    if (!response.ok && response.status !== 404) {
      logWarn("Gmail watch stop returned non-OK", {
        account: account.emailAddress,
        status: response.status,
      });
    }
  } catch (err) {
    logError(
      "Failed to stop Gmail watch",
      { account: account.emailAddress },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
  await db
    .update(emailAccounts)
    .set({
      gmailWatchExpiration: null,
      gmailWatchHistoryId: null,
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, account.id));
}

/**
 * Create or renew the Microsoft Graph subscription for the inbox folder.
 * If a renewal PATCH fails (e.g. the subscription was garbage collected by
 * Graph), we recreate the subscription from scratch.
 */
export async function ensureOutlookSubscription(account: EmailAccountRow): Promise<void> {
  if (!isOutlookPushConfigured()) return;
  if (account.provider !== "OUTLOOK" || !account.isActive) return;
  if (account.syncStatus === "NEEDS_RECONNECT") return;

  const hasFresh =
    account.outlookSubscriptionId &&
    account.outlookSubscriptionExpiration &&
    account.outlookSubscriptionExpiration.getTime() - Date.now() > OUTLOOK_RENEWAL_BUFFER_MS;
  if (hasFresh) return;

  const newExpiration = new Date(Date.now() + OUTLOOK_MAX_EXPIRATION_MINUTES * 60 * 1000);

  // Try to renew first if we have an existing subscription that is still
  // valid (just inside the renewal buffer).
  if (
    account.outlookSubscriptionId &&
    account.outlookSubscriptionExpiration &&
    account.outlookSubscriptionExpiration.getTime() > Date.now()
  ) {
    try {
      const resp = await outlookApiFetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${account.outlookSubscriptionId}`,
        account,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expirationDateTime: newExpiration.toISOString() }),
        },
      );
      if (resp.ok) {
        await db
          .update(emailAccounts)
          .set({
            outlookSubscriptionExpiration: newExpiration,
            updatedAt: new Date(),
          })
          .where(eq(emailAccounts.id, account.id));
        logInfo("Outlook subscription renewed", {
          account: account.emailAddress,
          expiration: newExpiration.toISOString(),
        });
        return;
      }
      logWarn("Outlook subscription renew failed, will recreate", {
        account: account.emailAddress,
        status: resp.status,
      });
    } catch (err) {
      logWarn("Outlook subscription renew threw, will recreate", {
        account: account.emailAddress,
        error: String(err),
      });
    }
  }

  // Create a fresh subscription.
  const clientState = crypto.randomBytes(24).toString("hex");
  try {
    const resp = await outlookApiFetch(
      "https://graph.microsoft.com/v1.0/subscriptions",
      account,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeType: "created,updated,deleted",
          notificationUrl: buildOutlookNotificationUrl(),
          resource: "/me/mailFolders('inbox')/messages",
          expirationDateTime: newExpiration.toISOString(),
          clientState,
        }),
      },
    );
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(
        `Outlook subscription create failed: ${resp.status} ${errText.slice(0, 300)}`,
      );
    }
    const data = (await resp.json()) as { id: string; expirationDateTime: string };
    await db
      .update(emailAccounts)
      .set({
        outlookSubscriptionId: data.id,
        outlookSubscriptionExpiration: new Date(data.expirationDateTime),
        outlookSubscriptionClientState: clientState,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, account.id));
    logInfo("Outlook subscription created", {
      account: account.emailAddress,
      expiration: data.expirationDateTime,
    });
  } catch (err) {
    logError(
      "Failed to create Outlook subscription",
      { account: account.emailAddress },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

export async function deleteOutlookSubscription(account: EmailAccountRow): Promise<void> {
  if (account.provider !== "OUTLOOK" || !account.outlookSubscriptionId) return;
  try {
    const resp = await outlookApiFetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${account.outlookSubscriptionId}`,
      account,
      { method: "DELETE" },
    );
    if (!resp.ok && resp.status !== 404) {
      logWarn("Outlook subscription delete returned non-OK", {
        account: account.emailAddress,
        status: resp.status,
      });
    }
  } catch (err) {
    logError(
      "Failed to delete Outlook subscription",
      { account: account.emailAddress },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
  await db
    .update(emailAccounts)
    .set({
      outlookSubscriptionId: null,
      outlookSubscriptionExpiration: null,
      outlookSubscriptionClientState: null,
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, account.id));
}

/**
 * Sweep all active Gmail/Outlook accounts and ensure each has a current
 * push subscription. Called from the background job runner on a schedule.
 */
export async function ensureAllEmailPushSubscriptions(): Promise<void> {
  if (!isGmailPushConfigured() && !isOutlookPushConfigured()) return;

  const accounts = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.isActive, true));

  for (const account of accounts) {
    if (account.syncStatus === "NEEDS_RECONNECT") continue;
    try {
      if (account.provider === "GMAIL") {
        await ensureGmailWatch(account);
      } else if (account.provider === "OUTLOOK") {
        await ensureOutlookSubscription(account);
      }
    } catch (err) {
      logError(
        "ensureAllEmailPushSubscriptions failed for account",
        { account: account.emailAddress },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
