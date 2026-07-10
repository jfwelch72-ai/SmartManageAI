# Mobile Security

> Part of the [Mobile App Architecture Blueprint](./README.md). Extends
> `threat_model.md` and `docs/api/mobile-auth.md` with the mobile-specific
> layer; does not restate server-side controls already covered there.

## 1. Threat model delta for mobile

`threat_model.md` §1 already lists "Mobile app (Expo)" as a trust zone
("Device... Talks to the same API with JWT cookie auth"). This doc is the
detailed follow-through on that line item, and should be read alongside a
`threat_model.md` update the first time this blueprint's endpoints ship
(see §7 "Reviewer checklist" in that document — a new mobile auth surface
or file-upload entry point requires re-opening it).

New adversary consideration specific to mobile: **a lost or stolen
unlocked device**. Unlike a browser session (which times out and requires
re-auth on a shared/public machine), a phone is often left logged in for
convenience. This drives the local-storage and app-lock controls below.

## 2. Token storage & lifecycle

- JWT stored in **`expo-secure-store`**, which is backed by iOS Keychain /
  Android Keystore — never `AsyncStorage` (unencrypted) and never plain
  JS memory alone.
- No refresh-token endpoint exists server-side today
  (`backend-integration.md` §2) — the practical implication is the JWT's
  existing expiry (`server/auth.ts`) governs session length on mobile
  exactly as it does on web; a session that outlives the token expiry
  re-authenticates via the same OAuth/passkey flow, not a silent refresh.
- `tokenVersion`-based revocation (`threat_model.md` §5.2) applies
  identically — an admin revoking a user's sessions logs the mobile app
  out on its next request, same as a web tab.

## 3. Optional biometric app-lock

A device-local convenience layer, distinct from server auth:
- `expo-local-authentication` (Face ID / fingerprint / device PIN) can gate
  *reopening* the app after backgrounding, without re-running the OAuth
  flow — the JWT stays in SecureStore; the biometric check is a local gate
  on using it.
- This is a UX/loss-mitigation control, not a replacement for the server's
  auth boundary — a bypassed or disabled app-lock does not grant API
  access without a valid JWT.
- Recommended default: **on** for any org with SUPERINTENDENT/MANAGER/ADMIN
  seats (money-path and approval access), optional elsewhere. Exact
  default policy is a product decision to confirm before launch, not
  something this blueprint hardcodes.

## 4. Local (offline) data at rest

`docs/architecture/mobile-sync.md` §"Local Storage Posture" already
documents the current gap: cached SQLite data (`cache_entities`, `outbox`)
relies on **OS-level full-disk encryption**, not app-level
column/database encryption, and flags a **shared-device caveat** — if a
company issues shared tablets, cached data from the previous user's
session could be visible to the next user unless explicitly cleared.

This blueprint's guidance on top of that gap:
- **Logout must purge the local store.** `AuthContext`'s logout handler
  clears `cache_entities`, `outbox` (after confirming no PENDING writes
  would be lost — warn the user first if there are unsynced items), and
  `sync_meta` before returning to the auth stack.
- **Shared-device orgs** (a plausible pattern for a jobsite-issued tablet
  used across shifts) should be a known, explicit deployment configuration
  — flagged as a product/rollout decision requiring confirmation with the
  customer, not a silently-accepted risk.
- **SQLCipher (encrypted SQLite)** is a reasonable v1.1 hardening step if a
  regulated tenant (e.g., handling PII-heavy hiring data offline) requires
  it, but is not assumed as a v1 requirement given the existing
  `mobile-sync.md` posture already treats this as a documented, accepted
  gap rather than a blocker.

## 5. Network transport & certificate posture

- All traffic over HTTPS/TLS to the same Replit-hosted mTLS-proxied
  backend the web app uses (`threat_model.md` §1) — no separate mobile
  ingress.
- **Certificate pinning** is not recommended for v1: Replit's
  infrastructure manages TLS termination and certificate rotation, and
  pinning against a platform-managed endpoint creates a real risk of
  bricking the app on a routine cert rotation with no corresponding
  benefit against the app's actual adversaries (per `threat_model.md` §3,
  none of whom are positioned for a MITM attack that pinning specifically
  defeats). Revisit only if a specific compliance requirement mandates it.
- CORS is a browser-only concept and does not apply to the native app's
  direct HTTP client — `ADDITIONAL_ALLOWED_ORIGINS` entries needed for
  mobile are for the **Expo web / Metro dev** target only (`replit.md`),
  not for the compiled native binary.

## 6. AV scanning & upload safety

No mobile bypass of `scanConfirmedUpload` — every photo/document captured
on a device flows through the identical confirm → AV-scan → ACL sequence
described in `backend-integration.md` §4 and `threat_model.md` §5.4. A
malicious or compromised device attempting to upload a crafted payload gets
exactly the same scan-and-quarantine treatment as a browser upload.

## 7. Push notification payload hygiene

Push payloads (§7 of `01-architecture.md`) must not carry sensitive
business data in the notification body itself (e.g., dollar figures, PII) —
push notification content is visible on a lock screen by default on both
platforms. Payloads carry a generic message ("New RFI assigned on
Project X") plus a `deepLink`; the actual data is fetched authenticated
in-app after the user opens the notification.

## 8. Audit log coverage for mobile-originated actions

Every money-path/auth-sensitive action available on mobile (change order
approval, pay app approval, MFA enable/disable, role changes if ever
surfaced) writes to `audit_log` exactly as it does from web — the audit
row does not need a "source: mobile" distinction to be complete, but adding
one (a `source` or `userAgent`-derived field) is a low-cost enhancement
worth doing given `threat_model.md` §5.5's SOC-2-oriented coverage
philosophy; flagged as a nice-to-have when mobile approval endpoints are
actually implemented, not a blocking requirement.

## 9. Secret hygiene on the client

- No API key, AI provider key, or SendGrid credential is ever bundled into
  the mobile app binary — all AI/email calls proxy through the backend
  (`backend-integration.md` §7).
- Expo public env vars (`EXPO_PUBLIC_*`) are, by design, visible in the
  compiled bundle — only non-sensitive config (API base URL, feature flag
  toggles) belongs there, mirroring the `VITE_`-prefix caution already
  documented for the web client (`fullstack-js` skill).

## 10. Reviewer checklist addition

When a new mobile-originated endpoint is added, re-open
`threat_model.md` §7 exactly as the checklist there already requires for
"new auth route" / "new file-upload entry point" / "new money-path
mutation" — mobile does not get a separate checklist; it uses the existing
one.
