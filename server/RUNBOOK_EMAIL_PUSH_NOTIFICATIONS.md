# Real-Time Email Push Notifications — Operator Setup Runbook

## Overview
Task #524 added real-time push notifications for Gmail and Outlook so the
inbox sync no longer waits up to 5 minutes for the polling job to fire.
The feature only activates once the relevant environment variables are
configured. Without them, the helpers in `server/emailPushNotifications.ts`
no-op and the system falls back to background polling alone.

## Quick Start

1. Generate a shared secret: `openssl rand -hex 32`. Save it as
   `EMAIL_WEBHOOK_SECRET` in the platform secrets manager.
2. Set `APP_BASE_URL` to the app's public `https://` origin (Outlook only;
   Gmail push works without it but you'll want it for end-to-end testing).
3. **Gmail:** create a Pub/Sub topic, grant
   `gmail-api-push@system.gserviceaccount.com` the
   `roles/pubsub.publisher` role on it, and create a push subscription
   pointing at `https://<APP_BASE_URL>/api/webhooks/email/gmail?token=<secret>`.
   Save the topic name as `GMAIL_PUBSUB_TOPIC`.
4. **Outlook:** no console setup required — each connected account
   self-registers a Microsoft Graph subscription using `EMAIL_WEBHOOK_SECRET`
   and `APP_BASE_URL`.
5. Restart the app. Within ~15 minutes the background sweep registers
   watches/subscriptions for every active account.
6. Send a test email to a connected mailbox and confirm
   `Gmail/Outlook push-triggered sync completed` appears in the logs.

Detailed steps and verification follow.

## Required Environment Variables

| Variable | Required for | Purpose | Example |
| --- | --- | --- | --- |
| `GMAIL_PUBSUB_TOPIC` | Gmail push | Fully-qualified Google Cloud Pub/Sub topic that Gmail will publish history change events to. | `projects/acme-prod/topics/gmail-watch` |
| `EMAIL_WEBHOOK_SECRET` | Gmail + Outlook push | Shared secret appended as `?token=…` to the Pub/Sub push URL and the Outlook subscription `notificationUrl`. Must be at least 32 characters of high-entropy randomness. | `7f3c…` (64 hex chars) |
| `APP_BASE_URL` | Outlook push | Public **https** origin used to build the Outlook `notificationUrl`. Must be reachable from Microsoft Graph. Gmail push doesn't read this value (the push URL lives on the Pub/Sub subscription), but you should still set it for verification and so the same secret rotation procedure works for both providers. | `https://app.example.com` |

Behavioral guards (see `isGmailPushConfigured` / `isOutlookPushConfigured`
in `server/emailPushNotifications.ts`):

- Gmail push activates when **both** `GMAIL_PUBSUB_TOPIC` and
  `EMAIL_WEBHOOK_SECRET` are set. `APP_BASE_URL` is **not** required for
  Gmail because the Pub/Sub subscription already encodes the destination
  URL.
- Outlook push activates when `EMAIL_WEBHOOK_SECRET` is set **and**
  `APP_BASE_URL` resolves to an `https://` origin.

Generate the shared secret on any workstation:

```bash
openssl rand -hex 32
# copy output into EMAIL_WEBHOOK_SECRET
```

Set the values via the platform's secrets manager (do **not** commit them
to source control). After updating any of these three variables, restart
the application so the new values are picked up.

---

## Part 1 — Gmail Pub/Sub Setup

Gmail's push notification API publishes inbox change events to a
**Google Cloud Pub/Sub topic** that you own. Pub/Sub then forwards each
message to our `/api/webhooks/email/gmail` endpoint.

### 1.1 Prerequisites
- A Google Cloud project (any active billing-enabled project will do).
- The `gcloud` CLI authenticated as a project owner, or equivalent
  Console access.
- The Gmail API and the Pub/Sub API enabled on the project:

  ```bash
  gcloud services enable gmail.googleapis.com pubsub.googleapis.com \
    --project=YOUR_PROJECT_ID
  ```

### 1.2 Create the Pub/Sub topic

```bash
gcloud pubsub topics create gmail-watch --project=YOUR_PROJECT_ID
```

Record the fully-qualified name — this is the value for
`GMAIL_PUBSUB_TOPIC`:

```
projects/YOUR_PROJECT_ID/topics/gmail-watch
```

### 1.3 Grant Gmail permission to publish to the topic

