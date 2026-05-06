// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { crmOrganisations } from "./crm";



// ====================================================================
// EMAIL AI SYSTEM
// ====================================================================

// Email Provider Enum
export const emailAccounts = pgTable("email_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: emailProviderEnum("provider").notNull(),
  emailAddress: text("email_address").notNull(),
  displayName: text("display_name"),
  
  // OAuth fields (for Gmail/Outlook)
  oauthProviderId: text("oauth_provider_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  
  // IMAP/SMTP fields
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapSecure: boolean("imap_secure"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure"),
  imapUsername: text("imap_username"),
  imapPassword: text("imap_password"), // Should be encrypted in production
  
  isActive: boolean("is_active").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  lastSyncError: text("last_sync_error"),

  // Incremental sync cursors (Task #522)
  gmailHistoryId: text("gmail_history_id"),
  outlookDeltaInbox: text("outlook_delta_inbox"),
  outlookDeltaSent: text("outlook_delta_sent"),
  lastFullSyncAt: timestamp("last_full_sync_at"),
  // OK | DEGRADED | ERROR | NEEDS_RECONNECT
  syncStatus: text("sync_status").notNull().default("OK"),

  // Real-time push notification subscriptions (Task #524)
  // Gmail: a watch on the user's mailbox publishes events to a Pub/Sub topic.
  // The watch returns the historyId at registration time and an expiration
  // (max 7 days) — we renew before expiry.
  gmailWatchExpiration: timestamp("gmail_watch_expiration"),
  gmailWatchHistoryId: text("gmail_watch_history_id"),
  // Outlook: a Microsoft Graph subscription against the inbox folder posts
  // notifications to our webhook. Subscriptions expire after ~70 hours and
  // we renew before they lapse. clientState is a per-account secret that we
  // verify on every incoming notification.
  outlookSubscriptionId: text("outlook_subscription_id"),
  outlookSubscriptionExpiration: timestamp("outlook_subscription_expiration"),
  outlookSubscriptionClientState: text("outlook_subscription_client_state"),
  // Per-subscription rotating webhook token embedded in the notificationUrl
  // (Task #548). Hardens the Outlook webhook against URL leaks: even if a
  // single subscription's URL is exfiltrated, only that one mailbox's
  // notifications can be replayed, and the token rotates whenever the
  // subscription is recreated. Falls back to the global EMAIL_WEBHOOK_SECRET
  // for local-testing setups that haven't been migrated yet.
  outlookSubscriptionWebhookToken: text("outlook_subscription_webhook_token"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_accounts_org_idx").on(table.organizationId),
  userIdx: index("email_accounts_user_idx").on(table.userId),
  emailIdx: index("email_accounts_email_idx").on(table.emailAddress),
}));

export const insertEmailAccountSchema = createInsertSchema(emailAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type EmailAccount = typeof emailAccounts.$inferSelect;

// Email Threads Table
export const emailThreads = pgTable("email_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailAccountId: varchar("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  
  subject: text("subject").notNull(),
  externalThreadId: text("external_thread_id"), // Provider's thread ID
  
  // Linked entities (optional)
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  
  status: emailThreadStatusEnum("status").notNull().default("OPEN"),
  messageCount: integer("message_count").notNull().default(0),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  
  // AI-generated fields
  aiSummary: text("ai_summary"),
  primaryClassification: emailClassificationEnum("primary_classification"),
  aiMetadata: text("ai_metadata"), // JSON with extracted entities
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_threads_org_idx").on(table.organizationId),
  accountIdx: index("email_threads_account_idx").on(table.emailAccountId),
  projectIdx: index("email_threads_project_idx").on(table.projectId),
  bidIdx: index("email_threads_bid_idx").on(table.bidId),
  statusIdx: index("email_threads_status_idx").on(table.status),
  lastMessageIdx: index("email_threads_last_message_idx").on(table.lastMessageAt),
}));

export const insertEmailThreadSchema = createInsertSchema(emailThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailThread = z.infer<typeof insertEmailThreadSchema>;
export type EmailThread = typeof emailThreads.$inferSelect;

// Email Messages Table
export const emailMessages = pgTable("email_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailAccountId: varchar("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  threadId: varchar("thread_id").notNull().references(() => emailThreads.id, { onDelete: "cascade" }),
  
  externalId: text("external_id").notNull(), // Provider message ID
  
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  toAddresses: text("to_addresses"), // JSON array
  ccAddresses: text("cc_addresses"), // JSON array
  bccAddresses: text("bcc_addresses"), // JSON array
  
  subject: text("subject").notNull(),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  snippet: text("snippet"), // Preview text
  
  receivedAt: timestamp("received_at").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  isIncoming: boolean("is_incoming").notNull().default(true),
  isArchived: boolean("is_archived").notNull().default(false),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  // 'INBOX' | 'SENT' | 'ARCHIVE' | 'OTHER' (Task #522 — informational)
  folder: text("folder").notNull().default("INBOX"),
  // Task #522 — pending state push-back to provider, processed async by job runner.
  // Shape: { isRead?: boolean, isArchived?: boolean, attempts?: number }
  pendingProviderPush: jsonb("pending_provider_push"),

  // AI Classification
  classification: emailClassificationEnum("classification"),
  aiMetadata: text("ai_metadata"), // JSON with extracted data
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_messages_org_idx").on(table.organizationId),
  accountIdx: index("email_messages_account_idx").on(table.emailAccountId),
  threadIdx: index("email_messages_thread_idx").on(table.threadId),
  externalIdIdx: index("email_messages_external_id_idx").on(table.externalId),
  receivedAtIdx: index("email_messages_received_at_idx").on(table.receivedAt),
  classificationIdx: index("email_messages_classification_idx").on(table.classification),
  // Idempotency: provider message IDs are unique within an account (Task #522)
  accountExternalIdUnique: uniqueIndex("email_messages_account_external_id_uidx").on(
    table.emailAccountId,
    table.externalId,
  ),
}));

