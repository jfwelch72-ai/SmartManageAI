import { logError, logInfo } from "../utils/logger";
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const DEFAULT_FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS || 'SmartManageAI <onboarding@resend.dev>';

/**
 * Task #777 — env-gated no-op transport for tests.
 *
 * When EMAIL_TRANSPORT === 'noop' the `sendEmail` helper short-circuits
 * before talking to Resend: the message is appended to an in-memory
 * outbox and the call resolves true. This lets end-to-end tests that
 * exercise "send a sample email" paths (e.g. the quiet-hours digest
 * preview) verify the send branch without delivering real mail or
 * burning Resend quota. Production code paths are unchanged unless the
 * env flag is set explicitly.
 */
export interface CapturedEmail {
  to: string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
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

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function isTransientError(error: any): boolean {
  if (error?.statusCode && error.statusCode >= 500) return true;
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND') return true;
  if (error?.message?.includes('rate limit')) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendEmail(options: EmailOptions & { headers?: Record<string, string> }): Promise<boolean> {
  let lastError: any;

  let recipients: string[] = [];
  if (typeof options.to === 'string') {
    if (options.to.includes(',')) {
      recipients = options.to.split(',').map(email => email.trim());
    } else {
      recipients = [options.to];
    }
  } else {
    recipients = options.to;
  }
  const recipientCount = recipients.length;

  if (isEmailTransportNoop()) {
    const captured: CapturedEmail = {
      to: recipients,
      from: options.from || DEFAULT_FROM_EMAIL,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      capturedAt: new Date(),
    };
    testOutbox.push(captured);
    logInfo(
      `[email:noop] captured outbound email (${recipientCount} recipient(s)): ${options.subject}`,
      { transport: 'noop', recipientCount },
    );
    return true;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const emailPayload: any = {
        from: options.from || DEFAULT_FROM_EMAIL,
        to: recipients,
        subject: options.subject,
        text: options.text || '',
        html: options.html || options.text || '',
      };

      if (options.replyTo) {
        emailPayload.replyTo = options.replyTo;
      }

      if (options.headers && Object.keys(options.headers).length > 0) {
        emailPayload.headers = options.headers;
      }

      if (options.attachments && options.attachments.length > 0) {
        emailPayload.attachments = options.attachments.map(att => ({
          filename: att.filename,
          content: att.content,
          content_type: att.contentType || 'application/pdf',
        }));
      }

      const { data, error } = await resend.emails.send(emailPayload);

      if (error) {
        const errorMsg = typeof error === 'object' ? JSON.stringify(error) : String(error);
        lastError = error;
        if (attempt < MAX_RETRIES && isTransientError(error)) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(`Resend transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${errorMsg}`);
          await sleep(delay);
          continue;
        }
        logError(`Resend email error (${recipientCount} recipient(s)): ${errorMsg}`, {}, new Error(errorMsg));
        return false;
      }

      console.log(`Email sent successfully via Resend (${recipientCount} recipient(s))`, data?.id);
      return true;
    } catch (error: any) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
      if (attempt < MAX_RETRIES && isTransientError(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`Resend transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${errorMsg}`);
        await sleep(delay);
        continue;
      }
      logError(`Resend email error (${recipientCount} recipient(s)): ${errorMsg}`, {}, error instanceof Error ? error : new Error(errorMsg));
      return false;
    }
  }

  const finalMsg = lastError instanceof Error ? lastError.message : (typeof lastError === 'object' ? JSON.stringify(lastError) : String(lastError));
  logError(`Resend email failed after ${MAX_RETRIES + 1} attempts: ${finalMsg}`, {}, lastError instanceof Error ? lastError : new Error(finalMsg));
  return false;
}

export async function sendNotificationEmail(
  to: string,
  subject: string,
  message: string,
  actionUrl?: string,
  actionText?: string
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">${subject}</h2>
      <p style="color: #666; line-height: 1.6;">${message}</p>
      ${actionUrl ? `
        <p style="margin-top: 20px;">
          <a href="${actionUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            ${actionText || 'View Details'}
          </a>
        </p>
      ` : ''}
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="color: #999; font-size: 12px;">This email was sent from SmartManageAI</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text: message });
}

