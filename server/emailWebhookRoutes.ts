/**
 * Webhook endpoints for real-time email push notifications (Task #524).
 *
 * Mounted under /api/webhooks/email — that prefix is CSRF-exempt
 * (see server/csrf.ts).
 *
 *   POST /api/webhooks/email/gmail    — Pub/Sub push from a Gmail watch
 *   POST /api/webhooks/email/outlook  — Microsoft Graph subscription
 *                                       (responds to validationToken handshake
 *                                       and incoming change notifications)
 *
 * Both endpoints require ?token=<EMAIL_WEBHOOK_SECRET> so that random
 * traffic can't trigger syncs. Notifications are acknowledged immediately
 * (the providers retry aggressively on slow responses) and the actual
 * incremental sync runs on the next tick.
 */

import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { emailAccounts } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { syncGmailAccount, syncOutlookAccount } from "./emailRoutes";
import { getEmailWebhookSecret } from "./emailPushNotifications";
import {
  isGmailPubsubJwtVerificationEnabled,
  verifyGmailPubsubJwt,
} from "./gmailPubsubAuth";
import { logInfo, logWarn, logError } from "./utils/logger";

const router = Router();

function hasValidSharedSecret(req: Request): boolean {
  const expected = getEmailWebhookSecret();
  if (!expected) return false;
  const provided =
    (req.query.token as string | undefined) ||
    (req.header("x-webhook-secret") || "");
  return provided === expected;
}

function isAuthorized(req: Request): boolean {
  return hasValidSharedSecret(req);
}

/**
 * Authorize a Gmail Pub/Sub push delivery. When GMAIL_PUBSUB_AUDIENCE is
 * configured we require a valid OIDC bearer JWT signed by Google — that
 * proves the request really came from Pub/Sub and not from someone who
 * exfiltrated the webhook URL with its shared secret. When the audience
 * env var is unset we fall back to the shared-secret-only flow, which is
 * the documented local-testing path.
 */
async function isGmailPushAuthorized(req: Request): Promise<boolean> {
  if (isGmailPubsubJwtVerificationEnabled()) {
    const result = await verifyGmailPubsubJwt(req.header("authorization"));
    if (!result.ok) {
      logWarn("Gmail Pub/Sub JWT verification failed", {
        reason: result.reason,
        ip: req.ip,
      });
      return false;
    }
    // Require the shared secret too when present, as defence in depth — but
    // the shared secret is optional once JWT verification is enabled.
    const expected = getEmailWebhookSecret();
    if (expected && !hasValidSharedSecret(req)) {
      logWarn("Gmail webhook rejected: JWT ok but shared secret missing/invalid", {
        ip: req.ip,
      });
      return false;
    }
    return true;
  }
  return hasValidSharedSecret(req);
}

// ---------------------------------------------------------------------------
// Gmail Pub/Sub push handler
// ---------------------------------------------------------------------------
//
// Pub/Sub delivers a body shaped like:
//   { message: { data: <base64>, messageId, publishTime, ... },
//     subscription: "projects/.../subscriptions/..." }
// The base64 message data decodes to JSON:
//   { emailAddress: "user@gmail.com", historyId: 1234567890 }
router.post("/gmail", async (req: Request, res: Response) => {
  if (!(await isGmailPushAuthorized(req))) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const message = req.body?.message;
  if (!message?.data) {
    // Always 2xx so Pub/Sub doesn't retry malformed deliveries forever.
    return res.status(204).end();
  }

  let emailAddress: string | null = null;
  try {
    const decoded = Buffer.from(message.data, "base64").toString("utf-8");
    const payload = JSON.parse(decoded);
    if (typeof payload?.emailAddress === "string") {
      emailAddress = payload.emailAddress.toLowerCase();
    }
  } catch (err) {
    logWarn("Gmail push payload could not be parsed", { error: String(err) });
  }

  // Acknowledge immediately. Pub/Sub treats slow ACKs as failures.
  res.status(204).end();

  if (!emailAddress) return;

  try {
    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.emailAddress, emailAddress),
          eq(emailAccounts.provider, "GMAIL"),
          eq(emailAccounts.isActive, true),
        ),
      );

    for (const account of accounts) {
      if (account.syncStatus === "NEEDS_RECONNECT") continue;
      try {
        const result = await syncGmailAccount(account, account.userId);
        if (result.messagesImported > 0) {
          logInfo("Gmail push-triggered sync completed", {
            account: account.emailAddress,
            messagesImported: result.messagesImported,
          });
        }
      } catch (err) {
        logError(
          "Gmail push-triggered sync failed",
          { account: account.emailAddress },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  } catch (err) {
    logError(
      "Gmail webhook handler failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
});

// ---------------------------------------------------------------------------
// Outlook (Microsoft Graph) subscription handler
// ---------------------------------------------------------------------------
//
// Two flows:
//   1. Subscription validation: Graph POSTs with ?validationToken=... and
//      expects a 200 response containing that token in the body within 10s.
//   2. Change notifications: body { value: [{ subscriptionId, clientState,
//      resource, changeType, ... }] }. Respond 202 quickly and process
//      asynchronously.
router.post("/outlook", async (req: Request, res: Response) => {
  // Subscription validation handshake. This must succeed before Graph will
  // accept the subscription, and it does NOT require the token query because
  // we don't have a stored secret yet — but we still require it so that an
  // attacker can't spam our webhook acting as Graph.
  const validationToken = req.query.validationToken as string | undefined;
  if (validationToken) {
    if (!isAuthorized(req)) {
      return res.status(401).send("unauthorized");
    }
    res.set("Content-Type", "text/plain");
    return res.status(200).send(validationToken);
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const notifications = req.body?.value;
  // Acknowledge immediately so Graph doesn't retry / disable the subscription.
  res.status(202).end();

  if (!Array.isArray(notifications) || notifications.length === 0) return;

  try {
    const affectedAccountIds = new Set<string>();
    for (const notification of notifications) {
      const subId = notification?.subscriptionId;
      const clientState = notification?.clientState;
      if (typeof subId !== "string" || typeof clientState !== "string") continue;

      const [account] = await db
        .select()
        .from(emailAccounts)
        .where(
          and(
            eq(emailAccounts.outlookSubscriptionId, subId),
            eq(emailAccounts.provider, "OUTLOOK"),
          ),
        )
        .limit(1);

      if (!account) {
        logWarn("Outlook notification for unknown subscription", { subId });
        continue;
      }
      if (account.outlookSubscriptionClientState !== clientState) {
        logWarn("Outlook notification clientState mismatch", {
          subId,
          account: account.emailAddress,
        });
        continue;
      }
      if (!account.isActive || account.syncStatus === "NEEDS_RECONNECT") continue;
      affectedAccountIds.add(account.id);
    }

    for (const accountId of affectedAccountIds) {
      const [account] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, accountId))
        .limit(1);
      if (!account) continue;
      try {
        const result = await syncOutlookAccount(account, account.userId);
        if (result.messagesImported > 0) {
          logInfo("Outlook push-triggered sync completed", {
            account: account.emailAddress,
            messagesImported: result.messagesImported,
          });
        }
      } catch (err) {
        logError(
          "Outlook push-triggered sync failed",
          { account: account.emailAddress },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  } catch (err) {
    logError(
      "Outlook webhook handler failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
});

export default router;
