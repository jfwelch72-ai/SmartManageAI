import { logInfo } from "../utils/logger";

/**
 * Task #782 — shared, test-safe outbound email transport.
 *
 * Every outbound email helper (Resend-based transactional mail in
 * emailService.ts, per-account SMTP sends in imapService.ts, and any
 * future helper) must route through this module so a single
 * `EMAIL_TRANSPORT=noop` flag can short-circuit delivery during e2e
 * tests. When the flag is set we append the message to an in-memory
 * outbox and skip the real provider; otherwise behavior is unchanged.
 */
export interface CapturedEmail {
  to: string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  source: 'resend' | 'smtp';
  capturedAt: Date;
}

const testOutbox: CapturedEmail[] = [];

export function isEmailTransportNoop(): boolean {
  return process.env.EMAIL_TRANSPORT === 'noop';
}

export function getTestEmailOutbox(): CapturedEmail[] {
  return testOutbox.slice();
}

export function clearTestEmailOutbox(): void {
  testOutbox.length = 0;
}

export function captureOutboundEmail(email: Omit<CapturedEmail, 'capturedAt'>): CapturedEmail {
  const captured: CapturedEmail = { ...email, capturedAt: new Date() };
  testOutbox.push(captured);
  logInfo(
    `[email:noop] captured outbound email via ${captured.source} (${captured.to.length} recipient(s)): ${captured.subject}`,
    { transport: 'noop', source: captured.source, recipientCount: captured.to.length },
  );
  return captured;
}