export async function sendWeeklyPayrollReportEmail(
  to: string,
  weekStartDate: string,
  weekEndDate: string,
  reportUrl: string,
  summary: { totalHours: number; totalEmployees: number; totalAmount?: number }
): Promise<boolean> {
  const subject = `Weekly Payroll Report Ready: ${weekStartDate} - ${weekEndDate}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Weekly Payroll Report Ready</h2>
      <p style="color: #666;">The weekly payroll report for <strong>${weekStartDate} - ${weekEndDate}</strong> has been generated and is ready for review.</p>
      
      <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #333; margin-top: 0;">Summary</h3>
        <p style="margin: 5px 0;"><strong>Total Hours:</strong> ${summary.totalHours.toFixed(2)}</p>
        <p style="margin: 5px 0;"><strong>Employees:</strong> ${summary.totalEmployees}</p>
        ${summary.totalAmount ? `<p style="margin: 5px 0;"><strong>Total Amount:</strong> $${summary.totalAmount.toFixed(2)}</p>` : ''}
      </div>
      
      <p style="margin-top: 20px;">
        <a href="${reportUrl}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          View Full Report
        </a>
      </p>
      
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="color: #999; font-size: 12px;">This email was sent from SmartManageAI</p>
    </div>
  `;

  return sendEmail({ to, subject, html });
}

export function getPasswordResetEmailHtml(resetLink: string, userName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Request</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: #1a365d; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Password Reset Request</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hi ${userName},
      </p>
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        We received a request to reset your password. Click the button below to create a new password:
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
          Reset Password
        </a>
      </div>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        This link will expire in <strong>30 minutes</strong> for security reasons.
      </p>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
      <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${resetLink}" style="color: #2563eb; word-break: break-all;">${resetLink}</a>
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
      <p style="color: #999999; font-size: 12px; margin: 0;">
        SmartManageAI Construction Management Platform
      </p>
    </div>
  </div>
</body>
</html>
`;
}

export function getPasswordResetEmailText(resetLink: string, userName: string): string {
  return `
Hi ${userName},

We received a request to reset your password. Click the link below to create a new password:

${resetLink}

This link will expire in 30 minutes for security reasons.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

---
SmartManageAI Construction Management Platform
`;
}

export function getAdminPasswordResetEmailHtml(resetLink: string, userName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset by Administrator</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: #1a365d; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Password Reset Required</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hi ${userName},
      </p>
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        A platform administrator has initiated a password reset for your account. Please click the button below to set a new password:
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
          Set New Password
        </a>
      </div>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        This link will expire in <strong>30 minutes</strong> for security reasons.
      </p>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        If you did not expect this email, please contact your administrator.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
      <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${resetLink}" style="color: #2563eb; word-break: break-all;">${resetLink}</a>
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
      <p style="color: #999999; font-size: 12px; margin: 0;">
        SmartManageAI Construction Management Platform
      </p>
    </div>
  </div>
</body>
</html>
`;
}

interface InspectionEmailData {
  inspectionNumber: string;
  title: string;
  inspectionType: string;
  projectName: string;
  projectCode: string;
  locationAddress: string | null;
  requestedDate: Date;
  scheduledDate: Date | null;
  requesterName: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  organizationName: string;
  pdfUrl?: string;
}

export async function sendInspectionRequestEmail(
  to: string | string[],
  data: InspectionEmailData
): Promise<boolean> {
  const recipients = Array.isArray(to) ? to.join(', ') : to;
  const html = getInspectionRequestEmailHtml(data);
  const text = getInspectionRequestEmailText(data);

  return sendEmail({
    to: recipients,
    subject: `Inspection Request: ${data.title} - ${data.projectName} [${data.inspectionNumber}]`,
    html,
    text,
  });
}

