// Resend Email Service
// Uses Resend for transactional email

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Default from email - can be customized per organization
const DEFAULT_FROM_EMAIL = 'SmartManageAI <onboarding@resend.dev>';

export async function getResendClient() {
  return {
    client: resend,
    fromEmail: DEFAULT_FROM_EMAIL
  };
}

// Keep this for backwards compatibility with existing code
export async function getUncachableSendGridClient() {
  return getResendClient();
}

// Email sending helper functions
export interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const { fromEmail } = await getResendClient();
    
    // Normalize recipients
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject: options.subject,
      text: options.text || '',
      html: options.html || options.text || '',
      replyTo: options.replyTo,
    });
    
    if (error) {
      console.error('Resend email error:', error);
      return false;
    }
    
    console.log(`Email sent successfully via Resend to ${recipients.join(', ')}`, data?.id);
    return true;
  } catch (error: any) {
    console.error('Resend email error:', error.message);
    return false;
  }
}

export async function sendTemplateEmail(
  to: string | string[],
  templateId: string,
  dynamicData: Record<string, any>
): Promise<boolean> {
  // Resend doesn't have templates in the same way as SendGrid
  // For now, we'll just send a basic email with the dynamic data
  console.warn('sendTemplateEmail: Resend template emails not implemented, falling back to basic email');
  return sendEmail({
    to,
    subject: dynamicData.subject || 'Notification',
    html: dynamicData.html || JSON.stringify(dynamicData),
    text: dynamicData.text,
  });
}

// Convenience functions for common email types
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
