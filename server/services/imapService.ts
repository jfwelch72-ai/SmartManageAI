import { ImapFlow } from "imapflow";
import * as nodemailer from "nodemailer";
import type { EmailAccount } from "@shared/schema";

export interface ImapTestResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface ImapFetchedMessage {
  externalId: string;
  subject: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string;
  ccAddresses: string;
  bodyText: string;
  bodyHtml: string;
  snippet: string;
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  messageId: string;
}

function buildImapConfig(account: EmailAccount) {
  return {
    host: account.imapHost!,
    port: account.imapPort!,
    secure: account.imapSecure ?? true,
    auth: {
      user: account.imapUsername || account.emailAddress,
      pass: account.imapPassword!,
    },
    logger: false as const,
  };
}

function buildSmtpConfig(account: EmailAccount) {
  return {
    host: account.smtpHost!,
    port: account.smtpPort ?? 587,
    secure: account.smtpSecure ?? false,
    auth: {
      user: account.imapUsername || account.emailAddress,
      pass: account.imapPassword!,
    },
  };
}

export async function testImapConnection(account: EmailAccount): Promise<ImapTestResult> {
  const client = new ImapFlow(buildImapConfig(account));

  try {
    await client.connect();
    await client.logout();
    return { success: true, message: "IMAP connection successful" };
  } catch (err: any) {
    const errorMsg = parseConnectionError(err, "IMAP", account);
    return { success: false, message: "IMAP connection failed", error: errorMsg };
  }
}

export async function testSmtpConnection(account: EmailAccount): Promise<ImapTestResult> {
  if (!account.smtpHost) {
    return { success: true, message: "SMTP not configured (skipped)" };
  }

  const transporter = nodemailer.createTransport(buildSmtpConfig(account));

  try {
    await transporter.verify();
    transporter.close();
    return { success: true, message: "SMTP connection successful" };
  } catch (err: any) {
    transporter.close();
    const errorMsg = parseConnectionError(err, "SMTP", account);
    return { success: false, message: "SMTP connection failed", error: errorMsg };
  }
}

export async function testFullConnection(account: EmailAccount): Promise<{
  imap: ImapTestResult;
  smtp: ImapTestResult;
  success: boolean;
}> {
  const [imap, smtp] = await Promise.all([
    testImapConnection(account),
    testSmtpConnection(account),
  ]);

  return {
    imap,
    smtp,
    success: imap.success && smtp.success,
  };
}

