// SendGrid Email Service - Replit Integration
// Uses the Replit SendGrid connector for secure API key management

import sgMail from '@sendgrid/mail';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
export async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
  };
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
    const { client, fromEmail } = await getUncachableSendGridClient();
    
    const msg = {
      to: options.to,
      from: fromEmail,
      subject: options.subject,
      text: options.text || '',
      html: options.html || options.text || '',
      replyTo: options.replyTo,
    };
    
    await client.send(msg);
    console.log(`Email sent successfully to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
    return true;
  } catch (error: any) {
    console.error('SendGrid email error:', error?.response?.body || error.message);
    return false;
  }
}

export async function sendTemplateEmail(
  to: string | string[],
  templateId: string,
  dynamicData: Record<string, any>
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    
    const msg = {
      to,
      from: fromEmail,
      templateId,
      dynamicTemplateData: dynamicData,
    };
    
    await client.send(msg);
    console.log(`Template email sent successfully to ${Array.isArray(to) ? to.join(', ') : to}`);
    return true;
  } catch (error: any) {
    console.error('SendGrid template email error:', error?.response?.body || error.message);
    return false;
  }
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
