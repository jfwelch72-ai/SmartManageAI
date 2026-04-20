# Live Gmail / Outlook Sync Runbook

This runbook documents the manual end-to-end pass for the 2-way provider email
sync (Task #522 / #526 / #538). The automated suite at
`server/__tests__/email-sync/email-sync.test.ts` covers request shapes and the
state machine with mocks; this runbook covers what mocks cannot — real provider
behavior (Gmail history-id pagination, Microsoft Graph delta-token rotation,
throttling, scope regressions, OAuth refresh).

Run this whenever:
- The OAuth scopes, token-refresh, or sync code in `server/emailRoutes.ts`
  changes (`syncGmailAccount`, `syncOutlookAccount`, `pushGmailMessageState`,
  `pushOutlookMessageState`, `drainAccountProviderPushes`).
- The cron schedule or locking in
  `server/jobs/jobRunner.ts > processProviderEmailSync` changes.
- Before a release that touches the email feature.

Expected total time: ~30 minutes per provider.

---

## 0. Prerequisites

- A throwaway Gmail account (e.g. `crm-sync-test@gmail.com`) and a throwaway
  Outlook account (personal `outlook.com` or M365 dev tenant).
- A second mailbox you control to send test mail from (any provider is fine).
- A user in a CRM workspace with permission to connect email accounts.
- Server env vars present: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
  `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, plus the configured redirect
  URIs registered in Google Cloud Console / Azure App Registration.
- Direct database access for the `email_accounts` table (for the cursor-expiry
  step). A psql shell or the platform's DB tool is sufficient.

---

## 1. Connect the test accounts

For each provider:

1. In the CRM, open **Settings → Email Accounts → Connect**.
2. Pick the provider, complete the OAuth consent flow with the test mailbox.
3. Confirm the consent screen requests the expected scopes:
   - **Gmail**: `gmail.modify` (read, mark read/unread, archive).
   - **Outlook**: `Mail.ReadWrite`, `offline_access`, `User.Read`.
4. After redirect, verify the account row shows `syncStatus = OK` and
   `lastSyncedAt` within the last 2 minutes.
5. Confirm the initial 30-day backfill ran: the inbox should show recent
   threads from both Inbox and Sent.

**Pass criteria:** account connects, status `OK`, threads visible.

---

## 2. New mail appears in CRM (≤ 2 minutes)

1. From the second mailbox, send a uniquely-subjected message
   (`LIVE-SYNC <provider> <timestamp>`) to the test account.
2. Wait for the next `provider_sync` cron tick (runs every 2 minutes; see
   `processProviderEmailSync`).
3. In the CRM email view, confirm the message arrives within 2 minutes,
   threaded correctly, marked unread.

**Pass criteria:** message appears within 2 min, unread, in the right thread.

---

## 3. Mark read in Gmail/Outlook → CRM updates

1. Open the message directly in the Gmail or Outlook web UI; let it auto-mark
   as read (or click Mark as read).
2. Wait for the next sync tick.
3. In the CRM, refresh the thread; the message should now show as read.

**Pass criteria:** read state propagates provider → CRM within 2 min.

---

## 4. Mark read in CRM → Gmail/Outlook updates

1. Send a fresh test message (so it starts unread on both sides).
2. After it appears in CRM, click it / mark it read in CRM. This triggers
   `PATCH /api/email/messages/:id` which writes
   `pendingProviderPush` and is then drained by
   `drainAccountProviderPushes` on the next cron tick.
3. Within 2 minutes, refresh the Gmail/Outlook web UI and confirm the message
   is now marked read there too.

**Pass criteria:** CRM → provider read-state push lands within 2 min; the
`pendingProviderPush` column on the row is cleared.

---

## 5. Archive in both directions

**Provider → CRM:**
1. Send a fresh message.
2. Archive it in Gmail (remove `INBOX` label) or Outlook (move to Archive).
3. After the next sync, confirm the CRM thread shows the message in the
   Archive folder, no longer in Inbox.

**CRM → Provider:**
1. Send another fresh message.
2. In the CRM, click Archive on the message.
3. Within 2 min, confirm Gmail/Outlook shows the message archived
   (Gmail: `INBOX` label removed; Outlook: moved to `Archive`).

**Pass criteria:** archive state propagates both directions within 2 min.

---

## 6. Sent from Gmail/Outlook appears in CRM thread

1. From the test mailbox's web UI, reply to one of the existing threads.
2. After the next sync, confirm the CRM thread shows the new outgoing message
   in chronological order, attributed to the test mailbox.

**Pass criteria:** sent-folder messages get pulled into the right CRM thread.

---

## 7. Cursor-expiry / 410 recovery (run at least once per provider)

This exercises the full-resync fallback path that the mock test cannot fully
prove against the real APIs.

### Gmail (history-id 404 / 410)

1. Find the account row in `email_accounts` and clear its history cursor:
   ```sql
   UPDATE email_accounts
   SET gmail_history_id = NULL
   WHERE email_address = 'crm-sync-test@gmail.com';
   ```
   (Setting it to a stale value like `'1'` also works — Gmail returns 404 and
   `syncGmailIncremental` flips to `needsFullResync`.)
2. Wait for the next sync tick, or trigger manually via the
   "Sync now" button on the account.
3. Confirm in server logs: `Gmail history expired ... doing full resync` (or
   `Gmail incremental sync failed ... falling back to full sync`).
4. Confirm `gmail_history_id` is repopulated and `syncStatus = OK`.
5. Spot-check the inbox in the CRM is intact (no duplicated threads).

### Outlook (delta-link expiry)

1. Clear both delta cursors:
   ```sql
   UPDATE email_accounts
   SET outlook_delta_inbox = NULL, outlook_delta_sent = NULL
   WHERE email_address = '<outlook test address>';
   ```
2. Wait for next sync or trigger manually.
3. Confirm both delta links are repopulated and `syncStatus = OK`.
4. Spot-check inbox/sent in CRM look correct (no duplication, no missing
   recent threads).

**Pass criteria:** both providers recover from a cleared cursor without manual
reconnect, no duplicated messages, status returns to `OK`.

---

## 7b. Scripted archive verification (Task #545)

Section 5 verifies archive push-back through the CRM UI. For a scripted,
loggable pass — the original confidence goal of Task #537 / #545 — use:

  `scripts/email-sync-live-archive-test.ts`

It calls `PATCH /api/email/messages/:id` against a running CRM and then polls
the live Gmail / Microsoft Graph API for the same message until INBOX is gone
(or a timeout is hit). Run once per provider whenever the push-back code in
`server/emailRoutes.ts` (`drainMessageProviderPush`, `pushGmailMessageState`,
`pushOutlookMessageState`) changes meaningfully.

**Gather inputs once per provider:**

1. Connect the sandbox mailbox via Settings → Email Accounts (Section 1).
2. Send yourself a fresh message so it lands in Inbox / has the `INBOX`
   label.
3. From a DB shell, grab the CRM-side message id and the provider-side id:
   ```sql
   SELECT id, external_id, subject
   FROM email_messages
   WHERE email_account_id = '<account uuid>'
   ORDER BY received_at DESC
   LIMIT 5;
   ```
   `id` → `CRM_MESSAGE_ID`, `external_id` → `PROVIDER_MESSAGE_ID`.
4. Get an authenticated CRM cookie (browser devtools → Network → copy any
   `/api/...` request's `Cookie` header), and a CSRF token if your session
   requires it.
5. Mint a short-lived provider access token for verification:
   - **Gmail**: in OAuth Playground or via your refresh token, request scope
     `https://www.googleapis.com/auth/gmail.modify` and copy the access
     token.
   - **Outlook**: get a token with `Mail.Read` scope (the Graph Explorer
     "Access token" tab works for personal accounts; `az account get-access-token
     --resource https://graph.microsoft.com` for tenant accounts).

**Run (Gmail):**

```bash
PROVIDER=gmail \
CRM_BASE_URL=https://<your-crm-host> \
CRM_SESSION_COOKIE='connect.sid=s%3A...' \
CSRF_TOKEN='<token if required>' \
CRM_MESSAGE_ID=<uuid from step 3> \
PROVIDER_MESSAGE_ID=<external_id from step 3> \
PROVIDER_ACCESS_TOKEN=<gmail access token> \
npx tsx scripts/email-sync-live-archive-test.ts \
  | tee live-archive-gmail-$(date +%Y%m%d).log
```

**Run (Outlook):** identical, with `PROVIDER=outlook` and the Graph token.

**Pass criteria:** script prints
`SUCCESS: Gmail message no longer carries INBOX label.` (or
`SUCCESS: Outlook message moved out of Inbox.`) and exits 0. The captured
`live-archive-<provider>-<date>.log` is the artifact attached to the
regression-pass record (alongside an Inbox-after screenshot from the
provider's web UI).

If the script times out, check:
- The CRM PATCH response was 200 (logged by the script).
- The `provider_sync` job is running (`processProviderEmailSync` in
  `server/jobs/jobRunner.ts`) — `drainMessageProviderPush` is called both
  inline by the PATCH handler and again by the cron, so a stuck cron will
  still let an inline push succeed.
- The mailbox is the same one whose tokens were minted (a common foot-gun:
  `PROVIDER_ACCESS_TOKEN` belongs to a different account than
  `CRM_MESSAGE_ID`).

---

## 8. Wrap-up

- Capture the date, app version / commit SHA, and any anomalies in the
  test log (#eng-email or wherever the team tracks regression passes).
- File issues for any deviations from "Pass criteria" above.
- If OAuth consent screens changed (new scopes prompted, or scopes missing),
  flag it — that almost always indicates a regression in
  `getGmailAuthUrl` / `getOutlookAuthUrl` scope arrays.

---

## Quick reference: where the behavior lives

| Behavior | File | Symbol |
| --- | --- | --- |
| Gmail incremental + full sync | `server/emailRoutes.ts` | `syncGmailAccount`, `syncGmailIncremental` |
| Outlook delta sync | `server/emailRoutes.ts` | `syncOutlookAccount`, `syncOutlookFolderDelta` |
| CRM → provider push (read/archive) | `server/emailRoutes.ts` | `PATCH /messages/:id`, `drainAccountProviderPushes`, `pushGmailMessageState`, `pushOutlookMessageState` |
| Cron driver (every 2 min) | `server/jobs/jobRunner.ts` | `processProviderEmailSync` |
| Mocked unit coverage | `server/__tests__/email-sync/email-sync.test.ts` | — |