export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;
export type EmailMessage = typeof emailMessages.$inferSelect;

// Email Attachments Table
export const emailAttachments = pgTable("email_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailMessageId: varchar("email_message_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
  
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(), // Object storage key
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_attachments_org_idx").on(table.organizationId),
  messageIdx: index("email_attachments_message_idx").on(table.emailMessageId),
}));

export const insertEmailAttachmentSchema = createInsertSchema(emailAttachments).omit({ id: true, createdAt: true });
export type InsertEmailAttachment = z.infer<typeof insertEmailAttachmentSchema>;
export type EmailAttachment = typeof emailAttachments.$inferSelect;

// DEPRECATED: email_tasks table
// Email-derived tasks are now stored in the unified 'tasks' table (line 633) with sourceType="EMAIL"
// The emailTasks table is kept for migration reference only. New code should use the unified tasks table.
// See tasks.sourceType, tasks.emailThreadId, tasks.emailMessageId, tasks.aiMetadata for email task fields.

export const emailTasks = pgTable("email_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  emailThreadId: varchar("email_thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
  emailMessageId: varchar("email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  dueDate: timestamp("due_date"),
  sourceType: emailTaskSourceEnum("source_type").notNull().default("EMAIL"),
  aiMetadata: text("ai_metadata"),
  completedAt: timestamp("completed_at"),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_tasks_org_idx").on(table.organizationId),
  projectIdx: index("email_tasks_project_idx").on(table.projectId),
  assignedIdx: index("email_tasks_assigned_idx").on(table.assignedToUserId),
  statusIdx: index("email_tasks_status_idx").on(table.status),
  threadIdx: index("email_tasks_thread_idx").on(table.emailThreadId),
  dueDateIdx: index("email_tasks_due_date_idx").on(table.dueDate),
}));

// DEPRECATED: Use insertTaskSchema and Task types instead
export const insertEmailTaskSchema = createInsertSchema(emailTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailTask = z.infer<typeof insertEmailTaskSchema>;
export type EmailTask = typeof emailTasks.$inferSelect;

// AI Email Summaries Table (daily/weekly digest cache)
export const emailSummaries = pgTable("email_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  summaryType: text("summary_type").notNull(), // "DAILY" or "WEEKLY"
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  summaryContent: text("summary_content").notNull(), // AI-generated summary
  highlightsJson: text("highlights_json"), // JSON with key points
  
  emailCount: integer("email_count").notNull().default(0),
  tasksCreated: integer("tasks_created").notNull().default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_summaries_org_idx").on(table.organizationId),
  userIdx: index("email_summaries_user_idx").on(table.userId),
  periodIdx: index("email_summaries_period_idx").on(table.periodStart, table.periodEnd),
}));

export const insertEmailSummarySchema = createInsertSchema(emailSummaries).omit({ id: true, createdAt: true });
export type InsertEmailSummary = z.infer<typeof insertEmailSummarySchema>;
export type EmailSummary = typeof emailSummaries.$inferSelect;

export const emailCampaigns = pgTable("email_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlContent: text("html_content").notNull(),
  textContent: text("text_content"),
  fromName: text("from_name"),
  replyTo: text("reply_to"),
  status: text("status").notNull().default("DRAFT"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  totalRecipients: integer("total_recipients").default(0),
  totalSent: integer("total_sent").default(0),
  totalOpened: integer("total_opened").default(0),
  totalClicked: integer("total_clicked").default(0),
  totalBounced: integer("total_bounced").default(0),
  totalUnsubscribed: integer("total_unsubscribed").default(0),
  tags: text("tags").array(),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_campaigns_org_idx").on(table.organizationId),
}));

export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;

export const emailCampaignContacts = pgTable("email_campaign_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => emailCampaigns.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  status: text("status").notNull().default("PENDING"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  errorMessage: text("error_message"),
}, (table) => ({
  campaignIdx: index("email_campaign_contacts_campaign_idx").on(table.campaignId),
}));

export const insertEmailCampaignContactSchema = createInsertSchema(emailCampaignContacts).omit({ id: true });
export type InsertEmailCampaignContact = z.infer<typeof insertEmailCampaignContactSchema>;
export type EmailCampaignContact = typeof emailCampaignContacts.$inferSelect;

export const emailCampaignTemplates = pgTable("email_campaign_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  subject: text("subject"),
  htmlContent: text("html_content").notNull(),
  category: text("category").default("GENERAL"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_campaign_templates_org_idx").on(table.organizationId),
}));

export const insertEmailCampaignTemplateSchema = createInsertSchema(emailCampaignTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailCampaignTemplate = z.infer<typeof insertEmailCampaignTemplateSchema>;
export type EmailCampaignTemplate = typeof emailCampaignTemplates.$inferSelect;