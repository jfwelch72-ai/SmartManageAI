/**
 * Startup audit for third-party webhook authentication secrets (Task #883).
 *
 * Task #879 added a loud boot-time warning for the missing Resend webhook
 * signing secret. The same silent-failure risk exists for every other
 * webhook integration the app depends on (Gmail Pub/Sub JWT verification,
 * Outlook subscription delivery, generic EMAIL_WEBHOOK_SECRET shared
 * secret, and any future provider). When an operator forgets one of these
 * values the misconfiguration only surfaces later — typically when a user
 * notices "bounces stopped flowing" or "new mail isn't pushing in".
 *
 * This module inventories every webhook signing/shared secret the server
 * relies on at startup and emits one summary WARN/ERROR line per missing
 * secret. The audit runs once during `registerRoutes` (see server/routes.ts).
 *
 * Adding a new webhook integration?
 *   1. Add a check inside `collectWebhookSecretFindings` below.
 *   2. Document the env var in `server/RUNBOOK_EMAIL_PUSH_NOTIFICATIONS.md`
 *      (or the runbook for the new integration).
 *
 * Tests: `server/__tests__/webhook-secrets-audit.test.ts`.
 */

import { logWarn, logError } from "./utils/logger";

export type WebhookSecretSeverity = "warn" | "error";

export interface WebhookSecretFinding {
  /** The env var that is missing (or, for compound checks, the primary one). */
  variable: string;
  /** Human-readable label for the integration the secret protects. */
  integration: string;
  /** WARN when a fallback or graceful degradation exists; ERROR otherwise. */
  severity: WebhookSecretSeverity;
  /** Operator-facing description of the impact + remediation. */
  message: string;
}

function isPresent(envName: string): boolean {
  return !!(process.env[envName] || "").trim();
}

/**
 * Pure helper — does no logging. Returns the list of missing webhook
 * secrets so callers (and tests) can inspect or render them however they
 * like. Order is stable so test assertions are deterministic.
 */
