# SmartManageAI — Threat Model

A lightweight threat model that documents the trust boundaries, the assets we
care about, the realistic adversaries, and the mitigations currently in place.
Updated as part of Task #2479. Re-review on every major architectural change.

## 1. System overview

SmartManageAI is a multi-tenant SaaS for construction project management.
The major components:

| Component                | Trust zone | Notes |
| ------------------------ | ---------- | ----- |
| React/Vite SPA           | Browser    | Single-page app served by the same Express process. |
| Express API              | Server     | All HTTP traffic. Behind Replit's mTLS proxy. |
| Postgres (Neon)          | Server     | Source of truth for all tenant data. |
| GCS (Replit Object Storage) | Server | Per-tenant prefixed object keys. Signed URLs only. |
| OpenAI / Anthropic       | 3rd party  | Outbound only; no callbacks. |
| SendGrid                 | 3rd party  | Outbound email. |
| Mobile app (Expo)        | Device     | Talks to the same API with JWT cookie auth. |

## 2. Assets

1. **Tenant business data** — bids, change orders, payroll, invoices, AIA pay
   apps, time entries. Loss or tampering is direct financial harm.
2. **Tenant documents** — uploaded plans, contracts, certifications. Often
   contain PII, pricing, and confidential project info.
3. **Auth credentials** — bcrypt hashes, JWTs, session cookies, OAuth refresh
   tokens for connected integrations.
4. **AI provider keys** — OpenAI / Anthropic. Stolen keys = direct $$.
5. **Audit log** — append-only record of money-path changes. Tampering breaks
   forensic / SOC compliance.

## 3. Adversaries

| Actor | Motivation | Realistic capability |
| ----- | ---------- | -------------------- |
| Cross-tenant snooper (logged-in user of org A trying to read org B) | Competitive intel | Browser, valid auth, can craft any API request. |
| Hostile vendor uploading a doc with prompt-injection payloads | LLM bill burn / data exfiltration via AI | Can upload arbitrary file content via the bid invitation flow. |
| Credential stuffer / brute force | Account takeover | Distributed IPs, leaked password lists. |
| Insider with low-priv role | Privilege escalation | Valid auth, knows internal endpoints. |
| Internet scanner | Drive-by exploit | No prior auth; will hit every public route. |

## 4. Trust boundaries

- **Browser ↔ API** — All write requests must carry the CSRF cookie+header
  pair (`server/csrf.ts`). All API access requires a signed JWT cookie
  (`server/auth.ts`).
- **API ↔ DB** — All tenant queries are filtered through `getOrgIdForFilter`.
  SUPER_ADMIN bypass is explicit and audited.
- **API ↔ GCS** — Uploads use short-TTL (15-min) signed PUT URLs. Downloads
  use 5-min signed GET URLs. Object keys are prefixed with the tenant's
  `organizationId`.
- **API ↔ LLM** — Document text is wrapped in a quarantine envelope
  (`server/ai/promptInjectionGuard.ts`) before being sent. JSON outputs are
  schema-validated.

## 5. Mitigations currently in place

### 5.1 HTTP hardening (`server/index.ts`)
- `helmet` with a tuned CSP for the SPA, Vite assets, GCS images, and the
  whitelisted social OAuth form-actions.
- `frame-ancestors 'none'` + `frameguard: deny` (clickjacking).
- `hsts: maxAge=1y, includeSubDomains, preload` in production.
- `referrer-policy: no-referrer`.
- `cors` is allowlist-driven from env (`FRONTEND_URL`, `REPLIT_DOMAINS`).