Gmail publishes as the service account
`gmail-api-push@system.gserviceaccount.com`. Without this binding the
`users.watch` call from `ensureGmailWatch` returns a 403:

```bash
gcloud pubsub topics add-iam-policy-binding gmail-watch \
  --project=YOUR_PROJECT_ID \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

### 1.4 Create a push subscription pointing at our webhook

Pub/Sub will POST every message to the URL below. The `?token=…` query
string is checked by `isAuthorized` in `server/emailWebhookRoutes.ts`.

```bash
gcloud pubsub subscriptions create gmail-watch-push \
  --project=YOUR_PROJECT_ID \
  --topic=gmail-watch \
  --push-endpoint="https://app.example.com/api/webhooks/email/gmail?token=YOUR_EMAIL_WEBHOOK_SECRET" \
  --ack-deadline=10 \
  --message-retention-duration=1h
```

Notes:
- Use the exact `EMAIL_WEBHOOK_SECRET` value, URL-encoded if it contains
  special characters.
- A short ack deadline (10s) and a 1-hour retention window keep retries
  from piling up if the app is briefly down — the 5-minute polling
  fallback will recover anything missed.
- You do **not** need to attach a Pub/Sub OIDC service account to the
  subscription; our endpoint authenticates on the shared secret only.

### 1.5 Verify the watch registers

1. Set `GMAIL_PUBSUB_TOPIC`, `EMAIL_WEBHOOK_SECRET`, and `APP_BASE_URL`
   in the application environment and restart.
2. Open the app and reconnect (or save) any Gmail account.
3. Within ~15 minutes the background job
   (`ensureAllEmailPushSubscriptions`) registers a watch and writes
   `gmailWatchExpiration` / `gmailWatchHistoryId` on the
   `email_accounts` row. To force it sooner, restart the workflow.
4. Send a test email to the connected mailbox. You should see
   `Gmail push-triggered sync completed` in the application logs within
   a few seconds.

---

## Part 2 — Outlook (Microsoft Graph) Setup

Outlook does **not** require any subscription that you create by hand.
Each connected Outlook account auto-registers its own Microsoft Graph
subscription via `ensureOutlookSubscription`, using the access token
captured during OAuth. Operators only need to supply the two
environment values that let our app build the callback URL.

### 2.1 Prerequisites
- The Microsoft / Outlook OAuth integration is already configured
  (existing `MICROSOFT_CLIENT_ID` / secret used by the email connect
  flow).
- The connected app registration includes the
  `Mail.Read` and `Mail.ReadWrite` delegated scopes that the existing
  email connect flow already requests.

### 2.2 Set the env vars

```
EMAIL_WEBHOOK_SECRET=<same value used by Gmail>
APP_BASE_URL=https://app.example.com
```

`APP_BASE_URL` **must**:
- Use `https://` (Microsoft Graph rejects plain http endpoints).
- Be publicly reachable from Microsoft's data centers — local-only
  hostnames or self-signed certs will fail the validation handshake.
- Match the public domain users see; the value is read by
  `getCanonicalBaseUrl()` and combined with the webhook path to
  produce the `notificationUrl`.

Restart the application after updating these.

### 2.3 Verify the subscription is created

1. Reconnect (or save) any Outlook account in the app.
2. Within ~15 minutes the sweep job calls
   `POST https://graph.microsoft.com/v1.0/subscriptions`. Microsoft Graph
   immediately performs a **validation handshake**:
   `POST https://app.example.com/api/webhooks/email/outlook?token=…&validationToken=…`
   Our handler responds 200 with the `validationToken` echoed back as
   `text/plain`.