export function collectWebhookSecretFindings(): WebhookSecretFinding[] {
  const findings: WebhookSecretFinding[] = [];

  // ---------------------------------------------------------------------
  // 1. Resend bounce/complaint webhook (Task #879).
  //
  //    Preferred:  RESEND_WEBHOOK_SIGNING_SECRET (Svix HMAC).
  //    Fallback:   RESEND_WEBHOOK_SECRET or the legacy EMAIL_WEBHOOK_SECRET
  //                used as a `?token=` shared secret.
  //
  //    Without the signing secret payload integrity isn't verified; without
  //    *any* secret, every delivery is rejected and bounces silently stop.
  // ---------------------------------------------------------------------
  const resendSigning = isPresent("RESEND_WEBHOOK_SIGNING_SECRET");
  const resendSharedFallback =
    isPresent("RESEND_WEBHOOK_SECRET") || isPresent("EMAIL_WEBHOOK_SECRET");
  if (!resendSigning) {
    if (resendSharedFallback) {
      findings.push({
        variable: "RESEND_WEBHOOK_SIGNING_SECRET",
        integration: "Resend bounce/complaint webhook",
        severity: "warn",
        message:
          "RESEND_WEBHOOK_SIGNING_SECRET is not set — Resend webhook deliveries will only be authenticated by the shared-secret query token (no Svix signature verification). Configure the signing secret to verify payload authenticity.",
      });
    } else {
      findings.push({
        variable: "RESEND_WEBHOOK_SIGNING_SECRET",
        integration: "Resend bounce/complaint webhook",
        severity: "error",
        message:
          "RESEND_WEBHOOK_SIGNING_SECRET is not set AND no shared-secret fallback (RESEND_WEBHOOK_SECRET / EMAIL_WEBHOOK_SECRET) is configured — Resend bounce/complaint webhook deliveries will be REJECTED until one is provided. Bounces and complaints will not be recorded.",
      });
    }
  }

  // ---------------------------------------------------------------------
  // 2. Generic email webhook shared secret (Task #524).
  //
  //    Required for Gmail Pub/Sub push and Outlook Microsoft Graph push.
  //    Without it, both providers' `is*PushConfigured` guards return false
  //    and the system silently falls back to background polling alone —
  //    losing the real-time push experience without any visible error.
  // ---------------------------------------------------------------------
  if (!isPresent("EMAIL_WEBHOOK_SECRET")) {
    findings.push({
      variable: "EMAIL_WEBHOOK_SECRET",
      integration: "Gmail / Outlook push webhook shared secret",
      severity: "warn",
      message:
        "EMAIL_WEBHOOK_SECRET is not set — Gmail Pub/Sub push and Outlook subscription push are disabled and the system will fall back to background polling alone. Set this to a high-entropy shared secret (>=32 chars) to enable real-time email push notifications.",
    });
  }

  // ---------------------------------------------------------------------
  // 3. Gmail Pub/Sub OIDC JWT verification (Task #542).
  //
  //    GMAIL_PUBSUB_AUDIENCE enables verification of the Google-signed
  //    bearer JWT on each push delivery. Without it we authenticate only
  //    on the shared-secret URL token, so a leaked notification URL is
  //    enough for a third party to forge pushes. Only worth warning about
  //    once Gmail push has actually been wired up (i.e. GMAIL_PUBSUB_TOPIC
  //    is set) — otherwise the whole feature is intentionally disabled.
  // ---------------------------------------------------------------------
  if (isPresent("GMAIL_PUBSUB_TOPIC") && !isPresent("GMAIL_PUBSUB_AUDIENCE")) {
    findings.push({
      variable: "GMAIL_PUBSUB_AUDIENCE",
      integration: "Gmail Pub/Sub push JWT verification",
      severity: "warn",
      message:
        "GMAIL_PUBSUB_AUDIENCE is not set — Gmail Pub/Sub push deliveries are authenticated only by the shared-secret URL token, so a leaked notification URL would let a third party forge pushes. Configure the OIDC audience so we additionally verify the Google-signed JWT (see server/gmailPubsubAuth.ts).",
    });
  }

  // ---------------------------------------------------------------------
  // 4. Outlook subscription delivery authentication (Task #548).
  //
  //    Outlook deliveries are authorised via per-subscription rotating
  //    tokens stored on each `email_accounts` row, with EMAIL_WEBHOOK_SECRET
  //    available as the local-testing fallback. The per-account tokens are
  //    not env vars — they're generated on subscription creation — so the
  //    only env-level audit needed here is the EMAIL_WEBHOOK_SECRET check
  //    above. We surface this comment so future maintainers don't add a
  //    redundant Outlook clientState check by accident.
  // ---------------------------------------------------------------------

  return findings;
}

let bootAuditEmitted = false;

/**
 * Test-only: clear the boot-warning latch so unit tests can re-trigger
 * the audit in the same process.
 */
export function __resetWebhookSecretsAuditForTests(): void {
  bootAuditEmitted = false;
}

/**
 * Run the audit and emit one log line per missing secret. Idempotent: safe
 * to call multiple times; subsequent invocations are a no-op so a process
 * restart is required to re-emit the warnings.
 */
export function auditWebhookSecretsAtBoot(): void {
  if (bootAuditEmitted) return;
  bootAuditEmitted = true;

  const findings = collectWebhookSecretFindings();
  if (findings.length === 0) return;

  for (const f of findings) {
    const summary = `[webhook-secrets-audit] ${f.integration}: ${f.message}`;
    if (f.severity === "error") {
      logError(
        summary,
        { variable: f.variable, integration: f.integration },
        new Error(`Missing webhook secret: ${f.variable}`),
      );
    } else {
      logWarn(summary, {
        variable: f.variable,
        integration: f.integration,
      });
    }
  }
}
