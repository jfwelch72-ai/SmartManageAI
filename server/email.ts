import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('Email configuration not set. Email would have been sent to:', options.to);
    console.log('Subject:', options.subject);
    console.log('---');
    console.log('To enable email sending, set SMTP_USER and SMTP_PASS environment variables.');
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log('Email sent successfully to:', options.to);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
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
        TFR Construction Management Platform
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
TFR Construction Management Platform
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
        TFR Construction Management Platform
      </p>
    </div>
  </div>
</body>
</html>
`;
}
