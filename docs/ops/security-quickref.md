# Security Quick Reference

Key security pointers for contributors. The full threat model is in `threat_model.md`.

## Threat Model

`threat_model.md` — covers HTTP hardening, rate limits, upload safety, audit log coverage, prompt-injection defenses, and secret rotation. **Re-read it whenever you add**: a new auth route/role, a new file-upload entry point, a new AI provider/model/prompt template, a new money-path mutation, or a new outbound HTTP destination from server-side code.

## Environment Secrets

*   **Env template**: `.env.example` — copy to `.env` and fill in secrets locally. **Never commit a real `.env`.**
*   Secrets live only in Replit's Secrets store. Rotation cadence: `SESSION_SECRET` every 90 days (logs out all users), AI keys every 90 days, SendGrid/GCS/OAuth every 180 days.

## Prompt-Injection Guard

Every new server file that calls an LLM must either:

1. Import helpers from `server/ai/promptInjectionGuard.ts` and use them on every untrusted input (`quarantineDocumentBlocks`, `quarantineUntrustedText`, `quarantineUserText`, `detectPromptInjection`, `validateAiJsonOutput`).
2. Or carry a top-of-file `// prompt-injection-guard: <reason>` annotation documenting why the guard is unnecessary.

CI guard `scripts/check-prompt-injection-guard.mjs` (wired into `scripts/ci.sh`) enforces this. Full playbook: `docs/architecture/prompt-injection.md`.

## Tenant Isolation

All authenticated requests must be wrapped in `withOrgContext()`. SUPER_ADMIN sessions are NOT auto-elevated — use explicit `runAsSuperadmin(reason, fn)` which writes an audit row before elevating. `STRICT_TENANT_RLS=true` must be set in production. Full design: `docs/architecture/tenant-isolation.md`.

## File Upload Safety

MIME-type allowlist + size caps enforced in `server/fileValidation.ts`. Every confirmed upload passes through `scanConfirmedUpload(...)` (AV scan) before the ACL policy is written. Blocked uploads are quarantined (deleted from GCS) and audited. See `threat_model.md` §5.4.

## AI Provider Keys

New chat-completion call sites must route through `routedGeneralChatCompletion` (or `routedChatCompletion` for Takeoff family). Direct `openai.chat.completions.create` calls require a `// ai-router-bypass: <reason>` annotation. See `docs/architecture/ai-provider-routing.md`.