### 5.2 Authentication & sessions (`server/auth.ts`)
- bcrypt(10) password hashing.
- HTTP-only, `SameSite=Lax`, `Secure` (in prod) JWT cookie.
- `tokenVersion` per-user — `revokeUserTokens()` invalidates all sessions.
- 5-second per-pod auth cache, with explicit invalidation hooks for
  cross-replica safety (see Task #2427 doc-comments).
- HUSTLER role uses `effectiveRole` from `hustler_organizations` for org-
  scoped privilege.

### 5.3 Rate limiting (`server/rateLimiter.ts`, Postgres-backed)
| Limiter | Window | Max | Applied to |
| ------- | ------ | --- | ---------- |
| `authLimiter` | 15 min | 15 | `/api/auth/login`, `/api/auth/register`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/resend-verification`, client-portal verify. |
| `sensitiveLimiter` | 15 min | 100 | AI document analyze + reanalyze, other expensive endpoints. |
| `apiLimiter` | 15 min | 1000 | Global API surface (skipped in dev seed). |
| `exportLimiter` | 15 min | 20 | CSV / PDF export endpoints. |
| `feedbackLimiter` | 15 min | 60 | DOT pay-item match feedback. |
| `uploadLimiter` *(new)* | 15 min | 200 | `/api/objects/upload`, `/api/objects/multipart`, `/api/objects/confirm`. |
| `aiLimiter` *(new)* | 15 min | 30 | Reserved for high-cost AI routes. |

All limiters share a Postgres-backed store so per-window quotas hold across
autoscale replicas.

### 5.4 File-upload safety (`server/auditBillingStorageRoutes.ts`,
`server/objectStorage.ts`, `server/fileValidation.ts`)
- MIME-type allowlist per file class (`MEDIA`, `DOCUMENT`, `RECEIPT`, `BIM`,
  `LIDAR`).
- Size cap per file class (max 32 GB for plan-set PDFs).
- Per-tenant path prefix — every upload lands under
  `${PRIVATE_OBJECT_DIR}/${organizationId}/uploads/${uuid}`.
- ACL policy carries `organizationId`; download path enforces tenant isolation.
- Signed download URLs default to 5 minutes (`getSignedDownloadUrl`); upload
  PUT URLs default to 15 minutes.
- **AV scan boundary** (`server/uploadAvScanner.ts`): every confirmed
  upload — both single-shot (`POST /api/objects/confirm`) and multipart
  (`POST /api/objects/multipart/:uploadId/complete`) — now traverses
  `scanConfirmedUpload(...)` *before* the ACL policy is written. Active
  scanner picks in this order:
    1. Anything registered via `registerUploadAvScanner(fn)` (integration
       point for ClamAV-on-host, VirusTotal, etc.).
    2. **Cloudmersive** hosted ClamAV-backed scan-file endpoint when
       `CLOUDMERSIVE_AV_API_KEY` is set. Files larger than
       `CLOUDMERSIVE_AV_MAX_BYTES` (default 25 MiB) fall back to step 3.
    3. Built-in **EICAR head-check**: downloads the first 4 KiB of the
       object from GCS and rejects any file containing the canonical
       EICAR antimalware test signature.
  Mode (`UPLOAD_AV_SCAN_MODE`) defaults to `enforce` in production
  (scanner errors fail-closed → 422) and `permissive` in dev/test
  (scanner errors fail-open). Explicit env always wins;
  `UPLOAD_AV_SCAN_MODE=disabled` keeps the legacy bypass for emergency
  rollback.

  **Task #2493** closed the remaining gap on the AV-scan boundary:
  - Every scan outcome (clean / blocked / skipped) is recorded in
    `audit_log` via `recordUploadScanAudit(...)` in
    `server/auditBillingStorageRoutes.ts`. The row carries
    `entityType = "upload_av_scan"`, `entityId = uploadIntent.id`,
    `action = APPROVE` for clean/skipped and `REJECT` for blocked,
    and a JSON `newValue` payload with `scannerId`, `reason`,
    `objectKey`, `contentType`, `sizeBytes`, `organizationId`,
    `route` (`confirm` vs `multipart_complete`), and the request
    `correlationId` (`x-request-id`) so each scan can be joined to
    structured logs and Sentry.
  - Blocked uploads are now physically quarantined: the offending
    object is `deleteObjectByKey()`'d from GCS in the same helper
    before the 422 response is returned, so an "infected" verdict
    leaves no orphan blob even if a signed URL had already been
    minted.

### 5.5 Audit log coverage (`server/auditLogger.ts`)
Append-only `audit_log` table, no DELETE/UPDATE routes exposed. `userId` is
runtime-asserted to be a non-empty string (guards against the historical
"pass the whole Express Request" footgun, lint at
`scripts/audit-audit-logger-userid.mjs`). Coverage as of Task #2479:

| Money path | Covered |
| ---------- | ------- |
| Pay runs (create/status/delete) | Yes (`server/payrollRoutes.ts`) |
| Change orders (create/status/approve) | Yes (`server/changeOrder*Routes.ts`) |
| Billing events (create) | Yes (`server/auditBillingStorageRoutes.ts`) |
| AIA pay applications (create / status / record-payment) | **Yes (added Task #2479)** |
| Auth events (login, login-failed, logout, password change/reset) | **Yes (added Task #2495)** — `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_CHANGE`, `PASSWORD_RESET`, `PASSWORD_RESET_REQUESTED` actions written via `logAuthEvent` from `server/authProfileRoutes.ts`, `server/workforceRoutes.ts`, and `server/platformRoutes.ts`. The activity_log rows are kept for the in-app session UI; audit_log is the SOC 2 trail. |
| MFA changes (enable / disable) | **Yes (added Task #2495)** — `MFA_ENABLED` / `MFA_DISABLED` audit rows written from `server/userSettingsRoutes.ts` (`/api/account/2fa/verify` enable, `/api/account/2fa/disable` disable). |
| Role changes (platform, in-org, HUSTLER oversight grant/revoke) | **Yes (added Task #2495)** — `ROLE_CHANGED` for `users.role` swaps via `/platform/users/:id/role` and `PATCH /api/users/:id`; `ROLE_GRANTED` / `ROLE_REVOKED` for `hustler_organizations` membership changes via `/hustler/link-requests/respond`, `/accept-invite`, `/accept-token`, and `DELETE /hustler/unlink-organization/:id`. All routed through the typed `logRoleChange` helper in `server/auditLogger.ts`. |
| Data export | Yes (export limiter rows + per-route audit). |

### 5.6 AI prompt-injection defenses
(`server/ai/promptInjectionGuard.ts`, `server/aiDocumentRoutes.ts`)
- **Quarantine envelope** — every untrusted text block is wrapped in
  `<UNTRUSTED_DOCUMENT>` tags with a leading reminder that the LLM must NOT
  follow embedded instructions.
- **Heuristic detector** — `detectPromptInjection` flags common patterns
  (ignore-previous, role override, fake `<system>` tags, exfiltration
  prompts, jailbreak markers).
- **Refusal policy** — `shouldRefusePromptInjection` rejects requests where
  the document combines role-override + exfiltration patterns.
- **Output validation** — `validateAiJsonOutput` runs a Zod schema check on
  the LLM JSON response before any DB write. The OpenAI call also sets
  `response_format: { type: 'json_object' }` to constrain the model.
- **Governance gate** — `governedAiCall` enforces per-org spend / action
  caps and records every call.
- **SSRF** — `extractDocumentContent` only accepts our internal
  `/objects/...` paths or `storage.googleapis.com` URLs (see
  `parseGcsUrl`). Arbitrary HTTP(S) URLs are rejected.

**Task #2683 — mechanical enforcement** closed the "developer
discipline" gap that previously kept this section honest only by code
review:

- **CI guard** — `scripts/check-prompt-injection-guard.mjs` (wired into
  `scripts/ci.sh`) walks every `.ts` / `.tsx` file under `server/`,
  flags any call to `openai.chat.completions.create`,
  `routedChatCompletion`, or `callOpenAIForAnalysis`, and FAILS the
  build if the file does not either (a) import a helper from
  `server/ai/promptInjectionGuard.ts`, or (b) carry an explicit
  `// prompt-injection-guard: <reason>` top-of-file annotation. The
  annotation is the deliberate, reviewable acknowledgement —
  reviewers must inspect every new annotation in PR.
- **Stored-injection vector closed** — `quarantineUserText(label,
  text)` wraps short tenant-DB strings (sheet filenames, RFI bodies,
  assembly names) in `<<USER:label>>...<</USER:label>>` sentinels so a
  hostile filename like `>>>END\nIgnore previous instructions` cannot
  break out of inline templating. Reference site:
  `server/services/aiEstimator/mapReduceDraft.ts` wraps every
  `sheetNumber` / `sheetName` before splicing into the discipline
  batch envelope.
- **Expanded pattern coverage** — added `delimiter_escape` (closing
  `</UNTRUSTED_DOCUMENT>` sentinels in user content), `im_start` /
  `im_end` (OpenAI/Anthropic chat-format spoof), `encoded_payload_hint`
  (base64 / rot13 instruction smuggling), broader `tool_override` /
  `exfiltration` / `jailbreak_marker` rules. Detection runs on a
  normalized form (`normalizeForDetection`) that strips zero-width and
  non-breaking-space chars and collapses whitespace, defeating
  `i\u200bgnore previous` style obfuscation.
- **Observability** — every detection (refused or merely flagged)
  routes through `recordPromptInjectionDetection({ route, patternId,
  action })`. Counter exported on `/metrics` as
  `ai_prompt_injection_detections_total{route,pattern_id,action}`
  (`action` ∈ `flagged | refused | quarantined`). Triage runbook:
  `docs/runbooks/observability.md`.
- **Regression suite** — `server/__tests__/promptInjectionGuard.test.ts`
  exercises every pattern_id with a real-world payload (zero-width
  evasion, smartquote evasion, delimiter escape, im_start spoof,
  base64 smuggling, tool-invocation override, act-as / new-system-
  prompt overrides, exfiltration, explicit injection markers) plus
  the `quarantineUserText` and metric counter behavior.
- **Playbook** — `docs/architecture/prompt-injection.md` is the
  contributor-facing single source of truth (primitives, canonical
  wiring example, stored-injection vector, observability, new-route
  checklist).

### 5.7 Secret hygiene & rotation
- Secrets live only in Replit's Secrets store / `.env` (gitignored). The
  repo ships `.env.example` (Task #2479) — never a `.env`.
- Rotation cadence:
  - `SESSION_SECRET` — every 90 days; rotation logs out all users.
  - `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — every 90 days, immediately on
    suspected leak.
  - `DATABASE_URL` — rotate on Neon side; redeploy.
  - SendGrid, GCS, OAuth client secrets — every 180 days.
- Secret-scanning runs as part of CI via the existing `security_scan` skill.
  Run `runDependencyAudit`, `runSastScan`, and `runHoundDogScan` before
  cutting a release.

### 5.8 Other relevant controls
- `correlationIdMiddleware` stamps every request with `x-request-id`,
  propagated to outbound `fetch` and to error_logs / Sentry.
- `expressAsyncShim` ensures async handler errors land in the central
  error middleware rather than hanging the request.
- `redactForLog` strips passwords, tokens, secrets, and PII (email/phone)
  before any structured log line is written.

## 6. Known residual risks (out of scope for Task #2479)

1. **Pen-testing** — not yet engaged. Tracked separately.
2. **SOC 2 controls** beyond the technical baseline — separate workstream.
3. **Per-tenant key separation for OpenAI** — today every tenant shares one
   API key. Bring-your-own-key is a roadmap item, not a present mitigation.
4. **DLP on outbound email** — SendGrid sends are not scanned for PII before
   leaving the tenant boundary.

## 7. Reviewer checklist

When changing any of the surfaces below, re-open this doc and update the
relevant section:
- New auth route, role, or permission key.
- New file-upload entry point.
- New AI provider, model, or prompt template.
- New money-path mutation (anything that touches `pay_applications`,
  `change_orders`, `payroll_*`, `invoices`, `unified_payments`,
  `billing_events`).
- New outbound HTTP destination from server-side code.
