import { sendEmail } from "./email";
import { db } from "./db";
import { users, organizations, organizationNetworkSettings, notifications } from "@shared/schema";
import { insertNotification } from "./services/notificationService";
import { eq, and, or } from "drizzle-orm";
import {logInfo, logError, logWarn } from "./utils/logger";

interface NotificationRecipient {
  email: string;
  firstName?: string;
  organizationName?: string;
}

interface BidRequestInfo {
  id: string;
  title: string;
  scopeOfWork: string;
  bidDueDate: Date;
  requiredTrades: string[];
  projectCity?: string;
  projectState?: string;
  gcOrganizationName: string;
}

interface InvitationInfo {
  id: string;
  personalMessage?: string;
}

interface ResponseInfo {
  id: string;
  totalBidAmount: number;
  subOrganizationName: string;
  submittedAt: Date;
}

const APP_NAME = "SmartManageAI";
const BASE_URL = process.env.REPLIT_DEV_DOMAIN 
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
  : process.env.REPLIT_DOMAINS 
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` 
    : "http://localhost:5000";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

async function getOrgNotificationSettings(organizationId: string): Promise<{ notifyByEmail: boolean; notifyInApp: boolean }> {
  try {
    const [settings] = await db
      .select()
      .from(organizationNetworkSettings)
      .where(eq(organizationNetworkSettings.organizationId, organizationId));
    
    return {
      notifyByEmail: settings?.notifyByEmail ?? true,
      notifyInApp: settings?.notifyInApp ?? true,
    };
  } catch {
    logWarn("Non-critical operation failed");
    return { notifyByEmail: true, notifyInApp: true };
  }
}

async function getOrgAdminEmails(organizationId: string): Promise<NotificationRecipient[]> {
  try {
    const admins = await db
      .select({
        email: users.email,
        firstName: users.firstName,
      })
      .from(users)
      .where(and(
        eq(users.organizationId, organizationId),
        eq(users.role, "ADMIN")
      ));
    
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    
    return admins.map(a => ({
      email: a.email,
      firstName: a.firstName || undefined,
      organizationName: org?.name,
    }));
  } catch {
    logWarn("Non-critical operation failed");
    return [];
  }
}

export async function sendBidInvitationNotification(
  recipientOrganizationId: string,
  bidRequest: BidRequestInfo,
  invitation: InvitationInfo
): Promise<boolean> {
  try {
    const settings = await getOrgNotificationSettings(recipientOrganizationId);
    
    if (!settings.notifyByEmail) {
      logInfo("Email notifications disabled for org", { organizationId: recipientOrganizationId });
      return true;
    }
    
    const recipients = await getOrgAdminEmails(recipientOrganizationId);
    
    if (recipients.length === 0) {
      logInfo("No admin recipients found", { organizationId: recipientOrganizationId });
      return true;
    }
    
    const location = [bidRequest.projectCity, bidRequest.projectState].filter(Boolean).join(", ");
    const tradesFormatted = bidRequest.requiredTrades.map(t => t.replace(/_/g, " ")).join(", ");
    
    for (const recipient of recipients) {
      const subject = `New Bid Invitation: ${bidRequest.title}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
            .detail-label { color: #64748b; }
            .detail-value { font-weight: 600; }
            .cta-button { display: inline-block; background: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .personal-message { background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 20px 0; font-style: italic; }
            .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">New Bid Invitation</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">from ${bidRequest.gcOrganizationName}</p>
            </div>
            <div class="content">
              <p>Hi${recipient.firstName ? ` ${recipient.firstName}` : ""},</p>
              <p>You've been invited to submit a bid for the following project:</p>
              
              <h2 style="color: #1e40af; margin-top: 25px;">${bidRequest.title}</h2>
              
              <div class="details">
                <div class="detail-row">
                  <span class="detail-label">Required Trades</span>
                  <span class="detail-value">${tradesFormatted}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Bid Due Date</span>
                  <span class="detail-value">${formatDate(bidRequest.bidDueDate)}</span>
                </div>
                ${location ? `
                <div class="detail-row">
                  <span class="detail-label">Location</span>
                  <span class="detail-value">${location}</span>
                </div>
                ` : ""}
                <div class="detail-row">
                  <span class="detail-label">General Contractor</span>
                  <span class="detail-value">${bidRequest.gcOrganizationName}</span>
                </div>
              </div>
              
              ${invitation.personalMessage ? `
              <div class="personal-message">
                <strong>Personal Message:</strong><br>
                "${invitation.personalMessage}"
              </div>
              ` : ""}
              
              <p><strong>Scope Summary:</strong></p>
              <p style="color: #475569;">${bidRequest.scopeOfWork.substring(0, 300)}${bidRequest.scopeOfWork.length > 300 ? "..." : ""}</p>
              
              <center>
                <a href="${BASE_URL}/bid-inbox/${invitation.id}" class="cta-button">View Invitation & Submit Bid</a>
              </center>
              
              <p style="color: #64748b; font-size: 14px;">
                Don't miss this opportunity! Make sure to review the full scope and submit your bid before the deadline.
              </p>
            </div>
            <div class="footer">
              <p>This email was sent by ${APP_NAME}</p>
              <p>You're receiving this because your organization is registered on the Bid Network.</p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      const text = `
New Bid Invitation from ${bidRequest.gcOrganizationName}

Hi${recipient.firstName ? ` ${recipient.firstName}` : ""},

You've been invited to submit a bid for: ${bidRequest.title}

Required Trades: ${tradesFormatted}
Bid Due Date: ${formatDate(bidRequest.bidDueDate)}
${location ? `Location: ${location}` : ""}

${invitation.personalMessage ? `Personal Message: "${invitation.personalMessage}"` : ""}

Scope Summary:
${bidRequest.scopeOfWork.substring(0, 300)}${bidRequest.scopeOfWork.length > 300 ? "..." : ""}

View the full invitation and submit your bid at:
${BASE_URL}/bid-inbox/${invitation.id}

---
This email was sent by ${APP_NAME}
      `;
      
      await sendEmail({
        to: recipient.email,
        subject,
        html,
        text,
      });
    }
    
    logInfo("Bid invitation notification sent", { 
      organizationId: recipientOrganizationId, 
      bidRequestId: bidRequest.id,
      recipientCount: recipients.length 
    });
    
    return true;
  } catch (error) {
    logError("Failed to send bid invitation notification", error as Error);
    return false;
  }
}

export async function sendBidResponseNotification(
  gcOrganizationId: string,
  bidRequest: BidRequestInfo,
  response: ResponseInfo
): Promise<boolean> {
  try {
    const settings = await getOrgNotificationSettings(gcOrganizationId);
    
    if (!settings.notifyByEmail) {
      logInfo("Email notifications disabled for org", { organizationId: gcOrganizationId });
      return true;
    }
    
    const recipients = await getOrgAdminEmails(gcOrganizationId);
    
    if (recipients.length === 0) {
      logInfo("No admin recipients found", { organizationId: gcOrganizationId });
      return true;
    }
    
    for (const recipient of recipients) {
      const subject = `New Bid Response: ${bidRequest.title} - ${formatCurrency(response.totalBidAmount)}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .bid-amount { background: white; padding: 25px; border-radius: 8px; margin: 20px 0; text-align: center; }
            .amount { font-size: 36px; font-weight: bold; color: #059669; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
            .cta-button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">New Bid Response Received!</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">for ${bidRequest.title}</p>
            </div>
            <div class="content">
              <p>Hi${recipient.firstName ? ` ${recipient.firstName}` : ""},</p>
              <p>Great news! You've received a new bid response.</p>
              
              <div class="bid-amount">
                <p style="color: #64748b; margin: 0;">Bid Amount</p>
                <p class="amount">${formatCurrency(response.totalBidAmount)}</p>
                <p style="color: #64748b; margin: 10px 0 0 0;">from ${response.subOrganizationName}</p>
              </div>
              
              <div class="details">
                <div class="detail-row">
                  <span style="color: #64748b;">Project</span>
                  <span style="font-weight: 600;">${bidRequest.title}</span>
                </div>
                <div class="detail-row">
                  <span style="color: #64748b;">Submitted</span>
                  <span style="font-weight: 600;">${formatDate(response.submittedAt)}</span>
                </div>
                <div class="detail-row" style="border: none;">
                  <span style="color: #64748b;">Due Date</span>
                  <span style="font-weight: 600;">${formatDate(bidRequest.bidDueDate)}</span>
                </div>
              </div>
              
              <center>
                <a href="${BASE_URL}/bid-network/${bidRequest.id}" class="cta-button">Review Response</a>
              </center>
              
              <p style="color: #64748b; font-size: 14px;">
                Review the full proposal details, compare with other responses, and take action.
              </p>
            </div>
            <div class="footer">
              <p>This email was sent by ${APP_NAME}</p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      const text = `
New Bid Response Received!

Hi${recipient.firstName ? ` ${recipient.firstName}` : ""},

You've received a new bid response for: ${bidRequest.title}

Bid Amount: ${formatCurrency(response.totalBidAmount)}
From: ${response.subOrganizationName}
Submitted: ${formatDate(response.submittedAt)}

Review the response at:
${BASE_URL}/bid-network/${bidRequest.id}

---
This email was sent by ${APP_NAME}
      `;
      
      await sendEmail({
        to: recipient.email,
        subject,
        html,
        text,
      });
    }
    
    logInfo("Bid response notification sent", { 
      organizationId: gcOrganizationId, 
      bidRequestId: bidRequest.id,
      responseId: response.id 
    });
    
    return true;
  } catch (error) {
    logError("Failed to send bid response notification", error as Error);
    return false;
  }
}

