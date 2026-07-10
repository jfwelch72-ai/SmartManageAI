# Backend Integration

> Part of the [Mobile App Architecture Blueprint](./README.md). Describes
> how the mobile client talks to the existing Express/Postgres backend —
> no new backend architecture is introduced.

## 1. Principle: same backend, same contracts

The mobile app is a client of the exact same Express API the web app uses.
It does not get a GraphQL layer, a BFF (backend-for-frontend), or a
mobile-specific API version. Every endpoint referenced in the
[`features/`](./features) docs is either an existing route or an explicitly
flagged proposed addition (see each doc's "Gaps vs. today" section) — this
blueprint does not silently assume new backend surface exists.

## 2. Auth

Fully governed by `docs/api/mobile-auth.md` (authoritative):
- OAuth mobile-exchange flow using a system-browser `AuthSession` +
  short-lived exchange code, not an embedded webview (avoids credential
  harvesting risk of in-app browsers).
- Passkey (WebAuthn) as the primary low-friction login path.
- JWT issued the same way as web (`server/auth.ts`), stored via
  `expo-secure-store` on the client rather than a cookie jar (mobile HTTP
  clients don't share the browser's cookie store) — the app sends the JWT
  as a `Bearer` header rather than relying on cookie auth.
- No refresh-token endpoint exists today — a 401 means "re-authenticate,"
  not "silently retry." Any client-side "seamless refresh" UX must wait on
  a server-side refresh-token capability being added (tracked as a gap, not
  assumed).

## 3. RBAC & tenant isolation

No mobile-specific auth exception. Every request:
1. Passes through `orgContextMiddleware` → `withOrgContext()`, which sets
   the Postgres session variables RLS policies key off
   (`docs/ACCOUNT_ROLES_RBAC.md` §"Data Boundaries").
2. Is re-checked by `requireRole` / `requireFeature` on the specific route,
   using `effectiveRole` for HUSTLER org-switch scoping.
3. Is filtered by RLS at the database layer even if application code
   forgets a `WHERE` clause (`docs/architecture/tenant-isolation.md`).

The mobile client's role-based nav/screen hiding (`ui-ux.md` §2) is a UX
convenience, never the actual security boundary — this is stated
explicitly so no future contributor mistakes "hidden in the tab bar" for
"enforced."

## 4. File uploads (photos, documents)

Mirrors the existing signed-URL upload flow (`threat_model.md` §5.4,
`server/objectStorage.ts`):

1. Client requests an upload intent: `POST /api/objects/upload` (or the
   multipart variant for large files) → receives a short-TTL (15-min)
   signed PUT URL.
2. Client `PUT`s the file bytes directly to GCS via the signed URL (not
   proxied through Express) — keeps large plan/photo uploads off the app
   server's request path.
3. Client calls `POST /api/objects/confirm` (or
   `POST /api/objects/multipart/:uploadId/complete`), which triggers the
   AV-scan boundary (`scanConfirmedUpload`) before the ACL policy — a
   photo captured on a compromised device is scanned exactly like a web
   upload, no mobile bypass.
4. On the mobile client, this whole sequence runs inside the same outbox
   entry as the parent entity (daily report, punch item, etc.) so a
   photo-plus-form submission is treated as one logical sync unit — see
   `workflows.md` §2 and §5.

## 5. Pagination

Every list-backed mobile screen implements the client checklist in
`docs/api/pagination.md`:
- `useInfiniteQuery` with cursor-based `pageSize`/`cursor` params.
- Respect the server's `pageSize` cap (200).
- Virtualize any list once cached rows exceed ~500 (`FlatList`/`FlashList`
  with `windowSize` tuning, not a plain `ScrollView.map`).
- Where a route hasn't yet migrated to the envelope shape (see backlog
  items referenced in `features/*.md`), the client should branch on
  response shape rather than block the mobile screen on the server
  migration.

## 6. Rate limiting

Mobile traffic hits the same Postgres-backed rate limiters as web
(`threat_model.md` §5.3) — `authLimiter`, `sensitiveLimiter`, `apiLimiter`,
`uploadLimiter`. No separate mobile allowance exists. Given a field crew
might retry a flaky clock-in several times in a poor-signal area, the sync
coordinator's bounded retry-with-backoff (`01-architecture.md` §5) is
designed to stay well under these limits — not to require raising them.

## 7. AI features on mobile

Any mobile screen that surfaces AI output (e.g., a future AI-assisted daily
report summary) must route through the same governance stack as web:
`routedGeneralChatCompletion`/`routedChatCompletion`
(`docs/architecture/ai-provider-routing.md`), the prompt-injection
quarantine envelope for any untrusted text
(`docs/architecture/prompt-injection.md`), and `governedAiCall` spend caps.
No AI call originates directly from the mobile client to OpenAI/Anthropic —
all AI calls proxy through the Express backend, consistent with the
threat model's "AI provider keys are server-side only" posture
(`threat_model.md` §2.4).

## 8. Correlation & observability

Every mobile request carries an `x-request-id` header
(`correlationIdMiddleware`, `threat_model.md` §5.8), generated client-side
per request, so a field-reported bug can be traced end-to-end through
server logs and Sentry using the same ID surfaced in the mobile crash
report (`01-architecture.md` §9).

## 9. What mobile does NOT get

- No new auth mechanism, no weakened RLS, no bypass of `requireRole`.
- No direct-to-GCS upload without going through the confirm/AV-scan step.
- No direct-to-LLM calls from the device.
- No mobile-only relaxed rate limit tier.
