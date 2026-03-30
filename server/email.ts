export {
  sendEmail,
  sendNotificationEmail,
  sendWeeklyPayrollReportEmail,
  sendInspectionRequestEmail,
  getPasswordResetEmailHtml,
  getPasswordResetEmailText,
  getAdminPasswordResetEmailHtml,
  getEmailVerificationHtml,
  getEmailVerificationText,
} from './services/emailService';
export type { EmailOptions } from './services/emailService';