export async function sendClarificationNotification(
  recipientOrganizationId: string,
  bidRequest: BidRequestInfo,
  question: string,
  isAnswer: boolean,
  answer?: string
): Promise<boolean> {
  try {
    const settings = await getOrgNotificationSettings(recipientOrganizationId);
    
    if (!settings.notifyByEmail) {
      return true;
    }
    
    const recipients = await getOrgAdminEmails(recipientOrganizationId);
    
    if (recipients.length === 0) {
      return true;
    }
    
    for (const recipient of recipients) {
      const subject = isAnswer 
        ? `Clarification Answered: ${bidRequest.title}`
        : `New Question: ${bidRequest.title}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: ${isAnswer ? "#8b5cf6" : "#f59e0b"}; color: white; padding: 30px; border-radius: 8px 8px 0 0; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .question-box { background: white; padding: 20px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 20px 0; }
            .answer-box { background: #f0fdf4; padding: 20px; border-left: 4px solid #10b981; border-radius: 4px; margin: 20px 0; }
            .cta-button { display: inline-block; background: ${isAnswer ? "#8b5cf6" : "#f59e0b"}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">${isAnswer ? "Clarification Answered" : "New Question Received"}</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${bidRequest.title}</p>
            </div>
            <div class="content">
              <p>Hi${recipient.firstName ? ` ${recipient.firstName}` : ""},</p>
              
              <div class="question-box">
                <strong>Question:</strong>
                <p style="margin: 10px 0 0 0;">${question}</p>
              </div>
              
              ${isAnswer && answer ? `
              <div class="answer-box">
                <strong>Answer:</strong>
                <p style="margin: 10px 0 0 0;">${answer}</p>
              </div>
              ` : ""}
              
              <center>
                <a href="${BASE_URL}/${isAnswer ? "bid-inbox" : "bid-network"}/${bidRequest.id}" class="cta-button">
                  ${isAnswer ? "View Full Details" : "Answer Question"}
                </a>
              </center>
            </div>
            <div class="footer">
              <p>This email was sent by ${APP_NAME}</p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      await sendEmail({
        to: recipient.email,
        subject,
        html,
      });
    }
    
    return true;
  } catch (error) {
    logError("Failed to send clarification notification", error as Error);
    return false;
  }
}

export async function createBidNetworkInAppNotification(
  organizationId: string,
  type: "BID_INVITATION_RECEIVED" | "BID_RESPONSE_RECEIVED" | "BID_CLARIFICATION_NEW",
  title: string,
  message: string,
  relatedEntityId?: string,
  relatedEntityType?: string
): Promise<void> {
  try {
    const settings = await getOrgNotificationSettings(organizationId);
    if (!settings.notifyInApp) return;

    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.organizationId, organizationId),
        or(eq(users.role, "ADMIN"), eq(users.role, "MANAGER"))
      ));

    if (admins.length === 0) return;

    for (const admin of admins) {
      await insertNotification({
        userId: admin.id,
        organizationId,
        type,
        title,
        message,
        relatedEntityId: relatedEntityId || null,
        relatedEntityType: relatedEntityType || null,
        isRead: false,
      });
    }

    logInfo("In-app notification created", { organizationId, type, recipientCount: admins.length });
  } catch (error) {
    logError("Failed to create in-app notification", error as Error);
  }
}

export async function sendRfqEmail(
  recipientEmail: string,
  recipientName: string,
  bidTitle: string,
  scopeDescription: string,
  gcOrganizationName: string,
  quoteType: "subcontractor" | "material",
  bidDueDate?: Date,
  responseToken?: string
): Promise<boolean> {
  try {
    const safeBidTitle = escapeHtml(bidTitle);
    const safeGcName = escapeHtml(gcOrganizationName);
    const safeRecipientName = escapeHtml(recipientName);
    const safeScope = escapeHtml(scopeDescription.substring(0, 500));

    const subject = `Request for Quote: ${bidTitle} - ${gcOrganizationName}`;
    const typeLabel = quoteType === "subcontractor" ? "Subcontractor Services" : "Materials & Supplies";

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
          .detail-label { color: #64748b; font-size: 13px; }
          .detail-value { font-weight: 600; margin-top: 4px; }
          .scope-box { background: white; padding: 20px; border-left: 4px solid #6366f1; border-radius: 4px; margin: 20px 0; }
          .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Request for Quote</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">from ${safeGcName}</p>
          </div>
          <div class="content">
            <p>Hi${safeRecipientName ? ` ${safeRecipientName}` : ""},</p>
            <p>${safeGcName} is requesting a quote from you for the following project:</p>
            
            <div class="details">
              <div class="detail-row">
                <div class="detail-label">Project</div>
                <div class="detail-value">${safeBidTitle}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Quote Type</div>
                <div class="detail-value">${typeLabel}</div>
              </div>
              ${bidDueDate ? `
              <div class="detail-row">
                <div class="detail-label">Response Needed By</div>
                <div class="detail-value">${formatDate(bidDueDate)}</div>
              </div>
              ` : ""}
            </div>
            
            <div class="scope-box">
              <strong>Scope Description:</strong>
              <p style="margin: 10px 0 0 0; color: #475569;">${safeScope}${scopeDescription.length > 500 ? "..." : ""}</p>
            </div>
            
            ${responseToken ? `
            <div style="text-align: center; margin: 20px 0;">
              <a href="${BASE_URL}/rfq-response/${responseToken}" 
                 style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                Submit Your Quote Online
              </a>
              <p style="color: #64748b; font-size: 12px; margin-top: 10px;">
                Or copy this link: ${BASE_URL}/rfq-response/${responseToken}
              </p>
            </div>
            ` : ""}
            
            <p style="color: #64748b; font-size: 14px;">
              Please respond to ${safeGcName} with your pricing and availability at your earliest convenience.
            </p>
          </div>
          <div class="footer">
            <p>This email was sent by ${APP_NAME} on behalf of ${safeGcName}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const responseLink = responseToken ? `\nSubmit your quote online: ${BASE_URL}/rfq-response/${responseToken}\n` : "";
    const text = `Request for Quote from ${gcOrganizationName}\n\nHi${recipientName ? ` ${recipientName}` : ""},\n\n${gcOrganizationName} is requesting a quote from you for: ${bidTitle}\nType: ${typeLabel}\n${bidDueDate ? `Response Needed By: ${formatDate(bidDueDate)}\n` : ""}${responseLink}\nScope: ${scopeDescription.substring(0, 500)}\n\nPlease respond with your pricing and availability.\n\n---\nThis email was sent by ${APP_NAME}`;

    await sendEmail({ to: recipientEmail, subject, html, text });
    logInfo("RFQ email sent", { to: recipientEmail, bidTitle, quoteType });
    return true;
  } catch (error) {
    logError("Failed to send RFQ email", error as Error);
    return false;
  }
}

export async function sendBidReminderNotification(
  recipientOrganizationId: string,
  bidRequest: BidRequestInfo,
  invitationId: string,
  daysRemaining: number
): Promise<boolean> {
  try {
    const settings = await getOrgNotificationSettings(recipientOrganizationId);
    
    if (!settings.notifyByEmail) {
      return true;
    }
    
    const recipients = await getOrgAdminEmails(recipientOrganizationId);
    
    for (const recipient of recipients) {
      const subject = `Reminder: Bid Due in ${daysRemaining} Day${daysRemaining === 1 ? "" : "s"} - ${bidRequest.title}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
            .countdown { font-size: 48px; font-weight: bold; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .cta-button { display: inline-block; background: #ef4444; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header" style="text-align: center;">
              <p class="countdown">${daysRemaining}</p>
              <p style="margin: 0; font-size: 18px;">Day${daysRemaining === 1 ? "" : "s"} Remaining</p>
            </div>
            <div class="content">
              <p>Hi${recipient.firstName ? ` ${recipient.firstName}` : ""},</p>
              <p>This is a friendly reminder that the bid deadline is approaching for:</p>
              
              <h2 style="color: #dc2626;">${bidRequest.title}</h2>
              <p><strong>Due:</strong> ${formatDate(bidRequest.bidDueDate)}</p>
              <p><strong>From:</strong> ${bidRequest.gcOrganizationName}</p>
              
              <center>
                <a href="${BASE_URL}/bid-inbox/${invitationId}" class="cta-button">Submit Your Bid Now</a>
              </center>
              
              <p style="color: #64748b; font-size: 14px;">
                Don't miss out on this opportunity. Make sure to submit your bid before the deadline!
              </p>
            </div>
            <div class="footer">
              <p>This email was sent by ${APP_NAME}</p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      await sendEmail({
        to: recipient.email,
        subject,
        html,
      });
    }
    
    logInfo("Bid reminder notification sent", { 
      organizationId: recipientOrganizationId, 
      bidRequestId: bidRequest.id,
      daysRemaining 
    });
    
    return true;
  } catch (error) {
    logError("Failed to send bid reminder notification", error as Error);
    return false;
  }
}
