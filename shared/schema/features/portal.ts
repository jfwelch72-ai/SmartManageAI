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
import { subcontractorPortalTokens } from "./subcontractor";



// ============================================
// FEATURE E: CLIENT PORTAL
// Secure read-only project access for clients/owners
// ============================================
export const clientPortalAccess = pgTable("client_portal_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  accessType: text("access_type").notNull().default("STAKEHOLDER"),
  permissionsJson: text("permissions_json"),
  accessTokenHash: text("access_token_hash"),
  tokenExpiresAt: timestamp("token_expires_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("portal_access_project_idx").on(table.projectId),
  emailIdx: index("portal_access_email_idx").on(table.email),
}));

export const insertClientPortalAccessSchema = createInsertSchema(clientPortalAccess).omit({ id: true, createdAt: true });
export type InsertClientPortalAccess = z.infer<typeof insertClientPortalAccessSchema>;
export type ClientPortalAccess = typeof clientPortalAccess.$inferSelect;

export const clientPortalActivity = pgTable("client_portal_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessId: varchar("access_id").notNull().references(() => clientPortalAccess.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  action: text("action").notNull(),                   // VIEW_SUMMARY, VIEW_PHOTOS, APPROVE_CO, etc.
  detailsJson: text("details_json"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  accessIdx: index("portal_activity_access_idx").on(table.accessId),
  projectIdx: index("portal_activity_project_idx").on(table.projectId),
}));

export const insertClientPortalActivitySchema = createInsertSchema(clientPortalActivity).omit({ id: true, createdAt: true });
export type InsertClientPortalActivity = z.infer<typeof insertClientPortalActivitySchema>;
export type ClientPortalActivity = typeof clientPortalActivity.$inferSelect;

// Portal Activity Log table
export const portalActivityLog = pgTable("portal_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portalTokenId: varchar("portal_token_id").notNull().references(() => subcontractorPortalTokens.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tokenIdx: index("portal_activity_log_token_idx").on(table.portalTokenId),
  actionIdx: index("portal_activity_log_action_idx").on(table.action),
  createdAtIdx: index("portal_activity_log_created_at_idx").on(table.createdAt),
}));

export const insertPortalActivityLogSchema = createInsertSchema(portalActivityLog).omit({ id: true, createdAt: true });
export type InsertPortalActivityLog = z.infer<typeof insertPortalActivityLogSchema>;
export type PortalActivityLog = typeof portalActivityLog.$inferSelect;

// Bid Document Distributions table
export const bidDocumentDistributions = pgTable("bid_document_distributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name").notNull(),
  documentType: text("document_type").notNull(),
  documentId: varchar("document_id"),
  documentTitle: text("document_title").notNull(),
  portalTokenId: varchar("portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "set null" }),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),
  responseNotes: text("response_notes"),
  attachmentsJson: text("attachments_json"),
  messageBody: text("message_body"),
  sentById: varchar("sent_by_id").references(() => users.id),
  sentByName: text("sent_by_name"),
}, (table) => ({
  organizationIdx: index("bid_doc_dist_org_idx").on(table.organizationId),
  bidIdx: index("bid_doc_dist_bid_idx").on(table.bidId),
  crmOrgIdx: index("bid_doc_dist_crm_org_idx").on(table.crmOrganisationId),
  statusIdx: index("bid_doc_dist_status_idx").on(table.status),
  sentAtIdx: index("bid_doc_dist_sent_at_idx").on(table.sentAt),
}));

export const insertBidDocumentDistributionSchema = createInsertSchema(bidDocumentDistributions).omit({ id: true, sentAt: true });
export type InsertBidDocumentDistribution = z.infer<typeof insertBidDocumentDistributionSchema>;
export type BidDocumentDistribution = typeof bidDocumentDistributions.$inferSelect;

// ============================================================
// CLIENT PORTAL CHAT SYSTEM
// Two-way messaging between portal users (clients/subs) and project team members
// ============================================================