3. On success the `email_accounts` row is updated with
   `outlookSubscriptionId`, `outlookSubscriptionExpiration` (~70h out),
   a fresh random `outlookSubscriptionClientState`, and a fresh random
   `outlookSubscriptionWebhookToken` (per-subscription rotating token
   embedded in the `notificationUrl?token=…`, Task #548). Each
   notification is now authenticated against this per-subscription
   token in addition to `clientState`, so leaking one subscription's
   URL only exposes that single mailbox and the token rotates whenever
   the subscription is recreated. The handler still accepts the global
   `EMAIL_WEBHOOK_SECRET` as a fallback for legacy rows that haven't
   been re-subscribed yet and for the local-testing handshake below.
4. Send a test email. You should see
   `Outlook push-triggered sync completed` in the logs within seconds.

The background job renews each subscription before it expires
(`OUTLOOK_RENEWAL_BUFFER_MS = 12h`); manual intervention is not needed.

---

## Part 3 — Resend Bounce/Complaint Webhook (Task #858)

Outbound transactional email is sent via Resend (status-page subscriber
notifications, etc.). When a recipient address is invalid, full, or marks
the message as spam, Resend reports it via a webhook. Our
`/api/webhooks/email/resend` endpoint records each event in
`status_subscriber_email_events` so the admin **Subscribers** tab can
badge bad addresses and surface bounce reasons inline.

### 3.1 Choose an authentication mode

The endpoint accepts **either** of two auth modes — pick one:

1. **Svix-style signed headers (recommended).** Resend signs every
   delivery with `svix-id`, `svix-timestamp`, `svix-signature`. We
   verify the HMAC-SHA256 against the raw request body and reject
   deliveries with a timestamp skew greater than 5 minutes. Configure
   by setting:

   ```
   RESEND_WEBHOOK_SIGNING_SECRET=whsec_********************************
   ```

   Use the value Resend shows in the dashboard exactly as displayed
   (the leading `whsec_` is stripped server-side before
   base64-decoding).

2. **Shared secret in the URL.** Append `?token=<secret>` to the
   webhook URL and configure the same value as
   `RESEND_WEBHOOK_SECRET`. The endpoint also accepts the legacy
   `EMAIL_WEBHOOK_SECRET` for parity with the Gmail/Outlook handlers,
   but a Resend-specific secret is preferred so it can be rotated
   without disturbing the inbox push subscriptions.

If both are configured the endpoint will accept whichever proof the
incoming request presents.

> **Boot-time guard (Task #879).** On startup the server checks for
> `RESEND_WEBHOOK_SIGNING_SECRET` and emits a prominent log line if it
> is not set:
>
> - **WARN** — signing secret missing but a shared-secret fallback is
>   configured. Deliveries are still authenticated via `?token=`, but
>   payload integrity is not cryptographically verified.
> - **ERROR** — *neither* secret is configured. Every Resend delivery
>   will be rejected with `401 unauthorized` and bounces/complaints
>   will silently stop being recorded until a secret is provided.
>
> If you see either line in startup logs, set the appropriate secret
> in the platform secrets manager and restart the app. Additionally,
> any incoming delivery that carries `svix-*` headers while the
> signing secret is missing logs a per-request WARN so the
> misconfiguration shows up in production traffic too.

> **Webhook secrets audit (Task #883).** The Resend boot guard above is
> one entry in a single startup audit
> (`server/webhookSecretsAudit.ts`, wired into `registerRoutes`) that
> inventories every webhook signing/shared secret the app depends on
> and emits one `[webhook-secrets-audit] …` log line per missing
> secret. Today it covers:
>
> | Env var | Severity when missing | Impact |
> | --- | --- | --- |
> | `RESEND_WEBHOOK_SIGNING_SECRET` | WARN if a shared-secret fallback is set, ERROR otherwise | See guard above. |
> | `EMAIL_WEBHOOK_SECRET` | WARN | Gmail Pub/Sub push and Outlook subscription push are disabled; the system falls back to background polling alone. |
> | `GMAIL_PUBSUB_AUDIENCE` (only when `GMAIL_PUBSUB_TOPIC` is set) | WARN | Gmail Pub/Sub deliveries are authenticated only by the shared-secret URL token, so a leaked URL is enough to forge pushes. |
>
> Outlook subscription deliveries are additionally authorised by
> per-subscription rotating tokens stored in the `email_accounts`
> table (Task #548), which are not env-configured and therefore not
> part of the boot audit.
>
> When you add a new third-party webhook integration, add its required
> signing/shared secret to `collectWebhookSecretFindings` in
> `server/webhookSecretsAudit.ts` so the next missing-secret incident
> surfaces in startup logs instead of in user-visible breakage.

### 3.2 Create the webhook in the Resend dashboard

1. Sign in to <https://resend.com> and open **Webhooks** in the side
   nav.
2. Click **Add Webhook**.
3. **Endpoint URL:**

   - Signed-headers mode: `https://<APP_BASE_URL>/api/webhooks/email/resend`
   - Shared-secret mode: `https://<APP_BASE_URL>/api/webhooks/email/resend?token=<RESEND_WEBHOOK_SECRET>`

   `<APP_BASE_URL>` is the production host (no trailing slash). Do not
   include the `https://` prefix twice.
4. **Events to enable** — at minimum, tick the bounce and complaint
   families that the handler classifies (see
   `RESEND_BOUNCE_TYPES` / `RESEND_COMPLAINT_TYPES` in
   `server/emailWebhookRoutes.ts`):

   - `email.bounced`
   - `email.delivery_delayed`
   - `email.failed`
   - `email.complained`

   Other event types (e.g. `email.delivered`, `email.opened`) are
   ignored by the handler — enabling them is harmless but adds noise
   to the Resend delivery logs.
5. Click **Add**. Resend reveals the **Signing Secret** once; copy it
   immediately and store it as `RESEND_WEBHOOK_SIGNING_SECRET` in the
   platform secrets manager. Restart the application so the new value
   is picked up.

### 3.3 Verify the webhook

1. In Resend's webhook detail page, use **Send test event** (Resend
   offers a sample `email.bounced` payload).
2. The endpoint must respond `202 Accepted` with `{ ok: true,
   accepted: 1 }`. A 401 means the signing-secret HMAC failed or the
   `?token=` value doesn't match — recheck step 3.1.
3. In the database, confirm the event was recorded:

   ```sql
   SELECT email, event_type, provider, reason, received_at
   FROM status_subscriber_email_events
   ORDER BY received_at DESC
   LIMIT 5;
   ```

   You should see a `provider = 'resend'` row matching the test event.
4. Open the admin **Status Page → Subscribers** tab. Any subscriber
   whose address matches the test event's `to` field should now show
   the bounce/complaint badge.

### 3.4 Troubleshooting Resend deliveries

- **401 on every delivery, signed-headers mode:** the `whsec_…` value
  was copied with extra whitespace, or the body is being re-serialised
  by a proxy. We HMAC the raw request bytes captured by
  `express.json({ verify: rawBodySaver })` — any middleware that
  rewrites the body before it reaches the handler will break the
  signature. Check that no compression/transformation is configured in
  front of `/api/webhooks/email/resend`.
- **401 on every delivery, shared-secret mode:** URL-encode the secret
  if it contains characters Resend's URL parser may strip (`#`, `&`,
  `?`). Easiest fix: regenerate with `openssl rand -hex 32` and update
  both the dashboard URL and `RESEND_WEBHOOK_SECRET`.
- **`status_subscriber_email_events` rows never appear** even though
  the dashboard shows 202 responses: the event type is one we don't
  classify (e.g. `email.opened`). Confirm the test event is one of the
  bounce/complaint families listed in step 3.2.
- **Replay-style deliveries from old timestamps fail with 401:** Svix
  retries can stall; we reject deliveries older than 5 minutes to
  mitigate replay. Trigger a fresh test event from the dashboard
  rather than re-running an old one.

---

## Verifying End-to-End

Quick smoke test once both providers are configured:

```bash
# 1. Confirm env vars are loaded.
curl -sS "$APP_BASE_URL/api/health" >/dev/null

# 2. Hit the Gmail webhook unauthenticated — expect 401.
curl -i -X POST "$APP_BASE_URL/api/webhooks/email/gmail"
# HTTP/1.1 401 Unauthorized

# 3. Hit the Outlook validation handshake with the secret — expect the
#    token echoed back as text/plain.
curl -i -X POST \
  "$APP_BASE_URL/api/webhooks/email/outlook?token=$EMAIL_WEBHOOK_SECRET&validationToken=hello"
# HTTP/1.1 200 OK
# Content-Type: text/plain
# hello
```

In the database:

```sql
SELECT email_address,
       provider,
       gmail_watch_expiration,
       outlook_subscription_id,
       outlook_subscription_expiration
FROM email_accounts
WHERE is_active = true
ORDER BY provider, email_address;
```

Healthy rows have a future `gmail_watch_expiration` (Gmail) or
`outlook_subscription_expiration` (Outlook).

---

## Troubleshooting

### Webhook returns 401 to provider deliveries
**Cause:** The `?token=…` query string on the push subscription /
notification URL doesn't match `EMAIL_WEBHOOK_SECRET` in the app
environment. `isAuthorized` in `server/emailWebhookRoutes.ts` rejects
the request.

**Fix:**
1. Confirm both sides hold the *same* secret (rotate via the platform
   secrets manager if unsure).
2. For Gmail, recreate the push subscription with the corrected URL —
   `gcloud` does not let you mutate `--push-endpoint` in place on older
   SDK versions:
   ```bash
   gcloud pubsub subscriptions delete gmail-watch-push --project=YOUR_PROJECT_ID
   gcloud pubsub subscriptions create gmail-watch-push --topic=gmail-watch \
     --push-endpoint="https://app.example.com/api/webhooks/email/gmail?token=NEW_SECRET" \
     --project=YOUR_PROJECT_ID
   ```
3. For Outlook, set the new secret, restart the app, and let the next
   sweep recreate the subscription (the renewal PATCH will fail and the
   helper falls back to creating a fresh subscription).

### Outlook subscription validation handshake fails
**Symptoms:** Logs show `Failed to create Outlook subscription` with
`Subscription validation request failed` from Microsoft Graph.

**Common causes & fixes:**
- `APP_BASE_URL` is `http://` or a non-public hostname → set to a real
  public https origin.
- Reverse proxy strips the `?token=…` query string before it reaches
  the app → check the proxy config; the validation request comes from
  Microsoft IP space.
- Endpoint takes longer than 10 seconds to respond (cold start, slow
  startup probe) → keep at least one warm instance running, or scale
  the deployment minimum to 1.
- TLS certificate is self-signed or expired → use a valid public CA cert.

### Gmail push works but stops after a few days
**Cause:** Gmail watches expire after at most 7 days. The renewal job
should catch this when fewer than 24h remain (`GMAIL_RENEWAL_BUFFER_MS`).

**Fix:**
1. Check the background job is running on its schedule.
2. Check the application logs for `Failed to register Gmail watch`.
3. Confirm the `gmail-api-push@system.gserviceaccount.com` IAM binding
   on the Pub/Sub topic still exists (it can be removed if someone
   re-imports the topic from Terraform without the binding).
4. Re-running the app forces an immediate sweep, which renews any
   account whose `gmailWatchExpiration` is inside the buffer.

### Outlook subscription disappears or returns 404 on renewal
**Cause:** Microsoft Graph garbage-collects subscriptions whose
notification endpoint has been unreachable for an extended period.

**Fix:** No manual action needed — `ensureOutlookSubscription` detects
the failed PATCH and recreates the subscription on the next sweep. If
recreation also fails, work through the validation-handshake checklist
above.

### Account stuck at `NEEDS_RECONNECT`
Push helpers skip accounts in this state. The user must reconnect via
the email settings UI; the next sweep then registers a fresh
watch / subscription.

### Pub/Sub messages pile up in the subscription backlog
**Cause:** The webhook is returning non-2xx (look for 401 or 5xx in
both the app logs and the Pub/Sub subscription metrics in Google Cloud
Console).

**Fix:** Resolve the underlying webhook error (auth, deploy down, etc).
The handler always responds quickly (`res.status(204).end()` *before*
running the sync), so backlogs are nearly always an authentication or
network problem rather than slow processing.

---

## Disabling Push (Reverting to Polling Only)

To turn the feature off without re-deploying code:

1. Unset `GMAIL_PUBSUB_TOPIC` and/or `EMAIL_WEBHOOK_SECRET` in the
   platform secrets manager.
2. Restart the app. The `isGmailPushConfigured` /
   `isOutlookPushConfigured` guards now return false, so no new
   watches or subscriptions are created.
3. Existing Gmail watches expire on their own within 7 days. Existing
   Outlook subscriptions expire within ~70 hours. To clean up sooner,
   call `stopGmailWatch` / `deleteOutlookSubscription` from a one-off
   script, or simply revoke the OAuth tokens.
4. Optionally delete the Pub/Sub subscription so Google stops accruing
   message-storage charges:
   ```bash
   gcloud pubsub subscriptions delete gmail-watch-push --project=YOUR_PROJECT_ID
   ```

The 5-minute polling job continues to run and keeps inboxes in sync —
the only user-visible change is the higher latency on new messages.

---

## Related Files
- `server/emailPushNotifications.ts` — env vars, watch/subscription
  helpers, sweep job.
- `server/emailWebhookRoutes.ts` — webhook contract (auth check,
  Pub/Sub payload parsing, Graph validation handshake).
- `server/utils/routeHelpers.ts` — `getCanonicalBaseUrl()` used to
  build the Outlook `notificationUrl`.
- `server/csrf.ts` — exempts `/api/webhooks/email/*` from CSRF.
