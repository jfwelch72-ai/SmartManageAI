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
import { and, eq, sql } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Resend bounce/complaint webhook (Task #858)
// ---------------------------------------------------------------------------
//
// Resend POSTs events shaped like:
//   { type: "email.bounced" | "email.complained" | ..., created_at, data: {
//     email_id, to: ["user@example.com"], from, subject, bounce?, ... } }
//
// Authentication: either a shared secret in `?token=` (matching
// RESEND_WEBHOOK_SECRET, falling back to the legacy EMAIL_WEBHOOK_SECRET) or
// Svix-style signed headers (`svix-id`, `svix-timestamp`, `svix-signature`)
// when RESEND_WEBHOOK_SIGNING_SECRET is configured. Bounces/complaints are
// recorded per-email in `status_subscriber_email_events` so admins can spot
// bad addresses directly in the Subscribers tab.

const RESEND_BOUNCE_TYPES = new Set([
  "email.bounced",
  "email.bounce",
  "email.failed",
  "email.delivery_delayed",
]);
const RESEND_COMPLAINT_TYPES = new Set([
  "email.complained",
  "email.complaint",
  "email.spam_reported",
]);

function getResendSharedSecret(): string {
  return (process.env.RESEND_WEBHOOK_SECRET || getEmailWebhookSecret() || "").trim();
}

function hasValidResendSharedSecret(req: Request): boolean {
  const expected = getResendSharedSecret();
  if (!expected) return false;
  const provided = getProvidedToken(req);
  if (!provided) return false;
  return timingSafeEquals(provided, expected);
}

function verifyResendSvixSignature(req: Request): boolean {
  const signingSecret = (process.env.RESEND_WEBHOOK_SIGNING_SECRET || "").trim();
  const svixId = req.header("svix-id");
  const svixTimestamp = req.header("svix-timestamp");
  const svixSignature = req.header("svix-signature");
  const looksSvixSigned = !!(svixId || svixTimestamp || svixSignature);
  if (!signingSecret) {
    // A delivery that carries Svix headers means Resend is trying to prove
    // authenticity but we have no key to check it. Log loudly so operators
    // notice the misconfiguration instead of relying on the (optional) shared
    // secret silently. We *don't* return 401 here because the route may still
    // be intentionally protected by RESEND_WEBHOOK_SECRET only — but the boot
    // warning + this per-request warning together make the gap visible.
    if (looksSvixSigned) {
      logWarn(
        "Resend webhook delivery carried Svix signature headers but RESEND_WEBHOOK_SIGNING_SECRET is not set; skipping signature verification",
        { hasSvixId: !!svixId, hasSvixSig: !!svixSignature },
      );
    }
    return false;
  }
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject deliveries with skewed timestamps (5 minute window) to mitigate replay.
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > 5 * 60) return false;

  // Svix secrets are typically prefixed with `whsec_`; strip and base64-decode.
  const rawSecret = signingSecret.startsWith("whsec_")
    ? signingSecret.slice("whsec_".length)
    : signingSecret;
  let keyBuffer: Buffer;
  try {
    keyBuffer = Buffer.from(rawSecret, "base64");
  } catch {
    return false;
  }
  // express.json() in server/index.ts captures req.rawBody as a Buffer; use the
  // exact bytes for HMAC instead of re-serialising req.body (which would lose
  // whitespace/key-order from the original payload and break the signature).
  const raw = (req as Request & { rawBody?: unknown }).rawBody;
  let rawBody: string;
  if (Buffer.isBuffer(raw)) rawBody = raw.toString("utf8");
  else if (typeof raw === "string") rawBody = raw;
  else return false; // refuse to verify against a re-serialised body
  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac("sha256", keyBuffer)
    .update(signedPayload)
    .digest("base64");

  // Header looks like "v1,base64sig v1,base64sig2" — accept any match.
  for (const part of svixSignature.split(/\s+/)) {
    const [, sig] = part.split(",", 2);
    if (sig && timingSafeEquals(sig, expectedSig)) return true;
  }
  return false;
}

function isResendAuthorized(req: Request): boolean {
  if (verifyResendSvixSignature(req)) return true;
  if (hasValidResendSharedSecret(req)) return true;
  return false;
}

// Classify the incoming Resend event into the categories we suppress on.
// We split bounces into hard vs soft so the fanout suppressor (Task #866)
// can apply different rules: any recent hard bounce or complaint is enough
// to suppress immediately, while soft bounces only suppress once they
// exceed a threshold within a short window.
function classifyResendEvent(
  rawType: unknown,
  data: any,
): "hard_bounce" | "soft_bounce" | "complaint" | null {
  if (typeof rawType !== "string") return null;
  const t = rawType.toLowerCase();
  if (RESEND_COMPLAINT_TYPES.has(t)) return "complaint";
  // delivery_delayed and email.failed are inherently transient/retryable,
  // so they are always soft regardless of any sub-type the provider includes.
  if (t === "email.delivery_delayed" || t === "email.failed") return "soft_bounce";
  if (RESEND_BOUNCE_TYPES.has(t)) {
    const b = data?.bounce;
    const bType = (
      b?.type ??
      b?.bounceType ??
      b?.subType ??
      b?.subtype ??
      data?.bounce_type ??
      ""
    )
      .toString()
      .toLowerCase();
    if (bType.includes("transient") || bType.includes("soft")) return "soft_bounce";
    // Default any unclassified bounce to hard. Resend (via SES) only forwards
    // undeliverable mail, so an unknown sub-type is far more likely to be a
    // permanent failure than a transient one.
    return "hard_bounce";
  }
  return null;
}