export const portalChatThreads = pgTable("portal_chat_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  portalTokenId: varchar("portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "cascade" }),
  clientPortalAccessId: varchar("client_portal_access_id").references(() => clientPortalAccess.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  category: portalChatThreadCategoryEnum("category").notNull().default("GENERAL"),
  linkedEntityType: text("linked_entity_type"),
  linkedEntityId: varchar("linked_entity_id"),
  status: portalChatThreadStatusEnum("status").notNull().default("OPEN"),
  priority: portalChatPriorityEnum("priority").notNull().default("NORMAL"),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  portalUnreadCount: integer("portal_unread_count").notNull().default(0),
  teamUnreadCount: integer("team_unread_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("portal_chat_threads_org_idx").on(table.organizationId),
  projectIdx: index("portal_chat_threads_project_idx").on(table.projectId),
  portalTokenIdx: index("portal_chat_threads_token_idx").on(table.portalTokenId),
  statusIdx: index("portal_chat_threads_status_idx").on(table.status),
  lastMessageIdx: index("portal_chat_threads_last_msg_idx").on(table.lastMessageAt),
}));

export const portalChatMessages = pgTable("portal_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull().references(() => portalChatThreads.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(),
  senderPortalTokenId: varchar("sender_portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "set null" }),
  senderClientAccessId: varchar("sender_client_access_id").references(() => clientPortalAccess.id, { onDelete: "set null" }),
  senderUserId: varchar("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  readByPortal: boolean("read_by_portal").notNull().default(false),
  readByTeam: boolean("read_by_team").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  threadIdx: index("portal_chat_messages_thread_idx").on(table.threadId),
  senderTypeIdx: index("portal_chat_messages_sender_type_idx").on(table.senderType),
  createdAtIdx: index("portal_chat_messages_created_at_idx").on(table.createdAt),
}));

export const insertPortalChatThreadSchema = createInsertSchema(portalChatThreads).omit({ id: true, createdAt: true, updatedAt: true, lastMessageAt: true, portalUnreadCount: true, teamUnreadCount: true });
export type InsertPortalChatThread = z.infer<typeof insertPortalChatThreadSchema>;
export type PortalChatThread = typeof portalChatThreads.$inferSelect;

export const insertPortalChatMessageSchema = createInsertSchema(portalChatMessages).omit({ id: true, createdAt: true });
export type InsertPortalChatMessage = z.infer<typeof insertPortalChatMessageSchema>;
export type PortalChatMessage = typeof portalChatMessages.$inferSelect;

// ============================================================
// PORTAL NOTIFICATIONS
// Notification inbox for external portal users (clients, subs, vendors)
// Separate from the internal `notifications` table which requires a users FK.
// ============================================================

export const portalNotifications = pgTable("portal_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  recipientType: text("recipient_type").notNull(),
  clientPortalAccessId: varchar("client_portal_access_id").references(() => clientPortalAccess.id, { onDelete: "cascade" }),
  portalTokenId: varchar("portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  actionUrl: text("action_url"),
  isRead: boolean("is_read").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  clientAccessIdx: index("portal_notif_client_access_idx").on(table.clientPortalAccessId),
  portalTokenIdx: index("portal_notif_portal_token_idx").on(table.portalTokenId),
  userIdIdx: index("portal_notif_user_id_idx").on(table.userId),
  orgCreatedIdx: index("portal_notif_org_created_idx").on(table.organizationId, table.createdAt),
  isReadIdx: index("portal_notif_is_read_idx").on(table.isRead),
}));

export const insertPortalNotificationSchema = createInsertSchema(portalNotifications).omit({ id: true, createdAt: true });
export type InsertPortalNotification = z.infer<typeof insertPortalNotificationSchema>;
export type PortalNotification = typeof portalNotifications.$inferSelect;

export const portalNotificationPrefs = pgTable("portal_notification_prefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  recipientType: text("recipient_type").notNull(),
  clientPortalAccessId: varchar("client_portal_access_id").references(() => clientPortalAccess.id, { onDelete: "cascade" }),
  portalTokenId: varchar("portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  clientAccessIdx: index("portal_notif_prefs_client_access_idx").on(table.clientPortalAccessId),
  portalTokenIdx: index("portal_notif_prefs_portal_token_idx").on(table.portalTokenId),
  userIdIdx: index("portal_notif_prefs_user_id_idx").on(table.userId),
}));

export const insertPortalNotificationPrefsSchema = createInsertSchema(portalNotificationPrefs).omit({ id: true });
export type InsertPortalNotificationPrefs = z.infer<typeof insertPortalNotificationPrefsSchema>;
export type PortalNotificationPrefs = typeof portalNotificationPrefs.$inferSelect;