export async function fetchImapMessages(
  account: EmailAccount,
  since?: Date,
  maxMessages: number = 50
): Promise<ImapFetchedMessage[]> {
  const client = new ImapFlow(buildImapConfig(account));
  const messages: ImapFetchedMessage[] = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");

    try {
      const searchCriteria: any = since ? { since } : { since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };

      const searchResult = await client.search(searchCriteria, { uid: true });
      const uids = Array.isArray(searchResult) ? searchResult : [];

      if (uids.length > 0) {
        const uidList = uids.slice(-maxMessages);
        const uidRange = uidList.join(",");

        for await (const msg of client.fetch(uidRange, {
          uid: true,
          envelope: true,
          source: true,
          flags: true,
          bodyStructure: true,
        }, { uid: true })) {
          try {
            const envelope = msg.envelope;
            if (!envelope) continue;

            const fromAddr = envelope.from?.[0];
            const toAddrs = envelope.to || [];
            const ccAddrs = envelope.cc || [];

            let bodyText = "";
            let bodyHtml = "";

            if (msg.source) {
              const sourceStr = msg.source.toString();
              bodyText = extractTextFromSource(sourceStr);
              bodyHtml = extractHtmlFromSource(sourceStr);
            }

            const snippet = bodyText
              ? bodyText.substring(0, 200).replace(/\s+/g, " ").trim()
              : "";

            const hasAttachments = checkForAttachments(msg.bodyStructure);

            messages.push({
              externalId: `imap-${account.id}-${msg.uid}`,
              subject: envelope.subject || "(No Subject)",
              fromAddress: fromAddr ? `${fromAddr.address}` : "unknown@unknown.com",
              fromName: fromAddr?.name || "",
              toAddresses: JSON.stringify(toAddrs.map((a: any) => a.address).filter(Boolean)),
              ccAddresses: JSON.stringify(ccAddrs.map((a: any) => a.address).filter(Boolean)),
              bodyText,
              bodyHtml,
              snippet,
              receivedAt: envelope.date ? new Date(envelope.date) : new Date(),
              isRead: msg.flags ? msg.flags.has("\\Seen") : false,
              hasAttachments,
              messageId: envelope.messageId || `imap-${msg.uid}`,
            });
          } catch (parseErr) {
            console.error(`Error parsing IMAP message UID ${msg.uid}:`, parseErr);
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch (_) {}
  }

  return messages;
}

export async function sendSmtpEmail(
  account: EmailAccount,
  options: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!account.smtpHost) {
    return { success: false, error: "SMTP not configured for this account. Please add SMTP settings." };
  }

  const transporter = nodemailer.createTransport(buildSmtpConfig(account));

  try {
    const info = await transporter.sendMail({
      from: account.displayName
        ? `"${account.displayName}" <${account.emailAddress}>`
        : account.emailAddress,
      to: options.to,
      cc: options.cc || undefined,
      bcc: options.bcc || undefined,
      subject: options.subject,
      text: options.text || undefined,
      html: options.html || undefined,
      inReplyTo: options.inReplyTo || undefined,
      references: options.references || undefined,
    });

    transporter.close();
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    transporter.close();
    const errorMsg = parseConnectionError(err, "SMTP");
    return { success: false, error: errorMsg };
  }
}

function detectProvider(account: EmailAccount): string | null {
  const email = account.emailAddress?.toLowerCase() || "";
  const host = (account.imapHost || "").toLowerCase();
  if (email.includes("@yahoo.") || host.includes("yahoo")) return "Yahoo";
  if (email.includes("@aol.") || host.includes("aol")) return "AOL";
  if (email.includes("@outlook.") || email.includes("@hotmail.") || email.includes("@live.") || host.includes("outlook")) return "Outlook";
  if (email.includes("@gmail.") || host.includes("gmail") || host.includes("imap.google")) return "Gmail";
  if (email.includes("@icloud.") || host.includes("icloud")) return "iCloud";
  return null;
}

function parseConnectionError(err: any, protocol: string, account?: EmailAccount): string {
  const msg = err.message || String(err);
  const provider = account ? detectProvider(account) : null;

  if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
    return `${protocol} server not found. Please check the hostname.`;
  }
  if (msg.includes("ECONNREFUSED")) {
    return `${protocol} connection refused. Please check the host and port.`;
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("ESOCKET")) {
    return `${protocol} connection timed out. Check the host, port, and SSL/TLS settings.`;
  }
  if (msg.includes("Invalid credentials") || msg.includes("AUTHENTICATIONFAILED") || msg.includes("LOGIN") || msg.includes("auth") || msg.includes("Authentication")) {
    if (provider === "Yahoo") {
      return `${protocol} authentication failed. Yahoo requires an App Password — go to Yahoo Account Security to generate one.`;
    }
    if (provider === "AOL") {
      return `${protocol} authentication failed. AOL requires an App Password — go to AOL Account Security to generate one.`;
    }
    if (provider === "Outlook") {
      return `${protocol} authentication failed. If you have 2FA enabled, you need an App Password from your Microsoft account security settings.`;
    }
    if (provider === "iCloud") {
      return `${protocol} authentication failed. iCloud requires an App-Specific Password — generate one at appleid.apple.com.`;
    }
    if (provider === "Gmail") {
      return `${protocol} authentication failed. Gmail requires an App Password if 2FA is enabled, or use the Gmail OAuth option instead.`;
    }
    return `${protocol} authentication failed. Please check your username and password. If your provider uses 2-factor authentication, you may need an App Password.`;
  }
  if (msg.includes("certificate") || msg.includes("SSL") || msg.includes("TLS")) {
    return `${protocol} SSL/TLS error. Try toggling the secure connection setting.`;
  }

  return `${protocol} error: ${msg.substring(0, 200)}`;
}

function extractTextFromSource(source: string): string {
  const textMatch = source.match(/Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:Content-[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\r?\n--)/i);
  if (textMatch) {
    return decodeContent(textMatch[1], source);
  }

  if (!source.includes("Content-Type: multipart")) {
    const headerEnd = source.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      return decodeContent(source.substring(headerEnd + 4), source);
    }
  }

  return "";
}

function extractHtmlFromSource(source: string): string {
  const htmlMatch = source.match(/Content-Type:\s*text\/html[^\r\n]*\r?\n(?:Content-[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\r?\n--)/i);
  if (htmlMatch) {
    return decodeContent(htmlMatch[1], source);
  }
  return "";
}

function decodeContent(content: string, fullSource: string): string {
  if (fullSource.includes("Content-Transfer-Encoding: base64")) {
    try {
      return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf-8");
    } catch {
      return content;
    }
  }
  if (fullSource.includes("Content-Transfer-Encoding: quoted-printable")) {
    return content
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return content;
}

function checkForAttachments(bodyStructure: any): boolean {
  if (!bodyStructure) return false;
  if (bodyStructure.disposition === "attachment") return true;
  if (bodyStructure.childNodes) {
    return bodyStructure.childNodes.some((child: any) => checkForAttachments(child));
  }
  return false;
}