function extractRecipients(data: any): string[] {
  if (!data) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.includes("@")) out.push(v.toLowerCase().trim());
  };
  if (Array.isArray(data.to)) data.to.forEach(push);
  else push(data.to);
  if (Array.isArray(data.cc)) data.cc.forEach(push);
  if (Array.isArray(data.bcc)) data.bcc.forEach(push);
  push(data.email);
  return Array.from(new Set(out.filter(Boolean)));
}

function extractReason(eventType: string, data: any): string | null {
  if (!data || typeof data !== "object") return null;
  if (eventType === "bounce") {
    const b = data.bounce;
    if (b && typeof b === "object") {
      const parts = [b.type, b.subType, b.subtype, b.message, b.diagnosticCode]
        .filter((s) => typeof s === "string" && s.length > 0);
      if (parts.length > 0) return parts.join(" — ").slice(0, 500);
    }
    if (typeof data.reason === "string") return data.reason.slice(0, 500);
  }
  if (eventType === "complaint") {
    const c = data.complaint;
    if (c && typeof c === "object" && typeof c.feedbackType === "string") {
      return String(c.feedbackType).slice(0, 500);
    }
    if (typeof data.feedback_type === "string") return data.feedback_type.slice(0, 500);
  }
  return null;
}

/**
 * Boot-time check: emit a prominent warning if the Resend webhook signing
 * secret isn't configured. Without it, the route falls back to the (optional)
 * shared-secret token in the query string — and if that's also missing, we
 * would silently accept unverified payloads. Loud logging here means the
 * misconfiguration is caught at startup rather than the next time someone
 * notices bounces stopped flowing into the Subscribers tab.
 *
 * Idempotent: safe to call multiple times (e.g. from tests).
 */
let resendSecretBootWarningEmitted = false;
/** Test-only: clear the boot-warning latch so unit tests can re-trigger it. */
export function __resetResendBootWarningForTests(): void {
  resendSecretBootWarningEmitted = false;
}
export function warnIfResendWebhookSigningSecretMissing(): void {
  if (resendSecretBootWarningEmitted) return;
  const signingSecret = (process.env.RESEND_WEBHOOK_SIGNING_SECRET || "").trim();
  if (signingSecret) return;
  resendSecretBootWarningEmitted = true;
  const sharedSecret = (
    process.env.RESEND_WEBHOOK_SECRET ||
    process.env.EMAIL_WEBHOOK_SECRET ||
    ""
  ).trim();
  if (sharedSecret) {
    logWarn(
      "RESEND_WEBHOOK_SIGNING_SECRET is not set — Resend webhook deliveries will only be authenticated by the shared-secret query token (no Svix signature verification). Configure the signing secret to verify payload authenticity.",
    );
  } else {
    logError(
      "RESEND_WEBHOOK_SIGNING_SECRET is not set AND no shared-secret fallback (RESEND_WEBHOOK_SECRET / EMAIL_WEBHOOK_SECRET) is configured — Resend bounce/complaint webhook deliveries will be REJECTED until one is provided. Bounces and complaints will not be recorded.",
      {},
      new Error("Missing Resend webhook signing secret"),
    );
  }
}

router.post("/resend", async (req: Request, res: Response) => {
  if (!isResendAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Resend can deliver a single event or an array of events.
  const body = req.body;
  const events: any[] = Array.isArray(body)
    ? body
    : Array.isArray(body?.events)
      ? body.events
      : body
        ? [body]
        : [];

  // Acknowledge promptly; Resend retries on slow/failed responses.
  res.status(202).json({ ok: true, accepted: events.length });

  for (const evt of events) {
    try {
      const data = evt?.data ?? evt;
      const eventType = classifyResendEvent(evt?.type, data);
      if (!eventType) continue;
      const recipients = extractRecipients(data);
      if (recipients.length === 0) continue;
      // extractReason switches on the high-level category, so map the more
      // specific bounce sub-types back to "bounce" for that helper.
      const reasonCategory = eventType === "complaint" ? "complaint" : "bounce";
      const reason = extractReason(reasonCategory, data);
      const receivedAt = (() => {
        const raw = evt?.created_at || data?.created_at;
        if (typeof raw === "string") {
          const d = new Date(raw);
          if (!Number.isNaN(d.getTime())) return d;
        }
        return new Date();
      })();

      for (const email of recipients) {
        try {
          await db.execute(sql`
            INSERT INTO "status_subscriber_email_events"
              ("email", "event_type", "provider", "reason", "raw_event", "received_at")
            VALUES (
              ${email},
              ${eventType},
              ${"resend"},
              ${reason},
              ${sql`${JSON.stringify(evt)}::jsonb`},
              ${receivedAt}
            )
          `);
          logInfo("Recorded email provider bounce/complaint event", {
            email,
            eventType,
            provider: "resend",
          });
        } catch (err) {
          logError(
            "Failed to insert email provider event",
            { email, eventType },
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    } catch (err) {
      logError(
        "Resend webhook event processing failed",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
});

export default router;
