# safeDownload audit (Task #1498)

This note lists every server-side outbound `fetch()` reachable from the
search `rg -n "await fetch\(" server` and records whether it was
migrated to `safeDownload()` (or why it was left alone).

`safeDownload()` is the right tool when:
- the URL (or any segment of it) comes from user-, tenant-, or
  third-party-controlled input, AND
- we are downloading the response body for storage / forwarding /
  parsing (not just calling a known SaaS API endpoint).

For server-to-known-SaaS-API calls (Google, Microsoft, LinkedIn,
Twitter, Workable, Lever, Greenhouse, Box, Dropbox, OneDrive, Stripe,
QBO, etc.) the host is a fixed constant in our code, so SSRF protection
is unnecessary and a content-type allowlist would actively break the
JSON API. Those call sites are intentionally **not** migrated.

## Migrated in this task

| File | Line | Reason |
| --- | --- | --- |
| `server/aiOnboardingRoutes.ts` | `extractThemeFromWebsite` | User-supplied `websiteUrl` was being fetched with hand-rolled SSRF regexes. Now uses `safeDownload({ allowedContentTypes: ['text/html', 'application/xhtml+xml'], maxBytes: 1MB, timeoutMs: 10s })`. Adds DNS-resolution check, redirect re-validation, Authorization-header stripping, and streaming size cap. |
| `server/integrations/providers/stackct/sync.ts` | ~419 | Fetches third-party `doc.fileUrl` (cloud storage). Existing host allowlist (`*.googleapis`, `*.amazonaws`, `*.blob.core.windows.net`) preserved as a first gate; `safeDownload({ allowedContentTypes: null })` now layered on top so redirects can't escape to internal hosts and downloads can't exceed the 100 MB cap. |
| `server/social/publishService.ts` | YouTube upload (~365) | User-supplied `mediaUrl` is downloaded then forwarded to YouTube. Now goes through `safeDownload({ allowedContentTypes: null, maxBytes: 500 MB, timeoutMs: 60s })`. |
| `server/services/callTranscriptionService.ts` | `fetchRecordingAudio` (~115) | Twilio recording fetched for Whisper transcription. The `api.twilio.com` host allowlist remains the first gate; `safeDownload({ allowedContentTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg'], maxBytes: 50 MB, timeoutMs: 60s })` now adds DNS-resolution checks, redirect re-validation with Authorization stripping, and a streaming size cap. (Task #1542) |
| `server/crmCallsRoutes.ts` | `downloadRecordingToStorage` (~141) | Twilio recording cached to object storage. Same Twilio host allowlist preserved as a first gate; `safeDownload({ allowedContentTypes: [...audio types...], maxBytes: 100 MB, timeoutMs: 60s })` layered on top. (Task #1542) |

## Already protected (previous tasks)

- `POST /api/documents/from-url` — `server/projectOpsRoutes.ts:~470` (Task #1455).
- `POST /api/documents/from-cloud` — `server/projectOpsRoutes.ts:~639` (Task #1456).

## Audited and intentionally left as plain `fetch`

### Known SaaS API hosts (fixed in code)
- `server/social/publishService.ts` — graph.facebook.com, api.linkedin.com,
  api.twitter.com, open.tiktokapis.com, googleapis.com, api.pinterest.com.
- `server/socialRoutes.ts` — same set of OAuth + profile endpoints.
- `server/oauthRoutes.ts` — Google/Apple/Microsoft OAuth token + JWKS.
- `server/emailRoutes.ts` — Gmail / Microsoft Graph token + send endpoints.
- `server/integrationRoutes.ts` — Google Drive / OneDrive APIs (URLs built
  from constants and provider IDs, not free-form user input).
- `server/integrations/providers/{box,dropbox,gdrive,google,microsoft,onedrive,qbo,sage,bluebeam,autodesk,esign,stackct,zapier}/provider.ts`
  — provider OAuth/token/profile URLs.
- `server/integrations/providers/qbo/sync.ts`,
  `server/integrations/providers/stackct/client.ts` — fixed API base.
- `server/integrations/ats/{Workable,Lever,Greenhouse}Provider.ts` — fixed
  ATS API hosts.
- `server/services/nativePushService.ts` — Expo push.
- `server/gmailPubsubAuth.ts` — Google certs URL (constant).
- `server/utils/geocodingService.ts` — fixed geocoding host.
- `server/delayRoutes.ts:53`, `server/weatherRoutes.ts:153/236/290` —
  fixed weather API hosts.
- `server/statusProbeScheduler.ts` — synthetic uptime probes whose URLs
  are tenant-configured but explicitly intended to hit arbitrary
  HTTP(S) endpoints; SSRF would break the feature. (See ticket-level
  follow-up if internal probing becomes a concern.)

### User-configured webhooks (notify-only POSTs, no body downloaded)
- `server/services/slackService.ts`, `server/services/teamsService.ts`,
  `server/services/transcriptBackfillNotifications.ts`,
  `server/services/crmAutomationEngine.ts`,
  `server/integrations/webhookService.ts`,
  `server/integrations/providers/zapier/provider.ts`,
  `server/statusAlertService.ts`,
  `server/crmCallsRoutes.ts:1896/1948`.
  These POST a small JSON payload to a tenant-supplied webhook URL and
  do not consume the response body for storage or parsing. They use the
  separate `validateOutboundUrl` / `safeFetch` helper in
  `server/utils/safeFetch.ts` where applicable; switching them to
  `safeDownload` would not add value and would impose a content-type
  allowlist they don't need.

### Internal / signed-URL fetches
- `server/projectOpsRoutes.ts:577,766,2657` — uploads to or downloads
  from our own object-storage signed URLs (host fixed by the storage
  SDK, no user input in the URL).
- `server/auditBillingStorageRoutes.ts` — GCS resumable upload URIs
  returned by our own backend.
- `server/changeOrderApprovalRoutes.ts`, `server/submittalRoutes.ts`,
  `server/rfiRoutes.ts` — `http://127.0.0.1:1106/...` upload helper.
  Loopback and explicitly intentional.
- `server/taskRoutes.ts:735` — uploadURL produced by our backend.
- `server/reportRoutes.ts:522` — internal URL constructed by the same
  process.
- `server/objectStorage.ts:340` — sidecar token endpoint
  (`127.0.0.1:1106`).

### Already gated by their own SSRF defenses
- `server/crmCallsRoutes.ts:~892` — Twilio recording streaming proxy
  (`GET /api/crm/calls/:id/recording`). Preserves the `api.twilio.com`
  allowlist and forwards the client's `Range` header so the audio
  player can seek. `safeDownload()` buffers the full body in memory
  before returning, which would defeat both range-request streaming
  and the multi-MB memory budget for long calls. Left as a streaming
  passthrough; the host allowlist + HTTPS check remain the SSRF gate.

### Tests
- `server/__tests__/email-provider-pushback.test.ts` — fixtures only.