function getInspectionRequestEmailHtml(data: InspectionEmailData): string {
  const requestedDateStr = new Date(data.requestedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const scheduledDateStr = data.scheduledDate
    ? new Date(data.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : 'To Be Scheduled';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspection Request</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: #1a365d; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">${data.organizationName}</h1>
      <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">INSPECTION REQUEST</p>
    </div>
    <div style="padding: 32px 24px;">
      <div style="background-color: #f0f9ff; border-left: 4px solid #0284c7; padding: 16px; margin-bottom: 24px;">
        <h2 style="color: #0284c7; margin: 0 0 8px; font-size: 18px;">${data.title}</h2>
        <p style="color: #374151; margin: 0; font-size: 14px;">Reference: ${data.inspectionNumber}</p>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #6b7280; font-size: 14px; width: 140px;">Inspection Type:</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #111827; font-size: 14px; font-weight: 500;">${data.inspectionType}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #6b7280; font-size: 14px;">Project:</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #111827; font-size: 14px; font-weight: 500;">${data.projectName} (${data.projectCode})</td>
        </tr>
        ${data.locationAddress ? `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #6b7280; font-size: 14px;">Location:</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #111827; font-size: 14px;">${data.locationAddress}</td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #6b7280; font-size: 14px;">Requested Date:</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #111827; font-size: 14px;">${requestedDateStr}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: #6b7280; font-size: 14px;">Scheduled Date:</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; color: ${data.scheduledDate ? '#059669' : '#6b7280'}; font-size: 14px; font-weight: 500;">${scheduledDateStr}</td>
        </tr>
      </table>

      <p style="color: #374151; font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
        This inspection request has been submitted and requires your attention. Please review the details above and coordinate scheduling as needed.
      </p>

      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
      
      <p style="color: #6b7280; font-size: 14px; margin: 0;">
        <strong>Requested by:</strong><br>
        ${data.requesterName}<br>
        ${data.requesterEmail ? data.requesterEmail + '<br>' : ''}
        ${data.requesterPhone ? data.requesterPhone : ''}
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        ${data.organizationName} | Reference: ${data.inspectionNumber}
      </p>
    </div>
  </div>
</body>
</html>
`;
}

function getInspectionRequestEmailText(data: InspectionEmailData): string {
  const requestedDateStr = new Date(data.requestedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const scheduledDateStr = data.scheduledDate
    ? new Date(data.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : 'To Be Scheduled';

  return `
INSPECTION REQUEST
Reference: ${data.inspectionNumber}

${data.title}

Inspection Type: ${data.inspectionType}
Project: ${data.projectName} (${data.projectCode})
${data.locationAddress ? `Location: ${data.locationAddress}` : ''}
Requested Date: ${requestedDateStr}
Scheduled Date: ${scheduledDateStr}

This inspection request has been submitted and requires your attention. Please review the details above and coordinate scheduling as needed.

---
Requested by:
${data.requesterName}
${data.requesterEmail ? data.requesterEmail : ''}
${data.requesterPhone ? data.requesterPhone : ''}

---
${data.organizationName}
`;
}

export function getEmailVerificationHtml(verifyLink: string, userName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: #1a365d; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Verify Your Email</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hi ${userName},
      </p>
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Welcome to SmartManageAI! Please verify your email address by clicking the button below:
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${verifyLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
          Verify Email
        </a>
      </div>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        This link will expire in <strong>24 hours</strong>.
      </p>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        If you didn't create an account, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
      <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${verifyLink}" style="color: #2563eb; word-break: break-all;">${verifyLink}</a>
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
      <p style="color: #999999; font-size: 12px; margin: 0;">
        SmartManageAI Construction Management Platform
      </p>
    </div>
  </div>
</body>
</html>
`;
}

export function getEmailVerificationText(verifyLink: string, userName: string): string {
  return `
Hi ${userName},

Welcome to SmartManageAI! Please verify your email address by clicking the link below:

${verifyLink}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.

---
SmartManageAI Construction Management Platform
`;
}
