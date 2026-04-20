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
import crypto from "crypto";
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

type EmailAccountRow = typeof emailAccounts.$inferSelect;

const router = Router();

function getProvidedToken(req: Request): string {
  return (
    (req.query.token as string | undefined) ||
    req.header("x-webhook-secret") ||
    ""
  );
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function hasValidSharedSecret(req: Request): boolean {
  const expected = getEmailWebhookSecret();
  if (!expected) return false;
  const provided = getProvidedToken(req);
  if (!provided) return false;
  return timingSafeEquals(provided, expected);
}

/**
 * Authorize an Outlook webhook delivery (Task #548).
 *
 * Microsoft Graph doesn't sign mailbox-change notifications, so to harden
 * against URL leaks we issue a per-subscription rotating token that lives
 * only in the notificationUrl we registered with Graph. On every delivery
 * we look that token up and confirm it belongs to a real subscription.
 *
 * Returns the matched account when authentication succeeded via a
 * per-subscription token, or `{ ok: true, account: null }` when only the
 * legacy global shared secret matched (kept for the local-testing
 * fallback and for rows that haven't been re-subscribed since the
 * migration). Logs every rejection so operators can spot misconfigs.
 */
async function authorizeOutlookRequest(
  req: Request,
): Promise<{ ok: boolean; account: EmailAccountRow | null }> {
  const provided = getProvidedToken(req);
  if (!provided) {
    logWarn("Outlook webhook rejected: missing token", { ip: req.ip });
    return { ok: false, account: null };
  }

  // Per-subscription token lookup. Match is exact on a high-entropy random
  // value, so we don't need to enumerate accounts in code.
  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(
      and(
        eq(emailAccounts.provider, "OUTLOOK"),
        eq(emailAccounts.outlookSubscriptionWebhookToken, provided),
      ),
    )
    .limit(1);
  if (account) {
    return { ok: true, account };
  }

  // Fall back to the global shared secret only when explicitly configured
  // — this preserves the documented local-testing path and supports
  // legacy subscriptions that pre-date per-subscription tokens.
  if (hasValidSharedSecret(req)) {
    return { ok: true, account: null };
  }

  logWarn("Outlook webhook rejected: token did not match any subscription", {
    ip: req.ip,
  });
  return { ok: false, account: null };
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
  // Authenticate every delivery via per-subscription token (preferred) or
  // the global shared secret (fallback). Failures are logged inside the
  // helper so operators can spot leaked URLs or misconfigurations.
  const auth = await authorizeOutlookRequest(req);

  // Subscription validation handshake. Graph POSTs ?validationToken=...
  // immediately after we create a subscription and expects a 200 echo
  // within 10s. The per-subscription token in the URL is what we just
  // wrote to the row, so authorizeOutlookRequest already verified it.
  const validationToken = req.query.validationToken as string | undefined;
  if (validationToken) {
    if (!auth.ok) {
      return res.status(401).send("unauthorized");
    }
    res.set("Content-Type", "text/plain");
    return res.status(200).send(validationToken);
  }

  if (!auth.ok) {
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
      // When authenticated via a per-subscription token, the notification
      // MUST belong to that same account. This stops a leaked URL for one
      // mailbox from being used to trigger syncs on others.
      if (auth.account && account.id !== auth.account.id) {
        logWarn("Outlook notification subscription/token mismatch", {
          subId,
          tokenAccount: auth.account.emailAddress,
          notificationAccount: account.emailAddress,
        });
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
