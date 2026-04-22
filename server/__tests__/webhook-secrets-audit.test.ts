/**
 * Unit tests for the boot-time webhook secrets audit (Task #883).
 *
 * Asserts that `collectWebhookSecretFindings` produces the right
 * findings for each combination of env vars, and that
 * `auditWebhookSecretsAtBoot` emits one WARN/ERROR log line per
 * finding and is idempotent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const logWarnMock = vi.fn();
const logErrorMock = vi.fn();
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: (...args: unknown[]) => logWarnMock(...args),
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const WEBHOOK_ENV_VARS = [
  "RESEND_WEBHOOK_SIGNING_SECRET",
  "RESEND_WEBHOOK_SECRET",
  "EMAIL_WEBHOOK_SECRET",
  "GMAIL_PUBSUB_TOPIC",
  "GMAIL_PUBSUB_AUDIENCE",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of WEBHOOK_ENV_VARS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  logWarnMock.mockReset();
  logErrorMock.mockReset();
  const { __resetWebhookSecretsAuditForTests } = await import(
    "../webhookSecretsAudit"
  );
  __resetWebhookSecretsAuditForTests();
});

afterEach(() => {
  for (const k of WEBHOOK_ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
});

describe("collectWebhookSecretFindings", () => {
  it("returns no findings when every webhook secret is configured", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = "whsec_xxx";
    process.env.EMAIL_WEBHOOK_SECRET = "shared-secret";
    process.env.GMAIL_PUBSUB_TOPIC = "projects/p/topics/t";
    process.env.GMAIL_PUBSUB_AUDIENCE = "https://app.example.com/webhook";

    const { collectWebhookSecretFindings } = await import(
      "../webhookSecretsAudit"
    );
    expect(collectWebhookSecretFindings()).toEqual([]);
  });

  it("flags a missing Resend signing secret as WARN when a shared-secret fallback exists", async () => {
    process.env.RESEND_WEBHOOK_SECRET = "shared";
    process.env.EMAIL_WEBHOOK_SECRET = "shared";

    const { collectWebhookSecretFindings } = await import(
      "../webhookSecretsAudit"
    );
    const findings = collectWebhookSecretFindings();
    const resend = findings.find(
      (f) => f.variable === "RESEND_WEBHOOK_SIGNING_SECRET",
    );
    expect(resend?.severity).toBe("warn");
  });

  it("flags a missing Resend signing secret as ERROR when no shared-secret fallback exists", async () => {
    const { collectWebhookSecretFindings } = await import(
      "../webhookSecretsAudit"
    );
    const findings = collectWebhookSecretFindings();
    const resend = findings.find(
      (f) => f.variable === "RESEND_WEBHOOK_SIGNING_SECRET",
    );
    expect(resend?.severity).toBe("error");
  });

  it("flags a missing EMAIL_WEBHOOK_SECRET as WARN", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = "whsec_xxx";

    const { collectWebhookSecretFindings } = await import(
      "../webhookSecretsAudit"
    );
    const findings = collectWebhookSecretFindings();
    const email = findings.find(
      (f) => f.variable === "EMAIL_WEBHOOK_SECRET",
    );
    expect(email?.severity).toBe("warn");
  });

  it("flags a missing GMAIL_PUBSUB_AUDIENCE only when Gmail Pub/Sub is in use", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = "whsec_xxx";
    process.env.EMAIL_WEBHOOK_SECRET = "shared";

    const { collectWebhookSecretFindings } = await import(
      "../webhookSecretsAudit"
    );

    // Topic not configured → no finding for the audience.
    expect(
      collectWebhookSecretFindings().find(
        (f) => f.variable === "GMAIL_PUBSUB_AUDIENCE",
      ),
    ).toBeUndefined();

    // Topic configured but audience missing → WARN finding.
    process.env.GMAIL_PUBSUB_TOPIC = "projects/p/topics/t";
    expect(
      collectWebhookSecretFindings().find(
        (f) => f.variable === "GMAIL_PUBSUB_AUDIENCE",
      )?.severity,
    ).toBe("warn");
  });

  it("treats whitespace-only env values as missing", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = "   ";
    process.env.EMAIL_WEBHOOK_SECRET = "\t\n";

    const { collectWebhookSecretFindings } = await import(
      "../webhookSecretsAudit"
    );
    const variables = collectWebhookSecretFindings().map((f) => f.variable);
    expect(variables).toContain("RESEND_WEBHOOK_SIGNING_SECRET");
    expect(variables).toContain("EMAIL_WEBHOOK_SECRET");
  });
});

describe("auditWebhookSecretsAtBoot", () => {
  it("emits one log line per finding (WARN/ERROR matching severity)", async () => {
    // Nothing configured — expect Resend ERROR + EMAIL_WEBHOOK_SECRET WARN.
    const { auditWebhookSecretsAtBoot } = await import(
      "../webhookSecretsAudit"
    );
    auditWebhookSecretsAtBoot();

    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalledTimes(1);

    const errorLine = String(logErrorMock.mock.calls[0]?.[0] ?? "");
    expect(errorLine).toContain("RESEND_WEBHOOK_SIGNING_SECRET");
    expect(errorLine).toContain("[webhook-secrets-audit]");

    const warnLine = String(logWarnMock.mock.calls[0]?.[0] ?? "");
    expect(warnLine).toContain("EMAIL_WEBHOOK_SECRET");
    expect(warnLine).toContain("[webhook-secrets-audit]");
  });

  it("is idempotent — subsequent calls do not re-emit", async () => {
    const { auditWebhookSecretsAtBoot } = await import(
      "../webhookSecretsAudit"
    );
    auditWebhookSecretsAtBoot();
    const errorCalls = logErrorMock.mock.calls.length;
    const warnCalls = logWarnMock.mock.calls.length;

    auditWebhookSecretsAtBoot();
    expect(logErrorMock.mock.calls.length).toBe(errorCalls);
    expect(logWarnMock.mock.calls.length).toBe(warnCalls);
  });

  it("stays silent when every secret is configured", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = "whsec_xxx";
    process.env.EMAIL_WEBHOOK_SECRET = "shared";
    process.env.GMAIL_PUBSUB_TOPIC = "projects/p/topics/t";
    process.env.GMAIL_PUBSUB_AUDIENCE = "https://app.example.com/webhook";

    const { auditWebhookSecretsAtBoot } = await import(
      "../webhookSecretsAudit"
    );
    auditWebhookSecretsAtBoot();
    expect(logErrorMock).not.toHaveBeenCalled();
    expect(logWarnMock).not.toHaveBeenCalled();
  });
});
