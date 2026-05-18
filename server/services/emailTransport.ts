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
 *
 * Task #788 — capture also broadcasts to subscribers so the admin
 * outbox page (and e2e tests) can observe new messages in real-time
 * via SSE rather than polling every 5 seconds.
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
  source: 'sendgrid' | 'smtp';
  capturedAt: Date;
}

const testOutbox: CapturedEmail[] = [];

type CaptureSubscriber = (email: CapturedEmail) => void;
const subscribers = new Set<CaptureSubscriber>();

export function isEmailTransportNoop(): boolean {
  return process.env.EMAIL_TRANSPORT === 'noop';
}

export function getTestEmailOutbox(): CapturedEmail[] {
  return testOutbox.slice();
}

export function clearTestEmailOutbox(): void {
  testOutbox.length = 0;
}

/**
 * Subscribe to outbound email captures. The returned function unsubscribes.
 * Subscriber errors are isolated so one bad listener can't break others.
 */
export function subscribeToCapturedEmails(handler: CaptureSubscriber): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

export function captureOutboundEmail(email: Omit<CapturedEmail, 'capturedAt'>): CapturedEmail {
  const captured: CapturedEmail = { ...email, capturedAt: new Date() };
  testOutbox.push(captured);
  logInfo(
    `[email:noop] captured outbound email via ${captured.source} (${captured.to.length} recipient(s)): ${captured.subject}`,
    { transport: 'noop', source: captured.source, recipientCount: captured.to.length },
  );
  for (const sub of subscribers) {
    try {
      sub(captured);
    } catch {
      // Subscriber failures must not break the capture path.
    }
  }
  return captured;
}
