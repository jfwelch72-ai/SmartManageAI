/**
 * Task #784 — Regression tests for the SMTP no-op safety net.
 *
 * Task #782 routed `sendSmtpEmail` (per-account SMTP via nodemailer) through
 * the same `EMAIL_TRANSPORT=noop` seam used by Resend. These tests guard
 * against a future refactor silently re-enabling real per-account SMTP
 * sends in e2e runs.
 *
 * Verifies:
 *   1. With EMAIL_TRANSPORT=noop, `sendSmtpEmail` returns { success: true },
 *      never constructs a nodemailer transporter, and appends a
 *      `source: 'smtp'` entry (with to/cc/bcc) to the in-memory outbox.
 *   2. Without the env flag, the function still attempts the real SMTP
 *      path (mocked) — i.e. it constructs a transporter and calls sendMail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { EmailAccount } from "@shared/schema";

const { sendMailMock, closeMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn(async (_opts: Record<string, unknown>) => ({ messageId: "real-smtp-message-id" }));
  const closeMock = vi.fn();
  const createTransportMock = vi.fn(() => ({
    sendMail: sendMailMock,
    close: closeMock,
    verify: vi.fn(async () => true),
  }));
  return { sendMailMock, closeMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  createTransport: createTransportMock,
  default: { createTransport: createTransportMock },
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

import { sendSmtpEmail } from "../services/imapService";
import {
  clearTestEmailOutbox,
  getTestEmailOutbox,
  isEmailTransportNoop,
} from "../services/emailTransport";

const baseAccount: EmailAccount = {
  id: "acct-1",
  emailAddress: "owner@example.com",
  displayName: "Test Owner",
  imapHost: "imap.example.com",
  imapPort: 993,
  imapSecure: true,
  imapUsername: "owner@example.com",
  imapPassword: "secret",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
} as unknown as EmailAccount;

let priorEmailTransport: string | undefined;

beforeEach(() => {
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  createTransportMock.mockClear();
  sendMailMock.mockClear();
  closeMock.mockClear();
  clearTestEmailOutbox();
});

afterEach(() => {
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
  clearTestEmailOutbox();
});

describe("sendSmtpEmail — EMAIL_TRANSPORT=noop safety net (Task #784)", () => {
  it("captures the email and skips nodemailer when EMAIL_TRANSPORT=noop", async () => {
    process.env.EMAIL_TRANSPORT = "noop";
    expect(isEmailTransportNoop()).toBe(true);

    const result = await sendSmtpEmail(baseAccount, {
      to: "alice@example.com, bob@example.com",
      cc: "carol@example.com",
      bcc: "dan@example.com,erin@example.com",
      subject: "Hello from noop",
      text: "plain body",
      html: "<p>html body</p>",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^noop-/);

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();

    const outbox = getTestEmailOutbox();
    expect(outbox).toHaveLength(1);
    const entry = outbox[0];
    expect(entry.source).toBe("smtp");
    expect(entry.to).toEqual(["alice@example.com", "bob@example.com"]);
    expect(entry.cc).toEqual(["carol@example.com"]);
    expect(entry.bcc).toEqual(["dan@example.com", "erin@example.com"]);
    expect(entry.subject).toBe("Hello from noop");
    expect(entry.html).toBe("<p>html body</p>");
    expect(entry.text).toBe("plain body");
    expect(entry.from).toBe('"Test Owner" <owner@example.com>');
  });

  it("omits cc/bcc from the outbox entry when not provided", async () => {
    process.env.EMAIL_TRANSPORT = "noop";

    const result = await sendSmtpEmail(baseAccount, {
      to: "solo@example.com",
      subject: "no cc/bcc",
      text: "body",
    });

    expect(result.success).toBe(true);
    expect(createTransportMock).not.toHaveBeenCalled();

    const outbox = getTestEmailOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toEqual(["solo@example.com"]);
    expect(outbox[0].cc).toBeUndefined();
    expect(outbox[0].bcc).toBeUndefined();
  });

  it("attempts the real SMTP path via nodemailer when EMAIL_TRANSPORT is unset", async () => {
    delete process.env.EMAIL_TRANSPORT;
    expect(isEmailTransportNoop()).toBe(false);

    const result = await sendSmtpEmail(baseAccount, {
      to: "alice@example.com",
      subject: "Real send",
      text: "hello",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("real-smtp-message-id");

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const sendArgs = (sendMailMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sendArgs.to).toBe("alice@example.com");
    expect(sendArgs.subject).toBe("Real send");
    expect(sendArgs.from).toBe('"Test Owner" <owner@example.com>');

    // Real-path sends must NOT be appended to the test outbox.
    expect(getTestEmailOutbox()).toHaveLength(0);
  });
});
